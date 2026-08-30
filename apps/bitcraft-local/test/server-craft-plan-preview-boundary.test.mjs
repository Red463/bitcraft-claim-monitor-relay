import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCraftPlanPreview, buildCraftPlanRouteResponse } from "../src/server/craftPlanRouteReview.mjs";

const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const saveOrchestration = await readFile(new URL("../src/server/craftPlanSaveOrchestration.mjs", import.meta.url), "utf8");

test("server-facing route response keeps full plan reviews for manager and preview payloads", () => {
  const plan = {
    steps: [],
    materials: [{
      key: "items:1020003",
      sourceRoutes: [{
        output: { key: "items:1020003", kind: "items", id: "1020003", name: "Rough Plank" },
        selectedRecipeId: "1014176789",
        alternatives: [
          { id: "1014176789", label: "Saw Rough Plank", isTransportRoute: false },
          { id: "102009", label: "Carve Rough Plank", isTransportRoute: false },
          { id: "transport", label: "Move Rough Plank", isTransportRoute: true },
        ],
      }],
    }],
  };
  const managerResponse = buildCraftPlanRouteResponse({
    plan,
    response: { planRecord: { id: "plan-1" }, plan },
  });
  const previewResponse = buildCraftPlanRouteResponse({
    plan,
    includeRouteInventory: false,
    response: buildCraftPlanPreview({ plan, routeInventory: managerResponse.routeInventory }),
  });

  assert.equal(managerResponse.plan, plan);
  assert.deepEqual(managerResponse.routeInventory.map(({ outputKey }) => outputKey), ["items:1020003"]);
  assert.deepEqual(managerResponse.routeInventory[0].alternatives.map(({ id }) => id), ["1014176789", "102009"]);
  assert.equal(previewResponse.routeEvidence, "current");
  assert.equal("routeInventory" in previewResponse, false);
  assert.deepEqual(previewResponse.routeDiagnostics, {
    steps: 0,
    materialSourceRoutes: 1,
    directInventory: 0,
    returnedReviews: 1,
    fallbackReturnedReviews: 0,
  });
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
