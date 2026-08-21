import assert from "node:assert/strict";
import test from "node:test";

import { packResourceCoordinate } from "../src/map/resourcePartitionCodec.mjs";
import {
  applyMapResourceBinaryCommitted,
  applyMapResourceBinaryEvent,
  createMapResourceBinaryState,
  reconcileMapResourceBinaryScope,
} from "../src/pages/map/mapResourceBinaryState.mjs";

const bush = { key: "19|resource:2", regionId: "19", resourceId: "2" };
const ferns = { key: "19|resource:125", regionId: "19", resourceId: "125" };

test("accumulates provisional points without making them committed", () => {
  const initial = createMapResourceBinaryState([bush]);
  const changed = applyMapResourceBinaryEvent(initial, {
    type: "partition-provisional",
    key: bush.key,
    additions: [packResourceCoordinate(1, 2), packResourceCoordinate(3, 4)],
  });
  const partition = changed.partitions.get(bush.key);
  assert.equal(changed.requiresFetch, false);
  assert.equal(partition.generation, null);
  assert.equal(partition.status, "loading");
  assert.deepEqual([...partition.committed], []);
  assert.deepEqual([...partition.provisional], [packResourceCoordinate(1, 2), packResourceCoordinate(3, 4)]);
  assert.equal(partition.pointCount, 2);
});

test("atomically replaces provisional data with a validated committed generation", () => {
  let state = createMapResourceBinaryState([bush]);
  state = applyMapResourceBinaryEvent(state, {
    type: "partition-provisional", key: bush.key, additions: [packResourceCoordinate(1, 2)],
  }).partitions;
  const coordinates = Uint32Array.of(packResourceCoordinate(5, 6));
  const changed = applyMapResourceBinaryCommitted(state, bush.key, {
    regionId: "19", resourceId: "2", dimension: "1", generation: "7", coordinates, pointCount: 1,
  }, { freshness: "live" });
  const partition = changed.get(bush.key);
  assert.equal(partition.generation, "7");
  assert.equal(partition.committed, coordinates);
  assert.deepEqual([...partition.provisional], []);
  assert.equal(partition.status, "live");
});

test("promotes an exact cached generation to the server-reported freshness without fetching", () => {
  const coordinates = Uint32Array.of(packResourceCoordinate(5, 6));
  const cached = applyMapResourceBinaryCommitted(createMapResourceBinaryState([bush]), bush.key, {
    regionId: "19", resourceId: "2", dimension: "1", generation: "7", coordinates, pointCount: 1,
  }, { freshness: "awaiting-confirmation" });

  const confirmed = applyMapResourceBinaryEvent(cached, {
    type: "partition-ready", key: bush.key, generation: "7", freshness: "live",
  });

  assert.equal(confirmed.requiresFetch, false);
  assert.equal(confirmed.partitions.get(bush.key).committed, coordinates);
  assert.equal(confirmed.partitions.get(bush.key).freshness, "live");
  assert.equal(confirmed.partitions.get(bush.key).status, "live");
});

test("ignores an older decimal ready generation than the committed last-good generation", () => {
  const committed = applyMapResourceBinaryCommitted(createMapResourceBinaryState([bush]), bush.key, {
    regionId: "19", resourceId: "2", dimension: "1", generation: "10",
    coordinates: Uint32Array.of(packResourceCoordinate(10, 10)), pointCount: 1,
  }, { freshness: "live" });

  const older = applyMapResourceBinaryEvent(committed, {
    type: "partition-ready", key: bush.key, generation: "9", freshness: "live", url: "/older",
  });

  assert.equal(older.requiresFetch, false);
  assert.equal(older.partitions, committed);
  assert.equal(older.partitions.get(bush.key).generation, "10");
});

test("applies only an exact-base delta and requests a full fetch after a missed base", () => {
  const coordinate = packResourceCoordinate(1, 1);
  let state = applyMapResourceBinaryCommitted(createMapResourceBinaryState([bush]), bush.key, {
    regionId: "19", resourceId: "2", dimension: "1", generation: "7",
    coordinates: Uint32Array.of(coordinate), pointCount: 1,
  }, { freshness: "live" });
  const changed = applyMapResourceBinaryEvent(state, {
    type: "partition-delta", key: bush.key, baseGeneration: "7", generation: "8",
    additions: [packResourceCoordinate(2, 2)], removals: [coordinate],
  });
  assert.equal(changed.requiresFetch, false);
  assert.equal(changed.partitions.get(bush.key).generation, "8");
  assert.deepEqual([...changed.partitions.get(bush.key).committed], [packResourceCoordinate(2, 2)]);

  state = changed.partitions;
  const missed = applyMapResourceBinaryEvent(state, {
    type: "partition-delta", key: bush.key, baseGeneration: "6", generation: "9",
    additions: [], removals: [],
  });
  assert.equal(missed.requiresFetch, true);
  assert.equal(missed.partitions, state);
});

test("retains last-good as stale and marks a cold unavailable partition", () => {
  let state = applyMapResourceBinaryCommitted(createMapResourceBinaryState([bush, ferns]), bush.key, {
    regionId: "19", resourceId: "2", dimension: "1", generation: "7",
    coordinates: Uint32Array.of(packResourceCoordinate(1, 1)), pointCount: 1,
  }, { freshness: "live" });
  state = applyMapResourceBinaryEvent(state, {
    type: "partition-unavailable", key: bush.key, warning: "Relay unavailable",
  }).partitions;
  state = applyMapResourceBinaryEvent(state, {
    type: "partition-unavailable", key: ferns.key, warning: "Relay unavailable",
  }).partitions;

  assert.equal(state.get(bush.key).status, "stale");
  assert.equal(state.get(bush.key).generation, "7");
  assert.equal(state.get(ferns.key).status, "unavailable");
});

test("scope reconciliation removes deselections and preserves unrelated buffer identity", () => {
  let state = createMapResourceBinaryState([bush, ferns]);
  const fernsPartition = state.get(ferns.key);
  const unknown = applyMapResourceBinaryEvent(state, { type: "partition-loading", key: "24|resource:2" });
  assert.equal(unknown.partitions, state);

  state = applyMapResourceBinaryEvent(state, { type: "partition-loading", key: bush.key }).partitions;
  assert.equal(state.get(ferns.key), fernsPartition);
  const reconciled = reconcileMapResourceBinaryScope(state, [ferns]);
  assert.deepEqual([...reconciled.keys()], [ferns.key]);
  assert.equal(reconciled.get(ferns.key), fernsPartition);
  assert.equal(JSON.stringify([...reconciled.values()]).includes("entityId"), false);
});
