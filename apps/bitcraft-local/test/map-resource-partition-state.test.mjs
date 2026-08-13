import assert from "node:assert/strict";
import test from "node:test";

import {
  applyResourcePartitionPage,
  replaceResourcePartition,
  resourcePartitionKey,
  resourcePartitionPlan,
  resourceRowsFromPartitions,
  retainResourcePartitions,
} from "../src/pages/map/mapResourcePartitionState.mjs";

test("resource partition plans are decimal-canonical and Cartesian", () => {
  assert.equal(resourcePartitionKey("019", "00028"), "19|resource:28");
  assert.deepEqual(resourcePartitionPlan(["24", "019", "24"], ["1000028", "28"]).map((entry) => entry.key), [
    "19|resource:28",
    "19|resource:1000028",
    "24|resource:28",
    "24|resource:1000028",
  ]);
});

test("replacing one complete partition preserves every other partition", () => {
  const first = replaceResourcePartition(new Map(), {
    key: "19|resource:28", generation: "1", rows: [["1", "19", "28", 10, 20]], warnings: [], freshness: "live",
  });
  const existing = first.get("19|resource:28");
  const next = replaceResourcePartition(first, {
    key: "24|resource:28", generation: "3", rows: [["9", "24", "28", 30, 40]], warnings: [], freshness: "live",
  });

  assert.equal(next.get("19|resource:28"), existing);
  assert.equal(next.get("24|resource:28").generation, "3");
  assert.equal(first.has("24|resource:28"), false, "the prior immutable cache must not be mutated");
});

test("partition replacement validates scope, deduplicates entities, and sorts lossless ids", () => {
  const next = replaceResourcePartition(new Map(), {
    key: "19|resource:28",
    generation: "7",
    rows: [
      ["10", "19", "28", 10, 20],
      ["2", "19", "28", 30, 40],
      ["2", "19", "28", 99, 99],
      ["3", "24", "28", 50, 60],
      ["90071992547409930", "19", "28", 70, 80],
    ],
    warnings: ["one warning"],
    freshness: "stale",
  });

  assert.deepEqual(next.get("19|resource:28").rows.map((row) => row[0]), ["2", "10", "90071992547409930"]);
  assert.deepEqual(next.get("19|resource:28").rows[0], ["2", "19", "28", 30, 40]);
});

test("retaining a new selection removes only deselected partitions", () => {
  let state = replaceResourcePartition(new Map(), { key: "19|resource:28", generation: "1", rows: [["1", "19", "28", 10, 20]] });
  state = replaceResourcePartition(state, { key: "24|resource:28", generation: "1", rows: [["2", "24", "28", 30, 40]] });
  const retained = retainResourcePartitions(state, ["24|resource:28"]);

  assert.deepEqual([...retained.keys()], ["24|resource:28"]);
  assert.deepEqual(resourceRowsFromPartitions(retained), [["2", "24", "28", 30, 40]]);
});

test("cold pages render progressively and deduplicate entity ids within one generation", () => {
  let state = applyResourcePartitionPage(new Map(), {
    key: "19|resource:28", regionId: "19", resourceId: "28", generation: "7",
    rows: [["2", "19", "28", 20, 30], ["1", "19", "28", 10, 20]],
    warnings: [], freshness: "live", complete: false,
  });
  state = applyResourcePartitionPage(state, {
    key: "19|resource:28", regionId: "19", resourceId: "28", generation: "7",
    rows: [["2", "19", "28", 99, 99], ["3", "19", "28", 30, 40]],
    warnings: [], freshness: "live", complete: false,
  });

  assert.deepEqual(resourceRowsFromPartitions(state).map((row) => row[0]), ["1", "2", "3"]);
  assert.equal(state.get("19|resource:28").complete, false);
});

test("a new incomplete generation keeps the last complete rows until atomic promotion", () => {
  let state = replaceResourcePartition(new Map(), {
    key: "19|resource:28", generation: "7", rows: [["1", "19", "28", 10, 20]], warnings: [], freshness: "live",
  });
  state = applyResourcePartitionPage(state, {
    key: "19|resource:28", regionId: "19", resourceId: "28", generation: "8",
    rows: [["2", "19", "28", 30, 40]], warnings: [], freshness: "live", complete: false,
  });
  assert.deepEqual(resourceRowsFromPartitions(state).map((row) => row[0]), ["1"]);
  assert.deepEqual(state.get("19|resource:28").stagingRows.map((row) => row[0]), ["2"]);

  state = applyResourcePartitionPage(state, {
    key: "19|resource:28", regionId: "19", resourceId: "28", generation: "9",
    rows: [["3", "19", "28", 50, 60]], warnings: [], freshness: "live", complete: false,
  });
  assert.deepEqual(resourceRowsFromPartitions(state).map((row) => row[0]), ["1"]);
  assert.deepEqual(state.get("19|resource:28").stagingRows.map((row) => row[0]), ["3"]);

  state = applyResourcePartitionPage(state, {
    key: "19|resource:28", regionId: "19", resourceId: "28", generation: "9",
    rows: [["4", "19", "28", 70, 80]], warnings: [], freshness: "live", complete: true,
  });
  assert.deepEqual(resourceRowsFromPartitions(state).map((row) => row[0]), ["3", "4"]);
  assert.equal(state.get("19|resource:28").complete, true);
  assert.deepEqual(state.get("19|resource:28").stagingRows, []);
});
