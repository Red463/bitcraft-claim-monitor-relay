function decimal(value, label) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) throw new TypeError(`${label} must be a decimal integer`);
  return BigInt(text).toString();
}

function decimalSort(values, label) {
  return [...new Set((values ?? []).map((value) => decimal(value, label)))]
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
}

export function resourcePartitionKey(regionId, resourceId) {
  return `${decimal(regionId, "Resource partition region id")}|resource:${decimal(resourceId, "Resource partition type id")}`;
}

function partitionIdentity(key) {
  const match = /^(\d+)\|resource:(\d+)$/.exec(String(key ?? ""));
  if (!match) throw new TypeError("Resource partition key is invalid");
  return { regionId: decimal(match[1], "Resource partition region id"), resourceId: decimal(match[2], "Resource partition type id") };
}

function compareEntityRows(left, right) {
  return left[0].length - right[0].length || left[0].localeCompare(right[0]);
}

export function resourcePartitionPlan(regionIds = [], resourceIds = [], options = {}) {
  const regions = decimalSort(regionIds, "Resource partition region id");
  const resources = decimalSort(resourceIds, "Resource partition type id");
  const priorityResourceId = resources.includes(String(options.priorityResourceId)) ? String(options.priorityResourceId) : null;
  const priorityRegionId = regions.includes(String(options.priorityRegionId)) ? String(options.priorityRegionId) : null;
  const orderedResources = priorityResourceId
    ? [priorityResourceId, ...resources.filter((resourceId) => resourceId !== priorityResourceId)]
    : resources;
  return orderedResources.flatMap((resourceId) => {
    const orderedRegions = resourceId === priorityResourceId && priorityRegionId
      ? [priorityRegionId, ...regions.filter((regionId) => regionId !== priorityRegionId)]
      : regions;
    return orderedRegions.map((regionId) => ({
      key: resourcePartitionKey(regionId, resourceId), regionId, resourceId,
    }));
  });
}

function normalizedRows(rows, identity) {
  const entities = new Set();
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!Array.isArray(row) || row.length !== 5) return [];
    try {
      const entityId = decimal(row[0], "Resource entity id");
      const regionId = decimal(row[1], "Resource row region id");
      const resourceId = decimal(row[2], "Resource row type id");
      const x = Number(row[3]);
      const z = Number(row[4]);
      if (regionId !== identity.regionId || resourceId !== identity.resourceId || entities.has(entityId)) return [];
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(z)) return [];
      entities.add(entityId);
      return [[entityId, regionId, resourceId, x, z]];
    } catch {
      return [];
    }
  }).sort(compareEntityRows);
}

function mergeRows(left, right) {
  const merged = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (leftIndex >= left.length) merged.push(right[rightIndex++]);
    else if (rightIndex >= right.length) merged.push(left[leftIndex++]);
    else {
      const order = compareEntityRows(left[leftIndex], right[rightIndex]);
      if (order <= 0) merged.push(left[leftIndex++]);
      if (order >= 0) {
        if (order !== 0) merged.push(right[rightIndex]);
        rightIndex += 1;
      }
    }
  }
  return merged;
}

export function replaceResourcePartition(state, partition) {
  const identity = partitionIdentity(partition?.key);
  const generation = decimal(partition?.generation, "Resource partition generation");
  const next = new Map(state ?? []);
  next.set(resourcePartitionKey(identity.regionId, identity.resourceId), Object.freeze({
    key: resourcePartitionKey(identity.regionId, identity.resourceId),
    regionId: identity.regionId,
    resourceId: identity.resourceId,
    generation,
    rows: Object.freeze(normalizedRows(partition?.rows, identity)),
    warnings: Object.freeze([...(partition?.warnings ?? [])].map(String)),
    freshness: String(partition?.freshness ?? "live"),
    complete: true,
    stagingRows: Object.freeze([]),
    lastComplete: null,
  }));
  return next;
}

function completeSnapshot(partition) {
  if (!partition) return null;
  if (partition.complete === true) return Object.freeze({
    generation: partition.generation,
    rows: partition.rows,
    warnings: partition.warnings,
    freshness: partition.freshness,
  });
  return partition.lastComplete ?? null;
}

export function applyResourcePartitionPage(state, page) {
  const identity = partitionIdentity(page?.key);
  const key = resourcePartitionKey(identity.regionId, identity.resourceId);
  if (page?.regionId != null && decimal(page.regionId, "Resource page region id") !== identity.regionId) {
    throw new TypeError("Resource page region does not match its partition key");
  }
  if (page?.resourceId != null && decimal(page.resourceId, "Resource page type id") !== identity.resourceId) {
    throw new TypeError("Resource page type does not match its partition key");
  }
  const generation = decimal(page?.generation, "Resource partition generation");
  const next = new Map(state ?? []);
  const current = next.get(key);
  const sameStaging = current?.complete === false && current.generation === generation;
  const pageRows = normalizedRows(page?.rows, identity);
  const stagingRows = Object.freeze(sameStaging ? mergeRows(current.stagingRows, pageRows) : pageRows);
  const warnings = Object.freeze([...new Set([
    ...(sameStaging ? current.warnings : []),
    ...(page?.warnings ?? []),
  ].map(String))]);
  const freshness = String(page?.freshness ?? "live");
  const lastComplete = completeSnapshot(current);
  if (page?.complete === true) {
    next.set(key, Object.freeze({
      key, ...identity, generation, rows: stagingRows, warnings, freshness,
      complete: true, stagingRows: Object.freeze([]), lastComplete: null,
    }));
  } else {
    next.set(key, Object.freeze({
      key, ...identity, generation,
      rows: lastComplete?.rows ?? stagingRows,
      warnings,
      freshness,
      complete: false,
      stagingRows,
      lastComplete,
    }));
  }
  return next;
}

export function retainResourcePartitions(state, wantedKeys = []) {
  const wanted = new Set(wantedKeys.map((key) => {
    const identity = partitionIdentity(key);
    return resourcePartitionKey(identity.regionId, identity.resourceId);
  }));
  return new Map([...new Map(state ?? [])].filter(([key]) => wanted.has(key)));
}

export function resourceRowsFromPartitions(state) {
  return [...new Map(state ?? []).values()]
    .sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true }))
    .flatMap((partition) => partition.rows);
}
