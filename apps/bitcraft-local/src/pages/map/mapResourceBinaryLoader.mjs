import { decodeResourcePartition } from "../../map/resourcePartitionCodec.mjs";
import {
  applyMapResourceBinaryCommitted,
  applyMapResourceBinaryEvent,
  createMapResourceBinaryState,
  markMapResourceBinaryAwaitingConfirmation,
  reconcileMapResourceBinaryScope,
} from "./mapResourceBinaryState.mjs";

const MAX_CONCURRENT_LOADS = 4;
const MAX_CACHE_ENTRIES = 8;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const DEFAULT_LOAD_TIMEOUT_MS = 30_000;

function eventUrlWithGenerations(url, partitions) {
  const generations = {};
  for (const [key, partition] of partitions) {
    if (partition.generation != null) generations[key] = partition.generation;
  }
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}generations=${encodeURIComponent(JSON.stringify(generations))}`;
}

function isAbort(error) {
  return error?.name === "AbortError";
}

function compareGenerations(left, right) {
  if (left === right) return 0;
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) return BigInt(left) < BigInt(right) ? -1 : 1;
  return left < right ? -1 : 1;
}

function positiveInteger(value, fallback, maximum) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? Math.min(normalized, maximum) : fallback;
}

function nonNegativeInteger(value, fallback, maximum) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? Math.min(normalized, maximum) : fallback;
}

export function createMapResourceBinaryLoader({
  fetchBinary,
  connectEvents,
  onChange,
  onError,
  maxConcurrentLoads = MAX_CONCURRENT_LOADS,
  cacheMaxEntries = MAX_CACHE_ENTRIES,
  cacheMaxBytes = MAX_CACHE_BYTES,
  loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer = (timer) => clearTimeout(timer),
}) {
  if (typeof fetchBinary !== "function" || typeof connectEvents !== "function") {
    throw new TypeError("Resource partition loader dependencies are required");
  }
  const loadLimit = positiveInteger(maxConcurrentLoads, MAX_CONCURRENT_LOADS, MAX_CONCURRENT_LOADS);
  const cacheEntryLimit = nonNegativeInteger(cacheMaxEntries, MAX_CACHE_ENTRIES, MAX_CACHE_ENTRIES);
  const cacheByteLimit = nonNegativeInteger(cacheMaxBytes, MAX_CACHE_BYTES, MAX_CACHE_BYTES);
  const loadTimeout = positiveInteger(loadTimeoutMs, DEFAULT_LOAD_TIMEOUT_MS, Number.MAX_SAFE_INTEGER);
  let partitions = createMapResourceBinaryState();
  let eventUrl = "";
  let connection = null;
  let paused = false;
  let stopped = false;
  let connectionEpoch = 0;
  let cacheBytes = 0;
  let scopePriority = new Map();
  const pending = new Map();
  const active = new Map();
  const decodedCache = new Map();
  const awaitingConfirmation = new Set();

  const publish = (next) => {
    if (next === partitions) return;
    partitions = next;
    onChange?.(partitions);
  };

  const removeCached = (key) => {
    const cached = decodedCache.get(key);
    if (!cached) return null;
    decodedCache.delete(key);
    cacheBytes -= cached.byteLength;
    return cached;
  };

  const cachePartition = (current) => {
    if (
      cacheEntryLimit === 0
      || cacheByteLimit === 0
      || current.generation == null
      || current.freshness !== "live"
      || current.status !== "live"
      || !(current.committed instanceof Uint32Array)
      || current.pointCount !== current.committed.length
      || current.committed.byteLength > cacheByteLimit
    ) return;
    removeCached(current.key);
    const cached = {
      key: current.key,
      regionId: current.regionId,
      resourceId: current.resourceId,
      generation: current.generation,
      coordinates: current.committed,
      pointCount: current.pointCount,
      byteLength: current.committed.byteLength,
    };
    decodedCache.set(current.key, cached);
    cacheBytes += cached.byteLength;
    while (decodedCache.size > cacheEntryLimit || cacheBytes > cacheByteLimit) {
      removeCached(decodedCache.keys().next().value);
    }
  };

  const abortKey = (key) => {
    pending.delete(key);
    const request = active.get(key);
    request?.controller.abort();
  };

  const markUnavailable = (key) => {
    const result = applyMapResourceBinaryEvent(partitions, {
      type: "partition-unavailable",
      key,
      warning: "Resource partition could not be loaded",
    });
    publish(result.partitions);
    onError?.("Resource partition could not be loaded");
  };

  const runActive = async (request) => {
    const { key, controller } = request;
    const deadline = new Promise((_resolve, reject) => {
      request.timeoutTimer = setTimer(() => {
        request.timedOut = true;
        controller.abort();
        reject(new Error("Resource partition load timed out"));
      }, loadTimeout);
    });
    const load = async () => {
      let recoveryRemaining = 1;
      while (true) {
        const response = await fetchBinary(request.url, controller.signal);
        if (controller.signal.aborted || active.get(key) !== request || stopped || paused || !partitions.has(key)) return;
        if (response && typeof response === "object" && response.status === 409) {
          const recovery = typeof response.json === "function" ? await response.json() : response.json;
          if (controller.signal.aborted || active.get(key) !== request || stopped || paused || !partitions.has(key)) return;
          const currentGeneration = String(recovery?.currentGeneration ?? "");
          const recoveryUrl = recovery?.url;
          if (recoveryRemaining > 0 && /^\d+$/.test(currentGeneration) && typeof recoveryUrl === "string") {
            recoveryRemaining -= 1;
            request.generation = currentGeneration;
            request.url = recoveryUrl;
            continue;
          }
          throw new TypeError("Resource partition generation expired");
        }
        const payload = response && typeof response === "object" && typeof response.arrayBuffer === "function"
          ? await response.arrayBuffer()
          : response;
        if (controller.signal.aborted || active.get(key) !== request || stopped || paused || !partitions.has(key)) return;
        const current = partitions.get(key);
        if (!current) return;
        if (
          !awaitingConfirmation.has(key)
          && /^\d+$/.test(current.generation ?? "")
          && compareGenerations(request.generation, current.generation) < 0
        ) return;
        const decoded = decodeResourcePartition(payload, {
          regionId: current.regionId,
          resourceId: current.resourceId,
          dimension: "1",
          generation: request.generation,
        });
        if (controller.signal.aborted || active.get(key) !== request || stopped || paused || !partitions.has(key)) return;
        const freshness = current.freshness === "stale" || current.freshness === "unavailable" || request.freshness === "stale"
          ? "stale"
          : "live";
        const warning = current.freshness === "stale" || current.freshness === "unavailable"
          ? current.warning
          : request.warning;
        awaitingConfirmation.delete(key);
        publish(applyMapResourceBinaryCommitted(partitions, key, decoded, { freshness, warning }));
        return;
      }
    };
    try {
      await Promise.race([load(), deadline]);
    } catch (error) {
      const failed = request.timedOut || (!controller.signal.aborted && !isAbort(error));
      if (failed && active.get(key) === request && !stopped && !paused && partitions.has(key) && !pending.has(key)) {
        markUnavailable(key);
      }
    } finally {
      if (request.timeoutTimer != null) clearTimer(request.timeoutTimer);
      request.timeoutTimer = null;
      if (active.get(key) === request) active.delete(key);
      pump();
    }
  };

  const pump = () => {
    if (paused || stopped) return;
    while (active.size < loadLimit) {
      let selected = null;
      let selectedPriority = Number.POSITIVE_INFINITY;
      for (const entry of pending) {
        if (!active.has(entry[0])) {
          const priority = scopePriority.get(entry[0]) ?? Number.POSITIVE_INFINITY;
          if (selected && priority >= selectedPriority) continue;
          selected = entry;
          selectedPriority = priority;
        }
      }
      if (!selected) return;
      const [key, work] = selected;
      pending.delete(key);
      if (!partitions.has(key)) continue;
      const request = { ...work, controller: new AbortController(), timedOut: false, timeoutTimer: null };
      active.set(key, request);
      void runActive(request);
    }
  };

  const enqueue = (key, generation, url, metadata = {}) => {
    if (paused || stopped || !partitions.has(key) || typeof url !== "string") return;
    const normalizedGeneration = String(generation);
    if (!/^\d+$/.test(normalizedGeneration)) return;
    const current = partitions.get(key);
    if (current?.generation === normalizedGeneration && !awaitingConfirmation.has(key)) return;
    const allowsAuthoritativeReset = awaitingConfirmation.has(key);
    const work = {
      key,
      generation: normalizedGeneration,
      url,
      freshness: metadata.freshness === "stale" ? "stale" : "live",
      warning: metadata.warning == null ? null : String(metadata.warning),
    };
    const queued = pending.get(key);
    if (queued) {
      const queuedComparison = compareGenerations(normalizedGeneration, queued.generation);
      if (queuedComparison < 0 && !allowsAuthoritativeReset) return;
      if (queuedComparison === 0) {
        queued.freshness = work.freshness;
        queued.warning = work.warning;
        return;
      }
    }
    const running = active.get(key);
    if (running) {
      const runningComparison = compareGenerations(normalizedGeneration, running.generation);
      if (!running.controller.signal.aborted && runningComparison < 0 && !allowsAuthoritativeReset) return;
      if (!running.controller.signal.aborted && runningComparison === 0) {
        running.freshness = work.freshness;
        running.warning = work.warning;
        return;
      }
      pending.set(key, work);
      running.controller.abort();
      return;
    }
    pending.set(key, work);
    pump();
  };

  const handleEvent = (event) => {
    if (paused || stopped || !event || typeof event !== "object") return;
    if (event.type === "stream-ready") {
      pending.clear();
      for (const request of active.values()) request.controller.abort();
      const next = markMapResourceBinaryAwaitingConfirmation(partitions);
      for (const [key, current] of next) {
        if (current.generation != null) awaitingConfirmation.add(key);
      }
      publish(next);
      return;
    }
    const key = String(event.key ?? "");
    if (!partitions.has(key)) return;
    try {
      if (awaitingConfirmation.has(key) && event.type === "partition-delta") {
        const current = partitions.get(key);
        const generation = String(event.generation ?? "");
        if (current && /^\d+$/.test(generation)) {
          const params = new URLSearchParams({ regionId: current.regionId, resourceId: current.resourceId, generation });
          enqueue(key, generation, `/api/local/map/resource-partition?${params}`);
        }
        return;
      }
      const before = partitions.get(key);
      const result = applyMapResourceBinaryEvent(partitions, event);
      publish(result.partitions);
      if (
        awaitingConfirmation.has(key)
        && event.type === "partition-ready"
        && before?.generation === String(event.generation)
        && !result.requiresFetch
      ) awaitingConfirmation.delete(key);
      if (event.type === "partition-ready" && result.requiresFetch && typeof event.url === "string") {
        enqueue(key, event.generation, event.url, { freshness: event.freshness, warning: event.warning });
      } else if (result.requiresFetch) {
        const current = partitions.get(key);
        const generation = String(event.generation ?? "");
        if (current && /^\d+$/.test(generation)) {
          const params = new URLSearchParams({ regionId: current.regionId, resourceId: current.resourceId, generation });
          enqueue(key, generation, `/api/local/map/resource-partition?${params}`, { freshness: "live" });
        }
      }
    } catch {
      markUnavailable(key);
    }
  };

  const closeConnection = () => {
    const owned = connection;
    connection = null;
    connectionEpoch += 1;
    owned?.close();
  };

  const openConnection = () => {
    if (paused || stopped || connection || !eventUrl || partitions.size === 0) return;
    const ownedEpoch = ++connectionEpoch;
    connection = connectEvents(
      eventUrlWithGenerations(eventUrl, partitions),
      (event) => {
        if (ownedEpoch === connectionEpoch) handleEvent(event);
      },
      () => {
        if (ownedEpoch === connectionEpoch) onError?.("Resource event connection was interrupted");
      },
    );
  };

  return {
    setScope(scope, nextEventUrl) {
      if (stopped) return;
      scopePriority = new Map();
      for (const [index, entry] of (scope ?? []).entries()) {
        const key = String(entry.key);
        if (!scopePriority.has(key)) scopePriority.set(key, index);
      }
      const wanted = new Set(scopePriority.keys());
      for (const [key, current] of partitions) {
        if (!wanted.has(key)) cachePartition(current);
      }
      for (const key of pending.keys()) if (!wanted.has(key)) pending.delete(key);
      for (const key of active.keys()) if (!wanted.has(key)) abortKey(key);
      for (const key of awaitingConfirmation) if (!wanted.has(key)) awaitingConfirmation.delete(key);
      let next = reconcileMapResourceBinaryScope(partitions, scope);
      const scopeChanged = next !== partitions;
      for (const input of scope ?? []) {
        const key = String(input.key);
        const current = next.get(key);
        if (!current || current.generation != null) continue;
        const cached = removeCached(key);
        if (!cached) continue;
        if (cached.regionId !== current.regionId || cached.resourceId !== current.resourceId) continue;
        next = applyMapResourceBinaryCommitted(next, key, {
          regionId: cached.regionId,
          resourceId: cached.resourceId,
          dimension: "1",
          generation: cached.generation,
          coordinates: cached.coordinates,
          pointCount: cached.pointCount,
        }, { freshness: "awaiting-confirmation" });
        awaitingConfirmation.add(key);
      }
      publish(next);
      const urlChanged = eventUrl !== String(nextEventUrl ?? "");
      eventUrl = String(nextEventUrl ?? "");
      if (urlChanged || scopeChanged) closeConnection();
      openConnection();
    },
    pause() {
      if (paused || stopped) return;
      paused = true;
      closeConnection();
      pending.clear();
      for (const request of active.values()) request.controller.abort();
    },
    resume() {
      if (!paused || stopped) return;
      paused = false;
      openConnection();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      closeConnection();
      pending.clear();
      for (const request of active.values()) request.controller.abort();
    },
    state() {
      return partitions;
    },
  };
}
