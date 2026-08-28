import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const AUDIT_RETENTION_DAYS = 30;
const SENSITIVE_KEYS = /(authorization|cookie|password|secret|session|token)/i;

function redactSensitiveText(value) {
  return String(value)
    .replace(/([?&](?:access_)?(?:token|secret|password|session|cookie)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/("(?:authorization|cookie|password|secret|session|token)"\s*:\s*")[^"]+/gi, "$1[REDACTED]");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value) {
  return redactSensitiveText(value ?? "").trim();
}

function sanitized(value) {
  if (Array.isArray(value)) return value.map(sanitized);
  if (typeof value === "string") return redactSensitiveText(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEYS.test(key))
      .map(([key, entry]) => [key, sanitized(entry)]),
  );
}

function sortedStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))].sort();
}

function normalizeTargets(value) {
  return (Array.isArray(value) ? value : []).map((target) => ({
    id: text(target?.id),
    kind: text(target?.kind || "items"),
    quantity: number(target?.quantity),
    ...(text(target?.name) ? { name: text(target.name) } : {}),
  })).sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

function normalizeMultipliers(value, { semantic = false } = {}) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, row]) => [
    text(key),
    semantic
      ? number(row?.multiplier ?? row)
      : {
        multiplier: number(row?.multiplier ?? row),
        ...(text(row?.note) ? { note: text(row.note) } : {}),
      },
  ]).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeSourceRules(value = {}) {
  return {
    storageContainerIds: sortedStrings(value.storageContainerIds),
    playerIds: sortedStrings(value.playerIds),
    craftPlayerIds: sortedStrings(value.craftPlayerIds),
    bankPlayerIds: sortedStrings(value.bankPlayerIds),
    bankContainerIds: sortedStrings(value.bankContainerIds),
    deployableContainerIds: sortedStrings(value.deployableContainerIds),
  };
}

function normalizePlanInputs(config = {}) {
  return {
    targets: normalizeTargets(config.targets),
    routeOverrides: stable(sanitized(config.routeOverrides ?? {})),
    routeReviews: stable(sanitized(config.routeReviews ?? {})),
    gatheredItemKeys: sortedStrings(config.gatheredItemKeys),
    multipliers: normalizeMultipliers(config.multipliers),
    sourceRules: normalizeSourceRules(config.sourceRules),
    buildingProgress: stable(sanitized(config.buildingProgress ?? {})),
  };
}

function normalizeBaselineInputs(config = {}, metadata = {}) {
  return {
    config: {
      targets: normalizeTargets(config.targets).map(({ name, ...target }) => target),
      routeOverrides: stable(sanitized(config.routeOverrides ?? {})),
      gatheredItemKeys: sortedStrings(config.gatheredItemKeys),
      multipliers: normalizeMultipliers(config.multipliers, { semantic: true }),
    },
    catalogRevision: text(metadata.catalogRevision),
    modelVersion: number(metadata.modelVersion),
  };
}

function normalizeStockSource(source = {}) {
  return {
    sourceId: text(source.sourceId ?? source.id),
    label: text(source.label ?? source.name),
    type: text(source.type ?? source.sourceType),
    quantity: number(source.quantity),
    ...(text(source.playerId) ? { playerId: text(source.playerId) } : {}),
    ...(text(source.playerName) ? { playerName: text(source.playerName) } : {}),
  };
}

function normalizeCraftSource(source = {}) {
  return {
    craftId: text(source.craftId ?? source.sourceId ?? source.id),
    playerId: text(source.playerId),
    playerName: text(source.playerName),
    buildingId: text(source.buildingId),
    buildingName: text(source.buildingName ?? source.stationName),
    status: text(source.status ?? source.state),
    quantity: number(source.quantity),
    directQuantity: number(source.directQuantity ?? source.outputQuantity),
    guaranteedQuantity: number(source.guaranteedQuantity),
    estimatedQuantity: number(source.estimatedQuantity ?? source.quantity),
  };
}

function sourceSortKey(source) {
  return `${source.type}\u0000${source.sourceId}\u0000${source.playerId ?? ""}`;
}

function craftSortKey(source) {
  return `${source.craftId}\u0000${source.playerId}\u0000${source.buildingId}`;
}

function weightFor(weights, key) {
  if (!(weights instanceof Map)) return 1;
  const row = weights.get(key);
  const parsed = number(row?.effortWeight ?? row);
  return parsed > 0 ? parsed : 1;
}

function normalizeEffortProgress(progress = {}) {
  return sanitized(progress);
}

function capturedMaterialKey(value = {}) {
  const explicit = text(value.key);
  if (explicit) return explicit;
  const id = text(value.id ?? value.itemId ?? value.entityId);
  if (!id) return "";
  const rawKind = text(value.kind ?? value.itemType ?? value.item_type).toLowerCase();
  const kind = rawKind === "cargo" || rawKind === "1" ? "cargo" : rawKind === "building" ? "building" : "items";
  return `${kind}:${id}`;
}

function capturedDependencyPaths(plan = {}, config = {}) {
  const childrenByOutput = new Map();
  for (const step of Array.isArray(plan.steps) ? plan.steps : []) {
    const outputKey = capturedMaterialKey(step?.output);
    if (!outputKey) continue;
    const children = childrenByOutput.get(outputKey) ?? new Set();
    for (const input of Array.isArray(step?.inputs) ? step.inputs : []) {
      const inputKey = capturedMaterialKey(input);
      if (inputKey) children.add(inputKey);
    }
    childrenByOutput.set(outputKey, children);
  }
  const pathsByMaterial = new Map();
  const roots = normalizeTargets(config.targets).map(capturedMaterialKey).filter(Boolean);
  function visit(key, path, visited) {
    if (visited.has(key) || path.length > 16) return;
    const nextPath = [...path, key];
    const existing = pathsByMaterial.get(key) ?? [];
    existing.push(nextPath);
    pathsByMaterial.set(key, existing);
    const nextVisited = new Set(visited).add(key);
    for (const child of [...(childrenByOutput.get(key) ?? [])].sort()) visit(child, nextPath, nextVisited);
  }
  for (const root of roots) visit(root, [], new Set());
  return new Map([...pathsByMaterial].map(([key, paths]) => [
    key,
    [...new Map(paths.map((path) => [path.join("\u0000"), path])).values()]
      .sort((left, right) => left.join("\u0000").localeCompare(right.join("\u0000"))),
  ]));
}

