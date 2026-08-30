import assert from "node:assert/strict";
import test from "node:test";

import {
  CRAFT_PLAN_EFFORT_MODEL_VERSION,
  calculateCraftPlanEffortProgress,
  compactCraftPlanEffortInput,
  craftingEffortCandidate,
  gatheringEffortCandidate,
  normalizeGameResourceEffortCandidates,
  projectCraftPlanEffortMaterials,
  selectLowestEffortWeights,
  unavailableCraftPlanEffortProgress,
} from "../src/server/craftPlanEffortProgress.mjs";

function fishingPlan({ current = false } = {}) {
  return {
    materials: [
      { key: "items:oil", tag: "Fish Oil", section: "Fishing", bufferedRequired: 100, missing: current ? 40 : 100 },
      { key: "items:shells", tag: "Crushed Shells", section: "Fishing", bufferedRequired: 100, missing: current ? 45.6 : 100 },
      { key: "items:ocean", tag: "Ocean Fish", section: "Fishing", bufferedRequired: 100, missing: current ? 42.8 : 100 },
      { key: "items:lake", tag: "Lake Fish", section: "Fishing", bufferedRequired: 10, missing: current ? 4.28 : 10 },
    ],
    personalViews: { fishing: { tiers: [{ routes: {
      ocean: { available: true, input: { key: "items:ocean", tag: "Ocean Fish" }, needed: current ? 42.8 : 100, stockQuantity: 0, guaranteedTrackedQuantity: 0 },
      lake: { available: true, input: { key: "items:lake", tag: "Lake Fish" }, needed: current ? 4.28 : 10, stockQuantity: 0, guaranteedTrackedQuantity: 0 },
    } }] } },
  };
}

function fishingWeights() {
  return new Map([
    ["items:oil", { effortWeight: 1 }],
    ["items:shells", { effortWeight: 1 }],
    ["items:ocean", { effortWeight: 1 }],
    ["items:lake", { effortWeight: 2 }],
  ]);
}

test("effort candidates use actions or inverse gathering probability", () => {
  assert.equal(CRAFT_PLAN_EFFORT_MODEL_VERSION, 3);
  assert.equal(craftingEffortCandidate({ catalogKey: "items:oil", sourceKey: "recipe:oil", actionsRequired: 12, outputQuantity: 3, probability: 1 }).effortWeight, 4);
  assert.equal(craftingEffortCandidate({ catalogKey: "items:straw", sourceKey: "recipe:grain", actionsRequired: 8, outputQuantity: 2, probability: 0.5 }).effortWeight, 8);
  assert.equal(gatheringEffortCandidate({ catalogKey: "items:gypsite", sourceKey: "resource:clay", outputQuantity: 1, probability: 0.02 }).effortWeight, 50);
});

test("invalid candidates are rejected and the cheapest verified route wins", () => {
  assert.equal(craftingEffortCandidate({ catalogKey: "items:x", actionsRequired: 0, outputQuantity: 2 }), null);
  assert.equal(craftingEffortCandidate({ catalogKey: "items:x", outputQuantity: 2 }), null);
  assert.equal(gatheringEffortCandidate({ catalogKey: "items:x", outputQuantity: 1, probability: 0 }), null);
  const weights = selectLowestEffortWeights([
    { catalogKey: "items:x", sourceKey: "slow", method: "crafting", effortWeight: 8 },
    { catalogKey: "items:x", sourceKey: "fast", method: "gathering", effortWeight: 3 },
  ]);
  assert.equal(weights.get("items:x").effortWeight, 3);
  assert.equal(weights.get("items:x").sourceKey, "fast");
});

test("progress compares a zero-stock baseline with confirmed live missing effort", () => {
  const baselinePlan = { materials: [
    { key: "items:plank", section: "Carpentry", bufferedRequired: 100, missing: 100 },
    { key: "items:stone", section: "Masonry", bufferedRequired: 10, missing: 10 },
  ], personalViews: { fishing: { tiers: [] } } };
  const currentPlan = { materials: [
    { key: "items:plank", section: "Carpentry", bufferedRequired: 100, missing: 25 },
    { key: "items:stone", section: "Masonry", bufferedRequired: 10, missing: 10 },
  ], personalViews: { fishing: { tiers: [] } } };
  const weights = new Map([["items:plank", { effortWeight: 2 }], ["items:stone", { effortWeight: 10 }]]);
  const result = calculateCraftPlanEffortProgress({ baselinePlan, currentPlan, weights });
  assert.equal(result.sections.Carpentry.completion, 75);
  assert.equal(result.sections.Masonry.completion, 0);
  assert.deepEqual(result.overall, { state: "ready", baselineEffort: 300, remainingEffort: 150, completion: 50 });
});

