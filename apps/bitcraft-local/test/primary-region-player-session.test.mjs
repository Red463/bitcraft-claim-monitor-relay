import assert from "node:assert/strict";
import test from "node:test";

let sessionModule = null;
try {
  sessionModule = await import("../src/server/game-data/primaryRegionPlayerSession.ts");
} catch {
  // The first TDD run proves the regional player session is absent.
}

function fakeBindings({ bankRows = [], inventoryRows = [] } = {}) {
  const state = {
    connectConfig: {},
    queries: null,
    onApplied: null,
    subscriptions: [],
    callbacks: new Map(),
    disconnected: false,
    unsubscribed: false,
  };
  const rows = [{
    entityId: 101n,
    timePlayed: 7200,
    sessionStartTimestamp: 0,
    timeSignedIn: 3600,
    signInTimestamp: 1785352200,
    signedIn: true,
    travelerTasksExpiration: 0,
  }];
  const cachedTable = (name, tableRows = []) => ({
    iter: () => tableRows[Symbol.iterator](),
    onInsert: (callback) => state.callbacks.set(`${name}:insert`, callback),
    onUpdate: (callback) => state.callbacks.set(`${name}:update`, callback),
    onDelete: (callback) => state.callbacks.set(`${name}:delete`, callback),
    removeOnInsert: () => state.callbacks.delete(`${name}:insert`),
    removeOnUpdate: () => state.callbacks.delete(`${name}:update`),
    removeOnDelete: () => state.callbacks.delete(`${name}:delete`),
  });
  const playerState = cachedTable("player", rows);
  const equipmentState = cachedTable("equipment", [{
    entityId: 101n,
    equipmentSlots: [],
  }]);
  const equipmentPresetState = cachedTable("preset", []);
  const activeBuffState = cachedTable("buff", []);
  const projectSiteState = cachedTable("project", [{
    entityId: 9001n,
    constructionRecipeId: 3023,
    resourcePlacementRecipeId: 0,
    items: [{
      itemId: 3090004,
      quantity: 5,
      itemType: { tag: "Item", value: {} },
    }],
    cargos: [],
    progress: 157,
    lastCritOutcome: 1,
    ownerId: 1369094286777412590n,
    direction: 2,
    lastHitTimestamp: {
      __timestamp_micros_since_unix_epoch__: 1785096910248578n,
    },
  }]);
  const buildingState = cachedTable("building", [{
    entityId: 7001n,
    claimEntityId: 1369094286777412590n,
    directionIndex: 2,
    buildingDescriptionId: 6020,
    constructedByPlayerEntityId: 101n,
  }]);
  const claimTechState = cachedTable("research", [{
    entityId: 1369094286777412590n,
    learned: [1, 200, 748616905],
    researching: 0,
    startTimestamp: {
      __timestamp_micros_since_unix_epoch__: 0n,
    },
    scheduledId: null,
  }]);
  const claimRecruitmentState = cachedTable("recruitment", [{
    entityId: 1369094286821318198n,
    claimEntityId: 1369094286777412590n,
    remainingStock: 19,
    requiredSkillId: 1,
    requiredSkillLevel: 1,
    requiredApproval: false,
  }]);
  const travelerTaskState = cachedTable("traveler-task", [{
    entityId: 6001n,
    playerEntityId: 101n,
    travelerId: 12,
    taskId: 77,
    completed: false,
  }]);
  const travelerTaskDesc = cachedTable("traveler-task-desc", [{
    id: 77,
    description: "Deliver fine planks",
    levelRequirement: { skillId: 3, level: 20 },
    requiredItems: [],
    rewardedItems: [],
    rewardedExperience: { skillId: 3, quantity: 125 },
  }]);
  const bankState = cachedTable("bank", bankRows);
  const inventoryState = cachedTable("inventory", inventoryRows);
  const progressiveActionState = cachedTable("progressive-action", []);
  const connection = {
    db: {
      playerState,
      equipmentState,
      equipmentPresetState,
      activeBuffState,
      projectSiteState,
      buildingState,
      claimTechState,
      claimRecruitmentState,
      travelerTaskState,
      travelerTaskDesc,
      bankState,
      inventoryState,
      progressiveActionState,
    },
    subscriptionBuilder() {
      const subscriptionState = {
        onApplied: null,
        onError: null,
        queries: null,
        unsubscribed: false,
      };
      const builder = {
        onApplied(callback) {
          subscriptionState.onApplied = callback;
          return builder;
        },
        onError(callback) {
          subscriptionState.onError = callback;
          return builder;
        },
        subscribe(queries) {
          subscriptionState.queries = queries;
          state.subscriptions.push(subscriptionState);
          if (state.subscriptions.length === 1) {
            state.queries = queries;
            state.onApplied = subscriptionState.onApplied;
          }
          return { unsubscribe: () => {
            subscriptionState.unsubscribed = true;
            if (state.subscriptions[0] === subscriptionState) state.unsubscribed = true;
          } };
        },
      };
      return builder;
    },
    disconnect() {
      state.disconnected = true;
    },
  };
  const builder = {
    withUri(value) {
      state.connectConfig.uri = value;
      return builder;
    },
    withDatabaseName(value) {
      state.connectConfig.database = value;
      return builder;
    },
    onConnect(callback) {
      state.onConnect = callback;
      return builder;
    },
    onConnectError() {
      return builder;
    },
    onDisconnect() {
      return builder;
    },
    build() {
      return connection;
    },
  };
  return {
    module: { DbConnection: { builder: () => builder } },
    connection,
    state,
  };
}

