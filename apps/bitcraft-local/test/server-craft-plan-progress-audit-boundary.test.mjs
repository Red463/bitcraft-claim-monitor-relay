import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const computedCraftPlan = server.match(
  /async function computedCraftPlanResponseFresh[\s\S]*?async function craftPlanDiscordReport/,
)?.[0] ?? "";

test("server records complete planner progress and retains last-good progress during source failures", () => {
  assert.match(server, /createCraftPlanProgressAuditRepository/);
  assert.match(server, /craftPlanProgressAuditWriteWarning/);
  assert.match(computedCraftPlan, /craftPlanBaselineConfig\(config\)/);
  assert.match(computedCraftPlan, /craftPlanBaselineRevision/);
  assert.match(computedCraftPlan, /buildCraftPlanProgressSnapshot/);
  assert.match(computedCraftPlan, /recordSuccess/);
  assert.match(computedCraftPlan, /recordFailure/);
  assert.match(computedCraftPlan, /latestSuccess/);
  assert.match(computedCraftPlan, /staleCraftPlanProgress/);
  assert.match(computedCraftPlan, /sourceFailures/);
});

test("server validates completed planner results and retains the cached last-good complete plan", () => {
  assert.match(server, /joinCraftPlanBaselineMaterials/);
  assert.match(server, /validateCompletedCraftPlan/);
  assert.match(server, /selectCraftPlanPublication/);
  assert.match(server, /const craftPlanCalculationValidationWarnings = new Map\(\)/);
  assert.match(computedCraftPlan, /craftPlanCalculationValidationWarnings\.(?:set|delete)\(planId/);
  assert.match(server, /validationWarning: craftPlanCalculationValidationWarnings\.get\(planId\) \?\? null/);
  assert.match(computedCraftPlan, /lastGoodPlan/);
  assert.match(computedCraftPlan, /retainedLastGood/);
  assert.match(computedCraftPlan, /recordFailure/);
  assert.match(computedCraftPlan, /staleCraftPlanProgress/);
});

test("server exposes authenticated progress audit status and gzip export routes", () => {
  assert.match(server, /\/api\/local\/admin\/craft-plan\/progress-audit/);
  assert.match(server, /progress-audit\/export/);
  assert.match(server, /normalizeCraftPlanAuditRange/);
  assert.match(server, /application\/gzip/);
  assert.match(server, /content-disposition/);
  assert.match(server, /craft-plan-progress-audit-/);
});
