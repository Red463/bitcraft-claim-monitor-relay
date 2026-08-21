import assert from "node:assert/strict";
import test from "node:test";

import { encodeResourcePartition, packResourceCoordinate } from "../src/map/resourcePartitionCodec.mjs";

let benchmarkModule = null;
try {
  benchmarkModule = await import("../scripts/benchmark-map-resource-client.mjs");
} catch {
  // RED: the SSE-to-binary resource-client benchmark has not been implemented yet.
}

const scope = [
  { key: "19|resource:28", regionId: "19", resourceId: "28" },
  { key: "19|resource:125", regionId: "19", resourceId: "125" },
  { key: "19|resource:300", regionId: "19", resourceId: "300" },
];

function encoded(entry, generation, offset = 0) {
  return encodeResourcePartition({
    regionId: entry.regionId,
    resourceId: entry.resourceId,
    dimension: "1",
    generation: String(generation),
    coordinates: Uint32Array.of(
      packResourceCoordinate(Number(entry.resourceId) + offset, 10),
      packResourceCoordinate(Number(entry.resourceId) + offset + 1, 11),
    ),
  });
}

function response(body, status = 200) {
  return { status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function drain(steps = 20) {
  for (let index = 0; index < steps; index += 1) await Promise.resolve();
}

function readyEvents(entries, generationFor = () => "7") {
  return entries.map((entry) => {
    const generation = String(generationFor(entry));
    return {
      type: "partition-ready",
      key: entry.key,
      generation,
      pointCount: 2,
      encodedBytes: 52,
      receivedAt: "2026-08-21T00:00:00.000Z",
      freshness: "live",
      url: `/api/local/map/resource-partition?regionId=${entry.regionId}&resourceId=${entry.resourceId}&generation=${generation}`,
    };
  });
}

function eventAdapter(eventSets) {
  const connections = [];
  return {
    connections,
    connect(url, onEvent) {
      const index = connections.length;
      const connection = { url, closed: false, close() { this.closed = true; } };
      connections.push(connection);
      queueMicrotask(() => {
        if (connection.closed) return;
        for (const event of eventSets[index] ?? []) onEvent(event);
      });
      return connection;
    },
  };
}

function sequenceClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function manualScheduler() {
  const pending = new Set();
  return {
    setTimeout(callback) {
      const token = { callback, cancelled: false };
      pending.add(token);
      return token;
    },
    clearTimeout(token) {
      if (token) token.cancelled = true;
      pending.delete(token);
    },
    fireAll() {
      for (const token of [...pending]) {
        pending.delete(token);
        if (!token.cancelled) token.callback();
      }
    },
  };
}

test("runs the production loader across every cold partition and a cache-only exact-generation reselect", async () => {
  assert.ok(benchmarkModule?.runMapResourceClientBenchmark);
  const events = eventAdapter([readyEvents(scope), readyEvents(scope)]);
  const requests = [];
  const gates = [];
  const running = benchmarkModule.runMapResourceClientBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: ["28", "125", "300"],
    maxConcurrentLoads: 2,
    now: sequenceClock([100, 110, 130, 200, 205]),
    sseAdapter: events,
    httpAdapter: {
      request(url) {
        requests.push(url);
        const gate = deferred();
        gates.push({ url, gate });
        return gate.promise;
      },
    },
  });

  await drain();
  assert.equal(requests.length, 2, "the third cold request waits for a configured slot");
  for (const pending of gates.slice(0, 2)) {
    const url = new URL(pending.url);
    const entry = scope.find((candidate) => candidate.resourceId === url.searchParams.get("resourceId"));
    pending.gate.resolve(response(encoded(entry, "7")));
  }
  await drain();
  assert.equal(requests.length, 3, "the final partition starts after a cold slot completes");
  const lastUrl = new URL(gates[2].url);
  gates[2].gate.resolve(response(encoded(scope.find((entry) => entry.resourceId === lastUrl.searchParams.get("resourceId")), "7")));

  const result = await running;
  assert.equal(result.ok, true, result.failures.join("; "));
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.metrics, {
    expectedPartitionCount: 3,
    committedPartitionCount: 3,
    firstPartitionElapsedMs: 10,
    completeSelectionElapsedMs: 30,
    warmReselectElapsedMs: 5,
    decodedBytes: 24,
    coldRequestCount: 3,
    warmRequestCount: 0,
    changedGenerationCount: 0,
    maxActiveLoads: 2,
    configuredMaxConcurrentLoads: 2,
    unexpectedHttpCount: 0,
  });
  assert.equal(events.connections.length, 2);
  assert.equal(events.connections.every((connection) => connection.closed), true);
});

test("fetches exactly one partition when warm confirmation reports one changed generation", async () => {
  const entries = scope.slice(0, 2);
  const events = eventAdapter([
    readyEvents(entries),
    readyEvents(entries, (entry) => entry.resourceId === "28" ? "8" : "7"),
  ]);
  const requests = [];
  const result = await benchmarkModule.runMapResourceClientBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: ["28", "125"],
    now: sequenceClock([0, 5, 10, 20, 21]),
    sseAdapter: events,
    httpAdapter: {
      async request(url) {
        requests.push(url);
        const parsed = new URL(url);
        const entry = entries.find((candidate) => candidate.resourceId === parsed.searchParams.get("resourceId"));
        return response(encoded(entry, parsed.searchParams.get("generation"), parsed.searchParams.get("generation") === "8" ? 10 : 0));
      },
    },
  });

  assert.equal(result.ok, true, result.failures.join("; "));
  assert.equal(result.metrics.coldRequestCount, 2);
  assert.equal(result.metrics.warmRequestCount, 1);
  assert.equal(result.metrics.changedGenerationCount, 1);
  assert.equal(requests.filter((url) => new URL(url).searchParams.get("generation") === "8").length, 1);
});

