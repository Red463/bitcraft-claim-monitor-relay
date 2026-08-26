import assert from "node:assert/strict";
import test from "node:test";

let publicData = null;
try {
  publicData = await import("../src/server/public/publicData.mjs");
} catch {
  // RED: Task 3 owns this isolated public-data boundary.
}

const normalizers = await import("../src/server/game-data/normalizers.ts");
const { relayTopologyFromPayloads } = await import("../src/server/game-data/topology.ts");

test("public settlement search validates NFKC visible text and canonical unsigned-64 identifiers", () => {
  assert.ok(publicData, "public data module must exist");
  assert.deepEqual(publicData.normalizePublicSearchQuery("  Ｏａｋ  "), { kind: "name", value: "Oak" });
  assert.deepEqual(publicData.normalizePublicSearchQuery("18446744073709551615"), { kind: "id", value: "18446744073709551615" });
  assert.throws(
    () => publicData.normalizePublicSearchQuery("ab"),
    (error) => error instanceof publicData.PublicDataError
      && error.status === 400
      && error.message === "Claim search requires 3-64 visible Unicode characters.",
  );
  for (const invalid of ["ab", "a\nb", "01", "18446744073709551616", "x".repeat(65)]) {
    assert.throws(() => publicData.normalizePublicSearchQuery(invalid), { name: "PublicDataError", status: 400 });
  }
});

test("canonical unsigned-64 conversion rejects unsafe numbers and preserves exact strings and BigInts", () => {
  assert.equal(publicData.canonicalUnsigned64(Number.MAX_SAFE_INTEGER), "9007199254740991");
  assert.equal(publicData.canonicalUnsigned64(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(publicData.canonicalUnsigned64(42.5), null);
  assert.equal(publicData.canonicalUnsigned64(-1), null);
  assert.equal(publicData.canonicalUnsigned64("18446744073709551615"), "18446744073709551615");
  assert.equal(publicData.canonicalUnsigned64(18_446_744_073_709_551_615n), "18446744073709551615");
});

test("public settlement and catalog boundaries reject rounded numeric identifiers", async () => {
  const unsafeId = Number.MAX_SAFE_INTEGER + 1;
  const service = publicData.createPublicDataService({ http: {}, normalizers });
  await assert.rejects(service.snapshot(unsafeId, "claim"), { name: "PublicDataError", status: 400 });

  const catalog = publicData.createPublicCatalogService({
    searchEntities: () => [{ targetId: unsafeId, kind: "items", name: "Rounded" }],
    recipeDetail: () => ({ detail: {} }),
  });
  assert.throws(() => catalog.search("rounded"), { name: "PublicDataError", status: 502 });
  assert.throws(() => catalog.recipe("item", unsafeId), { name: "PublicDataError", status: 400 });
});

test("public response cache singleflights identical work and serves fresh values", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = publicData.createBoundedStaleCache({
    freshMs: 60_000,
    staleMs: 300_000,
    maxEntries: 256,
    maxBytes: 2 * 1024 * 1024,
    now: () => now,
  });
  const load = async () => {
    loads += 1;
    await Promise.resolve();
    return { hints: [{ claimId: "42" }] };
  };

  const [first, joined] = await Promise.all([cache.load("oak", load), cache.load("oak", load)]);
  now += 59_999;
  const fresh = await cache.load("oak", load);

  assert.equal(loads, 1);
  assert.deepEqual(joined, first);
  assert.deepEqual(fresh, { value: { hints: [{ claimId: "42" }] }, stale: false, ageMs: 59_999 });
});

test("public response cache serves stale data only inside stale-if-error window", async () => {
  let now = 0;
  const cache = publicData.createBoundedStaleCache({
    freshMs: 20_000,
    staleMs: 120_000,
    maxEntries: 128,
    maxBytes: 32 * 1024 * 1024,
    maxEntryBytes: 4 * 1024 * 1024,
    now: () => now,
  });
  await cache.load("42:claim", async () => ({ claimId: "42" }));
  now = 20_001;
  const stale = await cache.load("42:claim", async () => { throw new Error("Relay offline"); });
  assert.deepEqual(stale, { value: { claimId: "42" }, stale: true, ageMs: 20_001, error: "Relay offline" });

  now = 120_001;
  await assert.rejects(
    cache.load("42:claim", async () => { throw new Error("Relay offline"); }),
    /Relay offline/,
  );
});

test("public response cache enforces total and per-entry byte caps with LRU eviction", async () => {
  const cache = publicData.createBoundedStaleCache({
    freshMs: 20_000,
    staleMs: 120_000,
    maxEntries: 3,
    maxBytes: 55,
    maxEntryBytes: 40,
  });
  await cache.load("a", async () => ({ value: "a".repeat(10) }));
  await cache.load("b", async () => ({ value: "b".repeat(10) }));
  await cache.load("c", async () => ({ value: "c".repeat(10) }));
  assert.deepEqual(cache.stats(), { entries: 2, bytes: 44, inflight: 0 });
  await assert.rejects(
    cache.load("oversized", async () => ({ value: "x".repeat(50) })),
    { name: "PublicDataError", status: 503 },
  );
  assert.deepEqual(cache.stats(), { entries: 2, bytes: 44, inflight: 0 });
});

test("public Relay gate runs four requests, queues twelve, and rejects excess work", async () => {
  const gate = publicData.createPublicRelayGate({ maxActive: 4, maxQueued: 12 });
  const releases = [];
  let active = 0;
  let peak = 0;
  const work = Array.from({ length: 16 }, (_, index) => gate.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => releases.push(resolve));
    active -= 1;
    return index;
  }));
  await Promise.resolve();
  assert.equal(peak, 4);
  assert.deepEqual(gate.stats(), { active: 4, queued: 12 });
  await assert.rejects(gate.run(async () => 17), { name: "PublicDataError", status: 503, retryAfter: 1 });

  while (releases.length || gate.stats().active || gate.stats().queued) {
    releases.splice(0).forEach((release) => release());
    await Promise.resolve();
    await Promise.resolve();
  }
  assert.deepEqual(await Promise.all(work), Array.from({ length: 16 }, (_, index) => index));
  assert.equal(peak, 4);
});

