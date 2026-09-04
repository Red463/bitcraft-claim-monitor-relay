import {
  mapResourceQueries,
  normalizeMapResourceRegionGeneration,
  type MapResourcePoint,
} from "./mapResourceProjection.ts";
import { MapResourceLiveIndex } from "./mapResourceLiveIndex.ts";
import { assertSchemaFingerprint, schemaBindingsReady } from "./schemaManifest.ts";

type BindingManifest = Parameters<typeof assertSchemaFingerprint>[0];
type CachedTable = {
  iter(): IterableIterator<unknown>;
  onInsert?(callback: (...args: unknown[]) => void): void;
  onUpdate?(callback: (...args: unknown[]) => void): void;
  onDelete?(callback: (...args: unknown[]) => void): void;
  removeOnInsert?(callback: (...args: unknown[]) => void): void;
  removeOnUpdate?(callback: (...args: unknown[]) => void): void;
  removeOnDelete?(callback: (...args: unknown[]) => void): void;
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
  withLightMode(lightMode: boolean): ConnectionBuilder;
  onConnect(callback: (connection: BindingConnection) => void): ConnectionBuilder;
  onConnectError(callback: (context: unknown, error: Error) => void): ConnectionBuilder;
  onDisconnect(callback: (context: unknown, error?: Error) => void): ConnectionBuilder;
  build(): BindingConnection;
};
export type RegionalBindingModule = { DbConnection: { builder(): ConnectionBuilder } };

const MAX_RESOURCE_IDS = 16;
const MAX_CONCURRENT_HYDRATIONS = 1;
const DEFAULT_REBUILD_DELAY_MS = 300;
const DEFAULT_SUBSCRIPTION_APPLY_TIMEOUT_MS = 60_000;

export type RegionSessionConfig = {
  uri: string;
  database: string;
  schemaFingerprint: string;
  manifest: BindingManifest;
  generation: number;
  regionId: string;
};

export type MapResourceSnapshot = {
  data: { regionId: string; resourceId: string; resources: MapResourcePoint[] };
  compactResources?: ReadonlyArray<readonly [string, string, string, number, number]>;
  warnings: string[];
  database: string;
  regionId: string;
  resourceId: string;
  schemaFingerprint: string;
  generation: number;
  receivedAt: string;
  packedCoordinates: Uint32Array;
};

export type MapResourceStatus = {
  regionId: string;
  resourceId: string;
  warning: string;
  receivedAt: string;
};

export type MapResourceProvisionalNotice = {
  regionId: string;
  resourceId: string;
  additions: Uint32Array;
  receivedAt: string;
};

export type MapResourceDeltaNotice = MapResourceProvisionalNotice & {
  removals: Uint32Array;
};

export type ResourceRegionHealth = {
  connected: boolean;
  applied: boolean;
  stage: "idle" | "connecting" | "subscribed" | "applied" | "partial" | "error" | "stopped";
  appliedResourceIds: string[];
  rowCount: number;
  rowsPerType: Record<string, { resourceState: number; locationState: number }>;
  firstGenerationLatencyMs: number | null;
  normalizationDurationMs: number | null;
  lastAppliedAt: string | null;
  lastError: string | null;
};

