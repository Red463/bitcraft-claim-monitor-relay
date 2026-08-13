import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

let tileModule = null;
try {
  tileModule = await import("../src/server/mapTiles.mjs");
} catch {
  // The RED run proves the focused same-origin tile boundary does not exist yet.
}

function responseRecorder() {
  return {
    status: 0,
    headers: {},
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = null) { this.body = body; },
  };
}

test("map tile route serves installed negative-Y terrain tiles through the store", async () => {
  assert.ok(tileModule, "map tile module must exist");
  const expected = Buffer.from([0x52, 0x49, 0x46, 0x46]);
  const store = { readTile: async (request) => request.style === "terrain" && request.z === -5 && request.x === 0 && request.y === -2
    ? { bytes: expected, contentType: "image/webp", generation: "1" }
    : null };

  const res = responseRecorder();
  assert.equal(await tileModule.serveLocalMapTile("/api/local/map/tiles/terrain/-5/0/-2.webp", res, store), true);
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/webp");
  assert.equal(res.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.deepEqual(res.body, expected);
});

test("map tile route serves the aligned same-origin water channel", async () => {
  assert.ok(tileModule, "map tile module must exist");
  const expected = Buffer.from([0x52, 0x49, 0x46, 0x46]);
  const store = { readTile: async (request) => request.style === "water"
    ? { bytes: expected, contentType: "image/webp", generation: "1" }
    : null };
  const res = responseRecorder();
  assert.equal(await tileModule.serveLocalMapTile("/api/local/map/tiles/water/-5/0/-2.webp", res, store), true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, expected);
});

test("map tile route serves a bounded same-origin biome mask channel", async () => {
  const expected = Buffer.from("biome-mask");
  const requests = [];
  const store = { readTile: async (request) => {
    requests.push(request);
    return request.style === "biome-2" ? { bytes: expected, contentType: "image/webp", generation: "1" } : null;
  } };
  const res = responseRecorder();
  assert.equal(await tileModule.serveLocalMapTile("/api/local/map/tiles/biome-2/-5/0/-2.webp", res, store), true);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, expected);
  assert.deepEqual(requests, [{ style: "biome-2", z: -5, x: 0, y: -2 }]);
});

test("map tile route serves installed roads from the independent durable store", async () => {
  const expected = Buffer.from("roads");
  const res = responseRecorder();
  const terrainStore = { readTile: async () => null };
  const roadStore = { readTile: async (request) => request.style === "roads" ? { bytes: expected, contentType: "image/webp", generation: "9" } : null };
  await tileModule.serveLocalMapTile("/api/local/map/tiles/roads/-5/0/-1.webp", res, terrainStore, undefined, null, roadStore);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, expected);
});

test("map tile route rejects unsupported styles and coordinates without filesystem traversal", async () => {
  assert.ok(tileModule, "map tile module must exist");
  const store = { readTile: async () => null };
  for (const pathname of [
    "/api/local/map/tiles/external/-5/0/-2.webp",
    "/api/local/map/tiles/terrain/-6/0/-2.webp",
    "/api/local/map/tiles/terrain/-5/0/../../secret.webp",
    "/api/local/map/tiles/biome-256/-5/0/-2.webp",
    "/api/local/map/tiles/biome-x/-5/0/-2.webp",
    "/api/local/map/tiles/biome-2/-5/0/../../secret.webp",
  ]) {
    const res = responseRecorder();
    assert.equal(await tileModule.serveLocalMapTile(pathname, res, store), true);
    assert.equal(res.status, 400);
  }
});

test("map tile route returns a cacheable 404 when a local tile is not installed", async () => {
  assert.ok(tileModule, "map tile module must exist");
  const store = { readTile: async () => null };
  const res = responseRecorder();
  assert.equal(await tileModule.serveLocalMapTile("/api/local/map/tiles/game/0/4/-3.webp", res, store), true);
  assert.equal(res.status, 404);
  assert.equal(res.body, null);
});

