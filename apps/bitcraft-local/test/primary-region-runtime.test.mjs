import assert from "node:assert/strict";
import test from "node:test";

let runtimeModule = null;
try {
  runtimeModule = await import("../src/server/game-data/primaryRegionRuntime.ts");
} catch {
  // The first TDD run proves the primary-region coordinator is absent.
}

function topology() {
  return {
    cacheReady: true,
    global: null,
    regions: new Map([["19", {
      sourceKey: "region:19",
      database: "relay-region-19",
      port: 4019,
      schemaFingerprint: "regional-v1",
      ready: true,
    }]]),
    discoveredAt: "2026-07-29T20:40:00.000Z",
  };
}

test("primary-region runtime publishes players and restarts only when membership changes", async () => {
  assert.ok(runtimeModule, "primary-region runtime module must exist");
  const starts = [];
  const stops = [];
  const writes = [];
  const handlers = [];
  const presenceBaseUrls = [];
  const presenceRequests = [];
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => topology(),
    createSession: (options) => {
      handlers.push(options.onSnapshot);
      const index = handlers.length;
      return {
        start: async (config) => starts.push(config),
        stop: async () => stops.push(index),
        health: () => ({ connected: true, applied: true, lastAppliedAt: null, lastError: null }),
      };
    },
    createPresenceService: (baseUrl) => {
      presenceBaseUrls.push(baseUrl);
      return {
        enrich: async (players) => players.map((player) => {
          presenceRequests.push(player.playerEntityId);
          return player.presenceSource === "unavailable"
            ? { ...player, signedIn: false, presenceRegionId: "14", presenceSource: "relay-player" }
            : player;
        }),
      };
    },
    currentStateRepository: {
      nextGeneration: () => 12,
      commitGeneration: (batch) => writes.push(batch),
    },
  });
  const members = [{ playerEntityId: "101", userName: "Ada" }];

  await runtime.start({
    relayBaseUrl: "https://relay.example/",
    claimId: "1369094286777412590",
    regionId: "19",
    members,
  });
  assert.equal(starts.length, 1);
  assert.deepEqual(presenceBaseUrls, ["https://relay.example"]);
  assert.deepEqual(starts[0], {
    uri: "wss://relay.example:4019",
    database: "relay-region-19",
    schemaFingerprint: "regional-v1",
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    generation: 1,
    regionId: "19",
    claimId: "1369094286777412590",
    members,
  });

  await handlers[0]({
    players: [{
      playerEntityId: "101",
      username: "Ada",
      signedIn: null,
      presenceRegionId: null,
      presenceSource: "unavailable",
    }],
    warnings: [],
    equipment: { members: [{ playerEntityId: "101", username: "Ada" }] },
    equipmentWarnings: [],
    construction: {
      projects: [{
        entityId: "9001",
        constructionRecipeId: "3023",
        ownerId: "1369094286777412590",
        items: [],
        cargos: [],
      }],
      buildings: [{
        entityId: "7001",
        claimEntityId: "1369094286777412590",
        directionIndex: 2,
        buildingDescriptionId: "6020",
        constructedByPlayerEntityId: "101",
      }],
    },
    constructionWarnings: [],
    research: {
      claimId: "1369094286777412590",
      learnedTechIds: ["1", "200"],
      researchingTechId: null,
      researchStartedAt: null,
      scheduledId: null,
    },
    researchWarnings: [],
    recruitment: {
      claimId: "1369094286777412590",
      isRecruiting: true,
      recruitment: [{
        entityId: "1369094286821318198",
        claimEntityId: "1369094286777412590",
        remainingStock: "19",
        requiredSkillId: "1",
        requiredSkillLevel: "1",
        requiredApproval: false,
        isRecruiting: true,
      }],
    },
    recruitmentWarnings: [],
    bankInventories: {
      buildings: [{
        entityId: "8001",
        buildingEntityId: "7002",
        playerOwnerEntityId: "101",
        name: "Town Bank — Ada",
        inventory: [],
      }],
    },
    bankInventoryWarnings: [],
    settlementInventories: {
      buildings: [{
        entityId: "7001",
        inventoryEntityId: "8101",
        buildingDescriptionId: "6020",
        items: [{ itemId: "42", itemType: "item", quantity: "11" }],
        inventory: [],
      }],
    },
    settlementInventoryWarnings: [],
    contributionWarnings: ["Relay craft 9002 has invalid experience per progress"],
    database: "relay-region-19",
    regionId: "19",
    schemaFingerprint: "regional-v1",
    generation: 1,
    receivedAt: "2026-07-29T20:41:00.000Z",
  });
  assert.deepEqual(writes[0], {
    claimId: "1369094286777412590",
    generation: 12,
    domains: {
      players: {
        data: [{
          playerEntityId: "101",
          username: "Ada",
          signedIn: false,
          presenceRegionId: "14",
          presenceSource: "relay-player",
        }],
        confidence: "authoritative",
        provenance: {
          provider: "relay",
          sourceKey: "region:19",
          regionId: "19",
          database: "relay-region-19",
          schemaFingerprint: "regional-v1",
          sourceObservedAt: null,
          receivedAt: "2026-07-29T20:41:00.000Z",
        },
        warnings: [],
      },
      equipment: {
        data: { members: [{ playerEntityId: "101", username: "Ada" }] },
        confidence: "authoritative",
        provenance: {
          provider: "relay",
          sourceKey: "region:19",
          regionId: "19",
          database: "relay-region-19",
          schemaFingerprint: "regional-v1",
          sourceObservedAt: null,
          receivedAt: "2026-07-29T20:41:00.000Z",
        },
        warnings: [],
      },
      construction: {
        data: {
          projects: [{
            entityId: "9001",
            constructionRecipeId: "3023",
            ownerId: "1369094286777412590",
            items: [],
            cargos: [],
          }],
          buildings: [{
            entityId: "7001",
            claimEntityId: "1369094286777412590",
            directionIndex: 2,
            buildingDescriptionId: "6020",
            constructedByPlayerEntityId: "101",
          }],
        },
        confidence: "authoritative",
        provenance: {
          provider: "relay",
          sourceKey: "region:19",
          regionId: "19",
          database: "relay-region-19",
          schemaFingerprint: "regional-v1",
          sourceObservedAt: null,
          receivedAt: "2026-07-29T20:41:00.000Z",
        },
        warnings: [],
      },
      research: {
        data: {
          claimId: "1369094286777412590",
          learnedTechIds: ["1", "200"],
          researchingTechId: null,
          researchStartedAt: null,
          scheduledId: null,
        },
        confidence: "authoritative",
        provenance: {
          provider: "relay",
          sourceKey: "region:19",
          regionId: "19",
          database: "relay-region-19",
          schemaFingerprint: "regional-v1",
          sourceObservedAt: null,
          receivedAt: "2026-07-29T20:41:00.000Z",
        },
        warnings: [],
      },
      recruitment: {
        data: {
          claimId: "1369094286777412590",
          isRecruiting: true,
          recruitment: [{
            entityId: "1369094286821318198",
            claimEntityId: "1369094286777412590",
            remainingStock: "19",
            requiredSkillId: "1",
            requiredSkillLevel: "1",
            requiredApproval: false,
            isRecruiting: true,
          }],
        },
        confidence: "authoritative",
        provenance: {
          provider: "relay",
          sourceKey: "region:19",
          regionId: "19",
          database: "relay-region-19",
          schemaFingerprint: "regional-v1",
          sourceObservedAt: null,
          receivedAt: "2026-07-29T20:41:00.000Z",
        },
        warnings: [],
      },
      "inventory-banks": {
        data: {
          buildings: [{
            entityId: "8001",
            buildingEntityId: "7002",
            playerOwnerEntityId: "101",
            name: "Town Bank — Ada",
            inventory: [],
          }],
        },
        confidence: "authoritative",
        provenance: {
          provider: "relay",
          sourceKey: "region:19",
          regionId: "19",
          database: "relay-region-19",
          schemaFingerprint: "regional-v1",
          sourceObservedAt: null,
          receivedAt: "2026-07-29T20:41:00.000Z",
        },
        warnings: [],
      },
      "inventory-storages": {
        data: {
          buildings: [{
            entityId: "7001",
            inventoryEntityId: "8101",
            buildingDescriptionId: "6020",
            items: [{ itemId: "42", itemType: "item", quantity: "11" }],
            inventory: [],
          }],
        },
        confidence: "authoritative",
        provenance: {
          provider: "relay",
          sourceKey: "region:19",
          regionId: "19",
          database: "relay-region-19",
          schemaFingerprint: "regional-v1",
          sourceObservedAt: null,
          receivedAt: "2026-07-29T20:41:00.000Z",
        },
        warnings: [],
      },
      contributions: {
        data: {},
        confidence: "partial",
        provenance: {
          provider: "relay",
          sourceKey: "region:19",
          regionId: "19",
          database: "relay-region-19",
          schemaFingerprint: "regional-v1",
          sourceObservedAt: null,
          receivedAt: "2026-07-29T20:41:00.000Z",
        },
        warnings: ["Relay craft 9002 has invalid experience per progress"],
      },
    },
  });

  assert.deepEqual(presenceRequests, ["101"]);
  await runtime.reconcile({ regionId: "19", members: [...members] });
  assert.equal(starts.length, 1);
  await runtime.reconcile({
    regionId: "19",
    members: [{ playerEntityId: "101", userName: "Ada Renamed" }],
  });
  assert.deepEqual(stops, [1]);
  assert.equal(starts.length, 2);
  await handlers[0]({
    players: [{ playerEntityId: "101", username: "Stale Ada", signedIn: false }],
    warnings: [],
    equipment: { members: [] },
    equipmentWarnings: [],
    construction: { projects: [], buildings: [] },
    constructionWarnings: [],
    research: {
      claimId: "1369094286777412590",
      learnedTechIds: [],
      researchingTechId: null,
      researchStartedAt: null,
      scheduledId: null,
    },
    researchWarnings: [],
    recruitment: {
      claimId: "1369094286777412590",
      isRecruiting: false,
      recruitment: [],
    },
    recruitmentWarnings: [],
    bankInventories: { buildings: [] },
    bankInventoryWarnings: [],
    settlementInventories: { buildings: [] },
    settlementInventoryWarnings: [],
    database: "relay-region-19",
    regionId: "19",
    schemaFingerprint: "regional-v1",
    generation: 2,
    receivedAt: "2026-07-29T20:42:00.000Z",
  });
  assert.equal(writes.length, 1, "retired session callbacks must be ignored");
  await runtime.reconcile({
    regionId: "19",
    members: [
      { playerEntityId: "101", userName: "Ada Renamed" },
      { playerEntityId: "202", userName: "Grace" },
    ],
  });
  assert.deepEqual(stops, [1, 2]);
  assert.equal(starts.length, 3);
  assert.equal(starts[2].members.length, 2);
  await runtime.reconcile({
    claimId: "2",
    regionId: "19",
    members: [
      { playerEntityId: "101", userName: "Ada Renamed" },
      { playerEntityId: "202", userName: "Grace" },
    ],
  });
  assert.deepEqual(stops, [1, 2, 3]);
  assert.equal(starts[3].claimId, "2");
});

