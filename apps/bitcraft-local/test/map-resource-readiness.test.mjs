import assert from "node:assert/strict";
import test from "node:test";

import { RelayMapResourceReadiness } from "../src/server/game-data/mapResourceReadiness.ts";

const manifest = {
  schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } },
};

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
      schemaFingerprint: "regional-v1",
      ready: true,
    }])),
  };
}

test("web readiness configures every schema-ready resource region without worker jobs", async () => {
  const reconciliations = [];
  const readiness = new RelayMapResourceReadiness({
    manifest,
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
    manifest,
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
    manifest,
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

test("initial discovery failure advertises no unverified regions", async () => {
  const readiness = new RelayMapResourceReadiness({
    manifest,
    discoverTopology: async () => { throw new Error("Relay unavailable"); },
    runtime: { reconcile: async () => {} },
    now: () => 1_000,
  });

  const catalog = await readiness.ensure(input);

  assert.deepEqual(catalog.regionIds, []);
  assert.equal(catalog.freshness, "unavailable");
  assert.match(catalog.warnings.join(" "), /unavailable/i);
});

test("schema-mismatched regions are not advertised or reconciled", async () => {
  const discovered = topology(["3", "19"]);
  discovered.regions.get("3").schemaFingerprint = "unexpected";
  const reconciliations = [];
  const readiness = new RelayMapResourceReadiness({
    manifest,
    discoverTopology: async () => discovered,
    runtime: { reconcile: async (value) => reconciliations.push(value) },
    now: () => 1_000,
  });

  const catalog = await readiness.ensure(input);

  assert.deepEqual(catalog.regionIds, ["19"]);
  assert.deepEqual(reconciliations[0].activeRegionIds, ["19"]);
  assert.match(catalog.warnings.join(" "), /region 3.*fingerprint mismatch/i);
});
