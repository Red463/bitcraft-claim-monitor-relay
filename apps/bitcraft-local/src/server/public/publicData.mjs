import { sendJson } from "../httpResponses.mjs";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const PUBLIC_WARNING_MESSAGES = Object.freeze({
  relay_search_stale: "Claim search results are stale while Relay recovers.",
  relay_snapshot_stale: "Claim snapshot data is stale while Relay recovers.",
  relay_roster_malformed: "Roster data is unavailable because Relay returned malformed data.",
  relay_roster_unavailable: "Roster data is temporarily unavailable.",
  relay_inventories_malformed: "Inventory data is unavailable because Relay returned malformed data.",
  relay_inventories_unavailable: "Inventory data is temporarily unavailable.",
  relay_crafts_malformed: "Craft data is unavailable because Relay returned malformed data.",
  relay_crafts_unavailable: "Craft data is temporarily unavailable.",
  relay_crafts_partial_malformed: "One craft projection is unavailable because Relay returned malformed data.",
  relay_crafts_partial: "One craft projection is temporarily unavailable.",
});

function publicWarning(code) {
  return { code, message: PUBLIC_WARNING_MESSAGES[code] };
}

export class PublicDataError extends Error {
  constructor(message, status, options = {}) {
    super(message, options);
    this.name = "PublicDataError";
    this.status = status;
    this.retryAfter = options.retryAfter ?? null;
  }
}

export function canonicalUnsigned64(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "bigint") {
    return value >= 0n && value <= UINT64_MAX ? value.toString() : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)$/.test(text)) return null;
  try {
    return BigInt(text) <= UINT64_MAX ? text : null;
  } catch {
    return null;
  }
}

export function normalizePublicSearchQuery(value) {
  const normalized = String(value ?? "").normalize("NFKC").trim();
  if (/^\d+$/.test(normalized)) {
    const id = canonicalUnsigned64(normalized);
    if (!id) throw new PublicDataError("Claim ID must be a canonical unsigned 64-bit decimal string.", 400);
    return { kind: "id", value: id };
  }
  const length = [...normalized].length;
  if (length < 3 || length > 64 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized)) {
    throw new PublicDataError("Claim search requires 3-64 visible Unicode characters.", 400);
  }
  return { kind: "name", value: normalized };
}

function wireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicDataError(`${label} is malformed.`, 502);
  }
  return value;
}

export function createBoundedStaleCache({ freshMs, staleMs, maxEntries, maxBytes, maxEntryBytes = maxBytes, now = Date.now, canServeStale = () => true }) {
  const entries = new Map();
  const inflight = new Map();
  let totalBytes = 0;

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  async function load(key, loader) {
    const cached = entries.get(key);
    const at = now();
    if (cached && at - cached.storedAt < freshMs) {
      touch(key, cached);
      return { value: cached.value, stale: false, ageMs: at - cached.storedAt };
    }
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      try {
        const value = await loader();
        const bytes = Buffer.byteLength(JSON.stringify(value));
        if (bytes > maxEntryBytes) throw new PublicDataError("Public Relay response exceeds the allowed byte limit.", 503, { retryAfter: 1 });
        if (bytes <= maxBytes) {
          const previous = entries.get(key);
          if (previous) totalBytes -= previous.bytes;
          const entry = { value, bytes, storedAt: now() };
          touch(key, entry);
          totalBytes += bytes;
          while (entries.size > maxEntries || totalBytes > maxBytes) {
            const oldestKey = entries.keys().next().value;
            const oldest = entries.get(oldestKey);
            entries.delete(oldestKey);
            totalBytes -= oldest.bytes;
          }
        }
        return { value, stale: false, ageMs: 0 };
      } catch (error) {
        const ageMs = cached ? now() - cached.storedAt : Number.POSITIVE_INFINITY;
        if (cached && ageMs <= staleMs && canServeStale(error)) {
          touch(key, cached);
          return {
            value: cached.value,
            stale: true,
            ageMs,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        throw error;
      }
    })();
    inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    load,
    stats: () => ({ entries: entries.size, bytes: totalBytes, inflight: inflight.size }),
  };
}

