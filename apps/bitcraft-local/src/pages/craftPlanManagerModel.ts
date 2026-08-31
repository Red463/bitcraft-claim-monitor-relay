import type { AnyRecord } from "../main-app-data";

export const CRAFT_PLAN_SOURCE_RULE_KEYS = [
  "storageContainerIds",
  "playerIds",
  "craftPlayerIds",
  "bankPlayerIds",
  "bankContainerIds",
  "deployableContainerIds",
] as const;

export type CraftPlanSourceRules = Record<(typeof CRAFT_PLAN_SOURCE_RULE_KEYS)[number], string[]>;

const WORKSPACES = [
  { id: "goals", label: "Goals", capabilities: ["name", "visibility", "targets", "quantities", "presets"] },
  { id: "sources", label: "Counted Sources", capabilities: ["storage", "inventory", "crafts", "deployables", "banks"] },
  { id: "recipes", label: "Recipe Review", capabilities: ["routes", "review", "buffers", "material-impact"] },
  { id: "audit", label: "Audit", capabilities: ["causal-timeline", "filters", "checkpoint-comparison", "export"] },
] as const;

export type CraftPlanManagerWorkspace = (typeof WORKSPACES)[number]["id"];

const CRAFT_PLAN_LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

export function craftPlanAuditInstant(localValue: unknown) {
  const value = String(localValue ?? "").trim();
  if (!value) return "";
  if (!CRAFT_PLAN_LOCAL_DATE_TIME.test(value)) return "";
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : "";
}

export function craftPlanAuditLocalDateTime(instantValue: unknown) {
  const instant = instantValue instanceof Date
    ? new Date(instantValue.getTime())
    : typeof instantValue === "number"
      ? new Date(instantValue)
      : new Date(String(instantValue ?? ""));
  if (!Number.isFinite(instant.getTime())) return "";
  const localTime = instant.getTime() - instant.getTimezoneOffset() * 60 * 1000;
  return new Date(localTime).toISOString().slice(0, 16);
}

export function craftPlanManagerWorkspaces({ canViewAudit = false, canEdit = true } = {}) {
  return WORKSPACES.filter(({ id }) => canEdit ? id !== "audit" || canViewAudit : id === "audit" && canViewAudit);
}

export function canEditCraftPlan(adminSession: AnyRecord | null | undefined, ownsSelectedPlan: boolean) {
  if (ownsSelectedPlan) return true;
  const permissions = Array.isArray(adminSession?.user?.permissions) ? adminSession.user.permissions : [];
  return Boolean(adminSession?.authenticated && (permissions.includes("*") || permissions.includes("settings.manage")));
}

export function canViewCraftPlanAudit(adminSession: AnyRecord | null | undefined) {
  const permissions = Array.isArray(adminSession?.user?.permissions) ? adminSession.user.permissions : [];
  return Boolean(adminSession?.authenticated && (permissions.includes("*") || permissions.includes("audit.view")));
}

export function canOpenCraftPlanManager(adminSession: AnyRecord | null | undefined, ownsSelectedPlan: boolean) {
  return canEditCraftPlan(adminSession, ownsSelectedPlan) || canViewCraftPlanAudit(adminSession);
}

export function craftPlanUnavailableActions({ canOpenManager = false, canEdit = false } = {}) {
  return {
    retry: true,
    managerLabel: canOpenManager ? canEdit ? "Manage Plan" : "View Audit" : null,
  };
}

export function craftPlanValidationDiagnostics(progressAudit: AnyRecord | null | undefined) {
  const errors = progressAudit?.status?.validationWarning?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((error) => {
    if (!error || typeof error !== "object") return [];
    const { code, path, message, ...details } = error as AnyRecord;
    return [{
      code: String(code ?? "").trim(),
      path: String(path ?? "").trim(),
      message: String(message ?? "").trim(),
      details,
    }];
  });
}

function emptySourceRules(): CraftPlanSourceRules {
  return {
    storageContainerIds: [],
    playerIds: [],
    craftPlayerIds: [],
    bankPlayerIds: [],
    bankContainerIds: [],
    deployableContainerIds: [],
  };
}