test("primary-region runtime preserves last-good data when the region source is unavailable", async () => {
  assert.ok(runtimeModule, "primary-region runtime module must exist");
  let constructed = false;
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ ...topology(), regions: new Map() }),
    createSession: () => {
      constructed = true;
      return {};
    },
    currentStateRepository: {
      nextGeneration: () => 1,
      commitGeneration: () => assert.fail("must preserve last-good players"),
    },
  });
  await assert.rejects(runtime.start({
    relayBaseUrl: "https://relay.example",
    claimId: "1",
    regionId: "19",
    members: [{ playerEntityId: "101", userName: "Ada" }],
  }), /region 19 source is not ready/i);
  assert.equal(constructed, false);
});

test("primary-region runtime forwards live contribution events to durable provider storage", async () => {
  const starts = [];
  const appended = [];
  let contributionHandler;
  const target = {
    craftEntityId: "1369094287428103662",
    profession: "Forestry",
    craftLabel: "Owl Feather",
    structureName: "Forester",
    itemTier: "3",
    xpPerProgress: "2",
  };
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => topology(),
    createSession: (options) => {
      contributionHandler = options.onContribution;
      return {
        start: async (config) => starts.push(config),
        stop: async () => {},
        health: () => ({ connected: true, applied: true, lastAppliedAt: null, lastError: null }),
      };
    },
    currentStateRepository: {
      nextGeneration: () => 1,
      commitGeneration: () => {},
      appendEvents: async (events) => appended.push(...events),
    },
  });

  await runtime.start({
    relayBaseUrl: "https://relay.example",
    claimId: "1369094286777412590",
    regionId: "19",
    members: [{ playerEntityId: "576460752388321942", userName: "Mosswick" }],
    contributionTargets: [target],
  });
  assert.deepEqual(starts[0].contributionTargets, [target]);

  const event = {
    claimId: "1369094286777412590",
    domain: "contributions",
    sourceKey: "relay-craft-contribution:19:transaction-12:1369094287428103662",
    occurredAt: "2026-08-01T09:00:00.000Z",
    data: { eventType: "craft_contribution" },
  };
  await contributionHandler(event);
  await runtime.stop();
  assert.deepEqual(appended, [event]);
});

