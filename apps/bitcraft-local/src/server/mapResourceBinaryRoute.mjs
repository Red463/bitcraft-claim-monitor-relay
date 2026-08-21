const CONTENT_TYPE = "application/vnd.timbersteel.map-resource-partition+octet-stream; version=1";

export class MapResourceBinaryRouteError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "MapResourceBinaryRouteError";
    this.statusCode = statusCode;
  }
}

function decimal(value, label) {
  const normalized = String(value ?? "").trim();
  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    if (!/^\d+$/.test(normalized)) throw new MapResourceBinaryRouteError(422, `${label} is required and must be decimal`);
  }
  return BigInt(normalized).toString();
}

function allowed(values, value) {
  return new Set(values.map((candidate) => BigInt(String(candidate)).toString())).has(value);
}

export function parseMapResourceBinaryScope(searchParams, { allowedRegionIds, allowedResourceIds }) {
  const regionId = decimal(searchParams.get("regionId"), "Region");
  const resourceId = decimal(searchParams.get("resourceId"), "Resource");
  const generation = decimal(searchParams.get("generation"), "Generation");
  if (!allowed(allowedRegionIds, regionId)) {
    throw new MapResourceBinaryRouteError(422, "Requested map region is unavailable");
  }
  if (!allowed(allowedResourceIds, resourceId)) {
    throw new MapResourceBinaryRouteError(422, "Requested map resource is unavailable");
  }
  return { regionId, resourceId, generation };
}

export function mapResourcePartitionUrl(partition) {
  const params = new URLSearchParams({
    regionId: String(partition.regionId),
    resourceId: String(partition.resourceId),
    generation: String(partition.generation),
  });
  return `/api/local/map/resource-partition?${params}`;
}

export function initialMapResourcePartitionEvent(key, partition) {
  if (!partition) return { type: "partition-loading", key: String(key) };
  return {
    type: "partition-ready",
    key: String(key),
    generation: String(partition.generation),
    pointCount: Number(partition.pointCount),
    encodedBytes: Number(partition.encodedBytes),
    receivedAt: String(partition.receivedAt),
    freshness: String(partition.freshness),
  };
}

function etag(partition) {
  return `"${partition.regionId}-${partition.resourceId}-${partition.generation}-v1"`;
}

export function binaryPartitionResponse({ scope, partition, ifNoneMatch = "" }) {
  if (!partition
    || partition.regionId !== scope.regionId
    || partition.resourceId !== scope.resourceId
    || partition.generation !== scope.generation) {
    throw new MapResourceBinaryRouteError(404, "Requested map resource generation is unavailable");
  }
  const partitionEtag = etag(partition);
  if (String(ifNoneMatch).split(",").map((value) => value.trim()).includes(partitionEtag)) {
    return {
      statusCode: 304,
      body: null,
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        etag: partitionEtag,
      },
    };
  }
  return {
    statusCode: 200,
    body: partition.encoded,
    headers: {
      "content-type": CONTENT_TYPE,
      "content-length": String(partition.encoded.byteLength),
      "cache-control": "private, max-age=31536000, immutable",
      etag: partitionEtag,
    },
  };
}

export function binaryPartitionRecoveryResponse({ scope, latest }) {
  if (!latest || latest.regionId !== scope.regionId || latest.resourceId !== scope.resourceId) {
    return {
      statusCode: 503,
      body: { error: "Map resource partition is not ready" },
      headers: { "cache-control": "no-store" },
    };
  }
  return {
    statusCode: 409,
    body: {
      currentGeneration: latest.generation,
      url: mapResourcePartitionUrl(latest),
    },
    headers: { "cache-control": "no-store" },
  };
}

function partitionIdentityFromKey(key) {
  const match = /^(\d+)\|resource:(\d+)$/.exec(String(key));
  if (!match) throw new TypeError("Invalid map resource partition key");
  return { regionId: match[1], resourceId: match[2] };
}