export function craftPlanSourceSuggestion({ personal = false, sources = {} as AnyRecord } = {}) {
  const sourceRules = emptySourceRules();
  if (personal) {
    const owner = Array.isArray(sources.players) ? sources.players[0] : null;
    if (owner?.playerId != null) sourceRules.playerIds = [String(owner.playerId)];
  } else {
    sourceRules.storageContainerIds = (Array.isArray(sources.storage) ? sources.storage : [])
      .map((source: AnyRecord) => String(source.sourceId ?? ""))
      .filter(Boolean);
  }
  return { applied: false, sourceRules };
}

export function applyCraftPlanSourceSuggestion<T extends { sourceRules?: Partial<CraftPlanSourceRules> }>(draft: T, suggestion: { sourceRules: CraftPlanSourceRules }): T & { sourceRules: CraftPlanSourceRules } {
  return { ...draft, sourceRules: structuredClone(suggestion.sourceRules) };
}

export function orderCraftPlanRouteReviews<T extends { outputKey?: unknown; ambiguous?: unknown; confirmed?: unknown }>(reviews: T[], confirmedOutputKeys: ReadonlySet<string> = new Set()): T[] {
  return [...reviews].sort((left, right) => Number(Boolean(right.ambiguous)) - Number(Boolean(left.ambiguous))
    || Number(left.confirmed === true || confirmedOutputKeys.has(String(left.outputKey ?? ""))) - Number(right.confirmed === true || confirmedOutputKeys.has(String(right.outputKey ?? "")))
    || String(left.outputKey ?? "").localeCompare(String(right.outputKey ?? "")));
}

function stableCraftPlanConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableCraftPlanConfig);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as AnyRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stableCraftPlanConfig(entry)]));
}

function routeInputs(alternative: AnyRecord = {}) {
  return (Array.isArray(alternative.inputs) ? alternative.inputs : [])
    .map((input: AnyRecord) => ({ key: String(input?.key ?? ""), quantity: Number(input?.quantity ?? 0) }))
    .filter((input) => input.key)
    .sort((left, right) => left.key.localeCompare(right.key) || left.quantity - right.quantity);
}

function nullableRouteNumber(value: unknown) {
  return value == null ? null : Number(value);
}

function routeProducerIdentity(producer: unknown) {
  if (typeof producer === "string") return producer.trim() || null;
  if (!producer || typeof producer !== "object") return null;
  const record = producer as AnyRecord;
  const explicit = String(record.key ?? "").trim();
  if (explicit) return explicit;
  const kind = String(record.kind ?? "").trim();
  const id = String(record.id ?? "").trim();
  return kind && id ? `${kind}:${id}` : null;
}

function routeCalculationSignature(alternative: AnyRecord = {}) {
  const producerRecipeId = String(alternative.producerRecipe?.id ?? "").trim();
  const gatheringSourceTag = alternative.gatheringSource?.tag == null ? null : String(alternative.gatheringSource.tag);
  const gatheringSourceSkill = alternative.gatheringSource?.skill == null ? null : String(alternative.gatheringSource.skill);
  return JSON.stringify(stableCraftPlanConfig({
    routeType: String(alternative.routeType ?? "craft"),
    gatheringMode: alternative.gatheringMode == null ? null : String(alternative.gatheringMode),
    gatheringSkill: alternative.gatheringSkill == null ? null : String(alternative.gatheringSkill),
    producer: routeProducerIdentity(alternative.producer),
    producerRecipe: producerRecipeId ? {
      id: producerRecipeId,
      skillName: alternative.producerRecipe?.skillName == null ? null : String(alternative.producerRecipe.skillName),
    } : null,
    probabilityStatus: String(alternative.probabilityStatus ?? (alternative.isProbabilistic === true ? "expected" : "guaranteed")),
    isProbabilistic: alternative.isProbabilistic === true,
    isTransportRoute: alternative.isTransportRoute === true,
    expectedYield: nullableRouteNumber(alternative.expectedYield),
    yieldBasis: alternative.yieldBasis == null ? null : String(alternative.yieldBasis),
    expectedPerCraft: nullableRouteNumber(alternative.expectedPerCraft),
    expectedPerProgress: nullableRouteNumber(alternative.expectedPerProgress),
    expectedPerResource: nullableRouteNumber(alternative.expectedPerResource),
    resourceHealth: nullableRouteNumber(alternative.resourceHealth),
    actionsRequired: nullableRouteNumber(alternative.actionsRequired),
    dropChance: nullableRouteNumber(alternative.dropChance),
    dropQuantity: nullableRouteNumber(alternative.dropQuantity),
    guaranteedYield: nullableRouteNumber(alternative.guaranteedYield),
    gatheringSource: gatheringSourceTag || gatheringSourceSkill ? { tag: gatheringSourceTag, skill: gatheringSourceSkill } : null,
    inputs: routeInputs(alternative),
  }));
}

