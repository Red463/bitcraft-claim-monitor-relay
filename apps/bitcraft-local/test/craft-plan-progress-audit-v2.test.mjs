import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createCraftPlanConfigAuditRepository } from "../src/server/craftPlanConfigAudit.mjs";
import {
  buildCraftPlanProgressSnapshot,
  createCraftPlanProgressAuditRepository,
  diffCraftPlanProgressSnapshots,
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

function v1Snapshot(options = {}) {
  const snapshot = v2Snapshot(options);
  const {
    buildingCompletion: _buildingCompletion,
    validation: _validation,
    ...legacySnapshot
  } = snapshot;
  return {
    ...legacySnapshot,
    schemaVersion: 1,
    planInputs: Object.fromEntries(
      Object.entries(snapshot.planInputs).filter(([key]) => key !== "routeReviews"),
    ),
    materials: snapshot.materials.map((material) => {
      const {
        planRequired: _planRequired,
        requiredNow: _requiredNow,
        missingNow: _missingNow,
        visibleStock: _visibleStock,
        guaranteedCraftOutput: _guaranteedCraftOutput,
        estimatedCraftOutput: _estimatedCraftOutput,
        dependencyPaths: _dependencyPaths,
        ...legacy
      } = material;
      return legacy;
    }),
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

test("dependency topology does not hide unsupported demand and progress relationships", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot());
  repository.recordSuccess(v2Snapshot({
    capturedAt: "2026-08-28T10:05:00.000Z",
    required: 120,
    requiredNow: 120,
    missing: 60,
    completion: 55,
  }));

  const group = repository.queryCausalGroups("42", { planId: "legacy-primary" }).causalGroups[0];
  assert.deepEqual(group.dependencyPaths, [{ materialKey: "items:1", paths: [["items:9", "items:1"]] }]);
  assert.ok(group.unresolvedRelationships.some((entry) => entry.effectType === "requirement_delta"));
  assert.ok(group.unresolvedRelationships.some((entry) => entry.effectType === "progress_delta"));
  db.close();
});

test("causal diff resolves v1 and v2 material aliases independently without fabricated deltas", () => {
  const from = v1Snapshot();
  const unchanged = v2Snapshot({ capturedAt: "2026-08-28T10:05:00.000Z" });
  const unchangedEvents = diffCraftPlanProgressSnapshots(from, unchanged).events;

  assert.deepEqual(
    unchangedEvents.filter((event) => event.type.endsWith("_delta") && event.itemKey === "items:1"),
    [],
  );

  const changed = v2Snapshot({
    capturedAt: "2026-08-28T10:05:00.000Z",
    required: 120,
    requiredNow: 110,
    missing: 55,
    guaranteed: 10,
    estimated: 2,
  });
  const changedEvents = diffCraftPlanProgressSnapshots(from, changed).events
    .filter((event) => event.type.endsWith("_delta") && event.itemKey === "items:1")
    .map(({ type, before, after, delta }) => ({ type, before, after, delta }));
  assert.deepEqual(changedEvents, [
    { type: "requirement_delta", before: 100, after: 120, delta: 20 },
    { type: "required_now_delta", before: 100, after: 110, delta: 10 },
    { type: "guaranteed_output_delta", before: 20, after: 10, delta: -10 },
    { type: "estimated_output_delta", before: 5, after: 2, delta: -3 },
    { type: "missing_quantity_delta", before: 40, after: 55, delta: 15 },
  ]);
});

test("craft collection inference requires an exact captured output-to-stock relationship", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot());
  repository.recordSuccess(v2Snapshot({
    capturedAt: "2026-08-28T10:05:00.000Z",
    craftPresent: false,
    available: 41,
    guaranteed: 0,
    estimated: 0,
  }));

  const group = repository.queryCausalGroups("42", { planId: "legacy-primary" }).causalGroups[0];
  const removal = group.events.find((event) => event.type === "craft_removed");
  assert.equal(removal.inference, undefined);
  assert.ok(group.unresolvedRelationships.some((entry) => entry.effectType === "craft_removed"));
  db.close();
});

