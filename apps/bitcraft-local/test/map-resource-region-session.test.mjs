import assert from "node:assert/strict";
import test from "node:test";

import { RelayMapResourceRegionSession } from "../src/server/game-data/mapResourceRegionSession.ts";

function table(rows) {
  const listeners = { insert: [], update: [], delete: [] };
  let iterationCount = 0;
  return {
    iter: () => { iterationCount += 1; return rows.values(); },
    onInsert: (callback) => listeners.insert.push(callback),
    onUpdate: (callback) => listeners.update.push(callback),
    onDelete: (callback) => listeners.delete.push(callback),
    removeOnInsert: (callback) => { listeners.insert = listeners.insert.filter((item) => item !== callback); },
    removeOnUpdate: (callback) => { listeners.update = listeners.update.filter((item) => item !== callback); },
    removeOnDelete: (callback) => { listeners.delete = listeners.delete.filter((item) => item !== callback); },
    emit(kind) { for (const callback of [...listeners[kind]]) callback(); },
    listenerCount() { return listeners.insert.length + listeners.update.length + listeners.delete.length; },
    iterationCount() { return iterationCount; },
  };
}

function fakeTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimer(callback, delayMs) { const id = nextId++; pending.set(id, { callback, delayMs }); return id; },
    clearTimer(id) { pending.delete(id); },
    run(delayMs) {
      for (const [id, timer] of [...pending]) if (timer.delayMs === delayMs) {
        pending.delete(id);
        timer.callback();
      }
    },
    size() { return pending.size; },
  };
}

