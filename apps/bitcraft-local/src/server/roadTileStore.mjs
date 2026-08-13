import { createHash } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import { createMapTilePackStore } from "./mapTilePackStore.mjs";

const MAX_TILE_BYTES = 2 * 1024 * 1024;

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function currentDate(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Road tile store clock returned an invalid date");
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

export function createRoadTileStore({ dataDir, now = () => new Date() }) {
  const root = path.resolve(dataDir, "map-road-tiles");
  if (!within(path.resolve(dataDir), root)) throw new TypeError("Road tile store path escapes data directory");
  const packStore = createMapTilePackStore({ root, allowedStyles: ["roads"], maxTileBytes: MAX_TILE_BYTES });
  let queue = Promise.resolve();
  let closed = false;

  async function installRoads({ generation, regionIds, observedAt, bounds, tiles, featureCount }) {
    if (closed) throw new Error("Road tile store is closed");
    const generationId = String(generation ?? "");
    if (!/^\d+$/.test(generationId)) throw new TypeError("Road generation must be a decimal integer");
    const generatedAt = currentDate(now);
    const version = `g-${generationId}-${generatedAt.getTime()}-${process.pid}`;
    const staging = path.resolve(root, `.staging-${version}`);
    if (!within(root, staging)) throw new TypeError("Road bundle staging path escapes store");
    let totalBytes = 0;
    const files = [];
    try {
      await mkdir(root, { recursive: true });
      await mkdir(staging, { recursive: false });
      for (const tile of tiles) {
        if (!Number.isSafeInteger(tile.z) || !Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.y)) throw new TypeError("Road tile coordinates must be safe integers");
        const bytes = Buffer.from(tile.bytes ?? []);
        if (!bytes.byteLength) throw new TypeError("Road tile must not be empty");
        if (bytes.byteLength > MAX_TILE_BYTES) throw new RangeError("Road tile exceeds byte budget");
        totalBytes += bytes.byteLength;
        const relativeTilePath = path.posix.join("tiles", "roads", String(tile.z), String(tile.x), `${tile.y}.webp`);
        const directory = path.join(staging, "tiles", "roads", String(tile.z), String(tile.x));
        await mkdir(directory, { recursive: true });
        await writeDurableBytes(path.join(directory, `${tile.y}.webp`), bytes);
        files.push({ path: relativeTilePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
      }
      const manifest = {
        provider: "relay",
        generation: generationId,
        generatedAt: generatedAt.toISOString(),
        observedAt,
        regionIds: [...new Set(regionIds.map(String))].sort((left, right) => Number(left) - Number(right)),
        dimension: "1",
        bounds,
        zoomRange: { min: -5, max: 0 },
        tileCount: files.length,
        totalBytes,
        featureCount,
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
    install(input) {
      const operation = queue.then(() => installRoads(input));
      queue = operation.catch(() => undefined);
      return operation;
    },
    async readManifest() {
      return packStore.readManifest();
    },
    async readTile(request) {
      return packStore.readTile(request);
    },
    health() {
      return packStore.health();
    },
    async close() {
      closed = true;
      await queue;
      await packStore.close();
    },
  };
}
