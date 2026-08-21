import assert from "node:assert/strict";
import test from "node:test";

import {
  MapSnapshotError,
  authorizedMapPlayerIds,
  combineMapSpatialSnapshots,
  buildMapSnapshot,
  mapRequestAccess,
  parseMapScope,
} from "../src/server/mapSnapshot.mjs";
import { normalizeAccessControlConfig } from "../src/access/accessControl.mjs";

test("map scopes are canonical, bounded, and restricted to configured regions", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "24,19,19",
    layers: "players,claims,resources",
    playerIds: "216172782115643288,1369094286777412590",
    resourceIds: "30,2,2",
  }), { allowedRegionIds: ["19", "24"] });

  assert.deepEqual(scope, {
    regionIds: ["19", "24"],
    playerRegionIds: ["19", "24"],
    layers: ["claims", "players", "resources"],
    resourceIds: ["2", "30"],
    enemyTypes: [],
    playerIds: ["216172782115643288", "1369094286777412590"],
  });
  assert.throws(
    () => parseMapScope(new URLSearchParams({ regions: "99", layers: "claims" }), { allowedRegionIds: ["19"] }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 422,
  );
  assert.throws(
    () => parseMapScope(new URLSearchParams({ regions: "19", layers: "resources" }), { allowedRegionIds: ["19"] }),
    /resourceIds/,
  );
  assert.throws(
    () => parseMapScope(new URLSearchParams({ regions: "19", layers: "banks" }), { allowedRegionIds: ["19"] }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 422 && /Unknown map layer/.test(error.message),
  );
});

test("map scopes validate an independent bounded Relay-ready player region scope", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "19",
    playerRegions: "24,31",
    layers: "players",
    playerIds: "101",
  }), { allowedRegionIds: ["19"], allowedPlayerRegionIds: ["19", "24", "31"] });

  assert.deepEqual(scope.regionIds, ["19"]);
  assert.deepEqual(scope.playerRegionIds, ["24", "31"]);
  const broadPlayerScope = parseMapScope(new URLSearchParams({
    regions: "19",
    playerRegions: "19,24,31,37,42",
    layers: "players",
    playerIds: "101",
  }), { allowedRegionIds: ["19"], allowedPlayerRegionIds: ["19", "24", "31", "37", "42"] });
  assert.deepEqual(broadPlayerScope.playerRegionIds, ["19", "24", "31", "37", "42"]);
  assert.throws(
    () => parseMapScope(new URLSearchParams({
      regions: "19",
      playerRegions: Array.from({ length: 17 }, (_, index) => String(index + 1)).join(","),
      layers: "players",
      playerIds: "101",
    }), {
      allowedRegionIds: ["19"],
      allowedPlayerRegionIds: Array.from({ length: 17 }, (_, index) => String(index + 1)),
    }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 413 && /playerRegions/.test(error.message),
  );
  assert.throws(
    () => parseMapScope(new URLSearchParams({ regions: "19", playerRegions: "99", layers: "players", playerIds: "101" }), {
      allowedRegionIds: ["19"],
      allowedPlayerRegionIds: ["19", "24"],
    }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 422 && /player region/i.test(error.message),
  );
});

test("operational-only map scopes do not require the selected region to be player-ready", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "24",
    layers: "claims",
  }), { allowedRegionIds: ["24"], allowedPlayerRegionIds: ["19"] });

  assert.deepEqual(scope.regionIds, ["24"]);
  assert.deepEqual(scope.playerRegionIds, []);
});

test("map snapshot resource scope rejects identities outside the current catalog", () => {
  assert.throws(
    () => parseMapScope(new URLSearchParams({ regions: "19", layers: "resources", resourceIds: "999" }), {
      allowedRegionIds: ["19"],
      allowedResourceIds: ["28", "54"],
    }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 422 && /catalog/i.test(error.message) && !error.message.includes("28"),
  );
});

test("map scopes canonicalize decimal ids before deduplication and filtering", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "019,19",
    layers: "resources",
    resourceIds: "028,28",
  }), { allowedRegionIds: ["019"] });

  assert.deepEqual(scope.regionIds, ["19"]);
  assert.deepEqual(scope.resourceIds, ["28"]);
});

