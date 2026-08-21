import { MAP_OVERWORLD_DIMENSION, MAP_WORLD_BOUNDS, mapPointFromMobile, normalizeStaticMapPoint } from "../pages/map/mapCoordinates.mjs";
import { publicAccessDecision } from "../access/accessControl.mjs";
import { MAP_RESOURCE_PARTITION_BUDGET, MAP_RESOURCE_TYPE_LIMIT } from "../map/mapResourceSelection.mjs";

export const MAP_LAYER_KEYS = [
  "claims",
  "markets",
  "waystones",
  "empire-settlements",
  "empire-territory",
  "watchtowers",
  "players",
  "resources",
  "enemies",
  "roads",
  "claim-areas",
];

export const MAP_SCOPE_LIMITS = Object.freeze({
  regions: 16,
  playerRegions: 16,
  resourceIds: MAP_RESOURCE_TYPE_LIMIT,
  resourcePartitions: MAP_RESOURCE_PARTITION_BUDGET,
  enemyTypes: 16,
  playerIds: 250,
  features: 50_000,
  bytes: 8 * 1024 * 1024,
});

export class MapSnapshotError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "MapSnapshotError";
    this.statusCode = statusCode;
  }
}

export function mapRequestAccess(config, subject) {
  return publicAccessDecision(config, "page:map", subject);
}

function decimalValues(value, label, limit) {
  const entries = String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.some((entry) => !/^\d+$/.test(entry))) throw new MapSnapshotError(422, `${label} must contain decimal integers`);
  const values = [...new Set(entries.map((entry) => BigInt(entry).toString()))];
  if (values.length > limit) throw new MapSnapshotError(413, `${label} exceeds the limit of ${limit}`);
  return values.sort((left, right) => left.length - right.length || left.localeCompare(right));
}

export function parseMapScope(searchParams, { allowedRegionIds = [], allowedPlayerRegionIds = allowedRegionIds, allowedResourceIds = null } = {}) {
  const regionIds = decimalValues(searchParams.get("regions"), "regions", MAP_SCOPE_LIMITS.regions);
  if (!regionIds.length) throw new MapSnapshotError(422, "At least one region is required");
  const requestedLayers = [...new Set(String(searchParams.get("layers") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean))].sort();
  if (!requestedLayers.length) throw new MapSnapshotError(422, "At least one map layer is required");
  if (requestedLayers.some((layer) => !MAP_LAYER_KEYS.includes(layer))) throw new MapSnapshotError(422, "Unknown map layer requested");
  const allowed = new Set(allowedRegionIds.map((regionId) => {
    const value = String(regionId).trim();
    return /^\d+$/.test(value) ? BigInt(value).toString() : value;
  }));
  if (regionIds.some((regionId) => !allowed.has(regionId))) throw new MapSnapshotError(422, "Region is outside the configured active-region scope");
  const playerRegionIds = requestedLayers.includes("players")
    ? (searchParams.has("playerRegions")
        ? decimalValues(searchParams.get("playerRegions"), "playerRegions", MAP_SCOPE_LIMITS.playerRegions)
        : regionIds)
    : [];
  const allowedPlayerRegions = new Set(allowedPlayerRegionIds.map((regionId) => {
    const value = String(regionId).trim();
    return /^\d+$/.test(value) ? BigInt(value).toString() : value;
  }));
  if (playerRegionIds.some((regionId) => !allowedPlayerRegions.has(regionId))) {
    throw new MapSnapshotError(422, "Player region is outside the Relay-ready map scope");
  }
  const resourceIds = decimalValues(searchParams.get("resourceIds"), "resourceIds", MAP_SCOPE_LIMITS.resourceIds);
  const enemyTypes = decimalValues(searchParams.get("enemyTypes"), "enemyTypes", MAP_SCOPE_LIMITS.enemyTypes);
  const playerIds = decimalValues(searchParams.get("playerIds"), "playerIds", MAP_SCOPE_LIMITS.playerIds);
  if (requestedLayers.includes("resources") && !resourceIds.length) throw new MapSnapshotError(422, "resourceIds are required for the resources layer");
  if (requestedLayers.includes("resources") && regionIds.length * resourceIds.length > MAP_SCOPE_LIMITS.resourcePartitions) {
    throw new MapSnapshotError(413, `Map resource partition scope exceeds the limit of ${MAP_SCOPE_LIMITS.resourcePartitions}`);
  }
  if (allowedResourceIds != null && resourceIds.length) {
    const allowedResources = new Set(allowedResourceIds.map((resourceId) => {
      const value = String(resourceId).trim();
      return /^\d+$/.test(value) ? BigInt(value).toString() : value;
    }));
    if (resourceIds.some((resourceId) => !allowedResources.has(resourceId))) {
      throw new MapSnapshotError(422, "Map resource id is not in the available catalog");
    }
  }
  if (requestedLayers.includes("enemies") && !enemyTypes.length) throw new MapSnapshotError(422, "enemyTypes are required for the enemies layer");
  if (requestedLayers.includes("players") && !playerIds.length) throw new MapSnapshotError(422, "playerIds are required for the players layer");
  return { regionIds, playerRegionIds, layers: requestedLayers, resourceIds, enemyTypes, playerIds };
}