test("public per-IP limiter enforces burst and sustained settlement budgets lazily", () => {
  let now = 0;
  const limiter = publicData.createPublicIpRateLimiter({ now: () => now });
  for (let window = 0; window < 5; window += 1) {
    for (let index = 0; index < 6; index += 1) assert.equal(limiter.take("203.0.113.1", "search").allowed, true);
    assert.equal(limiter.take("203.0.113.1", "search").allowed, false);
    now += 30_001;
  }
  assert.deepEqual(limiter.take("203.0.113.1", "search"), { allowed: false, retryAfter: 450 });
  assert.equal(limiter.take("203.0.113.2", "search").allowed, true);

  now = 600_001;
  assert.equal(limiter.take("203.0.113.1", "search").allowed, true);

  for (let window = 0; window < 5; window += 1) {
    for (let index = 0; index < 4; index += 1) assert.equal(limiter.take("203.0.113.3", "snapshot").allowed, true);
    now += 30_001;
  }
  assert.equal(limiter.take("203.0.113.3", "snapshot").allowed, false);
});

test("public per-IP limiter bounds unique-key churn and admits new keys after opportunistic expiry pruning", () => {
  let now = 0;
  const limiter = publicData.createPublicIpRateLimiter({ now: () => now, maxBuckets: 3 });
  assert.equal(limiter.take("203.0.113.1", "search").allowed, true);
  assert.equal(limiter.take("203.0.113.2", "snapshot").allowed, true);
  assert.equal(limiter.take("203.0.113.3", "search").allowed, true);

  assert.deepEqual(limiter.take("203.0.113.4", "search"), { allowed: false, retryAfter: 600 });
  assert.equal(limiter.take("203.0.113.1", "search").allowed, true);

  now = 600_001;
  assert.equal(limiter.take("203.0.113.4", "search").allowed, true);
});

test("public settlement service searches names and revalidates exact IDs without repository access", async () => {
  const calls = [];
  const service = publicData.createPublicDataService({
    http: {
      searchClaims: async (query) => {
        calls.push(["search", query]);
        return [
          { claimId: "41", name: "Oak", regionId: "7", ownerName: "Exact" },
          { claimId: "42", name: "Oakland", regionId: "19", ownerName: "Owner" },
        ];
      },
      claim: async (id) => {
        calls.push(["claim", id]);
        return { entity_id: id, name: "Exact ID", region: 19 };
      },
    },
    normalizers,
  });

  const byName = await service.searchSettlements(" oak ");
  const byId = await service.searchSettlements("42");

  assert.deepEqual(byName.hints.map(({ claimId }) => claimId), ["41", "42"]);
  assert.deepEqual(byId.hints, [{ claimId: "42", name: "Exact ID", regionId: "19" }]);
  assert.deepEqual(calls, [["search", "oak"], ["claim", "42"]]);
  assert.equal("configuredClaimId" in byId, false);
});

