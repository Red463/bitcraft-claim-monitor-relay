import assert from "node:assert/strict";
import test from "node:test";
import { packResourceCoordinate } from "../src/map/resourcePartitionCodec.mjs";

let runtimeModule = null;
try {
  runtimeModule = await import("../src/server/game-data/mapResourceRuntime.ts");
} catch {
  // RED: the warm map-resource runtime has not been implemented yet.
}

function manualClock() {
  let now = 0;
  const timers = new Map();
  const callbacks = new Map();
  let nextTimer = 1;
  return {
    now: () => now,
    setTimer(callback, delay) {
      const timer = nextTimer++;
      timers.set(timer, { callback, dueAt: now + delay });
      callbacks.set(timer, callback);
      return timer;
    },
    clearTimer(timer) { timers.delete(timer); },
    pendingTimers: () => [...timers.keys()],
    async fire(timer) { await callbacks.get(timer)?.(); },
    async advance(ms) {
      now += ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.dueAt <= now)
          .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
        if (!due) return;
        timers.delete(due[0]);
        await due[1].callback();
      }
    },
  };
}

function snapshot(regionId, resourceId, generation, resources = []) {
  return {
    data: { regionId, resourceId, resources }, warnings: [], database: `relay-region-${regionId}`,
    regionId, resourceId, schemaFingerprint: "regional-v1", generation,
    receivedAt: "2026-08-12T10:00:00.000Z",
    packedCoordinates: new Uint32Array(resources.flatMap((resource) => (
      Number.isInteger(resource.locationX) && Number.isInteger(resource.locationZ)
        ? [packResourceCoordinate(resource.locationX, resource.locationZ)]
        : []
    ))),
  };
}

function runtimeFixture({ regions = ["19", "20"], clock = manualClock(), start = async () => {}, subscribe = async () => {}, onGeneration } = {}) {
  const sessions = [];
  const topology = {
    regions: new Map(regions.map((regionId) => [regionId, {
      ready: true, port: 4000 + Number(regionId), database: `relay-region-${regionId}`, schemaFingerprint: "regional-v1",
    }])),
  };
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => topology,
    now: clock.now,
    setTimer: (callback, delay) => clock.setTimer(callback, delay),
    clearTimer: (timer) => clock.clearTimer(timer),
    onGeneration,
    createSession: (options) => {
      const session = {
        options, starts: [], subscriptions: [], unsubscribed: [], stopped: false,
        async start(config) { this.starts.push(config); await start(config, this); },
        async subscribe(resourceId, generation) {
          this.subscriptions.push({ resourceId, generation });
          await subscribe(resourceId, generation, this);
        },
        unsubscribe(resourceId) { this.unsubscribed.push(resourceId); },
        health() { return { connected: !this.stopped, applied: !this.stopped, lastError: null }; },
        async stop() { this.stopped = true; },
      };
      sessions.push(session);
      return session;
    },
  });
  return { runtime, sessions, topology, clock };
}

test("reconcile configures resource regions without opening an empty SDK connection", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const { runtime, sessions } = runtimeFixture();
  await runtime.reconcile({ relayBaseUrl: "https://relay.example/", primaryRegionId: "019", activeRegionIds: ["20", "19", "19"] });
  assert.equal(sessions.length, 0);
  assert.equal(runtime.health().regionalConnectionCount, 0);
  assert.deepEqual(runtime.health().pinnedRegionIds, []);
  await runtime.stop();
});

test("an equivalent reconcile does not invalidate an in-flight cold region acquisition", async () => {
  let openRegion;
  const regionOpening = new Promise((resolve) => { openRegion = resolve; });
  const { runtime, sessions } = runtimeFixture({
    start: async (config) => { if (config.regionId === "20") await regionOpening; },
  });
  const config = { relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] };
  await runtime.reconcile(config);
  const acquisition = runtime.acquire({ regionId: "20", resourceId: "28" });
  while (sessions.length < 1) await Promise.resolve();

  await runtime.reconcile({ ...config, activeRegionIds: ["20", "19"] });
  openRegion();

  const lease = await acquisition;
  assert.equal(lease.key, "20|resource:28");
  await lease.release();
  await runtime.stop();
});

