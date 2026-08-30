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

function nullableNumber(value) {
  return value == null ? null : Number(value);
}

function normalizedProducer(producer = null) {
  const key = inputIdentity(producer ?? {});
  return key || null;
}

function normalizedProducerRecipe(recipe = null) {
  if (!recipe || typeof recipe !== "object") return null;
  const id = String(recipe.id ?? "").trim();
  return id ? {
    id,
    skillName: recipe.skillName == null ? null : String(recipe.skillName),
  } : null;
}

function normalizedGatheringSource(source = null) {
  if (!source || typeof source !== "object") return null;
  const tag = source.tag == null ? null : String(source.tag);
  const label = source.label == null ? null : String(source.label);
  const skill = source.skill == null ? null : String(source.skill);
  return tag || label || skill ? { tag, label, skill } : null;
}

function normalizedAlternative(alternative = {}) {
  return {
    id: String(alternative.id ?? "").trim(),
    label: String(alternative.label ?? alternative.recipeName ?? alternative.id ?? "").trim(),
    routeType: String(alternative.routeType ?? "craft"),
    gatheringMode: alternative.gatheringMode == null ? null : String(alternative.gatheringMode),
    gatheringSkill: alternative.gatheringSkill == null ? null : String(alternative.gatheringSkill),
    producer: normalizedProducer(alternative.producer),
    producerRecipe: normalizedProducerRecipe(alternative.producerRecipe),
    probabilityStatus: String(alternative.probabilityStatus ?? (alternative.isProbabilistic ? "expected" : "guaranteed")),
    isProbabilistic: alternative.isProbabilistic === true,
    isTransportRoute: alternative.isTransportRoute === true,
    isSelectable: alternative.isSelectable !== false,
    buildingName: alternative.buildingName == null ? null : String(alternative.buildingName),
    expectedYield: nullableNumber(alternative.expectedYield),
    yieldBasis: alternative.yieldBasis == null ? null : String(alternative.yieldBasis),
    expectedPerCraft: nullableNumber(alternative.expectedPerCraft),
    expectedPerProgress: nullableNumber(alternative.expectedPerProgress),
    expectedPerResource: nullableNumber(alternative.expectedPerResource),
    resourceHealth: nullableNumber(alternative.resourceHealth),
    actionsRequired: nullableNumber(alternative.actionsRequired),
    dropChance: nullableNumber(alternative.dropChance),
    dropQuantity: nullableNumber(alternative.dropQuantity),
    guaranteedYield: nullableNumber(alternative.guaranteedYield),
    gatheringSource: normalizedGatheringSource(alternative.gatheringSource),
    inputs: (Array.isArray(alternative.inputs) ? alternative.inputs : [])
      .map((input) => ({
        key: inputIdentity(input),
        name: String(input.name ?? input.label ?? input.tag ?? "").trim() || inputIdentity(input),
        quantity: Number(input.quantity ?? 0),
      }))
      .filter((input) => input.key)
      .sort((left, right) => left.key.localeCompare(right.key) || left.quantity - right.quantity),
  };
}

