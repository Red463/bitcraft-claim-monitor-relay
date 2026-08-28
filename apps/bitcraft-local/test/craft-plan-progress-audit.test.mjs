import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  buildCraftPlanProgressSnapshot,
  craftPlanProgressFingerprint,
  createCraftPlanProgressAuditRepository,
  diffCraftPlanProgressSnapshots,
  normalizeCraftPlanAuditRange,
  staleCraftPlanProgress,
} from "../src/server/craftPlanProgressAudit.mjs";
import { createPreparedStatements } from "../src/server/preparedStatements.mjs";
import { schemaBootstrapSql } from "../src/server/schemaBootstrap.mjs";
import { applyAdditiveColumnMigrations } from "../src/server/schemaMigrations.mjs";

function fixtureSnapshot({
  capturedAt = "2026-07-24T10:00:00.000Z",
  confirmed = 75,
  projected = confirmed,
  baselineRevision = "rev-a",
  material = {},
  sourceQuantity = 60,
  craftPresent = true,
} = {}) {
  const required = Number(material.required ?? 100);
  const available = Number(material.available ?? sourceQuantity);
  const guaranteed = Number(material.guaranteed ?? (craftPresent ? 15 : 0));
  const estimated = Number(material.estimated ?? 0);
  const missing = Math.max(0, required - available - guaranteed);
  const confirmedProgress = {
    overall: { completion: confirmed, baselineEffort: 100, remainingEffort: 100 - confirmed },
    sections: {},
  };
  const projectedProgress = {
    overall: { completion: projected, baselineEffort: 100, remainingEffort: 100 - projected },
    sections: {},
  };
  return {
    schemaVersion: 1,
    claimId: "1",
    capturedAt,
    baselineRevision,
    baselineInputs: {
      config: {
        targets: [{ id: "1", kind: "items", quantity: required }],
        routeOverrides: {},
        gatheredItemKeys: [],
        multipliers: {},
      },
      catalogRevision: "catalog-a",
      modelVersion: 3,
    },
    planInputs: {
      targets: [{ id: "1", kind: "items", quantity: required }],
      routeOverrides: {},
      gatheredItemKeys: [],
      multipliers: {},
      sourceRules: {
        storageContainerIds: ["store-1"],
        playerIds: ["player-1"],
        craftPlayerIds: ["player-1"],
        bankPlayerIds: [],
        bankContainerIds: ["player-1:bank-7"],
        deployableContainerIds: [],
      },
      buildingProgress: {},
    },
    planConfigFingerprint: "fixture",
    progress: { confirmed, projected },
    effortProgress: {
      confirmed: confirmedProgress,
      projected: projectedProgress,
      overall: confirmedProgress.overall,
      sections: confirmedProgress.sections,
      baselineRevision,
    },
    materials: [{
      key: "items:1",
      name: "Ink",
      required,
      missing,
      available,
      guaranteedInProgress: guaranteed,
      estimatedInProgress: estimated,
      effortWeight: 1,
      sources: [{
        sourceId: "store-1",
        label: "Scholar Storage",
        type: "Settlement storage",
        quantity: sourceQuantity,
      }],
      activeCraftSources: craftPresent ? [{
        craftId: "craft-1",
        playerId: "player-1",
        playerName: "Tom",
        buildingName: "Scholar Station",
        status: "In progress",
        quantity: guaranteed + estimated,
        directQuantity: guaranteed,
        guaranteedQuantity: guaranteed,
        estimatedQuantity: estimated,
      }] : [],
    }],
    sourceStatus: [{
      sourceId: "store-1",
      label: "Scholar Storage",
      type: "Settlement storage",
      available: true,
    }],
    metadata: { appVersion: "0.1.0", buildId: "abc", catalogRevision: "catalog-a", modelVersion: 3 },
  };
}

