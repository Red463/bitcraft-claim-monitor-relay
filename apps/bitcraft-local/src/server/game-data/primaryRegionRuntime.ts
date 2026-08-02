import type { DomainEvent, DomainSnapshotBatch } from "./contracts.ts";
import { relayWebSocketUri } from "./globalCatalogRuntime.ts";
import {
  RelayPrimaryRegionPlayerSession,
  type RegionalPlayerSnapshot,
} from "./primaryRegionPlayerSession.ts";
import {
  discoverRelayTopology,
  type RelayTopology,
  type RelayTopologyDiscoveryOptions,
} from "./topology.ts";

type BindingManifest = Parameters<RelayPrimaryRegionPlayerSession["start"]>[0]["manifest"];
type Member = Parameters<RelayPrimaryRegionPlayerSession["start"]>[0]["members"][number];
type ContributionTarget = NonNullable<
  Parameters<RelayPrimaryRegionPlayerSession["start"]>[0]["contributionTargets"]
>[number];

type CurrentStateRepository = {
  nextGeneration(claimId: string): number;
  commitGeneration(batch: DomainSnapshotBatch): Promise<void> | void;
  appendEvents?(events: DomainEvent[]): Promise<void> | void;
};

type RegionalSession = {
  start(config: Parameters<RelayPrimaryRegionPlayerSession["start"]>[0]): Promise<void>;
  updateContributionScope?(
    targets: ContributionTarget[],
    warnings?: string[],
  ): void;
  health(): ReturnType<RelayPrimaryRegionPlayerSession["health"]>;
  stop(): Promise<void>;
};

type RegionalSessionFactory = (
  options: ConstructorParameters<typeof RelayPrimaryRegionPlayerSession>[0],
) => RegionalSession;

type RuntimeDependencies = {
  manifest: BindingManifest;
  currentStateRepository: CurrentStateRepository;
  discoverTopology?: (
    baseUrl: string,
    options?: RelayTopologyDiscoveryOptions,
  ) => Promise<RelayTopology>;
  createSession?: RegionalSessionFactory;
  now?: () => number;
  topologyRefreshMs?: number;
};

function memberId(member: Member): string {
  return String(member.playerEntityId ?? member.player_entity_id ?? "").trim();
}

function membershipSignature(regionId: string, members: Member[]): string {
  const identities = members.map((member) => (
    `${memberId(member)}:${String(member.userName ?? member.user_name ?? "").trim()}`
  ));
  return `${regionId}:${[...new Set(identities)].sort().join(",")}`;
}

function contributionSignature(targets: ContributionTarget[]): string {
  return targets.map((target) => [
    target.craftEntityId,
    target.profession ?? "",
    target.craftLabel,
    target.structureName,
    target.itemTier ?? "",
    target.xpPerProgress,
  ].join(":")).sort().join(",");
}

function contributionSessionSignature(
  targets: ContributionTarget[],
  warnings: string[] = [],
): string {
  const warningSignature = [...new Set(warnings.map((warning) => String(warning).trim()).filter(Boolean))]
    .sort()
    .join(",");
  return `${contributionSignature(targets)}|${warningSignature}`;
}

function primaryRegionSource(
  relayBaseUrl: string,
  regionId: string,
  topology: RelayTopology,
) {
  const region = topology.regions.get(regionId);
  if (!region?.ready || !region.schemaFingerprint) {
    throw new Error(`Relay region ${regionId} source is not ready or has no schema fingerprint`);
  }
  return {
    sourceKey: `region:${Number(regionId)}` as const,
    regionId,
    database: region.database,
    schemaFingerprint: region.schemaFingerprint,
    uri: relayWebSocketUri(relayBaseUrl, region.port),
  };
}

function samePrimaryRegionSource(
  left: ReturnType<typeof primaryRegionSource> | null,
  right: ReturnType<typeof primaryRegionSource>,
) {
  return left?.sourceKey === right.sourceKey
    && left.regionId === right.regionId
    && left.database === right.database
    && left.schemaFingerprint === right.schemaFingerprint
    && left.uri === right.uri;
}

