export function serveLastGoodOrWait({ lastGood, refresh, forceRefresh = false, onRefreshError = () => {} }) {
  const refreshPromise = Promise.resolve(refresh);
  if (lastGood !== undefined && !forceRefresh) {
    void refreshPromise.catch(onRefreshError);
    return Promise.resolve(lastGood);
  }
  return refreshPromise;
}

export function nextRefreshRetry(previous = {}, { now = Date.now(), baseDelayMs = 15_000, maxDelayMs = 300_000 } = {}) {
  const refreshFailures = Math.max(0, Number(previous.refreshFailures) || 0) + 1;
  const delayMs = Math.min(
    Math.max(1, Number(maxDelayMs) || 300_000),
    Math.max(1, Number(baseDelayMs) || 15_000) * (2 ** Math.min(20, refreshFailures - 1)),
  );
  return { refreshFailures, retryAfter: Number(now) + delayMs };
}

export function refreshRetryAllowed(entry = {}, { now = Date.now(), forceRefresh = false } = {}) {
  return forceRefresh || Number(entry.retryAfter ?? 0) <= Number(now);
}

export function refreshFailureEntry(current, captured, options = {}) {
  if (!captured || current !== captured) return current;
  return { ...current, ...nextRefreshRetry(current, options) };
}
