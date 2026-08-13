import { discoverRelayTopology, type RelayTopology } from "./topology.ts";
import { assertSchemaFingerprint } from "./schemaManifest.ts";

type BindingManifest = Parameters<typeof assertSchemaFingerprint>[0];

export type MapResourceRegionCatalog = {
  provider: "relay";
  generatedAt: string | null;
  freshness: "live" | "stale" | "unavailable";
  warnings: string[];
  regionIds: string[];
  regions: Array<{
    regionId: string;
    regionName: string;
    relayReady: boolean;
    freshness: "live" | "stale";
  }>;
};

type ReadinessInput = {
  relayBaseUrl: string;
  primaryRegionId: string;
  configuredRegionIds: string[];
};

type Runtime = {
  reconcile(input: { relayBaseUrl: string; primaryRegionId: string; activeRegionIds: string[] }): Promise<void>;
};

type Dependencies = {
  manifest: BindingManifest;
  runtime: Runtime;
  discoverTopology?: (baseUrl: string) => Promise<RelayTopology>;
  now?: () => number;
  ttlMs?: number;
};

function decimal(value: unknown, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) throw new TypeError(`${label} must be a decimal integer`);
  return BigInt(normalized).toString();
}

function decimalList(values: unknown[], label: string): string[] {
  return [...new Set(values.map((value) => decimal(value, label)))]
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
}

function normalizedInput(input: ReadinessInput) {
  const relayBaseUrl = String(input.relayBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(relayBaseUrl)) throw new TypeError("Map resource Relay base URL must be HTTP or HTTPS");
  const primaryRegionId = decimal(input.primaryRegionId, "Map resource primary region id");
  const configuredRegionIds = decimalList([...input.configuredRegionIds, primaryRegionId], "Map resource configured region id");
  return {
    relayBaseUrl,
    primaryRegionId,
    configuredRegionIds,
    key: `${relayBaseUrl}|${primaryRegionId}|${configuredRegionIds.join(",")}`,
  };
}

function catalogFor(regionIds: string[], freshness: "live" | "stale" | "unavailable", generatedAt: string | null, warnings: string[]): MapResourceRegionCatalog {
  const rowFreshness = freshness === "live" ? "live" : "stale";
  return {
    provider: "relay",
    generatedAt,
    freshness,
    warnings,
    regionIds,
    regions: regionIds.map((regionId) => ({
      regionId,
      regionName: `Region ${regionId}`,
      relayReady: true,
      freshness: rowFreshness,
    })),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class RelayMapResourceReadiness {
  readonly #manifest: BindingManifest;
  readonly #runtime: Runtime;
  readonly #discoverTopology: (baseUrl: string) => Promise<RelayTopology>;
  readonly #now: () => number;
  readonly #ttlMs: number;
  #lastGood: MapResourceRegionCatalog | null = null;
  #lastKey: string | null = null;
  #expiresAt = 0;
  #inflight: { key: string; promise: Promise<MapResourceRegionCatalog> } | null = null;

  constructor(dependencies: Dependencies) {
    this.#manifest = dependencies.manifest;
    this.#runtime = dependencies.runtime;
    this.#discoverTopology = dependencies.discoverTopology ?? discoverRelayTopology;
    this.#now = dependencies.now ?? Date.now;
    this.#ttlMs = dependencies.ttlMs ?? 60_000;
    if (!Number.isFinite(this.#ttlMs) || this.#ttlMs < 0) throw new TypeError("Map resource readiness TTL must be non-negative");
  }

  async ensure(input: ReadinessInput): Promise<MapResourceRegionCatalog> {
    const normalized = normalizedInput(input);
    if (this.#lastGood && this.#lastKey === normalized.key && this.#now() < this.#expiresAt) return this.#lastGood;
    if (this.#inflight?.key === normalized.key) return this.#inflight.promise;
    if (this.#inflight) {
      await this.#inflight.promise;
      return this.ensure(input);
    }
    const promise = this.#refresh(normalized).finally(() => {
      if (this.#inflight?.promise === promise) this.#inflight = null;
    });
    this.#inflight = { key: normalized.key, promise };
    return promise;
  }

  catalog(): MapResourceRegionCatalog | null {
    return this.#lastGood;
  }

  async #refresh(input: ReturnType<typeof normalizedInput>): Promise<MapResourceRegionCatalog> {
    try {
      const topology = await this.#discoverTopology(input.relayBaseUrl);
      const warnings: string[] = [];
      const regionIds = decimalList([...topology.regions.entries()].flatMap(([regionId, source]) => {
        if (!source.ready) return [];
        try {
          assertSchemaFingerprint(this.#manifest, "regional", String(source.schemaFingerprint ?? ""));
          return [regionId];
        } catch (error) {
          warnings.push(`Relay map resource region ${regionId} ${errorMessage(error)}.`);
          return [];
        }
      }), "Map resource ready region id");
      await this.#runtime.reconcile({
        relayBaseUrl: input.relayBaseUrl,
        primaryRegionId: input.primaryRegionId,
        activeRegionIds: regionIds,
      });
      const catalog = catalogFor(
        regionIds,
        regionIds.length ? "live" : "unavailable",
        topology.discoveredAt ?? new Date(this.#now()).toISOString(),
        regionIds.length ? warnings : [...warnings, "No Relay regional source is currently schema-ready."],
      );
      this.#lastGood = catalog;
      this.#lastKey = input.key;
      this.#expiresAt = this.#now() + this.#ttlMs;
      return catalog;
    } catch (error) {
      const warning = `Relay map resource readiness is stale: ${errorMessage(error)}`;
      const fallbackIds = this.#lastGood && this.#lastKey === input.key
        ? this.#lastGood.regionIds
        : [];
      const degraded = catalogFor(fallbackIds, fallbackIds.length ? "stale" : "unavailable", this.#lastGood?.generatedAt ?? null, [warning]);
      this.#lastGood = degraded;
      this.#lastKey = input.key;
      this.#expiresAt = this.#now() + this.#ttlMs;
      return degraded;
    }
  }
}