test("primary-region runtime updates contribution scope without restarting member data", async () => {
  const starts = [];
  const stops = [];
  const updates = [];
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => topology(),
    createSession: () => ({
      start: async (config) => starts.push(config),
      updateContributionScope: (targets, warnings) => updates.push({ targets, warnings }),
      stop: async () => stops.push(true),
      health: () => ({ connected: true, applied: true, lastAppliedAt: null, lastError: null }),
    }),
    currentStateRepository: {
      nextGeneration: () => 1,
      commitGeneration: () => {},
    },
  });
  const members = [{ playerEntityId: "101", userName: "Ada" }];
  const first = [{
    craftEntityId: "9001",
    profession: "Forestry",
    craftLabel: "Planks",
    structureName: "Forester",
    itemTier: "3",
    xpPerProgress: "2",
  }];
  const second = [{ ...first[0], craftEntityId: "9002" }];

  await runtime.start({
    relayBaseUrl: "https://relay.example",
    claimId: "1",
    regionId: "19",
    members,
    contributionTargets: first,
  });
  await runtime.reconcile({
    claimId: "1",
    regionId: "19",
    members,
    contributionTargets: second,
    contributionWarnings: ["one target changed"],
  });

  assert.equal(starts.length, 1);
  assert.deepEqual(stops, []);
  assert.deepEqual(updates, [{ targets: second, warnings: ["one target changed"] }]);
});

