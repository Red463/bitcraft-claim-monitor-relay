import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const { applySchemaBootstrap } = await import(
  new URL("../src/server/schemaBootstrap.mjs", import.meta.url).href,
);
const { applyAdditiveColumnMigrations } = await import(
  new URL("../src/server/schemaMigrations.mjs", import.meta.url).href,
);
const { applySchemaIndexStatements } = await import(
  new URL("../src/server/schemaMigrations.mjs", import.meta.url).href,
);
const { createCurrentStateRepository } = await import(
  new URL("../src/server/game-data/currentStateRepository.ts", import.meta.url).href,
);
const {
  browserVisibleChangedDomains,
  gameDataResponse,
  generationSourceDomains,
} = await import(
  new URL("../src/server/game-data/gameDataRoute.ts", import.meta.url).href,
);
const { enrichCraftsDomain } = await import(
  new URL("../src/server/game-data/craftProjection.ts", import.meta.url).href,
);

test("Town Bank commits invalidate the public inventories domain immediately", () => {
  assert.deepEqual(
    browserVisibleChangedDomains(["players", "inventory-banks", "inventory-banks"]),
    ["players", "inventories"],
  );
});

test("inventory generation polling includes the internal Town Bank source", () => {
  assert.deepEqual(
    generationSourceDomains(["claim", "inventories"]),
    ["claim", "inventories", "inventory-banks"],
  );
});
const { parseDomainKeys } = await import(
  new URL("../src/server/game-data/gameDataRoute.ts", import.meta.url).href,
);
const { createRelaySettlementTransitionCoordinator } = await import(
  new URL("../src/server/relaySettlementTransitionCoordinator.mjs", import.meta.url).href,
);

function relayProvenance(receivedAt, sourceObservedAt = receivedAt) {
  return {
    provider: "relay",
    sourceKey: "relay-cache",
    regionId: "19",
    database: null,
    schemaFingerprint: null,
    sourceObservedAt,
    receivedAt,
  };
}