export function buildCraftPlanProgressSnapshot({
  claimId,
  plan = {},
  metadata = {},
  sourceStatus = [],
  weights = new Map(),
} = {}) {
  const config = plan.config ?? {};
  const effortProgress = normalizeEffortProgress(plan.effortProgress ?? {});
  const planInputs = normalizePlanInputs(config);
  const selectedDependencyPaths = capturedDependencyPaths(plan, config);
  const baselineInputs = normalizeBaselineInputs(config, {
    catalogRevision: metadata.catalogRevision,
    modelVersion: metadata.modelVersion ?? effortProgress.modelVersion,
  });
  const materials = (Array.isArray(plan.materials) ? plan.materials : []).map((material) => {
    const key = text(material?.key);
    const planRequired = number(material?.planRequired ?? material?.bufferedRequired ?? material?.required);
    const requiredNow = number(material?.requiredNow ?? material?.bufferedRequired ?? material?.required);
    const missingNow = number(material?.missingNow ?? material?.missing);
    const visibleStock = number(material?.visibleStock ?? material?.available);
    const guaranteedCraftOutput = number(material?.guaranteedCraftOutput ?? material?.guaranteedInProgress ?? material?.guaranteedActiveOutput);
    const estimatedCraftOutput = number(material?.estimatedCraftOutput ?? material?.estimatedInProgress ?? material?.estimatedActiveOutput);
    return {
      key,
      name: text(material?.name ?? material?.label),
      planRequired,
      requiredNow,
      missingNow,
      required: number(material?.required ?? requiredNow),
      missing: number(material?.missing ?? missingNow),
      visibleStock,
      available: number(material?.available ?? visibleStock),
      guaranteedCraftOutput,
      estimatedCraftOutput,
      guaranteedInProgress: number(material?.guaranteedInProgress ?? guaranteedCraftOutput),
      estimatedInProgress: number(material?.estimatedInProgress ?? estimatedCraftOutput),
      dependencyPaths: ((Array.isArray(material?.dependencyPaths) && material.dependencyPaths.length)
        ? material.dependencyPaths
        : selectedDependencyPaths.get(key) ?? [])
        .map((path) => (Array.isArray(path) ? path.map(text).filter(Boolean) : []))
        .filter((path) => path.length > 0),
      effortWeight: weightFor(weights, key),
      sources: (Array.isArray(material?.sources) ? material.sources : [])
        .map(normalizeStockSource)
        .sort((left, right) => sourceSortKey(left).localeCompare(sourceSortKey(right))),
      activeCraftSources: (Array.isArray(material?.activeCraftSources) ? material.activeCraftSources : [])
        .map(normalizeCraftSource)
        .sort((left, right) => craftSortKey(left).localeCompare(craftSortKey(right))),
    };
  }).sort((left, right) => left.key.localeCompare(right.key));
  const normalizedSourceStatus = (Array.isArray(sourceStatus) ? sourceStatus : []).map((source) => ({
    sourceId: text(source?.sourceId ?? source?.id),
    label: text(source?.label ?? source?.name),
    type: text(source?.type ?? source?.sourceType),
    available: source?.available === true,
    ...(text(source?.error) ? { error: text(source.error).slice(0, 300) } : {}),
  })).sort((left, right) => sourceSortKey(left).localeCompare(sourceSortKey(right)));
  const baselineRevision = text(effortProgress.baselineRevision);
  return {
    schemaVersion: 2,
    claimId: text(claimId),
    planId: text(metadata.planId || plan?.plan?.id || "legacy-primary"),
    capturedAt: text(metadata.capturedAt || new Date().toISOString()),
    baselineRevision,
    baselineInputs,
    planInputs,
    planConfigFingerprint: hash(planInputs),
    progress: {
      confirmed: number(effortProgress?.confirmed?.overall?.completion ?? effortProgress?.overall?.completion),
      projected: number(effortProgress?.projected?.overall?.completion ?? effortProgress?.overall?.completion),
    },
    effortProgress,
    buildingCompletion: stable(sanitized(plan.buildingCompletion ?? config.buildingProgress ?? {})),
    validation: stable(sanitized(plan.validation ?? plan.validationResult ?? { valid: true, errors: [] })),
    materials,
    sourceStatus: normalizedSourceStatus,
    metadata: {
      appVersion: text(metadata.appVersion),
      buildId: text(metadata.buildId),
      catalogRevision: text(metadata.catalogRevision),
      modelVersion: number(metadata.modelVersion ?? effortProgress.modelVersion),
    },
  };
}

export function craftPlanProgressFingerprint(snapshot = {}) {
  const { capturedAt, ...content } = snapshot;
  return hash(content);
}

function materialMap(snapshot) {
  return new Map((snapshot?.materials ?? []).map((material) => [material.key, material]));
}

function stockMap(material) {
  return new Map((material?.sources ?? []).map((source) => [sourceSortKey(source), source]));
}

function craftMap(material) {
  return new Map((material?.activeCraftSources ?? []).map((source) => [craftSortKey(source), source]));
}

function baselineChangeReasons(previous = {}, current = {}) {
  const reasons = [];
  const before = previous.baselineInputs ?? {};
  const after = current.baselineInputs ?? {};
  const beforeConfig = before.config ?? {};
  const afterConfig = after.config ?? {};
  if (JSON.stringify(stable(beforeConfig.targets)) !== JSON.stringify(stable(afterConfig.targets))) reasons.push("Targets or target quantities changed");
  if (JSON.stringify(stable(beforeConfig.routeOverrides)) !== JSON.stringify(stable(afterConfig.routeOverrides))) reasons.push("Selected routes changed");
  if (JSON.stringify(stable(beforeConfig.gatheredItemKeys)) !== JSON.stringify(stable(afterConfig.gatheredItemKeys))) reasons.push("Gathered overrides changed");
  if (JSON.stringify(stable(beforeConfig.multipliers)) !== JSON.stringify(stable(afterConfig.multipliers))) reasons.push("Safety buffers or material multipliers changed");
  if (text(before.catalogRevision) !== text(after.catalogRevision)) reasons.push("Catalogue revision changed");
  if (number(before.modelVersion) !== number(after.modelVersion)) reasons.push("Probability or effort model version changed");
  return reasons.length ? reasons : ["Plan baseline inputs changed"];
}

