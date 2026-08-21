import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resourcePartitionPlan } from "../src/pages/map/mapResourcePartitionState.mjs";
import { createMapResourceBinaryLoader } from "../src/pages/map/mapResourceBinaryLoader.mjs";

const HARD_MAX_CONCURRENT_LOADS = 4;
const WARM_CACHE_PARTITION_LIMIT = 8;
const MAX_PARTITIONS = 256;
const DEFAULT_SELECTION_DEADLINE_MS = 15_000;
const BINARY_ACCEPT = "application/vnd.timbersteel.map-resource-partition+octet-stream; version=1";

class BenchmarkFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "BenchmarkFailure";
  }
}

function canonicalDecimals(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  const output = [];
  const seen = new Set();
  for (const input of values) {
    const value = String(input ?? "").trim();
    if (!/^[1-9]\d*$/.test(value)) throw new TypeError(`${label} must contain positive decimal identifiers`);
    const canonical = BigInt(value).toString();
    if (!seen.has(canonical)) {
      seen.add(canonical);
      output.push(canonical);
    }
  }
  output.sort((left, right) => left.length - right.length || left.localeCompare(right));
  return output;
}

function normalizeLocalBaseUrl(value) {
  const parsed = new URL(String(value ?? ""));
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) throw new TypeError("Benchmark base URL must use HTTP or HTTPS");
  const hostname = parsed.hostname.toLowerCase();
  if (!new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(hostname)) {
    throw new TypeError("Benchmark base URL must target an explicit loopback server");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) {
    throw new TypeError("Benchmark base URL must be a credential-free origin");
  }
  return parsed.origin;
}

function sameOriginUrl(baseUrl, candidate) {
  const resolved = new URL(String(candidate), `${baseUrl}/`);
  if (resolved.username || resolved.password) throw new BenchmarkFailure("Resource benchmark rejected a credential-bearing URL");
  if (resolved.origin !== baseUrl) throw new BenchmarkFailure("Resource benchmark rejected a cross-origin URL");
  return resolved.toString();
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? Math.min(normalized, maximum) : fallback;
}

function isCommitted(partition) {
  return partition?.generation != null && partition.committed instanceof Uint32Array;
}

function completeScope(state, scope) {
  return state.size === scope.length && scope.every((entry) => isCommitted(state.get(entry.key)));
}

function confirmedScope(state, scope, readyGenerations, coldGenerations, warmRequestedKeys) {
  return completeScope(state, scope)
    && scope.every((entry) => {
      const partition = state.get(entry.key);
      const coldGeneration = coldGenerations.get(entry.key);
      if (warmRequestedKeys.has(entry.key) && partition.generation !== coldGeneration) return true;
      return partition.generation === coldGeneration && readyGenerations.get(entry.key) === partition.generation;
    });
}

function warmBenchmarkSelection(regions, resources) {
  if (regions.length >= WARM_CACHE_PARTITION_LIMIT) {
    return {
      regions: regions.slice(-WARM_CACHE_PARTITION_LIMIT),
      resources: resources.slice(-1),
    };
  }
  const retainedResourceCount = Math.min(
    resources.length,
    Math.max(1, Math.floor(WARM_CACHE_PARTITION_LIMIT / regions.length)),
  );
  return {
    regions,
    resources: resources.slice(-retainedResourceCount),
  };
}

function finiteThreshold(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? normalized : null;
}