test("baseline changes retain simultaneous progress effects", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot());
  repository.recordSuccess(v2Snapshot({
    capturedAt: "2026-08-28T10:05:00.000Z",
    baselineRevision: "baseline-b",
    catalogRevision: "catalog-b",
    completion: 55,
  }));

  const group = repository.queryCausalGroups("42", { planId: "legacy-primary" }).causalGroups[0];
  assert.ok(group.events.some((event) => event.type === "baseline_change"));
  assert.ok(group.events.some((event) => event.type === "progress_delta"));
  assert.ok(group.derivedEffects.some((effect) => effect.category === "progress_change"));
  db.close();
});

test("source failures create immediate deterministic causal evidence", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot());
  const failure = [{ sourceId: "storage-1", label: "Storage", type: "Settlement storage", error: "timed out" }];

  repository.recordFailure("42", failure, "2026-08-28T10:05:00.000Z", "legacy-primary");
  repository.recordFailure("42", failure, "2026-08-28T10:06:00.000Z", "legacy-primary");

  const result = repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "source_health" });
  assert.equal(result.pagination.total, 1);
  const group = result.causalGroups[0];
  assert.deepEqual(group.span, { from: "2026-08-28T10:00:00.000Z", to: "2026-08-28T10:05:00.000Z" });
  assert.ok(group.observedTriggers.some((entry) => entry.type === "source_failure"));
  assert.ok(group.unresolvedRelationships.some((entry) => entry.triggerType === "source_failure"));
  assert.deepEqual(group.events.map((event) => event.type), ["source_failure"]);
  db.close();
});

test("ordinary five-minute causal checkpoints compare from stored evidence", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot());
  const changed = repository.recordSuccess(v2Snapshot({
    capturedAt: "2026-08-28T10:05:00.000Z",
    available: 50,
    missing: 30,
    completion: 70,
  }));

  assert.equal(changed.fullSnapshot, false);
  const group = repository.queryCausalGroups("42", { planId: "legacy-primary" }).causalGroups[0];
  const comparison = repository.compareCheckpoints("42", {
    planId: "legacy-primary",
    from: group.span.from,
    to: group.span.to,
  });
  assert.equal(comparison.ok, true);
  assert.equal(comparison.checkpoints.to.capturedAt, "2026-08-28T10:05:00.000Z");
  assert.equal(comparison.differences.materials.changed, true);
  assert.equal(comparison.differences.buildingProgress.changed, true);
  db.close();
});

test("one stock increase cannot collect two simultaneous equal-output crafts", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  const previous = v2Snapshot({ guaranteed: 20, estimated: 0 });
  const craft = previous.materials[0].activeCraftSources[0];
  previous.materials[0].activeCraftSources = [
    { ...craft, craftId: "craft-a", guaranteedQuantity: 10, estimatedQuantity: 0 },
    { ...craft, craftId: "craft-b", guaranteedQuantity: 10, estimatedQuantity: 0 },
  ];
  repository.recordSuccess(previous);
  repository.recordSuccess(v2Snapshot({
    capturedAt: "2026-08-28T10:05:00.000Z",
    available: 50,
    guaranteed: 0,
    estimated: 0,
    craftPresent: false,
  }));

  const group = repository.queryCausalGroups("42", { planId: "legacy-primary" }).causalGroups[0];
  const removals = group.events.filter((event) => event.type === "craft_removed");
  assert.equal(removals.length, 2);
  assert.deepEqual(removals.map((event) => event.inference), [undefined, undefined]);
  assert.equal(group.unresolvedRelationships.filter((entry) => entry.effectType === "craft_removed").length, 2);
  db.close();
});

