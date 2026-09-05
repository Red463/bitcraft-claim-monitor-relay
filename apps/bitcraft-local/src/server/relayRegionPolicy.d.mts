export const CLOSED_EVENT_REGION_IDS: readonly ["3", "11", "15", "23"];
export function isClosedEventRegion(value: unknown): boolean;
export function withoutClosedEventRegions<T>(values?: T[]): T[];
export function relayMapSchemaMismatchDiagnostic(detail: { regionId: string; error: unknown }): {
  stage: "region-skipped";
  regionId: string;
  reason: "schema-mismatch";
  warning: string;
};
export function schemaCompleteRelayMapRegionIds(options: {
  topology: { regions: Map<string, { ready?: boolean; schemaFingerprint?: unknown }> };
  manifest: unknown;
  requestedSet?: ReadonlySet<string> | null;
  assertFingerprint: (manifest: unknown, kind: "regional", fingerprint: string) => void;
  onSchemaMismatch?: (detail: { regionId: string; error: unknown }) => void;
}): string[] | null;
