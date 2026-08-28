import { createHash } from "node:crypto";

const TYPED_OUTPUT_KEY = /^(?:items|cargo):[^:\s]+$/;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function outputKey(route = {}) {
  const explicit = String(route?.output?.key ?? "").trim();
  if (TYPED_OUTPUT_KEY.test(explicit)) return explicit;
  const kind = String(route?.output?.kind ?? "").trim();
  const id = String(route?.output?.id ?? "").trim();
  const derived = `${kind}:${id}`;
  return TYPED_OUTPUT_KEY.test(derived) ? derived : "";
}

function inputIdentity(input = {}) {
  const explicit = String(input.key ?? "").trim();
  if (TYPED_OUTPUT_KEY.test(explicit)) return explicit;
  const derived = `${String(input.kind ?? "").trim()}:${String(input.id ?? "").trim()}`;
  return TYPED_OUTPUT_KEY.test(derived) ? derived : "";
}

function normalizedAlternative(alternative = {}) {
  return {
    id: String(alternative.id ?? "").trim(),
    label: String(alternative.label ?? alternative.recipeName ?? alternative.id ?? "").trim(),
    routeType: String(alternative.routeType ?? "craft"),
    probabilityStatus: String(alternative.probabilityStatus ?? (alternative.isProbabilistic ? "expected" : "guaranteed")),
    isProbabilistic: alternative.isProbabilistic === true,
    isTransportRoute: alternative.isTransportRoute === true,
    buildingName: alternative.buildingName == null ? null : String(alternative.buildingName),
    expectedYield: alternative.expectedYield == null ? null : Number(alternative.expectedYield),
    guaranteedYield: alternative.guaranteedYield == null ? null : Number(alternative.guaranteedYield),
    actionsRequired: alternative.actionsRequired == null ? null : Number(alternative.actionsRequired),
    inputs: (Array.isArray(alternative.inputs) ? alternative.inputs : [])
      .map((input) => ({ key: inputIdentity(input), quantity: Number(input.quantity ?? 0) }))
      .filter((input) => input.key)
      .sort((left, right) => left.key.localeCompare(right.key) || left.quantity - right.quantity),
  };
}

function validProductionAlternatives(route = {}) {
  return (Array.isArray(route.alternatives) ? route.alternatives : [])
    .map(normalizedAlternative)
    .filter((alternative) => alternative.id && !alternative.isTransportRoute && alternative.probabilityStatus !== "unavailable")
    .sort((left, right) => left.id.localeCompare(right.id));
}

function safestAlternative(alternatives) {
  return [...alternatives].sort((left, right) => {
    const leftRisk = left.probabilityStatus === "guaranteed" && !left.isProbabilistic ? 0 : 1;
    const rightRisk = right.probabilityStatus === "guaranteed" && !right.isProbabilistic ? 0 : 1;
    return leftRisk - rightRisk || left.id.localeCompare(right.id);
  })[0] ?? null;
}

export function routeReviewFingerprint(route = {}) {
  const alternatives = validProductionAlternatives(route).map(({ label: _displayLabel, ...materialSignature }) => materialSignature);
  return fingerprint({ outputKey: outputKey(route), alternatives });
}

function routeReview(route) {
  const key = outputKey(route);
  if (!key) return null;
  const alternatives = validProductionAlternatives(route);
  const safest = safestAlternative(alternatives);
  return {
    outputKey: key,
    selectedRouteId: String(route.selectedRecipeId ?? "").trim() || null,
    preselectedRouteId: safest?.id ?? null,
    ambiguous: alternatives.length > 1,
    alternatives,
    fingerprint: routeReviewFingerprint(route),
  };
}

function planRoutes(plan = {}) {
  return [
    ...(Array.isArray(plan.steps) ? plan.steps : []),
    ...(Array.isArray(plan.materials)
      ? plan.materials.flatMap((material) => Array.isArray(material?.sourceRoutes) ? material.sourceRoutes : [])
      : []),
  ];
}

function materialImpact(material = {}) {
  return {
    key: String(material.key ?? ""),
    kind: String(material.kind ?? ""),
    id: String(material.id ?? ""),
    planRequired: Number(material.planRequired ?? 0),
    requiredNow: Number(material.requiredNow ?? material.required ?? 0),
    missingNow: Number(material.missingNow ?? material.missing ?? 0),
    required: Number(material.required ?? material.requiredNow ?? 0),
    missing: Number(material.missing ?? material.missingNow ?? 0),
  };
}

