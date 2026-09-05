export const CLOSED_EVENT_REGION_IDS = Object.freeze(["3", "11", "15", "23"]);

const closedEventRegionIds = new Set(CLOSED_EVENT_REGION_IDS);

function decimalRegionId(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  return BigInt(normalized).toString();
}

export function isClosedEventRegion(value) {
  const regionId = decimalRegionId(value);
  return regionId != null && closedEventRegionIds.has(regionId);
}

export function withoutClosedEventRegions(values = []) {
  return values.filter((value) => !isClosedEventRegion(value));
}

function schemaReadyRelayRegionIds({
  topology,
  manifest,
  requestedSet = null,
  assertFingerprint,
  onSchemaMismatch = () => {},
}) {
  const regionIds = [];
  let firstSchemaMismatch = null;
  for (const [value, source] of topology.regions.entries()) {
    const regionId = decimalRegionId(value);
    if (regionId == null || !source.ready || isClosedEventRegion(regionId) || (requestedSet && !requestedSet.has(regionId))) continue;
    try {
      assertFingerprint(manifest, "regional", String(source.schemaFingerprint ?? ""));
    } catch (error) {
      if (error?.code !== "RELAY_SCHEMA_FINGERPRINT_MISMATCH") throw error;
      firstSchemaMismatch ??= error;
      onSchemaMismatch({ regionId, error });
      continue;
    }
    regionIds.push(regionId);
  }
  if (!regionIds.length && firstSchemaMismatch) throw firstSchemaMismatch;
  return regionIds.sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
}

export function relayMapSchemaMismatchDiagnostic({ regionId, error }) {
  return {
    stage: "region-skipped",
    regionId,
    reason: "schema-mismatch",
    warning: error instanceof Error ? error.message : String(error),
  };
}

export function schemaCompleteRelayMapRegionIds(options) {
  let schemaMismatch = false;
  let firstSchemaMismatch = null;
  const onSchemaMismatch = options.onSchemaMismatch ?? (() => {});
  const regionIds = schemaReadyRelayRegionIds({
    ...options,
    onSchemaMismatch(detail) {
      schemaMismatch = true;
      firstSchemaMismatch ??= detail.error;
      onSchemaMismatch(detail);
    },
  });
  if (schemaMismatch && options.requestedSet) throw firstSchemaMismatch;
  return schemaMismatch ? null : regionIds;
}
