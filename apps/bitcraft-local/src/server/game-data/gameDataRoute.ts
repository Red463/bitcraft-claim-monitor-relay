import {
  DOMAIN_KEYS,
  type Confidence,
  type CurrentStateReader,
  type DomainDependencies,
  type DomainEnvelope,
  type DomainKey,
  type DomainStatus,
  type EntityId,
} from "./contracts.ts";
import type { MapResourceLease, MapResourceRuntimeHealth } from "./mapResourceRuntime.ts";

type MapScopeSelection = {
  regionIds: string[];
  playerRegionIds: string[];
  layers: string[];
  resourceIds: string[];
  enemyTypes: string[];
  playerIds: string[];
};

type MapGenerationEvent = {
  claimId?: string;
  generation?: number;
  generatedAt?: string | null;
  changedDomains: DomainKey[];
  mapSpatialScopeKey?: string;
  mapResourceScopeKey?: string;
};

type MapGenerationListener = {
  domains: Set<DomainKey>;
  mapSpatialScopeKeys?: Set<string>;
  mapResourceScopeKeys?: Set<string>;
};

const MAP_LAYER_GENERATION_DOMAINS: Readonly<Record<string, readonly DomainKey[]>> = Object.freeze({
  claims: ["region-claims", "map-spatial"],
  markets: ["market"],
  waystones: ["region-claims"],
  "empire-settlements": ["empires"],
  "empire-territory": ["empires"],
  watchtowers: ["empires"],
  players: ["members", "players", "map-spatial"],
  resources: ["map-resources"],
  enemies: ["map-spatial"],
  roads: [],
  "claim-areas": [],
});

export function mapGenerationDomainsForLayers(layers: readonly string[]): DomainKey[] {
  const required = new Set<DomainKey>();
  for (const layer of layers) {
    for (const domain of MAP_LAYER_GENERATION_DOMAINS[layer] ?? []) required.add(domain);
  }
  return DOMAIN_KEYS.filter((domain) => required.has(domain));
}

export function mapResourceLeaseInputs(scope: MapScopeSelection): Array<{ regionId: string; resourceId: string }> {
  if (!scope.layers.includes("resources")) return [];
  return scope.regionIds.flatMap((regionId) => scope.resourceIds.map((resourceId) => ({ regionId, resourceId })));
}

export function mapRequestNeedsResourceReadiness(pathname: string, searchParams: URLSearchParams): boolean {
  if (["/api/local/map/regions", "/api/local/map/resources", "/api/local/map/resource-partition", "/api/local/map/resource-events"].includes(pathname)) {
    return true;
  }
  return String(searchParams.get("layers") ?? "")
    .split(",")
    .some((layer) => layer.trim() === "resources");
}

export function mapSpatialLeaseInputs(
  scope: MapScopeSelection,
  permitted: { playerIds: string[]; enemyTypes: string[] },
): Array<{ regionId: string; playerIds: string[]; enemyTypes: string[]; includeClaims: boolean }> {
  const playerIds = scope.layers.includes("players") ? permitted.playerIds : [];
  const enemyTypes = scope.layers.includes("enemies") ? permitted.enemyTypes : [];
  const claimRegions = new Set(scope.layers.includes("claims") ? scope.regionIds : []);
  const playerRegions = new Set(playerIds.length ? scope.playerRegionIds : []);
  const enemyRegions = new Set(enemyTypes.length ? scope.regionIds : []);
  const regionIds = [...new Set([...claimRegions, ...playerRegions, ...enemyRegions])]
    .sort((left, right) => left.length - right.length || left.localeCompare(right));
  return regionIds.map((regionId) => ({
    regionId,
    playerIds: playerRegions.has(regionId) ? playerIds : [],
    enemyTypes: enemyRegions.has(regionId) ? enemyTypes : [],
    includeClaims: claimRegions.has(regionId),
  }));
}

export function mapSpatialLeaseNeedsInitialWait(input: { playerIds: string[]; enemyTypes: string[] }): boolean {
  return input.playerIds.length > 0 || input.enemyTypes.length > 0;
}

export function mapRequestLogTarget(requestTarget: URL | string): string {
  let url: URL;
  try {
    url = requestTarget instanceof URL ? requestTarget : new URL(requestTarget, "http://localhost");
  } catch {
    return "/";
  }
  return url.pathname.startsWith("/api/local/map/") ? url.pathname : `${url.pathname}${url.search}`;
}

