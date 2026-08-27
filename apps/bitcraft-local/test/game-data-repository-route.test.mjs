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

test("current-state reads reuse unchanged parsed payload without hiding external updates", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const repository = createCurrentStateRepository(db);
  const claimId = "1369094286777412590";
  const observedAt = "2026-08-27T10:00:00.000Z";

  await repository.commitGeneration({
    claimId,
    generation: 1,
    domains: {
      "regional-market": {
        data: { orders: [{ entityId: "1" }] },
        confidence: "authoritative",
        provenance: relayProvenance(observedAt),
        warnings: [],
      },
    },
  });

  const first = repository.read(claimId, "regional-market");
  const second = repository.read(claimId, "regional-market");
  assert.strictEqual(second.data, first.data);

  db.prepare(`
    UPDATE domain_payload_current
    SET data_json = ?
    WHERE claim_id = ? AND domain = 'regional-market'
  `).run(JSON.stringify({ orders: [{ entityId: "2" }] }), claimId);

  const externallyUpdated = repository.read(claimId, "regional-market");
  assert.notStrictEqual(externallyUpdated.data, first.data);
  assert.equal(externallyUpdated.data.orders[0].entityId, "2");
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
  const publication = await repository.commitGenerationWithTransition({
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

  assert.deepEqual(publication, {
    published: true,
    changedDomains: ["regional-market"],
    generation: 42,
  });

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
      lockedBy: null,
      leaseToken: null,
      lockedAt: null,
      leaseExpiresAt: null,
      createdAt: transition.observedAt,
      updatedAt: transition.observedAt,
    }],
  );

  const lease = restartedProcess.claimPendingTransition({
    claimId: transition.claimId,
    domain: "regional-market",
    workerId: "repository-test",
    leaseMs: 30_000,
    at: "2026-07-30T12:00:00.000Z",
  });
  assert.ok(lease?.leaseToken);
  assert.equal(restartedProcess.recordTransitionError({
    transitionKey: transition.transitionKey,
    leaseToken: lease.leaseToken,
    error: "history disk temporarily unavailable",
    retryAt: "2026-07-30T12:00:01.000Z",
  }), true);
  assert.equal(
    restartedProcess.listPendingTransitions(transition.claimId, "regional-market")[0].attempts,
    1,
  );
  const retryLease = restartedProcess.claimPendingTransition({
    claimId: transition.claimId,
    domain: "regional-market",
    workerId: "repository-test",
    leaseMs: 30_000,
    at: "2026-07-30T12:00:01.000Z",
  });
  assert.equal(restartedProcess.ackTransition({
    transitionKey: transition.transitionKey,
    leaseToken: retryLease.leaseToken,
  }), true);
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
        schemaFingerprintDiagnostic: null,
      },
      "region:19": {
        ready: true,
        database: "relay-region-19",
        schemaFingerprint: "regional-fingerprint",
        schemaFingerprintDiagnostic: null,
      },
    },
  });
  db.close();
});

test("repository rejects stale and equal transition generations without creating outbox rows", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const repository = createCurrentStateRepository(db);
  const claimId = "1369094286777412590";
  const transitionFor = (generation) => ({
    transitionKey: `claim-market:${claimId}:market:${generation}`,
    claimId,
    domain: "market",
    observedAt: "2026-07-30T12:00:00.000Z",
    payload: {
      version: 1,
      claimId,
      generation,
      observedAt: "2026-07-30T12:00:00.000Z",
      events: [],
    },
  });
  const batchFor = (generation) => ({
    claimId,
    generation,
    domains: {
      market: {
        data: { claimId, regionId: "19", listings: [] },
        confidence: "authoritative",
        provenance: relayProvenance("2026-07-30T12:00:00.000Z"),
        warnings: [],
      },
    },
  });

  assert.deepEqual(
    await repository.commitGenerationWithTransition(batchFor(42), transitionFor(42)),
    { published: true, changedDomains: ["market"], generation: 42 },
  );
  assert.deepEqual(
    await repository.commitGenerationWithTransition(batchFor(42), transitionFor(42)),
    { published: false, changedDomains: [], generation: 42 },
  );
  assert.deepEqual(
    await repository.commitGenerationWithTransition(batchFor(41), transitionFor(41)),
    { published: false, changedDomains: [], generation: 41 },
  );
  assert.equal(repository.read(claimId, "market").generation, 42);
  assert.deepEqual(
    repository.listPendingTransitions(claimId, "market").map((row) => row.transitionKey),
    [`claim-market:${claimId}:market:42`],
  );
  db.close();
});