test("snapshot retains exact source identities and complete effort progress", () => {
  const snapshot = buildCraftPlanProgressSnapshot({
    claimId: "77",
    plan: {
      config: {
        targets: [{ id: "1", kind: "items", quantity: 10 }],
        routeOverrides: {},
        gatheredItemKeys: [],
        multipliers: {},
        sourceRules: {
          storageContainerIds: ["store-9"],
          playerIds: ["player-7"],
          craftPlayerIds: ["player-7"],
          bankPlayerIds: [],
          bankContainerIds: ["player-7:bank-9"],
          deployableContainerIds: [],
        },
        buildingProgress: {},
      },
      effortProgress: {
        baselineRevision: "rev-a",
        confirmed: { overall: { completion: 50, baselineEffort: 100, remainingEffort: 50 }, sections: {} },
        projected: { overall: { completion: 60, baselineEffort: 100, remainingEffort: 40 }, sections: {} },
        overall: { completion: 50, baselineEffort: 100, remainingEffort: 50 },
        sections: {},
        warnings: ["A useful warning"],
      },
      materials: [{
        key: "items:1",
        name: "Ink",
        required: 10,
        missing: 5,
        available: 4,
        guaranteedInProgress: 1,
        estimatedInProgress: 1,
        sources: [{ sourceId: "store-9", label: "Scholar Storage", type: "Settlement storage", quantity: 4 }],
        activeCraftSources: [{
          craftId: "craft-8",
          playerId: "player-7",
          playerName: "Tom",
          buildingName: "Scholar Station",
          status: "In progress",
          quantity: 2,
          directQuantity: 1,
          guaranteedQuantity: 1,
          estimatedQuantity: 1,
        }],
      }],
    },
    metadata: {
      appVersion: "0.1.0",
      buildId: "abc",
      catalogRevision: "catalog-a",
      modelVersion: 3,
      capturedAt: "2026-07-24T10:00:00.000Z",
    },
    sourceStatus: [{ sourceId: "store-9", label: "Scholar Storage", type: "Settlement storage", available: true }],
    weights: new Map([["items:1", { effortWeight: 5 }]]),
  });

  assert.equal(snapshot.materials[0].sources[0].label, "Scholar Storage");
  assert.equal(snapshot.materials[0].activeCraftSources[0].playerName, "Tom");
  assert.equal(snapshot.materials[0].effortWeight, 5);
  assert.equal(snapshot.progress.confirmed, 50);
  assert.equal(snapshot.progress.projected, 60);
  assert.equal(snapshot.effortProgress.confirmed.overall.completion, 50);
  assert.equal(snapshot.effortProgress.projected.overall.completion, 60);
  assert.deepEqual(snapshot.planInputs.sourceRules.storageContainerIds, ["store-9"]);
  assert.deepEqual(snapshot.planInputs.sourceRules.bankContainerIds, ["player-7:bank-9"]);
  assert.match(snapshot.planConfigFingerprint, /^[a-f0-9]{64}$/);
});

test("fingerprints ignore capture time but change with planner inputs", () => {
  const base = fixtureSnapshot();
  assert.equal(
    craftPlanProgressFingerprint({ ...base, capturedAt: "2026-07-24T10:00:00Z" }),
    craftPlanProgressFingerprint({ ...base, capturedAt: "2026-07-24T11:00:00Z" }),
  );
  assert.notEqual(
    craftPlanProgressFingerprint(base),
    craftPlanProgressFingerprint({ ...base, progress: { ...base.progress, confirmed: 49 } }),
  );
});

test("diff attributes stock, craft, requirement, output, and progress changes", () => {
  const previous = fixtureSnapshot({
    confirmed: 75,
    material: { required: 100, available: 60, guaranteed: 15, estimated: 5 },
    sourceQuantity: 60,
    craftPresent: true,
  });
  const current = fixtureSnapshot({
    confirmed: 65,
    material: { required: 130, available: 65, guaranteed: 0, estimated: 0 },
    sourceQuantity: 65,
    craftPresent: false,
  });
  const result = diffCraftPlanProgressSnapshots(previous, current);
  assert.ok(result.events.some((event) => event.type === "progress_delta" && event.confirmedDelta === -10));
  assert.ok(result.events.some((event) => event.type === "requirement_delta" && event.delta === 30));
  assert.ok(result.events.some((event) => event.type === "craft_removed" && event.craftId === "craft-1"));
  assert.ok(result.events.some((event) => event.type === "stock_delta" && event.delta === 5));
  assert.ok(result.events.some((event) => event.type === "guaranteed_output_delta" && event.delta === -15));
});

test("collection is inferred only when matching stock appears", () => {
  const result = diffCraftPlanProgressSnapshots(
    fixtureSnapshot({ craftPresent: true, sourceQuantity: 0 }),
    fixtureSnapshot({ craftPresent: false, sourceQuantity: 10 }),
  );
  const removed = result.events.find((event) => event.type === "craft_removed");
  assert.equal(removed.inference?.cause, "collected");
  assert.equal(removed.inference?.confidence, "medium");
  assert.match(removed.inference?.evidence.join(" "), /matching stock increase/i);
});

