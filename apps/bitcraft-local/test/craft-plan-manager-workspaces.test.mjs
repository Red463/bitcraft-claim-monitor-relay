import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCraftPlanSourceSuggestion,
  craftPlanAuditInstant,
  craftPlanAuditLocalDateTime,
  craftPlanManagerWorkspaces,
  craftPlanUnavailableActions,
  craftPlanValidationDiagnostics,
  craftPlanMaterialPresentation,
  craftPlanNeedReviewTargets,
  craftPlanRecipeReviewHref,
  rebaseCraftPlanDraft,
  resolveCraftPlanRouteReviewState,
  resolveCraftPlanDraftConflict,
  craftPlanRouteSelection,
  craftPlanSourceSuggestion,
  orderCraftPlanRouteReviews,
  stageCraftPlanRouteRecommendations,
} from "../src/pages/craftPlanManagerModel.ts";
import * as craftPlanManagerModel from "../src/pages/craftPlanManagerModel.ts";

const roughPlankReviews = [{
  outputKey: "items:1020003",
  outputName: "Rough Plank",
  ambiguous: true,
  selectedRouteId: "1014176789",
  alternatives: [
    { id: "1014176789", label: "Saw Rough Plank", inputs: [] },
    { id: "102009", label: "Carve Rough Plank", inputs: [] },
  ],
}];

test("failed calculations keep the authorized audit action available", () => {
  assert.deepEqual(craftPlanUnavailableActions({ canOpenManager: true, canEdit: false }), {
    retry: true,
    managerLabel: "View Audit",
  });
  assert.deepEqual(craftPlanUnavailableActions({ canOpenManager: true, canEdit: true }), {
    retry: true,
    managerLabel: "Manage Plan",
  });
  assert.deepEqual(craftPlanUnavailableActions({ canOpenManager: false, canEdit: false }), {
    retry: true,
    managerLabel: null,
  });
});

test("recipe review retains saved Rough Plank inventory when an unchanged preview omits routes", () => {
  const state = resolveCraftPlanRouteReviewState({
    preview: { routeReviews: [] },
    loadedRouteInventory: roughPlankReviews,
    draftDirty: false,
  });

  assert.deepEqual(state.routeReviews, roughPlankReviews);
  assert.equal(state.evidence, "loaded_plan");
  assert.equal(state.routeLoss, true);
});

test("recipe review never reuses saved routes for a changed draft", () => {
  const state = resolveCraftPlanRouteReviewState({
    preview: { routeReviews: [] },
    loadedRouteInventory: roughPlankReviews,
    draftDirty: true,
  });

  assert.deepEqual(state.routeReviews, []);
  assert.notEqual(state.evidence, "loaded_plan");
});

test("recipe review preserves retained evidence for exact preview routes", () => {
  const state = resolveCraftPlanRouteReviewState({
    preview: { routeReviews: roughPlankReviews, routeEvidence: "retained" },
    loadedRouteInventory: [],
    draftDirty: true,
  });

  assert.deepEqual(state.routeReviews, roughPlankReviews);
  assert.equal(state.evidence, "retained");
  assert.equal(state.routeLoss, false);
});

test("recipe review flags lost raw route evidence instead of a valid empty state", () => {
  const state = resolveCraftPlanRouteReviewState({
    preview: { routeReviews: [], routeDiagnostics: { steps: 0, materialSourceRoutes: 1, directInventory: 0, returnedReviews: 0 } },
    loadedRouteInventory: [],
    draftDirty: true,
  });

  assert.equal(state.routeLoss, true);
});

test("administrator audit preserves exact structured calculation diagnostics", () => {
  assert.deepEqual(craftPlanValidationDiagnostics({
    status: {
      validationWarning: {
        errors: [{
          code: "invalid_selected_route",
          path: "config.routeOverrides.items:42",
          message: "The configured route must match the completed selected route.",
          outputKey: "items:42",
          selectedRecipeId: "recipe-7",
        }],
      },
    },
  }), [{
    code: "invalid_selected_route",
    path: "config.routeOverrides.items:42",
    message: "The configured route must match the completed selected route.",
    details: { outputKey: "items:42", selectedRecipeId: "recipe-7" },
  }]);
  assert.deepEqual(craftPlanValidationDiagnostics({ status: { validationWarning: null } }), []);
});

