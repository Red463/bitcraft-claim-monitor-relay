import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { numericDistribution } from "../src/server/mapPerformance.mjs";

const DEFAULT_THRESHOLDS = Object.freeze({
  healthP95Ms: 250,
  cachedTileP95Ms: 100,
  coldTileP95Ms: 250,
  firstResourcePageP95Ms: 3_000,
  completePartitionP95Ms: 10_000,
  warmReselectP95Ms: 500,
  maxHttp429: 0,
  maxHttp503: 0,
});

function p95(values) {
  return numericDistribution(values).p95 ?? 0;
}

export function evaluateMapBenchmark(samples, thresholds = {}) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const metrics = {
    healthP95Ms: p95(samples.healthMs ?? []),
    cachedTileP95Ms: p95(samples.cachedTileMs ?? []),
    coldTileP95Ms: p95(samples.coldTileMs ?? []),
    firstResourcePageP95Ms: p95(samples.firstResourcePageMs ?? []),
    completePartitionP95Ms: p95(samples.completePartitionMs ?? []),
    warmReselectP95Ms: p95(samples.warmReselectMs ?? []),
    http429: Number(samples.http429 ?? 0),
    http503: Number(samples.http503 ?? 0),
    unexpectedHttp: Number(samples.unexpectedHttp ?? 0),
  };
  const failures = [];
  for (const [label, values] of [
    ["health", samples.healthMs], ["cold tile", samples.coldTileMs], ["cached tile", samples.cachedTileMs],
    ["first resource page", samples.firstResourcePageMs], ["complete partition", samples.completePartitionMs],
    ["warm resource reselect", samples.warmReselectMs],
  ]) if (!Array.isArray(values) || values.length === 0) failures.push(`No successful ${label} samples were recorded`);
  if (metrics.healthP95Ms > limits.healthP95Ms) failures.push(`Health p95 ${metrics.healthP95Ms}ms exceeds ${limits.healthP95Ms}ms`);
  if (metrics.cachedTileP95Ms > limits.cachedTileP95Ms) failures.push(`Cached tile p95 ${metrics.cachedTileP95Ms}ms exceeds ${limits.cachedTileP95Ms}ms`);
  if (metrics.coldTileP95Ms > limits.coldTileP95Ms) failures.push(`Cold tile p95 ${metrics.coldTileP95Ms}ms exceeds ${limits.coldTileP95Ms}ms`);
  if (metrics.firstResourcePageP95Ms > limits.firstResourcePageP95Ms) failures.push(`First resource page p95 ${metrics.firstResourcePageP95Ms}ms exceeds ${limits.firstResourcePageP95Ms}ms`);
  if (metrics.completePartitionP95Ms > limits.completePartitionP95Ms) failures.push(`Complete partition p95 ${metrics.completePartitionP95Ms}ms exceeds ${limits.completePartitionP95Ms}ms`);
  if (metrics.warmReselectP95Ms > limits.warmReselectP95Ms) failures.push(`Warm resource reselect p95 ${metrics.warmReselectP95Ms}ms exceeds ${limits.warmReselectP95Ms}ms`);
  if (metrics.http429 > limits.maxHttp429) failures.push(`HTTP 429 count ${metrics.http429} exceeds ${limits.maxHttp429}`);
  if (metrics.http503 > limits.maxHttp503) failures.push(`HTTP 503 count ${metrics.http503} exceeds ${limits.maxHttp503}`);
  if (metrics.unexpectedHttp > 0) failures.push(`Unexpected HTTP or response count ${metrics.unexpectedHttp}`);
  return { ok: failures.length === 0, failures, metrics };
}

const defaultHttpClient = {
  async request(url, { headers = {} } = {}) {
    const startedAt = performance.now();
    const response = await fetch(url, { headers });
    const bytes = Buffer.from(await response.arrayBuffer());
    let json = null;
    try { json = JSON.parse(bytes.toString("utf8")); } catch {}
    return { status: response.status, durationMs: performance.now() - startedAt, bytes: bytes.byteLength, json };
  },
};

