import assert from "node:assert/strict";
import test from "node:test";

const { createRelayTopologyDiscoveryCache, discoverRelayTopology, discoverRelayTopologyWithClient } = await import(
  new URL("../src/server/game-data/topology.ts", import.meta.url).href,
);
const { RelayHttpClient } = await import(
  new URL("../src/server/game-data/http.ts", import.meta.url).href,
);

test("topology discovery derives global and regional databases without fixed ports or names", async () => {
  const responses = new Map([
    ["https://relay.example/health", {
      schema_count: 2,
      sources: {
        global: {
          database: "dynamic-global-db",
          port: 4000,
          schema_cached: true,
          metrics: {
            initial_subscribe_complete: true,
            publisher: { fingerprint: "global-fingerprint" },
            upstream: { state: "up" },
          },
        },
        "unexpected-source-key": {
          database: "dynamic-region-db",
          port: 4919,
          schema_cached: true,
          metrics: {
            mirror_database: "dynamic-region-db",
            upstream_database: "bitcraft-live-19",
            initial_subscribe_complete: true,
            publisher: { fingerprint: "region-fingerprint" },
            upstream: { state: "up" },
          },
        },
      },
    }],
    ["https://relay.example/cache-health", {
      ready: true,
      regions: [{ region: 19, ready: true }],
    }],
  ]);
  const fetcher = async (input) => {
    const body = responses.get(String(input));
    return body
      ? new Response(JSON.stringify(body), { status: 200 })
      : new Response("missing", { status: 404 });
  };

  const topology = await discoverRelayTopology("https://relay.example", fetcher);

  assert.equal(topology.cacheReady, true);
  assert.deepEqual(topology.global, {
    sourceKey: "global",
    database: "dynamic-global-db",
    port: 4000,
    schemaFingerprint: "global-fingerprint",
    ready: true,
  });
  assert.deepEqual(topology.regions.get("19"), {
    sourceKey: "region:19",
    database: "dynamic-region-db",
    port: 4919,
    schemaFingerprint: "region-fingerprint",
    ready: true,
  });
});

test("shared topology discovery normalizes trailing slashes, singleflights, and caches successes for sixty seconds", async () => {
  let now = 1_000;
  let calls = 0;
  let finishFirst;
  const firstDiscovery = new Promise((resolve) => { finishFirst = resolve; });
  const cachedDiscover = createRelayTopologyDiscoveryCache({
    discover: async (baseUrl) => {
      calls += 1;
      if (calls === 1) return firstDiscovery;
      return { baseUrl, call: calls };
    },
    now: () => now,
  });

  const withoutSlash = cachedDiscover("https://relay.example");
  const withSlash = cachedDiscover("https://relay.example/");
  assert.equal(calls, 1);
  const first = { baseUrl: "https://relay.example", call: 1 };
  finishFirst(first);
  assert.equal(await withoutSlash, first);
  assert.equal(await withSlash, first);

  now = 60_999;
  assert.equal(await cachedDiscover("https://relay.example///"), first);
  assert.equal(calls, 1);

  now = 61_000;
  assert.deepEqual(await cachedDiscover("https://relay.example/"), {
    baseUrl: "https://relay.example",
    call: 2,
  });
  assert.equal(calls, 2);
});

test("shared topology discovery evicts failures immediately", async () => {
  let calls = 0;
  const cachedDiscover = createRelayTopologyDiscoveryCache({
    discover: async () => {
      calls += 1;
      if (calls === 1) throw new Error("Relay discovery failed");
      return { call: calls };
    },
  });

  await assert.rejects(cachedDiscover("https://relay.example/"), /Relay discovery failed/);
  assert.deepEqual(await cachedDiscover("https://relay.example"), { call: 2 });
  assert.equal(calls, 2);
});

