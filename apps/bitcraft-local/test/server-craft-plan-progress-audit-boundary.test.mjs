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
  assert.match(computedCraftPlan, /plan: \{ \.\.\.livePlan, validation \}/);
  assert.match(computedCraftPlan, /recordSuccess/);
  assert.match(server, /resolveFailedCraftPlanPublication/);
  assert.match(computedCraftPlan, /resolveFailedCraftPlanPublication/);
  assert.match(computedCraftPlan, /sourceFailures/);
});

test("server validates completed planner results and retains the cached last-good complete plan", () => {
  assert.match(server, /finalizeCraftPlanPublication/);
  assert.match(server, /reconcileCraftPlanRequiredSourceStatus/);
  assert.match(computedCraftPlan, /legacySourceIds/);
  assert.doesNotMatch(
    computedCraftPlan,
    /if \(storedEffortModelVersion !== CRAFT_PLAN_EFFORT_MODEL_VERSION\) \{[\s\S]*?return livePlan;[\s\S]*?\}/,
  );
  assert.match(computedCraftPlan, /livePlan\.gatherNext = completedPublication\.candidatePlan\.gatherNext/);
  assert.match(server, /const craftPlanCalculationValidationWarnings = new Map\(\)/);
  assert.match(computedCraftPlan, /craftPlanCalculationValidationWarnings\.(?:set|delete)\(planId/);
  assert.match(server, /validationWarning: craftPlanCalculationValidationWarnings\.get\(planId\) \?\? auditStatus\.validationWarning \?\? null/);
  assert.match(computedCraftPlan, /lastGoodPlan/);
  assert.match(computedCraftPlan, /validationWarnings: craftPlanCalculationValidationWarnings/);
});

test("server exposes authenticated progress audit status and gzip export routes", () => {
  assert.match(server, /\/api\/local\/admin\/craft-plan\/progress-audit/);
  assert.match(server, /progress-audit\/export/);
  assert.match(server, /normalizeCraftPlanAuditRange/);
  assert.match(server, /application\/gzip/);
  assert.match(server, /content-disposition/);
  assert.match(server, /craft-plan-progress-audit-/);
  assert.match(server, /progress-audit\/compare/);
  assert.match(server, /compareCheckpoints/);
  assert.match(server, /queryCausalGroups/);
  assert.match(server, /listEvents\(claimId, \{ since, until, limit: 100, planId \}\)/);
  for (const filter of ["page", "pageSize", "since", "until", "triggerCategory", "effectCategory", "materialKey", "unresolvedOnly"]) {
    assert.match(server, new RegExp(`searchParams\\.get\\(\"${filter}\"\\)`), filter);
  }
  assert.match(server, /retentionDays: 30/);
  assert.match(server, /createCraftPlanConfigAuditRepository/);
  assert.match(server, /type: "admin"/);
  assert.match(server, /type: "user_account"/);
});
