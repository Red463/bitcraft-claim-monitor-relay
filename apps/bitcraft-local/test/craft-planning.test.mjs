import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import * as craftPlanning from "../src/server/craftPlanning.mjs";

import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import {
  collectLocalCatalogCraftPlanDetails,
  compactCraftPlanResponse,
  computeCraftPlan,
  craftPlanAuditDetails,
  craftPlanAuditLimit,
  craftPlanDetailResponse,
  craftPlanCatalogTargets,
  normalizeCraftPlanConfig,
  normalizeCraftPlanAuditRows,
  reconcileCraftPlanBuildingProgress,
  recipeKey,
} from "../src/server/craftPlanning.mjs";
import { createGameCatalogRepository } from "../src/server/gameCatalog.mjs";
import { normalizeGameDataItemLists, normalizeGameDataResources } from "../src/server/itemProbability.mjs";

const fishOilDetail = {
  item: { id: "900", name: "Fish Oil", itemType: 0, tag: "Oil" },
  craftingRecipes: [
    {
      id: "ocean-route",
      name: "Ocean Fish Oil",
      buildingName: "Cooking Station",
      craftedItemStacks: [{ item_id: "900", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "100", item_type: "item", quantity: 3 }],
      consumedItems: [{ id: "100", name: "Ocean Fish", tag: "Fish", tier: 2 }],
      levelRequirements: [{ skill: { name: "Fishing" }, level: 10 }],
    },
    {
      id: "lake-route",
      name: "Lake Fish Oil",
      buildingName: "Cooking Station",
      craftedItemStacks: [{ item_id: "900", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "101", item_type: "item", quantity: 3 }],
      consumedItems: [{ id: "101", name: "Lake Fish", tag: "Fish", tier: 2 }],
      levelRequirements: [{ skill: { name: "Fishing" }, level: 10 }],
    },
  ],
};

const animalHairDetail = {
  item: { id: "200", name: "Animal Hair", itemType: 0, tag: "Hunting" },
  craftingRecipes: [],
};

test("canonical material totals stay fixed while live quantities and typed identities remain compatible", () => {
  assert.equal(typeof craftPlanning.joinCraftPlanBaselineMaterials, "function");
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "1", kind: "items", name: "Plank", quantity: 10 }],
    sourceRules: { craftPlayerIds: ["player-1"] },
  });
  const detailsByKey = new Map([
    ["items:1", {
      item: { id: "1", kind: "items", name: "Plank" },
      craftingRecipes: [{
        id: "plank-route",
        name: "Make Plank",
        craftedItemStacks: [{ item_id: "1", item_type: "item", quantity: 1 }],
        consumedItemStacks: [{ item_id: "7", item_type: "item", quantity: 1 }],
        consumedItems: [{ id: "7", itemType: 0, name: "Log" }],
      }],
    }],
    ["items:7", { item: { id: "7", kind: "items", name: "Log" }, craftingRecipes: [] }],
  ]);
  const baselinePlan = computeCraftPlan({ config, detailsByKey });
  const livePlan = computeCraftPlan({
    config,
    detailsByKey,
    storageSources: [{ sourceId: "store-1", label: "Stockpile", items: [{ id: "1", kind: "items", name: "Plank", quantity: 4 }] }],
    activeCrafts: [{ id: "craft-1", playerId: "player-1", itemId: "1", kind: "items", name: "Plank", quantity: 2, guaranteedQuantity: 2 }],
  });
  baselinePlan.materials.push({ key: "cargo:7", id: "7", kind: "cargo", required: 20 });
  livePlan.materials.push(
    { key: "cargo:7", id: "7", kind: "cargo", required: 4, missing: 1 },
    { key: "items:99", id: "99", kind: "items", required: 3, missing: 3 },
  );

  const joined = craftPlanning.joinCraftPlanBaselineMaterials(livePlan, baselinePlan);

  const values = new Map(joined.materials.map((material) => [material.key, material]));
  assert.deepEqual(
    ["items:7", "cargo:7", "items:99"].map((key) => {
      const { planRequired, requiredNow, missingNow, required, missing } = values.get(key);
      return { key, planRequired, requiredNow, missingNow, required, missing };
    }),
    [
      { key: "items:7", planRequired: 10, requiredNow: 4, missingNow: 4, required: 4, missing: 4 },
      { key: "cargo:7", planRequired: 20, requiredNow: 4, missingNow: 1, required: 4, missing: 1 },
      { key: "items:99", planRequired: 0, requiredNow: 3, missingNow: 3, required: 3, missing: 3 },
    ],
  );
  const gatherItem = joined.gatherNext
    .flatMap((group) => group.items)
    .find((material) => material.key === "items:7");
  assert.deepEqual(
    {
      planRequired: gatherItem?.planRequired,
      requiredNow: gatherItem?.requiredNow,
      missingNow: gatherItem?.missingNow,
    },
    { planRequired: 10, requiredNow: 4, missingNow: 4 },
  );
  assert.equal("planRequired" in livePlan.materials.find((material) => material.key === "items:7"), false);
});

test("canonical baseline-only materials remain published when live stock suppresses expansion", () => {
  const baselinePlan = {
    materials: [
      { key: "items:7", id: "7", kind: "items", name: "Log", required: 10, missing: 10, available: 0, inProgress: 0, guaranteedInProgress: 0, estimatedInProgress: 0 },
      { key: "cargo:7", id: "7", kind: "cargo", name: "Log crate", required: 6, missing: 6, available: 0, inProgress: 0, guaranteedInProgress: 0, estimatedInProgress: 0 },
    ],
  };
  const livePlan = {
    materials: [{ key: "items:9", id: "9", kind: "items", name: "Bark", required: 2, missing: 1, available: 1, inProgress: 0, guaranteedInProgress: 0, estimatedInProgress: 0 }],
    gatherNext: [{ tag: "Woodcutting", items: [{ key: "items:9", required: 2, missing: 1 }] }],
  };

  const joined = craftPlanning.joinCraftPlanBaselineMaterials(livePlan, baselinePlan);

  assert.deepEqual(joined.materials.map(({ key }) => key), ["items:9", "items:7", "cargo:7"]);
  assert.deepEqual(joined.materials.slice(1).map((material) => ({
    key: material.key,
    planRequired: material.planRequired,
    requiredNow: material.requiredNow,
    missingNow: material.missingNow,
    required: material.required,
    missing: material.missing,
    available: material.available,
    inProgress: material.inProgress,
    guaranteedInProgress: material.guaranteedInProgress,
    estimatedInProgress: material.estimatedInProgress,
  })), [
    { key: "items:7", planRequired: 10, requiredNow: 0, missingNow: 0, required: 0, missing: 0, available: 0, inProgress: 0, guaranteedInProgress: 0, estimatedInProgress: 0 },
    { key: "cargo:7", planRequired: 6, requiredNow: 0, missingNow: 0, required: 0, missing: 0, available: 0, inProgress: 0, guaranteedInProgress: 0, estimatedInProgress: 0 },
  ]);
  assert.deepEqual(joined.gatherNext[0].items.map(({ key }) => key), ["items:9"], "gatherNext keeps live grouping semantics");
});

test("completed craft plan validation reports every calculation invariant without throwing", () => {
  assert.equal(typeof craftPlanning.validateCompletedCraftPlan, "function");
  const validPlan = () => ({
    materials: [{
      key: "items:7",
      id: "7",
      kind: "items",
      planRequired: 10,
      requiredNow: 6,
      missingNow: 2,
      required: 6,
      missing: 2,
      available: 4,
      inProgress: 0,
      guaranteedInProgress: 0,
      estimatedInProgress: 0,
    }],
    steps: [{ selectedRecipeId: "route-a", alternatives: [{ id: "route-a" }], output: { key: "items:7" } }],
    config: { routeOverrides: { "items:7": "route-a" } },
    unavailableSources: [],
    effortProgress: {
      baselineRevision: "baseline-1",
      confirmed: { overall: { completion: 40 }, sections: { Other: { completion: 40 } } },
      projected: { overall: { completion: 50 }, sections: { Other: { completion: 50 } } },
    },
  });
  const requiredSources = [{ sourceId: "claim:1", label: "Settlement inventories", type: "Settlement storage", available: true }];
  const previousPlan = validPlan();

  assert.deepEqual(craftPlanning.validateCompletedCraftPlan(validPlan(), { requiredSources, previousPlan }), {
    valid: true,
    baselineRevision: "baseline-1",
    errors: [],
  });

  const invalidCases = [
    ["duplicate typed key", "duplicate_material_key", (plan) => plan.materials.push({ ...plan.materials[0] })],
    ["invalid typed key", "invalid_material_key", (plan) => { plan.materials[0].key = "item:7"; }],
    ["non-finite quantity", "invalid_material_quantity", (plan) => { plan.materials[0].requiredNow = Number.NaN; }],
    ["negative quantity", "invalid_material_quantity", (plan) => { plan.materials[0].missingNow = -1; }],
    ["invalid selected route", "invalid_selected_route", (plan) => { plan.steps[0].selectedRecipeId = "route-b"; }],
    ["selected route with unavailable probability expansion", "incomplete_recipe_expansion", (plan) => { plan.steps[0].alternatives[0].probabilityStatus = "unavailable"; }],
    ["selected route does not satisfy its configured override", "invalid_selected_route", (plan) => { plan.config.routeOverrides["items:7"] = "route-b"; }],
    ["incomplete required source", "required_source_incomplete", (_plan, sources) => { delete sources[0].sourceId; }],
    ["changed canonical total in the same baseline revision", "unstable_baseline_material", (plan) => { plan.materials[0].planRequired = 11; }],
    ["added canonical material in the same baseline revision", "unstable_baseline_material", (plan) => { plan.materials.push({ ...plan.materials[0], key: "cargo:7", kind: "cargo" }); }],
    ["removed canonical material in the same baseline revision", "unstable_baseline_material", (plan) => { plan.materials = []; }],
    ["projected overall progress below confirmed", "projected_progress_regression", (plan) => { plan.effortProgress.projected.overall.completion = 39; }],
    ["projected section progress below confirmed", "projected_progress_regression", (plan) => { plan.effortProgress.projected.sections.Other.completion = 39; }],
  ];

  for (const [label, expectedCode, mutate] of invalidCases) {
    const plan = validPlan();
    const sources = structuredClone(requiredSources);
    mutate(plan, sources);
    const result = craftPlanning.validateCompletedCraftPlan(plan, { requiredSources: sources, previousPlan });
    assert.equal(result.valid, false, label);
    assert.ok(result.errors.some((error) => error.code === expectedCode), `${label}: ${JSON.stringify(result.errors)}`);
    if (expectedCode === "unstable_baseline_material") {
      const publication = craftPlanning.selectCraftPlanPublication({ candidatePlan: plan, lastGoodPlan: previousPlan, validation: result });
      assert.strictEqual(publication.plan, previousPlan, `${label}: last-good plan must be retained`);
      assert.equal(publication.retainedLastGood, true, `${label}: publication must report retained last-good`);
    }
  }
});

test("saved routes remain valid when live stock suppresses their recipe steps", () => {
  const material = {
    key: "items:7",
    id: "7",
    kind: "items",
    required: 0,
    missing: 0,
  };
  const candidatePlan = {
    config: { routeOverrides: { "items:7": "route-a" } },
    materials: [material],
    gatherNext: [],
    steps: [],
    unavailableSources: [],
    effortProgress: { baselineRevision: "baseline-1" },
  };
  const baselinePlan = {
    materials: [{ ...material, required: 10, missing: 10 }],
    steps: [{
      selectedRecipeId: "route-a",
      alternatives: [{ id: "route-a", probabilityStatus: "available" }],
      output: { key: "items:7", id: "7", kind: "items" },
    }],
  };

  const completed = craftPlanning.finalizeCraftPlanPublication({ candidatePlan, baselinePlan });

  assert.equal(completed.validation.valid, true);
  assert.deepEqual(completed.validation.errors, []);
  assert.strictEqual(completed.plan, completed.candidatePlan);
});

test("informational source routes with unavailable yields do not block an otherwise complete plan", () => {
  const informationalRoute = {
    selectedRecipeId: "gather-unknown-yield",
    probabilityStatus: "unavailable",
    alternatives: [{ id: "gather-unknown-yield", probabilityStatus: "unavailable" }],
    output: { key: "items:7", id: "7", kind: "items" },
  };
  const plan = {
    config: { routeOverrides: {} },
    materials: [{
      key: "items:7",
      id: "7",
      kind: "items",
      planRequired: 1,
      requiredNow: 1,
      missingNow: 1,
      required: 1,
      missing: 1,
      sourceRoutes: [informationalRoute],
    }],
    gatherNext: [],
    steps: [],
    unavailableSources: [],
    effortProgress: { baselineRevision: "baseline-1" },
  };

  assert.deepEqual(craftPlanning.validateCompletedCraftPlan(plan), {
    valid: true,
    baselineRevision: "baseline-1",
    errors: [],
  });

  plan.config.routeOverrides["items:7"] = "gather-unknown-yield";
  const selected = craftPlanning.validateCompletedCraftPlan(plan);
  assert.equal(selected.valid, false);
  assert.ok(selected.errors.some((error) => error.code === "incomplete_recipe_expansion"));
});

test("gather-only invalid materials cannot publish while ordinary gather mirrors are not duplicates", () => {
  const topMaterial = {
    key: "items:7",
    id: "7",
    kind: "items",
    required: 4,
    missing: 2,
  };
  const basePlan = () => ({
    config: { routeOverrides: {} },
    materials: [topMaterial],
    gatherNext: [{ section: "Woodworking", items: [topMaterial] }],
    steps: [],
    unavailableSources: [],
    effortProgress: { baselineRevision: "baseline-1" },
  });
  const baselinePlan = { materials: [{ key: "items:7", required: 10 }] };
  const ordinary = craftPlanning.finalizeCraftPlanPublication({ candidatePlan: basePlan(), baselinePlan });
  assert.equal(ordinary.validation.valid, true);
  assert.equal(ordinary.validation.errors.some((error) => error.code === "duplicate_material_key"), false);

  const invalidGatherCases = [
    ["non-finite quantity", { key: "items:8", id: "8", kind: "items", required: Number.NaN, missing: 1 }, "invalid_material_quantity"],
    ["negative quantity", { key: "items:8", id: "8", kind: "items", required: 1, missing: -1 }, "invalid_material_quantity"],
    ["invalid typed key", { key: "item:8", id: "8", kind: "items", required: 1, missing: 1 }, "invalid_material_key"],
  ];
  for (const [label, gatherMaterial, expectedCode] of invalidGatherCases) {
    const candidatePlan = basePlan();
    candidatePlan.gatherNext.push({ section: "Gather only", items: [gatherMaterial] });
    const lastGoodPlan = { marker: "last-good" };
    const result = craftPlanning.finalizeCraftPlanPublication({ candidatePlan, baselinePlan, lastGoodPlan });
    assert.equal(result.validation.valid, false, label);
    assert.ok(result.validation.errors.some((error) => error.code === expectedCode), label);
    assert.strictEqual(result.plan, lastGoodPlan, label);
    assert.equal(result.retainedLastGood, true, label);
  }
});

test("noncanonical whitespace typed keys fail validation and cannot publish with a zero canonical total", () => {
  const candidatePlan = {
    config: { routeOverrides: {} },
    materials: [{
      key: " items:7 ",
      id: "7",
      kind: "items",
      required: 4,
      missing: 2,
    }],
    gatherNext: [],
    steps: [],
    unavailableSources: [],
    effortProgress: { baselineRevision: "baseline-1" },
  };
  const lastGoodPlan = { marker: "last-good" };
  const result = craftPlanning.finalizeCraftPlanPublication({
    candidatePlan,
    baselinePlan: { materials: [{ key: "items:7", required: 10 }] },
    lastGoodPlan,
  });

  assert.equal(result.candidatePlan.materials[0].planRequired, 0);
  assert.equal(result.validation.valid, false);
  assert.ok(result.validation.errors.some((error) => (
    error.code === "invalid_material_key"
    && error.path === "materials[0].key"
  )));
  assert.strictEqual(result.plan, lastGoodPlan);
  assert.equal(result.retainedLastGood, true);
});

test("invalid completed craft plans retain the exact last-good publication and otherwise fail closed", () => {
  assert.equal(typeof craftPlanning.selectCraftPlanPublication, "function");
  const candidatePlan = { marker: "invalid-live-values" };
  const lastGoodPlan = { marker: "last-good-complete-plan" };
  const invalid = {
    valid: false,
    baselineRevision: "baseline-1",
    errors: [{ code: "invalid_material_quantity", path: "materials[0].missingNow", message: "Invalid quantity" }],
  };

  const retained = craftPlanning.selectCraftPlanPublication({ candidatePlan, lastGoodPlan, validation: invalid });
  assert.strictEqual(retained.plan, lastGoodPlan);
  assert.equal(retained.retainedLastGood, true);
  assert.deepEqual(retained.diagnostic, invalid);
  assert.deepEqual(craftPlanning.selectCraftPlanPublication({ candidatePlan, validation: invalid }), {
    plan: null,
    retainedLastGood: false,
    diagnostic: invalid,
  });
  assert.deepEqual(craftPlanning.selectCraftPlanPublication({ candidatePlan, lastGoodPlan, validation: { valid: true, errors: [] } }), {
    plan: candidatePlan,
    retainedLastGood: false,
    diagnostic: null,
  });
});

test("configured planner sources missing from a completed projection remain explicit source-health warnings", () => {
  assert.equal(typeof craftPlanning.reconcileCraftPlanRequiredSourceStatus, "function");
  const config = normalizeCraftPlanConfig({
    sourceRules: {
      storageContainerIds: ["storage-present", "storage-missing"],
      bankContainerIds: ["player-1:bank-missing"],
      deployableContainerIds: ["player-1:cart-missing"],
    },
  });
  const requiredSources = craftPlanning.reconcileCraftPlanRequiredSourceStatus(config, [{
    sourceId: "storage-present",
    label: "Present storage",
    type: "Settlement storage",
    available: true,
    error: "",
  }]);
  const material = {
    key: "items:7",
    id: "7",
    kind: "items",
    planRequired: 10,
    requiredNow: 4,
    missingNow: 4,
    required: 4,
    missing: 4,
  };
  const candidatePlan = {
    config,
    materials: [material],
    gatherNext: [],
    steps: [],
    unavailableSources: [],
    effortProgress: { baselineRevision: "baseline-1" },
  };
  const validation = craftPlanning.validateCompletedCraftPlan(candidatePlan, { requiredSources });
  const publication = craftPlanning.selectCraftPlanPublication({ candidatePlan, validation });

  assert.deepEqual(
    requiredSources.filter((source) => source.available === false).map((source) => source.sourceId),
    ["storage-missing", "player-1:bank-missing", "player-1:cart-missing"],
  );
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.strictEqual(publication.plan, candidatePlan);
  assert.equal(publication.retainedLastGood, false);
});

test("configured deployable canonical and legacy aliases are both recognized as present", () => {
  const config = normalizeCraftPlanConfig({
    sourceRules: {
      deployableContainerIds: ["player-1:cart", "player-1:raw-wagon-42"],
    },
  });
  const requiredSources = craftPlanning.reconcileCraftPlanRequiredSourceStatus(config, [{
    sourceId: "player-1:cart",
    legacySourceIds: ["player-1:raw-wagon-42"],
    label: "Cart",
    type: "Player deployable",
    available: true,
    error: "",
  }]);

  assert.deepEqual(requiredSources, [{
    sourceId: "player-1:cart",
    legacySourceIds: ["player-1:raw-wagon-42"],
    label: "Cart",
    type: "Player deployable",
    available: true,
    error: "",
  }]);
});

test("required-source reconciliation ignores unselected categories and retains selected personal scopes", () => {
  const shared = craftPlanning.reconcileCraftPlanRequiredSourceStatus(normalizeCraftPlanConfig({
    sourceRules: { storageContainerIds: ["selected-store"] },
  }), [
    { sourceId: "selected-store", label: "Selected", type: "Settlement storage", available: true },
    { sourceId: "unselected-store", label: "Unselected", type: "Settlement storage", available: false },
    { sourceId: "player-2", label: "Other inventory", type: "Player inventory", available: false },
    { sourceId: "player-2:crafts", label: "Other crafts", type: "Tracked crafts", available: false },
  ]);
  assert.deepEqual(shared.map(({ sourceId }) => sourceId), ["selected-store"]);

  const personal = craftPlanning.reconcileCraftPlanRequiredSourceStatus(normalizeCraftPlanConfig({
    sourceRules: { playerIds: ["player-1"], craftPlayerIds: ["player-1"] },
  }), [
    { sourceId: "player-1", label: "Owner inventory", type: "Player inventory", available: false },
    { sourceId: "player-1:crafts", label: "Owner crafts", type: "Tracked crafts", available: false },
    { sourceId: "player-1:passive-crafts", label: "Owner passive crafts", type: "Tracked passive crafts", available: false },
    { sourceId: "settlement-crafts", label: "Settlement crafts", type: "Tracked crafts", available: false },
  ]);
  assert.deepEqual(personal.map(({ sourceId }) => sourceId), ["player-1", "player-1:crafts", "player-1:passive-crafts"]);
  assert.equal(craftPlanning.validateCompletedCraftPlan({ materials: [], gatherNext: [], steps: [], unavailableSources: [] }, { requiredSources: personal }).valid, true);
});

test("unselected craft collection failures do not make a plan unavailable", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "7", kind: "items", name: "Log", quantity: 1 }],
      sourceRules: { craftPlayerIds: [] },
    }),
    detailsByKey: new Map([["items:7", { item: { id: "7", kind: "items", name: "Log" }, craftingRecipes: [] }]]),
    craftSourceErrors: [{ sourceId: "settlement-crafts", label: "Settlement crafts", type: "Tracked crafts", error: "offline" }],
  });
  assert.deepEqual(plan.unavailableSources, []);
});

test("effort-unavailable plans still pass through enrichment, validation, and last-good publication", () => {
  assert.equal(typeof craftPlanning.finalizeCraftPlanPublication, "function");
  const material = {
    key: "items:7",
    id: "7",
    kind: "items",
    required: 4,
    missing: 2,
  };
  const candidatePlan = {
    config: { routeOverrides: {} },
    materials: [material],
    gatherNext: [{ section: "Woodworking", items: [material] }],
    steps: [],
    unavailableSources: [],
    effortProgress: { state: "unavailable", baselineRevision: "baseline-1" },
  };
  const baselinePlan = { materials: [{ key: "items:7", required: 10 }] };
  const requiredSources = [{ sourceId: "storage-1", label: "Storage", type: "Settlement storage", available: true }];
  const completed = craftPlanning.finalizeCraftPlanPublication({
    candidatePlan,
    baselinePlan,
    requiredSources,
    baselineRevision: "baseline-1",
  });

  assert.equal(completed.validation.valid, true);
  assert.strictEqual(completed.plan, completed.candidatePlan);
  assert.deepEqual(
    completed.plan.gatherNext[0].items[0],
    completed.plan.materials[0],
  );
  assert.deepEqual(
    {
      planRequired: completed.plan.materials[0].planRequired,
      requiredNow: completed.plan.materials[0].requiredNow,
      missingNow: completed.plan.materials[0].missingNow,
    },
    { planRequired: 10, requiredNow: 4, missingNow: 2 },
  );

  const invalidCandidate = structuredClone(candidatePlan);
  invalidCandidate.materials[0].required = Number.NaN;
  const lastGoodPlan = { marker: "last-good-complete-plan" };
  const rejected = craftPlanning.finalizeCraftPlanPublication({
    candidatePlan: invalidCandidate,
    baselinePlan,
    requiredSources,
    baselineRevision: "baseline-1",
    lastGoodPlan,
  });
  assert.equal(rejected.validation.valid, false);
  assert.strictEqual(rejected.plan, lastGoodPlan);
  assert.equal(rejected.retainedLastGood, true);
});

test("compactCraftPlanResponse keeps live board values without nested drilldown payloads", () => {
  const material = { key: "items:1", name: "Cloth", required: 100, available: 30, inProgress: 20, guaranteedInProgress: 12, estimatedInProgress: 8, plannedOutput: 10, missing: 50, sources: [{ quantity: 30 }], activeCraftSources: [{ quantity: 20 }], sourceRoutes: [{ id: "route" }], recipeUsages: [{ outputKey: "items:2" }] };
  const compact = compactCraftPlanResponse({
    enabled: true,
    materials: [material],
    steps: [{ output: material }],
    gatherNext: [{ section: "Tailoring", items: [material] }],
    totals: { missingItems: 1 },
    effortProgress: { modelVersion: 1, overall: { completion: 40 }, sections: { Tailoring: { completion: 40 } } },
  });

  assert.deepEqual(compact.materials[0], { key: "items:1", name: "Cloth", required: 100, available: 30, inProgress: 20, guaranteedInProgress: 12, estimatedInProgress: 8, missing: 50, hasSourceRoutes: true, hasRecipeUsages: true });
  assert.equal("plannedOutput" in compact.materials[0], false);
  assert.deepEqual(compact.steps, []);
  assert.deepEqual(compact.gatherNext[0].items[0], compact.materials[0]);
  assert.equal(compact.totals.missingItems, 1);
  assert.equal(compact.effortProgress.overall.completion, 40);
  assert.doesNotMatch(JSON.stringify(compact), /effortWeight|candidate/i);
});

