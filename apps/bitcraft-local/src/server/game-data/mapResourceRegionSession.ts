import {
  mapResourceQueries,
  normalizeMapResourceRegionGeneration,
  type MapResourcePoint,
} from "./mapResourceProjection.ts";
import { assertSchemaFingerprint, schemaBindingsReady } from "./schemaManifest.ts";

type BindingManifest = Parameters<typeof assertSchemaFingerprint>[0];
type CachedTable = {
  iter(): IterableIterator<unknown>;
  onInsert?(callback: () => void): void;
  onUpdate?(callback: () => void): void;
  onDelete?(callback: () => void): void;
  removeOnInsert?(callback: () => void): void;
  removeOnUpdate?(callback: () => void): void;
  removeOnDelete?(callback: () => void): void;
};
type SubscriptionHandle = { unsubscribe(): void };
type SubscriptionBuilder = {
  onApplied(callback: () => void): SubscriptionBuilder;
  onError(callback: (context: unknown, error: Error) => void): SubscriptionBuilder;
  subscribe(queries: string[]): SubscriptionHandle;
};
type BindingConnection = {
  db: { resourceState: CachedTable; locationState: CachedTable };
  subscriptionBuilder(): SubscriptionBuilder;
  disconnect(): void;
};
type ConnectionBuilder = {
  withUri(uri: string): ConnectionBuilder;
  withDatabaseName(database: string): ConnectionBuilder;
  onConnect(callback: (connection: BindingConnection) => void): ConnectionBuilder;
  onConnectError(callback: (context: unknown, error: Error) => void): ConnectionBuilder;
  onDisconnect(callback: (context: unknown, error?: Error) => void): ConnectionBuilder;
  build(): BindingConnection;
};
export type RegionalBindingModule = { DbConnection: { builder(): ConnectionBuilder } };

const MAX_RESOURCE_IDS = 16;
const DEFAULT_MAX_NODES = 250_000;
const DEFAULT_REBUILD_DELAY_MS = 300;

export type RegionSessionConfig = {
  uri: string;
  database: string;
  schemaFingerprint: string;
  manifest: BindingManifest;
  generation: number;
  regionId: string;
  maxNodes?: number;
};

export type MapResourceSnapshot = {
  data: { regionId: string; resourceId: string; resources: MapResourcePoint[] };
  warnings: string[];
  database: string;
  regionId: string;
  resourceId: string;
  schemaFingerprint: string;
  generation: number;
  receivedAt: string;
};

export type MapResourceStatus = {
  regionId: string;
  resourceId: string;
  warning: string;
  receivedAt: string;
};

export type ResourceRegionHealth = {
  connected: boolean;
  applied: boolean;
  stage: "idle" | "connecting" | "subscribed" | "applied" | "partial" | "error" | "stopped";
  appliedResourceIds: string[];
  rowCount: number;
  rowsPerType: Record<string, { resourceState: number; locationState: number }>;
  firstGenerationLatencyMs: number | null;
  lastAppliedAt: string | null;
  lastError: string | null;
};

type ResourceSubscription = {
  resourceId: string;
  generation: number;
  handle: SubscriptionHandle;
  applied: boolean;
};

async function loadBundledRegionalBindings(): Promise<RegionalBindingModule> {
  return await import(new URL("./bindings/regional.js", import.meta.url).href) as unknown as RegionalBindingModule;
}

function decimal(value: unknown, label: string): string {
  const result = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^\d+$/.test(result)) throw new TypeError(`${label} must be a decimal integer`);
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new TypeError(`${label} must be a positive safe integer`);
  return result;
}

function tableRows(table: CachedTable): unknown[] {
  return [...table.iter()];
}