test("runtime health aggregates active, idle, row, and latency diagnostics without resource identities", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ regions: new Map([["19", { ready: true, port: 4019, database: "relay-region-19", schemaFingerprint: "regional-v1" }]]) }),
    createSession: () => ({
      async start() {}, async subscribe() {}, unsubscribe() {}, async stop() {},
      health: () => ({ connected: true, applied: true, stage: "applied", lastError: null, lastAppliedAt: "2026-08-12T10:00:00.000Z", firstGenerationLatencyMs: 8, normalizationDurationMs: 4, rowCount: 10, rowsPerType: { "54": { resourceState: 3, locationState: 2 }, "28": { resourceState: 1, locationState: 1 } }, appliedResourceIds: ["28", "54"], points: [{ x: 101, z: 202 }] }),
    }),
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const active = await runtime.acquire({ regionId: "19", resourceId: "28" });
  const idle = await runtime.acquire({ regionId: "19", resourceId: "54" });
  await idle.release();
  const serialized = JSON.stringify(runtime.health());
  assert.equal(serialized.includes("28"), false, "health must not disclose selected resource IDs");
  assert.equal(serialized.includes("101"), false, "health must not disclose resource coordinates");
  assert.equal(runtime.health().regionalConnectionCount, 1);
  assert.equal(runtime.health().activeResourceSubscriptionCount, 1);
  assert.equal(runtime.health().idleRetainedResourceSubscriptionCount, 1);
  assert.deepEqual(runtime.health().rowsPerSubscription, [2, 5]);
  assert.deepEqual(runtime.health().firstGenerationLatencyMs, { sampleCount: 1, min: 8, max: 8, average: 8 });
  assert.deepEqual(runtime.health().normalizationDurationMs, { sampleCount: 1, min: 4, max: 4, average: 4 });
  assert.equal(runtime.health().reconnectAttemptCount, 0);
  assert.equal(runtime.health().capacityRejectionCount, 0);
  assert.deepEqual(runtime.health().regions[0].subscription, {
    connected: true, applied: true, stage: "applied", lastError: null, lastAppliedAt: "2026-08-12T10:00:00.000Z", firstGenerationLatencyMs: 8, normalizationDurationMs: 4, rowCount: 10, rowsPerSubscription: [2, 5],
  });
  await active.release();
  await runtime.stop();
});

test("runtime health reports aggregate partition states, bytes, and queued cold work", async () => {
  const { runtime, sessions } = runtimeFixture({ regions: ["19"] });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const lease = await runtime.acquire({ regionId: "19", resourceId: "28" });
  assert.deepEqual(runtime.health().partitionCounts, { live: 0, loading: 1, stale: 0, unavailable: 0 });
  assert.equal(runtime.health().queueDepth, 1);

  sessions[0].options.onSnapshot(snapshot("19", "28", 1, [
    { entityId: "100", regionId: "19", resourceId: "28", locationX: 10, locationZ: 20, dimension: "1" },
  ]));
  assert.deepEqual(runtime.health().partitionCounts, { live: 1, loading: 0, stale: 0, unavailable: 0 });
  assert.equal(runtime.health().queueDepth, 0);
  assert.equal(runtime.health().bytesPerSubscription.length, 1);
  assert.ok(runtime.health().bytesPerSubscription[0] > 0);

  sessions[0].options.onFailure("temporary disconnect");
  assert.deepEqual(runtime.health().partitionCounts, { live: 0, loading: 0, stale: 1, unavailable: 0 }, "a live subscription failure retains cached rows as stale");
  await lease.release();
  await runtime.stop();
});

test("runtime health excludes disconnected retained sessions from the regional connection count", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ regions: new Map([["19", { ready: true, port: 4019, database: "relay-region-19", schemaFingerprint: "regional-v1" }]]) }),
    createSession: () => ({
      async start() {}, async subscribe() {}, unsubscribe() {}, async stop() {},
      health: () => ({ connected: false, applied: false, stage: "error", lastError: "disconnected", lastAppliedAt: null, firstGenerationLatencyMs: null, rowCount: 0, rowsPerType: {} }),
    }),
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  assert.equal(runtime.health().regionalConnectionCount, 0);
  await runtime.stop();
});