export function createPublicRelayGate({ maxActive = 4, maxQueued = 12 } = {}) {
  let active = 0;
  const queued = [];

  function start(entry) {
    active += 1;
    Promise.resolve().then(entry.work).then(entry.resolve, entry.reject).finally(() => {
      active -= 1;
      const next = queued.shift();
      if (next) start(next);
    });
  }

  function run(work) {
    if (active >= maxActive && queued.length >= maxQueued) {
      return Promise.reject(new PublicDataError("Public Relay request queue is full.", 503, { retryAfter: 1 }));
    }
    return new Promise((resolve, reject) => {
      const entry = { work, resolve, reject };
      if (active < maxActive) start(entry);
      else queued.push(entry);
    });
  }

  return { run, stats: () => ({ active, queued: queued.length }) };
}

const PUBLIC_IP_LIMITS = Object.freeze({
  search: { burst: 6, burstMs: 30_000, sustained: 30, sustainedMs: 600_000 },
  snapshot: { burst: 4, burstMs: 30_000, sustained: 20, sustainedMs: 600_000 },
});

export function createPublicIpRateLimiter({ now = Date.now, maxBuckets = 4096 } = {}) {
  const buckets = new Map();
  const bucketCapacity = Number.isInteger(maxBuckets) && maxBuckets > 0 ? maxBuckets : 4096;
  let operations = 0;
  const totals = { accepted: 0, rejected: 0 };
  const byKind = {
    search: { accepted: 0, rejected: 0 },
    snapshot: { accepted: 0, rejected: 0 },
  };

  function expireBucket(bucket, at) {
    const policy = PUBLIC_IP_LIMITS[bucket.kind];
    while (bucket.timestamps.length && bucket.timestamps[0] <= at - policy.sustainedMs) bucket.timestamps.shift();
  }

  function pruneExpired(at) {
    for (const [key, bucket] of buckets) {
      expireBucket(bucket, at);
      if (!bucket.timestamps.length) buckets.delete(key);
    }
  }

  function capacityRetryAfter(at) {
    let earliestExpiry = Number.POSITIVE_INFINITY;
    for (const bucket of buckets.values()) {
      const policy = PUBLIC_IP_LIMITS[bucket.kind];
      earliestExpiry = Math.min(earliestExpiry, bucket.timestamps[0] + policy.sustainedMs);
    }
    return Math.max(1, Math.ceil((earliestExpiry - at) / 1000));
  }

  function take(ip, kind) {
    const policy = PUBLIC_IP_LIMITS[kind];
    if (!policy) throw new TypeError(`Unknown public rate-limit kind ${kind}`);
    const at = now();
    const key = `${kind}:${String(ip)}`;
    operations += 1;
    if (operations % 64 === 0) pruneExpired(at);
    let bucket = buckets.get(key);
    if (!bucket && buckets.size >= bucketCapacity) {
      pruneExpired(at);
      if (buckets.size >= bucketCapacity) {
        totals.rejected += 1;
        byKind[kind].rejected += 1;
        return { allowed: false, retryAfter: capacityRetryAfter(at) };
      }
    }
    bucket ??= { kind, timestamps: [] };
    expireBucket(bucket, at);
    const burst = bucket.timestamps.filter((entry) => entry > at - policy.burstMs);
    if (burst.length >= policy.burst || bucket.timestamps.length >= policy.sustained) {
      const waits = [];
      if (burst.length >= policy.burst) waits.push(burst[0] + policy.burstMs - at);
      if (bucket.timestamps.length >= policy.sustained) waits.push(bucket.timestamps[0] + policy.sustainedMs - at);
      buckets.set(key, bucket);
      totals.rejected += 1;
      byKind[kind].rejected += 1;
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(Math.max(...waits) / 1000)) };
    }
    bucket.timestamps.push(at);
    buckets.set(key, bucket);
    totals.accepted += 1;
    byKind[kind].accepted += 1;
    return { allowed: true, retryAfter: 0 };
  }
  function stats() {
    pruneExpired(now());
    return {
      capacity: bucketCapacity,
      buckets: buckets.size,
      saturated: buckets.size >= bucketCapacity,
      totals: { ...totals },
      byKind: { search: { ...byKind.search }, snapshot: { ...byKind.snapshot } },
    };
  }
  return { take, stats };
}