test("Craft Planner workspace creates one shared compact projection", () => {
  assert.equal(typeof craftPlanning.createCraftPlanResponseWorkspace, "function");
  let projections = 0;
  const plan = { enabled: true, materials: [{ key: "item:1" }] };
  const workspace = craftPlanning.createCraftPlanResponseWorkspace(plan, (value) => {
    projections += 1;
    return { enabled: value.enabled };
  });

  assert.equal(workspace.plan, plan);
  assert.equal(workspace.compact(), workspace.compact());
  assert.equal(projections, 1);
});

test("craftPlanDetailResponse returns drilldown data only for requested material keys", () => {
  const cloth = { key: "items:1", name: "Cloth", sources: [{ quantity: 30 }], sourceRoutes: [{ id: "route" }], recipeUsages: [{ outputKey: "items:2" }] };
  const thread = { key: "items:2", name: "Thread", sources: [{ quantity: 10 }] };
  const plan = { materials: [cloth, thread], steps: [{ id: "route", output: { key: "items:1" } }, { id: "other", output: { key: "items:2" } }] };
  const detail = craftPlanDetailResponse(plan, ["items:1"]);

  assert.deepEqual(detail.materials, [cloth]);
  assert.deepEqual(detail.steps, [plan.steps[0]]);
});

function animalHairSourceDetails() {
  const hair = { id: "200", name: "Rough Animal Hair", itemType: 0, kind: "items", tag: "Hunting" };
  const output = { id: "201", name: "Rough Animal Output", itemType: 0, kind: "items", tag: "Hunting" };
  const sagiBird = { id: "202", name: "Sagi Bird", itemType: 0, kind: "items", tag: "Hunting" };
  const processingSalt = { id: "203", name: "Processing Salt", itemType: 0, kind: "items", tag: "Hunting" };
  return { hair, output, sagiBird, processingSalt, detailsByKey: new Map([
    [recipeKey("items", hair.id), { item: hair }],
    [recipeKey("items", output.id), {
      item: output,
      craftingRecipes: [{
        id: "process-sagi-bird",
        name: "Process Sagi Bird",
        skillName: "Hunting",
        craftedItemStacks: [{ item_id: output.id, item_type: "item", quantity: 1 }],
        consumedItemStacks: [
          { item_id: sagiBird.id, item_type: "item", quantity: 1 },
          { item_id: processingSalt.id, item_type: "item", quantity: 2 },
        ],
        consumedItems: [sagiBird, processingSalt],
      }],
      itemListPossibilities: [{ targetId: hair.id, targetItem: hair, quantity: 1, chance: 0.25 }],
    }],
    [recipeKey("items", sagiBird.id), { item: sagiBird }],
    [recipeKey("items", processingSalt.id), { item: processingSalt }],
  ]) };
}

function fishingPreferenceDetails({ oceanYield = 3, lakeYield = 1 } = {}) {
  const oil = { id: "1900", name: "Basic Fish Oil", itemType: 0, tag: "Fish Oil", tier: 1 };
  const ocean = { id: "1901", name: "Briny Linus", itemType: 0, tag: "Ocean Fish", tier: 1 };
  const lake = { id: "1902", name: "Briny Argus", itemType: 0, tag: "Lake Fish", tier: 1 };
  return new Map([[recipeKey("items", oil.id), {
    item: oil,
    craftingRecipes: [
      {
        id: "ocean-fish-oil",
        name: "Press Ocean Fish Oil",
        craftedItemStacks: [{ item_id: oil.id, item_type: "item", quantity: oceanYield * 2, quantityMin: oceanYield }],
        consumedItemStacks: [{ item_id: ocean.id, item_type: "item", quantity: 1 }],
        consumedItems: [ocean],
        levelRequirements: [{ skill: { name: "Fishing" }, level: 1 }],
      },
      {
        id: "lake-fish-oil",
        name: "Press Lake Fish Oil",
        craftedItemStacks: [{ item_id: oil.id, item_type: "item", quantity: lakeYield * 2, quantityMin: lakeYield }],
        consumedItemStacks: [{ item_id: lake.id, item_type: "item", quantity: 1 }],
        consumedItems: [lake],
        levelRequirements: [{ skill: { name: "Fishing" }, level: 1 }],
      },
    ],
  }], [recipeKey("items", ocean.id), { item: ocean }], [recipeKey("items", lake.id), { item: lake }]]);
}

function probabilisticFishingPreferenceDetails() {
  const oil = { id: "1900", name: "Basic Fish Oil", itemType: 0, tag: "Fish Oil", tier: 1 };
  const ocean = { id: "1901", name: "Briny Linus", itemType: 0, tag: "Ocean Fish", tier: 1 };
  const lake = { id: "1902", name: "Briny Argus", itemType: 0, tag: "Lake Fish", tier: 1 };
  const products = { id: "1903", name: "Ocean Fish Products", itemType: 0, tag: "Fish Products", tier: 1 };
  return new Map([[recipeKey("items", oil.id), {
    item: oil,
    craftingRecipes: [{
      id: "lake-fish-oil",
      name: "Press Lake Fish Oil",
      craftedItemStacks: [{ item_id: oil.id, item_type: "item", quantity: 1, quantityMin: 1 }],
      consumedItemStacks: [{ item_id: lake.id, item_type: "item", quantity: 1 }],
      consumedItems: [lake],
    }],
  }], [recipeKey("items", products.id), {
    item: products,
    craftingRecipes: [{
      id: "process-ocean-fish",
      name: "Process Ocean Fish",
      craftedItemStacks: [{ item_id: products.id, item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: ocean.id, item_type: "item", quantity: 1 }],
      consumedItems: [ocean],
    }],
    itemListPossibilities: [{ targetId: oil.id, targetItem: oil, quantity: 4, chance: 0.5 }],
  }], [recipeKey("items", ocean.id), { item: ocean }], [recipeKey("items", lake.id), { item: lake }]]);
}

const CATALOG_UPDATED_AT = "2026-07-10T12:00:00.000Z";

function createCatalogFixture(t) {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  db.exec("PRAGMA foreign_keys = ON;");
  t.after(() => db.close());
  return { db, repository: createGameCatalogRepository(db) };
}

function upsertCatalogDetails(repository, details) {
  for (const detail of details) repository.upsertDetail(detail, { updatedAt: CATALOG_UPDATED_AT });
}

test("local catalog planner uses normalized gathering probability, resource effort, full-resource yield, and safety buffer", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "1007577047", name: "T2 Berry Output", itemListId: "1423411753", tag: "Berry Output" },
      extractionRecipes: [{
        id: 78,
        resourceId: 80,
        resourceName: "Honeyberry Bush",
        extractedItemStacks: [{ item_stack: { item_id: 1007577047, item_type: "Item", quantity: 1 }, probability: 0.06723 }],
        levelRequirements: [{ skill: { name: "Foraging" }, level: 20 }],
      }],
    },
    { item: { id: "2130004", name: "Simple Berry", tier: 2, tag: "Berry" } },
    { item: { id: "115737343", name: "Simple Citric Berry", tier: 2, tag: "Berry" } },
  ]);
  repository.replaceProbabilitySnapshot({
    itemLists: normalizeGameDataItemLists([{ id: 1423411753, possibilities: [
      { probability: 1, items: [{ item_id: 2130004, item_type: "Item", quantity: 1 }] },
      { probability: 0.02, items: [{ item_id: 115737343, item_type: "Item", quantity: 1 }] },
    ] }]),
    resources: normalizeGameDataResources([{ id: 80, name: "Honeyberry Bush", max_health: 595, on_destroy_yield: [] }]),
    sourceUrl: "https://example.test/static",
  });

  const targetKey = recipeKey("items", "2130004");
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "2130004", kind: "items", name: "Simple Berry", quantity: 100 }],
    multipliers: { [targetKey]: { multiplier: 1.1, note: "10% extra" } },
  });
  const catalog = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({ config, detailsByKey: catalog.detailsByKey, catalogWarnings: catalog.warnings });
  const step = plan.steps.find((row) => row.output.id === "2130004");
  const expectedPerProgress = 0.06723 / 1.02;

  assert.equal(step.yieldBasis, "per_progress");
  assert.equal(step.expectedPerProgress, expectedPerProgress);
  assert.equal(step.expectedPerResource, 39.2175);
  assert.equal(step.resourceHealth, 595);
  assert.equal(step.unbufferedCraftCount, Math.ceil(100 / expectedPerProgress));
  assert.equal(step.craftCount, Math.ceil(110 / expectedPerProgress));
  assert.equal(step.expectedEffort, step.craftCount);
  assert.equal(step.expectedResourceEquivalents, step.craftCount / 595);
  assert.equal(step.probabilityStatus, "expected");
});

test("local catalog planner keeps prospecting per progress and omits full-resource equivalents", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [{
    cargo: { id: "62000", itemType: 1, name: "Prospected Crystal" },
    extractionRecipes: [{
      id: 620,
      cargoId: 62000,
      resourceId: 0,
      name: "Gather Prospected Crystal",
      levelRequirements: [{ skill: { name: "Crystal Prospecting" }, level: 1 }],
      extractedItemStacks: [1, 0.5].map((probability) => ({
        item_stack: { item_id: 62000, item_type: "Cargo", quantity: 1 },
        probability,
      })),
    }],
  }]);
  repository.replaceProbabilitySnapshot({
    itemLists: [],
    resources: normalizeGameDataResources([{ id: 0, name: "Displayed Crystal Node", max_health: 250000 }]),
    sourceUrl: "https://example.test/static",
  });

  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "62000", kind: "cargo", itemType: 1, name: "Prospected Crystal", quantity: 10 }],
  });
  const catalog = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({ config, detailsByKey: catalog.detailsByKey, catalogWarnings: catalog.warnings });
  const step = plan.steps.find((row) => row.output.id === "62000");

  assert.equal(step.gatheringMode, "prospecting");
  assert.equal(step.yieldBasis, "per_progress");
  assert.equal(step.expectedPerProgress, 1.5);
  assert.equal(step.expectedPerResource, null);
  assert.equal(step.resourceHealth, null);
  assert.equal(step.expectedResourceEquivalents, null);
  assert.equal(step.guaranteedYield, 1);
  assert.equal(step.probabilityStatus, "expected");
});

test("local catalog planner exposes resource-completion-only outputs as full-resource routes", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "500", name: "Tree Output" },
      extractionRecipes: [{
        id: 90,
        resourceId: 91,
        extractedItemStacks: [{ item_stack: { item_id: 500, item_type: "Item", quantity: 1 }, probability: 1 }],
        levelRequirements: [{ skill: { name: "Forestry" }, level: 1 }],
      }],
    },
    { item: { id: "501", name: "Completion Seed" } },
  ]);
  repository.replaceProbabilitySnapshot({
    itemLists: normalizeGameDataItemLists([{ id: 1, possibilities: [{ probability: 1, items: [] }] }]),
    resources: normalizeGameDataResources([{ id: 91, name: "Test Tree", max_health: 100, on_destroy_yield: [
      { item_id: 501, item_type: "Item", quantity: 2 },
    ] }]),
    sourceUrl: "https://example.test/static",
  });

  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "501", kind: "items", name: "Completion Seed", quantity: 10 }],
  });
  const catalog = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({ config, detailsByKey: catalog.detailsByKey, catalogWarnings: catalog.warnings });
  const step = plan.steps.find((row) => row.output.id === "501");

  assert.equal(step.expectedPerProgress, 0.02);
  assert.equal(step.expectedPerResource, 2);
  assert.equal(step.resourceHealth, 100);
  assert.equal(step.expectedEffort, 500);
  assert.equal(step.expectedResourceEquivalents, 5);
  assert.equal(step.probabilityStatus, "expected");
});

test("local catalog planner converts expected craft output into completions and total recipe work", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "3000", name: "Weighted Product Bundle", itemListId: "5000" },
      craftingRecipes: [{
        id: "make-weighted-bundle",
        actions_required: 5,
        craftedItemStacks: [{ item_id: "3000", item_type: "item", quantity: 1 }],
        consumedItemStacks: [{ item_id: "3002", item_type: "item", quantity: 1 }],
      }],
    },
    { item: { id: "3001", name: "Weighted Product", tier: 2 } },
    { item: { id: "3002", name: "Crafting Input", tier: 2 } },
  ]);
  repository.replaceProbabilitySnapshot({
    itemLists: normalizeGameDataItemLists([{ id: 5000, possibilities: [
      { probability: 98, items: [{ item_id: 3001, item_type: "Item", quantity: 2 }] },
      { probability: 2, items: [{ item_id: 3001, item_type: "Item", quantity: 53 }] },
    ] }]),
    resources: [],
    sourceUrl: "https://example.test/static",
  });

  const targetKey = recipeKey("items", "3001");
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "3001", kind: "items", name: "Weighted Product", quantity: 9 }],
    multipliers: { [targetKey]: { multiplier: 1.1 } },
  });
  const catalog = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({ config, detailsByKey: catalog.detailsByKey, catalogWarnings: catalog.warnings });
  const step = plan.steps.find((row) => row.output.id === "3001");

  assert.equal(step.expectedPerCraft, 3.02);
  assert.equal(step.guaranteedYield, 2);
  assert.equal(step.unbufferedCraftCount, 3);
  assert.equal(step.craftCount, 4);
  assert.equal(step.unbufferedExpectedEffort, 15);
  assert.equal(step.expectedEffort, 20);
  assert.equal(step.probabilityStatus, "expected");
});

test("local catalog planner preserves producer routes while validated yields are unavailable", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    { item: { id: "4100", itemType: 0, name: "Chance Output", tag: "Output", tier: 1 } },
    {
      item: { id: "4101", itemType: 0, name: "Chance Bundle", tag: "Products", tier: 1 },
      craftingRecipes: [{
        id: "make-bundle",
        name: "Process Chance Plant",
        stationName: "Farming Station",
        craftedItemStacks: [{ item_id: "4101", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "4101", itemType: 0, name: "Chance Bundle", tag: "Products", tier: 1 }],
        consumedItemStacks: [{ item_id: "4102", item_type: "item", quantity: 1 }],
        consumedItems: [{ id: "4102", itemType: 0, name: "Chance Plant", tag: "Plant", tier: 1 }],
      }],
      itemListPossibilities: [{
        targetId: "4100",
        targetItem: { id: "4100", itemType: 0, name: "Chance Output", tag: "Output", tier: 1 },
        quantity: 1,
        chance: 0.5,
      }],
    },
    { item: { id: "4102", itemType: 0, name: "Chance Plant", tag: "Plant", tier: 1 } },
    {
      item: { id: "4103", itemType: 0, name: "Alternative Bundle", tag: "Products", tier: 1 },
      craftingRecipes: [{
        id: "make-alternative-bundle",
        name: "Process Alternative Plant",
        stationName: "Farming Station",
        craftedItemStacks: [{ item_id: "4103", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "4103", itemType: 0, name: "Alternative Bundle", tag: "Products", tier: 1 }],
        consumedItemStacks: [{ item_id: "4104", item_type: "item", quantity: 1 }],
        consumedItems: [{ id: "4104", itemType: 0, name: "Alternative Plant", tag: "Plant", tier: 1 }],
      }],
      itemListPossibilities: [{
        targetId: "4100",
        targetItem: { id: "4100", itemType: 0, name: "Chance Output", tag: "Output", tier: 1 },
        quantity: 1,
        chance: 0.25,
      }],
    },
    { item: { id: "4104", itemType: 0, name: "Alternative Plant", tag: "Plant", tier: 1 } },
  ]);

  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "4100", kind: "items", name: "Chance Output", quantity: 10, itemType: 0 }],
  });
  const catalog = collectLocalCatalogCraftPlanDetails(
    repository,
    config.targets,
    config.routeOverrides,
    64,
    [],
    { requireValidatedProbabilities: true },
  );
  const plan = computeCraftPlan({ config, detailsByKey: catalog.detailsByKey, catalogWarnings: catalog.warnings });
  const target = plan.materials.find((row) => row.id === "4100");

  assert.equal(catalog.detailsByKey.get("items:4101")?.itemListPossibilities.length, 1);
  assert.equal(target?.sourceRoutes?.[0]?.producerRecipe?.name, "Process Chance Plant");
  assert.equal(target?.sourceRoutes?.[0]?.probabilityStatus, "unavailable");
  assert.equal(target?.sourceRoutes?.[0]?.expectedYield, null);
  assert.deepEqual(
    target?.sourceRoutes?.[0]?.alternatives.map((route) => route.label).sort(),
    ["Process Alternative Plant -> Chance Output", "Process Chance Plant -> Chance Output"],
  );
  assert.equal(plan.materials.some((row) => row.id === "4102"), false);
  assert.equal(plan.materials.some((row) => row.id === "4104"), false);
  assert.match(plan.warnings.join("\n"), /validated output rate unavailable.*items:4100/i);
});

test("normalizeCraftPlanConfig preserves targets, sources, route overrides, and multipliers", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "900", kind: "items", name: "Fish Oil", quantity: "12", itemType: 0 }],
    sourceRules: {
      storageContainerIds: ["store-1", "", "store-1"],
      playerIds: ["player-1"],
      craftPlayerIds: ["player-1"],
      bankPlayerIds: ["player-bank", "player-bank", ""],
      bankContainerIds: ["player-bank:bank-2", "", "player-bank:bank-2"],
      deployableContainerIds: ["player-1:cart-1"],
    },
    routeOverrides: { [recipeKey("items", "900")]: "lake-route" },
    multipliers: { [recipeKey("items", "200")]: { multiplier: "1.75", note: "Chance drop" } },
  });

  assert.equal(config.enabled, true);
  assert.equal(config.targets[0].quantity, 12);
  assert.deepEqual(config.sourceRules.storageContainerIds, ["store-1"]);
  assert.deepEqual(config.sourceRules.playerIds, ["player-1"]);
  assert.deepEqual(config.sourceRules.craftPlayerIds, ["player-1"]);
  assert.deepEqual(config.sourceRules.bankPlayerIds, ["player-bank"]);
  assert.deepEqual(config.sourceRules.bankContainerIds, ["player-bank:bank-2"]);
  assert.deepEqual(config.sourceRules.deployableContainerIds, ["player-1:cart-1"]);
  assert.equal(config.routeOverrides[recipeKey("items", "900")], "lake-route");
  assert.equal(config.multipliers[recipeKey("items", "200")].multiplier, 1.75);
});

test("normalizeCraftPlanConfig defaults craft tracking to selected players for existing plans", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "900", kind: "items", name: "Fish Oil", quantity: 1, itemType: 0 }],
    sourceRules: { playerIds: ["player-1", "player-2"] },
  });

  assert.deepEqual(config.sourceRules.craftPlayerIds, ["player-1", "player-2"]);
  assert.deepEqual(config.sourceRules.bankPlayerIds, []);
  assert.deepEqual(config.sourceRules.bankContainerIds, []);
});

test("normalizeCraftPlanConfig validates, deduplicates, and sorts gathered item keys", () => {
  const config = normalizeCraftPlanConfig({
    gatheredItemKeys: ["items:600", "", "items:600", "building:9", "invalid", "cargo:200"],
  });

  assert.deepEqual(config.gatheredItemKeys, ["cargo:200", "items:600"]);
  assert.deepEqual(normalizeCraftPlanConfig({}).gatheredItemKeys, []);
});

test("computeCraftPlan ignores legacy gathered overrides and follows the selected route", () => {
  const key = recipeKey("items", "600");
  const detailsByKey = new Map([[key, {
    item: { id: "600", itemType: 0, name: "Rough Stone Carvings" },
    craftingRecipes: [{
      id: "carve-stone",
      name: "Carve Rough Stone Carvings",
      buildingName: "Scholar Station",
      actionsRequired: 4,
      craftedItemStacks: [{ item_id: "600", item_type: "item", quantity: 2 }],
      consumedItemStacks: [{ item_id: "601", item_type: "item", quantity: 3 }],
      consumedItems: [{ id: "601", itemType: 0, name: "Rough Stone" }],
    }],
  }]]);
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "600", kind: "items", itemType: 0, name: "Rough Stone Carvings", quantity: 5 }],
      gatheredItemKeys: [key],
      routeOverrides: { [key]: "carve-stone" },
    }),
    detailsByKey,
  });

  assert.equal(plan.steps[0].selectedRecipeId, "carve-stone");
  assert.equal(plan.materials.find((item) => item.key === key)?.isGatheredOverride, false);
  assert.equal(plan.materials.find((item) => item.key === key)?.sourceRoutes.length, 1);
});

test("computeCraftPlan counts player bank sources as confirmed stock", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "900", kind: "items", name: "Simple Plank", quantity: 10, itemType: 0 }],
      sourceRules: { bankPlayerIds: ["player-1"] },
    }),
    detailsByKey: new Map([[recipeKey("items", "900"), {
      item: { id: "900", itemType: 0, name: "Simple Plank", tier: 2 },
    }]]),
    bankSources: [{
      sourceId: "player-1:bank-remote",
      label: "Town Bank — Remote Settlement",
      type: "Player bank",
      playerId: "player-1",
      playerName: "Modular",
      items: [{ id: "900", kind: "items", itemType: 0, name: "Simple Plank", quantity: 7 }],
    }],
  });

  const material = plan.materials.find((row) => row.id === "900");
  assert.equal(material.available, 7);
  assert.equal(material.missing, 3);
  assert.deepEqual(material.sources.map((source) => [source.label, source.type, source.playerName, source.quantity]), [
    ["Town Bank — Remote Settlement", "Player bank", "Modular", 7],
  ]);
});

test("craftPlanAuditDetails records saved toggle additions and removals with labels", () => {
  const previous = normalizeCraftPlanConfig({
    enabled: true,
    sourceRules: {
      storageContainerIds: ["store-old"],
      playerIds: ["player-1"],
      craftPlayerIds: [],
      bankContainerIds: ["player-1:bank-old"],
      deployableContainerIds: ["player-1:cart"],
    },
  });
  const next = normalizeCraftPlanConfig({
    enabled: false,
    sourceRules: {
      storageContainerIds: ["store-new"],
      playerIds: ["player-1"],
      craftPlayerIds: ["player-1"],
      bankContainerIds: ["player-1:bank-new"],
      deployableContainerIds: [],
    },
  });

  assert.deepEqual(craftPlanAuditDetails(previous, next, {
    storage: { "store-old": "Old Warehouse", "store-new": "New Warehouse" },
    player_inventory: { "player-1": "Alice" },
    player_crafts: { "player-1": "Alice" },
    player_bank: { "player-1:bank-old": "Old Town Bank", "player-1:bank-new": "New Town Bank" },
    deployable: { "player-1:cart": "Alice's Handcart" },
  }), {
    changes: [
      { category: "public_board", entityId: "public-board", label: "Public board", enabled: false },
      { category: "storage", entityId: "store-new", label: "New Warehouse", enabled: true },
      { category: "storage", entityId: "store-old", label: "Old Warehouse", enabled: false },
      { category: "player_crafts", entityId: "player-1", label: "Alice", enabled: true },
      { category: "player_bank", entityId: "player-1:bank-new", label: "New Town Bank", enabled: true },
      { category: "player_bank", entityId: "player-1:bank-old", label: "Old Town Bank", enabled: false },
      { category: "deployable", entityId: "player-1:cart", label: "Alice's Handcart", enabled: false },
    ],
    otherSettingsChanged: false,
  });
});

test("craftPlanAuditDetails ignores source order and summarizes other editable fields", () => {
  const previous = normalizeCraftPlanConfig({
    name: "Plan A",
    sourceRules: { storageContainerIds: ["2", "1"], playerIds: [], craftPlayerIds: [], deployableContainerIds: [] },
  });
  const reordered = normalizeCraftPlanConfig({
    name: "Plan B",
    sourceRules: { storageContainerIds: ["1", "2"], playerIds: [], craftPlayerIds: [], deployableContainerIds: [] },
  });

  assert.deepEqual(craftPlanAuditDetails(previous, reordered), {
    changes: [],
    otherSettingsChanged: true,
  });
});

test("craftPlanAuditDetails falls back to the stored source identifier", () => {
  const previous = normalizeCraftPlanConfig({ sourceRules: { storageContainerIds: [], playerIds: [], craftPlayerIds: [], deployableContainerIds: [] } });
  const next = normalizeCraftPlanConfig({ sourceRules: { storageContainerIds: ["missing-label"], playerIds: [], craftPlayerIds: [], deployableContainerIds: [] } });
  assert.equal(craftPlanAuditDetails(previous, next).changes[0].label, "missing-label");
});

