import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

import { canonicalMapRegionIds } from "../src/server/mapRegionIds.mjs";
import { isExecutedMainModule } from "../src/server/executedMainModule.mjs";
import { configureMapGenerationConcurrency } from "../src/server/mapGenerationConcurrency.mjs";
import { isClosedEventRegion } from "../src/server/relayRegionPolicy.mjs";

const ROAD_GENERATION_STAGES = new Set([
  "topology", "relay-connect", "relay-subscription", "coordinate-projection",
  "tile-render", "batch-install", "pack-compose", "pack-install", "pack-prune",
]);

function roadBatchInstallReason(cause) {
  const chain = [];
  const seen = new Set();
  let current = cause;
  while (current && chain.length < 8 && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = current?.cause;
  }
  for (const error of chain) {
    const message = String(error?.message ?? "");
    const storeStage = /ROAD_BATCH_STAGE=(preflight|prepare-root|create-staging|write-tiles|build-manifest|write-manifest|install-pack)/i.exec(message)?.[1]?.toLowerCase();
    if (storeStage) return `store-${storeStage}`;
  }
  for (const error of chain) {
    const code = String(error?.code ?? "");
    const message = String(error?.message ?? "");
    if (/tile exceeds (?:byte|read) budget/i.test(message)) return "tile-budget";
    if (/ENOSPC/i.test(code) || /no space left on device/i.test(message)) return "disk";
    if (/^(?:EACCES|EPERM)$/i.test(code) || /permission denied/i.test(message)) return "permission";
    if (/EEXIST/i.test(code) || /already (?:exists|installed)/i.test(message)) return "collision";
    if (/ENOENT/i.test(code) || /no such file or directory|missing tile/i.test(message)) return "missing-path";
    if (/tile store is closed|pack store is closed/i.test(message)) return "closed";
    if (/manifest|invalid tile path|tile (?:byte count|hash)|totals do not match/i.test(message)) return "validation";
  }
  return "other";
}

export function roadStageError(stage, cause) {
  if (!ROAD_GENERATION_STAGES.has(stage)) throw new TypeError(`Unsupported road generation stage: ${stage}`);
  const reason = stage === "batch-install" ? ` ROAD_REASON=${roadBatchInstallReason(cause)}` : "";
  return new Error(`ROAD_STAGE=${stage}${reason}`, { cause });
}

export async function roadGenerationStage(stage, task) {
  try {
    return await task();
  } catch (error) {
    if (/^ROAD_STAGE=/.test(String(error?.message ?? ""))) throw error;
    throw roadStageError(stage, error);
  }
}

function canonicalRegions(values) {
  const regions = canonicalMapRegionIds(values);
  if (!regions.length) throw new TypeError("Road world generation requires decimal region IDs");
  return regions;
}

export function schemaReadyRoadRegionIds({ topology, manifest, requestedSet, assertFingerprint }) {
  return canonicalRegions([...topology.regions.entries()].flatMap(([regionId, source]) => {
    if (!source.ready || isClosedEventRegion(regionId) || (requestedSet && !requestedSet.has(String(regionId)))) return [];
    assertFingerprint(manifest, "regional", String(source.schemaFingerprint ?? ""));
    return [String(regionId)];
  }));
}

export function projectRoadPoints({ pavedRows, locationRows }) {
  const locations = new Map(locationRows.map((row) => [String(row.entityId), row]));
  return pavedRows.map((row) => {
    const entityId = String(row.entityId);
    const location = locations.get(entityId);
    if (!location) throw new Error(`Road paving entity ${entityId} is missing location data`);
    if (String(location.dimension) !== "1") throw new Error(`Road paving entity ${entityId} has unexpected dimension ${location.dimension}`);
    const x = Number(location.x);
    const z = Number(location.z);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z) || x < 0 || z < 0 || x > 38_400 || z > 38_400) {
      throw new Error(`Road paving entity ${entityId} has impossible coordinates`);
    }
    return { x, z };
  });
}

