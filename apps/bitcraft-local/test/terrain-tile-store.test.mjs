import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

let storeModule = null;
try {
  storeModule = await import("../src/server/terrainTileStore.mjs");
} catch {
  // RED: atomic terrain store does not exist yet.
}

function generation(id) {
  return {
    generation: String(id),
    observedAt: "2026-08-11T15:38:41.745Z",
    regionId: "19",
    regionIds: ["19"],
    dimension: "1",
    regionBounds: { minChunkX: 0, minChunkZ: 0, maxChunkX: 0, maxChunkZ: 0 },
    evidence: { side: 32, cellSize: 3, evidenceHash: "fixture" },
    biomes: [
      { biomeType: 1, name: "Calm Forest", description: "Calm", hazardLevel: "Safe", iconAddress: "private", disallowPlayerBuild: false },
      { biomeType: 2, name: "Pine Woods", description: "Pines", hazardLevel: "Low", iconAddress: "private", disallowPlayerBuild: false },
      { biomeType: 3, name: "Snowy Peaks", description: "Snow", hazardLevel: "High", iconAddress: "private", disallowPlayerBuild: false },
    ],
  };
}

function encodedChannels(value, zoom, x, y, biomeIds = [1, 2]) {
  return {
    terrain: Buffer.from(`${value.generation}:terrain:${zoom}:${x}:${y}`),
    water: Buffer.from(`${value.generation}:water:${zoom}:${x}:${y}`),
    biomeMasks: new Map(biomeIds.map((biomeType) => [biomeType, Buffer.from(`${value.generation}:biome-${biomeType}:${zoom}:${x}:${y}`)])),
    waterTypes: zoom === -5 ? ["lake", "river"] : ["river", "ocean"],
  };
}

test("terrain store installs complete bundles and retains last-good on encoder failure", async () => {
  assert.ok(storeModule, "terrain tile store module must exist");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bitcraft-terrain-store-"));
  let calls = 0;
  let failAfter = Infinity;
  const encoder = async ({ generation: value, zoom, x, y }) => {
    calls += 1;
    if (calls > failAfter) throw new Error("forced encoder failure");
    return encodedChannels(value, zoom, x, y);
  };
  const store = storeModule.createTerrainTileStore({
    dataDir,
    encoder,
    now: () => new Date("2026-08-11T16:00:00.000Z"),
    limits: { minZoom: -5, maxZoom: -3, maxTiles: 20, maxBytes: 4096, maxTileBytes: 256, deadlineMs: 10_000 },
  });
  assert.equal(store.paletteVersion, 4, "runtime cache identity must use the installed palette version");

  const first = await store.buildAndInstall(generation(1));
  assert.equal(first.generation, "1");
  assert.equal((await store.readManifest()).generation, "1");
  assert.equal((await store.readTile({ style: "terrain", z: -5, x: 0, y: -1 })).bytes.toString(), "1:terrain:-5:0:-1");
  assert.equal((await store.readTile({ style: "water", z: -5, x: 0, y: -1 })).bytes.toString(), "1:water:-5:0:-1");
  assert.equal((await store.readTile({ style: "biome-1", z: -5, x: 0, y: -1 })).bytes.toString(), "1:biome-1:-5:0:-1");
  assert.equal(await store.readTile({ style: "biome-3", z: -5, x: 0, y: -1 }), null);
  assert.deepEqual(first.biomes.map(({ biomeType, present }) => [biomeType, present]), [[1, true], [2, true], [3, false]]);
  assert.deepEqual(first.waterTypes, ["lake", "ocean", "river"]);
  assert.equal(first.channels.biomeMasks.tileCount, 2 * first.channels.terrain.tileCount);

  calls = 0;
  failAfter = 2;
  await assert.rejects(store.buildAndInstall(generation(2)), /forced encoder failure/);
  assert.equal((await store.readManifest()).generation, "1");
  assert.equal((await store.readTile({ style: "terrain", z: -5, x: 0, y: -1 })).bytes.toString(), "1:terrain:-5:0:-1");
  assert.equal((await store.readTile({ style: "biome-1", z: -5, x: 0, y: -1 })).bytes.toString(), "1:biome-1:-5:0:-1");
  await store.close();
});

test("terrain store rejects budgets and malformed current manifests", async () => {
  assert.ok(storeModule, "terrain tile store module must exist");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bitcraft-terrain-budget-"));
  const store = storeModule.createTerrainTileStore({
    dataDir,
    encoder: async () => ({ terrain: Buffer.alloc(300), water: Buffer.alloc(1), biomeMasks: new Map() }),
    limits: { minZoom: -5, maxZoom: -3, maxTiles: 2, maxBytes: 512, maxTileBytes: 256, deadlineMs: 10_000 },
  });
  await assert.rejects(store.buildAndInstall(generation(1)), /tile budget|tile byte budget/);
  assert.equal(await store.readManifest(), null);
  await mkdir(path.join(dataDir, "map-tiles"), { recursive: true });
  await writeFile(path.join(dataDir, "map-tiles", "current.json"), "{malformed", "utf8");
  const reopened = storeModule.createTerrainTileStore({ dataDir, encoder: async () => ({ terrain: Buffer.alloc(1), water: Buffer.alloc(1), biomeMasks: new Map() }) });
  assert.equal(await reopened.readManifest(), null);
  await reopened.close();
  await store.close();
});

test("terrain tile reads do not prune the bundle currently being built", async () => {
  assert.ok(storeModule, "terrain tile store module must exist");
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "bitcraft-terrain-concurrent-"));
  let releaseSecondTile;
  let secondTileStarted;
  const secondTileGate = new Promise((resolve) => { releaseSecondTile = resolve; });
  const secondTileReady = new Promise((resolve) => { secondTileStarted = resolve; });
  let generationTwoCalls = 0;
  const store = storeModule.createTerrainTileStore({
    dataDir,
    encoder: async ({ generation: value, zoom, x, y }) => {
      if (value.generation === "2") {
        generationTwoCalls += 1;
        if (generationTwoCalls === 2) {
          secondTileStarted();
          await secondTileGate;
        }
      }
      return encodedChannels(value, zoom, x, y, []);
    },
    limits: { minZoom: -5, maxZoom: -3, maxTiles: 10, maxBytes: 1024, maxTileBytes: 256, deadlineMs: 10_000 },
  });

  await store.buildAndInstall(generation(1));
  const building = store.buildAndInstall(generation(2));
  await secondTileReady;
  assert.equal((await store.readTile({ style: "terrain", z: -5, x: 0, y: -1 })).bytes.toString(), "1:terrain:-5:0:-1");
  releaseSecondTile();
  await building;
  assert.equal((await store.readTile({ style: "terrain", z: -5, x: 0, y: -1 })).bytes.toString(), "2:terrain:-5:0:-1");
  await store.close();
});

test("terrain reads delegate to the immutable pack store and perform no pruning", async () => {
  const source = await readFile(new URL("../src/server/terrainTileStore.mjs", import.meta.url), "utf8");
  const readStart = source.indexOf("async readTile");
  const readEnd = source.indexOf("async close", readStart);
  assert.notEqual(readStart, -1);
  assert.notEqual(readEnd, -1);
  const body = source.slice(readStart, readEnd);
  assert.match(source, /createMapTilePackStore/);
  assert.match(body, /packStore\.readTile/);
  assert.doesNotMatch(body, /pruneVersions|readdir|\brm\(/);
});
