import {
  normalizeRegionalBankInventories,
  normalizeRegionalConstruction,
  normalizeRegionalEquipment,
  normalizeRegionalPlayers,
  normalizeRegionalRecruitment,
  normalizeRegionalResearch,
} from "./normalizers.ts";
import {
  assertSchemaFingerprint,
  schemaBindingsReady,
} from "./schemaManifest.ts";
import type { DomainEvent } from "./contracts.ts";
import { equalitySubscriptionQueries } from "./publicCraftRegionSession.ts";

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

type SubscriptionHandle = {
  unsubscribe(): void;
};

type SubscriptionBuilder = {
  onApplied(callback: (context: unknown) => void): SubscriptionBuilder;
  onError(callback: (context: unknown, error: Error) => void): SubscriptionBuilder;
  subscribe(queries: readonly string[] | string[]): SubscriptionHandle;
};

type BindingConnection = {
  db: {
    playerState: CachedTable;
    equipmentState: CachedTable;
    equipmentPresetState: CachedTable;
    activeBuffState: CachedTable;
    projectSiteState: CachedTable;
    buildingState: CachedTable;
    claimTechState: CachedTable;
    claimRecruitmentState: CachedTable;
    travelerTaskState: CachedTable;
    travelerTaskDesc: CachedTable;
    bankState: CachedTable;
    inventoryState: CachedTable;
    progressiveActionState: CachedTable;
  };
  subscriptionBuilder(): SubscriptionBuilder;
  disconnect(): void;
};

type ConnectionBuilder = {
  withUri(uri: string): ConnectionBuilder;
  withDatabaseName(database: string): ConnectionBuilder;
  onConnect(callback: (connection: BindingConnection, identity: unknown, token: string) => void): ConnectionBuilder;
  onConnectError(callback: (context: unknown, error: Error) => void): ConnectionBuilder;
  onDisconnect(callback: (context: unknown, error?: Error) => void): ConnectionBuilder;
  build(): BindingConnection;
};

type RegionalBindingModule = {
  DbConnection: {
    builder(): ConnectionBuilder;
  };
};

type Member = {
  playerEntityId?: unknown;
  player_entity_id?: unknown;
  userName?: unknown;
  user_name?: unknown;
  [key: string]: unknown;
};

export type CraftContributionTarget = {
  craftEntityId: string;
  profession: string | null;
  craftLabel: string;
  structureName: string;
  itemTier: string | null;
  xpPerProgress: string;
};

type SessionConfig = {
  uri: string;
  database: string;
  schemaFingerprint: string;
  manifest: BindingManifest;
  generation: number;
  regionId: string;
  claimId: string;
  members: Member[];
  contributionTargets?: CraftContributionTarget[];
  contributionWarnings?: string[];
};

type SessionDependencies = {
  loadBindings?: () => Promise<RegionalBindingModule>;
  onSnapshot: (snapshot: RegionalPlayerSnapshot) => void | Promise<void>;
  onContribution?: (event: DomainEvent) => void | Promise<void>;
  now?: () => Date;
};

export type RegionalPlayerSnapshot = {
  players: ReturnType<typeof normalizeRegionalPlayers>["data"];
  warnings: string[];
  equipment: ReturnType<typeof normalizeRegionalEquipment>["data"];
  equipmentWarnings: string[];
  construction: ReturnType<typeof normalizeRegionalConstruction>["data"];
  constructionWarnings: string[];
  research: ReturnType<typeof normalizeRegionalResearch>["data"];
  researchWarnings: string[];
  recruitment: ReturnType<typeof normalizeRegionalRecruitment>["data"];
  recruitmentWarnings: string[];
  bankInventories: ReturnType<typeof normalizeRegionalBankInventories>["data"];
  bankInventoryWarnings: string[];
  contributionWarnings?: string[];
  database: string;
  regionId: string;
  schemaFingerprint: string;
  generation: number;
  receivedAt: string;
};

async function loadBundledRegionalBindings(): Promise<RegionalBindingModule> {
  const moduleUrl = new URL("./bindings/regional.js", import.meta.url).href;
  return await import(moduleUrl) as unknown as RegionalBindingModule;
}

function memberEntityId(member: Member, index: number): string {
  const value = member.playerEntityId ?? member.player_entity_id;
  const id = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^\d+$/.test(id)) {
    throw new TypeError(`regional member ${index} has an invalid player entity id`);
  }
  return id;
}

function decimalInteger(value: unknown, label: string): string {
  const id = typeof value === "bigint" ? value.toString() : String(value ?? "").trim();
  if (!/^\d+$/.test(id)) throw new TypeError(`${label} must be a decimal integer`);
  return id;
}