test("confirmed effort projection ignores planning-only estimated coverage", () => {
  const result = calculateCraftPlanEffortProgress({
    baselinePlan: {
      materials: [{ key: "items:lake", section: "Fishing", required: 30, missing: 30 }],
      personalViews: { fishing: { tiers: [] } },
    },
    currentPlan: {
      materials: [],
      personalViews: { fishing: { tiers: [] } },
      confirmedEffortPlan: {
        materials: [{ key: "items:lake", section: "Fishing", required: 30, missing: 30 }],
        personalViews: { fishing: { tiers: [] } },
      },
    },
    weights: new Map([["items:lake", 1]]),
  });

  assert.equal(result.overall.completion, 0);
});

test("effort progress exposes confirmed and projected active output separately", () => {
  const baselinePlan = {
    materials: [{ key: "items:ink", section: "Scholar", required: 100, missing: 100 }],
    personalViews: { fishing: { tiers: [] } },
  };
  const currentPlan = {
    materials: [{ key: "items:ink", section: "Scholar", required: 100, missing: 20 }],
    confirmedEffortPlan: {
      materials: [{ key: "items:ink", section: "Scholar", required: 100, missing: 40 }],
      personalViews: { fishing: { tiers: [] } },
    },
    personalViews: { fishing: { tiers: [] } },
  };
  const result = calculateCraftPlanEffortProgress({
    baselinePlan,
    currentPlan,
    weights: new Map([["items:ink", 1]]),
  });

  assert.equal(result.confirmed.overall.completion, 60);
  assert.equal(result.projected.overall.completion, 80);
  assert.equal(result.overall.completion, 60);
  assert.strictEqual(result.sections, result.confirmed.sections);
  assert.equal(result.projected.sections.Scholar.completion, 80);
});

test("projected completion is clamped to confirmed completion", () => {
  const result = calculateCraftPlanEffortProgress({
    baselinePlan: {
      materials: [{ key: "items:x", section: "Other", required: 10, missing: 10 }],
      personalViews: { fishing: { tiers: [] } },
    },
    currentPlan: {
      materials: [{ key: "items:x", section: "Other", required: 10, missing: 9 }],
      confirmedEffortPlan: {
        materials: [{ key: "items:x", section: "Other", required: 10, missing: 4 }],
        personalViews: { fishing: { tiers: [] } },
      },
      personalViews: { fishing: { tiers: [] } },
    },
    weights: new Map([["items:x", 1]]),
  });

  assert.equal(result.confirmed.overall.completion, 60);
  assert.equal(result.projected.overall.completion, 60);
});

test("materials removed from the live requirement graph count as completed effort", () => {
  const baselinePlan = { materials: [
    { key: "items:plank", section: "Carpentry", bufferedRequired: 10, missing: 10 },
  ], personalViews: { fishing: { tiers: [] } } };
  const result = calculateCraftPlanEffortProgress({
    baselinePlan,
    currentPlan: { materials: [], personalViews: { fishing: { tiers: [] } } },
    weights: new Map([["items:plank", { effortWeight: 2 }]]),
  });
  assert.deepEqual(result.overall, { state: "ready", baselineEffort: 20, remainingEffort: 0, completion: 100 });
  assert.equal(result.sections.Carpentry.completion, 100);
});

test("missing gathering weights use a neutral estimate without hiding progress", () => {
  const baselinePlan = { materials: [
    { key: "items:known", section: "Carpentry", bufferedRequired: 10, missing: 10 },
    { key: "items:unknown", section: "Fishing", bufferedRequired: 5, missing: 5 },
  ], personalViews: { fishing: { tiers: [] } } };
  const currentPlan = { materials: [
    { key: "items:known", section: "Carpentry", bufferedRequired: 10, missing: 0 },
    { key: "items:unknown", section: "Fishing", bufferedRequired: 5, missing: 5 },
  ], personalViews: { fishing: { tiers: [] } } };
  const result = calculateCraftPlanEffortProgress({ baselinePlan, currentPlan, weights: new Map([["items:known", { effortWeight: 2 }]]) });
  assert.equal(result.state, "partial");
  assert.equal(result.sections.Carpentry.completion, 100);
  assert.deepEqual(result.sections.Fishing, { state: "ready", baselineEffort: 5, remainingEffort: 5, completion: 0 });
  assert.deepEqual(result.overall, { state: "ready", baselineEffort: 25, remainingEffort: 5, completion: 80 });
  assert.deepEqual(result.coverage.missingWeightKeys, ["items:unknown"]);
  assert.match(result.warnings[0], /neutral one-action estimate/i);
});