test("craftPlanAuditDetails records gathered item enable and disable changes", () => {
  const previous = normalizeCraftPlanConfig({ gatheredItemKeys: ["items:old"] });
  const next = normalizeCraftPlanConfig({ gatheredItemKeys: ["items:new"] });

  assert.deepEqual(craftPlanAuditDetails(previous, next, {
    gathered_item: {
      "items:new": "Simple Stone Carvings",
      "items:old": "Rough Stone Carvings",
    },
  }), {
    changes: [
      { category: "gathered_item", entityId: "items:new", label: "Simple Stone Carvings", enabled: true },
      { category: "gathered_item", entityId: "items:old", label: "Rough Stone Carvings", enabled: false },
    ],
    otherSettingsChanged: false,
  });
});

test("craftPlanAuditDetails falls back to a gathered typed key when its label is unavailable", () => {
  const details = craftPlanAuditDetails(
    normalizeCraftPlanConfig({ gatheredItemKeys: [] }),
    normalizeCraftPlanConfig({ gatheredItemKeys: ["items:600"] }),
  );

  assert.equal(details.changes[0].label, "items:600");
});

test("craftPlanAuditLimit clamps requests to one through one hundred", () => {
  assert.equal(craftPlanAuditLimit(undefined), 100);
  assert.equal(craftPlanAuditLimit("0"), 1);
  assert.equal(craftPlanAuditLimit("25"), 25);
  assert.equal(craftPlanAuditLimit("999"), 100);
});

test("normalizeCraftPlanAuditRows tolerates malformed legacy details", () => {
  const rows = normalizeCraftPlanAuditRows([
    { id: 2, username: "Alice", occurred_at: "2026-07-16T10:00:00.000Z", details_json: JSON.stringify({ changes: [{ category: "storage", entityId: "1", label: "Warehouse", enabled: true }, { category: "unknown", entityId: "secret", label: "Ignored", enabled: true }], targets: 2, otherSettingsChanged: true }) },
    { id: 1, username: "Legacy", occurred_at: "2026-07-15T10:00:00.000Z", details_json: "{" },
  ]);
  assert.deepEqual(rows[0], {
    id: 2,
    username: "Alice",
    occurredAt: "2026-07-16T10:00:00.000Z",
    changes: [{ category: "storage", entityId: "1", label: "Warehouse", enabled: true }],
    otherSettingsChanged: true,
    summary: { targets: 2, players: 0, deployables: 0 },
  });
  assert.deepEqual(rows[1], {
    id: 1,
    username: "Legacy",
    occurredAt: "2026-07-15T10:00:00.000Z",
    changes: [],
    otherSettingsChanged: false,
    summary: { targets: 0, players: 0, deployables: 0 },
  });
});

test("chance metadata preserves normalized probability and expected yield", () => {
  const hair = { id: "200", name: "Rough Animal Hair", itemType: 0, kind: "items", tag: "Hunting" };
  const output = { id: "201", name: "Rough Animal Output", itemType: 0, kind: "items", tag: "Hunting" };
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ ...hair, quantity: 10 }] }),
    detailsByKey: new Map([[recipeKey("items", hair.id), { item: hair }], [recipeKey("items", output.id), {
      item: output,
      craftingRecipes: [{ id: "hunt", name: "Harvest", skillName: "Hunting", craftedItemStacks: [{ item_id: output.id, item_type: "item", quantity: 1 }], consumedItemStacks: [] }],
      itemListPossibilities: [{ targetId: hair.id, targetItem: hair, quantity: 1, chance: 25 }],
    }]]),
  });
  const route = plan.materials.find((row) => row.id === hair.id).sourceRoutes[0];
  assert.equal(route.isProbabilistic, true);
  assert.equal(route.dropQuantity, 1);
  assert.equal(route.dropChance, 0.25);
  assert.equal(route.expectedYield, 0.25);
});

test("multipliers apply only to probabilistic source materials", () => {
  const item = { id: "300", name: "Rough Brick", itemType: 0, kind: "items", tag: "Masonry" };
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ ...item, quantity: 10 }], multipliers: { [recipeKey("items", item.id)]: { multiplier: 1.5 } } }),
    detailsByKey: new Map([[recipeKey("items", item.id), { item }]]),
  });
  const material = plan.materials.find((row) => row.id === item.id);
  assert.equal(material.multiplier, 1);
  assert.equal(material.bufferedRequired, 10);
});

test("workstation targets preserve construction requirements and expand them for catalog lookup", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{
      id: "6020",
      kind: "building",
      name: "Peerless Carpentry Station",
      family: "Carpentry Station",
      tier: 6,
      quantity: 2,
      requirements: [
        { id: "6010001", kind: "items", name: "Peerless Wood Log", quantity: 20, tier: 6 },
        { id: "1204", kind: "cargo", name: "Exquisite Timber", quantity: 1, tier: 5 },
      ],
    }],
  });

  assert.equal(config.targets[0].kind, "building");
  assert.equal(config.targets[0].requirements.length, 2);
  assert.deepEqual(craftPlanCatalogTargets(config).map((row) => [row.kind, row.id, row.quantity]), [
    ["items", "6010001", 40],
    ["cargo", "1204", 2],
  ]);
});

test("workstation progress snapshots existing entities and permanently records exact new builds", () => {
  const target = { id: "6020", kind: "building", name: "Peerless Carpentry Station", quantity: 1, requirements: [] };
  const initial = reconcileCraftPlanBuildingProgress(normalizeCraftPlanConfig({ enabled: true, targets: [target] }), [
    { entityId: "existing", buildingDescriptionId: 6020, buildingName: "Peerless Carpentry Station" },
    { entityId: "wrong-id", buildingDescriptionId: 9999, buildingName: "Peerless Carpentry Station" },
  ]);
  assert.equal(initial.changed, true);
  assert.deepEqual(initial.config.buildingProgress["building:6020"], { baselineEntityIds: ["existing"], completedEntityIds: [] });

  const detected = reconcileCraftPlanBuildingProgress(initial.config, [
    { entityId: "existing", buildingDescriptionId: 6020 },
    { entityId: "new", buildingDescriptionId: 6020 },
  ]);
  assert.deepEqual(detected.config.buildingProgress["building:6020"].completedEntityIds, ["new"]);

  const removed = reconcileCraftPlanBuildingProgress(detected.config, []);
  assert.deepEqual(removed.config.buildingProgress["building:6020"].completedEntityIds, ["new"]);
});

test("workstation completion expands materials only for remaining new stations", () => {
  const target = {
    id: "6020",
    kind: "building",
    name: "Peerless Carpentry Station",
    quantity: 2,
    requirements: [{ id: "6010001", kind: "items", name: "Peerless Wood Log", quantity: 20, tier: 6 }],
  };
  const plan = computeCraftPlan({ config: normalizeCraftPlanConfig({
    enabled: true,
    targets: [target],
    buildingProgress: { "building:6020": { baselineEntityIds: ["old"], completedEntityIds: ["new"] } },
  }) });

  assert.equal(plan.targets[0].available, 1);
  assert.equal(plan.targets[0].missing, 1);
  assert.equal(plan.targets[0].progressInitialized, true);
  assert.equal(plan.materials.find((row) => row.id === "6010001").required, 20);
  assert.deepEqual(craftPlanCatalogTargets(plan.config).map((row) => [row.id, row.quantity]), [["6010001", 20]]);

  const complete = computeCraftPlan({ config: normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ ...target, quantity: 1 }],
    buildingProgress: { "building:6020": { baselineEntityIds: ["old"], completedEntityIds: ["new"] } },
  }) });
  assert.equal(complete.targets[0].missing, 0);
  assert.equal(complete.materials.some((row) => row.id === "6010001"), false);
});

test("computeCraftPlan keeps a workstation goal while calculating its construction materials", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{
        id: "6020",
        kind: "building",
        name: "Peerless Carpentry Station",
        family: "Carpentry Station",
        tier: 6,
        quantity: 1,
        requirements: [{ id: "6010001", kind: "items", name: "Peerless Wood Log", quantity: 20, tier: 6 }],
      }],
    }),
    storageSources: [{ sourceId: "store", label: "Construction", items: [{ id: "6010001", kind: "items", name: "Peerless Wood Log", quantity: 7 }] }],
  });

  assert.equal(plan.targets[0].name, "Peerless Carpentry Station");
  assert.equal(plan.targets[0].missing, 1);
  const material = plan.materials.find((row) => row.id === "6010001");
  assert.equal(material.required, 20);
  assert.equal(material.available, 7);
  assert.equal(material.missing, 13);
});

test("computeCraftPlan exposes ocean and lake personal views from one oil-equivalent deficit", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 100, itemType: 0 }],
      sourceRules: { storageContainerIds: ["store"], craftPlayerIds: ["player"] },
    }),
    detailsByKey: fishingPreferenceDetails(),
    storageSources: [{ sourceId: "store", label: "Fishing", items: [
      { id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10 },
      { id: "1901", kind: "items", name: "Briny Linus", quantity: 10 },
      { id: "1902", kind: "items", name: "Briny Argus", quantity: 10 },
    ] }],
    activeCrafts: [{ id: "craft", playerId: "player", itemId: "1900", kind: "items", name: "Basic Fish Oil", quantity: 5, guaranteedQuantity: 5 }],
  });

  const tier = plan.personalViews.fishing.tiers[0];
  assert.equal(tier.remainingOil, 45);
  assert.equal(tier.routes.ocean.needed, 15);
  assert.equal(tier.routes.lake.needed, 45);
  assert.equal(tier.routes.ocean.usage.output.name, "Basic Fish Oil");
  assert.equal(tier.routes.ocean.usage.output.quantity, 45);
  assert.equal(tier.routes.ocean.usage.requiredQuantity, 15);
  assert.equal(tier.routes.ocean.usage.recipeName, "Press Ocean Fish Oil");
  assert.equal(tier.routes.ocean.sources[0].label, "Fishing");
  assert.equal(tier.routes.ocean.sources[0].quantity, 10);
  assert.equal(tier.routes.ocean.usage.alternatives[0].id, "ocean-fish-oil");
  assert.equal(tier.routes.ocean.usage.alternatives[0].inputs[0].name, "Briny Linus");
  assert.equal(tier.routes.ocean.usage.alternatives[0].buildingName, null);
  assert.equal(tier.routes.lake.usage.requiredQuantity, 45);
});

test("personal fishing view rounds preferred fish upward", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }] }),
    detailsByKey: fishingPreferenceDetails(),
  });

  assert.equal(plan.personalViews.fishing.tiers[0].routes.ocean.needed, 4);
  assert.equal(plan.personalViews.fishing.tiers[0].routes.lake.needed, 10);
});

test("personal fishing view clamps covered demand to zero", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }],
      sourceRules: { storageContainerIds: ["store"] },
    }),
    detailsByKey: fishingPreferenceDetails(),
    storageSources: [{ sourceId: "store", label: "Fishing", items: [{ id: "1900", kind: "items", quantity: 10, name: "Basic Fish Oil" }] }],
  });

  const tier = plan.personalViews.fishing.tiers[0];
  assert.equal(tier.remainingOil, 0);
  assert.equal(tier.routes.ocean.needed, 0);
  assert.equal(tier.routes.lake.needed, 0);
});

test("personal fishing view excludes a route with no positive guaranteed yield", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }] }),
    detailsByKey: fishingPreferenceDetails({ oceanYield: 0 }),
  });

  const tier = plan.personalViews.fishing.tiers[0];
  assert.equal(tier.routes.ocean.available, false);
  assert.equal(tier.routes.ocean.reason, "Verified route unavailable");
  assert.equal(tier.routes.lake.available, true);
});

test("personal fishing view uses a verified expected yield when a route has no guaranteed minimum", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }],
      sourceRules: { storageContainerIds: ["store"] },
    }),
    detailsByKey: probabilisticFishingPreferenceDetails(),
    storageSources: [{ sourceId: "store", label: "Fishing", items: [{ id: "1901", kind: "items", name: "Briny Linus", quantity: 10 }] }],
  });

  const tier = plan.personalViews.fishing.tiers[0];
  assert.equal(tier.routes.ocean.available, true);
  assert.equal(tier.routes.ocean.estimated, true);
  assert.equal(tier.routes.ocean.guaranteedYield, 2);
  assert.equal(tier.routes.ocean.needed, 0);
  assert.equal(tier.remainingOil, 0);
  assert.equal(tier.routes.lake.needed, 0);
  assert.equal(plan.warnings.some((warning) => /Ocean Fish.*no positive guaranteed yield/i.test(warning)), false);
});

test("personal fishing view applies chance buffers to probabilistic fish inputs only", () => {
  const oilKey = recipeKey("items", "1900");
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }],
      multipliers: { [oilKey]: { multiplier: 1.5 } },
    }),
    detailsByKey: probabilisticFishingPreferenceDetails(),
  });

  const tier = plan.personalViews.fishing.tiers[0];
  assert.equal(tier.requiredOil, 10);
  assert.equal(tier.routes.ocean.isProbabilistic, true);
  assert.equal(tier.routes.ocean.unbufferedNeeded, 5);
  assert.equal(tier.routes.ocean.needed, 8);
  assert.equal(tier.routes.ocean.multiplier, 1.5);
  assert.equal(tier.routes.lake.needed, 10);
  assert.equal(tier.routes.lake.multiplier, 1);
});

test("personal fishing view counts estimated output for material planning", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }],
      sourceRules: { craftPlayerIds: ["player"] },
    }),
    detailsByKey: fishingPreferenceDetails(),
    activeCrafts: [{
      id: "craft",
      playerId: "player",
      itemId: "1900",
      kind: "items",
      quantity: 5,
      guaranteedQuantity: 0,
      name: "Basic Fish Oil",
    }],
  });

  const tier = plan.personalViews.fishing.tiers[0];
  assert.equal(plan.materials.find((material) => material.id === "1900")?.inProgress, 5);
  assert.equal(plan.materials.find((material) => material.id === "1900")?.guaranteedInProgress, 0);
  assert.equal(plan.materials.find((material) => material.id === "1900")?.estimatedInProgress, 5);
  assert.equal(tier.trackedOil, 5);
  assert.equal(tier.remainingOil, 5);
  assert.equal(tier.routes.ocean.needed, 2);

  const guaranteedPlan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }],
      sourceRules: { craftPlayerIds: ["player"] },
    }),
    detailsByKey: fishingPreferenceDetails(),
    activeCrafts: [{ id: "craft", playerId: "player", itemId: "1900", kind: "items", quantity: 5, guaranteedQuantity: 2, name: "Basic Fish Oil" }],
  });
  assert.equal(guaranteedPlan.materials.find((material) => material.id === "1900")?.inProgress, 5);
  assert.equal(guaranteedPlan.materials.find((material) => material.id === "1900")?.guaranteedInProgress, 2);
  assert.equal(guaranteedPlan.materials.find((material) => material.id === "1900")?.estimatedInProgress, 3);
  assert.equal(guaranteedPlan.materials.find((material) => material.id === "1900")?.missing, 5);
});

test("estimated active output satisfies material planning and stops prerequisite expansion", () => {
  const plan = computeCraftPlan({
    config: {
      enabled: true,
      targets: [{ id: "1900", kind: "items", quantity: 10 }],
      sourceRules: { craftPlayerIds: ["player"] },
    },
    detailsByKey: fishingPreferenceDetails(),
    activeCrafts: [{ id: "craft", playerId: "player", itemId: "1900", kind: "items", quantity: 10, guaranteedQuantity: 0, name: "Fish Oil" }],
  });
  const oil = plan.materials.find((item) => item.key === "items:1900");
  assert.equal(oil.inProgress, 10);
  assert.equal(oil.guaranteedInProgress, 0);
  assert.equal(oil.estimatedInProgress, 10);
  assert.equal(oil.missing, 0);
  assert.equal(plan.materials.some((item) => item.key === "items:1901"), false);
  const confirmedOil = plan.confirmedEffortPlan.materials.find((item) => item.key === "items:1900");
  assert.equal(confirmedOil.missing, 10);
  assert.equal(plan.confirmedEffortPlan.materials.some((item) => item.key === "items:1901"), true);
});

test("guaranteed active output satisfies requirements", () => {
  const plan = computeCraftPlan({
    config: {
      enabled: true,
      targets: [{ id: "1900", kind: "items", quantity: 10 }],
      sourceRules: { craftPlayerIds: ["player"] },
    },
    detailsByKey: fishingPreferenceDetails(),
    activeCrafts: [{ id: "craft", playerId: "player", itemId: "1900", kind: "items", quantity: 5, guaranteedQuantity: 5, name: "Fish Oil" }],
  });
  assert.equal(plan.materials.find((item) => item.key === "items:1900").missing, 5);
});

test("active crafts without guaranteed quantity display rounded expected output and satisfy planning demand", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }],
      sourceRules: { craftPlayerIds: ["player"] },
    }),
    detailsByKey: fishingPreferenceDetails(),
    activeCrafts: [{ id: "craft", playerId: "player", itemId: "1900", kind: "items", quantity: 5, name: "Basic Fish Oil" }],
  });

  const oil = plan.materials.find((material) => material.id === "1900");
  assert.equal(oil?.inProgress, 5);
  assert.equal(oil?.guaranteedInProgress, 0);
  assert.equal(oil?.estimatedInProgress, 5);
  assert.equal(oil?.missing, 5);
});

test("computeCraftPlan combines expected active-craft output before rounding down", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "9100", kind: "items", name: "Rough Straw", quantity: 10, itemType: 0 }],
      sourceRules: { craftPlayerIds: ["farmer"] },
    }),
    detailsByKey: new Map([[recipeKey("items", "9100"), {
      item: { id: "9100", name: "Rough Straw", itemType: 0, tag: "Straw", tier: 1 },
    }]]),
    activeCrafts: [
      { id: "craft-a", playerId: "farmer", itemId: "9100", kind: "items", quantity: 0.6, guaranteedQuantity: 0, name: "Rough Straw" },
      { id: "craft-b", playerId: "farmer", itemId: "9100", kind: "items", quantity: 0.6, guaranteedQuantity: 0, name: "Rough Straw" },
    ],
  });

  const straw = plan.materials.find((material) => material.id === "9100");
  assert.equal(straw?.inProgress, 1);
  assert.equal(straw?.guaranteedInProgress, 0);
  assert.equal(straw?.estimatedInProgress, 1);
  assert.equal(straw?.missing, 9);
});

test("computeCraftPlan never counts less than guaranteed active output", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "9200", kind: "items", name: "Basic Embergrain", quantity: 50, itemType: 0 }],
      sourceRules: { craftPlayerIds: ["farmer"] },
    }),
    detailsByKey: new Map([[recipeKey("items", "9200"), {
      item: { id: "9200", name: "Basic Embergrain", itemType: 0, tag: "Grain Plant", tier: 1 },
    }]]),
    activeCrafts: [{ id: "craft", playerId: "farmer", itemId: "9200", kind: "items", quantity: 29.8, guaranteedQuantity: 30, name: "Basic Embergrain" }],
  });

  const grain = plan.materials.find((material) => material.id === "9200");
  assert.equal(grain?.inProgress, 30);
  assert.equal(grain?.guaranteedInProgress, 30);
  assert.equal(grain?.estimatedInProgress, 0);
});

test("normalized local fishing distributions retain guaranteed route yields end to end", (t) => {
  const { repository } = createCatalogFixture(t);
  const oil = { id: "1900", itemType: 0, name: "Basic Fish Oil", tag: "Fish Oil", tier: 1 };
  const oceanFish = { id: "1901", itemType: 0, name: "Briny Linus", tag: "Ocean Fish", tier: 1 };
  const lakeFish = { id: "1902", itemType: 0, name: "Briny Argus", tag: "Lake Fish", tier: 1 };
  upsertCatalogDetails(repository, [
    { item: oil },
    {
      item: { id: "1903", itemType: 0, name: "Briny Linus Products", tag: "Oceanfish Products", tier: 1 },
      craftingRecipes: [{
        id: "process-ocean-fish",
        name: "Process Ocean Fish",
        craftedItemStacks: [{ item_id: "1903", item_type: "item", quantity: 1 }],
        consumedItemStacks: [{ item_id: oceanFish.id, item_type: "item", quantity: 1 }],
        consumedItems: [oceanFish],
      }],
      itemListPossibilities: [
        { targetId: oil.id, targetItem: oil, quantity: 3, chance: 0.5 },
        { targetId: oil.id, targetItem: oil, quantity: 3, chance: 0.45 },
        { targetId: oil.id, targetItem: oil, quantity: 4, chance: 0.05 },
      ],
    },
    {
      item: { id: "1904", itemType: 0, name: "Briny Argus Products", tag: "Lake Fish Products", tier: 1 },
      craftingRecipes: [{
        id: "process-lake-fish",
        name: "Process Lake Fish",
        craftedItemStacks: [{ item_id: "1904", item_type: "item", quantity: 1 }],
        consumedItemStacks: [{ item_id: lakeFish.id, item_type: "item", quantity: 1 }],
        consumedItems: [lakeFish],
      }],
      itemListPossibilities: [
        { targetId: oil.id, targetItem: oil, quantity: 1, chance: 0.5 },
        { targetId: oil.id, targetItem: oil, quantity: 1, chance: 0.5 },
      ],
    },
    { item: oceanFish },
    { item: lakeFish },
  ]);
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ ...oil, kind: "items", quantity: 10 }],
  });
  const { detailsByKey, warnings } = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);

  const plan = computeCraftPlan({ config, detailsByKey, catalogWarnings: warnings });

  const tier = plan.personalViews.fishing.tiers[0];
  assert.equal(tier.routes.ocean.available, true);
  assert.equal(tier.routes.ocean.guaranteedYield, 3);
  assert.equal(tier.routes.ocean.needed, 4);
  assert.equal(tier.routes.lake.available, true);
  assert.equal(tier.routes.lake.guaranteedYield, 1);
  assert.equal(tier.routes.lake.needed, 10);
  assert.equal(plan.warnings.some((warning) => /no positive guaranteed yield/i.test(warning)), false);
});

test("personal fishing view uses completed uncollected fish-oil crafts", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }],
      sourceRules: { craftPlayerIds: ["player"] },
    }),
    detailsByKey: fishingPreferenceDetails(),
    activeCrafts: [{ id: "craft", playerId: "player", itemId: "1900", kind: "items", quantity: 4, guaranteedQuantity: 4, name: "Basic Fish Oil", completed: true }],
  });

  const tier = plan.personalViews.fishing.tiers[0];
  assert.equal(tier.trackedOil, 4);
  assert.equal(tier.remainingOil, 6);
  assert.equal(tier.routes.ocean.needed, 2);
});

test("personal fishing view does not change saved route overrides", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "1900", kind: "items", name: "Basic Fish Oil", quantity: 10, itemType: 0 }],
    routeOverrides: { [recipeKey("items", "1900")]: "lake-fish-oil" },
  });
  const plan = computeCraftPlan({ config, detailsByKey: fishingPreferenceDetails() });

  assert.deepEqual(plan.config.routeOverrides, { [recipeKey("items", "1900")]: "lake-fish-oil" });
  assert.equal(plan.steps.find((step) => step.output.id === "1900")?.selectedRecipeId, "lake-fish-oil");
  assert.equal(plan.personalViews.fishing.tiers[0].routes.ocean.available, true);
  assert.equal(plan.personalViews.fishing.tiers[0].routes.lake.available, true);
});

test("computeCraftPlan applies recipe route overrides and offsets storage, players, deployables, and active crafts", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "900", kind: "items", name: "Fish Oil", quantity: 10, itemType: 0 }],
    sourceRules: {
      storageContainerIds: ["store-1"],
      playerIds: ["player-1"],
      deployableContainerIds: ["player-1:cart-1"],
    },
    routeOverrides: { [recipeKey("items", "900")]: "lake-route" },
  });

  const plan = computeCraftPlan({
    config,
    detailsByKey: new Map([[recipeKey("items", "900"), fishOilDetail]]),
    storageSources: [{ sourceId: "store-1", label: "Pantry", items: [{ id: "101", kind: "items", quantity: 4, name: "Lake Fish" }] }],
    playerSources: [{ sourceId: "player-1", label: "Modular inventory", items: [{ id: "101", kind: "items", quantity: 6, name: "Lake Fish" }] }],
    deployableSources: [{ sourceId: "player-1:cart-1", label: "Modular cart", items: [{ id: "101", kind: "items", quantity: 5, name: "Lake Fish" }] }],
    activeCrafts: [{ id: "craft-1", playerId: "player-1", playerName: "Modular", buildingName: "Fishing Station", itemId: "101", kind: "items", quantity: 3, guaranteedQuantity: 3, name: "Lake Fish" }],
  });

  const lakeFish = plan.materials.find((material) => material.name === "Lake Fish");
  const oceanFish = plan.materials.find((material) => material.name === "Ocean Fish");

  assert.equal(oceanFish, undefined);
  assert.equal(lakeFish.required, 30);
  assert.equal(lakeFish.available, 15);
  assert.equal(lakeFish.inProgress, 3);
  assert.equal(lakeFish.missing, 12);
  assert.equal(plan.gatherNext[0].section, "Fishing");
  assert.equal(plan.gatherNext[0].items[0].name, "Lake Fish");
  const fishOil = plan.materials.find((material) => material.name === "Fish Oil");
  assert.equal(fishOil.sourceRoutes.length, 1);
  assert.equal(fishOil.sourceRoutes[0].selectedRecipeId, "lake-route");
  assert.deepEqual(fishOil.sourceRoutes[0].alternatives.map((route) => route.id), ["ocean-route", "lake-route"]);
});