test("topology discovery supports current live-source health and fingerprints public schemas", async () => {
  let now = 0;
  const discoveryOptions = {
    now: () => now,
    schemaFingerprintCacheMs: 45_000,
  };
  const globalSchema = JSON.stringify({ tables: [{ name: "item_desc" }] });
  const regionalSchema = JSON.stringify({ tables: [{ name: "claim_state" }] });
  const responses = new Map([
    ["https://relay.example/health", {
      schema_count: 2,
      sources: {
        global: {
          connectivity: "live",
          connected_since: "2026-07-31T04:01:14.396Z",
          database: "bitcraft-live-global",
          port: 3000,
          schema_cached: true,
          tables_live: 281,
          tables_total: 281,
        },
        "unexpected-live-source-key": {
          connectivity: "live",
          connected_since: "2026-07-31T04:05:40.436Z",
          database: "bitcraft-live-19",
          port: 3019,
          schema_cached: true,
          tables_live: 274,
          tables_total: 274,
        },
        "unrelated-live-source": {
          connectivity: "live",
          connected_since: "2026-07-31T04:05:40.436Z",
          database: "unrelated-live-database",
          port: 3999,
          schema_cached: true,
          tables_live: 1,
          tables_total: 1,
        },
      },
    }],
    ["https://relay.example/cache-health", {
      ready: true,
      regions: [{ region: 19, ready: true }],
    }],
    ["https://relay.example:3000/v1/database/bitcraft-live-global/schema?version=9", globalSchema],
    ["https://relay.example:3019/v1/database/bitcraft-live-19/schema?version=9", regionalSchema],
  ]);
  const requested = [];
  const fetcher = async (input) => {
    requested.push(String(input));
    const body = responses.get(String(input));
    return body == null
      ? new Response("missing", { status: 404 })
      : new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  };

  const topology = await discoverRelayTopology(
    "https://relay.example",
    fetcher,
    discoveryOptions,
  );

  assert.deepEqual(topology.global, {
    sourceKey: "global",
    database: "bitcraft-live-global",
    port: 3000,
    schemaFingerprint: "5cb5c6aca97912b63f2b58a7b6e94360a16b479bbdf174f8409786cdd9a68e92",
    ready: true,
  });
  assert.deepEqual(topology.regions.get("19"), {
    sourceKey: "region:19",
    database: "bitcraft-live-19",
    port: 3019,
    schemaFingerprint: "b54d38f391895e0e1c8cabfe3ffd44e633725e52a48037f9901787321190633f",
    ready: true,
  });
  await discoverRelayTopology("https://relay.example", fetcher, discoveryOptions);
  assert.equal(requested.filter((url) => url.includes("/schema?version=9")).length, 2);
  await Promise.all([
    discoverRelayTopology("https://relay.example", fetcher, discoveryOptions),
    discoverRelayTopology("https://relay.example", fetcher, discoveryOptions),
  ]);
  assert.equal(requested.filter((url) => url.includes("/schema?version=9")).length, 2);
  now = 45_000;
  await discoverRelayTopology("https://relay.example", fetcher, discoveryOptions);
  assert.equal(requested.filter((url) => url.includes("/schema?version=9")).length, 4);
});

test("topology discovery can fingerprint only the source required by a runtime", async () => {
  const requested = [];
  const fetcher = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/health")) {
      return new Response(JSON.stringify({
        sources: {
          global: {
            connectivity: "live",
            connected_since: "global-1",
            database: "bitcraft-live-global",
            port: 3000,
            schema_cached: true,
            tables_live: 281,
            tables_total: 281,
          },
          region19: {
            connectivity: "live",
            connected_since: "region-1",
            database: "bitcraft-live-19",
            port: 3019,
            schema_cached: true,
            tables_live: 274,
            tables_total: 274,
          },
        },
      }), { status: 200 });
    }
    if (url.endsWith("/cache-health")) {
      return new Response(JSON.stringify({
        ready: true,
        regions: [{ region: 19, ready: true }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ tables: [] }), { status: 200 });
  };

  const topology = await discoverRelayTopology("https://relay-filter.example", fetcher, {
    sourceKeys: new Set(["global"]),
  });

  assert.ok(topology.global?.schemaFingerprint);
  assert.equal(topology.regions.get("19")?.schemaFingerprint, null);
  assert.deepEqual(
    requested.filter((url) => url.includes("/schema?version=9")),
    ["https://relay-filter.example:3000/v1/database/bitcraft-live-global/schema?version=9"],
  );
});