function effortContributors(previous, current) {
  const before = materialMap(previous);
  const after = materialMap(current);
  return [...new Set([...before.keys(), ...after.keys()])].map((key) => {
    const previousMaterial = before.get(key);
    const currentMaterial = after.get(key);
    const weight = number(currentMaterial?.effortWeight ?? previousMaterial?.effortWeight) || 1;
    const delta = (number(currentMaterial?.missing) - number(previousMaterial?.missing)) * weight;
    return {
      itemKey: key,
      name: text(currentMaterial?.name ?? previousMaterial?.name),
      remainingEffortDelta: delta,
    };
  }).filter((row) => row.remainingEffortDelta !== 0)
    .sort((left, right) => Math.abs(right.remainingEffortDelta) - Math.abs(left.remainingEffortDelta))
    .slice(0, 20);
}

function valueDeltaEvent(type, itemKey, before, after, field) {
  const previousValue = number(before?.[field]);
  const currentValue = number(after?.[field]);
  if (previousValue === currentValue) return null;
  return {
    type,
    itemKey,
    before: previousValue,
    after: currentValue,
    delta: currentValue - previousValue,
  };
}

export function diffCraftPlanProgressSnapshots(previous = {}, current = {}) {
  const events = [];
  const baselineChanged = text(previous.baselineRevision) !== text(current.baselineRevision);
  let baselineChange = null;
  if (baselineChanged) {
    const reasons = baselineChangeReasons(previous, current);
    baselineChange = {
      previousRevision: text(previous.baselineRevision),
      revision: text(current.baselineRevision),
      changedAt: text(current.capturedAt),
      reasons,
    };
    events.push({
      type: "baseline_change",
      ...baselineChange,
      beforeProgress: sanitized(previous.progress ?? {}),
      afterProgress: sanitized(current.progress ?? {}),
    });
  }
  const confirmedDelta = number(current?.progress?.confirmed) - number(previous?.progress?.confirmed);
  const projectedDelta = number(current?.progress?.projected) - number(previous?.progress?.projected);
  if (confirmedDelta !== 0 || projectedDelta !== 0) {
    events.push({
      type: "progress_delta",
      confirmedBefore: number(previous?.progress?.confirmed),
      confirmedAfter: number(current?.progress?.confirmed),
      confirmedDelta,
      projectedBefore: number(previous?.progress?.projected),
      projectedAfter: number(current?.progress?.projected),
      projectedDelta,
      contributors: effortContributors(previous, current),
    });
  }

  const beforeMaterials = materialMap(previous);
  const afterMaterials = materialMap(current);
  for (const itemKey of [...new Set([...beforeMaterials.keys(), ...afterMaterials.keys()])].sort()) {
    const before = beforeMaterials.get(itemKey);
    const after = afterMaterials.get(itemKey);
    const comparableBefore = comparableMaterial(before);
    const comparableAfter = comparableMaterial(after);
    for (const [type, field] of [
      ["requirement_delta", "planRequired"],
      ["required_now_delta", "requiredNow"],
      ["guaranteed_output_delta", "guaranteedCraftOutput"],
      ["estimated_output_delta", "estimatedCraftOutput"],
      ["missing_quantity_delta", "missingNow"],
    ]) {
      const event = valueDeltaEvent(type, itemKey, comparableBefore, comparableAfter, field);
      if (event) events.push(event);
    }

    const beforeStock = stockMap(before);
    const afterStock = stockMap(after);
    let netStockIncrease = 0;
    for (const key of [...new Set([...beforeStock.keys(), ...afterStock.keys()])].sort()) {
      const oldSource = beforeStock.get(key);
      const newSource = afterStock.get(key);
      const delta = number(newSource?.quantity) - number(oldSource?.quantity);
      netStockIncrease += delta;
      if (delta !== 0 || !oldSource || !newSource) {
        events.push({
          type: !oldSource ? "stock_source_added" : !newSource ? "stock_source_removed" : "stock_delta",
          itemKey,
          sourceId: text(newSource?.sourceId ?? oldSource?.sourceId),
          label: text(newSource?.label ?? oldSource?.label),
          sourceType: text(newSource?.type ?? oldSource?.type),
          before: number(oldSource?.quantity),
          after: number(newSource?.quantity),
          delta,
        });
      }
    }

    const beforeCrafts = craftMap(before);
    const afterCrafts = craftMap(after);
    const craftEvents = [];
    for (const key of [...new Set([...beforeCrafts.keys(), ...afterCrafts.keys()])].sort()) {
      const oldCraft = beforeCrafts.get(key);
      const newCraft = afterCrafts.get(key);
      if (!oldCraft && newCraft) {
        craftEvents.push({ type: "craft_added", itemKey, ...newCraft });
      } else if (oldCraft && !newCraft) {
        craftEvents.push({
          type: "craft_removed",
          itemKey,
          ...oldCraft,
        });
      } else if (JSON.stringify(stable(oldCraft)) !== JSON.stringify(stable(newCraft))) {
        craftEvents.push({ type: "craft_changed", itemKey, before: oldCraft, after: newCraft });
      }
    }
    const removals = craftEvents.filter((event) => event.type === "craft_removed");
    const collectedIndexes = uniquelyCollectedCraftIndexes(removals, Math.max(0, netStockIncrease));
    for (const [index, event] of removals.entries()) {
      if (!collectedIndexes.has(index)) continue;
      event.inference = {
        cause: "collected",
        confidence: "high",
        evidence: [`Captured craft outputs uniquely allocate the stock increase of ${netStockIncrease}`],
      };
    }
    events.push(...craftEvents);
  }

  const beforeRules = previous?.planInputs?.sourceRules ?? {};
  const afterRules = current?.planInputs?.sourceRules ?? {};
  for (const rule of Object.keys({ ...beforeRules, ...afterRules }).sort()) {
    const beforeIds = new Set(beforeRules[rule] ?? []);
    const afterIds = new Set(afterRules[rule] ?? []);
    for (const sourceId of [...new Set([...beforeIds, ...afterIds])].sort()) {
      if (beforeIds.has(sourceId) === afterIds.has(sourceId)) continue;
      events.push({
        type: afterIds.has(sourceId) ? "source_configured" : "source_unconfigured",
        sourceRule: rule,
        sourceId,
      });
    }
  }

  const statusKey = (source) => `${text(source?.type)}\u0000${text(source?.sourceId)}`;
  const beforeStatuses = new Map((previous?.sourceStatus ?? []).map((source) => [statusKey(source), source]));
  const afterStatuses = new Map((current?.sourceStatus ?? []).map((source) => [statusKey(source), source]));
  for (const key of [...new Set([...beforeStatuses.keys(), ...afterStatuses.keys()])].sort()) {
    const before = beforeStatuses.get(key);
    const after = afterStatuses.get(key);
    if (before?.available === after?.available && Boolean(before) === Boolean(after)) continue;
    events.push({
      type: !after ? "source_removed" : after.available ? "source_restored" : "source_unavailable",
      sourceId: text(after?.sourceId ?? before?.sourceId),
      label: text(after?.label ?? before?.label),
      sourceType: text(after?.type ?? before?.type),
    });
  }

  if (JSON.stringify(stable(previous?.planInputs?.buildingProgress ?? {}))
    !== JSON.stringify(stable(current?.planInputs?.buildingProgress ?? {}))) {
    events.push({
      type: "building_progress_changed",
      before: sanitized(previous?.planInputs?.buildingProgress ?? {}),
      after: sanitized(current?.planInputs?.buildingProgress ?? {}),
    });
  }

  return { events, baselineChanged, baselineChange };
}