function contributionQueries(targets: CraftContributionTarget[]): string[] {
  return equalitySubscriptionQueries(
    "progressive_action_state",
    "entity_id",
    targets.map((target, index) => (
      decimalInteger(target.craftEntityId, `regional contribution target ${index}`)
    )),
  );
}

export function playerStateQueries(members: Member[]): string[] {
  const ids = [...new Set(members.map(memberEntityId))];
  const where = (column: string) => ids.map((id) => `${column} = ${id}`).join(" OR ");
  return [
    `SELECT * FROM player_state WHERE ${where("entity_id")}`,
    `SELECT * FROM equipment_state WHERE ${where("entity_id")}`,
    `SELECT * FROM equipment_preset_state WHERE ${where("player_entity_id")}`,
    `SELECT * FROM active_buff_state WHERE ${where("entity_id")}`,
  ];
}

function travelerTaskQuery(members: Member[]): string {
  const ids = [...new Set(members.map(memberEntityId))];
  return `SELECT * FROM traveler_task_state WHERE ${ids.map((id) => `player_entity_id = ${id}`).join(" OR ")}`;
}

function constructionQuery(claimIdValue: string): string {
  const claimId = String(claimIdValue ?? "").trim();
  if (!/^\d+$/.test(claimId)) {
    throw new TypeError("regional construction claim id is invalid");
  }
  return `SELECT * FROM project_site_state WHERE owner_id = ${claimId}`;
}

function buildingQuery(claimIdValue: string): string {
  const claimId = String(claimIdValue ?? "").trim();
  if (!/^\d+$/.test(claimId)) {
    throw new TypeError("regional building claim id is invalid");
  }
  return `SELECT * FROM building_state WHERE claim_entity_id = ${claimId}`;
}

function researchQuery(claimIdValue: string): string {
  const claimId = String(claimIdValue ?? "").trim();
  if (!/^\d+$/.test(claimId)) {
    throw new TypeError("regional research claim id is invalid");
  }
  return `SELECT * FROM claim_tech_state WHERE entity_id = ${claimId}`;
}

function recruitmentQuery(claimIdValue: string): string {
  const claimId = String(claimIdValue ?? "").trim();
  if (!/^\d+$/.test(claimId)) {
    throw new TypeError("regional recruitment claim id is invalid");
  }
  return `SELECT * FROM claim_recruitment_state WHERE claim_entity_id = ${claimId}`;
}

function bankQuery(claimIdValue: string): string {
  const claimId = String(claimIdValue ?? "").trim();
  if (!/^\d+$/.test(claimId)) {
    throw new TypeError("regional Town Bank claim id is invalid");
  }
  return `SELECT * FROM bank_state WHERE claim_entity_id = ${claimId}`;
}

