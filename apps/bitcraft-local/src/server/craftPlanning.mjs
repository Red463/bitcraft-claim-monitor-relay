import { plannerOverrideKeyFor } from "../pages/craftPlanningTaxonomyData.mjs";

const DEFAULT_PLAN_NAME = "Settlement craft plan";
const PLAN_SECTIONS = new Set([
  "Carpentry",
  "Construction",
  "Cooking",
  "Farming",
  "Fishing",
  "Foraging",
  "Forestry",
  "Hunting",
  "Leatherworking",
  "Masonry",
  "Mining",
  "Scholar",
  "Smithing",
  "Tailoring",
  "Other",
]);

const COLLECTED_ANIMAL_CARGO_IDENTITIES = new Map([
  ["cargo:3", { id: "4", name: "Cervus", iconAssetName: "GeneratedIcons/Cargo/Animals/DeerMale" }],
  ["cargo:5", { id: "6", name: "Scrofa", iconAssetName: "GeneratedIcons/Cargo/Animals/BoarMale" }],
]);

export function recipeKey(kind, id) {
  const normalizedKind = String(kind) === "cargo" ? "cargo" : String(kind) === "building" ? "building" : "items";
  return `${normalizedKind}:${String(id ?? "").trim()}`;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replaceAll(",", "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeKind(value) {
  if (String(value) === "building" || String(value) === "2") return "building";
  return String(value) === "cargo" || String(value) === "1" ? "cargo" : "items";
}

function itemTypeFromKind(kind) {
  return kind === "cargo" ? 1 : kind === "building" ? 2 : 0;
}

function normalizedTier(value) {
  const explicit = Number(value);
  return Number.isFinite(explicit) && explicit >= 1 && explicit <= 10 ? explicit : null;
}

function normalizeTarget(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id ?? value.itemId ?? value.targetId ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  const kind = normalizeKind(value.kind ?? value.itemType ?? value.item_type);
  const quantity = Math.max(1, Math.ceil(toNumber(value.quantity)));
  const target = {
    id,
    kind,
    itemType: itemTypeFromKind(kind),
    name: String(value.name ?? value.itemName ?? `Item #${id}`).trim() || `Item #${id}`,
    quantity,
    tier: normalizedTier(value.tier),
    rarityStr: value.rarityStr == null && value.rarity == null ? null : String(value.rarityStr ?? value.rarity),
    tag: value.tag == null ? null : String(value.tag),
    iconAssetName: value.iconAssetName == null ? null : String(value.iconAssetName),
  };
  if (kind === "building") {
    target.family = value.family == null ? null : String(value.family);
    target.constructionRecipeId = value.constructionRecipeId == null ? null : String(value.constructionRecipeId);
    target.requirements = (Array.isArray(value.requirements) ? value.requirements : [])
      .map((requirement) => normalizeTarget(requirement))
      .filter((requirement) => requirement && requirement.kind !== "building");
  }
  return target;
}

function expandedPlanTargets(targets, buildingProgress = {}) {
  const merged = new Map();
  for (const target of targets) {
    const completed = target.kind === "building" ? buildingProgress[recipeKey(target.kind, target.id)]?.completedEntityIds?.length ?? 0 : 0;
    const remainingQuantity = target.kind === "building" ? Math.max(0, target.quantity - completed) : target.quantity;
    const rows = target.kind === "building"
      ? (target.requirements ?? []).map((requirement) => ({ ...requirement, quantity: requirement.quantity * remainingQuantity }))
      : [target];
    for (const row of rows) {
      const key = recipeKey(row.kind, row.id);
      const current = merged.get(key);
      merged.set(key, current ? { ...current, quantity: current.quantity + row.quantity } : { ...row });
    }
  }
  return [...merged.values()].filter((target) => target.quantity > 0);
}

export function craftPlanCatalogTargets(config) {
  const normalized = normalizeCraftPlanConfig(config);
  return expandedPlanTargets(normalized.targets, normalized.buildingProgress).filter((target) => target.kind !== "building" && target.quantity > 0);
}

export function normalizeCraftPlanConfig(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  const routeOverrides = {};
  for (const [key, value] of Object.entries(raw.routeOverrides ?? {})) {
    const cleanKey = String(key ?? "").trim();
    const cleanValue = String(value ?? "").trim();
    if (cleanKey && cleanValue) routeOverrides[cleanKey] = cleanValue;
  }
  const sectionOverrides = {};
  for (const [key, value] of Object.entries(raw.sectionOverrides ?? {})) {
    const cleanKey = String(key ?? "").trim();
    const section = String(value ?? "").trim();
    if (cleanKey && PLAN_SECTIONS.has(section)) sectionOverrides[cleanKey] = section;
  }
  const rowNameOverrides = {};
  for (const [key, value] of Object.entries(raw.rowNameOverrides ?? {})) {
    const cleanKey = String(key ?? "").trim();
    const cleanValue = String(value ?? "").trim().slice(0, 80);
    if (cleanKey && cleanValue) rowNameOverrides[cleanKey] = cleanValue;
  }
  const multipliers = {};
  for (const [key, value] of Object.entries(raw.multipliers ?? {})) {
    const cleanKey = String(key ?? "").trim();
    const rawMultiplier = typeof value === "object" && value ? value.multiplier : value;
    const multiplier = Math.max(1, Math.min(20, toNumber(rawMultiplier) || 1));
    if (cleanKey && multiplier > 1) {
      multipliers[cleanKey] = {
        multiplier,
        note: typeof value === "object" && value?.note != null ? String(value.note).slice(0, 160) : "",
      };
    }
  }
  const gatheredItemKeys = uniqueStrings(raw.gatheredItemKeys)
    .filter((key) => /^(?:items|cargo):[^:\s]+$/.test(key))
    .sort((left, right) => left.localeCompare(right));
  const playerIds = uniqueStrings(raw.sourceRules?.playerIds);
  const craftPlayerIds = Array.isArray(raw.sourceRules?.craftPlayerIds) ? uniqueStrings(raw.sourceRules.craftPlayerIds) : playerIds;
  const bankPlayerIds = uniqueStrings(raw.sourceRules?.bankPlayerIds);
  const bankContainerIds = uniqueStrings(raw.sourceRules?.bankContainerIds);
  const targets = (Array.isArray(raw.targets) ? raw.targets : []).map(normalizeTarget).filter(Boolean).slice(0, 50);
  const buildingTargetKeys = new Set(targets.filter((target) => target.kind === "building").map((target) => recipeKey(target.kind, target.id)));
  const buildingProgress = {};
  for (const [key, value] of Object.entries(raw.buildingProgress ?? {})) {
    if (!buildingTargetKeys.has(key) || !value || typeof value !== "object") continue;
    buildingProgress[key] = {
      baselineEntityIds: uniqueStrings(value.baselineEntityIds),
      completedEntityIds: uniqueStrings(value.completedEntityIds),
    };
  }
  return {
    enabled: raw.enabled !== false,
    name: String(raw.name ?? DEFAULT_PLAN_NAME).trim().slice(0, 120) || DEFAULT_PLAN_NAME,
    targets,
    sourceRules: {
      storageContainerIds: uniqueStrings(raw.sourceRules?.storageContainerIds),
      playerIds,
      craftPlayerIds,
      bankPlayerIds,
      bankContainerIds,
      deployableContainerIds: uniqueStrings(raw.sourceRules?.deployableContainerIds),
    },
    routeOverrides,
    sectionOverrides,
    rowNameOverrides,
    multipliers,
    gatheredItemKeys,
    buildingProgress,
  };
}

const CRAFT_PLAN_AUDIT_SOURCE_RULES = [
  ["storageContainerIds", "storage"],
  ["playerIds", "player_inventory"],
  ["craftPlayerIds", "player_crafts"],
  ["bankContainerIds", "player_bank"],
  ["deployableContainerIds", "deployable"],
];

const CRAFT_PLAN_AUDIT_CATEGORIES = new Set([
  "public_board",
  "gathered_item",
  ...CRAFT_PLAN_AUDIT_SOURCE_RULES.map(([, category]) => category),
]);

const CRAFT_PLAN_OTHER_AUDIT_FIELDS = [
  "name",
  "targets",
  "routeOverrides",
  "sectionOverrides",
  "rowNameOverrides",
  "multipliers",
];

function auditLabel(labels, category, entityId) {
  return String(labels?.[category]?.[entityId] ?? entityId);
}

export function craftPlanAuditDetails(previousInput = {}, nextInput = {}, labels = {}) {
  const previous = normalizeCraftPlanConfig(previousInput);
  const next = normalizeCraftPlanConfig(nextInput);
  const changes = [];
  if (previous.enabled !== next.enabled) {
    changes.push({ category: "public_board", entityId: "public-board", label: "Public board", enabled: next.enabled });
  }
  for (const [ruleKey, category] of CRAFT_PLAN_AUDIT_SOURCE_RULES) {
    const before = new Set(previous.sourceRules[ruleKey]);
    const after = new Set(next.sourceRules[ruleKey]);
    const ids = [...new Set([...before, ...after])].sort((left, right) => left.localeCompare(right));
    for (const entityId of ids) {
      if (before.has(entityId) === after.has(entityId)) continue;
      changes.push({ category, entityId, label: auditLabel(labels, category, entityId), enabled: after.has(entityId) });
    }
  }
  const previousGathered = new Set(previous.gatheredItemKeys);
  const nextGathered = new Set(next.gatheredItemKeys);
  const gatheredKeys = [...new Set([...previousGathered, ...nextGathered])]
    .sort((left, right) => left.localeCompare(right));
  for (const entityId of gatheredKeys) {
    if (previousGathered.has(entityId) === nextGathered.has(entityId)) continue;
    changes.push({
      category: "gathered_item",
      entityId,
      label: auditLabel(labels, "gathered_item", entityId),
      enabled: nextGathered.has(entityId),
    });
  }
  const otherSettingsChanged = CRAFT_PLAN_OTHER_AUDIT_FIELDS.some((field) => JSON.stringify(previous[field]) !== JSON.stringify(next[field]));
  return { changes, otherSettingsChanged };
}

export function craftPlanAuditLimit(value) {
  const parsed = Number(value ?? 100);
  return Math.min(Math.max(Number.isFinite(parsed) ? Math.trunc(parsed) : 100, 1), 100);
}

export function normalizeCraftPlanAuditRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    let details = {};
    try {
      const parsed = JSON.parse(String(row?.details_json ?? "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) details = parsed;
    } catch {
      details = {};
    }
    const changes = (Array.isArray(details.changes) ? details.changes : [])
      .filter((change) => change && typeof change === "object" && CRAFT_PLAN_AUDIT_CATEGORIES.has(String(change.category ?? "")))
      .map((change) => ({
        category: String(change.category),
        entityId: String(change.entityId ?? ""),
        label: String(change.label ?? change.entityId ?? "Unknown source"),
        enabled: Boolean(change.enabled),
      }))
      .filter((change) => change.entityId);
    return {
      id: Number(row?.id) || 0,
      username: String(row?.username ?? "system"),
      occurredAt: String(row?.occurred_at ?? ""),
      changes,
      otherSettingsChanged: Boolean(details.otherSettingsChanged),
      summary: {
        targets: Number(details.targets) || 0,
        players: Number(details.players) || 0,
        deployables: Number(details.deployables) || 0,
      },
    };
  });
}

function claimBuildingRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.buildings)) return payload.buildings;
  if (Array.isArray(payload?.data?.buildings)) return payload.data.buildings;
  return [];
}

export function reconcileCraftPlanBuildingProgress(config, claimBuildingsPayload) {
  const normalized = normalizeCraftPlanConfig(config);
  const rows = claimBuildingRows(claimBuildingsPayload);
  const nextProgress = {};
  for (const target of normalized.targets.filter((entry) => entry.kind === "building")) {
    const key = recipeKey(target.kind, target.id);
    const currentIds = uniqueStrings(rows
      .filter((building) => String(building?.buildingDescriptionId ?? building?.building_description_id ?? "") === String(target.id))
      .map((building) => building?.entityId ?? building?.entity_id));
    const existing = normalized.buildingProgress[key];
    if (!existing) {
      nextProgress[key] = { baselineEntityIds: currentIds, completedEntityIds: [] };
      continue;
    }
    const baseline = new Set(existing.baselineEntityIds);
    nextProgress[key] = {
      baselineEntityIds: existing.baselineEntityIds,
      completedEntityIds: uniqueStrings([...existing.completedEntityIds, ...currentIds.filter((id) => !baseline.has(id))]),
    };
  }
  const changed = JSON.stringify(nextProgress) !== JSON.stringify(normalized.buildingProgress);
  return { config: { ...normalized, buildingProgress: nextProgress }, changed };
}

function stackKind(stack) {
  return normalizeKind(stack?.item_type ?? stack?.itemType);
}

function stackId(stack) {
  return String(stack?.item_id ?? stack?.itemId ?? stack?.id ?? "").trim();
}

function stackMatches(stack, target) {
  return stackId(stack) === String(target.id) && stackKind(stack) === target.kind;
}

function unwrapRecipeDetail(detail) {
  return detail?.detail && typeof detail.detail === "object" ? detail.detail : detail;
}

