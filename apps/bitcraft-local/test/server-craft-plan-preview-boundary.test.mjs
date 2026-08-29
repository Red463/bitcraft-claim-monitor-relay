import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const saveOrchestration = await readFile(new URL("../src/server/craftPlanSaveOrchestration.mjs", import.meta.url), "utf8");

test("server wires authenticated settlement and personal previews through non-persisting calculation", () => {
  assert.match(server, /createCraftPlanRouteReviewRepository/);
  assert.match(server, /async function previewCraftPlanConfig/);
  assert.match(server, /computedCraftPlanResponseFresh\([^)]*[\s\S]*preview: true/);
  assert.match(server, /configOverride: staged\.config/);
  assert.match(server, /buildCraftPlanPreview/);
  assert.match(server, /POST[\s\S]*\/api\/local\/admin\/craft-plans[\s\S]*preview/);
  assert.match(server, /POST[\s\S]*\/api\/local\/user\/craft-plans[\s\S]*preview/);
  assert.match(server, /rateLimit\(req, res, "craft-plan-preview", RATE_LIMITS\.expensiveLocal\)/);
  assert.match(server, /craftPlans\.stage\(planId, normalizeCraftPlanConfig\(inputConfig\), subject\)/);
  assert.match(server, /previewCraftPlanConfig\(planId,[^;]+\{ admin: true \}\)/);
  assert.match(server, /previewCraftPlanConfig\(planId,[^;]+\{ userId: appUser\.id \}\)/);
});

test("preview calculation bypasses cache, reconciliation writes, audit writes, and administrator diagnostics", () => {
  assert.match(server, /let config = options\.configOverride[\s\S]*normalizeCraftPlanConfig\(options\.configOverride\)/);
  assert.match(server, /reconciled\.changed && !options\.preview[\s\S]*saveCraftPlanConfig/);
  assert.match(server, /if \(options\.preview\) return \{[\s\S]*validation/);
  assert.doesNotMatch(server, /\/craft-plans\/[^"']+\/route(?:s)?["']/);
});

test("modern save conflict responses preserve non-sensitive authoritative rebase metadata", () => {
  assert.match(server, /orchestrateCraftPlanSave/);
  assert.match(saveOrchestration, /conflict: error\?\.conflict/);
  assert.match(saveOrchestration, /routeReviewState/);
  assert.match(saveOrchestration, /expectedRevision: body\.expectedRevision/);
});
