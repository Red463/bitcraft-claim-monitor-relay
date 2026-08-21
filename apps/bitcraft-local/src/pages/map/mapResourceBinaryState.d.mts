export type BrowserResourcePartition = {
  key: string;
  regionId: string;
  resourceId: string;
  generation: string | null;
  committed: Uint32Array;
  provisional: Uint32Array;
  pointCount: number;
  freshness: string;
  status: "loading" | "live" | "stale" | "unavailable";
  warning: string | null;
};

export type BrowserResourcePartitionScope = Pick<BrowserResourcePartition, "key" | "regionId" | "resourceId">;
export type BrowserResourceBinaryEventResult = {
  partitions: ReadonlyMap<string, BrowserResourcePartition>;
  requiresFetch: boolean;
};

export function createMapResourceBinaryState(scope?: BrowserResourcePartitionScope[]): Map<string, BrowserResourcePartition>;
export function reconcileMapResourceBinaryScope(
  state: ReadonlyMap<string, BrowserResourcePartition>,
  scope?: BrowserResourcePartitionScope[],
): ReadonlyMap<string, BrowserResourcePartition>;
export function markMapResourceBinaryAwaitingConfirmation(
  state: ReadonlyMap<string, BrowserResourcePartition>,
): ReadonlyMap<string, BrowserResourcePartition>;
export function applyMapResourceBinaryCommitted(
  state: ReadonlyMap<string, BrowserResourcePartition>,
  key: string,
  decoded: { regionId: string; resourceId: string; dimension: "1"; generation: string; coordinates: Uint32Array; pointCount: number },
  metadata?: { freshness?: string; warning?: string | null },
): ReadonlyMap<string, BrowserResourcePartition>;
export function applyMapResourceBinaryEvent(
  state: ReadonlyMap<string, BrowserResourcePartition>,
  event: Record<string, unknown>,
): BrowserResourceBinaryEventResult;
