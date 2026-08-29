import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createCraftPlanLastGoodPublicationRepository, resolveFailedCraftPlanPublication } from "../src/server/craftPlanPublication.mjs";

function invalidValidation() {
  return {
    valid: false,
    baselineRevision: "baseline-1",
    errors: [{
      code: "invalid_material_quantity",
      path: "gatherNext[0].items[0].requiredNow",
      message: "requiredNow must be a finite non-negative number.",
    }],
  };
}

function harness() {
  const validationWarnings = new Map();
  const recordedFailures = [];
  return {
    validationWarnings,
    recordedFailures,
    progressAudit: {
      recordFailure(...args) {
        recordedFailures.push(args);
      },
      latestSuccess() {
        return null;
      },
    },
  };
}

test("server publication failure records diagnostics and returns cached last-good as stale", () => {
  const state = harness();
  const lastGoodPlan = {
    marker: "last-good",
    effortProgress: { confirmed: { overall: { completion: 42 } }, lastSuccessfulAt: "2026-08-28T10:00:00.000Z" },
    unavailableSources: [],
    warnings: [],
  };
  const result = resolveFailedCraftPlanPublication({
    claimId: "claim-1",
    planId: "plan-1",
    candidatePlan: { marker: "invalid-live" },
    publication: { plan: lastGoodPlan, retainedLastGood: true },
    validation: invalidValidation(),
    sourceFailures: [],
    capturedAt: "2026-08-28T10:05:00.000Z",
    validationWarnings: state.validationWarnings,
    progressAudit: state.progressAudit,
    baselineChange: () => ({ changedAt: "2026-08-28T09:00:00.000Z" }),
  });

  assert.equal(state.recordedFailures.length, 1);
  assert.equal(state.recordedFailures[0][0], "claim-1");
  assert.equal(state.validationWarnings.get("plan-1").retainedLastGood, true);
  assert.equal(state.validationWarnings.get("plan-1").errors[0].path, "gatherNext[0].items[0].requiredNow");
  assert.equal(result.plan.marker, "last-good");
  assert.notStrictEqual(result.plan, lastGoodPlan);
  assert.equal(result.plan.effortProgress.stale, true);
  assert.equal(result.plan.effortProgress.staleSince, "2026-08-28T10:05:00.000Z");
  assert.equal(result.plan.effortProgress.baselineChange.changedAt, "2026-08-28T09:00:00.000Z");
  assert.equal(result.plan.unavailableSources.at(-1).sourceId, "craft-plan-validation");
  assert.match(result.plan.warnings.at(-1), /last successful complete plan/i);
});

test("two consecutive failed refreshes keep stale decoration bounded around pristine evidence", () => {
  const state = harness();
  const lastGoodPlan = {
    marker: "last-good",
    effortProgress: { confirmed: { overall: { completion: 42 } }, lastSuccessfulAt: "2026-08-28T10:00:00.000Z" },
    unavailableSources: [],
    warnings: [],
  };
  const first = resolveFailedCraftPlanPublication({
    claimId: "claim-1",
    planId: "plan-1",
    candidatePlan: { marker: "invalid-live-1" },
    publication: { plan: lastGoodPlan, retainedLastGood: true },
    validation: invalidValidation(),
    capturedAt: "2026-08-28T10:05:00.000Z",
    validationWarnings: state.validationWarnings,
    progressAudit: state.progressAudit,
  });
  const firstSnapshot = structuredClone(first.plan);
  const second = resolveFailedCraftPlanPublication({
    claimId: "claim-1",
    planId: "plan-1",
    candidatePlan: { marker: "invalid-live-2" },
    publication: { plan: first.plan, retainedLastGood: true },
    validation: invalidValidation(),
    capturedAt: "2026-08-28T10:10:00.000Z",
    validationWarnings: state.validationWarnings,
    progressAudit: state.progressAudit,
  });

  assert.deepEqual(first.plan, firstSnapshot);
  assert.deepEqual(lastGoodPlan.unavailableSources, []);
  assert.deepEqual(lastGoodPlan.warnings, []);
  assert.equal(second.plan.marker, "last-good");
  assert.equal(second.plan.effortProgress.stale, true);
  assert.equal(second.plan.effortProgress.staleSince, "2026-08-28T10:10:00.000Z");
  assert.deepEqual(second.plan.unavailableSources, first.plan.unavailableSources);
  assert.deepEqual(second.plan.warnings, first.plan.warnings);
  assert.deepEqual(second.plan.effortProgress.unavailableSources, first.plan.effortProgress.unavailableSources);
  assert.deepEqual(second.plan.effortProgress.warnings, first.plan.effortProgress.warnings);
  assert.equal(state.recordedFailures.length, 2);
});

