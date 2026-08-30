import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCraftPlanPreview,
  craftPlanRouteFallbackAllowed,
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

  assert.equal(craftPlanRouteFallbackAllowed(authorizedDraft, stored), true);
  assert.equal(craftPlanRouteFallbackAllowed(changedTarget, stored), false);
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