function relayStatus(error) {
  const status = Number(error?.status);
  return Number.isInteger(status) ? status : null;
}

function isMalformedRelayError(error) {
  return error?.code === "RELAY_MALFORMED_JSON" || error?.code === "RELAY_MALFORMED_SETTLEMENT_HINTS";
}

function unavailableRelayError(error) {
  return new PublicDataError("Public Relay data is temporarily unavailable.", 503, {
    cause: error,
    retryAfter: 1,
  });
}

function exactClaimHint(value, expectedId, normalizers) {
  let claim;
  try {
    claim = normalizers.normalizeClaimPayload(value).data;
  } catch (error) {
    throw new PublicDataError("Relay claim response is malformed.", 502, { cause: error });
  }
  if (claim.entityId !== expectedId) {
    throw new PublicDataError("Relay claim identity does not match the requested claim.", 502);
  }
  return {
    claimId: claim.entityId,
    name: claim.name,
    regionId: claim.regionId,
    ...(Number.isInteger(claim.tier) ? { tier: claim.tier } : {}),
  };
}

const PUBLIC_SNAPSHOT_DOMAINS = Object.freeze(["claim", "members", "citizens", "inventories", "crafts"]);

export function parsePublicSnapshotDomains(value) {
  const requested = String(value ?? "").trim()
    ? String(value).split(",").map((entry) => entry.trim()).filter(Boolean)
    : PUBLIC_SNAPSHOT_DOMAINS;
  const unique = [...new Set(requested)];
  if (!unique.length || unique.some((domain) => !PUBLIC_SNAPSHOT_DOMAINS.includes(domain))) {
    throw new PublicDataError("Snapshot domains must contain only claim, members, citizens, inventories, or crafts.", 400);
  }
  return unique.sort((left, right) => PUBLIC_SNAPSHOT_DOMAINS.indexOf(left) - PUBLIC_SNAPSHOT_DOMAINS.indexOf(right));
}

async function concurrentMapLimit(values, limit, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
  return results;
}

