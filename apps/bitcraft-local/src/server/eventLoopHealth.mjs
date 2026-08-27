function milliseconds(value) {
  const nanoseconds = Number(value);
  return Number.isFinite(nanoseconds) && nanoseconds >= 0 ? nanoseconds / 1e6 : 0;
}

export function createEventLoopHealthSampler(histogram, { now = Date.now, warmupMs = 180_000 } = {}) {
  const startedAt = now();
  let latest = {
    eventLoopDelayMs: 0,
    eventLoopDelayP99Ms: 0,
    eventLoopDelayMaxMs: 0,
    eventLoopMonitoringReady: false,
  };

  return {
    current() {
      return { ...latest };
    },
    sampleAndReset() {
      latest = {
        eventLoopDelayMs: milliseconds(histogram.mean),
        eventLoopDelayP99Ms: milliseconds(histogram.percentile?.(99)),
        eventLoopDelayMaxMs: milliseconds(histogram.max),
        eventLoopMonitoringReady: now() - startedAt >= Math.max(0, Number(warmupMs) || 0),
      };
      histogram.reset?.();
      return { ...latest };
    },
  };
}