function detailTarget(detail, fallback) {
  const unwrapped = unwrapRecipeDetail(detail);
  const source = unwrapped?.item ?? unwrapped?.cargo ?? unwrapped ?? {};
  const kind = normalizeKind(source.itemType ?? source.item_type ?? fallback?.kind);
  return {
    id: String(source.id ?? fallback?.id ?? "").trim(),
    kind,
    itemType: itemTypeFromKind(kind),
    name: String(source.name ?? fallback?.name ?? "Unknown item"),
    tier: normalizedTier(source.tier ?? fallback?.tier),
    rarityStr: source.rarityStr ?? source.rarity ?? fallback?.rarityStr ?? null,
    tag: source.tag ?? fallback?.tag ?? null,
    iconAssetName: source.iconAssetName ?? fallback?.iconAssetName ?? null,
  };
}

function recipeOutputs(recipe) {
  return Array.isArray(recipe?.craftedItemStacks) ? recipe.craftedItemStacks : [];
}

function recipeInputs(recipe) {
  return Array.isArray(recipe?.consumedItemStacks) ? recipe.consumedItemStacks : [];
}

function stackDisplayLooksTransport(display) {
  return /\b(unpack|unpackage|packed|package)\b/i.test(String(display?.name ?? display?.tag ?? display?.itemTag ?? ""));
}

function recipeLooksTransportRoute(recipe) {
  if (recipe?.isTransportRoute === true) return true;
  if (/\b(unpack|unpackage|packed|package)\b/i.test(String(recipe?.name ?? ""))) return true;
  const inputDisplays = Array.isArray(recipe?.consumedItems) ? recipe.consumedItems : [];
  const outputDisplays = Array.isArray(recipe?.craftedItems) ? recipe.craftedItems : [];
  return inputDisplays.some(stackDisplayLooksTransport) || outputDisplays.some(stackDisplayLooksTransport);
}

function recipeSkillName(recipe) {
  return String(recipe?.skillName ?? recipe?.levelRequirements?.[0]?.skill?.name ?? "").trim();
}

function recipeStationName(recipe) {
  return String(
    recipe?.buildingName
    ?? recipe?.building_name
    ?? recipe?.stationName
    ?? recipe?.station_name
    ?? recipe?.station?.name
    ?? recipe?.building?.name
    ?? "",
  ).trim();
}

function recipeActivityKind(recipe) {
  if (recipeStationName(recipe)) return "craft";
  return recipe?.activityKind === "gathering" ? "gathering" : "craft";
}

function routeIsGathering(recipe) {
  if (recipe?.routeType != null) {
    return recipe.routeType === "gathering" || recipe.routeType === "gathering-byproduct";
  }
  return recipeActivityKind(recipe) === "gathering";
}

function routeTypeForItemListOutput(recipe, output) {
  const activityKind = recipeActivityKind(recipe);
  const expectedYield = Math.max(0, toNumber(output?.quantity));
  const guaranteedYield = Math.max(0, toNumber(output?.guaranteedQuantity));
  return guaranteedYield + 1e-9 < expectedYield ? `${activityKind}-byproduct` : activityKind;
}

function routeMetadata(recipe, target = null) {
  const gathering = routeIsGathering(recipe);
  const gatheringMode = gathering && recipe?.gatheringMode === "prospecting" ? "prospecting" : "ordinary";
  const prospecting = gatheringMode === "prospecting";
  const gatheringSkill = recipe?.gatheringSkill ?? recipeSkillName(recipe);
  const targetOutput = target
    ? recipeOutputs(recipe).find((output) => stackMatches(output, target))
    : null;
  const probabilityStatus = recipe?.probabilityStatus ?? (recipe?.isProbabilistic === true ? "expected" : "guaranteed");
  const probabilityUnavailable = probabilityStatus === "unavailable";
  const expectedYield = probabilityUnavailable
    ? null
    : recipe?.expectedYield == null
      ? Math.max(0, toNumber(targetOutput?.quantity)) || null
      : toNumber(recipe.expectedYield);
  const yieldBasis = gathering ? "per_progress" : "per_craft";
  const resourceHealth = gathering && !prospecting ? Math.max(0, toNumber(recipe?.resourceHealth)) || null : null;
  const completionYield = !prospecting && target && Array.isArray(recipe?.resourceCompletionOutputs)
    ? recipe.resourceCompletionOutputs
      .filter((output) => output.outputKey === recipeKey(target.kind, target.id))
      .reduce((sum, output) => sum + (Math.max(0, toNumber(output.quantity)) * Math.max(0, toNumber(output.occurrenceRate, 1))), 0)
    : 0;
  const expectedPerProgress = gathering && !probabilityUnavailable ? Math.max(0, toNumber(recipe?.expectedPerProgress ?? expectedYield)) : null;
  const expectedPerResource = gathering && resourceHealth && !probabilityUnavailable
    ? Math.max(0, toNumber(recipe?.expectedPerResource)) || ((expectedPerProgress * resourceHealth) + completionYield)
    : null;
  const actionsRequired = Math.max(1, toNumber(recipe?.actionsRequired ?? recipe?.actions_required) || 1);
  return {
    routeType: recipe?.routeType ?? recipeActivityKind(recipe),
    gatheringMode,
    gatheringSkill: gathering ? gatheringSkill || null : null,
    producer: recipe?.producer ?? null,
    producerRecipe: recipe?.producerRecipe ?? null,
    expectedYield,
    yieldBasis,
    expectedPerCraft: gathering ? null : expectedYield,
    expectedPerProgress,
    expectedPerResource,
    resourceHealth,
    actionsRequired,
    isTransportRoute: recipeLooksTransportRoute(recipe),
    probabilityStatus,
    isProbabilistic: recipe?.isProbabilistic === true || probabilityStatus === "expected" || probabilityUnavailable,
    dropChance: recipe?.dropChance == null ? null : toNumber(recipe.dropChance),
    dropQuantity: recipe?.dropQuantity == null ? null : toNumber(recipe.dropQuantity),
    guaranteedYield: probabilityUnavailable
      ? null
      : recipe?.guaranteedYield == null
        ? targetOutput?.guaranteedQuantity == null ? null : Math.max(0, toNumber(targetOutput.guaranteedQuantity))
        : toNumber(recipe.guaranteedYield),
    gatheringSource: recipe?.gatheringSource ?? null,
  };
}

function farmingRoutePreference(recipe, target, detailsByKey) {
  const targetTag = String(target?.tag ?? "").trim();
  const targetTier = normalizedTier(target?.tier);
  if (!/\bPlant$/i.test(targetTag) || targetTier == null) return 0;
  const inputs = recipeInputs(recipe).map((input, index) => {
    const display = stackDisplay(input, recipe?.consumedItems, index);
    return detailsByKey instanceof Map ? enrichDisplayFromDetails(display, detailsByKey) : display;
  });
  const usesLowerTierPlant = inputs.some((input) => String(input.tag ?? "").trim() === targetTag && input.tier != null && input.tier < targetTier);
  if (usesLowerTierPlant) return 1000;
  const usesSameTierSeeds = inputs.some((input) => /\bSeeds?$/i.test(String(input.tag ?? input.name ?? "")) && input.tier === targetTier);
  return usesSameTierSeeds ? -1000 : 0;
}

function recipeSortScore(recipe, target, detailsByKey) {
  const targetOutput = recipeOutputs(recipe).find((output) => stackMatches(output, target));
  const routeCost = (recipeInputs(recipe).reduce((sum, input) => sum + Math.max(0, toNumber(input.quantity)), 0)
    / Math.max(0.0001, toNumber(targetOutput?.quantity) || 1)) * 100;
  return (recipeLooksTransportRoute(recipe) ? 10000 : 0)
    + farmingRoutePreference(recipe, target, detailsByKey)
    + routeCost
    + (recipe?.isPassive ? 10 : 0)
    + recipeInputs(recipe).length;
}

function directRecipesForTarget(detail, target) {
  const unwrapped = unwrapRecipeDetail(detail);
  const candidates = [
    ...(unwrapped?.craftingRecipes ?? []).map((recipe) => ({ recipe, fallbackActivityKind: "craft" })),
    ...(unwrapped?.extractionRecipes ?? []).map((recipe) => ({ recipe, fallbackActivityKind: "gathering" })),
  ];
  return candidates
    .map(({ recipe, fallbackActivityKind }) => ({
      ...recipe,
      activityKind: recipe?.activityKind ?? fallbackActivityKind,
    }))
    .filter((recipe) => recipeOutputs(recipe).some((stack) => stackMatches(stack, target)));
}

function possibilityTargetId(possibility) {
  return String(possibility?.targetId ?? possibility?.targetItem?.id ?? possibility?.itemId ?? possibility?.id ?? "").trim();
}

function possibilityKind(possibility) {
  return possibility?.isCargo === true || String(possibility?.itemType ?? possibility?.item_type) === "1" ? "cargo" : "items";
}

function possibilityYieldForTarget(detail, target) {
  return possibilityExpectedOutputs(detail)
    .find((output) => output.id === String(target.id) && output.kind === target.kind)?.quantity ?? 0;
}

function possibilityExpectedOutputs(detail) {
  const unwrapped = unwrapRecipeDetail(detail);
  const outputs = new Map();
  for (const possibility of unwrapped?.itemListPossibilities ?? []) {
    const id = possibilityTargetId(possibility);
    if (!id) continue;
    const kind = possibilityKind(possibility);
    const quantity = Math.max(0, toNumber(possibility.quantity));
    const rawChance = possibility.chance == null ? 1 : toNumber(possibility.chance);
    const chance = Math.max(0, Math.min(1, rawChance > 1 ? rawChance / 100 : rawChance));
    const probabilityStatus = possibility?.probabilityStatus === "unavailable" ? "unavailable" : null;
    const expectedYield = possibility?.quantityIsExpected === true
      ? quantity
      : quantity * Math.max(0, Math.min(1, chance || 0));
    if (expectedYield <= 0) continue;
    const key = recipeKey(kind, id);
    const current = outputs.get(key) ?? {
      id,
      kind,
      itemType: itemTypeFromKind(kind),
      name: String(possibility?.targetItem?.name ?? possibility?.name ?? `Item #${id}`),
      tier: normalizedTier(possibility?.targetItem?.tier ?? possibility?.tier),
      tag: possibility?.targetItem?.tag ?? possibility?.tag ?? null,
      rarityStr: possibility?.targetItem?.rarityStr ?? possibility?.targetItem?.rarity ?? null,
      iconAssetName: possibility?.targetItem?.iconAssetName ?? null,
      quantity: 0,
      explicitGuaranteedQuantity: 0,
      hasExplicitGuarantee: true,
      minimumQuantity: Number.POSITIVE_INFINITY,
      totalChance: 0,
      weightedDropQuantity: 0,
      probabilityStatus,
    };
    if (probabilityStatus === "unavailable") current.probabilityStatus = "unavailable";
    current.quantity += expectedYield;
    const explicitGuarantee = possibility?.guaranteedQuantity ?? possibility?.guaranteed_quantity;
    current.hasExplicitGuarantee = current.hasExplicitGuarantee && explicitGuarantee != null && Number.isFinite(Number(explicitGuarantee));
    current.explicitGuaranteedQuantity += Math.max(0, toNumber(explicitGuarantee));
    current.minimumQuantity = Math.min(current.minimumQuantity, quantity);
    current.totalChance += chance;
    current.weightedDropQuantity += Math.max(0, toNumber(possibility?.dropQuantity ?? quantity)) * chance;
    outputs.set(key, current);
  }
  return [...outputs.values()].map(({ explicitGuaranteedQuantity, hasExplicitGuarantee, minimumQuantity, totalChance, weightedDropQuantity, ...output }) => ({
    ...output,
    dropChance: Math.min(1, totalChance),
    dropQuantity: totalChance > 0 ? weightedDropQuantity / totalChance : 0,
    guaranteedQuantity: hasExplicitGuarantee
      ? explicitGuaranteedQuantity
      : totalChance >= 1 - 1e-9 && Number.isFinite(minimumQuantity) ? minimumQuantity : 0,
  }));
}

