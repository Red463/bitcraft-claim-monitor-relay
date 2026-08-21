import assert from "node:assert/strict";
import test from "node:test";

let performanceModule = null;
let benchmarkModule = null;
let binaryBenchmarkModule = null;
let resourceClientBenchmarkModule = null;
try {
  performanceModule = await import("../src/server/mapPerformance.mjs");
} catch {
  // RED: aggregate map performance telemetry has not been implemented yet.
}
try {
  benchmarkModule = await import("../scripts/benchmark-native-map.mjs");
} catch {
  // RED: the production-shaped native map benchmark has not been implemented yet.
}
try {
  binaryBenchmarkModule = await import("../scripts/benchmark-map-resource-binary.mjs");
} catch {
  // RED: the deterministic binary resource benchmark has not been implemented yet.
}
try {
  resourceClientBenchmarkModule = await import("../scripts/benchmark-map-resource-client.mjs");
} catch {
  // RED: the production-loader resource-client benchmark has not been implemented yet.
}

test("400,000-point binary resource processing stays bounded", async () => {
  assert.ok(binaryBenchmarkModule?.runBinaryResourceBenchmark);
  const result = await binaryBenchmarkModule.runBinaryResourceBenchmark({ pointCount: 400_000, iterations: 3 });
  assert.equal(result.pointCount, 400_000);
  assert.equal(result.encodedBytes, 44 + (400_000 * 4));
  assert.equal(result.identityLeak, false);
  assert.ok(result.maxHeapMiB <= 256);
  assert.ok(result.p95CodecMs <= 5_000);
  assert.ok(result.p95DeltaMs <= 2_000);
});

test("resource-client benchmark complements the retained server and binary benchmarks", () => {
  assert.ok(benchmarkModule?.runNativeMapBenchmark);
  assert.ok(binaryBenchmarkModule?.runBinaryResourceBenchmark);
  assert.ok(resourceClientBenchmarkModule?.runMapResourceClientBenchmark);
  const result = resourceClientBenchmarkModule.evaluateMapResourceClientBenchmark({
    expectedPartitionCount: 1,
    committedPartitionCount: 1,
    firstPartitionElapsedMs: 10,
    completeSelectionElapsedMs: 20,
    warmReselectElapsedMs: 1,
    decodedBytes: 4,
    coldRequestCount: 1,
    warmRequestCount: 0,
    changedGenerationCount: 0,
    maxActiveLoads: 1,
    configuredMaxConcurrentLoads: 4,
    unexpectedHttpCount: 0,
  });
  assert.equal(result.ok, true, result.failures.join("; "));
});

test("public map health contains aggregate partition metrics without coordinates or selected ids", () => {
  assert.ok(performanceModule?.publicMapHealth);
  const health = performanceModule.publicMapHealth({
    resourceHealth: {
      configuredRegionIds: ["19", "24"],
      pinnedRegionIds: ["19"],
      partitionCounts: { live: 2, loading: 1, stale: 1, unavailable: 0 },
      rowsPerSubscription: [100, 500],
      bytesPerSubscription: [2_000, 8_000],
      firstGenerationLatencyMs: { sampleCount: 2, min: 80, max: 120, average: 100 },
      normalizationDurationMs: { sampleCount: 2, min: 3, max: 7, average: 5 },
      queueDepth: 1,
      regionalConnectionCount: 2,
      activeResourceSubscriptionCount: 3,
      idleRetainedResourceSubscriptionCount: 1,
      reconnectAttemptCount: 2,
      capacityRejectionCount: 1,
      coldStartsInWindow: 4,
      binaryCache: { bytes: 1_600_000, entries: 3, activeEntries: 2, evictions: 4, rejections: 1 },
      regions: [{ regionId: "19", resourceIds: ["28"], locationX: 123, locationZ: 456 }],
    },
    telemetry: {
      tileLatencyMs: { observationCount: 3, sampleCount: 3, min: 10, p50: 20, p95: 30, p99: 30, max: 30, average: 20 },
      tileStatusCounts: { "200": 3 },
      resourcePageRows: { observationCount: 1, sampleCount: 1, min: 20_000, p50: 20_000, p95: 20_000, p99: 20_000, max: 20_000, average: 20_000 },
      resourcePageBytes: { observationCount: 1, sampleCount: 1, min: 100_000, p50: 100_000, p95: 100_000, p99: 100_000, max: 100_000, average: 100_000 },
      resourceStatusCounts: { "200": 1 },
    },
    tileHealth: { pointerReloadFailureCount: 2, selectedVersion: "g-secret" },
    eventLoopDelayMs: 12,
  });

  const serialized = JSON.stringify(health);
  assert.equal(serialized.includes("locationX"), false);
  assert.equal(serialized.includes("locationZ"), false);
  assert.equal(serialized.includes("resourceIds"), false);
  assert.equal(serialized.includes("regionId"), false);
  assert.equal(serialized.includes("g-secret"), false);
  assert.deepEqual(health.resources.partitionCounts, { live: 2, loading: 1, stale: 1, unavailable: 0 });
  assert.equal(health.tiles.pointerReloadFailureCount, 2);
  assert.equal(health.eventLoopDelayMs, 12);
  assert.deepEqual(health.resources.binaryCache, {
    bytes: 1_600_000,
    entries: 3,
    activeEntries: 2,
    evictions: 4,
    rejections: 1,
  });
});

