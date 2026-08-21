import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { RelayMapResourceRegionSession } from "../src/server/game-data/mapResourceRegionSession.ts";
import { RelayMapResourceRuntime } from "../src/server/game-data/mapResourceRuntime.ts";

const routeModule = await import("../src/server/game-data/gameDataRoute.ts");
const snapshotModule = await import("../src/server/mapSnapshot.mjs");

function resourceSnapshot(regionId, resourceId, generation, resources = [], warnings = []) {
  return {
    data: { regionId, resourceId, resources }, warnings, regionId, resourceId, generation,
    receivedAt: `2026-08-12T10:00:0${generation}.000Z`,
  };
}

function lease(key, status, snapshot = null, warning = null) {
  return {
    key,
    state: () => ({ status, snapshot, warning }),
    waitForSnapshot: async () => snapshot,
    release: async () => {},
  };
}

function liveTable(rows) {
  const listeners = [];
  return {
    iter: () => rows.values(),
    onInsert: (callback) => listeners.push(callback),
    onUpdate: (callback) => listeners.push(callback),
    onDelete: (callback) => listeners.push(callback),
    removeOnInsert() {}, removeOnUpdate() {}, removeOnDelete() {},
    emit: () => listeners.forEach((callback) => callback()),
  };
}

test("resource lease inputs are Cartesian and independent of player selections", () => {
  assert.equal(typeof routeModule.mapResourceLeaseInputs, "function");
  const base = { regionIds: ["19", "24"], layers: ["players", "resources"], resourceIds: ["28", "54"], enemyTypes: [], playerIds: ["101"] };
  assert.deepEqual(routeModule.mapResourceLeaseInputs(base), [
    { regionId: "19", resourceId: "28" },
    { regionId: "19", resourceId: "54" },
    { regionId: "24", resourceId: "28" },
    { regionId: "24", resourceId: "54" },
  ]);
  assert.deepEqual(routeModule.mapResourceLeaseInputs({ ...base, playerIds: ["202", "303"] }), routeModule.mapResourceLeaseInputs(base));
});

test("spatial lease inputs collect players across their live regions while enemies stay operationally scoped", () => {
  assert.equal(typeof routeModule.mapSpatialLeaseInputs, "function");
  assert.deepEqual(routeModule.mapSpatialLeaseInputs({
    regionIds: ["19"],
    playerRegionIds: ["19", "24"],
    layers: ["enemies", "players"],
    resourceIds: [],
    enemyTypes: ["8"],
    playerIds: ["101"],
  }, { playerIds: ["101"], enemyTypes: ["8"] }), [
    { regionId: "19", playerIds: ["101"], enemyTypes: ["8"], includeClaims: false },
    { regionId: "24", playerIds: ["101"], enemyTypes: [], includeClaims: false },
  ]);
});

test("spatial lease inputs collect claims in every selected operational region", () => {
  assert.deepEqual(routeModule.mapSpatialLeaseInputs({
    regionIds: ["17", "19"], playerRegionIds: [], layers: ["claims"], resourceIds: [], enemyTypes: [], playerIds: [],
  }, { playerIds: [], enemyTypes: [] }), [
    { regionId: "17", playerIds: [], enemyTypes: [], includeClaims: true },
    { regionId: "19", playerIds: [], enemyTypes: [], includeClaims: true },
  ]);
});

test("claim-only spatial leases hydrate in the background without delaying the operational snapshot", () => {
  assert.equal(typeof routeModule.mapSpatialLeaseNeedsInitialWait, "function");
  assert.equal(routeModule.mapSpatialLeaseNeedsInitialWait({ includeClaims: true, playerIds: [], enemyTypes: [] }), false);
  assert.equal(routeModule.mapSpatialLeaseNeedsInitialWait({ includeClaims: true, playerIds: ["101"], enemyTypes: [] }), true);
  assert.equal(routeModule.mapSpatialLeaseNeedsInitialWait({ includeClaims: false, playerIds: [], enemyTypes: ["8"] }), true);
});

