export type NativeMapRequestInput = { operationalRegionIds?: string[]; playerRegionIds?: string[]; resourceRegionIds?: string[]; playerIds?: string[]; resourceIds?: string[]; enemyTypes?: string[]; priorityResourceId?: string; priorityRegionId?: string };
export function boundedNativeMapRegions(selectedRegionIds?: string[], availableRegionIds?: string[], limit?: number): string[];
export function nativeMapResourceRegions(selectedRegionIds?: string[], availableRegionIds?: string[], preferredClaimRegionId?: string): string[];
export function nativeMapResourceSelectionLimit(regionIds?: string[]): number;
export function normalizeNativeMapRegionSelection(selectedRegionIds?: string[], availableRegionIds?: string[]): string[];
export function nativeMapRequest(input: NativeMapRequestInput): {
  layers: string[];
  snapshotUrl: string;
  eventsUrl: string;
  resourcePartitions: Array<{ key: string; regionId: string; resourceId: string }>;
  resourceEventUrl: string | null;
};