function possibilityRecipesForTarget(target, detailsByKey) {
  if (!(detailsByKey instanceof Map)) return [];
  const recipes = [];
  for (const [sourceKey, detail] of detailsByKey.entries()) {
    const expectedOutputs = possibilityExpectedOutputs(detail);
    const yieldQuantity = expectedOutputs.find((output) => output.id === String(target.id) && output.kind === target.kind)?.quantity ?? 0;
    if (yieldQuantity <= 0) continue;
    const outputTarget = detailTarget(detail, {});
    if (!outputTarget.id || recipeKey(outputTarget.kind, outputTarget.id) === recipeKey(target.kind, target.id)) continue;
    for (const recipe of directRecipesForTarget(detail, outputTarget)) {
      if (recipeLooksTransportRoute(recipe)) continue;
      const output = recipeOutputs(recipe).find((stackItem) => stackMatches(stackItem, outputTarget));
      const outputPerCraft = Math.max(0.0001, toNumber(output?.quantity ?? recipe.outputQuantity) || 1);
      const producerGuaranteed = Math.max(0, toNumber(output?.guaranteedQuantity ?? outputPerCraft));
      const craftedOutputs = expectedOutputs.map((expectedOutput) => ({
        ...expectedOutput,
        quantity: expectedOutput.quantity * outputPerCraft,
        guaranteedQuantity: expectedOutput.guaranteedQuantity * producerGuaranteed,
      }));
      const craftedOutput = craftedOutputs.find((candidate) => candidate.id === String(target.id) && candidate.kind === target.kind);
      const routeType = routeTypeForItemListOutput(recipe, craftedOutput);
      const gathering = routeType === "gathering" || routeType === "gathering-byproduct";
      const gatheringSkill = recipeSkillName(recipe);
      const resourceHealth = Math.max(0, toNumber(recipe?.resourceHealth)) || null;
      const completionYield = (recipe?.resourceCompletionOutputs ?? [])
        .filter((output) => output.outputKey === recipeKey(target.kind, target.id))
        .reduce((sum, output) => sum + (Math.max(0, toNumber(output.quantity)) * Math.max(0, toNumber(output.occurrenceRate, 1))), 0);
      const expectedPerProgress = yieldQuantity * outputPerCraft;
      const expectedPerResource = gathering && resourceHealth
        ? (expectedPerProgress * resourceHealth) + completionYield
        : null;
      const effectiveExpectedYield = gathering && resourceHealth
        ? expectedPerResource / resourceHealth
        : expectedPerProgress;
      const probabilistic = outputPerCraft !== producerGuaranteed
        || (craftedOutput?.guaranteedQuantity ?? 0) + 1e-9 < (craftedOutput?.quantity ?? 0);
      const probabilityUnavailable = craftedOutput?.probabilityStatus === "unavailable";
      const probabilityStatus = probabilityUnavailable ? "unavailable" : probabilistic ? "expected" : "guaranteed";
      recipes.push({
        ...recipe,
        id: `possibility:${recipeId(recipe)}:${recipeKey(target.kind, target.id)}`,
        name: `${recipeLabel(recipe)} -> ${target.name}`,
        craftedItemStacks: craftedOutputs.map((craftedOutput) => ({
          item_id: craftedOutput.id,
          item_type: craftedOutput.kind === "cargo" ? "cargo" : "item",
          quantity: craftedOutput.quantity,
          guaranteedQuantity: craftedOutput.guaranteedQuantity,
        })),
        craftedItems: craftedOutputs,
        consumedItemStacks: recipeInputs(recipe),
        consumedItems: Array.isArray(recipe?.consumedItems) ? recipe.consumedItems : [],
        sourceOutputKey: sourceKey,
        sourceOutput: outputTarget,
        routeType,
        gatheringSkill: gathering ? gatheringSkill : null,
        producer: outputTarget,
        producerRecipe: {
          id: recipeId(recipe),
          name: recipeLabel(recipe),
          buildingName: recipe.buildingName ?? recipe.building_name ?? null,
          skillName: gatheringSkill || null,
        },
        isExpectedYield: true,
        isProbabilistic: probabilityUnavailable || probabilistic,
        probabilityStatus,
        expectedYield: probabilityUnavailable ? null : effectiveExpectedYield,
        expectedPerProgress: probabilityUnavailable ? null : expectedPerProgress,
        expectedPerResource: probabilityUnavailable ? null : expectedPerResource,
        resourceHealth,
        dropChance: craftedOutput?.dropChance ?? null,
        dropQuantity: craftedOutput?.dropQuantity ?? null,
        guaranteedYield: probabilityUnavailable ? null : craftedOutput?.guaranteedQuantity ?? 0,
        gatheringSource: recipe.gatheringSource ?? null,
      });
    }
  }
  return recipes;
}

export function recipesForTarget(detail, target, detailsByKey = null) {
  const recipes = [...directRecipesForTarget(detail, target), ...possibilityRecipesForTarget(target, detailsByKey)];
  return recipes.sort((a, b) => {
    const gatheringOrder = Number(routeIsGathering(b)) - Number(routeIsGathering(a));
    return gatheringOrder || recipeSortScore(a, target, detailsByKey) - recipeSortScore(b, target, detailsByKey);
  });
}

function fishingRouteFamily(item) {
  const tag = String(item?.tag ?? "").toLowerCase();
  if (tag.includes("ocean fish")) return "ocean";
  if (tag.includes("lake fish")) return "lake";
  return null;
}

function guaranteedTargetYield(recipe, target) {
  const output = recipeOutputs(recipe).find((entry) => stackMatches(entry, target));
  const guaranteed = output?.guaranteedQuantity ?? output?.guaranteed_quantity;
  if (recipe?.isExpectedYield === true && guaranteed == null) return 0;
  const minimum = toNumber(guaranteed ?? output?.quantityMin ?? output?.minQuantity ?? output?.quantity);
  return Number.isFinite(minimum) && minimum > 0 ? minimum : 0;
}

function recipeLabel(recipe) {
  return String(recipe?.label ?? recipe?.name ?? recipe?.recipeName ?? recipeId(recipe) ?? "Recipe");
}

function recipeId(recipe) {
  return String(recipe?.id ?? recipe?.name ?? "");
}

function recipeMatchesOverride(recipe, overrideId) {
  const selected = String(overrideId ?? "").trim();
  if (!selected) return false;
  return recipeId(recipe) === selected || String(recipe?.recipeKey ?? recipe?.catalogRecipeKey ?? "") === selected;
}

function recipeIsSelectable(recipe, blockedKeys = []) {
  const blocked = new Set(blockedKeys);
  return !recipeInputs(recipe).some((input) => blocked.has(recipeKey(stackKind(input), stackId(input))));
}

function selectedRecipeForTarget(recipes, overrideId, blockedKeys = []) {
  const overridden = recipes.find((recipe) => recipeMatchesOverride(recipe, overrideId));
  if (overridden && recipeIsSelectable(overridden, blockedKeys)) return overridden;
  return recipes.find((recipe) => !recipeLooksTransportRoute(recipe) && recipeIsSelectable(recipe, blockedKeys)) ?? null;
}

function mergeDetailTarget(detail, target) {
  const detailed = detailTarget(detail, target);
  return { ...target, ...detailed, quantity: target.quantity };
}

function enrichDisplayFromDetails(display, detailsByKey) {
  const detail = detailsByKey.get(recipeKey(display.kind, display.id));
  if (!detail) return display;
  const detailed = detailTarget(detail, display);
  return { ...display, ...detailed, id: display.id, kind: display.kind, itemType: itemTypeFromKind(display.kind) };
}

function stackDisplay(stack, displays, index) {
  const display = Array.isArray(displays) ? displays[index] ?? {} : {};
  const kind = stackKind(stack);
  const item = {
    id: stackId(stack),
    kind,
    itemType: itemTypeFromKind(kind),
    name: String(display.name ?? stack.name ?? `Item #${stackId(stack)}`),
    tier: normalizedTier(display.tier ?? stack.tier),
    rarityStr: display.rarityStr ?? display.rarity ?? stack.rarityStr ?? stack.rarity ?? null,
    tag: display.tag ?? stack.tag ?? null,
    iconAssetName: display.iconAssetName ?? stack.iconAssetName ?? null,
  };
  const collectedIdentity = COLLECTED_ANIMAL_CARGO_IDENTITIES.get(recipeKey(item.kind, item.id));
  return collectedIdentity ? { ...item, ...collectedIdentity } : item;
}

function addRequired(map, target, quantity, section) {
  const key = recipeKey(target.kind, target.id);
  const current = map.get(key) ?? {
    key,
    id: target.id,
    kind: target.kind,
    itemType: itemTypeFromKind(target.kind),
    name: target.name,
    tier: target.tier ?? null,
    rarityStr: target.rarityStr ?? null,
    tag: target.tag ?? null,
    iconAssetName: target.iconAssetName ?? null,
    section: section || sectionForMaterial(target, null),
    required: 0,
  };
  current.required += quantity;
  if (!current.section || current.section === "Other") current.section = section || sectionForMaterial(target, null);
  map.set(key, current);
}

function sectionForMaterial(material, recipe) {
  const skill = recipe?.levelRequirements?.[0]?.skill?.name ?? recipe?.skillName;
  return skill ? String(skill) : "Other";
}

function sectionOverrideKeyForItem(item) {
  return plannerOverrideKeyFor(item, recipeKey(item?.kind, item?.id));
}

function recipeExpansionIsSelectable(recipe, blockedKeys, detailsByKey, routeOverrides, depth = 0, maxDepth = 64, memo = new Map()) {
  if (!recipeIsSelectable(recipe, blockedKeys) || depth >= maxDepth) return false;
  const memoKey = JSON.stringify({
    route: recipeId(recipe),
    outputs: recipeOutputs(recipe).map((output) => recipeKey(stackKind(output), stackId(output))).sort(),
    inputs: recipeInputs(recipe).map((input) => recipeKey(stackKind(input), stackId(input))).sort(),
    blocked: [...blockedKeys].sort(),
    depth,
  });
  if (memo.has(memoKey)) return memo.get(memoKey);
  memo.set(memoKey, false);
  for (const [index, input] of recipeInputs(recipe).entries()) {
    const inputKey = recipeKey(stackKind(input), stackId(input));
    if (blockedKeys.includes(inputKey)) return false;
    const detail = detailsByKey.get(inputKey);
    if (!detail) continue;
    const material = mergeDetailTarget(detail, stackDisplay(input, recipe.consumedItems, index));
    const recipes = recipesForTarget(detail, material, detailsByKey);
    if (!recipes.length) continue;
    const nextBlockedKeys = [...blockedKeys, inputKey];
    const productionRecipes = recipes.filter((candidate) => !recipeLooksTransportRoute(candidate));
    if (!productionRecipes.length) continue;
    const overridden = productionRecipes.find((candidate) => recipeMatchesOverride(candidate, routeOverrides[inputKey]));
    if (overridden && recipeExpansionIsSelectable(overridden, nextBlockedKeys, detailsByKey, routeOverrides, depth + 1, maxDepth, memo)) continue;
    if (!productionRecipes.some((candidate) => candidate !== overridden
      && recipeExpansionIsSelectable(candidate, nextBlockedKeys, detailsByKey, routeOverrides, depth + 1, maxDepth, memo))) return false;
  }
  memo.set(memoKey, true);
  return true;
}

function selectedViableRecipeForTarget(recipes, overrideId, blockedKeys, detailsByKey, routeOverrides, memo = new Map()) {
  const overridden = recipes.find((recipe) => recipeMatchesOverride(recipe, overrideId));
  if (overridden && recipeIsSelectable(overridden, blockedKeys)) return overridden;
  return recipes.find((recipe) => !recipeLooksTransportRoute(recipe)
    && recipeExpansionIsSelectable(recipe, blockedKeys, detailsByKey, routeOverrides, 0, 64, memo))
    ?? selectedRecipeForTarget(recipes, overrideId, blockedKeys);
}

function routeAlternativesForUi(recipes, blockedKeys, detailsByKey, routeOverrides, memo = new Map()) {
  return recipes.map((recipe) => ({
    ...recipe,
    isSelectable: recipeExpansionIsSelectable(recipe, blockedKeys, detailsByKey, routeOverrides, 0, 64, memo),
  }));
}

function sourceRoutesForTarget(target, detailsByKey, routeOverrides, gatheredItemKeys, viabilityMemo = new Map()) {
  const targetKey = recipeKey(target.kind, target.id);
  const detail = detailsByKey.get(targetKey);
  if (!detail) return [];
  const normalizedTarget = mergeDetailTarget(detail, target);
  const key = recipeKey(normalizedTarget.kind, normalizedTarget.id);
  const recipes = recipesForTarget(detail, normalizedTarget, detailsByKey);
  const selected = selectedViableRecipeForTarget(recipes, routeOverrides[key], [key], detailsByKey, routeOverrides, viabilityMemo);
  if (!selected) return [];
  const visibleRecipes = routeAlternativesForUi(recipes, [key], detailsByKey, routeOverrides, viabilityMemo);
  const gatheringSources = visibleRecipes
    .filter(routeIsGathering)
    .map((recipe) => ({
      label: recipe.gatheringSource?.label ?? recipe.producer?.tag ?? recipe.producer?.name ?? "Gathering",
      tag: recipe.gatheringSource?.tag ?? recipe.producer?.tag ?? null,
      expectedYield: toNumber(recipe.expectedYield),
    }))
    .filter((source, index, sources) => sources.findIndex((candidate) => candidate.label === source.label) === index)
    .sort((a, b) => (a.label === "Sand" ? -1 : b.label === "Sand" ? 1 : a.label.localeCompare(b.label)));
  return [{
    id: recipeId(selected),
    recipeName: gatheringSources.length > 1 ? `Gather from ${gatheringSources.map((source) => source.label).join(" or ")}` : recipeLabel(selected),
    ...routeMetadata(selected, normalizedTarget),
    output: normalizedTarget,
    inputs: recipeInputs(selected).map((input, index) => ({
      ...enrichDisplayFromDetails(stackDisplay(input, selected.consumedItems, index), detailsByKey),
      quantity: toNumber(input.quantity),
      quantityPerCraft: toNumber(input.quantity),
    })),
    buildingName: selected.buildingName ?? selected.building_name ?? null,
    selectedRecipeId: recipeId(selected),
    alternatives: visibleRecipes.map((alternative) => ({
      id: recipeId(alternative),
      label: recipeLabel(alternative),
      ...routeMetadata(alternative, normalizedTarget),
      isSelectable: alternative.isSelectable !== false,
      buildingName: alternative.buildingName ?? alternative.building_name ?? null,
      inputs: recipeInputs(alternative).map((input, index) => ({
        ...enrichDisplayFromDetails(stackDisplay(input, alternative.consumedItems, index), detailsByKey),
        quantity: toNumber(input.quantity),
      })),
    })),
    gatheringSources,
  }];
}

