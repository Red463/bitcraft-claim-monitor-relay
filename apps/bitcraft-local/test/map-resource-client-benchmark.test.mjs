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

function unavailableEvents(entries) {
  return entries.map((entry) => ({
    type: "partition-unavailable",
    key: entry.key,
    warning: "Partition unavailable during warm confirmation",
  }));
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
    warmPartitionCount: 3,
    coldRequestCount: 3,
    warmRequestCount: 0,
    coldHttpRequestCount: 3,
    warmHttpRequestCount: 0,
    recoveryRequestCount: 0,
    changedGenerationCount: 0,
    maxActiveHttpLoads: 2,
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
  assert.equal(result.metrics.coldHttpRequestCount, 2);
  assert.equal(result.metrics.warmHttpRequestCount, 1);
  assert.equal(result.metrics.changedGenerationCount, 1);
  assert.equal(requests.filter((url) => new URL(url).searchParams.get("generation") === "8").length, 1);
});

test("requires an explicit matching ready event instead of treating warm unavailable state as confirmation", async () => {
  const scheduler = manualScheduler();
  const entry = scope[0];
  const events = eventAdapter([readyEvents([entry]), unavailableEvents([entry])]);
  const running = benchmarkModule.runMapResourceClientBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: [entry.resourceId],
    sseAdapter: events,
    httpAdapter: { request: async () => response(encoded(entry, "7")) },
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  });
  await drain();
  scheduler.fireAll();
  const result = await running;

  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /confirm the warm selection/i);
  assert.equal(result.metrics.warmRequestCount, 0);
});

test("benchmarks all cold partitions and cache-only reselects a deterministic retained subset", async () => {
  const entries = Array.from({ length: 9 }, (_, index) => ({
    key: `19|resource:${index + 1}`,
    regionId: "19",
    resourceId: String(index + 1),
  }));
  const retained = entries.slice(-8);
  const scheduler = manualScheduler();
  const events = eventAdapter([readyEvents(entries), readyEvents(retained)]);
  const requests = [];
  const running = benchmarkModule.runMapResourceClientBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: entries.map((entry) => entry.resourceId),
    sseAdapter: events,
    httpAdapter: {
      async request(url) {
        requests.push(url);
        const parsed = new URL(url);
        const entry = entries.find((candidate) => candidate.resourceId === parsed.searchParams.get("resourceId"));
        return response(encoded(entry, parsed.searchParams.get("generation")));
      },
    },
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  });
  await drain(100);
  scheduler.fireAll();
  const result = await running;

  assert.equal(result.ok, true, result.failures.join("; "));
  assert.equal(result.metrics.expectedPartitionCount, 9);
  assert.equal(result.metrics.committedPartitionCount, 9);
  assert.equal(result.metrics.warmPartitionCount, 8);
  assert.equal(result.metrics.coldRequestCount, 9);
  assert.equal(result.metrics.warmRequestCount, 0);
  assert.equal(requests.length, 9);
  assert.deepEqual(new URL(events.connections[1].url).searchParams.get("resourceIds").split(","), retained.map((entry) => entry.resourceId));
});

test("counts a Response-style 409 recovery as two HTTP attempts in one logical cold partition load", async () => {
  const entry = scope[0];
  const events = eventAdapter([
    readyEvents([entry], () => "7"),
    readyEvents([entry], () => "8"),
  ]);
  let attempts = 0;
  const result = await benchmarkModule.runMapResourceClientBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: [entry.resourceId],
    sseAdapter: events,
    httpAdapter: {
      async request() {
        attempts += 1;
        if (attempts === 1) {
          return {
            status: 409,
            async json() {
              return {
                currentGeneration: "8",
                url: `/api/local/map/resource-partition?regionId=19&resourceId=${entry.resourceId}&generation=8`,
              };
            },
          };
        }
        return response(encoded(entry, "8", 10));
      },
    },
  });

  assert.equal(result.ok, true, result.failures.join("; "));
  assert.equal(result.metrics.coldRequestCount, 1);
  assert.equal(result.metrics.coldHttpRequestCount, 2);
  assert.equal(result.metrics.warmRequestCount, 0);
  assert.equal(result.metrics.warmHttpRequestCount, 0);
  assert.equal(result.metrics.recoveryRequestCount, 1);
});

test("confirms a changed warm generation committed through canonical 409 recovery", async () => {
  const entry = scope[0];
  const scheduler = manualScheduler();
  const events = eventAdapter([
    readyEvents([entry], () => "7"),
    readyEvents([entry], () => "8"),
  ]);
  const requestGenerations = [];
  const running = benchmarkModule.runMapResourceClientBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: [entry.resourceId],
    sseAdapter: events,
    httpAdapter: {
      async request(url) {
        const generation = new URL(url).searchParams.get("generation");
        requestGenerations.push(generation);
        if (generation === "8") {
          return {
            status: 409,
            async json() {
              return {
                currentGeneration: "9",
                url: `/api/local/map/resource-partition?regionId=19&resourceId=${entry.resourceId}&generation=9`,
              };
            },
          };
        }
        return response(encoded(entry, generation, generation === "9" ? 20 : 0));
      },
    },
    setTimeout: scheduler.setTimeout,
    clearTimeout: scheduler.clearTimeout,
  });
  await drain(100);
  scheduler.fireAll();
  const result = await running;

  assert.equal(result.ok, true, result.failures.join("; "));
  assert.deepEqual(requestGenerations, ["7", "8", "9"]);
  assert.equal(result.metrics.coldRequestCount, 1);
  assert.equal(result.metrics.warmRequestCount, 1);
  assert.equal(result.metrics.coldHttpRequestCount, 1);
  assert.equal(result.metrics.warmHttpRequestCount, 2);
  assert.equal(result.metrics.recoveryRequestCount, 1);
  assert.equal(result.metrics.changedGenerationCount, 1);
});