test("generic resource scopes accept 16 by 16 but reject 17 by 16 under the shared partition budget", () => {
  const regionIds = Array.from({ length: 17 }, (_, index) => String(index + 1));
  const resourceIds = Array.from({ length: 16 }, (_, index) => String(index + 1));
  const accepted = parseMapScope(new URLSearchParams({
    regions: regionIds.slice(0, 16).join(","),
    layers: "resources",
    resourceIds: resourceIds.join(","),
  }), {
    allowedRegionIds: regionIds,
    allowedResourceIds: resourceIds,
  });
  assert.equal(accepted.regionIds.length * accepted.resourceIds.length, 256);

  assert.throws(
    () => parseMapScope(new URLSearchParams({
      regions: regionIds.join(","),
      layers: "resources",
      resourceIds: resourceIds.join(","),
    }), {
      allowedRegionIds: regionIds,
      allowedResourceIds: resourceIds,
    }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 413,
  );
});

test("map request access follows the configured Map page rule", () => {
  const config = normalizeAccessControlConfig({ rules: { "page:map": { mode: "verified" } } });
  assert.equal(mapRequestAccess(config, { user: null }).allowed, false);
  assert.equal(mapRequestAccess(config, { user: { discordId: "123456", characterStatus: "pending" } }).allowed, false);
  assert.equal(mapRequestAccess(config, { user: { discordId: "123456", characterStatus: "approved" } }).allowed, true);
});

test("roads and claim areas are accepted but fail closed until coordinates are verified", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "19",
    layers: "roads,claim-areas",
  }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({ scope, now: new Date("2026-08-11T12:00:00.000Z") });

  assert.deepEqual(snapshot.layers.roads, []);
  assert.deepEqual(snapshot.layers["claim-areas"], []);
  assert.deepEqual(snapshot.layerAvailability.roads, {
    available: false,
    status: "unavailable",
    reason: "Unavailable — awaiting verified Relay coordinates",
  });
  assert.equal(snapshot.layerAvailability["claim-areas"].available, false);
  assert.match(snapshot.warnings.join(" "), /roads.*verified Relay coordinates/i);
  assert.match(snapshot.warnings.join(" "), /claim areas.*verified Relay coordinates/i);
});

test("map snapshot projects available operations and reports uncollected layers", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "19",
    layers: "claims,markets,watchtowers,players,resources",
    playerIds: "216172782115643288",
    resourceIds: "2",
  }), { allowedRegionIds: ["19"] });

  const snapshot = buildMapSnapshot({
    scope,
    now: new Date("2026-08-11T12:00:10.000Z"),
    excludedMemberIds: [],
    regionClaims: {
      data: { regionId: "19", claims: [{ entityId: "1369094286777412590", name: "Timbersteel", tier: 6, npc: true, locationX: 10, locationZ: 20, locationDimension: "1" }] },
      generation: 7,
      provenance: { receivedAt: "2026-08-11T12:00:00.000Z" },
    },
    market: {
      data: { regionId: "19", marketplaces: [{ buildingEntityId: "1369094286778488967", claimEntityId: "1369094286777412590", locationX: 30, locationZ: 40, dimension: "1" }] },
      generation: 8,
      provenance: { receivedAt: "2026-08-11T12:00:01.000Z" },
    },
    empires: {
      data: { nodes: [{ entityId: "216172782113783810", empireEntityId: "1", regionId: "19", nickname: "North Tower", locationX: 50, locationZ: 60, locationDimension: "1" }] },
      generation: 9,
      provenance: { receivedAt: "2026-08-11T12:00:02.000Z" },
    },
    members: [{ playerEntityId: "216172782115643288", username: "Scout" }],
    players: [{ entityId: "216172782115643288", signedIn: true }],
    spatial: null,
  });

  assert.equal(snapshot.provider, "relay");
  assert.equal(snapshot.layers.claims[0].entityId, "1369094286777412590");
  assert.equal(snapshot.layers.claims[0].npc, true);
  assert.equal(snapshot.layers.markets[0].point.x, 30);
  assert.equal(snapshot.layers.watchtowers[0].point.z, 60);
  assert.deepEqual(snapshot.layers.players, []);
  assert.deepEqual(snapshot.layers.resources, []);
  assert.equal(snapshot.layerAvailability.players.available, false);
  assert.equal(snapshot.layerAvailability.resources.available, false);
  assert.equal(snapshot.freshness, "partial");
  assert.match(snapshot.warnings.join(" "), /player positions.*unavailable/i);
  assert.match(snapshot.warnings.join(" "), /resource positions.*unavailable/i);
});

