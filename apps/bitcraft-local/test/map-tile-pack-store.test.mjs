import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

let storeModule = null;
try {
  storeModule = await import("../src/server/mapTilePackStore.mjs");
} catch {
  // RED: the immutable pack store is introduced by this task.
}

function manifest(generation, generatedAt = "2026-08-13T00:00:00.000Z") {
  return {
    provider: "relay",
    generation: String(generation),
    generatedAt,
    regionIds: ["19"],
    dimension: "1",
    zoomRange: { min: -5, max: 0 },
    tileCount: 1,
    totalBytes: 4,
  };
}

function manifestBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writePointer(root, version, value, manifestHash) {
  await writeFile(path.join(root, "current.json"), `${JSON.stringify({ version, manifest: value, manifestHash }, null, 2)}\n`, "utf8");
}

async function installFixture(root, version, value, { tile = Buffer.from("tile") } = {}) {
  const versionRoot = path.join(root, "versions", version);
  const tileRoot = path.join(versionRoot, "tiles", "terrain", "-1", "45");
  await mkdir(tileRoot, { recursive: true });
  await writeFile(path.join(tileRoot, "-47.webp"), tile);
  const bytes = manifestBytes(value);
  const manifestHash = sha256(bytes);
  await writeFile(path.join(versionRoot, "manifest.json"), bytes);
  await writeFile(path.join(versionRoot, "complete.json"), `${JSON.stringify({ manifestHash })}\n`, "utf8");
  await writePointer(root, version, value, manifestHash);
  return { versionRoot, manifestHash };
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

test("cached reader A never deletes newly installed B", async () => {
  assert.ok(storeModule, "map tile pack store module must exist");
  const root = await mkdtemp(path.join(os.tmpdir(), "bitcraft-map-pack-race-"));
  await installFixture(root, "g-1", manifest(1));
  const store = storeModule.createMapTilePackStore({ root, allowedStyles: ["terrain"], pointerTtlMs: 0 });
  assert.equal((await store.readManifest()).generation, "1");

  await installFixture(root, "g-2", manifest(2, "2026-08-13T01:00:00.000Z"));
  assert.equal((await store.readTile({ style: "terrain", z: -1, x: 45, y: -47 })).generation, "2");
  assert.equal(await exists(path.join(root, "versions", "g-2")), true);
  await store.close();
});

test("malformed replacement pointer retains last-good", async () => {
  assert.ok(storeModule, "map tile pack store module must exist");
  const root = await mkdtemp(path.join(os.tmpdir(), "bitcraft-map-pack-pointer-"));
  await installFixture(root, "g-1", manifest(1));
  const store = storeModule.createMapTilePackStore({ root, allowedStyles: ["terrain"], pointerTtlMs: 0 });
  assert.equal((await store.readManifest()).generation, "1");

  await writeFile(path.join(root, "current.json"), "{", "utf8");
  assert.equal((await store.readManifest()).generation, "1");
  assert.equal((await store.readTile({ style: "terrain", z: -1, x: 45, y: -47 })).bytes.toString(), "tile");
  await store.close();
});

test("tile paths cannot escape the installed version", async () => {
  assert.ok(storeModule, "map tile pack store module must exist");
  const root = await mkdtemp(path.join(os.tmpdir(), "bitcraft-map-pack-path-"));
  await installFixture(root, "g-1", manifest(1));
  const store = storeModule.createMapTilePackStore({ root, allowedStyles: ["terrain"] });

  assert.equal(await store.readTile({ style: "terrain", z: -1, x: 45, y: Number.NaN }), null);
  assert.equal(await store.readTile({ style: "../terrain", z: -1, x: 45, y: -47 }), null);
  assert.equal(await store.readTile({ style: "terrain", z: -1, x: Number.MAX_SAFE_INTEGER + 1, y: -47 }), null);
  assert.deepEqual((await readdir(path.join(root, "versions"))).sort(), ["g-1"]);
  await store.close();
});

test("installed tile reads enforce the byte budget", async () => {
  assert.ok(storeModule, "map tile pack store module must exist");
  const root = await mkdtemp(path.join(os.tmpdir(), "bitcraft-map-pack-budget-"));
  await installFixture(root, "g-1", manifest(1), { tile: Buffer.alloc(5) });
  const store = storeModule.createMapTilePackStore({ root, allowedStyles: ["terrain"], maxTileBytes: 4 });
  await assert.rejects(store.readTile({ style: "terrain", z: -1, x: 45, y: -47 }), /read budget/i);
  await store.close();
});

