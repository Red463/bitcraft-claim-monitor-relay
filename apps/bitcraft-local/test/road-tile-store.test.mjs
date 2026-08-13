import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRoadTileStore } from "../src/server/roadTileStore.mjs";

test("road tile store atomically installs and reads a same-origin bundle", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bitcraft-road-store-"));
  const store = createRoadTileStore({ dataDir, now: () => new Date("2026-08-11T12:00:00.000Z") });
  const manifest = await store.install({
    generation: "7", regionIds: ["19"], observedAt: "2026-08-11T11:59:00.000Z",
    bounds: { minX: 1, minZ: 2, maxX: 3, maxZ: 4 },
    tiles: [{ z: -5, x: 0, y: -1, bytes: Buffer.from("road") }],
    featureCount: 10,
  });
  assert.equal(manifest.tileCount, 1);
  assert.equal(manifest.featureCount, 10);
  assert.equal((await store.readTile({ style: "roads", z: -5, x: 0, y: -1 })).bytes.toString(), "road");
  assert.equal(await store.readTile({ style: "terrain", z: -5, x: 0, y: -1 }), null);
});

test("road reads delegate to the immutable pack store", async () => {
  const source = await readFile(new URL("../src/server/roadTileStore.mjs", import.meta.url), "utf8");
  assert.match(source, /createMapTilePackStore/);
  assert.match(source, /packStore\.readTile/);
});