test("baseline changes are not reported as ordinary progress deltas", () => {
  const previous = fixtureSnapshot({ confirmed: 75, baselineRevision: "rev-a" });
  const current = fixtureSnapshot({ confirmed: 65, baselineRevision: "rev-b" });
  current.baselineInputs.config.targets[0].quantity = 120;
  const result = diffCraftPlanProgressSnapshots(previous, current);
  assert.equal(result.events.some((event) => event.type === "progress_delta"), false);
  assert.equal(result.events.some((event) => event.type === "baseline_change"), true);
  assert.match(result.baselineChange.reasons.join(" "), /target/i);
});

test("stale progress retains the complete last success and identifies failed sources", () => {
  const stale = staleCraftPlanProgress({
    confirmed: { overall: { completion: 72.8 }, sections: { Scholar: { completion: 47.5 } } },
    projected: { overall: { completion: 76.1 }, sections: { Scholar: { completion: 51 } } },
    overall: { completion: 72.8 },
    sections: { Scholar: { completion: 47.5 } },
    fishingVariants: { ocean: { overall: { completion: 70 } } },
    warnings: [],
    lastSuccessfulAt: "2026-07-24T09:00:00.000Z",
  }, [{
    sourceId: "player-1",
    label: "Mosswick inventory",
    type: "Player inventory",
    error: "HTTP 500",
  }], "2026-07-24T09:10:00.000Z");

  assert.equal(stale.overall.completion, 72.8);
  assert.equal(stale.confirmed.sections.Scholar.completion, 47.5);
  assert.equal(stale.fishingVariants.ocean.overall.completion, 70);
  assert.equal(stale.stale, true);
  assert.equal(stale.unavailableSources[0].label, "Mosswick inventory");
});

test("audit ranges are explicit and bounded by retention", () => {
  assert.deepEqual(
    normalizeCraftPlanAuditRange("24h", "2026-07-24T12:00:00.000Z"),
    { label: "24h", since: "2026-07-23T12:00:00.000Z" },
  );
  assert.equal(
    normalizeCraftPlanAuditRange("all", "2026-07-24T12:00:00.000Z").since,
    "2026-06-24T12:00:00.000Z",
  );
  assert.throws(
    () => normalizeCraftPlanAuditRange("30d", "2026-07-24T12:00:00.000Z"),
    /invalid audit range/i,
  );
});

function createTestRepository(clock) {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaBootstrapSql);
  applyAdditiveColumnMigrations(db);
  return createCraftPlanProgressAuditRepository(db, {
    statements: createPreparedStatements(db),
    now: () => clock.now,
    retentionDays: 14,
  });
}

test("repository deduplicates, checkpoints, survives failures, and exports retained history", () => {
  const clock = { now: "2026-07-24T12:00:00.000Z" };
  const repository = createTestRepository(clock);
  const first = repository.recordSuccess(fixtureSnapshot({ capturedAt: clock.now, confirmed: 50 }));
  const duplicate = repository.recordSuccess(fixtureSnapshot({
    capturedAt: "2026-07-24T12:01:00.000Z",
    confirmed: 50,
  }));
  assert.equal(first.recorded, true);
  assert.equal(first.fullSnapshot, true);
  assert.equal(duplicate.recorded, false);

  clock.now = "2026-07-24T18:01:00.000Z";
  const heartbeat = repository.recordSuccess(fixtureSnapshot({ capturedAt: clock.now, confirmed: 50 }));
  assert.equal(heartbeat.fullSnapshot, true);

  repository.recordFailure("1", [{ label: "Mosswick inventory", error: "HTTP 500" }], clock.now);
  repository.recordFailure("1", [{ label: "Mosswick inventory", error: "HTTP 500" }], "2026-07-24T18:02:00.000Z");
  assert.match(repository.status("1").lastError, /Mosswick inventory/);
  assert.equal(
    repository.listEvents("1", { since: "2026-07-24T18:00:00.000Z", limit: 100 })
      .filter((event) => event.eventType === "source_failure").length,
    1,
  );

  clock.now = "2026-07-24T18:03:00.000Z";
  const recovered = repository.recordSuccess(fixtureSnapshot({ capturedAt: clock.now, confirmed: 51 }));
  assert.equal(recovered.events.some((event) => event.type === "source_recovered"), true);
  assert.equal(repository.latestSuccess("1").effortProgress.confirmed.overall.completion, 51);
  assert.equal(repository.status("1").confirmedCompletion, 51);
  assert.equal(repository.status("1").projectedCompletion, 51);
  assert.equal(repository.status("1").baselineRevision, "rev-a");

  const bundle = repository.exportRange("1", {
    label: "all",
    since: "2026-07-10T18:03:00.000Z",
  });
  assert.equal(bundle.retentionDays, 14);
  assert.equal(bundle.claimId, "1");
  assert.ok(bundle.snapshots.length >= 1);
  assert.equal(JSON.stringify(bundle).includes("HTTP 500"), true);
});