function recordPoint(row, mobile = false) {
  const x = row.locationX ?? row.x;
  const z = row.locationZ ?? row.z;
  const dimension = row.locationDimension ?? row.dimension ?? MAP_OVERWORLD_DIMENSION;
  return mobile ? mapPointFromMobile({ x, z, dimension }) : normalizeStaticMapPoint({ x, z, dimension });
}

function inScope(row, scope) {
  return scope.regionIds.includes(String(row.regionId ?? row.region_id ?? "")) && String(row.locationDimension ?? row.dimension ?? MAP_OVERWORLD_DIMENSION) === MAP_OVERWORLD_DIMENSION;
}

function inPlayerScope(row, scope) {
  return scope.playerRegionIds.includes(String(row.regionId ?? row.region_id ?? "")) && String(row.locationDimension ?? row.dimension ?? MAP_OVERWORLD_DIMENSION) === MAP_OVERWORLD_DIMENSION;
}

function feature(row, kind, entityId, point, extra = {}) {
  return { kind, entityId: String(entityId), point, observedAt: row.observedAt ?? null, ...extra };
}

function snapshotRows(snapshot, key) {
  const value = snapshot?.data?.[key];
  return Array.isArray(value) ? value : [];
}

function oldestReceivedAt(snapshots) {
  return snapshots.map((snapshot) => snapshot?.provenance?.receivedAt).filter(Boolean).sort().at(0) ?? null;
}

export function combineMapSpatialSnapshots(input = []) {
  const requested = input.map((entry) => (
    entry && Object.prototype.hasOwnProperty.call(entry, "snapshot")
      ? entry
      : { regionId: entry?.regionId ?? null, snapshot: entry }
  ));
  const snapshots = requested.map((entry) => entry.snapshot).filter(Boolean);
  if (!snapshots.length) return null;
  const missingCount = requested.length - snapshots.length;
  const warnings = [...new Set([
    ...snapshots.flatMap((snapshot) => snapshot.warnings ?? []).map(String),
    ...(missingCount ? [`Live spatial data is unavailable for ${missingCount} of ${requested.length} requested regions.`] : []),
  ])];
  const freshnessRank = new Map([["live", 0], ["fresh", 1], ["partial", 2], ["stale", 3], ["unavailable", 4]]);
  const observedFreshness = snapshots.reduce((worst, snapshot) => {
    const value = freshnessRank.has(String(snapshot.freshness))
      ? String(snapshot.freshness)
      : (snapshot.warnings?.length ? "partial" : "live");
    return (freshnessRank.get(value) ?? 2) > (freshnessRank.get(worst) ?? 0) ? value : worst;
  }, "live");
  const freshness = missingCount && !["stale", "unavailable"].includes(observedFreshness) ? "partial" : observedFreshness;
  const receivedAt = snapshots
    .map((snapshot) => String(snapshot.receivedAt ?? snapshot.provenance?.receivedAt ?? ""))
    .filter(Boolean)
    .sort()
    .at(0) ?? null;
  return {
    data: {
      claims: snapshots.flatMap((snapshot) => snapshot.data?.claims ?? []),
      players: snapshots.flatMap((snapshot) => snapshot.data?.players ?? []),
      enemies: snapshots.flatMap((snapshot) => snapshot.data?.enemies ?? []),
      banks: snapshots.flatMap((snapshot) => snapshot.data?.banks ?? []),
      waystones: snapshots.flatMap((snapshot) => snapshot.data?.waystones ?? []),
    },
    generation: Math.max(0, ...snapshots.map((snapshot) => Number(snapshot.generation) || 0)),
    freshness,
    provenance: { receivedAt },
    warnings,
  };
}