function buildRequirementMapPass(targets, detailsByKey, routeOverrides, gatheredItemKeys = new Set(), multipliers = {}, effectiveStockTotals = new Map(), viabilityMemo = new Map()) {
  const required = new Map();
  const steps = [];
  const warnings = [];
  const usages = new Map();
  const remainingSupply = new Map([...effectiveStockTotals.entries()].map(([key, value]) => [key, Math.max(0, toNumber(value?.total))]));

  function resolve(target, quantity, stack, parentRecipe) {
    const key = recipeKey(target.kind, target.id);
    const detail = detailsByKey.get(key);
    if (stack.includes(key)) return;
    const normalizedTarget = detail ? mergeDetailTarget(detail, target) : target;
    if (gatheredItemKeys.has(key)) {
      const availableSupply = remainingSupply.get(key) ?? 0;
      const allocatedSupply = Math.min(quantity, availableSupply);
      remainingSupply.set(key, availableSupply - allocatedSupply);
      addRequired(required, normalizedTarget, quantity, sectionForMaterial(normalizedTarget, parentRecipe));
      return;
    }
    if (!detail || stack.length > 14) {
      addRequired(required, target, quantity, sectionForMaterial(target, parentRecipe));
      if (!detail) warnings.push(`No recipe data was available for ${target.name}; it was treated as a source material.`);
      return;
    }
    const availableSupply = remainingSupply.get(key) ?? 0;
    const allocatedSupply = Math.min(quantity, availableSupply);
    remainingSupply.set(key, availableSupply - allocatedSupply);
    const quantityToCraft = Math.max(0, quantity - allocatedSupply);
    const recipes = recipesForTarget(detail, normalizedTarget, detailsByKey);
    const blockedKeys = [...stack, key];
    const selected = selectedViableRecipeForTarget(recipes, routeOverrides[key], blockedKeys, detailsByKey, routeOverrides, viabilityMemo);
    addRequired(required, normalizedTarget, quantity, sectionForMaterial(normalizedTarget, selected ?? parentRecipe));
    if (quantityToCraft <= 0) return;
    if (!selected) {
      if (recipes.some(recipeLooksTransportRoute)) {
        warnings.push(`Only transport routes are available for ${key}; no package conversion was selected automatically.`);
      }
      return;
    }
    const metadata = routeMetadata(selected, normalizedTarget);
    if (metadata.probabilityStatus === "unavailable") {
      warnings.push(`Validated output rate unavailable for ${key}; producer route retained without quantity expansion.`);
      return;
    }
    const output = recipeOutputs(selected).find((stackItem) => stackMatches(stackItem, normalizedTarget));
    const rawOutputPerCraft = toNumber(metadata.expectedYield ?? output?.quantity ?? selected.outputQuantity) || 1;
    const outputPerCraft = Math.max(0.0001, rawOutputPerCraft);
    const unbufferedCraftCount = Math.ceil(quantityToCraft / outputPerCraft);
    const multiplier = selected.isProbabilistic === true ? multipliers[key]?.multiplier ?? 1 : 1;
    const craftCount = Math.ceil(quantityToCraft * multiplier / outputPerCraft);
    const section = sectionForMaterial(normalizedTarget, selected);
    const visibleRecipes = routeAlternativesForUi(recipes, blockedKeys, detailsByKey, routeOverrides, viabilityMemo);
    const alternatives = visibleRecipes.map((recipe) => ({
      id: recipeId(recipe),
      label: String(recipe.name ?? normalizedTarget.name),
      ...routeMetadata(recipe, normalizedTarget),
      isSelectable: recipe.isSelectable !== false,
      buildingName: recipe.buildingName ?? recipe.building_name ?? null,
      inputs: recipeInputs(recipe).map((input, index) => ({
        ...enrichDisplayFromDetails(stackDisplay(input, recipe.consumedItems, index), detailsByKey),
        quantity: toNumber(input.quantity),
        quantityPerCraft: toNumber(input.quantity),
      })),
    }));
    const rawInputs = recipeInputs(selected).map((input, index) => ({ input, index }));
    const siblingKeys = new Set(rawInputs.map(({ input }) => recipeKey(stackKind(input), stackId(input))));
    rawInputs.sort((a, b) => {
      const score = ({ input, index }) => {
        const material = enrichDisplayFromDetails(stackDisplay(input, selected.consumedItems, index), detailsByKey);
        const detail = detailsByKey.get(recipeKey(material.kind, material.id));
        if (!detail) return 1;
        const recipes = recipesForTarget(detail, material, detailsByKey);
        const producer = selectedViableRecipeForTarget(
          recipes,
          routeOverrides[recipeKey(material.kind, material.id)],
          [...stack, key, recipeKey(material.kind, material.id)],
          detailsByKey,
          routeOverrides,
          viabilityMemo,
        );
        return producer && recipeOutputs(producer).some((candidate) => siblingKeys.has(recipeKey(stackKind(candidate), stackId(candidate))) && !stackMatches(candidate, material)) ? 0 : 1;
      };
      return score(a) - score(b) || a.index - b.index;
    });
    const inputs = rawInputs.map(({ input, index }) => {
      const material = enrichDisplayFromDetails(stackDisplay(input, selected.consumedItems, index), detailsByKey);
      const requiredQuantity = toNumber(input.quantity) * craftCount;
      const usageKey = recipeKey(material.kind, material.id);
      const currentUsages = usages.get(usageKey) ?? [];
      currentUsages.push({
        outputKey: key,
        output: { ...normalizedTarget, quantity: craftCount * outputPerCraft },
        recipeName: String(selected.name ?? normalizedTarget.name),
        selectedRecipeId: recipeId(selected),
        alternatives,
        requiredQuantity,
        quantityPerCraft: toNumber(input.quantity),
        craftCount,
        unbufferedCraftCount,
        multiplier,
        buildingName: selected.buildingName ?? null,
        section,
      });
      usages.set(usageKey, currentUsages);
      resolve(material, requiredQuantity, [...stack, key], selected);
      return { ...material, quantity: requiredQuantity };
    });
    steps.push({
      id: recipeId(selected),
      recipeName: String(selected.name ?? normalizedTarget.name),
      ...metadata,
      output: { ...normalizedTarget, quantity: craftCount * outputPerCraft },
      inputs,
      craftCount,
      unbufferedCraftCount,
      multiplier,
      outputPerCraft,
      unbufferedExpectedEffort: metadata.yieldBasis === "per_progress"
        ? unbufferedCraftCount
        : unbufferedCraftCount * Math.max(1, toNumber(selected.actionsRequired)),
      expectedEffort: metadata.yieldBasis === "per_progress"
        ? craftCount
        : craftCount * Math.max(1, toNumber(selected.actionsRequired)),
      expectedResourceEquivalents: metadata.yieldBasis === "per_progress" && metadata.resourceHealth
        ? craftCount / metadata.resourceHealth
        : null,
      section,
      buildingName: selected.buildingName ?? null,
      alternatives: visibleRecipes.map((recipe) => ({
        id: recipeId(recipe),
        label: recipeLabel(recipe),
        ...routeMetadata(recipe, normalizedTarget),
        isSelectable: recipe.isSelectable !== false,
        buildingName: recipe.buildingName ?? recipe.building_name ?? null,
        inputs: recipeInputs(recipe).map((input, index) => ({
          ...enrichDisplayFromDetails(stackDisplay(input, recipe.consumedItems, index), detailsByKey),
          quantity: toNumber(input.quantity),
        })),
      })),
      selectedRecipeId: recipeId(selected),
    });
  }

  for (const target of targets) resolve(target, target.quantity, [], null);
  return { required, steps, usages, warnings: [...new Set(warnings)] };
}

function buildRequirementMap(targets, detailsByKey, routeOverrides, gatheredItemKeys = new Set(), multipliers = {}, effectiveStockTotals = new Map(), viabilityMemo = new Map()) {
  return buildRequirementMapPass(targets, detailsByKey, routeOverrides, gatheredItemKeys, multipliers, effectiveStockTotals, viabilityMemo);
}


function catalogKeyParts(key) {
  const [rawKind, ...rest] = String(key ?? "").split(":");
  const id = rest.join(":").trim();
  return { kind: normalizeKind(rawKind), id };
}


function catalogEntityDisplay(entity, fallback = {}) {
  const kind = normalizeKind(entity?.kind ?? fallback.kind ?? fallback.itemType ?? fallback.item_type);
  const id = String(entity?.targetId ?? entity?.id ?? fallback.id ?? fallback.itemId ?? fallback.targetId ?? "").trim();
  return {
    id,
    itemType: itemTypeFromKind(kind),
    kind,
    name: String(entity?.name ?? fallback.name ?? fallback.itemName ?? `${kind === "cargo" ? "Cargo" : "Item"} #${id}`),
    tag: entity?.tag ?? fallback.tag ?? null,
    tier: normalizedTier(entity?.tier ?? fallback.tier),
    rarityStr: entity?.rarity ?? fallback.rarityStr ?? fallback.rarity ?? null,
    iconAssetName: entity?.iconAssetName ?? fallback.iconAssetName ?? null,
  };
}

function catalogRouteId(recipe) {
  const value = String(recipe?.recipeKey ?? "").trim();
  if (value.startsWith("recipe-hash:")) return recipe?.name ? String(recipe.name) : value.slice("recipe-hash:".length);
  if (value.startsWith("recipe:")) return value.slice("recipe:".length);
  const marker = ":recipe:";
  const index = value.indexOf(marker);
  const suffix = index >= 0 ? value.slice(index + marker.length) : value;
  return /^[a-f0-9]{12}$/i.test(suffix) && recipe?.name ? String(recipe.name) : suffix;
}

function catalogPlannerRecipeName(repository, recipe) {
  const rawName = String(recipe?.name ?? "Recipe").trim() || "Recipe";
  const links = [...(recipe?.inputs ?? []), ...(recipe?.outputs ?? [])];
  if (links.some((link) => normalizeKind(link.kind) === "cargo")) return rawName;
  if (!/\b(pack|package|unpack|packed|transport|bundle|crate)\b/i.test(rawName)) return rawName;
  const primary = recipe?.outputs?.find((output) => output.isPrimaryOutput) ?? recipe?.outputs?.[0];
  const entity = primary?.outputKey ? repository.getEntity(primary.outputKey) : null;
  return entity?.name ? `Craft ${entity.name}` : rawName;
}

function catalogStack(link = {}) {
  const kind = normalizeKind(link.kind);
  const rawQuantity = toNumber(link.quantity);
  const occurrenceRate = link.occurrenceRate == null ? 1 : Math.max(0, toNumber(link.occurrenceRate));
  const expectedQuantity = rawQuantity * occurrenceRate;
  return {
    item_id: String(link.targetId ?? link.id ?? ""),
    item_type: kind === "cargo" ? "cargo" : "item",
    quantity: expectedQuantity,
    rawQuantity,
    occurrenceRate,
    yieldBasis: link.yieldBasis ?? "per_craft",
    guaranteedQuantity: link.guaranteedQuantity == null
      ? occurrenceRate === 1 ? rawQuantity : 0
      : Math.max(0, toNumber(link.guaranteedQuantity)),
  };
}

function catalogLinkedDisplay(repository, link = {}, warnings, fallback = {}) {
  const key = link.inputKey ?? link.outputKey ?? recipeKey(link.kind, link.targetId);
  const entity = repository.getEntity(key);
  if (!entity) warnings.add(`Local catalog identity is missing for ${key}; planner used an id-only fallback.`);
  return catalogEntityDisplay(entity, { ...fallback, id: link.targetId, kind: link.kind });
}

