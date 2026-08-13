import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const VERSION = /^g-[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const MANIFEST_HASH = /^[a-f0-9]{64}$/;

function within(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nowMilliseconds(now) {
  const value = now();
  return value instanceof Date ? value.getTime() : Number(value);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validManifest(value) {
  return value && typeof value === "object" && /^\d+$/.test(String(value.generation ?? ""));
}

async function readInstalledPointer(root, candidate) {
  if (!candidate || typeof candidate !== "object" || !VERSION.test(candidate.version) || !MANIFEST_HASH.test(candidate.manifestHash)) return null;
  const versionsRoot = path.resolve(root, "versions");
  const versionRoot = path.resolve(versionsRoot, candidate.version);
  if (!within(versionsRoot, versionRoot)) return null;

  const [manifestBytes, completeBytes] = await Promise.all([
    readFile(path.join(versionRoot, "manifest.json")),
    readFile(path.join(versionRoot, "complete.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const complete = JSON.parse(completeBytes);
  if (!validManifest(manifest) || complete?.manifestHash !== candidate.manifestHash || sha256(manifestBytes) !== candidate.manifestHash) return null;
  if (!validManifest(candidate.manifest) || String(candidate.manifest.generation) !== String(manifest.generation)) return null;
  return Object.freeze({ version: candidate.version, manifest: Object.freeze({ ...manifest }), manifestHash: candidate.manifestHash });
}

export function createMapTilePackStore({
  root,
  allowedStyles,
  maxTileBytes = 2 * 1024 * 1024,
  pointerTtlMs = 1000,
  now = Date.now,
}) {
  const resolvedRoot = path.resolve(root);
  const versionsRoot = path.resolve(resolvedRoot, "versions");
  const allowed = new Set(allowedStyles ?? []);
  if (!allowed.size || [...allowed].some((style) => typeof style !== "string" || !style.length || style.includes("/") || style.includes("\\"))) {
    throw new TypeError("Map tile pack store requires safe allowed styles");
  }
  if (!Number.isSafeInteger(maxTileBytes) || maxTileBytes <= 0) throw new TypeError("Map tile pack byte budget must be a positive safe integer");
  if (!Number.isFinite(pointerTtlMs) || pointerTtlMs < 0) throw new TypeError("Map tile pack pointer TTL must be non-negative");
  if (!within(resolvedRoot, versionsRoot)) throw new TypeError("Map tile pack versions path escapes root");

  let lastGood = null;
  let checkedAt = -Infinity;
  let closed = false;

  async function current() {
    if (closed) throw new Error("Map tile pack store is closed");
    const checkedNow = nowMilliseconds(now);
    if (lastGood && checkedNow - checkedAt < pointerTtlMs) return lastGood;
    checkedAt = checkedNow;
    try {
      const candidate = JSON.parse(await readFile(path.join(resolvedRoot, "current.json"), "utf8"));
      const installed = await readInstalledPointer(resolvedRoot, candidate);
      if (installed) lastGood = installed;
    } catch (error) {
      if (!lastGood && error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    return lastGood;
  }

  async function readManifest() {
    const pointer = await current();
    return pointer ? { ...pointer.manifest } : null;
  }

  async function readTile({ style, z, x, y }) {
    if (!allowed.has(style) || !Number.isSafeInteger(z) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
    const pointer = await current();
    if (!pointer) return null;
    const versionRoot = path.resolve(versionsRoot, pointer.version);
    const tilePath = path.resolve(versionRoot, "tiles", style, String(z), String(x), `${y}.webp`);
    if (!within(versionRoot, tilePath)) return null;
    try {
      const metadata = await stat(tilePath);
      if (!metadata.isFile()) return null;
      if (metadata.size > maxTileBytes) throw new RangeError("Installed map tile exceeds read budget");
      const bytes = await readFile(tilePath);
      if (bytes.byteLength > maxTileBytes) throw new RangeError("Installed map tile exceeds read budget");
      return { bytes, contentType: "image/webp", generation: pointer.manifest.generation };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function install() {
    throw new Error("Map tile pack installation is not implemented");
  }

  async function prune() {
    throw new Error("Map tile pack pruning is not implemented");
  }

  async function close() {
    closed = true;
  }

  return Object.freeze({ readManifest, readTile, install, prune, close });
}