export function createPublicDataService({ http, normalizers, topologyFromPayloads, now = Date.now, gate = createPublicRelayGate() }) {
  if (!http || !normalizers) throw new TypeError("Public data service requires Relay HTTP and normalizers.");
  const searchCache = createBoundedStaleCache({
    freshMs: 60_000,
    staleMs: 300_000,
    maxEntries: 256,
    maxBytes: 2 * 1024 * 1024,
    now,
    canServeStale: (error) => error?.status === 503 || !(error instanceof PublicDataError),
  });
  const snapshotCache = createBoundedStaleCache({
    freshMs: 20_000,
    staleMs: 120_000,
    maxEntries: 128,
    maxBytes: 32 * 1024 * 1024,
    maxEntryBytes: 4 * 1024 * 1024,
    now,
    canServeStale: (error) => error?.status === 503 || !(error instanceof PublicDataError),
  });
  let topologyCache = null;

  async function topology() {
    if (topologyCache && (!topologyCache.settled || topologyCache.expiresAt > now())) return topologyCache.promise;
    const entry = { promise: null, settled: false, expiresAt: Number.POSITIVE_INFINITY };
    entry.promise = Promise.all([
      gate.run(() => http.health()),
      gate.run(() => http.cacheHealth()),
    ]).then(([health, cache]) => {
      if (typeof topologyFromPayloads !== "function") throw new TypeError("Public topology normalizer is unavailable.");
      return topologyFromPayloads(health, cache, new Date(now()).toISOString());
    });
    topologyCache = entry;
    void entry.promise.then(() => {
      entry.settled = true;
      entry.expiresAt = now() + 60_000;
    }, () => {
      if (topologyCache === entry) topologyCache = null;
    });
    return entry.promise;
  }

  async function searchSettlements(input) {
    const query = normalizePublicSearchQuery(input);
    const result = await searchCache.load(`${query.kind}:${query.value.toLocaleLowerCase()}`, async () => {
      if (query.kind === "id") {
        try {
          const wire = await gate.run(() => http.claim(query.value));
          return { query: query.value, hints: [exactClaimHint(wire, query.value, normalizers)] };
        } catch (error) {
          if (error instanceof PublicDataError) throw error;
          if (relayStatus(error) === 404) throw new PublicDataError("Claim was not found.", 404, { cause: error });
          if (isMalformedRelayError(error)) {
            throw new PublicDataError("Relay claim response is malformed.", 502, { cause: error });
          }
          throw unavailableRelayError(error);
        }
      }
      try {
        const wire = await gate.run(() => http.searchClaims(query.value));
        if (!Array.isArray(wire)) throw new PublicDataError("Relay claim search response is malformed.", 502);
        return { query: query.value, hints: wire.slice(0, 20) };
      } catch (error) {
        if (error instanceof PublicDataError) throw error;
        if (isMalformedRelayError(error)) {
          throw new PublicDataError("Relay claim search response is malformed.", 502, { cause: error });
        }
        throw unavailableRelayError(error);
      }
    });
    return {
      ...result.value,
      stale: result.stale,
      ageMs: result.ageMs,
      warnings: result.stale ? [publicWarning("relay_search_stale")] : [],
    };
  }

  function domainEnvelope(data, warnings = []) {
    return { data, warnings };
  }

  function mismatch(message) {
    throw new PublicDataError(message, 502);
  }

  function addTypedCatalogKey(stack) {
    return {
      ...stack,
      catalogKey: `${stack.itemType === "cargo" ? "cargo" : "items"}:${stack.itemId}`,
    };
  }

  function verifyEmbeddedClaim(value, label, claimId, regionId) {
    const payload = wireRecord(value, label);
    let embedded;
    try {
      embedded = normalizers.normalizeClaimPayload(payload.claim).data;
    } catch (error) {
      throw new PublicDataError(`${label} claim metadata is malformed.`, 502, { cause: error });
    }
    if (embedded.entityId !== claimId || embedded.regionId !== regionId) {
      mismatch(`${label} claim identity or region does not match the requested claim.`);
    }
  }

  async function loadSnapshot(claimId, requested) {
    let claimWire;
    let relayTopology;
    try {
      [claimWire, relayTopology] = await Promise.all([
        gate.run(() => http.claim(claimId)),
        topology(),
      ]);
    } catch (error) {
      if (error instanceof PublicDataError) throw error;
      if (relayStatus(error) === 404) throw new PublicDataError("Claim was not found.", 404, { cause: error });
      if (isMalformedRelayError(error)) {
        throw new PublicDataError("Relay required snapshot data is malformed.", 502, { cause: error });
      }
      throw unavailableRelayError(error);
    }

    let normalizedClaim;
    try {
      normalizedClaim = normalizers.normalizeClaimPayload(claimWire);
    } catch (error) {
      throw new PublicDataError("Relay claim response is malformed.", 502, { cause: error });
    }
    if (normalizedClaim.data.entityId !== claimId) mismatch("Relay claim identity does not match the requested claim.");
    const regionId = normalizedClaim.data.regionId;
    if (!relayTopology?.cacheReady || !relayTopology.regions?.get(regionId)?.ready) {
      throw new PublicDataError(`Claim region ${regionId} is unavailable from Relay.`, 503, { retryAfter: 1 });
    }

    const output = {};
    const warnings = [];
    if (requested.includes("claim")) output.claim = domainEnvelope(normalizedClaim.data, normalizedClaim.warnings);
    const needsRoster = requested.includes("members") || requested.includes("citizens");
    const reads = [];
    if (needsRoster) reads.push({ key: "roster", load: () => http.members(claimId) });
    if (requested.includes("inventories")) reads.push({ key: "inventories", load: () => http.inventory(claimId) });
    if (requested.includes("crafts")) {
      reads.push({ key: "crafts-current", load: () => http.crafts(claimId, false) });
      reads.push({ key: "crafts-completed", load: () => http.crafts(claimId, true) });
    }
    const results = await concurrentMapLimit(reads, 2, async ({ key, load }) => {
      try {
        return { key, value: await gate.run(load) };
      } catch (error) {
        return { key, error };
      }
    });
    const byKey = new Map(results.map((result) => [result.key, result]));

    if (needsRoster) {
      const result = byKey.get("roster");
      if (result?.error && isMalformedRelayError(result.error)) {
        const domainWarning = publicWarning("relay_roster_malformed");
        if (requested.includes("members")) output.members = domainEnvelope(null, [domainWarning]);
        if (requested.includes("citizens")) output.citizens = domainEnvelope(null, [domainWarning]);
      } else if (result?.error) {
        const domainWarning = publicWarning("relay_roster_unavailable");
        if (requested.includes("members")) output.members = domainEnvelope(null, [domainWarning]);
        if (requested.includes("citizens")) output.citizens = domainEnvelope(null, [domainWarning]);
      }
      else {
        try {
          verifyEmbeddedClaim(result.value, "Relay roster", claimId, regionId);
          const members = normalizers.normalizeMembersPayload(result.value);
          if (members.data.some((member) => member.claimEntityId !== claimId)) mismatch("Relay roster contains a member from another claim.");
          if (requested.includes("members")) output.members = domainEnvelope(members.data, members.warnings);
          if (requested.includes("citizens")) {
            const citizens = normalizers.normalizeCitizensPayload(result.value);
            output.citizens = domainEnvelope(citizens.data, citizens.warnings);
          }
        } catch (error) {
          if (error instanceof PublicDataError) throw error;
          throw new PublicDataError("Relay roster response is malformed.", 502, { cause: error });
        }
      }
    }

    if (requested.includes("inventories")) {
      const result = byKey.get("inventories");
      if (result?.error) {
        output.inventories = domainEnvelope(null, [publicWarning(
          isMalformedRelayError(result.error) ? "relay_inventories_malformed" : "relay_inventories_unavailable",
        )]);
      }
      else {
        try {
          const inventories = normalizers.normalizeClaimInventory(result.value);
          if (inventories.claim.entityId !== claimId || inventories.claim.regionId !== regionId) mismatch("Relay inventory claim identity or region does not match the requested claim.");
          for (const building of inventories.buildings) {
            building.items = building.items.map(addTypedCatalogKey);
            building.inventory = building.items.map((contents) => ({ contents }));
          }
          output.inventories = domainEnvelope(inventories);
        } catch (error) {
          if (error instanceof PublicDataError) throw error;
          throw new PublicDataError("Relay inventory response is malformed.", 502, { cause: error });
        }
      }
    }

    if (requested.includes("crafts")) {
      const craftResults = [byKey.get("crafts-current"), byKey.get("crafts-completed")];
      const successful = craftResults.filter((result) => result && !result.error).map((result) => result.value);
      const craftErrors = craftResults.filter((result) => result?.error).map((result) => result.error);
      if (successful.length) {
        try {
          for (const value of successful) verifyEmbeddedClaim(value, "Relay crafts", claimId, regionId);
          const crafts = normalizers.normalizeClaimCraftPayloads(successful);
          if (crafts.craftResults.some((craft) => craft.claimEntityId !== claimId)) mismatch("Relay crafts contain work from another claim.");
          crafts.craftResults = crafts.craftResults.map((craft) => ({
            ...craft,
            craftedItem: craft.craftedItem.map(addTypedCatalogKey),
          }));
          output.crafts = domainEnvelope(crafts, successful.length === 2 ? [] : [publicWarning(
            craftErrors.some(isMalformedRelayError) ? "relay_crafts_partial_malformed" : "relay_crafts_partial",
          )]);
        } catch (error) {
          if (error instanceof PublicDataError) throw error;
          throw new PublicDataError("Relay crafts response is malformed.", 502, { cause: error });
        }
      } else {
        output.crafts = domainEnvelope(null, [publicWarning(
          craftErrors.some(isMalformedRelayError) ? "relay_crafts_malformed" : "relay_crafts_unavailable",
        )]);
      }
    }

    return {
      claimId,
      regionId,
      receivedAt: new Date(now()).toISOString(),
      domains: output,
      warnings,
    };
  }

  async function snapshot(claimIdValue, domainsValue) {
    const claimId = canonicalUnsigned64(claimIdValue);
    if (!claimId || String(claimIdValue) !== claimId) throw new PublicDataError("Claim ID must be a canonical unsigned 64-bit decimal string.", 400);
    const domains = parsePublicSnapshotDomains(domainsValue);
    const result = await snapshotCache.load(`${claimId}:${domains.join(",")}`, () => loadSnapshot(claimId, domains));
    return {
      ...result.value,
      stale: result.stale,
      ageMs: result.ageMs,
      warnings: [
        ...result.value.warnings,
        ...(result.stale ? [publicWarning("relay_snapshot_stale")] : []),
      ],
    };
  }

  return {
    searchSettlements,
    snapshot,
    health: () => ({ searchCache: searchCache.stats(), snapshotCache: snapshotCache.stats(), relayGate: gate.stats() }),
  };
}