test("topology discovery leaves a live source fingerprint unavailable when schema retrieval fails", async () => {
  let schemaRequests = 0;
  const fetcher = async (input) => {
    if (String(input).endsWith("/health")) {
      return new Response(JSON.stringify({
        sources: {
          global: {
            connectivity: "live",
            database: "bitcraft-live-global",
            port: 3000,
            schema_cached: true,
            tables_live: 281,
            tables_total: 281,
          },
        },
      }), { status: 200 });
    }
    if (String(input).endsWith("/cache-health")) {
      return new Response(JSON.stringify({ ready: true, regions: [] }), { status: 200 });
    }
    schemaRequests += 1;
    return new Response("schema unavailable", { status: 404 });
  };

  const topology = await discoverRelayTopology("https://relay.example", fetcher);

  assert.equal(topology.global?.ready, true);
  assert.equal(topology.global?.schemaFingerprint, null);
  assert.equal(schemaRequests, 1);
});

test("topology discovery can retain one HTTP circuit across refreshes", async () => {
  let requests = 0;
  const client = new RelayHttpClient({
    baseUrl: "https://relay.example",
    fetcher: async () => {
      requests += 1;
      throw new TypeError("network unavailable");
    },
    retryDelayMs: 0,
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(
      discoverRelayTopologyWithClient("https://relay.example", client, fetch),
      /network unavailable/,
    );
  }
  const requestsBeforeOpenCheck = requests;
  await assert.rejects(
    discoverRelayTopologyWithClient("https://relay.example", client, fetch),
    /circuit is open/i,
  );
  assert.equal(requests, requestsBeforeOpenCheck);
});

test("Relay HTTP retries one transient response but never retries a permanent 4xx", async () => {
  const calls = [];
  const transientClient = new RelayHttpClient({
    baseUrl: "https://relay.example",
    fetcher: async (input) => {
      calls.push(String(input));
      return calls.length === 1
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify({ entity_id: "1369094286777412590" }), { status: 200 });
    },
    retryDelayMs: 0,
  });

  assert.deepEqual(await transientClient.claim("1369094286777412590"), {
    entity_id: "1369094286777412590",
  });
  assert.equal(calls.length, 2);

  let permanentCalls = 0;
  const permanentClient = new RelayHttpClient({
    baseUrl: "https://relay.example",
    fetcher: async () => {
      permanentCalls += 1;
      return new Response("not found", { status: 404 });
    },
    retryDelayMs: 0,
  });
  await assert.rejects(permanentClient.members("1369094286777412590"), /HTTP 404/);
  assert.equal(permanentCalls, 1);
});

test("Relay HTTP requests bounded player detail, inventory, and housing by encoded player ID", async () => {
  const requested = [];
  const client = new RelayHttpClient({
    baseUrl: "https://relay.example",
    fetcher: async (input) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ player: {}, inventories: [] }), { status: 200 });
    },
    retryDelayMs: 0,
  });

  await client.player("101/with separator");
  await client.playerInventory("101/with separator");
  await client.playerHousing("101/with separator");
  assert.deepEqual(requested, [
    "https://relay.example/player/101%2Fwith%20separator",
    "https://relay.example/player/101%2Fwith%20separator/inventory",
    "https://relay.example/player/101%2Fwith%20separator/housing",
  ]);
});

test("Relay HTTP requests bounded storage history for one regional container", async () => {
  const requested = [];
  const client = new RelayHttpClient({
    baseUrl: "https://relay.example",
    fetcher: async (input) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ count: 0, logs: [] }), { status: 200 });
    },
    retryDelayMs: 0,
  });

  await client.storageLogs({
    storageId: "1369094286778488967",
    regionId: "19",
    limit: 5000,
  });
  assert.deepEqual(requested, [
    "https://relay.example/storage-logs?storageId=1369094286778488967&region=19&limit=5000",
  ]);
});

test("Relay HTTP opens its circuit after five failures in one minute", async () => {
  let calls = 0;
  const client = new RelayHttpClient({
    baseUrl: "https://relay.example",
    fetcher: async () => {
      calls += 1;
      throw new TypeError("network unavailable");
    },
    retryDelayMs: 0,
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(client.claim("1369094286777412590"), /network unavailable/);
  }
  await assert.rejects(client.claim("1369094286777412590"), /circuit is open/i);
  assert.equal(calls, 10);
});
