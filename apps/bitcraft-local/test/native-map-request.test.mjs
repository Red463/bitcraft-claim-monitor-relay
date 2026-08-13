import assert from "node:assert/strict";
import test from "node:test";

import { boundedNativeMapRegions, nativeMapRequest, nativeMapResourceRegions, nativeMapResourceSelectionLimit, normalizeNativeMapRegionSelection } from "../src/pages/map/nativeMapRequest.mjs";

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
    ["19|resource:123", "/api/local/map/resources?region=19&resourceId=123"],
    ["19|resource:456", "/api/local/map/resources?region=19&resourceId=456"],
    ["24|resource:123", "/api/local/map/resources?region=24&resourceId=123"],
    ["24|resource:456", "/api/local/map/resources?region=24&resourceId=456"],
  ]);
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

test("native map regions discard stale persisted ids and request every ready world region", () => {
  assert.deepEqual(boundedNativeMapRegions(["99", "19"], ["19", "24"]), ["19"]);
  assert.deepEqual(boundedNativeMapRegions([], Array.from({ length: 13 }, (_, index) => String(index + 1))), Array.from({ length: 13 }, (_, index) => String(index + 1)));
  assert.deepEqual(nativeMapResourceRegions([], ["1", "2", "3", "4", "5"]), ["1", "2", "3", "4", "5"]);
  assert.deepEqual(nativeMapResourceRegions(["99", "24"], ["19", "24"]), ["24"]);
  assert.deepEqual(nativeMapResourceRegions([], ["19", "24"]), ["19", "24"], "All requests every ready resource region");
  assert.deepEqual(nativeMapResourceRegions(["24"], ["19"]), ["19"], "a configured but unready selection falls back within the ready set");
  assert.deepEqual(nativeMapResourceRegions(["24", "19"], ["19"]), ["19"], "mixed selections intersect the ready set");
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