export function staleCraftPlanProgress(lastSuccess = {}, failures = [], now = new Date().toISOString()) {
  return {
    ...sanitized(lastSuccess),
    stale: true,
    staleSince: text(now),
    unavailableSources: (Array.isArray(failures) ? failures : []).map((failure) => ({
      sourceId: text(failure?.sourceId),
      label: text(failure?.label ?? failure?.sourceId ?? "Unknown source"),
      type: text(failure?.type || "Planner source"),
      error: text(failure?.error || "Refresh failed").slice(0, 300),
    })),
    warnings: [...new Set([
      ...(Array.isArray(lastSuccess?.warnings) ? lastSuccess.warnings : []),
      "Planner progress is showing the last complete refresh because one or more counted sources are unavailable.",
    ])],
  };
}

export function normalizeCraftPlanAuditRange(value, now = new Date().toISOString()) {
  const label = text(value || "3d").toLowerCase();
  const durations = { "24h": 24, "3d": 72, "7d": 168, all: AUDIT_RETENTION_DAYS * 24 };
  if (!(label in durations)) throw new Error("Invalid audit range. Use 24h, 3d, 7d, or all.");
  const timestamp = new Date(now);
  if (Number.isNaN(timestamp.getTime())) throw new Error("Invalid audit range timestamp.");
  return {
    label,
    since: new Date(timestamp.getTime() - durations[label] * 60 * 60 * 1000).toISOString(),
  };
}

function gzipJson(value) {
  return gzipSync(Buffer.from(JSON.stringify(value)));
}

function gunzipJson(value) {
  if (!value) return null;
  return JSON.parse(gunzipSync(Buffer.from(value)).toString("utf8"));
}

function dependencyPathsFor(previous, current, materialKey) {
  const material = materialMap(current).get(materialKey) ?? materialMap(previous).get(materialKey);
  const paths = (Array.isArray(material?.dependencyPaths) ? material.dependencyPaths : [])
    .map((path) => (Array.isArray(path) ? path.map(text).filter(Boolean) : []))
    .filter((path) => path.length > 0);
  return paths;
}

function observedTrigger(event) {
  if (["stock_delta", "stock_source_added", "stock_source_removed"].includes(event.type)) return "stock_movement";
  if (["craft_added", "craft_removed", "craft_changed"].includes(event.type)) return "craft_transition";
  if (["source_failure", "source_recovered", "source_unavailable", "source_restored", "source_removed"].includes(event.type)) return "source_health";
  if (["source_configured", "source_unconfigured", "building_progress_changed"].includes(event.type)) return "plan_config_save";
  return null;
}

function derivedEffect(event) {
  if (["requirement_delta", "required_now_delta"].includes(event.type)) return "demand_change";
  if (event.type === "missing_quantity_delta") return "shortage_change";
  if (event.type === "progress_delta") return "progress_change";
  if (["guaranteed_output_delta", "estimated_output_delta"].includes(event.type)) return "craft_output_change";
  return null;
}

function effectHasSupportedRelationship(event, events) {
  const materialKey = text(event.itemKey);
  if (events.some((candidate) => candidate.type === "baseline_change")) {
    return ["requirement_delta", "required_now_delta", "missing_quantity_delta", "progress_delta"].includes(event.type);
  }
  if (["guaranteed_output_delta", "estimated_output_delta"].includes(event.type)) {
    return events.some((candidate) => text(candidate.itemKey) === materialKey
      && ["craft_added", "craft_removed", "craft_changed"].includes(candidate.type));
  }
  if (event.type === "missing_quantity_delta") {
    return events.some((candidate) => text(candidate.itemKey) === materialKey
      && ["stock_delta", "stock_source_added", "stock_source_removed"].includes(candidate.type)
      && number(candidate.delta) === -number(event.delta));
  }
  if (event.type === "progress_delta") {
    const contributorKeys = new Set((event.contributors ?? []).map((entry) => text(entry.itemKey)).filter(Boolean));
    return events.some((candidate) => contributorKeys.has(text(candidate.itemKey))
      && ["stock_delta", "stock_source_added", "stock_source_removed", "craft_added", "craft_removed", "craft_changed"].includes(candidate.type));
  }
  return false;
}