export class RelayMapResourceRegionSession {
  readonly #loadBindings: () => Promise<RegionalBindingModule>;
  readonly #onSnapshot: (snapshot: MapResourceSnapshot) => void | Promise<void>;
  readonly #onStatus: (status: MapResourceStatus) => void | Promise<void>;
  readonly #onFailure: (error: string) => void;
  readonly #now: () => Date;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (timer: unknown) => void;
  readonly #rebuildDelayMs: number;
  #connection: BindingConnection | null = null;
  #pendingConnection: BindingConnection | null = null;
  #abortStart: (() => void) | null = null;
  #config: (Omit<RegionSessionConfig, "regionId" | "generation" | "maxNodes"> & { regionId: string; generation: number; maxNodes: number }) | null = null;
  #subscriptions = new Map<string, ResourceSubscription>();
  #listenersAttached = false;
  #rebuildTimer: unknown | null = null;
  #startedAt: Date | null = null;
  #stopping = false;
  #health: ResourceRegionHealth = {
    connected: false,
    applied: false,
    stage: "idle",
    appliedResourceIds: [],
    rowCount: 0,
    rowsPerType: {},
    firstGenerationLatencyMs: null,
    lastAppliedAt: null,
    lastError: null,
  };

  readonly #changed = () => this.#queueRebuild();

  constructor({
    loadBindings = loadBundledRegionalBindings,
    onSnapshot,
    onStatus = () => {},
    onFailure = () => {},
    now = () => new Date(),
    setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    rebuildDelayMs = DEFAULT_REBUILD_DELAY_MS,
  }: {
    loadBindings?: () => Promise<RegionalBindingModule>;
    onSnapshot: (snapshot: MapResourceSnapshot) => void | Promise<void>;
    onStatus?: (status: MapResourceStatus) => void | Promise<void>;
    onFailure?: (error: string) => void;
    now?: () => Date;
    setTimer?: (callback: () => void, delayMs: number) => unknown;
    clearTimer?: (timer: unknown) => void;
    rebuildDelayMs?: number;
  }) {
    this.#loadBindings = loadBindings;
    this.#onSnapshot = onSnapshot;
    this.#onStatus = onStatus;
    this.#onFailure = onFailure;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#rebuildDelayMs = positiveInteger(rebuildDelayMs, "Relay map resource rebuild delay");
  }

  async start(config: RegionSessionConfig): Promise<void> {
    if (this.#connection || this.#config) throw new Error("Relay map resource region session is already started");
    assertSchemaFingerprint(config.manifest, "regional", config.schemaFingerprint);
    if (!schemaBindingsReady(config.manifest, "regional")) throw new Error("Relay regional schema bindings are not generated");
    this.#config = {
      ...config,
      regionId: decimal(config.regionId, "Relay map resource region id"),
      generation: positiveInteger(config.generation, "Relay map resource generation"),
      maxNodes: positiveInteger(config.maxNodes ?? DEFAULT_MAX_NODES, "Relay map resource node budget"),
    };
    this.#stopping = false;
    this.#startedAt = this.#now();
    this.#health.stage = "connecting";
    let cancelled = false;
    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    void cancellation.catch(() => {});
    const abort = () => {
      if (cancelled) return;
      cancelled = true;
      this.#connection = null;
      this.#pendingConnection?.disconnect();
      this.#pendingConnection = null;
      this.#config = null;
      this.#startedAt = null;
      this.#health.connected = false;
      rejectCancellation(new Error("Relay map resource region session stopped while connecting"));
    };
    this.#abortStart = abort;
    try {
      const bindings = await Promise.race([this.#loadBindings(), cancellation]);
      await Promise.race([new Promise<void>((resolve, reject) => {
        let settled = false;
        let failed = false;
        let builtConnection: BindingConnection | null = null;
        const fail = (error: Error) => {
          if (settled || cancelled) return;
          settled = true;
          failed = true;
          this.#connection = null;
          this.#pendingConnection = null;
          this.#config = null;
          this.#startedAt = null;
          this.#health.connected = false;
          this.#recordError(error);
          builtConnection?.disconnect();
          reject(error);
        };
        try {
          builtConnection = bindings.DbConnection.builder()
            .withUri(config.uri)
            .withDatabaseName(config.database)
            .onConnect((connection) => {
              if (settled || cancelled) return;
              settled = true;
              this.#connection = connection;
              this.#pendingConnection = null;
              this.#health.connected = true;
              this.#health.stage = "subscribed";
              resolve();
            })
            .onConnectError((_context, error) => fail(error))
            .onDisconnect((_context, error) => {
              this.#health.connected = false;
              const disconnectError = error ?? new Error("Relay map resource subscription disconnected.");
              if (!settled && !cancelled) fail(disconnectError);
              else if (settled && !this.#stopping) this.#recordError(disconnectError);
          })
          .build();
        if (failed) builtConnection.disconnect();
        else if (!settled && !cancelled) this.#pendingConnection = builtConnection;
        else if (cancelled) builtConnection.disconnect();
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      }), cancellation]);
    } finally {
      if (this.#abortStart === abort) this.#abortStart = null;
    }
  }

  async subscribe(rawResourceId: string, generation: number): Promise<void> {
    this.#requiredConfig();
    const connection = this.#connection;
    if (!connection) throw new Error("Relay map resource region session is not connected");
    const resourceId = decimal(rawResourceId, "Relay map resource id");
    const nextGeneration = positiveInteger(generation, "Relay map resource generation");
    const existing = this.#subscriptions.get(resourceId);
    if (existing) return;
    if (this.#subscriptions.size >= MAX_RESOURCE_IDS) throw new Error(`Relay map resource request cap ${MAX_RESOURCE_IDS} exceeded`);
    let subscription: ResourceSubscription;
    const handle = connection.subscriptionBuilder()
      .onApplied(() => {
        if (this.#subscriptions.get(resourceId) !== subscription) return;
        subscription.applied = true;
        this.#refreshAppliedResourceIds();
        this.#attachListeners(connection);
        this.#applyGeneration(connection, [subscription]);
      })
      .onError((_context, error) => this.#recordError(error))
      .subscribe(mapResourceQueries(resourceId));
    subscription = { resourceId, generation: nextGeneration, handle, applied: false };
    this.#subscriptions.set(resourceId, subscription);
    this.#health.stage = "subscribed";
  }

  unsubscribe(rawResourceId: string): void {
    const resourceId = decimal(rawResourceId, "Relay map resource id");
    const subscription = this.#subscriptions.get(resourceId);
    if (!subscription) return;
    subscription.handle.unsubscribe();
    this.#subscriptions.delete(resourceId);
    delete this.#health.rowsPerType[resourceId];
    this.#health.rowCount = Object.values(this.#health.rowsPerType).reduce(
      (total, counts) => total + counts.resourceState + counts.locationState,
      0,
    );
    this.#refreshAppliedResourceIds();
  }

  #attachListeners(connection: BindingConnection): void {
    if (this.#listenersAttached) return;
    for (const table of [connection.db.resourceState, connection.db.locationState]) {
      table.onInsert?.(this.#changed);
      table.onUpdate?.(this.#changed);
      table.onDelete?.(this.#changed);
    }
    this.#listenersAttached = true;
  }

  #removeListeners(connection = this.#connection): void {
    if (!connection || !this.#listenersAttached) return;
    for (const table of [connection.db.resourceState, connection.db.locationState]) {
      table.removeOnInsert?.(this.#changed);
      table.removeOnUpdate?.(this.#changed);
      table.removeOnDelete?.(this.#changed);
    }
    this.#listenersAttached = false;
  }

  #queueRebuild(): void {
    if (!this.#connection || this.#rebuildTimer !== null) return;
    this.#rebuildTimer = this.#setTimer(() => {
      this.#rebuildTimer = null;
      const connection = this.#connection;
      if (!connection) return;
      this.#applyGeneration(connection);
    }, this.#rebuildDelayMs);
  }

  #applyGeneration(
    connection: BindingConnection,
    selectedSubscriptions = [...this.#subscriptions.values()].filter((subscription) => subscription.applied),
  ): void {
    const config = this.#config;
    const subscriptions = selectedSubscriptions.filter((subscription) => (
      subscription.applied && this.#subscriptions.get(subscription.resourceId) === subscription
    ));
    if (!config || this.#connection !== connection || !subscriptions.length) return;
    try {
      const resourceRows = tableRows(connection.db.resourceState);
      const locationRows = tableRows(connection.db.locationState);
      const receivedAt = this.#now().toISOString();
      const normalized = normalizeMapResourceRegionGeneration({
        regionId: config.regionId,
        resourceIds: subscriptions.map((subscription) => subscription.resourceId),
        resourceRows,
        locationRows,
        observedAt: receivedAt,
      });
      const pending: Promise<void>[] = [];
      const incompleteWarnings: string[] = [];
      const hardErrors: string[] = [];
      let publishedSnapshot = false;
      for (const subscription of subscriptions) {
        const result = normalized.get(subscription.resourceId);
        if (!result) continue;
        this.#health.rowsPerType[subscription.resourceId] = { ...result.rowCounts };
        if (!result.complete) {
          const warning = result.warnings.join(" ") || "Relay map resource generation is incomplete";
          incompleteWarnings.push(warning);
          pending.push(Promise.resolve(this.#onStatus({
            regionId: config.regionId,
            resourceId: subscription.resourceId,
            warning,
            receivedAt,
          })));
          continue;
        }
        if (result.resources.length > config.maxNodes) {
          const message = `Relay map resource node budget ${config.maxNodes} exceeded by ${result.resources.length} nodes`;
          hardErrors.push(message);
          this.#onFailure(message);
          continue;
        }
        publishedSnapshot = true;
        const snapshot: MapResourceSnapshot = {
          data: { regionId: config.regionId, resourceId: subscription.resourceId, resources: result.resources },
          warnings: result.warnings,
          database: config.database,
          regionId: config.regionId,
          resourceId: subscription.resourceId,
          schemaFingerprint: config.schemaFingerprint,
          generation: subscription.generation++,
          receivedAt,
        };
        pending.push(Promise.resolve(this.#onSnapshot(snapshot)));
      }
      this.#health.rowCount = Object.values(this.#health.rowsPerType).reduce(
        (total, counts) => total + counts.resourceState + counts.locationState,
        0,
      );
      this.#health.stage = hardErrors.length ? "error" : incompleteWarnings.length ? "partial" : "applied";
      this.#health.lastError = [...hardErrors, ...incompleteWarnings].join(" ") || null;
      void Promise.all(pending).then(() => {
        if (publishedSnapshot) this.#health.applied = true;
        this.#health.stage = hardErrors.length ? "error" : incompleteWarnings.length ? "partial" : "applied";
        this.#refreshAppliedResourceIds();
        if (publishedSnapshot) this.#health.lastAppliedAt = receivedAt;
        this.#health.lastError = [...hardErrors, ...incompleteWarnings].join(" ") || null;
        if (publishedSnapshot && this.#health.firstGenerationLatencyMs === null && this.#startedAt) {
          this.#health.firstGenerationLatencyMs = Math.max(0, this.#now().getTime() - this.#startedAt.getTime());
        }
      }).catch((error) => this.#recordError(error));
    } catch (error) {
      this.#recordError(error);
    }
  }

  #refreshAppliedResourceIds(): void {
    this.#health.appliedResourceIds = [...this.#subscriptions.values()]
      .filter((subscription) => subscription.applied)
      .map((subscription) => subscription.resourceId)
      .sort((left, right) => left.length - right.length || left.localeCompare(right));
  }

  #recordError(error: unknown): void {
    this.#health.stage = "error";
    this.#health.lastError = error instanceof Error ? error.message : String(error);
    this.#onFailure(this.#health.lastError);
  }

  #requiredConfig() {
    if (!this.#config) throw new Error("Relay map resource region session is not configured");
    return this.#config;
  }

  health(): ResourceRegionHealth {
    return {
      ...this.#health,
      appliedResourceIds: [...this.#health.appliedResourceIds],
      rowsPerType: Object.fromEntries(Object.entries(this.#health.rowsPerType).map(([id, counts]) => [id, { ...counts }])),
    };
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#rebuildTimer !== null) this.#clearTimer(this.#rebuildTimer);
    this.#rebuildTimer = null;
    this.#removeListeners();
    for (const subscription of this.#subscriptions.values()) subscription.handle.unsubscribe();
    this.#subscriptions.clear();
    this.#abortStart?.();
    this.#connection?.disconnect();
    this.#connection = null;
    this.#pendingConnection = null;
    this.#abortStart = null;
    this.#config = null;
    this.#health.connected = false;
    this.#health.appliedResourceIds = [];
    this.#health.stage = "stopped";
  }
}