test("map telemetry keeps bounded numeric samples while retaining total observation counts", () => {
  assert.ok(performanceModule?.createMapPerformanceTelemetry);
  const telemetry = performanceModule.createMapPerformanceTelemetry({ sampleLimit: 3 });
  for (const durationMs of [10, 20, 30, 40, 50]) telemetry.recordTileRequest({ durationMs, statusCode: 200 });
  telemetry.recordResourcePage({ rows: 20_000, bytes: 200_000, statusCode: 200 });
  const snapshot = telemetry.snapshot();

  assert.equal(snapshot.tileLatencyMs.observationCount, 5);
  assert.equal(snapshot.tileLatencyMs.sampleCount, 3);
  assert.deepEqual([snapshot.tileLatencyMs.min, snapshot.tileLatencyMs.p50, snapshot.tileLatencyMs.p95, snapshot.tileLatencyMs.max], [30, 40, 50, 50]);
  assert.deepEqual(snapshot.tileStatusCounts, { "200": 5 });
  assert.equal(snapshot.resourcePageRows.p95, 20_000);
});

test("benchmark rejects health p95 above 250ms and accepted first-result budgets", () => {
  assert.ok(benchmarkModule?.evaluateMapBenchmark);
  const rejected = benchmarkModule.evaluateMapBenchmark({
    healthMs: [90, 110, 290],
    cachedTileMs: [40, 70, 80],
    coldTileMs: [120, 150, 180],
    firstResourcePageMs: [1_200],
    warmReselectMs: [120],
    completePartitionMs: [1_500],
    http429: 0,
    http503: 0,
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.failures.join(" "), /health p95/i);

  const accepted = benchmarkModule.evaluateMapBenchmark({
    healthMs: [90, 110, 150],
    cachedTileMs: [40, 70, 80],
    coldTileMs: [120, 150, 180],
    firstResourcePageMs: [1_200],
    warmReselectMs: [120],
    completePartitionMs: [1_500],
    http429: 0,
    http503: 0,
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.failures, []);
  assert.equal(accepted.metrics.healthP95Ms, 150);
  assert.equal(accepted.metrics.cachedTileP95Ms, 80);
});

test("benchmark runner probes health and tiles while paging resource partitions through injected clients", async () => {
  assert.ok(benchmarkModule?.runNativeMapBenchmark);
  const calls = [];
  const httpClient = {
    async request(url, options) {
      calls.push(url);
      assert.equal(options.headers.authorization, "Bearer benchmark");
      if (url.includes("/api/local/map/health")) return { status: 200, durationMs: 40, bytes: 100, json: { resources: { queueDepth: 2 }, rssBytes: 1_000, eventLoopDelayMs: 8 } };
      if (url.includes("/tiles/")) return { status: 200, durationMs: calls.filter((entry) => entry.includes("/tiles/")).length === 1 ? 140 : 35, bytes: 2_000, json: null };
      if (url.includes("cursor=next")) return { status: 200, durationMs: 25, bytes: 300, json: { complete: true, nextCursor: null, resources: [["2", "19", "28", 30, 40]], layerAvailability: { status: "live" } } };
      return { status: 200, durationMs: 45, bytes: 300, json: { complete: false, nextCursor: "next", resources: [["1", "19", "28", 10, 20]], layerAvailability: { status: "live" } } };
    },
  };
  let streamClosed = false;
  const sseClient = {
    async open(_url, onEvent, options) {
      calls.push("sse-open");
      assert.equal(options.headers.authorization, "Bearer benchmark");
      onEvent({ initial: true });
      return { status: 200, close() { streamClosed = true; } };
    },
  };

  const result = await benchmarkModule.runNativeMapBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"],
    resourceIds: ["28"],
    tilePath: "/api/local/map/tiles/terrain/-5/0/-1.webp",
    iterations: 2,
    httpClient,
    sseClient,
    requestHeaders: { authorization: "Bearer benchmark" },
    verifyReleaseLifecycle: false,
  });

  assert.equal(result.samples.healthMs.length, 2);
  assert.equal(result.samples.coldTileMs.length, 1);
  assert.equal(result.samples.cachedTileMs.length, 1);
  assert.deepEqual(result.samples.firstResourcePageMs, [45]);
  assert.deepEqual(result.samples.completePartitionMs, [70]);
  assert.deepEqual(result.samples.warmReselectMs, [45]);
  assert.equal(result.samples.responseBytes, 5_100);
  assert.equal(result.samples.queueDepth, 2);
  assert.equal(result.samples.rssBytes, 1_000);
  assert.equal(result.samples.eventLoopDelayMs, 8);
  assert.equal(streamClosed, true);
  assert.equal(calls.indexOf("sse-open") > calls.findIndex((url) => url.includes("/api/local/map/resources")), true, "SSE must not pre-warm the cold partition request");
  assert.equal(calls.some((url) => url.includes("/api/local/map/resource-events")), false, "SSE uses its injected client rather than the HTTP client");
});