const manifest = {
  schemas: {
    regional: { fingerprint: "regional-v1", bindingsGenerated: true },
  },
};

const members = [
  { playerEntityId: "101", userName: "Ada" },
  { playerEntityId: "202", userName: "Grace" },
];

test("primary-region session filters member, settlement, and Town Bank state before emitting snapshots", async () => {
  assert.ok(sessionModule, "primary-region player session module must exist");
  const fake = fakeBindings({
    bankRows: [{
      buildingEntityId: 7002n,
      claimEntityId: 1369094286777412590n,
      coordinates: { q: 1, r: 2 },
    }],
    inventoryRows: [{
      entityId: 8001n,
      ownerEntityId: 7002n,
      playerOwnerEntityId: 101n,
      inventoryIndex: 4,
      cargoIndex: 5,
      pockets: [{
        volume: 10,
        contents: {
          itemId: 42,
          quantity: 7,
          itemType: { tag: "Item", value: {} },
          durability: null,
        },
        locked: false,
      }],
    }],
  });
  const snapshots = [];
  const session = new sessionModule.RelayPrimaryRegionPlayerSession({
    loadBindings: async () => fake.module,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    now: () => new Date("2026-07-29T20:35:00.000Z"),
  });

  await session.start({
    uri: "wss://relay.example:4000",
    database: "relay-region-19",
    schemaFingerprint: "regional-v1",
    manifest,
    generation: 4,
    regionId: "19",
    claimId: "1369094286777412590",
    members,
    contributionWarnings: ["Relay craft 9002 has invalid experience per progress"],
  });
  fake.state.onConnect(fake.connection);
  assert.deepEqual(fake.state.queries, [
    "SELECT * FROM player_state WHERE entity_id = 101 OR entity_id = 202",
    "SELECT * FROM equipment_state WHERE entity_id = 101 OR entity_id = 202",
    "SELECT * FROM equipment_preset_state WHERE player_entity_id = 101 OR player_entity_id = 202",
    "SELECT * FROM active_buff_state WHERE entity_id = 101 OR entity_id = 202",
    "SELECT * FROM project_site_state WHERE owner_id = 1369094286777412590",
    "SELECT * FROM building_state WHERE claim_entity_id = 1369094286777412590",
    "SELECT * FROM claim_tech_state WHERE entity_id = 1369094286777412590",
    "SELECT * FROM claim_recruitment_state WHERE claim_entity_id = 1369094286777412590",
    "SELECT * FROM traveler_task_state WHERE player_entity_id = 101 OR player_entity_id = 202",
    "SELECT * FROM traveler_task_desc",
    "SELECT * FROM bank_state WHERE claim_entity_id = 1369094286777412590",
  ]);

  fake.state.onApplied({});
  assert.equal(snapshots.length, 0);
  assert.deepEqual(fake.state.subscriptions[1].queries, [
    "SELECT * FROM inventory_state WHERE owner_entity_id = 7002",
  ]);
  fake.state.subscriptions[1].onApplied({});
  await Promise.resolve();
  assert.deepEqual(snapshots[0], {
    players: [
      {
        entityId: "101",
        playerEntityId: "101",
        username: "Ada",
        signedIn: true,
        sessionSeconds: 5100,
        timePlayedSeconds: 7200,
        timeSignedInSeconds: 3600,
        signInTimestamp: "2026-07-29T19:10:00.000Z",
        tasks: {
          tasks: [{
            entityId: "6001",
            travelerId: "12",
            taskId: "77",
            description: "Deliver fine planks",
            completed: false,
          }],
        },
      },
      {
        entityId: "202",
        playerEntityId: "202",
        username: "Grace",
        signedIn: false,
        sessionSeconds: null,
        timePlayedSeconds: null,
        timeSignedInSeconds: null,
        tasks: { tasks: [] },
      },
    ],
    warnings: ["Regional player_state omitted member 202."],
    equipment: {
      members: [
        {
          playerEntityId: "101",
          username: "Ada",
          equipment: { equipmentSlots: [] },
          equipmentPresets: { presets: [] },
          buffs: { buffs: [] },
        },
        {
          playerEntityId: "202",
          username: "Grace",
          equipment: { equipmentSlots: [] },
          equipmentPresets: { presets: [] },
          buffs: { buffs: [] },
        },
      ],
    },
    equipmentWarnings: [],
    construction: {
      projects: [{
        entityId: "9001",
        constructionRecipeId: "3023",
        resourcePlacementRecipeId: "0",
        ownerId: "1369094286777412590",
        items: [{ itemId: "3090004", itemType: "item", quantity: "5" }],
        cargos: [],
        progress: "157",
        lastCritOutcome: 1,
        direction: 2,
        lastHitAt: "2026-07-26T20:15:10.248Z",
      }],
      buildings: [{
        entityId: "7001",
        claimEntityId: "1369094286777412590",
        directionIndex: 2,
        buildingDescriptionId: "6020",
        constructedByPlayerEntityId: "101",
      }],
    },
    constructionWarnings: [],
    research: {
      claimId: "1369094286777412590",
      learnedTechIds: ["1", "200", "748616905"],
      researchingTechId: null,
      researchStartedAt: null,
      scheduledId: null,
    },
    researchWarnings: [],
    recruitment: {
      claimId: "1369094286777412590",
      isRecruiting: true,
      recruitment: [{
        entityId: "1369094286821318198",
        claimEntityId: "1369094286777412590",
        remainingStock: "19",
        requiredSkillId: "1",
        requiredSkillLevel: "1",
        requiredApproval: false,
        isRecruiting: true,
      }],
    },
    recruitmentWarnings: [],
    bankInventories: {
      buildings: [{
        entityId: "8001",
        buildingEntityId: "7002",
        playerOwnerEntityId: "101",
        playerOwnerName: "Ada",
        name: "Town Bank — Ada",
        nickname: "Town Bank — Ada",
        category: "town-bank",
        inventoryIndex: 4,
        cargoIndex: 5,
        items: [{ itemId: "42", itemType: "item", quantity: "7" }],
        inventory: [{
          slot: 0,
          locked: false,
          contents: { itemId: "42", itemType: "item", quantity: "7" },
        }],
      }],
    },
    bankInventoryWarnings: [],
    contributionWarnings: ["Relay craft 9002 has invalid experience per progress"],
    database: "relay-region-19",
    regionId: "19",
    schemaFingerprint: "regional-v1",
    generation: 4,
    receivedAt: "2026-07-29T20:35:00.000Z",
  });

  fake.state.callbacks.get("equipment:update")({}, {}, {});
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(snapshots[1].generation, 5);

  await session.stop();
  assert.equal(fake.state.unsubscribed, true);
  assert.equal(fake.state.subscriptions.every(({ unsubscribed }) => unsubscribed), true);
  assert.equal(fake.state.disconnected, true);
  assert.equal(fake.state.callbacks.size, 0);
});

