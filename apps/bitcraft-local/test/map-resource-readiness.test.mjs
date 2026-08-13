import assert from "node:assert/strict";
import test from "node:test";

import { RelayMapResourceReadiness } from "../src/server/game-data/mapResourceReadiness.ts";

const input = {
  relayBaseUrl: "https://relay.example/",
  primaryRegionId: "19",
  configuredRegionIds: ["24", "3", "19"],
};

function topology(regionIds = ["3", "19"]) {
  return {
    discoveredAt: "2026-08-13T10:00:00.000Z",
    cacheReady: true,
    global: null,
    regions: new Map(regionIds.map((regionId) => [regionId, {
      sourceKey: `region:${regionId}`,
      database: `relay-region-${regionId}`,
      port: 4000 + Number(regionId),
      schemaFingerprint: `schema-${regionId}`,
      ready: true,
    }])),
  };
}

test("web readiness configures every schema-ready resource region without worker jobs", async () => {
  const reconciliations = [];
  const readiness = new RelayMapResourceReadiness({
    discoverTopology: async () => topology(),
    runtime: { reconcile: async (value) => reconciliations.push(value) },
    now: () => 1_000,
  });

  const catalog = await readiness.ensure(input);

  assert.deepEqual(catalog.regionIds, ["3", "19"]);
  assert.equal(catalog.freshness, "live");
  assert.deepEqual(reconciliations, [{
    relayBaseUrl: "https://relay.example",
    primaryRegionId: "19",
    activeRegionIds: ["3", "19"],
  }]);
});

test("concurrent readiness callers share one topology discovery and reconciliation", async () => {
  let discoveryCalls = 0;
  let releaseDiscovery;
  const discovery = new Promise((resolve) => { releaseDiscovery = () => resolve(topology()); });
  const reconciliations = [];
  const readiness = new RelayMapResourceReadiness({
    discoverTopology: async () => { discoveryCalls += 1; return discovery; },
    runtime: { reconcile: async (value) => reconciliations.push(value) },
    now: () => 1_000,
  });

  const first = readiness.ensure(input);
  const second = readiness.ensure({ ...input, configuredRegionIds: ["019", "3", "24"] });
  releaseDiscovery();
  const [left, right] = await Promise.all([first, second]);

  assert.equal(discoveryCalls, 1);
  assert.equal(reconciliations.length, 1);
  assert.equal(left, right);
});

test("expired discovery failure returns stale last-good regions instead of emptying the catalog", async () => {
  let now = 1_000;
  let shouldFail = false;
  const readiness = new RelayMapResourceReadiness({
    discoverTopology: async () => {
      if (shouldFail) throw new Error("Relay health timed out");
      return topology(["19", "24"]);
    },
    runtime: { reconcile: async () => {} },
    now: () => now,
    ttlMs: 60_000,
  });
  await readiness.ensure(input);
  now += 60_001;
  shouldFail = true;

  const degraded = await readiness.ensure(input);

  assert.deepEqual(degraded.regionIds, ["19", "24"]);
  assert.equal(degraded.freshness, "stale");
  assert.match(degraded.warnings.join(" "), /timed out/i);
  assert.equal(readiness.catalog(), degraded);
});

test("initial discovery failure exposes only configured fallback regions as stale", async () => {
  const readiness = new RelayMapResourceReadiness({
    discoverTopology: async () => { throw new Error("Relay unavailable"); },
    runtime: { reconcile: async () => {} },
    now: () => 1_000,
  });

  const catalog = await readiness.ensure(input);

  assert.deepEqual(catalog.regionIds, ["3", "19", "24"]);
  assert.equal(catalog.freshness, "stale");
  assert.match(catalog.warnings.join(" "), /unavailable/i);
});