function zeroInputGatheringAlternative(alternative: AnyRecord = {}) {
  const routeType = String(alternative.routeType ?? "craft");
  return alternative.isTransportRoute !== true
    && (routeType === "gathering" || routeType === "gathering-byproduct")
    && routeInputs(alternative).length === 0;
}

function routeOverrideFallbackCompatible(previous: AnyRecord = {}, selected: AnyRecord = {}) {
  return (zeroInputGatheringAlternative(previous) && zeroInputGatheringAlternative(selected))
    || routeCalculationSignature(previous) === routeCalculationSignature(selected);
}

export function craftPlanRetainedRoutesAllowed(stagedConfig: AnyRecord = {}, storedConfig: AnyRecord = {}, routeInventory: AnyRecord[] = []) {
  const { name: _stagedName, routeOverrides: _stagedRoutes, ...stagedCalculation } = stagedConfig;
  const { name: _storedName, routeOverrides: _storedRoutes, ...storedCalculation } = storedConfig;
  if (JSON.stringify(stableCraftPlanConfig(stagedCalculation)) !== JSON.stringify(stableCraftPlanConfig(storedCalculation))) return false;
  const stagedRoutes = stagedConfig.routeOverrides && typeof stagedConfig.routeOverrides === "object" ? stagedConfig.routeOverrides : {};
  const storedRoutes = storedConfig.routeOverrides && typeof storedConfig.routeOverrides === "object" ? storedConfig.routeOverrides : {};
  const changedOutputKeys = [...new Set([...Object.keys(stagedRoutes), ...Object.keys(storedRoutes)])]
    .filter((outputKey) => String(stagedRoutes[outputKey] ?? "") !== String(storedRoutes[outputKey] ?? ""));
  const reviewsByOutput = new Map((Array.isArray(routeInventory) ? routeInventory : [])
    .map((review) => [String(review?.outputKey ?? ""), review]));
  return changedOutputKeys.every((outputKey) => {
    const selectedRouteId = String(stagedRoutes[outputKey] ?? "").trim();
    const review = reviewsByOutput.get(outputKey);
    const alternatives = Array.isArray(review?.alternatives) ? review.alternatives : [];
    const previous = alternatives.find((alternative: AnyRecord) => String(alternative?.id ?? "") === String(review?.selectedRouteId ?? ""));
    const selected = alternatives.find((alternative: AnyRecord) => String(alternative?.id ?? "") === selectedRouteId);
    return Boolean(selectedRouteId && previous && selected && previous.isSelectable !== false && selected.isSelectable !== false
      && routeOverrideFallbackCompatible(previous, selected));
  });
}