test("runtime health drops active and idle retained counts after a connected session disconnects", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  let connected = true;
  let fail;
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ regions: new Map([["19", { ready: true, port: 4019, database: "relay-region-19", schemaFingerprint: "regional-v1" }]]) }),
    createSession: (options) => {
      fail = () => { connected = false; options.onFailure("disconnected"); };
      return {
        async start() {}, async subscribe() {}, unsubscribe() {}, async stop() { connected = false; },
        health: () => ({ connected, applied: connected, stage: connected ? "applied" : "error", lastError: connected ? null : "disconnected", lastAppliedAt: null, firstGenerationLatencyMs: null, rowCount: 0, rowsPerType: {} }),
      };
    },
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const active = await runtime.acquire({ regionId: "19", resourceId: "28" });
  const idle = await runtime.acquire({ regionId: "19", resourceId: "54" });
  await idle.release();
  assert.equal(runtime.health().activeResourceSubscriptionCount, 1);
  assert.equal(runtime.health().idleRetainedResourceSubscriptionCount, 1);

  fail();
  assert.equal(runtime.health().activeResourceSubscriptionCount, 0);
  assert.equal(runtime.health().idleRetainedResourceSubscriptionCount, 0);
  await active.release();
  await runtime.stop();
});

test("runtime health excludes failed resource entries from active and idle subscription counts", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ regions: new Map([["19", { ready: true, port: 4019, database: "relay-region-19", schemaFingerprint: "regional-v1" }]]) }),
    createSession: () => ({
      async start() {}, async subscribe() { throw new Error("subscription rejected"); }, unsubscribe() {}, async stop() {},
      health: () => ({ connected: false, applied: false, stage: "error", lastError: "subscription rejected", lastAppliedAt: null, firstGenerationLatencyMs: null, rowCount: 0, rowsPerType: {} }),
    }),
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const lease = await runtime.acquire({ regionId: "19", resourceId: "28" });
  assert.equal(runtime.health().activeResourceSubscriptionCount, 0);
  await lease.release();
  assert.equal(runtime.health().idleRetainedResourceSubscriptionCount, 0);
  await runtime.stop();
});

test("runtime health aggregates latency and reconnect attempts across connected regions", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  let sessionIndex = 0;
  const sessionRecords = [];
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ regions: new Map([
      ["19", { ready: true, port: 4019, database: "relay-region-19", schemaFingerprint: "regional-v1" }],
      ["20", { ready: true, port: 4020, database: "relay-region-20", schemaFingerprint: "regional-v1" }],
    ]) }),
    createSession: (options) => {
      const index = sessionIndex++;
      const session = {
        async start() {}, async subscribe() {}, unsubscribe() {}, async stop() {},
        health: () => ({ connected: true, applied: true, stage: "applied", lastError: null, lastAppliedAt: null, firstGenerationLatencyMs: index === 0 ? 8 : 20, rowCount: 0, rowsPerType: {} }),
        fail: () => options.onFailure("temporary disconnect"),
      };
      sessionRecords.push(session);
      return session;
    },
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] });
  const region19 = await runtime.acquire({ regionId: "19", resourceId: "28" });
  const region20 = await runtime.acquire({ regionId: "20", resourceId: "28" });
  sessionRecords[0].fail();
  sessionRecords[1].fail();
  const health = runtime.health();
  assert.deepEqual(health.firstGenerationLatencyMs, { sampleCount: 2, min: 8, max: 20, average: 14 });
  assert.equal(health.reconnectAttemptCount, 2);
  await region19.release();
  await region20.release();
  await runtime.stop();
});

test("changing the primary resource region does not open or pin empty connections", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const { runtime, sessions } = runtimeFixture();
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "20", activeRegionIds: ["19", "20"] });
  assert.equal(sessions.length, 0);
  assert.deepEqual(runtime.health().pinnedRegionIds, []);
  await runtime.stop();
});

