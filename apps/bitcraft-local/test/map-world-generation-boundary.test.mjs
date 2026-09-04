import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

let terrainJob = null;
let roadJob = null;
try {
  [terrainJob, roadJob] = await Promise.all([
    import("../scripts/build-relay-terrain-world.mjs"),
    import("../scripts/build-relay-road-world.mjs"),
  ]);
} catch {
  // RED: full-world job entrypoints are introduced by this task.
}

test("terrain job excludes closed event regions at the generation boundary", async () => {
  assert.ok(terrainJob, "terrain world generation module must exist");
  const built = [];
  const installed = [];
  let pruneCalls = 0;
  const result = await terrainJob.runTerrainWorldGeneration({
    readyRegionIds: ["19", "3"],
    batchSize: 1,
    buildBatch: async ({ regionIds, index }) => {
      built.push(regionIds);
      return { batchRoot: `batch-${index}`, manifest: { regionIds, tileCount: 1, totalBytes: 10 } };
    },
    compose: async ({ expectedRegionIds, manifestBase }) => ({
      stagedVersionDir: ".staging-g-100",
      manifestHash: "a".repeat(64),
      manifest: { ...manifestBase, regionIds: expectedRegionIds, zoomRange: { min: -5, max: 0 } },
    }),
    install: async (candidate) => {
      installed.push(candidate);
      return candidate.manifest;
    },
    prune: async () => { pruneCalls += 1; },
    generation: "100",
    generatedAt: "2026-08-13T01:00:00.000Z",
  });

  assert.deepEqual(built, [["19"]]);
  assert.deepEqual(result.manifest.regionIds, ["19"]);
  assert.deepEqual(result.manifest.zoomRange, { min: -5, max: 0 });
  assert.equal(installed.length, 1);
  assert.equal(pruneCalls, 1);
});

test("one failed road region retains the previous pack", async () => {
  assert.ok(roadJob, "road world generation module must exist");
  let installedGeneration = "previous";
  let composed = false;
  let pruneCalls = 0;
  await assert.rejects(roadJob.runRoadWorldGeneration({
    readyRegionIds: ["3", "19"],
    batchSize: 2,
    buildBatch: async ({ regionIds }) => {
      const regionId = regionIds[0];
      if (regionId === "19") throw new Error("forced region 19 failure");
      return { batchRoot: `batch-${regionId}`, manifest: { regionIds, featureCount: 5 } };
    },
    compose: async () => { composed = true; return {}; },
    install: async () => { installedGeneration = "replacement"; },
    prune: async () => { pruneCalls += 1; },
    generation: "101",
    generatedAt: "2026-08-13T01:00:00.000Z",
  }), /region 19/i);
  assert.equal(composed, false);
  assert.equal(installedGeneration, "previous");
  assert.equal(pruneCalls, 0);
});

test("road region selection surfaces schema drift instead of reporting an empty region list", () => {
  const mismatch = new Error("Relay regional schema fingerprint mismatch");
  assert.throws(() => roadJob.schemaReadyRoadRegionIds({
    topology: {
      regions: new Map([["19", {
        ready: true,
        schemaFingerprint: "live-regional-fingerprint",
      }]]),
    },
    manifest: { schemas: { regional: { fingerprint: "generated-regional-fingerprint" } } },
    requestedSet: null,
    assertFingerprint: () => { throw mismatch; },
  }), (error) => error === mismatch);
});

test("road job excludes closed event regions at the generation boundary", async () => {
  const built = [];
  const result = await roadJob.runRoadWorldGeneration({
    readyRegionIds: ["23", "19", "15", "11", "3"],
    buildBatch: async ({ regionIds }) => {
      built.push(regionIds);
      return { batchRoot: `batch-${regionIds[0]}`, manifest: { regionIds, featureCount: 1 } };
    },
    compose: async ({ expectedRegionIds, manifestBase }) => ({
      manifest: { ...manifestBase, regionIds: expectedRegionIds },
    }),
    install: async (candidate) => candidate.manifest,
  });

  assert.deepEqual(built, [["19"]]);
  assert.deepEqual(result.manifest.regionIds, ["19"]);
});

test("road region selection ignores closed event regions still reported by Relay", () => {
  const checked = [];
  const regionIds = roadJob.schemaReadyRoadRegionIds({
    topology: {
      regions: new Map(["3", "7", "11", "15", "19", "23"].map((regionId) => [regionId, {
        ready: true,
        schemaFingerprint: "regional-v1",
      }])),
    },
    manifest: { schemas: { regional: { fingerprint: "regional-v1" } } },
    requestedSet: null,
    assertFingerprint: (_manifest, _kind, fingerprint) => checked.push(fingerprint),
  });

  assert.deepEqual(regionIds, ["7", "19"]);
  assert.equal(checked.length, 2);
});

