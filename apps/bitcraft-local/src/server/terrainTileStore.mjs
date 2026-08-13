import { createHash } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import { createMapTilePackStore } from "./mapTilePackStore.mjs";
import { TERRAIN_PALETTE_VERSION } from "./terrainPalette.mjs";

const APOTHEM = 2 / Math.sqrt(3);
const DEFAULT_LIMITS = Object.freeze({
  minZoom: -5,
  maxZoom: 0,
  tileSize: 256,
  maxTiles: 50_000,
  maxBytes: 512 * 1024 * 1024,
  maxTileBytes: 2 * 1024 * 1024,
  deadlineMs: 120_000,
});
const TERRAIN_STYLES = Object.freeze([
  "terrain",
  "water",
  ...Array.from({ length: 256 }, (_, biomeType) => `biome-${biomeType}`),
]);

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeGeneration(value) {
  const generation = String(value ?? "");
  if (!/^\d+$/.test(generation)) throw new TypeError("Terrain bundle generation must be a decimal integer");
  return generation;
}

function currentDate(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Terrain tile store clock returned an invalid date");
  return date;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function durableJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeDurableBytes(filePath, bytes) {
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function enumerateTiles(generation, limits) {
  const { side, cellSize } = generation.evidence ?? {};
  if (!Number.isSafeInteger(side) || side <= 0 || !Number.isFinite(cellSize) || cellSize <= 0) throw new TypeError("Terrain bundle requires verified layout dimensions");
  const bounds = generation.regionBounds;
  if (!bounds) throw new TypeError("Terrain bundle requires region bounds");
  const chunkSpan = side * cellSize;
  const minX = bounds.minChunkX * chunkSpan;
  const maxX = (bounds.maxChunkX + 1) * chunkSpan;
  const minZ = bounds.minChunkZ * chunkSpan;
  const maxZ = (bounds.maxChunkZ + 1) * chunkSpan;
  const tiles = [];
  for (let zoom = limits.minZoom; zoom <= limits.maxZoom; zoom += 1) {
    const scale = 2 ** zoom;
    const minTileX = Math.floor((minX * scale) / limits.tileSize);
    const maxTileX = Math.floor(((maxX * scale) - Number.EPSILON) / limits.tileSize);
    const minProjectedY = -maxZ / APOTHEM;
    const maxProjectedY = -minZ / APOTHEM;
    const minTileY = Math.floor((minProjectedY * scale) / limits.tileSize);
    const maxTileY = Math.floor(((maxProjectedY * scale) - Number.EPSILON) / limits.tileSize);
    for (let x = minTileX; x <= maxTileX; x += 1) for (let y = minTileY; y <= maxTileY; y += 1) tiles.push({ zoom, x, y });
  }
  return { tiles, bounds: { minX, minZ, maxX, maxZ } };
}

export function createTerrainTileStore({ dataDir, encoder, now = () => new Date(), limits: limitOverrides = {} }) {
  if (typeof encoder !== "function") throw new TypeError("Terrain tile store requires an encoder");
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const root = path.resolve(dataDir, "map-tiles");
  if (!within(path.resolve(dataDir), root)) throw new TypeError("Terrain tile store path escapes data directory");
  const packStore = createMapTilePackStore({ root, allowedStyles: TERRAIN_STYLES, maxTileBytes: limits.maxTileBytes });
  let closed = false;
  let queue = Promise.resolve();

  async function build(generation) {
    if (closed) throw new Error("Terrain tile store is closed");
    const generationId = safeGeneration(generation.generation);
    const { tiles, bounds } = enumerateTiles(generation, limits);
    if (!tiles.length || tiles.length > limits.maxTiles) throw new RangeError(`Terrain bundle exceeded ${limits.maxTiles} tile budget`);
    const generatedAt = currentDate(now);
    const version = `g-${generationId}-${generatedAt.getTime()}-${process.pid}`;
    const staging = path.resolve(root, `.staging-${version}`);
    if (!within(root, staging)) throw new TypeError("Terrain bundle staging path escapes store");
    const started = Date.now();
    let totalBytes = 0;
    let tileCount = 0;
    const files = [];
    const channelBytes = { terrain: 0, water: 0, biomeMasks: 0 };
    const channelTileCounts = { terrain: 0, water: 0, biomeMasks: 0 };
    const presentBiomeIds = new Set();
    const presentWaterTypes = new Set();
    try {
      await mkdir(root, { recursive: true });
      await mkdir(staging, { recursive: false });
      for (const tile of tiles) {
        if (Date.now() - started > limits.deadlineMs) throw new Error(`Terrain bundle exceeded ${limits.deadlineMs}ms deadline`);
        const channels = await encoder({ generation, zoom: tile.zoom, x: tile.x, y: tile.y, tileSize: limits.tileSize });
        for (const waterType of channels?.waterTypes ?? []) {
          if (["lake", "river", "ocean", "ocean-biome", "swamp"].includes(waterType)) presentWaterTypes.add(waterType);
        }
        const outputs = [
          { style: "terrain", group: "terrain", value: channels?.terrain },
          { style: "water", group: "water", value: channels?.water },
          ...[...(channels?.biomeMasks instanceof Map ? channels.biomeMasks : [])].map(([biomeType, value]) => ({
            style: `biome-${biomeType}`,
            group: "biomeMasks",
            biomeType: Number(biomeType),
            value,
          })),
        ];
        for (const output of outputs) {
          if (output.group === "biomeMasks" && (!Number.isInteger(output.biomeType) || output.biomeType < 0 || output.biomeType > 255)) throw new TypeError("Terrain biome mask type must be between 0 and 255");
          const bytes = Buffer.from(output.value ?? []);
          if (!bytes.byteLength && output.group === "biomeMasks") continue;
          if (!bytes.byteLength) throw new TypeError(`Terrain ${output.style} channel must not be empty`);
          if (bytes.byteLength > limits.maxTileBytes) throw new RangeError(`Terrain tile exceeded ${limits.maxTileBytes} tile byte budget`);
          tileCount += 1;
          totalBytes += bytes.byteLength;
          channelBytes[output.group] += bytes.byteLength;
          channelTileCounts[output.group] += 1;
          if (tileCount > limits.maxTiles) throw new RangeError(`Terrain bundle exceeded ${limits.maxTiles} tile budget`);
          if (totalBytes > limits.maxBytes) throw new RangeError(`Terrain bundle exceeded ${limits.maxBytes} byte budget`);
          if (output.group === "biomeMasks") presentBiomeIds.add(output.biomeType);
          const relativeTilePath = path.posix.join("tiles", output.style, String(tile.zoom), String(tile.x), `${tile.y}.webp`);
          const directory = path.join(staging, "tiles", output.style, String(tile.zoom), String(tile.x));
          await mkdir(directory, { recursive: true });
          await writeDurableBytes(path.join(directory, `${tile.y}.webp`), bytes);
          files.push({ path: relativeTilePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
        }
      }
      const biomes = [...(generation.biomes ?? [])].map((biome) => ({
        biomeType: Number(biome.biomeType),
        name: String(biome.name),
        description: String(biome.description ?? ""),
        hazardLevel: String(biome.hazardLevel ?? ""),
        disallowPlayerBuild: Boolean(biome.disallowPlayerBuild),
        present: presentBiomeIds.has(Number(biome.biomeType)),
      })).filter(({ biomeType }) => Number.isInteger(biomeType) && biomeType >= 0 && biomeType <= 255)
        .sort((left, right) => left.biomeType - right.biomeType);
      const manifest = {
        provider: "relay",
        generation: generationId,
        generatedAt: generatedAt.toISOString(),
        observedAt: generation.observedAt ?? null,
        regionIds: [...new Set(generation.regionIds ?? [generation.regionId])].map(String).sort((a, b) => Number(a) - Number(b)),
        dimension: "1",
        bounds,
        zoomRange: { min: limits.minZoom, max: limits.maxZoom },
        paletteVersion: TERRAIN_PALETTE_VERSION,
        tileCount,
        totalBytes,
        biomes,
        waterTypes: [...presentWaterTypes].sort(),
        channels: {
          terrain: { tileCount: channelTileCounts.terrain, totalBytes: channelBytes.terrain },
          water: { tileCount: channelTileCounts.water, totalBytes: channelBytes.water },
          biomeMasks: { tileCount: channelTileCounts.biomeMasks, totalBytes: channelBytes.biomeMasks },
        },
        evidenceHash: generation.evidence.evidenceHash,
        files,
      };
      const manifestBytes = durableJsonBytes(manifest);
      const manifestHash = sha256(manifestBytes);
      await writeDurableBytes(path.join(staging, "manifest.json"), manifestBytes);
      return await packStore.install({ stagedVersionDir: staging, version, manifestHash });
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  return {
    paletteVersion: TERRAIN_PALETTE_VERSION,
    buildAndInstall(generation) {
      const operation = queue.then(() => build(generation));
      queue = operation.catch(() => undefined);
      return operation;
    },
    async readManifest() {
      return packStore.readManifest();
    },
    async readTile(request) {
      return packStore.readTile(request);
    },
    async close() {
      closed = true;
      await queue;
      await packStore.close();
    },
  };
}
