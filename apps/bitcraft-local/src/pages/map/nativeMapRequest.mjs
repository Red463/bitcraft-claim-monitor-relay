import { mapResourceTypeLimitForRegions } from "../../map/mapResourceSelection.mjs";
import { resourcePartitionPlan } from "./mapResourcePartitionState.mjs";

const OPERATIONAL_LAYERS = [
  "claims",
  "watchtowers",
  "claim-areas",
];

function decimalSort(values) {
  return [...new Set((values ?? []).map(String).filter((value) => /^\d+$/.test(value)))]
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
}

export function normalizeNativeMapRegionSelection(selectedRegionIds = [], availableRegionIds = []) {
  const allowed = new Set(decimalSort(availableRegionIds));
  return decimalSort(selectedRegionIds).filter((regionId) => allowed.has(regionId));
}

export function boundedNativeMapRegions(selectedRegionIds = [], availableRegionIds = [], limit = 16) {
  const available = decimalSort(availableRegionIds);
  const allowed = new Set(available);
  const selected = decimalSort(selectedRegionIds).filter((regionId) => allowed.has(regionId));
  return (selected.length ? selected : available).slice(0, limit);
}

export function nativeMapResourceRegions(selectedRegionIds = [], availableRegionIds = [], preferredClaimRegionId = "") {
  const available = decimalSort(availableRegionIds);
  const allowed = new Set(available);
  const selected = decimalSort(selectedRegionIds).filter((regionId) => allowed.has(regionId));
  if (selected.length) return selected;
  if ((selectedRegionIds ?? []).length === 0) return available;
  const claimRegion = decimalSort([preferredClaimRegionId])[0] ?? "";
  return allowed.has(claimRegion) ? [claimRegion] : available.slice(0, 1);
}

export function nativeMapResourceSelectionLimit(regionIds = []) {
  return mapResourceTypeLimitForRegions(regionIds);
}

export function nativeMapRequest({ operationalRegionIds = [], playerRegionIds = [], resourceRegionIds = [], playerIds = [], resourceIds = [], enemyTypes = [], priorityResourceId = "", priorityRegionId = "" }) {
  const regions = decimalSort(operationalRegionIds);
  const playerRegions = decimalSort(playerRegionIds);
  const resourceRegions = decimalSort(resourceRegionIds);
  const players = decimalSort(playerIds);
  const resources = decimalSort(resourceIds).slice(0, nativeMapResourceSelectionLimit(resourceRegions));
  const enemies = decimalSort(enemyTypes);
  const requestedPriorityResource = decimalSort([priorityResourceId])[0] ?? "";
  const requestedPriorityRegion = decimalSort([priorityRegionId])[0] ?? "";
  const acceptedPriorityResource = resources.includes(requestedPriorityResource) ? requestedPriorityResource : "";
  const acceptedPriorityRegion = resourceRegions.includes(requestedPriorityRegion) ? requestedPriorityRegion : "";
  const layers = [
    ...OPERATIONAL_LAYERS,
    ...(players.length ? ["players"] : []),
    ...(resources.length ? ["resources"] : []),
    ...(enemies.length ? ["enemies"] : []),
  ].sort();
  const snapshotLayers = layers.filter((layer) => layer !== "resources");
  const snapshotParams = new URLSearchParams({ regions: regions.join(","), layers: snapshotLayers.join(",") });
  if (players.length) {
    snapshotParams.set("playerRegions", playerRegions.join(","));
    snapshotParams.set("playerIds", players.join(","));
  }
  if (enemies.length) snapshotParams.set("enemyTypes", enemies.join(","));
  const resourcePartitions = resourcePartitionPlan(resourceRegions, resources, {
    priorityResourceId: acceptedPriorityResource,
    priorityRegionId: acceptedPriorityRegion,
  });
  const resourceParams = new URLSearchParams({ regions: resourceRegions.join(","), resourceIds: resources.join(",") });
  if (acceptedPriorityResource) resourceParams.set("priorityResourceId", acceptedPriorityResource);
  if (acceptedPriorityRegion) resourceParams.set("priorityRegionId", acceptedPriorityRegion);
  const resourceEventUrl = resourcePartitions.length ? `/api/local/map/resource-events?${resourceParams}` : null;
  return {
    layers,
    snapshotUrl: `/api/local/map/snapshot?${snapshotParams}`,
    eventsUrl: `/api/local/map/events?${snapshotParams}`,
    resourcePartitions,
    resourceEventUrl,
  };
}