test("fails deterministically for missing partitions, malformed binary, and unexpected HTTP", async (t) => {
  await t.test("missing partition", async () => {
    const scheduler = manualScheduler();
    const entries = scope.slice(0, 2);
    const events = eventAdapter([readyEvents(entries.slice(0, 1))]);
    const running = benchmarkModule.runMapResourceClientBenchmark({
      baseUrl: "http://127.0.0.1:18449",
      regionIds: ["19"], resourceIds: ["28", "125"], sseAdapter: events,
      httpAdapter: { request: async () => response(encoded(entries[0], "7")) },
      setTimeout: scheduler.setTimeout,
      clearTimeout: scheduler.clearTimeout,
    });
    await drain();
    scheduler.fireAll();
    const result = await running;
    assert.equal(result.ok, false);
    assert.match(result.failures.join(" "), /complete the requested selection/i);
  });

  await t.test("malformed binary", async () => {
    const events = eventAdapter([readyEvents(scope.slice(0, 1))]);
    const result = await benchmarkModule.runMapResourceClientBenchmark({
      baseUrl: "http://127.0.0.1:18449",
      regionIds: ["19"], resourceIds: ["28"], sseAdapter: events,
      httpAdapter: { request: async () => response(Uint8Array.of(0, 1, 2, 3)) },
    });
    assert.equal(result.ok, false);
    assert.match(result.failures.join(" "), /binary resource partition/i);
  });

  await t.test("unexpected HTTP", async () => {
    const events = eventAdapter([readyEvents(scope.slice(0, 1))]);
    const result = await benchmarkModule.runMapResourceClientBenchmark({
      baseUrl: "http://127.0.0.1:18449",
      regionIds: ["19"], resourceIds: ["28"], sseAdapter: events,
      httpAdapter: { request: async () => ({ status: 503, arrayBuffer: async () => new ArrayBuffer() }) },
    });
    assert.equal(result.ok, false);
    assert.equal(result.metrics.unexpectedHttpCount, 1);
    assert.match(result.failures.join(" "), /unexpected HTTP/i);
  });
});

test("functional evaluation rejects incomplete, over-concurrent, and broken request/cache metrics without timing limits", () => {
  assert.ok(benchmarkModule?.evaluateMapResourceClientBenchmark);
  const result = benchmarkModule.evaluateMapResourceClientBenchmark({
    expectedPartitionCount: 3,
    committedPartitionCount: 2,
    firstPartitionElapsedMs: 1,
    completeSelectionElapsedMs: 2,
    warmReselectElapsedMs: 0,
    decodedBytes: 8,
    coldRequestCount: 2,
    warmRequestCount: 2,
    changedGenerationCount: 1,
    maxActiveLoads: 3,
    configuredMaxConcurrentLoads: 2,
    unexpectedHttpCount: 0,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /committed 2 of 3/i);
  assert.match(result.failures.join(" "), /cold request count/i);
  assert.match(result.failures.join(" "), /warm request count/i);
  assert.match(result.failures.join(" "), /active loads 3 exceeds 2/i);
});

test("sanitizes adapter failures and never emits authentication or cookie values", async () => {
  const secret = "Bearer top-secret cookie=session-secret";
  const events = eventAdapter([readyEvents(scope.slice(0, 1))]);
  const observedLogs = [];
  const originalError = console.error;
  console.error = (...values) => observedLogs.push(values.join(" "));
  try {
    const result = await benchmarkModule.runMapResourceClientBenchmark({
      baseUrl: "http://127.0.0.1:18449",
      regionIds: ["19"], resourceIds: ["28"], sseAdapter: events,
      httpAdapter: { request: async () => { throw new Error(secret); } },
    });
    const serialized = JSON.stringify(result);
    assert.equal(result.ok, false);
    assert.equal(serialized.includes("top-secret"), false);
    assert.equal(serialized.includes("session-secret"), false);
    assert.deepEqual(observedLogs, []);
  } finally {
    console.error = originalError;
  }
});

test("Node SSE adapter parses fragmented CRLF events and sends no credential headers", async () => {
  assert.ok(benchmarkModule?.createNodeStreamingSseAdapter);
  const encoder = new TextEncoder();
  const events = [];
  const received = new Promise((resolve, reject) => {
    const adapter = benchmarkModule.createNodeStreamingSseAdapter({
      fetchImpl: async (_url, options) => {
        assert.deepEqual(options.headers, { accept: "text/event-stream" });
        assert.equal("authorization" in options.headers, false);
        assert.equal("cookie" in options.headers, false);
        return {
          status: 200,
          ok: true,
          body: (async function* () {
            yield encoder.encode(": keepalive\r\ndata: {\"type\":\"partition-");
            yield encoder.encode("loading\",\"key\":\"19|resource:28\"}\r\n\r\n");
          })(),
        };
      },
    });
    const connection = adapter.connect("http://127.0.0.1:18449/events", (event) => {
      events.push(event);
      connection.close();
      resolve();
    }, reject);
  });
  await received;
  assert.deepEqual(events, [{ type: "partition-loading", key: "19|resource:28" }]);
});
