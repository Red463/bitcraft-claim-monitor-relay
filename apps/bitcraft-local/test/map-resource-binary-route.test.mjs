import assert from "node:assert/strict";
import test from "node:test";

import { encodeResourcePartition, packResourceCoordinate } from "../src/map/resourcePartitionCodec.mjs";
import {
  MapResourceBinaryRouteError,
  binaryPartitionRecoveryResponse,
  binaryPartitionResponse,
  mapResourcePartitionUrl,
  publicMapResourcePartitionEvent,
  runWithConcurrency,
  parseMapResourceBinaryScope,
} from "../src/server/mapResourceBinaryRoute.mjs";

const binaryRouteModule = await import("../src/server/mapResourceBinaryRoute.mjs");

function cachedPartition() {
  const coordinates = Uint32Array.of(packResourceCoordinate(10, 20));
  const encoded = encodeResourcePartition({
    regionId: "19",
    resourceId: "28",
    dimension: "1",
    generation: "18446744073709551615",
    coordinates,
  });
  return {
    key: "19|resource:28",
    regionId: "19",
    resourceId: "28",
    generation: "18446744073709551615",
    coordinates,
    encoded,
    encodedBytes: encoded.byteLength,
    pointCount: 1,
    receivedAt: "2026-08-14T00:00:00.000Z",
    freshness: "live",
    warning: null,
  };
}

test("canonicalizes a bounded region, resource, and lossless generation scope", () => {
  const scope = parseMapResourceBinaryScope(new URLSearchParams({
    regionId: "019",
    resourceId: "028",
    generation: "018446744073709551615",
  }), {
    allowedRegionIds: ["19", "20"],
    allowedResourceIds: ["28", "125"],
  });
  assert.deepEqual(scope, {
    regionId: "19",
    resourceId: "28",
    generation: "18446744073709551615",
  });
});

test("rejects absent or out-of-catalogue binary scopes without echoing identities", () => {
  assert.throws(
    () => parseMapResourceBinaryScope(new URLSearchParams({ regionId: "99", resourceId: "777", generation: "1" }), {
      allowedRegionIds: ["19"],
      allowedResourceIds: ["28"],
    }),
    (error) => error instanceof MapResourceBinaryRouteError
      && error.statusCode === 422
      && !error.message.includes("99")
      && !error.message.includes("777"),
  );
  assert.throws(
    () => parseMapResourceBinaryScope(new URLSearchParams({ regionId: "19", resourceId: "28" }), {
      allowedRegionIds: ["19"],
      allowedResourceIds: ["28"],
    }),
    /generation/i,
  );
});

test("returns exact immutable binary headers and the original cached bytes", () => {
  const partition = cachedPartition();
  const scope = { regionId: partition.regionId, resourceId: partition.resourceId, generation: partition.generation };
  const response = binaryPartitionResponse({ scope, partition });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, partition.encoded);
  assert.deepEqual(response.headers, {
    "content-type": "application/vnd.timbersteel.map-resource-partition+octet-stream; version=1",
    "content-length": "48",
    "cache-control": "private, max-age=31536000, immutable",
    etag: '"19-28-18446744073709551615-v1"',
  });
});

test("honors an exact conditional ETag with a bodyless 304", () => {
  const partition = cachedPartition();
  const scope = { regionId: partition.regionId, resourceId: partition.resourceId, generation: partition.generation };
  const response = binaryPartitionResponse({
    scope,
    partition,
    ifNoneMatch: '"19-28-18446744073709551615-v1"',
  });
  assert.equal(response.statusCode, 304);
  assert.equal(response.body, null);
  assert.equal("content-length" in response.headers, false);
});

test("returns bounded recovery metadata when a requested generation expired", () => {
  const latest = cachedPartition();
  const scope = { regionId: "19", resourceId: "28", generation: "7" };
  assert.deepEqual(binaryPartitionRecoveryResponse({ scope, latest }), {
    statusCode: 409,
    body: {
      currentGeneration: "18446744073709551615",
      url: "/api/local/map/resource-partition?regionId=19&resourceId=28&generation=18446744073709551615",
    },
    headers: { "cache-control": "no-store" },
  });
  assert.equal(mapResourcePartitionUrl(latest), binaryPartitionRecoveryResponse({ scope, latest }).body.url);
});