test("export keeps event and causal ranges anchored to the request before the first snapshot", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordFailure("42", [{ sourceId: "storage-1", label: "Storage", error: "offline" }], "2026-08-28T10:05:00.000Z", "legacy-primary");
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T10:10:00.000Z" }));

  const bundle = repository.exportRange("42", { label: "24h", since: "2026-08-28T10:00:00.000Z" }, "legacy-primary");
  assert.equal(bundle.effectiveSince, "2026-08-28T10:10:00.000Z");
  assert.ok(bundle.events.some((event) => event.type === "source_failure" && event.capturedAt === "2026-08-28T10:05:00.000Z"));
  assert.ok(bundle.causalGroups.some((group) => group.observedTriggers.some((entry) => entry.type === "source_failure")));
  db.close();
});

test("first successful capture after failure creates a recovery causal group", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordFailure("42", [{ sourceId: "storage-1", label: "Storage", error: "offline" }], "2026-08-28T10:05:00.000Z", "legacy-primary");
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T10:10:00.000Z" }));

  const result = repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "source_health" });
  assert.equal(result.pagination.total, 2);
  const recovered = result.causalGroups.find((group) => group.observedTriggers.some((entry) => entry.type === "source_recovered"));
  assert.deepEqual(recovered.span, { from: "2026-08-28T10:05:00.000Z", to: "2026-08-28T10:10:00.000Z" });
  assert.ok(recovered.unresolvedRelationships.some((entry) => entry.triggerType === "source_recovered"));
  db.close();
});

test("unchanged success after failure records recovery without duplicating the snapshot", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  const initial = v2Snapshot();
  repository.recordSuccess(initial);
  repository.recordFailure("42", [{ sourceId: "storage-1", label: "Storage", error: "offline" }], "2026-08-28T10:05:00.000Z", "legacy-primary");

  const recovery = repository.recordSuccess({ ...initial, capturedAt: "2026-08-28T10:10:00.000Z" });

  assert.equal(recovery.recorded, false);
  assert.deepEqual(recovery.events.map((event) => event.type), ["source_recovered"]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_snapshots").get().count, 1);
  const state = db.prepare("SELECT * FROM craft_plan_progress_audit_state WHERE claim_id = '42' AND plan_id = 'legacy-primary'").get();
  assert.equal(state.last_failure_fingerprint, null);
  assert.equal(state.last_error, null);
  assert.equal(state.last_success_at, "2026-08-28T10:10:00.000Z");
  const recovered = repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "source_health" })
    .causalGroups.find((group) => group.observedTriggers.some((entry) => entry.type === "source_recovered"));
  assert.deepEqual(recovered.span, { from: "2026-08-28T10:05:00.000Z", to: "2026-08-28T10:10:00.000Z" });
  db.close();
});

test("duplicate success repairs a corrupt state payload without storing a duplicate snapshot", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  const initial = v2Snapshot();
  repository.recordSuccess(initial);
  db.prepare("UPDATE craft_plan_progress_audit_state SET last_payload_gzip = ? WHERE claim_id = '42' AND plan_id = 'legacy-primary'")
    .run(Buffer.from("corrupt"));

  const result = repository.recordSuccess({ ...initial, capturedAt: "2026-08-28T10:05:00.000Z" });

  assert.equal(result.recorded, false);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_snapshots").get().count, 1);
  assert.equal(repository.latestSuccess("42").capturedAt, "2026-08-28T10:05:00.000Z");
  db.close();
});

test("six-hour duplicate checkpoint replaces a corrupt state payload with valid current evidence", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  const initial = v2Snapshot();
  repository.recordSuccess(initial);
  db.prepare("UPDATE craft_plan_progress_audit_state SET last_payload_gzip = ? WHERE claim_id = '42' AND plan_id = 'legacy-primary'")
    .run(Buffer.from("corrupt"));
  const checkpoint = { ...initial, capturedAt: "2026-08-28T16:00:00.000Z" };

  const result = repository.recordSuccess(checkpoint);

  assert.equal(result.recorded, true);
  assert.equal(result.fullSnapshot, true);
  assert.equal(repository.latestSuccess("42").capturedAt, checkpoint.capturedAt);
  assert.equal(repository.compareCheckpoints("42", {
    planId: "legacy-primary",
    from: initial.capturedAt,
    to: checkpoint.capturedAt,
  }).ok, true);
  db.close();
});

