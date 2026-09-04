import { mkdir, readFile, rm, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

import { canonicalMapRegionIds } from "../src/server/mapRegionIds.mjs";
import { isExecutedMainModule } from "../src/server/executedMainModule.mjs";
import { configureMapGenerationConcurrency } from "../src/server/mapGenerationConcurrency.mjs";
import { isClosedEventRegion } from "../src/server/relayRegionPolicy.mjs";

function canonicalRegions(values) {
  const regions = canonicalMapRegionIds(values);
  if (!regions.length) throw new TypeError("Terrain world generation requires decimal region IDs");
  return regions;
}

function boundedBatchSize(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.max(1, Math.min(4, parsed)) : 1;
}

function chunks(values, size) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

export async function runTerrainWorldGeneration({
  readyRegionIds,
  batchSize = 1,
  buildBatch,
  compose,
  install,
  prune = async () => {},
  generation = String(Date.now()),
  generatedAt = new Date().toISOString(),
}) {
  const regionIds = canonicalRegions(readyRegionIds).filter((regionId) => !isClosedEventRegion(regionId));
  const built = [];
  let index = 0;
  for (const batch of chunks(regionIds, boundedBatchSize(batchSize))) {
    const results = await Promise.all(batch.map(async (regionId) => {
      const batchIndex = index++;
      try {
        return await buildBatch({ regionIds: [regionId], index: batchIndex });
      } catch (error) {
        throw new Error(`Terrain world generation failed for region ${regionId}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }));
    built.push(...results);
  }
  const candidate = await compose({
    batchRoots: built.map(({ batchRoot }) => batchRoot),
    expectedRegionIds: regionIds,
    manifestBase: {
      provider: "relay",
      product: "terrain",
      generation: String(generation),
      generatedAt,
      dimension: "1",
      zoomRange: { min: -5, max: 0 },
    },
  });
  const manifest = await install(candidate);
  await prune();
  return { manifest, batches: built.map(({ manifest: value }) => value) };
}

async function waitForTerrain(runtime, regionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!runtime.health().appliedRegionIds.includes(regionId)) {
    const health = runtime.health();
    if (health.buildStage === "error") throw new Error(health.lastError ?? "terrain build failed");
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for Relay terrain region ${regionId}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await runtime.waitForIdle();
  const health = runtime.health();
  if (health.buildStage === "error") throw new Error(health.lastError ?? "terrain build failed");
}

export async function runTerrainWorldCli() {
  configureMapGenerationConcurrency(sharp);
  const [{ discoverRelayTopology, RelayTerrainRuntime }, { createTerrainTileStore }, { renderTerrainTileChannels }, { composeMapTilePack }, { createMapTilePackStore }] = await Promise.all([
    import("../dist-server/game-data/index.js"),
    import("../src/server/terrainTileStore.mjs"),
    import("../src/server/terrainTileRenderer.mjs"),
    import("../src/server/mapTilePackComposer.mjs"),
    import("../src/server/mapTilePackStore.mjs"),
  ]);
  const relayBaseUrl = String(process.env.BITCRAFT_RELAY_ORIGIN ?? "https://relay.bitcraftsync.app").replace(/\/+$/, "");
  const dataDir = path.resolve(String(process.env.BITCRAFT_LOCAL_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url))));
  const timeoutMs = Math.max(60_000, Number(process.env.BITCRAFT_MAP_GENERATION_TIMEOUT_MS ?? 3 * 60 * 60_000));
  const batchSize = boundedBatchSize(process.env.BITCRAFT_MAP_GENERATION_BATCH_SIZE ?? 1);
  const minimumAgeMs = Math.max(0, Number(process.env.BITCRAFT_TERRAIN_WORLD_MIN_AGE_MS ?? 7 * 24 * 60 * 60_000));
  const force = process.env.BITCRAFT_FORCE_TERRAIN_WORLD === "true";
  const requested = canonicalRegions(String(process.env.BITCRAFT_MAP_REGION_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean).length
    ? String(process.env.BITCRAFT_MAP_REGION_IDS).split(",")
    : ["0"]);
  const requestedSet = process.env.BITCRAFT_MAP_REGION_IDS ? new Set(requested) : null;
  const topology = await discoverRelayTopology(relayBaseUrl);
  const readyRegionIds = canonicalRegions([...topology.regions.entries()]
    .filter(([regionId, source]) => source.ready && source.schemaFingerprint && !isClosedEventRegion(regionId) && (!requestedSet || requestedSet.has(String(regionId))))
    .map(([regionId]) => String(regionId)));
  if (requestedSet) for (const regionId of requestedSet) if (!readyRegionIds.includes(regionId)) throw new Error(`Requested terrain region ${regionId} is not schema-ready`);

  const allowedStyles = ["terrain", "water", ...Array.from({ length: 256 }, (_, biomeType) => `biome-${biomeType}`)];
  const outputRoot = path.join(dataDir, "map-tiles");
  const outputStore = createMapTilePackStore({ root: outputRoot, allowedStyles });
  const existing = await outputStore.readManifest();
  const existingAgeMs = existing?.generatedAt ? Date.now() - Date.parse(existing.generatedAt) : Infinity;
  if (!force && existing && existingAgeMs >= 0 && existingAgeMs < minimumAgeMs && canonicalRegions(existing.regionIds).join(",") === readyRegionIds.join(",")) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "terrain world pack is within its freshness window", manifest: existing }, null, 2));
    await outputStore.close();
    return existing;
  }

  const manifest = JSON.parse(await readFile(new URL("../src/server/game-data/bindings/schema-manifest.json", import.meta.url), "utf8"));
  const evidence = JSON.parse(await readFile(new URL("../test/fixtures/terrain-live-layout.json", import.meta.url), "utf8"));
  await mkdir(dataDir, { recursive: true });
  const jobRoot = await mkdtemp(path.join(dataDir, ".terrain-world-"));
  const generatedAt = new Date().toISOString();
  const generation = String(Date.now());
  const terrainZooms = [];
  for (let zoom = -5; zoom <= 0; zoom += 1) terrainZooms.push(zoom);
  try {
    const result = await runTerrainWorldGeneration({
      readyRegionIds,
      batchSize,
      generation,
      generatedAt,
      buildBatch: async ({ regionIds, index }) => {
        const regionId = regionIds[0];
        const batchDataDir = path.join(jobRoot, `batch-${index + 1}-${regionId}`);
        const tileStore = createTerrainTileStore({
          dataDir: batchDataDir,
          encoder: ({ generation: value, zoom, x, y, tileSize }) => renderTerrainTileChannels({ generation: value, evidence: value.evidence, zoom, x, y, tileSize }),
          limits: { minZoom: terrainZooms[0], maxZoom: terrainZooms.at(-1), maxTiles: 100_000, maxBytes: 1024 * 1024 * 1024, deadlineMs: timeoutMs },
        });
        const runtime = new RelayTerrainRuntime({ manifest, tileStore, evidence, discoverTopology: async () => topology });
        try {
          await runtime.start({ relayBaseUrl, activeRegionIds: [regionId] });
          await waitForTerrain(runtime, regionId, timeoutMs);
          const installed = await tileStore.readManifest();
          if (!installed || canonicalRegions(installed.regionIds).join(",") !== regionId) throw new Error(`Relay terrain region ${regionId} did not install a complete pack`);
          return { batchRoot: batchDataDir, manifest: installed };
        } finally {
          await runtime.stop();
          await tileStore.close();
        }
      },
      compose: ({ batchRoots, expectedRegionIds, manifestBase }) => composeMapTilePack({
        batchRoots,
        outputRoot,
        product: "terrain",
        expectedRegionIds,
        styles: allowedStyles,
        manifestBase: { ...manifestBase, paletteVersion: 4 },
      }),
      install: async (candidate) => outputStore.install({
        stagedVersionDir: candidate.stagedVersionDir,
        version: path.basename(candidate.stagedVersionDir).replace(/^\.staging-/, ""),
        manifestHash: candidate.manifestHash,
      }),
      prune: () => outputStore.prune({ graceMs: 24 * 60 * 60_000, keepGenerations: 2 }),
    });
    console.log(JSON.stringify({ ok: true, dataDir, manifest: result.manifest, batches: result.batches }, null, 2));
    return result.manifest;
  } finally {
    await outputStore.close();
    await rm(jobRoot, { recursive: true, force: true });
  }
}

if (isExecutedMainModule(import.meta.url)) {
  await runTerrainWorldCli();
}
