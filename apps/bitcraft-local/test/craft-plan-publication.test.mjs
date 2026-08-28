import assert from "node:assert/strict";
import test from "node:test";

import { resolveFailedCraftPlanPublication } from "../src/server/craftPlanPublication.mjs";

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