test("computeCraftPlan route overrides select either lake or ocean fish but never both", () => {
  for (const [selectedRecipeId, expectedFish, excludedFish] of [
    ["lake-route", "Lake Fish", "Ocean Fish"],
    ["ocean-route", "Ocean Fish", "Lake Fish"],
  ]) {
    const plan = computeCraftPlan({
      config: normalizeCraftPlanConfig({
        enabled: true,
        targets: [{ id: "900", kind: "items", name: "Fish Oil", quantity: 10, itemType: 0 }],
        routeOverrides: { [recipeKey("items", "900")]: selectedRecipeId },
      }),
      detailsByKey: new Map([[recipeKey("items", "900"), fishOilDetail]]),
    });

    assert.equal(plan.materials.find((material) => material.name === expectedFish)?.required, 30);
    assert.equal(plan.materials.some((material) => material.name === excludedFish), false);
    const fishOil = plan.materials.find((material) => material.name === "Fish Oil");
    assert.equal(fishOil.sourceRoutes.length, 1);
    assert.equal(fishOil.sourceRoutes[0].selectedRecipeId, selectedRecipeId);
  }
});

test("computeCraftPlan prefers the highest-yield probabilistic producer route", () => {
  const oil = { item: { id: "9000", name: "Simple Fish Oil", itemType: 0, tag: "Fish Oil", tier: 2 } };
  const poorFish = {
    item: { id: "9001", name: "Muddy Auratus Products", itemType: 0, tag: "Lake Fish Products", tier: 2 },
    craftingRecipes: [{ id: "poor-products", name: "Process Muddy Auratus", craftedItemStacks: [{ item_id: "9001", item_type: "item", quantity: 1 }], consumedItemStacks: [{ item_id: "9002", item_type: "item", quantity: 1 }], consumedItems: [{ id: "9002", name: "Muddy Auratus", itemType: 0, tier: 2 }] }],
    itemListPossibilities: [{ targetId: "9000", targetItem: oil.item, quantity: 1, chance: 0.005 }],
  };
  const goodFish = {
    item: { id: "9003", name: "Briny Argus Products", itemType: 0, tag: "Lake Fish Products", tier: 2 },
    craftingRecipes: [{ id: "good-products", name: "Process Briny Argus", craftedItemStacks: [{ item_id: "9003", item_type: "item", quantity: 1 }], consumedItemStacks: [{ item_id: "9004", item_type: "item", quantity: 1 }], consumedItems: [{ id: "9004", name: "Briny Argus", itemType: 0, tier: 2 }] }],
    itemListPossibilities: [{ targetId: "9000", targetItem: oil.item, quantity: 1, chance: 0.5 }],
  };
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "9000", kind: "items", name: "Simple Fish Oil", quantity: 10, itemType: 0 }] }),
    detailsByKey: new Map([[recipeKey("items", "9000"), oil], [recipeKey("items", "9001"), poorFish], [recipeKey("items", "9003"), goodFish]]),
  });

  assert.equal(plan.steps.find((step) => step.output.id === "9000")?.selectedRecipeId, "possibility:good-products:items:9000");
  assert.equal(plan.materials.find((material) => material.name === "Briny Argus")?.required, 20);
  assert.equal(plan.materials.some((material) => material.name === "Muddy Auratus"), false);
});

test("recipesForTarget exposes normalized item-list producer routes for calculator detail responses", () => {
  const target = { id: "9000", kind: "items", itemType: 0, name: "Rough Resin" };
  const targetDetail = { item: { ...target, itemType: 0 }, craftingRecipes: [] };
  const producerDetail = {
    item: { id: "9100", name: "Rough Forestry Products", itemType: 0 },
    craftingRecipes: [{
      id: "forestry-products",
      name: "Process Rough Logs",
      consumedItemStacks: [{ item_id: "9200", item_type: "item", quantity: 2 }],
      consumedItems: [{ id: "9200", name: "Rough Log", itemType: 0 }],
      craftedItemStacks: [{ item_id: "9100", item_type: "item", quantity: 1 }],
    }],
    itemListPossibilities: [{
      targetId: "9000",
      targetItem: { ...target, itemType: 0 },
      quantity: 0.25,
      quantityIsExpected: true,
      chance: 0.25,
      guaranteedQuantity: 0,
    }],
  };
  const details = new Map([
    [recipeKey("items", "9000"), targetDetail],
    [recipeKey("items", "9100"), producerDetail],
  ]);

  const recipes = craftPlanning.recipesForTarget(targetDetail, target, details);
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].id, "possibility:forestry-products:items:9000");
  assert.equal(recipes[0].craftedItemStacks[0].quantity, 0.25);
  assert.equal(recipes[0].consumedItemStacks[0].item_id, "9200");
});

test("computeCraftPlan keeps tracked craft status and ready-to-collect outputs", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "900", kind: "items", name: "Fish Oil", quantity: 10, itemType: 0 }],
      sourceRules: { craftPlayerIds: ["player-1"] },
    }),
    detailsByKey: new Map([[recipeKey("items", "900"), fishOilDetail]]),
    activeCrafts: [
      { id: "craft-1", playerId: "player-1", playerName: "Modular", buildingName: "Fishing Station", itemId: "900", kind: "items", name: "Fish Oil", quantity: 4, guaranteedQuantity: 4, status: "In progress", completed: false },
      { id: "craft-2", playerId: "player-1", playerName: "Modular", buildingName: "Fishing Station", itemId: "900", kind: "items", name: "Fish Oil", quantity: 3, guaranteedQuantity: 3, status: "Ready to collect", completed: true },
      { id: "craft-3", playerId: "player-2", playerName: "Other", buildingName: "Fishing Station", itemId: "900", kind: "items", name: "Fish Oil", quantity: 50, guaranteedQuantity: 50, status: "In progress", completed: false },
    ],
  });

  const fishOil = plan.materials.find((material) => material.name === "Fish Oil");
  assert.equal(fishOil.inProgress, 7);
  assert.deepEqual(fishOil.activeCraftSources.map((source) => [source.craftId, source.status, source.completed]), [
    ["craft-1", "In progress", false],
    ["craft-2", "Ready to collect", true],
  ]);
});

test("computeCraftPlan counts completed uncollected Rough Plank and transitions it into inventory", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "1020003", kind: "items", name: "Rough Plank", quantity: 1880, itemType: 0 }],
    sourceRules: { storageContainerIds: ["woodworking"], craftPlayerIds: ["player-1"] },
  });
  const detailsByKey = new Map([[recipeKey("items", "1020003"), {
    item: { id: "1020003", name: "Rough Plank", itemType: 0, tag: "Plank", tier: 1 },
  }]]);

  const waitingCollection = computeCraftPlan({
    config,
    detailsByKey,
    storageSources: [{ sourceId: "woodworking", label: "Woodworking", items: [{ id: "1020003", kind: "items", quantity: 1296, name: "Rough Plank" }] }],
    activeCrafts: [{ id: "craft-rough-plank", playerId: "player-1", playerName: "Modular", buildingName: "Exquisite Carpentry Station", itemId: "1020003", kind: "items", quantity: 612, guaranteedQuantity: 612, name: "Rough Plank", status: "Ready to collect", completed: true }],
  });
  const waitingPlank = waitingCollection.materials.find((material) => material.name === "Rough Plank");
  assert.equal(waitingPlank.available, 1296);
  assert.equal(waitingPlank.inProgress, 612);
  assert.equal(waitingPlank.missing, 0);
  assert.equal(waitingPlank.available + waitingPlank.inProgress - waitingPlank.bufferedRequired, 28);
  assert.deepEqual(waitingPlank.activeCraftSources.map((source) => [source.playerName, source.status, source.quantity]), [["Modular", "Ready to collect", 612]]);

  const collected = computeCraftPlan({
    config,
    detailsByKey,
    storageSources: [{ sourceId: "woodworking", label: "Woodworking", items: [{ id: "1020003", kind: "items", quantity: 1908, name: "Rough Plank" }] }],
    activeCrafts: [],
  });
  const collectedPlank = collected.materials.find((material) => material.name === "Rough Plank");
  assert.equal(collectedPlank.available, 1908);
  assert.equal(collectedPlank.inProgress, 0);
  assert.equal(collectedPlank.missing, 0);
});

test("computeCraftPlan normalizes collected animal carcasses without merging distinct animals", () => {
  const cases = [
    { variantId: "3", variantName: "Female Cervus", stockId: "4", expectedId: "4", expectedName: "Cervus", tier: 3, expectedAvailable: 6 },
    { variantId: "5", variantName: "Female Scrofa", stockId: "6", expectedId: "6", expectedName: "Scrofa", tier: 4, expectedAvailable: 6 },
    { variantId: "7", variantName: "Elder Scrofa", stockId: "6", expectedId: "7", expectedName: "Elder Scrofa", tier: 8, expectedAvailable: 0 },
  ];

  for (const [index, animal] of cases.entries()) {
    const targetId = `99000${index}`;
    const plan = computeCraftPlan({
      config: normalizeCraftPlanConfig({
        enabled: true,
        targets: [{ id: targetId, kind: "items", name: `Animal output ${index}`, quantity: 10, itemType: 0 }],
        sourceRules: { storageContainerIds: ["hunting-storage"] },
      }),
      detailsByKey: new Map([[recipeKey("items", targetId), {
        item: { id: targetId, name: `Animal output ${index}`, itemType: 0, tag: "Test output", tier: 1 },
        craftingRecipes: [{
          id: `process-animal-${index}`,
          name: `Process ${animal.variantName}`,
          craftedItemStacks: [{ item_id: targetId, item_type: "item", quantity: 1 }],
          craftedItems: [{ id: targetId, name: `Animal output ${index}`, itemType: 0, tier: 1 }],
          consumedItemStacks: [{ item_id: animal.variantId, item_type: "cargo", quantity: 1 }],
          consumedItems: [{ id: animal.variantId, name: animal.variantName, itemType: 1, tag: "Animal", tier: animal.tier }],
        }],
      }]]),
      storageSources: [{
        sourceId: "hunting-storage",
        label: "Hunting storage",
        items: [{ id: animal.stockId, kind: "cargo", quantity: 6, name: animal.expectedName }],
      }],
    });

    const material = plan.materials.find((entry) => entry.name === animal.expectedName);
    assert.ok(material, `${animal.expectedName} should appear in the plan`);
    assert.equal(material.id, animal.expectedId);
    assert.equal(material.available, animal.expectedAvailable);
    assert.equal(material.missing, 10 - animal.expectedAvailable);
  }
});

test("computeCraftPlan does not credit unstarted farming co-products", () => {
  const filamentDetail = { item: { id: "1100017", name: "Rough Wispweave Filament", itemType: 0, tag: "Filament", tier: 1 } };
  const productsDetail = {
    item: { id: "1220023", name: "Basic Wispweave Products", itemType: 0, tag: "Wispweave Products", tier: 1 },
    craftingRecipes: [{
      id: "harvest-wispweave",
      name: "Harvest Basic Wispweave Plant",
      craftedItemStacks: [{ item_id: "1220023", item_type: "item", quantity: 1 }],
      craftedItems: [{ id: "1220023", name: "Basic Wispweave Products", itemType: 0, tier: 1 }],
      consumedItemStacks: [{ item_id: "1100016", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "1100016", name: "Basic Wispweave Plant", itemType: 0, tag: "Filament Plant", tier: 1 }],
      levelRequirements: [{ skill: { name: "Farming" }, level: 1 }],
    }],
    itemListPossibilities: [
      { targetId: "1100015", targetItem: { id: "1100015", name: "Basic Wispweave Seeds", itemType: 0, tag: "Filament Seeds", tier: 1 }, quantity: 1.8, chance: 1 },
      { targetId: "1100017", targetItem: { id: "1100017", name: "Rough Wispweave Filament", itemType: 0, tag: "Filament", tier: 1 }, quantity: 5, chance: 1 },
    ],
  };
  const plantDetail = {
    item: { id: "1100016", name: "Basic Wispweave Plant", itemType: 0, tag: "Filament Plant", tier: 1 },
    craftingRecipes: [{
      id: "grow-wispweave",
      name: "Grow Basic Wispweave Plant",
      craftedItemStacks: [{ item_id: "1100016", item_type: "item", quantity: 1 }],
      consumedItemStacks: [
        { item_id: "1100015", item_type: "item", quantity: 1 },
        { item_id: "1100001", item_type: "item", quantity: 1 },
      ],
      consumedItems: [
        { id: "1100015", name: "Basic Wispweave Seeds", itemType: 0, tag: "Filament Seeds", tier: 1 },
        { id: "1100001", name: "Basic Fertilizer", itemType: 0, tag: "Fertilizer", tier: 1 },
      ],
      levelRequirements: [{ skill: { name: "Farming" }, level: 1 }],
    }],
  };
  const seedDetail = { item: { id: "1100015", name: "Basic Wispweave Seeds", itemType: 0, tag: "Filament Seeds", tier: 1 } };
  const fertilizerDetail = { item: { id: "1100001", name: "Basic Fertilizer", itemType: 0, tag: "Fertilizer", tier: 1 } };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "1100017", kind: "items", name: "Rough Wispweave Filament", quantity: 715, itemType: 0 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "1100017"), filamentDetail],
      [recipeKey("items", "1220023"), productsDetail],
      [recipeKey("items", "1100016"), plantDetail],
      [recipeKey("items", "1100015"), seedDetail],
      [recipeKey("items", "1100001"), fertilizerDetail],
    ]),
  });

  assert.equal(plan.materials.find((material) => material.name === "Basic Wispweave Plant")?.required, 143);
  assert.equal(plan.materials.find((material) => material.name === "Basic Fertilizer")?.required, 143);
  assert.equal(plan.materials.find((material) => material.name === "Basic Wispweave Seeds")?.missing, 143);
  assert.equal(plan.totals.missingQuantity, 1_144);
});

test("computeCraftPlan prefers same-tier seeds over plant tier-up recipes", () => {
  const simplePlantDetail = {
    item: { id: "2100016", name: "Simple Wispweave Plant", itemType: 0, tag: "Filament Plant", tier: 2 },
    craftingRecipes: [{
      id: "210016",
      name: "Grow Simple Wispweave Plant",
      craftedItemStacks: [{ item_id: "2100016", item_type: "item", quantity: 1 }],
      consumedItemStacks: [
        { item_id: "1100016", item_type: "item", quantity: 5 },
        { item_id: "2100001", item_type: "item", quantity: 1 },
      ],
      consumedItems: [
        { id: "1100016", name: "Basic Wispweave Plant", itemType: 0, tag: "Filament Plant", tier: 1 },
        { id: "2100001", name: "Simple Fertilizer", itemType: 0, tag: "Fertilizer", tier: 2 },
      ],
      levelRequirements: [{ skill: { name: "Farming" }, level: 20 }],
    }, {
      id: "210017",
      name: "Grow Simple Wispweave Plant",
      craftedItemStacks: [{ item_id: "2100016", item_type: "item", quantity: 1 }],
      consumedItemStacks: [
        { item_id: "2100015", item_type: "item", quantity: 1 },
        { item_id: "2100001", item_type: "item", quantity: 1 },
        { item_id: "104000", item_type: "item", quantity: 1 },
      ],
      consumedItems: [
        { id: "2100015", name: "Simple Wispweave Seeds", itemType: 0, tag: "Filament Seeds", tier: 2 },
        { id: "2100001", name: "Simple Fertilizer", itemType: 0, tag: "Fertilizer", tier: 2 },
        { id: "104000", name: "Water Bucket", itemType: 0, tag: "Water", tier: 1 },
      ],
      levelRequirements: [{ skill: { name: "Farming" }, level: 20 }],
    }],
  };
  const detailsByKey = new Map([
    [recipeKey("items", "2100016"), simplePlantDetail],
    [recipeKey("items", "1100016"), { item: { id: "1100016", name: "Basic Wispweave Plant", itemType: 0, tag: "Filament Plant", tier: 1 } }],
    [recipeKey("items", "2100015"), { item: { id: "2100015", name: "Simple Wispweave Seeds", itemType: 0, tag: "Filament Seeds", tier: 2 } }],
    [recipeKey("items", "2100001"), { item: { id: "2100001", name: "Simple Fertilizer", itemType: 0, tag: "Fertilizer", tier: 2 } }],
    [recipeKey("items", "104000"), { item: { id: "104000", name: "Water Bucket", itemType: 0, tag: "Water", tier: 1 } }],
  ]);

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "2100016", kind: "items", name: "Simple Wispweave Plant", quantity: 10, itemType: 0 }] }),
    detailsByKey,
  });

  assert.equal(plan.steps.find((step) => step.output.id === "2100016")?.selectedRecipeId, "210017");
  assert.equal(plan.materials.find((material) => material.name === "Simple Wispweave Seeds")?.required, 10);
  assert.equal(plan.materials.some((material) => material.name === "Basic Wispweave Plant"), false);
});


test("computeCraftPlan counts active crafts only for craft-tracked players", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "900", kind: "items", name: "Fish Oil", quantity: 10, itemType: 0 }],
    sourceRules: {
      playerIds: ["player-1", "player-2"],
      craftPlayerIds: ["player-1"],
    },
    routeOverrides: { [recipeKey("items", "900")]: "lake-route" },
  });

  const plan = computeCraftPlan({
    config,
    detailsByKey: new Map([[recipeKey("items", "900"), fishOilDetail]]),
    activeCrafts: [
      { id: "craft-1", playerId: "player-1", playerName: "Modular", buildingName: "Fishing Station", itemId: "101", kind: "items", quantity: 3, guaranteedQuantity: 3, name: "Lake Fish" },
      { id: "craft-2", playerId: "player-2", playerName: "Mosswick", buildingName: "Fishing Station", itemId: "101", kind: "items", quantity: 8, guaranteedQuantity: 8, name: "Lake Fish" },
    ],
  });

  const lakeFish = plan.materials.find((material) => material.name === "Lake Fish");

  assert.equal(lakeFish.inProgress, 3);
  assert.equal(lakeFish.missing, 27);
  assert.deepEqual(lakeFish.activeCraftSources.map((source) => [source.label, source.playerName, source.quantity]), [["Fishing Station", "Modular", 3]]);
});

test("computeCraftPlan preserves passive craft source metadata for item details", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "900", kind: "items", name: "Fish Oil", quantity: 10, itemType: 0 }],
    sourceRules: { craftPlayerIds: ["farmer-1"] },
    routeOverrides: { [recipeKey("items", "900")]: "lake-route" },
  });
  const plan = computeCraftPlan({
    config,
    detailsByKey: new Map([[recipeKey("items", "900"), fishOilDetail]]),
    activeCrafts: [{
      id: "passive:farmer-1:lake-fish",
      playerId: "farmer-1",
      playerName: "Farmer",
      buildingName: "Fishing Pond",
      itemId: "101",
      kind: "items",
      quantity: 3,
      guaranteedQuantity: 3,
      name: "Lake Fish",
      passive: true,
      sourceType: "Passive craft",
      locationUnknown: true,
      status: "Passive craft in progress",
    }],
  });

  const source = plan.materials.find((material) => material.name === "Lake Fish")?.activeCraftSources[0];
  assert.equal(source?.passive, true);
  assert.equal(source?.sourceType, "Passive craft");
  assert.equal(source?.locationUnknown, true);
  assert.equal(source?.status, "Passive craft in progress");
});

test("computeCraftPlan only expands the missing quantity of stocked intermediate crafts", () => {
  const plankDetail = {
    item: { id: "300", name: "Simple Plank", itemType: 0, tag: "Plank", tier: 2 },
    craftingRecipes: [{
      id: "plank-route",
      name: "Simple Plank",
      craftedItemStacks: [{ item_id: "300", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "301", item_type: "item", quantity: 2 }],
      consumedItems: [{ id: "301", name: "Simple Wood Log", itemType: 0, tag: "Wood Log", tier: 2 }],
      levelRequirements: [{ skill: { name: "Carpentry" }, level: 20 }],
    }],
  };
  const logDetail = { item: { id: "301", name: "Simple Wood Log", itemType: 0, tag: "Wood Log", tier: 2 }, craftingRecipes: [] };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "300", kind: "items", name: "Simple Plank", quantity: 10, itemType: 0 }], sourceRules: { playerIds: ["player-1"] } }),
    detailsByKey: new Map([
      [recipeKey("items", "300"), plankDetail],
      [recipeKey("items", "301"), logDetail],
    ]),
    storageSources: [{ sourceId: "store-1", label: "Carpentry chest", items: [{ id: "300", kind: "items", quantity: 6, name: "Simple Plank" }] }],
    activeCrafts: [{ id: "craft-1", playerId: "player-1", playerName: "Modular", buildingName: "Carpentry Station", itemId: "300", kind: "items", quantity: 1, guaranteedQuantity: 1, name: "Simple Plank" }],
  });

  const plank = plan.materials.find((material) => material.name === "Simple Plank");
  const logs = plan.materials.find((material) => material.name === "Simple Wood Log");

  assert.equal(plank.required, 10);
  assert.equal(plank.available, 6);
  assert.equal(plank.inProgress, 1);
  assert.equal(plank.missing, 3);
  assert.equal(logs.required, 6);
});

test("computeCraftPlan prefers crafting recipes over unpacking packed transport items", () => {
  const ropeDetail = {
    item: { id: "400", name: "Fine Rope", itemType: 0, tag: "Rope", tier: 4 },
    craftingRecipes: [
      {
        id: "packed-route",
        name: "Open Packed Fine Rope",
        craftedItemStacks: [{ item_id: "400", item_type: "item", quantity: 10 }],
        consumedItemStacks: [{ item_id: "401", item_type: "item", quantity: 1 }],
        consumedItems: [{ id: "401", name: "Packed Fine Rope", itemType: 0, tag: "Rope", tier: 4 }],
      },
      {
        id: "craft-route",
        name: "Craft Fine Rope",
        craftedItemStacks: [{ item_id: "400", item_type: "item", quantity: 1 }],
        consumedItemStacks: [
          { item_id: "402", item_type: "item", quantity: 2 },
          { item_id: "403", item_type: "item", quantity: 1 },
        ],
        consumedItems: [
          { id: "402", name: "Fine Fiber", itemType: 0, tag: "Plant Fiber", tier: 4 },
          { id: "403", name: "Fine Resin", itemType: 0, tag: "Resin", tier: 4 },
        ],
      },
    ],
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "400", kind: "items", name: "Fine Rope", quantity: 10, itemType: 0 }] }),
    detailsByKey: new Map([[recipeKey("items", "400"), ropeDetail]]),
  });

  assert.equal(plan.steps[0].selectedRecipeId, "craft-route");
  assert.equal(plan.materials.some((material) => material.name === "Packed Fine Rope"), false);
  assert.equal(plan.materials.find((material) => material.name === "Fine Fiber")?.required, 20);
  assert.deepEqual(plan.steps[0].alternatives.map((recipe) => recipe.id), ["craft-route", "packed-route"]);
});

test("computeCraftPlan does not automatically use an unpack route when it is the only catalog option", () => {
  const berryDetail = {
    item: { id: "100", name: "Basic Berry", itemType: 0, tag: "Berry", tier: 1 },
    craftingRecipes: [{
      id: "unpack-berry",
      name: "Unpack Basic Berry Package",
      isTransportRoute: true,
      craftedItemStacks: [{ item_id: "100", item_type: "item", quantity: 500 }],
      consumedItemStacks: [{ item_id: "200", item_type: "cargo", quantity: 1 }],
      consumedItems: [{ id: "200", name: "Basic Berry Package", itemType: 1, tag: "Package", tier: 1 }],
    }],
  };
  const packageDetail = {
    cargo: { id: "200", name: "Basic Berry Package", itemType: 1, tag: "Package", tier: 1 },
    craftingRecipes: [{
      id: "pack-berry",
      name: "Package Basic Berry",
      isTransportRoute: true,
      craftedItemStacks: [{ item_id: "200", item_type: "cargo", quantity: 1 }],
      consumedItemStacks: [{ item_id: "100", item_type: "item", quantity: 500 }],
      consumedItems: [{ id: "100", name: "Basic Berry", itemType: 0, tag: "Berry", tier: 1 }],
    }],
  };

  const detailsByKey = new Map([
    [recipeKey("items", "100"), berryDetail],
    [recipeKey("cargo", "200"), packageDetail],
  ]);
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "100", kind: "items", name: "Basic Berry", quantity: 500, itemType: 0 }] }),
    detailsByKey,
  });

  assert.equal(plan.steps.length, 0);
  assert.deepEqual(plan.materials.find((row) => row.id === "100")?.sourceRoutes, []);
  assert.equal(plan.materials.some((row) => row.id === "200"), false);
  assert.match(plan.warnings.join("\n"), /only transport routes.*items:100/i);

  const overridePlan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "100", kind: "items", name: "Basic Berry", quantity: 500, itemType: 0 }],
      routeOverrides: { [recipeKey("items", "100")]: "unpack-berry" },
    }),
    detailsByKey,
  });
  assert.equal(overridePlan.steps[0]?.selectedRecipeId, "unpack-berry");
});