test("later Relay HTTP health cannot erase a persisted schema-blocking diagnostic", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const repository = createCurrentStateRepository(db);
  const diagnostic = {
    sourceKey: "global",
    schemaUrl: "https://relay.example:3000/v1/database/relay-global/schema?version=9",
    expected: "expected-global",
    observed: "observed-global",
    attemptedAt: "2026-08-22T10:00:00.000Z",
    status: "mismatch",
    error: "Relay global schema fingerprint mismatch",
  };

  await repository.recordSchemaFingerprintDiagnostic({
    diagnostic,
    database: "relay-global",
    ready: true,
  });
  await repository.recordHealth({
    provider: "relay",
    running: true,
    topologyReady: true,
    cacheReady: true,
    generation: 4,
    lastRefreshAt: "2026-08-22T10:00:01.000Z",
    lastError: null,
    sources: {
      global: {
        ready: true,
        database: "relay-global",
        schemaFingerprint: "observed-global",
      },
    },
  }, "2026-08-22T10:00:01.000Z");

  assert.deepEqual(
    repository.readHealth()?.sources.global?.schemaFingerprintDiagnostic,
    diagnostic,
  );
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
    runtimeState: "connected",
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

test("repository rejects new unknown Relay craft contributions", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  applySchemaIndexStatements(db);
  const repository = createCurrentStateRepository(db);
  const event = {
    claimId: "1369094286777412590",
    domain: "contributions",
    sourceKey: "relay-craft-contribution:19:unknown:unknown:no-match:1369094287428103662:16056:16080",
    occurredAt: "2026-08-01T09:00:00.000Z",
    data: {
      eventType: "craft_contribution",
      regionId: "19",
      database: "bitcraft-live-19",
      schemaFingerprint: "regional-v1",
      craftEntityId: "1369094287428103662",
      contributorEntityId: null,
      contributorName: "Unknown contributor",
      attributionConfidence: "unknown",
      observedSince: "2026-08-01T09:00:00.000Z",
      profession: "Forestry",
      craftLabel: "Owl Feather",
      structureName: "Forester",
      itemTier: "3",
      contributedProgress: "24",
      contributedXp: "42.24",
      contributionCount: "1",
      previousProgress: "16056",
      currentProgress: "16080",
    },
  };
  await assert.rejects(repository.appendEvents([event]), /attribution confidence is invalid/i);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM production_contribution_events").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM production_contributions").get().count, 0);
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
  assert.deepEqual(unavailable.body.meta, {
    coherence: "unavailable",
    availableGenerations: [],
    newestGeneration: null,
    oldestGeneration: null,
  });
  assert.deepEqual(unavailable.body.domainStatus, {
    claim: {
      generation: null,
      freshness: "unavailable",
      confidence: "unknown",
      ageMs: null,
      warnings: ["claim has not loaded yet."],
      provenance: null,
      dependencies: {},
    },
    members: {
      generation: null,
      freshness: "unavailable",
      confidence: "unknown",
      ageMs: null,
      warnings: ["members has not loaded yet."],
      provenance: null,
      dependencies: {},
    },
  });
});