test("serializes provider-neutral packed events without entity or Relay metadata", () => {
  const event = publicMapResourcePartitionEvent({
    type: "partition-delta",
    key: "19|resource:28",
    baseGeneration: "7",
    generation: "8",
    additions: Uint32Array.of(1, 0xffff_ffff),
    removals: Uint32Array.of(2),
    entityId: "secret",
    database: "relay-region-19",
  });
  assert.deepEqual(event, {
    type: "partition-delta",
    key: "19|resource:28",
    baseGeneration: "7",
    generation: "8",
    additions: [1, 4_294_967_295],
    removals: [2],
  });
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes("entityId"), false);
  assert.equal(serialized.includes("database"), false);
});

test("a newly connected resource stream announces an already warm partition", () => {
  assert.equal(typeof binaryRouteModule.initialMapResourcePartitionEvent, "function");
  const partition = cachedPartition();
  assert.deepEqual(binaryRouteModule.initialMapResourcePartitionEvent(partition.key, partition), {
    type: "partition-ready",
    key: partition.key,
    generation: partition.generation,
    pointCount: partition.pointCount,
    encodedBytes: partition.encodedBytes,
    receivedAt: partition.receivedAt,
    freshness: partition.freshness,
  });
  assert.deepEqual(binaryRouteModule.initialMapResourcePartitionEvent(partition.key, null), {
    type: "partition-loading",
    key: partition.key,
  });
});

test("runs independent acquisitions with a strict concurrency bound", async () => {
  let active = 0;
  let maximum = 0;
  const gates = [];
  const work = [1, 2, 3, 4].map((value) => async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => gates.push(resolve));
    active -= 1;
    return value;
  });
  const running = runWithConcurrency(work, 2);
  await Promise.resolve();
  assert.equal(active, 2);
  gates.shift()();
  gates.shift()();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(active, 2);
  gates.shift()();
  gates.shift()();
  assert.deepEqual(await running, [1, 2, 3, 4]);
  assert.equal(maximum, 2);
});

test("starts no more than eight of twenty acquisitions and preserves input result order", async () => {
  let active = 0;
  let maximum = 0;
  const started = [];
  const gates = Array.from({ length: 20 }, () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  });
  const work = gates.map((gate, index) => async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    started.push(index);
    await gate.promise;
    active -= 1;
    return `result-${index}`;
  });

  const running = runWithConcurrency(work, 8);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(active, 8);

  gates[3].resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(active, 8);

  for (const gate of gates) gate.resolve();
  assert.deepEqual(await running, Array.from({ length: 20 }, (_, index) => `result-${index}`));
  assert.equal(maximum, 8);
});

test("retains the first failure and settles already-started siblings before rejecting", async () => {
  const firstFailure = new Error("first acquisition failed");
  const laterFailure = new Error("later acquisition failed");
  const started = [];
  const settled = [];
  const gates = Array.from({ length: 5 }, () => {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  });
  const running = runWithConcurrency(gates.map((gate, index) => async () => {
    started.push(index);
    try {
      await gate.promise;
      return index;
    } finally {
      settled.push(index);
    }
  }), 3);
  let observedFailure = null;
  void running.catch((error) => { observedFailure = error; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);

  gates[0].reject(firstFailure);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observedFailure, null, "the runner must wait for siblings that already started");
  assert.deepEqual(started, [0, 1, 2], "no new work starts after the first failure");

  gates[1].reject(laterFailure);
  gates[2].resolve();
  await assert.rejects(running, (error) => error === firstFailure);
  assert.deepEqual([...settled].sort((left, right) => left - right), [0, 1, 2]);
  assert.equal(started.includes(3), false);
});