export function combineMapResourceLeases(leases: MapResourceLease[]) {
  const states = leases.map((lease) => ({ lease, ...lease.state() }));
  const ready = states.filter((state) => state.snapshot != null);
  const snapshots = ready.map((state) => state.snapshot!);
  const receivedAt = snapshots.map((snapshot) => String(snapshot.receivedAt ?? "")).filter(Boolean).sort().at(0) ?? null;
  const warnings = [...new Set([
    ...states.map((state) => state.warning),
    ...snapshots.flatMap((snapshot) => snapshot.warnings ?? []),
  ].filter((warning): warning is string => Boolean(warning)))];
  return {
    data: { resources: snapshots.flatMap((snapshot) => snapshot.data?.resources ?? []) },
    compactPartitions: new Map(ready.map((state) => [
      state.lease.key,
      state.snapshot!.compactResources ?? (state.snapshot!.data?.resources ?? []).map((point) => [
        point.entityId,
        point.regionId,
        point.resourceId,
        point.locationX,
        point.locationZ,
      ] as const),
    ])),
    generation: Math.max(0, ...snapshots.map((snapshot) => Number(snapshot.generation) || 0)),
    freshness: ready.some((state) => state.status === "stale") ? "stale" : warnings.length ? "partial" : "live",
    provenance: { receivedAt },
    warnings,
    requestedKeys: states.map((state) => state.lease.key),
    readyKeys: ready.map((state) => state.lease.key),
    loadingKeys: states.filter((state) => state.snapshot == null && state.status === "loading").map((state) => state.lease.key),
    unavailableKeys: states.filter((state) => state.snapshot == null && state.status === "unavailable").map((state) => state.lease.key),
  };
}

export function mapSnapshotStatusCode({ scope, layerAvailability, regionClaims, market, empires, spatial, resourceCollection }: {
  scope: { layers: string[] };
  layerAvailability: Record<string, { status: string }>;
  regionClaims: unknown;
  market: unknown;
  empires: unknown;
  spatial: unknown;
  resourceCollection: { readyKeys?: string[]; loadingKeys?: string[] } | null;
}): 200 | 503 {
  const hasRelevantSource = scope.layers.some((layer) => {
    if (layerAvailability[layer]?.status === "unavailable") return false;
    if (layer === "resources") return Boolean(resourceCollection?.readyKeys?.length || resourceCollection?.loadingKeys?.length);
    if (layer === "claims") return Boolean(regionClaims || spatial);
    if (layer === "markets") return Boolean(market);
    if (layer === "waystones") return Boolean(regionClaims || spatial);
    if (["empire-settlements", "empire-territory", "watchtowers"].includes(layer)) return Boolean(empires);
    if (["players", "enemies"].includes(layer)) return Boolean(spatial);
    return false;
  });
  return hasRelevantSource ? 200 : 503;
}

export function generationDomainsForListener(event: MapGenerationEvent, listener: MapGenerationListener): DomainKey[] {
  return browserVisibleChangedDomains(event.changedDomains).filter((domain) => (
    listener.domains.has(domain)
    && (domain !== "map-spatial" || !event.mapSpatialScopeKey || listener.mapSpatialScopeKeys?.has(event.mapSpatialScopeKey))
    && (domain !== "map-resources" || Boolean(event.mapResourceScopeKey && listener.mapResourceScopeKeys?.has(event.mapResourceScopeKey)))
  ));
}

export function publicGenerationEvent(event: MapGenerationEvent, changedDomains: DomainKey[]) {
  return {
    ...(event.claimId == null ? {} : { claimId: event.claimId }),
    ...(event.generation == null ? {} : { generation: event.generation }),
    ...(event.generatedAt === undefined ? {} : { generatedAt: event.generatedAt }),
    changedDomains,
    ...(changedDomains.includes("map-resources") && event.mapResourceScopeKey
      ? { mapResourceScopeKey: event.mapResourceScopeKey }
      : {}),
  };
}