export class RelayPrimaryRegionRuntime {
  readonly #manifest: BindingManifest;
  readonly #currentStateRepository: CurrentStateRepository;
  readonly #discoverTopology: (
    baseUrl: string,
    options?: RelayTopologyDiscoveryOptions,
  ) => Promise<RelayTopology>;
  readonly #createSession: RegionalSessionFactory;
  readonly #now: () => number;
  readonly #topologyRefreshMs: number;
  #session: RegionalSession | null = null;
  #relayBaseUrl: string | null = null;
  #claimId: string | null = null;
  #signature: string | null = null;
  #contributionSignature: string | null = null;
  #sessionEpoch = 0;
  #commitTail: Promise<void> = Promise.resolve();
  #eventTail: Promise<void> = Promise.resolve();
  #source: {
    sourceKey: `region:${number}`;
    regionId: string;
    database: string;
    schemaFingerprint: string;
    uri: string;
  } | null = null;
  #lastError: string | null = null;
  #lastTopologyCheckedAt = 0;
  #reconcileInFlight: Promise<void> | null = null;

  constructor(dependencies: RuntimeDependencies) {
    this.#manifest = dependencies.manifest;
    this.#currentStateRepository = dependencies.currentStateRepository;
    this.#discoverTopology = dependencies.discoverTopology
      ?? ((baseUrl, options) => discoverRelayTopology(baseUrl, fetch, options));
    this.#createSession = dependencies.createSession
      ?? ((options) => new RelayPrimaryRegionPlayerSession(options));
    this.#now = dependencies.now ?? Date.now;
    this.#topologyRefreshMs = dependencies.topologyRefreshMs ?? 60_000;
  }

  async start(config: {
    relayBaseUrl: string;
    claimId: string;
    regionId: string;
    members: Member[];
    contributionTargets?: ContributionTarget[];
    contributionWarnings?: string[];
  }): Promise<void> {
    if (this.#session) throw new Error("Relay primary-region runtime is already started");
    this.#relayBaseUrl = config.relayBaseUrl.replace(/\/+$/, "");
    this.#claimId = String(config.claimId).trim();
    await this.#startSession(
      config.regionId,
      config.members,
      config.contributionTargets ?? [],
      config.contributionWarnings ?? [],
    );
  }

  reconcile(config: {
    claimId?: string;
    regionId: string;
    members: Member[];
    contributionTargets?: ContributionTarget[];
    contributionWarnings?: string[];
  }): Promise<void> {
    const claimId = String(config.claimId ?? this.#claimId ?? "").trim();
    const contributionTargets = config.contributionTargets ?? [];
    const contributionWarnings = config.contributionWarnings ?? [];
    const nextSignature = membershipSignature(config.regionId, config.members);
    const nextContributionSignature = contributionSessionSignature(
      contributionTargets,
      contributionWarnings,
    );
    const sameScope = this.#session
      && claimId === this.#claimId
      && nextSignature === this.#signature;
    if (sameScope && nextContributionSignature !== this.#contributionSignature) {
      this.#session?.updateContributionScope?.(
        contributionTargets,
        contributionWarnings,
      );
      this.#contributionSignature = nextContributionSignature;
    }
    if (
      sameScope
      && this.#now() - this.#lastTopologyCheckedAt < this.#topologyRefreshMs
    ) return Promise.resolve();
    if (this.#reconcileInFlight) return this.#reconcileInFlight;
    const reconcile = (async () => {
      if (sameScope) {
        const relayBaseUrl = this.#relayBaseUrl;
        if (!relayBaseUrl) throw new Error("Relay primary-region runtime is not configured");
        const topology = await this.#discoverTopology(relayBaseUrl, {
          sourceKeys: new Set([`region:${Number(config.regionId)}`]),
        });
        const discoveredSource = primaryRegionSource(
          relayBaseUrl,
          String(config.regionId).trim(),
          topology,
        );
        this.#lastTopologyCheckedAt = this.#now();
        if (samePrimaryRegionSource(this.#source, discoveredSource)) return;
      }
      this.#sessionEpoch += 1;
      await this.#session?.stop();
      await this.#commitTail;
      await this.#eventTail;
      this.#session = null;
      this.#signature = null;
      this.#contributionSignature = null;
      this.#claimId = claimId;
      await this.#startSession(config.regionId, config.members, contributionTargets, contributionWarnings);
    })();
    this.#reconcileInFlight = reconcile;
    return reconcile.finally(() => {
      if (this.#reconcileInFlight === reconcile) this.#reconcileInFlight = null;
    });
  }

  async #startSession(
    regionIdValue: string,
    members: Member[],
    contributionTargets: ContributionTarget[],
    contributionWarnings: string[] = [],
  ): Promise<void> {
    const relayBaseUrl = this.#relayBaseUrl;
    if (!relayBaseUrl || !this.#claimId) {
      throw new Error("Relay primary-region runtime is not configured");
    }
    const regionId = String(regionIdValue).trim();
    let openingSession: RegionalSession | null = null;
    try {
      const topology = await this.#discoverTopology(relayBaseUrl, {
        sourceKeys: new Set([`region:${Number(regionId)}`]),
      });
      this.#source = primaryRegionSource(relayBaseUrl, regionId, topology);
      this.#lastTopologyCheckedAt = this.#now();
      const sessionEpoch = this.#sessionEpoch + 1;
      this.#sessionEpoch = sessionEpoch;
      openingSession = this.#createSession({
        onSnapshot: (snapshot) => this.#enqueueSnapshot(snapshot, sessionEpoch),
        onContribution: (event) => this.#enqueueEvent(event, sessionEpoch),
      });
      await openingSession.start({
        uri: this.#source.uri,
        database: this.#source.database,
        schemaFingerprint: this.#source.schemaFingerprint,
        manifest: this.#manifest,
        generation: 1,
        regionId,
        claimId: this.#claimId,
        members,
        ...(contributionTargets.length ? { contributionTargets } : {}),
        ...(contributionWarnings.length ? { contributionWarnings } : {}),
      });
      this.#session = openingSession;
      this.#signature = membershipSignature(regionId, members);
      this.#contributionSignature = contributionSessionSignature(
        contributionTargets,
        contributionWarnings,
      );
      this.#lastError = null;
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
      try {
        await openingSession?.stop();
      } catch {
        // Preserve the startup failure as the actionable error.
      }
      this.#session = null;
      throw error;
    }
  }

  #enqueueEvent(event: DomainEvent, sessionEpoch: number): Promise<void> {
    const append = this.#eventTail.then(async () => {
      if (sessionEpoch !== this.#sessionEpoch) return;
      await this.#currentStateRepository.appendEvents?.([event]);
    });
    this.#eventTail = append.catch(() => {});
    return append;
  }

  #enqueueSnapshot(snapshot: RegionalPlayerSnapshot, sessionEpoch: number): Promise<void> {
    const commit = this.#commitTail.then(async () => {
      if (sessionEpoch !== this.#sessionEpoch) return;
      await this.#commitSnapshot(snapshot);
    });
    this.#commitTail = commit.catch(() => {});
    return commit;
  }

  async #commitSnapshot(snapshot: RegionalPlayerSnapshot): Promise<void> {
    const claimId = this.#claimId;
    if (!claimId) throw new Error("Relay primary-region runtime has no configured claim");
    const sourceKey = `region:${Number(snapshot.regionId)}` as const;
    try {
      await this.#currentStateRepository.commitGeneration({
        claimId,
        generation: this.#currentStateRepository.nextGeneration(claimId),
        domains: {
          players: {
            data: snapshot.players,
            confidence: snapshot.warnings.length ? "partial" : "authoritative",
            provenance: {
              provider: "relay",
              sourceKey,
              regionId: snapshot.regionId,
              database: snapshot.database,
              schemaFingerprint: snapshot.schemaFingerprint,
              sourceObservedAt: null,
              receivedAt: snapshot.receivedAt,
            },
            warnings: snapshot.warnings,
          },
          equipment: {
            data: snapshot.equipment,
            confidence: snapshot.equipmentWarnings.length ? "partial" : "authoritative",
            provenance: {
              provider: "relay",
              sourceKey,
              regionId: snapshot.regionId,
              database: snapshot.database,
              schemaFingerprint: snapshot.schemaFingerprint,
              sourceObservedAt: null,
              receivedAt: snapshot.receivedAt,
            },
            warnings: snapshot.equipmentWarnings,
          },
          construction: {
            data: snapshot.construction,
            confidence: snapshot.constructionWarnings.length ? "partial" : "authoritative",
            provenance: {
              provider: "relay",
              sourceKey,
              regionId: snapshot.regionId,
              database: snapshot.database,
              schemaFingerprint: snapshot.schemaFingerprint,
              sourceObservedAt: null,
              receivedAt: snapshot.receivedAt,
            },
            warnings: snapshot.constructionWarnings,
          },
          research: {
            data: snapshot.research,
            confidence: snapshot.researchWarnings.length ? "partial" : "authoritative",
            provenance: {
              provider: "relay",
              sourceKey,
              regionId: snapshot.regionId,
              database: snapshot.database,
              schemaFingerprint: snapshot.schemaFingerprint,
              sourceObservedAt: null,
              receivedAt: snapshot.receivedAt,
            },
            warnings: snapshot.researchWarnings,
          },
          recruitment: {
            data: snapshot.recruitment,
            confidence: snapshot.recruitmentWarnings.length ? "partial" : "authoritative",
            provenance: {
              provider: "relay",
              sourceKey,
              regionId: snapshot.regionId,
              database: snapshot.database,
              schemaFingerprint: snapshot.schemaFingerprint,
              sourceObservedAt: null,
              receivedAt: snapshot.receivedAt,
            },
            warnings: snapshot.recruitmentWarnings,
          },
          "inventory-banks": {
            data: snapshot.bankInventories,
            confidence: snapshot.bankInventoryWarnings.length ? "partial" : "authoritative",
            provenance: {
              provider: "relay",
              sourceKey,
              regionId: snapshot.regionId,
              database: snapshot.database,
              schemaFingerprint: snapshot.schemaFingerprint,
              sourceObservedAt: null,
              receivedAt: snapshot.receivedAt,
            },
            warnings: snapshot.bankInventoryWarnings,
          },
          contributions: {
            data: {},
            confidence: snapshot.contributionWarnings?.length ? "partial" : "authoritative",
            provenance: {
              provider: "relay",
              sourceKey,
              regionId: snapshot.regionId,
              database: snapshot.database,
              schemaFingerprint: snapshot.schemaFingerprint,
              sourceObservedAt: null,
              receivedAt: snapshot.receivedAt,
            },
            warnings: snapshot.contributionWarnings ?? [],
          },
        },
      });
      this.#lastError = null;
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  health() {
    return {
      running: this.#session != null,
      source: this.#source ? { ...this.#source } : null,
      membershipSignature: this.#signature,
      subscription: this.#session?.health() ?? {
        connected: false,
        applied: false,
        lastAppliedAt: null,
        lastError: null,
      },
      lastError: this.#lastError,
    };
  }

  async stop(): Promise<void> {
    this.#sessionEpoch += 1;
    await this.#session?.stop();
    await this.#commitTail;
    await this.#eventTail;
    this.#session = null;
    this.#signature = null;
    this.#contributionSignature = null;
  }
}