test("computeCraftPlan follows selected producer routes despite legacy gathered keys", () => {
  const plannedPack = { id: "500", kind: "cargo", itemType: 1, name: "Scholar Supply Pack", quantity: 1 };
  const carvings = { id: "600", kind: "items", itemType: 0, name: "Rough Stone Carvings", tier: 1 };
  const misleadingPack = { id: "601", kind: "cargo", itemType: 1, name: "Stone Carvings Package", tier: 1 };
  const detailsByKey = new Map([
    [recipeKey("cargo", "500"), {
      cargo: plannedPack,
      craftingRecipes: [{
        id: "craft-scholar-pack",
        name: "Craft Scholar Supply Pack",
        craftedItemStacks: [{ item_id: "500", item_type: "cargo", quantity: 1 }],
        consumedItemStacks: [{ item_id: "600", item_type: "item", quantity: 5 }],
        consumedItems: [carvings],
        levelRequirements: [{ skill: { name: "Scholar" }, level: 1 }],
      }],
    }],
    [recipeKey("items", "600"), {
      item: carvings,
      craftingRecipes: [{
        id: "unpack-carvings",
        name: "Unpack Stone Carvings Package",
        isTransportRoute: true,
        craftedItemStacks: [{ item_id: "600", item_type: "item", quantity: 5 }],
        consumedItemStacks: [{ item_id: "601", item_type: "cargo", quantity: 1 }],
        consumedItems: [misleadingPack],
      }],
    }],
    [recipeKey("cargo", "601"), { cargo: misleadingPack, craftingRecipes: [] }],
  ]);
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [plannedPack],
    gatheredItemKeys: [recipeKey("items", "600")],
    routeOverrides: { [recipeKey("items", "600")]: "unpack-carvings" },
    multipliers: { [recipeKey("items", "600")]: { multiplier: 1.5, note: "retained" } },
  });

  const plan = computeCraftPlan({
    config,
    detailsByKey,
    storageSources: [{ sourceId: "store-1", label: "Scholar chest", items: [{ ...carvings, quantity: 2 }] }],
  });
  const carvingMaterial = plan.materials.find((item) => item.key === recipeKey("items", "600"));

  assert.deepEqual(plan.steps.map((step) => step.selectedRecipeId), ["unpack-carvings", "craft-scholar-pack"]);
  assert.equal(carvingMaterial.required, 5);
  assert.equal(carvingMaterial.available, 2);
  assert.equal(carvingMaterial.missing, 3);
  assert.equal(carvingMaterial.isGatheredOverride, false);
  assert.equal(carvingMaterial.sourceRoutes[0].selectedRecipeId, "unpack-carvings");
  assert.equal(carvingMaterial.recipeUsages[0].output.name, "Scholar Supply Pack");
  assert.equal(plan.materials.some((item) => item.key === recipeKey("cargo", "601")), true);
  assert.equal(plan.config.routeOverrides[recipeKey("items", "600")], "unpack-carvings");
  assert.equal(plan.config.multipliers[recipeKey("items", "600")].multiplier, 1.5);
});

test("computeCraftPlan retains independently targeted packages when an input is gathered", () => {
  const carvingsKey = recipeKey("items", "600");
  const packageKey = recipeKey("cargo", "601");
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [
        { id: "600", kind: "items", itemType: 0, name: "Rough Stone Carvings", quantity: 5 },
        { id: "601", kind: "cargo", itemType: 1, name: "Stone Carvings Package", quantity: 1 },
      ],
      gatheredItemKeys: [carvingsKey],
    }),
    detailsByKey: new Map([
      [carvingsKey, { item: { id: "600", itemType: 0, name: "Rough Stone Carvings" }, craftingRecipes: [] }],
      [packageKey, { cargo: { id: "601", itemType: 1, name: "Stone Carvings Package" }, craftingRecipes: [] }],
    ]),
  });

  assert.equal(plan.materials.some((item) => item.key === carvingsKey), true);
  assert.equal(plan.materials.some((item) => item.key === packageKey), true);
});

test("legacy gathered overrides do not change retained route resolution", () => {
  const key = recipeKey("items", "600");
  const detailsByKey = new Map([[key, {
    item: { id: "600", itemType: 0, name: "Rough Stone Carvings" },
    craftingRecipes: [{
      id: "unpack-carvings",
      name: "Unpack Stone Carvings Package",
      craftedItemStacks: [{ item_id: "600", item_type: "item", quantity: 5 }],
      consumedItemStacks: [{ item_id: "601", item_type: "cargo", quantity: 1 }],
      consumedItems: [{ id: "601", itemType: 1, name: "Stone Carvings Package" }],
    }],
  }]]);
  const shared = {
    enabled: true,
    targets: [{ id: "600", kind: "items", itemType: 0, name: "Rough Stone Carvings", quantity: 5 }],
    routeOverrides: { [key]: "unpack-carvings" },
  };

  const gathered = computeCraftPlan({ config: normalizeCraftPlanConfig({ ...shared, gatheredItemKeys: [key] }), detailsByKey });
  const restored = computeCraftPlan({ config: normalizeCraftPlanConfig({ ...shared, gatheredItemKeys: [] }), detailsByKey });

  assert.equal(gathered.steps[0].selectedRecipeId, "unpack-carvings");
  assert.equal(restored.steps[0].selectedRecipeId, "unpack-carvings");
  assert.equal(gathered.materials.some((item) => item.key === recipeKey("cargo", "601")), true);
  assert.equal(restored.materials.some((item) => item.key === recipeKey("cargo", "601")), true);
});

test("legacy gathered overrides do not suppress personal fishing routes", () => {
  const key = recipeKey("items", "1900");
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "1900", kind: "items", itemType: 0, name: "Basic Fish Oil", quantity: 10 }],
      gatheredItemKeys: [key],
    }),
    detailsByKey: fishingPreferenceDetails(),
  });
  const tier = plan.personalViews.fishing.tiers[0];

  assert.equal(tier.remainingOil, 10);
  assert.equal(Object.values(tier.routes).some((route) => route.available), true);
});

test("computeCraftPlan stops cyclic production routes at the nearest source item", () => {
  const plantDetail = {
    item: { id: "300", name: "Basic Wispweave Plant", itemType: 0, tag: "Filament Plant", tier: 1 },
    craftingRecipes: [{
      id: "grow-plant",
      name: "Grow Basic Wispweave Plant",
      craftedItemStacks: [{ item_id: "300", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "301", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "301", name: "Basic Wispweave Seeds", itemType: 0, tag: "Filament Seeds", tier: 1 }],
    }],
  };
  const seedDetail = {
    item: { id: "301", name: "Basic Wispweave Seeds", itemType: 0, tag: "Filament Seeds", tier: 1 },
    craftingRecipes: [{
      id: "harvest-seeds",
      name: "Harvest Basic Wispweave Seeds",
      craftedItemStacks: [{ item_id: "301", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "300", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "300", name: "Basic Wispweave Plant", itemType: 0, tag: "Filament Plant", tier: 1 }],
    }],
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "300", kind: "items", name: "Basic Wispweave Plant", quantity: 10, itemType: 0 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "300"), plantDetail],
      [recipeKey("items", "301"), seedDetail],
    ]),
  });

  assert.equal(plan.materials.find((material) => material.name === "Basic Wispweave Plant")?.required, 10);
  assert.equal(plan.materials.find((material) => material.name === "Basic Wispweave Seeds")?.required, 10);
  assert.equal(plan.steps.length, 1);
});

test("computeCraftPlan does not credit secondary outputs from recipes that have not started", () => {
  const assemblyDetail = {
    item: { id: "1000", name: "Assembly", itemType: 0, tag: "Assembly", tier: 1 },
    craftingRecipes: [{
      id: "make-assembly",
      name: "Make Assembly",
      craftedItemStacks: [{ item_id: "1000", item_type: "item", quantity: 1 }],
      consumedItemStacks: [
        { item_id: "1001", item_type: "item", quantity: 1 },
        { item_id: "1002", item_type: "item", quantity: 1 },
      ],
      consumedItems: [
        { id: "1001", name: "Primary Part", itemType: 0, tag: "Part", tier: 1 },
        { id: "1002", name: "Binding", itemType: 0, tag: "Binding", tier: 1 },
      ],
    }],
  };
  const primaryDetail = {
    item: { id: "1001", name: "Primary Part", itemType: 0, tag: "Part", tier: 1 },
    craftingRecipes: [{
      id: "make-primary-with-binding",
      name: "Make Primary Part",
      craftedItemStacks: [
        { item_id: "1001", item_type: "item", quantity: 1 },
        { item_id: "1002", item_type: "item", quantity: 1 },
      ],
      craftedItems: [
        { id: "1001", name: "Primary Part", itemType: 0, tag: "Part", tier: 1 },
        { id: "1002", name: "Binding", itemType: 0, tag: "Binding", tier: 1 },
      ],
      consumedItemStacks: [{ item_id: "1003", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "1003", name: "Raw Material", itemType: 0, tag: "Raw Material", tier: 1 }],
    }],
  };
  const bindingDetail = {
    item: { id: "1002", name: "Binding", itemType: 0, tag: "Binding", tier: 1 },
    craftingRecipes: [{
      id: "make-binding",
      name: "Make Binding",
      craftedItemStacks: [{ item_id: "1002", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "1004", item_type: "item", quantity: 10 }],
      consumedItems: [{ id: "1004", name: "Binding Fibre", itemType: 0, tag: "Fibre", tier: 1 }],
    }],
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "1000", kind: "items", name: "Assembly", quantity: 5, itemType: 0 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "1000"), assemblyDetail],
      [recipeKey("items", "1001"), primaryDetail],
      [recipeKey("items", "1002"), bindingDetail],
      [recipeKey("items", "1003"), { item: { id: "1003", name: "Raw Material", itemType: 0, tag: "Raw Material", tier: 1 }, craftingRecipes: [] }],
      [recipeKey("items", "1004"), { item: { id: "1004", name: "Binding Fibre", itemType: 0, tag: "Fibre", tier: 1 }, craftingRecipes: [] }],
    ]),
  });

  const binding = plan.materials.find((item) => item.name === "Binding");
  assert.equal("plannedOutput" in binding, false);
  assert.equal(binding?.missing, 5);
  assert.equal(plan.materials.find((item) => item.name === "Binding Fibre")?.missing, 50);
  assert.equal(plan.materials.find((item) => item.name === "Raw Material")?.missing, 5);
});

test("computeCraftPlan does not net unstarted secondary outputs across target branches", () => {
  const bindingDetail = {
    item: { id: "1102", name: "Binding", itemType: 0, tag: "Binding", tier: 1 },
    craftingRecipes: [{
      id: "make-binding",
      name: "Make Binding",
      craftedItemStacks: [{ item_id: "1102", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "1104", item_type: "item", quantity: 10 }],
      consumedItems: [{ id: "1104", name: "Binding Fibre", itemType: 0, tag: "Fibre", tier: 1 }],
    }],
  };
  const firstTarget = {
    item: { id: "1100", name: "Bound Part", itemType: 0, tag: "Part", tier: 1 },
    craftingRecipes: [{
      id: "make-bound-part",
      name: "Make Bound Part",
      craftedItemStacks: [{ item_id: "1100", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "1102", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "1102", name: "Binding", itemType: 0, tag: "Binding", tier: 1 }],
    }],
  };
  const secondTarget = {
    item: { id: "1101", name: "Primary Part", itemType: 0, tag: "Part", tier: 1 },
    craftingRecipes: [{
      id: "make-primary",
      name: "Make Primary Part",
      craftedItemStacks: [
        { item_id: "1101", item_type: "item", quantity: 1 },
        { item_id: "1102", item_type: "item", quantity: 1 },
      ],
      craftedItems: [
        { id: "1101", name: "Primary Part", itemType: 0, tag: "Part", tier: 1 },
        { id: "1102", name: "Binding", itemType: 0, tag: "Binding", tier: 1 },
      ],
      consumedItemStacks: [{ item_id: "1103", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "1103", name: "Raw Material", itemType: 0, tag: "Raw Material", tier: 1 }],
    }],
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [
      { id: "1100", kind: "items", name: "Bound Part", quantity: 5, itemType: 0 },
      { id: "1101", kind: "items", name: "Primary Part", quantity: 5, itemType: 0 },
    ] }),
    detailsByKey: new Map([
      [recipeKey("items", "1100"), firstTarget],
      [recipeKey("items", "1101"), secondTarget],
      [recipeKey("items", "1102"), bindingDetail],
      [recipeKey("items", "1103"), { item: { id: "1103", name: "Raw Material", itemType: 0, tag: "Raw Material", tier: 1 }, craftingRecipes: [] }],
      [recipeKey("items", "1104"), { item: { id: "1104", name: "Binding Fibre", itemType: 0, tag: "Fibre", tier: 1 }, craftingRecipes: [] }],
    ]),
  });

  const binding = plan.materials.find((item) => item.name === "Binding");
  assert.equal("plannedOutput" in binding, false);
  assert.equal(binding?.missing, 5);
  assert.equal(plan.materials.find((item) => item.name === "Binding Fibre")?.missing, 50);
});
test("computeCraftPlan prefers loose-material routes over packaged transport routes", () => {
  const mixDetail = {
    item: { id: "910", name: "Infused Potter's Mix", itemType: 0, tag: "Potter's Mix", tier: 3 },
    craftingRecipes: [
      {
        id: "packaged-mix-route",
        name: "Mix Infused Potter's Mix",
        craftedItemStacks: [{ item_id: "910", item_type: "item", quantity: 1 }],
        consumedItemStacks: [
          { item_id: "911", item_type: "item", quantity: 5 },
          { item_id: "912", item_type: "item", quantity: 1 },
        ],
        consumedItems: [
          { id: "911", name: "Sturdy Pebbles", itemType: 0, tag: "Pebbles", tier: 3 },
          { id: "912", name: "Infused Clay Lump Package", itemType: 0, tag: "Clay Lump Package", tier: 3 },
        ],
      },
      {
        id: "loose-mix-route",
        name: "Mix Infused Potter's Mix",
        craftedItemStacks: [{ item_id: "910", item_type: "item", quantity: 1 }],
        consumedItemStacks: [
          { item_id: "911", item_type: "item", quantity: 5 },
          { item_id: "913", item_type: "item", quantity: 2 },
        ],
        consumedItems: [
          { id: "911", name: "Sturdy Pebbles", itemType: 0, tag: "Pebbles", tier: 3 },
          { id: "913", name: "Infused Clay Lump", itemType: 0, tag: "Clay", tier: 3 },
        ],
      },
    ],
  };
  const pebblesDetail = { item: { id: "911", name: "Sturdy Pebbles", itemType: 0, tag: "Pebbles", tier: 3 }, craftingRecipes: [] };
  const clayPackageDetail = {
    item: { id: "912", name: "Infused Clay Lump Package", itemType: 0, tag: "Clay Lump Package", tier: 3 },
    craftingRecipes: [{
      id: "package-clay-route",
      name: "Package {I} into {O}",
      craftedItemStacks: [{ item_id: "912", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "913", item_type: "item", quantity: 500 }],
      consumedItems: [{ id: "913", name: "Infused Clay Lump", itemType: 0, tag: "Clay", tier: 3 }],
    }],
  };
  const clayDetail = { item: { id: "913", name: "Infused Clay Lump", itemType: 0, tag: "Clay", tier: 3 }, craftingRecipes: [] };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "910", kind: "items", name: "Infused Potter's Mix", quantity: 4, itemType: 0 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "910"), mixDetail],
      [recipeKey("items", "911"), pebblesDetail],
      [recipeKey("items", "912"), clayPackageDetail],
      [recipeKey("items", "913"), clayDetail],
    ]),
  });

  assert.equal(plan.steps[0].selectedRecipeId, "loose-mix-route");
  assert.deepEqual(plan.steps[0].alternatives.map((recipe) => recipe.id), ["loose-mix-route", "packaged-mix-route"]);
  assert.equal(plan.materials.some((material) => material.name === "Infused Clay Lump Package"), false);
  const clay = plan.materials.find((material) => material.name === "Infused Clay Lump");
  assert.equal(clay?.required, 8);
  assert.deepEqual(clay?.recipeUsages.map((usage) => usage.output.name), ["Infused Potter's Mix"]);
});
test("computeCraftPlan uses API recipe detail tiers instead of name or id fallback inference", () => {
  const detail = {
    item: { id: "900000", name: "Tier Upgrade", itemType: 0, tier: 6 },
    craftingRecipes: [{
      id: "tier-upgrade-route",
      name: "Tier Upgrade",
      craftedItemStacks: [{ item_id: "900000", item_type: "item", quantity: 1 }],
      consumedItemStacks: [
        { item_id: "602001", item_type: "item", quantity: 4 },
        { item_id: "102999", item_type: "item", quantity: 2 },
      ],
      consumedItems: [
        { id: "602001", name: "Hexite Wood Fragment", itemType: 0 },
        { id: "102999", name: "Woodworking Sandpaper", itemType: 0 },
      ],
      levelRequirements: [{ skill: { name: "Carpentry" }, level: 60 }],
    }],
  };
  const hexiteDetail = { item: { id: "602001", name: "Hexite Wood Fragment", itemType: 0, tier: 6 }, craftingRecipes: [] };
  const sandpaperDetail = { item: { id: "102999", name: "Woodworking Sandpaper", itemType: 0 }, craftingRecipes: [] };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "900000", kind: "items", name: "Tier Upgrade", quantity: 3, itemType: 0, tier: 6 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "900000"), detail],
      [recipeKey("items", "602001"), hexiteDetail],
      [recipeKey("items", "102999"), sandpaperDetail],
    ]),
  });

  const hexite = plan.materials.find((material) => material.name === "Hexite Wood Fragment");
  const sandpaper = plan.materials.find((material) => material.name === "Woodworking Sandpaper");
  assert.equal(hexite?.tier, 6);
  assert.equal(hexite?.required, 12);
  assert.equal(sandpaper?.tier, null);
  assert.equal(sandpaper?.required, 6);
});

test("computeCraftPlan enriches emitted materials from fetched item details", () => {
  const detail = {
    item: { id: "700", name: "Berry Jam", itemType: 0, tier: 6, tag: "Food" },
    craftingRecipes: [{
      id: "berry-jam-route",
      name: "Berry Jam",
      craftedItemStacks: [{ item_id: "700", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "6130004", item_type: "item", quantity: 2 }],
      consumedItems: [{ id: "6130004", name: "Peerless Berry", itemType: 0 }],
      levelRequirements: [{ skill: { name: "Foraging" }, level: 60 }],
    }],
  };
  const peerlessBerryDetail = {
    item: { id: "6130004", name: "Peerless Berry", itemType: 0, tag: "Berry", tier: 6 },
    craftingRecipes: [],
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "700", kind: "items", name: "Berry Jam", quantity: 5, itemType: 0 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "700"), detail],
      [recipeKey("items", "6130004"), peerlessBerryDetail],
    ]),
  });

  const berry = plan.materials.find((material) => material.id === "6130004");
  assert.equal(berry?.name, "Peerless Berry");
  assert.equal(berry?.tag, "Berry");
  assert.equal(berry?.tier, 6);
  assert.equal(berry?.required, 10);
  assert.equal(berry?.section, "Foraging");
});
test("computeCraftPlan leaves missing tier null when API detail is unavailable", () => {
  const detail = {
    item: { id: "900000", name: "Tier Upgrade", itemType: 0, tier: 6 },
    craftingRecipes: [{
      id: "tier-upgrade-route",
      name: "Tier Upgrade",
      craftedItemStacks: [{ item_id: "900000", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "602001", item_type: "item", quantity: 4 }],
      consumedItems: [{ id: "602001", name: "Hexite Wood Fragment", itemType: 0 }],
      levelRequirements: [{ skill: { name: "Carpentry" }, level: 60 }],
    }],
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "900000", kind: "items", name: "Tier Upgrade", quantity: 3, itemType: 0, tier: 6 }] }),
    detailsByKey: new Map([[recipeKey("items", "900000"), detail]]),
  });

  const hexite = plan.materials.find((material) => material.name === "Hexite Wood Fragment");
  assert.equal(hexite?.tier, null);
  assert.equal(hexite?.required, 12);
});

test("computeCraftPlan exposes source locations and recipe alternatives for material details", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "900", kind: "items", name: "Fish Oil", quantity: 4, itemType: 0 }],
  });

  const plan = computeCraftPlan({
    config,
    detailsByKey: new Map([[recipeKey("items", "900"), fishOilDetail]]),
    storageSources: [{ sourceId: "store-1", label: "Pantry", items: [{ id: "100", kind: "items", quantity: 5, name: "Ocean Fish" }] }],
  });

  const oceanFish = plan.materials.find((material) => material.name === "Ocean Fish");
  assert.equal(oceanFish.required, 12);
  assert.deepEqual(oceanFish.sources.map((source) => [source.label, source.quantity]), [["Pantry", 5]]);
  assert.equal(oceanFish.recipeUsages.length, 1);
  assert.equal(oceanFish.recipeUsages[0].output.name, "Fish Oil");
  assert.equal(oceanFish.recipeUsages[0].output.quantity, 4);
  assert.equal(oceanFish.recipeUsages[0].requiredQuantity, 12);
  assert.equal(oceanFish.recipeUsages[0].quantityPerCraft, 3);
  assert.equal(oceanFish.recipeUsages[0].selectedRecipeId, "ocean-route");
  assert.deepEqual(oceanFish.recipeUsages[0].alternatives.map((recipe) => [recipe.id, recipe.label]), [["ocean-route", "Ocean Fish Oil"], ["lake-route", "Lake Fish Oil"]]);
  assert.equal(oceanFish.recipeUsages[0].alternatives[0].inputs[0].quantityPerCraft, 3);
  assert.equal(oceanFish.recipeUsages[0].alternatives[0].routeType, "craft");
  assert.equal(oceanFish.recipeUsages[0].alternatives[0].actionsRequired, 1);
  assert.deepEqual(plan.steps[0].alternatives.map((recipe) => [recipe.id, recipe.label]), [["ocean-route", "Ocean Fish Oil"], ["lake-route", "Lake Fish Oil"]]);
});

test("probabilistic buffers increase producer actions and inputs without inflating the chance output", () => {
  const { hair, sagiBird, processingSalt, detailsByKey } = animalHairSourceDetails();
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ ...hair, quantity: 368 }],
    multipliers: { [recipeKey("items", hair.id)]: { multiplier: 1.25, note: "25% extra" } },
  });

  const plan = computeCraftPlan({ config, detailsByKey });

  const hairMaterial = plan.materials.find((material) => material.id === hair.id);
  const sagiMaterial = plan.materials.find((material) => material.id === sagiBird.id);
  const saltMaterial = plan.materials.find((material) => material.id === processingSalt.id);
  const step = plan.steps.find((candidate) => candidate.output.id === hair.id);
  assert.equal(hairMaterial.required, 368);
  assert.equal(hairMaterial.bufferedRequired, 368);
  assert.equal(sagiMaterial.required, 1840);
  assert.equal(saltMaterial.required, 3680);
  assert.equal(step.unbufferedCraftCount, 1472);
  assert.equal(step.craftCount, 1840);
  assert.equal(step.multiplier, 1.25);
});

test("probabilistic buffers use remaining output and producer stock while reset restores base inputs", () => {
  const { hair, sagiBird, detailsByKey } = animalHairSourceDetails();
  const sourceRules = { storageContainerIds: ["store"] };
  const storageSources = [{ sourceId: "store", label: "Hunting stores", items: [
    { ...hair, quantity: 8 },
    { ...sagiBird, quantity: 100 },
  ] }];
  const target = { ...hair, quantity: 368 };
  const buffered = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [target], sourceRules, multipliers: { [recipeKey("items", hair.id)]: { multiplier: 1.25 } } }),
    detailsByKey,
    storageSources,
  });
  const reset = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [target], sourceRules }),
    detailsByKey,
    storageSources,
  });

  assert.equal(buffered.materials.find((material) => material.id === hair.id).required, 368);
  assert.equal(buffered.materials.find((material) => material.id === sagiBird.id).required, 1800);
  assert.equal(buffered.materials.find((material) => material.id === sagiBird.id).missing, 1700);
  assert.equal(reset.materials.find((material) => material.id === sagiBird.id).required, 1440);
  assert.equal(reset.materials.find((material) => material.id === sagiBird.id).missing, 1340);
});

