import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCraftPlanRouteEvidence,
  buildCraftPlanPreview,
  craftPlanRouteFallbackAllowed,
  retainCraftPlanRouteInventoryForEquivalentOverrides,
  routeReviewFingerprint,
  selectCraftPlanRouteInventory,
} from "../src/server/craftPlanRouteReview.mjs";
import { compactCraftPlanEffortInput } from "../src/server/craftPlanEffortProgress.mjs";
import * as craftPlanRouteReview from "../src/server/craftPlanRouteReview.mjs";

function route(outputKey, selectedRecipeId, alternatives) {
  const [kind, id] = outputKey.split(":");
  return {
    output: { key: outputKey, kind, id },
    selectedRecipeId,
    alternatives,
  };
}

const productionAlternatives = [
  {
    id: "risky",
    label: "Risky forge",
    routeType: "craft",
    probabilityStatus: "expected",
    isProbabilistic: true,
    isTransportRoute: false,
    inputs: [{ key: "items:2", kind: "items", id: "2", quantity: 3 }],
  },
  {
    id: "safe",
    label: "Safe forge",
    routeType: "craft",
    probabilityStatus: "guaranteed",
    isProbabilistic: false,
    isTransportRoute: false,
    inputs: [{ key: "cargo:2", kind: "cargo", id: "2", quantity: 2 }],
  },
  {
    id: "unpack",
    label: "Unpack crate",
    routeType: "craft",
    probabilityStatus: "guaranteed",
    isProbabilistic: false,
    isTransportRoute: true,
    inputs: [{ key: "cargo:99", kind: "cargo", id: "99", quantity: 1 }],
  },
];

test("route evidence keeps material source reviews from the calculated Rough Plank plan", () => {
  const plan = {
    steps: [],
    materials: [{
      key: "items:1020003",
      kind: "items",
      id: "1020003",
      sourceRoutes: [route("items:1020003", "1014176789", [
        { id: "1014176789", label: "Saw Rough Plank", isTransportRoute: false },
        { id: "102009", label: "Carve Rough Plank", isTransportRoute: false },
        { id: "transport", label: "Move Rough Plank", isTransportRoute: true },
      ])],
    }],
  };

  const evidence = buildCraftPlanRouteEvidence({ plan });
  assert.deepEqual(evidence.routeInventory.map(({ outputKey }) => outputKey), ["items:1020003"]);
  assert.deepEqual(evidence.routeInventory[0].alternatives.map(({ id }) => id), ["1014176789", "102009"]);
  assert.deepEqual(evidence.diagnostics, {
    steps: 0,
    materialSourceRoutes: 1,
    directInventory: 0,
    returnedReviews: 1,
    fallbackReturnedReviews: 0,
  });
});

test("settlement preview returns stable material impact, ambiguity, revisions, validation, and fingerprint", () => {
  const plan = {
    materials: [{
      key: "items:7", kind: "items", id: "7",
      planRequired: 12, requiredNow: 8, missingNow: 5, required: 8, missing: 5,
      sourceRoutes: [route("items:7", "safe", productionAlternatives)],
    }],
    steps: [],
  };

  const first = buildCraftPlanPreview({
    plan,
    scope: "shared",
    configurationRevision: 4,
    baselineRevision: "baseline-a",
    validation: { valid: true, errors: [] },
  });
  const second = buildCraftPlanPreview({
    plan: structuredClone(plan),
    scope: "shared",
    configurationRevision: 4,
    baselineRevision: "baseline-a",
    validation: { errors: [], valid: true },
  });

  assert.deepEqual(first.materials, [{
    key: "items:7", kind: "items", id: "7",
    planRequired: 12, requiredNow: 8, missingNow: 5, required: 8, missing: 5,
  }]);
  assert.equal(first.scope, "shared");
  assert.equal(first.configurationRevision, 4);
  assert.equal(first.baselineRevision, "baseline-a");
  assert.deepEqual(first.validation, { valid: true, errors: [] });
  assert.equal(first.routeReviews[0].ambiguous, true);
  assert.equal(first.routeReviews[0].preselectedRouteId, "safe");
  assert.deepEqual(first.routeReviews[0].alternatives.map(({ id }) => id), ["risky", "safe"]);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.fingerprint, second.fingerprint);
});