function catalogPlannerRecipe(repository, recipe, warnings) {
  const outputs = (recipe.outputs ?? []).map((output) => catalogStack(output));
  const outputDisplays = (recipe.outputs ?? []).map((output) => catalogLinkedDisplay(repository, output, warnings));
  const inputs = (recipe.inputs ?? []).map((input) => catalogStack(input));
  const inputDisplays = (recipe.inputs ?? []).map((input) => catalogLinkedDisplay(repository, input, warnings));
  const id = catalogRouteId(recipe);
  const name = catalogPlannerRecipeName(repository, recipe);
  const gathering = recipe.activityKind === "gathering";
  const gatheringMode = gathering && recipe.gatheringMode === "prospecting" ? "prospecting" : "ordinary";
  const resource = recipe.resourceId && gatheringMode !== "prospecting" ? repository.getResource(recipe.resourceId) : null;
  const resourceCompletionOutputs = recipe.resourceId && gatheringMode !== "prospecting"
    ? repository.listResourceCompletionOutputs(recipe.resourceId)
    : [];
  const probabilistic = outputs.some((output) => output.guaranteedQuantity + 1e-9 < output.quantity);
  return {
    id,
    recipeKey: recipe.recipeKey,
    catalogRecipeKey: recipe.recipeKey,
    name,
    buildingName: recipe.stationName ?? null,
    stationName: recipe.stationName ?? null,
    skillName: recipe.skillName ?? null,
    activityKind: recipe.activityKind === "gathering" ? "gathering" : "craft",
    gatheringMode,
    isPassive: recipe.isPassive === true,
    isTransportRoute: recipe.isTransportRoute === true,
    actionsRequired: Math.max(0, toNumber(recipe.actionCount)),
    resourceId: recipe.resourceId ?? null,
    resourceHealth: resource?.maxHealth ?? null,
    resourceCompletionOutputs,
    gatheringSource: gathering && resource ? { tag: resource.tag, label: resource.name, skill: recipe.skillName ?? null } : null,
    isProbabilistic: probabilistic,
    probabilityStatus: probabilistic ? "expected" : "guaranteed",
    craftedItemStacks: outputs,
    craftedItems: outputDisplays,
    consumedItemStacks: inputs,
    consumedItems: inputDisplays,
    levelRequirements: recipe.skillName ? [{ skill: { name: recipe.skillName }, level: 0 }] : [],
  };
}

function catalogByproductPossibility(repository, row, warnings, probabilityStatus = null) {
  const outputKey = row.outputKey ?? recipeKey(row.kind, row.targetId);
  const entity = repository.getEntity(outputKey);
  if (!entity) warnings.add(`Local catalog identity is missing for ${outputKey}; planner used an id-only fallback.`);
  const targetItem = catalogEntityDisplay(entity, { id: row.targetId, kind: row.kind });
  return {
    targetId: targetItem.id,
    itemType: targetItem.itemType,
    targetItem,
    quantity: toNumber(row.quantity),
    quantityIsExpected: true,
    chance: row.chance == null ? 1 : toNumber(row.chance),
    dropQuantity: toNumber(row.chance) > 0 ? toNumber(row.quantity) / toNumber(row.chance) : 0,
    guaranteedQuantity: Math.max(0, toNumber(row.guaranteedQuantity)),
    isCargo: targetItem.kind === "cargo",
    probabilityStatus: probabilityStatus === "unavailable" ? "unavailable" : null,
  };
}

function catalogGatheringOutputSource(producer) {
  const tag = String(producer?.tag ?? "").trim();
  if (tag === "Sand Output") return { tag, label: "Sand", skill: "Mining" };
  if (tag === "Clay Output") return { tag, label: "Clay", skill: "Mining" };
  return null;
}

function catalogGatheringOutputRecipe(row, producerTarget, source) {
  return {
    id: `gathering-output:${row.producerKey}`,
    name: `Gather ${source.label}`,
    skillName: source.skill,
    activityKind: "gathering",
    gatheringSource: source,
    craftedItemStacks: [{ item_id: producerTarget.id, item_type: producerTarget.kind === "cargo" ? "cargo" : "item", quantity: 1 }],
    craftedItems: [producerTarget],
    consumedItemStacks: [],
    consumedItems: [],
    levelRequirements: [{ skill: { name: source.skill }, level: 0 }],
  };
}

function catalogResourceCompletionRecipe(recipe, target) {
  const resourceHealth = Math.max(0, toNumber(recipe?.resourceHealth));
  const completionOutput = recipe?.completionOutput ?? {};
  const expectedPerResource = Math.max(0, toNumber(completionOutput.quantity))
    * Math.max(0, toNumber(completionOutput.occurrenceRate, 1));
  if (!(resourceHealth > 0) || !(expectedPerResource > 0)) return null;
  const expectedPerProgress = expectedPerResource / resourceHealth;
  return {
    id: `resource-completion:${catalogRouteId(recipe)}:${recipeKey(target.kind, target.id)}`,
    recipeKey: recipe.recipeKey,
    catalogRecipeKey: recipe.recipeKey,
    name: `${recipe.resourceName ?? "Resource"} completion`,
    skillName: recipe.skillName ?? null,
    activityKind: "gathering",
    gatheringSource: { label: recipe.resourceName ?? "Resource", skill: recipe.skillName ?? null },
    actionsRequired: 1,
    resourceId: recipe.resourceId ?? null,
    resourceHealth,
    expectedPerProgress,
    expectedPerResource,
    isProbabilistic: true,
    probabilityStatus: "expected",
    craftedItemStacks: [{
      item_id: target.id,
      item_type: target.kind === "cargo" ? "cargo" : "item",
      quantity: expectedPerProgress,
      rawQuantity: expectedPerResource,
      occurrenceRate: 1,
      yieldBasis: "per_progress",
      guaranteedQuantity: 0,
    }],
    craftedItems: [target],
    consumedItemStacks: [],
    consumedItems: [],
    levelRequirements: recipe.skillName ? [{ skill: { name: recipe.skillName }, level: 0 }] : [],
  };
}

function localCatalogDetail(repository, key, fallbackTarget, byproductRows, warnings, probabilityStatus = null) {
  const { kind, id } = catalogKeyParts(key);
  const entity = repository.getEntity(key);
  const recipes = repository.listProducerRecipesForOutput(key);
  const resourceCompletionRecipes = typeof repository.listResourceCompletionRecipesForOutput === "function"
    ? repository.listResourceCompletionRecipesForOutput(key)
    : [];
  if (!entity && recipes.length === 0 && byproductRows.length === 0 && resourceCompletionRecipes.length === 0) return null;
  if (!entity) warnings.add(`Local catalog identity is missing for ${key}; planner used an id-only fallback.`);
  const source = catalogEntityDisplay(entity, { ...fallbackTarget, id, kind });
  const directRecipeKeys = new Set(recipes.map((recipe) => recipe.recipeKey));
  const completionRecipes = resourceCompletionRecipes
    .filter((recipe) => !directRecipeKeys.has(recipe.recipeKey))
    .map((recipe) => catalogResourceCompletionRecipe(recipe, source))
    .filter(Boolean);
  return {
    [kind === "cargo" ? "cargo" : "item"]: source,
    craftingRecipes: [
      ...recipes.map((recipe) => catalogPlannerRecipe(repository, recipe, warnings)),
      ...completionRecipes,
    ],
    extractionRecipes: [],
    recipesUsingItem: [],
    itemListPossibilities: byproductRows.map((row) => catalogByproductPossibility(repository, row, warnings, probabilityStatus)),
  };
}

export function collectLocalCatalogCraftPlanDetails(
  repository,
  targets,
  routeOverrides = {},
  maxDepth = 64,
  _legacyGatheredItemKeys = [],
  { requireValidatedProbabilities = false } = {},
) {
  const detailsByKey = new Map();
  const warnings = new Set();
  const byproductsByProducerKey = new Map();
  const visiting = new Set();
  const completed = new Set();
  const probabilitySnapshotAvailable = Boolean(repository.getProbabilitySnapshot?.());
  const probabilityStatus = requireValidatedProbabilities && !probabilitySnapshotAvailable ? "unavailable" : null;
  if (probabilityStatus === "unavailable") {
    warnings.add("Validated probability snapshot unavailable; producer routes remain visible but yield calculations are disabled.");
  }

  function addByproductProducer(row) {
    if (!row?.producerKey) return;
    const rows = byproductsByProducerKey.get(row.producerKey) ?? [];
    if (!rows.some((existing) => existing.outputKey === row.outputKey && existing.targetId === row.targetId)) rows.push(row);
    byproductsByProducerKey.set(row.producerKey, rows);
  }

  function setDetail(key, fallbackTarget = {}) {
    const existing = detailsByKey.get(key);
    if (existing) {
      existing.itemListPossibilities = (byproductsByProducerKey.get(key) ?? [])
        .map((row) => catalogByproductPossibility(repository, row, warnings, probabilityStatus));
      return existing;
    }
    const detail = localCatalogDetail(
      repository,
      key,
      fallbackTarget,
      byproductsByProducerKey.get(key) ?? [],
      warnings,
      probabilityStatus,
    );
    if (detail && probabilityStatus === "unavailable") {
      detail.craftingRecipes = detail.craftingRecipes.map((recipe) => recipe.isProbabilistic === true ? {
        ...recipe,
        probabilityStatus: "unavailable",
        expectedYield: null,
        expectedPerProgress: null,
        expectedPerResource: null,
        guaranteedYield: null,
      } : recipe);
    }
    if (detail) detailsByKey.set(key, detail);
    return detail;
  }

  function visit(rawTarget, depth, isRoot = false) {
    const target = normalizeTarget({ ...rawTarget, quantity: rawTarget?.quantity ?? 1 });
    if (!target) return;
    const key = recipeKey(target.kind, target.id);
    if (depth > maxDepth) {
      warnings.add(`Local catalog recursion limit reached while loading ${key}.`);
      return;
    }
    if (visiting.has(key)) return;
    const byproductProducers = repository.listByproductProducersForOutput(key);
    for (const row of byproductProducers) addByproductProducer(row);
    if (completed.has(key)) {
      setDetail(key, target);
      return;
    }
    visiting.add(key);

    const detail = setDetail(key, target);
    if (!detail && byproductProducers.length === 0) {
      warnings.add(`Local catalog data is missing for ${key}; planner treated it as a source material.`);
      visiting.delete(key);
      return;
    }
    if (isRoot && detail && directRecipesForTarget(detail, mergeDetailTarget(detail, target)).length === 0 && byproductProducers.length === 0) {
      warnings.add(`Local catalog has no producer recipe or byproduct route for ${key}; planner treated it as a source material.`);
    }

    let usableByproductProducers = 0;
    for (const row of byproductProducers) {
      const producerTarget = catalogEntityDisplay(row.producer, { id: row.producer?.targetId, kind: row.producer?.kind });
      const producerDetail = setDetail(row.producerKey, producerTarget);
      let producerRecipes = producerDetail
        ? directRecipesForTarget(producerDetail, mergeDetailTarget(producerDetail, producerTarget))
        : [];
      const gatheringSource = catalogGatheringOutputSource(row.producer);
      if (producerDetail && producerRecipes.length === 0 && gatheringSource) {
        producerDetail.craftingRecipes.push(catalogGatheringOutputRecipe(row, producerTarget, gatheringSource));
        producerRecipes = directRecipesForTarget(producerDetail, mergeDetailTarget(producerDetail, producerTarget));
      }
      if (producerRecipes.length > 0) usableByproductProducers += 1;
    }
    if (byproductProducers.length > 0 && usableByproductProducers === 0) {
      warnings.add(`Local catalog byproduct routes are incomplete for ${target.name} (${key}); planner retained verified direct routes. ${byproductProducers.length} producer candidate${byproductProducers.length === 1 ? "" : "s"} require catalog data.`);
    }

    const currentDetail = detailsByKey.get(key);
    if (!currentDetail) {
      visiting.delete(key);
      return;
    }
    const normalizedTarget = mergeDetailTarget(currentDetail, target);
    const recipes = recipesForTarget(currentDetail, normalizedTarget, detailsByKey);
    const selected = selectedRecipeForTarget(recipes, routeOverrides[key], [...visiting]);
    if (selected) {
      const inputs = recipeInputs(selected);
      for (let index = 0; index < inputs.length; index += 1) {
        visit(stackDisplay(inputs[index], selected.consumedItems, index), depth + 1, false);
      }
    }
    completed.add(key);
    visiting.delete(key);
  }

  for (const target of targets ?? []) visit(target, 0, true);
  return { detailsByKey, warnings: [...warnings] };
}
export async function collectRecipeDetails(targets, fetchDetail, routeOverrides = {}, maxDepth = 14) {
  const details = new Map();
  const pending = new Set();

  async function visit(target, depth) {
    const key = recipeKey(target.kind, target.id);
    if (details.has(key) || pending.has(key) || depth > maxDepth) return;
    pending.add(key);
    let detail;
    try {
      detail = await fetchDetail(target);
    } catch {
      pending.delete(key);
      return;
    }
    pending.delete(key);
    details.set(key, detail);
    const normalizedTarget = mergeDetailTarget(detail, target);
    const recipes = recipesForTarget(detail, normalizedTarget, details);
    const selected = recipes.find((recipe) => recipeMatchesOverride(recipe, routeOverrides[key])) ?? recipes[0];
    if (!selected) return;
    const inputs = recipeInputs(selected);
    for (let index = 0; index < inputs.length; index += 1) {
      await visit(stackDisplay(inputs[index], selected.consumedItems, index), depth + 1);
    }
  }

  for (const target of targets ?? []) await visit(target, 0);
  return details;
}
function normalizeSourceItem(item) {
  const id = String(item?.itemId ?? item?.item_id ?? item?.outputItemId ?? item?.craftedItem?.[0]?.item_id ?? item?.id ?? "").trim();
  if (!id) return null;
  const kind = normalizeKind(item?.kind ?? item?.itemType ?? item?.item_type);
  const quantity = toNumber(item?.quantity ?? item?.qty ?? item?.amount);
  const guaranteedQuantity = item?.guaranteedQuantity ?? item?.guaranteed_quantity;
  return {
    key: recipeKey(kind, id),
    id,
    kind,
    quantity,
    guaranteedQuantity: guaranteedQuantity == null ? 0 : Math.max(0, toNumber(guaranteedQuantity)),
    name: item?.name == null ? `Item #${id}` : String(item.name),
    playerId: item?.playerId == null ? null : String(item.playerId),
    playerName: item?.playerName == null && item?.crafterName == null ? null : String(item.playerName ?? item.crafterName),
    buildingName: item?.buildingName == null ? null : String(item.buildingName),
    craftId: item?.craftId == null && item?.id == null ? null : String(item.craftId ?? item.id),
  };
}