function validProductionAlternatives(route = {}) {
  return (Array.isArray(route.alternatives) ? route.alternatives : [])
    .map(normalizedAlternative)
    .filter((alternative) => alternative.id
      && !alternative.isTransportRoute)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function safestAlternative(alternatives) {
  return [...alternatives].sort((left, right) => {
    const leftRisk = left.probabilityStatus === "guaranteed" && !left.isProbabilistic ? 0 : 1;
    const rightRisk = right.probabilityStatus === "guaranteed" && !right.isProbabilistic ? 0 : 1;
    return leftRisk - rightRisk || left.id.localeCompare(right.id);
  })[0] ?? null;
}

function alternativeRisk(alternative) {
  return alternative?.probabilityStatus === "guaranteed" && alternative?.isProbabilistic !== true ? 0 : 1;
}

export function routeReviewFingerprint(route = {}) {
  const alternatives = validProductionAlternatives(route).map(({
    label: _displayLabel,
    buildingName: _displayBuildingName,
    gatheringSource,
    inputs,
    ...materialSignature
  }) => ({
    ...materialSignature,
    gatheringSource: gatheringSource ? { tag: gatheringSource.tag, skill: gatheringSource.skill } : null,
    inputs: inputs.map(({ name: _displayName, ...inputSignature }) => inputSignature),
  }));
  return fingerprint({ outputKey: outputKey(route), alternatives });
}

function routeReview(route) {
  const key = outputKey(route);
  if (!key) return null;
  const alternatives = validProductionAlternatives(route);
  if (!alternatives.length) return null;
  const selectableAlternatives = alternatives.filter((alternative) => alternative.isSelectable);
  const safest = safestAlternative(selectableAlternatives);
  const selectedRouteId = String(route.selectedRecipeId ?? "").trim() || null;
  const calculated = alternatives.find((alternative) => alternative.id === selectedRouteId) ?? null;
  const preselected = calculated?.isSelectable && alternativeRisk(calculated) <= alternativeRisk(safest)
    ? calculated
    : safest;
  const outputName = String(route?.output?.name ?? route?.output?.label ?? route?.output?.tag ?? "").trim();
  return {
    outputKey: key,
    outputName: outputName || key,
    selectedRouteId,
    preselectedRouteId: preselected?.id ?? null,
    ambiguous: selectableAlternatives.length > 1,
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

export function buildCraftPlanRouteInventory(plan = {}) {
  const byOutput = new Map();
  for (const route of planRoutes(plan)) {
    const review = routeReview(route);
    if (review && !byOutput.has(review.outputKey)) byOutput.set(review.outputKey, review);
  }
  return [...byOutput.values()].sort((left, right) => left.outputKey.localeCompare(right.outputKey));
}

function directRouteInventory(plan = {}) {
  return (Array.isArray(plan?.routeInventory) ? plan.routeInventory : [])
    .filter((review) => review?.outputKey && Array.isArray(review?.alternatives) && review.alternatives.length);
}

function countMaterialSourceRoutes(plan = {}) {
  return (Array.isArray(plan?.materials) ? plan.materials : [])
    .reduce((count, material) => count + (Array.isArray(material?.sourceRoutes) ? material.sourceRoutes.length : 0), 0);
}

function mergedRouteInventory(plan = {}) {
  const byOutput = new Map(directRouteInventory(plan).map((review) => [String(review.outputKey), review]));
  for (const review of buildCraftPlanRouteInventory(plan)) {
    if (!byOutput.has(review.outputKey)) byOutput.set(review.outputKey, review);
  }
  return [...byOutput.values()].sort((left, right) => left.outputKey.localeCompare(right.outputKey));
}

export function buildCraftPlanRouteEvidence({ plan = {}, fallbackPlan = {}, allowFallback = false } = {}) {
  const current = mergedRouteInventory(plan);
  const fallback = current.length || !allowFallback ? [] : mergedRouteInventory(fallbackPlan);
  const routeInventory = current.length ? current : fallback;
  return {
    routeInventory,
    evidence: current.length ? "current" : fallback.length ? "retained" : "none",
    diagnostics: {
      steps: Array.isArray(plan.steps) ? plan.steps.length : 0,
      materialSourceRoutes: countMaterialSourceRoutes(plan),
      directInventory: directRouteInventory(plan).length,
      returnedReviews: routeInventory.length,
      fallbackReturnedReviews: fallback.length,
    },
  };
}

export function buildCraftPlanRouteResponse({ response = {}, evidence = null, includeRouteInventory = true, ...options } = {}) {
  const routeEvidence = evidence ?? buildCraftPlanRouteEvidence(options);
  return {
    ...response,
    ...(includeRouteInventory ? { routeInventory: routeEvidence.routeInventory } : {}),
    routeEvidence: routeEvidence.evidence,
    routeDiagnostics: routeEvidence.diagnostics,
  };
}

export function selectCraftPlanRouteInventory(options = {}) {
  const evidence = buildCraftPlanRouteEvidence(options);
  return {
    routeInventory: evidence.routeInventory,
    evidence: evidence.evidence === "retained" ? "last_good" : "current",
  };
}

export function craftPlanRouteFallbackAllowed(stagedConfig = {}, storedConfig = {}) {
  const { name: _stagedName, ...stagedCalculation } = stagedConfig && typeof stagedConfig === "object" ? stagedConfig : {};
  const { name: _storedName, ...storedCalculation } = storedConfig && typeof storedConfig === "object" ? storedConfig : {};
  return JSON.stringify(stable(stagedCalculation)) === JSON.stringify(stable(storedCalculation));
}

export function buildCraftPlanPreview({
  plan = {},
  routeInventory = [],
  scope,
  configurationRevision,
  baselineRevision,
  validation = { valid: true, errors: [] },
} = {}) {
  const materials = (Array.isArray(plan.materials) ? plan.materials : [])
    .map(materialImpact)
    .sort((left, right) => left.key.localeCompare(right.key));
  const byOutput = new Map((Array.isArray(routeInventory) ? routeInventory : [])
    .filter((review) => review?.outputKey && Array.isArray(review?.alternatives) && review.alternatives.length)
    .map((review) => [String(review.outputKey), review]));
  for (const review of mergedRouteInventory(plan)) {
    if (!byOutput.has(review.outputKey)) byOutput.set(review.outputKey, review);
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
    status: String(row.review_status ?? (row.confirmed_fingerprint == null ? "legacy_unconfirmed" : "confirmed")),
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
  const calculatedSelectedRouteId = String(routeReview?.selectedRouteId ?? "").trim();
  return confirmation
    && String(confirmation.outputKey ?? "") === routeReview.outputKey
    && String(confirmation.fingerprint ?? "") === routeReview.fingerprint
    && selectedRouteId === calculatedSelectedRouteId
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
    const grandfathered = [];
    const unconfirmed = [];
    const rejectedConfirmations = [];
    for (const route of normalizedRoutes) {
      const current = stored.get(route.outputKey);
      const submission = submitted.get(route.outputKey);
      const storedCurrent = current
        && current.status === "confirmed"
        && current.confirmedFingerprint
        && current.confirmedFingerprint === route.fingerprint
        && current.fingerprint === route.fingerprint
        && current.selectedRouteId === route.selectedRouteId
        && route.alternatives.some((alternative) => alternative.id === current.selectedRouteId);
      const grandfatheredCurrent = current
        && current.status === "grandfathered"
        && current.confirmedFingerprint == null
        && current.fingerprint === route.fingerprint
        && current.selectedRouteId === route.selectedRouteId
        && route.alternatives.some((alternative) => alternative.id === current.selectedRouteId);
      if (submission && !matchingConfirmation(route, submission)) rejectedConfirmations.push(route);
      if (storedCurrent || matchingConfirmation(route, submission)) confirmed.push(route);
      else if (grandfatheredCurrent) grandfathered.push(route);
      else if (route.ambiguous) unconfirmed.push(route);
    }
    return { routeReviews: normalizedRoutes, confirmed, grandfathered, unconfirmed, storedReviews: [...stored.values()], rejectedConfirmations };
  };
  return {
    listForPlan,
    previewState,
    reconcile({
      planId,
      configurationRevision,
      routeReviews = [],
      confirmations = [],
      reviewer = {},
      reviewedAt = now(),
      grandfatheredOutputKeys = [],
      observedOutputKeys = [],
    }) {
      const state = previewState(planId, routeReviews, confirmations);
      const currentByKey = new Map(state.routeReviews.map((entry) => [entry.outputKey, entry]));
      for (const stored of listForPlan(planId)) {
        const current = currentByKey.get(stored.outputKey);
        const currentFingerprintAndSelection = current
          && current.fingerprint === stored.fingerprint
          && current.selectedRouteId === stored.selectedRouteId;
        const currentConfirmed = stored.status === "confirmed"
          && stored.confirmedFingerprint === stored.fingerprint
          && currentFingerprintAndSelection;
        const currentGrandfathered = stored.status === "grandfathered" && currentFingerprintAndSelection;
        const currentObserved = stored.status === "observed" && currentFingerprintAndSelection;
        if (!currentConfirmed && !currentGrandfathered && !currentObserved) {
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
          "confirmed",
          String(reviewer.type ?? "system"),
          reviewer.id == null ? null : String(reviewer.id),
          String(reviewer.displayName ?? "system"),
          String(reviewedAt),
          Number(configurationRevision),
        );
      }
      for (const outputKey of grandfatheredOutputKeys) {
        const route = currentByKey.get(String(outputKey));
        if (!route?.ambiguous || !route.selectedRouteId) continue;
        statements.upsertCraftPlanRouteReview.run(
          String(planId),
          route.outputKey,
          route.fingerprint,
          route.selectedRouteId,
          null,
          "grandfathered",
          "system",
          null,
          "Legacy public baseline",
          String(reviewedAt),
          Number(configurationRevision),
        );
      }
      for (const outputKey of observedOutputKeys) {
        const route = currentByKey.get(String(outputKey));
        if (!route || route.ambiguous || !route.selectedRouteId) continue;
        statements.upsertCraftPlanRouteReview.run(
          String(planId),
          route.outputKey,
          route.fingerprint,
          route.selectedRouteId,
          null,
          "observed",
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