test("resource lease composition preserves warm rows and loading readiness", () => {
  assert.equal(typeof routeModule.combineMapResourceLeases, "function");
  const warm = resourceSnapshot("19", "28", 7, [{ entityId: "100", resourceId: "28", regionId: "19", locationX: 10, locationZ: 20, dimension: "1" }]);
  const combined = routeModule.combineMapResourceLeases([
    lease("19|resource:28", "live", warm),
    lease("24|resource:28", "loading"),
  ]);
  assert.deepEqual(combined.data.resources, warm.data.resources);
  assert.equal(combined.generation, 7);
  assert.equal(combined.provenance.receivedAt, warm.receivedAt);
  assert.equal(combined.freshness, "live");
  assert.deepEqual(combined.readyKeys, ["19|resource:28"]);
  assert.deepEqual(combined.loadingKeys, ["24|resource:28"]);
  assert.deepEqual(combined.unavailableKeys, []);
  assert.deepEqual(combined.compactPartitions.get("19|resource:28"), [["100", "19", "28", 10, 20]]);
});

test("resource route maps transient admission pressure to retryable HTTP 429", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /mapResourceAdmissionResponse/);
  assert.match(server, /"Retry-After"/);
  assert.match(server, /statusCode:\s*429/);
});

test("resource lease composition retains snapshot warnings and marks usable rows partial", () => {
  const warned = resourceSnapshot(
    "19",
    "28",
    8,
    [{ entityId: "100", resourceId: "28", regionId: "19" }],
    ["Resource 100 has incomplete optional metadata."],
  );
  const combined = routeModule.combineMapResourceLeases([
    lease("19|resource:28", "live", warned, null),
  ]);
  assert.equal(combined.data.resources.length, 1);
  assert.deepEqual(combined.warnings, ["Resource 100 has incomplete optional metadata."]);
  assert.equal(combined.freshness, "partial");
});

test("incomplete Relay generations retain last-good rows, notify the scoped collection, and recover on completion", async () => {
  const resourceRows = [{ entityId: 1n, resourceId: 28 }];
  const locationRows = [{ entityId: 1n, x: 100, z: 200, dimension: 1 }];
  const resourceState = liveTable(resourceRows);
  const locationState = liveTable(locationRows);
  let applied = () => {};
  const connection = {
    db: { resourceState, locationState },
    subscriptionBuilder: () => ({
      onApplied(callback) { applied = callback; return this; },
      onError() { return this; },
      subscribe() { return { unsubscribe() {} }; },
    }),
    disconnect() {},
  };
  const bindings = { DbConnection: { builder: () => ({
    withUri() { return this; }, withDatabaseName() { return this; },
    withLightMode() { return this; },
    onConnect(callback) { this.connected = callback; return this; },
    onConnectError() { return this; }, onDisconnect() { return this; },
    build() { this.connected(connection); return connection; },
  }) } };
  const events = [];
  const runtime = new RelayMapResourceRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => ({ regions: new Map([["19", { ready: true, port: 4019, database: "relay-region-19", schemaFingerprint: "regional-v1" }]]) }),
    createSession: (options) => new RelayMapResourceRegionSession({
      ...options,
      loadBindings: async () => bindings,
      rebuildDelayMs: 1,
      now: () => new Date("2026-08-12T10:00:00.000Z"),
    }),
    refreshMs: 1,
    onGeneration: (event) => events.push(event),
  });
  await runtime.reconcile({ relayBaseUrl: "https://relay.example", primaryRegionId: "19", activeRegionIds: ["19"] });
  const activeLease = await runtime.acquire({ regionId: "19", resourceId: "28" });
  applied();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(activeLease.state().status, "live");

  resourceRows.push({ entityId: 2n, resourceId: 28 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  applied();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const degraded = routeModule.combineMapResourceLeases([activeLease]);
  assert.equal(activeLease.state().status, "stale");
  assert.deepEqual(degraded.data.resources.map((row) => row.entityId), ["1"]);
  assert.equal(degraded.freshness, "stale");
  assert.match(degraded.warnings.join(" "), /resource 2.*location/i);
  assert.equal(events.length, 2, "the incomplete status must trigger a scoped refetch notification");
  assert.deepEqual(events[1], {
    regionId: "19", resourceId: "28", generation: 1,
    receivedAt: "2026-08-12T10:00:00.000Z",
  });

  locationRows.push({ entityId: 2n, x: 101, z: 201, dimension: 1 });
  locationState.emit();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const recovered = routeModule.combineMapResourceLeases([activeLease]);
  assert.equal(activeLease.state().status, "live");
  assert.equal(recovered.freshness, "live");
  assert.deepEqual(recovered.data.resources.map((row) => row.entityId), ["1", "2"]);
  assert.equal(events.length, 3, "the complete generation must trigger the next scoped refetch");
  await activeLease.release();
  await runtime.stop();
});