test("map snapshot projects dynamically collected claim centres outside the monitored region", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "17", layers: "claims" }), { allowedRegionIds: ["17", "19"] });
  const snapshot = buildMapSnapshot({
    scope,
    spatial: {
      data: { claims: [{ entityId: "501", regionId: "17", name: "Pinewatch", tier: 4, npc: false, locationX: 123, locationZ: 456, dimension: "1", observedAt: "2026-08-13T12:00:00.000Z" }] },
      generation: 2,
      freshness: "live",
      provenance: { receivedAt: "2026-08-13T12:00:00.000Z" },
      warnings: [],
    },
  });

  assert.deepEqual(snapshot.layers.claims.map(({ entityId, regionId, name }) => ({ entityId, regionId, name })), [
    { entityId: "501", regionId: "17", name: "Pinewatch" },
  ]);
  assert.doesNotMatch(snapshot.warnings.join(" "), /only available for the collected claim region/i);
});

test("player positions require selected online monitored non-excluded members", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "19",
    layers: "players",
    playerIds: "101,102,103,104",
  }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({
    scope,
    now: new Date("2026-08-11T12:00:00.000Z"),
    excludedMemberIds: ["103"],
    mobileIdentityVerified: true,
    members: [
      { playerEntityId: "101", userName: "Online" },
      { playerEntityId: "102", username: "Offline" },
      { playerEntityId: "103", username: "Excluded" },
    ],
    players: [
      { entityId: "101", signedIn: true },
      { entityId: "102", signedIn: false },
      { entityId: "103", signedIn: true },
    ],
    spatial: {
      data: { players: [
        { playerEntityId: "101", regionId: "19", locationX: 12_000, locationZ: 24_000, dimension: "1", observedAt: "2026-08-11T11:59:59.000Z" },
        { playerEntityId: "102", regionId: "19", locationX: 13_000, locationZ: 25_000, dimension: "1" },
        { playerEntityId: "103", regionId: "19", locationX: 14_000, locationZ: 26_000, dimension: "1" },
        { playerEntityId: "104", regionId: "19", locationX: 15_000, locationZ: 27_000, dimension: "1" },
      ] },
      generation: 10,
      provenance: { receivedAt: "2026-08-11T11:59:59.000Z" },
    },
  });

  assert.deepEqual(snapshot.layers.players.map((row) => row.playerEntityId), ["101"]);
  assert.equal(snapshot.layers.players[0].name, "Online");
  assert.deepEqual(snapshot.layers.players[0].point, {
    x: 12,
    z: 24,
    dimension: "1",
    coordinateSpace: "map-xz",
    sourceCoordinateSpace: "mobile-fixed-1000",
  });

  const previouslyLiveSpatial = {
    data: { players: [{ playerEntityId: "101", regionId: "19", locationX: 12_000, locationZ: 24_000, dimension: "1" }] },
    generation: 10,
    provenance: { receivedAt: "2026-08-11T11:59:59.000Z" },
  };
  assert.deepEqual(buildMapSnapshot({
    scope: { ...scope, playerIds: ["101"] },
    mobileIdentityVerified: true,
    members: [{ playerEntityId: "101" }],
    players: [{ entityId: "101", signedIn: false }],
    spatial: previouslyLiveSpatial,
  }).layers.players, []);
  assert.deepEqual(buildMapSnapshot({
    scope: { ...scope, playerIds: ["101"] },
    excludedMemberIds: ["101"],
    mobileIdentityVerified: true,
    members: [{ playerEntityId: "101" }],
    players: [{ entityId: "101", signedIn: true }],
    spatial: previouslyLiveSpatial,
  }).layers.players, []);
});

