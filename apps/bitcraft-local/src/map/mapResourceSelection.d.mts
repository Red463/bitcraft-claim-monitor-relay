export const MAP_RESOURCE_PARTITION_BUDGET: 256;
export const MAP_RESOURCE_TYPE_LIMIT: 16;

export function mapResourceTypeLimitForRegions(
  regionIds?: readonly unknown[],
  options?: { partitionBudget?: number; typeLimit?: number },
): number;
