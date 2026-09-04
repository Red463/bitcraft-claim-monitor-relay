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
