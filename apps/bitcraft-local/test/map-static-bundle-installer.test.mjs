import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installNativeMapBundleFromDirectory } from "../scripts/install-native-map-bundle.mjs";

async function legacyPack(root, { version, style, z, x, y, regionId, generatedAt, featureCount }) {
  const versionRoot = path.join(root, "versions", version);
  const tileRoot = path.join(versionRoot, "tiles", style, String(z), String(x));
  await mkdir(tileRoot, { recursive: true });
  const bytes = Buffer.from("RIFF-map-pack-fixture-WEBP", "utf8");
  await writeFile(path.join(tileRoot, `${y}.webp`), bytes);
  const manifest = {
    provider: "relay", generation: "1", generatedAt, observedAt: generatedAt,
    regionIds: [regionId], dimension: "1", bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 },
    zoomRange: { min: -5, max: 0 }, tileCount: 1, totalBytes: bytes.length,
    ...(featureCount == null ? { biomes: [], waterTypes: [] } : { featureCount }),
  };
  await writeFile(path.join(versionRoot, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  await writeFile(path.join(root, "current.json"), `${JSON.stringify({ version, manifest })}\n`);
}

test("legacy deployment bundle is normalized, composed, and installed atomically", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-static-bundle-"));
  const sourceRoot = path.join(root, "source");
  const dataDir = path.join(root, "data");
  try {
    await legacyPack(path.join(sourceRoot, "map-overview", "batch-1", "map-tiles"), {
      version: "g-1-overview", style: "terrain", z: -5, x: 0, y: 0, regionId: "12", generatedAt: "2026-08-01T00:00:00.000Z",
    });
    await legacyPack(path.join(sourceRoot, "map-tiles"), {
      version: "g-1-detail", style: "water", z: 0, x: 1, y: -1, regionId: "19", generatedAt: "2026-08-02T00:00:00.000Z",
    });
    await legacyPack(path.join(sourceRoot, "map-road-tiles"), {
      version: "g-1-roads", style: "roads", z: -5, x: 0, y: 0, regionId: "19", generatedAt: "2026-08-03T00:00:00.000Z", featureCount: 4,
    });

    const result = await installNativeMapBundleFromDirectory({ sourceRoot, dataDir, revision: "a".repeat(40) });
    assert.deepEqual(result.terrain.regionIds, ["12", "19"]);
    assert.deepEqual(result.roads.regionIds, ["19"]);
    for (const storeName of ["map-tiles", "map-road-tiles"]) {
      const pointer = JSON.parse(await readFile(path.join(dataDir, storeName, "current.json"), "utf8"));
      assert.match(pointer.manifestHash, /^[a-f0-9]{64}$/);
      const complete = JSON.parse(await readFile(path.join(dataDir, storeName, "versions", pointer.version, "complete.json"), "utf8"));
      assert.equal(complete.manifestHash, pointer.manifestHash);
      assert.ok(pointer.manifest.files.length > 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid legacy source is rejected before either live pointer changes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "map-static-bundle-invalid-"));
  const sourceRoot = path.join(root, "source");
  const dataDir = path.join(root, "data");
  try {
    await legacyPack(path.join(sourceRoot, "map-tiles"), {
      version: "g-1-detail", style: "terrain", z: -5, x: 0, y: 0, regionId: "19", generatedAt: "2026-08-02T00:00:00.000Z",
    });
    await mkdir(path.join(dataDir, "map-tiles"), { recursive: true });
    await writeFile(path.join(dataDir, "map-tiles", "current.json"), "old-terrain\n");
    await assert.rejects(
      installNativeMapBundleFromDirectory({ sourceRoot, dataDir, revision: "b".repeat(40) }),
      /road/i,
    );
    assert.equal(await readFile(path.join(dataDir, "map-tiles", "current.json"), "utf8"), "old-terrain\n");
    await assert.rejects(readFile(path.join(dataDir, "map-road-tiles", "current.json")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