test("server publication failure records diagnostics and fails closed without last-good", () => {
  const state = harness();
  assert.throws(
    () => resolveFailedCraftPlanPublication({
      claimId: "claim-1",
      planId: "plan-1",
      candidatePlan: { marker: "invalid-live" },
      publication: { plan: null, retainedLastGood: false },
      validation: invalidValidation(),
      sourceFailures: [],
      capturedAt: "2026-08-28T10:05:00.000Z",
      validationWarnings: state.validationWarnings,
      progressAudit: state.progressAudit,
    }),
    (error) => error?.statusCode === 502 && /before a complete plan was available/i.test(error.message),
  );
  assert.equal(state.recordedFailures.length, 1);
  assert.equal(state.validationWarnings.get("plan-1").retainedLastGood, false);
});

test("valid publication survives cache loss and repository reconstruction for the next invalid candidate", () => {
  const db = new DatabaseSync(":memory:");
  const published = {
    plan: { id: "plan-1", revision: 4 },
    config: { enabled: true },
    materials: [{ key: "items:7", id: "7", kind: "items", planRequired: 10, requiredNow: 3, missingNow: 2, required: 3, missing: 2 }],
    gatherNext: [],
    steps: [],
    effortProgress: { baselineRevision: "baseline-1", confirmed: { overall: { completion: 70 } } },
    warnings: [],
    unavailableSources: [],
    token: "must-not-persist",
  };
  createCraftPlanLastGoodPublicationRepository(db).store("claim-1", "plan-1", published, "2026-08-28T10:00:00.000Z");

  const reconstructed = createCraftPlanLastGoodPublicationRepository(db);
  const loaded = reconstructed.load("claim-1", "plan-1");
  const { token: _sensitive, ...expected } = published;
  assert.deepEqual(loaded.plan, expected);
  assert.equal(loaded.limitation, null);
  const failed = resolveFailedCraftPlanPublication({
    claimId: "claim-1",
    planId: "plan-1",
    candidatePlan: { marker: "invalid-next-candidate" },
    publication: { plan: loaded.plan, retainedLastGood: true },
    validation: invalidValidation(),
    capturedAt: "2026-08-28T10:05:00.000Z",
    validationWarnings: new Map(),
    progressAudit: { recordFailure() {} },
  });
  assert.deepEqual({ ...failed.plan, effortProgress: undefined, unavailableSources: undefined, warnings: undefined }, {
    ...expected,
    effortProgress: undefined,
    unavailableSources: undefined,
    warnings: undefined,
  });
  assert.equal(failed.plan.effortProgress.stale, true);
  assert.equal(failed.plan.materials[0].planRequired, 10);
  assert.equal(failed.plan.materials[0].requiredNow, 3);

  db.prepare("UPDATE craft_plan_last_good_publications SET payload_gzip = X'00' WHERE claim_id = ? AND plan_id = ?").run("claim-1", "plan-1");
  const corrupt = reconstructed.load("claim-1", "plan-1");
  assert.equal(corrupt.plan, null);
  assert.match(corrupt.limitation.error, /corrupt|invalid/i);
  const absent = reconstructed.load("claim-1", "never-published");
  assert.deepEqual(absent, { plan: null, limitation: null });
  for (const unavailable of [corrupt, absent]) {
    assert.throws(() => resolveFailedCraftPlanPublication({
      claimId: "claim-1",
      planId: "plan-1",
      candidatePlan: { marker: "invalid-next-candidate" },
      publication: { plan: unavailable.plan, retainedLastGood: false },
      validation: invalidValidation(),
      validationWarnings: new Map(),
      progressAudit: { recordFailure() {} },
    }), (error) => error?.statusCode === 502);
  }
  db.close();
});
