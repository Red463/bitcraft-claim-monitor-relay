import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { composeMapTilePack } from "../src/server/mapTilePackComposer.mjs";
import { createMapTilePackStore } from "../src/server/mapTilePackStore.mjs";

const REVISION = /^[a-f0-9]{40}$/;
const TERRAIN_STYLES = Object.freeze(["terrain", "water", "game", ...Array.from({ length: 256 }, (_, biomeType) => `biome-${biomeType}`)]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function numericStrings(values) {
  return [...new Set(values.map(String))].sort((left, right) => Number(left) - Number(right) || left.localeCompare(right));
}

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function exists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function tileFiles(versionRoot, directory = path.join(versionRoot, "tiles")) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (!within(versionRoot, absolute)) throw new TypeError("Legacy map tile path escapes its version");
    if (entry.isDirectory()) files.push(...await tileFiles(versionRoot, absolute));
    else if (entry.isFile()) {
      const relative = path.relative(versionRoot, absolute).split(path.sep).join("/");
      if (!/^tiles\/(?:terrain|water|game|roads|biome-\d{1,3})\/-?\d+\/-?\d+\/-?\d+\.webp$/.test(relative)) {
        throw new TypeError(`Legacy map tile path is invalid: ${relative}`);
      }
      const bytes = await readFile(absolute);
      if (!bytes.length) throw new Error(`Legacy map tile is empty: ${relative}`);
      files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, undefined, { numeric: true }));
}

async function normalizeLegacyStore(root, label) {
  let pointer;
  try {
    pointer = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Native map bundle is missing ${label}`);
    throw error;
  }
  if (!pointer || typeof pointer.version !== "string" || !/^g-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pointer.version)) {
    throw new TypeError(`Native map bundle ${label} pointer is invalid`);
  }
  const versionsRoot = path.resolve(root, "versions");
  const versionRoot = path.resolve(versionsRoot, pointer.version);
  if (!within(versionsRoot, versionRoot)) throw new TypeError(`Native map bundle ${label} version escapes its store`);
  const manifestPath = path.join(versionRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!/^\d+$/.test(String(manifest?.generation ?? "")) || !Array.isArray(manifest?.regionIds) || !manifest.regionIds.length) {
    throw new TypeError(`Native map bundle ${label} manifest is invalid`);
  }
  const files = await tileFiles(versionRoot);
  if (!files.length) throw new Error(`Native map bundle ${label} has no tiles`);
  const normalized = {
    ...manifest,
    generation: String(manifest.generation),
    regionIds: numericStrings(manifest.regionIds),
    tileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  const manifestHash = sha256(manifestBytes);
  await writeFile(manifestPath, manifestBytes);
  await writeFile(path.join(versionRoot, "complete.json"), `${JSON.stringify({ manifestHash, installedAt: normalized.generatedAt ?? new Date().toISOString() }, null, 2)}\n`);
  await writeFile(path.join(root, "current.json"), `${JSON.stringify({ version: pointer.version, manifest: normalized, manifestHash }, null, 2)}\n`);
  return { root, manifest: normalized };
}

async function terrainRoots(sourceRoot) {
  const roots = [];
  const detail = path.join(sourceRoot, "map-tiles");
  if (await exists(path.join(detail, "current.json"))) roots.push(detail);
  const overview = path.join(sourceRoot, "map-overview");
  try {
    for (const entry of await readdir(overview, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(overview, entry.name, "map-tiles");
      if (await exists(path.join(candidate, "current.json"))) roots.push(candidate);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!roots.length) throw new Error("Native map bundle is missing terrain packs");
  return roots.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

export async function installNativeMapBundleFromDirectory({ sourceRoot, dataDir, revision }) {
  if (!REVISION.test(String(revision ?? ""))) throw new TypeError("Native map bundle install requires a full lowercase revision");
  const resolvedSource = path.resolve(sourceRoot);
  const resolvedData = path.resolve(dataDir);
  if (resolvedSource === resolvedData) throw new TypeError("Native map bundle source must be isolated from live data");

  const terrainInputs = await Promise.all((await terrainRoots(resolvedSource)).map((root, index) => normalizeLegacyStore(root, `terrain pack ${index + 1}`)));
  const roadInput = await normalizeLegacyStore(path.join(resolvedSource, "map-road-tiles"), "road pack");
  const terrainRegionIds = numericStrings(terrainInputs.flatMap(({ manifest }) => manifest.regionIds));
  const roadRegionIds = numericStrings(roadInput.manifest.regionIds);
  const generation = String(Date.now());
  const generatedAt = new Date().toISOString();
  const terrainRoot = path.join(resolvedData, "map-tiles");
  const roadRoot = path.join(resolvedData, "map-road-tiles");
  await Promise.all([mkdir(terrainRoot, { recursive: true }), mkdir(roadRoot, { recursive: true })]);

  const [terrainCandidate, roadCandidate] = await Promise.all([
    composeMapTilePack({
      batchRoots: terrainInputs.map(({ root }) => root), outputRoot: terrainRoot, product: "terrain",
      expectedRegionIds: terrainRegionIds, styles: TERRAIN_STYLES,
      manifestBase: { provider: "relay", product: "terrain", generation, generatedAt, dimension: "1", releaseRevision: revision },
    }),
    composeMapTilePack({
      batchRoots: [roadInput.root], outputRoot: roadRoot, product: "roads",
      expectedRegionIds: roadRegionIds, styles: ["roads"],
      manifestBase: {
        provider: "relay", product: "roads", generation, generatedAt, dimension: "1", releaseRevision: revision,
        featureCount: Number(roadInput.manifest.featureCount ?? 0),
      },
    }),
  ]);

  const terrainStore = createMapTilePackStore({ root: terrainRoot, allowedStyles: TERRAIN_STYLES });
  const roadStore = createMapTilePackStore({ root: roadRoot, allowedStyles: ["roads"] });
  try {
    const terrain = await terrainStore.install({
      ...terrainCandidate,
      version: path.basename(terrainCandidate.stagedVersionDir).replace(/^\.staging-/, ""),
    });
    const roads = await roadStore.install({
      ...roadCandidate,
      version: path.basename(roadCandidate.stagedVersionDir).replace(/^\.staging-/, ""),
    });
    return { terrain, roads };
  } finally {
    await Promise.all([terrainStore.close(), roadStore.close()]);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const result = await installNativeMapBundleFromDirectory({
    sourceRoot: argument("--source"),
    dataDir: argument("--data-dir"),
    revision: argument("--revision"),
  });
  process.stdout.write(`${JSON.stringify({ terrainGeneration: result.terrain.generation, roadGeneration: result.roads.generation })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