function addSourceTotals(totals, sources, type, unavailable, quantityField = "quantity") {
  for (const source of sources ?? []) {
    if (source?.unavailable) {
      unavailable.push({ sourceId: String(source.sourceId ?? ""), label: String(source.label ?? type), type, error: String(source.error ?? "Unavailable") });
      continue;
    }
    for (const rawItem of source?.items ?? []) {
      const item = normalizeSourceItem(rawItem);
      const quantity = item?.[quantityField] ?? 0;
      if (!item || quantity <= 0) continue;
      const current = totals.get(item.key) ?? { total: 0, sources: [] };
      current.total += quantity;
      current.sources.push({
        sourceId: String(source.sourceId ?? ""),
        label: String(source.label ?? item.buildingName ?? type),
        type,
        quantity,
        expectedQuantity: item.quantity,
        guaranteedQuantity: item.guaranteedQuantity,
        playerId: source.playerId == null ? item.playerId : String(source.playerId),
        playerName: source.playerName == null ? item.playerName : String(source.playerName),
        buildingName: source.buildingName == null ? item.buildingName : String(source.buildingName),
        craftId: source.craftId == null ? item.craftId : String(source.craftId),
        status: source.status == null ? item.status : String(source.status),
        completed: source.completed == null ? item.completed === true : source.completed === true,
        passive: source.passive === true,
        sourceType: String(source.sourceType ?? type),
        locationUnknown: source.locationUnknown === true,
      });
      totals.set(item.key, current);
    }
  }
}

function countedActiveCraftTotals(expectedTotals, guaranteedTotals) {
  const totals = new Map();
  const keys = new Set([...expectedTotals.keys(), ...guaranteedTotals.keys()]);
  for (const key of keys) {
    const expected = Math.max(0, toNumber(expectedTotals.get(key)?.total));
    const guaranteed = Math.max(0, toNumber(guaranteedTotals.get(key)?.total));
    const total = Math.max(guaranteed, Math.floor(expected + 1e-9));
    totals.set(key, {
      total,
      guaranteedTotal: guaranteed,
      estimatedTotal: Math.max(0, total - guaranteed),
      sources: expectedTotals.get(key)?.sources ?? guaranteedTotals.get(key)?.sources ?? [],
    });
  }
  return totals;
}

function groupGatherNext(materials) {
  const grouped = new Map();
  for (const material of materials.filter((item) => item.missing > 0)) {
    const section = material.section || "Other";
    const items = grouped.get(section) ?? [];
    items.push(material);
    grouped.set(section, items);
  }
  return [...grouped.entries()]
    .map(([section, items]) => ({ section, items: items.sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name)).slice(0, 6) }))
    .sort((a, b) => (b.items[0]?.missing ?? 0) - (a.items[0]?.missing ?? 0) || a.section.localeCompare(b.section));
}

function pickPlannerItem(item) {
  return Object.fromEntries(["key", "id", "kind", "itemType", "name", "tag", "tier", "iconAssetName"]
    .filter((key) => item?.[key] != null)
    .map((key) => [key, item[key]]));
}

function routeStock(route, totals) {
  const key = recipeKey(route.input.kind, route.input.id);
  return totals.get(key)?.total ?? 0;
}

function routeStockSources(route, totals) {
  const key = recipeKey(route.input.kind, route.input.id);
  return totals.get(key)?.sources ?? [];
}

function unavailableFishingRoute() {
  return { available: false, reason: "Verified route unavailable" };
}

function addFishingCatalogWarning(warnings, message) {
  if (warnings instanceof Set) warnings.add(message);
  else if (Array.isArray(warnings)) warnings.push(message);
}

function normalizeFishingAlternatives(recipes, oil, detailsByKey, availableTotals, activeCraftTotals, warnings) {
  const routes = {
    ocean: unavailableFishingRoute(),
    lake: unavailableFishingRoute(),
  };
  for (const recipe of recipes) {
    const inputStack = recipeInputs(recipe)[0];
    if (!inputStack) continue;
    const input = enrichDisplayFromDetails(stackDisplay(inputStack, recipe.consumedItems, 0), detailsByKey);
    const family = fishingRouteFamily(input);
    const guaranteedYield = guaranteedTargetYield(recipe, oil);
    const expectedYield = Math.max(0, toNumber(recipe?.expectedYield));
    const planningYield = guaranteedYield > 0 ? guaranteedYield : expectedYield;
    if (!family) continue;
    if (planningYield <= 0) {
      addFishingCatalogWarning(warnings, `${family === "ocean" ? "Ocean" : "Lake"} Fish route to ${oil.name} has no positive yield in the local catalog.`);
      continue;
    }
    if (routes[family].available) continue;
    const route = {
      input: pickPlannerItem(input),
      inputQuantity: Math.max(1, toNumber(inputStack.quantity) || 1),
      recipeName: recipeLabel(recipe),
      buildingName: recipe.buildingName ?? recipe.building_name ?? null,
      selectedRecipeId: recipeId(recipe),
    };
    const active = activeCraftTotals.get(recipeKey(route.input.kind, route.input.id));
    const routeAlternatives = recipes.filter((alternative) => {
      const alternativeInput = recipeInputs(alternative)[0];
      if (!alternativeInput) return false;
      const display = enrichDisplayFromDetails(stackDisplay(alternativeInput, alternative.consumedItems, 0), detailsByKey);
      return fishingRouteFamily(display) === family;
    }).map((alternative) => ({
      id: recipeId(alternative),
      label: recipeLabel(alternative),
      ...routeMetadata(alternative),
      buildingName: alternative.buildingName ?? alternative.building_name ?? null,
      inputs: recipeInputs(alternative).map((stack, index) => ({
        ...enrichDisplayFromDetails(stackDisplay(stack, alternative.consumedItems, index), detailsByKey),
        quantity: toNumber(stack.quantity),
        quantityPerCraft: toNumber(stack.quantity),
      })),
    }));
    routes[family] = {
      available: true,
      ...route,
      guaranteedYield: planningYield,
      estimated: guaranteedYield <= 0,
      isProbabilistic: recipe.isProbabilistic === true,
      stockQuantity: routeStock(route, availableTotals),
      trackedQuantity: active?.total ?? 0,
      guaranteedTrackedQuantity: active?.guaranteedTotal ?? 0,
      estimatedTrackedQuantity: active?.estimatedTotal ?? 0,
      sources: routeStockSources(route, availableTotals),
      activeCraftSources: active?.sources ?? [],
      alternatives: routeAlternatives,
    };
  }
  return routes;
}

export function buildPersonalFishingView({ materials, detailsByKey, availableTotals, activeCraftTotals, gatheredItemKeys = new Set(), multipliers = {}, warnings, countEstimatedOutput = true }) {
  const fishOilMaterials = (materials ?? []).filter((item) => String(item?.tag ?? "").toLowerCase().includes("fish oil"));
  return { tiers: fishOilMaterials.map((oil) => {
    const alternatives = gatheredItemKeys.has(oil.key) ? [] : recipesForTarget(detailsByKey.get(oil.key), oil, detailsByKey);
    const routes = normalizeFishingAlternatives(alternatives, oil, detailsByKey, availableTotals, activeCraftTotals, warnings);
    const verifiedRoutes = Object.values(routes).filter((route) => route.available);
    const activeOil = activeCraftTotals.get(oil.key);
    const trackedOil = activeOil?.total ?? 0;
    const guaranteedTrackedOil = activeOil?.guaranteedTotal ?? 0;
    const countedTrackedOil = countEstimatedOutput ? trackedOil : guaranteedTrackedOil;
    const availableOilEquivalent = oil.available + countedTrackedOil + verifiedRoutes.reduce((total, route) => (
      total + (route.stockQuantity + (countEstimatedOutput ? route.trackedQuantity : route.guaranteedTrackedQuantity)) * route.guaranteedYield
    ), 0);
    const remainingOil = Math.max(0, oil.bufferedRequired - availableOilEquivalent);
    return {
      tier: oil.tier,
      outputKey: oil.key,
      output: pickPlannerItem(oil),
      requiredOil: oil.bufferedRequired,
      availableOil: oil.available,
      trackedOil,
      guaranteedTrackedOil,
      estimatedTrackedOil: activeOil?.estimatedTotal ?? 0,
      remainingOil,
      routes: Object.fromEntries(Object.entries(routes).map(([family, route]) => {
        if (!route.available) return [family, route];
        const unbufferedNeeded = Math.ceil(remainingOil / route.guaranteedYield);
        const multiplier = route.isProbabilistic === true ? multipliers[oil.key]?.multiplier ?? 1 : 1;
        const needed = Math.ceil(remainingOil * multiplier / route.guaranteedYield);
        return [family, {
          ...route,
          unbufferedNeeded,
          multiplier,
          needed,
          usage: {
            outputKey: oil.key,
            output: { ...pickPlannerItem(oil), quantity: remainingOil },
            recipeName: route.recipeName,
            buildingName: route.buildingName,
            selectedRecipeId: route.selectedRecipeId,
            alternatives: route.alternatives,
            requiredQuantity: needed,
            quantityPerCraft: route.inputQuantity,
            craftCount: Math.ceil(needed / route.inputQuantity),
          },
        }];
      })),
    };
  }) };
}

function stockTotalsWithActiveOutput(availableTotals, activeTotals, quantityField) {
  const totals = new Map(availableTotals);
  for (const [key, active] of activeTotals.entries()) {
    const quantity = Math.max(0, toNumber(active?.[quantityField]));
    if (quantity <= 0) continue;
    const current = totals.get(key) ?? { total: 0, sources: [] };
    totals.set(key, { ...current, total: current.total + quantity, sources: current.sources });
  }
  return totals;
}

function materialRowsForRequirements({
  requirements,
  usages,
  detailsByKey,
  routeOverrides,
  gatheredItemKeys,
  multipliers,
  availableTotals,
  activeTotals,
  targetKeys,
  normalized,
  countEstimatedOutput,
  viabilityMemo,
}) {
  return [...requirements.values()].map((item) => {
    const enrichedItem = enrichDisplayFromDetails(item, detailsByKey);
    const sourceRoutes = sourceRoutesForTarget({ ...item, ...enrichedItem }, detailsByKey, routeOverrides, gatheredItemKeys, viabilityMemo);
    const probabilistic = sourceRoutes.some((route) => route.isProbabilistic === true);
    const multiplier = probabilistic ? multipliers[item.key]?.multiplier ?? 1 : 1;
    const bufferedRequired = item.required;
    const available = availableTotals.get(item.key)?.total ?? 0;
    const active = activeTotals.get(item.key);
    const inProgress = active?.total ?? 0;
    const guaranteedInProgress = active?.guaranteedTotal ?? 0;
    const estimatedInProgress = active?.estimatedTotal ?? 0;
    const countedInProgress = countEstimatedOutput ? inProgress : guaranteedInProgress;
    const apiSection = item.section || sectionForMaterial(enrichedItem, null);
    const sectionOverrideKey = sectionOverrideKeyForItem({ ...item, ...enrichedItem });
    const sectionOverride = normalized.sectionOverrides[sectionOverrideKey] ?? null;
    const rowNameOverride = normalized.rowNameOverrides[sectionOverrideKey] ?? null;
    return {
      ...item,
      ...enrichedItem,
      key: item.key,
      id: item.id,
      kind: item.kind,
      itemType: itemTypeFromKind(item.kind),
      required: item.required,
      apiSection,
      sectionOverrideKey,
      sectionOverride,
      rowNameOverride,
      section: sectionOverride || apiSection,
      isTarget: targetKeys.has(item.key),
      isGatheredOverride: gatheredItemKeys.has(item.key),
      multiplier,
      multiplierNote: multipliers[item.key]?.note ?? "",
      bufferedRequired,
      available,
      inProgress,
      guaranteedInProgress,
      estimatedInProgress,
      missing: Math.max(0, bufferedRequired - available - countedInProgress),
      sources: availableTotals.get(item.key)?.sources ?? [],
      activeCraftSources: active?.sources ?? [],
      sourceRoutes,
      recipeUsages: usages.get(item.key) ?? [],
    };
  }).sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name));
}