const defaultSseClient = {
  async open(url, onEvent, { headers = {} } = {}) {
    const controller = new AbortController();
    const response = await fetch(url, { signal: controller.signal, headers });
    void (async () => {
      if (!response.body) return;
      const decoder = new TextDecoder();
      let buffered = "";
      for await (const chunk of response.body) {
        buffered += decoder.decode(chunk, { stream: true });
        const events = buffered.split("\n\n");
        buffered = events.pop() ?? "";
        for (const event of events) {
          const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (data) try { onEvent(JSON.parse(data)); } catch {}
        }
      }
    })().catch(() => {});
    return { status: response.status, close() { controller.abort(); } };
  },
};

function recordStatus(samples, response) {
  samples.responseBytes += Number(response.bytes ?? 0);
  if (response.status === 429) samples.http429 += 1;
  if (response.status === 503) samples.http503 += 1;
  if (response.status < 200 || response.status >= 300) samples.unexpectedHttp += 1;
  return response.status >= 200 && response.status < 300;
}

function validTile(samples, response) {
  return recordStatus(samples, response) && Number(response.bytes) > 0;
}

function validResourcePage(samples, response) {
  return recordStatus(samples, response)
    && Array.isArray(response.json?.resources)
    && typeof response.json?.complete === "boolean";
}

function acceptedResourcePage(response) {
  return response.json?.layerAvailability?.status === "live" || response.json?.layerAvailability?.status === "stale";
}

function selectionQuery(regionIds, resourceIds) {
  const query = new URLSearchParams();
  query.set("regions", regionIds.join(","));
  query.set("resourceIds", resourceIds.join(","));
  return query.toString();
}

