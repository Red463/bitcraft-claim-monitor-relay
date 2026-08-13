type WireRecord = Record<string, unknown>;

const MAP_OVERWORLD_DIMENSION = "1";
const MAP_WORLD_MAX = 38_400;

export type MapResourcePoint = {
  entityId: string;
  resourceId: string;
  regionId: string;
  locationX: number;
  locationZ: number;
  dimension: "1";
  observedAt: string;
};

export type MapResourceGenerationData = {
  complete: boolean;
  resources: MapResourcePoint[];
  rowCounts: { resourceState: number; locationState: number };
  warnings: string[];
};

function decimal(value: unknown, label: string): string {
  const result = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^\d+$/.test(result)) throw new TypeError(`${label} must be a decimal integer`);
  return result;
}

function integer(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new TypeError(`${label} must be a safe integer`);
  return result;
}

function wireRecord(value: unknown): value is WireRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function overworldDimension(value: unknown, label: string): "1" {
  if (value == null) throw new TypeError(`${label} dimension is missing`);
  const dimension = decimal(value, `${label} dimension`);
  if (dimension !== MAP_OVERWORLD_DIMENSION) throw new TypeError(`${label} dimension ${dimension} is not overworld ${MAP_OVERWORLD_DIMENSION}`);
  return MAP_OVERWORLD_DIMENSION;
}

function boundedCoordinate(value: unknown, label: string): number {
  const coordinate = integer(value, label);
  if (coordinate < 0 || coordinate > MAP_WORLD_MAX) throw new RangeError(`${label} is outside verified world bounds`);
  return coordinate;
}

export function mapResourceKey(regionId: string, resourceId: string): string {
  return `${decimal(regionId, "Map resource region id")}:${decimal(resourceId, "Map resource id")}`;
}

export function mapResourceQueries(resourceId: string): string[] {
  const selectedResourceId = decimal(resourceId, "Map resource id");
  const resourceJoin = "FROM resource_state JOIN location_state ON resource_state.entity_id = location_state.entity_id";
  return [
    `SELECT resource_state.* ${resourceJoin} WHERE resource_state.resource_id = ${selectedResourceId} AND location_state.dimension = ${MAP_OVERWORLD_DIMENSION}`,
    `SELECT location_state.* ${resourceJoin} WHERE resource_state.resource_id = ${selectedResourceId} AND location_state.dimension = ${MAP_OVERWORLD_DIMENSION}`,
  ];
}

export function normalizeMapResourceGeneration({
  regionId: rawRegionId,
  resourceId: rawResourceId,
  resourceRows,
  locationRows,
  observedAt,
}: {
  regionId: string;
  resourceId: string;
  resourceRows: unknown[];
  locationRows: unknown[];
  observedAt: string;
}): MapResourceGenerationData {
  const resourceId = decimal(rawResourceId, "Map resource id");
  return normalizeMapResourceRegionGeneration({
    regionId: rawRegionId,
    resourceIds: [resourceId],
    resourceRows,
    locationRows,
    observedAt,
  }).get(resourceId)!;
}

export function normalizeMapResourceRegionGeneration({
  regionId: rawRegionId,
  resourceIds: rawResourceIds,
  resourceRows,
  locationRows,
  observedAt,
}: {
  regionId: string;
  resourceIds: string[];
  resourceRows: Iterable<unknown>;
  locationRows: Iterable<unknown>;
  observedAt: string;
}): Map<string, MapResourceGenerationData> {
  const regionId = decimal(rawRegionId, "Map resource region id");
  const resourceIds = [...new Set(rawResourceIds.map((resourceId) => decimal(resourceId, "Map resource id")))];
  const selected = new Set(resourceIds);
  const entitiesByType = new Map(resourceIds.map((resourceId) => [resourceId, [] as string[]]));
  const warningsByType = new Map(resourceIds.map((resourceId) => [resourceId, [] as string[]]));
  let resourceIndex = 0;
  for (const value of resourceRows) {
    const index = resourceIndex++;
    if (!wireRecord(value)) continue;
    let resourceId: string;
    try {
      resourceId = decimal(value.resourceId ?? value.resource_id, `Map resource ${index} type`);
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error);
      for (const warnings of warningsByType.values()) warnings.push(warning);
      continue;
    }
    if (!selected.has(resourceId)) continue;
    try {
      entitiesByType.get(resourceId)!.push(decimal(value.entityId ?? value.entity_id, `Map resource ${index} entity id`));
    } catch (error) {
      warningsByType.get(resourceId)!.push(error instanceof Error ? error.message : String(error));
    }
  }

  const selectedEntityIds = new Set([...entitiesByType.values()].flat());
  const locations = new Map<string, WireRecord>();
  let locationIndex = 0;
  for (const value of locationRows) {
    const index = locationIndex++;
    if (!wireRecord(value)) continue;
    try {
      const entityId = decimal(value.entityId ?? value.entity_id, `Map location ${index} entity id`);
      if (selectedEntityIds.has(entityId)) locations.set(entityId, value);
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error);
      for (const warnings of warningsByType.values()) warnings.push(warning);
    }
  }

  const result = new Map<string, MapResourceGenerationData>();
  for (const resourceId of resourceIds) {
    const entityIds = entitiesByType.get(resourceId)!;
    const warnings = warningsByType.get(resourceId)!;
    let complete = true;
    const resources: MapResourcePoint[] = [];
    let matchedLocationCount = 0;
    for (const entityId of entityIds) {
      const location = locations.get(entityId);
      if (!location) {
        complete = false;
        warnings.push(`Map resource ${entityId} has no location_state row.`);
        continue;
      }
      matchedLocationCount += 1;
      try {
        resources.push({
          entityId,
          resourceId,
          regionId,
          locationX: boundedCoordinate(location.x, `Map resource ${entityId} x`),
          locationZ: boundedCoordinate(location.z, `Map resource ${entityId} z`),
          dimension: overworldDimension(location.dimension, `Map resource ${entityId}`),
          observedAt,
        });
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
    resources.sort((left, right) => left.entityId.length - right.entityId.length || left.entityId.localeCompare(right.entityId));
    result.set(resourceId, {
      complete,
      resources,
      rowCounts: { resourceState: entityIds.length, locationState: matchedLocationCount },
      warnings,
    });
  }
  return result;
}
