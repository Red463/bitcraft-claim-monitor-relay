import assert from "node:assert/strict";
import test from "node:test";
import { collectMapLiveEvidence } from "../scripts/map-spatial-live-evidence.mjs";

const config = {
  uri: "wss://relay.example", database: "region-19", schemaFingerprint: "regional-v1", generation: 1,
  manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
  scope: { claimId: "123", regionId: "19", playerIds: [], resourceIds: ["54"], enemyTypes: [] },
};

// Stub only the remote transport; use real sessions, queries and normalization.
function transport({ failure, apply = true, missingLocation = false } = {}) {
  const queries = [];
  let disconnects = 0, unsubscribes = 0;
  const table = rows => ({ iter: () => rows.values() });
  const connection = {
    db: {
      resourceState: table([{ entityId: 9007199254740993n, resourceId: 54 }, { entityId: 2n, resourceId: 28 }]),
      locationState: table(missingLocation ? [] : [{ entityId: 9007199254740993n, x: 100, z: 200, dimension: 1 }, { entityId: 2n, x: 300, z: 400, dimension: 1 }]),
      waystoneState: table([]), enemyState: table([]), mobileEntityState: table([]),
    },
    subscriptionBuilder() {
      let onApplied, onError;
      return {
        onApplied(callback) { onApplied = callback; return this; },
        onError(callback) { onError = callback; return this; },
        subscribe(sql) {
          if (!sql.length) throw new Error("Subscriptions must have at least one query");
          queries.push(...sql);
          if (apply) queueMicrotask(() => failure ? onError(null, new Error(failure)) : onApplied());
          return { unsubscribe() { unsubscribes++; } };
        },
      };
    },
    disconnect() { disconnects++; },
  };
  return {
    queries, disconnects: () => disconnects, unsubscribes: () => unsubscribes,
    loadBindings: async () => ({ DbConnection: { builder() {
      let connected;
      return {
        withUri() { return this; }, withDatabaseName() { return this; }, withLightMode() { return this; },
        onConnect(callback) { connected = callback; return this; }, onConnectError() { return this; }, onDisconnect() { return this; },
        build() { connected(connection); return connection; },
      };
    } } }),
  };
}

test("workflow resource-only scope verifies the resource/location join without an empty spatial subscription", async () => {
  const relay = transport();
  const result = await collectMapLiveEvidence(config, { loadBindings: relay.loadBindings, timeoutMs: 5000 });
  assert.deepEqual(result.data.resources.map(({ entityId, resourceId, locationX, locationZ }) => ({ entityId, resourceId, locationX, locationZ })), [
    { entityId: "9007199254740993", resourceId: "54", locationX: 100, locationZ: 200 },
  ]);
  assert.equal(relay.queries.length, 2);
  assert.ok(relay.queries.every(sql => sql.includes("JOIN location_state") && sql.includes("resource_id = 54")));
  assert.equal(relay.disconnects(), 1);
  assert.equal(relay.unsubscribes(), 1);
});

test("resource smoke check waits for every requested type", async () => {
  const relay = transport();
  const result = await collectMapLiveEvidence({ ...config, scope: { ...config.scope, resourceIds: ["54", "28"] } }, { loadBindings: relay.loadBindings, timeoutMs: 5000 });
  assert.deepEqual(result.data.resources.map(row => row.resourceId).sort(), ["28", "54"]);
  assert.equal(relay.unsubscribes(), 2);
});

for (const [name, options, message] of [
  ["subscription failure", { failure: "query rejected" }, /query rejected/],
  ["incomplete resource join", { missingLocation: true }, /location|incomplete/i],
  ["no applied generation", { apply: false }, /Timed out/],
]) test(`resource smoke check fails closed on ${name} and disconnects`, async () => {
  const relay = transport(options);
  await assert.rejects(collectMapLiveEvidence(config, { loadBindings: relay.loadBindings, timeoutMs: options.apply === false ? 80 : 5000 }), message);
  assert.equal(relay.disconnects(), 1);
});

test("mixed resource and player scopes verify both sessions and close both", async () => {
  const relay = transport();
  const result = await collectMapLiveEvidence({ ...config, scope: { ...config.scope, playerIds: ["456"] } }, { loadBindings: relay.loadBindings, timeoutMs: 5000 });
  assert.equal(result.data.resources.length, 1);
  assert.ok(relay.queries.some(sql => sql.includes("mobile_entity_state") && sql.includes("456")));
  assert.equal(relay.disconnects(), 2);
});

test("an empty smoke scope and mismatched schema fail before connecting", async () => {
  const relay = transport();
  await assert.rejects(collectMapLiveEvidence({ ...config, scope: { ...config.scope, resourceIds: [] } }, { loadBindings: relay.loadBindings }), /Select/);
  await assert.rejects(collectMapLiveEvidence({ ...config, schemaFingerprint: "wrong" }, { loadBindings: relay.loadBindings }), /fingerprint/i);
  assert.equal(relay.queries.length, 0);
});

test("spatial bindings completing after timeout cannot leave a connection open", async () => {
  const relay = transport();
  let finishLoading;
  const pending = new Promise(resolve => { finishLoading = resolve; });
  await assert.rejects(collectMapLiveEvidence({ ...config, scope: { ...config.scope, resourceIds: [], playerIds: ["456"] } }, {
    loadBindings: () => pending, timeoutMs: 30,
  }), /Timed out/);
  finishLoading(await relay.loadBindings());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(relay.disconnects(), 1);
});