test("audit datetime controls round-trip local wall time through an explicit ISO instant", () => {
  const localValue = craftPlanAuditLocalDateTime("2026-08-10T09:30:00.000Z");
  const instant = craftPlanAuditInstant(localValue);

  assert.match(localValue, /^2026-08-10T\d{2}:\d{2}$/);
  assert.equal(craftPlanAuditLocalDateTime(Date.parse("2026-08-10T09:30:00.000Z")), localValue);
  assert.match(instant, /^2026-08-10T\d{2}:\d{2}:00\.000Z$/);
  assert.equal(new Date(instant).getTime(), new Date(localValue).getTime());
  assert.equal(craftPlanAuditInstant(""), "");
  assert.equal(craftPlanAuditInstant("not-a-date"), "");
});

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
  assert.deepEqual(craftPlanManagerWorkspaces({ canViewAudit: true, canEdit: false }).map(({ id }) => id), ["audit"]);
});

test("manager edit access requires ownership or the settings-manage permission", async () => {
  const model = await import("../src/pages/craftPlanManagerModel.ts");

  assert.equal(typeof model.canEditCraftPlan, "function");
  assert.equal(model.canEditCraftPlan({ authenticated: true, user: { permissions: ["audit.view"] } }, false), false);
  assert.equal(model.canEditCraftPlan({ authenticated: true, user: { permissions: ["settings.manage"] } }, false), true);
  assert.equal(model.canEditCraftPlan({ authenticated: true, user: { permissions: ["*"] } }, false), true);
  assert.equal(model.canEditCraftPlan({ authenticated: false, user: { permissions: ["settings.manage"] } }, false), false);
  assert.equal(model.canEditCraftPlan({ authenticated: false, user: { permissions: [] } }, true), true);
  assert.equal(typeof model.canViewCraftPlanAudit, "function");
  assert.equal(typeof model.canOpenCraftPlanManager, "function");
  assert.equal(model.canViewCraftPlanAudit({ authenticated: true, user: { permissions: ["audit.view"] } }), true);
  assert.equal(model.canOpenCraftPlanManager({ authenticated: true, user: { permissions: ["audit.view"] } }, false), true);
  assert.equal(model.canOpenCraftPlanManager({ authenticated: true, user: { permissions: ["status.view"] } }, false), false);
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

test("recipe review uses the calculated route unless the draft explicitly stages an override", () => {
  const review = { selectedRouteId: "route-risky", preselectedRouteId: "route-safe" };

  assert.equal(craftPlanRouteSelection(review), "route-risky");
  assert.equal(craftPlanRouteSelection(review, "route-staged"), "route-staged");
  assert.equal(craftPlanRouteSelection({ selectedRouteId: "route-only" }), "route-only");

  assert.deepEqual(stageCraftPlanRouteRecommendations({ routeOverrides: { "items:8": "route-kept" } }, [
    { outputKey: "items:7", selectedRouteId: "route-risky", preselectedRouteId: "route-safe" },
    { outputKey: "items:8", selectedRouteId: "route-other", preselectedRouteId: "route-recommended" },
    { outputKey: "items:9", selectedRouteId: "route-only", preselectedRouteId: "route-only" },
    { outputKey: "items:10", selectedRouteId: "route-safe", preselectedRouteId: "route-safe", ambiguous: true },
    { outputKey: "items:11", preselectedRouteId: "route-default" },
  ]).routeOverrides, {
    "items:7": "route-safe",
    "items:8": "route-kept",
    "items:11": "route-default",
  });
  assert.equal(craftPlanRouteSelection(review, "route-safe"), "route-safe");
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

test("grouped item detail presents aggregate NeedCell coverage instead of its first material", async () => {
  const model = await import("../src/pages/craftPlanManagerModel.ts");

  assert.equal(typeof model.craftPlanNeedCellPresentation, "function");
  assert.deepEqual(model.craftPlanNeedCellPresentation({
    missing: 9,
    required: 30,
    available: 8,
    guaranteedInProgress: 6,
    estimatedInProgress: 4,
    items: [{ buildingCompletion: 2 }, { buildingCompletion: 3 }],
  }), {
    neededNow: 9,
    planTotal: 30,
    stock: 8,
    guaranteedCraftOutput: 6,
    estimatedCraftOutput: 4,
    buildingCompletion: 5,
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

test("three-way draft rebase preserves non-overlapping server and local changes", () => {
  const base = {
    targets: [{ key: "items:1", quantity: 1 }],
    sourceRules: { storageContainerIds: [] },
    routeOverrides: { "items:7": "safe" },
    multipliers: {},
  };
  const local = {
    ...structuredClone(base),
    routeOverrides: { "items:7": "risky" },
    multipliers: { "items:7": { multiplier: 1.25 } },
  };
  const server = {
    ...structuredClone(base),
    targets: [{ key: "items:1", quantity: 9 }],
    sourceRules: { storageContainerIds: ["server-store"] },
  };

  assert.deepEqual(rebaseCraftPlanDraft({ base, local, server }), {
    config: {
      targets: [{ key: "items:1", quantity: 9 }],
      sourceRules: { storageContainerIds: ["server-store"] },
      routeOverrides: { "items:7": "risky" },
      multipliers: { "items:7": { multiplier: 1.25 } },
    },
    conflicts: [],
  });
});

test("three-way draft rebase keeps overlapping server values explicit until resolved", () => {
  const result = rebaseCraftPlanDraft({
    base: { routeOverrides: { "items:7": "safe" }, multipliers: {} },
    local: { routeOverrides: { "items:7": "risky" }, multipliers: { "items:7": { multiplier: 1.25 } } },
    server: { routeOverrides: { "items:7": "server-route" }, multipliers: {} },
  });

  assert.deepEqual(result.config, {
    routeOverrides: { "items:7": "server-route" },
    multipliers: { "items:7": { multiplier: 1.25 } },
  });
  assert.deepEqual(result.conflicts, [{ path: "/routeOverrides/items:7", base: "safe", local: "risky", server: "server-route" }]);
  assert.deepEqual(resolveCraftPlanDraftConflict(result.config, result.conflicts[0], "local"), {
    routeOverrides: { "items:7": "risky" },
    multipliers: { "items:7": { multiplier: 1.25 } },
  });
});

test("grouped detail review targets include exact typed outputs with production routes even when expansion is unavailable", () => {
  const cell = { items: [
    { key: "items:7", name: "Item Seven" },
    { key: "cargo:7", name: "Cargo Seven" },
    { key: "items:9", name: "Later Grouped Item" },
    { key: "items:7", name: "Duplicate" },
  ] };
  const routes = [
    { output: { key: "items:7" }, alternatives: [{ id: "item-route", isSelectable: false, probabilityStatus: "unavailable" }] },
    { output: { key: "cargo:7" }, alternatives: [{ id: "cargo-route", isSelectable: true }] },
    { output: { key: "items:9" }, alternatives: [{ id: "blocked-route", isSelectable: false }] },
  ];

  assert.deepEqual(craftPlanNeedReviewTargets(cell, routes), [
    { outputKey: "items:7", label: "Item Seven" },
    { outputKey: "cargo:7", label: "Cargo Seven" },
    { outputKey: "items:9", label: "Later Grouped Item" },
  ]);
  assert.deepEqual(craftPlanNeedReviewTargets(cell, []), []);
});

test("recipe review filters the complete plan inventory by status and human-readable route text", () => {
  assert.equal(typeof craftPlanManagerModel.filterCraftPlanRouteReviews, "function");
  const filterCraftPlanRouteReviews = craftPlanManagerModel.filterCraftPlanRouteReviews;
  const reviews = [
    { outputKey: "items:7", outputName: "Iron Ingot", ambiguous: true, confirmed: false, alternatives: [{ label: "Bloomery", buildingName: "Forge", inputs: [{ key: "items:2", name: "Hematite" }] }] },
    { outputKey: "cargo:7", outputName: "Iron Ore Cargo", ambiguous: true, confirmed: true, alternatives: [{ label: "Crush cargo", buildingName: "Crusher" }] },
    { outputKey: "items:9", outputName: "Wooden Peg", ambiguous: false, confirmed: true, alternatives: [{ label: "Carve peg", buildingName: "Workbench" }] },
  ];

  assert.deepEqual(filterCraftPlanRouteReviews(reviews, { mode: "needs-review" }).map(({ outputKey }) => outputKey), ["items:7"]);
  assert.deepEqual(filterCraftPlanRouteReviews(reviews, { mode: "multiple" }).map(({ outputKey }) => outputKey), ["items:7", "cargo:7"]);
  assert.deepEqual(filterCraftPlanRouteReviews(reviews, { mode: "single" }).map(({ outputKey }) => outputKey), ["items:9"]);
  assert.deepEqual(filterCraftPlanRouteReviews(reviews, { mode: "all", query: "crusher" }).map(({ outputKey }) => outputKey), ["cargo:7"]);
  assert.deepEqual(filterCraftPlanRouteReviews(reviews, { mode: "all", query: "iron ingot" }).map(({ outputKey }) => outputKey), ["items:7"]);
  assert.deepEqual(filterCraftPlanRouteReviews(reviews, { mode: "all", query: "cargo:7" }).map(({ outputKey }) => outputKey), ["cargo:7"]);
  assert.deepEqual(filterCraftPlanRouteReviews(reviews, { mode: "all", query: "hematite" }).map(({ outputKey }) => outputKey), ["items:7"]);
});