test("computeCraftPlan expands cached recipe-detail wrappers and keeps final targets out of gather next", () => {
  const codexDetail = {
    item: { id: "500", name: "Advanced Codex", itemType: 0, tag: "Research", tier: 5 },
    craftingRecipes: [{
      id: "advanced-codex-route",
      name: "Advanced Codex",
      buildingName: "Scholar Station",
      craftedItemStacks: [{ item_id: "500", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "501", item_type: "item", quantity: 2 }],
      consumedItems: [{ id: "501", name: "Advanced Research Notes", tag: "Research", tier: 5 }],
      levelRequirements: [{ skill: { name: "Scholar" }, level: 50 }],
    }],
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "500", kind: "items", name: "Advanced Codex", quantity: 25, itemType: 0 }] }),
    detailsByKey: new Map([[recipeKey("items", "500"), { detail: codexDetail, cached: true }]]),
  });

  assert.equal(plan.targets[0].missing, 25);
  assert.equal(plan.materials.some((material) => material.name === "Advanced Codex" && material.missing > 0), true);
  assert.equal(plan.gatherNext.some((group) => group.items.some((item) => item.name === "Advanced Codex")), false);
  const notes = plan.materials.find((material) => material.name === "Advanced Research Notes");
  assert.equal(notes.required, 50);
  assert.equal(plan.gatherNext[0].items[0].name, "Advanced Research Notes");
});

test("computeCraftPlan keeps uncrafted final targets out of gather next", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "500", kind: "items", name: "Advanced Codex", quantity: 25, itemType: 0 }] }),
  });

  assert.equal(plan.targets[0].missing, 25);
  assert.equal(plan.materials.find((material) => material.name === "Advanced Codex")?.missing, 25);
  assert.deepEqual(plan.gatherNext, []);
});

test("computeCraftPlan keeps refined materials under the profession that crafts them", () => {
  const refinedPlankDetail = {
    item: { id: "305", name: "Refined Simple Plank", itemType: 0, tag: "Refined Plank", tier: 2 },
    craftingRecipes: [{
      id: "refine-plank-route",
      name: "Research Refined Simple Plank",
      craftedItemStacks: [{ item_id: "305", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "300", item_type: "item", quantity: 5 }],
      consumedItems: [{ id: "300", name: "Simple Plank", itemType: 0, tag: "Plank", tier: 1 }],
      levelRequirements: [{ skill: { name: "Scholar" }, level: 20 }],
    }],
  };
  const plankDetail = { item: { id: "300", name: "Simple Plank", itemType: 0, tag: "Plank", tier: 1 }, craftingRecipes: [] };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "305", kind: "items", name: "Refined Simple Plank", quantity: 10, itemType: 0 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "305"), refinedPlankDetail],
      [recipeKey("items", "300"), plankDetail],
    ]),
  });

  const refinedPlank = plan.materials.find((material) => material.name === "Refined Simple Plank");
  assert.equal(refinedPlank?.section, "Scholar");
});
test("computeCraftPlan does not infer sections from item names or tags without recipe API context", () => {
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "800", kind: "items", name: "Advanced Codex", quantity: 1, itemType: 0 }] }),
    detailsByKey: new Map([[recipeKey("items", "800"), {
      item: { id: "800", name: "Advanced Codex", itemType: 0, tag: "Research", tier: 5 },
      craftingRecipes: [{
        id: "codex-route",
        name: "Advanced Codex",
        craftedItemStacks: [{ item_id: "800", item_type: "item", quantity: 1 }],
        consumedItemStacks: [{ item_id: "305", item_type: "item", quantity: 25 }],
        consumedItems: [{ id: "305", name: "Refined Simple Plank", itemType: 0, tag: "Refined Plank", tier: 2 }],
      }],
    }]]),
  });

  const refinedPlank = plan.materials.find((material) => material.name === "Refined Simple Plank");
  assert.equal(refinedPlank?.section, "Other");
});
test("normalizeCraftPlanConfig preserves valid section overrides", () => {
  const config = normalizeCraftPlanConfig({
    sectionOverrides: {
      "tag:Refined Plank": "Scholar",
      "item:items:123": "Foraging",
      "bad": "Not A Section",
      "tag:Blank": "",
    },
  });

  assert.deepEqual(config.sectionOverrides, {
    "tag:Refined Plank": "Scholar",
    "item:items:123": "Foraging",
  });
});

test("computeCraftPlan applies row section overrides after API section resolution", () => {
  const detail = {
    item: { id: "305", name: "Refined Simple Plank", itemType: 0, tag: "Refined Plank", tier: 2 },
    craftingRecipes: [{
      id: "refine-plank-route",
      name: "Research Refined Simple Plank",
      craftedItemStacks: [{ item_id: "305", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "300", item_type: "item", quantity: 5 }],
      consumedItems: [{ id: "300", name: "Simple Plank", itemType: 0, tag: "Plank", tier: 1 }],
      levelRequirements: [{ skill: { name: "Scholar" }, level: 20 }],
    }],
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "305", kind: "items", name: "Refined Simple Plank", quantity: 10, itemType: 0 }],
      sectionOverrides: { "tag:Refined Plank": "Carpentry" },
    }),
    detailsByKey: new Map([[recipeKey("items", "305"), detail]]),
  });

  const refinedPlank = plan.materials.find((material) => material.name === "Refined Simple Plank");
  assert.equal(refinedPlank?.apiSection, "Scholar");
  assert.equal(refinedPlank?.section, "Carpentry");
  assert.equal(refinedPlank?.sectionOverrideKey, "tag:Refined Plank");
  assert.equal(refinedPlank?.sectionOverride, "Carpentry");
});

test("computeCraftPlan expands item list possibilities through producer item routes", () => {
  const crushedShellDetail = {
    item: { id: "1110012", name: "Crushed Rough Shells", itemType: 0, tag: "Crushed Shells", tier: 1 },
    craftingRecipes: [],
    recipesUsingItem: [],
  };
  const baitAndShellsDetail = {
    item: { id: "1220019", name: "Basic Bait and Shells", itemType: 0, tag: "Bait Output", tier: 1, itemListId: "1110025" },
    craftingRecipes: [{
      id: "process-guppi",
      name: "Process Briny Guppi",
      craftedItemStacks: [{ item_id: "1220019", item_type: "item", quantity: 1 }],
      craftedItems: [{ id: "1220019", name: "Basic Bait and Shells", itemType: 0, tag: "Bait Output", tier: 1 }],
      consumedItemStacks: [{ item_id: "900", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "900", name: "Briny Guppi", itemType: 0, tag: "Fish", tier: 1 }],
      levelRequirements: [{ skill: { name: "Fishing" }, level: 1 }],
    }],
    itemListPossibilities: [{
      targetId: "1110012",
      targetItem: { id: "1110012", name: "Crushed Rough Shells", tier: 1 },
      quantity: 1,
      chance: 0.1,
      isCargo: false,
    }],
  };
  const fishDetail = { item: { id: "900", name: "Briny Guppi", itemType: 0, tag: "Fish", tier: 1 } };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "1110012", kind: "items", name: "Crushed Rough Shells", quantity: 2, itemType: 0 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "1110012"), crushedShellDetail],
      [recipeKey("items", "1220019"), baitAndShellsDetail],
      [recipeKey("items", "900"), fishDetail],
    ]),
  });

  assert.equal(plan.steps[0].selectedRecipeId, "possibility:process-guppi:items:1110012");
  const fish = plan.materials.find((material) => material.name === "Briny Guppi");
  assert.equal(fish?.section, "Fishing");
  assert.equal(fish?.required, 20);
  const shells = plan.materials.find((material) => material.name === "Crushed Rough Shells");
  assert.equal(shells?.sourceRoutes?.[0]?.recipeName, "Process Briny Guppi -> Crushed Rough Shells");
});

test("computeCraftPlan expands item list possibilities through cargo processing routes", () => {
  const woodLogDetail = {
    item: { id: "5010001", name: "Exquisite Wood Log", itemType: 0, tag: "Wood Log", tier: 5 },
    craftingRecipes: [{
      id: "unpack-log-package",
      name: "Unpack Exquisite Wood Log Package",
      craftedItemStacks: [{ item_id: "5010001", item_type: "item", quantity: 100 }],
      consumedItemStacks: [{ item_id: "550000", item_type: "cargo", quantity: 1 }],
      consumedItems: [{ id: "550000", name: "Exquisite Wood Log Package", itemType: 1, tag: "Package", tier: 5 }],
      levelRequirements: [{ skill: { name: "Forestry" }, level: 1 }],
    }],
  };
  const woodLogOutputDetail = {
    item: { id: "338345776", name: "Exquisite Wood Log Output", itemType: 0, tag: "Wood Log", tier: 5 },
    craftingRecipes: [{
      id: "split-trunk",
      name: "Split into Exquisite Wood Log Output",
      craftedItemStacks: [{ item_id: "338345776", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "1004", item_type: "cargo", quantity: 1 }],
      consumedItems: [{ id: "1004", name: "Exquisite Trunk", itemType: 1, tag: "Trunk", tier: 5 }],
      levelRequirements: [{ skill: { name: "Forestry" }, level: 50 }],
    }],
    itemListPossibilities: [{
      targetId: "5010001",
      targetItem: { id: "5010001", name: "Exquisite Wood Log", tier: 5 },
      quantity: 6,
      chance: 0.94,
      isCargo: false,
    }, {
      targetId: "5010001",
      targetItem: { id: "5010001", name: "Exquisite Wood Log", tier: 5 },
      quantity: 6,
      chance: 0.06,
      isCargo: false,
    }],
  };
  const trunkDetail = {
    cargo: { id: "1004", name: "Exquisite Trunk", itemType: 1, tag: "Trunk", tier: 5 },
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ id: "5010001", kind: "items", name: "Exquisite Wood Log", quantity: 18, itemType: 0 }] }),
    detailsByKey: new Map([
      [recipeKey("items", "5010001"), woodLogDetail],
      [recipeKey("items", "338345776"), woodLogOutputDetail],
      [recipeKey("cargo", "1004"), trunkDetail],
    ]),
  });

  assert.equal(plan.steps[0].selectedRecipeId, "possibility:split-trunk:items:5010001");
  assert.equal(plan.materials.some((material) => material.name === "Exquisite Wood Log Package"), false);
  const trunk = plan.materials.find((material) => material.name === "Exquisite Trunk");
  assert.equal(trunk?.kind, "cargo");
  assert.equal(trunk?.tag, "Trunk");
  assert.equal(trunk?.tier, 5);
  assert.equal(trunk?.section, "Forestry");
  assert.equal(trunk?.required, 3);
  const log = plan.materials.find((material) => material.name === "Exquisite Wood Log");
  assert.equal(log?.sourceRoutes?.[0]?.recipeName, "Split into Exquisite Wood Log Output -> Exquisite Wood Log");
});

test("computeCraftPlan treats guaranteed Forestry Station logs as craft output and resin as a craft byproduct", () => {
  const log = { id: "2010001", itemType: 0, name: "Simple Wood Log", tag: "Wood Log", tier: 2 };
  const resin = { id: "1724476397", itemType: 0, name: "Simple Amber Resin", tag: "Resin", tier: 2 };
  const output = { id: "1940258895", itemType: 0, name: "Simple Wood Log Output", tag: "Wood Log", tier: 2 };
  const trunk = { id: "1001", itemType: 1, name: "Simple Wood Trunk", tag: "Trunk", tier: 2 };
  const splitRecipe = {
    id: "201003",
    name: "Split into Simple Wood Log Output",
    buildingName: "Tier 2 Forestry Station",
    skillName: "Forestry",
    activityKind: "craft",
    craftedItemStacks: [{ item_id: output.id, item_type: "item", quantity: 1 }],
    craftedItems: [output],
    consumedItemStacks: [{ item_id: trunk.id, item_type: "cargo", quantity: 1 }],
    consumedItems: [trunk],
  };
  const detailsByKey = new Map([
    [recipeKey("items", log.id), { item: log }],
    [recipeKey("items", resin.id), { item: resin }],
    [recipeKey("items", output.id), {
      item: output,
      craftingRecipes: [splitRecipe],
      itemListPossibilities: [
        { targetId: log.id, targetItem: log, quantity: 6, chance: 1, guaranteedQuantity: 6 },
        { targetId: resin.id, targetItem: resin, quantity: 0.06, chance: 1, guaranteedQuantity: 0 },
      ],
    }],
    [recipeKey("cargo", trunk.id), { cargo: trunk }],
  ]);

  const logPlan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ ...log, kind: "items", quantity: 276 }] }),
    detailsByKey,
  });
  const logRoute = logPlan.materials.find((material) => material.id === log.id)?.sourceRoutes?.[0];
  assert.equal(logRoute?.routeType, "craft");
  assert.equal(logRoute?.expectedYield, 6);
  assert.equal(logRoute?.guaranteedYield, 6);
  assert.equal(logRoute?.isProbabilistic, false);
  assert.equal(logRoute?.inputs[0]?.name, "Simple Wood Trunk");
  assert.equal(logRoute?.inputs[0]?.quantity, 1);

  const resinPlan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ ...resin, kind: "items", quantity: 1 }] }),
    detailsByKey,
  });
  const resinRoute = resinPlan.materials.find((material) => material.id === resin.id)?.sourceRoutes?.[0];
  assert.equal(resinRoute?.routeType, "craft-byproduct");
  assert.equal(resinRoute?.isProbabilistic, true);
});

function itemListRouteFixture({ activityKind, guaranteedQuantity }) {
  const target = { id: "9100", itemType: 0, name: "Stone Fragment", tag: "Stone", tier: 1 };
  const producer = { id: "9101", itemType: 0, name: "Stone Output", tag: "Stone Output", tier: 1 };
  const source = { id: "9102", itemType: 1, name: "Stone Source", tag: "Stone Source", tier: 1 };
  const station = activityKind === "craft" ? "Mining Station" : null;
  const recipe = {
    id: `stone-${activityKind}`,
    name: activityKind === "craft" ? "Process Stone" : "Gather Stone",
    activityKind,
    buildingName: station,
    skillName: "Mining",
    gatheringSource: activityKind === "gathering"
      ? { tag: "Stone Output", label: "Stone", skill: "Mining" }
      : null,
    craftedItemStacks: [{ item_id: producer.id, item_type: "item", quantity: 1 }],
    craftedItems: [producer],
    consumedItemStacks: station ? [{ item_id: source.id, item_type: "cargo", quantity: 1 }] : [],
    consumedItems: station ? [source] : [],
  };
  const detailsByKey = new Map([
    [recipeKey("items", target.id), { item: target }],
    [recipeKey("items", producer.id), {
      item: producer,
      craftingRecipes: [recipe],
      itemListPossibilities: [{ targetId: target.id, targetItem: target, quantity: 6, chance: 1, guaranteedQuantity }],
    }],
    [recipeKey("cargo", source.id), { cargo: source }],
  ]);
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [{ ...target, kind: "items", quantity: 6 }] }),
    detailsByKey,
  });
  return plan.materials.find((material) => material.id === target.id)?.sourceRoutes?.[0];
}

for (const [activityKind, guaranteedQuantity, expectedRouteType] of [
  ["craft", 6, "craft"],
  ["craft", 0, "craft-byproduct"],
  ["gathering", 6, "gathering"],
  ["gathering", 0, "gathering-byproduct"],
]) {
  test(`item-list route ${activityKind} with guarantee ${guaranteedQuantity} becomes ${expectedRouteType}`, () => {
    assert.equal(itemListRouteFixture({ activityKind, guaranteedQuantity }).routeType, expectedRouteType);
  });
}

test("normalizeCraftPlanConfig preserves valid row name overrides", () => {
  const config = normalizeCraftPlanConfig({
    rowNameOverrides: {
      "tag:Refined Plank": "Finished Planks",
      " ": "Ignored",
      "tag:Empty": " ",
    },
  });

  assert.deepEqual(config.rowNameOverrides, {
    "tag:Refined Plank": "Finished Planks",
  });
});

test("computeCraftPlan applies row name overrides after API row identity resolution", () => {
  const detail = {
    item: { id: "305", name: "Refined Simple Plank", itemType: 0, tag: "Refined Plank", tier: 2 },
    craftingRecipes: [{
      id: "refine-plank-route",
      name: "Research Refined Simple Plank",
      craftedItemStacks: [{ item_id: "305", item_type: "item", quantity: 1 }],
      consumedItemStacks: [{ item_id: "300", item_type: "item", quantity: 5 }],
      consumedItems: [{ id: "300", name: "Simple Plank", itemType: 0, tag: "Plank", tier: 1 }],
      levelRequirements: [{ skill: { name: "Scholar" }, level: 20 }],
    }],
  };
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "305", kind: "items", name: "Refined Simple Plank", quantity: 10, itemType: 0 }],
      rowNameOverrides: { "tag:Refined Plank": "Finished Planks" },
    }),
    detailsByKey: new Map([[recipeKey("items", "305"), detail]]),
  });

  const material = plan.materials.find((item) => item.name === "Refined Simple Plank");
  assert.equal(material?.sectionOverrideKey, "tag:Refined Plank");
  assert.equal(material?.rowNameOverride, "Finished Planks");
});

test("computeCraftPlan applies row overrides independently to material families that share a tag", () => {
  const brick = { id: "3030002", name: "Sturdy Brick", itemType: 0, tag: "Brick", tier: 3 };
  const unfiredBrick = { id: "812749346", name: "Unfired Sturdy Brick", itemType: 0, tag: "Brick", tier: 3 };
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [
        { id: brick.id, kind: "items", name: brick.name, quantity: 1, itemType: 0 },
        { id: unfiredBrick.id, kind: "items", name: unfiredBrick.name, quantity: 1, itemType: 0 },
      ],
      sectionOverrides: { "row:Unfired Brick": "Construction" },
      rowNameOverrides: { "row:Unfired Brick": "Green Brick" },
    }),
    detailsByKey: new Map([
      [recipeKey("items", brick.id), { item: brick, craftingRecipes: [] }],
      [recipeKey("items", unfiredBrick.id), { item: unfiredBrick, craftingRecipes: [] }],
    ]),
  });

  const ordinaryMaterial = plan.materials.find((item) => item.name === brick.name);
  const unfiredMaterial = plan.materials.find((item) => item.name === unfiredBrick.name);
  assert.equal(ordinaryMaterial?.sectionOverrideKey, "tag:Brick");
  assert.equal(ordinaryMaterial?.sectionOverride, null);
  assert.equal(ordinaryMaterial?.rowNameOverride, null);
  assert.equal(unfiredMaterial?.sectionOverrideKey, "row:Unfired Brick");
  assert.equal(unfiredMaterial?.sectionOverride, "Construction");
  assert.equal(unfiredMaterial?.rowNameOverride, "Green Brick");
});

test("computeCraftPlan applies a Braxite family override without changing Pebbles", () => {
  const pebbles = { id: "1030001", name: "Rough Pebbles", itemType: 0, tag: "Pebbles", tier: 1 };
  const braxite = { id: "1985074940", name: "Rough Braxite", itemType: 0, tag: "Pebbles", tier: 1 };
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [
        { id: pebbles.id, kind: "items", name: pebbles.name, quantity: 1, itemType: 0 },
        { id: braxite.id, kind: "items", name: braxite.name, quantity: 1, itemType: 0 },
      ],
      sectionOverrides: { "row:Braxite": "Foraging" },
      rowNameOverrides: { "row:Braxite": "Rare Braxite" },
    }),
    detailsByKey: new Map([
      [recipeKey("items", pebbles.id), { item: pebbles, craftingRecipes: [] }],
      [recipeKey("items", braxite.id), { item: braxite, craftingRecipes: [] }],
    ]),
  });

  const pebblesMaterial = plan.materials.find((item) => item.name === pebbles.name);
  const braxiteMaterial = plan.materials.find((item) => item.name === braxite.name);
  assert.equal(pebblesMaterial?.sectionOverrideKey, "tag:Pebbles");
  assert.equal(pebblesMaterial?.sectionOverride, null);
  assert.equal(pebblesMaterial?.rowNameOverride, null);
  assert.equal(braxiteMaterial?.sectionOverrideKey, "row:Braxite");
  assert.equal(braxiteMaterial?.sectionOverride, "Foraging");
  assert.equal(braxiteMaterial?.rowNameOverride, "Rare Braxite");
});

test("computeCraftPlan keeps direct overrides when a Foraging workstation offers a craft byproduct", () => {
  const gypsiteDetail = {
    item: { id: "3001", name: "Rough Gypsite", itemType: 0, tag: "Gypsite", tier: 1 },
    craftingRecipes: [{
      id: "craft-gypsite",
      name: "Craft Rough Gypsite",
      craftedItemStacks: [{ item_id: "3001", item_type: "item", quantity: 1 }],
      craftedItems: [{ id: "3001", name: "Rough Gypsite", itemType: 0, tag: "Gypsite", tier: 1 }],
      consumedItemStacks: [
        { item_id: "4001", item_type: "item", quantity: 10 },
        { item_id: "4002", item_type: "item", quantity: 20 },
      ],
      consumedItems: [
        { id: "4001", name: "Rough Brick", itemType: 0, tag: "Brick", tier: 1 },
        { id: "4002", name: "Ancient Mortar", itemType: 0, tag: "Mortar", tier: 1 },
      ],
      levelRequirements: [{ skill: { name: "Masonry" }, level: 1 }],
    }],
  };
  const clayOutputDetail = {
    item: { id: "5001", name: "Rough Clay Output", itemType: 0, tag: "Clay Output", tier: 1, itemListId: "5000" },
    craftingRecipes: [{
      id: "gather-clay",
      name: "Gather Rough Clay",
      stationName: "Foraging Camp",
      craftedItemStacks: [{ item_id: "5001", item_type: "item", quantity: 1 }],
      craftedItems: [{ id: "5001", name: "Rough Clay Output", itemType: 0, tag: "Clay Output", tier: 1 }],
      consumedItemStacks: [{ item_id: "6001", item_type: "cargo", quantity: 1 }],
      consumedItems: [{ id: "6001", name: "Rough Clay Deposit", itemType: 1, tag: "Clay Deposit", tier: 1 }],
      levelRequirements: [{ skill: { name: "Foraging" }, level: 1 }],
    }],
    itemListPossibilities: [{
      targetId: "3001",
      targetItem: { id: "3001", name: "Rough Gypsite", itemType: 0, tag: "Gypsite", tier: 1 },
      quantity: 1,
      chance: 0.25,
      isCargo: false,
    }],
  };
  const clayDepositDetail = {
    cargo: { id: "6001", name: "Rough Clay Deposit", itemType: 1, tag: "Clay Deposit", tier: 1 },
  };

  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ id: "3001", kind: "items", name: "Rough Gypsite", quantity: 4, itemType: 0 }],
      routeOverrides: { "items:3001": "craft-gypsite" },
    }),
    detailsByKey: new Map([
      [recipeKey("items", "3001"), gypsiteDetail],
      [recipeKey("items", "5001"), clayOutputDetail],
      [recipeKey("cargo", "6001"), clayDepositDetail],
    ]),
  });

  assert.equal(plan.steps[0].selectedRecipeId, "craft-gypsite");
  assert.equal(plan.materials.find((material) => material.name === "Rough Brick")?.required, 40);
  assert.equal(plan.materials.find((material) => material.name === "Ancient Mortar")?.required, 80);
  assert.equal(plan.materials.some((material) => material.name === "Rough Clay Deposit"), false);
  const gypsite = plan.materials.find((material) => material.name === "Rough Gypsite");
  assert.equal(gypsite?.sourceRoutes?.[0]?.recipeName, "Craft Rough Gypsite");
  assert.equal(gypsite?.sourceRoutes?.[0]?.routeType, "craft");
  assert.equal(gypsite?.sourceRoutes?.[0]?.gatheringSkill, null);
  assert.equal(gypsite?.sourceRoutes?.[0]?.alternatives.some((route) => (
    route.id === "possibility:gather-clay:items:3001" && route.routeType === "craft-byproduct"
  )), true);
});

