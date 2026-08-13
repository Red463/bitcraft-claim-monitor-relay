import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyNativeMapPack, verifyNativeMapServing } from "../scripts/verify-native-map-pack.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function pointer(root, product, overrides = {}, { installed = true } = {}) {
  await mkdir(root, { recursive: true });
  const tileFiles = product === "terrain"
    ? [{ path: "tiles/terrain/-5/0/-1.webp", content: Buffer.from("t") }, { path: "tiles/water/-5/0/-1.webp", content: Buffer.from("w") }]
    : [{ path: "tiles/roads/-5/0/-1.webp", content: Buffer.from("r") }];
  const manifest = {
    product,
    generation: "10",
    generatedAt: "2026-08-13T01:00:00.000Z",
    regionIds: ["3", "19"],
    dimension: "1",
    zoomRange: { min: -5, max: 0 },
    tileCount: tileFiles.length,
    totalBytes: tileFiles.reduce((total, file) => total + file.content.byteLength, 0),
    files: tileFiles.map((file) => ({ path: file.path, bytes: file.content.byteLength, sha256: sha256(file.content) })),
    ...(product === "terrain"
      ? { channels: { terrain: { tileCount: 1 }, water: { tileCount: 1 } } }
      : { featureCount: 20, joinVersion: "paved-location-overworld-v1" }),
    ...overrides,
  };
  if (!installed) {
    await writeFile(path.join(root, "current.json"), `${JSON.stringify({ version: "g-10", manifest })}\n`);
    return;
  }
  const versionRoot = path.join(root, "versions", "g-10");
  for (const file of tileFiles) {
    const target = path.join(versionRoot, ...file.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const manifestHash = sha256(manifestBytes);
  await writeFile(path.join(versionRoot, "manifest.json"), manifestBytes);
  await writeFile(path.join(versionRoot, "complete.json"), `${JSON.stringify({ manifestHash })}\n`);
  await writeFile(path.join(root, "current.json"), `${JSON.stringify({ version: "g-10", manifest, manifestHash })}\n`);
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

test("native map pack verifier rejects an embedded manifest without an installed hashed generation", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "map-pack-uninstalled-"));
  await pointer(path.join(dataDir, "map-tiles"), "terrain", {}, { installed: false });
  await assert.rejects(verifyNativeMapPack({ dataDir, product: "terrain" }), /installed|pointer/i);
});

test("native map serving verifier requires matching status and real terrain, water, and road responses", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "map-pack-serving-"));
  await pointer(path.join(dataDir, "map-tiles"), "terrain");
  await pointer(path.join(dataDir, "map-road-tiles"), "roads");
  const requests = [];
  const result = await verifyNativeMapServing({
    dataDir,
    baseUrl: "http://127.0.0.1:19430",
    attempts: 2,
    delayMs: 0,
    sleep: async () => {},
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith("/status")) return {
        ok: true,
        async json() { return requests.filter((value) => value.endsWith("/status")).length === 1
          ? { available: false, roads: { available: false } }
          : { available: true, generation: "10", roads: { available: true, generation: "10" } }; },
      };
      return { ok: true, headers: { get: () => "image/webp" }, async arrayBuffer() { return Buffer.from("tile"); } };
    },
  });
  assert.equal(result.terrain.generation, "10");
  assert.equal(result.roads.generation, "10");
  assert.equal(requests.filter((url) => url.endsWith("/status")).length, 2);
  assert.deepEqual(requests.filter((url) => url.includes("/tiles/terrain/")).length, 1);
  assert.deepEqual(requests.filter((url) => url.includes("/tiles/water/")).length, 1);
  assert.deepEqual(requests.filter((url) => url.includes("/tiles/roads/")).length, 1);
});
