import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createCraftPlanConfigAuditRepository } from "../src/server/craftPlanConfigAudit.mjs";
import {
  buildCraftPlanProgressSnapshot,
  createCraftPlanProgressAuditRepository,
} from "../src/server/craftPlanProgressAudit.mjs";
import { applyCraftPlanRecordsMigration } from "../src/server/craftPlanRepository.mjs";
import { createPreparedStatements } from "../src/server/preparedStatements.mjs";
import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import { applyAdditiveColumnMigrations } from "../src/server/schemaMigrations.mjs";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  applyCraftPlanRecordsMigration(db, { now: () => "2026-08-01T00:00:00.000Z" });
  applyAdditiveColumnMigrations(db);
  const statements = createPreparedStatements(db);
  return {
    db,
    statements,
    configAudit: createCraftPlanConfigAuditRepository(db, { statements }),
  };
}

function v2Snapshot({
  capturedAt = "2026-08-28T10:00:00.000Z",
  planId = "legacy-primary",
  baselineRevision = "baseline-a",
  catalogRevision = "catalog-a",
  required = 100,
  requiredNow = required,
  available = 40,
  missing = 40,
  guaranteed = 20,
  estimated = 5,
  craftPresent = true,
  route = "recipe-a",
  sourceAvailable = true,
  buildingCompletion = 25,
  completion = 60,
  validation = { valid: true, errors: [] },
  dependencyPaths = [["items:9", "items:1"]],
} = {}) {
  return {
    schemaVersion: 2,
    claimId: "42",
    planId,
    capturedAt,
    baselineRevision,
    baselineInputs: {
      config: { targets: [{ id: "9", kind: "items", quantity: 1 }], routeOverrides: { "items:9": route }, gatheredItemKeys: [], multipliers: {} },
      catalogRevision,
      modelVersion: 4,
    },
    planInputs: {
      targets: [{ id: "9", kind: "items", quantity: 1 }],
      routeOverrides: { "items:9": route },
      routeReviews: {},
      gatheredItemKeys: [],
      multipliers: {},
      sourceRules: { storageContainerIds: ["storage-1"], playerIds: [], craftPlayerIds: [], bankPlayerIds: [], bankContainerIds: [], deployableContainerIds: [] },
      buildingProgress: { "building-1": buildingCompletion },
    },
    planConfigFingerprint: `fingerprint-${capturedAt}`,
    progress: { confirmed: completion, projected: completion + 5 },
    effortProgress: { baselineRevision, confirmed: { overall: { completion } }, projected: { overall: { completion: completion + 5 } } },
    buildingCompletion: { "building-1": buildingCompletion },
    validation,
    materials: [
      {
        key: "items:1", name: "Timber", planRequired: required, requiredNow, missingNow: missing,
        required: requiredNow, missing, visibleStock: available, available,
        guaranteedCraftOutput: guaranteed, estimatedCraftOutput: estimated,
        guaranteedInProgress: guaranteed, estimatedInProgress: estimated,
        dependencyPaths,
        sources: [{ sourceId: "storage-1", label: "Storage", type: "Settlement storage", quantity: available }],
        activeCraftSources: craftPresent ? [{ craftId: "craft-1", playerId: "7", buildingId: "8", status: "active", guaranteedQuantity: guaranteed, estimatedQuantity: estimated }] : [],
      },
      {
        key: "cargo:1", name: "Timber Cargo", planRequired: 2, requiredNow: 2, missingNow: 2,
        required: 2, missing: 2, visibleStock: 0, available: 0,
        guaranteedCraftOutput: 0, estimatedCraftOutput: 0,
        guaranteedInProgress: 0, estimatedInProgress: 0,
        dependencyPaths: [["cargo:1"]], sources: [], activeCraftSources: [],
      },
    ],
    sourceStatus: [{ sourceId: "storage-1", label: "Storage", type: "Settlement storage", available: sourceAvailable }],
    metadata: { appVersion: "0.2.0", buildId: "build", catalogRevision, modelVersion: 4 },
  };
}