test("computeCraftPlan keeps mixed gathering and processing routes selectable", () => {
  const pebbles = { id: "3030001", name: "Sturdy Pebbles", itemType: 0, tag: "Pebbles", tier: 3 };
  const stoneChunk = { id: "2003", name: "Sturdy Stone Chunk", itemType: 1, tag: "Chunk", tier: 3 };
  const rubbleOutput = { id: "1512914014", name: "Ancient Rubble Drops", itemType: 0, tag: "Dungeon Item List", tier: 3 };
  const pebblesOutput = { id: "3220007", name: "Sturdy Pebbles Output", itemType: 0, tag: "Pebbles", tier: 3 };
  const detailsByKey = new Map([
    [recipeKey("items", pebbles.id), { item: pebbles, craftingRecipes: [] }],
    [recipeKey("items", rubbleOutput.id), {
      item: rubbleOutput,
      craftingRecipes: [{
        id: "147405514",
        name: "Gather from Ancient Rubble",
        activityKind: "gathering",
        gatheringSource: { label: "Ancient Rubble" },
        resourceHealth: 100,
        craftedItemStacks: [{ item_id: rubbleOutput.id, item_type: "item", quantity: 1 }],
        craftedItems: [rubbleOutput],
        consumedItemStacks: [],
        consumedItems: [],
      }],
      itemListPossibilities: [{
        targetId: pebbles.id,
        targetItem: pebbles,
        quantity: 0.1,
        quantityIsExpected: true,
        chance: 0.1,
        guaranteedQuantity: 0,
      }],
    }],
    [recipeKey("items", pebblesOutput.id), {
      item: pebblesOutput,
      craftingRecipes: [{
        id: "303012",
        name: "Smash Sturdy Stone Chunk into Sturdy Pebbles Output",
        activityKind: "craft",
        actionsRequired: 85,
        craftedItemStacks: [{ item_id: pebblesOutput.id, item_type: "item", quantity: 1, guaranteedQuantity: 1 }],
        craftedItems: [pebblesOutput],
        consumedItemStacks: [{ item_id: stoneChunk.id, item_type: "cargo", quantity: 1 }],
        consumedItems: [stoneChunk],
      }],
      itemListPossibilities: [{
        targetId: pebbles.id,
        targetItem: pebbles,
        quantity: 11.87,
        quantityIsExpected: true,
        chance: 1,
        guaranteedQuantity: 8,
      }],
    }],
    [recipeKey("cargo", stoneChunk.id), { cargo: stoneChunk, craftingRecipes: [] }],
  ]);
  const target = { ...pebbles, kind: "items", quantity: 119 };

  const defaultPlan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets: [target] }),
    detailsByKey,
  });
  const defaultRoute = defaultPlan.materials.find((material) => material.id === pebbles.id)?.sourceRoutes?.[0];
  assert.equal(defaultRoute?.routeType, "gathering-byproduct");
  assert.deepEqual(defaultRoute?.alternatives.map((route) => route.id), [
    "possibility:147405514:items:3030001",
    "possibility:303012:items:3030001",
  ]);

  const processingRouteId = "possibility:303012:items:3030001";
  const processingPlan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [target],
      routeOverrides: { [recipeKey("items", pebbles.id)]: processingRouteId },
    }),
    detailsByKey,
  });
  const processingRoute = processingPlan.materials.find((material) => material.id === pebbles.id)?.sourceRoutes?.[0];
  assert.equal(processingRoute?.selectedRecipeId, processingRouteId);
  assert.equal(processingRoute?.routeType, "craft-byproduct");
  assert.equal(processingPlan.materials.find((material) => material.name === stoneChunk.name)?.required, 11);
});

test("collectLocalCatalogCraftPlanDetails builds a full recursive plan from normalized local catalog rows", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "700", itemType: 0, name: "Peerless Berry Tart", tag: "Food", tier: 6 },
      craftingRecipes: [{
        id: "bake-tart",
        name: "Bake Peerless Berry Tart",
        stationName: "Cooking Station",
        craftedItemStacks: [{ item_id: "700", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "700", itemType: 0, name: "Peerless Berry Tart", tag: "Food", tier: 6 }],
        consumedItemStacks: [{ item_id: "701", item_type: "item", quantity: 2 }],
        consumedItems: [{ id: "701", itemType: 0, name: "Berry Filling" }],
        levelRequirements: [{ skill: { name: "Cooking" }, level: 60 }],
      }],
    },
    {
      item: { id: "701", itemType: 0, name: "Peerless Berry Filling", tag: "Filling", tier: 6 },
      craftingRecipes: [{
        id: "cook-filling",
        name: "Cook Peerless Berry Filling",
        stationName: "Cooking Station",
        craftedItemStacks: [{ item_id: "701", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "701", itemType: 0, name: "Peerless Berry Filling", tag: "Filling", tier: 6 }],
        consumedItemStacks: [{ item_id: "6130004", item_type: "item", quantity: 3 }],
        consumedItems: [{ id: "6130004", itemType: 0, name: "Peerless Berry" }],
        levelRequirements: [{ skill: { name: "Cooking" }, level: 60 }],
      }],
    },
    {
      item: { id: "6130004", itemType: 0, name: "Peerless Berry", tag: "Berry", tier: 6 },
      craftingRecipes: [],
      extractionRecipes: [],
      itemListPossibilities: [],
    },
  ]);

  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "700", kind: "items", name: "Peerless Berry Tart", quantity: 2, itemType: 0 }],
    sourceRules: { playerIds: ["player-1"], craftPlayerIds: ["player-1"] },
  });
  const { detailsByKey, warnings } = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({
    config,
    detailsByKey,
    catalogWarnings: warnings,
    storageSources: [{ sourceId: "store-1", label: "Pantry", items: [{ id: "6130004", kind: "items", quantity: 1, name: "Peerless Berry" }] }],
    activeCrafts: [{ id: "craft-berry", playerId: "player-1", playerName: "Tester", buildingName: "Foraging Basket", itemId: "6130004", kind: "items", quantity: 2, guaranteedQuantity: 2, name: "Peerless Berry" }],
  });

  assert.equal(detailsByKey.has(recipeKey("items", "700")), true);
  assert.equal(detailsByKey.has(recipeKey("items", "701")), true);
  assert.equal(detailsByKey.has(recipeKey("items", "6130004")), true);
  assert.deepEqual(plan.steps.map((step) => step.selectedRecipeId), ["cook-filling", "bake-tart"]);
  const berry = plan.materials.find((material) => material.id === "6130004");
  assert.equal(berry?.name, "Peerless Berry");
  assert.equal(berry?.tag, "Berry");
  assert.equal(berry?.tier, 6);
  assert.equal(berry?.required, 12);
  assert.equal(berry?.available, 1);
  assert.equal(berry?.inProgress, 2);
  assert.equal(berry?.missing, 9);
});

test("collectLocalCatalogCraftPlanDetails ignores legacy gathered keys", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "700", itemType: 0, name: "Scholar Pack" },
      craftingRecipes: [{
        id: "craft-pack",
        craftedItemStacks: [{ item_id: "700", item_type: "item", quantity: 1 }],
        consumedItemStacks: [{ item_id: "600", item_type: "item", quantity: 2 }],
        consumedItems: [{ id: "600", itemType: 0, name: "Stone Carvings" }],
      }],
    },
    {
      item: { id: "600", itemType: 0, name: "Stone Carvings" },
      craftingRecipes: [{
        id: "unpack-carvings",
        craftedItemStacks: [{ item_id: "600", item_type: "item", quantity: 2 }],
        consumedItemStacks: [{ item_id: "601", item_type: "cargo", quantity: 1 }],
        consumedItems: [{ id: "601", itemType: 1, name: "Stone Carvings Package" }],
      }],
    },
    { cargo: { id: "601", itemType: 1, name: "Stone Carvings Package" }, craftingRecipes: [] },
  ]);

  const result = collectLocalCatalogCraftPlanDetails(
    repository,
    [{ id: "700", kind: "items", itemType: 0, name: "Scholar Pack", quantity: 1 }],
    { [recipeKey("items", "600")]: "unpack-carvings" },
    64,
    [recipeKey("items", "600")],
  );

  assert.equal(result.detailsByKey.has(recipeKey("items", "700")), true);
  assert.equal(result.detailsByKey.has(recipeKey("items", "600")), true);
  assert.equal(result.detailsByKey.has(recipeKey("cargo", "601")), true);
  assert.deepEqual(result.warnings, []);
});

test("local catalog recovers malformed Ferralith recipes and expands Refined Pyrelite to ore", (t) => {
  const { db, repository } = createCatalogFixture(t);
  const malformedFerralithDetail = {
    item: { id: "1050001", itemType: 0, name: "Ferralith Ingot", tag: "Ingot", tier: 1 },
    craftingRecipes: [{
      id: "105009",
      name: "Forge Exquisite Construction Materials Pack",
      buildingName: "Rough Smithing Station",
      craftedItemStacks: [{ item_id: "1050001", item_type: "item", quantity: 1 }],
      craftedItems: [{ id: "1050001", itemType: 0, name: "Exquisite Construction Materials Pack" }],
      consumedItemStacks: [{ item_id: "1050003", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "1050003", itemType: 0, name: "Molten Ferralith" }],
      levelRequirements: [{ skill: { name: "Smithing" }, level: 1 }],
    }],
  };
  const malformedRefinedFerralithDetail = {
    item: { id: "181015293", itemType: 0, name: "Refined Ferralith Ingot", tag: "Refined Ingot", tier: 1 },
    craftingRecipes: [{
      id: "998040942",
      name: "Refine Refined Ferralith Ingot",
      buildingName: "Rough Smithing Station",
      craftedItemStacks: [{ item_id: "181015293", item_type: "item", quantity: 1 }],
      craftedItems: [{ id: "181015293", itemType: 0, name: "Refined Ferralith Ingot" }],
      consumedItemStacks: [
        { item_id: "1050001", item_type: "item", quantity: 5 },
        { item_id: "1858615467", item_type: "item", quantity: 1 },
      ],
      consumedItems: [
        { id: "1050001", itemType: 0, name: "Exquisite Construction Materials Pack" },
        { id: "1858615467", itemType: 0, name: "Basic Metal Solvent" },
      ],
      levelRequirements: [{ skill: { name: "Smithing" }, level: 1 }],
    }],
  };
  upsertCatalogDetails(repository, [
    {
      item: { id: "647670203", itemType: 0, name: "Refined Pyrelite Ingot", tag: "Refined Ingot", tier: 2 },
      craftingRecipes: [{
        id: "1810363538",
        name: "Refine Refined Pyrelite Ingot",
        craftedItemStacks: [{ item_id: "647670203", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "647670203", itemType: 0, name: "Refined Pyrelite Ingot", tag: "Refined Ingot", tier: 2 }],
        consumedItemStacks: [
          { item_id: "2050001", item_type: "item", quantity: 5 },
          { item_id: "1537761415", item_type: "item", quantity: 1 },
          { item_id: "181015293", item_type: "item", quantity: 2 },
        ],
        consumedItems: [
          { id: "2050001", itemType: 0, name: "Pyrelite Ingot" },
          { id: "1537761415", itemType: 0, name: "Simple Metal Solvent" },
          { id: "181015293", itemType: 0, name: "Refined Ferralith Ingot" },
        ],
        levelRequirements: [{ skill: { name: "Smithing" }, level: 20 }],
      }],
    },
    malformedRefinedFerralithDetail,
    malformedFerralithDetail,
    {
      item: { id: "1050003", itemType: 0, name: "Molten Ferralith", tag: "Molten Ingot", tier: 1 },
      craftingRecipes: [{
        id: "105000",
        name: "Smelt Molten Ferralith",
        craftedItemStacks: [{ item_id: "1050003", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "1050003", itemType: 0, name: "Molten Ferralith" }],
        consumedItemStacks: [{ item_id: "1040003", item_type: "item", quantity: 1 }],
        consumedItems: [{ id: "1040003", itemType: 0, name: "Ferralith Ore Concentrate" }],
        levelRequirements: [{ skill: { name: "Smithing" }, level: 1 }],
      }],
    },
    {
      item: { id: "1040003", itemType: 0, name: "Ferralith Ore Concentrate", tag: "Ore Concentrate", tier: 1 },
      extractionRecipes: [{
        id: "103006",
        name: "Extract Ferralith Ore Concentrate",
        craftedItemStacks: [{ item_id: "1040003", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "1040003", itemType: 0, name: "Ferralith Ore Concentrate" }],
        consumedItemStacks: [{ item_id: "1040002", item_type: "item", quantity: 2 }],
        consumedItems: [{ id: "1040002", itemType: 0, name: "Ferralith Ore Piece" }],
        levelRequirements: [{ skill: { name: "Mining" }, level: 1 }],
      }],
    },
    {
      item: { id: "1040002", itemType: 0, name: "Ferralith Ore Piece", tag: "Ore Piece", tier: 1 },
      extractionRecipes: [{
        id: "103005",
        name: "Extract Ferralith Ore Piece",
        craftedItemStacks: [{ item_id: "1040002", item_type: "item", quantity: 4 }],
        craftedItems: [{ id: "1040002", itemType: 0, name: "Ferralith Ore Piece" }],
        consumedItemStacks: [{ item_id: "1001", item_type: "cargo", quantity: 1 }],
        consumedItems: [{ id: "1001", itemType: 1, name: "Ferralith Ore Chunk" }],
        levelRequirements: [{ skill: { name: "Mining" }, level: 1 }],
      }],
    },
    { cargo: { id: "1001", itemType: 1, name: "Ferralith Ore Chunk", tag: "Ore Chunk", tier: 1 }, craftingRecipes: [] },
    { item: { id: "2050001", itemType: 0, name: "Pyrelite Ingot", tag: "Ingot", tier: 2 }, craftingRecipes: [] },
    { item: { id: "1537761415", itemType: 0, name: "Simple Metal Solvent", tag: "Metal Solvent", tier: 2 }, craftingRecipes: [] },
    { item: { id: "1858615467", itemType: 0, name: "Basic Metal Solvent", tag: "Metal Solvent", tier: 1 }, craftingRecipes: [] },
  ]);
  db.prepare("UPDATE game_catalog_recipes SET name = ?, is_transport_route = 1 WHERE recipe_key = ?")
    .run("Forge Exquisite Construction Materials Pack", "recipe:105009");
  db.prepare("UPDATE game_catalog_recipes SET is_transport_route = 1 WHERE recipe_key IN (?, ?)")
    .run("recipe:998040942", "recipe:105000");

  const target = { id: "647670203", kind: "items", itemType: 0, name: "Refined Pyrelite Ingot", quantity: 196 };
  const config = normalizeCraftPlanConfig({ enabled: true, targets: [target] });
  const { detailsByKey, warnings } = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({ config, detailsByKey, catalogWarnings: warnings });
  const material = (key) => plan.materials.find((entry) => entry.key === key);

  assert.equal(material("items:181015293")?.required, 392);
  assert.equal(material("items:181015293")?.sourceRoutes[0]?.recipeName, "Refine Refined Ferralith Ingot");
  assert.equal(material("items:1050001")?.required, 1960);
  assert.equal(material("items:1050001")?.sourceRoutes[0]?.recipeName, "Craft Ferralith Ingot");
  assert.equal(material("items:1050003")?.required, 1960);
  assert.equal(material("items:1040003")?.required, 1960);
  assert.equal(material("items:1040002")?.required, 3920);
  assert.equal(material("cargo:1001")?.required, 980);
});

test("computeCraftPlan keeps direct overrides for non-gathering co-products", () => {
  const catalyst = { id: "7100", name: "Basic Catalyst", itemType: 0, tag: "Catalyst", tier: 1 };
  const batch = { id: "7200", name: "Basic Pigment Batch", itemType: 0, tag: "Pigment Output", tier: 1 };
  const detailsByKey = new Map([
    [recipeKey("items", catalyst.id), {
      item: catalyst,
      craftingRecipes: [{
        id: "craft-catalyst",
        name: "Craft Basic Catalyst",
        craftedItemStacks: [{ item_id: catalyst.id, item_type: "item", quantity: 1 }],
        craftedItems: [catalyst],
        consumedItemStacks: [{ item_id: "7300", item_type: "item", quantity: 2 }],
        consumedItems: [{ id: "7300", name: "Basic Solvent", itemType: 0, tag: "Solvent", tier: 1 }],
        levelRequirements: [{ skill: { name: "Scholar" }, level: 1 }],
      }],
    }],
    [recipeKey("items", batch.id), {
      item: batch,
      craftingRecipes: [{
        id: "process-pigment",
        name: "Process Basic Pigment",
        craftedItemStacks: [{ item_id: batch.id, item_type: "item", quantity: 1 }],
        craftedItems: [batch],
        consumedItemStacks: [{ item_id: "7400", item_type: "item", quantity: 1 }],
        consumedItems: [{ id: "7400", name: "Basic Flower", itemType: 0, tag: "Flower", tier: 1 }],
        levelRequirements: [{ skill: { name: "Scholar" }, level: 1 }],
      }],
      itemListPossibilities: [{ targetId: catalyst.id, targetItem: catalyst, quantity: 1, chance: 0.5 }],
    }],
  ]);
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ ...catalyst, kind: "items", quantity: 1 }],
      routeOverrides: { [`items:${catalyst.id}`]: "craft-catalyst" },
    }),
    detailsByKey,
  });

  assert.equal(plan.steps.find((step) => step.output.id === catalyst.id)?.selectedRecipeId, "craft-catalyst");
  const route = plan.materials.find((material) => material.id === catalyst.id)?.sourceRoutes?.[0];
  assert.equal(route?.routeType, "craft");
  assert.equal(route?.alternatives.some((alternative) => alternative.routeType === "craft-byproduct"), true);
});

test("computeCraftPlan keeps Fishing workstation item-list producers classified as crafts", () => {
  const shells = { id: "1110012", name: "Crushed Rough Shells", itemType: 0, tag: "Crushed Shells", tier: 1 };
  const baitOutput = { id: "1220019", name: "Basic Bait and Shells", itemType: 0, tag: "Bait Output", tier: 1 };
  const detailsByKey = new Map([
    [recipeKey("items", shells.id), {
      item: shells,
      craftingRecipes: [{
        id: "craft-shells",
        name: "Craft Crushed Rough Shells",
        craftedItemStacks: [{ item_id: shells.id, item_type: "item", quantity: 1 }],
        craftedItems: [shells],
        consumedItemStacks: [{ item_id: "1110999", item_type: "item", quantity: 10 }],
        consumedItems: [{ id: "1110999", name: "Shell Compound", itemType: 0, tag: "Material", tier: 1 }],
        levelRequirements: [{ skill: { name: "Scholar" }, level: 1 }],
      }],
    }],
    [recipeKey("items", baitOutput.id), {
      item: baitOutput,
      craftingRecipes: [{
        id: "fish-bait-shells",
        name: "Catch Rough Bait and Shells",
        craftedItemStacks: [{ item_id: baitOutput.id, item_type: "item", quantity: 1 }],
        craftedItems: [baitOutput],
        consumedItemStacks: [{ item_id: "6100", item_type: "item", quantity: 1 }],
        consumedItems: [{ id: "6100", name: "Basic Bait", itemType: 0, tag: "Bait", tier: 1 }],
        levelRequirements: [{ skill: { name: "Fishing" }, level: 1 }],
      }],
      itemListPossibilities: [{ targetId: shells.id, targetItem: shells, quantity: 1, chance: 0.2 }],
    }],
  ]);
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({
      enabled: true,
      targets: [{ ...shells, kind: "items", quantity: 2 }],
      routeOverrides: { [`items:${shells.id}`]: "craft-shells" },
    }),
    detailsByKey,
  });

  const route = plan.materials.find((material) => material.id === shells.id)?.sourceRoutes?.[0];
  assert.equal(route?.routeType, "craft");
  assert.equal(route?.gatheringSkill, null);
  assert.equal(route?.alternatives.some((alternative) => (
    alternative.id === "possibility:fish-bait-shells:items:1110012"
      && alternative.routeType === "craft-byproduct"
  )), true);
});

test("collectLocalCatalogCraftPlanDetails exposes normalized byproduct routes through clay and tree producers", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "3001", itemType: 0, name: "Rough Gypsite", tag: "Gypsite", tier: 1 },
      craftingRecipes: [{
        id: "craft-gypsite",
        name: "Craft Rough Gypsite",
        stationName: "Masonry Station",
        craftedItemStacks: [{ item_id: "3001", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "3001", itemType: 0, name: "Rough Gypsite", tag: "Gypsite", tier: 1 }],
        consumedItemStacks: [
          { item_id: "4001", item_type: "item", quantity: 10 },
          { item_id: "4002", item_type: "item", quantity: 20 },
        ],
        consumedItems: [
          { id: "4001", itemType: 0, name: "Rough Brick", tag: "Brick", tier: 1 },
          { id: "4002", itemType: 0, name: "Ancient Mortar", tag: "Mortar", tier: 1 },
        ],
        levelRequirements: [{ skill: { name: "Masonry" }, level: 1 }],
      }],
    },
    {
      item: { id: "5001", itemType: 0, name: "Rough Clay Output", tag: "Clay Output", tier: 1 },
      craftingRecipes: [{
        id: "gather-clay",
        name: "Gather Rough Clay",
        stationName: "Foraging Camp",
        craftedItemStacks: [{ item_id: "5001", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "5001", itemType: 0, name: "Rough Clay Output", tag: "Clay Output", tier: 1 }],
        consumedItemStacks: [{ item_id: "6001", item_type: "cargo", quantity: 1 }],
        consumedItems: [{ id: "6001", itemType: 1, name: "Rough Clay Deposit", tag: "Clay Deposit", tier: 1 }],
        levelRequirements: [{ skill: { name: "Foraging" }, level: 1 }],
      }],
      itemListPossibilities: [{
        targetId: "3001",
        targetItem: { id: "3001", itemType: 0, name: "Rough Gypsite", tag: "Gypsite", tier: 1 },
        quantity: 1,
        chance: 0.25,
        isCargo: false,
      }],
    },
    { cargo: { id: "6001", itemType: 1, name: "Rough Clay Deposit", tag: "Clay Deposit", tier: 1 } },
    {
      item: { id: "3002", itemType: 0, name: "Rough Resin", tag: "Resin", tier: 1 },
      craftingRecipes: [{
        id: "craft-resin",
        name: "Craft Rough Resin",
        stationName: "Forestry Station",
        craftedItemStacks: [{ item_id: "3002", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "3002", itemType: 0, name: "Rough Resin", tag: "Resin", tier: 1 }],
        consumedItemStacks: [
          { item_id: "4003", item_type: "item", quantity: 8 },
          { item_id: "4004", item_type: "item", quantity: 4 },
        ],
        consumedItems: [
          { id: "4003", itemType: 0, name: "Rough Bark", tag: "Bark", tier: 1 },
          { id: "4004", itemType: 0, name: "Tree Sap", tag: "Sap", tier: 1 },
        ],
        levelRequirements: [{ skill: { name: "Forestry" }, level: 1 }],
      }],
    },
    {
      item: { id: "5002", itemType: 0, name: "Rough Trunk Output", tag: "Trunk Output", tier: 1 },
      craftingRecipes: [{
        id: "split-trunk",
        name: "Split Rough Trunk",
        stationName: "Forestry Camp",
        craftedItemStacks: [{ item_id: "5002", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "5002", itemType: 0, name: "Rough Trunk Output", tag: "Trunk Output", tier: 1 }],
        consumedItemStacks: [{ item_id: "6002", item_type: "cargo", quantity: 1 }],
        consumedItems: [{ id: "6002", itemType: 1, name: "Rough Trunk", tag: "Trunk", tier: 1 }],
        levelRequirements: [{ skill: { name: "Forestry" }, level: 1 }],
      }],
      itemListPossibilities: [{
        targetId: "3002",
        targetItem: { id: "3002", itemType: 0, name: "Rough Resin", tag: "Resin", tier: 1 },
        quantity: 2,
        chance: 0.5,
        isCargo: false,
      }, {
        targetId: "4003",
        targetItem: { id: "4003", itemType: 0, name: "Rough Bark", tag: "Bark", tier: 1 },
        quantity: 1,
        chance: 1,
        isCargo: false,
      }],
    },
    { cargo: { id: "6002", itemType: 1, name: "Rough Trunk", tag: "Trunk", tier: 1 } },
  ]);

  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [
      { id: "3001", kind: "items", name: "Rough Gypsite", quantity: 4, itemType: 0 },
      { id: "3002", kind: "items", name: "Rough Resin", quantity: 3, itemType: 0 },
    ],
  });
  const { detailsByKey, warnings } = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({ config, detailsByKey, catalogWarnings: warnings });

  assert.equal(plan.steps.find((step) => step.output.name === "Rough Gypsite")?.selectedRecipeId, "possibility:gather-clay:items:3001");
  assert.equal(plan.steps.find((step) => step.output.name === "Rough Resin")?.selectedRecipeId, "possibility:split-trunk:items:3002");
  assert.equal(plan.materials.find((material) => material.name === "Rough Gypsite")?.sourceRoutes?.[0]?.routeType, "craft-byproduct");
  assert.equal(plan.materials.find((material) => material.name === "Rough Resin")?.sourceRoutes?.[0]?.routeType, "craft-byproduct");
  assert.equal(plan.materials.find((material) => material.name === "Rough Resin")?.sourceRoutes?.[0]?.gatheringSkill, null);
  assert.equal(plan.materials.some((material) => material.name === "Rough Brick"), false);
  assert.equal(plan.materials.some((material) => material.name === "Ancient Mortar"), false);
  assert.equal(plan.materials.some((material) => material.name === "Tree Sap"), false);
  assert.equal(plan.materials.find((material) => material.name === "Rough Clay Deposit")?.required, 16);
  assert.equal(plan.materials.find((material) => material.name === "Rough Trunk")?.required, 3);
});

