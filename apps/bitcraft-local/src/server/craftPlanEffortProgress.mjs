import { plannerTaxonomyFor } from "../pages/craftPlanningTaxonomyData.mjs";

export const CRAFT_PLAN_EFFORT_MODEL_VERSION = 3;

const MAX_MISSING_WEIGHT_KEYS = 25;

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function effortCandidate(method, {
  catalogKey,
  sourceKey,
  actionsRequired,
  outputQuantity,
  probability = 1,
} = {}) {
  const actions = positive(actionsRequired);
  const quantity = positive(outputQuantity);
  const chance = positive(probability);
  const key = String(catalogKey ?? "").trim();
  if (!key || !actions || !quantity || !chance || chance > 1) return null;
  const effortWeight = actions / (quantity * chance);
  return Number.isFinite(effortWeight) && effortWeight > 0
    ? {
      catalogKey: key,
      sourceKey: String(sourceKey ?? "").trim(),
      method,
      effortWeight,
    }
    : null;
}

export function craftingEffortCandidate(input = {}) {
  return effortCandidate("crafting", input);
}

export function gatheringEffortCandidate(input = {}) {
  return effortCandidate("gathering", { ...input, actionsRequired: 1 });
}

function resourceRows(payload = {}) {
  if (Array.isArray(payload?.resources)) return payload.resources;
  if (Array.isArray(payload?.data?.resources)) return payload.data.resources;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function resourceOutputs(resource = {}) {
  for (const value of [resource.outputs, resource.items, resource.itemListPossibilities, resource.resourceOutputs]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function normalizeGameResourceEffortCandidates(payload = {}) {
  const candidates = [];
  for (const resource of resourceRows(payload)) {
    const resourceId = String(resource?.id ?? resource?.entityId ?? resource?.resourceId ?? "").trim();
    if (!resourceId) continue;
    for (const output of resourceOutputs(resource)) {
      const target = output?.targetItem ?? {};
      const id = String(output?.itemId ?? output?.item_id ?? output?.targetId ?? target?.id ?? "").trim();
      if (!id) continue;
      const rawType = output?.itemType ?? output?.item_type ?? target?.itemType ?? target?.item_type;
      const kind = output?.isCargo === true || rawType === 1 || rawType === "1" || String(rawType ?? "").toLowerCase() === "cargo"
        ? "cargo"
        : "items";
      const rawChance = Number(output?.probability ?? output?.chance ?? output?.dropChance);
      const probability = rawChance > 1 ? rawChance / 100 : rawChance;
      const candidate = gatheringEffortCandidate({
        catalogKey: `${kind}:${id}`,
        sourceKey: `resource:${resourceId}`,
        outputQuantity: output?.quantity ?? output?.amount,
        probability,
      });
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

export function selectLowestEffortWeights(candidates = []) {
  const weights = new Map();
  for (const row of candidates) {
    const catalogKey = String(row?.catalogKey ?? "").trim();
    const effortWeight = positive(row?.effortWeight);
    if (!catalogKey || !effortWeight) continue;
    const current = weights.get(catalogKey);
    if (!current || effortWeight < current.effortWeight) {
      weights.set(catalogKey, { ...row, catalogKey, effortWeight });
    }
  }
  return weights;
}

function materialKey(material = {}) {
  return String(material.key ?? "").trim();
}

function materialRequired(material = {}) {
  return nonNegative(material.bufferedRequired ?? material.required);
}

function compactFishingRoute(route = {}) {
  if (route?.available !== true) {
    return { available: false, reason: String(route?.reason ?? "Verified route unavailable") };
  }
  return {
    available: true,
    input: {
      key: String(route?.input?.key ?? ""),
      tag: String(route?.input?.tag ?? ""),
    },
    needed: nonNegative(route.needed),
    stockQuantity: nonNegative(route.stockQuantity),
    guaranteedTrackedQuantity: nonNegative(route.guaranteedTrackedQuantity),
  };
}

export function compactCraftPlanEffortInput(plan = {}, { routeInventory = null } = {}) {
  const effortPlan = plan?.confirmedEffortPlan ?? plan;
  return {
    materials: (Array.isArray(effortPlan?.materials) ? effortPlan.materials : []).map((material) => {
      const name = String(material?.name ?? material?.label ?? material?.itemName ?? "").trim();
      const sectionOverride = String(material?.sectionOverride ?? "").trim();
      return {
        key: materialKey(material),
        ...(name ? { name } : {}),
        tag: String(material?.tag ?? ""),
        section: String(material?.section ?? material?.apiSection ?? "Other"),
        ...(sectionOverride ? { sectionOverride } : {}),
        required: materialRequired(material),
        missing: nonNegative(material?.missing),
      };
    }),
    personalViews: {
      fishing: {
        tiers: (Array.isArray(effortPlan?.personalViews?.fishing?.tiers) ? effortPlan.personalViews.fishing.tiers : []).map((tier) => ({
          routes: Object.fromEntries(Object.entries(tier?.routes ?? {}).map(([name, route]) => [name, compactFishingRoute(route)])),
        })),
      },
    },
    ...(Array.isArray(routeInventory) ? { routeInventory: structuredClone(routeInventory) } : {}),
  };
}

function effortClassification(material = {}) {
  const taxonomy = plannerTaxonomyFor(material);
  const sectionOverride = String(material.sectionOverride ?? "").trim();
  const section = sectionOverride
    || String(taxonomy.section ?? material.section ?? material.apiSection ?? "Other").trim()
    || "Other";
  return { taxonomy, section };
}

function isInterchangeableFishingInput(classification) {
  return classification.section.toLowerCase() === "fishing"
    && /^(ocean|lake) fish$/i.test(String(classification.taxonomy.row ?? "").trim());
}

export function projectCraftPlanEffortMaterials(plan = {}, fishingRoute = null) {
  const projected = new Map();
  for (const material of Array.isArray(plan?.materials) ? plan.materials : []) {
    const { taxonomy, section } = effortClassification(material);
    if (taxonomy.hidden) continue;
    if (fishingRoute && isInterchangeableFishingInput({ taxonomy, section })) continue;
    const key = materialKey(material);
    const required = materialRequired(material);
    if (!key || required <= 0) continue;
    const current = projected.get(key);
    if (current) {
      current.required += required;
      current.missing += Math.min(required, nonNegative(material.missing));
      continue;
    }
    projected.set(key, {
      key,
      section,
      required,
      missing: Math.min(required, nonNegative(material.missing)),
    });
  }
  if (fishingRoute) {
    for (const tier of Array.isArray(plan?.personalViews?.fishing?.tiers) ? plan.personalViews.fishing.tiers : []) {
      const route = tier?.routes?.[fishingRoute];
      if (route?.available !== true) continue;
      const key = String(route?.input?.key ?? "").trim();
      if (!key) continue;
      const required = nonNegative(route.needed) + nonNegative(route.stockQuantity) + nonNegative(route.guaranteedTrackedQuantity);
      const missing = Math.min(required, nonNegative(route.needed));
      const current = projected.get(key);
      if (current) {
        current.required += required;
        current.missing += missing;
      } else if (required > 0) {
        projected.set(key, { key, section: "Fishing", required, missing });
      }
    }
  }
  return [...projected.values()];
}

function roundedCompletion(baselineEffort, remainingEffort) {
  if (baselineEffort <= 0) return 100;
  const completion = Math.round((1 - remainingEffort / baselineEffort) * 1000) / 10;
  return Math.min(100, Math.max(0, completion));
}

function readyAggregate(rows) {
  const baselineEffort = rows.reduce((sum, row) => sum + row.baselineEffort, 0);
  const remainingEffort = Math.min(
    baselineEffort,
    rows.reduce((sum, row) => sum + row.remainingEffort, 0),
  );
  return {
    state: "ready",
    baselineEffort,
    remainingEffort,
    completion: roundedCompletion(baselineEffort, remainingEffort),
  };
}

function unavailableAggregate() {
  return {
    state: "unavailable",
    baselineEffort: null,
    remainingEffort: null,
    completion: null,
  };
}

export function unavailableCraftPlanEffortProgress() {
  const confirmed = {
    state: "unavailable",
    overall: unavailableAggregate(),
    sections: {},
    fishingVariants: {},
    coverage: {
      weightedRequiredMaterials: 0,
      totalRequiredMaterials: 0,
      missingWeightCount: 0,
      missingWeightKeys: [],
    },
    warnings: ["Effort progress is unavailable until compatible Relay catalog data is ready."],
  };
  return {
    modelVersion: CRAFT_PLAN_EFFORT_MODEL_VERSION,
    ...confirmed,
    confirmed,
    projected: confirmed,
  };
}

function atLeastConfirmed(confirmed, projected) {
  if (!confirmed || !projected) return projected;
  if (confirmed.completion == null || projected.completion == null) return projected;
  if (projected.completion >= confirmed.completion) return projected;
  return {
    ...projected,
    remainingEffort: confirmed.remainingEffort,
    completion: confirmed.completion,
  };
}

function clampProjection(confirmed, projected) {
  const sections = Object.fromEntries(Object.entries(projected.sections ?? {}).map(([name, value]) => [
    name,
    atLeastConfirmed(confirmed.sections?.[name], value),
  ]));
  return {
    ...projected,
    overall: atLeastConfirmed(confirmed.overall, projected.overall),
    sections,
  };
}

export function calculateCraftPlanEffortProgress({
  baselinePlan = {},
  currentPlan = {},
  weights = new Map(),
} = {}) {
  const confirmedPlan = currentPlan?.confirmedEffortPlan ?? currentPlan;
  const calculateProjection = (baseline, current) => {
    if (!baseline.length) return {
      state: "empty",
      overall: { state: "empty", baselineEffort: 0, remainingEffort: 0, completion: 100 },
      sections: {},
      coverage: { weightedRequiredMaterials: 0, totalRequiredMaterials: 0, missingWeightCount: 0, missingWeightKeys: [] },
      warnings: [],
    };

    const currentByKey = new Map(current.map((row) => [row.key, row]));
    const sectionRows = new Map();
    const missingBySection = new Map();
    const missingWeights = new Set();
    let weightedRequiredMaterials = 0;

    for (const row of baseline) {
      const verifiedWeight = positive(weights instanceof Map ? weights.get(row.key)?.effortWeight ?? weights.get(row.key) : null);
      const weight = verifiedWeight ?? 1;
      if (!verifiedWeight) {
        missingWeights.add(row.key);
        const sectionMissing = missingBySection.get(row.section) ?? new Set();
        sectionMissing.add(row.key);
        missingBySection.set(row.section, sectionMissing);
      } else {
        weightedRequiredMaterials += 1;
      }
      const liveMissing = Math.min(row.required, nonNegative(currentByKey.get(row.key)?.missing ?? 0));
      const entries = sectionRows.get(row.section) ?? [];
      entries.push({ baselineEffort: row.required * weight, remainingEffort: liveMissing * weight });
      sectionRows.set(row.section, entries);
    }

    const sectionNames = new Set([...sectionRows.keys(), ...missingBySection.keys()]);
    const sections = {};
    for (const section of sectionNames) {
      sections[section] = readyAggregate(sectionRows.get(section) ?? []);
    }
    const overall = readyAggregate([...sectionRows.values()].flat());
    const state = missingWeights.size ? "partial" : "ready";
    const missingWeightKeys = [...missingWeights].sort();
    return {
      state,
      overall,
      sections,
      coverage: {
        weightedRequiredMaterials,
        totalRequiredMaterials: baseline.length,
        missingWeightCount: missingWeightKeys.length,
        missingWeightKeys: missingWeightKeys.slice(0, MAX_MISSING_WEIGHT_KEYS),
      },
      warnings: missingWeightKeys.length
        ? [`Effort progress uses a neutral one-action estimate for ${missingWeightKeys.length} required material${missingWeightKeys.length === 1 ? "" : "s"} because verified gathering yields are unavailable for them.`]
        : [],
    };
  };

  const baseline = projectCraftPlanEffortMaterials(baselinePlan);
  if (!baseline.length) {
    const confirmed = {
      state: "empty",
      overall: { state: "empty", baselineEffort: 0, remainingEffort: 0, completion: 100 },
      sections: {},
      fishingVariants: {},
      coverage: {
        weightedRequiredMaterials: 0,
        totalRequiredMaterials: 0,
        missingWeightCount: 0,
        missingWeightKeys: [],
      },
      warnings: [],
    };
    return {
      modelVersion: CRAFT_PLAN_EFFORT_MODEL_VERSION,
      ...confirmed,
      confirmed,
      projected: confirmed,
    };
  }

  const confirmed = calculateProjection(baseline, projectCraftPlanEffortMaterials(confirmedPlan));
  const projected = clampProjection(
    confirmed,
    calculateProjection(baseline, projectCraftPlanEffortMaterials(currentPlan)),
  );
  const fishingVariants = {};
  for (const route of ["ocean", "lake"]) {
    const baselineRoutes = baselinePlan?.personalViews?.fishing?.tiers ?? [];
    const confirmedRoutes = confirmedPlan?.personalViews?.fishing?.tiers ?? [];
    const projectedRoutes = currentPlan?.personalViews?.fishing?.tiers ?? [];
    const routeAvailable = baselineRoutes.length > 0
      && baselineRoutes.every((tier) => tier?.routes?.[route]?.available === true)
      && confirmedRoutes.every((tier) => tier?.routes?.[route]?.available === true)
      && projectedRoutes.every((tier) => tier?.routes?.[route]?.available === true);
    if (!routeAvailable) continue;
    const routeBaseline = projectCraftPlanEffortMaterials(baselinePlan, route);
    const confirmedVariant = calculateProjection(
      routeBaseline,
      projectCraftPlanEffortMaterials(confirmedPlan, route),
    );
    const projectedVariant = clampProjection(
      confirmedVariant,
      calculateProjection(routeBaseline, projectCraftPlanEffortMaterials(currentPlan, route)),
    );
    fishingVariants[route] = {
      route,
      ...confirmedVariant,
      confirmed: confirmedVariant,
      projected: projectedVariant,
    };
  }
  return {
    modelVersion: CRAFT_PLAN_EFFORT_MODEL_VERSION,
    ...confirmed,
    confirmed,
    projected,
    fishingVariants,
  };
}