const PUBLIC_RECIPE_FIELDS = new Set([
  "item", "cargo", "craftingRecipes", "extractionRecipes",
  "id", "kind", "itemType", "name", "tag", "tier", "rarity", "rarityStr", "iconAssetName",
  "recipeKey", "catalogRecipeKey", "activityKind", "actionsRequired", "buildingName", "skillName",
  "isPassive", "isExpectedYield", "isProbabilistic", "probabilityStatus", "routeType", "gatheringSkill",
  "expectedYield", "expectedPerProgress", "expectedPerResource", "resourceHealth", "dropChance", "dropQuantity",
  "guaranteedYield", "outputQuantity", "craftedItemStacks", "consumedItemStacks", "craftedItems", "consumedItems",
  "item_id", "item_type", "quantity", "guaranteedQuantity", "quantityMin", "quantityMax",
  "levelRequirements", "toolRequirements", "experiencePerProgress", "skill", "level", "tool", "amount",
  "sourceOutputKey", "sourceOutput", "producer", "producerRecipe", "gatheringSource", "label",
]);

function allowlistedRecipeValue(value) {
  if (Array.isArray(value)) return value.map(allowlistedRecipeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => PUBLIC_RECIPE_FIELDS.has(key))
    .map(([key, child]) => [key, allowlistedRecipeValue(child)]));
}

