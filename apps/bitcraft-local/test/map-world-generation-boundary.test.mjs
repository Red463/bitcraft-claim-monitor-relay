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

test("terrain job includes every ready region at zoom -5 through 0", async () => {
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

  assert.deepEqual(built, [["3"], ["19"]]);
  assert.deepEqual(result.manifest.regionIds, ["3", "19"]);
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
