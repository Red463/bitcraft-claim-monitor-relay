import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { packageNativeMapProduct } from "../scripts/package-native-map-product.mjs";
import { installNativeMapProduct } from "../scripts/install-native-map-product.mjs";
import { createMapTilePackStore } from "../src/server/mapTilePackStore.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function installRoadFixture(dataDir, generation) {
  const root = path.join(dataDir, "map-road-tiles");
  const stage = path.join(root, `.staging-g-${generation}`);
  const tile = Buffer.from(`roads-${generation}`);
  await mkdir(path.join(stage, "tiles", "roads", "-5", "0"), { recursive: true });
  await writeFile(path.join(stage, "tiles", "roads", "-5", "0", "0.webp"), tile);
  const manifest = {
    provider: "relay",
    product: "roads",
    generation: String(generation),
    generatedAt: "2026-08-16T00:00:00.000Z",
    dimension: "1",
    regionIds: ["19"],
    zoomRange: { min: -5, max: 0 },
    featureCount: 1,
    joinVersion: "paved-location-overworld-v1",
    tileCount: 1,
    totalBytes: tile.byteLength,
    files: [{ path: "tiles/roads/-5/0/0.webp", bytes: tile.byteLength, sha256: sha256(tile) }],
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(stage, "manifest.json"), manifestBytes);
  const store = createMapTilePackStore({ root, allowedStyles: ["roads"] });
  await store.install({ stagedVersionDir: stage, version: `g-${generation}`, manifestHash: sha256(manifestBytes) });
  await store.close();
  return manifest;
}

test("a packaged road product installs atomically without touching terrain", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "map-product-transfer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const artifact = path.join(root, "artifact");
  const destination = path.join(root, "destination");
  await installRoadFixture(source, 101);
  await mkdir(path.join(destination, "map-tiles"), { recursive: true });
  await writeFile(path.join(destination, "map-tiles", "sentinel"), "terrain-stays");

  const packaged = await packageNativeMapProduct({ dataDir: source, product: "roads", outputDir: artifact });
  const installed = await installNativeMapProduct({ sourceDataDir: artifact, dataDir: destination, product: "roads" });

  assert.equal(packaged.version, "g-101");
  assert.equal(installed.generation, "101");
  assert.equal(await readFile(path.join(destination, "map-tiles", "sentinel"), "utf8"), "terrain-stays");
});

test("a malformed imported product retains the destination last-good pointer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "map-product-reject-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const artifact = path.join(root, "artifact");
  const destination = path.join(root, "destination");
  await installRoadFixture(source, 202);
  await installRoadFixture(destination, 201);
  await packageNativeMapProduct({ dataDir: source, product: "roads", outputDir: artifact });
  const pointerPath = path.join(artifact, "map-road-tiles", "current.json");
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  pointer.manifestHash = "0".repeat(64);
  await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);

  await assert.rejects(() => installNativeMapProduct({ sourceDataDir: artifact, dataDir: destination, product: "roads" }), /readable installed pointer|manifest/i);
  const retained = JSON.parse(await readFile(path.join(destination, "map-road-tiles", "current.json"), "utf8"));
  assert.equal(retained.generation, "201");
});