export function joinCraftPlanBaselineMaterials(livePlan = {}, baselinePlan = {}) {
  const baselineMaterials = Array.isArray(baselinePlan?.materials) ? baselinePlan.materials : [];
  const baselineRequirements = new Map(
    baselineMaterials.map((material) => [
      String(material?.key ?? ""),
      material?.planRequired ?? material?.bufferedRequired ?? material?.required,
    ]),
  );
  const enrichMaterial = (material) => ({
    ...material,
    planRequired: baselineRequirements.has(String(material?.key ?? ""))
      ? baselineRequirements.get(String(material?.key ?? ""))
      : 0,
    requiredNow: material?.required,
    missingNow: material?.missing,
  });
  const materials = (Array.isArray(livePlan?.materials) ? livePlan.materials : []).map(enrichMaterial);
  const liveKeys = new Set(materials.map((material) => String(material?.key ?? "")));
  for (const baselineMaterial of baselineMaterials) {
    const key = String(baselineMaterial?.key ?? "");
    if (!key || liveKeys.has(key)) continue;
    materials.push({
      ...baselineMaterial,
      planRequired: baselineRequirements.get(key),
      requiredNow: 0,
      missingNow: 0,
      required: 0,
      missing: 0,
      bufferedRequired: 0,
      available: 0,
      inProgress: 0,
      guaranteedInProgress: 0,
      estimatedInProgress: 0,
      sources: [],
      activeCraftSources: [],
    });
    liveKeys.add(key);
  }
  const materialsByKey = new Map(materials.map((material) => [String(material?.key ?? ""), material]));
  return {
    ...livePlan,
    materials,
    gatherNext: (Array.isArray(livePlan?.gatherNext) ? livePlan.gatherNext : []).map((group) => ({
      ...group,
      items: (Array.isArray(group?.items) ? group.items : []).map((material) => (
        materialsByKey.get(String(material?.key ?? "")) ?? enrichMaterial(material)
      )),
    })),
  };
}

const CRAFT_PLAN_CONFIGURED_SOURCE_TYPES = [
  ["storageContainerIds", "Settlement storage"],
  ["bankContainerIds", "Player bank"],
  ["deployableContainerIds", "Player deployable"],
];

