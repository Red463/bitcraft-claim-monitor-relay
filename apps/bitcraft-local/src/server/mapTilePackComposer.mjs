import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const HASH = /^[a-f0-9]{64}$/;
const SAFE_STYLE = /^[a-z][a-z0-9-]{0,63}$/;

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

function tileCoordinates(relativePath, allowedStyles) {
  if (typeof relativePath !== "string" || relativePath.includes("\\") || path.posix.normalize(relativePath) !== relativePath) return null;
  const parts = relativePath.split("/");
  if (parts.length !== 5 || parts[0] !== "tiles" || !allowedStyles.has(parts[1])) return null;
  const yMatch = /^(-?\d+)\.webp$/.exec(parts[4]);
  const z = Number(parts[2]);
  const x = Number(parts[3]);
  const y = Number(yMatch?.[1]);
  if (!Number.isSafeInteger(z) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  return { style: parts[1], z, x, y, relativePath };
}

function compareTiles(left, right) {
  return left.style.localeCompare(right.style)
    || left.z - right.z
    || left.x - right.x
    || left.y - right.y;
}

async function installedVersionRoot(batchRoot) {
  const candidates = [path.resolve(batchRoot), path.resolve(batchRoot, "map-tiles"), path.resolve(batchRoot, "map-road-tiles")];
  for (const root of candidates) {
    try {
      const pointer = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
      if (!pointer || typeof pointer.version !== "string" || !HASH.test(String(pointer.manifestHash ?? ""))) continue;
      const versionRoot = path.resolve(root, "versions", pointer.version);
      if (!within(path.resolve(root, "versions"), versionRoot)) continue;
      return { versionRoot, pointer };
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }
  try {
    await readFile(path.join(path.resolve(batchRoot), "manifest.json"));
    return { versionRoot: path.resolve(batchRoot), pointer: null };
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Map tile input has no installed manifest: ${batchRoot}`);
    throw error;
  }
}

async function readBatch(batchRoot, allowedStyles) {
  const { versionRoot, pointer } = await installedVersionRoot(batchRoot);
  const manifestBytes = await readFile(path.join(versionRoot, "manifest.json"));
  const manifestHash = sha256(manifestBytes);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (pointer?.manifestHash && pointer.manifestHash !== manifestHash) throw new Error(`Map tile input manifest hash differs: ${batchRoot}`);
  if (!/^\d+$/.test(String(manifest?.generation ?? "")) || !Array.isArray(manifest?.regionIds) || !Array.isArray(manifest?.files)) {
    throw new TypeError(`Map tile input manifest is incomplete: ${batchRoot}`);
  }
  if (pointer) {
    const complete = JSON.parse(await readFile(path.join(versionRoot, "complete.json"), "utf8"));
    if (complete?.manifestHash !== manifestHash) throw new Error(`Map tile input is not complete: ${batchRoot}`);
  }
  const files = [];
  for (const file of manifest.files) {
    const coordinates = tileCoordinates(file?.path, allowedStyles);
    if (!coordinates) continue;
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !HASH.test(String(file.sha256 ?? ""))) throw new TypeError(`Map tile input file metadata is invalid: ${file?.path}`);
    const absolutePath = path.resolve(versionRoot, ...file.path.split("/"));
    if (!within(versionRoot, absolutePath)) throw new TypeError(`Map tile input path escapes its version: ${file.path}`);
    files.push({ ...coordinates, absolutePath, bytes: file.bytes, sha256: file.sha256 });
  }
  return { root: path.resolve(batchRoot), versionRoot, manifest, manifestHash, files };
}

function batchOrder(left, right) {
  const leftRegions = numericStrings(left.manifest.regionIds);
  const rightRegions = numericStrings(right.manifest.regionIds);
  return Number(leftRegions[0]) - Number(rightRegions[0])
    || leftRegions.join(",").localeCompare(rightRegions.join(","), undefined, { numeric: true })
    || left.root.localeCompare(right.root);
}

function mergedBounds(batches) {
  const bounds = batches.map(({ manifest }) => manifest.bounds).filter(Boolean);
  if (!bounds.length) return null;
  return {
    minX: Math.min(...bounds.map(({ minX }) => Number(minX))),
    minZ: Math.min(...bounds.map(({ minZ }) => Number(minZ))),
    maxX: Math.max(...bounds.map(({ maxX }) => Number(maxX))),
    maxZ: Math.max(...bounds.map(({ maxZ }) => Number(maxZ))),
  };
}

function mergedBiomes(batches) {
  const values = new Map();
  for (const { manifest } of batches) for (const biome of manifest.biomes ?? []) {
    const biomeType = Number(biome.biomeType);
    if (!Number.isInteger(biomeType) || biomeType < 0 || biomeType > 255) continue;
    const previous = values.get(biomeType);
    values.set(biomeType, { ...(previous ?? {}), ...biome, biomeType, present: Boolean(previous?.present || biome.present) });
  }
  return [...values.values()].sort((left, right) => left.biomeType - right.biomeType);
}

async function sourceBytes(source) {
  const bytes = await readFile(source.absolutePath);
  if (bytes.byteLength !== source.bytes || sha256(bytes) !== source.sha256) throw new Error(`Map tile input differs from manifest: ${source.relativePath}`);
  return bytes;
}

async function composeSources(sources) {
  if (sources.length === 1) return sourceBytes(sources[0]);
  const inputs = await Promise.all(sources.map(sourceBytes));
  const { default: sharp } = await import("sharp");
  return sharp(inputs[0], { failOn: "error" })
    .composite(inputs.slice(1).map((input) => ({ input })))
    .webp({ lossless: true, effort: 4 })
    .toBuffer();
}

export async function composeMapTilePack({ batchRoots, outputRoot, product, expectedRegionIds, styles, manifestBase }) {
  if (!Array.isArray(batchRoots) || !batchRoots.length) throw new TypeError("Map tile composition requires input batches");
  if (typeof product !== "string" || !SAFE_STYLE.test(product)) throw new TypeError("Map tile composition requires a safe product");
  const allowedStyles = new Set(styles ?? []);
  if (!allowedStyles.size || [...allowedStyles].some((style) => typeof style !== "string" || !SAFE_STYLE.test(style))) throw new TypeError("Map tile composition requires safe styles");
  const expected = numericStrings(expectedRegionIds ?? []);
  if (!expected.length) throw new TypeError("Map tile composition requires expected regions");
  if (!/^\d+$/.test(String(manifestBase?.generation ?? ""))) throw new TypeError("Map tile composition requires a decimal generation");
  const generatedAt = new Date(manifestBase.generatedAt ?? Date.now());
  if (!Number.isFinite(generatedAt.getTime())) throw new TypeError("Map tile composition requires a valid generated time");
  const resolvedOutputRoot = path.resolve(outputRoot);
  const version = `g-${manifestBase.generation}-${generatedAt.getTime()}-${process.pid}`;
  const stagedVersionDir = path.resolve(resolvedOutputRoot, `.staging-${version}`);
  if (!within(resolvedOutputRoot, stagedVersionDir)) throw new TypeError("Map tile composition staging path escapes output root");

  const batches = (await Promise.all(batchRoots.map((batchRoot) => readBatch(batchRoot, allowedStyles)))).sort(batchOrder);
  const actual = numericStrings(batches.flatMap(({ manifest }) => manifest.regionIds));
  for (const regionId of expected) if (!actual.includes(regionId)) throw new Error(`Map tile composition is missing region ${regionId}`);
  for (const regionId of actual) if (!expected.includes(regionId)) throw new Error(`Map tile composition includes unexpected region ${regionId}`);

  const sourcesByTile = new Map();
  for (const batch of batches) for (const file of batch.files) {
    const key = file.relativePath;
    if (!sourcesByTile.has(key)) sourcesByTile.set(key, []);
    sourcesByTile.get(key).push(file);
  }
  if (!sourcesByTile.size) throw new Error("Map tile composition found no selected tiles");
  const keys = [...sourcesByTile.keys()].map((key) => tileCoordinates(key, allowedStyles)).sort(compareTiles);
  let totalBytes = 0;
  const files = [];
  const channelTotals = {
    terrain: { tileCount: 0, totalBytes: 0 },
    water: { tileCount: 0, totalBytes: 0 },
    biomeMasks: { tileCount: 0, totalBytes: 0 },
  };
  try {
    await mkdir(resolvedOutputRoot, { recursive: true });
    await mkdir(stagedVersionDir, { recursive: false });
    for (const tile of keys) {
      const sources = sourcesByTile.get(tile.relativePath);
      const outputPath = path.resolve(stagedVersionDir, ...tile.relativePath.split("/"));
      if (!within(stagedVersionDir, outputPath)) throw new TypeError(`Map tile output path escapes staging: ${tile.relativePath}`);
      await mkdir(path.dirname(outputPath), { recursive: true });
      let bytes;
      if (sources.length === 1) {
        await copyFile(sources[0].absolutePath, outputPath);
        bytes = await sourceBytes(sources[0]);
      } else {
        bytes = await composeSources(sources);
        await writeFile(outputPath, bytes, { flag: "wx" });
      }
      totalBytes += bytes.byteLength;
      files.push({ path: tile.relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
      const channel = tile.style === "terrain" ? "terrain" : tile.style === "water" ? "water" : tile.style.startsWith("biome-") ? "biomeMasks" : null;
      if (channel) {
        channelTotals[channel].tileCount += 1;
        channelTotals[channel].totalBytes += bytes.byteLength;
      }
    }
    const observedAt = batches.map(({ manifest }) => manifest.observedAt).filter(Boolean).sort().at(0) ?? null;
    const manifest = {
      ...manifestBase,
      provider: String(manifestBase.provider ?? "relay"),
      product,
      generation: String(manifestBase.generation),
      generatedAt: generatedAt.toISOString(),
      observedAt,
      regionIds: expected,
      dimension: String(manifestBase.dimension ?? "1"),
      bounds: manifestBase.bounds ?? mergedBounds(batches),
      zoomRange: manifestBase.zoomRange ?? { min: Math.min(...keys.map(({ z }) => z)), max: Math.max(...keys.map(({ z }) => z)) },
      tileCount: files.length,
      totalBytes,
      biomes: manifestBase.biomes ?? mergedBiomes(batches),
      waterTypes: manifestBase.waterTypes ?? [...new Set(batches.flatMap(({ manifest }) => manifest.waterTypes ?? []))].sort(),
      channels: manifestBase.channels ?? channelTotals,
      files,
      sources: batches.map(({ manifest, manifestHash }) => ({ regionIds: numericStrings(manifest.regionIds), generation: String(manifest.generation), manifestHash })),
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const manifestHash = sha256(manifestBytes);
    await writeFile(path.join(stagedVersionDir, "manifest.json"), manifestBytes, { flag: "wx" });
    return { stagedVersionDir, manifest, manifestHash };
  } catch (error) {
    await rm(stagedVersionDir, { recursive: true, force: true });
    throw error;
  }
}
