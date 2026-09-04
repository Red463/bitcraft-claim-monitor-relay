import { withoutClosedEventRegions } from "./relayRegionPolicy.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function decimalRegionIds(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  return [...new Set(values
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => /^\d+$/.test(entry)))]
    .sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0));
}

export function relayActiveRegions(options = {}) {
  const claimRegionId = decimalRegionIds([options.claimRegionId])[0] ?? "";
  const defaultRegionId = decimalRegionIds([options.defaultRegionId])[0] ?? "";
  const overrideRegionIds = withoutClosedEventRegions(decimalRegionIds(options.additionalRegionIds));
  const configuredRegionIds = withoutClosedEventRegions(decimalRegionIds([
    claimRegionId,
    defaultRegionId,
    ...overrideRegionIds,
  ]));
  const snapshot = record(options.regionSnapshot);
  const snapshotData = record(snapshot.data);
  const rowsById = new Map(
    (Array.isArray(snapshotData.regions) ? snapshotData.regions : [])
      .map(record)
      .map((row) => [String(row.regionId ?? ""), row])
      .filter(([regionId]) => /^\d+$/.test(regionId)),
  );
  const provenance = record(snapshot.provenance);
  const generatedAt = typeof provenance.receivedAt === "string" && provenance.receivedAt
    ? provenance.receivedAt
    : null;
  const receivedAtMs = generatedAt ? Date.parse(generatedAt) : Number.NaN;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const staleAfterMs = Math.max(1_000, Number(options.staleAfterMs) || 60_000);
  const ageMs = Number.isFinite(receivedAtMs) ? Math.max(0, nowMs - receivedAtMs) : null;
  const providerHealth = record(options.providerHealth);
  const providerSources = record(providerHealth.sources);
  const globalRuntime = record(providerHealth.globalCatalog);
  const globalSubscription = record(globalRuntime.subscription);
  const globalSubscriptionKnown = Object.keys(globalSubscription).length > 0;
  const globalSubscriptionError = globalSubscription.lastError ?? globalRuntime.lastError;
  const globalSubscriptionHealthy = globalSubscriptionKnown
    && globalSubscription.connected === true
    && globalSubscription.applied === true
    && !globalSubscriptionError;
  const snapshotWarnings = Array.isArray(snapshot.warnings) ? snapshot.warnings.map(String) : [];

  const regions = configuredRegionIds.map((regionId) => {
    const live = rowsById.get(regionId);
    const relaySource = record(providerSources[`region:${regionId}`]);
    const relayKnown = Object.keys(relaySource).length > 0;
    const relayReady = relayKnown ? relaySource.ready === true : null;
    const warnings = [...snapshotWarnings];
    let freshness = live && (
      globalSubscriptionHealthy
      || (!globalSubscriptionKnown && ageMs != null && ageMs <= staleAfterMs)
    ) ? "live" : live ? "stale" : "unavailable";
    if (globalSubscriptionError) {
      freshness = live ? "stale" : "unavailable";
      warnings.push(`Relay global region subscription error: ${String(globalSubscriptionError)}`);
    } else if (globalSubscriptionKnown && !globalSubscriptionHealthy) {
      freshness = live ? "stale" : "unavailable";
      warnings.push("Relay global region subscription is disconnected.");
    } else if (relayReady === false) {
      freshness = "unavailable";
      warnings.push(`Relay region ${regionId} is not ready.`);
    } else if (!relayKnown) {
      freshness = live ? "stale" : "unavailable";
      warnings.push(`Relay readiness for region ${regionId} is unavailable.`);
    } else if (freshness === "stale") {
      warnings.push(`Relay region population is older than ${Math.round(staleAfterMs / 1_000)} seconds.`);
    }
    return {
      regionId,
      regionName: String(live?.regionName ?? `Region ${regionId}`),
      active: live?.active === true ? true : live?.active === false ? false : null,
      syncing: live?.syncing === true ? true : live?.syncing === false ? false : null,
      allowPlayerSpawns: live?.allowPlayerSpawns === true
        ? true
        : live?.allowPlayerSpawns === false
          ? false
          : null,
      signedInPlayers: Number.isSafeInteger(live?.signedInPlayers) ? live.signedInPlayers : null,
      playersInQueue: Number.isSafeInteger(live?.playersInQueue) ? live.playersInQueue : null,
      relayReady,
      updatedAt: generatedAt,
      source: regionId === claimRegionId
        ? "claim"
        : overrideRegionIds.includes(regionId)
          ? "admin"
          : "default",
      freshness,
      warnings: [...new Set(warnings)],
    };
  });
  const liveCount = regions.filter((region) => region.freshness === "live").length;
  const staleCount = regions.filter((region) => region.freshness === "stale").length;
  const freshness = !regions.length
    ? "unavailable"
    : liveCount === regions.length
      ? "live"
      : staleCount === regions.length
        ? "stale"
        : liveCount || staleCount
          ? "partial"
          : "unavailable";
  return {
    regions,
    overrideRegionIds,
    configuredRegionIds,
    generatedAt,
    updatedAt: generatedAt,
    freshness,
    ageMs,
    warnings: [...new Set(regions.flatMap((region) => region.warnings))],
  };
}
