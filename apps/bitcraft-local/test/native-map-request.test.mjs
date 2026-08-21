import assert from "node:assert/strict";
import test from "node:test";

import { MAP_RESOURCE_PARTITION_BUDGET, mapResourceTypeLimitForRegions } from "../src/map/mapResourceSelection.mjs";
import { boundedNativeMapRegions, nativeMapPreferredResourceRegion, nativeMapRequest, nativeMapResourceRegions, nativeMapResourceSelectionLimit, normalizeNativeMapRegionSelection } from "../src/pages/map/nativeMapRequest.mjs";

test("native map requests are same-origin, canonical, and omit empty bounded layers", () => {
  const request = nativeMapRequest({
    operationalRegionIds: ["24", "19", "19"],
    playerRegionIds: ["31", "24", "31"],
    resourceRegionIds: ["24", "19"],
    playerIds: ["216172782115643288"],
    resourceIds: [],
    enemyTypes: ["8", "1"],
  });
  assert.equal(request.snapshotUrl, "/api/local/map/snapshot?regions=19%2C24&layers=claim-areas%2Cclaims%2Cenemies%2Cplayers%2Cwatchtowers&playerRegions=24%2C31&playerIds=216172782115643288&enemyTypes=1%2C8");
  assert.equal(request.eventsUrl, request.snapshotUrl.replace("/snapshot?", "/events?"));
  assert.equal(request.layers.includes("resources"), false);
  assert.equal(request.layers.includes("banks"), false);
  assert.equal(request.layers.includes("markets"), false);
  assert.equal(request.layers.includes("waystones"), false);
  assert.equal(request.layers.includes("empire-settlements"), false);
  assert.equal(request.layers.includes("roads"), false);
});

test("native map request keeps resource and enemy namespaces separate", () => {
  const request = nativeMapRequest({ operationalRegionIds: ["19"], resourceRegionIds: ["24", "19"], playerIds: [], resourceIds: ["456", "123"], enemyTypes: ["123"] });
  assert.equal(new URL(request.snapshotUrl, "http://local").searchParams.has("resourceIds"), false);
  assert.equal(new URL(request.snapshotUrl, "http://local").searchParams.get("layers").includes("resources"), false);
  assert.deepEqual(request.resourcePartitions.map(({ key, url }) => [key, url]), [
    ["19|resource:123", undefined],
    ["24|resource:123", undefined],
    ["19|resource:456", undefined],
    ["24|resource:456", undefined],
  ]);
  assert.equal(JSON.stringify(request).includes("/api/local/map/resources"), false);
  assert.equal(new URL(request.resourceEventUrl, "http://local").searchParams.get("regions"), "19,24");
  assert.equal(new URL(request.resourceEventUrl, "http://local").searchParams.get("resourceIds"), "123,456");
  assert.equal(new URL(request.eventsUrl, "http://local").searchParams.has("resourceIds"), false);
  assert.equal(new URL(request.snapshotUrl, "http://local").searchParams.get("enemyTypes"), "123");
});

test("native map resource planning keeps all 16 types across all 13 regions", () => {
  const regionIds = Array.from({ length: 13 }, (_, index) => String(index + 1));
  const resourceIds = Array.from({ length: 16 }, (_, index) => String(index + 1));
  const request = nativeMapRequest({ operationalRegionIds: ["1"], resourceRegionIds: regionIds, resourceIds });

  assert.equal(nativeMapResourceSelectionLimit(regionIds), 16);
  assert.equal(request.resourcePartitions.length, 208);
  assert.deepEqual([...new Set(request.resourcePartitions.map((partition) => partition.resourceId))], resourceIds);
  assert.equal(new URL(request.resourceEventUrl, "http://local").searchParams.get("resourceIds"), resourceIds.join(","));
});

test("native map resource type limits share the 256-partition browser budget", () => {
  const regions = (count) => Array.from({ length: count }, (_, index) => String(index + 1));
  assert.equal(MAP_RESOURCE_PARTITION_BUDGET, 256);
  assert.equal(mapResourceTypeLimitForRegions(regions(13)), 16);
  assert.equal(mapResourceTypeLimitForRegions(regions(16)), 16);
  assert.equal(mapResourceTypeLimitForRegions(regions(17)), 15);
  assert.equal(mapResourceTypeLimitForRegions([]), 0);
  assert.ok(mapResourceTypeLimitForRegions(regions(257)) * 257 <= MAP_RESOURCE_PARTITION_BUDGET);
  assert.equal(mapResourceTypeLimitForRegions(["019", "19", "bad", "24"]), 16, "only unique decimal regions count");
});