test("road projection rejects incomplete joins instead of silently dropping paving rows", () => {
  assert.throws(() => roadJob.projectRoadPoints({
    pavedRows: [{ entityId: 1n }, { entityId: 2n }],
    locationRows: [{ entityId: 1n, dimension: 1n, x: 10, z: 20 }],
  }), /entity 2.*missing location/i);
});

test("road projection rejects non-overworld and impossible coordinates", () => {
  assert.throws(() => roadJob.projectRoadPoints({
    pavedRows: [{ entityId: 1n }],
    locationRows: [{ entityId: 1n, dimension: 0n, x: 10, z: 20 }],
  }), /dimension/i);
  assert.throws(() => roadJob.projectRoadPoints({
    pavedRows: [{ entityId: 1n }],
    locationRows: [{ entityId: 1n, dimension: 1n, x: 38_401, z: 20 }],
  }), /coordinates/i);
});

test("road bounds handle dense regions without spreading every point as an argument", () => {
  const points = Array.from({ length: 150_000 }, (_, index) => ({
    x: index % 38_401,
    z: 38_400 - (index % 38_401),
  }));

  assert.deepEqual(roadJob.roadPointBounds(points), {
    minX: 0,
    minZ: 0,
    maxX: 38_400,
    maxZ: 38_400,
  });
});

test("road generation failures retain only a deterministic stage marker", async () => {
  await assert.rejects(
    roadJob.roadGenerationStage("relay-subscription", async () => { throw new Error("provider detail"); }),
    (error) => error.message === "ROAD_STAGE=relay-subscription" && error.cause?.message === "provider detail",
  );
  assert.throws(() => roadJob.roadStageError("unsupported", new Error("detail")), /unsupported road generation stage/i);
});

test("road batch install failures embed only an allow-listed reason in the outer marker", () => {
  const cases = [
    [new RangeError("Road tile exceeds byte budget"), "tile-budget"],
    [new Error("Map tile pack manifest totals do not match referenced tiles"), "validation"],
    [Object.assign(new Error("private collision detail"), { code: "EEXIST" }), "collision"],
    [Object.assign(new Error("private permission detail"), { code: "EACCES" }), "permission"],
    [Object.assign(new Error("private disk detail"), { code: "ENOSPC" }), "disk"],
    [Object.assign(new Error("private missing detail"), { code: "ENOENT" }), "missing-path"],
    [new Error("Road tile store is closed"), "closed"],
    [new Error("ROAD_BATCH_STAGE=preflight"), "store-preflight"],
    [new Error("ROAD_BATCH_STAGE=prepare-root"), "store-prepare-root"],
    [new Error("ROAD_BATCH_STAGE=create-staging"), "store-create-staging"],
    [new Error("ROAD_BATCH_STAGE=write-tiles"), "store-write-tiles"],
    [new Error("ROAD_BATCH_STAGE=build-manifest"), "store-build-manifest"],
    [new Error("ROAD_BATCH_STAGE=write-manifest"), "store-write-manifest"],
    [new Error("ROAD_BATCH_STAGE=install-pack"), "store-install-pack"],
    [new Error("private unknown detail 999"), "other"],
  ];

  for (const [cause, reason] of cases) {
    const error = roadJob.roadStageError("batch-install", cause);
    assert.equal(error.message, `ROAD_STAGE=batch-install ROAD_REASON=${reason}`);
    assert.equal(error.message.includes("private"), false);
  }
});

test("road batch diagnostics find allow-listed store stages through nested causes", () => {
  const nested = new Error("private outer storage detail", {
    cause: new Error("private middle storage detail", {
      cause: new Error("ROAD_BATCH_STAGE=install-pack"),
    }),
  });

  const error = roadJob.roadStageError("batch-install", nested);
  assert.equal(error.message, "ROAD_STAGE=batch-install ROAD_REASON=store-install-pack");
  assert.equal(error.message.includes("private"), false);
});

test("world jobs retain the verified Relay joins and bounded package entrypoints", async () => {
  const [terrainSource, roadSource, packageSource] = await Promise.all([
    readFile(new URL("../scripts/build-relay-terrain-world.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build-relay-road-world.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.scripts["map:build-terrain-world"], "node scripts/build-relay-terrain-world.mjs");
  assert.equal(packageJson.scripts["map:build-road-world"], "node scripts/build-relay-road-world.mjs");
  assert.match(terrainSource, /BITCRAFT_MAP_GENERATION_BATCH_SIZE/);
  assert.match(terrainSource, /for \(let zoom = -5; zoom <= 0/);
  assert.match(roadSource, /paved_tile_state\.entity_id = location_state\.entity_id/);
  assert.match(roadSource, /location_state\.dimension = 1/);
  assert.match(roadSource, /for \(let zoom = -5; zoom <= 0/);
  assert.doesNotMatch(roadSource, /related_entity_id = location_state\.entity_id/);
});