export function resolveCraftPlanRouteReviewState({
  preview = null,
  loadedRouteInventory = [],
  draftDirty = false,
  allowRetainedRoutes = false,
}: {
  preview?: AnyRecord | null;
  loadedRouteInventory?: AnyRecord[];
  draftDirty?: boolean;
  allowRetainedRoutes?: boolean;
} = {}) {
  const previewReviews = Array.isArray(preview?.routeReviews) ? preview.routeReviews : [];
  const loadedReviews = Array.isArray(loadedRouteInventory) ? loadedRouteInventory : [];
  const hasExactPreviewReviews = previewReviews.length > 0;
  const useLoadedPlan = !hasExactPreviewReviews && (!draftDirty || allowRetainedRoutes) && loadedReviews.length > 0;
  const diagnostics = preview?.routeDiagnostics;
  const rawEvidence = Number(diagnostics?.steps ?? 0) > 0
    || Number(diagnostics?.materialSourceRoutes ?? 0) > 0
    || Number(diagnostics?.directInventory ?? 0) > 0;
  const previewOmittedLoadedRoutes = Boolean(preview) && useLoadedPlan;

  return {
    routeReviews: hasExactPreviewReviews ? previewReviews : useLoadedPlan ? loadedReviews : [],
    evidence: hasExactPreviewReviews ? String(preview?.routeEvidence ?? "current") : useLoadedPlan ? draftDirty ? "retained" : "loaded_plan" : "none",
    routeLoss: (rawEvidence && Number(diagnostics?.returnedReviews ?? 0) === 0) || previewOmittedLoadedRoutes,
  };
}

export type CraftPlanRouteReviewFilter = "all" | "needs-review" | "multiple" | "single";

export function filterCraftPlanRouteReviews<T extends AnyRecord>(
  reviews: T[],
  {
    mode = "all" as CraftPlanRouteReviewFilter,
    query = "",
    confirmedOutputKeys = new Set<string>(),
  } = {},
): T[] {
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  return orderCraftPlanRouteReviews(Array.isArray(reviews) ? reviews : [], confirmedOutputKeys).filter((review) => {
    const outputKey = String(review.outputKey ?? "");
    const confirmed = review.confirmed === true || confirmedOutputKeys.has(outputKey);
    if (mode === "needs-review" && (!review.ambiguous || confirmed)) return false;
    if (mode === "multiple" && !review.ambiguous) return false;
    if (mode === "single" && review.ambiguous) return false;
    if (!normalizedQuery) return true;
    const searchable = [
      outputKey,
      review.outputName,
      ...(Array.isArray(review.alternatives) ? review.alternatives.flatMap((alternative: AnyRecord) => [
        alternative.id,
        alternative.label,
        alternative.recipeName,
        alternative.buildingName,
        ...(Array.isArray(alternative.inputs) ? alternative.inputs.flatMap((input: AnyRecord) => [input.name, input.key]) : []),
      ]) : []),
    ].map((value) => String(value ?? "").toLocaleLowerCase());
    return searchable.some((value) => value.includes(normalizedQuery));
  });
}

export function craftPlanRouteSelection(review: AnyRecord, stagedOverride: unknown = "") {
  return String(stagedOverride ?? "").trim()
    || String(review.selectedRouteId ?? "").trim();
}

export function stageCraftPlanRouteRecommendations<T extends { routeOverrides?: Record<string, string> }>(draft: T, reviews: AnyRecord[], excludedOutputKeys: ReadonlySet<string> = new Set()): T & { routeOverrides: Record<string, string> } {
  const routeOverrides = { ...(draft.routeOverrides ?? {}) };
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const outputKey = String(review.outputKey ?? "").trim();
    if (!outputKey || excludedOutputKeys.has(outputKey) || String(routeOverrides[outputKey] ?? "").trim()) continue;
    const selected = String(review.selectedRouteId ?? "").trim();
    const recommended = String(review.preselectedRouteId ?? selected).trim();
    if (recommended && recommended !== selected) routeOverrides[outputKey] = recommended;
  }
  return { ...draft, routeOverrides };
}

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function craftPlanMaterialPresentation(material: AnyRecord) {
  const estimatedCraftOutput = finite(material.estimatedInProgress);
  return {
    neededNow: finite(material.missingNow ?? material.missing),
    planTotal: finite(material.planRequired ?? material.requiredNow ?? material.required),
    stock: finite(material.available),
    guaranteedCraftOutput: material.guaranteedInProgress != null
      ? finite(material.guaranteedInProgress)
      : estimatedCraftOutput > 0 ? 0 : finite(material.inProgress),
    estimatedCraftOutput,
    buildingCompletion: finite(material.buildingCompletion),
  };
}