export function authorizedMapPlayerIds({ selectedPlayerIds = [], excludedMemberIds = [], members = [], players = [], mobileIdentityVerified = false } = {}) {
  if (!mobileIdentityVerified) return [];
  const selected = new Set(selectedPlayerIds.map(String));
  const excluded = new Set(excludedMemberIds.map(String));
  const monitored = new Set(members.map((row) => String(row.playerEntityId ?? row.entityId)));
  const online = new Set(players
    .filter((row) => row.signedIn === true || row.online === true)
    .map((row) => String(row.entityId ?? row.playerEntityId)));
  return [...selected]
    .filter((playerId) => monitored.has(playerId) && online.has(playerId) && !excluded.has(playerId))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
}

function resourceLayerAvailability(resourceCollection) {
  const requestedCount = resourceCollection?.requestedKeys?.length ?? 0;
  const readyCount = resourceCollection?.readyKeys?.length ?? 0;
  const loadingCount = resourceCollection?.loadingKeys?.length ?? 0;
  const resourceWarning = resourceCollection?.warnings?.[0] ?? null;
  if (requestedCount > 0 && readyCount === requestedCount) {
    const stale = resourceCollection?.freshness === "stale";
    return { available: true, status: stale ? "stale" : "live", reason: stale ? (resourceWarning ?? "Live resource positions are stale.") : null };
  }
  if (readyCount > 0) return { available: true, status: "partial", pending: loadingCount > 0, reason: loadingCount > 0 ? "Some selected resource positions are still loading." : "Some selected resource positions are unavailable." };
  if (loadingCount > 0) return { available: false, status: "loading", pending: true, reason: "Selected resource positions are loading." };
  return { available: false, status: "unavailable", reason: resourceWarning ?? "Live resource positions are unavailable." };
}