export function publicMapResourcePartitionEvent(event) {
  const base = { type: event.type, key: String(event.key) };
  if (event.type === "partition-loading") return base;
  if (event.type === "partition-provisional") {
    return { ...base, additions: Array.from(event.additions, (value) => value >>> 0) };
  }
  if (event.type === "partition-ready") {
    const identity = partitionIdentityFromKey(event.key);
    return {
      ...base,
      generation: String(event.generation),
      pointCount: Number(event.pointCount),
      encodedBytes: Number(event.encodedBytes),
      receivedAt: String(event.receivedAt),
      freshness: String(event.freshness),
      url: mapResourcePartitionUrl({ ...identity, generation: String(event.generation) }),
    };
  }
  if (event.type === "partition-delta") {
    return {
      ...base,
      baseGeneration: String(event.baseGeneration),
      generation: String(event.generation),
      additions: Array.from(event.additions, (value) => value >>> 0),
      removals: Array.from(event.removals, (value) => value >>> 0),
    };
  }
  if (event.type === "partition-stale") {
    return { ...base, generation: String(event.generation), warning: String(event.warning) };
  }
  if (event.type === "partition-unavailable") {
    return {
      ...base,
      warning: String(event.warning),
      ...(event.retryAfterSeconds == null ? {} : { retryAfterSeconds: Number(event.retryAfterSeconds) }),
    };
  }
  throw new TypeError("Unsupported map resource partition event");
}

export async function runWithConcurrency(tasks, limit) {
  if (!Array.isArray(tasks)) throw new TypeError("Concurrent tasks must be an array");
  const concurrency = Number(limit);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new TypeError("Concurrency limit must be positive");
  const results = new Array(tasks.length);
  let nextIndex = 0;
  let failed = false;
  let firstFailure;
  async function worker() {
    while (!failed && nextIndex < tasks.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await tasks[index]();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstFailure = error;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  if (failed) throw firstFailure;
  return results;
}

export function createMapResourceEventLeaseAcquisition({
  inputs,
  concurrency,
  acquire,
  isClosed,
  onEvent,
  onInitial,
  onUnavailable,
  closedMessage = "Map resource event request closed during lease acquisition.",
}) {
  if (!Array.isArray(inputs)) throw new TypeError("Map resource event inputs must be an array");
  for (const [label, callback] of Object.entries({ acquire, isClosed, onEvent, onInitial, onUnavailable })) {
    if (typeof callback !== "function") throw new TypeError(`Map resource event ${label} callback is required`);
  }
  const leases = new Array(inputs.length);
  const unsubscribers = new Array(inputs.length);
  let released = false;
  let releasePromise = null;
  let runPromise = null;
  const closed = () => released || Boolean(isClosed());
  const closeError = () => new Error(closedMessage);

  function settleCleanup(unsubscribe, lease) {
    const cleanup = [];
    if (typeof unsubscribe === "function") cleanup.push(Promise.resolve().then(() => unsubscribe()));
    if (lease && typeof lease.release === "function") cleanup.push(Promise.resolve().then(() => lease.release()));
    return Promise.allSettled(cleanup);
  }

  function cleanupSlot(index) {
    const unsubscribe = unsubscribers[index];
    const lease = leases[index];
    unsubscribers[index] = undefined;
    leases[index] = undefined;
    return settleCleanup(unsubscribe, lease);
  }

  const tasks = inputs.map((input, index) => async () => {
    if (closed()) throw closeError();
    try {
      const lease = await acquire(input);
      if (closed()) {
        await settleCleanup(null, lease);
        throw closeError();
      }
      leases[index] = lease;
      const unsubscribe = lease.subscribe((event) => onEvent(input, event, lease));
      unsubscribers[index] = unsubscribe;
      await onInitial(input, lease);
      if (closed()) throw closeError();
    } catch (error) {
      await cleanupSlot(index);
      if (closed()) throw error;
      await onUnavailable(input, error);
    }
  });

  return {
    run() {
      runPromise ??= runWithConcurrency(tasks, concurrency);
      return runPromise;
    },
    release() {
      released = true;
      releasePromise ??= Promise.all(inputs.map((_, index) => cleanupSlot(index))).then(() => undefined);
      return releasePromise;
    },
  };
}

export const MAP_RESOURCE_PARTITION_CONTENT_TYPE = CONTENT_TYPE;
