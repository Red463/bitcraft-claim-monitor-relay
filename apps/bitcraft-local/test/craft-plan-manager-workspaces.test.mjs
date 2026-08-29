import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCraftPlanSourceSuggestion,
  craftPlanManagerWorkspaces,
  craftPlanMaterialPresentation,
  craftPlanRecipeReviewHref,
  craftPlanRouteSelection,
  craftPlanSourceSuggestion,
  orderCraftPlanRouteReviews,
  stageCraftPlanRouteRecommendations,
} from "../src/pages/craftPlanManagerModel.ts";

test("manager exposes exactly four capability-preserving workspaces when audit is authorized", () => {
  const workspaces = craftPlanManagerWorkspaces({ canViewAudit: true });

  assert.deepEqual(workspaces.map(({ id, label }) => ({ id, label })), [
    { id: "goals", label: "Goals" },
    { id: "sources", label: "Counted Sources" },
    { id: "recipes", label: "Recipe Review" },
    { id: "audit", label: "Audit" },
  ]);
  assert.deepEqual(workspaces[0].capabilities, ["name", "visibility", "targets", "quantities", "presets"]);
  assert.deepEqual(workspaces[1].capabilities, ["storage", "inventory", "crafts", "deployables", "banks"]);
  assert.deepEqual(workspaces[2].capabilities, ["routes", "review", "buffers", "material-impact"]);
  assert.deepEqual(craftPlanManagerWorkspaces({ canViewAudit: false }).map(({ id }) => id), ["goals", "sources", "recipes"]);
});

test("manager edit access requires ownership or the settings-manage permission", async () => {
  const model = await import("../src/pages/craftPlanManagerModel.ts");

  assert.equal(typeof model.canEditCraftPlan, "function");
  assert.equal(model.canEditCraftPlan({ authenticated: true, user: { permissions: ["audit.view"] } }, false), false);
  assert.equal(model.canEditCraftPlan({ authenticated: true, user: { permissions: ["settings.manage"] } }, false), true);
  assert.equal(model.canEditCraftPlan({ authenticated: true, user: { permissions: ["*"] } }, false), true);
  assert.equal(model.canEditCraftPlan({ authenticated: false, user: { permissions: ["settings.manage"] } }, false), false);
  assert.equal(model.canEditCraftPlan({ authenticated: false, user: { permissions: [] } }, true), true);
});

test("new-plan suggestions are unselected, scope-specific, and keep opt-in sources empty", () => {
  const sources = {
    storage: [{ sourceId: "storage-a" }, { sourceId: "storage-b" }],
    players: [{ playerId: "owner" }, { playerId: "other" }],
  };

  const settlement = craftPlanSourceSuggestion({ personal: false, sources });
  assert.deepEqual(settlement.sourceRules, {
    storageContainerIds: ["storage-a", "storage-b"],
    playerIds: [],
    craftPlayerIds: [],
    bankPlayerIds: [],
    bankContainerIds: [],
    deployableContainerIds: [],
  });
  assert.equal(settlement.applied, false);

  const personal = craftPlanSourceSuggestion({ personal: true, sources });
  assert.deepEqual(personal.sourceRules, {
    storageContainerIds: [],
    playerIds: ["owner"],
    craftPlayerIds: [],
    bankPlayerIds: [],
    bankContainerIds: [],
    deployableContainerIds: [],
  });
  assert.equal(personal.applied, false);

  const current = { sourceRules: { storageContainerIds: [], playerIds: [], craftPlayerIds: ["other"], bankPlayerIds: [], bankContainerIds: ["bank-a"], deployableContainerIds: ["wagon-a"] } };
  const unchanged = structuredClone(current);
  assert.deepEqual(current, unchanged, "previewing a suggestion must not mutate the draft");
  assert.deepEqual(applyCraftPlanSourceSuggestion(current, settlement).sourceRules, settlement.sourceRules);
});

test("recipe review orders ambiguous outputs first without losing typed identity", () => {
  const ordered = orderCraftPlanRouteReviews([
    { outputKey: "items:7", ambiguous: false },
    { outputKey: "cargo:7", ambiguous: true },
    { outputKey: "items:3", ambiguous: true },
  ]);

  assert.deepEqual(ordered.map(({ outputKey }) => outputKey), ["cargo:7", "items:3", "items:7"]);
});

test("recipe review preselects the safest server recommendation unless the draft has an override", () => {
  const review = { selectedRouteId: "route-risky", preselectedRouteId: "route-safe" };

  assert.equal(craftPlanRouteSelection(review), "route-safe");
  assert.equal(craftPlanRouteSelection(review, "route-staged"), "route-staged");
  assert.equal(craftPlanRouteSelection({ selectedRouteId: "route-only" }), "route-only");

  assert.deepEqual(stageCraftPlanRouteRecommendations({ routeOverrides: { "items:8": "route-kept" } }, [
    { outputKey: "items:7", selectedRouteId: "route-risky", preselectedRouteId: "route-safe" },
    { outputKey: "items:8", selectedRouteId: "route-other", preselectedRouteId: "route-recommended" },
  ]).routeOverrides, {
    "items:7": "route-safe",
    "items:8": "route-kept",
  });
});

test("material presentation prefers Task 1 fields and keeps legacy aliases as fallback", () => {
  assert.deepEqual(craftPlanMaterialPresentation({
    missingNow: 4,
    planRequired: 12,
    missing: 99,
    required: 88,
    available: 3,
    guaranteedInProgress: 2,
    estimatedInProgress: 1,
    buildingCompletion: 75,
  }), {
    neededNow: 4,
    planTotal: 12,
    stock: 3,
    guaranteedCraftOutput: 2,
    estimatedCraftOutput: 1,
    buildingCompletion: 75,
  });
  assert.deepEqual(craftPlanMaterialPresentation({ missing: 5, required: 9, available: 1, inProgress: 3 }), {
    neededNow: 5,
    planTotal: 9,
    stock: 1,
    guaranteedCraftOutput: 3,
    estimatedCraftOutput: 0,
    buildingCompletion: 0,
  });
});

test("item-detail editor links preserve the exact typed output in Recipe Review", () => {
  const href = craftPlanRecipeReviewHref({ planId: "shared plan", outputKey: "cargo:7" });
  const url = new URL(href, "http://localhost");

  assert.equal(url.searchParams.get("page"), "planning");
  assert.equal(url.searchParams.get("plan"), "shared plan");
  assert.equal(url.searchParams.get("manager"), "recipe-review");
  assert.equal(url.searchParams.get("output"), "cargo:7");
});
