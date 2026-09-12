import type { FishingRoutePreference } from "./craftPlanningFishingView";

type EffortState = "ready" | "partial" | "unavailable" | "empty";

export type EffortAggregate = {
  state: EffortState;
  baselineEffort: number | null;
  remainingEffort: number | null;
  completion: number | null;
};

export type EffortProgressSummary = {
  state: EffortState;
  overall?: EffortAggregate;
  sections?: Record<string, EffortAggregate>;
  fishingVariants?: Partial<Record<FishingRoutePreference, {
    overall: EffortAggregate;
    sections: Record<string, EffortAggregate>;
    warnings?: string[];
  }>>;
  warnings?: string[];
};

export type CraftPlanningEffortView = {
  state: EffortState;
  route: FishingRoutePreference;
  confirmed: {
    overall: EffortAggregate;
    sections: Record<string, EffortAggregate>;
  };
  projected: {
    overall: EffortAggregate;
    sections: Record<string, EffortAggregate>;
  };
  overall: EffortAggregate;
  sections: Record<string, EffortAggregate>;
  warnings: string[];
  stale: boolean;
  sourceCoverageIncomplete: boolean;
  staleSince: string | null;
  lastSuccessfulAt: string | null;
  unavailableSources: Array<{ sourceId?: string; label: string; type?: string; error?: string }>;
  baselineRevision: string | null;
  baselineChange: null | {
    previousRevision?: string;
    revision: string;
    changedAt: string;
    reasons: string[];
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finite(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function aggregate(value: unknown): EffortAggregate {
  const source = record(value);
  const completion = finite(source.completion);
  const state = (source.state === "ready" || source.state === "empty") && completion != null
    ? source.state
    : "unavailable";
  return {
    state,
    baselineEffort: finite(source.baselineEffort),
    remainingEffort: finite(source.remainingEffort),
    completion: state === "ready" || state === "empty" ? completion : null,
  };
}

export function selectCraftPlanningEffortView(summary: unknown, route: FishingRoutePreference): CraftPlanningEffortView {
  const root = record(summary);
  const variants = record(root.fishingVariants);
  const variant = record(variants[route]);
  const confirmedRoot = Object.keys(record(root.confirmed)).length ? record(root.confirmed) : root;
  const projectedRoot = Object.keys(record(root.projected)).length ? record(root.projected) : confirmedRoot;
  const confirmedVariant = Object.keys(record(variant.confirmed)).length
    ? record(variant.confirmed)
    : Object.keys(record(root.confirmed)).length ? {} : variant;
  const projectedVariant = Object.keys(record(variant.projected)).length
    ? record(variant.projected)
    : Object.keys(record(root.projected)).length ? {} : confirmedVariant;
  const hasConfirmedVariant = Object.keys(confirmedVariant).length > 0;
  const hasProjectedVariant = Object.keys(projectedVariant).length > 0;
  const baseSections = record(confirmedRoot.sections);
  const hasFishing = Object.prototype.hasOwnProperty.call(baseSections, "Fishing");
  const selectProjection = (
    projection: Record<string, unknown>,
    selectedVariant: Record<string, unknown>,
    hasVariant: boolean,
  ) => ({
    overall: aggregate(hasVariant ? selectedVariant.overall : projection.overall),
    sections: Object.fromEntries(Object.entries({
      ...record(projection.sections),
      ...(hasVariant ? record(selectedVariant.sections) : {}),
    }).map(([name, value]) => [name, aggregate(value)])),
  });
  const confirmed = selectProjection(confirmedRoot, confirmedVariant, hasConfirmedVariant);
  const projected = selectProjection(projectedRoot, projectedVariant, hasProjectedVariant);
  const validStates = new Set<EffortState>(["ready", "partial", "unavailable", "empty"]);
  const stateValue = confirmedRoot.state ?? root.state;
  const state = validStates.has(String(stateValue) as EffortState)
    ? String(stateValue) as EffortState
    : "unavailable";
  const variantWarnings = [
    ...(Array.isArray(confirmedVariant.warnings) ? confirmedVariant.warnings.map(String) : []),
    ...(Array.isArray(projectedVariant.warnings) ? projectedVariant.warnings.map(String) : []),
    ...(Array.isArray(variant.warnings) ? variant.warnings.map(String) : []),
  ];
  const rootWarnings = Array.isArray(root.warnings) ? root.warnings.map(String) : [];
  const warnings = [...new Set([...variantWarnings, ...rootWarnings])];
  if (hasFishing && !hasConfirmedVariant) {
    warnings.unshift(`The selected ${route} Fishing route has no specialised effort estimate; showing the general Fishing estimate.`);
  }
  const unavailableSources = Array.isArray(root.unavailableSources)
    ? root.unavailableSources.map((source) => {
      const value = record(source);
      return {
        sourceId: value.sourceId == null ? undefined : String(value.sourceId),
        label: String(value.label ?? value.sourceId ?? "Unknown source"),
        type: value.type == null ? undefined : String(value.type),
        error: value.error == null ? undefined : String(value.error),
      };
    })
    : [];
  const baselineChangeValue = record(root.baselineChange);
  const baselineChange = Object.keys(baselineChangeValue).length
    ? {
      previousRevision: baselineChangeValue.previousRevision == null ? undefined : String(baselineChangeValue.previousRevision),
      revision: String(baselineChangeValue.revision ?? ""),
      changedAt: String(baselineChangeValue.changedAt ?? ""),
      reasons: Array.isArray(baselineChangeValue.reasons) ? baselineChangeValue.reasons.map(String) : [],
    }
    : null;
  return {
    state,
    route,
    confirmed,
    projected,
    overall: confirmed.overall,
    sections: confirmed.sections,
    warnings: warnings.slice(0, 25),
    stale: root.stale === true,
    sourceCoverageIncomplete: root.sourceCoverageIncomplete === true,
    staleSince: root.staleSince == null ? null : String(root.staleSince),
    lastSuccessfulAt: root.lastSuccessfulAt == null ? null : String(root.lastSuccessfulAt),
    unavailableSources,
    baselineRevision: root.baselineRevision == null ? null : String(root.baselineRevision),
    baselineChange,
  };
}