type ResourceSubscription = {
  resourceId: string;
  generation: number;
  handle: SubscriptionHandle | null;
  applyTimer: unknown | null;
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
  readonly #onProvisional: (notice: MapResourceProvisionalNotice) => void | Promise<void>;
  readonly #onDelta: (notice: MapResourceDeltaNotice) => void | Promise<void>;
  readonly #onFailure: (error: string) => void;
  readonly #onResourceFailure: (resourceId: string, error: string) => void;
  readonly #now: () => Date;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (timer: unknown) => void;
  readonly #rebuildDelayMs: number;
  readonly #subscriptionApplyTimeoutMs: number;
  #connection: BindingConnection | null = null;
  #pendingConnection: BindingConnection | null = null;
  #abortStart: (() => void) | null = null;
  #config: (Omit<RegionSessionConfig, "regionId" | "generation"> & { regionId: string; generation: number }) | null = null;
  #subscriptions = new Map<string, ResourceSubscription>();
  #index: MapResourceLiveIndex | null = null;
  #dirtyResourceIds = new Set<string>();
  #needsReseed = false;
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
    normalizationDurationMs: null,
    lastAppliedAt: null,
    lastError: null,
  };

  readonly #resourceInserted = (...args: unknown[]) => this.#handleResourceInsert(args);
  readonly #resourceUpdated = (...args: unknown[]) => this.#handleResourceUpdate(args);
  readonly #resourceDeleted = (...args: unknown[]) => this.#handleResourceDelete(args);
  readonly #locationInserted = (...args: unknown[]) => this.#handleLocationInsert(args);
  readonly #locationUpdated = (...args: unknown[]) => this.#handleLocationUpdate(args);
  readonly #locationDeleted = (...args: unknown[]) => this.#handleLocationDelete(args);

  constructor({
    loadBindings = loadBundledRegionalBindings,
    onSnapshot,
    onStatus = () => {},
    onProvisional = () => {},
    onDelta = () => {},
    onFailure = () => {},
    onResourceFailure = () => {},
    now = () => new Date(),
    setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    rebuildDelayMs = DEFAULT_REBUILD_DELAY_MS,
    subscriptionApplyTimeoutMs = DEFAULT_SUBSCRIPTION_APPLY_TIMEOUT_MS,
  }: {
    loadBindings?: () => Promise<RegionalBindingModule>;
    onSnapshot: (snapshot: MapResourceSnapshot) => void | Promise<void>;
    onStatus?: (status: MapResourceStatus) => void | Promise<void>;
    onProvisional?: (notice: MapResourceProvisionalNotice) => void | Promise<void>;
    onDelta?: (notice: MapResourceDeltaNotice) => void | Promise<void>;
    onFailure?: (error: string) => void;
    onResourceFailure?: (resourceId: string, error: string) => void;
    now?: () => Date;
    setTimer?: (callback: () => void, delayMs: number) => unknown;
    clearTimer?: (timer: unknown) => void;
    rebuildDelayMs?: number;
    subscriptionApplyTimeoutMs?: number;
  }) {
    this.#loadBindings = loadBindings;
    this.#onSnapshot = onSnapshot;
    this.#onStatus = onStatus;
    this.#onProvisional = onProvisional;
    this.#onDelta = onDelta;
    this.#onFailure = onFailure;
    this.#onResourceFailure = onResourceFailure;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
    this.#rebuildDelayMs = positiveInteger(rebuildDelayMs, "Relay map resource rebuild delay");
    this.#subscriptionApplyTimeoutMs = positiveInteger(subscriptionApplyTimeoutMs, "Relay map resource subscription apply timeout");
  }

  async start(config: RegionSessionConfig): Promise<void> {
    if (this.#connection || this.#config) throw new Error("Relay map resource region session is already started");
    assertSchemaFingerprint(config.manifest, "regional", config.schemaFingerprint);
    if (!schemaBindingsReady(config.manifest, "regional")) throw new Error("Relay regional schema bindings are not generated");
    this.#config = {
      ...config,
      regionId: decimal(config.regionId, "Relay map resource region id"),
      generation: positiveInteger(config.generation, "Relay map resource generation"),
    };
    this.#index = new MapResourceLiveIndex(this.#config.regionId);
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
            .withLightMode(true)
            .onConnect((connection) => {
              if (settled || cancelled) return;
              settled = true;
              this.#connection = connection;
              this.#pendingConnection = null;
              this.#health.connected = true;
              this.#health.stage = "subscribed";
              this.#attachListeners(connection);
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
    const subscription: ResourceSubscription = {
      resourceId,
      generation: nextGeneration,
      handle: null,
      applyTimer: null,
      applied: false,
    };
    this.#subscriptions.set(resourceId, subscription);
    this.#index?.select(resourceId);
    this.#startQueuedSubscriptions(connection);
    this.#health.stage = "subscribed";
  }

  #startQueuedSubscriptions(connection: BindingConnection): void {
    let hydrating = [...this.#subscriptions.values()].filter((subscription) => subscription.handle && !subscription.applied).length;
    for (const subscription of this.#subscriptions.values()) {
      if (hydrating >= MAX_CONCURRENT_HYDRATIONS) return;
      if (subscription.handle || subscription.applied) continue;
      this.#startSubscription(connection, subscription);
      hydrating += 1;
    }
  }

  #startSubscription(connection: BindingConnection, subscription: ResourceSubscription): void {
    const { resourceId } = subscription;
    subscription.applyTimer = this.#setTimer(() => {
      if (this.#subscriptions.get(resourceId) !== subscription || subscription.applied) return;
      subscription.applyTimer = null;
      subscription.handle?.unsubscribe();
      subscription.handle = null;
      this.#subscriptions.delete(resourceId);
      this.#index?.unselect(resourceId);
      this.#dirtyResourceIds.delete(resourceId);
      delete this.#health.rowsPerType[resourceId];
      this.#refreshAppliedResourceIds();
      this.#recordResourceError(resourceId, new Error(
        `Relay map resource ${resourceId} subscription did not apply within ${this.#subscriptionApplyTimeoutMs}ms`,
      ));
      this.#startQueuedSubscriptions(connection);
    }, this.#subscriptionApplyTimeoutMs);
    try {
      subscription.handle = connection.subscriptionBuilder()
      .onApplied(() => {
        if (this.#subscriptions.get(resourceId) !== subscription) return;
        if (subscription.applyTimer !== null) this.#clearTimer(subscription.applyTimer);
        subscription.applyTimer = null;
        subscription.applied = true;
        this.#refreshAppliedResourceIds();
        this.#needsReseed = true;
        this.#queueRebuild([resourceId]);
        this.#startQueuedSubscriptions(connection);
      })
      .onError((_context, error) => {
        if (this.#subscriptions.get(resourceId) !== subscription) return;
        if (subscription.applyTimer !== null) this.#clearTimer(subscription.applyTimer);
        subscription.applyTimer = null;
        subscription.handle?.unsubscribe();
        subscription.handle = null;
        this.#subscriptions.delete(resourceId);
        this.#index?.unselect(resourceId);
        this.#dirtyResourceIds.delete(resourceId);
        delete this.#health.rowsPerType[resourceId];
        this.#refreshAppliedResourceIds();
        this.#recordResourceError(resourceId, error);
        this.#startQueuedSubscriptions(connection);
      })
      .subscribe(mapResourceQueries(resourceId));
    } catch (error) {
      if (subscription.applyTimer !== null) this.#clearTimer(subscription.applyTimer);
      this.#subscriptions.delete(resourceId);
      this.#index?.unselect(resourceId);
      throw error;
    }
  }

  unsubscribe(rawResourceId: string): void {
    const resourceId = decimal(rawResourceId, "Relay map resource id");
    const subscription = this.#subscriptions.get(resourceId);
    if (!subscription) return;
    if (subscription.applyTimer !== null) this.#clearTimer(subscription.applyTimer);
    subscription.applyTimer = null;
    subscription.handle?.unsubscribe();
    this.#subscriptions.delete(resourceId);
    this.#index?.unselect(resourceId);
    this.#dirtyResourceIds.delete(resourceId);
    delete this.#health.rowsPerType[resourceId];
    this.#health.rowCount = Object.values(this.#health.rowsPerType).reduce(
      (total, counts) => total + counts.resourceState + counts.locationState,
      0,
    );
    this.#refreshAppliedResourceIds();
    if (this.#connection) this.#startQueuedSubscriptions(this.#connection);
  }

  #attachListeners(connection: BindingConnection): void {
    if (this.#listenersAttached) return;
    connection.db.resourceState.onInsert?.(this.#resourceInserted);
    connection.db.resourceState.onUpdate?.(this.#resourceUpdated);
    connection.db.resourceState.onDelete?.(this.#resourceDeleted);
    connection.db.locationState.onInsert?.(this.#locationInserted);
    connection.db.locationState.onUpdate?.(this.#locationUpdated);
    connection.db.locationState.onDelete?.(this.#locationDeleted);
    this.#listenersAttached = true;
  }

  #removeListeners(connection = this.#connection): void {
    if (!connection || !this.#listenersAttached) return;
    connection.db.resourceState.removeOnInsert?.(this.#resourceInserted);
    connection.db.resourceState.removeOnUpdate?.(this.#resourceUpdated);
    connection.db.resourceState.removeOnDelete?.(this.#resourceDeleted);
    connection.db.locationState.removeOnInsert?.(this.#locationInserted);
    connection.db.locationState.removeOnUpdate?.(this.#locationUpdated);
    connection.db.locationState.removeOnDelete?.(this.#locationDeleted);
    this.#listenersAttached = false;
  }

  #queueRebuild(resourceIds: Iterable<string> = []): void {
    for (const resourceId of resourceIds) this.#dirtyResourceIds.add(resourceId);
    if (!this.#connection || this.#rebuildTimer !== null) return;
    this.#rebuildTimer = this.#setTimer(() => {
      this.#rebuildTimer = null;
      const connection = this.#connection;
      if (!connection) return;
      const dirtyResourceIds = [...this.#dirtyResourceIds];
      this.#dirtyResourceIds.clear();
      const reseed = this.#needsReseed;
      this.#needsReseed = false;
      this.#publishChanges(connection, dirtyResourceIds, reseed);
    }, this.#rebuildDelayMs);
  }

  #fallbackChanged(): void {
    this.#needsReseed = true;
    this.#queueRebuild(this.#subscriptions.keys());
  }

  #handleResourceInsert(args: unknown[]): void {
    const row = args.at(-1);
    if (!row || typeof row !== "object") return this.#fallbackChanged();
    try {
      this.#index?.upsertResource(row);
      this.#queueRebuild(this.#index?.dirtyResourceIds());
    } catch (error) {
      this.#recordError(error);
    }
  }

  #handleResourceUpdate(args: unknown[]): void {
    const previous = args.at(-2);
    const next = args.at(-1);
    if (!previous || typeof previous !== "object" || !next || typeof next !== "object") return this.#fallbackChanged();
    try {
      this.#index?.deleteResource(previous);
      this.#index?.upsertResource(next);
      this.#queueRebuild(this.#index?.dirtyResourceIds());
    } catch (error) {
      this.#recordError(error);
    }
  }

  #handleResourceDelete(args: unknown[]): void {
    const row = args.at(-1);
    if (!row || typeof row !== "object") return this.#fallbackChanged();
    try {
      this.#index?.deleteResource(row);
      this.#queueRebuild(this.#index?.dirtyResourceIds());
    } catch (error) {
      this.#recordError(error);
    }
  }

  #handleLocationInsert(args: unknown[]): void {
    const row = args.at(-1);
    if (!row || typeof row !== "object") return this.#fallbackChanged();
    try {
      this.#index?.upsertLocation(row);
      this.#queueRebuild(this.#index?.dirtyResourceIds());
    } catch (error) {
      this.#recordError(error);
    }
  }

  #handleLocationUpdate(args: unknown[]): void {
    const previous = args.at(-2);
    const next = args.at(-1);
    if (!previous || typeof previous !== "object" || !next || typeof next !== "object") return this.#fallbackChanged();
    try {
      this.#index?.deleteLocation(previous);
      this.#index?.upsertLocation(next);
      this.#queueRebuild(this.#index?.dirtyResourceIds());
    } catch (error) {
      this.#recordError(error);
    }
  }

  #handleLocationDelete(args: unknown[]): void {
    const row = args.at(-1);
    if (!row || typeof row !== "object") return this.#fallbackChanged();
    try {
      this.#index?.deleteLocation(row);
      this.#queueRebuild(this.#index?.dirtyResourceIds());
    } catch (error) {
      this.#recordError(error);
    }
  }

  #publishChanges(connection: BindingConnection, resourceIds: string[], reseed: boolean): void {
    if (reseed) {
      this.#applyGeneration(
        connection,
        resourceIds.map((resourceId) => this.#subscriptions.get(resourceId)).filter((value): value is ResourceSubscription => Boolean(value?.applied)),
        true,
      );
      return;
    }
    const receivedAt = this.#now().toISOString();
    const notices: Promise<void>[] = [];
    for (const resourceId of resourceIds) {
      const subscription = this.#subscriptions.get(resourceId);
      if (!subscription) continue;
      const delta = this.#index?.drain(resourceId) ?? {
        resourceId,
        additions: new Uint32Array(),
        removals: new Uint32Array(),
      };
      if (delta.additions.length === 0 && delta.removals.length === 0) continue;
      if (!subscription.applied) {
        if (delta.additions.length > 0) {
          notices.push(Promise.resolve(this.#onProvisional({
            regionId: this.#requiredConfig().regionId,
            resourceId,
            additions: delta.additions,
            receivedAt,
          })));
        }
        continue;
      }
      notices.push(Promise.resolve(this.#onDelta({
        regionId: this.#requiredConfig().regionId,
        resourceId,
        additions: delta.additions,
        removals: delta.removals,
        receivedAt,
      })));
    }
    void Promise.all(notices).catch((error) => this.#recordError(error));
  }

  #applyGeneration(
    connection: BindingConnection,
    selectedSubscriptions = [...this.#subscriptions.values()].filter((subscription) => subscription.applied),
    reseedIndex = false,
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
      const normalizationStartedAt = performance.now();
      const normalized = normalizeMapResourceRegionGeneration({
        regionId: config.regionId,
        resourceIds: subscriptions.map((subscription) => subscription.resourceId),
        resourceRows,
        locationRows,
        observedAt: receivedAt,
      });
      const seeded = reseedIndex
        ? this.#index?.seed([...this.#subscriptions.keys()], resourceRows, locationRows)
        : null;
      this.#health.normalizationDurationMs = Math.max(0, performance.now() - normalizationStartedAt);
      const pending: Promise<void>[] = [];
      const incompleteWarnings: string[] = [];
      let publishedSnapshot = false;
      for (const subscription of subscriptions) {
        const result = normalized.get(subscription.resourceId);
        if (!result) continue;
        this.#health.rowsPerType[subscription.resourceId] = { ...result.rowCounts };
        const packedCoordinates = seeded?.get(subscription.resourceId)?.coordinates
          ?? this.#index?.coordinates(subscription.resourceId)
          ?? new Uint32Array();
        if (!result.complete || seeded?.get(subscription.resourceId)?.complete === false) {
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
          packedCoordinates,
        };
        pending.push(Promise.resolve(this.#onSnapshot(snapshot)));
      }
      this.#health.rowCount = Object.values(this.#health.rowsPerType).reduce(
        (total, counts) => total + counts.resourceState + counts.locationState,
        0,
      );
      this.#health.stage = incompleteWarnings.length ? "partial" : "applied";
      this.#health.lastError = incompleteWarnings.join(" ") || null;
      void Promise.all(pending).then(() => {
        if (publishedSnapshot) this.#health.applied = true;
        this.#health.stage = incompleteWarnings.length ? "partial" : "applied";
        this.#refreshAppliedResourceIds();
        if (publishedSnapshot) this.#health.lastAppliedAt = receivedAt;
        this.#health.lastError = incompleteWarnings.join(" ") || null;
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

  #recordResourceError(resourceId: string, error: unknown): void {
    this.#health.stage = this.#health.appliedResourceIds.length ? "partial" : "error";
    this.#health.lastError = error instanceof Error ? error.message : String(error);
    this.#onResourceFailure(resourceId, this.#health.lastError);
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
    for (const subscription of this.#subscriptions.values()) {
      if (subscription.applyTimer !== null) this.#clearTimer(subscription.applyTimer);
      subscription.applyTimer = null;
      subscription.handle?.unsubscribe();
    }
    this.#subscriptions.clear();
    this.#dirtyResourceIds.clear();
    this.#needsReseed = false;
    this.#abortStart?.();
    this.#connection?.disconnect();
    this.#connection = null;
    this.#pendingConnection = null;
    this.#abortStart = null;
    this.#config = null;
    this.#index = null;
    this.#health.connected = false;
    this.#health.appliedResourceIds = [];
    this.#health.stage = "stopped";
  }
}