test("preview keeps every baseline dependency route when live stock suppresses route expansion", () => {
  assert.equal(typeof craftPlanRouteReview.buildCraftPlanRouteInventory, "function");
  const baselinePlan = {
    materials: [{
      key: "items:42",
      kind: "items",
      id: "42",
      name: "Fine Plank",
      sourceRoutes: [route("items:42", "sawmill", [
        { id: "sawmill", label: "Saw Fine Plank", probabilityStatus: "guaranteed", inputs: [{ key: "items:2", name: "Rough Plank", quantity: 3 }] },
        { id: "carving", label: "Carve Fine Plank", probabilityStatus: "guaranteed", inputs: [{ key: "items:3", quantity: 2 }] },
      ])],
    }],
    steps: [],
  };
  baselinePlan.materials[0].sourceRoutes[0].output.name = "Fine Plank";
  const routeInventory = craftPlanRouteReview.buildCraftPlanRouteInventory(baselinePlan);

  const preview = buildCraftPlanPreview({
    plan: {
      materials: [{ key: "items:42", kind: "items", id: "42", name: "Fine Plank", planRequired: 12, requiredNow: 0, missingNow: 0 }],
      steps: [],
    },
    routeInventory,
    scope: "shared",
    configurationRevision: 5,
    baselineRevision: "baseline-stock-covered",
  });

  assert.deepEqual(preview.routeReviews.map(({ outputKey, outputName, ambiguous }) => ({ outputKey, outputName, ambiguous })), [
    { outputKey: "items:42", outputName: "Fine Plank", ambiguous: true },
  ]);
  assert.deepEqual(preview.routeReviews[0].alternatives.map(({ id }) => id), ["carving", "sawmill"]);
  assert.deepEqual(preview.routeReviews[0].alternatives.find(({ id }) => id === "sawmill").inputs, [
    { key: "items:2", name: "Rough Plank", quantity: 3 },
  ]);
});

test("the compact zero-stock baseline retains root and nested dependency routes", () => {
  const root = route("items:700", "assemble", [
    { id: "assemble", label: "Assemble T7 Codex", probabilityStatus: "guaranteed", inputs: [{ key: "items:701", name: "T7 Binding", quantity: 2 }] },
  ]);
  root.output.name = "T7 Codex";
  const nested = route("items:701", "bind", [
    { id: "bind", label: "Bind T7 Codex", probabilityStatus: "guaranteed", inputs: [{ key: "items:702", name: "T7 Parchment", quantity: 4 }] },
    { id: "weave", label: "Weave T7 Binding", probabilityStatus: "guaranteed", inputs: [{ key: "items:703", name: "T7 Thread", quantity: 3 }] },
  ]);
  nested.output.name = "T7 Binding";
  const baselinePlan = {
    steps: [root],
    materials: [{ key: "items:701", sourceRoutes: [nested] }],
  };

  const routeInventory = craftPlanRouteReview.buildCraftPlanRouteInventory(baselinePlan);
  const compact = compactCraftPlanEffortInput(baselinePlan, { routeInventory });
  const preview = buildCraftPlanPreview({ plan: { materials: [], steps: [] }, routeInventory: compact.routeInventory });

  assert.deepEqual(preview.routeReviews.map(({ outputKey }) => outputKey), ["items:700", "items:701"]);
  assert.equal(preview.routeReviews[1].ambiguous, true);
});

test("an unchanged preview can retain selectable routes from last-good plan evidence", () => {
  const lastGoodRoute = route("items:42", "sawmill", [
    { id: "sawmill", label: "Saw Fine Plank", probabilityStatus: "guaranteed", inputs: [{ key: "items:2", quantity: 3 }] },
    { id: "carving", label: "Carve Fine Plank", probabilityStatus: "guaranteed", inputs: [{ key: "items:3", quantity: 2 }] },
  ]);
  lastGoodRoute.output.name = "Fine Plank";

  const retained = selectCraftPlanRouteInventory({
    plan: { materials: [{ key: "items:42", planRequired: 12 }], steps: [] },
    fallbackPlan: { materials: [{ key: "items:42", sourceRoutes: [lastGoodRoute] }], steps: [] },
    allowFallback: true,
  });
  const changedDraft = selectCraftPlanRouteInventory({
    plan: { materials: [{ key: "items:42", planRequired: 24 }], steps: [] },
    fallbackPlan: { materials: [{ key: "items:42", sourceRoutes: [lastGoodRoute] }], steps: [] },
    allowFallback: false,
  });

  assert.equal(retained.evidence, "last_good");
  assert.deepEqual(retained.routeInventory.map(({ outputKey }) => outputKey), ["items:42"]);
  assert.equal(changedDraft.evidence, "current");
  assert.deepEqual(changedDraft.routeInventory, []);
});