test("source failure falls back from corrupt state evidence to the latest valid checkpoint", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot());
  db.prepare("UPDATE craft_plan_progress_audit_state SET last_payload_gzip = ? WHERE claim_id = '42' AND plan_id = 'legacy-primary'")
    .run(Buffer.from("corrupt"));

  const result = repository.recordFailure("42", [{ sourceId: "storage-1", label: "Storage", error: "offline" }], "2026-08-28T10:05:00.000Z", "legacy-primary");

  assert.equal(result.recorded, true);
  const group = repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "source_health" }).causalGroups[0];
  assert.deepEqual(group.span, { from: "2026-08-28T10:00:00.000Z", to: "2026-08-28T10:05:00.000Z" });
  assert.ok(group.observedTriggers.some((entry) => entry.type === "source_failure"));
  assert.equal(repository.status("42").lastError, "Storage: offline");
  db.close();
});

test("recent events honor an exact until bound", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordFailure("42", [{ sourceId: "storage-1", label: "Storage", error: "offline" }], "2026-08-28T10:00:00.000Z", "legacy-primary");
  repository.recordFailure("42", [{ sourceId: "storage-1", label: "Storage", error: "still offline" }], "2026-08-28T11:00:00.000Z", "legacy-primary");

  const events = repository.listEvents("42", {
    planId: "legacy-primary",
    since: "2026-08-28T09:00:00.000Z",
    until: "2026-08-28T10:30:00.000Z",
    limit: 100,
  });

  assert.deepEqual(events.map((event) => event.capturedAt), ["2026-08-28T10:00:00.000Z"]);
  db.close();
});

test("structured validation diagnostics survive repository reconstruction", () => {
  const { db, statements } = database();
  createCraftPlanProgressAuditRepository(db, { statements }).recordFailure("42", [{
    sourceId: "craft-plan-validation",
    label: "Craft Plan calculation validation",
    type: "Planner validation",
    error: "1 calculation invariant failed.",
    diagnostic: {
      baselineRevision: "baseline-a",
      retainedLastGood: true,
      errors: [{
        code: "incomplete_recipe_expansion",
        path: "steps[0].selectedRecipeId",
        message: "Selected recipe expansion is incomplete.",
        outputKey: "items:9",
        token: "must-not-persist",
      }],
      authorization: "Bearer must-not-persist",
    },
  }], "2026-08-28T10:05:00.000Z", "legacy-primary");

  const reconstructed = createCraftPlanProgressAuditRepository(db, { statements });
  assert.deepEqual(reconstructed.status("42", "legacy-primary").validationWarning, {
    at: "2026-08-28T10:05:00.000Z",
    planId: "legacy-primary",
    baselineRevision: "baseline-a",
    retainedLastGood: true,
    errors: [{
      code: "incomplete_recipe_expansion",
      path: "steps[0].selectedRecipeId",
      message: "Selected recipe expansion is incomplete.",
      outputKey: "items:9",
    }],
  });
  db.close();
});