test("repository records one baseline event and uses the new comparison epoch", () => {
  const clock = { now: "2026-07-24T12:00:00.000Z" };
  const repository = createTestRepository(clock);
  repository.recordSuccess(fixtureSnapshot({ capturedAt: clock.now, confirmed: 70, baselineRevision: "rev-a" }));
  clock.now = "2026-07-24T12:10:00.000Z";
  const next = fixtureSnapshot({ capturedAt: clock.now, confirmed: 50, baselineRevision: "rev-b" });
  next.baselineInputs.config.targets[0].quantity = 200;
  const result = repository.recordSuccess(next);
  assert.equal(result.fullSnapshot, true);
  assert.equal(result.baselineChanged, true);
  assert.equal(result.events.some((event) => event.type === "progress_delta"), false);
  assert.match(result.baselineChange.reasons.join(" "), /target/i);
});

test("audit snapshots retain exact identities while redacting credential values", () => {
  const snapshot = buildCraftPlanProgressSnapshot({
    claimId: "1",
    plan: {
      config: {
        targets: [{ id: "1", kind: "items", quantity: 10 }],
        sourceRules: { storageContainerIds: ["Scholar Storage Exact ID"] },
        apiToken: "must-not-export",
      },
      effortProgress: {
        baselineRevision: "rev-a",
        confirmed: { overall: { completion: 50 }, sections: {} },
        projected: { overall: { completion: 50 }, sections: {} },
        warnings: ["Request failed with Bearer must-not-export-either"],
      },
      materials: [{
        key: "items:1",
        name: "Ink",
        required: 10,
        missing: 5,
        available: 5,
        sources: [{ sourceId: "Scholar Storage Exact ID", label: "Tom's Scholar Storage", quantity: 5 }],
      }],
    },
    sourceStatus: [{
      sourceId: "Scholar Storage Exact ID",
      label: "Tom's Scholar Storage",
      available: false,
      error: "https://example.test/items?token=must-not-export",
    }],
  });
  const serialized = JSON.stringify(snapshot);
  assert.match(serialized, /Scholar Storage Exact ID/);
  assert.match(serialized, /Tom's Scholar Storage/);
  assert.doesNotMatch(serialized, /must-not-export/);
  assert.match(serialized, /\[REDACTED\]/);
});

test("audit export skips corrupt checkpoints with an explicit warning", () => {
  const clock = { now: "2026-07-24T12:00:00.000Z" };
  const db = new DatabaseSync(":memory:");
  db.exec(schemaBootstrapSql);
  applyAdditiveColumnMigrations(db);
  const repository = createCraftPlanProgressAuditRepository(db, {
    statements: createPreparedStatements(db),
    now: () => clock.now,
    retentionDays: 14,
  });
  repository.recordSuccess(fixtureSnapshot({ capturedAt: clock.now }));
  db.prepare("UPDATE craft_plan_progress_audit_snapshots SET payload_gzip = ?").run(Buffer.from("not-gzip"));

  const bundle = repository.exportRange("1", { label: "24h", since: "2026-07-23T12:00:00.000Z" });
  assert.equal(bundle.snapshots.length, 0);
  assert.match(bundle.warnings.join(" "), /corrupt snapshot/i);
  db.close();
});

test("audit pruning removes checkpoints and events older than retention", () => {
  const clock = { now: "2026-07-01T12:00:00.000Z" };
  const db = new DatabaseSync(":memory:");
  db.exec(schemaBootstrapSql);
  applyAdditiveColumnMigrations(db);
  const repository = createCraftPlanProgressAuditRepository(db, {
    statements: createPreparedStatements(db),
    now: () => clock.now,
    retentionDays: 14,
  });
  repository.recordSuccess(fixtureSnapshot({ capturedAt: clock.now, confirmed: 50 }));
  repository.recordSuccess(fixtureSnapshot({ capturedAt: "2026-07-01T12:01:00.000Z", confirmed: 51 }));
  clock.now = "2026-07-24T12:00:00.000Z";
  repository.recordSuccess(fixtureSnapshot({ capturedAt: clock.now, confirmed: 52 }));

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_snapshots WHERE captured_at < ?").get("2026-07-10T12:00:00.000Z").count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_events WHERE captured_at < ?").get("2026-07-10T12:00:00.000Z").count, 0);
  db.close();
});
