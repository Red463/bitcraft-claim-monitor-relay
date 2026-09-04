import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { discoverRelayTopology, RelayTerrainRuntime } from "../dist-server/game-data/index.js";
import { createTerrainTileStore } from "../src/server/terrainTileStore.mjs";
import { renderTerrainTile } from "../src/server/terrainTileRenderer.mjs";
import { createTerrainOverviewStore } from "../src/server/terrainOverviewStore.mjs";
import { isClosedEventRegion } from "../src/server/relayRegionPolicy.mjs";

const relayBaseUrl = String(process.env.BITCRAFT_RELAY_ORIGIN ?? "https://relay.bitcraftsync.app").replace(/\/+$/, "");
const dataDir = String(process.env.BITCRAFT_LOCAL_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url)));
const timeoutMs = Math.max(60_000, Number(process.env.RELAY_TERRAIN_OVERVIEW_TIMEOUT_MS ?? 10 * 60_000));
const batchSize = Math.max(1, Math.min(2, Number(process.env.RELAY_TERRAIN_OVERVIEW_BATCH_SIZE ?? 1)));
const minimumAgeMs = Math.max(0, Number(process.env.RELAY_TERRAIN_OVERVIEW_MIN_AGE_MS ?? 7 * 24 * 60 * 60_000));
const forceOverview = process.env.BITCRAFT_FORCE_TERRAIN_OVERVIEW === "true";
const manifest = JSON.parse(await readFile(new URL("../src/server/game-data/bindings/schema-manifest.json", import.meta.url), "utf8"));
const evidence = JSON.parse(await readFile(new URL("../test/fixtures/terrain-live-layout.json", import.meta.url), "utf8"));
const topology = await discoverRelayTopology(relayBaseUrl);
const requested = String(process.env.BITCRAFT_OVERVIEW_REGION_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const readyRegionIds = [...topology.regions.entries()]
  .filter(([regionId, source]) => source.ready && source.schemaFingerprint && !isClosedEventRegion(regionId) && (!requested.length || requested.includes(regionId)))
  .map(([regionId]) => regionId)
  .sort((left, right) => Number(left) - Number(right));
if (!readyRegionIds.length) throw new Error("Relay exposes no ready overworld regions for the terrain overview");
const existingOverview = await createTerrainOverviewStore({ dataDir }).readManifest();
const existingAgeMs = existingOverview?.generatedAt ? Date.now() - Date.parse(existingOverview.generatedAt) : Infinity;
if (!forceOverview
  && existingOverview
  && existingAgeMs >= 0
  && existingAgeMs < minimumAgeMs
  && existingOverview.regionIds.join(",") === readyRegionIds.join(",")) {
  console.log(JSON.stringify({ ok: true, skipped: true, reason: "terrain overview is within its freshness window", generatedAt: existingOverview.generatedAt, regionIds: readyRegionIds }, null, 2));
  process.exit(0);
}

const batches = [];
for (let offset = 0; offset < readyRegionIds.length; offset += batchSize) batches.push(readyRegionIds.slice(offset, offset + batchSize));
const results = [];
for (const [index, regionIds] of batches.entries()) {
  const batchDataDir = path.join(dataDir, "map-overview", `batch-${index + 1}`);
  const tileStore = createTerrainTileStore({
    dataDir: batchDataDir,
    encoder: ({ generation, style, zoom, x, y, tileSize }) => renderTerrainTile({ generation, evidence: generation.evidence, style, zoom, x, y, tileSize }),
    limits: { minZoom: -5, maxZoom: -2, maxTiles: 10_000, maxBytes: 256 * 1024 * 1024, deadlineMs: timeoutMs },
  });
  const runtime = new RelayTerrainRuntime({ manifest, tileStore, evidence });
  const deadline = Date.now() + timeoutMs;
  try {
    await runtime.start({ relayBaseUrl, activeRegionIds: regionIds });
    while (runtime.health().appliedRegionIds.length < regionIds.length) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for overview regions ${regionIds.join(",")}: ${JSON.stringify(runtime.health())}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await runtime.waitForIdle();
    const installed = await tileStore.readManifest();
    if (!installed || installed.regionIds.length !== regionIds.length) throw new Error(`Overview batch ${index + 1} did not install its complete region set`);
    results.push(installed);
    console.log(JSON.stringify({ stage: "batch-installed", batch: index + 1, regionIds, tileCount: installed.tileCount, totalBytes: installed.totalBytes }));
  } finally {
    await runtime.stop();
    await tileStore.close();
  }
}

console.log(JSON.stringify({ ok: true, dataDir, regionIds: readyRegionIds, batches: results }, null, 2));