export function evaluateMapResourceClientBenchmark(metrics, thresholds = {}) {
  const failures = [];
  const expected = Number(metrics?.expectedPartitionCount ?? 0);
  const committed = Number(metrics?.committedPartitionCount ?? 0);
  const warmPartitions = Number(metrics?.warmPartitionCount ?? 0);
  const coldRequests = Number(metrics?.coldRequestCount ?? 0);
  const warmRequests = Number(metrics?.warmRequestCount ?? 0);
  const coldHttpRequests = Number(metrics?.coldHttpRequestCount ?? 0);
  const warmHttpRequests = Number(metrics?.warmHttpRequestCount ?? 0);
  const recoveries = Number(metrics?.recoveryRequestCount ?? 0);
  const changedGenerations = Number(metrics?.changedGenerationCount ?? 0);
  const maxActiveHttpLoads = Number(metrics?.maxActiveHttpLoads ?? 0);
  const configuredLimit = Number(metrics?.configuredMaxConcurrentLoads ?? HARD_MAX_CONCURRENT_LOADS);
  const unexpectedHttp = Number(metrics?.unexpectedHttpCount ?? 0);

  if (!Number.isSafeInteger(expected) || expected < 1) failures.push("No requested resource partitions were measured");
  if (committed !== expected) failures.push(`Committed ${committed} of ${expected} requested resource partitions`);
  if (!Number.isSafeInteger(warmPartitions) || warmPartitions < 1 || warmPartitions > Math.min(expected, WARM_CACHE_PARTITION_LIMIT)) {
    failures.push(`Warm partition count ${warmPartitions} is outside the retained cache scope`);
  }
  if (!Number.isFinite(metrics?.firstPartitionElapsedMs)) failures.push("No first-partition elapsed metric was recorded");
  if (!Number.isFinite(metrics?.completeSelectionElapsedMs)) failures.push("No complete-selection elapsed metric was recorded");
  if (!Number.isFinite(metrics?.warmReselectElapsedMs)) failures.push("No warm-reselect elapsed metric was recorded");
  if (!Number.isSafeInteger(metrics?.decodedBytes) || metrics.decodedBytes < 0) failures.push("Decoded byte count is invalid");
  if (coldRequests !== expected) failures.push(`Cold request count ${coldRequests} does not match ${expected} requested partitions`);
  if (warmRequests !== changedGenerations) {
    failures.push(`Warm request count ${warmRequests} does not match ${changedGenerations} changed generations`);
  }
  if (coldHttpRequests + warmHttpRequests !== coldRequests + warmRequests + recoveries) {
    failures.push("HTTP request counts do not match logical partition loads plus recovery attempts");
  }
  const activeLimit = Math.min(HARD_MAX_CONCURRENT_LOADS, configuredLimit);
  if (maxActiveHttpLoads > activeLimit) failures.push(`Maximum active HTTP loads ${maxActiveHttpLoads} exceeds ${activeLimit}`);
  if (unexpectedHttp > 0) failures.push(`Unexpected HTTP response count ${unexpectedHttp}`);

  for (const [metric, threshold, label] of [
    [metrics?.firstPartitionElapsedMs, thresholds.maxFirstPartitionElapsedMs, "First partition"],
    [metrics?.completeSelectionElapsedMs, thresholds.maxCompleteSelectionElapsedMs, "Complete selection"],
    [metrics?.warmReselectElapsedMs, thresholds.maxWarmReselectElapsedMs, "Warm reselect"],
  ]) {
    const limit = finiteThreshold(threshold);
    if (limit != null && Number(metric) > limit) failures.push(`${label} ${metric}ms exceeds ${limit}ms`);
  }
  return { ok: failures.length === 0, failures, metrics };
}

