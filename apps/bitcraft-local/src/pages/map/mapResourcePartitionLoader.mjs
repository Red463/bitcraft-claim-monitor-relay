function abortError(error) {
  return error?.name === "AbortError";
}

function warning(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createMapResourcePartitionLoader({ fetchPage, concurrency = 4, onPage = () => {}, onPartition, onStatus }) {
  if (typeof fetchPage !== "function" || typeof onPage !== "function" || (onPartition != null && typeof onPartition !== "function") || typeof onStatus !== "function") {
    throw new TypeError("Resource partition loader callbacks are required");
  }
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError("Resource partition concurrency must be a positive integer");
  let wanted = new Map();
  let queue = [];
  const queued = new Set();
  const active = new Map();
  const completed = new Set();
  const retryTimers = new Map();
  let paused = false;
  let stopped = false;

  const enqueue = (partition) => {
    if (stopped || paused || !wanted.has(partition.key) || queued.has(partition.key) || active.has(partition.key) || completed.has(partition.key)) return;
    queued.add(partition.key);
    queue.push(partition);
  };

  const publishStatus = (partition, status, extra = {}) => {
    if (!stopped && wanted.has(partition.key)) onStatus({ key: partition.key, regionId: partition.regionId, resourceId: partition.resourceId, status, ...extra });
  };

  const clearRetry = (key) => {
    const timer = retryTimers.get(key);
    if (timer != null) clearTimeout(timer);
    retryTimers.delete(key);
  };

  const scheduleRetry = (partition, seconds) => {
    clearRetry(partition.key);
    const delayMs = Math.max(1, Number(seconds) * 1_000);
    if (!Number.isFinite(delayMs)) return;
    retryTimers.set(partition.key, setTimeout(() => {
      retryTimers.delete(partition.key);
      enqueue(partition);
      pump();
    }, delayMs));
  };

  const load = async (partition, controller) => {
    let cursor = null;
    let generation = null;
    let rows = onPartition ? [] : null;
    let warnings = [];
    let freshness = "live";
    let restarts = 0;
    publishStatus(partition, "loading");
    while (!stopped && !controller.signal.aborted && wanted.has(partition.key)) {
      let payload;
      try {
        payload = await fetchPage({ partition, cursor, signal: controller.signal });
      } catch (error) {
        if (error?.staleCursor === true && cursor != null && restarts < 1) {
          restarts += 1;
          cursor = null;
          generation = null;
          rows = onPartition ? [] : null;
          warnings = [];
          continue;
        }
        throw error;
      }
      if (controller.signal.aborted || stopped || !wanted.has(partition.key)) return;
      if (String(payload?.partition?.regionId) !== partition.regionId || String(payload?.partition?.resourceId) !== partition.resourceId) {
        throw new TypeError("Resource partition response scope does not match its request");
      }
      const nextGeneration = String(payload?.generation ?? "");
      if (!/^\d+$/.test(nextGeneration)) throw new TypeError("Resource partition generation is invalid");
      if (generation != null && generation !== nextGeneration) {
        if (restarts >= 1) throw new Error("Resource partition generation changed repeatedly while paging");
        restarts += 1;
        cursor = null;
        generation = null;
        rows = onPartition ? [] : null;
        warnings = [];
        continue;
      }
      generation = nextGeneration;
      const availability = payload?.layerAvailability ?? {};
      freshness = String(payload?.freshness ?? availability.status ?? "partial");
      warnings.push(...(payload?.warnings ?? []).map(String));
      if (availability.available !== true) {
        publishStatus(partition, String(availability.status ?? "unavailable"), {
          warning: String(availability.reason ?? warnings[0] ?? "Resource partition is unavailable."),
          pending: availability.pending === true,
        });
        if (availability.pending === true && Number(payload?.retryAfterSeconds) > 0) {
          scheduleRetry(partition, payload.retryAfterSeconds);
        }
        return;
      }
      if (!Array.isArray(payload.resources)) throw new TypeError("Resource partition rows are invalid");
      onPage({
        ...partition,
        generation,
        rows: payload.resources,
        complete: payload.complete === true,
        warnings: [...new Set(warnings)],
        freshness,
      });
      rows?.push(...payload.resources);
      if (payload.complete === true) {
        completed.add(partition.key);
        onPartition?.({ ...partition, generation, rows: rows ?? [], warnings: [...new Set(warnings)], freshness });
        publishStatus(partition, freshness, { warning: warnings[0] ?? null, pending: false });
        return;
      }
      cursor = String(payload.nextCursor ?? "");
      if (!cursor) throw new TypeError("Incomplete resource partition page has no continuation cursor");
    }
  };

  const pump = () => {
    if (stopped || paused) return;
    while (active.size < concurrency && queue.length) {
      const partition = queue.shift();
      queued.delete(partition.key);
      if (!wanted.has(partition.key) || completed.has(partition.key) || active.has(partition.key)) continue;
      const controller = new AbortController();
      active.set(partition.key, controller);
      void load(partition, controller).catch((error) => {
        if (!abortError(error) && !stopped && wanted.has(partition.key)) {
          publishStatus(partition, "unavailable", { warning: warning(error), pending: false });
        }
      }).finally(() => {
        const retryAbortedSelection = controller.signal.aborted
          && !stopped && !paused && wanted.has(partition.key) && !completed.has(partition.key);
        if (active.get(partition.key) === controller) active.delete(partition.key);
        if (retryAbortedSelection) enqueue(partition);
        pump();
      });
    }
  };

  return Object.freeze({
    setScope(partitions = []) {
      if (stopped) return;
      const next = new Map(partitions.map((partition) => [partition.key, partition]));
      wanted = next;
      queue = queue.filter((partition) => next.has(partition.key));
      queued.clear();
      for (const partition of queue) queued.add(partition.key);
      for (const [key, controller] of active) if (!next.has(key)) controller.abort();
      for (const key of retryTimers.keys()) if (!next.has(key)) clearRetry(key);
      for (const key of [...completed]) if (!next.has(key)) completed.delete(key);
      for (const partition of next.values()) enqueue(partition);
      pump();
    },
    refresh(keys = []) {
      if (stopped) return;
      for (const key of keys) {
        const partition = wanted.get(key);
        if (!partition) continue;
        clearRetry(key);
        completed.delete(key);
        active.get(key)?.abort();
        if (!active.has(key)) enqueue(partition);
      }
      pump();
    },
    pause() {
      if (stopped || paused) return;
      paused = true;
      for (const key of retryTimers.keys()) clearRetry(key);
      for (const controller of active.values()) controller.abort();
    },
    resume() {
      if (stopped || !paused) return;
      paused = false;
      for (const partition of wanted.values()) if (!completed.has(partition.key)) enqueue(partition);
      pump();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      queue = [];
      queued.clear();
      for (const key of retryTimers.keys()) clearRetry(key);
      for (const controller of active.values()) controller.abort();
      active.clear();
      wanted.clear();
      completed.clear();
    },
  });
}