test("player positions remain collectible outside the selected operational region", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "19",
    playerRegions: "19,24",
    layers: "players",
    playerIds: "101",
  }), { allowedRegionIds: ["19"], allowedPlayerRegionIds: ["19", "24"] });
  const snapshot = buildMapSnapshot({
    scope,
    mobileIdentityVerified: true,
    members: [{ playerEntityId: "101", username: "Traveller" }],
    players: [{ entityId: "101", signedIn: true }],
    spatial: {
      data: { players: [{ playerEntityId: "101", regionId: "24", locationX: 12_000, locationZ: 24_000, dimension: "1" }] },
      generation: 10,
      provenance: { receivedAt: "2026-08-11T11:59:59.000Z" },
    },
  });

  assert.deepEqual(snapshot.layers.players.map((row) => [row.playerEntityId, row.regionId]), [["101", "24"]]);
});

test("multi-region spatial aggregation keeps the oldest observation and worst freshness with last-good rows", () => {
  const combined = combineMapSpatialSnapshots([
    {
      data: { players: [{ playerEntityId: "101", regionId: "19" }], enemies: [], banks: [], waystones: [] },
      generation: 7,
      receivedAt: "2026-08-11T12:09:00.000Z",
      freshness: "live",
      warnings: [],
    },
    {
      data: { players: [{ playerEntityId: "102", regionId: "24" }], enemies: [], banks: [], waystones: [] },
      generation: 8,
      receivedAt: "2026-08-11T12:00:00.000Z",
      freshness: "stale",
      warnings: ["Region 24 spatial subscription is reconnecting."],
    },
  ]);

  assert.equal(combined.provenance.receivedAt, "2026-08-11T12:00:00.000Z");
  assert.equal(combined.freshness, "stale");
  assert.equal(combined.generation, 8);
  assert.deepEqual(combined.data.players.map((row) => row.playerEntityId), ["101", "102"]);
  assert.deepEqual(combined.warnings, ["Region 24 spatial subscription is reconnecting."]);
});

test("multi-region spatial aggregation reports a missing requested region as partial", () => {
  const combined = combineMapSpatialSnapshots([
    {
      regionId: "19",
      snapshot: {
        data: { players: [{ playerEntityId: "101", regionId: "19", locationX: 12_000, locationZ: 24_000, dimension: "1" }], enemies: [], banks: [], waystones: [] },
        generation: 7,
        receivedAt: "2026-08-11T12:09:00.000Z",
        freshness: "live",
        warnings: [],
      },
    },
    { regionId: "24", snapshot: null },
  ]);

  assert.equal(combined.freshness, "partial");
  assert.deepEqual(combined.data.players.map((row) => row.playerEntityId), ["101"]);
  assert.deepEqual(combined.warnings, ["Live spatial data is unavailable for 1 of 2 requested regions."]);

  const scope = parseMapScope(new URLSearchParams({ regions: "19", playerRegions: "19,24", layers: "players", playerIds: "101" }), {
    allowedRegionIds: ["19"],
    allowedPlayerRegionIds: ["19", "24"],
  });
  const payload = buildMapSnapshot({
    scope,
    mobileIdentityVerified: true,
    members: [{ playerEntityId: "101" }],
    players: [{ entityId: "101", signedIn: true }],
    spatial: combined,
  });
  assert.equal(payload.layerAvailability.players.status, "partial");
  assert.equal(payload.layerAvailability.players.available, true);
});