test("primary-region session emits positive craft progress transactions as exact contribution events", async () => {
  assert.ok(sessionModule, "primary-region player session module must exist");
  const fake = fakeBindings();
  const contributions = [];
  const session = new sessionModule.RelayPrimaryRegionPlayerSession({
    loadBindings: async () => fake.module,
    onSnapshot: () => {},
    onContribution: (event) => contributions.push(event),
    now: () => new Date("2026-08-01T09:00:00.000Z"),
  });
  const target = {
    craftEntityId: "1369094287428103662",
    profession: "Forestry",
    craftLabel: "Owl Feather",
    structureName: "Forester",
    itemTier: "3",
    xpPerProgress: "2",
  };

  await session.start({
    uri: "wss://relay.example:4000",
    database: "bitcraft-live-19",
    schemaFingerprint: "regional-v1",
    manifest,
    generation: 1,
    regionId: "19",
    claimId: "1369094286777412590",
    members: [{ playerEntityId: "576460752388321942", userName: "Mosswick" }],
    contributionTargets: [target],
  });
  fake.state.onConnect(fake.connection);
  assert.ok(fake.state.subscriptions[1].queries.includes(
    "SELECT * FROM progressive_action_state WHERE entity_id = 1369094287428103662",
  ));
  fake.state.onApplied({});

  const update = fake.state.callbacks.get("progressive-action:update");
  assert.equal(typeof update, "function");
  update(
    { event: { tag: "SubscribeApplied", id: "initial" } },
    { entityId: 1369094287428103662n, ownerEntityId: 576460752388321942n, progress: 0 },
    { entityId: 1369094287428103662n, ownerEntityId: 576460752388321942n, progress: 16056 },
  );
  update(
    { event: { tag: "Transaction", id: "transaction-12" } },
    { entityId: 1369094287428103662n, ownerEntityId: 576460752388321942n, progress: 16056 },
    { entityId: 1369094287428103662n, ownerEntityId: 576460752388321942n, progress: 16080 },
  );
  update(
    { event: { tag: "Transaction", id: "transaction-13" } },
    { entityId: 1369094287428103662n, ownerEntityId: 576460752388321942n, progress: 16080 },
    { entityId: 1369094287428103662n, ownerEntityId: 576460752388321942n, progress: 16080 },
  );

  assert.deepEqual(contributions, [{
    claimId: "1369094286777412590",
    domain: "contributions",
    sourceKey: "relay-craft-contribution:19:transaction-12:1369094287428103662",
    occurredAt: "2026-08-01T09:00:00.000Z",
    data: {
      eventType: "craft_contribution",
      regionId: "19",
      database: "bitcraft-live-19",
      schemaFingerprint: "regional-v1",
      craftEntityId: "1369094287428103662",
      contributorEntityId: "576460752388321942",
      contributorName: "Mosswick",
      profession: "Forestry",
      craftLabel: "Owl Feather",
      structureName: "Forester",
      itemTier: "3",
      contributedProgress: "24",
      contributedXp: "48",
      contributionCount: "1",
      previousProgress: "16056",
      currentProgress: "16080",
    },
  }]);

  await session.stop();
});

