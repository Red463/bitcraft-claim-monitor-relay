import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_PAGE_FEATURE_LIMIT = 20_000;
const DEFAULT_PAGE_BYTE_LIMIT = 4 * 1024 * 1024;

export class MapResourcePageError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "MapResourcePageError";
    this.statusCode = statusCode;
  }
}

function decimal(value, label) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new MapResourcePageError(422, `${label} must be a decimal integer`);
  return BigInt(text).toString();
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return number;
}

function resourceKey(regionId, resourceId) {
  return `${regionId}|resource:${resourceId}`;
}

function validateResourceCatalog(resourceIds, allowedResourceIds) {
  if (allowedResourceIds == null) return;
  const allowed = new Set(allowedResourceIds.map((value) => decimal(value, "Available map resource id")));
  if (resourceIds.some((resourceId) => !allowed.has(resourceId))) {
    throw new MapResourcePageError(422, "Map resource id is not in the available catalog");
  }
}

function signature(secret, body) {
  return createHmac("sha256", secret).update(body).digest();
}

export function createMapResourceCursorCodec(secret) {
  const key = Buffer.from(secret ?? []);
  if (!key.byteLength) throw new TypeError("Map resource cursor secret is required");
  return Object.freeze({
    encode({ regionId, resourceId, generation, offset }) {
      const payload = [1, decimal(regionId, "Cursor region id"), decimal(resourceId, "Cursor resource id"), decimal(generation, "Cursor generation"), Number(offset)];
      if (!Number.isSafeInteger(payload[4]) || payload[4] < 0) throw new TypeError("Cursor offset must be a non-negative safe integer");
      const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return `${body}.${signature(key, body).toString("base64url")}`;
    },
    decode(token, expectedScope) {
      try {
        const [body, encodedSignature, extra] = String(token ?? "").split(".");
        if (!body || !encodedSignature || extra != null) throw new Error("shape");
        const actual = Buffer.from(encodedSignature, "base64url");
        const expected = signature(key, body);
        if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) throw new Error("signature");
        const [version, regionId, resourceId, generation, offset] = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (version !== 1 || !Number.isSafeInteger(offset) || offset < 0) throw new Error("payload");
        if (
          decimal(regionId, "Cursor region id") !== decimal(expectedScope.regionId, "Expected cursor region id")
          || decimal(resourceId, "Cursor resource id") !== decimal(expectedScope.resourceId, "Expected cursor resource id")
          || decimal(generation, "Cursor generation") !== decimal(expectedScope.generation, "Expected cursor generation")
        ) throw new Error("scope");
        return { offset };
      } catch {
        throw new MapResourcePageError(422, "Map resource cursor is invalid or stale");
      }
    },
  });
}

export function parseMapResourcePartitionScope(searchParams, { allowedRegionIds = [], allowedResourceIds = null } = {}) {
  const regionId = decimal(searchParams.get("region"), "Map resource region");
  const resourceId = decimal(searchParams.get("resourceId"), "Map resource id");
  const allowed = new Set(allowedRegionIds.map((value) => decimal(value, "Allowed map resource region")));
  if (!allowed.has(regionId)) throw new MapResourcePageError(422, "Map resource region is outside the Relay-ready scope");
  validateResourceCatalog([resourceId], allowedResourceIds);
  const cursor = String(searchParams.get("cursor") ?? "").trim() || null;
  return { regionId, resourceId, cursor };
}

function decimalValues(value, label) {
  const entries = String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) throw new MapResourcePageError(422, `${label} requires at least one decimal integer`);
  return [...new Set(entries.map((entry) => decimal(entry, label)))]
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
}

export function parseMapResourceSelectionScope(searchParams, { allowedRegionIds = [], allowedResourceIds = null, maxResourceIds = 16, maxPartitions = 256 } = {}) {
  const regionIds = decimalValues(searchParams.get("regions"), "Map resource regions");
  const resourceIds = decimalValues(searchParams.get("resourceIds"), "Map resource ids");
  const allowed = new Set(allowedRegionIds.map((value) => decimal(value, "Allowed map resource region")));
  if (regionIds.some((regionId) => !allowed.has(regionId))) {
    throw new MapResourcePageError(422, "Map resource selection includes a region outside the Relay-ready scope");
  }
  const resourceLimit = positiveInteger(maxResourceIds, "Map resource selection type limit");
  if (resourceIds.length > resourceLimit) throw new MapResourcePageError(413, `Map resource ids exceed the limit of ${resourceLimit}`);
  validateResourceCatalog(resourceIds, allowedResourceIds);
  const partitionLimit = positiveInteger(maxPartitions, "Map resource selection partition limit");
  if (regionIds.length * resourceIds.length > partitionLimit) {
    throw new MapResourcePageError(413, `Map resource partition scope exceeds the limit of ${partitionLimit}`);
  }
  return { regionIds, resourceIds };
}