export function buildCraftPlanCausalGroup(previous, current, events = []) {
  const observedTriggers = [];
  const derivedEffects = [];
  const derivedEffectEvents = [];
  for (const event of events) {
    const triggerCategory = observedTrigger(event);
    if (triggerCategory) observedTriggers.push({ category: triggerCategory, type: event.type, materialKey: text(event.itemKey) || null });
    const effectCategory = derivedEffect(event);
    if (effectCategory) {
      derivedEffects.push({ category: effectCategory, type: event.type, materialKey: text(event.itemKey) || null, before: event.before, after: event.after, delta: event.delta });
      derivedEffectEvents.push(event);
    }
    if (event.type === "baseline_change") {
      const reasons = Array.isArray(event.reasons) ? event.reasons : [];
      if (reasons.some((reason) => /catalogue|model version/i.test(reason))) {
        observedTriggers.push({ category: "catalogue_baseline_change", type: event.type, materialKey: null });
      }
      if (reasons.some((reason) => !/catalogue|model version/i.test(reason))) {
        observedTriggers.push({ category: "plan_config_save", type: event.type, materialKey: null });
      }
    }
  }
  const affectedMaterialKeys = [...new Set(events.map((event) => text(event.itemKey)).filter(Boolean))].sort();
  const dependencyPaths = affectedMaterialKeys.map((materialKey) => ({
    materialKey,
    paths: dependencyPathsFor(previous, current, materialKey),
  })).filter((entry) => entry.paths.length > 0);
  const unresolvedRelationships = derivedEffectEvents
    .filter((event) => !effectHasSupportedRelationship(event, events))
    .map((event) => ({
      materialKey: text(event.itemKey) || null,
      effectType: event.type,
      reason: "Captured evidence does not prove which observed trigger caused this effect.",
    }));
  for (const event of events.filter((entry) => entry.type === "craft_removed" && entry.inference?.cause !== "collected")) {
    unresolvedRelationships.push({
      materialKey: text(event.itemKey) || null,
      effectType: event.type,
      reason: "Captured stock movement does not exactly match the disappearing craft output, so collection is unproven.",
    });
  }
  for (const event of events.filter((entry) => entry.type === "source_failure")) {
    unresolvedRelationships.push({
      materialKey: null,
      triggerType: event.type,
      reason: "The source failure is observed, but its downstream demand, shortage, and progress effects have not yet been observed.",
    });
    for (const limitation of event.evidenceLimitations ?? []) {
      unresolvedRelationships.push({
        materialKey: null,
        triggerType: event.type,
        relationship: "prior_success_checkpoint",
        reason: text(limitation),
      });
    }
  }
  for (const event of events.filter((entry) => entry.type === "source_recovered")) {
    unresolvedRelationships.push({
      materialKey: null,
      triggerType: event.type,
      reason: "Source recovery is observed, but captured evidence does not uniquely attribute downstream changes to that recovery.",
    });
  }
  const core = {
    planId: text(current?.planId || previous?.planId || "legacy-primary"),
    span: { from: text(previous?.capturedAt), to: text(current?.capturedAt) },
    checkpoints: {
      from: { capturedAt: text(previous?.capturedAt), baselineRevision: text(previous?.baselineRevision) },
      to: { capturedAt: text(current?.capturedAt), baselineRevision: text(current?.baselineRevision) },
    },
    observedTriggers,
    derivedEffects,
    dependencyPaths,
    unresolvedRelationships,
    materialKeys: affectedMaterialKeys,
    events: sanitized(events),
  };
  return { groupId: hash(core), ...core };
}

function parseCausalGroupRow(row) {
  try { return JSON.parse(String(row?.payload_json ?? "{}")); } catch {
    return {
      groupId: text(row?.group_id),
      span: { from: text(row?.from_captured_at), to: text(row?.to_captured_at) },
      observedTriggers: [], derivedEffects: [], dependencyPaths: [], unresolvedRelationships: [], materialKeys: [], events: [], corrupt: true,
    };
  }
}

function compatibilityForSnapshots(snapshots) {
  const legacyEvidence = snapshots.some((snapshot) => number(snapshot?.schemaVersion) === 1);
  return {
    legacyEvidence,
    limitations: legacyEvidence
      ? ["Schema version 1 evidence does not contain stable planRequired/requiredNow/missingNow totals, explicit visible stock, selected dependency paths, route reviews, validation, or building completion. Cross-schema configuration fingerprints are not treated as user changes, and historical values are not reconstructed from the current catalogue."]
      : [],
  };
}

function uniquelyCollectedCraftIndexes(crafts, stockIncrease) {
  if (stockIncrease <= 0 || crafts.length === 0 || crafts.length > 20) return new Set();
  const solutions = new Set();
  const selected = [];
  const visit = (index, remaining) => {
    if (solutions.size > 1) return;
    if (remaining === 0) {
      solutions.add(selected.join(","));
      return;
    }
    if (index >= crafts.length || remaining < 0) return;
    visit(index + 1, remaining);
    const candidates = [...new Set([
      number(crafts[index]?.guaranteedQuantity),
      number(crafts[index]?.estimatedQuantity),
      number(crafts[index]?.quantity),
    ].filter((quantity) => quantity > 0))];
    for (const quantity of candidates) {
      selected.push(index);
      visit(index + 1, remaining - quantity);
      selected.pop();
    }
  };
  visit(0, stockIncrease);
  if (solutions.size !== 1) return new Set();
  const [solution] = solutions;
  return new Set(solution ? solution.split(",").map(Number) : []);
}

