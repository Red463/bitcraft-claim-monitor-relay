import assert from "node:assert/strict";
import test from "node:test";

import { mapResourceFeatures, mergeMapResourcePayload } from "../src/pages/map/mapResourceSnapshotState.mjs";

test("partition rows convert to typed resource features without losing entity ids", () => {
  assert.deepEqual(mapResourceFeatures([
    ["90071992547409930", "19", "28", 123, 456],
    ["bad"],
  ]), [{
    kind: "resource",
    entityId: "90071992547409930",
    regionId: "19",
    resourceId: "28",
    identity: "resource:28",
    point: { x: 123, z: 456, dimension: "1", coordinateSpace: "map-xz" },
  }]);
});

test("compact resource payload merges typed points without replacing operational layers", () => {
  const snapshot = {
    generation: "7",
    generatedAt: "2026-08-12T10:00:00.000Z",
    freshness: "live",
    warnings: ["base warning"],
    scope: { regionIds: ["19"], layers: ["claims"], resourceIds: [] },
    layers: { claims: [{ kind: "claim", entityId: "9" }] },
    layerAvailability: { claims: { available: true, status: "live", reason: null } },
  };
  const merged = mergeMapResourcePayload(snapshot, {
    generation: "8",
    freshness: "partial",
    warnings: ["resource warning"],
    scope: { regionIds: ["19", "24"], resourceIds: ["28", "54"] },
    resources: [
      ["100", "19", "28", 123, 456],
      ["101", "24", "54", 321, 654],
    ],
    layerAvailability: { available: true, status: "partial", pending: true, reason: "Some selected resource positions are still loading." },
  });

  assert.equal(merged.layers.claims, snapshot.layers.claims);
  assert.deepEqual(merged.layers.resources[0], {
    kind: "resource",
    entityId: "100",
    regionId: "19",
    resourceId: "28",
    identity: "resource:28",
    point: { x: 123, z: 456, dimension: "1", coordinateSpace: "map-xz" },
  });
  assert.deepEqual(merged.scope.resourceIds, ["28", "54"]);
  assert.equal(merged.generation, "8");
  assert.equal(merged.freshness, "partial");
  assert.deepEqual(merged.warnings, ["base warning", "resource warning"]);
  assert.deepEqual(merged.layerAvailability.resources, {
    available: true,
    status: "partial",
    pending: true,
    reason: "Some selected resource positions are still loading.",
  });
});

test("compact resource merge ignores malformed rows", () => {
  const snapshot = { generation: "1", freshness: "live", warnings: [], scope: {}, layers: {}, layerAvailability: {} };
  const merged = mergeMapResourcePayload(snapshot, {
    generation: "1",
    freshness: "live",
    warnings: [],
    scope: { resourceIds: ["28"] },
    resources: [["100", "19", "28", 1, 2], ["bad"], ["101", "19", "28", Number.NaN, 2]],
    layerAvailability: { available: true, status: "live", reason: null },
  });
  assert.equal(merged.layers.resources.length, 1);
});

test("typed resource projection accepts a progressive first page", () => {
  const features = mapResourceFeatures([["100", "19", "28", -25, 38_401]]);
  assert.equal(features.length, 1);
  assert.deepEqual(features[0].point, { x: -25, z: 38_401, dimension: "1", coordinateSpace: "map-xz" });
});