export async function runNativeMapBenchmark({
  baseUrl,
  regionIds,
  resourceIds,
  tilePath,
  iterations = 5,
  thresholds,
  httpClient = defaultHttpClient,
  sseClient = defaultSseClient,
  requestHeaders = {},
  selectionDeadlineMs = 15_000,
}) {
  const root = String(baseUrl).replace(/\/+$/, "");
  const samples = {
    healthMs: [], cachedTileMs: [], coldTileMs: [], firstResourcePageMs: [], completePartitionMs: [], warmReselectMs: [],
    responseBytes: 0, queueDepth: 0, rssBytes: 0, eventLoopDelayMs: 0, http429: 0, http503: 0, unexpectedHttp: 0,
  };
  let stream = null;
  let eventVersion = 0;
  const eventWaiters = new Set();
  const onStreamEvent = () => {
    eventVersion += 1;
    for (const resolve of eventWaiters) resolve();
    eventWaiters.clear();
  };
  const ensureStream = async () => {
    if (stream) return stream.status >= 200 && stream.status < 300;
    stream = await sseClient.open(
      `${root}/api/local/map/resource-events?${selectionQuery(regionIds, resourceIds)}`,
      onStreamEvent,
      { headers: requestHeaders },
    );
    if (stream.status < 200 || stream.status >= 300) samples.unexpectedHttp += 1;
    return stream.status >= 200 && stream.status < 300;
  };
  const waitForStreamChange = async (afterVersion, timeoutMs) => {
    if (eventVersion > afterVersion) return 0;
    const startedAt = performance.now();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        eventWaiters.delete(done);
        resolve();
      }, Math.max(1, timeoutMs));
      const done = () => {
        clearTimeout(timer);
        eventWaiters.delete(done);
        resolve();
      };
      eventWaiters.add(done);
    });
    return performance.now() - startedAt;
  };
  try {
    let selectionFinished = false;
    const selectionDeadlineAt = performance.now() + selectionDeadlineMs;
    const probe = async () => {
      for (let index = 0; index < iterations || (!selectionFinished && performance.now() < selectionDeadlineAt); index += 1) {
        const health = await httpClient.request(`${root}/api/local/map/health`, { headers: requestHeaders });
        if (recordStatus(samples, health) && health.json && typeof health.json.resources === "object") {
          samples.healthMs.push(health.durationMs);
          samples.queueDepth = Math.max(samples.queueDepth, Number(health.json.resources.queueDepth ?? 0));
          samples.rssBytes = Math.max(samples.rssBytes, Number(health.json.rssBytes ?? 0));
          samples.eventLoopDelayMs = Math.max(samples.eventLoopDelayMs, Number(health.json.eventLoopDelayMs ?? 0));
        } else if (health.status >= 200 && health.status < 300) samples.unexpectedHttp += 1;
        const tile = await httpClient.request(`${root}${tilePath}`, { headers: requestHeaders });
        if (validTile(samples, tile)) (index === 0 ? samples.coldTileMs : samples.cachedTileMs).push(tile.durationMs);
        else if (tile.status >= 200 && tile.status < 300) samples.unexpectedHttp += 1;
        if (index + 1 >= iterations && !selectionFinished) await new Promise((resolve) => setTimeout(resolve, 100));
      }
    };
    const loadPartitions = async () => { for (const regionId of regionIds) for (const resourceId of resourceIds) {
      let cursor = null;
      let completeMs = 0;
      let initialStreamRetry = false;
      let acceptedFirstPage = false;
      let attempts = 0;
      while (true) {
        attempts += 1;
        const query = new URLSearchParams({ region: regionId, resourceId });
        if (cursor) query.set("cursor", cursor);
        const response = await httpClient.request(`${root}/api/local/map/resources?${query}`, { headers: requestHeaders });
        if (!validResourcePage(samples, response)) {
          if (response.status >= 200 && response.status < 300) samples.unexpectedHttp += 1;
          break;
        }
        completeMs += response.durationMs;
        if (!acceptedResourcePage(response)) {
          if (response.json?.layerAvailability?.status !== "loading" || attempts >= 100 || performance.now() >= selectionDeadlineAt) break;
          if (!await ensureStream()) break;
          if (initialStreamRetry) {
            const observedVersion = eventVersion;
            completeMs += await waitForStreamChange(observedVersion, Math.max(1, selectionDeadlineAt - performance.now()));
            if (eventVersion <= observedVersion) break;
          }
          initialStreamRetry = true;
          cursor = null;
          continue;
        }
        if (!cursor) {
          samples.firstResourcePageMs.push(completeMs);
          acceptedFirstPage = true;
        }
        cursor = response.json?.nextCursor ?? null;
        if (!cursor) break;
      }
      if (completeMs > 0 && acceptedFirstPage && cursor === null) {
        samples.completePartitionMs.push(completeMs);
      }
    }};
    const loading = loadPartitions().finally(() => { selectionFinished = true; });
    await Promise.all([probe(), loading]);
    await ensureStream();
    const warmQuery = new URLSearchParams({ region: regionIds[0], resourceId: resourceIds[0] });
    const warm = await httpClient.request(`${root}/api/local/map/resources?${warmQuery}`, { headers: requestHeaders });
    if (validResourcePage(samples, warm) && acceptedResourcePage(warm)) samples.warmReselectMs.push(warm.durationMs);
    else if (warm.status >= 200 && warm.status < 300) samples.unexpectedHttp += 1;
  } finally {
    stream?.close();
  }
  return { ...evaluateMapBenchmark(samples, thresholds), samples };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (fileURLToPath(import.meta.url) === invokedPath) {
  const regionIds = String(process.env.BITCRAFT_MAP_BENCHMARK_REGIONS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const resourceIds = String(process.env.BITCRAFT_MAP_BENCHMARK_RESOURCES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!regionIds.length || !resourceIds.length) throw new Error("BITCRAFT_MAP_BENCHMARK_REGIONS and BITCRAFT_MAP_BENCHMARK_RESOURCES are required");
  const result = await runNativeMapBenchmark({
    baseUrl: process.env.BITCRAFT_MAP_BENCHMARK_BASE_URL ?? "http://127.0.0.1:18449",
    regionIds,
    resourceIds,
    tilePath: process.env.BITCRAFT_MAP_BENCHMARK_TILE_PATH ?? "/api/local/map/tiles/terrain/-5/0/-1.webp",
    requestHeaders: {
      ...(process.env.BITCRAFT_MAP_BENCHMARK_AUTHORIZATION ? { authorization: process.env.BITCRAFT_MAP_BENCHMARK_AUTHORIZATION } : {}),
      ...(process.env.BITCRAFT_MAP_BENCHMARK_COOKIE ? { cookie: process.env.BITCRAFT_MAP_BENCHMARK_COOKIE } : {}),
    },
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
