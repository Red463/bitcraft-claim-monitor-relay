import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const AUDIT_RETENTION_DAYS = 14;
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
  const baselineInputs = normalizeBaselineInputs(config, {
    catalogRevision: metadata.catalogRevision,
    modelVersion: metadata.modelVersion ?? effortProgress.modelVersion,
  });
  const materials = (Array.isArray(plan.materials) ? plan.materials : []).map((material) => {
    const key = text(material?.key);
    return {
      key,
      name: text(material?.name ?? material?.label),
      required: number(material?.bufferedRequired ?? material?.required),
      missing: number(material?.missing),
      available: number(material?.available),
      guaranteedInProgress: number(material?.guaranteedInProgress ?? material?.guaranteedActiveOutput),
      estimatedInProgress: number(material?.estimatedInProgress ?? material?.estimatedActiveOutput),
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
    schemaVersion: 1,
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
  } else {
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
  }

  const beforeMaterials = materialMap(previous);
  const afterMaterials = materialMap(current);
  for (const itemKey of [...new Set([...beforeMaterials.keys(), ...afterMaterials.keys()])].sort()) {
    const before = beforeMaterials.get(itemKey);
    const after = afterMaterials.get(itemKey);
    for (const [type, field] of [
      ["requirement_delta", "required"],
      ["guaranteed_output_delta", "guaranteedInProgress"],
      ["estimated_output_delta", "estimatedInProgress"],
      ["missing_quantity_delta", "missing"],
    ]) {
      const event = valueDeltaEvent(type, itemKey, before, after, field);
      if (event) events.push(event);
    }

    const beforeStock = stockMap(before);
    const afterStock = stockMap(after);
    let matchingStockIncrease = 0;
    for (const key of [...new Set([...beforeStock.keys(), ...afterStock.keys()])].sort()) {
      const oldSource = beforeStock.get(key);
      const newSource = afterStock.get(key);
      const delta = number(newSource?.quantity) - number(oldSource?.quantity);
      if (delta > 0) matchingStockIncrease += delta;
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
    for (const key of [...new Set([...beforeCrafts.keys(), ...afterCrafts.keys()])].sort()) {
      const oldCraft = beforeCrafts.get(key);
      const newCraft = afterCrafts.get(key);
      if (!oldCraft && newCraft) {
        events.push({ type: "craft_added", itemKey, ...newCraft });
      } else if (oldCraft && !newCraft) {
        events.push({
          type: "craft_removed",
          itemKey,
          ...oldCraft,
          ...(matchingStockIncrease > 0 ? {
            inference: {
              cause: "collected",
              confidence: "medium",
              evidence: [`Matching stock increased by ${matchingStockIncrease}`],
            },
          } : {}),
        });
      } else if (JSON.stringify(stable(oldCraft)) !== JSON.stringify(stable(newCraft))) {
        events.push({ type: "craft_changed", itemKey, before: oldCraft, after: newCraft });
      }
    }
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
    for (const row of statements.listLatestCraftPlanProgressSnapshots.all(text(claimId), text(planId), 25)) {
      try {
        const payload = gunzipJson(row.payload_gzip);
        if (payload) return payload;
      } catch {
        // Keep scanning older valid checkpoints.
      }
    }
    return null;
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
    return {
      cutoff,
      snapshotsDeleted: number(snapshotResult.changes),
      eventsDeleted: number(eventResult.changes),
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
    const payloadGzip = duplicate && state?.last_payload_gzip
      ? Buffer.from(state.last_payload_gzip)
      : gzipJson(snapshot);

    if (duplicate && !fullSnapshot) {
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

    const diff = previous
      ? diffCraftPlanProgressSnapshots(previous, snapshot)
      : { events: [], baselineChanged: false, baselineChange: null };
    const events = [...diff.events];
    if (state?.last_failure_fingerprint) {
      events.push({
        type: "source_recovered",
        previousError: text(state.last_error),
      });
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      let lastSnapshotId = state?.last_snapshot_id ?? null;
      let lastFullSnapshotAt = state?.last_full_snapshot_at ?? null;
      if (fullSnapshot) {
        const result = statements.insertCraftPlanProgressSnapshot.run(
          claimId,
          planId,
          capturedAt,
          text(snapshot.baselineRevision),
          fingerprint,
          1,
          payloadGzip,
          text(snapshot?.metadata?.appVersion),
          text(snapshot?.metadata?.buildId),
        );
        lastSnapshotId = result.lastInsertRowid;
        lastFullSnapshotAt = capturedAt;
      }
      for (const event of events) insertEvent(claimId, planId, capturedAt, snapshot.baselineRevision, event);
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
      recorded: true,
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
    db.exec("BEGIN IMMEDIATE");
    try {
      if (changed) {
        insertEvent(claimId, planId, capturedAt, current?.last_fingerprint ? latestSuccess(claimId, planId)?.baselineRevision : "", {
          type: "source_failure",
          failures: normalized,
        });
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

  function exportRange(claimId, range, planId = "legacy-primary") {
    const warnings = [];
    const checkpoint = statements.latestCraftPlanProgressSnapshotBefore.get(text(claimId), text(planId), text(range.since));
    const rows = statements.listCraftPlanProgressSnapshotsSince.all(text(claimId), text(planId), text(range.since));
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
    let effectiveSince = text(range.since);
    if (!checkpoint && snapshots.length) {
      effectiveSince = text(snapshots[0].capturedAt);
      warnings.push("No valid checkpoint predates the requested range; reconstruction starts at the first retained full snapshot.");
    }
    return {
      schemaVersion: 1,
      generatedAt: text(now()),
      retentionDays,
      claimId: text(claimId),
      requestedRange: text(range.label),
      effectiveSince,
      planId: text(planId),
      status: status(claimId, planId),
      snapshots,
      events: listEvents(claimId, { since: effectiveSince, limit: 10_000, planId }),
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
    exportRange,
    prune,
  };
}