test("resource-only loading snapshots remain successful HTTP responses", () => {
  assert.equal(typeof routeModule.mapSnapshotStatusCode, "function");
  assert.equal(routeModule.mapSnapshotStatusCode({
    scope: { layers: ["resources"] },
    layerAvailability: { resources: { available: false, status: "loading", reason: "Loading." } },
    regionClaims: null, market: null, empires: null, spatial: null,
    resourceCollection: { requestedKeys: ["19|resource:28"], readyKeys: [], loadingKeys: ["19|resource:28"], unavailableKeys: [] },
  }), 200);
  assert.equal(routeModule.mapSnapshotStatusCode({
    scope: { layers: ["resources"] },
    layerAvailability: { resources: { available: false, status: "unavailable", reason: "Unavailable." } },
    regionClaims: { data: { claims: [] } }, market: { data: { marketplaces: [] } }, empires: { data: { settlements: [] } }, spatial: null,
    resourceCollection: { requestedKeys: ["19|resource:28"], readyKeys: [], loadingKeys: [], unavailableKeys: ["19|resource:28"] },
  }), 503);
});

test("claims-only snapshots accept the selected region spatial source", () => {
  assert.equal(routeModule.mapSnapshotStatusCode({
    scope: { layers: ["claims"] },
    layerAvailability: { claims: { available: true, status: "live", reason: null } },
    regionClaims: null,
    market: null,
    empires: null,
    spatial: { data: { claims: [{ entityId: "1", regionId: "17" }] } },
    resourceCollection: null,
  }), 200);
});

test("map event generation domains are the exact requested-layer dependencies in canonical order", () => {
  assert.equal(typeof routeModule.mapGenerationDomainsForLayers, "function");
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers([
    "resources", "players", "claim-areas", "claims", "markets", "waystones",
    "watchtowers", "empire-territory", "empire-settlements", "enemies", "roads", "claims",
  ]), [
    "members",
    "players",
    "market",
    "region-claims",
    "empires",
    "map-spatial",
    "map-resources",
  ]);
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers(["claims"]), ["region-claims", "map-spatial"]);
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers(["markets"]), ["market"]);
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers(["waystones"]), ["region-claims"]);
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers(["empire-settlements", "empire-territory", "watchtowers"]), ["empires"]);
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers(["players"]), ["members", "players", "map-spatial"]);
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers(["resources"]), ["map-resources"]);
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers(["enemies"]), ["map-spatial"]);
  assert.deepEqual(routeModule.mapGenerationDomainsForLayers(["roads", "claim-areas"]), []);
});