test("multi-region spatial aggregation returns unavailable when every requested region is missing", () => {
  assert.equal(combineMapSpatialSnapshots([
    { regionId: "19", snapshot: null },
    { regionId: "24", snapshot: null },
  ]), null);
});

test("map player subscriptions receive only selected online monitored non-excluded ids", () => {
  assert.deepEqual(authorizedMapPlayerIds({
    selectedPlayerIds: ["101", "102", "103", "104"],
    excludedMemberIds: ["103"],
    mobileIdentityVerified: true,
    members: [
      { playerEntityId: "101" },
      { playerEntityId: "102" },
      { playerEntityId: "103" },
    ],
    players: [
      { entityId: "101", signedIn: true },
      { entityId: "102", signedIn: false },
      { entityId: "103", signedIn: true },
      { entityId: "104", signedIn: true },
    ],
  }), ["101"]);
  assert.deepEqual(authorizedMapPlayerIds({
    selectedPlayerIds: ["101"],
    members: [{ playerEntityId: "101" }],
    players: [{ entityId: "101", signedIn: true }],
  }), []);
});

test("map snapshot exposes verified waystone coordinates from the scoped collector", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "19", layers: "waystones" }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({
    scope,
    waystoneCoordinatesVerified: true,
    spatial: {
      data: {
        waystones: [{ entityId: "301", claimEntityId: "999", regionId: "19", locationX: 30, locationZ: 40, dimension: "1" }],
      },
      generation: 11,
      provenance: { receivedAt: "2026-08-11T12:00:00.000Z" },
    },
  });
  assert.equal(snapshot.layers.waystones[0].kind, "waystone");
  assert.equal(snapshot.layers.waystones[0].point.z, 40);
  assert.deepEqual(snapshot.warnings, []);
});

test("map snapshot keeps waystone coordinates unavailable until live fixtures are verified", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "19", layers: "waystones" }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({
    scope,
    spatial: {
      data: {
        waystones: [{ entityId: "301", claimEntityId: "999", regionId: "19", locationX: 30, locationZ: 40, dimension: "1" }],
      },
      provenance: { receivedAt: "2026-08-11T12:00:00.000Z" },
    },
  });
  assert.deepEqual(snapshot.layers.waystones, []);
  assert.equal(snapshot.layerAvailability.waystones.available, false);
  assert.match(snapshot.layerAvailability.waystones.reason, /live-verified/i);
  assert.match(snapshot.warnings.join(" "), /waystone.*live-verified/i);
});

test("map snapshot forwards scoped collector warnings to the native renderer", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "19",
    layers: "enemies",
    enemyTypes: "8",
  }), { allowedRegionIds: ["19"] });
  const warning = "Enemy positions are unavailable until the Relay EnemyType to catalog mapping is live-verified.";
  const snapshot = buildMapSnapshot({
    scope,
    spatial: {
      data: { enemies: [] },
      generation: 12,
      provenance: { receivedAt: "2026-08-11T12:00:00.000Z" },
      warnings: [warning],
    },
  });

  assert.equal(snapshot.freshness, "partial");
  assert.deepEqual(snapshot.warnings, [warning]);
});

test("map snapshot keeps enemy positions unavailable until type mapping is verified", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "19", layers: "enemies", enemyTypes: "8" }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({
    scope,
    spatial: {
      data: { enemies: [{ entityId: "200", enemyType: "8", regionId: "19", locationX: 70_000, locationZ: 80_000, dimension: "1" }] },
      generation: 12,
      provenance: { receivedAt: "2026-08-11T12:00:00.000Z" },
    },
  });
  assert.deepEqual(snapshot.layers.enemies, []);
  assert.equal(snapshot.layerAvailability.enemies.available, false);
  assert.match(snapshot.warnings.join(" "), /enemy positions.*catalog mapping.*live-verified/i);
});