test("public read limiter exposes sanitized search and snapshot totals and saturation", async () => {
  let now = 0;
  const rateLimiter = publicData.createPublicIpRateLimiter({ now: () => now, maxBuckets: 2 });
  const router = publicData.createPublicApiRouter({
    data: { searchSettlements: async () => ({ hints: [] }), snapshot: async () => ({ claimId: "42" }) },
    catalog: { search: () => ({}), recipe: () => ({}) },
    serveIcon: async () => false,
    rateLimiter,
  });
  const response = () => ({ writeHead() {}, end() {} });
  await router({ method: "GET", url: new URL("https://claim-monitor.com/api/public/settlements/search?q=oak"), res: response(), address: "one" });
  await router({ method: "GET", url: new URL("https://claim-monitor.com/api/public/settlements/42"), res: response(), address: "two" });
  await router({ method: "GET", url: new URL("https://claim-monitor.com/api/public/settlements/search?q=oak"), res: response(), address: "three" });

  assert.deepEqual(router.health(), {
    capacity: 2,
    buckets: 2,
    saturated: true,
    totals: { accepted: 2, rejected: 1 },
    byKind: { search: { accepted: 1, rejected: 1 }, snapshot: { accepted: 1, rejected: 0 } },
  });
  now = 600_001;
  await router({ method: "GET", url: new URL("https://claim-monitor.com/api/public/settlements/search?q=oak"), res: response(), address: "three" });
  assert.equal(router.health().saturated, false);
});

test("public settlement search classifies malformed Relay JSON as malformed data", async () => {
  const malformed = Object.assign(new Error("Unexpected token at https://relay.secret/api?token=hidden"), {
    name: "RelayHttpMalformedResponseError",
    code: "RELAY_MALFORMED_JSON",
    status: 502,
  });
  const service = publicData.createPublicDataService({
    http: { searchClaims: async () => { throw malformed; } },
    normalizers,
  });

  await assert.rejects(service.searchSettlements("oak"), {
    name: "PublicDataError",
    status: 502,
    message: "Relay claim search response is malformed.",
  });
});

test("public settlement search uses a fixed stale warning without exception details", async () => {
  let now = 0;
  let calls = 0;
  const service = publicData.createPublicDataService({
    http: {
      searchClaims: async () => {
        calls += 1;
        if (calls === 1) return [{ entity_id: "42", name: "Oak", region: 19 }];
        throw new Error("GET https://relay.secret/claim?token=hidden failed");
      },
    },
    normalizers,
    now: () => now,
  });
  await service.searchSettlements("oak");
  now = 60_001;

  const stale = await service.searchSettlements("oak");
  assert.deepEqual(stale.warnings, [{
    code: "relay_search_stale",
    message: "Claim search results are stale while Relay recovers.",
  }]);
  assert.doesNotMatch(JSON.stringify(stale), /relay\.secret|token|hidden|GET/);
});

test("public exact-ID search classifies malformed Relay JSON as malformed data", async () => {
  const malformed = Object.assign(new Error("Unexpected token in private Relay response"), {
    code: "RELAY_MALFORMED_JSON",
    status: 502,
  });
  const service = publicData.createPublicDataService({
    http: { claim: async () => { throw malformed; } },
    normalizers,
  });

  await assert.rejects(service.searchSettlements("42"), {
    name: "PublicDataError",
    status: 502,
    message: "Relay claim response is malformed.",
  });
});