function publicRecipeProjection(value) {
  const source = wireRecord(value, "Catalog recipe response");
  const detail = wireRecord(source.detail, "Catalog recipe detail");
  return { detail: allowlistedRecipeValue(detail), provider: "relay" };
}

export function createPublicCatalogService({ searchEntities, recipeDetail }) {
  if (typeof searchEntities !== "function" || typeof recipeDetail !== "function") {
    throw new TypeError("Public catalog service requires safe catalog readers.");
  }
  function search(input) {
    const query = String(input ?? "").normalize("NFKC").trim();
    if ([...query].length < 2 || [...query].length > 64 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(query)) {
      throw new PublicDataError("Catalog search requires 2-64 visible Unicode characters.", 400);
    }
    const rows = searchEntities(query, 20);
    if (!Array.isArray(rows)) throw new PublicDataError("Public catalog search is malformed.", 502);
    const items = [];
    const cargos = [];
    for (const row of rows.slice(0, 20)) {
      const id = canonicalUnsigned64(row?.targetId);
      const kind = row?.kind === "cargo" ? "cargo" : row?.kind === "items" ? "items" : null;
      if (!id || !kind) throw new PublicDataError("Public catalog search row is malformed.", 502);
      const item = {
        id,
        kind,
        itemType: kind === "cargo" ? 1 : 0,
        name: String(row.name ?? ""),
        tag: row.tag,
        tier: row.tier,
        rarityStr: row.rarity,
        iconAssetName: row.iconAssetName,
        catalogKey: `${kind}:${id}`,
      };
      (kind === "cargo" ? cargos : items).push(item);
    }
    return { query, items, cargos };
  }
  function recipe(kindValue, idValue) {
    const kind = String(kindValue ?? "");
    const id = canonicalUnsigned64(idValue);
    if ((kind !== "item" && kind !== "cargo") || !id || String(idValue) !== id) {
      throw new PublicDataError("Recipe kind must be item or cargo and id must be canonical decimal.", 400);
    }
    try {
      return publicRecipeProjection(recipeDetail({ id, kind: kind === "cargo" ? "cargo" : "items", itemType: kind === "cargo" ? 1 : 0 }));
    } catch (error) {
      if (error instanceof PublicDataError) throw error;
      const status = error?.statusCode === 404 ? 404 : 503;
      throw new PublicDataError(status === 404 ? "Catalog recipe was not found." : "Catalog recipe is temporarily unavailable.", status, {
        cause: error,
        retryAfter: status === 503 ? 1 : null,
      });
    }
  }
  return { search, recipe };
}

