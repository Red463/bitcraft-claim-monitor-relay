import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCraftPlanPreview,
  routeReviewFingerprint,
} from "../src/server/craftPlanRouteReview.mjs";

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