test("v2 snapshot preserves stable/live aliases, visible stock, craft estimates, building completion, and typed dependency paths", () => {
  const snapshot = buildCraftPlanProgressSnapshot({
    claimId: "42",
    plan: {
      plan: { id: "legacy-primary" },
      config: { targets: [{ id: "9", kind: "items", quantity: 1 }], routeOverrides: {}, routeReviews: {}, sourceRules: {}, buildingProgress: { "building-1": 25 } },
      validation: { valid: true, errors: [] },
      steps: [{ output: { id: "9", kind: "items" }, inputs: [{ id: "1", kind: "items" }] }],
      effortProgress: { baselineRevision: "baseline-a", confirmed: { overall: { completion: 40 } }, projected: { overall: { completion: 50 } } },
      materials: [
        { key: "items:1", planRequired: 12, requiredNow: 8, missingNow: 3, required: 8, missing: 3, available: 4, guaranteedInProgress: 1, estimatedInProgress: 2 },
        { key: "cargo:1", planRequired: 2, requiredNow: 2, missingNow: 2, required: 2, missing: 2, available: 0, dependencyPaths: [["cargo:1"]] },
      ],
    },
  });

  assert.equal(snapshot.schemaVersion, 2);
  assert.deepEqual(snapshot.materials.map((row) => row.key), ["cargo:1", "items:1"]);
  const item = snapshot.materials.find((row) => row.key === "items:1");
  assert.deepEqual({
    planRequired: item.planRequired,
    requiredNow: item.requiredNow,
    missingNow: item.missingNow,
    required: item.required,
    missing: item.missing,
    visibleStock: item.visibleStock,
    guaranteedCraftOutput: item.guaranteedCraftOutput,
    estimatedCraftOutput: item.estimatedCraftOutput,
  }, { planRequired: 12, requiredNow: 8, missingNow: 3, required: 8, missing: 3, visibleStock: 4, guaranteedCraftOutput: 1, estimatedCraftOutput: 2 });
  assert.deepEqual(item.dependencyPaths, [["items:9", "items:1"]]);
  assert.deepEqual(snapshot.buildingCompletion, { "building-1": 25 });
});

test("causal replay attributes craft disappearance and stock arrival without inventing requirement causality", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot());
  repository.recordSuccess(v2Snapshot({
    capturedAt: "2026-08-28T10:05:00.000Z",
    craftPresent: false,
    available: 60,
    guaranteed: 0,
    estimated: 0,
    missing: 40,
    completion: 60,
  }));

  const result = repository.queryCausalGroups("42", { planId: "legacy-primary", page: 1, pageSize: 10 });
  assert.equal(result.pagination.total, 1);
  const group = result.causalGroups[0];
  assert.deepEqual(group.span, { from: "2026-08-28T10:00:00.000Z", to: "2026-08-28T10:05:00.000Z" });
  assert.ok(group.observedTriggers.some((trigger) => trigger.category === "craft_transition"));
  assert.ok(group.observedTriggers.some((trigger) => trigger.category === "stock_movement"));
  assert.ok(group.derivedEffects.some((effect) => effect.category === "craft_output_change"));
  assert.deepEqual(group.dependencyPaths, [{ materialKey: "items:1", paths: [["items:9", "items:1"]] }]);
  assert.equal(group.unresolvedRelationships.length, 0);
  assert.equal(group.unresolvedRelationships.some((row) => row.effectType === "requirement_delta"), false);
  assert.equal(group.events.some((event) => event.type === "requirement_delta"), false);
  db.close();
});

test("causal groups preserve typed identities, unresolved evidence, bounded pagination, and every filter", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot({ dependencyPaths: [] }));
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T11:00:00.000Z", required: 120, requiredNow: 120, missing: 60, dependencyPaths: [] }));
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T12:00:00.000Z", required: 120, requiredNow: 120, missing: 60, sourceAvailable: false, dependencyPaths: [] }));

  const page = repository.queryCausalGroups("42", { planId: "legacy-primary", page: 1, pageSize: 1 });
  assert.equal(page.pagination.total, 2);
  assert.equal(page.pagination.totalPages, 2);
  assert.equal(page.causalGroups.length, 1);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", since: "2026-08-28T11:30:00.000Z", until: "2026-08-28T12:30:00.000Z" }).pagination.total, 1);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "source_health" }).pagination.total, 1);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", effectCategory: "demand_change" }).pagination.total, 1);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", materialKey: "items:1" }).pagination.total, 1);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", materialKey: "cargo:1" }).pagination.total, 0);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", unresolvedOnly: true }).pagination.total, 1);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", pageSize: 999 }).pagination.pageSize, 200);
  db.close();
});

test("comparison reconstructs stored v2 checkpoints across every evidence category", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  const from = v2Snapshot();
  const to = v2Snapshot({
    capturedAt: "2026-08-28T17:00:00.000Z",
    baselineRevision: "baseline-b",
    catalogRevision: "catalog-b",
    required: 120,
    requiredNow: 110,
    missing: 55,
    available: 55,
    guaranteed: 0,
    estimated: 0,
    craftPresent: false,
    route: "recipe-b",
    sourceAvailable: false,
    buildingCompletion: 50,
    completion: 45,
    validation: { valid: false, errors: [{ code: "source_unavailable" }] },
  });
  repository.recordSuccess(from);
  repository.recordSuccess(to);

  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "plan_config_save" }).pagination.total, 1);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "catalogue_baseline_change" }).pagination.total, 1);

  const result = repository.compareCheckpoints("42", { planId: "legacy-primary", from: from.capturedAt, to: to.capturedAt });
  assert.equal(result.ok, true);
  for (const category of ["baseline", "routeConfig", "materials", "sources", "craft", "buildingProgress", "validation"]) {
    assert.equal(result.differences[category].changed, true, category);
  }
  assert.equal(result.checkpoints.from.capturedAt, from.capturedAt);
  assert.equal(result.checkpoints.to.capturedAt, to.capturedAt);
  db.close();
});

