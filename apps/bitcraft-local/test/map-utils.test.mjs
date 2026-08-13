import assert from "node:assert/strict";
import test from "node:test";

import {
  mapResourceCategory,
  mapResourceToken,
  normalizeMapResourceToken,
} from "../src/pages/map/mapUtils.ts";

test("map resource helpers handle resource and enemy catalog rows", () => {
  assert.equal(mapResourceToken({ id: 30, mapId: "30", mapKind: "resource" }), "resource:30");
  assert.equal(mapResourceToken({ id: "enemy:8", enemyType: 8, mapKind: "enemy" }), "enemy:8");
  assert.equal(normalizeMapResourceToken("30"), "resource:30");
  assert.equal(normalizeMapResourceToken("enemy:8"), "enemy:8");
  assert.equal(normalizeMapResourceToken(""), "");
  assert.equal(mapResourceCategory({ tag: "Ore", category: "Stone" }), "Ore");
  assert.equal(mapResourceCategory({ resourceType: "Tree" }), "Tree");
});