test("collectLocalCatalogCraftPlanDetails treats recipe-less Sand and Clay Output producers as gathering routes", (t) => {
  const { repository } = createCatalogFixture(t);
  const gypsite = { id: "3001", itemType: 0, name: "Rough Gypsite", tag: "Gypsite", tier: 1 };
  upsertCatalogDetails(repository, [
    { item: gypsite, craftingRecipes: [{ id: "craft-gypsite", name: "Craft Rough Gypsite", craftedItemStacks: [{ item_id: gypsite.id, item_type: "item", quantity: 1 }], consumedItemStacks: [{ item_id: "4001", item_type: "item", quantity: 10 }], consumedItems: [{ id: "4001", itemType: 0, name: "Rough Brick", tag: "Brick", tier: 1 }], levelRequirements: [{ skill: { name: "Masonry" }, level: 1 }] }] },
    { item: { id: "5001", itemType: 0, name: "T1 Clay Output", tag: "Clay Output", tier: 1 }, craftingRecipes: [], itemListPossibilities: [{ targetId: gypsite.id, targetItem: gypsite, quantity: 0.02, chance: 1, guaranteedQuantity: 0 }] },
    { item: { id: "5002", itemType: 0, name: "T1 Sand Output", tag: "Sand Output", tier: 1 }, craftingRecipes: [], itemListPossibilities: [{ targetId: gypsite.id, targetItem: gypsite, quantity: 0.02, chance: 1, guaranteedQuantity: 0 }] },
  ]);
  const config = normalizeCraftPlanConfig({ enabled: true, targets: [{ ...gypsite, kind: "items", quantity: 4 }] });
  const { detailsByKey, warnings } = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({ config, detailsByKey, catalogWarnings: warnings });
  const route = plan.materials.find((material) => material.id === gypsite.id)?.sourceRoutes?.[0];
  assert.equal(route?.routeType, "gathering-byproduct");
  assert.equal(route?.recipeName, "Gather from Sand or Clay");
  assert.deepEqual(route?.gatheringSources.map((source) => source.label), ["Sand", "Clay"]);
  assert.equal(route?.gatheringSources.every((source) => source.expectedYield === 0.02), true);
  assert.deepEqual(route?.alternatives.map((alternative) => [
    alternative.id,
    alternative.gatheringSource?.label,
    alternative.routeType,
    alternative.expectedPerProgress,
    alternative.expectedPerResource,
    alternative.resourceHealth,
    alternative.actionsRequired,
  ]), [
    ["possibility:gathering-output:items:5001:items:3001", "Clay", "gathering-byproduct", 0.02, null, null, 1],
    ["possibility:gathering-output:items:5002:items:3001", "Sand", "gathering-byproduct", 0.02, null, null, 1],
    ["craft-gypsite", undefined, "craft", null, null, null, 1],
  ]);
  assert.equal(plan.materials.some((material) => material.name === "Rough Brick"), false);
});

test("collectLocalCatalogCraftPlanDetails reports missing local rows without inferring identity from names", (t) => {
  const { repository } = createCatalogFixture(t);
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "999999", kind: "items", name: "Peerless Mythril T6 Bar", quantity: 2, itemType: 0 }],
  });

  const { detailsByKey, warnings } = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const plan = computeCraftPlan({ config, detailsByKey, catalogWarnings: warnings });

  assert.equal(detailsByKey.has(recipeKey("items", "999999")), false);
  const material = plan.materials.find((item) => item.id === "999999");
  assert.equal(material?.name, "Peerless Mythril T6 Bar");
  assert.equal(material?.tag, null);
  assert.equal(material?.tier, null);
  assert.match(plan.warnings.join("\n"), /local catalog/i);
  assert.match(plan.warnings.join("\n"), /items:999999/);
});

test("collectLocalCatalogCraftPlanDetails reports incomplete byproduct producer recipes", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "8500", itemType: 0, name: "Rare Sap", tag: "Sap", tier: 2 },
      craftingRecipes: [{
        id: "craft-sap",
        name: "Craft Rare Sap",
        craftedItemStacks: [{ item_id: "8500", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8500", itemType: 0, name: "Rare Sap", tag: "Sap", tier: 2 }],
        consumedItemStacks: [{ item_id: "8501", item_type: "item", quantity: 10 }],
        consumedItems: [{ id: "8501", itemType: 0, name: "Sap Compound", tag: "Material", tier: 2 }],
        levelRequirements: [{ skill: { name: "Scholar" }, level: 1 }],
      }],
    },
    {
      item: { id: "8600", itemType: 0, name: "Tree Output", tag: "Tree Output", tier: 2 },
      craftingRecipes: [],
      itemListPossibilities: [{
        targetId: "8500",
        targetItem: { id: "8500", itemType: 0, name: "Rare Sap", tag: "Sap", tier: 2 },
        quantity: 1,
        chance: 0.1,
      }],
    },
  ]);
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "8500", kind: "items", name: "Rare Sap", quantity: 1, itemType: 0 }],
  });

  const { warnings } = collectLocalCatalogCraftPlanDetails(repository, config.targets, config.routeOverrides);
  const byproductWarnings = warnings.filter((warning) => /byproduct routes are incomplete/i.test(warning));
  assert.equal(byproductWarnings.length, 1);
  assert.match(byproductWarnings[0], /Rare Sap/);
  assert.match(byproductWarnings[0], /items:8500/);
});

test("collectLocalCatalogCraftPlanDetails ignores incomplete byproduct candidates when a usable producer exists", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "8700", itemType: 0, name: "Tree Resin", tag: "Resin", tier: 1 },
      craftingRecipes: [],
    },
    {
      item: { id: "8701", itemType: 0, name: "Incomplete Tree", tag: "Tree", tier: 1 },
      craftingRecipes: [],
      itemListPossibilities: [{ targetId: "8700", targetItem: { id: "8700", itemType: 0, name: "Tree Resin", tag: "Resin", tier: 1 }, quantity: 1, chance: 0.1 }],
    },
    {
      item: { id: "8702", itemType: 0, name: "Gatherable Tree", tag: "Tree", tier: 1 },
      craftingRecipes: [{
        id: "gather-tree",
        name: "Gather Tree",
        craftedItemStacks: [{ item_id: "8702", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8702", itemType: 0, name: "Gatherable Tree", tag: "Tree", tier: 1 }],
        consumedItemStacks: [],
        consumedItems: [],
        levelRequirements: [{ skill: { name: "Forestry" }, level: 1 }],
      }],
      itemListPossibilities: [{ targetId: "8700", targetItem: { id: "8700", itemType: 0, name: "Tree Resin", tag: "Resin", tier: 1 }, quantity: 1, chance: 0.1 }],
    },
  ]);

  const { warnings } = collectLocalCatalogCraftPlanDetails(repository, [{ id: "8700", kind: "items", name: "Tree Resin", quantity: 1, itemType: 0 }]);
  assert.equal(warnings.some((warning) => /byproduct routes are incomplete/i.test(warning)), false);
});

test("collectLocalCatalogCraftPlanDetails keeps transport routes available after real local routes and honors override ids", (t) => {
  const { db, repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [{
    item: { id: "8100", itemType: 0, name: "Treated Board", tag: "Board", tier: 3 },
    craftingRecipes: [
      {
        id: "transport-route",
        name: "A Trade Shipment",
        stationName: "Hauling Station",
        craftedItemStacks: [{ item_id: "8100", item_type: "item", quantity: 10 }],
        craftedItems: [{ id: "8100", itemType: 0, name: "Treated Board", tag: "Board", tier: 3 }],
        consumedItemStacks: [{ item_id: "8101", item_type: "cargo", quantity: 1 }],
        consumedItems: [{ id: "8101", itemType: 1, name: "Treated Board Shipment", tag: "Transport", tier: 3 }],
        levelRequirements: [{ skill: { name: "Construction" }, level: 1 }],
      },
      {
        id: "craft-route",
        name: "Z Saw Treated Board",
        stationName: "Carpentry Station",
        craftedItemStacks: [{ item_id: "8100", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8100", itemType: 0, name: "Treated Board", tag: "Board", tier: 3 }],
        consumedItemStacks: [{ item_id: "8102", item_type: "item", quantity: 2 }],
        consumedItems: [{ id: "8102", itemType: 0, name: "Raw Board", tag: "Board", tier: 3 }],
        levelRequirements: [{ skill: { name: "Carpentry" }, level: 30 }],
      },
    ],
  }]);
  repository.upsertEntityIdentity(
    { id: "8101", itemType: 1, name: "Treated Board Shipment", tag: "Transport", tier: 3 },
    { updatedAt: CATALOG_UPDATED_AT, kind: "cargo" },
  );
  repository.upsertEntityIdentity({ id: "8102", itemType: 0, name: "Raw Board", tag: "Board", tier: 3 }, { updatedAt: CATALOG_UPDATED_AT, kind: "items" });
  db.prepare("UPDATE game_catalog_recipes SET is_transport_route = 1 WHERE recipe_key = ?").run("items:8100:recipe:transport-route");

  const baseConfig = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "8100", kind: "items", name: "Treated Board", quantity: 10, itemType: 0 }],
  });
  const { detailsByKey } = collectLocalCatalogCraftPlanDetails(repository, baseConfig.targets, baseConfig.routeOverrides);
  const defaultPlan = computeCraftPlan({ config: baseConfig, detailsByKey });
  assert.equal(defaultPlan.steps[0].selectedRecipeId, "craft-route");
  assert.deepEqual(defaultPlan.steps[0].alternatives.map((recipe) => recipe.id), ["craft-route", "transport-route"]);
  assert.equal(defaultPlan.steps[0].alternatives.find((recipe) => recipe.id === "transport-route")?.isTransportRoute, true);

  const overrideConfig = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "8100", kind: "items", name: "Treated Board", quantity: 10, itemType: 0 }],
    routeOverrides: { [recipeKey("items", "8100")]: "transport-route" },
  });
  const overridePlan = computeCraftPlan({ config: overrideConfig, detailsByKey });
  assert.equal(overridePlan.steps[0].selectedRecipeId, "transport-route");
  assert.equal(overridePlan.materials.find((material) => material.name === "Treated Board Shipment")?.required, 1);
  assert.deepEqual(overridePlan.steps[0].alternatives.map((recipe) => recipe.id), ["craft-route", "transport-route"]);
});
test("collectLocalCatalogCraftPlanDetails uses recipe names as legacy route ids for hashed normalized recipes", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [{
    item: { id: "8200", itemType: 0, name: "Legacy Board", tag: "Board", tier: 2 },
    craftingRecipes: [
      {
        name: "A Legacy Board Route",
        stationName: "Carpentry Station",
        craftedItemStacks: [{ item_id: "8200", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8200", itemType: 0, name: "Legacy Board", tag: "Board", tier: 2 }],
        consumedItemStacks: [{ item_id: "8201", item_type: "item", quantity: 1 }],
        consumedItems: [{ id: "8201", itemType: 0, name: "A Route Input", tag: "Board", tier: 2 }],
        levelRequirements: [{ skill: { name: "Carpentry" }, level: 20 }],
      },
      {
        name: "Z Legacy Board Route",
        stationName: "Carpentry Station",
        craftedItemStacks: [{ item_id: "8200", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8200", itemType: 0, name: "Legacy Board", tag: "Board", tier: 2 }],
        consumedItemStacks: [{ item_id: "8202", item_type: "item", quantity: 2 }],
        consumedItems: [{ id: "8202", itemType: 0, name: "Z Route Input", tag: "Board", tier: 2 }],
        levelRequirements: [{ skill: { name: "Carpentry" }, level: 20 }],
      },
    ],
  }]);
  repository.upsertEntityIdentity({ id: "8201", itemType: 0, name: "A Route Input", tag: "Board", tier: 2 }, { updatedAt: CATALOG_UPDATED_AT, kind: "items" });
  repository.upsertEntityIdentity({ id: "8202", itemType: 0, name: "Z Route Input", tag: "Board", tier: 2 }, { updatedAt: CATALOG_UPDATED_AT, kind: "items" });

  const target = { id: "8200", kind: "items", name: "Legacy Board", quantity: 3, itemType: 0 };
  const { detailsByKey } = collectLocalCatalogCraftPlanDetails(repository, [target], {});
  const detail = detailsByKey.get(recipeKey("items", "8200"));
  const routeIds = detail.craftingRecipes.map((recipe) => recipe.id);
  assert.deepEqual(routeIds, ["A Legacy Board Route", "Z Legacy Board Route"]);

  const nameOverrideConfig = normalizeCraftPlanConfig({
    enabled: true,
    targets: [target],
    routeOverrides: { [recipeKey("items", "8200")]: "Z Legacy Board Route" },
  });
  const nameOverridePlan = computeCraftPlan({ config: nameOverrideConfig, detailsByKey });
  assert.equal(nameOverridePlan.steps[0].selectedRecipeId, "Z Legacy Board Route");
  assert.equal(nameOverridePlan.materials.find((material) => material.name === "Z Route Input")?.required, 6);

  const fullCatalogKey = repository.listProducerRecipesForOutput(recipeKey("items", "8200"))
    .find((recipe) => recipe.name === "Z Legacy Board Route")?.recipeKey;
  const keyOverrideConfig = normalizeCraftPlanConfig({
    enabled: true,
    targets: [target],
    routeOverrides: { [recipeKey("items", "8200")]: fullCatalogKey },
  });
  const keyOverridePlan = computeCraftPlan({ config: keyOverrideConfig, detailsByKey });
  assert.equal(keyOverridePlan.steps[0].selectedRecipeId, "Z Legacy Board Route");
});

test("collectLocalCatalogCraftPlanDetails loads only the selected producer route dependencies", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "8300", itemType: 0, name: "Routing Target", tag: "Tool", tier: 3 },
      craftingRecipes: [
        {
          id: "basic-route",
          name: "Basic Route",
          stationName: "Workshop",
          craftedItemStacks: [{ item_id: "8300", item_type: "item", quantity: 1 }],
          craftedItems: [{ id: "8300", itemType: 0, name: "Routing Target", tag: "Tool", tier: 3 }],
          consumedItemStacks: [{ item_id: "8301", item_type: "item", quantity: 1 }],
          consumedItems: [{ id: "8301", itemType: 0, name: "Basic Input", tag: "Part", tier: 3 }],
          levelRequirements: [{ skill: { name: "Smithing" }, level: 30 }],
        },
        {
          id: "deep-route",
          name: "Deep Route",
          stationName: "Workshop",
          craftedItemStacks: [{ item_id: "8300", item_type: "item", quantity: 1 }],
          craftedItems: [{ id: "8300", itemType: 0, name: "Routing Target", tag: "Tool", tier: 3 }],
          consumedItemStacks: [{ item_id: "8302", item_type: "item", quantity: 2 }],
          consumedItems: [{ id: "8302", itemType: 0, name: "Refined Input", tag: "Part", tier: 3 }],
          levelRequirements: [{ skill: { name: "Smithing" }, level: 30 }],
        },
      ],
    },
    {
      item: { id: "8301", itemType: 0, name: "Basic Input", tag: "Part", tier: 3 },
      craftingRecipes: [],
    },
    {
      item: { id: "8302", itemType: 0, name: "Refined Input", tag: "Part", tier: 3 },
      craftingRecipes: [{
        id: "refine-input",
        name: "Refine Input",
        stationName: "Smithing Station",
        craftedItemStacks: [{ item_id: "8302", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8302", itemType: 0, name: "Refined Input", tag: "Part", tier: 3 }],
        consumedItemStacks: [{ item_id: "8303", item_type: "item", quantity: 4 }],
        consumedItems: [{ id: "8303", itemType: 0, name: "Deep Ore", tag: "Ore", tier: 3 }],
        levelRequirements: [{ skill: { name: "Mining" }, level: 30 }],
      }],
    },
    {
      item: { id: "8303", itemType: 0, name: "Deep Ore", tag: "Ore", tier: 3 },
      craftingRecipes: [],
    },
  ]);

  const target = { id: "8300", kind: "items", name: "Routing Target", quantity: 2, itemType: 0 };
  const { detailsByKey } = collectLocalCatalogCraftPlanDetails(repository, [target], {});
  assert.equal(detailsByKey.has(recipeKey("items", "8301")), true);
  assert.equal(detailsByKey.has(recipeKey("items", "8302")), false);
  assert.equal(detailsByKey.has(recipeKey("items", "8303")), false);

  const overrideConfig = normalizeCraftPlanConfig({
    enabled: true,
    targets: [target],
    routeOverrides: { [recipeKey("items", "8300")]: "deep-route" },
  });
  const overrideDetails = collectLocalCatalogCraftPlanDetails(repository, [target], overrideConfig.routeOverrides).detailsByKey;
  const overridePlan = computeCraftPlan({ config: overrideConfig, detailsByKey: overrideDetails });
  assert.equal(overridePlan.steps[0].selectedRecipeId, "refine-input");
  assert.equal(overridePlan.steps[1].selectedRecipeId, "deep-route");
  assert.equal(overridePlan.materials.find((material) => material.name === "Deep Ore")?.required, 16);
});

test("collectLocalCatalogCraftPlanDetails does not report depth warnings for unused alternate branches", (t) => {
  const { repository } = createCatalogFixture(t);
  const details = [];
  for (let id = 9000; id <= 9020; id += 1) {
    const nextId = id + 1;
    details.push({
      item: { id: String(id), itemType: 0, name: `Branch ${id}`, tag: "Part", tier: 1 },
      craftingRecipes: id < 9020 ? [{
        id: `route-${id}`,
        name: `Route ${id}`,
        craftedItemStacks: [{ item_id: String(id), item_type: "item", quantity: 1 }],
        craftedItems: [{ id: String(id), itemType: 0, name: `Branch ${id}`, tag: "Part", tier: 1 }],
        consumedItemStacks: [{ item_id: String(nextId), item_type: "item", quantity: 1 }],
        consumedItems: [{ id: String(nextId), itemType: 0, name: `Branch ${nextId}`, tag: "Part", tier: 1 }],
      }] : [],
    });
  }
  details.unshift({
    item: { id: "8999", itemType: 0, name: "Target", tag: "Tool", tier: 1 },
    craftingRecipes: [{
      id: "short-route",
      name: "A Short Route",
      craftedItemStacks: [{ item_id: "8999", item_type: "item", quantity: 1 }],
      craftedItems: [{ id: "8999", itemType: 0, name: "Target", tag: "Tool", tier: 1 }],
      consumedItemStacks: [{ item_id: "9100", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "9100", itemType: 0, name: "Short Input", tag: "Part", tier: 1 }],
    }, {
      id: "deep-route",
      name: "Z Deep Route",
      craftedItemStacks: [{ item_id: "8999", item_type: "item", quantity: 1 }],
      craftedItems: [{ id: "8999", itemType: 0, name: "Target", tag: "Tool", tier: 1 }],
      consumedItemStacks: [{ item_id: "9000", item_type: "item", quantity: 1 }],
      consumedItems: [{ id: "9000", itemType: 0, name: "Branch 9000", tag: "Part", tier: 1 }],
    }],
  }, { item: { id: "9100", itemType: 0, name: "Short Input", tag: "Part", tier: 1 }, craftingRecipes: [] });
  upsertCatalogDetails(repository, details);

  const result = collectLocalCatalogCraftPlanDetails(repository, [{ id: "8999", kind: "items", name: "Target", quantity: 1, itemType: 0 }], {});
  assert.equal(result.detailsByKey.has(recipeKey("items", "9100")), true);
  assert.equal(result.detailsByKey.has(recipeKey("items", "9000")), false);
  assert.equal(result.warnings.some((warning) => /recursion limit/i.test(warning)), false);
});

test("collectLocalCatalogCraftPlanDetails queries shared completed subgraphs once", (t) => {
  const { repository } = createCatalogFixture(t);
  upsertCatalogDetails(repository, [
    {
      item: { id: "8400", itemType: 0, name: "Shared Target", tag: "Tool", tier: 4 },
      craftingRecipes: [{
        id: "shared-target-route",
        name: "Shared Target Route",
        stationName: "Workshop",
        craftedItemStacks: [{ item_id: "8400", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8400", itemType: 0, name: "Shared Target", tag: "Tool", tier: 4 }],
        consumedItemStacks: [
          { item_id: "8401", item_type: "item", quantity: 1 },
          { item_id: "8402", item_type: "item", quantity: 1 },
        ],
        consumedItems: [
          { id: "8401", itemType: 0, name: "Left Part", tag: "Part", tier: 4 },
          { id: "8402", itemType: 0, name: "Right Part", tag: "Part", tier: 4 },
        ],
        levelRequirements: [{ skill: { name: "Smithing" }, level: 40 }],
      }],
    },
    {
      item: { id: "8401", itemType: 0, name: "Left Part", tag: "Part", tier: 4 },
      craftingRecipes: [{
        id: "left-route",
        name: "Left Route",
        craftedItemStacks: [{ item_id: "8401", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8401", itemType: 0, name: "Left Part", tag: "Part", tier: 4 }],
        consumedItemStacks: [{ item_id: "8403", item_type: "item", quantity: 2 }],
        consumedItems: [{ id: "8403", itemType: 0, name: "Shared Core", tag: "Core", tier: 4 }],
      }],
    },
    {
      item: { id: "8402", itemType: 0, name: "Right Part", tag: "Part", tier: 4 },
      craftingRecipes: [{
        id: "right-route",
        name: "Right Route",
        craftedItemStacks: [{ item_id: "8402", item_type: "item", quantity: 1 }],
        craftedItems: [{ id: "8402", itemType: 0, name: "Right Part", tag: "Part", tier: 4 }],
        consumedItemStacks: [{ item_id: "8403", item_type: "item", quantity: 3 }],
        consumedItems: [{ id: "8403", itemType: 0, name: "Shared Core", tag: "Core", tier: 4 }],
      }],
    },
    {
      item: { id: "8403", itemType: 0, name: "Shared Core", tag: "Core", tier: 4 },
      craftingRecipes: [],
    },
  ]);

  const calls = new Map();
  const countedRepository = {
    getEntity: (...args) => repository.getEntity(...args),
    listByproductProducersForOutput: (...args) => repository.listByproductProducersForOutput(...args),
    listProducerRecipesForOutput: (key) => {
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return repository.listProducerRecipesForOutput(key);
    },
  };

  collectLocalCatalogCraftPlanDetails(countedRepository, [{ id: "8400", kind: "items", name: "Shared Target", quantity: 1, itemType: 0 }], {});

  assert.equal(calls.get(recipeKey("items", "8403")), 1);
});

test("computeCraftPlan reuses route viability across repeated target branches", () => {
  const depth = 36;
  const alternatives = 64;
  const detailsByKey = new Map();
  for (let level = 0; level <= depth; level += 1) {
    const id = String(20_000 + level);
    const nextId = String(20_000 + level + 1);
    detailsByKey.set(recipeKey("items", id), {
      item: { id, itemType: 0, name: `Part ${level}`, tag: "Part", tier: 7 },
      craftingRecipes: level === depth
        ? []
        : Array.from({ length: alternatives }, (_, routeIndex) => ({
            id: `route-${level}-${routeIndex}`,
            name: `Route ${level}-${routeIndex}`,
            craftedItemStacks: [{ item_id: id, item_type: "item", quantity: 1 }],
            craftedItems: [{ id, itemType: 0, name: `Part ${level}`, tag: "Part", tier: 7 }],
            consumedItemStacks: [{ item_id: nextId, item_type: "item", quantity: 1 }],
            consumedItems: [{ id: nextId, itemType: 0, name: `Part ${level + 1}`, tag: "Part", tier: 7 }],
          })),
    });
  }
  const targets = Array.from({ length: 50 }, () => ({
    id: "20000",
    kind: "items",
    itemType: 0,
    name: "Part 0",
    quantity: 1,
  }));

  class CountingMap extends Map {
    hits = 0;
    misses = 0;

    has(key) {
      const found = super.has(key);
      if (found) this.hits += 1;
      else this.misses += 1;
      return found;
    }
  }
  const routeViabilityMemo = new CountingMap();
  const plan = computeCraftPlan({
    config: normalizeCraftPlanConfig({ enabled: true, targets }),
    detailsByKey,
    routeViabilityMemo,
  });

  assert.equal(plan.materials.find((material) => material.key === "items:20015")?.required, 50);
  assert.ok(routeViabilityMemo.hits > routeViabilityMemo.misses, `expected shared route cache hits, received ${routeViabilityMemo.hits} hits and ${routeViabilityMemo.misses} misses`);
});