test("healthy primary-region runtime replaces its session when the discovered source changes", async () => {
  let now = 0;
  let sourceRevision = 1;
  let discoveryCount = 0;
  const sessions = [];
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    now: () => now,
    topologyRefreshMs: 60_000,
    discoverTopology: async () => {
      discoveryCount += 1;
      const value = topology();
      value.regions.get("19").database = `relay-region-19-${sourceRevision}`;
      value.regions.get("19").port = 4019 + sourceRevision;
      return value;
    },
    createSession: () => {
      const session = {
        stopped: false,
        async start() {},
        health: () => ({
          connected: true,
          applied: true,
          lastAppliedAt: "2026-08-01T08:00:00.000Z",
          lastError: null,
        }),
        async stop() { session.stopped = true; },
      };
      sessions.push(session);
      return session;
    },
    currentStateRepository: {
      nextGeneration: () => 1,
      commitGeneration: () => {},
    },
  });
  const config = {
    claimId: "1",
    regionId: "19",
    members: [{ playerEntityId: "101", userName: "Ada" }],
  };

  await runtime.start({ relayBaseUrl: "https://relay.example", ...config });
  now = 59_999;
  await runtime.reconcile(config);
  assert.equal(discoveryCount, 1);

  sourceRevision = 2;
  now = 60_000;
  await runtime.reconcile(config);
  assert.equal(sessions[0].stopped, true);
  assert.equal(runtime.health().source.database, "relay-region-19-2");
  assert.equal(discoveryCount, 3);
});

test("primary-region runtime coalesces concurrent topology reconciliation", async () => {
  let now = 0;
  let discoveryCount = 0;
  let releaseDiscovery;
  const discoveryGate = new Promise((resolve) => {
    releaseDiscovery = resolve;
  });
  const sessions = [];
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    now: () => now,
    topologyRefreshMs: 60_000,
    discoverTopology: async () => {
      discoveryCount += 1;
      if (discoveryCount === 2) await discoveryGate;
      return topology();
    },
    createSession: () => {
      const session = {
        async start() {},
        health: () => ({
          connected: true,
          applied: true,
          lastAppliedAt: "2026-08-01T08:00:00.000Z",
          lastError: null,
        }),
        async stop() {},
      };
      sessions.push(session);
      return session;
    },
    currentStateRepository: {
      nextGeneration: () => 1,
      commitGeneration: () => {},
    },
  });
  const config = {
    claimId: "1",
    regionId: "19",
    members: [{ playerEntityId: "101", userName: "Ada" }],
  };
  await runtime.start({ relayBaseUrl: "https://relay.example", ...config });
  now = 60_000;

  const first = runtime.reconcile(config);
  const second = runtime.reconcile(config);
  releaseDiscovery();
  await Promise.all([first, second]);

  assert.equal(discoveryCount, 2);
  assert.equal(sessions.length, 1);
});