test("leases share canonical resource entries and one live regional connection", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const { runtime, sessions } = runtimeFixture();
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] });
  const first = await runtime.acquire({ regionId: "019", resourceId: "028" });
  const second = await runtime.acquire({ regionId: "19", resourceId: "28" });
  assert.equal(first.key, "19|resource:28");
  assert.equal(second.key, "19|resource:28");
  assert.equal(runtimeModule.mapResourceScopeKey("019", "028"), "19|resource:28");
  assert.deepEqual(sessions[0].subscriptions, [{ resourceId: "28", generation: 1 }]);
  const readyFirst = first.waitForSnapshot(1_000);
  const readySecond = second.waitForSnapshot(1_000);
  const empty = snapshot("19", "28", 1);
  await sessions[0].options.onSnapshot(empty);
  assert.equal(await readyFirst, empty, "valid empty generations are ready snapshots");
  assert.equal(await readySecond, empty);
  assert.equal(first.state().status, "live");
  assert.equal(second.state().snapshot, empty);

  const another = await runtime.acquire({ regionId: "19", resourceId: "54" });
  assert.equal(sessions.length, 1, "selected resources share the live regional connection");
  assert.deepEqual(sessions[0].subscriptions, [
    { resourceId: "28", generation: 1 },
    { resourceId: "54", generation: 1 },
  ]);
  await first.release();
  await second.release();
  await another.release();
  await runtime.stop();
});

test("accepted resource generations retain the live SDK subscription and binary partition", async () => {
  const { runtime, sessions } = runtimeFixture({ regions: ["19"] });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const first = await runtime.acquire({ regionId: "19", resourceId: "28" });

  sessions[0].options.onSnapshot(snapshot("19", "28", 1, [
    { entityId: "100", regionId: "19", resourceId: "28", locationX: 10, locationZ: 20, dimension: "1" },
  ]));
  await Promise.resolve();

  assert.equal(sessions[0].stopped, false, "active resources keep event-driven subscriptions attached");
  assert.equal(runtime.health().regionalConnectionCount, 1);
  assert.equal(first.state().status, "live");
  assert.equal(first.current()?.pointCount, 1);

  const second = await runtime.acquire({ regionId: "19", resourceId: "54" });
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].subscriptions, [
    { resourceId: "28", generation: 1 },
    { resourceId: "54", generation: 1 },
  ]);

  await first.release();
  await second.release();
  await runtime.stop();
});

test("active resource leases do not schedule polling hydration", async () => {
  const clock = manualClock();
  const { runtime, sessions } = runtimeFixture({ regions: ["19"], clock });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const lease = await runtime.acquire({ regionId: "19", resourceId: "28" });
  sessions[0].options.onSnapshot(snapshot("19", "28", 1, [{ entityId: "first" }]));
  await Promise.resolve();

  await clock.advance(300_000);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].subscriptions, [{ resourceId: "28", generation: 1 }]);
  assert.equal(sessions[0].stopped, false);
  assert.equal(lease.current()?.generation, "1");
  await lease.release();
  await runtime.stop();
});

test("multiple active resources stay on one event-driven regional session", async () => {
  const clock = manualClock();
  const { runtime, sessions } = runtimeFixture({ regions: ["19"], clock });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const first = await runtime.acquire({ regionId: "19", resourceId: "28" });
  const second = await runtime.acquire({ regionId: "19", resourceId: "54" });
  sessions[0].options.onSnapshot(snapshot("19", "28", 1, [{ entityId: "first" }]));
  sessions[0].options.onSnapshot(snapshot("19", "54", 1, [{ entityId: "second" }]));
  await Promise.resolve();

  await clock.advance(300_000);
  assert.equal(sessions.length, 1);
  assert.deepEqual([...sessions[0].subscriptions].sort((left, right) => Number(left.resourceId) - Number(right.resourceId)), [
    { resourceId: "28", generation: 1 },
    { resourceId: "54", generation: 1 },
  ]);

  await first.release();
  await second.release();
  await runtime.stop();
});