test("map resource SSE changes reach only listeners for the selected keys", () => {
  assert.equal(typeof routeModule.generationDomainsForListener, "function");
  const event = { changedDomains: ["map-resources"], mapResourceScopeKey: "19|resource:28" };
  const listener = { domains: new Set(["map-resources"]), mapResourceScopeKeys: new Set(["19|resource:28"]) };
  assert.deepEqual(routeModule.generationDomainsForListener(event, listener), ["map-resources"]);
  assert.deepEqual(routeModule.generationDomainsForListener(event, { ...listener, mapResourceScopeKeys: new Set(["19|resource:54"]) }), []);
  assert.deepEqual(routeModule.generationDomainsForListener({ ...event, mapResourceScopeKey: "24|resource:28" }, listener), []);
  assert.deepEqual(routeModule.generationDomainsForListener({ changedDomains: ["map-resources"] }, listener), []);
});

test("public resource generation events identify only the changed resource partition", () => {
  assert.equal(typeof routeModule.publicGenerationEvent, "function");
  const serialized = JSON.stringify(routeModule.publicGenerationEvent({
    claimId: "999",
    generation: 7,
    generatedAt: "2026-08-12T10:00:00.000Z",
    changedDomains: ["map-resources"],
    mapResourceScopeKey: "19|resource:28",
    mapSpatialScopeKey: "999|19|players:101",
  }, ["map-resources"]));
  assert.equal(serialized.includes("mapResourceScopeKey"), true);
  assert.equal(serialized.includes("mapSpatialScopeKey"), false);
  assert.deepEqual(JSON.parse(serialized), {
    claimId: "999",
    generation: 7,
    generatedAt: "2026-08-12T10:00:00.000Z",
    changedDomains: ["map-resources"],
    mapResourceScopeKey: "19|resource:28",
  });
});

test("map leases release once on request close, response completion, or event-stream close", async () => {
  assert.equal(typeof routeModule.bindMapLeaseRelease, "function");
  for (const event of ["request-close", "response-finish", "response-close"]) {
    const request = new EventEmitter();
    const response = new EventEmitter();
    let releases = 0;
    const release = routeModule.bindMapLeaseRelease(request, response, async () => { releases += 1; });
    if (event === "request-close") request.emit("close");
    if (event === "response-finish") response.emit("finish");
    if (event === "response-close") response.emit("close");
    await release();
    request.emit("close");
    response.emit("finish");
    response.emit("close");
    assert.equal(releases, 1, event);
  }
});

test("a lease acquired after request close is released before it can enter the route collection", async () => {
  assert.equal(typeof routeModule.acquireMapLeaseUnlessClosed, "function");
  let resolveAcquire;
  let releases = 0;
  const acquired = routeModule.acquireMapLeaseUnlessClosed(
    () => new Promise((resolve) => { resolveAcquire = resolve; }),
    () => true,
    "Map request closed during resource scope acquisition.",
  );
  resolveAcquire({ release: async () => { releases += 1; } });
  await assert.rejects(acquired, /request closed/i);
  assert.equal(releases, 1);
});

test("public resource health exposes aggregate counts and latency without points or selected IDs", () => {
  assert.equal(typeof routeModule.sanitizedMapResourceHealth, "function");
  const health = routeModule.sanitizedMapResourceHealth({
    configuredRegionIds: ["19", "24"], pinnedRegionIds: ["19"], coldStartsInWindow: 2,
    regionalConnectionCount: 1, activeResourceSubscriptionCount: 1, idleRetainedResourceSubscriptionCount: 1,
    rowsPerSubscription: [5, 2], firstGenerationLatencyMs: { sampleCount: 1, min: 18, max: 18, average: 18 },
    reconnectAttemptCount: 3, capacityRejectionCount: 4,
    regions: [{
      regionId: "19", pinned: true, resourceCount: 1, leaseCount: 2, failure: null,
      subscription: { connected: true, applied: true, stage: "applied", rowCount: 42, rowsPerSubscription: [5, 2], firstGenerationLatencyMs: 18, lastAppliedAt: "2026-08-12T10:00:00.000Z", lastError: null, appliedResourceIds: ["28"], points: [{ x: 1, z: 2 }] },
    }],
  });
  assert.equal(health.configuredRegionCount, 2);
  assert.equal(health.resourceCount, 1);
  assert.equal(health.leaseCount, 2);
  assert.equal(health.regionalConnectionCount, 1);
  assert.equal(health.activeResourceSubscriptionCount, 1);
  assert.equal(health.idleRetainedResourceSubscriptionCount, 1);
  assert.deepEqual(health.rowsPerSubscription, [2, 5]);
  assert.deepEqual(health.firstGenerationLatencyMs, { sampleCount: 1, min: 18, max: 18, average: 18 });
  assert.equal(health.reconnectAttemptCount, 3);
  assert.equal(health.capacityRejectionCount, 4);
  assert.deepEqual(health.regions[0].subscription.rowsPerSubscription, [2, 5]);
  assert.equal(health.regions[0].subscription.firstGenerationLatencyMs, 18);
  const serialized = JSON.stringify(health);
  assert.equal(serialized.includes("points"), false);
  assert.equal(serialized.includes("appliedResourceIds"), false);
  assert.equal(serialized.includes('\"28\"'), false);
});

