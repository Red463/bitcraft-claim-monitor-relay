import type { BrowserResourcePartition, BrowserResourcePartitionScope } from "./mapResourceBinaryState.mjs";

export type MapResourceBinaryEventConnection = { close(): void };
export type MapResourceBinaryFetchResult = ArrayBuffer | ArrayBufferView | {
  status: 409;
  json: { currentGeneration: string; url: string };
} | {
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export function createMapResourceBinaryLoader(input: {
  fetchBinary(url: string, signal: AbortSignal): Promise<MapResourceBinaryFetchResult>;
  connectEvents(
    url: string,
    onEvent: (event: Record<string, unknown>) => void,
    onError: (error?: unknown) => void,
  ): MapResourceBinaryEventConnection;
  onChange?(state: ReadonlyMap<string, BrowserResourcePartition>): void;
  onError?(message: string): void;
  maxConcurrentLoads?: number;
  cacheMaxEntries?: number;
  cacheMaxBytes?: number;
}): {
  setScope(scope: BrowserResourcePartitionScope[], eventUrl: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
  state(): ReadonlyMap<string, BrowserResourcePartition>;
};