test("accepted resource generations notify the runtime owner", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const events = [];
  const sessions = [];
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ regions: new Map([["19", { ready: true, port: 4019, database: "relay-region-19", schemaFingerprint: "regional-v1" }]]) }),
    createSession: (options) => {
      const session = {
        options,
        async start() {}, async subscribe() {}, unsubscribe() {}, async stop() {},
        health: () => ({ connected: true, applied: true, stage: "applied", rowCount: 0, firstGenerationLatencyMs: 1, lastAppliedAt: null, lastError: null }),
      };
      sessions.push(session);
      return session;
    },
    onGeneration: (generation) => events.push(generation),
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  await runtime.acquire({ regionId: "19", resourceId: "28" });
  const accepted = snapshot("19", "28", 1);
  await sessions[0].options.onSnapshot(accepted);
  assert.deepEqual(events, [accepted]);
  await runtime.stop();
});

test("accepted snapshots encode once, remain subscribed, and expose warm binary state", async () => {
  const runtimeEvents = [];
  const { runtime, sessions } = runtimeFixture({ regions: ["19"] });
  runtimeEvents.push(...[]);
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const lease = await runtime.acquire({ regionId: "19", resourceId: "28" });
  const notices = [];
  const unsubscribe = lease.subscribe((event) => notices.push(event));
  sessions[0].options.onSnapshot({
    ...snapshot("19", "28", 1),
    packedCoordinates: Uint32Array.of(packResourceCoordinate(10, 20)),
  });
  await Promise.resolve();

  assert.equal(sessions[0].stopped, false, "an active lease keeps its event-driven regional session alive");
  assert.equal(lease.current().generation, "1");
  assert.equal(lease.current().pointCount, 1);
  assert.equal(lease.current().encodedBytes, 48);
  assert.deepEqual(notices.map(({ type }) => type), ["partition-ready"]);
  unsubscribe();
  await lease.release();
  await runtime.stop();
});

test("a packed delta advances only its partition and preserves the previous generation", async () => {
  const { runtime, sessions } = runtimeFixture({ regions: ["19"] });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const bush = await runtime.acquire({ regionId: "19", resourceId: "2" });
  const ferns = await runtime.acquire({ regionId: "19", resourceId: "125" });
  sessions[0].options.onSnapshot({ ...snapshot("19", "2", 1), packedCoordinates: Uint32Array.of(packResourceCoordinate(1, 1)) });
  sessions[0].options.onSnapshot({ ...snapshot("19", "125", 1), packedCoordinates: Uint32Array.of(packResourceCoordinate(2, 2)) });
  const events = [];
  bush.subscribe((event) => events.push(event));
  events.length = 0;

  sessions[0].options.onDelta({
    regionId: "19",
    resourceId: "2",
    additions: Uint32Array.of(packResourceCoordinate(3, 3)),
    removals: Uint32Array.of(packResourceCoordinate(1, 1)),
    receivedAt: "2026-08-12T10:00:01.000Z",
  });
  await Promise.resolve();

  assert.equal(bush.current().generation, "2");
  assert.deepEqual([...bush.current().coordinates], [packResourceCoordinate(3, 3)]);
  assert.equal(ferns.current().generation, "1");
  assert.deepEqual(events.map(({ type, baseGeneration, generation }) => ({ type, baseGeneration, generation })), [
    { type: "partition-delta", baseGeneration: "1", generation: "2" },
  ]);
  await bush.release();
  await ferns.release();
  await runtime.stop();
});

test("warm reacquisition is ready immediately while the live subscription rehydrates", async () => {
  const clock = manualClock();
  const { runtime, sessions } = runtimeFixture({ regions: ["19"], clock });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const first = await runtime.acquire({ regionId: "19", resourceId: "28" });
  sessions[0].options.onSnapshot({ ...snapshot("19", "28", 1), packedCoordinates: Uint32Array.of(packResourceCoordinate(8, 9)) });
  await first.release();
  await clock.advance(60_000);

  const warm = await runtime.acquire({ regionId: "19", resourceId: "28" });
  assert.equal(warm.current().generation, "1");
  assert.deepEqual(sessions[0].subscriptions.at(-1), { resourceId: "28", generation: 2 });
  const immediate = [];
  warm.subscribe((event) => immediate.push(event));
  assert.deepEqual(immediate.map(({ type }) => type), ["partition-ready"]);
  await warm.release();
  await runtime.stop();
});