test("map request logging omits complete resource and player selections", () => {
  assert.equal(typeof routeModule.mapRequestLogTarget, "function");
  assert.equal(
    routeModule.mapRequestLogTarget(new URL("http://localhost/api/local/map/snapshot?regions=19&resourceIds=28&playerIds=101")),
    "/api/local/map/snapshot",
  );
  assert.equal(
    routeModule.mapRequestLogTarget(new URL("http://localhost/api/local/health?probe=1")),
    "/api/local/health?probe=1",
  );
});

test("operational map snapshots do not block on resource readiness discovery", () => {
  assert.equal(typeof routeModule.mapRequestNeedsResourceReadiness, "function");
  assert.equal(
    routeModule.mapRequestNeedsResourceReadiness(
      "/api/local/map/snapshot",
      new URLSearchParams("regions=19&layers=claim-areas,claims,watchtowers"),
    ),
    false,
  );
  assert.equal(
    routeModule.mapRequestNeedsResourceReadiness(
      "/api/local/map/snapshot",
      new URLSearchParams("regions=19&layers=claims,resources&resourceIds=28"),
    ),
    true,
  );
  assert.equal(
    routeModule.mapRequestNeedsResourceReadiness(
      "/api/local/map/resources",
      new URLSearchParams("region=19&resourceId=28"),
    ),
    true,
  );
});

test("server resource routes derive catalog validation before acquiring leases without exposing the catalog", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /function currentMapResourceIds\(\)/);
  assert.match(server, /parseMapResourcePartitionScope\(url\.searchParams, \{[^}]*allowedRegionIds:[^}]*allowedResourceIds:\s*currentMapResourceIds\(\)/s);
  assert.match(server, /parseMapResourceSelectionScope\(url\.searchParams, \{[^}]*allowedRegionIds:[^}]*allowedResourceIds:\s*currentMapResourceIds\(\)/s);
  assert.ok(server.indexOf("parseMapResourceSelectionScope") < server.indexOf("relayMapResourceRuntime.acquire({ regionId, resourceId })"));
});

test("every resource route authorizes before web readiness discovery or lease acquisition", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const routeMarkers = [
    'url.pathname === "/api/local/map/regions"',
    'url.pathname === "/api/local/map/resource-partition"',
    'url.pathname === "/api/local/map/resources"',
    'url.pathname === "/api/local/map/resource-events"',
    '["/api/local/map/snapshot", "/api/local/map/events"].includes(url.pathname)',
  ];
  for (const marker of routeMarkers) {
    const start = server.indexOf(marker);
    assert.ok(start >= 0, marker);
    const nextRoute = server.indexOf("if (req.method ===", start + marker.length);
    const route = server.slice(start, nextRoute === -1 ? undefined : nextRoute);
    const denied = route.indexOf("if (!access.allowed)");
    const readiness = route.indexOf("ensureCurrentMapResourceRegions(claimId)");
    assert.ok(denied >= 0, `${marker} must enforce Map access`);
    assert.ok(readiness > denied, `${marker} must authorize before readiness discovery`);
    const acquisition = route.indexOf("relayMapResourceRuntime.acquire");
    if (acquisition >= 0) assert.ok(acquisition > readiness, `${marker} must ensure readiness before acquiring a lease`);
  }
});

