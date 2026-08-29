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
    || String(review.selectedRouteId ?? "").trim();
}

export function stageCraftPlanRouteRecommendations<T extends { routeOverrides?: Record<string, string> }>(draft: T, reviews: AnyRecord[], excludedOutputKeys: ReadonlySet<string> = new Set()): T & { routeOverrides: Record<string, string> } {
  const routeOverrides = { ...(draft.routeOverrides ?? {}) };
  for (const review of Array.isArray(reviews) ? reviews : []) {
    const outputKey = String(review.outputKey ?? "").trim();
    if (!outputKey || excludedOutputKeys.has(outputKey) || String(routeOverrides[outputKey] ?? "").trim()) continue;
    const recommended = String(review.preselectedRouteId ?? review.selectedRouteId ?? "").trim();
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

export function craftPlanNeedReviewTargets(cell: AnyRecord) {
  const seen = new Set<string>();
  return (Array.isArray(cell?.items) ? cell.items : []).flatMap((item: AnyRecord) => {
    const outputKey = String(item.key ?? "").trim();
    if (!outputKey || seen.has(outputKey)) return [];
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