function publicErrorBody(error) {
  if (error.status === 400) return { error: error.message };
  if (error.status === 404) return { error: "Public resource was not found." };
  if (error.status === 429) return { error: "Public request limit reached." };
  if (error.status === 502) return { error: "Relay returned malformed public data." };
  return { error: "Public data is temporarily unavailable." };
}

export function createPublicApiRouter({ data, catalog, serveIcon, rateLimiter = createPublicIpRateLimiter() }) {
  function requireRate(address, kind) {
    const decision = rateLimiter.take(address, kind);
    if (!decision.allowed) throw new PublicDataError("Public request limit reached.", 429, { retryAfter: decision.retryAfter });
  }
  const route = async function route({ method, url, res, address = "unknown" }) {
    if (method !== "GET") return false;
    const { pathname, searchParams } = url;
    try {
      if (pathname === "/api/public/settlements/search") {
        requireRate(address, "search");
        sendJson(res, 200, await data.searchSettlements(searchParams.get("q") ?? ""));
        return true;
      }
      const settlement = pathname.match(/^\/api\/public\/settlements\/([^/]+)$/);
      if (settlement) {
        requireRate(address, "snapshot");
        sendJson(res, 200, await data.snapshot(settlement[1], searchParams.get("domains")));
        return true;
      }
      if (pathname === "/api/public/catalog/search") {
        sendJson(res, 200, catalog.search(searchParams.get("q") ?? ""));
        return true;
      }
      if (pathname === "/api/public/catalog/recipe-detail") {
        sendJson(res, 200, catalog.recipe(searchParams.get("kind"), searchParams.get("id")));
        return true;
      }
      if (pathname.startsWith("/api/public/game-icon/")) {
        await serveIcon(pathname, res);
        return true;
      }
      return false;
    } catch (error) {
      const mapped = error instanceof PublicDataError ? error : new PublicDataError("Public data is temporarily unavailable.", 503, { cause: error, retryAfter: 1 });
      const headers = mapped.retryAfter ? { "retry-after": String(mapped.retryAfter) } : {};
      sendJson(res, mapped.status, publicErrorBody(mapped), headers);
      return true;
    }
  };
  route.health = () => rateLimiter.stats();
  return route;
}