test("resource selection options can lower but never raise hard partition or type ceilings", () => {
  const regions = (count) => Array.from({ length: count }, (_, index) => String(index + 1));
  assert.equal(mapResourceTypeLimitForRegions(["1"], { partitionBudget: 257, typeLimit: 257 }), 16);
  assert.equal(mapResourceTypeLimitForRegions(regions(17), { partitionBudget: 257, typeLimit: 257 }), 15);
  assert.ok(mapResourceTypeLimitForRegions(regions(17), { partitionBudget: 257, typeLimit: 257 }) * 17 <= 256);
  assert.equal(mapResourceTypeLimitForRegions(regions(4), { partitionBudget: 8, typeLimit: 3 }), 2);
});

test("native map regions preserve explicit All but narrowly fall back for a stale persisted selection", () => {
  assert.deepEqual(boundedNativeMapRegions(["99", "19"], ["19", "24"]), ["19"]);
  assert.deepEqual(boundedNativeMapRegions([], Array.from({ length: 13 }, (_, index) => String(index + 1))), Array.from({ length: 13 }, (_, index) => String(index + 1)));
  assert.deepEqual(nativeMapResourceRegions([], ["1", "2", "3", "4", "5"]), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(nativeMapResourceRegions(["99", "24"], ["19", "24"]), ["24"]);
  assert.deepEqual(nativeMapResourceRegions([], ["19", "24"]), ["19", "24"], "All requests every ready resource region");
  assert.deepEqual(nativeMapResourceRegions(["24"], ["19", "31"], "31"), ["31"], "a configured but unready selection falls back to the ready claim region");
  assert.deepEqual(nativeMapResourceRegions(["24"], ["19", "31"], "99"), ["19"], "without a ready claim it falls back to the first ready region");
  assert.deepEqual(nativeMapResourceRegions(["24", "19"], ["19"]), ["19"], "mixed selections intersect the ready set");
});

test("preferred resource region always belongs to the active resource scope", () => {
  assert.equal(nativeMapPreferredResourceRegion([], ["19"], "31"), "19", "an out-of-scope ready claim cannot become the priority hint");
  assert.equal(nativeMapPreferredResourceRegion([], ["19", "31"], "31"), "31");
  assert.equal(nativeMapPreferredResourceRegion(["24"], ["19", "24"], "19"), "24", "an explicit in-scope region wins");
});

test("native map request validates priority hints and applies them to scope and URL order", () => {
  const prioritized = nativeMapRequest({
    operationalRegionIds: ["19"],
    resourceRegionIds: ["19", "24"],
    resourceIds: ["28", "54"],
    priorityResourceId: "54",
    priorityRegionId: "24",
  });
  assert.deepEqual(prioritized.resourcePartitions.map((partition) => partition.key), [
    "24|resource:54",
    "19|resource:54",
    "19|resource:28",
    "24|resource:28",
  ]);
  const priorityUrl = new URL(prioritized.resourceEventUrl, "http://local");
  assert.equal(priorityUrl.searchParams.get("priorityResourceId"), "54");
  assert.equal(priorityUrl.searchParams.get("priorityRegionId"), "24");

  const ignored = nativeMapRequest({
    operationalRegionIds: ["19"],
    resourceRegionIds: ["19", "24"],
    resourceIds: ["28", "54"],
    priorityResourceId: "999",
    priorityRegionId: "31",
  });
  const ignoredUrl = new URL(ignored.resourceEventUrl, "http://local");
  assert.equal(ignoredUrl.searchParams.has("priorityResourceId"), false);
  assert.equal(ignoredUrl.searchParams.has("priorityRegionId"), false);
  assert.ok(ignored.resourcePartitions.length <= MAP_RESOURCE_PARTITION_BUDGET);
});

test("player collection regions are independent of selected operational and resource regions", () => {
  const request = nativeMapRequest({
    operationalRegionIds: ["19"],
    playerRegionIds: ["19", "24"],
    resourceRegionIds: ["19"],
    playerIds: ["101"],
    resourceIds: ["28"],
  });

  const snapshot = new URL(request.snapshotUrl, "http://local");
  assert.equal(snapshot.searchParams.get("regions"), "19");
  assert.equal(snapshot.searchParams.get("playerRegions"), "19,24");
  assert.deepEqual(request.resourcePartitions.map((partition) => partition.regionId), ["19"]);
});

test("stale persisted region selection becomes All without mutating persistence", () => {
  const persisted = ["99"];

  assert.deepEqual(normalizeNativeMapRegionSelection(persisted, ["19", "24"]), []);
  assert.deepEqual(persisted, ["99"]);
});

test("region selection follows ready-region transitions and retains valid ids", () => {
  assert.deepEqual(normalizeNativeMapRegionSelection(["24"], ["19", "24"]), ["24"]);
  assert.deepEqual(normalizeNativeMapRegionSelection(["24"], ["19"]), []);
  assert.deepEqual(normalizeNativeMapRegionSelection(["99", "19"], ["19", "24"]), ["19"]);
});