async function drainMicrotasks() {
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

function fixture({ resourceRows = [], locationRows = [], connectOnBuild = true } = {}) {
  const db = { resourceState: table(resourceRows), locationState: table(locationRows) };
  const subscriptions = [];
  const handles = [];
  let connected = () => {};
  let connectError = () => {};
  let disconnected = () => {};
  let disconnectCount = 0;
  let buildCount = 0;
  const connection = {
    db,
    subscriptionBuilder() {
      let applied = () => {};
      let failed = () => {};
      return {
        onApplied(callback) { applied = callback; return this; },
        onError(callback) { failed = callback; return this; },
        subscribe(queries) {
          const handle = { unsubscribeCount: 0, unsubscribe() { this.unsubscribeCount += 1; } };
          subscriptions.push({ queries: [...queries], apply: applied, fail: failed, handle });
          handles.push(handle);
          return handle;
        },
      };
    },
    disconnect() { disconnectCount += 1; },
  };
  const bindings = { DbConnection: { builder() {
    return {
      withUri() { return this; },
      withDatabaseName() { return this; },
      onConnect(callback) { connected = callback; return this; },
      onConnectError(callback) { connectError = callback; return this; },
      onDisconnect(callback) { disconnected = callback; return this; },
      build() { buildCount += 1; if (connectOnBuild) connected(connection); return connection; },
    };
  } } };
  const loadBindings = async () => bindings;
  return {
    db, subscriptions, handles, bindings, loadBindings,
    connect: () => connected(connection),
    disconnect: (error) => disconnected(undefined, error),
    connectError: (error) => connectError(undefined, error),
    buildCount: () => buildCount,
    disconnectCount: () => disconnectCount,
  };
}

function config(overrides = {}) {
  return {
    uri: "wss://relay.example:4019",
    database: "relay-region-19",
    schemaFingerprint: "regional-v1",
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    generation: 7,
    regionId: "19",
    ...overrides,
  };
}

test("resource session validates the regional schema before loading bindings", async () => {
  let loaded = false;
  const session = new RelayMapResourceRegionSession({
    loadBindings: async () => { loaded = true; throw new Error("must not load"); },
    onSnapshot() {},
    onFailure() {},
  });
  await assert.rejects(session.start(config({ schemaFingerprint: "wrong" })), /fingerprint mismatch/i);
  assert.equal(loaded, false);
});

test("resource session waits for asynchronous Relay connection readiness before resolving start", async () => {
  const relay = fixture({ connectOnBuild: false });
  const session = new RelayMapResourceRegionSession({ loadBindings: relay.loadBindings, onSnapshot() {}, onFailure() {} });
  let started = false;
  const starting = session.start(config()).then(() => { started = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(started, false, "start must remain pending until Relay invokes onConnect");

  relay.connect();
  await starting;
  await session.subscribe("28", 7);
  assert.equal(relay.subscriptions.length, 1);
  await session.stop();
});

test("resource session rejects pending start and disconnects when stopped before Relay connects", async () => {
  const relay = fixture({ connectOnBuild: false });
  const session = new RelayMapResourceRegionSession({ loadBindings: relay.loadBindings, onSnapshot() {}, onFailure() {} });
  let startError = null;
  void session.start(config()).catch((error) => { startError = error; });
  await Promise.resolve();
  await Promise.resolve();

  await session.stop();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(startError?.message ?? "", /stopped while connecting/i);
  assert.equal(relay.disconnectCount(), 1);
});

test("resource session ignores a late Relay connection callback after pending start is stopped", async () => {
  const relay = fixture({ connectOnBuild: false });
  const session = new RelayMapResourceRegionSession({ loadBindings: relay.loadBindings, onSnapshot() {}, onFailure() {} });
  let startError = null;
  void session.start(config()).catch((error) => { startError = error; });
  await Promise.resolve();
  await Promise.resolve();

  await session.stop();
  relay.connect();
  await Promise.resolve();
  await Promise.resolve();
  assert.match(startError?.message ?? "", /stopped while connecting/i);
  assert.equal(relay.disconnectCount(), 1);
});

test("resource session cancels startup stopped before bindings finish loading", async () => {
  const relay = fixture({ connectOnBuild: false });
  let resolveBindings;
  const session = new RelayMapResourceRegionSession({
    loadBindings: () => new Promise((resolve) => { resolveBindings = resolve; }),
    onSnapshot() {},
    onFailure() {},
  });
  const starting = session.start(config());
  await session.stop();
  resolveBindings(relay.bindings);
  await assert.rejects(starting, /stopped while connecting/i);
  assert.equal(relay.buildCount(), 0);
  assert.equal(relay.disconnectCount(), 0);
});

test("resource session rejects start before unresolved bindings finish and never builds a late connection", async () => {
  const relay = fixture({ connectOnBuild: false });
  let resolveBindings;
  let outcome = null;
  const session = new RelayMapResourceRegionSession({
    loadBindings: () => new Promise((resolve) => { resolveBindings = resolve; }),
    onSnapshot() {},
    onFailure() {},
  });
  const starting = session.start(config()).then(
    () => { outcome = { status: "resolved" }; },
    (error) => { outcome = { status: "rejected", error }; },
  );
  await Promise.resolve();

  await session.stop();
  await drainMicrotasks();
  const settledBeforeBindings = outcome !== null;
  resolveBindings(relay.bindings);
  await starting;

  assert.equal(settledBeforeBindings, true, "stop must settle start without waiting for bindings");
  assert.equal(outcome.status, "rejected");
  assert.match(outcome.error.message, /stopped while connecting/i);
  assert.equal(relay.buildCount(), 0, "late bindings must not build a connection after stop");
  assert.equal(relay.disconnectCount(), 0);
});

test("resource session maintains independent applied subscriptions on one regional connection", async () => {
  const relay = fixture();
  const timers = fakeTimers();
  const snapshots = [];
  const session = new RelayMapResourceRegionSession({
    loadBindings: relay.loadBindings,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onFailure() {},
    now: () => new Date("2026-08-12T12:00:00.000Z"),
    ...timers,
  });
  await session.start(config());
  await session.subscribe("28", 7);
  await session.subscribe("54", 8);

  assert.deepEqual(relay.subscriptions.map(({ queries }) => queries), [
    [
      "SELECT resource_state.* FROM resource_state JOIN location_state ON resource_state.entity_id = location_state.entity_id WHERE resource_state.resource_id = 28 AND location_state.dimension = 1",
      "SELECT location_state.* FROM resource_state JOIN location_state ON resource_state.entity_id = location_state.entity_id WHERE resource_state.resource_id = 28 AND location_state.dimension = 1",
    ],
    [
      "SELECT resource_state.* FROM resource_state JOIN location_state ON resource_state.entity_id = location_state.entity_id WHERE resource_state.resource_id = 54 AND location_state.dimension = 1",
      "SELECT location_state.* FROM resource_state JOIN location_state ON resource_state.entity_id = location_state.entity_id WHERE resource_state.resource_id = 54 AND location_state.dimension = 1",
    ],
  ]);
  assert.equal(relay.handles[0].unsubscribeCount, 0, "adding a resource must retain its existing handle");
  assert.equal(snapshots.length, 0, "no resource publishes before its own subscription applies");

  relay.subscriptions[1].apply();
  await Promise.resolve();
  assert.deepEqual(snapshots.map((snapshot) => snapshot.resourceId), ["54"]);
  assert.deepEqual(snapshots[0].data.resources, []);
  assert.equal(snapshots[0].generation, 8);
  assert.equal(session.health().appliedResourceIds.includes("54"), true);
  assert.equal(session.health().appliedResourceIds.includes("28"), false);

  relay.subscriptions[0].apply();
  await Promise.resolve();
  assert.deepEqual(snapshots.map((snapshot) => snapshot.resourceId), ["54", "28"]);
  assert.equal(snapshots[1].generation, 7);
  assert.equal(session.health().rowCount, 0);
  assert.equal(Number.isFinite(session.health().normalizationDurationMs), true);
  assert.equal(session.health().normalizationDurationMs >= 0, true);
  assert.equal(JSON.stringify(session.health()).includes("locationX"), false);

  session.unsubscribe("28");
  assert.equal(relay.handles[0].unsubscribeCount, 1);
  assert.equal(relay.handles[1].unsubscribeCount, 0);
  await session.stop();
});

test("resource session health counts rows for each selected resource independently", async () => {
  const relay = fixture({
    resourceRows: [
      { entityId: 1n, resourceId: 28 },
      { entityId: 2n, resourceId: 54 },
      { entityId: 3n, resourceId: 54 },
    ],
    locationRows: [
      { entityId: 1n, x: 100, z: 200, dimension: 1 },
      { entityId: 2n, x: 101, z: 201, dimension: 1 },
      { entityId: 3n, x: 102, z: 202, dimension: 1 },
    ],
  });
  const session = new RelayMapResourceRegionSession({ loadBindings: relay.loadBindings, onSnapshot() {}, onFailure() {} });
  await session.start(config());
  await session.subscribe("28", 7);
  await session.subscribe("54", 8);

  relay.subscriptions[0].apply();
  relay.subscriptions[1].apply();
  await drainMicrotasks();

  assert.deepEqual(session.health().rowsPerType, {
    "28": { resourceState: 1, locationState: 1 },
    "54": { resourceState: 2, locationState: 2 },
  });
  assert.equal(session.health().rowCount, 6, "the row budget covers active typed subscriptions");
  session.unsubscribe("28");
  assert.deepEqual(session.health().rowsPerType, {
    "54": { resourceState: 2, locationState: 2 },
  }, "unsubscribed resources must not remain in per-subscription diagnostics");
  assert.equal(session.health().rowCount, 4, "unsubscribed resources must leave the active row budget");
  await session.stop();
});

test("resource session budgets unique normalized nodes instead of reciprocal join rows", async () => {
  const relay = fixture({
    resourceRows: [
      { entityId: 1n, resourceId: 28 },
      { entityId: 2n, resourceId: 28 },
      { entityId: 3n, resourceId: 28 },
      ...Array.from({ length: 10 }, (_, index) => ({ entityId: BigInt(index + 100), resourceId: 999 })),
    ],
    locationRows: [
      { entityId: 1n, x: 100, z: 200, dimension: 1 },
      { entityId: 2n, x: 101, z: 201, dimension: 1 },
      { entityId: 3n, x: 102, z: 202, dimension: 1 },
      ...Array.from({ length: 10 }, (_, index) => ({ entityId: BigInt(index + 100), x: index, z: index, dimension: 1 })),
    ],
  });
  const snapshots = [];
  const failures = [];
  const session = new RelayMapResourceRegionSession({
    loadBindings: relay.loadBindings,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onFailure: (warning) => failures.push(warning),
  });
  await session.start(config({ maxNodes: 3 }));
  await session.subscribe("28", 7);

  relay.subscriptions[0].apply();
  await drainMicrotasks();

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].data.resources.length, 3);
  assert.deepEqual(session.health().rowsPerType, { "28": { resourceState: 3, locationState: 3 } });
  assert.equal(session.health().rowCount, 6, "health retains raw join evidence for diagnostics");
  assert.deepEqual(failures, []);
  await session.stop();
});

test("resource session rejects a genuinely oversized normalized partition", async () => {
  const relay = fixture({
    resourceRows: [
      { entityId: 1n, resourceId: 28 },
      { entityId: 2n, resourceId: 28 },
      { entityId: 3n, resourceId: 28 },
    ],
    locationRows: [
      { entityId: 1n, x: 100, z: 200, dimension: 1 },
      { entityId: 2n, x: 101, z: 201, dimension: 1 },
      { entityId: 3n, x: 102, z: 202, dimension: 1 },
    ],
  });
  const snapshots = [];
  const failures = [];
  const session = new RelayMapResourceRegionSession({
    loadBindings: relay.loadBindings,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onFailure: (warning) => failures.push(warning),
  });
  await session.start(config({ maxNodes: 2 }));
  await session.subscribe("28", 7);

  relay.subscriptions[0].apply();
  await drainMicrotasks();

  assert.equal(snapshots.length, 0);
  assert.match(failures[0], /node budget 2 exceeded by 3 nodes/);
  assert.match(session.health().lastError, /node budget 2 exceeded by 3 nodes/);
  await session.stop();
});

test("resource session accepts more than fifty thousand reciprocal join rows when unique nodes fit", async () => {
  const resourceRows = Array.from({ length: 25_001 }, (_, index) => ({ entityId: BigInt(index + 1), resourceId: 28 }));
  const locationRows = Array.from({ length: 25_001 }, (_, index) => ({ entityId: BigInt(index + 1), x: index % 38_401, z: index % 38_401, dimension: 1 }));
  const relay = fixture({ resourceRows, locationRows });
  const snapshots = [];
  const failures = [];
  const session = new RelayMapResourceRegionSession({
    loadBindings: relay.loadBindings,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onFailure: (warning) => failures.push(warning),
  });
  await session.start(config());
  await session.subscribe("28", 7);

  relay.subscriptions[0].apply();
  await drainMicrotasks();

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].data.resources.length, 25_001);
  assert.equal(session.health().rowCount, 50_002);
  assert.deepEqual(failures, []);
  await session.stop();
});

