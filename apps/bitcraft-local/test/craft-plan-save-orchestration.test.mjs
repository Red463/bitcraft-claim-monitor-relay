import assert from "node:assert/strict";
import test from "node:test";

import { craftPlanSaveErrorBody, orchestrateCraftPlanSave } from "../src/server/craftPlanSaveOrchestration.mjs";

test("save orchestration runs one normalized preview and atomic repository pipeline", async () => {
  const calls = [];
  const currentPlan = { id: "plan-1", revision: 4, config: { enabled: true, targets: [] } };
  const result = await orchestrateCraftPlanSave({
    planId: "plan-1",
    body: { expectedRevision: 4, name: "Renamed", config: { enabled: true, targets: [{ id: "7" }] }, routeReviewConfirmations: [{ outputKey: "items:7" }] },
    currentPlan,
    normalizeConfig(config) { calls.push("normalize"); return { ...config, normalized: true }; },
    async prepareConfig(config) { calls.push("prepare"); return { ...config, reconciled: true }; },
    async previewConfig(_planId, config, options) { calls.push(options.expectedRevision == null ? "preview-previous" : "preflight-preview-current"); return { routeReviews: [{ outputKey: "items:7", config }] }; },
    updatePlan(_planId, changes, options) { calls.push("atomic-update"); return { id: "plan-1", revision: 5, changes, options }; },
    invalidate() { calls.push("invalidate"); },
    subject: { admin: true },
    actor: { type: "admin_user", id: "1", displayName: "Admin" },
    claimId: "claim-1",
  });

  assert.deepEqual(calls, ["normalize", "prepare", "preflight-preview-current", "preview-previous", "atomic-update", "invalidate"]);
  assert.equal(result.planRecord.revision, 5);
  assert.equal(result.config.normalized, true);
  assert.equal(result.config.reconciled, true);
  assert.equal(result.planRecord.options.routeReviewState.confirmations[0].outputKey, "items:7");
  assert.equal(result.planRecord.options.expectedRevision, 4);
});

test("save orchestration shapes revision and route-review gates consistently and never invalidates on failure", async () => {
  let invalidations = 0;
  const conflict = Object.assign(new Error("changed"), { statusCode: 409, code: "craft_plan_revision_conflict", conflict: { currentRevision: 5 } });
  await assert.rejects(() => orchestrateCraftPlanSave({
    planId: "plan-1",
    body: { expectedRevision: 4, config: {} },
    currentPlan: { revision: 4, config: {} },
    normalizeConfig: (config) => config,
    previewConfig: async () => { throw conflict; },
    updatePlan() { throw new Error("must not update"); },
    invalidate() { invalidations += 1; },
  }), (error) => error === conflict);
  assert.equal(invalidations, 0);
  assert.deepEqual(craftPlanSaveErrorBody(conflict), {
    error: "changed",
    code: "craft_plan_revision_conflict",
    conflict: { currentRevision: 5 },
    unconfirmedRoutes: undefined,
  });
});
