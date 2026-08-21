import type { BrowserResourcePartition } from "./mapResourceBinaryState.mjs";

export type ResourceLocateActivation = Readonly<{ id: number; resourceId: string }>;
export type ResourceLocatePoint = Readonly<{ key: string; regionId: string; resourceId: string; x: number; z: number }>;

export function newlyAddedResourceIds(previousResourceIds?: readonly unknown[], nextResourceIds?: readonly unknown[]): string[];
export function resourceLocatePoint(input: {
  resourceId: string;
  partitions: ReadonlyMap<string, BrowserResourcePartition>;
  preferredRegionId?: string;
  centre?: { x: number; z: number };
}): ResourceLocatePoint | null;
export function applyResourceLocate(input: {
  activation: ResourceLocateActivation | null;
  consumedActivationId: number | null;
  partitions: ReadonlyMap<string, BrowserResourcePartition>;
  preferredRegionId?: string;
  centre?: { x: number; z: number };
  isVisible: (point: ResourceLocatePoint) => boolean;
  highlight: (point: ResourceLocatePoint) => void;
  locate: (point: ResourceLocatePoint) => void;
}): number | null;

export function resourceLayerStatus(input: {
  selectionKey: string;
  snapshotSelectionKey: string;
  available: boolean | undefined;
  status?: "live" | "partial" | "stale" | "loading" | "unavailable";
  pending?: boolean;
  reason: string | null | undefined;
  visible: boolean;
  freshness: string;
}): "loading" | "unavailable" | "hidden" | string;