test("resource session coalesces cache changes and retains a prior generation through an incomplete join", async () => {
  const resourceRows = [{ entityId: 1n, resourceId: 28 }];
  const locationRows = [{ entityId: 1n, x: 100, z: 200, dimension: 1 }];
  const relay = fixture({ resourceRows, locationRows });
  const timers = fakeTimers();
  const snapshots = [];
  const session = new RelayMapResourceRegionSession({
    loadBindings: relay.loadBindings,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onFailure() {},
    now: () => new Date("2026-08-12T12:00:00.000Z"),
    ...timers,
  });
  await session.start(config());
  await session.subscribe("28", 7);
  relay.subscriptions[0].apply();
  assert.equal(snapshots.length, 1);

  locationRows[0].x = 101;
  relay.db.resourceState.emit("insert");
  relay.db.resourceState.emit("update");
  relay.db.locationState.emit("delete");
  assert.equal(timers.size(), 1);
  assert.equal(snapshots.length, 1);
  timers.run(300);
  assert.equal(snapshots.length, 2, "a change burst produces one rebuild");
  assert.equal(snapshots[1].data.resources[0].locationX, 101);

  resourceRows.push({ entityId: 2n, resourceId: 28 });
  relay.db.resourceState.emit("insert");
  timers.run(300);
  assert.equal(snapshots.length, 2, "an incomplete join must not replace the previous generation");
  assert.match(session.health().lastError, /resource 2.*location/i);

  locationRows.push({ entityId: 2n, x: 102, z: 202, dimension: 1 });
  relay.db.locationState.emit("insert");
  timers.run(300);
  assert.equal(snapshots.length, 3);
  assert.deepEqual(snapshots[2].data.resources.map((resource) => resource.entityId), ["1", "2"]);
  await session.stop();
});