test("public settlement snapshot validates topology, coalesces roster reads, and preserves typed decimal identities", async () => {
  const claimId = "18446744073709551615";
  let rosterReads = 0;
  let domainActive = 0;
  let domainPeak = 0;
  const domain = async (value) => {
    domainActive += 1;
    domainPeak = Math.max(domainPeak, domainActive);
    await Promise.resolve();
    domainActive -= 1;
    return value;
  };
  const claim = { entity_id: claimId, name: "Decimal Haven", region: 19, tier: 7 };
  const service = publicData.createPublicDataService({
    http: {
      claim: async () => claim,
      health: async () => ({
        sources: { "bitcraft-live-19": { database: "bitcraft-live-19", port: 3019, schema_cached: true, connectivity: "live", tables_live: 274, tables_total: 274 } },
      }),
      cacheHealth: async () => ({ ready: true, regions: [{ region: 19, ready: true }] }),
      members: async () => {
        rosterReads += 1;
        return domain({ claim, members: [{
          entity_id: "9007199254740994",
          claim_entity_id: claimId,
          player_entity_id: "9007199254740993",
          user_name: "A",
          hexcoins: "9007199254740995",
          skills: { 2: 51 },
        }], skill_names: { 2: "Forestry" } });
      },
      inventory: async () => domain({ claim, dimensions: [{ dimension_id: "9007199254740996", kind: "overworld", buildings: [{
        entity_id: "9007199254740997", name: "Chest", items: [
          { item_id: 42, item_type: "Item", quantity: "9007199254740998" },
          { item_id: 42, item_type: "Cargo", quantity: "9007199254740999" },
        ],
      }] }] }),
      crafts: async (_id, completed) => domain({ claim, crafts: [{
        entity_id: completed ? "12" : "11",
        building_entity_id: "10",
        claim_entity_id: claimId,
        owner_entity_id: "9",
        completed,
        craft_count: "1",
        progress: "1",
        recipe_id: completed ? "8" : "7",
        total_actions_required: "2",
        crafted_item: [{ item_id: 42, item_type: completed ? "Cargo" : "Item", quantity: "3" }],
      }] }),
    },
    normalizers,
    topologyFromPayloads: relayTopologyFromPayloads,
  });

  const snapshot = await service.snapshot(claimId, "claim,members,citizens,inventories,crafts");
  assert.equal(rosterReads, 1);
  assert.equal(domainPeak, 2);
  assert.equal(snapshot.claimId, claimId);
  assert.equal(snapshot.domains.members.data[0].playerEntityId, "9007199254740993");
  assert.equal(snapshot.domains.members.data[0].hexcoins, "9007199254740995");
  assert.deepEqual(snapshot.domains.inventories.data.buildings[0].items.map(({ itemId, itemType, quantity, catalogKey }) => ({ itemId, itemType, quantity, catalogKey })), [
    { itemId: "42", itemType: "item", quantity: "9007199254740998", catalogKey: "items:42" },
    { itemId: "42", itemType: "cargo", quantity: "9007199254740999", catalogKey: "cargo:42" },
  ]);
  assert.deepEqual(snapshot.domains.crafts.data.craftResults.map(({ entityId, craftedItem }) => [entityId, craftedItem[0].catalogKey]), [["11", "items:42"], ["12", "cargo:42"]]);
});

test("public settlement snapshot classifies malformed required Relay JSON as malformed data", async () => {
  const malformed = Object.assign(new Error("Malformed body from https://relay.secret/config"), {
    code: "RELAY_MALFORMED_JSON",
    status: 502,
  });
  const service = publicData.createPublicDataService({
    http: {
      claim: async () => { throw malformed; },
      health: async () => ({}),
      cacheHealth: async () => ({}),
    },
    normalizers,
    topologyFromPayloads: relayTopologyFromPayloads,
  });

  await assert.rejects(service.snapshot("42", "claim"), {
    name: "PublicDataError",
    status: 502,
    message: "Relay required snapshot data is malformed.",
  });
});

test("public settlement snapshot uses a fixed stale warning without exception details", async () => {
  let now = 0;
  let claimCalls = 0;
  const claim = { entity_id: "42", name: "Oak", region: 19 };
  const service = publicData.createPublicDataService({
    http: {
      claim: async () => {
        claimCalls += 1;
        if (claimCalls === 1) return claim;
        throw new Error("Authorization failed at https://relay.secret/config?password=hidden");
      },
      health: async () => ({ sources: {
        "bitcraft-live-19": { database: "bitcraft-live-19", port: 3019, schema_cached: true, connectivity: "live", tables_live: 274, tables_total: 274 },
      } }),
      cacheHealth: async () => ({ ready: true, regions: [{ region: 19, ready: true }] }),
    },
    normalizers,
    topologyFromPayloads: relayTopologyFromPayloads,
    now: () => now,
  });
  await service.snapshot("42", "claim");
  now = 20_001;

  const stale = await service.snapshot("42", "claim");
  assert.deepEqual(stale.warnings, [{
    code: "relay_snapshot_stale",
    message: "Claim snapshot data is stale while Relay recovers.",
  }]);
  assert.doesNotMatch(JSON.stringify(stale), /relay\.secret|config|password|hidden|Authorization/);
});

