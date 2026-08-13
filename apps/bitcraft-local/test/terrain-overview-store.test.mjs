import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createLayeredTerrainTileStore } from "../src/server/terrainOverviewStore.mjs";

test("production terrain wrapper reads one precomposed store without overview composition", async () => {
  let detailReads = 0;
  let overviewReads = 0;
  const detailStore = {
    readManifest: async () => ({ generation: "200", generatedAt: "2026-08-13T00:00:00.000Z", regionIds: ["3", "19"] }),
    readTile: async () => {
      detailReads += 1;
      return { bytes: Buffer.from("precomposed"), contentType: "image/webp", generation: "200" };
    },
  };
  const overviewStore = {
    readManifest: async () => ({ generation: "100" }),
    readTile: async () => {
      overviewReads += 1;
      return { bytes: Buffer.from("legacy"), contentType: "image/webp", generation: "100" };
    },
  };
  const store = createLayeredTerrainTileStore({ detailStore, overviewStore });

  assert.equal((await store.readManifest()).generation, "200");
  assert.equal((await store.readTile({ style: "terrain", z: -5, x: 45, y: -47 })).bytes.toString(), "precomposed");
  assert.equal(detailReads, 1);
  assert.equal(overviewReads, 0);
});

test("production server does not construct the legacy layered overview", async () => {
  const [overviewSource, serverSource] = await Promise.all([
    readFile(new URL("../src/server/terrainOverviewStore.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(overviewSource, /import\(["']sharp["']\)|\.composite\(/);
  assert.doesNotMatch(serverSource, /createLayeredTerrainTileStore|createTerrainOverviewStore|layeredTerrainTileStore/);
  assert.match(serverSource, /serveLocalMapTile\(url\.pathname, res, terrainTileStore,/);
});