test("coalesced regional rebuild reads each SDK cache once and publishes complete types independently", async () => {
  const resourceRows = [
    { entityId: 1n, resourceId: 28 },
    { entityId: 2n, resourceId: 130 },
  ];
  const locationRows = [{ entityId: 1n, x: 100, z: 200, dimension: 1 }];
  const relay = fixture({ resourceRows, locationRows });
  const timers = fakeTimers();
  const snapshots = [];
  const statuses = [];
  const session = new RelayMapResourceRegionSession({
    loadBindings: relay.loadBindings,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onStatus: (status) => statuses.push(status),
    onFailure() {},
    ...timers,
  });
  await session.start(config());
  await session.subscribe("28", 7);
  await session.subscribe("130", 8);
  relay.subscriptions[0].apply();
  relay.subscriptions[1].apply();
  await drainMicrotasks();
  const resourceIterationsBefore = relay.db.resourceState.iterationCount();
  const locationIterationsBefore = relay.db.locationState.iterationCount();
  snapshots.length = 0;
  statuses.length = 0;

  relay.db.resourceState.emit("update");
  relay.db.locationState.emit("update");
  timers.run(300);
  await drainMicrotasks();

  assert.equal(relay.db.resourceState.iterationCount() - resourceIterationsBefore, 1);
  assert.equal(relay.db.locationState.iterationCount() - locationIterationsBefore, 1);
  assert.deepEqual(snapshots.map(({ resourceId }) => resourceId), ["28"]);
  assert.deepEqual(statuses.map(({ resourceId }) => resourceId), ["130"]);
  assert.equal(session.health().stage, "partial");
  await session.stop();
});

test("resource session reports disconnects and stops each regional resource handle exactly once", async () => {
  const relay = fixture();
  const failures = [];
  const session = new RelayMapResourceRegionSession({ loadBindings: relay.loadBindings, onSnapshot() {}, onFailure: (error) => failures.push(error) });
  await session.start(config());
  await session.subscribe("28", 7);
  await session.subscribe("54", 8);
  relay.disconnect(new Error("relay dropped"));
  assert.deepEqual(failures, ["relay dropped"]);
  await session.stop();
  assert.equal(relay.db.resourceState.listenerCount(), 0);
  assert.equal(relay.db.locationState.listenerCount(), 0);
  assert.deepEqual(relay.handles.map((handle) => handle.unsubscribeCount), [1, 1]);
  assert.equal(relay.disconnectCount(), 1);
});