test("public settlement snapshot marks malformed optional Relay JSON with a fixed domain warning", async () => {
  const claim = { entity_id: "42", name: "Oak", region: 19 };
  const malformed = Object.assign(new Error("Unexpected token from https://relay.secret/members?apiKey=hidden"), {
    code: "RELAY_MALFORMED_JSON",
    status: 502,
  });
  const service = publicData.createPublicDataService({
    http: {
      claim: async () => claim,
      health: async () => ({ sources: {
        "bitcraft-live-19": { database: "bitcraft-live-19", port: 3019, schema_cached: true, connectivity: "live", tables_live: 274, tables_total: 274 },
      } }),
      cacheHealth: async () => ({ ready: true, regions: [{ region: 19, ready: true }] }),
      members: async () => { throw malformed; },
    },
    normalizers,
    topologyFromPayloads: relayTopologyFromPayloads,
  });

  const snapshot = await service.snapshot("42", "members,citizens");
  const warning = {
    code: "relay_roster_malformed",
    message: "Roster data is unavailable because Relay returned malformed data.",
  };
  assert.deepEqual(snapshot.domains.members, { data: null, warnings: [warning] });
  assert.deepEqual(snapshot.domains.citizens, { data: null, warnings: [warning] });
  assert.deepEqual(snapshot.warnings, []);
  assert.doesNotMatch(JSON.stringify(snapshot), /relay\.secret|apiKey|hidden|Unexpected token/);
});

test("public settlement snapshot uses fixed domain warnings for unavailable optional sources", async () => {
  const claim = { entity_id: "42", name: "Oak", region: 19 };
  const unavailable = () => { throw new Error("Bearer secret-token failed at https://relay.secret/private"); };
  const service = publicData.createPublicDataService({
    http: {
      claim: async () => claim,
      health: async () => ({ sources: {
        "bitcraft-live-19": { database: "bitcraft-live-19", port: 3019, schema_cached: true, connectivity: "live", tables_live: 274, tables_total: 274 },
      } }),
      cacheHealth: async () => ({ ready: true, regions: [{ region: 19, ready: true }] }),
      members: async () => unavailable(),
      inventory: async () => unavailable(),
      crafts: async () => unavailable(),
    },
    normalizers,
    topologyFromPayloads: relayTopologyFromPayloads,
  });

  const snapshot = await service.snapshot("42", "members,citizens,inventories,crafts");
  assert.deepEqual(snapshot.domains.members, { data: null, warnings: [{
    code: "relay_roster_unavailable",
    message: "Roster data is temporarily unavailable.",
  }] });
  assert.deepEqual(snapshot.domains.citizens, snapshot.domains.members);
  assert.deepEqual(snapshot.domains.inventories, { data: null, warnings: [{
    code: "relay_inventories_unavailable",
    message: "Inventory data is temporarily unavailable.",
  }] });
  assert.deepEqual(snapshot.domains.crafts, { data: null, warnings: [{
    code: "relay_crafts_unavailable",
    message: "Craft data is temporarily unavailable.",
  }] });
  assert.deepEqual(snapshot.warnings, []);
  assert.doesNotMatch(JSON.stringify(snapshot), /relay\.secret|secret-token|Bearer|private/);
});

test("public settlement snapshot distinguishes malformed inventory and craft domains", async () => {
  const claim = { entity_id: "42", name: "Oak", region: 19 };
  const malformed = () => {
    throw Object.assign(new Error("Malformed https://relay.secret/domain?token=hidden"), {
      code: "RELAY_MALFORMED_JSON",
      status: 502,
    });
  };
  const service = publicData.createPublicDataService({
    http: {
      claim: async () => claim,
      health: async () => ({ sources: {
        "bitcraft-live-19": { database: "bitcraft-live-19", port: 3019, schema_cached: true, connectivity: "live", tables_live: 274, tables_total: 274 },
      } }),
      cacheHealth: async () => ({ ready: true, regions: [{ region: 19, ready: true }] }),
      inventory: async () => malformed(),
      crafts: async () => malformed(),
    },
    normalizers,
    topologyFromPayloads: relayTopologyFromPayloads,
  });

  const snapshot = await service.snapshot("42", "inventories,crafts");
  assert.deepEqual(snapshot.domains.inventories, { data: null, warnings: [{
    code: "relay_inventories_malformed",
    message: "Inventory data is unavailable because Relay returned malformed data.",
  }] });
  assert.deepEqual(snapshot.domains.crafts, { data: null, warnings: [{
    code: "relay_crafts_malformed",
    message: "Craft data is unavailable because Relay returned malformed data.",
  }] });
  assert.doesNotMatch(JSON.stringify(snapshot), /relay\.secret|token|hidden|Malformed/);
});