test("benchmark fails closed on missing samples and unexpected HTTP responses", async () => {
  assert.equal(benchmarkModule.evaluateMapBenchmark({}).ok, false);
  const result = await benchmarkModule.runNativeMapBenchmark({
    baseUrl: "http://127.0.0.1:18449",
    regionIds: ["19"], resourceIds: ["28"], tilePath: "/api/local/map/tiles/terrain/-5/0/-1.webp", iterations: 2,
    httpClient: { request: async () => ({ status: 403, durationMs: 1, bytes: 20, json: { error: "denied" } }) },
    sseClient: { open: async () => ({ status: 403, close() {} }) },
    verifyReleaseLifecycle: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /unexpected http|successful health|successful cold tile|resource page/i);
});

test("benchmark requires one accepted first and complete sample for every requested partition", () => {
  const result = benchmarkModule.evaluateMapBenchmark({
    expectedPartitionCount: 2,
    healthMs: [20], cachedTileMs: [20], coldTileMs: [30],
    firstResourcePageMs: [100], completePartitionMs: [150], warmReselectMs: [20],
    http429: 0, http503: 0,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /1 of 2.*partition/i);
});

test("benchmark waits for an accepted generation instead of treating a loading empty page as a result", async () => {
  let resourceRequests = 0;
  const result = await benchmarkModule.runNativeMapBenchmark({
    baseUrl: "http://127.0.0.1:18449", regionIds: ["19"], resourceIds: ["28"],
    tilePath: "/api/local/map/tiles/terrain/-5/0/-1.webp", iterations: 2,
    httpClient: { async request(url) {
      if (url.endsWith("/health")) return { status: 200, durationMs: 20, bytes: 50, json: { resources: { queueDepth: 0 } } };
      if (url.includes("/tiles/")) return { status: 200, durationMs: 20, bytes: 100, json: null };
      resourceRequests += 1;
      if (resourceRequests === 1) return { status: 200, durationMs: 100, bytes: 100, json: { resources: [], complete: true, nextCursor: null, layerAvailability: { status: "loading" } } };
      return { status: 200, durationMs: 80, bytes: 100, json: { resources: [], complete: true, nextCursor: null, layerAvailability: { status: "live" } } };
    } },
    sseClient: { async open(_url, onEvent) {
      queueMicrotask(() => onEvent({ changedDomains: ["map-resources"] }));
      return { status: 200, close() {} };
    } },
    verifyReleaseLifecycle: false,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.samples.firstResourcePageMs, [180]);
  assert.deepEqual(result.samples.completePartitionMs, [180]);
  assert.equal(resourceRequests, 3, "loading, accepted cold retry, and warm reselect are distinct");
});

test("benchmark starts later resource partitions without waiting for an earlier partition", async () => {
  let releaseFirst;
  const firstCanFinish = new Promise((resolve) => { releaseFirst = resolve; });
  const startedRegions = [];
  const benchmark = benchmarkModule.runNativeMapBenchmark({
    baseUrl: "http://127.0.0.1:18449", regionIds: ["19", "24"], resourceIds: ["28"],
    tilePath: "/api/local/map/tiles/terrain/-5/0/-1.webp", iterations: 2, selectionDeadlineMs: 1_000,
    httpClient: { async request(url) {
      if (url.endsWith("/health")) return { status: 200, durationMs: 20, bytes: 50, json: { resources: { queueDepth: 0 } } };
      if (url.includes("/tiles/")) return { status: 200, durationMs: 20, bytes: 100, json: null };
      const regionId = new URL(url).searchParams.get("region");
      startedRegions.push(regionId);
      if (regionId === "24") releaseFirst();
      if (regionId === "19" && startedRegions.filter((value) => value === "19").length === 1) await firstCanFinish;
      return { status: 200, durationMs: 40, bytes: 100, json: { resources: [], complete: true, nextCursor: null, layerAvailability: { status: "live" } } };
    } },
    sseClient: { async open() { return { status: 200, close() {} }; } },
    verifyReleaseLifecycle: false,
  });

  const result = await Promise.race([
    benchmark,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`later partition did not start concurrently: ${startedRegions.join(",")}`)), 500)),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(startedRegions.slice(0, 2).sort(), ["19", "24"]);
});

test("benchmark keeps health and tile probes running until resource selection finishes", async () => {
  let healthCalls = 0;
  let releasePartition;
  const probesContinued = new Promise((resolve) => { releasePartition = resolve; });
  const result = await benchmarkModule.runNativeMapBenchmark({
    baseUrl: "http://127.0.0.1:18449", regionIds: ["19"], resourceIds: ["28"],
    tilePath: "/api/local/map/tiles/terrain/-5/0/-1.webp", iterations: 2,
    httpClient: { async request(url) {
      if (url.endsWith("/health")) {
        healthCalls += 1;
        if (healthCalls === 3) releasePartition();
        return { status: 200, durationMs: 20, bytes: 50, json: { resources: { queueDepth: 0 } } };
      }
      if (url.includes("/tiles/")) return { status: 200, durationMs: 20, bytes: 100, json: null };
      if (healthCalls < 3) await probesContinued;
      return { status: 200, durationMs: 40, bytes: 100, json: { resources: [], complete: true, nextCursor: null, layerAvailability: { status: "live" } } };
    } },
    sseClient: { async open() { return { status: 200, close() {} }; } },
    verifyReleaseLifecycle: false,
  });

  assert.equal(result.ok, true);
  assert.ok(healthCalls >= 3, `expected probes beyond the minimum iteration count, got ${healthCalls}`);
});

test("benchmark observes resource subscriptions become idle and then close after stream release", async () => {
  let streamClosed = false;
  let releaseHealthCalls = 0;
  const result = await benchmarkModule.runNativeMapBenchmark({
    baseUrl: "http://127.0.0.1:18449", regionIds: ["19"], resourceIds: ["28"],
    tilePath: "/api/local/map/tiles/terrain/-5/0/-1.webp", iterations: 2,
    releaseDeadlineMs: 100, releasePollMs: 1,
    httpClient: { async request(url) {
      if (url.endsWith("/health")) {
        if (!streamClosed) return { status: 200, durationMs: 20, bytes: 50, json: { resources: { queueDepth: 0, activeResourceSubscriptionCount: 1, idleRetainedResourceSubscriptionCount: 0 } } };
        releaseHealthCalls += 1;
        return { status: 200, durationMs: 20, bytes: 50, json: { resources: { queueDepth: 0, activeResourceSubscriptionCount: 0, idleRetainedResourceSubscriptionCount: releaseHealthCalls === 1 ? 1 : 0 } } };
      }
      if (url.includes("/tiles/")) return { status: 200, durationMs: 20, bytes: 100, json: null };
      return { status: 200, durationMs: 40, bytes: 100, json: { resources: [], complete: true, nextCursor: null, layerAvailability: { status: "live" } } };
    } },
    sseClient: { async open() { return { status: 200, close() { streamClosed = true; } }; } },
  });

  assert.equal(result.ok, true);
  assert.equal(result.samples.releaseActiveObserved, true);
  assert.equal(result.samples.releaseIdleObserved, true);
  assert.equal(result.samples.releaseClosedObserved, true);
});

test("benchmark rejects repeated resource pagination cursors without unbounded requests", async () => {
  let resourceRequests = 0;
  const result = await benchmarkModule.runNativeMapBenchmark({
    baseUrl: "http://127.0.0.1:18449", regionIds: ["19"], resourceIds: ["28"],
    tilePath: "/api/local/map/tiles/terrain/-5/0/-1.webp", iterations: 2,
    httpClient: { async request(url) {
      if (url.endsWith("/health")) return { status: 200, durationMs: 20, bytes: 50, json: { resources: { queueDepth: 0 } } };
      if (url.includes("/tiles/")) return { status: 200, durationMs: 20, bytes: 100, json: null };
      resourceRequests += 1;
      return { status: 200, durationMs: 40, bytes: 100, json: { resources: [], complete: false, nextCursor: "same", layerAvailability: { status: "live" } } };
    } },
    sseClient: { async open() { return { status: 200, close() {} }; } },
    verifyReleaseLifecycle: false,
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /unexpected|completed/i);
  assert.equal(resourceRequests, 3, "two bounded partition pages plus the separate warm reselect");
});

test("streaming map routes are excluded from completion-latency distributions", () => {
  assert.equal(performanceModule.shouldRecordMapRequestLatency("/api/local/map/resource-events"), false);
  assert.equal(performanceModule.shouldRecordMapRequestLatency("/api/local/map/events"), false);
  assert.equal(performanceModule.shouldRecordMapRequestLatency("/api/local/map/resources"), true);
});