test("route fallback ignores presentation names but rejects calculation changes", () => {
  const stored = {
    enabled: true,
    name: "QA T7 plan",
    targets: [{ kind: "items", id: "42", quantity: 30 }],
    sourceRules: { storageContainerIds: ["storage-a"] },
    routeOverrides: {},
  };
  const authorizedDraft = structuredClone(stored);
  delete authorizedDraft.name;
  const changedTarget = structuredClone(authorizedDraft);
  changedTarget.targets[0].quantity = 31;
  const changedRoute = structuredClone(authorizedDraft);
  changedRoute.routeOverrides["items:42"] = "carving";

  assert.equal(craftPlanRouteFallbackAllowed(authorizedDraft, stored), true);
  assert.equal(craftPlanRouteFallbackAllowed(changedRoute, stored), false);
  assert.equal(craftPlanRouteFallbackAllowed(changedTarget, stored), false);
});

test("retained route evidence accepts only graph-equivalent route overrides", () => {
  const storedConfig = {
    enabled: true,
    targets: [{ kind: "cargo", id: "1003", quantity: 10 }],
    sourceRules: {},
    routeOverrides: { "cargo:1003": "extraction:1660372877" },
  };
  const routeInventory = [{
    outputKey: "cargo:1003",
    selectedRouteId: "extraction:1660372877",
    fingerprint: "fine-trunk-routes",
    alternatives: [
      { id: "extraction:1660372877", routeType: "gathering", expectedPerProgress: 0.0103, isSelectable: true, inputs: [] },
      { id: "possibility:extraction:26:cargo:1003", routeType: "gathering-byproduct", expectedPerProgress: 0.0077, isSelectable: true, inputs: [] },
      { id: "craft:milled-trunk", routeType: "craft", expectedPerCraft: 1, isSelectable: true, inputs: [{ key: "items:42", quantity: 2 }] },
    ],
  }];
  const equivalentDraft = structuredClone(storedConfig);
  equivalentDraft.routeOverrides["cargo:1003"] = "possibility:extraction:26:cargo:1003";
  const changedGraphDraft = structuredClone(storedConfig);
  changedGraphDraft.routeOverrides["cargo:1003"] = "craft:milled-trunk";
  const changedTargetDraft = structuredClone(equivalentDraft);
  changedTargetDraft.targets[0].quantity = 11;

  const retained = retainCraftPlanRouteInventoryForEquivalentOverrides({
    stagedConfig: equivalentDraft,
    storedConfig,
    routeInventory,
  });
  assert.equal(retained?.routeInventory[0].selectedRouteId, "possibility:extraction:26:cargo:1003");
  assert.deepEqual(retained?.changedOutputKeys, ["cargo:1003"]);
  assert.equal(retainCraftPlanRouteInventoryForEquivalentOverrides({ stagedConfig: changedGraphDraft, storedConfig, routeInventory }), null);
  assert.equal(retainCraftPlanRouteInventoryForEquivalentOverrides({ stagedConfig: changedTargetDraft, storedConfig, routeInventory }), null);
});

test("same-input craft routes with different calculation semantics reject retained fallback", () => {
  const storedConfig = {
    enabled: true,
    targets: [{ kind: "items", id: "1", quantity: 1 }],
    routeOverrides: { "items:1": "old-craft" },
  };
  const stagedConfig = structuredClone(storedConfig);
  stagedConfig.routeOverrides["items:1"] = "new-craft";
  const routeInventory = [{
    outputKey: "items:1",
    selectedRouteId: "old-craft",
    alternatives: [
      { id: "old-craft", routeType: "craft", expectedPerCraft: 1, probabilityStatus: "guaranteed", inputs: [{ key: "items:2", quantity: 1 }] },
      { id: "new-craft", routeType: "craft", expectedPerCraft: 2, probabilityStatus: "guaranteed", inputs: [{ key: "items:2", quantity: 1 }] },
    ],
  }];

  assert.equal(retainCraftPlanRouteInventoryForEquivalentOverrides({ stagedConfig, storedConfig, routeInventory }), null);
});

test("normalized route inventory rejects a producer-only route change", () => {
  const storedConfig = {
    enabled: true,
    targets: [{ kind: "items", id: "1", quantity: 1 }],
    routeOverrides: { "items:1": "old-craft" },
  };
  const stagedConfig = structuredClone(storedConfig);
  stagedConfig.routeOverrides["items:1"] = "new-craft";
  const routeInventory = [{
    outputKey: "items:1",
    selectedRouteId: "old-craft",
    alternatives: [
      { id: "old-craft", routeType: "craft", expectedPerCraft: 1, producer: "items:20", inputs: [{ key: "items:2", quantity: 1 }] },
      { id: "new-craft", routeType: "craft", expectedPerCraft: 1, producer: "items:21", inputs: [{ key: "items:2", quantity: 1 }] },
    ],
  }];

  assert.equal(retainCraftPlanRouteInventoryForEquivalentOverrides({ stagedConfig, storedConfig, routeInventory }), null);
});

