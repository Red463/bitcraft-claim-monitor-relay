import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

function routeSource(startMarker, endMarker) {
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing route marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing route boundary: ${endMarker}`);
  return server.slice(start, end);
}

test("Craft Plan saves persist structured toggle audit details", () => {
  const route = routeSource(
    'if (req.method === "PUT" && url.pathname === "/api/local/admin/craft-plan")',
    'if (req.method === "PUT" && url.pathname === "/api/local/admin/access-control")',
  );
  assert.match(route, /const planId = String\(url\.searchParams\.get\("planId"\) \?\? craftPlans\.primary\(\)\?\.id \?\? ""\)/);
  assert.match(route, /const previousConfig = storedCraftPlanConfig\(planId\)/);
  assert.match(route, /craftPlanAuditDetails\(previousConfig, config, craftPlanAuditLabels\(response\.sources, response\.plan\?\.materials\)\)/);
  assert.match(route, /changes: auditDetails\.changes/);
  assert.match(route, /otherSettingsChanged: auditDetails\.otherSettingsChanged/);
});

test("Craft Plan audit endpoint returns Task 2 lifetime config history for the selected plan", () => {
  const route = routeSource(
    'if (req.method === "GET" && url.pathname === "/api/local/admin/craft-plan/audit")',
    'if (req.method === "GET" && url.pathname === "/api/local/admin/craft-plan")',
  );
  assert.match(route, /craftPlanConfigAudit\.listForPlan\(planId\)/);
  assert.match(route, /configHistory/);
  assert.doesNotMatch(route, /admin_audit_log|normalizeCraftPlanAuditRows/);
});