export class RelayPrimaryRegionPlayerSession {
  readonly #loadBindings: () => Promise<RegionalBindingModule>;
  readonly #onSnapshot: SessionDependencies["onSnapshot"];
  readonly #onContribution: SessionDependencies["onContribution"];
  readonly #now: () => Date;
  #connection: BindingConnection | null = null;
  #baseSubscription: SubscriptionHandle | null = null;
  #contributionSubscription: SubscriptionHandle | null = null;
  #bankInventorySubscriptions: SubscriptionHandle[] = [];
  #config: SessionConfig | null = null;
  #nextGeneration = 0;
  #snapshotQueued = false;
  #applyInFlight = false;
  #applyPending = false;
  #listenersAttached = false;
  #bankRefreshEpoch = 0;
  #bankRefreshQueued = false;
  #refreshingBankInventories = false;
  readonly #tableChanged = () => this.#queueSnapshot();
  readonly #bankChanged = () => this.#queueBankInventoryRefresh();
  readonly #contributionChanged = (...args: unknown[]) => this.#handleContributionUpdate(args);
  #health = {
    connected: false,
    applied: false,
    lastAppliedAt: null as string | null,
    lastError: null as string | null,
  };

  constructor(dependencies: SessionDependencies) {
    this.#loadBindings = dependencies.loadBindings ?? loadBundledRegionalBindings;
    this.#onSnapshot = dependencies.onSnapshot;
    this.#onContribution = dependencies.onContribution;
    this.#now = dependencies.now ?? (() => new Date());
  }

  async start(config: SessionConfig): Promise<void> {
    if (this.#connection) throw new Error("Relay primary-region player session is already started");
    assertSchemaFingerprint(config.manifest, "regional", config.schemaFingerprint);
    if (!schemaBindingsReady(config.manifest, "regional")) {
      throw new Error("Relay regional schema bindings are not generated");
    }
    if (!Number.isSafeInteger(config.generation) || config.generation <= 0) {
      throw new Error("Relay regional player generation must be a positive safe integer");
    }
    const queries = [
      ...playerStateQueries(config.members),
      constructionQuery(config.claimId),
      buildingQuery(config.claimId),
      researchQuery(config.claimId),
      recruitmentQuery(config.claimId),
      travelerTaskQuery(config.members),
      "SELECT * FROM traveler_task_desc",
      bankQuery(config.claimId),
    ];
    if (queries.length === 0) {
      throw new Error("Relay regional player session requires at least one claim member");
    }
    this.#config = config;
    this.#nextGeneration = config.generation;
    const bindings = await this.#loadBindings();
    this.#connection = bindings.DbConnection.builder()
      .withUri(config.uri)
      .withDatabaseName(config.database)
      .onConnect((connection) => {
        this.#health.connected = true;
        this.#health.lastError = null;
        this.#baseSubscription = connection.subscriptionBuilder()
          .onApplied(() => {
            this.#attachTableListeners(connection);
            this.#beginBankInventoryRefresh(connection);
          })
          .onError((_context, error) => this.#recordError(error))
          .subscribe(queries);
        this.#replaceContributionSubscription(connection);
      })
      .onConnectError((_context, error) => this.#recordError(error))
      .onDisconnect((_context, error) => {
        this.#health.connected = false;
        if (error) this.#recordError(error);
      })
      .build();
  }

  updateContributionScope(
    targets: CraftContributionTarget[],
    warnings: string[] = [],
  ): void {
    if (!this.#config) {
      throw new Error("Relay primary-region player session is not started");
    }
    this.#config = {
      ...this.#config,
      contributionTargets: [...targets],
      contributionWarnings: [...warnings],
    };
    if (this.#connection) {
      this.#replaceContributionSubscription(this.#connection);
      this.#queueSnapshot();
    }
  }

  #replaceContributionSubscription(connection: BindingConnection): void {
    this.#contributionSubscription?.unsubscribe();
    this.#contributionSubscription = null;
    const queries = contributionQueries(this.#config?.contributionTargets ?? []);
    if (!queries.length) return;
    this.#contributionSubscription = connection.subscriptionBuilder()
      .onApplied(() => this.#queueSnapshot())
      .onError((_context, error) => this.#recordError(error))
      .subscribe(queries);
  }

  #applySnapshot(connection: BindingConnection): void {
    const config = this.#config;
    if (!config || this.#refreshingBankInventories) return;
    if (this.#applyInFlight) {
      this.#applyPending = true;
      return;
    }
    try {
      const receivedAt = this.#now().toISOString();
      const normalized = normalizeRegionalPlayers({
        members: config.members,
        playerRows: [...connection.db.playerState.iter()],
        taskRows: [...connection.db.travelerTaskState.iter()],
        taskDescriptionRows: [...connection.db.travelerTaskDesc.iter()],
        observedAt: receivedAt,
      });
      const equipment = normalizeRegionalEquipment({
        members: config.members,
        equipmentRows: [...connection.db.equipmentState.iter()],
        presetRows: [...connection.db.equipmentPresetState.iter()],
        buffRows: [...connection.db.activeBuffState.iter()],
      });
      const construction = normalizeRegionalConstruction({
        claimId: config.claimId,
        projectRows: [...connection.db.projectSiteState.iter()],
        buildingRows: [...connection.db.buildingState.iter()],
      });
      const research = normalizeRegionalResearch({
        claimId: config.claimId,
        stateRows: [...connection.db.claimTechState.iter()],
      });
      const recruitment = normalizeRegionalRecruitment({
        claimId: config.claimId,
        stateRows: [...connection.db.claimRecruitmentState.iter()],
      });
      const bankInventories = normalizeRegionalBankInventories({
        claimId: config.claimId,
        members: config.members,
        bankRows: [...connection.db.bankState.iter()],
        inventoryRows: [...connection.db.inventoryState.iter()],
      });
      const generation = this.#nextGeneration;
      this.#nextGeneration += 1;
      this.#applyInFlight = true;
      const result = this.#onSnapshot({
        players: normalized.data,
        warnings: normalized.warnings,
        equipment: equipment.data,
        equipmentWarnings: equipment.warnings,
        construction: construction.data,
        constructionWarnings: construction.warnings,
        research: research.data,
        researchWarnings: research.warnings,
        recruitment: recruitment.data,
        recruitmentWarnings: recruitment.warnings,
        bankInventories: bankInventories.data,
        bankInventoryWarnings: bankInventories.warnings,
        contributionWarnings: [...(config.contributionWarnings ?? [])],
        database: config.database,
        regionId: config.regionId,
        schemaFingerprint: config.schemaFingerprint,
        generation,
        receivedAt,
      });
      Promise.resolve(result).then(() => {
        this.#health.applied = true;
        this.#health.lastAppliedAt = receivedAt;
        this.#health.lastError = null;
      }).catch((error: unknown) => this.#recordError(error))
        .finally(() => this.#completeApply(connection));
    } catch (error) {
      this.#applyInFlight = false;
      this.#recordError(error);
      this.#completeApply(connection);
    }
  }

  #completeApply(connection: BindingConnection): void {
    this.#applyInFlight = false;
    if (!this.#applyPending) return;
    this.#applyPending = false;
    queueMicrotask(() => {
      if (this.#connection === connection) this.#applySnapshot(connection);
    });
  }

  #attachTableListeners(connection: BindingConnection): void {
    if (this.#listenersAttached) return;
    for (const table of this.#tables(connection)) {
      table.onInsert?.(this.#tableChanged);
      table.onUpdate?.(this.#tableChanged);
      table.onDelete?.(this.#tableChanged);
    }
    connection.db.bankState.onInsert?.(this.#bankChanged);
    connection.db.bankState.onUpdate?.(this.#bankChanged);
    connection.db.bankState.onDelete?.(this.#bankChanged);
    connection.db.inventoryState.onInsert?.(this.#tableChanged);
    connection.db.inventoryState.onUpdate?.(this.#tableChanged);
    connection.db.inventoryState.onDelete?.(this.#tableChanged);
    connection.db.progressiveActionState.onUpdate?.(this.#contributionChanged);
    this.#listenersAttached = true;
  }

  #removeTableListeners(): void {
    if (!this.#listenersAttached || !this.#connection) return;
    for (const table of this.#tables(this.#connection)) {
      table.removeOnInsert?.(this.#tableChanged);
      table.removeOnUpdate?.(this.#tableChanged);
      table.removeOnDelete?.(this.#tableChanged);
    }
    this.#connection.db.bankState.removeOnInsert?.(this.#bankChanged);
    this.#connection.db.bankState.removeOnUpdate?.(this.#bankChanged);
    this.#connection.db.bankState.removeOnDelete?.(this.#bankChanged);
    this.#connection.db.inventoryState.removeOnInsert?.(this.#tableChanged);
    this.#connection.db.inventoryState.removeOnUpdate?.(this.#tableChanged);
    this.#connection.db.inventoryState.removeOnDelete?.(this.#tableChanged);
    this.#connection.db.progressiveActionState.removeOnUpdate?.(this.#contributionChanged);
    this.#listenersAttached = false;
  }

  #handleContributionUpdate(args: unknown[]): void {
    if (!this.#onContribution || !this.#config) return;
    try {
      const [contextValue, previousValue, currentValue] = args;
      const context = contextValue && typeof contextValue === "object"
        ? contextValue as Record<string, unknown>
        : {};
      const event = context.event && typeof context.event === "object"
        ? context.event as Record<string, unknown>
        : {};
      if (event.tag !== "Transaction") return;
      const transactionId = String(event.id ?? "").trim();
      if (!transactionId) throw new TypeError("Relay craft contribution transaction id is required");
      const previous = previousValue && typeof previousValue === "object"
        ? previousValue as Record<string, unknown>
        : {};
      const current = currentValue && typeof currentValue === "object"
        ? currentValue as Record<string, unknown>
        : {};
      const craftId = decimalInteger(
        current.entityId ?? current.entity_id,
        "Relay craft contribution entity id",
      );
      const target = (this.#config.contributionTargets ?? []).find(
        (candidate) => candidate.craftEntityId === craftId,
      );
      if (!target) return;
      const previousProgress = decimalInteger(
        previous.progress,
        "Relay craft contribution previous progress",
      );
      const currentProgress = decimalInteger(
        current.progress,
        "Relay craft contribution current progress",
      );
      const progressDelta = BigInt(currentProgress) - BigInt(previousProgress);
      if (progressDelta <= 0n) return;
      const contributorId = decimalInteger(
        current.ownerEntityId ?? current.owner_entity_id,
        "Relay craft contribution owner entity id",
      );
      const member = this.#config.members.find(
        (candidate, index) => memberEntityId(candidate, index) === contributorId,
      );
      const contributorName = String(member?.userName ?? member?.user_name ?? contributorId).trim()
        || contributorId;
      const xpPerProgress = decimalInteger(
        target.xpPerProgress,
        `Relay craft ${craftId} experience per progress`,
      );
      const occurredAt = this.#now().toISOString();
      const result = this.#onContribution({
        claimId: this.#config.claimId,
        domain: "contributions",
        sourceKey: `relay-craft-contribution:${this.#config.regionId}:${transactionId}:${craftId}`,
        occurredAt,
        data: {
          eventType: "craft_contribution",
          regionId: this.#config.regionId,
          database: this.#config.database,
          schemaFingerprint: this.#config.schemaFingerprint,
          craftEntityId: craftId,
          contributorEntityId: contributorId,
          contributorName,
          profession: target.profession,
          craftLabel: target.craftLabel,
          structureName: target.structureName,
          itemTier: target.itemTier,
          contributedProgress: progressDelta.toString(),
          contributedXp: (progressDelta * BigInt(xpPerProgress)).toString(),
          contributionCount: "1",
          previousProgress,
          currentProgress,
        },
      });
      Promise.resolve(result).catch((error: unknown) => this.#recordError(error));
    } catch (error) {
      this.#recordError(error);
    }
  }

  #tables(connection: BindingConnection): CachedTable[] {
    return [
      connection.db.playerState,
      connection.db.equipmentState,
      connection.db.equipmentPresetState,
      connection.db.activeBuffState,
      connection.db.projectSiteState,
      connection.db.buildingState,
      connection.db.claimTechState,
      connection.db.claimRecruitmentState,
      connection.db.travelerTaskState,
      connection.db.travelerTaskDesc,
    ];
  }

  #beginBankInventoryRefresh(connection: BindingConnection): void {
    if (!this.#config) return;
    this.#refreshingBankInventories = true;
    this.#bankRefreshEpoch += 1;
    const epoch = this.#bankRefreshEpoch;
    this.#clearBankInventorySubscriptions();
    const buildingIds = [...connection.db.bankState.iter()].map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`regional bank row ${index} must be an object`);
      }
      const row = value as Record<string, unknown>;
      return decimalInteger(
        row.buildingEntityId ?? row.building_entity_id,
        `regional bank row ${index} building id`,
      );
    });
    const queries = equalitySubscriptionQueries(
      "inventory_state",
      "owner_entity_id",
      buildingIds,
    );
    if (!queries.length) {
      this.#refreshingBankInventories = false;
      this.#applySnapshot(connection);
      return;
    }
    this.#bankInventorySubscriptions.push(
      connection.subscriptionBuilder()
        .onApplied(() => {
          if (epoch !== this.#bankRefreshEpoch) return;
          this.#refreshingBankInventories = false;
          this.#applySnapshot(connection);
        })
        .onError((_context, error) => this.#recordError(error))
        .subscribe(queries),
    );
  }

  #queueBankInventoryRefresh(): void {
    if (this.#bankRefreshQueued || !this.#connection) return;
    this.#bankRefreshQueued = true;
    queueMicrotask(() => {
      this.#bankRefreshQueued = false;
      if (!this.#connection) return;
      try {
        this.#beginBankInventoryRefresh(this.#connection);
      } catch (error) {
        this.#recordError(error);
      }
    });
  }

  #clearBankInventorySubscriptions(): void {
    for (const subscription of this.#bankInventorySubscriptions) {
      subscription.unsubscribe();
    }
    this.#bankInventorySubscriptions = [];
  }

  #queueSnapshot(): void {
    if (this.#snapshotQueued || !this.#connection) return;
    this.#snapshotQueued = true;
    queueMicrotask(() => {
      this.#snapshotQueued = false;
      if (this.#connection) this.#applySnapshot(this.#connection);
    });
  }

  #recordError(error: unknown): void {
    this.#health.lastError = error instanceof Error ? error.message : String(error);
  }

  health() {
    return { ...this.#health };
  }

  async stop(): Promise<void> {
    this.#bankRefreshEpoch += 1;
    this.#removeTableListeners();
    this.#clearBankInventorySubscriptions();
    this.#contributionSubscription?.unsubscribe();
    this.#contributionSubscription = null;
    this.#baseSubscription?.unsubscribe();
    this.#baseSubscription = null;
    this.#connection?.disconnect();
    this.#connection = null;
    this.#config = null;
    this.#nextGeneration = 0;
    this.#snapshotQueued = false;
    this.#applyInFlight = false;
    this.#applyPending = false;
    this.#bankRefreshQueued = false;
    this.#refreshingBankInventories = false;
    this.#health.connected = false;
  }
}