test("server keeps one canonical paged resources route and removes the dead grouped payload surface", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const exactHandlers = server.match(/if \(req\.method === "GET" && url\.pathname === "\/api\/local\/map\/resources"\)/g) ?? [];
  assert.equal(exactHandlers.length, 1);
  assert.doesNotMatch(server, /\["\/api\/local\/map\/snapshot", "\/api\/local\/map\/resources", "\/api\/local\/map\/events"\]/);
  assert.doesNotMatch(server, /buildMapResourcePayload/);
  assert.equal("buildMapResourcePayload" in snapshotModule, false);
});

test("server shares one topology resolver across all map runtimes", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /const relayTopologyDiscovery = createRelayTopologyDiscoveryCache\(\{ discover: discoverRelayTopology \}\)/);
  assert.equal((server.match(/discoverTopology:\s*relayTopologyDiscovery/g) ?? []).length, 3);
  for (const runtime of ["RelayMapSpatialScopeManager", "RelayMapResourceRuntime", "RelayMapResourceReadiness"]) {
    const start = server.indexOf(`new ${runtime}({`);
    const end = server.indexOf("});", start);
    assert.ok(start >= 0, runtime);
    assert.match(server.slice(start, end), /discoverTopology:\s*relayTopologyDiscovery/);
  }
});

test("resource and grouped map acquisitions are capped, fenced, indexed, and release populated slots", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const resourceEventsStart = server.indexOf('url.pathname === "/api/local/map/resource-events"');
  const groupedStart = server.indexOf('["/api/local/map/snapshot", "/api/local/map/events"].includes(url.pathname)');
  const nextRoute = server.indexOf('url.pathname.startsWith("/api/local/branding/")', groupedStart);
  const resourceEvents = server.slice(resourceEventsStart, groupedStart);
  const grouped = server.slice(groupedStart, nextRoute);

  assert.match(resourceEvents, /relayClaimScopeFence\.run\(claimId, async \(\) =>/);
  assert.match(resourceEvents, /runWithConcurrency\(tasks, leasePlan\.concurrency\)/);
  assert.match(resourceEvents, /leases\[index\] = lease/);
  assert.match(resourceEvents, /leases\.filter\(Boolean\).*lease\.release/s);
  assert.match(grouped, /relayClaimScopeFence\.run\(claimId, async \(\) =>/);
  assert.match(grouped, /runWithConcurrency\(acquisitionTasks, MAP_RESOURCE_LEASE_ACQUISITION_LIMIT\)/);
  assert.match(grouped, /spatialLeases\[index\] = lease/);
  assert.match(grouped, /resourceLeases\[index\] = lease/);
  assert.match(grouped, /spatialLeases\.filter\(Boolean\).*resourceLeases\.filter\(Boolean\).*lease\.release/s);
});

test("server derives listener and initial map event domains from the requested layers", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /const domains = mapGenerationDomainsForLayers\(scope\.layers\)/);
  assert.match(server, /domains:\s*new Set\(domains\)/);
  assert.match(server, /currentGameDataGenerationEvent\(claimId, domains\)/);
  assert.doesNotMatch(server, /const domains = \[[^\]]*"map-static"/);
});

test("server preserves requested spatial regions when combining lease snapshots", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

  assert.match(server, /combineMapSpatialSnapshots\(spatialLeases\.map\(\(lease, index\) => \(\{ regionId: spatialInputs\[index\]\.regionId, snapshot: lease\.snapshot\(\) \}\)\)\)/);
});