export function buildCraftPlanPreview({
  plan = {},
  scope,
  configurationRevision,
  baselineRevision,
  validation = { valid: true, errors: [] },
} = {}) {
  const materials = (Array.isArray(plan.materials) ? plan.materials : [])
    .map(materialImpact)
    .sort((left, right) => left.key.localeCompare(right.key));
  const byOutput = new Map();
  for (const route of planRoutes(plan)) {
    const review = routeReview(route);
    if (review && !byOutput.has(review.outputKey)) byOutput.set(review.outputKey, review);
  }
  const routeReviews = [...byOutput.values()].sort((left, right) => left.outputKey.localeCompare(right.outputKey));
  const preview = {
    scope: String(scope ?? ""),
    materials,
    routeReviews,
    validation,
    baselineRevision: String(baselineRevision ?? ""),
    configurationRevision: Number(configurationRevision),
  };
  return { ...preview, fingerprint: fingerprint(preview) };
}

function parsedReview(row) {
  return {
    planId: String(row.plan_id),
    outputKey: String(row.output_key),
    fingerprint: String(row.signature_fingerprint),
    selectedRouteId: String(row.selected_route_id),
    confirmedFingerprint: row.confirmed_fingerprint == null ? null : String(row.confirmed_fingerprint),
    reviewer: {
      type: String(row.reviewer_type),
      id: row.reviewer_id == null ? null : String(row.reviewer_id),
      displayName: String(row.reviewer_display_name),
    },
    reviewedAt: String(row.reviewed_at),
    configurationRevision: Number(row.configuration_revision),
  };
}

function matchingConfirmation(routeReview, confirmation) {
  const selectedRouteId = String(confirmation?.selectedRouteId ?? "").trim();
  return confirmation
    && String(confirmation.outputKey ?? "") === routeReview.outputKey
    && String(confirmation.fingerprint ?? "") === routeReview.fingerprint
    && routeReview.alternatives.some((alternative) => alternative.id === selectedRouteId);
}

export function createCraftPlanRouteReviewRepository(db, { statements, now = () => new Date().toISOString() } = {}) {
  if (!db || !statements) throw new Error("Craft Plan route review requires a database and prepared statements.");
  const listForPlan = (planId) => statements.listCraftPlanRouteReviews.all(String(planId)).map(parsedReview);
  const previewState = (planId, routeReviews = [], confirmations = []) => {
    const normalizedRoutes = [...routeReviews].sort((left, right) => left.outputKey.localeCompare(right.outputKey));
    const stored = new Map(listForPlan(planId).map((entry) => [entry.outputKey, entry]));
    const submitted = new Map(confirmations.map((entry) => [String(entry?.outputKey ?? ""), entry]));
    const confirmed = [];
    const unconfirmed = [];
    for (const route of normalizedRoutes) {
      const current = stored.get(route.outputKey);
      const submission = submitted.get(route.outputKey);
      const storedCurrent = current
        && current.confirmedFingerprint
        && current.confirmedFingerprint === route.fingerprint
        && current.fingerprint === route.fingerprint
        && route.alternatives.some((alternative) => alternative.id === current.selectedRouteId);
      if (storedCurrent || matchingConfirmation(route, submission)) confirmed.push(route);
      else if (route.ambiguous) unconfirmed.push(route);
    }
    return { routeReviews: normalizedRoutes, confirmed, unconfirmed };
  };
  return {
    listForPlan,
    previewState,
    reconcile({ planId, configurationRevision, routeReviews = [], confirmations = [], reviewer = {}, reviewedAt = now() }) {
      const state = previewState(planId, routeReviews, confirmations);
      const currentByKey = new Map(state.routeReviews.map((entry) => [entry.outputKey, entry]));
      for (const stored of listForPlan(planId)) {
        const current = currentByKey.get(stored.outputKey);
        if (!current || current.fingerprint !== stored.fingerprint || stored.confirmedFingerprint !== stored.fingerprint) {
          statements.deleteCraftPlanRouteReview.run(String(planId), stored.outputKey);
        }
      }
      for (const confirmation of confirmations) {
        const route = currentByKey.get(String(confirmation?.outputKey ?? ""));
        if (!route || !matchingConfirmation(route, confirmation)) continue;
        statements.upsertCraftPlanRouteReview.run(
          String(planId),
          route.outputKey,
          route.fingerprint,
          String(confirmation.selectedRouteId),
          route.fingerprint,
          String(reviewer.type ?? "system"),
          reviewer.id == null ? null : String(reviewer.id),
          String(reviewer.displayName ?? "system"),
          String(reviewedAt),
          Number(configurationRevision),
        );
      }
      return previewState(planId, routeReviews, []);
    },
  };
}