test("a section containing only unweighted gathered materials still has progress", () => {
  const baselinePlan = { materials: [
    { key: "items:berry", section: "Foraging", bufferedRequired: 10, missing: 10 },
  ], personalViews: { fishing: { tiers: [] } } };
  const currentPlan = { materials: [
    { key: "items:berry", section: "Foraging", bufferedRequired: 10, missing: 4 },
  ], personalViews: { fishing: { tiers: [] } } };
  const result = calculateCraftPlanEffortProgress({ baselinePlan, currentPlan, weights: new Map() });
  assert.equal(result.state, "partial");
  assert.deepEqual(result.sections.Foraging, { state: "ready", baselineEffort: 10, remainingEffort: 4, completion: 60 });
  assert.deepEqual(result.overall, { state: "ready", baselineEffort: 10, remainingEffort: 4, completion: 60 });
});

test("effort sections follow the same canonical taxonomy as the Needs Board", () => {
  const baselinePlan = { materials: [
    { key: "items:berry", tag: "Citric Berry", section: "Scholar", bufferedRequired: 88, missing: 88 },
  ], personalViews: { fishing: { tiers: [] } } };
  const currentPlan = { materials: [
    { key: "items:berry", tag: "Citric Berry", section: "Scholar", bufferedRequired: 88, missing: 34 },
  ], personalViews: { fishing: { tiers: [] } } };
  const result = calculateCraftPlanEffortProgress({ baselinePlan, currentPlan, weights: new Map([["items:berry", 1]]) });
  assert.equal(result.sections.Foraging.completion, 61.4);
  assert.equal(result.sections.Scholar, undefined);
});

test("effort sections follow explicit Needs Board section overrides", () => {
  const baselinePlan = { materials: [
    { key: "items:berry", tag: "Citric Berry", section: "Scholar", sectionOverride: "Farming", bufferedRequired: 10, missing: 10 },
  ], personalViews: { fishing: { tiers: [] } } };
  const currentPlan = { materials: [
    { key: "items:berry", tag: "Citric Berry", section: "Scholar", sectionOverride: "Farming", bufferedRequired: 10, missing: 4 },
  ], personalViews: { fishing: { tiers: [] } } };
  const result = calculateCraftPlanEffortProgress({ baselinePlan, currentPlan, weights: new Map([["items:berry", 1]]) });
  assert.equal(result.sections.Farming.completion, 60);
  assert.equal(result.sections.Foraging, undefined);
});

test("effort progress excludes rows hidden by the Needs Board taxonomy", () => {
  const baselinePlan = { materials: [
    { key: "items:berry", tag: "Citric Berry", section: "Scholar", bufferedRequired: 10, missing: 10 },
    { key: "items:seeds", tag: "Wild Seeds", section: "Farming", bufferedRequired: 100, missing: 100 },
  ], personalViews: { fishing: { tiers: [] } } };
  const currentPlan = { materials: [
    { key: "items:berry", tag: "Citric Berry", section: "Scholar", bufferedRequired: 10, missing: 5 },
    { key: "items:seeds", tag: "Wild Seeds", section: "Farming", bufferedRequired: 100, missing: 100 },
  ], personalViews: { fishing: { tiers: [] } } };
  const weights = new Map([["items:berry", 1], ["items:seeds", 1]]);
  const result = calculateCraftPlanEffortProgress({ baselinePlan, currentPlan, weights });
  assert.equal(result.sections.Foraging.completion, 50);
  assert.equal(result.sections.Farming, undefined);
  assert.deepEqual(result.overall, { state: "ready", baselineEffort: 10, remainingEffort: 5, completion: 50 });
});

test("empty plans are complete without requiring catalog weights", () => {
  const result = calculateCraftPlanEffortProgress({ baselinePlan: { materials: [] }, currentPlan: { materials: [] }, weights: new Map() });
  assert.equal(result.state, "empty");
  assert.deepEqual(result.overall, { state: "empty", baselineEffort: 0, remainingEffort: 0, completion: 100 });
});

test("unavailable effort progress explains Relay catalog readiness without retired refresh instructions", () => {
  const result = unavailableCraftPlanEffortProgress();
  assert.deepEqual(result.warnings, ["Effort progress is unavailable until compatible Relay catalog data is ready."]);
  assert.doesNotMatch(result.warnings.join(" "), /refresh|full catalog run|scheduled/i);
});