test("game-data route reports coherent application generations without mixing unavailable domains", () => {
  const rows = new Map([
    ["claim", {
      data: { entityId: "1369094286777412590", regionId: "19" },
      confidence: "joined",
      generation: 12,
      lastError: null,
      provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
      warnings: [],
    }],
    ["members", {
      data: [{ playerEntityId: "1" }],
      confidence: "joined",
      generation: 12,
      lastError: null,
      provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
      warnings: [],
    }],
  ]);
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["claim", "members", "research"],
    repository: { read: (_claimId, domain) => rows.get(domain) ?? null },
    now: new Date("2026-07-29T11:00:01.000Z"),
  });

  assert.deepEqual(result.body.meta, {
    coherence: "coherent",
    availableGenerations: [12],
    newestGeneration: 12,
    oldestGeneration: 12,
  });
  assert.equal(result.body.domainStatus.claim.generation, 12);
  assert.equal(result.body.domainStatus.members.generation, 12);
  assert.equal(result.body.domainStatus.research.generation, null);
  assert.equal(result.body.domainStatus.research.freshness, "unavailable");
});

test("game-data route reports independently current application generations as mixed", () => {
  const rows = new Map([
    ["claim", {
      data: { entityId: "1369094286777412590", regionId: "19" },
      confidence: "joined",
      generation: 21,
      lastError: null,
      provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
      warnings: [],
    }],
    ["members", {
      data: [{ playerEntityId: "1" }],
      confidence: "joined",
      generation: 22,
      lastError: null,
      provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
      warnings: [],
    }],
  ]);
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["claim", "members"],
    repository: { read: (_claimId, domain) => rows.get(domain) ?? null },
    now: new Date("2026-07-29T11:00:01.000Z"),
  });

  assert.deepEqual(result.body.meta, {
    coherence: "mixed",
    availableGenerations: [21, 22],
    newestGeneration: 22,
    oldestGeneration: 21,
  });
});

test("game-data route includes catalog and composed-domain generation dependencies", () => {
  const rows = new Map([
    ["inventories", {
      data: { buildings: [] },
      confidence: "joined",
      generation: 31,
      lastError: null,
      provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
      warnings: [],
    }],
    ["crafts", {
      data: { craftResults: [] },
      confidence: "authoritative",
      generation: 31,
      lastError: null,
      provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
      warnings: [],
    }],
  ]);
  const catalog = {
    generation: 31,
    sourceGeneration: 908,
    sourceKey: "global",
    receivedAt: "2026-07-29T10:59:00.000Z",
  };
  const inventoryBanks = { generation: 31, sourceKey: "region:19", receivedAt: "2026-07-29T11:00:00.000Z" };
  const publicCrafts = { generation: 31, sourceKey: "region:19", receivedAt: "2026-07-29T11:00:00.000Z" };
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["inventories", "crafts"],
    repository: { read: (_claimId, domain) => rows.get(domain) ?? null },
    transformDomain: (domain, data) => ({
      data,
      dependencies: domain === "inventories"
        ? { catalog, "inventory-banks": inventoryBanks }
        : { catalog, "public-crafts": publicCrafts },
    }),
    now: new Date("2026-07-29T11:00:01.000Z"),
  });

  assert.deepEqual(result.body.domainStatus.inventories.dependencies, {
    catalog,
    "inventory-banks": inventoryBanks,
  });
  assert.deepEqual(result.body.domainStatus.crafts.dependencies, {
    catalog,
    "public-crafts": publicCrafts,
  });
  assert.equal(result.body.meta.coherence, "coherent");
});

test("game-data route does not treat a coincidentally equal catalog source generation as coherent", () => {
  const snapshot = {
    data: { marketplaces: [], listings: [] },
    confidence: "authoritative",
    generation: 31,
    lastError: null,
    provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
    warnings: [],
  };
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["market"],
    repository: { read: () => snapshot },
    transformDomain: (_domain, data) => ({
      data,
      dependencies: {
        catalog: {
          generation: null,
          sourceGeneration: 31,
          sourceKey: "global",
          receivedAt: "2026-07-29T10:59:00.000Z",
        },
      },
    }),
    now: new Date("2026-07-29T11:00:01.000Z"),
  });

  assert.deepEqual(result.body.meta, {
    coherence: "mixed",
    availableGenerations: [31],
    newestGeneration: 31,
    oldestGeneration: 31,
  });
  assert.equal(result.body.domainStatus.market.dependencies.catalog.sourceGeneration, 31);
});