export function createNativeFetchAdapter({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A native fetch implementation is required");
  return {
    request(url, { signal } = {}) {
      return fetchImpl(url, {
        signal,
        redirect: "error",
        headers: { accept: BINARY_ACCEPT },
      });
    },
  };
}

function eventData(block) {
  const lines = block.split(/\r\n|\n|\r/);
  const data = lines
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return data.length ? data.join("\n") : null;
}

export function createNodeStreamingSseAdapter({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("A native fetch implementation is required");
  return {
    connect(url, onEvent, onError) {
      const controller = new AbortController();
      let closed = false;
      let failed = false;
      const fail = () => {
        if (closed || failed) return;
        failed = true;
        onError?.();
      };
      void (async () => {
        try {
          const response = await fetchImpl(url, {
            signal: controller.signal,
            redirect: "error",
            headers: { accept: "text/event-stream" },
          });
          if (!response || response.status < 200 || response.status >= 300 || !response.body) {
            fail();
            return;
          }
          const decoder = new TextDecoder();
          let buffered = "";
          const emitBlock = (block) => {
            const data = eventData(block);
            if (data == null) return;
            try {
              onEvent(JSON.parse(data));
            } catch {
              fail();
              controller.abort();
            }
          };
          for await (const chunk of response.body) {
            if (closed || failed) break;
            buffered += decoder.decode(chunk, { stream: true });
            while (true) {
              const boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffered);
              if (!boundary) break;
              const block = buffered.slice(0, boundary.index);
              buffered = buffered.slice(boundary.index + boundary[0].length);
              emitBlock(block);
              if (failed) break;
            }
          }
          if (!closed && !failed) {
            buffered += decoder.decode();
            if (buffered.trim()) emitBlock(buffered);
            if (!failed) fail();
          }
        } catch (error) {
          if (!closed && error?.name !== "AbortError") fail();
        }
      })();
      return {
        close() {
          if (closed) return;
          closed = true;
          controller.abort();
        },
      };
    },
  };
}

export async function runMapResourceClientBenchmark({
  baseUrl,
  regionIds,
  resourceIds,
  maxConcurrentLoads = HARD_MAX_CONCURRENT_LOADS,
  selectionDeadlineMs = DEFAULT_SELECTION_DEADLINE_MS,
  thresholds = {},
  httpAdapter = createNativeFetchAdapter(),
  sseAdapter = createNodeStreamingSseAdapter(),
  now = performance.now.bind(performance),
  setTimeout: scheduleTimeout = globalThis.setTimeout,
  clearTimeout: cancelTimeout = globalThis.clearTimeout,
} = {}) {
  const root = normalizeLocalBaseUrl(baseUrl);
  const regions = canonicalDecimals(regionIds, "Benchmark regions");
  const resources = canonicalDecimals(resourceIds, "Benchmark resources");
  if (!regions.length || !resources.length) throw new TypeError("Benchmark regions and resources are required");
  const scope = resourcePartitionPlan(regions, resources);
  if (scope.length > MAX_PARTITIONS) throw new RangeError("Benchmark selection exceeds 256 resource partitions");
  const warmSelection = warmBenchmarkSelection(regions, resources);
  const warmScope = resourcePartitionPlan(warmSelection.regions, warmSelection.resources);
  if (typeof httpAdapter?.request !== "function" || typeof sseAdapter?.connect !== "function") {
    throw new TypeError("Benchmark HTTP and SSE adapters are required");
  }
  if (typeof now !== "function" || typeof scheduleTimeout !== "function" || typeof cancelTimeout !== "function") {
    throw new TypeError("Benchmark clock and timer adapters are required");
  }
  const configuredMaxConcurrentLoads = positiveInteger(maxConcurrentLoads, HARD_MAX_CONCURRENT_LOADS, HARD_MAX_CONCURRENT_LOADS);
  const deadlineMs = positiveInteger(selectionDeadlineMs, DEFAULT_SELECTION_DEADLINE_MS);
  const eventQuery = new URLSearchParams({ regions: regions.join(","), resourceIds: resources.join(",") });
  const eventUrl = `/api/local/map/resource-events?${eventQuery}`;
  const warmEventQuery = new URLSearchParams({
    regions: warmSelection.regions.join(","),
    resourceIds: warmSelection.resources.join(","),
  });
  const warmEventUrl = `/api/local/map/resource-events?${warmEventQuery}`;
  const metrics = {
    expectedPartitionCount: scope.length,
    committedPartitionCount: 0,
    firstPartitionElapsedMs: null,
    completeSelectionElapsedMs: null,
    warmReselectElapsedMs: null,
    decodedBytes: 0,
    warmPartitionCount: warmScope.length,
    coldRequestCount: 0,
    warmRequestCount: 0,
    coldHttpRequestCount: 0,
    warmHttpRequestCount: 0,
    recoveryRequestCount: 0,
    changedGenerationCount: 0,
    maxActiveHttpLoads: 0,
    configuredMaxConcurrentLoads,
    unexpectedHttpCount: 0,
  };
  const runtimeFailures = [];
  let currentState = new Map();
  let phase = null;
  let coldGenerations = null;
  let activeHttpLoads = 0;
  const requestedKeys = { cold: new Set(), warm: new Set() };
  const warmReadyGenerations = new Map();
  const waiters = new Set();

  const rejectWaiters = (message) => {
    for (const waiter of [...waiters]) waiter.reject(new BenchmarkFailure(message));
  };
  const observe = (state) => {
    currentState = state;
    const observedScope = phase?.name === "warm" ? warmScope : scope;
    const committed = observedScope.filter((entry) => isCommitted(state.get(entry.key)));
    if (phase?.name === "cold" && state.size === scope.length) {
      metrics.committedPartitionCount = Math.max(metrics.committedPartitionCount, committed.length);
    }
    if (phase?.name === "cold" && committed.length > 0 && metrics.firstPartitionElapsedMs == null) {
      metrics.firstPartitionElapsedMs = now() - phase.startedAt;
    }
    if (phase?.name === "cold" && committed.length === scope.length && metrics.completeSelectionElapsedMs == null) {
      metrics.completeSelectionElapsedMs = now() - phase.startedAt;
    }
    if (phase?.name === "warm" && committed.length === warmScope.length && metrics.warmReselectElapsedMs == null) {
      metrics.warmReselectElapsedMs = now() - phase.startedAt;
    }
    for (const waiter of [...waiters]) {
      if (waiter.predicate(state)) waiter.resolve();
    }
  };
  const waitFor = (predicate, failureMessage) => {
    let timer = null;
    let settled = false;
    let waiter;
    const promise = new Promise((resolve, reject) => {
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        waiters.delete(waiter);
        if (timer != null) cancelTimeout(timer);
        callback(value);
      };
      waiter = {
        predicate,
        resolve: () => finish(resolve),
        reject: (error) => finish(reject, error),
      };
      waiters.add(waiter);
      timer = scheduleTimeout(() => waiter.reject(new BenchmarkFailure(failureMessage)), deadlineMs);
    });
    if (predicate(currentState)) waiter.resolve();
    return promise;
  };

  const fetchBinary = async (candidate, signal) => {
    const requestPhase = phase?.name === "warm" ? "warm" : "cold";
    const resolvedUrl = sameOriginUrl(root, candidate);
    const parsedUrl = new URL(resolvedUrl);
    const requestedRegion = parsedUrl.searchParams.get("regionId");
    const requestedResource = parsedUrl.searchParams.get("resourceId");
    if (/^\d+$/.test(requestedRegion ?? "") && /^\d+$/.test(requestedResource ?? "")) {
      requestedKeys[requestPhase].add(`${BigInt(requestedRegion).toString()}|resource:${BigInt(requestedResource).toString()}`);
    }
    metrics[requestPhase === "warm" ? "warmHttpRequestCount" : "coldHttpRequestCount"] += 1;
    activeHttpLoads += 1;
    metrics.maxActiveHttpLoads = Math.max(metrics.maxActiveHttpLoads, activeHttpLoads);
    try {
      let response;
      try {
        response = await httpAdapter.request(resolvedUrl, { signal });
      } catch {
        throw new BenchmarkFailure("Binary resource partition request failed");
      }
      const status = Number(response?.status);
      if (status === 409) {
        metrics.recoveryRequestCount += 1;
        let recovery;
        try {
          recovery = typeof response.json === "function" ? await response.json() : response.json;
        } catch {
          throw new BenchmarkFailure("Binary resource partition recovery was malformed");
        }
        return { status: 409, json: recovery };
      }
      if (status !== 200 || typeof response?.arrayBuffer !== "function") {
        metrics.unexpectedHttpCount += 1;
        throw new BenchmarkFailure("Unexpected HTTP response for a binary resource partition");
      }
      try {
        return await response.arrayBuffer();
      } catch {
        throw new BenchmarkFailure("Binary resource partition body could not be read");
      }
    } finally {
      activeHttpLoads -= 1;
    }
  };

  const loader = createMapResourceBinaryLoader({
    fetchBinary,
    connectEvents(url, onEvent, onError) {
      return sseAdapter.connect(sameOriginUrl(root, url), (event) => {
        if (phase?.name === "warm" && event?.type === "partition-ready") {
          const key = String(event.key ?? "");
          if (warmScope.some((entry) => entry.key === key)) {
            warmReadyGenerations.set(key, String(event.generation ?? ""));
          }
        }
        onEvent(event);
      }, () => {
        rejectWaiters("Resource event stream failed");
        onError?.();
      });
    },
    onChange: observe,
    onError() {
      rejectWaiters("Binary resource partition load failed");
    },
    maxConcurrentLoads: configuredMaxConcurrentLoads,
  });

  try {
    phase = { name: "cold", startedAt: now() };
    const coldComplete = waitFor((state) => completeScope(state, scope), "Benchmark did not complete the requested selection");
    loader.setScope(scope, eventUrl);
    await coldComplete;
    coldGenerations = new Map(scope.map((entry) => [entry.key, currentState.get(entry.key).generation]));
    metrics.decodedBytes = scope.reduce((total, entry) => total + currentState.get(entry.key).committed.byteLength, 0);

    loader.setScope([], eventUrl);
    phase = { name: "warm", startedAt: now() };
    const warmHydrated = waitFor((state) => completeScope(state, warmScope), "Benchmark did not hydrate the warm selection");
    const warmConfirmed = waitFor(
      (state) => confirmedScope(state, warmScope, warmReadyGenerations, coldGenerations, requestedKeys.warm),
      "Benchmark did not confirm the warm selection",
    );
    loader.setScope(warmScope, warmEventUrl);
    await Promise.all([warmHydrated, warmConfirmed]);
    metrics.changedGenerationCount = warmScope.reduce(
      (count, entry) => count + Number(currentState.get(entry.key).generation !== coldGenerations.get(entry.key)),
      0,
    );
  } catch (error) {
    runtimeFailures.push(error instanceof BenchmarkFailure ? error.message : "Resource client benchmark failed");
  } finally {
    phase = null;
    loader.stop();
    rejectWaiters("Resource client benchmark stopped");
  }

  metrics.coldRequestCount = requestedKeys.cold.size;
  metrics.warmRequestCount = requestedKeys.warm.size;
  if (coldGenerations && metrics.changedGenerationCount === 0 && currentState.size === warmScope.length) {
    metrics.changedGenerationCount = warmScope.reduce(
      (count, entry) => {
        const partition = currentState.get(entry.key);
        return count + Number(isCommitted(partition) && partition.generation !== coldGenerations.get(entry.key));
      },
      0,
    );
  }

  const evaluated = evaluateMapResourceClientBenchmark(metrics, thresholds);
  const failures = [...new Set([...runtimeFailures, ...evaluated.failures])];
  return { ok: failures.length === 0, failures, metrics };
}

function requiredEnvironment(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalThreshold(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) return undefined;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new Error(`${name} must be a non-negative number`);
  return normalized;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === invokedPath) {
  const result = await runMapResourceClientBenchmark({
    baseUrl: requiredEnvironment("BITCRAFT_MAP_RESOURCE_CLIENT_BASE_URL"),
    regionIds: requiredEnvironment("BITCRAFT_MAP_RESOURCE_CLIENT_REGIONS").split(",").map((value) => value.trim()),
    resourceIds: requiredEnvironment("BITCRAFT_MAP_RESOURCE_CLIENT_RESOURCES").split(",").map((value) => value.trim()),
    thresholds: {
      maxFirstPartitionElapsedMs: optionalThreshold("BITCRAFT_MAP_RESOURCE_CLIENT_MAX_FIRST_MS"),
      maxCompleteSelectionElapsedMs: optionalThreshold("BITCRAFT_MAP_RESOURCE_CLIENT_MAX_COMPLETE_MS"),
      maxWarmReselectElapsedMs: optionalThreshold("BITCRAFT_MAP_RESOURCE_CLIENT_MAX_WARM_MS"),
    },
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
