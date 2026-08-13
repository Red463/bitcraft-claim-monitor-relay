import type { CompactResourceRow, ResourcePartitionPlan } from "./mapResourcePartitionState.mjs";

export type ResourcePartitionPage = {
  provider: "relay";
  generation: string;
  partition: { regionId: string; resourceId: string };
  resources: CompactResourceRow[];
  nextCursor: string | null;
  complete: boolean;
  warnings: string[];
  freshness: string;
  layerAvailability: { available: boolean; status: string; pending?: boolean; reason?: string | null };
};

export type CompletedResourcePartition = ResourcePartitionPlan & {
  generation: string;
  rows: CompactResourceRow[];
  warnings: string[];
  freshness: string;
};

export type ProgressiveResourcePartitionPage = CompletedResourcePartition & { complete: boolean };

export function createMapResourcePartitionLoader(options: {
  fetchPage(input: { partition: ResourcePartitionPlan; cursor: string | null; signal: AbortSignal }): Promise<ResourcePartitionPage>;
  concurrency?: number;
  onPage?(page: ProgressiveResourcePartitionPage): void;
  onPartition?(partition: CompletedResourcePartition): void;
  onStatus(status: { key: string; regionId: string; resourceId: string; status: string; warning?: string | null; pending?: boolean }): void;
}): {
  setScope(partitions?: ResourcePartitionPlan[]): void;
  refresh(keys?: string[]): void;
  pause(): void;
  resume(): void;
  stop(): void;
};