test("source failure scans past more than 25 corrupt checkpoints to older valid evidence", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T09:00:00.000Z" }));
  for (let index = 1; index <= 26; index += 1) {
    repository.recordSuccess(v2Snapshot({
      capturedAt: new Date(Date.parse("2026-08-28T09:00:00.000Z") + index * 60_000).toISOString(),
      available: 40 + index,
      missing: 40 - index,
    }));
  }
  db.prepare("UPDATE craft_plan_progress_audit_snapshots SET payload_gzip = ? WHERE captured_at > '2026-08-28T09:00:00.000Z'")
    .run(Buffer.from("corrupt"));
  db.prepare("UPDATE craft_plan_progress_audit_state SET last_payload_gzip = ? WHERE claim_id = '42' AND plan_id = 'legacy-primary'")
    .run(Buffer.from("corrupt"));

  repository.recordFailure("42", [{ sourceId: "storage-1", label: "Storage", error: "offline" }], "2026-08-28T10:00:00.000Z", "legacy-primary");

  const group = repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "source_health" }).causalGroups[0];
  assert.deepEqual(group.span, { from: "2026-08-28T09:00:00.000Z", to: "2026-08-28T10:00:00.000Z" });
  assert.equal(group.unresolvedRelationships.some((entry) => /no valid prior success checkpoint/i.test(entry.reason)), false);
  db.close();
});

test("source failure records a prior-evidence limitation when no valid checkpoint exists", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });

  repository.recordFailure("42", [{ sourceId: "storage-1", label: "Storage", error: "offline" }], "2026-08-28T10:05:00.000Z", "legacy-primary");

  const group = repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "source_health" }).causalGroups[0];
  assert.ok(group.unresolvedRelationships.some((entry) => /no valid prior success checkpoint/i.test(entry.reason)));
  db.close();
});

test("export falls back through a corrupt pre-range checkpoint to older valid evidence", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T09:00:00.000Z" }));
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T09:30:00.000Z", available: 45, missing: 35 }));
  repository.recordSuccess(v2Snapshot({ capturedAt: "2026-08-28T10:10:00.000Z", available: 50, missing: 30 }));
  db.prepare("UPDATE craft_plan_progress_audit_snapshots SET payload_gzip = ? WHERE captured_at = '2026-08-28T09:30:00.000Z'")
    .run(Buffer.from("corrupt"));

  const bundle = repository.exportRange("42", { label: "24h", since: "2026-08-28T10:00:00.000Z" }, "legacy-primary");

  assert.equal(bundle.effectiveSince, "2026-08-28T10:00:00.000Z");
  assert.deepEqual(bundle.snapshots.map((snapshot) => snapshot.capturedAt), [
    "2026-08-28T09:00:00.000Z",
    "2026-08-28T10:10:00.000Z",
  ]);
  assert.ok(bundle.warnings.some((warning) => /skipped corrupt snapshot/i.test(warning)));
  db.close();
});

test("export reports an unavailable effective boundary when no snapshot evidence exists", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });

  const bundle = repository.exportRange("42", { label: "24h", since: "2026-08-28T10:00:00.000Z" }, "legacy-primary");

  assert.equal(bundle.effectiveSince, null);
  assert.deepEqual(bundle.snapshots, []);
  assert.ok(bundle.warnings.some((warning) => /no valid checkpoint.*reconstruct/i.test(warning)));
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

test("v1 to v2 comparison resolves unchanged material aliases independently per side", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  const from = v1Snapshot();
  const to = v2Snapshot({ capturedAt: "2026-08-28T17:00:00.000Z" });
  repository.recordSuccess(from);
  repository.recordSuccess(to);

  const result = repository.compareCheckpoints("42", { planId: "legacy-primary", from: from.capturedAt, to: to.capturedAt });

  assert.equal(result.ok, true);
  for (const category of ["baseline", "routeConfig", "materials", "sources", "craft", "buildingProgress", "validation"]) {
    assert.equal(result.differences[category].changed, false, category);
  }
  assert.equal(result.compatibility.legacyEvidence, true);
  assert.match(result.compatibility.limitations.join(" "), /schema version 1/i);
  db.close();
});