function changed(before, after) {
  const safeBefore = stable(sanitized(before));
  const safeAfter = stable(sanitized(after));
  return { changed: JSON.stringify(safeBefore) !== JSON.stringify(safeAfter), before: safeBefore, after: safeAfter };
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function comparableMaterial(material = {}) {
  return {
    key: material.key,
    name: material.name,
    planRequired: firstDefined(material.planRequired, material.required),
    requiredNow: firstDefined(material.requiredNow, material.required),
    missingNow: firstDefined(material.missingNow, material.missing),
    visibleStock: firstDefined(material.visibleStock, material.available),
    guaranteedCraftOutput: firstDefined(material.guaranteedCraftOutput, material.guaranteedInProgress),
    estimatedCraftOutput: firstDefined(material.estimatedCraftOutput, material.estimatedInProgress),
  };
}

function comparableMaterials(snapshot) {
  return (snapshot?.materials ?? []).map(comparableMaterial);
}

function comparableBuildingProgress(snapshot) {
  return {
    buildingCompletion: firstDefined(snapshot?.buildingCompletion, snapshot?.planInputs?.buildingProgress),
    progress: snapshot?.progress,
  };
}

function comparableRouteConfig(snapshot, { legacyEvidence, crossSchema }) {
  const planInputs = snapshot?.planInputs ?? {};
  const comparableInputs = legacyEvidence
    ? Object.fromEntries(Object.entries(planInputs).filter(([key]) => key !== "routeReviews"))
    : planInputs;
  return {
    planInputs: comparableInputs,
    ...(crossSchema ? {} : { fingerprint: snapshot?.planConfigFingerprint }),
  };
}

function comparisonDifferences(before, after) {
  const materialSources = (snapshot) => (snapshot?.materials ?? []).map((material) => ({ key: material.key, sources: material.sources ?? [] }));
  const crafts = (snapshot) => (snapshot?.materials ?? []).map((material) => ({ key: material.key, activeCraftSources: material.activeCraftSources ?? [] }));
  const beforeVersion = number(before?.schemaVersion) || 1;
  const afterVersion = number(after?.schemaVersion) || 1;
  const legacyEvidence = beforeVersion === 1 || afterVersion === 1;
  const crossSchema = beforeVersion !== afterVersion;
  return {
    baseline: changed({ baselineRevision: before?.baselineRevision, baselineInputs: before?.baselineInputs }, { baselineRevision: after?.baselineRevision, baselineInputs: after?.baselineInputs }),
    routeConfig: changed(comparableRouteConfig(before, { legacyEvidence, crossSchema }), comparableRouteConfig(after, { legacyEvidence, crossSchema })),
    materials: changed(comparableMaterials(before), comparableMaterials(after)),
    sources: changed({ sourceStatus: before?.sourceStatus ?? [], materials: materialSources(before) }, { sourceStatus: after?.sourceStatus ?? [], materials: materialSources(after) }),
    craft: changed(crafts(before), crafts(after)),
    buildingProgress: changed(comparableBuildingProgress(before), comparableBuildingProgress(after)),
    validation: legacyEvidence ? changed(null, null) : changed(before?.validation ?? null, after?.validation ?? null),
  };
}

function parseEventRow(row) {
  let payload = {};
  try {
    payload = JSON.parse(String(row?.payload_json ?? "{}"));
  } catch {
    payload = { type: text(row?.event_type), corrupt: true };
  }
  return {
    id: number(row?.id),
    capturedAt: text(row?.captured_at),
    baselineRevision: text(row?.baseline_revision),
    eventType: text(row?.event_type),
    summary: text(row?.summary),
    ...payload,
  };
}

function eventSummary(event = {}) {
  if (event.type === "progress_delta") {
    const confirmed = number(event.confirmedDelta);
    const projected = number(event.projectedDelta);
    return `Confirmed ${confirmed >= 0 ? "+" : ""}${confirmed.toFixed(1)}%; projected ${projected >= 0 ? "+" : ""}${projected.toFixed(1)}%`;
  }
  if (event.type === "baseline_change") return `Plan baseline changed: ${(event.reasons ?? []).join("; ")}`;
  if (event.type === "source_failure") return `${event.failures?.length ?? 0} planner source refresh failure(s)`;
  if (event.type === "source_recovered") return "All counted planner sources recovered";
  if (event.type === "stock_delta") return `${event.label || event.sourceId}: stock ${event.delta >= 0 ? "+" : ""}${event.delta}`;
  if (event.type === "craft_added") return `${event.playerName || "Player"} craft added for ${event.itemKey}`;
  if (event.type === "craft_removed") return `${event.playerName || "Player"} craft removed for ${event.itemKey}`;
  return text(event.type).replaceAll("_", " ");
}

function normalizeFailures(failures = []) {
  return (Array.isArray(failures) ? failures : []).map((failure) => ({
    sourceId: text(failure?.sourceId),
    label: text(failure?.label ?? failure?.sourceId ?? "Unknown source"),
    type: text(failure?.type || "Planner source"),
    error: text(failure?.error || "Refresh failed").slice(0, 300),
  })).sort((left, right) => `${left.type}:${left.sourceId}:${left.label}`
    .localeCompare(`${right.type}:${right.sourceId}:${right.label}`));
}

function hoursBetween(left, right) {
  const first = new Date(left).getTime();
  const second = new Date(right).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(second)) return Number.POSITIVE_INFINITY;
  return (second - first) / (60 * 60 * 1000);
}