test("primary-region session replaces contribution queries without replacing base data", async () => {
  assert.ok(sessionModule, "primary-region player session module must exist");
  const fake = fakeBindings();
  const session = new sessionModule.RelayPrimaryRegionPlayerSession({
    loadBindings: async () => fake.module,
    onSnapshot: () => {},
  });
  const first = {
    craftEntityId: "9001",
    profession: "Forestry",
    craftLabel: "Planks",
    structureName: "Forester",
    itemTier: "3",
    xpPerProgress: "2",
  };
  const second = { ...first, craftEntityId: "9002", craftLabel: "Beams" };

  await session.start({
    uri: "wss://relay.example:4000",
    database: "bitcraft-live-19",
    schemaFingerprint: "regional-v1",
    manifest,
    generation: 1,
    regionId: "19",
    claimId: "1369094286777412590",
    members: [{ playerEntityId: "101", userName: "Ada" }],
    contributionTargets: [first],
  });
  fake.state.onConnect(fake.connection);

  const base = fake.state.subscriptions[0];
  const initialContribution = fake.state.subscriptions[1];
  assert.doesNotMatch(base.queries.join("\n"), /progressive_action_state/);
  assert.match(initialContribution.queries.join("\n"), /entity_id = 9001/);

  session.updateContributionScope([second], []);

  assert.equal(base.unsubscribed, false);
  assert.equal(initialContribution.unsubscribed, true);
  assert.match(fake.state.subscriptions[2].queries.join("\n"), /entity_id = 9002/);
  assert.equal(fake.state.disconnected, false);
});