export function bindMapLeaseRelease(
  request: { once(event: string, listener: () => void): unknown },
  response: { once(event: string, listener: () => void): unknown },
  release: () => Promise<unknown>,
) {
  let releasePromise: Promise<unknown> | null = null;
  const releaseOnce = () => {
    releasePromise ??= Promise.resolve().then(release);
    return releasePromise;
  };
  request.once("close", () => { void releaseOnce(); });
  response.once("finish", () => { void releaseOnce(); });
  response.once("close", () => { void releaseOnce(); });
  return releaseOnce;
}

export async function acquireMapLeaseUnlessClosed<T extends { release(): Promise<unknown> }>(
  acquire: () => Promise<T>,
  requestClosed: () => boolean,
  closedMessage: string,
): Promise<T> {
  const lease = await acquire();
  if (!requestClosed()) return lease;
  await lease.release();
  throw new Error(closedMessage);
}

export function sanitizedMapResourceHealth(health: MapResourceRuntimeHealth) {
  const regions = health.regions.map((region) => ({
    regionId: region.regionId,
    pinned: region.pinned,
    resourceCount: region.resourceCount,
    leaseCount: region.leaseCount,
    failure: region.failure,
    subscription: region.subscription ? {
      connected: region.subscription.connected,
      applied: region.subscription.applied,
      stage: region.subscription.stage,
      rowCount: region.subscription.rowCount,
      rowsPerSubscription: [...region.subscription.rowsPerSubscription].sort((left, right) => left - right),
      firstGenerationLatencyMs: region.subscription.firstGenerationLatencyMs,
      lastAppliedAt: region.subscription.lastAppliedAt,
      lastError: region.subscription.lastError,
    } : null,
  }));
  return {
    configuredRegionCount: health.configuredRegionIds.length,
    pinnedRegionCount: health.pinnedRegionIds.length,
    coldStartsInWindow: health.coldStartsInWindow,
    regionalConnectionCount: health.regionalConnectionCount,
    activeResourceSubscriptionCount: health.activeResourceSubscriptionCount,
    idleRetainedResourceSubscriptionCount: health.idleRetainedResourceSubscriptionCount,
    rowsPerSubscription: [...health.rowsPerSubscription].sort((left, right) => left - right),
    firstGenerationLatencyMs: health.firstGenerationLatencyMs ? { ...health.firstGenerationLatencyMs } : null,
    reconnectAttemptCount: health.reconnectAttemptCount,
    capacityRejectionCount: health.capacityRejectionCount,
    binaryCache: { ...health.binaryCache },
    regionCount: regions.length,
    resourceCount: regions.reduce((total, region) => total + region.resourceCount, 0),
    leaseCount: regions.reduce((total, region) => total + region.leaseCount, 0),
    regions,
  };
}

export function parseDomainKeys(value: string | null): DomainKey[] {
  if (!value) return [];
  const allowed = new Set<string>(DOMAIN_KEYS);
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter((entry): entry is DomainKey => allowed.has(entry)))];
}

export function browserVisibleChangedDomains(domains: DomainKey[]): DomainKey[] {
  const visible: DomainKey[] = [];
  const seen = new Set<DomainKey>();
  for (const domain of domains) {
    const exposed = domain === "inventory-banks" || domain === "inventory-storages" ? "inventories" : domain;
    if (seen.has(exposed)) continue;
    seen.add(exposed);
    visible.push(exposed);
  }
  return visible;
}

export function generationSourceDomains(domains: DomainKey[]): DomainKey[] {
  const sources = [...domains];
  if (domains.includes("inventories") && !sources.includes("inventory-storages")) {
    sources.push("inventory-storages");
  }
  if (domains.includes("inventories") && !sources.includes("inventory-banks")) {
    sources.push("inventory-banks");
  }
  return sources;
}