test("map tile status returns unavailable or a public installed manifest", async () => {
  assert.ok(tileModule, "map tile module must exist");
  const unavailable = responseRecorder();
  await tileModule.serveLocalMapTile(
    "/api/local/map/tiles/status",
    unavailable,
    { readManifest: async () => null },
    undefined,
    { buildStage: "building" },
  );
  assert.equal(unavailable.status, 200);
  assert.deepEqual(JSON.parse(unavailable.body), {
    provider: "relay", available: false, generation: null, generatedAt: null, observedAt: null,
    freshness: "unavailable", ageMs: null, regionIds: [], dimension: "1", bounds: null,
    zoomRange: { min: -5, max: 0 }, paletteVersion: null, tileCount: 0, totalBytes: 0,
    biomes: [], waterTypes: [], channels: { terrain: { tileCount: 0, totalBytes: 0 }, water: { tileCount: 0, totalBytes: 0 }, biomeMasks: { tileCount: 0, totalBytes: 0 } },
    buildStage: "building", warnings: ["Relay terrain is building its first complete tile bundle."],
  });

  const failed = responseRecorder();
  await tileModule.serveLocalMapTile(
    "/api/local/map/tiles/status",
    failed,
    { readManifest: async () => null },
    undefined,
    { buildStage: "error", lastError: "regional schema mismatch" },
  );
  assert.deepEqual(JSON.parse(failed.body).warnings, ["Relay terrain is unavailable: regional schema mismatch"]);

  const available = responseRecorder();
  const manifest = {
    generation: "42", generatedAt: "2026-08-11T16:00:00.000Z", observedAt: "2026-08-11T15:59:59.000Z",
    regionIds: ["19"], dimension: "1", bounds: { minX: 1, minZ: 2, maxX: 3, maxZ: 4 },
    zoomRange: { min: -5, max: 0 }, paletteVersion: 1, tileCount: 12, totalBytes: 345,
    channels: { terrain: { tileCount: 4, totalBytes: 100 }, water: { tileCount: 4, totalBytes: 100 }, biomeMasks: { tileCount: 4, totalBytes: 145 } },
    biomes: [{ biomeType: 1, name: "Calm Forest", description: "Calm", hazardLevel: "Safe", disallowPlayerBuild: false, present: true, iconAddress: "must-not-leak" }],
    waterTypes: ["lake", "river", "ocean", "ocean-biome", "swamp", "lava"],
  };
  await tileModule.serveLocalMapTile("/api/local/map/tiles/status", available, { readManifest: async () => manifest }, () => new Date("2026-08-11T16:00:00.000Z"));
  const payload = JSON.parse(available.body);
  assert.equal(payload.available, true);
  assert.equal(payload.generation, "42");
  assert.equal(payload.freshness, "live");
  assert.equal(payload.ageMs, 1000);
  assert.equal(payload.dataDir, undefined);
  assert.deepEqual(payload.biomes, [{ biomeType: 1, name: "Calm Forest", description: "Calm", hazardLevel: "Safe", disallowPlayerBuild: false, present: true }]);
  assert.equal(payload.biomes[0].iconAddress, undefined);
  assert.deepEqual(payload.waterTypes, ["lake", "ocean", "ocean-biome", "river", "swamp"]);
  assert.deepEqual(payload.channels.biomeMasks, { tileCount: 4, totalBytes: 145 });

  const withRoads = responseRecorder();
  await tileModule.serveLocalMapTile("/api/local/map/tiles/status", withRoads, { readManifest: async () => manifest }, () => new Date("2026-08-11T16:00:00.000Z"), null, {
    readManifest: async () => ({ generation: "9", generatedAt: "2026-08-11T15:00:00.000Z", regionIds: ["19"], tileCount: 20, totalBytes: 500, featureCount: 600 }),
  });
  assert.deepEqual(JSON.parse(withRoads.body).roads, {
    available: true, generation: "9", generatedAt: "2026-08-11T15:00:00.000Z", ageMs: 3_600_000, freshness: "live",
    regionIds: ["19"], tileCount: 20, totalBytes: 500, featureCount: 600, warnings: [],
  });
});

test("static layer status uses weekly terrain and daily road freshness windows", async () => {
  const terrainManifest = {
    generation: "42", generatedAt: "2026-08-01T00:00:00.000Z", observedAt: "2026-08-01T00:00:00.000Z",
    regionIds: ["3", "19"], dimension: "1", bounds: null, zoomRange: { min: -5, max: 0 }, tileCount: 1, totalBytes: 1,
    biomes: [], waterTypes: [], channels: { terrain: { tileCount: 1, totalBytes: 1 }, water: { tileCount: 0, totalBytes: 0 }, biomeMasks: { tileCount: 0, totalBytes: 0 } },
  };
  const roadManifest = { generation: "9", generatedAt: "2026-08-01T00:00:00.000Z", regionIds: ["3", "19"], tileCount: 1, totalBytes: 1, featureCount: 2 };
  async function statusAt(now) {
    const response = responseRecorder();
    await tileModule.serveLocalMapTile("/api/local/map/tiles/status", response, { readManifest: async () => terrainManifest }, () => new Date(now), null, { readManifest: async () => roadManifest });
    return JSON.parse(response.body);
  }
  assert.equal((await statusAt("2026-08-08T00:00:00.000Z")).freshness, "live");
  assert.equal((await statusAt("2026-08-10T00:00:00.000Z")).freshness, "stale");
  assert.equal((await statusAt("2026-08-02T06:00:00.000Z")).roads.freshness, "live");
  assert.equal((await statusAt("2026-08-02T16:00:00.000Z")).roads.freshness, "stale");
});

test("production server handles same-origin map tiles before map snapshot acquisition", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /import \{ serveLocalMapTile \} from "\.\/src\/server\/mapTiles\.mjs"/);
  assert.match(server, /await serveLocalMapTile\(url\.pathname, res, terrainTileStore, undefined, relayTerrainRuntime\.health\(\), roadTileStore\)/);
  assert.ok(server.indexOf("await serveLocalMapTile(url.pathname, res, terrainTileStore, undefined, relayTerrainRuntime.health(), roadTileStore)") < server.indexOf('["/api/local/map/snapshot", "/api/local/map/resources", "/api/local/map/events"].includes(url.pathname)'));
});
