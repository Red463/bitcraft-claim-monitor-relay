function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

export function numericDistribution(values = [], observationCount = values.length) {
  const sorted = values.map(finiteNonNegative).filter((value) => value !== null).sort((left, right) => left - right);
  return {
    observationCount,
    sampleCount: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, .5),
    p95: percentile(sorted, .95),
    p99: percentile(sorted, .99),
    max: sorted.at(-1) ?? null,
    average: sorted.length ? sorted.reduce((total, value) => total + value, 0) / sorted.length : null,
  };
}

function increment(counts, statusCode) {
  const key = String(Number(statusCode) || 0);
  counts[key] = (counts[key] ?? 0) + 1;
}

function boundedRecorder(limit) {
  const values = [];
  let observations = 0;
  return {
    record(value) {
      const number = finiteNonNegative(value);
      if (number === null) return;
      observations += 1;
      values.push(number);
      if (values.length > limit) values.splice(0, values.length - limit);
    },
    distribution() { return numericDistribution(values, observations); },
  };
}

export function createMapPerformanceTelemetry({ sampleLimit = 256 } = {}) {
  if (!Number.isSafeInteger(sampleLimit) || sampleLimit < 1) throw new TypeError("Map performance sample limit must be positive");
  const mapLatency = boundedRecorder(sampleLimit);
  const tileLatency = boundedRecorder(sampleLimit);
  const resourceRows = boundedRecorder(sampleLimit);
  const resourceBytes = boundedRecorder(sampleLimit);
  const mapStatusCounts = {};
  const tileStatusCounts = {};
  const resourceStatusCounts = {};
  return Object.freeze({
    recordMapRequest({ durationMs, statusCode }) {
      mapLatency.record(durationMs);
      increment(mapStatusCounts, statusCode);
    },
    recordTileRequest({ durationMs, statusCode }) {
      tileLatency.record(durationMs);
      increment(tileStatusCounts, statusCode);
    },
    recordResourcePage({ rows, bytes, statusCode }) {
      resourceRows.record(rows);
      resourceBytes.record(bytes);
      increment(resourceStatusCounts, statusCode);
    },
    snapshot() {
      return {
        mapRouteLatencyMs: mapLatency.distribution(),
        mapStatusCounts: { ...mapStatusCounts },
        tileLatencyMs: tileLatency.distribution(),
        tileStatusCounts: { ...tileStatusCounts },
        resourcePageRows: resourceRows.distribution(),
        resourcePageBytes: resourceBytes.distribution(),
        resourceStatusCounts: { ...resourceStatusCounts },
      };
    },
  });
}

function compactSummary(summary) {
  if (!summary) return null;
  return {
    sampleCount: summary.sampleCount,
    min: summary.min,
    max: summary.max,
    average: summary.average,
  };
}

export function shouldRecordMapRequestLatency(pathname) {
  return pathname !== "/api/local/map/resource-events" && pathname !== "/api/local/map/events";
}

export function publicMapHealth({ resourceHealth = {}, telemetry = {}, tileHealth = {}, eventLoopDelayMs = 0, rssBytes = process.memoryUsage().rss }) {
  return {
    provider: "relay",
    eventLoopDelayMs: finiteNonNegative(eventLoopDelayMs) ?? 0,
    rssBytes: finiteNonNegative(rssBytes) ?? 0,
    routes: {
      latencyMs: telemetry.mapRouteLatencyMs ?? numericDistribution([]),
      statusCounts: { ...(telemetry.mapStatusCounts ?? {}) },
    },
    tiles: {
      latencyMs: telemetry.tileLatencyMs ?? numericDistribution([]),
      statusCounts: { ...(telemetry.tileStatusCounts ?? {}) },
      pointerReloadFailureCount: Number(tileHealth.pointerReloadFailureCount ?? 0),
    },
    resources: {
      partitionCounts: { live: 0, loading: 0, stale: 0, unavailable: 0, ...(resourceHealth.partitionCounts ?? {}) },
      rowsPerSubscription: numericDistribution(resourceHealth.rowsPerSubscription ?? []),
      bytesPerSubscription: numericDistribution(resourceHealth.bytesPerSubscription ?? []),
      firstGenerationLatencyMs: compactSummary(resourceHealth.firstGenerationLatencyMs),
      normalizationDurationMs: compactSummary(resourceHealth.normalizationDurationMs),
      queueDepth: Number(resourceHealth.queueDepth ?? 0),
      regionalConnectionCount: Number(resourceHealth.regionalConnectionCount ?? 0),
      activeResourceSubscriptionCount: Number(resourceHealth.activeResourceSubscriptionCount ?? 0),
      idleRetainedResourceSubscriptionCount: Number(resourceHealth.idleRetainedResourceSubscriptionCount ?? 0),
      reconnectAttemptCount: Number(resourceHealth.reconnectAttemptCount ?? 0),
      capacityRejectionCount: Number(resourceHealth.capacityRejectionCount ?? 0),
      coldStartsInWindow: Number(resourceHealth.coldStartsInWindow ?? 0),
      pageRows: telemetry.resourcePageRows ?? numericDistribution([]),
      pageBytes: telemetry.resourcePageBytes ?? numericDistribution([]),
      statusCounts: { ...(telemetry.resourceStatusCounts ?? {}) },
    },
  };
}