export function gameDataResponse(options: {
  configuredClaimId: EntityId;
  claimId: EntityId;
  domains: DomainKey[];
  repository: CurrentStateReader;
  transformData?: (domain: DomainKey, data: unknown) => unknown;
  transformDomain?: (domain: DomainKey, data: unknown) => {
    data: unknown;
    confidence?: Confidence;
    warnings?: string[];
    dependencies?: DomainDependencies;
  };
  now?: Date;
  freshForMs?: number;
  liveForMs?: number;
}) {
  if (options.claimId !== options.configuredClaimId) {
    return {
      status: 403,
      body: { error: "Requested claim is not the configured monitored claim." },
    };
  }
  const now = options.now ?? new Date();
  const freshForMs = options.freshForMs ?? 90_000;
  const liveForMs = options.liveForMs ?? 45_000;
  const domains: Partial<Record<DomainKey, DomainEnvelope<unknown>>> = {};
  const domainStatus: Partial<Record<DomainKey, DomainStatus>> = {};
  const availableGenerations = new Set<number>();
  const partialErrors: string[] = [];
  let availableCount = 0;
  let unknownDependencyGeneration = false;
  let regionId = "";

  for (const domain of options.domains) {
    const snapshot = options.repository.read(options.claimId, domain);
    if (!snapshot) {
      const warning = `${domain} has not loaded yet.`;
      partialErrors.push(warning);
      domainStatus[domain] = {
        generation: null,
        freshness: "unavailable",
        confidence: "unknown",
        ageMs: null,
        warnings: [warning],
        provenance: null,
        dependencies: {},
      };
      continue;
    }
    availableCount += 1;
    availableGenerations.add(snapshot.generation);
    const observedAt = snapshot.provenance.sourceObservedAt ?? snapshot.provenance.receivedAt;
    const observedMs = Date.parse(observedAt);
    const ageMs = Number.isFinite(observedMs) ? Math.max(0, now.getTime() - observedMs) : null;
    const stale = snapshot.lastError != null || ageMs == null || ageMs > freshForMs;
    const subscriptionHealth = options.repository.readSubscriptionHealth?.(
      snapshot.provenance.sourceKey,
      domain,
    );
    const heartbeatMs = Date.parse(subscriptionHealth?.updatedAt ?? "");
    const heartbeatAgeMs = Number.isFinite(heartbeatMs)
      ? Math.max(0, now.getTime() - heartbeatMs)
      : null;
    const live = snapshot.lastError == null
      && subscriptionHealth?.connected === true
      && subscriptionHealth.lastError == null
      && subscriptionHealth.generation >= snapshot.generation
      && heartbeatAgeMs != null
      && heartbeatAgeMs <= liveForMs;
    const transformed = options.transformDomain
      ? options.transformDomain(domain, snapshot.data)
      : {
          data: options.transformData ? options.transformData(domain, snapshot.data) : snapshot.data,
        };
    const warnings = [
      ...snapshot.warnings,
      ...(Array.isArray(transformed.warnings) ? transformed.warnings : []),
    ];
    const confidence = transformed.confidence ?? snapshot.confidence;
    const dependencies = transformed.dependencies ?? {};
    const statusWarnings = [...new Set([
      ...warnings,
      ...(snapshot.lastError ? [snapshot.lastError] : []),
    ])];
    for (const dependency of Object.values(dependencies)) {
      if (!dependency) continue;
      if (dependency.generation == null) {
        unknownDependencyGeneration = true;
      } else {
        availableGenerations.add(dependency.generation);
      }
    }
    const freshness = live ? "live" : stale ? "stale" : "fresh";
    domains[domain] = {
      data: transformed.data,
      freshness,
      confidence,
      ageMs,
      provenance: snapshot.provenance,
      warnings,
    };
    domainStatus[domain] = {
      generation: snapshot.generation,
      freshness,
      confidence,
      ageMs,
      warnings: statusWarnings,
      provenance: snapshot.provenance,
      dependencies,
    };
    if (snapshot.lastError) partialErrors.push(`${domain}: ${snapshot.lastError}`);
    for (const warning of warnings) {
      partialErrors.push(`${domain}: ${warning}`);
    }
    if (confidence === "partial" && warnings.length === 0) {
      partialErrors.push(`${domain}: data is partial.`);
    }
    if (domain === "claim") {
      regionId = String((snapshot.data as { regionId?: unknown })?.regionId ?? "");
    }
  }

  const sortedGenerations = [...availableGenerations].sort((left, right) => left - right);

  return {
    status: availableCount ? 200 : 503,
    body: {
      claimId: options.claimId,
      regionId,
      generatedAt: now.toISOString(),
      domains,
      domainStatus,
      meta: {
        coherence: sortedGenerations.length === 0
          ? "unavailable"
          : unknownDependencyGeneration || sortedGenerations.length > 1 ? "mixed" : "coherent",
        availableGenerations: sortedGenerations,
        newestGeneration: sortedGenerations.at(-1) ?? null,
        oldestGeneration: sortedGenerations[0] ?? null,
      },
      partialErrors,
    },
  };
}
