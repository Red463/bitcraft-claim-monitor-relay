import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";
import { createMapTilePackStore } from "../src/server/mapTilePackStore.mjs";

let composerModule = null;
try {
  composerModule = await import("../src/server/mapTilePackComposer.mjs");
} catch {
  // RED: the offline full-world composer is introduced by this task.
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function solidTile({ r, g, b, alpha = 1 }) {
  return sharp({ create: { width: 4, height: 4, channels: 4, background: { r, g, b, alpha } } }).webp({ lossless: true }).toBuffer();
}

async function batchFixture(parent, name, { regionId, tile, style = "terrain", x = 0 }) {
  const root = path.join(parent, name);
  const version = `g-${regionId}`;
  const versionRoot = path.join(root, "versions", version);
  const relativeTilePath = `tiles/${style}/-5/${x}/-1.webp`;
  const tilePath = path.join(versionRoot, ...relativeTilePath.split("/"));
  await mkdir(path.dirname(tilePath), { recursive: true });
  await writeFile(tilePath, tile);
  const manifest = {
    provider: "relay",
    generation: String(regionId),
    generatedAt: "2026-08-13T00:00:00.000Z",
    observedAt: "2026-08-12T23:59:00.000Z",
    regionIds: [String(regionId)],
    dimension: "1",
    bounds: { minX: 0, minZ: 0, maxX: 38400, maxZ: 38400 },
    zoomRange: { min: -5, max: 0 },
    tileCount: 1,
    totalBytes: tile.byteLength,
    files: [{ path: relativeTilePath, bytes: tile.byteLength, sha256: sha256(tile) }],
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestHash = sha256(manifestBytes);
  await writeFile(path.join(versionRoot, "manifest.json"), manifestBytes);
  await writeFile(path.join(versionRoot, "complete.json"), `${JSON.stringify({ manifestHash, installedAt: manifest.generatedAt })}\n`, "utf8");
  await writeFile(path.join(root, "current.json"), `${JSON.stringify({ version, manifest, manifestHash }, null, 2)}\n`, "utf8");
  return root;
}

test("overlapping regional tiles become one deterministic output tile", async () => {
  assert.ok(composerModule, "map tile pack composer module must exist");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bitcraft-map-compose-"));
  const north = await batchFixture(workspace, "north", { regionId: "3", tile: await solidTile({ r: 255, g: 0, b: 0 }) });
  const south = await batchFixture(workspace, "south", { regionId: "19", tile: await solidTile({ r: 0, g: 0, b: 255, alpha: 0.5 }) });
  const outputRoot = path.join(workspace, "output");

  const result = await composerModule.composeMapTilePack({
    batchRoots: [south, north],
    outputRoot,
    product: "terrain",
    expectedRegionIds: ["19", "3"],
    styles: ["terrain"],
    manifestBase: {
      provider: "relay",
      generation: "100",
      generatedAt: "2026-08-13T01:00:00.000Z",
      dimension: "1",
      zoomRange: { min: -5, max: 0 },
    },
  });

  assert.deepEqual(result.manifest.regionIds, ["3", "19"]);
  assert.equal(result.manifest.tileCount, 1);
  assert.equal(result.manifest.files.length, 1);
  assert.match(path.basename(result.stagedVersionDir), /^\.staging-g-/);
  assert.equal(sha256(await readFile(path.join(result.stagedVersionDir, "manifest.json"))), result.manifestHash);
  const composedBytes = await readFile(path.join(result.stagedVersionDir, "tiles", "terrain", "-5", "0", "-1.webp"));
  const output = await sharp(composedBytes).ensureAlpha().raw().toBuffer();
  assert.deepEqual([...output.subarray(0, 4)], [126, 0, 128, 255], "region 19 must composite after region 3 regardless of input order");
  const store = createMapTilePackStore({ root: outputRoot, allowedStyles: ["terrain"] });
  const version = path.basename(result.stagedVersionDir).replace(/^\.staging-/, "");
  assert.equal((await store.install({ stagedVersionDir: result.stagedVersionDir, version, manifestHash: result.manifestHash })).generation, "100");
  assert.equal((await store.readTile({ style: "terrain", z: -5, x: 0, y: -1 })).generation, "100");
  await store.close();
});

test("single-source tiles are copied without re-encoding", async () => {
  assert.ok(composerModule, "map tile pack composer module must exist");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bitcraft-map-compose-copy-"));
  const tile = await solidTile({ r: 20, g: 40, b: 60 });
  const north = await batchFixture(workspace, "north", { regionId: "3", tile, x: 1 });
  const result = await composerModule.composeMapTilePack({
    batchRoots: [north],
    outputRoot: path.join(workspace, "output"),
    product: "terrain",
    expectedRegionIds: ["3"],
    styles: ["terrain"],
    manifestBase: { provider: "relay", generation: "101", generatedAt: "2026-08-13T01:00:00.000Z", dimension: "1" },
  });
  assert.deepEqual(await readFile(path.join(result.stagedVersionDir, "tiles", "terrain", "-5", "1", "-1.webp")), tile);
});

test("missing expected region prevents output", async () => {
  assert.ok(composerModule, "map tile pack composer module must exist");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "bitcraft-map-compose-missing-"));
  const north = await batchFixture(workspace, "north", { regionId: "3", tile: await solidTile({ r: 1, g: 2, b: 3 }) });
  await assert.rejects(composerModule.composeMapTilePack({
    batchRoots: [north],
    outputRoot: path.join(workspace, "output"),
    product: "terrain",
    expectedRegionIds: ["3", "19"],
    styles: ["terrain"],
    manifestBase: { provider: "relay", generation: "102", generatedAt: "2026-08-13T01:00:00.000Z", dimension: "1" },
  }), /missing region 19/i);
});