function sourceRuleValues(config, rule) {
  return (Array.isArray(config?.sourceRules?.[rule]) ? config.sourceRules[rule] : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function sourceMatchesSelectedRules(source, config) {
  const sourceId = String(source?.sourceId ?? "").trim();
  const aliases = new Set([sourceId, ...(Array.isArray(source?.legacySourceIds) ? source.legacySourceIds.map(String) : [])]);
  const exactIds = ["storageContainerIds", "bankContainerIds", "deployableContainerIds"]
    .flatMap((rule) => sourceRuleValues(config, rule));
  if (exactIds.some((id) => aliases.has(id))) return true;
  if (sourceRuleValues(config, "playerIds").includes(sourceId)) return true;
  if (sourceRuleValues(config, "craftPlayerIds").some((playerId) => sourceId === `${playerId}:crafts` || sourceId === `${playerId}:passive-crafts`)) return true;
  if (String(source?.type ?? "") === "Player bank" && sourceRuleValues(config, "bankPlayerIds").some((playerId) => (
    String(source?.playerId ?? "") === playerId || sourceId === `${playerId}:banks` || sourceId.startsWith(`${playerId}:`)
  ))) return true;
  if (String(source?.type ?? "") === "Player deployable" && sourceRuleValues(config, "deployableContainerIds").some((id) => {
    const playerId = id.split(":")[0];
    return sourceId === `${playerId}:deployables`;
  })) return true;
  return false;
}

export function reconcileCraftPlanRequiredSourceStatus(config = {}, sourceStatus = []) {
  const statuses = (Array.isArray(sourceStatus) ? sourceStatus : [])
    .filter((source) => sourceMatchesSelectedRules(source, config))
    .map((source) => ({ ...source }));
  const returnedIds = new Set(statuses.flatMap((source) => [
    source?.sourceId,
    ...(Array.isArray(source?.legacySourceIds) ? source.legacySourceIds : []),
  ]).map((sourceId) => String(sourceId ?? "").trim()).filter(Boolean));
  for (const [rule, type] of CRAFT_PLAN_CONFIGURED_SOURCE_TYPES) {
    for (const sourceId of config?.sourceRules?.[rule] ?? []) {
      const id = String(sourceId ?? "").trim();
      if (!id || returnedIds.has(id) || statuses.some((source) => sourceMatchesSelectedRules(source, { sourceRules: { [rule]: [id] } }))) continue;
      statuses.push({
        sourceId: id,
        label: id,
        type,
        available: false,
        error: "Configured source was not present in the completed source projection.",
      });
      returnedIds.add(id);
    }
  }
  for (const playerId of sourceRuleValues(config, "playerIds")) {
    if (returnedIds.has(playerId)) continue;
    statuses.push({ sourceId: playerId, label: playerId, type: "Player inventory", available: false, error: "Configured source was not present in the completed source projection." });
    returnedIds.add(playerId);
  }
  for (const playerId of sourceRuleValues(config, "craftPlayerIds")) {
    for (const [suffix, type] of [["crafts", "Tracked crafts"], ["passive-crafts", "Tracked passive crafts"]]) {
      const sourceId = `${playerId}:${suffix}`;
      if (returnedIds.has(sourceId)) continue;
      statuses.push({ sourceId, label: sourceId, type, available: false, error: "Configured source was not present in the completed source projection." });
      returnedIds.add(sourceId);
    }
  }
  for (const playerId of sourceRuleValues(config, "bankPlayerIds")) {
    if (statuses.some((source) => String(source?.type ?? "") === "Player bank" && sourceMatchesSelectedRules(source, { sourceRules: { bankPlayerIds: [playerId] } }))) continue;
    const sourceId = `${playerId}:banks`;
    statuses.push({ sourceId, label: sourceId, type: "Player bank", available: false, error: "Configured source was not present in the completed source projection." });
    returnedIds.add(sourceId);
  }
  return statuses;
}

const CRAFT_PLAN_TYPED_MATERIAL_KEY = /^(items|cargo):([0-9]+)$/;
const CRAFT_PLAN_REQUIRED_MATERIAL_QUANTITIES = ["planRequired", "requiredNow", "missingNow", "required", "missing"];
const CRAFT_PLAN_OPTIONAL_MATERIAL_QUANTITIES = [
  "bufferedRequired",
  "available",
  "inProgress",
  "guaranteedInProgress",
  "estimatedInProgress",
];

function craftPlanValidationError(code, path, message, details = {}) {
  return { code, path, message, ...details };
}

function completedPlanRoutes(plan) {
  return [
    ...(Array.isArray(plan?.steps) ? plan.steps.map((route, index) => ({ route, path: `steps[${index}]`, expanded: true })) : []),
    ...(Array.isArray(plan?.materials) ? plan.materials.flatMap((material, materialIndex) => (
      (Array.isArray(material?.sourceRoutes) ? material.sourceRoutes : []).map((route, routeIndex) => ({
        route,
        path: `materials[${materialIndex}].sourceRoutes[${routeIndex}]`,
        expanded: false,
      }))
    )) : []),
  ];
}

function craftPlanProgressCompletion(progress, view, section = null) {
  const branch = progress?.[view];
  return section == null ? branch?.overall?.completion : branch?.sections?.[section]?.completion;
}

export function validateCompletedCraftPlan(plan = {}, {
  requiredSources = [],
  previousPlan = null,
  baselinePlan = null,
  baselineRevision = plan?.effortProgress?.baselineRevision,
} = {}) {
  const errors = [];
  const topLevelMaterials = Array.isArray(plan?.materials) ? plan.materials : [];
  const publishedMaterialRows = topLevelMaterials.map((material, index) => ({
    material,
    path: `materials[${index}]`,
  }));
  const seenMaterialObjects = new Set(topLevelMaterials.filter((material) => material && typeof material === "object"));
  for (const [groupIndex, group] of (Array.isArray(plan?.gatherNext) ? plan.gatherNext : []).entries()) {
    for (const [itemIndex, material] of (Array.isArray(group?.items) ? group.items : []).entries()) {
      if (material && typeof material === "object" && seenMaterialObjects.has(material)) continue;
      if (material && typeof material === "object") seenMaterialObjects.add(material);
      publishedMaterialRows.push({ material, path: `gatherNext[${groupIndex}].items[${itemIndex}]` });
    }
  }
  const materials = publishedMaterialRows.map(({ material }) => material);
  const materialKeys = new Set();

  for (const { material, path } of publishedMaterialRows) {
    const rawKey = String(material?.key ?? "");
    const key = rawKey.trim();
    const match = CRAFT_PLAN_TYPED_MATERIAL_KEY.exec(key);
    if (rawKey !== key
      || !match
      || (material?.kind != null && String(material.kind) !== match?.[1])
      || (material?.id != null && String(material.id) !== match?.[2])) {
      errors.push(craftPlanValidationError("invalid_material_key", `${path}.key`, "Material keys must be exact items:<id> or cargo:<id> identities.", { key }));
    }
    if (materialKeys.has(key)) {
      errors.push(craftPlanValidationError("duplicate_material_key", `${path}.key`, `Material key ${key || "(empty)"} appears more than once.`, { key }));
    }
    materialKeys.add(key);

    for (const field of [...CRAFT_PLAN_REQUIRED_MATERIAL_QUANTITIES, ...CRAFT_PLAN_OPTIONAL_MATERIAL_QUANTITIES]) {
      if (CRAFT_PLAN_OPTIONAL_MATERIAL_QUANTITIES.includes(field) && material?.[field] == null) continue;
      const value = material?.[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        errors.push(craftPlanValidationError("invalid_material_quantity", `${path}.${field}`, `${field} must be a finite non-negative number.`, { key, field, value }));
      }
    }
    if (material?.requiredNow !== material?.required || material?.missingNow !== material?.missing) {
      errors.push(craftPlanValidationError("material_alias_mismatch", path, "Compatibility aliases must match requiredNow and missingNow.", { key }));
    }
  }

  const completedRoutes = completedPlanRoutes(plan);
  const completedRouteKeys = new Set(completedRoutes.map(({ route }) => (
    `${craftPlanItemKey(route?.output)}\n${String(route?.selectedRecipeId ?? "").trim()}`
  )));
  for (const baselineRoute of completedPlanRoutes(baselinePlan)) {
    const routeKey = `${craftPlanItemKey(baselineRoute.route?.output)}\n${String(baselineRoute.route?.selectedRecipeId ?? "").trim()}`;
    if (completedRouteKeys.has(routeKey)) continue;
    completedRouteKeys.add(routeKey);
    completedRoutes.push({ ...baselineRoute, path: `baselinePlan.${baselineRoute.path}` });
  }
  for (const { route, path, expanded } of completedRoutes) {
    const selectedRecipeId = String(route?.selectedRecipeId ?? "").trim();
    const alternatives = Array.isArray(route?.alternatives) ? route.alternatives : [];
    const selectedAlternative = alternatives.find((alternative) => String(alternative?.id ?? "").trim() === selectedRecipeId);
    const outputKey = craftPlanItemKey(route?.output);
    const explicitlySelected = String(plan?.config?.routeOverrides?.[outputKey] ?? "").trim() === selectedRecipeId;
    if (!selectedRecipeId || !selectedAlternative) {
      errors.push(craftPlanValidationError("invalid_selected_route", `${path}.selectedRecipeId`, "The selected route must identify one of the completed route alternatives.", { selectedRecipeId }));
    } else if ((expanded || explicitlySelected)
      && (selectedAlternative?.probabilityStatus === "unavailable" || route?.probabilityStatus === "unavailable")) {
      errors.push(craftPlanValidationError("incomplete_recipe_expansion", `${path}.selectedRecipeId`, "The selected recipe cannot be published until its validated output rate is available.", {
        selectedRecipeId,
        outputKey,
      }));
    }
  }
  for (const [outputKey, selectedRecipeId] of Object.entries(plan?.config?.routeOverrides ?? {})) {
    const completedOutputRoutes = completedRoutes.filter(({ route }) => craftPlanItemKey(route?.output) === outputKey);
    const normalizedSelectedRecipeId = String(selectedRecipeId ?? "").trim();
    const selectedRouteExists = completedOutputRoutes.some(({ route }) => (
      String(route?.selectedRecipeId ?? "").trim() === normalizedSelectedRecipeId
    ));
    const configuredAlternative = completedOutputRoutes
      .flatMap(({ route }) => Array.isArray(route?.alternatives) ? route.alternatives : [])
      .find((alternative) => String(alternative?.id ?? "").trim() === normalizedSelectedRecipeId);
    const configuredRouteIsExplicitlyUnselectable = configuredAlternative?.isSelectable === false;
    if (!CRAFT_PLAN_TYPED_MATERIAL_KEY.test(String(outputKey))
      || (completedOutputRoutes.length > 0 && !selectedRouteExists && !configuredRouteIsExplicitlyUnselectable)) {
      errors.push(craftPlanValidationError("invalid_selected_route", `config.routeOverrides.${outputKey}`, "The configured route must match the completed selected route for its typed output.", {
        outputKey,
        selectedRecipeId: String(selectedRecipeId ?? ""),
      }));
    }
  }

  for (const [index, source] of (Array.isArray(requiredSources) ? requiredSources : []).entries()) {
    const path = `requiredSources[${index}]`;
    if (!source || typeof source !== "object"
      || !String(source.sourceId ?? "").trim()
      || !String(source.label ?? "").trim()
      || !String(source.type ?? "").trim()
      || typeof source.available !== "boolean") {
      errors.push(craftPlanValidationError("required_source_incomplete", path, "Required source status is incomplete."));
    }
  }

  const normalizedBaselineRevision = String(baselineRevision ?? "").trim();
  const previousBaselineRevision = String(previousPlan?.effortProgress?.baselineRevision ?? "").trim();
  if (previousPlan && normalizedBaselineRevision && normalizedBaselineRevision === previousBaselineRevision) {
    const previousRequirements = new Map(
      (Array.isArray(previousPlan?.materials) ? previousPlan.materials : [])
        .map((material) => [String(material?.key ?? ""), material?.planRequired])
        .filter(([key]) => CRAFT_PLAN_TYPED_MATERIAL_KEY.test(key)),
    );
    const currentRequirements = new Map(
      topLevelMaterials
        .map((material, index) => [String(material?.key ?? ""), { index, planRequired: material?.planRequired }])
        .filter(([key]) => CRAFT_PLAN_TYPED_MATERIAL_KEY.test(key)),
    );
    for (const [key, { index, planRequired }] of currentRequirements.entries()) {
      if (!previousRequirements.has(key)) {
        errors.push(craftPlanValidationError("unstable_baseline_material", `materials[${index}].planRequired`, `Canonical material ${key} was added within baseline revision ${normalizedBaselineRevision}.`, {
          key,
          previousPlanRequired: null,
          planRequired,
          change: "added",
        }));
        continue;
      }
      if (previousRequirements.get(key) !== planRequired) {
        errors.push(craftPlanValidationError("unstable_baseline_material", `materials[${index}].planRequired`, `Canonical requirement for ${key} changed within baseline revision ${normalizedBaselineRevision}.`, {
          key,
          previousPlanRequired: previousRequirements.get(key),
          planRequired,
          change: "changed",
        }));
      }
    }
    for (const [key, previousPlanRequired] of previousRequirements.entries()) {
      if (currentRequirements.has(key)) continue;
      errors.push(craftPlanValidationError("unstable_baseline_material", "materials", `Canonical material ${key} was removed within baseline revision ${normalizedBaselineRevision}.`, {
        key,
        previousPlanRequired,
        planRequired: null,
        change: "removed",
      }));
    }
  }

  const progress = plan?.effortProgress ?? {};
  const sections = new Set([
    ...Object.keys(progress?.confirmed?.sections ?? {}),
    ...Object.keys(progress?.projected?.sections ?? {}),
  ]);
  for (const section of [null, ...sections]) {
    const confirmed = craftPlanProgressCompletion(progress, "confirmed", section);
    const projected = craftPlanProgressCompletion(progress, "projected", section);
    if (typeof confirmed === "number" && Number.isFinite(confirmed)
      && typeof projected === "number" && Number.isFinite(projected)
      && projected < confirmed) {
      const suffix = section == null ? "overall" : `sections.${section}`;
      errors.push(craftPlanValidationError("projected_progress_regression", `effortProgress.projected.${suffix}.completion`, "Projected progress must not be below confirmed progress.", {
        section,
        confirmed,
        projected,
      }));
    }
  }

  return { valid: errors.length === 0, baselineRevision: normalizedBaselineRevision, errors };
}

export function selectCraftPlanPublication({ candidatePlan, lastGoodPlan = null, validation = { valid: true } } = {}) {
  if (validation?.valid === true) {
    return { plan: candidatePlan, retainedLastGood: false, diagnostic: null };
  }
  return {
    plan: lastGoodPlan,
    retainedLastGood: Boolean(lastGoodPlan),
    diagnostic: validation,
  };
}

export function finalizeCraftPlanPublication({
  candidatePlan,
  baselinePlan = {},
  requiredSources = [],
  lastGoodPlan = null,
  baselineRevision = candidatePlan?.effortProgress?.baselineRevision,
} = {}) {
  const completedCandidate = joinCraftPlanBaselineMaterials(candidatePlan, baselinePlan);
  const validation = validateCompletedCraftPlan(completedCandidate, {
    requiredSources,
    previousPlan: lastGoodPlan,
    baselinePlan,
    baselineRevision,
  });
  return {
    candidatePlan: completedCandidate,
    validation,
    ...selectCraftPlanPublication({ candidatePlan: completedCandidate, lastGoodPlan, validation }),
  };
}

export function computeCraftPlan({
  config,
  preparedConfig = null,
  detailsByKey = new Map(),
  storageSources = [],
  playerSources = [],
  bankSources = [],
  deployableSources = [],
  activeCrafts = [],
  craftSourceErrors = [],
  catalogWarnings = [],
  routeViabilityMemo = new Map(),
} = {}) {
  const normalized = preparedConfig ?? normalizeCraftPlanConfig(config);
  if (!normalized.enabled || normalized.targets.length === 0) {
    return { config: normalized, enabled: normalized.enabled, targets: [], materials: [], steps: [], gatherNext: [], unavailableSources: [], warnings: [], personalViews: { fishing: { tiers: [] } } };
  }
  const availableTotals = new Map();
  const unavailableSources = [];
  addSourceTotals(availableTotals, storageSources, "Settlement storage", unavailableSources);
  addSourceTotals(availableTotals, playerSources, "Player inventory", unavailableSources);
  addSourceTotals(availableTotals, bankSources, "Player bank", unavailableSources);
  addSourceTotals(availableTotals, deployableSources, "Player deployable", unavailableSources);
  unavailableSources.push(...(normalized.sourceRules.craftPlayerIds.length ? craftSourceErrors ?? [] : []).map((source) => ({
    sourceId: String(source?.sourceId ?? "tracked-crafts"),
    label: String(source?.label ?? "Tracked crafts"),
    type: String(source?.type ?? "Tracked crafts"),
    error: String(source?.error ?? "Unable to load tracked crafts"),
  })));

  const expectedActiveTotals = new Map();
  const guaranteedActiveTotals = new Map();
  const craftPlayerIds = new Set(normalized.sourceRules.craftPlayerIds.map(String));
  const activeCraftSources = (activeCrafts ?? [])
    .filter((craft) => craftPlayerIds.has(String(craft?.playerId ?? craft?.playerEntityId ?? "")))
    .map((craft) => ({
      sourceId: String(craft.id ?? craft.craftId ?? "active-craft"),
      label: String(craft.buildingName ?? "Active craft"),
      type: "Active craft",
      playerId: craft.playerId ?? craft.playerEntityId ?? null,
      playerName: craft.playerName ?? craft.crafterName ?? null,
      buildingName: craft.buildingName ?? null,
      craftId: craft.id ?? craft.craftId ?? null,
      status: craft.status ?? (craft.completed ? "Ready to collect" : "In progress"),
      completed: craft.completed === true,
      passive: craft.passive === true,
      sourceType: String(craft.sourceType ?? (craft.passive ? "Passive craft" : "Active craft")),
      locationUnknown: craft.locationUnknown === true,
      items: [craft],
    }));
  addSourceTotals(expectedActiveTotals, activeCraftSources, "Active craft", unavailableSources, "quantity");
  addSourceTotals(guaranteedActiveTotals, activeCraftSources, "Active craft", unavailableSources, "guaranteedQuantity");
  const countedActiveTotals = countedActiveCraftTotals(expectedActiveTotals, guaranteedActiveTotals);

  const planningStockTotals = stockTotalsWithActiveOutput(availableTotals, countedActiveTotals, "total");
  const confirmedStockTotals = stockTotalsWithActiveOutput(availableTotals, countedActiveTotals, "guaranteedTotal");
  const gatheredItemKeys = new Set();
  const calculationTargets = expandedPlanTargets(normalized.targets, normalized.buildingProgress);
  const { required, steps, usages, warnings } = buildRequirementMap(calculationTargets, detailsByKey, normalized.routeOverrides, gatheredItemKeys, normalized.multipliers, planningStockTotals, routeViabilityMemo);
  const confirmedRequirements = buildRequirementMap(calculationTargets, detailsByKey, normalized.routeOverrides, gatheredItemKeys, normalized.multipliers, confirmedStockTotals, routeViabilityMemo);

  const targetKeys = new Set(normalized.targets.filter((target) => target.kind !== "building").map((target) => recipeKey(target.kind, target.id)));
  for (const target of calculationTargets) {
    if (!required.has(recipeKey(target.kind, target.id))) addRequired(required, target, target.quantity, sectionForMaterial(target, null));
  }

  const materialOptions = {
    detailsByKey,
    routeOverrides: normalized.routeOverrides,
    gatheredItemKeys,
    multipliers: normalized.multipliers,
    availableTotals,
    activeTotals: countedActiveTotals,
    targetKeys,
    normalized,
    viabilityMemo: routeViabilityMemo,
  };
  const materials = materialRowsForRequirements({ requirements: required, usages, ...materialOptions, countEstimatedOutput: true });
  const confirmedMaterials = materialRowsForRequirements({
    requirements: confirmedRequirements.required,
    usages: confirmedRequirements.usages,
    ...materialOptions,
    countEstimatedOutput: false,
  });

  const targets = normalized.targets.map((target) => {
    if (target.kind === "building") {
      const progress = normalized.buildingProgress[recipeKey(target.kind, target.id)];
      const available = Math.min(target.quantity, progress?.completedEntityIds?.length ?? 0);
      return { ...target, available, inProgress: 0, guaranteedInProgress: 0, estimatedInProgress: 0, missing: Math.max(0, target.quantity - available), progressInitialized: Boolean(progress) };
    }
    const material = materials.find((item) => item.key === recipeKey(target.kind, target.id));
    const enrichedTarget = enrichDisplayFromDetails(target, detailsByKey);
    return {
      ...target,
      ...enrichedTarget,
      quantity: target.quantity,
      missing: material?.missing ?? 0,
      available: material?.available ?? 0,
      inProgress: material?.inProgress ?? 0,
      guaranteedInProgress: material?.guaranteedInProgress ?? 0,
      estimatedInProgress: material?.estimatedInProgress ?? 0,
    };
  });

  const personalViews = {
    fishing: buildPersonalFishingView({ materials, detailsByKey, availableTotals, activeCraftTotals: countedActiveTotals, gatheredItemKeys, multipliers: normalized.multipliers, warnings, countEstimatedOutput: true }),
  };
  const confirmedPersonalViews = {
    fishing: buildPersonalFishingView({ materials: confirmedMaterials, detailsByKey, availableTotals, activeCraftTotals: countedActiveTotals, gatheredItemKeys, multipliers: normalized.multipliers, warnings, countEstimatedOutput: false }),
  };

  return {
    config: normalized,
    enabled: true,
    targets,
    materials,
    steps,
    personalViews,
    confirmedEffortPlan: { materials: confirmedMaterials, personalViews: confirmedPersonalViews },
    gatherNext: groupGatherNext(materials.filter((item) => !item.isTarget)),
    unavailableSources,
    warnings: [...new Set([...warnings, ...(Array.isArray(catalogWarnings) ? catalogWarnings : [])])],
    totals: {
      targets: targets.length,
      missingItems: materials.filter((item) => item.missing > 0).length,
      missingQuantity: materials.reduce((sum, item) => sum + item.missing, 0),
      activeCraftQuantity: materials.reduce((sum, item) => sum + item.inProgress, 0),
    },
  };
}

function compactCraftPlanItem(item = {}) {
  const { sources, activeCraftSources, sourceRoutes, recipeUsages, plannedOutput, ...summary } = item;
  return {
    ...summary,
    hasSourceRoutes: Boolean(item.hasSourceRoutes || sourceRoutes?.length),
    hasRecipeUsages: Boolean(item.hasRecipeUsages || recipeUsages?.length),
  };
}

function craftPlanItemKey(item = {}) {
  if (item.key) return String(item.key);
  const id = String(item.id ?? item.itemId ?? item.entityId ?? "").trim();
  return id ? recipeKey(item.kind ?? "items", id) : "";
}

export function compactCraftPlanResponse(plan = {}) {
  const { confirmedEffortPlan, ...publicPlan } = plan;
  return {
    ...publicPlan,
    materials: Array.isArray(plan.materials) ? plan.materials.map(compactCraftPlanItem) : [],
    steps: [],
    gatherNext: Array.isArray(plan.gatherNext) ? plan.gatherNext.map((group) => ({
      ...group,
      items: Array.isArray(group.items) ? group.items.map(compactCraftPlanItem) : [],
    })) : [],
  };
}

export function createCraftPlanResponseWorkspace(plan = {}, project = compactCraftPlanResponse) {
  let compactPlan;
  let projected = false;
  return {
    plan,
    compact() {
      if (!projected) {
        compactPlan = project(plan);
        projected = true;
      }
      return compactPlan;
    },
  };
}

export function craftPlanDetailResponse(plan = {}, requestedKeys = []) {
  const keys = new Set(requestedKeys.map(String).filter(Boolean));
  return {
    materials: Array.isArray(plan.materials) ? plan.materials.filter((item) => keys.has(craftPlanItemKey(item))) : [],
    steps: Array.isArray(plan.steps) ? plan.steps.filter((step) => keys.has(craftPlanItemKey(step.output))) : [],
  };
}