test("one graph-changing override rejects a multi-route retained fallback", () => {
  const storedConfig = {
    enabled: true,
    targets: [{ kind: "items", id: "1", quantity: 1 }],
    routeOverrides: { "items:1": "old-a", "items:2": "old-b" },
  };
  const stagedConfig = structuredClone(storedConfig);
  stagedConfig.routeOverrides = { "items:1": "new-a", "items:2": "new-b" };
  const routeInventory = [
    { outputKey: "items:1", selectedRouteId: "old-a", alternatives: [{ id: "old-a", inputs: [] }, { id: "new-a", inputs: [] }] },
    { outputKey: "items:2", selectedRouteId: "old-b", alternatives: [{ id: "old-b", inputs: [{ key: "items:3", quantity: 1 }] }, { id: "new-b", inputs: [{ key: "items:4", quantity: 1 }] }] },
  ];

  assert.equal(retainCraftPlanRouteInventoryForEquivalentOverrides({ stagedConfig, storedConfig, routeInventory }), null);
});

test("selectable routes remain reviewable when probability evidence is unavailable", () => {
  const uncertain = route("items:42", "sawmill", [{
    id: "sawmill",
    label: "Saw Fine Plank",
    probabilityStatus: "unavailable",
    isProbabilistic: true,
    isSelectable: true,
    isTransportRoute: false,
    inputs: [{ key: "items:2", quantity: 3 }],
  }]);

  const preview = buildCraftPlanPreview({ plan: { materials: [], steps: [uncertain] } });

  assert.equal(preview.routeReviews.length, 1);
  assert.equal(preview.routeReviews[0].selectedRouteId, "sawmill");
  assert.equal(preview.routeReviews[0].alternatives[0].probabilityStatus, "unavailable");
});

test("unexpandable production routes remain visible without requiring an impossible confirmation", () => {
  const blocked = route("items:42", "sawmill", [
    {
      id: "sawmill",
      label: "Saw Fine Plank",
      isSelectable: false,
      isTransportRoute: false,
      inputs: [{ key: "items:2", quantity: 3 }],
    },
    {
      id: "unpack",
      label: "Unpack Fine Plank",
      isSelectable: false,
      isTransportRoute: true,
      inputs: [{ key: "cargo:2", quantity: 1 }],
    },
  ]);

  const preview = buildCraftPlanPreview({ plan: { materials: [], steps: [blocked] } });

  assert.equal(preview.routeReviews.length, 1);
  assert.equal(preview.routeReviews[0].alternatives.length, 1);
  assert.equal(preview.routeReviews[0].alternatives[0].isSelectable, false);
  assert.equal(preview.routeReviews[0].ambiguous, false);
  assert.equal(preview.routeReviews[0].preselectedRouteId, null);
});

test("route review keeps the calculated renewable route when guaranteed alternatives are equally safe", () => {
  const plan = {
    materials: [],
    steps: [route("items:300", "210007", [
      { id: "210006", label: "Upgrade lower-tier plants", probabilityStatus: "guaranteed", isProbabilistic: false, inputs: [{ key: "items:299", quantity: 5 }] },
      { id: "210007", label: "Grow from renewable seed", probabilityStatus: "guaranteed", isProbabilistic: false, inputs: [{ key: "items:301", quantity: 1 }] },
    ])],
  };

  const preview = buildCraftPlanPreview({ plan, scope: "shared", configurationRevision: 1 });

  assert.equal(preview.routeReviews[0].selectedRouteId, "210007");
  assert.equal(preview.routeReviews[0].preselectedRouteId, "210007");
});

test("personal preview keeps exact item and cargo identities distinct in route signatures", () => {
  const itemRoute = route("items:7", "safe", productionAlternatives);
  const cargoRoute = route("cargo:7", "safe", productionAlternatives);
  const plan = {
    materials: [
      { key: "items:7", kind: "items", id: "7", planRequired: 2, requiredNow: 2, missingNow: 2, required: 2, missing: 2, sourceRoutes: [itemRoute] },
      { key: "cargo:7", kind: "cargo", id: "7", planRequired: 3, requiredNow: 3, missingNow: 1, required: 3, missing: 1, sourceRoutes: [cargoRoute] },
    ],
    steps: [],
  };
  const preview = buildCraftPlanPreview({
    plan,
    scope: "personal",
    configurationRevision: 9,
    baselineRevision: "personal-baseline",
    validation: { valid: false, errors: [{ code: "source_unavailable" }] },
  });

  assert.deepEqual(preview.routeReviews.map(({ outputKey }) => outputKey), ["cargo:7", "items:7"]);
  assert.notEqual(preview.routeReviews[0].fingerprint, preview.routeReviews[1].fingerprint);
  assert.notEqual(routeReviewFingerprint(itemRoute), routeReviewFingerprint(cargoRoute));
  assert.equal(preview.scope, "personal");
  assert.equal(preview.validation.valid, false);
});

