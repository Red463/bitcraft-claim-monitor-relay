export type EntityId = string;
export type DecimalInteger = string;
export type RegionId = string;
export type ItemKind = "item" | "cargo";

export const DOMAIN_KEYS = [
  "claim",
  "members",
  "citizens",
  "players",
  "skills",
  "buildings",
  "inventories",
  "inventory-storages",
  "inventory-banks",
  "crafts",
  "public-crafts",
  "contributions",
  "construction",
  "research",
  "recruitment",
  "equipment",
  "market",
  "regional-market",
  "region",
  "region-claims",
  "empires",
  "deposits",
  "catalogs",
  "map-static",
  "map-spatial",
  "map-resources",
] as const;

export type DomainKey = (typeof DOMAIN_KEYS)[number];
export type Freshness = "live" | "fresh" | "stale" | "unavailable";
export type Confidence = "authoritative" | "joined" | "partial" | "unknown";

export type MapLayerAvailability = {
  available: boolean;
  status: "live" | "partial" | "stale" | "loading" | "unavailable";
  reason: string | null;
};

export type Provenance = {
  provider: "relay";
  sourceKey: "relay-cache" | "global" | `region:${number}`;
  regionId: RegionId | null;
  database: string | null;
  schemaFingerprint: string | null;
  sourceObservedAt: string | null;
  receivedAt: string;
};

export type DomainEnvelope<T> = {
  data: T | null;
  freshness: Freshness;
  confidence: Confidence;
  ageMs: number | null;
  provenance: Provenance;
  warnings: string[];
};

export type GenerationDependency = {
  generation: number | null;
  sourceGeneration?: number | null;
  sourceKey: string;
  receivedAt: string | null;
  freshness?: Freshness;
};

export type DomainDependencies = Partial<Record<
  "catalog" | "inventory-storages" | "inventory-banks" | "public-crafts",
  GenerationDependency
>>;

export type DomainStatus = {
  generation: number | null;
  freshness: Freshness;
  confidence: Confidence;
  ageMs: number | null;
  warnings: string[];
  provenance: Provenance | null;
  dependencies: DomainDependencies;
};

export type GameDataResponseMeta = {
  coherence: "coherent" | "mixed" | "unavailable";
  availableGenerations: number[];
  newestGeneration: number | null;
  oldestGeneration: number | null;
};

export type PendingDomainSnapshot<T = unknown> = {
  data: T;
  confidence: Confidence;
  provenance: Provenance;
  warnings: string[];
};

export type DomainSnapshotBatch = {
  claimId: EntityId;
  generation: number;
  domains: Partial<Record<DomainKey, PendingDomainSnapshot>>;
};

export type DomainEvent = {
  claimId: EntityId;
  domain: DomainKey;
  sourceKey: string;
  occurredAt: string;
  data: unknown;
};

export type ProviderConfig = {
  relayBaseUrl: string;
  claimId: EntityId;
  activeRegionIds: RegionId[];
  topologyRefreshMs?: number;
};

export type RefreshRequest = {
  claimId: EntityId;
  domains: DomainKey[];
  reason: "startup" | "scheduled" | "manual";
};

export type RefreshResult = {
  generation: number;
  refreshed: DomainKey[];
  failed: Partial<Record<DomainKey, string>>;
};

export type SchemaFingerprintDiagnostic = {
  sourceKey: "global" | `region:${number}`;
  schemaUrl: string;
  expected: string | null;
  observed: string | null;
  attemptedAt: string;
  status: "verified" | "mismatch" | "download_error";
  error: string | null;
};

export type ProviderHealth = {
  provider: "relay";
  running: boolean;
  topologyReady: boolean;
  cacheReady: boolean;
  generation: number;
  lastRefreshAt: string | null;
  lastError: string | null;
  sources: Record<string, {
    ready: boolean;
    database: string | null;
    schemaFingerprint: string | null;
    schemaFingerprintDiagnostic?: SchemaFingerprintDiagnostic;
  }>;
};

export interface ProviderSink {
  commitGeneration(batch: DomainSnapshotBatch): Promise<void>;
  appendEvents(events: DomainEvent[]): Promise<void>;
  markError?(claimId: EntityId, domain: DomainKey, error: string, attemptedAt: string): Promise<void>;
  recordHealth?(health: ProviderHealth, observedAt: string): Promise<void>;
  nextGeneration?(claimId: EntityId): number;
}

export interface GameDataProvider {
  start(config: ProviderConfig, sink: ProviderSink): Promise<void>;
  refresh(request: RefreshRequest): Promise<RefreshResult>;
  health(): ProviderHealth;
  stop(): Promise<void>;
}

export type StoredDomainSnapshot<T = unknown> = PendingDomainSnapshot<T> & {
  generation: number;
  lastError: string | null;
};

export interface CurrentStateReader {
  read(claimId: EntityId, domain: DomainKey): StoredDomainSnapshot | null;
  readSubscriptionHealth?(sourceKey: string, domain: DomainKey): {
    generation: number;
    connected: boolean;
    lastError: string | null;
    updatedAt: string;
  } | null;
}