test("consumes simultaneous warm hydration and confirmation rejection without an unhandled promise", async () => {
  const entry = scope[0];
  let connectionCount = 0;
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const result = await benchmarkModule.runMapResourceClientBenchmark({
      baseUrl: "http://127.0.0.1:18449",
      regionIds: ["19"],
      resourceIds: [entry.resourceId],
      httpAdapter: { request: async () => response(encoded(entry, "7")) },
      sseAdapter: {
        connect(_url, onEvent, onError) {
          connectionCount += 1;
          queueMicrotask(() => {
            if (connectionCount === 1) {
              for (const event of readyEvents([entry])) {
                onEvent({ ...event, freshness: "stale", warning: "Cold stale fixture is not cacheable" });
              }
            } else {
              onError(new Error("warm stream closed"));
            }
          });
          return { close() {} };
        },
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(result.ok, false);
    assert.match(result.failures.join(" "), /event stream failed/i);
    assert.equal(result.metrics.changedGenerationCount, 0);
    assert.equal(result.failures.some((failure) => /warm request count/i.test(failure)), false);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
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
    warmPartitionCount: 2,
    coldRequestCount: 2,
    warmRequestCount: 2,
    coldHttpRequestCount: 2,
    warmHttpRequestCount: 2,
    recoveryRequestCount: 0,
    changedGenerationCount: 1,
    maxActiveHttpLoads: 3,
    configuredMaxConcurrentLoads: 2,
    unexpectedHttpCount: 0,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /committed 2 of 3/i);
  assert.match(result.failures.join(" "), /cold request count/i);
  assert.match(result.failures.join(" "), /warm request count/i);
  assert.match(result.failures.join(" "), /active HTTP loads 3 exceeds 2/i);
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

test("rejects embedded credentials in a same-origin partition URL before invoking HTTP", async () => {
  const entry = scope[0];
  const [event] = readyEvents([entry]);
  const events = eventAdapter([[
    {
      ...event,
      url: `http://bench-user:bench-password@127.0.0.1:18449/api/local/map/resource-partition?regionId=19&resourceId=${entry.resourceId}&generation=7`,
    },
  ]]);
  let httpCalls = 0;
  const result = await benchmarkModule.runMapResourceClientBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: [entry.resourceId],
    sseAdapter: events,
    httpAdapter: {
      async request() {
        httpCalls += 1;
        return response(encoded(entry, "7"));
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(httpCalls, 0);
  assert.equal(JSON.stringify(result).includes("bench-password"), false);
});

test("rejects a non-loopback base URL before invoking either adapter without leaking user-info", async () => {
  let adapterCalls = 0;
  let failure = null;
  try {
    await benchmarkModule.runMapResourceClientBenchmark({
      baseUrl: "https://bench-user:bench-password@example.com",
      regionIds: ["19"],
      resourceIds: ["28"],
      httpAdapter: { request: async () => { adapterCalls += 1; } },
      sseAdapter: { connect() { adapterCalls += 1; return { close() {} }; } },
    });
  } catch (error) {
    failure = error;
  }

  assert.match(failure?.message ?? "", /loopback/i);
  assert.equal(adapterCalls, 0);
  assert.equal(String(failure).includes("bench-password"), false);
});

test("rejects a cross-origin partition candidate before HTTP without leaking its URL", async () => {
  const entry = scope[0];
  const [event] = readyEvents([entry]);
  const events = eventAdapter([[
    {
      ...event,
      url: `http://127.0.0.1:18450/api/local/map/resource-partition?regionId=19&resourceId=${entry.resourceId}&generation=7&token=candidate-secret`,
    },
  ]]);
  let httpCalls = 0;
  const result = await benchmarkModule.runMapResourceClientBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: [entry.resourceId],
    sseAdapter: events,
    httpAdapter: { request: async () => { httpCalls += 1; } },
  });

  assert.equal(result.ok, false);
  assert.equal(httpCalls, 0);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("candidate-secret"), false);
  assert.equal(serialized.includes("18450"), false);
});

test("Node SSE adapter accepts LF-delimited multiline JSON data", async () => {
  const encoder = new TextEncoder();
  const received = await new Promise((resolve, reject) => {
    const adapter = benchmarkModule.createNodeStreamingSseAdapter({
      fetchImpl: async () => ({
        status: 200,
        body: (async function* () {
          yield encoder.encode("data: {\n");
          yield encoder.encode("data: \"type\":\"partition-loading\",\"key\":\"19|resource:28\"}\n\n");
        })(),
      }),
    });
    const connection = adapter.connect("http://127.0.0.1:18449/events", (event) => {
      connection.close();
      resolve(event);
    }, reject);
  });

  assert.deepEqual(received, { type: "partition-loading", key: "19|resource:28" });
});

test("Node SSE adapter aborts a malformed stream and reports one sanitized failure", async () => {
  const encoder = new TextEncoder();
  let requestSignal = null;
  let errorCount = 0;
  await new Promise((resolve) => {
    const adapter = benchmarkModule.createNodeStreamingSseAdapter({
      fetchImpl: async (_url, options) => {
        requestSignal = options.signal;
        return {
          status: 200,
          body: (async function* () {
            yield encoder.encode("data: not-json\n\n");
          })(),
        };
      },
    });
    adapter.connect("http://127.0.0.1:18449/events", () => {
      assert.fail("malformed SSE must not publish an event");
    }, () => {
      errorCount += 1;
      resolve();
    });
  });
  await drain();

  assert.equal(errorCount, 1);
  assert.equal(requestSignal.aborted, true);
});