export function roadPointBounds(points) {
  if (!points.length) throw new TypeError("Road bounds require at least one point");
  let minX = points[0].x;
  let minZ = points[0].z;
  let maxX = points[0].x;
  let maxZ = points[0].z;
  for (let index = 1; index < points.length; index += 1) {
    const { x, z } = points[index];
    if (x < minX) minX = x;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
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

export async function runRoadWorldGeneration({
  readyRegionIds,
  batchSize = 1,
  buildBatch,
  compose,
  install,
  prune = async () => {},
  generation = String(Date.now()),
  generatedAt = new Date().toISOString(),
}) {
  const startedAt = Date.now();
  const regionIds = canonicalRegions(readyRegionIds).filter((regionId) => !isClosedEventRegion(regionId));
  const built = [];
  let index = 0;
  for (const batch of chunks(regionIds, boundedBatchSize(batchSize))) {
    const results = await Promise.all(batch.map(async (regionId) => {
      const batchIndex = index++;
      try {
        return await buildBatch({ regionIds: [regionId], index: batchIndex });
      } catch (error) {
        throw new Error(`Road world generation failed for region ${regionId}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }));
    built.push(...results);
  }
  const featureCount = built.reduce((total, result) => total + Number(result.manifest?.featureCount ?? 0), 0);
  const candidate = await roadGenerationStage("pack-compose", () => compose({
    batchRoots: built.map(({ batchRoot }) => batchRoot),
    expectedRegionIds: regionIds,
    manifestBase: {
      provider: "relay",
      product: "roads",
      generation: String(generation),
      generatedAt,
      dimension: "1",
      zoomRange: { min: -5, max: 0 },
      featureCount,
      joinVersion: "paved-location-overworld-v1",
      generationDurationMs: Math.max(0, Date.now() - startedAt),
    },
  }));
  const manifest = await roadGenerationStage("pack-install", () => install(candidate));
  await roadGenerationStage("pack-prune", () => prune());
  return { manifest, batches: built.map(({ manifest: value }) => value) };
}

async function collectRoadRegion({ relayBaseUrl, source, timeoutMs }) {
  const [{ relayWebSocketUri }, { DbConnection }] = await Promise.all([
    import("../dist-server/game-data/index.js"),
    import("../dist-server/game-data/bindings/regional.js"),
  ]);
  let connection;
  let subscription;
  let timeout;
  try {
    return await new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out waiting for roads from ${source.database}`)), timeoutMs);
      const builder = DbConnection.builder()
        .withUri(relayWebSocketUri(relayBaseUrl, source.port))
        .withDatabaseName(source.database)
        .onConnect((connected) => {
          const join = "FROM paved_tile_state JOIN location_state ON paved_tile_state.entity_id = location_state.entity_id";
          subscription = connected.subscriptionBuilder()
            .onApplied(() => {
              try {
                const points = projectRoadPoints({
                  pavedRows: [...connected.db.pavedTileState.iter()],
                  locationRows: [...connected.db.locationState.iter()],
                });
                resolve({ points, observedAt: new Date().toISOString() });
              } catch (error) {
                reject(roadStageError("coordinate-projection", error));
              }
            })
            .onError((_context, error) => reject(roadStageError("relay-subscription", error)))
            .subscribe([
              `SELECT paved_tile_state.* ${join} WHERE location_state.dimension = 1`,
              `SELECT location_state.* ${join} WHERE location_state.dimension = 1`,
            ]);
        })
        .onConnectError((_context, error) => reject(roadStageError("relay-connect", error)))
        .onDisconnect((_context, error) => { if (error) reject(roadStageError("relay-connect", error)); });
      try {
        connection = builder.build();
      } catch (error) {
        reject(roadStageError("relay-connect", error));
      }
    });
  } finally {
    clearTimeout(timeout);
    subscription?.unsubscribe();
    connection?.disconnect();
  }
}

export async function runRoadWorldCli() {
  configureMapGenerationConcurrency(sharp);
  const [{ assertSchemaFingerprint, discoverRelayTopology }, { createRoadTileStore }, { groupRoadPointsForZoom, renderRoadTile }, { composeMapTilePack }, { createMapTilePackStore }] = await Promise.all([
    import("../dist-server/game-data/index.js"),
    import("../src/server/roadTileStore.mjs"),
    import("../src/server/roadTileRenderer.mjs"),
    import("../src/server/mapTilePackComposer.mjs"),
    import("../src/server/mapTilePackStore.mjs"),
  ]);
  const relayBaseUrl = String(process.env.BITCRAFT_RELAY_ORIGIN ?? "https://relay.bitcraftsync.app").replace(/\/+$/, "");
  const dataDir = path.resolve(String(process.env.BITCRAFT_LOCAL_DATA_DIR ?? fileURLToPath(new URL("../data", import.meta.url))));
  const timeoutMs = Math.max(60_000, Number(process.env.BITCRAFT_MAP_GENERATION_TIMEOUT_MS ?? 3 * 60 * 60_000));
  const batchSize = boundedBatchSize(process.env.BITCRAFT_MAP_GENERATION_BATCH_SIZE ?? 1);
  const minimumAgeMs = Math.max(0, Number(process.env.BITCRAFT_ROAD_WORLD_MIN_AGE_MS ?? 24 * 60 * 60_000));
  const force = process.env.BITCRAFT_FORCE_ROAD_WORLD === "true";
  const requestedValues = String(process.env.BITCRAFT_MAP_REGION_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const requestedSet = requestedValues.length ? new Set(canonicalRegions(requestedValues)) : null;
  const manifest = JSON.parse(await readFile(new URL("../src/server/game-data/bindings/schema-manifest.json", import.meta.url), "utf8"));
  const topology = await roadGenerationStage("topology", () => discoverRelayTopology(relayBaseUrl));
  const readyRegionIds = schemaReadyRoadRegionIds({
    topology,
    manifest,
    requestedSet,
    assertFingerprint: assertSchemaFingerprint,
  });
  if (requestedSet) for (const regionId of requestedSet) if (!readyRegionIds.includes(regionId)) throw new Error(`Requested road region ${regionId} is not schema-ready`);

  const outputRoot = path.join(dataDir, "map-road-tiles");
  const outputStore = createMapTilePackStore({ root: outputRoot, allowedStyles: ["roads"] });
  const existing = await outputStore.readManifest();
  const existingAgeMs = existing?.generatedAt ? Date.now() - Date.parse(existing.generatedAt) : Infinity;
  if (!force && existing && existingAgeMs >= 0 && existingAgeMs < minimumAgeMs && canonicalRegions(existing.regionIds).join(",") === readyRegionIds.join(",")) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "road world pack is within its freshness window", manifest: existing }, null, 2));
    await outputStore.close();
    return existing;
  }

  await mkdir(dataDir, { recursive: true });
  const jobRoot = await mkdtemp(path.join(dataDir, ".road-world-"));
  const generatedAt = new Date().toISOString();
  const generation = String(Date.now());
  try {
    const result = await runRoadWorldGeneration({
      readyRegionIds,
      batchSize,
      generation,
      generatedAt,
      buildBatch: async ({ regionIds, index }) => {
        const regionId = regionIds[0];
        const source = topology.regions.get(regionId);
        if (!source?.ready || !source.schemaFingerprint) throw new Error(`Relay road source ${regionId} is unavailable`);
        assertSchemaFingerprint(manifest, "regional", source.schemaFingerprint);
        const { points, observedAt } = await collectRoadRegion({ relayBaseUrl, source, timeoutMs });
        if (!points.length) throw new Error(`Relay road region ${regionId} returned no verified paving points`);
        const tiles = [];
        for (let zoom = -5; zoom <= 0; zoom += 1) {
          for (const [key, groupedPoints] of groupRoadPointsForZoom(points, { zoom })) {
            const [x, y] = key.split(":").map(Number);
            tiles.push({ z: zoom, x, y, bytes: await roadGenerationStage("tile-render", () => renderRoadTile({ points: groupedPoints, zoom })) });
          }
        }
        const batchDataDir = path.join(jobRoot, `batch-${index + 1}-${regionId}`);
        const store = createRoadTileStore({ dataDir: batchDataDir });
        try {
          const manifest = await roadGenerationStage("batch-install", () => store.install({
            generation,
            regionIds: [regionId],
            observedAt,
            bounds: roadPointBounds(points),
            tiles,
            featureCount: points.length,
          }));
          return { batchRoot: batchDataDir, manifest };
        } finally {
          await store.close();
        }
      },
      compose: ({ batchRoots, expectedRegionIds, manifestBase }) => composeMapTilePack({
        batchRoots,
        outputRoot,
        product: "roads",
        expectedRegionIds,
        styles: ["roads"],
        manifestBase,
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
  await runRoadWorldCli();
}
