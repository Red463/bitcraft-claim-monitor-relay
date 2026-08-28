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

export function craftPlanManagerWorkspaces({ canViewAudit = false } = {}) {
  return WORKSPACES.filter(({ id }) => id !== "audit" || canViewAudit);
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

export function orderCraftPlanRouteReviews<T extends { outputKey?: unknown; ambiguous?: unknown }>(reviews: T[]): T[] {
  return [...reviews].sort((left, right) => Number(Boolean(right.ambiguous)) - Number(Boolean(left.ambiguous))
    || String(left.outputKey ?? "").localeCompare(String(right.outputKey ?? "")));
}

export function craftPlanRouteSelection(review: AnyRecord, stagedOverride: unknown = "") {
  return String(stagedOverride ?? "").trim()
    || String(review.preselectedRouteId ?? "").trim()
    || String(review.selectedRouteId ?? "").trim();
}

export function stageCraftPlanRouteRecommendations<T extends { routeOverrides?: Record<string, string> }>(draft: T, reviews: AnyRecord[]): T & { routeOverrides: Record<string, string> } {
  const routeOverrides = { ...(draft.routeOverrides ?? {}) };
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const outputKey = String(review.outputKey ?? "").trim();
    if (!outputKey || String(routeOverrides[outputKey] ?? "").trim()) continue;
    const recommended = craftPlanRouteSelection(review);
    if (recommended) routeOverrides[outputKey] = recommended;
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

export function craftPlanRecipeReviewHref({ planId, outputKey }: { planId: string; outputKey: string }) {
  const params = new URLSearchParams({ page: "planning", plan: String(planId), manager: "recipe-review", output: String(outputKey) });
  return `/?${params.toString()}`;
}
