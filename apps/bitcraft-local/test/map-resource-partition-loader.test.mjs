import assert from "node:assert/strict";
import test from "node:test";

import { createMapResourcePartitionLoader } from "../src/pages/map/mapResourcePartitionLoader.mjs";

const A = { key: "19|resource:28", regionId: "19", resourceId: "28" };
const B = { key: "24|resource:28", regionId: "24", resourceId: "28" };
const C = { key: "25|resource:28", regionId: "25", resourceId: "28" };

async function waitFor(check, message = "condition") {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function page(partition, { generation = "1", rows = [], nextCursor = null, complete = true, status = "live" } = {}) {
  return {
    provider: "relay",
    generation,
    partition: { regionId: partition.regionId, resourceId: partition.resourceId },
    resources: rows,
    nextCursor,
    complete,
    warnings: [],
    freshness: status,
    layerAvailability: { available: status === "live" || status === "stale" || status === "partial", status, pending: status === "loading" },
  };
}

test("partition loader assembles every page before publishing one replacement", async () => {
  const cursors = [];
  const published = [];
  const loader = createMapResourcePartitionLoader({
    concurrency: 4,
    fetchPage: async ({ partition, cursor }) => {
      cursors.push(cursor);
      return cursor == null
        ? page(partition, { rows: [["1", "19", "28", 10, 20]], nextCursor: "next", complete: false })
        : page(partition, { rows: [["2", "19", "28", 30, 40]], complete: true });
    },
    onPartition: (partition) => published.push(partition),
    onStatus() {},
  });

  loader.setScope([A]);
  await waitFor(() => published.length === 1, "complete partition");

  assert.deepEqual(cursors, [null, "next"]);
  assert.deepEqual(published[0].rows.map((row) => row[0]), ["1", "2"]);
  loader.stop();
});

test("partition loader publishes the first page before the final page resolves", async () => {
  const pages = [];
  const partitions = [];
  let releaseSecondPage;
  const secondPage = new Promise((resolve) => { releaseSecondPage = resolve; });
  const loader = createMapResourcePartitionLoader({
    fetchPage: async ({ partition, cursor }) => cursor == null
      ? page(partition, { generation: "7", rows: [["1", "19", "28", 10, 20]], nextCursor: "next", complete: false })
      : secondPage,
    onPage: (entry) => pages.push(entry),
    onPartition: (partition) => partitions.push(partition),
    onStatus() {},
  });

  loader.setScope([A]);
  await waitFor(() => pages.length === 1, "first progressive page");
  assert.equal(pages[0].complete, false);
  assert.deepEqual(pages[0].rows, [["1", "19", "28", 10, 20]]);
  assert.equal(partitions.length, 0);

  releaseSecondPage(page(A, { generation: "7", rows: [["2", "19", "28", 30, 40]], complete: true }));
  await waitFor(() => partitions.length === 1, "completed partition");
  assert.equal(pages.length, 2);
  assert.equal(pages[1].complete, true);
  loader.stop();
});

test("partition loader bounds concurrent cold requests", async () => {
  let active = 0;
  let maximum = 0;
  const pending = [];
  const published = [];
  const loader = createMapResourcePartitionLoader({
    concurrency: 2,
    fetchPage: ({ partition }) => new Promise((resolve) => {
      active += 1;
      maximum = Math.max(maximum, active);
      pending.push(() => { active -= 1; resolve(page(partition)); });
    }),
    onPartition: (partition) => published.push(partition),
    onStatus() {},
  });

  loader.setScope([A, B, C]);
  await waitFor(() => pending.length === 2, "first two workers");
  assert.equal(maximum, 2);
  pending.shift()();
  await waitFor(() => pending.length === 2, "third worker");
  pending.shift()();
  pending.shift()();
  await waitFor(() => published.length === 3, "all partitions");
  assert.equal(maximum, 2);
  loader.stop();
});

test("partition loader refreshes only the changed selected key", async () => {
  const calls = [];
  const loader = createMapResourcePartitionLoader({
    fetchPage: async ({ partition }) => { calls.push(partition.key); return page(partition); },
    onPartition() {},
    onStatus() {},
  });
  loader.setScope([A, B]);
  await waitFor(() => calls.length === 2, "initial partitions");
  loader.refresh([B.key]);
  await waitFor(() => calls.length === 3, "changed partition");
  assert.deepEqual(calls, [A.key, B.key, B.key]);
  loader.stop();
});

test("partition loader pauses without publishing aborted work and resumes it", async () => {
  const signals = [];
  const published = [];
  const loader = createMapResourcePartitionLoader({
    fetchPage: ({ partition, signal }) => new Promise((resolve, reject) => {
      signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      if (signals.length > 1) resolve(page(partition));
    }),
    onPartition: (partition) => published.push(partition),
    onStatus() {},
  });
  loader.setScope([A]);
  await waitFor(() => signals.length === 1, "first request");
  loader.pause();
  assert.equal(signals[0].aborted, true);
  assert.equal(published.length, 0);
  loader.resume();
  await waitFor(() => published.length === 1, "resumed partition");
  loader.stop();
});

test("partition loader restarts once when page generations change", async () => {
  let calls = 0;
  const published = [];
  const loader = createMapResourcePartitionLoader({
    fetchPage: async ({ partition, cursor }) => {
      calls += 1;
      if (calls === 1) return page(partition, { generation: "1", rows: [["1", "19", "28", 10, 20]], nextCursor: "old", complete: false });
      if (cursor === "old") return page(partition, { generation: "2", rows: [], complete: true });
      return page(partition, { generation: "2", rows: [["2", "19", "28", 30, 40]], complete: true });
    },
    onPartition: (partition) => published.push(partition),
    onStatus() {},
  });
  loader.setScope([A]);
  await waitFor(() => published.length === 1, "restarted generation");
  assert.equal(calls, 3);
  assert.equal(published[0].generation, "2");
  assert.deepEqual(published[0].rows.map((row) => row[0]), ["2"]);
  loader.stop();
});

test("partition loader reports a failed region without replacing its last-good cache", async () => {
  const statuses = [];
  const published = [];
  const loader = createMapResourcePartitionLoader({
    fetchPage: async () => { throw new Error("region 24 unavailable"); },
    onPartition: (partition) => published.push(partition),
    onStatus: (status) => statuses.push(status),
  });
  loader.setScope([B]);
  await waitFor(() => statuses.some((status) => status.status === "unavailable"), "partition failure");
  assert.equal(published.length, 0);
  assert.match(statuses.at(-1).warning, /region 24 unavailable/);
  loader.stop();
});

test("retryable admission pressure stays pending and reloads after the advertised delay", async () => {
  let calls = 0;
  const pages = [];
  const statuses = [];
  const loader = createMapResourcePartitionLoader({
    fetchPage: async ({ partition }) => {
      calls += 1;
      if (calls === 1) return {
        ...page(partition, { status: "loading" }),
        retryAfterSeconds: 0.001,
        layerAvailability: { available: false, status: "loading", pending: true, reason: "Cold subscriptions are busy." },
      };
      return page(partition, { rows: [["1", "19", "28", 10, 20]] });
    },
    onPage: (entry) => pages.push(entry),
    onPartition() {},
    onStatus: (status) => statuses.push(status),
  });

  loader.setScope([A]);
  await waitFor(() => pages.length === 1, "retryable resource page");
  assert.equal(calls, 2);
  assert.equal(statuses.some((status) => status.status === "unavailable"), false);
  assert.equal(statuses.some((status) => status.status === "loading" && status.pending === true), true);
  loader.stop();
});
