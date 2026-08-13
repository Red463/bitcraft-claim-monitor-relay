import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyNativeMapPack } from "../scripts/verify-native-map-pack.mjs";

async function pointer(root, product, overrides = {}) {
  await mkdir(root, { recursive: true });
  const manifest = {
    product,
    generation: "10",
    generatedAt: "2026-08-13T01:00:00.000Z",
    regionIds: ["3", "19"],
    dimension: "1",
    zoomRange: { min: -5, max: 0 },
    tileCount: 2,
    totalBytes: 100,
    files: [{ path: "tiles/a", bytes: 50 }, { path: "tiles/b", bytes: 50 }],
    ...(product === "terrain"
      ? { channels: { terrain: { tileCount: 1 }, water: { tileCount: 1 } } }
      : { featureCount: 20, joinVersion: "paved-location-overworld-v1" }),
    ...overrides,
  };
  await writeFile(path.join(root, "current.json"), `${JSON.stringify({ version: "g-10", manifest })}\n`);
}

test("native map pack verifier accepts complete full-zoom terrain and roads", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "map-pack-verify-"));
  await pointer(path.join(dataDir, "map-tiles"), "terrain");
  await pointer(path.join(dataDir, "map-road-tiles"), "roads");
  assert.equal((await verifyNativeMapPack({ dataDir, product: "terrain" })).generation, "10");
  assert.equal((await verifyNativeMapPack({ dataDir, product: "roads" })).featureCount, 20);
});

test("native map pack verifier rejects partial zoom coverage and incomplete roads", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "map-pack-reject-"));
  await pointer(path.join(dataDir, "map-tiles"), "terrain", { zoomRange: { min: -5, max: -2 } });
  await pointer(path.join(dataDir, "map-road-tiles"), "roads", { joinVersion: null });
  await assert.rejects(verifyNativeMapPack({ dataDir, product: "terrain" }), /zoom -5 through 0/i);
  await assert.rejects(verifyNativeMapPack({ dataDir, product: "roads" }), /join version/i);
});