test("route-review fingerprints ignore display-only labels but detect material recipe changes", () => {
  const original = route("items:7", "safe", productionAlternatives);
  const renamed = structuredClone(original);
  renamed.alternatives.forEach((alternative) => { alternative.label = `Renamed ${alternative.id}`; });
  const changedInput = structuredClone(original);
  changedInput.alternatives[0].inputs[0].quantity += 1;

  assert.equal(routeReviewFingerprint(original), routeReviewFingerprint(renamed));
  assert.notEqual(routeReviewFingerprint(original), routeReviewFingerprint(changedInput));
});

test("route-review fingerprints cover calculation semantics while ignoring display metadata", () => {
  const materialAlternative = {
    id: "gather-route",
    label: "Gather original label",
    buildingName: "Original building",
    routeType: "gathering",
    gatheringMode: "ordinary",
    gatheringSkill: "Mining",
    producer: { key: "items:20", kind: "items", id: "20", name: "Display producer" },
    producerRecipe: { id: "producer-route", name: "Display recipe", buildingName: "Display station", skillName: "Mining" },
    probabilityStatus: "expected",
    isProbabilistic: true,
    isTransportRoute: false,
    expectedYield: 2,
    yieldBasis: "per_progress",
    expectedPerCraft: null,
    expectedPerProgress: 2,
    expectedPerResource: 20,
    resourceHealth: 10,
    actionsRequired: 3,
    dropChance: 0.5,
    dropQuantity: 4,
    guaranteedYield: 1,
    gatheringSource: { tag: "Ore", label: "Display source", skill: "Mining" },
    inputs: [{ key: "items:2", kind: "items", id: "2", quantity: 3 }],
  };
  const original = route("items:7", "gather-route", [materialAlternative]);
  assert.deepEqual(
    craftPlanRouteReview.buildCraftPlanRouteInventory({ steps: [original], materials: [] })[0].alternatives[0].gatheringSource,
    { tag: "Ore", label: "Display source", skill: "Mining" },
  );
  const renamed = structuredClone(original);
  Object.assign(renamed.alternatives[0], { label: "Renamed label", buildingName: "Renamed building" });
  Object.assign(renamed.alternatives[0].producer, { name: "Renamed producer" });
  Object.assign(renamed.alternatives[0].producerRecipe, { name: "Renamed recipe", buildingName: "Renamed station" });
  Object.assign(renamed.alternatives[0].gatheringSource, { label: "Renamed source" });
  assert.equal(routeReviewFingerprint(original), routeReviewFingerprint(renamed));

  const mutations = {
    gatheringMode: (value) => { value.gatheringMode = "prospecting"; },
    gatheringSkill: (value) => { value.gatheringSkill = "Forestry"; },
    producer: (value) => { value.producer.id = "21"; value.producer.key = "items:21"; },
    producerRecipe: (value) => { value.producerRecipe.id = "other-producer-route"; },
    producerSkill: (value) => { value.producerRecipe.skillName = "Forestry"; },
    yieldBasis: (value) => { value.yieldBasis = "per_craft"; },
    expectedPerCraft: (value) => { value.expectedPerCraft = 2; },
    expectedPerProgress: (value) => { value.expectedPerProgress = 3; },
    expectedPerResource: (value) => { value.expectedPerResource = 30; },
    resourceHealth: (value) => { value.resourceHealth = 15; },
    dropChance: (value) => { value.dropChance = 0.25; },
    dropQuantity: (value) => { value.dropQuantity = 8; },
    gatheringSourceTag: (value) => { value.gatheringSource.tag = "Tree"; },
    gatheringSourceSkill: (value) => { value.gatheringSource.skill = "Forestry"; },
  };
  const unchanged = [];
  for (const [field, mutate] of Object.entries(mutations)) {
    const changed = structuredClone(original);
    mutate(changed.alternatives[0]);
    if (routeReviewFingerprint(original) === routeReviewFingerprint(changed)) unchanged.push(field);
  }
  assert.deepEqual(unchanged, []);
});