test("Fishing variants replace only interchangeable fish inputs", () => {
  const result = calculateCraftPlanEffortProgress({
    baselinePlan: fishingPlan(),
    currentPlan: fishingPlan({ current: true }),
    weights: fishingWeights(),
  });
  assert.equal(result.fishingVariants.ocean.sections.Fishing.completion, 57.2);
  assert.equal(result.fishingVariants.lake.sections.Fishing.completion, 57.2);
  assert.notEqual(result.fishingVariants.ocean.overall.baselineEffort, result.fishingVariants.lake.overall.baselineEffort);
  assert.equal(result.fishingVariants.ocean.route, "ocean");
  assert.equal(result.fishingVariants.lake.route, "lake");
});

test("Fishing route projection replaces canonically classified fish aliases", () => {
  const plan = {
    materials: [
      { key: "items:ocean", tag: "Oceanfish", section: "Scholar", bufferedRequired: 100, missing: 40 },
      { key: "items:lake", tag: "Lake Fish", section: "Scholar", bufferedRequired: 10, missing: 4 },
    ],
    personalViews: { fishing: { tiers: [{ routes: {
      ocean: { available: true, input: { key: "items:ocean", tag: "Oceanfish" }, needed: 40, stockQuantity: 60, guaranteedTrackedQuantity: 0 },
      lake: { available: true, input: { key: "items:lake", tag: "Lake Fish" }, needed: 4, stockQuantity: 6, guaranteedTrackedQuantity: 0 },
    } }] } },
  };
  assert.deepEqual(projectCraftPlanEffortMaterials(plan, "ocean"), [
    { key: "items:ocean", section: "Fishing", required: 100, missing: 40 },
  ]);
});

test("compact effort input excludes planner drilldown payloads", () => {
  const compact = compactCraftPlanEffortInput({
    materials: [{ key: "items:1", tag: "Plank", section: "Carpentry", sectionOverride: "Farming", required: 10, missing: 4, sources: [{}], recipeUsages: [{}] }],
    personalViews: { fishing: { tiers: [{ routes: { ocean: { available: false, reason: "Missing route", alternatives: [{}] } } }] } },
    steps: [{}],
  });
  assert.deepEqual(compact.materials, [{ key: "items:1", tag: "Plank", section: "Carpentry", sectionOverride: "Farming", required: 10, missing: 4 }]);
  assert.deepEqual(compact.personalViews.fishing.tiers[0].routes.ocean, { available: false, reason: "Missing route" });
  assert.equal("steps" in compact, false);
});

test("compact baseline input retains an explicitly prepared route inventory for stable review", () => {
  const routeInventory = [{
    outputKey: "items:42",
    outputName: "Fine Plank",
    selectedRouteId: "sawmill",
    preselectedRouteId: "sawmill",
    ambiguous: false,
    alternatives: [{ id: "sawmill", label: "Saw Fine Plank", inputs: [] }],
    fingerprint: "route-fingerprint",
  }];

  const compact = compactCraftPlanEffortInput({ materials: [] }, { routeInventory });

  assert.deepEqual(compact.routeInventory, routeInventory);
  assert.notEqual(compact.routeInventory, routeInventory, "the cache value must not retain the caller's mutable array");
  assert.notEqual(compact.routeInventory[0], routeInventory[0], "the cache value must not retain mutable route objects");
});

test("resource outputs become gathering effort candidates without merging item and cargo ids", () => {
  const candidates = normalizeGameResourceEffortCandidates({ resources: [{
    id: 44,
    outputs: [
      { itemId: 700, itemType: 0, quantity: 1, probability: 0.02 },
      { itemId: 700, itemType: 0, quantity: 2, chance: 5 },
      { itemId: 700, itemType: 1, quantity: 1, chance: 0.5 },
    ],
  }] });
  assert.deepEqual(candidates.map((row) => [row.catalogKey, row.sourceKey, row.effortWeight]), [
    ["items:700", "resource:44", 50],
    ["items:700", "resource:44", 10],
    ["cargo:700", "resource:44", 2],
  ]);
});

test("resource normalization accepts wrapped BitJita output aliases and rejects unverifiable rows", () => {
  const candidates = normalizeGameResourceEffortCandidates({ data: { resources: [{
    entityId: "resource-9",
    resourceOutputs: [
      { targetItem: { id: "80" }, amount: "4", dropChance: "25" },
      { targetId: "81", quantity: 1, chance: 0 },
      { targetId: "82", quantity: 0, chance: 1 },
    ],
  }] } });
  assert.deepEqual(candidates.map((row) => [row.catalogKey, row.sourceKey, row.effortWeight]), [
    ["items:80", "resource:resource-9", 1],
  ]);
});