test("primary-region player session rejects schema mismatch before loading bindings", async () => {
  assert.ok(sessionModule, "primary-region player session module must exist");
  let loaded = false;
  const session = new sessionModule.RelayPrimaryRegionPlayerSession({
    loadBindings: async () => {
      loaded = true;
      return fakeBindings().module;
    },
    onSnapshot: () => assert.fail("schema mismatch must not emit a snapshot"),
  });
  await assert.rejects(session.start({
    uri: "wss://relay.example:4000",
    database: "relay-region-19",
    schemaFingerprint: "unexpected",
    manifest,
    generation: 1,
    regionId: "19",
    claimId: "1369094286777412590",
    members,
  }), /schema fingerprint mismatch/i);
  assert.equal(loaded, false);
});

test("primary-region player session coalesces rapid changes while a snapshot apply is unfinished", async () => {
  assert.ok(sessionModule, "primary-region player session module must exist");
  const fake = fakeBindings();
  const snapshots = [];
  let releaseFirst;
  const firstApply = new Promise((resolve) => { releaseFirst = resolve; });
  const session = new sessionModule.RelayPrimaryRegionPlayerSession({
    loadBindings: async () => fake.module,
    onSnapshot: (snapshot) => {
      snapshots.push(snapshot);
      return snapshots.length === 1 ? firstApply : undefined;
    },
  });
  await session.start({
    uri: "wss://relay.example:4019",
    database: "relay-region-19",
    schemaFingerprint: "regional-v1",
    manifest,
    generation: 30,
    regionId: "19",
    claimId: "1369094286777412590",
    members,
  });
  fake.state.onConnect(fake.connection);
  fake.state.onApplied({});
  fake.state.callbacks.get("player:update")({}, {}, {});
  fake.state.callbacks.get("buff:insert")({}, {});
  fake.state.callbacks.get("project:update")({}, {}, {});
  fake.state.callbacks.get("research:update")({}, {}, {});
  fake.state.callbacks.get("recruitment:update")({}, {}, {});
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(snapshots.length, 1);

  releaseFirst();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(snapshots.map(({ generation }) => generation), [30, 31]);
  await session.stop();
});
