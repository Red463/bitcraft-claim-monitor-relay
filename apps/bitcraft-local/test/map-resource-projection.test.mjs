import assert from "node:assert/strict";
import test from "node:test";

import {
  mapResourceKey,
  mapResourceQueries,
  normalizeMapResourceGeneration,
  normalizeMapResourceRegionGeneration,
} from "../src/server/game-data/mapResourceProjection.ts";

function counted(rows, counter) {
  return {
    [Symbol.iterator]() {
      counter.count += 1;
      return rows[Symbol.iterator]();
    },
  };
}

test("resource queries are independently bounded by one type and overworld dimension", () => {
  assert.deepEqual(mapResourceQueries("28"), [
    "SELECT resource_state.* FROM resource_state JOIN location_state ON resource_state.entity_id = location_state.entity_id WHERE resource_state.resource_id = 28 AND location_state.dimension = 1",
    "SELECT location_state.* FROM resource_state JOIN location_state ON resource_state.entity_id = location_state.entity_id WHERE resource_state.resource_id = 28 AND location_state.dimension = 1",
  ]);
  assert.equal(mapResourceKey("19", "28"), "19:28");
});

test("resource projection rejects invalid resource ids before constructing a query", () => {
  assert.throws(() => mapResourceQueries("not-a-resource"), /resource id must be a decimal integer/i);
  assert.throws(() => mapResourceKey("19", "not-a-resource"), /resource id must be a decimal integer/i);
});

test("resource normalization joins lossless entity ids and reports completeness", () => {
  const result = normalizeMapResourceGeneration({
    regionId: "19",
    resourceId: "28",
    resourceRows: [{ entityId: 9007199254740993123n, resourceId: 28 }],
    locationRows: [{ entityId: 9007199254740993123n, x: 27361, z: 23715, dimension: 1 }],
    observedAt: "2026-08-12T12:00:00.000Z",
  });
  assert.equal(result.complete, true);
  assert.equal(result.resources[0].entityId, "9007199254740993123");
});

test("resource normalization filters other resource types and deterministically orders selected points", () => {
  const result = normalizeMapResourceGeneration({
    regionId: "19",
    resourceId: "28",
    resourceRows: [
      { entityId: 10n, resourceId: 29 },
      { entityId: "not-selected", resourceId: 29 },
      { entityId: 20n, resourceId: 28 },
      { entityId: 3n, resourceId: 28 },
    ],
    locationRows: [
      { entityId: 10n, x: 10, z: 10, dimension: 1 },
      { entityId: 99n, x: "not-selected", z: "not-selected", dimension: 2 },
      { entityId: 20n, x: 20, z: 20, dimension: 1 },
      { entityId: 3n, x: 3, z: 3, dimension: 1 },
    ],
    observedAt: "2026-08-12T12:00:00.000Z",
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.resources.map((resource) => resource.entityId), ["3", "20"]);
  assert.deepEqual(result.resources.map((resource) => resource.resourceId), ["28", "28"]);
  assert.deepEqual(result.warnings, []);
});

test("resource normalization rejects non-overworld and out-of-bounds joined locations", () => {
  const result = normalizeMapResourceGeneration({
    regionId: "19",
    resourceId: "28",
    resourceRows: [
      { entityId: 1n, resourceId: 28 },
      { entityId: 2n, resourceId: 28 },
      { entityId: 3n, resourceId: 28 },
    ],
    locationRows: [
      { entityId: 1n, x: 1, z: 1, dimension: 2 },
      { entityId: 2n, x: -1, z: 2, dimension: 1 },
      { entityId: 3n, x: 3, z: 38_401, dimension: 1 },
    ],
    observedAt: "2026-08-12T12:00:00.000Z",
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.resources, []);
  assert.match(result.warnings.join(" "), /dimension 2.*overworld/i);
  assert.match(result.warnings.join(" "), /outside verified world bounds/i);
});

test("resource normalization marks a missing joined location incomplete without inventing a point", () => {
  const result = normalizeMapResourceGeneration({
    regionId: "19",
    resourceId: "28",
    resourceRows: [{ entityId: 100n, resourceId: 28 }],
    locationRows: [],
    observedAt: "2026-08-12T12:00:00.000Z",
  });
  assert.equal(result.complete, false);
  assert.deepEqual(result.resources, []);
  assert.match(result.warnings.join(" "), /resource 100.*location/i);
});

test("resource normalization treats an applied empty pair as complete", () => {
  const result = normalizeMapResourceGeneration({
    regionId: "19",
    resourceId: "28",
    resourceRows: [],
    locationRows: [],
    observedAt: "2026-08-12T12:00:00.000Z",
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.resources, []);
  assert.deepEqual(result.warnings, []);
});

test("regional resource normalization iterates each shared table once for multiple selected types", () => {
  const resourceIterations = { count: 0 };
  const locationIterations = { count: 0 };
  const result = normalizeMapResourceRegionGeneration({
    regionId: "19",
    resourceIds: ["28", "130"],
    resourceRows: counted([
      { entityId: 20n, resourceId: 28 },
      { entityId: 3n, resourceId: 28 },
      { entityId: 40n, resourceId: 130 },
      { entityId: 99n, resourceId: 999 },
    ], resourceIterations),
    locationRows: counted([
      { entityId: 3n, x: 3, z: 3, dimension: 1 },
      { entityId: 20n, x: 20, z: 20, dimension: 1 },
      { entityId: 40n, x: 40, z: 40, dimension: 1 },
    ], locationIterations),
    observedAt: "2026-08-12T12:00:00.000Z",
  });

  assert.equal(resourceIterations.count, 1);
  assert.equal(locationIterations.count, 1);
  assert.deepEqual(result.get("28").resources.map(({ entityId }) => entityId), ["3", "20"]);
  assert.deepEqual(result.get("130").resources.map(({ entityId }) => entityId), ["40"]);
});

test("regional resource normalization isolates one incomplete type from complete siblings", () => {
  const result = normalizeMapResourceRegionGeneration({
    regionId: "19",
    resourceIds: ["28", "130"],
    resourceRows: [
      { entityId: 1n, resourceId: 28 },
      { entityId: 2n, resourceId: 130 },
    ],
    locationRows: [{ entityId: 1n, x: 10, z: 20, dimension: 1 }],
    observedAt: "2026-08-12T12:00:00.000Z",
  });

  assert.equal(result.get("28").complete, true);
  assert.equal(result.get("130").complete, false);
  assert.deepEqual(result.get("28").resources.map(({ entityId }) => entityId), ["1"]);
  assert.match(result.get("130").warnings.join(" "), /resource 2.*location/i);
});