export function createCraftPlanProgressAuditRepository(db, {
  statements,
  now = () => new Date().toISOString(),
  retentionDays = AUDIT_RETENTION_DAYS,
  pruneBatchSize = 500,
} = {}) {
  if (!db || !statements) throw new Error("Craft Plan progress audit requires a database and prepared statements.");

  function stateFor(claimId, planId = "legacy-primary") {
    return statements.getCraftPlanProgressAuditState.get(text(claimId), text(planId)) ?? null;
  }

  function updateState(claimId, planId, values) {
    statements.upsertCraftPlanProgressAuditState.run(
      text(claimId),
      text(planId),
      values.lastFingerprint ?? null,
      values.lastPayloadGzip ?? null,
      values.lastSnapshotId ?? null,
      values.lastFullSnapshotAt ?? null,
      values.lastSuccessAt ?? null,
      values.lastFailureFingerprint ?? null,
      values.lastError ?? null,
      values.updatedAt,
    );
  }

  function latestSuccess(claimId, planId = "legacy-primary") {
    const state = stateFor(claimId, planId);
    try {
      const payload = gunzipJson(state?.last_payload_gzip);
      if (payload) return payload;
    } catch {
      // Fall through to durable historical checkpoints.
    }
    const pageSize = 25;
    let offset = 0;
    while (true) {
      const rows = statements.pageLatestCraftPlanProgressSnapshots.all(text(claimId), text(planId), pageSize, offset);
      for (const row of rows) {
        try {
          const payload = gunzipJson(row.payload_gzip);
          if (payload) return payload;
        } catch {
          // Keep scanning older valid checkpoints.
        }
      }
      if (rows.length < pageSize) return null;
      offset += rows.length;
    }
  }

  function insertEvent(claimId, planId, capturedAt, baselineRevision, event) {
    statements.insertCraftPlanProgressEvent.run(
      text(claimId),
      text(planId),
      capturedAt,
      text(baselineRevision) || null,
      text(event.type),
      eventSummary(event),
      JSON.stringify(event),
    );
  }

  function prune(capturedAt = now()) {
    const timestamp = new Date(capturedAt);
    const cutoff = new Date(timestamp.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const snapshotResult = statements.pruneCraftPlanProgressSnapshots.run(cutoff, pruneBatchSize);
    const eventResult = statements.pruneCraftPlanProgressEvents.run(cutoff, pruneBatchSize);
    const causalResult = statements.pruneCraftPlanProgressCausalGroups.run(cutoff, pruneBatchSize);
    return {
      cutoff,
      snapshotsDeleted: number(snapshotResult.changes),
      eventsDeleted: number(eventResult.changes),
      causalGroupsDeleted: number(causalResult.changes),
    };
  }

  function recordSuccess(snapshot) {
    const claimId = text(snapshot?.claimId);
    const planId = text(snapshot?.planId || "legacy-primary");
    const capturedAt = text(snapshot?.capturedAt || now());
    if (!claimId) throw new Error("Craft Plan progress audit snapshot requires a claim ID.");
    const state = stateFor(claimId, planId);
    const previous = latestSuccess(claimId, planId);
    const fingerprint = craftPlanProgressFingerprint(snapshot);
    const baselineChanged = Boolean(previous)
      && text(previous.baselineRevision) !== text(snapshot.baselineRevision);
    const fullSnapshot = !previous
      || baselineChanged
      || hoursBetween(state?.last_full_snapshot_at, capturedAt) >= 6;
    const duplicate = text(state?.last_fingerprint) === fingerprint;
    const recovering = Boolean(state?.last_failure_fingerprint);
    const recordSnapshot = !duplicate || fullSnapshot;
    let payloadGzip = gzipJson(snapshot);
    if (duplicate && !fullSnapshot && state?.last_payload_gzip) {
      try {
        gunzipJson(state.last_payload_gzip);
        payloadGzip = Buffer.from(state.last_payload_gzip);
      } catch {
        // The current successful capture repairs corrupt state evidence below.
      }
    }

    const diff = previous
      ? diffCraftPlanProgressSnapshots(previous, snapshot)
      : { events: [], baselineChanged: false, baselineChange: null };
    const recoveryEvent = recovering ? {
      type: "source_recovered",
      previousError: text(state.last_error),
    } : null;
    const events = recoveryEvent ? [...diff.events, recoveryEvent] : [...diff.events];

    if (!recordSnapshot && !recovering) {
      updateState(claimId, planId, {
        lastFingerprint: fingerprint,
        lastPayloadGzip: payloadGzip,
        lastSnapshotId: state?.last_snapshot_id,
        lastFullSnapshotAt: state?.last_full_snapshot_at,
        lastSuccessAt: capturedAt,
        lastFailureFingerprint: state?.last_failure_fingerprint,
        lastError: state?.last_error,
        updatedAt: capturedAt,
      });
      return {
        recorded: false,
        fullSnapshot: false,
        events: [],
        baselineChanged: false,
        baselineChange: null,
        capturedAt,
      };
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      let lastSnapshotId = state?.last_snapshot_id ?? null;
      let lastFullSnapshotAt = state?.last_full_snapshot_at ?? null;
      if (recordSnapshot) {
        const result = statements.insertCraftPlanProgressSnapshot.run(
          claimId,
          planId,
          capturedAt,
          text(snapshot.baselineRevision),
          fingerprint,
          fullSnapshot ? 1 : 0,
          payloadGzip,
          text(snapshot?.metadata?.appVersion),
          text(snapshot?.metadata?.buildId),
        );
        lastSnapshotId = result.lastInsertRowid;
        if (fullSnapshot) lastFullSnapshotAt = capturedAt;
      }
      for (const event of events) insertEvent(claimId, planId, capturedAt, snapshot.baselineRevision, event);
      if (previous && diff.events.length) {
        const group = buildCraftPlanCausalGroup(previous, snapshot, diff.events);
        statements.insertCraftPlanProgressCausalGroup.run(
          claimId, planId, group.groupId, group.span.from, group.span.to, JSON.stringify(group),
        );
      }
      if (recoveryEvent) {
        const recoveryPrevious = {
          planId,
          capturedAt: text(state.updated_at),
          baselineRevision: text(snapshot.baselineRevision),
        };
        const group = buildCraftPlanCausalGroup(recoveryPrevious, snapshot, [recoveryEvent]);
        statements.insertCraftPlanProgressCausalGroup.run(
          claimId, planId, group.groupId, group.span.from, group.span.to, JSON.stringify(group),
        );
      }
      updateState(claimId, planId, {
        lastFingerprint: fingerprint,
        lastPayloadGzip: payloadGzip,
        lastSnapshotId,
        lastFullSnapshotAt,
        lastSuccessAt: capturedAt,
        lastFailureFingerprint: null,
        lastError: null,
        updatedAt: capturedAt,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    prune(capturedAt);
    return {
      recorded: recordSnapshot,
      fullSnapshot,
      events,
      baselineChanged: diff.baselineChanged,
      baselineChange: diff.baselineChange,
      capturedAt,
    };
  }

  function recordFailure(claimId, failures, capturedAt = now(), planId = "legacy-primary") {
    const normalized = normalizeFailures(failures);
    const failureFingerprint = hash(normalized);
    const current = stateFor(claimId, planId);
    const error = normalized.map((failure) => `${failure.label}: ${failure.error}`).join("; ").slice(0, 1000);
    const changed = text(current?.last_failure_fingerprint) !== failureFingerprint;
    const previous = latestSuccess(claimId, planId);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (changed) {
        const event = {
          type: "source_failure",
          failures: normalized,
          ...(!previous ? {
            evidenceLimitations: ["No valid prior success checkpoint is available; downstream relationships cannot be reconstructed."],
          } : {}),
        };
        insertEvent(claimId, planId, capturedAt, text(previous?.baselineRevision), event);
        const group = buildCraftPlanCausalGroup(
          previous ?? { planId, capturedAt, baselineRevision: "" },
          { planId, capturedAt, baselineRevision: text(previous?.baselineRevision) },
          [event],
        );
        statements.insertCraftPlanProgressCausalGroup.run(
          text(claimId), text(planId), group.groupId, group.span.from, group.span.to, JSON.stringify(group),
        );
      }
      updateState(claimId, planId, {
        lastFingerprint: current?.last_fingerprint,
        lastPayloadGzip: current?.last_payload_gzip,
        lastSnapshotId: current?.last_snapshot_id,
        lastFullSnapshotAt: current?.last_full_snapshot_at,
        lastSuccessAt: current?.last_success_at,
        lastFailureFingerprint: failureFingerprint,
        lastError: error,
        updatedAt: capturedAt,
      });
      db.exec("COMMIT");
    } catch (failure) {
      db.exec("ROLLBACK");
      throw failure;
    }
    prune(capturedAt);
    return { recorded: changed, capturedAt, failures: normalized };
  }

  function listEvents(claimId, {
    since = new Date(new Date(now()).getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString(),
    limit = 100,
    planId = "legacy-primary",
  } = {}) {
    return statements.listCraftPlanProgressEvents
      .all(text(claimId), text(planId), text(since), Math.min(10_000, Math.max(1, Math.trunc(number(limit) || 100))))
      .map(parseEventRow);
  }

  function status(claimId, planId = "legacy-primary") {
    const state = stateFor(claimId, planId);
    const latest = latestSuccess(claimId, planId);
    const counts = statements.craftPlanProgressAuditCounts.get(
      text(claimId),
      text(planId),
      text(claimId),
      text(planId),
      text(claimId),
      text(planId),
      text(claimId),
      text(planId),
    ) ?? {};
    return {
      claimId: text(claimId),
      lastSuccessfulAt: text(state?.last_success_at) || null,
      lastFullSnapshotAt: text(state?.last_full_snapshot_at) || null,
      lastError: text(state?.last_error) || null,
      updatedAt: text(state?.updated_at) || null,
      snapshotCount: number(counts.snapshot_count),
      eventCount: number(counts.event_count),
      storedBytes: number(counts.stored_bytes),
      retentionDays,
      baselineRevision: text(latest?.baselineRevision) || null,
      confirmedCompletion: latest ? number(latest?.progress?.confirmed ?? latest?.effortProgress?.confirmed?.overall?.completion) : null,
      projectedCompletion: latest ? number(latest?.progress?.projected ?? latest?.effortProgress?.projected?.overall?.completion) : null,
    };
  }

  function latestBaselineChange(claimId, planId = "legacy-primary") {
    const row = statements.latestCraftPlanBaselineChange.get(text(claimId), text(planId));
    return row ? parseEventRow(row) : null;
  }

  function causalFilterArguments(claimId, {
    planId = "legacy-primary",
    since = "0000-01-01T00:00:00.000Z",
    until = "9999-12-31T23:59:59.999Z",
    triggerCategory = "",
    effectCategory = "",
    materialKey = "",
    unresolvedOnly = false,
  } = {}) {
    return [
      text(claimId), text(planId), text(since), text(until),
      text(triggerCategory), text(triggerCategory),
      text(effectCategory), text(effectCategory),
      text(materialKey), text(materialKey),
      unresolvedOnly ? 1 : 0,
    ];
  }

  function queryCausalGroups(claimId, {
    page = 1,
    pageSize = 50,
    ...filters
  } = {}) {
    const boundedPageSize = Math.min(200, Math.max(1, Math.trunc(number(pageSize) || 50)));
    const boundedPage = Math.max(1, Math.trunc(number(page) || 1));
    const filterArguments = causalFilterArguments(claimId, filters);
    const total = number(statements.countCraftPlanProgressCausalGroupsFiltered.get(...filterArguments)?.count);
    const totalPages = Math.max(1, Math.ceil(total / boundedPageSize));
    const offset = (boundedPage - 1) * boundedPageSize;
    return {
      causalGroups: statements.pageCraftPlanProgressCausalGroupsFiltered
        .all(...filterArguments, boundedPageSize, offset)
        .map(parseCausalGroupRow),
      pagination: {
        page: boundedPage, pageSize: boundedPageSize, total, totalPages,
        hasNext: offset + boundedPageSize < total,
        hasPrevious: boundedPage > 1,
      },
    };
  }

  function storedCheckpoint(claimId, planId, capturedAt) {
    const row = statements.craftPlanProgressSnapshotAt.get(text(claimId), text(planId), text(capturedAt));
    if (!row) return { error: { code: "missing_evidence", message: `No stored checkpoint exists at ${text(capturedAt)}.` } };
    try { return { snapshot: gunzipJson(row.payload_gzip) }; } catch {
      return { error: { code: "corrupt_evidence", message: `Stored checkpoint ${text(capturedAt)} is corrupt.` } };
    }
  }

  function compareCheckpoints(claimId, { planId = "legacy-primary", from, to } = {}) {
    const before = storedCheckpoint(claimId, planId, from);
    const after = storedCheckpoint(claimId, planId, to);
    if (before.error || after.error) return { ok: false, error: before.error ?? after.error, limitations: [] };
    const snapshots = [before.snapshot, after.snapshot];
    return {
      ok: true,
      planId: text(planId),
      checkpoints: {
        from: { capturedAt: text(before.snapshot.capturedAt), schemaVersion: number(before.snapshot.schemaVersion) || 1 },
        to: { capturedAt: text(after.snapshot.capturedAt), schemaVersion: number(after.snapshot.schemaVersion) || 1 },
      },
      differences: comparisonDifferences(before.snapshot, after.snapshot),
      compatibility: compatibilityForSnapshots(snapshots),
    };
  }

  function exportRange(claimId, range, planId = "legacy-primary") {
    const warnings = [];
    const requestedSince = text(range.since);
    let checkpoint = null;
    for (const row of statements.listCraftPlanProgressSnapshotsBefore.all(text(claimId), text(planId), requestedSince)) {
      try {
        gunzipJson(row.payload_gzip);
        checkpoint = row;
        break;
      } catch {
        warnings.push(`Skipped corrupt snapshot ${row.id}.`);
      }
    }
    const rows = statements.listCraftPlanProgressSnapshotsSince.all(text(claimId), text(planId), requestedSince);
    const uniqueRows = new Map();
    if (checkpoint) uniqueRows.set(number(checkpoint.id), checkpoint);
    for (const row of rows) uniqueRows.set(number(row.id), row);
    const snapshots = [];
    for (const row of [...uniqueRows.values()].sort((left, right) => text(left.captured_at).localeCompare(text(right.captured_at)))) {
      try {
        snapshots.push(gunzipJson(row.payload_gzip));
      } catch {
        warnings.push(`Skipped corrupt snapshot ${row.id}.`);
      }
    }
    let effectiveSince = checkpoint ? requestedSince : null;
    if (!checkpoint) {
      if (snapshots.length) {
        effectiveSince = text(snapshots[0].capturedAt);
        warnings.push("No valid checkpoint predates the requested range; reconstruction starts at the first retained full snapshot.");
      } else {
        warnings.push("No valid checkpoint evidence is available; the requested range cannot be reconstructed.");
      }
    }
    return {
      schemaVersion: 2,
      generatedAt: text(now()),
      retentionDays,
      claimId: text(claimId),
      requestedRange: text(range.label),
      effectiveSince,
      planId: text(planId),
      status: status(claimId, planId),
      snapshots,
      events: statements.exportCraftPlanProgressEvents
        .all(text(claimId), text(planId), requestedSince)
        .map(parseEventRow),
      configHistory: statements.listCraftPlanConfigAudit.all(text(planId)).map((row) => {
        let changes = { corrupt: true };
        try { changes = JSON.parse(String(row.changes_json)); } catch {}
        return {
          id: number(row.id), planId: text(row.plan_id), claimId: row.claim_id == null ? null : text(row.claim_id),
          actor: { type: text(row.actor_type), id: row.actor_id == null ? null : text(row.actor_id), displayName: text(row.actor_display_name) },
          occurredAt: text(row.occurred_at), previousRevision: row.previous_revision == null ? null : number(row.previous_revision),
          newRevision: number(row.new_revision), action: text(row.action), changes,
        };
      }).filter((row) => row.occurredAt >= text(range.since)),
      causalGroups: statements.exportCraftPlanProgressCausalGroups
        .all(text(claimId), text(planId), requestedSince, "9999-12-31T23:59:59.999Z")
        .map(parseCausalGroupRow),
      compatibility: compatibilityForSnapshots(snapshots),
      warnings,
    };
  }

  return {
    recordSuccess,
    recordFailure,
    latestSuccess,
    status,
    listEvents,
    latestBaselineChange,
    queryCausalGroups,
    compareCheckpoints,
    exportRange,
    prune,
  };
}