function availability(collection, key) {
  const ready = new Set(collection?.readyKeys ?? []);
  const loading = new Set(collection?.loadingKeys ?? []);
  const unavailable = new Set(collection?.unavailableKeys ?? []);
  const warning = (collection?.warnings ?? []).map(String).find(Boolean) ?? null;
  if (ready.has(key)) {
    const stale = collection?.freshness === "stale";
    return { available: true, status: stale ? "stale" : warning ? "partial" : "live", pending: false, reason: warning };
  }
  if (loading.has(key)) return { available: false, status: "loading", pending: true, reason: "Selected resource positions are loading." };
  if (unavailable.has(key)) return { available: false, status: "unavailable", pending: false, reason: warning ?? "Selected resource positions are unavailable." };
  return { available: false, status: "unavailable", pending: false, reason: warning ?? "Resource partition has no usable generation." };
}

function compactRows(resources, scope) {
  return (Array.isArray(resources) ? resources : []).flatMap((row) => {
    try {
      const entityId = decimal(row?.entityId, "Map resource entity id");
      const regionId = decimal(row?.regionId, "Map resource row region id");
      const resourceId = decimal(row?.resourceId, "Map resource row type id");
      const x = Number(row?.locationX);
      const z = Number(row?.locationZ);
      const dimension = decimal(row?.dimension, "Map resource dimension");
      if (regionId !== scope.regionId || resourceId !== scope.resourceId || dimension !== "1") return [];
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) return [];
      return [[entityId, regionId, resourceId, x, z]];
    } catch {
      return [];
    }
  }).sort((left, right) => left[0].length - right[0].length || left[0].localeCompare(right[0]));
}

export function buildMapResourcePartitionPayload({
  scope,
  resourceCollection,
  cursorCodec,
  pageFeatureLimit = DEFAULT_PAGE_FEATURE_LIMIT,
  pageByteLimit = DEFAULT_PAGE_BYTE_LIMIT,
} = {}) {
  const regionId = decimal(scope?.regionId, "Map resource region id");
  const resourceId = decimal(scope?.resourceId, "Map resource id");
  const generation = decimal(resourceCollection?.generation ?? 0, "Map resource generation");
  const featureLimit = positiveInteger(pageFeatureLimit, "Map resource page feature limit");
  const byteLimit = positiveInteger(pageByteLimit, "Map resource page byte limit");
  const offset = scope?.cursor ? cursorCodec.decode(scope.cursor, { regionId, resourceId, generation }).offset : 0;
  const key = resourceKey(regionId, resourceId);
  const rows = resourceCollection?.compactPartitions?.get?.(key)
    ?? compactRows(resourceCollection?.data?.resources, { regionId, resourceId });
  if (offset > rows.length) throw new MapResourcePageError(422, "Map resource cursor offset is outside the current generation");
  const resources = [];
  let serializedBytes = 2;
  for (let index = offset; index < rows.length && resources.length < featureLimit; index += 1) {
    const rowBytes = Buffer.byteLength(JSON.stringify(rows[index]));
    const nextBytes = serializedBytes + rowBytes + (resources.length ? 1 : 0);
    if (nextBytes > byteLimit) {
      if (!resources.length) throw new MapResourcePageError(413, "One map resource row exceeds the page byte budget");
      break;
    }
    resources.push(rows[index]);
    serializedBytes = nextBytes;
  }
  const nextOffset = offset + resources.length;
  const complete = nextOffset >= rows.length;
  const nextCursor = complete ? null : cursorCodec.encode({ regionId, resourceId, generation, offset: nextOffset });
  const layerAvailability = availability(resourceCollection, resourceKey(regionId, resourceId));
  return {
    provider: "relay",
    generation,
    generatedAt: resourceCollection?.provenance?.receivedAt ?? null,
    freshness: layerAvailability.status,
    warnings: [...new Set((resourceCollection?.warnings ?? []).map(String))],
    partition: { regionId, resourceId },
    resources,
    nextCursor,
    complete,
    layerAvailability,
  };
}