test("comparison reports missing and corrupt evidence and accepts v1 with explicit legacy limitations", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  assert.equal(repository.compareCheckpoints("42", { planId: "legacy-primary", from: "missing", to: "also-missing" }).error.code, "missing_evidence");

  const legacyFrom = { ...v2Snapshot(), schemaVersion: 1 };
  delete legacyFrom.buildingCompletion;
  const legacyTo = { ...v2Snapshot({ capturedAt: "2026-08-28T17:00:00.000Z", available: 50 }), schemaVersion: 1 };
  delete legacyTo.buildingCompletion;
  repository.recordSuccess(legacyFrom);
  repository.recordSuccess(legacyTo);
  const legacy = repository.compareCheckpoints("42", { planId: "legacy-primary", from: legacyFrom.capturedAt, to: legacyTo.capturedAt });
  assert.equal(legacy.ok, true);
  assert.equal(legacy.compatibility.legacyEvidence, true);
  assert.match(legacy.compatibility.limitations.join(" "), /schema version 1/i);

  db.prepare("UPDATE craft_plan_progress_audit_snapshots SET payload_gzip = ? WHERE captured_at = ?").run(Buffer.from("corrupt"), legacyTo.capturedAt);
  const corrupt = repository.compareCheckpoints("42", { planId: "legacy-primary", from: legacyFrom.capturedAt, to: legacyTo.capturedAt });
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.error.code, "corrupt_evidence");
  db.close();
});

test("30-day pruning keeps the boundary and never prunes lifetime config history", () => {
  const { db, statements, configAudit } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements, now: () => "2026-08-31T00:00:00.000Z" });
  configAudit.record({
    planId: "legacy-primary", actor: { type: "admin", id: "1", displayName: "Admin" },
    occurredAt: "2020-01-01T00:00:00.000Z", previousRevision: 1, newRevision: 2, action: "update", before: {}, after: {},
  });
  const old = v2Snapshot({ capturedAt: "2026-07-31T23:59:59.999Z" });
  const boundary = v2Snapshot({ capturedAt: "2026-08-01T00:00:00.000Z", baselineRevision: "baseline-b", required: 101 });
  repository.recordSuccess(old);
  repository.recordSuccess(boundary);
  repository.prune("2026-08-31T00:00:00.000Z");

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_snapshots WHERE captured_at < '2026-08-01T00:00:00.000Z'").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_snapshots WHERE captured_at = '2026-08-01T00:00:00.000Z'").get().count, 1);
  assert.equal(configAudit.listForPlan("legacy-primary").length, 1);
  assert.equal(repository.status("42").retentionDays, 30);
  db.close();
});

test("v2 export matches snapshots, events, config history, causal groups, and compatibility limitations", () => {
  const { db, statements, configAudit } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  configAudit.record({
    planId: "legacy-primary", claimId: "42", actor: { type: "admin", id: "1", displayName: "Admin" },
    occurredAt: "2026-08-28T09:00:00.000Z", previousRevision: 1, newRevision: 2, action: "update", before: {}, after: { enabled: true },
  });
  repository.recordSuccess({ ...v2Snapshot(), schemaVersion: 1 });
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T17:00:00.000Z", available: 50, missing: 30 }));

  const bundle = repository.exportRange("42", { label: "24h", since: "2026-08-28T00:00:00.000Z" }, "legacy-primary");
  assert.equal(bundle.schemaVersion, 2);
  assert.ok(bundle.snapshots.length >= 2);
  assert.ok(bundle.events.length >= 1);
  assert.equal(bundle.configHistory.length, 1);
  assert.equal(bundle.causalGroups.length, 1);
  assert.equal(bundle.compatibility.legacyEvidence, true);
  assert.match(bundle.compatibility.limitations.join(" "), /schema version 1/i);
  db.close();
});

test("v2 export never truncates matching causal groups at internal query bounds", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  for (let index = 0; index < 10_005; index += 1) {
    const capturedAt = "2026-08-28T10:00:00.000Z";
    const group = {
      groupId: `group-${index}`,
      span: { from: capturedAt, to: capturedAt },
      observedTriggers: [{ category: "stock_movement", type: "stock_delta", materialKey: "items:1" }],
      derivedEffects: [], dependencyPaths: [], unresolvedRelationships: [], materialKeys: ["items:1"], events: [],
    };
    statements.insertCraftPlanProgressCausalGroup.run("42", "legacy-primary", group.groupId, capturedAt, capturedAt, JSON.stringify(group));
  }

  const bundle = repository.exportRange("42", { label: "24h", since: "2026-08-28T00:00:00.000Z" }, "legacy-primary");
  assert.equal(bundle.causalGroups.length, 10_005);
  db.close();
});