test("game-data route marks a legacy catalog dependency with unknown publication generation as mixed", () => {
  const snapshot = {
    data: { marketplaces: [], listings: [] },
    confidence: "authoritative",
    generation: 44,
    lastError: null,
    provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
    warnings: [],
  };
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["market"],
    repository: { read: () => snapshot },
    transformDomain: (_domain, data) => ({
      data,
      dependencies: {
        catalog: {
          generation: null,
          sourceKey: "global",
          receivedAt: "2026-07-29T10:59:00.000Z",
        },
      },
    }),
    now: new Date("2026-07-29T11:00:01.000Z"),
  });

  assert.equal(result.body.meta.coherence, "mixed");
  assert.deepEqual(result.body.meta.availableGenerations, [44]);
});

test("game-data route marks a matching primary envelope with a different enrichment revision as mixed", () => {
  const snapshot = {
    data: { buildings: [] },
    confidence: "joined",
    generation: 41,
    lastError: null,
    provenance: relayProvenance("2026-07-29T11:00:00.000Z"),
    warnings: [],
  };
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["inventories"],
    repository: { read: () => snapshot },
    transformDomain: (_domain, data) => ({
      data,
      dependencies: {
        catalog: { generation: 42, sourceKey: "global", receivedAt: "2026-07-29T11:00:00.000Z" },
        "inventory-banks": { generation: 40, sourceKey: "region:19", receivedAt: "2026-07-29T11:00:00.000Z" },
      },
    }),
    now: new Date("2026-07-29T11:00:01.000Z"),
  });

  assert.deepEqual(result.body.meta, {
    coherence: "mixed",
    availableGenerations: [40, 41, 42],
    newestGeneration: 42,
    oldestGeneration: 40,
  });
});

test("game-data route accepts the provider-neutral public crafts domain", () => {
  assert.deepEqual(
    parseDomainKeys("claim,public-crafts,public-crafts,not-a-domain"),
    ["claim", "public-crafts"],
  );
});

test("game-data route accepts map resource generation events as a provider-neutral domain", () => {
  assert.deepEqual(
    parseDomainKeys("map-resources,map-resources,not-a-domain"),
    ["map-resources"],
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
  assert.deepEqual(result.body.domainStatus.claim, {
    generation: 4,
    freshness: "stale",
    confidence: "joined",
    ageMs: 120_000,
    warnings: ["Relay HTTP 503"],
    provenance: relayProvenance("2026-07-29T10:00:00.000Z"),
    dependencies: {},
  });
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

test("game-data route keeps age-stale status visible without a last error", () => {
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["research"],
    repository: {
      read: () => ({
        data: { nodes: [] },
        confidence: "authoritative",
        generation: 17,
        lastError: null,
        provenance: relayProvenance("2026-07-29T10:00:00.000Z"),
        warnings: [],
      }),
    },
    now: new Date("2026-07-29T10:02:00.000Z"),
    freshForMs: 60_000,
  });

  assert.equal(result.body.domainStatus.research.generation, 17);
  assert.equal(result.body.domainStatus.research.freshness, "stale");
  assert.equal(result.body.domainStatus.research.ageMs, 120_000);
  assert.deepEqual(result.body.domainStatus.research.provenance, relayProvenance("2026-07-29T10:00:00.000Z"));
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

test("game-data route does not emit a global warning for unavailable member presence", () => {
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["players"],
    repository: {
      read: () => ({
        data: [{
          playerEntityId: "1",
          signedIn: null,
          presenceRegionId: null,
          presenceSource: "unavailable",
        }],
        confidence: "authoritative",
        generation: 5,
        lastError: null,
        provenance: {
          ...relayProvenance("2026-07-29T20:45:00.000Z"),
          sourceKey: "region:19",
        },
        warnings: [],
      }),
    },
    now: new Date("2026-07-29T20:45:10.000Z"),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.partialErrors, []);
  assert.equal(result.body.domains.players.data[0].presenceSource, "unavailable");
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
