import assert from "node:assert/strict";
import test from "node:test";

let activeRegionsModule = null;
try {
  activeRegionsModule = await import("../src/server/relayActiveRegions.mjs");
} catch {
  // The first TDD run proves the provider-owned active-region view is absent.
}

test("active-region view is limited to configured Relay scope and preserves live population", () => {
  assert.ok(activeRegionsModule, "Relay active-region view must exist");
  const result = activeRegionsModule.relayActiveRegions({
    claimRegionId: "19",
    defaultRegionId: "19",
    additionalRegionIds: ["24"],
    requestedIncludeRegionIds: ["99"],
    regionSnapshot: {
      data: {
        regions: [{
          regionId: "19",
          regionName: "Zephra",
          active: true,
          syncing: false,
          allowPlayerSpawns: true,
          signedInPlayers: 42,
          playersInQueue: 3,
        }],
      },
      provenance: {
        receivedAt: "2026-07-30T11:59:59.000Z",
      },
      warnings: [],
    },
    providerHealth: {
      lastRefreshAt: "2026-07-30T11:59:59.500Z",
      lastError: null,
      sources: {
        "region:19": { ready: true },
        "region:24": { ready: false },
        "region:99": { ready: true },
      },
    },
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
  });

  assert.deepEqual(result.regions, [{
    regionId: "19",
    regionName: "Zephra",
    active: true,
    syncing: false,
    allowPlayerSpawns: true,
    signedInPlayers: 42,
    playersInQueue: 3,
    relayReady: true,
    updatedAt: "2026-07-30T11:59:59.000Z",
    source: "claim",
    freshness: "live",
    warnings: [],
  }, {
    regionId: "24",
    regionName: "Region 24",
    active: null,
    syncing: null,
    allowPlayerSpawns: null,
    signedInPlayers: null,
    playersInQueue: null,
    relayReady: false,
    updatedAt: "2026-07-30T11:59:59.000Z",
    source: "admin",
    freshness: "unavailable",
    warnings: ["Relay region 24 is not ready."],
  }]);
  assert.deepEqual(result.overrideRegionIds, ["24"]);
  assert.equal(result.freshness, "partial");
  assert.equal(result.generatedAt, "2026-07-30T11:59:59.000Z");
});

test("active-region view returns configured scope immediately before population loads", () => {
  const result = activeRegionsModule.relayActiveRegions({
    defaultRegionId: "19",
    additionalRegionIds: [],
    regionSnapshot: null,
    providerHealth: null,
  });
  assert.deepEqual(result.regions.map((region) => region.regionId), ["19"]);
  assert.equal(result.regions[0].freshness, "unavailable");
  assert.equal(result.freshness, "unavailable");
});

test("active-region view excludes closed event regions from configured scope", () => {
  const result = activeRegionsModule.relayActiveRegions({
    claimRegionId: "19",
    defaultRegionId: "3",
    additionalRegionIds: ["7", "11", "15", "23"],
    regionSnapshot: null,
    providerHealth: null,
  });

  assert.deepEqual(result.configuredRegionIds, ["7", "19"]);
  assert.deepEqual(result.overrideRegionIds, ["7"]);
  assert.deepEqual(result.regions.map((region) => region.regionId), ["7", "19"]);
});

test("connected global subscription keeps unchanged region rows live", () => {
  const result = activeRegionsModule.relayActiveRegions({
    defaultRegionId: "19",
    regionSnapshot: {
      data: {
        regions: [{
          regionId: "19",
          regionName: "Zephra",
          active: true,
          syncing: false,
          signedInPlayers: 0,
          playersInQueue: 0,
        }],
      },
      provenance: { receivedAt: "2026-07-30T10:00:00.000Z" },
      warnings: [],
    },
    providerHealth: {
      lastError: null,
      sources: { "region:19": { ready: true } },
      globalCatalog: {
        subscription: {
          connected: true,
          applied: true,
          lastError: null,
        },
      },
    },
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
  });
  assert.equal(result.regions[0].freshness, "live");
  assert.deepEqual(result.regions[0].warnings, []);
});

test("disconnected global subscription exposes region rows as stale last-good", () => {
  const result = activeRegionsModule.relayActiveRegions({
    defaultRegionId: "19",
    regionSnapshot: {
      data: {
        regions: [{
          regionId: "19",
          regionName: "Zephra",
          active: true,
          syncing: false,
          signedInPlayers: 12,
          playersInQueue: 0,
        }],
      },
      provenance: { receivedAt: "2026-07-30T11:59:59.000Z" },
      warnings: [],
    },
    providerHealth: {
      lastError: null,
      sources: { "region:19": { ready: true } },
      globalCatalog: {
        subscription: {
          connected: false,
          applied: true,
          lastError: "socket closed",
        },
      },
    },
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(result.regions[0].freshness, "stale");
  assert.equal(result.freshness, "stale");
  assert.match(result.regions[0].warnings.join(" "), /socket closed/);
});

test("unrelated Relay HTTP errors do not downgrade healthy global region metadata", () => {
  const result = activeRegionsModule.relayActiveRegions({
    defaultRegionId: "19",
    regionSnapshot: {
      data: {
        regions: [{
          regionId: "19",
          regionName: "Zephra",
          active: true,
          syncing: false,
          signedInPlayers: 12,
          playersInQueue: 0,
        }],
      },
      provenance: { receivedAt: "2026-07-30T11:59:59.000Z" },
      warnings: [],
    },
    providerHealth: {
      lastError: "deposits endpoint failed",
      sources: { "region:19": { ready: true } },
      globalCatalog: {
        subscription: {
          connected: true,
          applied: true,
          lastError: null,
        },
      },
    },
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(result.freshness, "live");
  assert.deepEqual(result.warnings, []);
});