export function craftPlanNeedCellPresentation(cell: AnyRecord) {
  return {
    neededNow: finite(cell.missing),
    planTotal: finite(cell.required),
    stock: finite(cell.available),
    guaranteedCraftOutput: finite(cell.guaranteedInProgress),
    estimatedCraftOutput: finite(cell.estimatedInProgress),
    buildingCompletion: (Array.isArray(cell.items) ? cell.items : []).reduce((total: number, item: AnyRecord) => total + finite(item.buildingCompletion), 0),
  };
}

export function craftPlanNeedReviewTargets(cell: AnyRecord, routes: AnyRecord[] = []) {
  const reviewableOutputKeys = new Set((Array.isArray(routes) ? routes : []).flatMap((route: AnyRecord) => {
    const alternatives = (Array.isArray(route?.alternatives) ? route.alternatives : [])
      .filter((alternative: AnyRecord) => String(alternative?.id ?? "").trim()
        && alternative?.isTransportRoute !== true);
    const outputKey = String(route?.key ?? route?.output?.key ?? "").trim();
    return outputKey && alternatives.length ? [outputKey] : [];
  }));
  const seen = new Set<string>();
  return (Array.isArray(cell?.items) ? cell.items : []).flatMap((item: AnyRecord) => {
    const outputKey = String(item.key ?? "").trim();
    if (!outputKey || seen.has(outputKey) || !reviewableOutputKeys.has(outputKey)) return [];
    seen.add(outputKey);
    return [{ outputKey, label: String(item.name ?? item.label ?? outputKey) }];
  });
}

export type CraftPlanDraftConflict = { path: string; base: unknown; local: unknown; server: unknown };

type StructuredChange = { path: string; value: unknown };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pointerSegment(value: string) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function structuredChanges(base: unknown, next: unknown, path = ""): StructuredChange[] {
  if (sameValue(base, next)) return [];
  if (isPlainObject(base) && isPlainObject(next)) {
    return [...new Set([...Object.keys(base), ...Object.keys(next)])].flatMap((key) => structuredChanges(base[key], next[key], `${path}/${pointerSegment(key)}`));
  }
  return [{ path, value: next }];
}

function pointerParts(path: string) {
  return path.split("/").slice(1).map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function valueAtPath(value: unknown, path: string) {
  return pointerParts(path).reduce<unknown>((current, part) => isPlainObject(current) ? current[part] : undefined, value);
}

function applyStructuredChange<T>(value: T, change: StructuredChange): T {
  if (!change.path) return structuredClone(change.value) as T;
  const result = structuredClone(value) as Record<string, unknown>;
  const parts = pointerParts(change.path);
  let parent = result;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(parent[part])) parent[part] = {};
    parent = parent[part] as Record<string, unknown>;
  }
  const leaf = parts.at(-1)!;
  if (change.value === undefined) delete parent[leaf];
  else parent[leaf] = structuredClone(change.value);
  return result as T;
}

function pathsOverlap(left: string, right: string) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function rebaseCraftPlanDraft<T>({ base, local, server }: { base: T; local: T; server: T }) {
  const serverChanges = structuredChanges(base, server);
  const conflicts: CraftPlanDraftConflict[] = [];
  let config = structuredClone(server);
  for (const change of structuredChanges(base, local)) {
    if (serverChanges.some((serverChange) => pathsOverlap(change.path, serverChange.path))) {
      conflicts.push({
        path: change.path,
        base: valueAtPath(base, change.path),
        local: change.value,
        server: valueAtPath(server, change.path),
      });
      continue;
    }
    config = applyStructuredChange(config, change);
  }
  return { config, conflicts };
}

export function resolveCraftPlanDraftConflict<T>(config: T, conflict: CraftPlanDraftConflict, choice: "local" | "server") {
  return choice === "local" ? applyStructuredChange(config, { path: conflict.path, value: conflict.local }) : config;
}

export function craftPlanRecipeReviewHref({ planId, outputKey }: { planId: string; outputKey: string }) {
  const params = new URLSearchParams({ page: "planning", plan: String(planId), manager: "recipe-review", output: String(outputKey) });
  return `/?${params.toString()}`;
}