test("current-state reads reject legacy rows rather than manufacturing Relay provenance", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const repository = createCurrentStateRepository(db);
  const observedAt = "2026-07-29T09:00:00.000Z";

  db.prepare(`
    INSERT INTO domain_payload_current (
      claim_id, domain, data_json, collected_at, last_attempt_at,
      last_success_at, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    "1369094286777412590",
    "claim",
    JSON.stringify({ entityId: "1369094286777412590", name: "Legacy cache" }),
    observedAt,
    observedAt,
    observedAt,
    observedAt,
  );

  assert.equal(repository.read("1369094286777412590", "claim"), null);
  db.close();
});

test("generation commit atomically replaces only the submitted domains", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const repository = createCurrentStateRepository(db);

  await repository.commitGeneration({
    claimId: "1369094286777412590",
    generation: 1,
    domains: {
      claim: {
        data: { entityId: "1369094286777412590", name: "First", regionId: "19" },
        confidence: "joined",
        provenance: relayProvenance("2026-07-29T10:00:00.000Z"),
        warnings: [],
      },
      members: {
        data: [{ playerEntityId: "1", userName: "First member" }],
        confidence: "joined",
        provenance: relayProvenance("2026-07-29T10:00:00.000Z"),
        warnings: [],
      },
    },
  });
  await repository.commitGeneration({
    claimId: "1369094286777412590",
    generation: 2,
    domains: {
      claim: {
        data: { entityId: "1369094286777412590", name: "Second", regionId: "19" },
        confidence: "joined",
        provenance: relayProvenance("2026-07-29T10:01:00.000Z"),
        warnings: [],
      },
    },
  });

  assert.equal(repository.read("1369094286777412590", "claim").generation, 2);
  assert.equal(repository.read("1369094286777412590", "claim").data.name, "Second");
  assert.equal(repository.read("1369094286777412590", "members").generation, 1);
  assert.equal(repository.read("1369094286777412590", "members").data[0].userName, "First member");
  assert.equal(repository.nextGeneration("1369094286777412590"), 3);
  db.close();
});

test("generation commit notifies browser delivery only after the transaction succeeds", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const events = [];
  const repository = createCurrentStateRepository(db, {
    onCommit: (event) => events.push(event),
  });

  await repository.commitGeneration({
    claimId: "1369094286777412590",
    generation: 7,
    domains: {
      members: {
        data: [{ playerEntityId: "1" }],
        confidence: "joined",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
      "regional-market": {
        data: { orders: [] },
        confidence: "authoritative",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
    },
  });

  assert.deepEqual(events, [{
    claimId: "1369094286777412590",
    generation: 7,
    generatedAt: "2026-07-30T12:00:00.000Z",
    changedDomains: ["members", "regional-market"],
  }]);
  db.close();
});

test("stale generation commits do not publish unchanged craft snapshots", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const events = [];
  const repository = createCurrentStateRepository(db, {
    onCommit: (event) => events.push(event),
  });
  const crafts = (generation, receivedAt) => ({
    claimId: "1369094286777412590",
    generation,
    domains: {
      crafts: {
        data: { craftResults: [] },
        confidence: "joined",
        provenance: relayProvenance(receivedAt),
        warnings: [],
      },
    },
  });

  await repository.commitGeneration(crafts(7, "2026-07-30T12:00:00.000Z"));
  events.length = 0;
  await repository.commitGeneration(crafts(6, "2026-07-30T12:01:00.000Z"));

  assert.deepEqual(events, []);
  assert.equal(repository.read("1369094286777412590", "crafts").generation, 7);
  db.close();
});

test("stale settlement domain writes do not notify the Relay transition coordinator", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const applications = [];
  let repository;
  const coordinator = createRelaySettlementTransitionCoordinator({
    configuredClaimId: () => "1369094286777412590",
    readDomainSnapshot: (claimId, domain) => repository.read(claimId, domain),
    applySettlementTransition: async (_claimId, summary) => applications.push(summary),
  });
  repository = createCurrentStateRepository(db, {
    onCommit: (event) => coordinator.onCommit(event),
  });
  const claimId = "1369094286777412590";
  await repository.commitGeneration({
    claimId,
    generation: 7,
    domains: {
      claim: {
        data: { entityId: claimId, regionId: "19", supplies: "100", treasury: "200" },
        confidence: "joined",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
      members: {
        data: [{ entityId: "member-1", claimEntityId: claimId }],
        confidence: "joined",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
      inventories: {
        data: { claim: { entityId: claimId }, dimensions: [], buildings: [] },
        confidence: "joined",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
      market: {
        data: { claimId, regionId: "19", marketplaces: [], listings: [] },
        confidence: "authoritative",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
    },
  });
  await coordinator.whenIdle();

  await repository.commitGeneration({
    claimId,
    generation: 6,
    domains: {
      claim: {
        data: { entityId: claimId, regionId: "19", supplies: "999", treasury: "999" },
        confidence: "joined",
        provenance: relayProvenance("2026-07-30T12:01:00.000Z"),
        warnings: [],
      },
    },
  });
  await coordinator.whenIdle();

  assert.equal(applications.length, 1);
  assert.equal(applications[0].supplies, "100");
  assert.equal(repository.read(claimId, "claim").generation, 7);
  db.close();
});

test("repository commit resolves before synchronous settlement transition work begins", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const claimId = "1369094286777412590";
  const order = [];
  let repository;
  const coordinator = createRelaySettlementTransitionCoordinator({
    configuredClaimId: () => claimId,
    readDomainSnapshot: (readClaimId, domain) => repository.read(readClaimId, domain),
    applySettlementTransition: async () => {
      order.push("transition");
    },
  });
  repository = createCurrentStateRepository(db, {
    onCommit: (event) => coordinator.onCommit(event),
  });

  await repository.commitGeneration({
    claimId,
    generation: 1,
    domains: {
      claim: {
        data: { entityId: claimId, regionId: "19", supplies: "100", treasury: "200" },
        confidence: "joined",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
      members: {
        data: [{ entityId: "member-1", claimEntityId: claimId }],
        confidence: "joined",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
      inventories: {
        data: { claim: { entityId: claimId }, dimensions: [], buildings: [] },
        confidence: "joined",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
      market: {
        data: { claimId, regionId: "19", marketplaces: [], listings: [] },
        confidence: "authoritative",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
    },
  });
  order.push("commit-resolved");
  await coordinator.whenIdle();

  assert.deepEqual(order, ["commit-resolved", "transition"]);
  db.close();
});

test("repository resumes generations after a process restart", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const firstProcess = createCurrentStateRepository(db);
  await firstProcess.commitGeneration({
    claimId: "1369094286777412590",
    generation: 41,
    domains: {
      claim: {
        data: { entityId: "1369094286777412590", regionId: "19" },
        confidence: "joined",
        provenance: relayProvenance("2026-07-29T10:00:00.000Z"),
        warnings: [],
      },
    },
  });

  const restartedProcess = createCurrentStateRepository(db);
  assert.equal(restartedProcess.nextGeneration("1369094286777412590"), 42);
  db.close();
});

test("repository commits current state and a retryable transition edge atomically", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const repository = createCurrentStateRepository(db);
  const transition = {
    transitionKey: "regional-market:1369094286777412590:42",
    claimId: "1369094286777412590",
    domain: "regional-market",
    observedAt: "2026-07-30T12:00:00.000Z",
    payload: {
      claimId: "1369094286777412590",
      previousData: { orders: [{ entityId: "1" }] },
      currentData: { orders: [] },
      isRegionBaseline: false,
      observedAt: "2026-07-30T12:00:00.000Z",
    },
  };
  await repository.commitGenerationWithTransition({
    claimId: transition.claimId,
    generation: 42,
    domains: {
      "regional-market": {
        data: transition.payload.currentData,
        confidence: "authoritative",
        provenance: relayProvenance(transition.observedAt),
        warnings: [],
      },
    },
  }, transition);

  const restartedProcess = createCurrentStateRepository(db);
  assert.equal(
    restartedProcess.read(transition.claimId, "regional-market").generation,
    42,
  );
  assert.deepEqual(
    restartedProcess.listPendingTransitions(transition.claimId, "regional-market"),
    [{
      ...transition,
      attempts: 0,
      lastError: null,
      createdAt: transition.observedAt,
      updatedAt: transition.observedAt,
    }],
  );

  await restartedProcess.recordTransitionError(
    transition.transitionKey,
    "history disk temporarily unavailable",
    "2026-07-30T12:00:01.000Z",
  );
  assert.equal(
    restartedProcess.listPendingTransitions(transition.claimId, "regional-market")[0].attempts,
    1,
  );
  await restartedProcess.ackTransition(transition.transitionKey);
  assert.deepEqual(
    restartedProcess.listPendingTransitions(transition.claimId, "regional-market"),
    [],
  );
  db.close();
});

test("repository rolls back current state when its transition outbox insert fails", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  db.exec(`
    CREATE TRIGGER reject_provider_transition
    BEFORE INSERT ON provider_transition_outbox
    BEGIN
      SELECT RAISE(ABORT, 'forced transition failure');
    END
  `);
  const repository = createCurrentStateRepository(db);
  const claimId = "1369094286777412590";
  await assert.rejects(
    repository.commitGenerationWithTransition({
      claimId,
      generation: 1,
      domains: {
        "regional-market": {
          data: { orders: [] },
          confidence: "authoritative",
          provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
          warnings: [],
        },
      },
    }, {
      transitionKey: `regional-market:${claimId}:1`,
      claimId,
      domain: "regional-market",
      observedAt: "2026-07-30T12:00:00.000Z",
      payload: { claimId, currentData: { orders: [] } },
    }),
    /forced transition failure/,
  );
  assert.equal(repository.read(claimId, "regional-market"), null);
  db.close();
});

test("repository persists provider health for the separate web process", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const repository = createCurrentStateRepository(db);
  await repository.recordHealth({
    provider: "relay",
    running: true,
    topologyReady: true,
    cacheReady: true,
    generation: 9,
    lastRefreshAt: "2026-07-29T19:00:00.000Z",
    lastError: null,
    sources: {
      global: {
        ready: true,
        database: "relay-global",
        schemaFingerprint: "global-fingerprint",
      },
      "region:19": {
        ready: true,
        database: "relay-region-19",
        schemaFingerprint: "regional-fingerprint",
      },
    },
  }, "2026-07-29T19:00:01.000Z");

  assert.deepEqual(repository.readHealth(), {
    provider: "relay",
    running: true,
    topologyReady: true,
    cacheReady: true,
    generation: 9,
    lastRefreshAt: "2026-07-29T19:00:00.000Z",
    lastError: null,
    sources: {
      global: {
        ready: true,
        database: "relay-global",
        schemaFingerprint: "global-fingerprint",
      },
      "region:19": {
        ready: true,
        database: "relay-region-19",
        schemaFingerprint: "regional-fingerprint",
      },
    },
  });
  db.close();
});

test("repository persists subscription-specific health for split worker/web reads", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const repository = createCurrentStateRepository(db);

  await repository.recordSubscriptionHealth({
    sourceKey: "global",
    domain: "region",
    generation: 12,
    connected: true,
    applyDurationMs: 18,
    lagMs: 4,
    reconnects: 2,
    malformedRows: 0,
    lastError: null,
  }, "2026-07-30T12:00:00.000Z");

  assert.deepEqual(repository.readSubscriptionHealth("global", "region"), {
    sourceKey: "global",
    domain: "region",
    generation: 12,
    connected: true,
    applyDurationMs: 18,
    lagMs: 4,
    reconnects: 2,
    malformedRows: 0,
    lastError: null,
    updatedAt: "2026-07-30T12:00:00.000Z",
  });
  db.close();
});

test("repository durably deduplicates normalized Relay storage events", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  applySchemaIndexStatements(db);
  const repository = createCurrentStateRepository(db);
  const event = {
    claimId: "1369094286777412590",
    domain: "inventories",
    sourceKey: "relay-storage:19:4070526",
    occurredAt: "2026-07-30T09:00:00.000Z",
    data: {
      eventType: "storage",
      summary: "Ada deposited 12 Bronze Ingot to Ingots",
      metadata: {
        action: "deposit",
        actorEntityId: "200",
        actorName: "Ada",
        buildingId: "100",
        containerName: "Ingots",
        itemId: "42",
        itemName: "Bronze Ingot",
        itemType: "item",
        quantity: "12",
        regionId: "19",
        relayLogId: "4070526",
      },
    },
  };

  await repository.appendEvents([event, event]);
  await repository.appendEvents([event]);

  const rows = db.prepare("SELECT * FROM activity_events").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_key, "relay-storage:19:4070526");
  assert.equal(rows[0].summary, "Ada deposited 12 Bronze Ingot to Ingots");
  assert.equal(JSON.parse(rows[0].metadata_json).quantity, "12");
  db.close();
});

test("repository applies Relay craft contribution deltas exactly once", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  applySchemaIndexStatements(db);
  const repository = createCurrentStateRepository(db);
  const event = {
    claimId: "1369094286777412590",
    domain: "contributions",
    sourceKey: "relay-craft-contribution:19:transaction-12:1369094287428103662",
    occurredAt: "2026-08-01T09:00:00.000Z",
    data: {
      eventType: "craft_contribution",
      regionId: "19",
      database: "bitcraft-live-19",
      schemaFingerprint: "regional-v1",
      craftEntityId: "1369094287428103662",
      contributorEntityId: "576460752388321942",
      contributorName: "Mosswick",
      profession: "Forestry",
      craftLabel: "Owl Feather",
      structureName: "Forester",
      itemTier: "3",
      contributedProgress: "24",
      contributedXp: "48",
      contributionCount: "1",
      previousProgress: "16056",
      currentProgress: "16080",
    },
  };

  await repository.appendEvents([event, event]);
  await repository.appendEvents([event]);

  const eventRows = db.prepare("SELECT * FROM production_contribution_events").all();
  assert.equal(eventRows.length, 1);
  assert.equal(eventRows[0].source_key, event.sourceKey);
  assert.equal(eventRows[0].contributed_progress, "24");

  const contribution = db.prepare("SELECT * FROM production_contributions").get();
  assert.equal(contribution.contributed_progress, "24");
  assert.equal(contribution.contributed_xp, "48");
  assert.equal(contribution.contribution_count, "1");
  assert.equal(contribution.first_contributed_at, event.occurredAt);
  assert.equal(contribution.last_contributed_at, event.occurredAt);
  db.close();
});

test("game-data route rejects other claims and returns 503 before any requested domain has loaded", () => {
  const repository = { read: () => null };
  assert.deepEqual(gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "999",
    domains: ["claim"],
    repository,
    now: new Date("2026-07-29T11:00:00.000Z"),
  }), {
    status: 403,
    body: { error: "Requested claim is not the configured monitored claim." },
  });

  const unavailable = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["claim", "members"],
    repository,
    now: new Date("2026-07-29T11:00:00.000Z"),
  });
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body.partialErrors, [
    "claim has not loaded yet.",
    "members has not loaded yet.",
  ]);
});

test("game-data route accepts the provider-neutral public crafts domain", () => {
  assert.deepEqual(
    parseDomainKeys("claim,public-crafts,public-crafts,not-a-domain"),
    ["claim", "public-crafts"],
  );
});

test("game-data route serves last-good data as stale with age and partial errors", () => {
  const rows = new Map([
    ["claim", {
      data: { entityId: "1369094286777412590", name: "Timbersteel Trade", regionId: "19" },
      confidence: "joined",
      generation: 4,
      lastError: "Relay HTTP 503",
      provenance: relayProvenance("2026-07-29T10:00:00.000Z"),
      warnings: [],
    }],
  ]);
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["claim", "members"],
    repository: { read: (_claimId, domain) => rows.get(domain) ?? null },
    now: new Date("2026-07-29T10:02:00.000Z"),
    freshForMs: 60_000,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.regionId, "19");
  assert.equal(result.body.domains.claim.freshness, "stale");
  assert.equal(result.body.domains.claim.ageMs, 120_000);
  assert.equal(result.body.domains.claim.data.name, "Timbersteel Trade");
  assert.deepEqual(result.body.partialErrors, [
    "claim: Relay HTTP 503",
    "members has not loaded yet.",
  ]);
});

test("game-data route reports an old unchanged snapshot as live while its subscription heartbeat is healthy", () => {
  const snapshot = {
    data: [{ playerEntityId: "1", signedIn: true }],
    confidence: "authoritative",
    generation: 8,
    lastError: null,
    provenance: {
      ...relayProvenance("2026-07-29T10:00:00.000Z"),
      sourceKey: "region:19",
    },
    warnings: [],
  };
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["players"],
    repository: {
      read: () => snapshot,
      readSubscriptionHealth: () => ({
        sourceKey: "region:19",
        domain: "players",
        generation: 8,
        connected: true,
        applyDurationMs: 12,
        lagMs: 0,
        reconnects: 0,
        malformedRows: 0,
        lastError: null,
        updatedAt: "2026-07-29T10:04:50.000Z",
      }),
    },
    now: new Date("2026-07-29T10:05:00.000Z"),
    freshForMs: 60_000,
    liveForMs: 45_000,
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.domains.players.freshness, "live");
  assert.equal(result.body.domains.players.ageMs, 300_000);
});

test("game-data route does not trust a stale or disconnected subscription heartbeat", () => {
  const snapshot = {
    data: [{ playerEntityId: "1", signedIn: true }],
    confidence: "authoritative",
    generation: 8,
    lastError: null,
    provenance: {
      ...relayProvenance("2026-07-29T10:00:00.000Z"),
      sourceKey: "region:19",
    },
    warnings: [],
  };
  for (const health of [
    {
      connected: true,
      lastError: null,
      updatedAt: "2026-07-29T10:03:00.000Z",
    },
    {
      connected: false,
      lastError: "Relay subscription disconnected.",
      updatedAt: "2026-07-29T10:04:59.000Z",
    },
  ]) {
    const result = gameDataResponse({
      configuredClaimId: "1369094286777412590",
      claimId: "1369094286777412590",
      domains: ["players"],
      repository: {
        read: () => snapshot,
        readSubscriptionHealth: () => ({
          sourceKey: "region:19",
          domain: "players",
          generation: 8,
          applyDurationMs: null,
          lagMs: null,
          reconnects: 0,
          malformedRows: 0,
          ...health,
        }),
      },
      now: new Date("2026-07-29T10:05:00.000Z"),
      freshForMs: 60_000,
      liveForMs: 45_000,
    });
    assert.equal(result.body.domains.players.freshness, "stale");
  }
});

test("game-data route surfaces partial-domain warnings to browser status", () => {
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["players"],
    repository: {
      read: () => ({
        data: [{ playerEntityId: "1", signedIn: false }],
        confidence: "partial",
        generation: 5,
        lastError: null,
        provenance: {
          ...relayProvenance("2026-07-29T20:45:00.000Z"),
          sourceKey: "region:19",
        },
        warnings: ["Regional player_state omitted member 1."],
      }),
    },
    now: new Date("2026-07-29T20:45:10.000Z"),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.partialErrors, [
    "players: Regional player_state omitted member 1.",
  ]);
});

test("game-data route composes requested domains through a provider-neutral local projection", () => {
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["inventories"],
    repository: {
      read: () => ({
        data: { buildings: [{ entityId: "1" }] },
        confidence: "joined",
        generation: 6,
        lastError: null,
        provenance: relayProvenance("2026-07-29T21:00:00.000Z"),
        warnings: [],
      }),
    },
    transformData: (domain, data) => ({
      ...data,
      projectedBy: domain,
    }),
    now: new Date("2026-07-29T21:00:01.000Z"),
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.domains.inventories.data, {
    buildings: [{ entityId: "1" }],
    projectedBy: "inventories",
  });
});

test("game-data route surfaces projection warnings and partial confidence", () => {
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["construction"],
    repository: {
      read: () => ({
        data: { projects: [{ entityId: "9", constructionRecipeId: "404" }] },
        confidence: "authoritative",
        generation: 7,
        lastError: null,
        provenance: relayProvenance("2026-07-29T21:00:00.000Z"),
        warnings: [],
      }),
    },
    transformDomain: (_domain, data) => ({
      data: { ...data, projects: [] },
      confidence: "partial",
      warnings: ["Construction project 9 is missing global recipe 404."],
    }),
    now: new Date("2026-07-29T21:00:01.000Z"),
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.domains.construction.data, { projects: [] });
  assert.equal(result.body.domains.construction.confidence, "partial");
  assert.deepEqual(result.body.domains.construction.warnings, [
    "Construction project 9 is missing global recipe 404.",
  ]);
  assert.deepEqual(result.body.partialErrors, [
    "construction: Construction project 9 is missing global recipe 404.",
  ]);
});

test("malformed public craft evidence preserves the crafts response with a partial warning", () => {
  const craftSnapshot = {
    craftResults: [{ entityId: "100", recipeId: "10", completed: false }],
  };
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["crafts"],
    repository: {
      read: () => ({
        data: craftSnapshot,
        confidence: "authoritative",
        generation: 8,
        lastError: null,
        provenance: relayProvenance("2026-07-29T21:00:00.000Z"),
        warnings: [],
      }),
    },
    transformDomain: (_domain, data) => enrichCraftsDomain(
      data,
      { data: { craftResults: [{ entityId: 100 }] }, lastError: null },
      () => null,
      () => ({ id: "10", isPassive: false }),
    ),
    now: new Date("2026-07-29T21:00:01.000Z"),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.domains.crafts.data.craftResults[0].visibility, "unknown");
  assert.equal(result.body.domains.crafts.data.craftResults[0].isPublic, null);
  assert.equal(result.body.domains.crafts.confidence, "partial");
  assert.match(result.body.domains.crafts.warnings[0], /public-crafts marker is malformed/);
});