test("public settlement snapshot marks a malformed craft projection without discarding the valid projection", async () => {
  const claim = { entity_id: "42", name: "Oak", region: 19 };
  let craftCalls = 0;
  const service = publicData.createPublicDataService({
    http: {
      claim: async () => claim,
      health: async () => ({ sources: {
        "bitcraft-live-19": { database: "bitcraft-live-19", port: 3019, schema_cached: true, connectivity: "live", tables_live: 274, tables_total: 274 },
      } }),
      cacheHealth: async () => ({ ready: true, regions: [{ region: 19, ready: true }] }),
      crafts: async () => {
        craftCalls += 1;
        if (craftCalls === 1) return { claim, crafts: [] };
        throw Object.assign(new Error("private endpoint malformed"), { code: "RELAY_MALFORMED_JSON", status: 502 });
      },
    },
    normalizers,
    topologyFromPayloads: relayTopologyFromPayloads,
  });

  const snapshot = await service.snapshot("42", "crafts");
  assert.deepEqual(snapshot.domains.crafts.data.craftResults, []);
  assert.deepEqual(snapshot.domains.crafts.warnings, [{
    code: "relay_crafts_partial_malformed",
    message: "One craft projection is unavailable because Relay returned malformed data.",
  }]);
  assert.doesNotMatch(JSON.stringify(snapshot), /private endpoint/);
});

test("public catalog wrapper exposes typed display fields and strips upstream metadata from recipe detail", () => {
  const catalog = publicData.createPublicCatalogService({
    searchEntities: () => [{
      targetId: "42", kind: "items", itemType: 0, name: "Oak Log", tag: "wood", tier: 2,
      rarity: "Common", iconAssetName: "Items/Oak", upstreamUrl: "https://secret.example",
    }],
    recipeDetail: (target) => ({
      detail: {
        item: {
          id: target.id, name: "Oak Log", iconAssetName: "Items/Oak",
          sourceUrl: "https://secret.example", authHeader: "Bearer hidden", privateMetadata: "hidden",
        },
        craftingRecipes: [{
          id: "7", name: "Saw Oak", actionsRequired: 2,
          craftedItemStacks: [{ item_id: "42", item_type: "item", quantity: 1, endpoint: "https://secret.example" }],
          endpoint: "https://secret.example/recipe", errorDetails: "token hidden",
        }],
        internalCatalogState: { password: "hidden" },
      },
      provider: "relay",
      upstreamOrigin: "https://secret.example",
      endpoint: "https://secret.example/private",
      headers: { authorization: "Bearer hidden" },
      password: "hidden",
      apiKey: "hidden",
      errorDetails: "private failure",
      diagnostic: "internal-only",
    }),
  });

  assert.deepEqual(catalog.search(" oak "), {
    query: "oak",
    items: [{ id: "42", kind: "items", itemType: 0, name: "Oak Log", tag: "wood", tier: 2, rarityStr: "Common", iconAssetName: "Items/Oak", catalogKey: "items:42" }],
    cargos: [],
  });
  assert.deepEqual(catalog.recipe("item", "42"), {
    detail: {
      item: { id: "42", name: "Oak Log", iconAssetName: "Items/Oak" },
      craftingRecipes: [{
        id: "7", name: "Saw Oak", actionsRequired: 2,
        craftedItemStacks: [{ item_id: "42", item_type: "item", quantity: 1 }],
      }],
    },
    provider: "relay",
  });
  assert.throws(() => catalog.recipe("items", "42"), { name: "PublicDataError", status: 400 });
});

test("public snapshot rejects mismatched embedded craft claim metadata even when craft rows are empty", async () => {
  const service = publicData.createPublicDataService({
    http: {
      claim: async () => ({ entity_id: "42", name: "Oak", region: 19 }),
      health: async () => ({ sources: {
        "bitcraft-live-19": { database: "bitcraft-live-19", port: 3019, schema_cached: true, connectivity: "live", tables_live: 274, tables_total: 274 },
      } }),
      cacheHealth: async () => ({ ready: true, regions: [{ region: 19, ready: true }] }),
      crafts: async () => ({ claim: { entity_id: "43", name: "Foreign", region: 19 }, crafts: [] }),
    },
    normalizers,
    topologyFromPayloads: relayTopologyFromPayloads,
  });

  await assert.rejects(service.snapshot("42", "crafts"), { name: "PublicDataError", status: 502 });
});
