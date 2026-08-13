import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { composeMapTilePack } from "../src/server/mapTilePackComposer.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function inputPack(root, overrides = {}) {
  const versionRoot = path.join(root, "versions", "g-3");
  const relativePath = "tiles/terrain/-5/0/-1.webp";
  const bytes = Buffer.from("single-source-map-tile");
  await mkdir(path.join(versionRoot, "tiles", "terrain", "-5", "0"), { recursive: true });
  await writeFile(path.join(versionRoot, ...relativePath.split("/")), bytes);
  const manifest = {
    generation: "3",
    generatedAt: "2026-08-13T00:00:00.000Z",
    regionIds: ["3"],
    dimension: "1",
    tileCount: 1,
    totalBytes: bytes.length,
    files: [{ path: relativePath, bytes: bytes.length, sha256: sha256(bytes) }],
    ...overrides,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  const manifestHash = sha256(manifestBytes);
  await writeFile(path.join(versionRoot, "manifest.json"), manifestBytes);
  await writeFile(path.join(versionRoot, "complete.json"), `${JSON.stringify({ manifestHash })}\n`);
  await writeFile(path.join(root, "current.json"), `${JSON.stringify({ version: "g-3", manifestHash })}\n`);
}

test("composition rejects source manifest file totals that do not match accepted entries", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "map-compose-totals-"));
  const inputRoot = path.join(workspace, "input");
  await inputPack(inputRoot, { tileCount: 2 });

  await assert.rejects(composeMapTilePack({
    batchRoots: [inputRoot],
    outputRoot: path.join(workspace, "output"),
    product: "terrain",
    expectedRegionIds: ["3"],
    styles: ["terrain"],
    manifestBase: { generation: "10", generatedAt: "2026-08-13T01:00:00.000Z" },
  }), /tile count differs/i);
});