export function buildMapSnapshot({
  scope,
  now = new Date(),
  excludedMemberIds = [],
  mobileIdentityVerified = false,
  enemyIdentityVerified = false,
  resourceCoordinatesVerified = false,
  waystoneCoordinatesVerified = false,
  regionClaims = null,
  market = null,
  empires = null,
  members = [],
  players = [],
  spatial = null,
  resourceCollection = {
    data: { resources: [] },
    generation: 0,
    provenance: { receivedAt: null },
    warnings: [],
    requestedKeys: [],
    readyKeys: [],
    loadingKeys: [],
    unavailableKeys: [],
  },
} = {}) {
  const layers = Object.fromEntries(scope.layers.map((layer) => [layer, []]));
  const layerAvailability = Object.fromEntries(scope.layers.map((layer) => [layer, { available: true, status: "live", reason: null }]));
  const warnings = [...new Set(
    [regionClaims, market, empires, spatial, layers.resources ? resourceCollection : null]
      .flatMap((snapshot) => Array.isArray(snapshot?.warnings) ? snapshot.warnings : [])
      .map(String),
  )];
  const regionClaimRows = [
    ...snapshotRows(regionClaims, "claims").map((row) => ({ ...row, regionId: row.regionId ?? regionClaims?.data?.regionId })),
    ...snapshotRows(spatial, "claims"),
  ].filter((row, index, values) => values.findIndex((candidate) => String(candidate.entityId) === String(row.entityId)) === index);
  const regionalWaystoneRows = snapshotRows(regionClaims, "waystones").map((row) => ({ ...row, regionId: row.regionId ?? regionClaims?.data?.regionId }));
  const marketRows = snapshotRows(market, "marketplaces").map((row) => ({ ...row, regionId: row.regionId ?? market?.data?.regionId }));
  const settlementRows = snapshotRows(empires, "settlements");
  const nodeRows = snapshotRows(empires, "nodes");

  const claimRegionId = String(regionClaims?.data?.regionId ?? "");
  const marketRegionId = String(market?.data?.regionId ?? "");
  if (layers.claims && !spatial && scope.regionIds.some((regionId) => regionId !== claimRegionId)) warnings.push("Claim centres are only available for the collected claim region.");
  if (layers.markets && scope.regionIds.some((regionId) => regionId !== marketRegionId)) warnings.push("Markets are only available for the monitored claim region.");

  if (layers.claims) layers.claims = regionClaimRows.filter((row) => inScope(row, scope) && row.locationX != null && row.locationZ != null).map((row) => feature(row, "claim", row.entityId, recordPoint(row), { regionId: String(row.regionId), name: row.name ?? "Claim", tier: row.tier ?? null, npc: row.npc === true }));
  if (layers.markets) layers.markets = marketRows.filter((row) => inScope(row, scope)).map((row) => feature(row, "market", row.buildingEntityId, recordPoint(row), { regionId: String(row.regionId), claimEntityId: String(row.claimEntityId) }));
  if (layers["empire-settlements"]) layers["empire-settlements"] = settlementRows.filter((row) => inScope(row, scope)).map((row) => feature(row, "empire-settlement", row.buildingEntityId, recordPoint(row), { regionId: String(row.regionId), name: row.claimName ?? "Empire settlement", empireEntityId: String(row.empireEntityId) }));
  if (layers.watchtowers) layers.watchtowers = nodeRows.filter((row) => inScope(row, scope)).map((row) => feature(row, "watchtower", row.entityId, recordPoint(row), { regionId: String(row.regionId), name: row.nickname ?? "Watchtower", empireEntityId: String(row.empireEntityId) }));

  const spatialRows = spatial?.data ?? {};
  const waystoneWarning = "Waystone positions are unavailable until known live fixtures are live-verified.";
  if (layers.waystones) {
    if (!waystoneCoordinatesVerified) {
      if (!warnings.includes(waystoneWarning)) warnings.push(waystoneWarning);
      layerAvailability.waystones = { available: false, status: "unavailable", reason: waystoneWarning };
    }
    else if (waystoneCoordinatesVerified) layers.waystones = [...regionalWaystoneRows, ...(Array.isArray(spatialRows.waystones) ? spatialRows.waystones : [])].filter((row, index, values) => values.findIndex((candidate) => String(candidate.entityId ?? candidate.buildingEntityId) === String(row.entityId ?? row.buildingEntityId)) === index && inScope(row, scope)).map((row) => feature(row, "waystone", row.entityId ?? row.buildingEntityId, recordPoint(row), { regionId: String(row.regionId), claimEntityId: String(row.claimEntityId) }));
  }
  if (layers.players) {
    const allowedPlayers = new Set(authorizedMapPlayerIds({ selectedPlayerIds: scope.playerIds, excludedMemberIds, members, players, mobileIdentityVerified }));
    const monitored = new Map(members.map((row) => [String(row.playerEntityId ?? row.entityId), row]));
    layers.players = (Array.isArray(spatialRows.players) ? spatialRows.players : [])
      .filter((row) => {
        const id = String(row.playerEntityId ?? row.entityId);
        return allowedPlayers.has(id) && inPlayerScope(row, scope);
      })
      .map((row) => {
        const playerEntityId = String(row.playerEntityId ?? row.entityId);
        const member = monitored.get(playerEntityId);
        return feature(row, "player", playerEntityId, recordPoint(row, true), { playerEntityId, regionId: String(row.regionId), name: member?.userName ?? member?.username ?? "Player" });
      });
    if (!mobileIdentityVerified) {
      const reason = "Player positions are unavailable until player-to-mobile entity identity is live-verified.";
      warnings.push(reason);
      layerAvailability.players = { available: false, status: "unavailable", reason };
    } else if (!spatial) {
      const reason = "Live player positions are unavailable.";
      warnings.push(reason);
      layerAvailability.players = { available: false, status: "unavailable", reason };
    } else if (["partial", "stale"].includes(String(spatial.freshness))) {
      layerAvailability.players = {
        available: true,
        status: String(spatial.freshness),
        reason: spatial.warnings?.[0] ?? "Live player positions are degraded.",
      };
    }
  }
  if (layers.resources) {
    const unavailableWarning = "Resource positions are unavailable until the Relay resource/location join is live-verified.";
    if (!resourceCoordinatesVerified) {
      if (!warnings.includes(unavailableWarning)) warnings.push(unavailableWarning);
      layerAvailability.resources = { available: false, status: "unavailable", reason: unavailableWarning };
    }
    else {
      const selected = new Set(scope.resourceIds);
      const resourceRows = Array.isArray(resourceCollection?.data?.resources) ? resourceCollection.data.resources : [];
      layers.resources = resourceRows.filter((row) => selected.has(String(row.resourceId)) && inScope(row, scope)).map((row) => feature(row, "resource", row.entityId, recordPoint(row), { regionId: String(row.regionId), resourceId: String(row.resourceId), identity: `resource:${row.resourceId}` }));
      layerAvailability.resources = resourceLayerAvailability(resourceCollection);
    }
  }
  if (layers.enemies) {
    const unavailableWarning = "Enemy positions are unavailable until the Relay EnemyType to catalog mapping is live-verified.";
    if (!enemyIdentityVerified) {
      if (!warnings.includes(unavailableWarning)) warnings.push(unavailableWarning);
      layerAvailability.enemies = { available: false, status: "unavailable", reason: unavailableWarning };
    }
    else {
      const selected = new Set(scope.enemyTypes);
      layers.enemies = (Array.isArray(spatialRows.enemies) ? spatialRows.enemies : []).filter((row) => selected.has(String(row.enemyType)) && inScope(row, scope)).map((row) => feature(row, "enemy", row.entityId, recordPoint(row, true), { regionId: String(row.regionId), enemyType: String(row.enemyType), identity: `enemy:${row.enemyType}` }));
      if (!spatial) {
        const reason = "Live enemy positions are unavailable.";
        warnings.push(reason);
        layerAvailability.enemies = { available: false, status: "unavailable", reason };
      }
    }
  }
  if (waystoneCoordinatesVerified && layers.waystones && !Array.isArray(regionClaims?.data?.waystones) && !Array.isArray(spatialRows.waystones)) {
    const reason = "Waystone map data is unavailable.";
    warnings.push(reason);
    layerAvailability.waystones = { available: false, status: "unavailable", reason };
  }
  if (layers["empire-territory"]) {
    const reason = "Empire territory is unavailable until the chunk-to-map polygon transform is live-verified.";
    warnings.push(reason);
    layerAvailability["empire-territory"] = { available: false, status: "unavailable", reason };
  }
  const unverifiedGeometryReason = "Unavailable — awaiting verified Relay coordinates";
  if (layers.roads) {
    layerAvailability.roads = { available: false, status: "unavailable", reason: unverifiedGeometryReason };
    warnings.push("Roads are unavailable — awaiting verified Relay coordinates.");
  }
  if (layers["claim-areas"]) {
    layerAvailability["claim-areas"] = { available: false, status: "unavailable", reason: unverifiedGeometryReason };
    warnings.push("Claim areas are unavailable — awaiting verified Relay coordinates.");
  }

  const featureCount = Object.values(layers).reduce((total, rows) => total + rows.length, 0);
  if (featureCount > MAP_SCOPE_LIMITS.features) throw new MapSnapshotError(413, `Map snapshot exceeds the ${MAP_SCOPE_LIMITS.features} feature limit`);
  const snapshots = [
    (layers.claims || layers.waystones) ? regionClaims : null,
    layers.markets ? market : null,
    (layers["empire-settlements"] || layers["empire-territory"] || layers.watchtowers) ? empires : null,
    (layers.players || layers.enemies || (layers.waystones && spatial)) ? spatial : null,
    layers.resources ? resourceCollection : null,
  ].filter(Boolean);
  const generatedAt = oldestReceivedAt(snapshots) ?? now.toISOString();
  const ageMs = Math.max(0, now.getTime() - Date.parse(generatedAt));
  const sourceFreshness = snapshots.map((snapshot) => String(snapshot.freshness ?? "live"));
  const allStale = sourceFreshness.length > 0 && sourceFreshness.every((value) => value === "stale");
  const degraded = sourceFreshness.some((value) => value === "stale" || value === "partial" || value === "unavailable")
    || Object.values(layerAvailability).some((availability) => availability.status === "partial" || availability.status === "loading" || availability.status === "unavailable");
  const result = {
    provider: "relay",
    generation: String(Math.max(0, ...snapshots.map((snapshot) => Number(snapshot.generation) || 0))),
    generatedAt,
    freshness: allStale ? "stale" : (warnings.length || degraded ? "partial" : "live"),
    confidence: warnings.length || degraded ? "partial" : "joined",
    ageMs,
    warnings,
    coordinateSystem: { version: 1, staticSpace: "map-xz", mobileScale: 1_000, leafletOrder: "z-x", dimension: MAP_OVERWORLD_DIMENSION, bounds: MAP_WORLD_BOUNDS },
    scope,
    layers,
    layerAvailability,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > MAP_SCOPE_LIMITS.bytes) throw new MapSnapshotError(413, "Map snapshot exceeds the response byte limit");
  return result;
}