test("map snapshot keeps resources unavailable until the live location join is verified", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "19", layers: "resources", resourceIds: "54" }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({
    scope,
    spatial: {
      data: { resources: [{ entityId: "100", resourceId: "54", regionId: "19", locationX: 100, locationZ: 200, dimension: "1" }] },
      generation: 12,
      provenance: { receivedAt: "2026-08-11T12:00:00.000Z" },
    },
  });
  assert.deepEqual(snapshot.layers.resources, []);
  assert.equal(snapshot.layerAvailability.resources.available, false);
  assert.match(snapshot.warnings.join(" "), /resource positions.*location join.*live-verified/i);
});

test("map snapshot freshness uses the oldest requested source and cannot be masked by a newer layer", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "19", layers: "claims,waystones" }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({
    scope,
    now: new Date("2026-08-11T12:10:00.000Z"),
    waystoneCoordinatesVerified: true,
    regionClaims: {
      data: { regionId: "19", claims: [] },
      generation: 1,
      freshness: "stale",
      provenance: { receivedAt: "2026-08-11T12:00:00.000Z" },
    },
    spatial: {
      data: { waystones: [] },
      generation: 2,
      freshness: "live",
      provenance: { receivedAt: "2026-08-11T12:09:59.000Z" },
    },
  });

  assert.equal(snapshot.generatedAt, "2026-08-11T12:00:00.000Z");
  assert.equal(snapshot.ageMs, 600_000);
  assert.equal(snapshot.freshness, "partial");
});

test("resource collections retain warm points while reporting cold keys as loading", () => {
  const scope = parseMapScope(new URLSearchParams({
    regions: "19,24",
    layers: "resources",
    resourceIds: "28",
  }), { allowedRegionIds: ["19", "24"] });
  const snapshot = buildMapSnapshot({
    scope,
    now: new Date("2026-08-12T10:00:05.000Z"),
    resourceCoordinatesVerified: true,
    resourceCollection: {
      data: { resources: [{ entityId: "100", resourceId: "28", regionId: "19", locationX: 100, locationZ: 200, dimension: "1" }] },
      generation: 7,
      freshness: "live",
      provenance: { receivedAt: "2026-08-12T10:00:00.000Z" },
      warnings: [],
      requestedKeys: ["19|resource:28", "24|resource:28"],
      readyKeys: ["19|resource:28"],
      loadingKeys: ["24|resource:28"],
      unavailableKeys: [],
    },
  });

  assert.deepEqual(snapshot.layers.resources.map((row) => row.entityId), ["100"]);
  assert.deepEqual(snapshot.layerAvailability.resources, {
    available: true,
    status: "partial",
    pending: true,
    reason: "Some selected resource positions are still loading.",
  });
  assert.equal(snapshot.freshness, "partial");
  assert.equal("requestedKeys" in snapshot, false);
  assert.equal(JSON.stringify(snapshot).includes("19|resource:28"), false);
});

test("resource collections expose unavailable partial selections without marking them pending", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "19,24", layers: "resources", resourceIds: "28" }), { allowedRegionIds: ["19", "24"] });
  const snapshot = buildMapSnapshot({
    scope,
    resourceCoordinatesVerified: true,
    resourceCollection: {
      data: { resources: [{ entityId: "100", resourceId: "28", regionId: "19", locationX: 100, locationZ: 200, dimension: "1" }] },
      generation: 7, freshness: "partial", provenance: { receivedAt: "2026-08-12T10:00:00.000Z" },
      warnings: ["Region 24 resource subscription is unavailable."],
      requestedKeys: ["19|resource:28", "24|resource:28"], readyKeys: ["19|resource:28"], loadingKeys: [], unavailableKeys: ["24|resource:28"],
    },
  });

  assert.deepEqual(snapshot.layerAvailability.resources, {
    available: true,
    status: "partial",
    pending: false,
    reason: "Some selected resource positions are unavailable.",
  });
});