test("primary-region runtime stops a session whose startup rejects", async () => {
  assert.ok(runtimeModule, "primary-region runtime module must exist");
  let stopped = false;
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => topology(),
    createSession: () => ({
      start: async () => { throw new Error("connection failed"); },
      stop: async () => { stopped = true; },
      health: () => ({}),
    }),
    currentStateRepository: {
      nextGeneration: () => 1,
      commitGeneration: () => {},
    },
  });
  await assert.rejects(runtime.start({
    relayBaseUrl: "https://relay.example",
    claimId: "1",
    regionId: "19",
    members: [{ playerEntityId: "101", userName: "Ada" }],
  }), /connection failed/);
  assert.equal(stopped, true);
});

test("primary-region reconnects only for disconnected or errored subscription health", async () => {
  let now = 0;
  const healthStates = [
    { connected: false, applied: true, lastAppliedAt: "2026-08-08T10:00:00.000Z", lastError: null },
    { connected: true, applied: true, lastAppliedAt: "2026-08-08T10:00:00.000Z", lastError: "socket failed" },
    { connected: true, applied: true, lastAppliedAt: "2026-08-08T10:00:00.000Z", lastError: null },
  ];
  const sessions = [];
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    now: () => now,
    topologyRefreshMs: 60_000,
    reconnectDelayMs: () => 1_000,
    discoverTopology: async () => topology(),
    createSession: () => {
      const index = sessions.length;
      const session = {
        stopped: false,
        async start() {},
        updateContributionScope() {},
        health: () => healthStates[index],
        async stop() { session.stopped = true; },
      };
      sessions.push(session);
      return session;
    },
    currentStateRepository: {
      nextGeneration: () => 1,
      commitGeneration: () => {},
    },
  });
  const config = {
    claimId: "100",
    regionId: "19",
    members: [{ playerEntityId: "101", userName: "Ada" }],
  };

  await runtime.start({ relayBaseUrl: "https://relay.example", ...config });
  await runtime.reconcile(config);
  assert.equal(sessions.length, 2, "disconnected health must restart");

  now = 999;
  await runtime.reconcile(config);
  assert.equal(sessions.length, 2, "reconnect attempts must respect backoff");

  now = 1_000;
  await runtime.reconcile(config);
  assert.equal(sessions.length, 3, "subscription errors must restart after backoff");

  await runtime.reconcile(config);
  assert.equal(sessions.length, 3, "healthy idle subscriptions must not restart");
});

test("primary-region applies escalating backoff after repeated rejected reconnect starts", async () => {
  let now = 0;
  const attempts = [];
  const delays = [];
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    now: () => now,
    topologyRefreshMs: 60_000,
    reconnectDelayMs: (failureCount) => {
      delays.push(failureCount);
      return failureCount * 1_000;
    },
    discoverTopology: async () => topology(),
    createSession: () => {
      const attempt = attempts.length;
      return {
        async start() {
          attempts.push(attempt);
          if (attempt > 0) throw new Error(`connection rejected ${attempt}`);
        },
        updateContributionScope() {},
        health: () => ({ connected: false, applied: true, lastAppliedAt: null, lastError: null }),
        async stop() {},
      };
    },
    currentStateRepository: { nextGeneration: () => 1, commitGeneration: () => {} },
  });
  const config = {
    claimId: "100",
    regionId: "19",
    members: [{ playerEntityId: "101", userName: "Ada" }],
  };

  await runtime.start({ relayBaseUrl: "https://relay.example", ...config });
  await assert.rejects(runtime.reconcile(config), /connection rejected 1/);
  assert.deepEqual(delays, [1]);

  now = 999;
  await runtime.reconcile(config);
  assert.equal(attempts.length, 2, "rejected reconnect must remain inside its first delay");

  now = 1_000;
  await assert.rejects(runtime.reconcile(config), /connection rejected 2/);
  assert.deepEqual(delays, [1, 2]);

  now = 2_999;
  await runtime.reconcile(config);
  assert.equal(attempts.length, 3, "second rejection must receive an escalated delay");

  now = 3_000;
  await assert.rejects(runtime.reconcile(config), /connection rejected 3/);
  assert.deepEqual(delays, [1, 2, 3]);
});
