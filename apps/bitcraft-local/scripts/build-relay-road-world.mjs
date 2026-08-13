import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

function canonicalRegions(values) {
  const regions = [...new Set(values.map((value) => String(value ?? "").trim()))];
  if (!regions.length || regions.some((regionId) => !/^\d+$/.test(regionId))) throw new TypeError("Road world generation requires decimal region IDs");
  return regions.sort((left, right) => Number(left) - Number(right));
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
  generation = String(Date.now()),
  generatedAt = new Date().toISOString(),
}) {
  const regionIds = canonicalRegions(readyRegionIds);
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
  const candidate = await compose({
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
    },
  });
  const manifest = await install(candidate);
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
      connection = DbConnection.builder()
        .withUri(relayWebSocketUri(relayBaseUrl, source.port))
        .withDatabaseName(source.database)
        .onConnect((connected) => {
          const join = "FROM paved_tile_state JOIN location_state ON paved_tile_state.entity_id = location_state.entity_id";
          subscription = connected.subscriptionBuilder()
            .onApplied(() => {
              try {
                const locations = new Map([...connected.db.locationState.iter()]
                  .filter((row) => String(row.dimension) === "1")
                  .map((row) => [String(row.entityId), row]));
                const points = [];
                for (const row of connected.db.pavedTileState.iter()) {
                  const location = locations.get(String(row.entityId));
                  if (!location) continue;
                  const x = Number(location.x);
                  const z = Number(location.z);
                  if (Number.isSafeInteger(x) && Number.isSafeInteger(z) && x >= 0 && z >= 0 && x <= 38_400 && z <= 38_400) points.push({ x, z });
                }
                resolve({ points, observedAt: new Date().toISOString() });
              } catch (error) {
                reject(error);
              }
            })
            .onError((_context, error) => reject(error))
            .subscribe([
              `SELECT paved_tile_state.* ${join} WHERE location_state.dimension = 1`,
              `SELECT location_state.* ${join} WHERE location_state.dimension = 1`,
            ]);
        })
        .onConnectError((_context, error) => reject(error))
        .onDisconnect((_context, error) => { if (error) reject(error); })
        .build();
    });
  } finally {
    clearTimeout(timeout);
    subscription?.unsubscribe();
    connection?.disconnect();
  }
}

export async function runRoadWorldCli() {
  const [{ discoverRelayTopology }, { createRoadTileStore }, { groupRoadPointsForZoom, renderRoadTile }, { composeMapTilePack }, { createMapTilePackStore }] = await Promise.all([
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
  const topology = await discoverRelayTopology(relayBaseUrl);
  const readyRegionIds = canonicalRegions([...topology.regions.entries()]
    .filter(([regionId, source]) => source.ready && source.schemaFingerprint && (!requestedSet || requestedSet.has(String(regionId))))
    .map(([regionId]) => String(regionId)));
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
        const { points, observedAt } = await collectRoadRegion({ relayBaseUrl, source, timeoutMs });
        if (!points.length) throw new Error(`Relay road region ${regionId} returned no verified paving points`);
        const tiles = [];
        for (let zoom = -5; zoom <= 0; zoom += 1) {
          for (const [key, groupedPoints] of groupRoadPointsForZoom(points, { zoom })) {
            const [x, y] = key.split(":").map(Number);
            tiles.push({ z: zoom, x, y, bytes: await renderRoadTile({ points: groupedPoints, zoom }) });
          }
        }
        const batchDataDir = path.join(jobRoot, `batch-${index + 1}-${regionId}`);
        const store = createRoadTileStore({ dataDir: batchDataDir });
        try {
          const manifest = await store.install({
            generation,
            regionIds: [regionId],
            observedAt,
            bounds: {
              minX: Math.min(...points.map(({ x }) => x)), minZ: Math.min(...points.map(({ z }) => z)),
              maxX: Math.max(...points.map(({ x }) => x)), maxZ: Math.max(...points.map(({ z }) => z)),
            },
            tiles,
            featureCount: points.length,
          });
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
    });
    console.log(JSON.stringify({ ok: true, dataDir, manifest: result.manifest, batches: result.batches }, null, 2));
    return result.manifest;
  } finally {
    await outputStore.close();
    await rm(jobRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runRoadWorldCli();
}