test("a ready empty resource generation is live and available", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "19", layers: "resources", resourceIds: "28" }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({
    scope,
    resourceCoordinatesVerified: true,
    resourceCollection: {
      data: { resources: [] },
      generation: 3,
      freshness: "live",
      provenance: { receivedAt: "2026-08-12T10:00:00.000Z" },
      warnings: [],
      requestedKeys: ["19|resource:28"],
      readyKeys: ["19|resource:28"],
      loadingKeys: [],
      unavailableKeys: [],
    },
  });

  assert.deepEqual(snapshot.layers.resources, []);
  assert.deepEqual(snapshot.layerAvailability.resources, { available: true, status: "live", reason: null });
  assert.equal(snapshot.freshness, "live");
});

test("stale resource warnings degrade freshness without clearing usable points", () => {
  const scope = parseMapScope(new URLSearchParams({ regions: "19", layers: "resources", resourceIds: "28" }), { allowedRegionIds: ["19"] });
  const snapshot = buildMapSnapshot({
    scope,
    resourceCoordinatesVerified: true,
    resourceCollection: {
      data: { resources: [{ entityId: "100", resourceId: "28", regionId: "19", locationX: 100, locationZ: 200, dimension: "1" }] },
      generation: 9,
      freshness: "stale",
      provenance: { receivedAt: "2026-08-12T09:59:00.000Z" },
      warnings: ["Relay map resource subscription disconnected."],
      requestedKeys: ["19|resource:28"],
      readyKeys: ["19|resource:28"],
      loadingKeys: [],
      unavailableKeys: [],
    },
  });

  assert.equal(snapshot.layers.resources.length, 1);
  assert.deepEqual(snapshot.layerAvailability.resources, {
    available: true,
    status: "stale",
    reason: "Relay map resource subscription disconnected.",
  });
  assert.equal(snapshot.freshness, "stale");
  assert.deepEqual(snapshot.warnings, ["Relay map resource subscription disconnected."]);
});

test("map resource requests retain region, resource, feature, and byte limits", () => {
  assert.throws(
    () => parseMapScope(new URLSearchParams({ regions: Array.from({ length: 17 }, (_, index) => index + 1).join(","), layers: "claims" }), { allowedRegionIds: Array.from({ length: 17 }, (_, index) => String(index + 1)) }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 413,
  );
  assert.throws(
    () => parseMapScope(new URLSearchParams({ regions: "1", layers: "resources", resourceIds: Array.from({ length: 17 }, (_, index) => index + 1).join(",") }), { allowedRegionIds: ["1"] }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 413,
  );
  const scope = parseMapScope(new URLSearchParams({ regions: "1", layers: "resources", resourceIds: "1" }), { allowedRegionIds: ["1"] });
  const collection = (resources) => ({
    data: { resources }, generation: 1, freshness: "live",
    provenance: { receivedAt: "2026-08-12T10:00:00.000Z" }, warnings: [],
    requestedKeys: ["1|resource:1"], readyKeys: ["1|resource:1"], loadingKeys: [], unavailableKeys: [],
  });
  const point = (entityId) => ({ entityId, resourceId: "1", regionId: "1", locationX: 1, locationZ: 1, dimension: "1" });
  assert.throws(
    () => buildMapSnapshot({ scope, resourceCoordinatesVerified: true, resourceCollection: collection(Array.from({ length: 50_001 }, (_, index) => point(String(index)))) }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 413 && /feature limit/.test(error.message),
  );
  assert.throws(
    () => buildMapSnapshot({ scope, resourceCoordinatesVerified: true, resourceCollection: collection([point("x".repeat(8 * 1024 * 1024))]) }),
    (error) => error instanceof MapSnapshotError && error.statusCode === 413 && /byte limit/.test(error.message),
  );
});
