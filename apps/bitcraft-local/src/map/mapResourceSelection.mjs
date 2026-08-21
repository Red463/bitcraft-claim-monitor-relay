export const MAP_RESOURCE_PARTITION_BUDGET = 256;
export const MAP_RESOURCE_TYPE_LIMIT = 16;

function decimalRegions(regionIds) {
  return new Set((regionIds ?? []).flatMap((value) => {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) return [];
    return [BigInt(text).toString()];
  }));
}

export function mapResourceTypeLimitForRegions(regionIds, options = {}) {
  const regionCount = decimalRegions(regionIds).size;
  if (!regionCount) return 0;
  const partitionBudget = Number.isSafeInteger(options.partitionBudget) && options.partitionBudget >= 0
    ? options.partitionBudget
    : MAP_RESOURCE_PARTITION_BUDGET;
  const typeLimit = Number.isSafeInteger(options.typeLimit) && options.typeLimit >= 0
    ? options.typeLimit
    : MAP_RESOURCE_TYPE_LIMIT;
  return Math.min(typeLimit, Math.floor(partitionBudget / regionCount));
}
