import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
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

async function writeDurableJson(filePath, value) {
  const handle = await open(filePath, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

function safePackFile(file, allowed) {
  if (!file || typeof file !== "object" || typeof file.path !== "string" || file.path.includes("\\") || path.posix.isAbsolute(file.path)) return null;
  if (path.posix.normalize(file.path) !== file.path) return null;
  const parts = file.path.split("/");
  if (parts.length !== 5 || parts[0] !== "tiles" || !allowed.has(parts[1])) return null;
  const z = Number(parts[2]);
  const x = Number(parts[3]);
  const yMatch = /^(-?\d+)\.webp$/.exec(parts[4]);
  const y = Number(yMatch?.[1]);
  if (!Number.isSafeInteger(z) || !Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
  if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !MANIFEST_HASH.test(file.sha256)) return null;
  return { ...file, z, x, y };
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
  let queue = Promise.resolve();
  let pointerReloadFailureCount = 0;
  let currentLoad = null;

  async function reloadCurrent(checkedNow) {
    checkedAt = checkedNow;
    try {
      const candidate = JSON.parse(await readFile(path.join(resolvedRoot, "current.json"), "utf8"));
      if (lastGood
        && candidate?.version === lastGood.version
        && candidate?.manifestHash === lastGood.manifestHash
        && validManifest(candidate.manifest)
        && String(candidate.manifest.generation) === String(lastGood.manifest.generation)) return lastGood;
      const installed = await readInstalledPointer(resolvedRoot, candidate);
      if (installed) lastGood = installed;
      else pointerReloadFailureCount += 1;
    } catch (error) {
      if (error?.code !== "ENOENT" || lastGood) pointerReloadFailureCount += 1;
      if (!lastGood && error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    return lastGood;
  }

  async function current(force = false) {
    if (closed) throw new Error("Map tile pack store is closed");
    const checkedNow = nowMilliseconds(now);
    if (!force && lastGood && checkedNow - checkedAt < pointerTtlMs) return lastGood;
    if (currentLoad) return currentLoad;
    const load = reloadCurrent(checkedNow);
    currentLoad = load;
    try {
      return await load;
    } finally {
      if (currentLoad === load) currentLoad = null;
    }
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

  async function validatePack(stagedVersionDir, expectedManifestHash) {
    const manifestPath = path.join(stagedVersionDir, "manifest.json");
    const manifestBytes = await readFile(manifestPath);
    if (sha256(manifestBytes) !== expectedManifestHash) throw new Error("Map tile pack manifest hash does not match");
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    if (!validManifest(manifest) || !Array.isArray(manifest.files) || !manifest.files.length) throw new TypeError("Map tile pack manifest requires referenced tiles");
    const files = manifest.files.map((file) => safePackFile(file, allowed));
    if (files.some((file) => !file)) throw new TypeError("Map tile pack manifest contains an invalid tile path");
    if (new Set(files.map((file) => file.path)).size !== files.length) throw new TypeError("Map tile pack manifest contains duplicate tiles");
    let totalBytes = 0;
    for (const file of files) {
      const tilePath = path.resolve(stagedVersionDir, ...file.path.split("/"));
      if (!within(stagedVersionDir, tilePath)) throw new TypeError("Map tile pack tile path escapes staging directory");
      let metadata;
      try {
        metadata = await stat(tilePath);
      } catch (error) {
        if (error?.code === "ENOENT") throw new Error(`Map tile pack is missing tile ${file.path}`);
        throw error;
      }
      if (!metadata.isFile()) throw new Error(`Map tile pack is missing tile ${file.path}`);
      if (metadata.size !== file.bytes) throw new Error(`Map tile pack tile byte count differs for ${file.path}`);
      if (metadata.size > maxTileBytes) throw new RangeError(`Map tile pack tile exceeds read budget: ${file.path}`);
      const bytes = await readFile(tilePath);
      if (sha256(bytes) !== file.sha256) throw new Error(`Map tile pack tile hash differs for ${file.path}`);
      totalBytes += bytes.byteLength;
    }
    if (manifest.tileCount !== files.length || manifest.totalBytes !== totalBytes) throw new Error("Map tile pack manifest totals do not match referenced tiles");
    return { manifest, manifestBytes };
  }

  async function installPack({ stagedVersionDir, version, manifestHash }) {
    if (closed) throw new Error("Map tile pack store is closed");
    if (!VERSION.test(version) || !MANIFEST_HASH.test(manifestHash)) throw new TypeError("Map tile pack install requires a safe version and manifest hash");
    const staged = path.resolve(stagedVersionDir);
    const installed = path.resolve(versionsRoot, version);
    if (!within(resolvedRoot, staged) || staged === resolvedRoot || !path.basename(staged).startsWith(".staging-") || staged === installed) {
      throw new TypeError("Map tile pack staging path escapes its root");
    }
    if (!within(versionsRoot, installed)) throw new TypeError("Map tile pack version path escapes its root");
    try {
      await access(installed);
      throw new Error(`Map tile pack version ${version} is already installed`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const { manifest } = await validatePack(staged, manifestHash);
    const installedAt = new Date(nowMilliseconds(now)).toISOString();
    await writeDurableJson(path.join(staged, "complete.json"), { manifestHash, installedAt });
    await syncDirectory(staged);
    await mkdir(versionsRoot, { recursive: true });
    await rename(staged, installed);
    await syncDirectory(versionsRoot);
    const pointer = { version, manifest, manifestHash };
    const temporaryPointer = path.join(resolvedRoot, `.current-${process.pid}-${nowMilliseconds(now)}.tmp`);
    await mkdir(resolvedRoot, { recursive: true });
    await writeDurableJson(temporaryPointer, pointer);
    await rename(temporaryPointer, path.join(resolvedRoot, "current.json"));
    await syncDirectory(resolvedRoot);
    lastGood = Object.freeze({ version, manifest: Object.freeze({ ...manifest }), manifestHash });
    checkedAt = nowMilliseconds(now);
    return { ...manifest };
  }

  async function completeGeneration(entry) {
    if (!entry.isDirectory() || !VERSION.test(entry.name)) return null;
    const versionRoot = path.resolve(versionsRoot, entry.name);
    try {
      const [manifestBytes, completeText, metadata] = await Promise.all([
        readFile(path.join(versionRoot, "manifest.json")),
        readFile(path.join(versionRoot, "complete.json"), "utf8"),
        stat(versionRoot),
      ]);
      const manifest = JSON.parse(manifestBytes.toString("utf8"));
      const complete = JSON.parse(completeText);
      if (!validManifest(manifest) || !MANIFEST_HASH.test(complete?.manifestHash) || sha256(manifestBytes) !== complete.manifestHash) return null;
      const installedAt = Date.parse(complete.installedAt ?? manifest.generatedAt ?? "");
      return { version: entry.name, installedAt: Number.isFinite(installedAt) ? installedAt : metadata.mtimeMs };
    } catch (error) {
      if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async function prunePacks({ graceMs, keepGenerations }) {
    if (closed) throw new Error("Map tile pack store is closed");
    if (!Number.isFinite(graceMs) || graceMs < 0) throw new TypeError("Map tile pack prune grace must be non-negative");
    if (!Number.isSafeInteger(keepGenerations) || keepGenerations < 1) throw new TypeError("Map tile pack retention count must be positive");
    const pointer = await current(true);
    let entries;
    try {
      entries = await readdir(versionsRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    const complete = (await Promise.all(entries.map(completeGeneration))).filter(Boolean)
      .sort((left, right) => right.installedAt - left.installedAt || right.version.localeCompare(left.version, undefined, { numeric: true }));
    const retained = new Set(complete.slice(0, keepGenerations).map(({ version }) => version));
    if (pointer) retained.add(pointer.version);
    const pruneNow = nowMilliseconds(now);
    for (const generation of complete) {
      if (retained.has(generation.version) || pruneNow - generation.installedAt < graceMs) continue;
      const target = path.resolve(versionsRoot, generation.version);
      if (within(versionsRoot, target)) await rm(target, { recursive: true, force: true });
    }
  }

  function enqueue(operation) {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  async function close() {
    await queue;
    closed = true;
  }

  return Object.freeze({
    readManifest,
    readTile,
    install(input) { return enqueue(() => installPack(input)); },
    prune(input) { return enqueue(() => prunePacks(input)); },
    health() { return { pointerReloadFailureCount }; },
    close,
  });
}