test("stop during a regional session open rejects the acquisition and stops the late session", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  let resolveRegion20Start;
  const region20Start = new Promise((resolve) => { resolveRegion20Start = resolve; });
  const sessions = [];
  const generations = [];
  const topology = (regionId) => ({ regions: new Map([[regionId, {
    ready: true,
    port: 4000 + Number(regionId),
    database: `relay-region-${regionId}`,
    schemaFingerprint: "regional-v1",
  }]]) });
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ regions: new Map([
      ...topology("19").regions,
      ...topology("20").regions,
    ]) }),
    createSession: (options) => {
      const session = {
        options, stopped: false,
        async start(config) { if (config.regionId === "20") await region20Start; }, async subscribe() {}, unsubscribe() {},
        health: () => ({ connected: !session.stopped, applied: false, stage: session.stopped ? "stopped" : "subscribed", rowCount: 0, firstGenerationLatencyMs: null, lastAppliedAt: null, lastError: null }),
        async stop() { session.stopped = true; },
      };
      sessions.push(session);
      return session;
    },
    onGeneration: (snapshot) => generations.push(snapshot),
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] });
  const acquiring = runtime.acquire({ regionId: "20", resourceId: "28" });
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = runtime.stop();
  resolveRegion20Start();
  await assert.rejects(acquiring, /stopped|configuration|ownership/i);
  await stopping;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].stopped, true);
  await sessions[0].options.onSnapshot(snapshot("20", "28", 1, [{ entityId: "late" }]));
  assert.deepEqual(generations, []);
  assert.deepEqual(runtime.health().regions, []);
});

test("zero leases retain a warm resource for 60 seconds, then close its idle region", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const { runtime, sessions, clock } = runtimeFixture();
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] });
  const first = await runtime.acquire({ regionId: "20", resourceId: "28" });
  assert.equal(sessions.length, 1);
  await first.release();
  await clock.advance(59_999);
  const warm = await runtime.acquire({ regionId: "20", resourceId: "28" });
  assert.equal(warm.state().status, "loading");
  assert.equal(sessions[0].subscriptions.length, 1, "warm reacquisition cannot resubscribe");
  await warm.release();
  await clock.advance(60_000);
  assert.deepEqual(sessions[0].unsubscribed, ["28"]);
  assert.equal(sessions[0].stopped, false, "the region gets its own idle window after resource expiry");
  await clock.advance(60_000);
  assert.equal(sessions[0].stopped, true);
  assert.equal(runtime.health().regionalConnectionCount, 0);
  await runtime.stop();
});

test("failed regions reconnect with bounded backoff, restore warm entries, and preserve stale snapshots", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const generations = [];
  const { runtime, sessions, clock } = runtimeFixture({ onGeneration: (generation) => generations.push(generation) });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const lease = await runtime.acquire({ regionId: "19", resourceId: "28" });
  const prior = snapshot("19", "28", 7, [{ entityId: "x" }]);
  await sessions[0].options.onSnapshot(prior);
  const pending = await runtime.acquire({ regionId: "19", resourceId: "54" });
  sessions[0].options.onFailure("socket closed");
  assert.equal(lease.state().status, "stale");
  assert.equal(lease.state().snapshot, prior);
  await clock.advance(999);
  assert.equal(sessions.length, 1);
  await clock.advance(1);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].starts[0].generation, 8);
  assert.deepEqual(sessions[1].subscriptions, [{ resourceId: "28", generation: 8 }, { resourceId: "54", generation: 1 }]);

  sessions[1].options.onFailure("schema fingerprint mismatch");
  await Promise.resolve();
  await clock.advance(1_000);
  assert.equal(sessions[1].stopped, true, "schema mismatch must detach and stop the active session");
  assert.equal(lease.state().status, "stale", "a schema mismatch retains last usable rows as stale");
  assert.equal(lease.state().snapshot, prior);
  await sessions[1].options.onSnapshot(snapshot("19", "28", 8, [{ entityId: "late" }]));
  assert.equal(lease.state().snapshot, prior, "a detached mismatched session cannot publish a late snapshot");
  assert.deepEqual(generations, [prior], "late snapshots cannot emit a generation notification");
  await pending.release();
  await runtime.stop();
});