test("v1 to v2 comparison reports real changed alias values without zero substitution", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  const from = v1Snapshot();
  const to = v2Snapshot({
    capturedAt: "2026-08-28T17:00:00.000Z",
    required: 120,
    requiredNow: 110,
    missing: 55,
    available: 50,
    guaranteed: 10,
    estimated: 2,
  });
  repository.recordSuccess(from);
  repository.recordSuccess(to);

  const result = repository.compareCheckpoints("42", { planId: "legacy-primary", from: from.capturedAt, to: to.capturedAt });

  assert.equal(result.differences.materials.changed, true);
  assert.equal(result.differences.routeConfig.changed, false);
  assert.equal(result.differences.validation.changed, false);
  assert.deepEqual(result.differences.materials.before[0], {
    estimatedCraftOutput: 5,
    guaranteedCraftOutput: 20,
    key: "items:1",
    missingNow: 40,
    name: "Timber",
    planRequired: 100,
    requiredNow: 100,
    visibleStock: 40,
  });
  assert.deepEqual(result.differences.materials.after[0], {
    estimatedCraftOutput: 2,
    guaranteedCraftOutput: 10,
    key: "items:1",
    missingNow: 55,
    name: "Timber",
    planRequired: 120,
    requiredNow: 110,
    visibleStock: 50,
  });
  assert.equal(result.compatibility.legacyEvidence, true);
  assert.match(result.compatibility.limitations.join(" "), /historical values are not reconstructed/i);
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

test("interactive causal pagination and filters account for every retained group beyond 10000", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  for (let index = 0; index < 10_005; index += 1) {
    const capturedAt = "2026-08-28T10:00:00.000Z";
    const sourceHealth = index < 5;
    const group = {
      groupId: `group-${index}`,
      span: { from: capturedAt, to: capturedAt },
      observedTriggers: [{ category: sourceHealth ? "source_health" : "stock_movement", type: sourceHealth ? "source_failure" : "stock_delta", materialKey: sourceHealth ? null : "items:1" }],
      derivedEffects: [], dependencyPaths: [], unresolvedRelationships: sourceHealth ? [{ triggerType: "source_failure" }] : [], materialKeys: sourceHealth ? [] : ["items:1"], events: [],
    };
    statements.insertCraftPlanProgressCausalGroup.run("42", "legacy-primary", group.groupId, capturedAt, capturedAt, JSON.stringify(group));
  }

  const lastPage = repository.queryCausalGroups("42", { planId: "legacy-primary", page: 51, pageSize: 200 });
  assert.deepEqual(lastPage.pagination, { page: 51, pageSize: 200, total: 10_005, totalPages: 51, hasNext: false, hasPrevious: true });
  assert.equal(lastPage.causalGroups.length, 5);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", triggerCategory: "source_health" }).pagination.total, 5);
  assert.equal(repository.queryCausalGroups("42", { planId: "legacy-primary", unresolvedOnly: true }).pagination.total, 5);
  db.close();
});

test("v2 export includes every matching causal group and event beyond 10000", () => {
  const { db, statements } = database();
  const repository = createCraftPlanProgressAuditRepository(db, { statements });
  for (let index = 0; index < 10_005; index += 1) {
    const capturedAt = "2026-08-28T10:00:00.000Z";
    const group = {
      groupId: `group-${index}`,
      span: { from: capturedAt, to: capturedAt },
      observedTriggers: [], derivedEffects: [], dependencyPaths: [], unresolvedRelationships: [], materialKeys: [], events: [],
    };
    statements.insertCraftPlanProgressCausalGroup.run("42", "legacy-primary", group.groupId, capturedAt, capturedAt, JSON.stringify(group));
    statements.insertCraftPlanProgressEvent.run("42", "legacy-primary", capturedAt, "baseline-a", "test_event", `event ${index}`, JSON.stringify({ type: "test_event", index }));
  }

  const bundle = repository.exportRange("42", { label: "24h", since: "2026-08-28T00:00:00.000Z" }, "legacy-primary");
  assert.equal(bundle.causalGroups.length, 10_005);
  assert.equal(bundle.events.length, 10_005);
  db.close();
});