test("a failed resource retries without restarting or staling healthy siblings", async () => {
  const { runtime, sessions, clock } = runtimeFixture({ regions: ["19"] });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const birch = await runtime.acquire({ regionId: "19", resourceId: "20" });
  const bush = await runtime.acquire({ regionId: "19", resourceId: "28" });
  await sessions[0].options.onSnapshot(snapshot("19", "28", 1, [{ entityId: "bush" }]));

  sessions[0].options.onResourceFailure("20", "Relay map resource 20 subscription did not apply within 60000ms");

  assert.equal(birch.state().status, "unavailable");
  assert.equal(bush.state().status, "live");
  await clock.advance(1_000);
  assert.equal(sessions.length, 1, "a resource-specific failure must retain the regional connection");
  assert.deepEqual(sessions[0].subscriptions, [
    { resourceId: "20", generation: 1 },
    { resourceId: "28", generation: 1 },
    { resourceId: "20", generation: 1 },
  ]);
  await birch.release();
  await bush.release();
  await runtime.stop();
});

test("an immediate resource subscription failure retries after acquisition creates its lease", async () => {
  let attempts = 0;
  const { runtime, sessions, clock } = runtimeFixture({
    regions: ["19"],
    subscribe: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("subscription builder failed");
    },
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });

  const lease = await runtime.acquire({ regionId: "19", resourceId: "20" });
  assert.equal(lease.state().status, "unavailable");
  await clock.advance(1_000);

  assert.equal(attempts, 2);
  assert.deepEqual(sessions[0].subscriptions, [
    { resourceId: "20", generation: 1 },
    { resourceId: "20", generation: 1 },
  ]);
  await lease.release();
  await runtime.stop();
});

test("a failed cold non-primary region retries after its first lease is created", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  let failed = false;
  const { runtime, sessions, clock } = runtimeFixture({
    start: async (config) => {
      if (config.regionId === "20" && !failed) {
        failed = true;
        throw new Error("temporary region connection failure");
      }
    },
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] });
  const lease = await runtime.acquire({ regionId: "20", resourceId: "28" });
  assert.equal(lease.state().status, "unavailable");
  await clock.advance(1_000);
  assert.equal(sessions.length, 2, "the first lease must make a failed lazy region reconnectable");
  assert.deepEqual(sessions[1].subscriptions, [{ resourceId: "28", generation: 1 }]);
  await runtime.stop();
});

test("the default runtime can lease every configured Relay-ready region", async () => {
  const regionIds = ["1", "2", "3", "4", "5"];
  const { runtime } = runtimeFixture({ regions: regionIds });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "1", activeRegionIds: regionIds });

  const leases = await Promise.all(regionIds.map((regionId) => runtime.acquire({ regionId, resourceId: "28" })));

  assert.equal(leases.length, 5);
  assert.equal(runtime.health().regionalConnectionCount, 5);
  await Promise.all(leases.map((lease) => lease.release()));
  await runtime.stop();
});

test("the default runtime admits the complete validated 16 by 13 resource scope", async () => {
  const regionIds = Array.from({ length: 13 }, (_, index) => String(index + 1));
  const resourceIds = Array.from({ length: 16 }, (_, index) => String(index + 1));
  const { runtime } = runtimeFixture({ regions: regionIds });
  const leases = [];
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "1", activeRegionIds: regionIds });

  try {
    for (const resourceId of resourceIds) {
      for (const regionId of regionIds) leases.push(await runtime.acquire({ regionId, resourceId }));
    }
    assert.equal(leases.length, 208);
    assert.equal(runtime.health().capacityRejectionCount, 0);
  } finally {
    await Promise.all(leases.map((lease) => lease.release()));
    await runtime.stop();
  }
});

test("configuration, capacity, and cold-start limits reject only cold creation", async () => {
  assert.ok(runtimeModule, "map-resource runtime module must exist");
  const clock = manualClock();
  const { runtime } = runtimeFixture({ clock });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] });
  await assert.rejects(runtime.acquire({ regionId: "21", resourceId: "1" }), /not configured/i);
  await runtime.stop();

  const perRegion = runtimeFixture();
  const constrained = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => perRegion.topology,
    createSession: (options) => perRegion.sessions.push({ options, async start() {}, async subscribe() {}, unsubscribe() {}, health() { return {}; }, async stop() {} }) && perRegion.sessions.at(-1),
    maxRegions: 1, maxResourceTypesPerRegion: 1,
  });
  await constrained.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19", "20"] });
  await constrained.acquire({ regionId: "19", resourceId: "1" });
  await assert.rejects(constrained.acquire({ regionId: "19", resourceId: "2" }), /resource.*capacity/i);
  await assert.rejects(constrained.acquire({ regionId: "20", resourceId: "1" }), /region.*capacity/i);
  assert.equal(constrained.health().capacityRejectionCount, 2);
  await constrained.stop();

  const rate = runtimeFixture({ clock });
  const limited = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => rate.topology,
    createSession: (options) => rate.sessions.push({ options, async start() {}, async subscribe() {}, unsubscribe() {}, health() { return {}; }, async stop() {} }) && rate.sessions.at(-1),
    now: clock.now, setTimer: (callback, delay) => clock.setTimer(callback, delay), clearTimer: (timer) => clock.clearTimer(timer),
    maxResourceTypesPerRegion: 128,
    maxColdStartsPerWindow: 64,
  });
  await limited.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const leases = [];
  for (let resourceId = 1; resourceId <= 64; resourceId += 1) leases.push(await limited.acquire({ regionId: "19", resourceId: String(resourceId) }));
  await assert.rejects(limited.acquire({ regionId: "19", resourceId: "65" }), /cold-start/i);
  assert.equal(limited.health().capacityRejectionCount, 1);
  await leases[0].release();
  await limited.acquire({ regionId: "19", resourceId: "1" });
  await limited.stop();
});

test("accepted runtime snapshots expose one sorted compact partition for zero-copy paging", async () => {
  const { runtime, sessions } = runtimeFixture({ regions: ["19"] });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const lease = await runtime.acquire({ regionId: "19", resourceId: "130" });
  sessions[0].options.onSnapshot(snapshot("19", "130", 1, [
    { entityId: "1", regionId: "19", resourceId: "130", locationX: 10, locationZ: 20, dimension: "1" },
    { entityId: "2", regionId: "19", resourceId: "130", locationX: 30, locationZ: 40, dimension: "1" },
  ]));

  assert.deepEqual(lease.state().snapshot.compactResources, [
    ["1", "19", "130", 10, 20],
    ["2", "19", "130", 30, 40],
  ]);
  await lease.release();
  await runtime.stop();
});

test("cold admission overloads identify a retry delay instead of permanent unavailability", async () => {
  const clock = manualClock();
  const fixture = runtimeFixture({ regions: ["19"], clock });
  const runtime = new runtimeModule.RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => fixture.topology,
    createSession: (options) => ({ options, async start() {}, async subscribe() {}, unsubscribe() {}, health() { return {}; }, async stop() {} }),
    now: clock.now,
    setTimer: (callback, delay) => clock.setTimer(callback, delay),
    clearTimer: (timer) => clock.clearTimer(timer),
    maxResourceTypesPerRegion: 16,
    maxColdStartsPerWindow: 1,
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  await runtime.acquire({ regionId: "19", resourceId: "1" });
  await assert.rejects(runtime.acquire({ regionId: "19", resourceId: "2" }), (error) => (
    error?.statusCode === 429 && error?.retryAfterSeconds === 60 && /cold-start/i.test(error.message)
  ));
  await runtime.stop();
});
