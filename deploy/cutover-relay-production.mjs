#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chownSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  createCanonicalCutoverPrivacyReadinessArtifact,
  verifyCanonicalCutoverPrivacyPlan,
} from "../apps/bitcraft-local/src/server/canonicalCutoverPrivacy.mjs";
import {
  canonicalJson,
  createCanonicalCutoverManifest,
  readCanonicalCutoverManifest,
  verifyAppliedCanonicalCutoverManifest,
} from "../apps/bitcraft-local/src/server/canonicalCutoverMigration.mjs";
import {
  applyContributionProfessionRepair,
  createContributionProfessionManifest,
} from "../apps/bitcraft-local/src/server/contributionProfessionRepair.mjs";
import {
  committedDeletionSubjects,
  deletionLedgerSubject,
  parseDeletionLedgerContent,
} from "../apps/bitcraft-local/src/server/privacyDeletionLedger.mjs";
import { enqueueCanonicalCutoverAnnouncement } from "../apps/bitcraft-local/src/server/canonicalCutoverAnnouncement.mjs";
import { OLD_PRODUCTION_UNITS } from "./canonical-unit-inventory.mjs";
import { createSystemOperationalSampler, runCanonicalSoak } from "./verify-canonical-soak.mjs";

export const CANONICAL_CONFIRMATION = "app.timbersteeltrade.com";
export const CANONICAL_CLAIM_ID = "1369094286777412590";
export const CANONICAL_VERSION = "0.53.0-beta.1";
export const CANONICAL_REVISION_PATTERN = /^[a-f0-9]{40}$/;
export const CANONICAL_MANIFEST_HASH_PATTERN = /^[a-f0-9]{64}$/;
export const LOCAL_CANONICAL_RETRY_ATTEMPTS = 40;
export const CUTOVER_LOCK_ORDER = Object.freeze([
  "/run/lock/bitcraft-claim-monitor-relay-cutover.lock",
  "/run/lock/bitcraft-claim-monitor-relay-deploy.lock",
  "/run/lock/bitcraft-claim-monitor-relay-backup.lock",
]);

const CANONICAL_ENVIRONMENT_UPDATES = new Set([
  "BITCRAFT_DEPLOYMENT_MODE",
  "DISCORD_DELIVERY_MODE",
  "ENABLE_DISCORD_STARTUP",
  "LEGAL_CONFIGURATION_CONFIRMED",
  "DISCORD_OAUTH_REDIRECT_URI",
  "PRIVACY_LEDGER_PREVIOUS_KEY_FILES",
]);

const SOURCE_UNITS = OLD_PRODUCTION_UNITS;
const RELAY_UNITS = Object.freeze([
  "bitcraft-claim-monitor-relay.service",
  "bitcraft-claim-monitor-relay-worker.service",
  "bitcraft-claim-monitor-relay-collector.service",
  "bitcraft-claim-monitor-relay-collector.timer",
  "bitcraft-claim-monitor-relay-backup.service",
  "bitcraft-claim-monitor-relay-backup.timer",
]);
const WRITER_STOP_ORDER = Object.freeze([
  "bitcraft-claim-monitor-backup.timer",
  "bitcraft-claim-monitor-relay-backup.timer",
  "bitcraft-monitor-collector.timer",
  "bitcraft-claim-monitor-relay-collector.timer",
  "bitcraft-monitor-collector.service",
  "bitcraft-claim-monitor-relay-collector.service",
  "bitcraft-claim-monitor-worker.service",
  "bitcraft-claim-monitor-relay-worker.service",
  "bitcraft-claim-monitor.service",
  "bitcraft-claim-monitor-relay.service",
]);
const RELAY_START_UNITS = Object.freeze([
  "bitcraft-claim-monitor-relay.service",
  "bitcraft-claim-monitor-relay-worker.service",
  "bitcraft-claim-monitor-relay-collector.timer",
  "bitcraft-claim-monitor-relay-backup.timer",
]);
const REQUIRED_ACTIVE_UNITS = Object.freeze([
  "bitcraft-claim-monitor.service",
  "bitcraft-claim-monitor-worker.service",
  "bitcraft-monitor-collector.timer",
  "bitcraft-claim-monitor-backup.timer",
  "bitcraft-claim-monitor-relay.service",
  "bitcraft-claim-monitor-relay-worker.service",
  "bitcraft-claim-monitor-relay-collector.timer",
  "bitcraft-claim-monitor-relay-backup.timer",
]);
const REQUIRED_PASSIVE_UNITS = Object.freeze([
  "bitcraft-monitor-collector.service",
  "bitcraft-claim-monitor-backup.service",
  "bitcraft-claim-monitor-relay-collector.service",
  "bitcraft-claim-monitor-relay-backup.service",
]);
const CUTOVER_RECOVERY_REQUIRED_LABELS = Object.freeze([
  "old-db",
  "relay-db",
  "old-environment",
  "relay-environment",
  "caddy",
  "old-privacy-key",
  "relay-privacy-key",
]);

function argumentError(message) {
  return new TypeError(`Invalid cutover arguments: ${message}`);
}

export function parseCutoverArguments(argv) {
  if (!Array.isArray(argv)) throw argumentError("arguments must be an array");
  const revision = argv[0] === "--revision" ? argv[1] : "";
  if (!CANONICAL_REVISION_PATTERN.test(String(revision ?? ""))) {
    throw argumentError("--revision must be a full lowercase 40-character SHA");
  }
  if (argv.length === 5
    && argv[2] === "--prepare-cutover"
    && argv[3] === "--confirmation"
    && argv[4] === CANONICAL_CONFIRMATION) {
    return { mode: "prepare", revision, confirmation: argv[4], manifestHash: null };
  }
  if ((argv.length === 5 || argv.length === 6)
    && (argv[2] === "--apply-cutover" || argv[2] === "--abort-cutover")
    && argv[3] === "--manifest-hash"
    && CANONICAL_MANIFEST_HASH_PATTERN.test(String(argv[4] ?? ""))
    && (argv.length === 5 || (argv[2] === "--apply-cutover" && argv[5] === "--skip-soak"))) {
    return {
      mode: argv[2] === "--apply-cutover" ? "apply" : "abort",
      revision,
      confirmation: null,
      manifestHash: argv[4],
      ...(argv[5] === "--skip-soak" ? { skipSoak: true } : {}),
    };
  }
  throw argumentError("unknown or mixed cutover mode");
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function editEnvironmentDocument(originalBytes, updates) {
  if (!(originalBytes instanceof Uint8Array)) throw new TypeError("Environment content must be bytes");
  const entries = Object.entries(updates ?? {});
  for (const [key, value] of entries) {
    if (!CANONICAL_ENVIRONMENT_UPDATES.has(key)) throw new Error(`Environment key is outside the cutover allowlist: ${key}`);
    if (typeof value !== "string" || /[\0\r\n]/.test(value)) throw new Error(`Environment value for ${key} is invalid`);
  }
  const text = decodeUtf8(originalBytes);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = text.endsWith("\n");
  const lines = text.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();
  const seen = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !Object.hasOwn(updates, match[1])) continue;
    if (seen.has(match[1])) throw new Error(`Duplicate protected environment key: ${match[1]}`);
    seen.set(match[1], index);
    lines[index] = `${match[1]}=${updates[match[1]]}`;
  }
  for (const [key, value] of entries) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  return Buffer.from(`${lines.join(newline)}${newline}`);
}

function parseEnvironmentDocument(bytes) {
  const values = {};
  for (const line of decodeUtf8(bytes).split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) throw new Error("Installed environment file contains an unsupported line");
    if (Object.hasOwn(values, match[1])) throw new Error(`Installed environment file contains duplicate key ${match[1]}`);
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(filePath) {
  const descriptor = openSync(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function regularFile(filePath, label, { allowMissing = false } = {}) {
  if (!existsSync(filePath)) {
    if (allowMissing) return null;
    throw new Error(`${label} is missing`);
  }
  const stat = lstatSync(filePath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) {
    throw new Error(`${label} must be a single-link regular non-symlink file`);
  }
  return stat;
}

function regularDirectory(directoryPath, label) {
  const stat = lstatSync(directoryPath, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink directory`);
  return stat;
}

function ensureRootPrivateDirectory(directoryPath, label) {
  if (existsSync(directoryPath)) {
    regularDirectory(directoryPath, label);
  } else {
    regularDirectory(path.dirname(directoryPath), `${label} parent`);
    mkdirSync(directoryPath, { mode: 0o700 });
  }
  const stat = regularDirectory(directoryPath, label);
  if (process.platform !== "win32" && (stat.uid !== 0n || stat.gid !== 0n)) {
    throw new Error(`${label} must be owned by root`);
  }
  chmodSync(directoryPath, 0o700);
}

function pathIsWithin(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function fileIdentity(filePath) {
  const stat = regularFile(filePath, "Protected cutover file");
  return {
    path: filePath,
    dev: String(stat.dev),
    ino: String(stat.ino),
    nlink: String(stat.nlink),
    mode: Number(stat.mode & 0o777n),
    uid: Number(stat.uid),
    gid: Number(stat.gid),
    size: Number(stat.size),
    sha256: sha256File(filePath),
  };
}

function assertRecordedIdentity(record, label) {
  if (!record?.path) throw new Error(`${label} identity was not recorded`);
  const current = fileIdentity(record.path);
  for (const key of ["dev", "ino", "nlink", "sha256"]) {
    if (String(current[key]) !== String(record[key])) throw new Error(`${label} identity changed`);
  }
  return current;
}

function applyMetadata(filePath, { mode, uid, gid }) {
  chmodSync(filePath, Number(mode));
  if (process.platform !== "win32") chownSync(filePath, Number(uid), Number(gid));
}

function writeStagedBytes(temporary, bytes, metadata) {
  let created = false;
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    created = true;
    try {
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    applyMetadata(temporary, metadata);
  } catch (error) {
    if (created && existsSync(temporary)) rmSync(temporary);
    throw error;
  }
}

function writeBytesAtomic(filePath, bytes, metadata, recordedTemporary = null) {
  const directory = path.dirname(filePath);
  regularDirectory(directory, "Protected file parent");
  const temporary = recordedTemporary
    ?? path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let staged = false;
  try {
    writeStagedBytes(temporary, bytes, metadata);
    staged = true;
    renameSync(temporary, filePath);
    syncDirectory(directory);
  } catch (error) {
    if (staged && existsSync(temporary)) rmSync(temporary);
    throw error;
  }
}

function writeBytesExclusive(filePath, bytes, metadata, recordedTemporary = null) {
  const directory = path.dirname(filePath);
  regularDirectory(directory, "Protected file parent");
  const temporary = recordedTemporary
    ?? path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let staged = false;
  try {
    writeStagedBytes(temporary, bytes, metadata);
    staged = true;
    linkSync(temporary, filePath);
    syncDirectory(directory);
  } finally {
    if (staged && existsSync(temporary)) {
      rmSync(temporary);
      syncDirectory(directory);
    }
  }
}

function cutoverTemporaryPath(filePath, state, label) {
  const operation = `${state.revision}-${state.manifestHash}-${label}`.replace(/[^a-zA-Z0-9.-]/g, "-");
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${operation}.tmp`);
}

function removeRecoveryTemporary(intent, label) {
  const temporary = intent?.temporaryPath;
  if (!temporary || !existsSync(temporary)) return;
  const destination = intent.path;
  const expectedPrefix = `.${path.basename(destination)}.`;
  if (path.dirname(temporary) !== path.dirname(destination)
    || !path.basename(temporary).startsWith(expectedPrefix)
    || !path.basename(temporary).endsWith(".tmp")) {
    throw new Error(`${label} staging path is outside its protected destination`);
  }
  const stat = lstatSync(temporary, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink < 1n || stat.nlink > 2n
    || stat.size > BigInt(intent.expectedSize)) {
    throw new Error(`${label} staging file is not a recoverable cutover artifact`);
  }
  if (process.platform !== "win32") {
    const expectedMetadata = intent.expectedMetadata ?? intent.expectedUpdatedMetadata;
    const actualMode = Number(stat.mode & 0o777n);
    const isInitialRootStage = stat.uid === 0n && stat.gid === 0n && actualMode === 0o600;
    const hasAppliedMetadata = stat.uid === BigInt(expectedMetadata.uid)
      && stat.gid === BigInt(expectedMetadata.gid)
      && actualMode === expectedMetadata.mode;
    if (!isInitialRootStage && !hasAppliedMetadata) {
      throw new Error(`${label} staging file ownership or mode is unsafe`);
    }
  }
  if (stat.nlink === 2n) {
    const destinationStat = lstatSync(destination, { bigint: true });
    if (!destinationStat.isFile() || destinationStat.isSymbolicLink()
      || destinationStat.dev !== stat.dev || destinationStat.ino !== stat.ino) {
      throw new Error(`${label} staging hard link is not bound to its destination`);
    }
  }
  rmSync(temporary);
  syncDirectory(path.dirname(temporary));
}

function assertIntendedFile(intent, label) {
  if (!intent?.destinationWasAbsent || !intent.path || !intent.expectedSha256 || !intent.expectedMetadata) {
    throw new Error(`${label} recovery intent is invalid`);
  }
  const current = fileIdentity(intent.path);
  if (current.sha256 !== intent.expectedSha256
    || (process.platform !== "win32"
      && (current.mode !== intent.expectedMetadata.mode
        || current.uid !== intent.expectedMetadata.uid
        || current.gid !== intent.expectedMetadata.gid))) {
    throw new Error(`${label} does not match its pre-mutation recovery intent`);
  }
  return current;
}

function removeRecordedOrIntendedFile(record, intent, label) {
  removeRecoveryTemporary(intent, label);
  const filePath = record?.path ?? intent?.path;
  if (!filePath || !existsSync(filePath)) return;
  if (record?.path) assertRecordedIdentity(record, label);
  else assertIntendedFile(intent, label);
  rmSync(filePath);
  syncDirectory(path.dirname(filePath));
}

function routeHosts(route) {
  const hosts = [];
  for (const match of Array.isArray(route?.match) ? route.match : []) {
    for (const host of Array.isArray(match?.host) ? match.host : []) hosts.push(String(host));
  }
  return hosts;
}

function routeIsLocal(route) {
  return (Array.isArray(route?.match) ? route.match : []).some((match) => (
    match?.remote_ip && Array.isArray(match.remote_ip.ranges)
      && match.remote_ip.ranges.some((range) => ["127.0.0.1", "127.0.0.0/8", "::1"].includes(String(range)))
  ));
}

const SUPPORTED_CADDY_HANDLERS = new Set([
  "encode",
  "headers",
  "reverse_proxy",
  "static_response",
  "subroute",
]);

function validateCaddyRouteMatcher(route, { topLevel }) {
  for (const match of Array.isArray(route?.match) ? route.match : []) {
    if (!match || typeof match !== "object" || Array.isArray(match)) {
      throw new Error("Unsupported Caddy route matcher");
    }
    const keys = Object.keys(match);
    const requiredKey = topLevel ? "host" : "remote_ip";
    if (keys.length !== 1 || keys[0] !== requiredKey) {
      throw new Error("Unsupported Caddy route matcher: empty or invalid alternative");
    }
    if (Object.hasOwn(match, "remote_ip")) {
      const ranges = match.remote_ip?.ranges;
      const supportedRanges = new Set(["127.0.0.1", "127.0.0.1/32", "127.0.0.0/8", "::1", "::1/128"]);
      if (!Array.isArray(ranges) || !ranges.length || ranges.some((range) => !supportedRanges.has(String(range)))) {
        throw new Error("Unsupported Caddy route matcher");
      }
    }
  }
}

function inspectCaddyHandle(handle, result, localOnly) {
  if (!handle || typeof handle !== "object" || !SUPPORTED_CADDY_HANDLERS.has(handle.handler)) {
    throw new Error(`Unsupported Caddy handler: ${String(handle?.handler ?? "missing")}`);
  }
  if (handle.handler === "reverse_proxy") {
    for (const upstream of Array.isArray(handle.upstreams) ? handle.upstreams : []) {
      result.proxies.push({ dial: String(upstream?.dial ?? ""), localOnly });
    }
  }
  if (handle.handler === "static_response") {
    const locations = handle.headers?.Location ?? handle.headers?.location ?? [];
    result.responses.push({
      localOnly,
      location: Array.isArray(locations) ? String(locations[0] ?? "") : String(locations ?? ""),
      status: Number(handle.status_code ?? 200),
    });
  }
  for (const route of Array.isArray(handle.routes) ? handle.routes : []) inspectCaddyRoute(route, result, localOnly);
}

function inspectCaddyRoute(route, result, inheritedLocal = false, topLevel = false) {
  validateCaddyRouteMatcher(route, { topLevel });
  const localOnly = inheritedLocal || routeIsLocal(route);
  for (const handle of Array.isArray(route?.handle) ? route.handle : []) inspectCaddyHandle(handle, result, localOnly);
}

function adaptedCaddySites(adapted) {
  const sites = new Map();
  const servers = adapted?.apps?.http?.servers;
  if (!servers || typeof servers !== "object") throw new Error("Caddy adapted configuration has no HTTP servers");
  for (const server of Object.values(servers)) {
    for (const route of Array.isArray(server?.routes) ? server.routes : []) {
      const hosts = routeHosts(route);
      if (!hosts.length) throw new Error("Caddy contains an unknown hostless site route");
      for (const host of hosts) {
        if (sites.has(host)) throw new Error(`Caddy contains duplicate site routing for ${host}`);
        const result = { proxies: [], responses: [] };
        inspectCaddyRoute(route, result, false, true);
        sites.set(host, result);
      }
    }
  }
  return sites;
}

function hasCanonicalRedirect(site) {
  return site.responses.some((response) => response.status === 301
    && response.location === "https://app.timbersteeltrade.com{http.request.uri}");
}

export function validateCaddyTopology(adapted, mode) {
  if (!["preflight", "maintenance", "final"].includes(mode)) throw new Error(`Unknown Caddy topology mode: ${mode}`);
  const sites = adaptedCaddySites(adapted);
  const expectedHosts = new Set([
    "app.timbersteeltrade.com",
    "relay.timbersteeltrade.com",
    "claim.timbersteeltrade.com",
    "claim.hostred.co.uk",
  ]);
  if (sites.size !== expectedHosts.size || [...sites.keys()].some((host) => !expectedHosts.has(host))) {
    throw new Error("Caddy host set contains an unknown site or would lose a supported site block");
  }
  const app = sites.get("app.timbersteeltrade.com");
  const relay = sites.get("relay.timbersteeltrade.com");
  for (const host of ["claim.timbersteeltrade.com", "claim.hostred.co.uk"]) {
    const claim = sites.get(host);
    if (claim.proxies.length !== 0 || claim.responses.length !== 1 || !hasCanonicalRedirect(claim)) {
      throw new Error(`Caddy claim redirect is not preserved exactly for ${host}`);
    }
  }
  if (mode === "preflight") {
    if (app.proxies.length !== 1 || app.proxies[0].dial !== "127.0.0.1:18430" || app.responses.length !== 0) {
      throw new Error("Pre-cutover Caddy app route has extra terminal behavior outside the supported 18430 proxy");
    }
    if (relay.proxies.length !== 1 || relay.proxies[0].dial !== "127.0.0.1:19430" || relay.responses.length !== 0) {
      throw new Error("Pre-cutover Caddy Relay route has extra terminal behavior outside the supported 19430 proxy");
    }
  } else if (mode === "maintenance") {
    if (app.proxies.length !== 1 || app.proxies[0].dial !== "127.0.0.1:19430" || !app.proxies[0].localOnly) {
      throw new Error("Maintenance Caddy must retain exactly one localhost-only Relay canary");
    }
    if (app.responses.length !== 1 || app.responses[0].status !== 503 || app.responses[0].localOnly
      || relay.responses.length !== 1 || relay.responses[0].status !== 503 || relay.responses[0].localOnly) {
      throw new Error("Maintenance Caddy must contain only the explicit public 503 responses");
    }
    if (relay.proxies.length) throw new Error("Maintenance Caddy exposes an unsupported backend");
  } else {
    if (app.proxies.length !== 1 || app.proxies[0].dial !== "127.0.0.1:19430" || app.responses.length !== 0) {
      throw new Error("Final Caddy app route must contain only the supported 19430 terminal behavior");
    }
    if (relay.proxies.length !== 0 || relay.responses.length !== 1 || !hasCanonicalRedirect(relay)) {
      throw new Error("Final Caddy Relay site must contain only the canonical redirect");
    }
    if ([...sites.values()].some((site) => site.proxies.some((entry) => entry.dial.includes("18430")))) throw new Error("Final Caddy must not contain 18430");
  }
  return { mode, hosts: [...sites.keys()].sort() };
}

function syncDirectory(directory) {
  const descriptor = openSync(directory, process.platform === "win32" ? "r+" : "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncFile(filePath) {
  const descriptor = openSync(filePath, process.platform === "win32" ? "r+" : "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writePrivateJsonAtomic(filePath, payload) {
  const directory = path.dirname(filePath);
  if (existsSync(directory)) regularDirectory(directory, "Protected cutover state directory");
  else mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  regularDirectory(directory, "Protected cutover state directory");
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, filePath);
  chmodSync(filePath, 0o600);
  syncDirectory(directory);
}

function readState(filePath) {
  if (!existsSync(filePath)) return null;
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Cutover state is invalid");
  return parsed;
}

function assertMatchingState(state, { revision, manifestHash }) {
  if (!state) throw new Error("No prepared cutover state exists");
  if (state.revision !== revision || state.manifestHash !== manifestHash) {
    throw new Error("Cutover revision or manifest hash does not match the prepared state");
  }
}

function prepareSummary(state) {
  return {
    revision: state.revision,
    manifestHash: state.manifestHash,
    counts: state.migration?.counts ?? {},
    repairHash: state.repair?.manifestSha256 ?? state.repair?.selectionHash ?? null,
    repairCount: state.repair?.selectedCount ?? 0,
    backupIdentifiers: (state.backups ?? []).map((backup) => backup.identifier),
    watchdogDeadline: state.watchdog?.deadline ?? null,
  };
}

async function invoke(operations, name, ...arguments_) {
  const operation = operations[name];
  if (typeof operation !== "function") throw new Error(`Cutover operation is unavailable: ${name}`);
  return operation(...arguments_);
}

export function createCutoverOrchestrator({ operations, stateDirectory, now = () => new Date() }) {
  if (!operations || typeof operations !== "object") throw new TypeError("Cutover operations are required");
  if (!path.isAbsolute(stateDirectory)) throw new TypeError("Cutover state directory must be absolute");
  const statePath = path.join(stateDirectory, "state.json");
  const admissionPath = path.join(stateDirectory, "admission.json");
  const save = (state) => writePrivateJsonAtomic(statePath, state);
  const restoreOperations = [
    { name: "cancelWatchdog", recoveryCritical: false },
    { name: "quiesceServicesForRestore", recoveryCritical: true },
    { name: "restorePreCutoverRelayData", recoveryCritical: true },
    { name: "restoreEnvironment", recoveryCritical: true },
    { name: "removeCreatedReadiness", recoveryCritical: true },
    { name: "removeCreatedPreviousKey", recoveryCritical: true },
    { name: "restoreCaddy", recoveryCritical: true },
    { name: "restoreServiceStates", recoveryCritical: true },
    { name: "validateAndReloadRestoredCaddy", recoveryCritical: true },
    { name: "verifyOldPublicHealth", recoveryCritical: true },
    { name: "cleanupPlaintext", recoveryCritical: false, alwaysAttempt: true },
  ];
  const attemptRestoration = async (state) => {
    const failures = [];
    let recoveryCoherent = true;
    for (const { name, recoveryCritical, alwaysAttempt = false } of restoreOperations) {
      if (!recoveryCoherent && !alwaysAttempt) {
        failures.push(`${name}: skipped because coherent restoration prerequisites failed`);
        continue;
      }
      try {
        await invoke(operations, name, state);
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        if (recoveryCritical) recoveryCoherent = false;
      }
    }
    return failures;
  };

  async function prepare({ revision, confirmation }) {
    if (!CANONICAL_REVISION_PATTERN.test(String(revision ?? ""))) throw new Error("Cutover revision must be a full SHA");
    if (confirmation !== CANONICAL_CONFIRMATION) throw new Error(`Cutover confirmation must be exactly ${CANONICAL_CONFIRMATION}`);
    if (existsSync(admissionPath)) throw new Error("Canonical admission already occurred");
    const previous = readState(statePath);
    if (previous && previous.status !== "aborted") throw new Error("An active prepare already exists");

    let state = null;
    try {
      const preflight = await invoke(operations, "validatePrepare", { revision, confirmation });
      state = {
        formatVersion: 1,
        status: "preparing",
        revision,
        manifestHash: null,
        preparedAt: now().toISOString(),
        preflight,
        preApply: {},
      };
      save(state);
      state.maintenance = await invoke(operations, "installMaintenance", state);
      save(state);
      state.serviceCapture = await invoke(operations, "stopAndCaptureWriters", state);
      save(state);
      await invoke(operations, "assertWritersStopped", state);
      state.backups = await invoke(operations, "createAndVerifyEncryptedBackups", state);
      save(state);
      state.repair = await invoke(operations, "createRepairManifest", state);
      save(state);
      state.migration = await invoke(operations, "createMigrationManifest", state);
      if (!CANONICAL_MANIFEST_HASH_PATTERN.test(String(state.migration?.selectionHash ?? ""))) {
        throw new Error("Frozen migration manifest returned an invalid selection hash");
      }
      state.manifestHash = state.migration.selectionHash;
      save(state);
      state.watchdog = await invoke(operations, "armWatchdog", state);
      state.status = "prepared";
      save(state);
      return prepareSummary(state);
    } catch (error) {
      if (state) {
        const failures = await attemptRestoration(state);
        state.status = failures.length ? "prepare-restore-failed" : "prepare-failed";
        state.prepareFailedAt = now().toISOString();
        state.prepareFailure = error instanceof Error ? error.message : String(error);
        state.prepareRestoreFailures = failures;
        save(state);
        if (failures.length) {
          throw new Error(`${state.prepareFailure}; prepare restoration was incomplete: ${failures.join("; ")}`);
        }
      }
      throw error;
    }
  }

  function matchingAdmission(revision, manifestHash) {
    const admission = readState(admissionPath);
    if (!admission || admission.formatVersion !== 1) throw new Error("Canonical admission marker is missing or invalid");
    assertMatchingState(admission, { revision, manifestHash });
    return admission;
  }

  async function finishAdmittedApply(state, { revision, manifestHash }) {
    state.postAdmission ??= {};
    if (!state.postAdmission.finalCaddyInstalled) {
      state.finalCaddy = await invoke(operations, "installFinalCaddy", state);
      state.postAdmission.finalCaddyInstalled = true;
      save(state);
    }
    if (!state.postAdmission.publicVerified) {
      state.publicVerification = await invoke(operations, "verifyPublicCanonical", state);
      state.postAdmission.publicVerified = true;
      save(state);
    }
    if (!state.postAdmission.oldUnitsMasked) {
      state.oldUnitsMasked = await invoke(operations, "maskOldUnits", state);
      state.postAdmission.oldUnitsMasked = true;
      save(state);
    }
    if (!state.postAdmission.watchdogCancelled) {
      await invoke(operations, "cancelWatchdog", state);
      state.postAdmission.watchdogCancelled = true;
      save(state);
    }
    if (!state.postAdmission.forensicRetentionRecorded) {
      state.forensicRetention = await invoke(operations, "recordForensicRetention", state);
      state.postAdmission.forensicRetentionRecorded = true;
      save(state);
    }
    if (!state.postAdmission.intensiveSoakVerified) {
      if (state.operatorOverrides?.skipIntensiveSoak?.approved === true) {
        state.postAdmission.intensiveSoakSkipped = true;
        state.postAdmission.intensiveSoakVerified = false;
      } else {
        state.intensiveSoak = await invoke(operations, "verifyIntensiveSoak", state);
        state.postAdmission.intensiveSoakVerified = true;
      }
      save(state);
    }
    if (!state.postAdmission.cutoverAnnouncementEnqueued) {
      state.cutoverAnnouncement = await invoke(operations, "enqueueCutoverAnnouncement", state);
      state.postAdmission.cutoverAnnouncementEnqueued = true;
      save(state);
    }
    state.status = "complete";
    state.completedAt ??= now().toISOString();
    save(state);
    return { revision, manifestHash, status: "complete" };
  }

  async function apply({ revision, manifestHash, skipSoak = false }) {
    let state = readState(statePath);
    assertMatchingState(state, { revision, manifestHash });
    const recordedSkip = state.operatorOverrides?.skipIntensiveSoak;
    if (skipSoak) {
      if (recordedSkip && (recordedSkip.approved !== true || recordedSkip.revision !== revision)) {
        throw new Error("Recorded intensive-soak override does not match this revision");
      }
      if (!recordedSkip) {
        state.operatorOverrides ??= {};
        state.operatorOverrides.skipIntensiveSoak = {
          approved: true,
          revision,
          requestedAt: now().toISOString(),
        };
        save(state);
      }
    } else if (recordedSkip?.approved === true) {
      throw new Error("Fix-forward apply must repeat the approved --skip-soak override");
    }
    if (existsSync(admissionPath)) {
      const admission = matchingAdmission(revision, manifestHash);
      if (state.status === "complete") return { revision, manifestHash, status: "complete" };
      if (!state.finalCaddyValidation) {
        throw new Error("Admission marker exists without final Caddy validation evidence; supervised fix-forward is required");
      }
      state.status = "admitted";
      state.admission = admission;
      save(state);
      return finishAdmittedApply(state, { revision, manifestHash });
    }
    if (state.status === "admitted" || state.status === "complete") throw new Error("Cutover state claims admission but the admission marker is missing");
    state.status = "applying";
    state.applyStartedAt ??= now().toISOString();
    save(state);
    await invoke(operations, "verifyPrepared", state);
    if ((state.repair?.selectedCount ?? 0) > 0) {
      state.repairApply = await invoke(operations, "applyContributionRepair", state);
      save(state);
    }
    await invoke(operations, "verifyContributionRepair", state);
    state.preApply.previousKey = await invoke(operations, "installPreviousPrivacyKey", state, save);
    save(state);
    state.preApply.environment = await invoke(operations, "editCanonicalEnvironment", state, save);
    save(state);
    state.preApply.readiness = await invoke(operations, "writePrivacyReadiness", state, save);
    save(state);
    await invoke(operations, "verifyPrivacyReadiness", state);
    state.migrationApply = await invoke(operations, "applyMigration", state);
    save(state);
    state.migrationVerification = await invoke(operations, "verifyMigratedData", state);
    save(state);
    state.releaseAnnouncementMarker = await invoke(operations, "seedReleaseAnnouncementMarker", state);
    state.outboxBeforeStart = await invoke(operations, "captureOutboxState", state);
    save(state);
    await invoke(operations, "startRelayServices", state);
    state.localVerification = await invoke(operations, "verifyLocalCanonical", state);
    save(state);
    state.canaryVerification = await invoke(operations, "verifyMaintenanceCanary", state);
    save(state);
    state.finalCaddyValidation = await invoke(operations, "validateFinalCaddyForAdmission", state);
    save(state);

    const admission = {
      formatVersion: 1,
      revision,
      manifestHash,
      admittedAt: now().toISOString(),
    };
    writePrivateJsonAtomic(admissionPath, admission);
    state.status = "admitted";
    state.admission = admission;
    save(state);
    return finishAdmittedApply(state, { revision, manifestHash });
  }

  async function abort({ revision, manifestHash }) {
    if (existsSync(admissionPath)) throw new Error("Cutover admission already occurred; abort is forbidden and recovery is fix-forward only");
    const state = readState(statePath);
    assertMatchingState(state, { revision, manifestHash });
    if (state.status === "aborted") return { revision, manifestHash, status: "aborted" };
    const failures = await attemptRestoration(state);
    state.status = failures.length ? "abort-failed" : "aborted";
    state.abortAttemptedAt = now().toISOString();
    state.abortFailures = failures;
    save(state);
    if (failures.length) throw new Error(`Cutover abort was incomplete: ${failures.join("; ")}`);
    return { revision, manifestHash, status: "aborted" };
  }

  return { prepare, apply, abort };
}

export function buildCutoverLockCommand(argv, { waitForLocks = false } = {}) {
  const nested = [];
  for (const lock of CUTOVER_LOCK_ORDER) {
    nested.push("flock");
    if (!waitForLocks) nested.push("--nonblock");
    nested.push(lock);
  }
  nested.push(
    "env",
    "BITCRAFT_CUTOVER_LOCKS_HELD=1",
    process.execPath,
    fileURLToPath(import.meta.url),
    ...argv,
  );
  return nested;
}

function runWithLocks(argv, options) {
  const nested = buildCutoverLockCommand(argv, options);
  const result = spawnSync(nested[0], nested.slice(1), { env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const DEFAULT_SYSTEM_PATHS = Object.freeze({
  sourceCheckout: "/opt/bitcraft-claim-monitor-relay/source",
  releasesDirectory: "/opt/bitcraft-claim-monitor-relay/releases",
  currentRelease: "/opt/bitcraft-claim-monitor-relay/current",
  stateDirectory: "/var/lib/bitcraft-claim-monitor-relay/cutover",
  sourceDatabasePath: "/var/lib/bitcraft-claim-monitor/bitcraft-local.sqlite",
  targetDatabasePath: "/var/lib/bitcraft-claim-monitor-relay/bitcraft-local.sqlite",
  sourceBrandingDirectory: "/var/lib/bitcraft-claim-monitor/branding",
  targetBrandingDirectory: "/var/lib/bitcraft-claim-monitor-relay/branding",
  sourceEnvironmentFile: "/etc/bitcraft-claim-monitor.env",
  relayEnvironmentFile: "/etc/bitcraft-claim-monitor-relay.env",
  sourceConfigRoot: "/etc/bitcraft-claim-monitor",
  relayConfigRoot: "/etc/bitcraft-claim-monitor-relay",
  sourceBackupRoot: "/var/backups/bitcraft-claim-monitor",
  relayBackupRoot: "/var/backups/bitcraft-claim-monitor-relay",
  sourcePrivacyLedger: "/var/backups/bitcraft-claim-monitor/privacy-deletion-ledger.jsonl",
  relayPrivacyLedger: "/var/backups/bitcraft-claim-monitor-relay/privacy-deletion-ledger.jsonl",
  sourcePrivacyKey: "/etc/bitcraft-claim-monitor/privacy-ledger.key",
  relayPrivacyKey: "/etc/bitcraft-claim-monitor-relay/privacy-ledger.key",
  installedPreviousPrivacyKey: "/etc/bitcraft-claim-monitor-relay/privacy-ledger.previous-production.key",
  privacyReadinessArtifact: "/var/backups/bitcraft-claim-monitor-relay/canonical-cutover-privacy-ready.json",
  backupEncryptionKeyFile: "/etc/bitcraft-claim-monitor-relay/backup-encryption.key",
  backupHelper: "/usr/local/bin/backup-bitcraft-claim-monitor-relay",
  backupCryptoHelper: "/usr/local/lib/bitcraft-claim-monitor-relay/backup-crypto.mjs",
  liveCaddyFile: "/etc/caddy/Caddyfile",
  maintenanceCaddyCandidate: "/opt/bitcraft-claim-monitor-relay/current/deploy/Caddyfile.cutover-maintenance",
  finalCaddyCandidate: "/opt/bitcraft-claim-monitor-relay/current/deploy/Caddyfile.example",
  updater: "/usr/local/bin/update-bitcraft-claim-monitor-relay",
  caddyBinary: "caddy",
  sqliteBinary: "sqlite3",
  curlBinary: "curl",
  systemctlBinary: "systemctl",
  systemdRunBinary: "systemd-run",
  sourcePublicOrigin: "https://app.timbersteeltrade.com",
  relayPublicOrigin: "https://relay.timbersteeltrade.com",
  logDirectory: "/var/log/bitcraft-claim-monitor-relay",
  runUser: "bitcraft",
  runHome: "/opt/bitcraft-claim-monitor-relay",
});

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function requireCommand(run, command, args, label, options = {}) {
  const result = run(command, args, options);
  if (result?.error || result?.status !== 0) throw new Error(`${label} failed`);
  return String(result.stdout ?? "");
}

function privacyPlanFromState(state) {
  const plan = state?.migration?.privacy?.plan ?? state?.migration?.manifest?.privacyDeletionLedger;
  if (!plan) throw new Error("Frozen migration manifest has no privacy cutover plan");
  return plan;
}

function timestampForFile(now) {
  return now().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function parseJsonOutput(value, label) {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("expected an object");
    return parsed;
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${error.message}`);
  }
}

function adaptAndValidateCaddy(run, paths, configPath, mode) {
  regularFile(configPath, `${mode} Caddy configuration`);
  requireCommand(run, paths.caddyBinary, ["validate", "--config", configPath], `Validate ${mode} Caddy configuration`);
  const adapted = requireCommand(
    run,
    paths.caddyBinary,
    ["adapt", "--config", configPath, "--adapter", "caddyfile"],
    `Adapt ${mode} Caddy configuration`,
  );
  return validateCaddyTopology(parseJsonOutput(adapted, `Adapted ${mode} Caddy configuration`), mode);
}

function systemctlValue(run, paths, unit, property) {
  return requireCommand(
    run,
    paths.systemctlBinary,
    ["show", unit, `--property=${property}`, "--value"],
    `Read ${property} for ${unit}`,
  ).trim();
}

function unitSnapshot(run, paths, unit) {
  const loadState = systemctlValue(run, paths, unit, "LoadState");
  const fragmentPath = systemctlValue(run, paths, unit, "FragmentPath");
  if (loadState !== "loaded" || path.basename(fragmentPath) !== unit) {
    throw new Error(`Installed unit identity mismatch for ${unit}`);
  }
  return {
    unit,
    loadState,
    fragmentPath,
    fragmentIdentity: fileIdentity(fragmentPath),
    activeState: systemctlValue(run, paths, unit, "ActiveState"),
    unitFileState: systemctlValue(run, paths, unit, "UnitFileState"),
    mainPid: systemctlValue(run, paths, unit, "MainPID"),
  };
}

function unitEnvironment(run, paths, unit) {
  const raw = systemctlValue(run, paths, unit, "Environment");
  const values = {};
  for (const match of raw.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|'([^']*)'|([^\s]*))/g)) {
    values[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return values;
}

function unitEnvironmentFile(run, paths, unit) {
  const raw = systemctlValue(run, paths, unit, "EnvironmentFiles");
  const match = raw.match(/(?:^|\s)(\/?[^\s;()]+)(?:\s*\([^)]*\))?/);
  if (!match) throw new Error(`Installed unit ${unit} has no discoverable environment file`);
  return path.resolve(match[1]);
}

function databaseSetting(db, key) {
  return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value;
}

function safeJsonObject(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value ?? ""));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed;
}

function assertCurrentRelayRelease(paths, revision) {
  if (!CANONICAL_REVISION_PATTERN.test(String(revision ?? ""))) {
    throw new Error("Prepared cutover revision must be a full SHA");
  }
  const currentStats = lstatSync(paths.currentRelease);
  if (!currentStats.isSymbolicLink()) throw new Error("Relay current release must be a symbolic link");
  const expectedRelease = path.resolve(paths.releasesDirectory, revision);
  if (path.resolve(realpathSync.native(paths.currentRelease)) !== expectedRelease) {
    throw new Error("Current Relay symlink does not point to the prepared revision");
  }
  const packageJson = safeJsonObject(
    readFileSync(path.join(expectedRelease, "apps", "bitcraft-local", "package.json"), "utf8"),
    "Relay package.json",
  );
  if (packageJson.version !== CANONICAL_VERSION) throw new Error(`Relay version must be exactly ${CANONICAL_VERSION}`);
  return expectedRelease;
}

function referencedBrandingFiles(databasePath, directory, label) {
  regularDirectory(directory, `${label} branding directory`);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const raw = databaseSetting(db, "branding_json");
    if (raw == null) return [];
    const branding = safeJsonObject(raw, `${label} branding_json`);
    const files = [];
    for (const type of ["logo", "favicon"]) {
      const entry = branding[type];
      if (entry == null) continue;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${label} ${type} branding metadata is invalid`);
      const fileName = String(entry.fileName ?? "");
      if (!/^(?:logo|favicon)\.(?:png|jpe?g|webp)$/i.test(fileName) || path.basename(fileName) !== fileName) {
        throw new Error(`${label} ${type} branding filename is unsafe`);
      }
      const filePath = path.resolve(directory, fileName);
      if (path.dirname(filePath) !== path.resolve(directory)) throw new Error(`${label} branding asset escapes its root`);
      regularFile(filePath, `${label} referenced branding asset`);
      files.push(filePath);
    }
    return [...new Set(files)].sort();
  } finally {
    db.close();
  }
}

function brandingDirectorySnapshot(directory, label) {
  if (!existsSync(directory)) return { existed: false, metadata: null, files: [] };
  const stat = regularDirectory(directory, `${label} branding directory`);
  const files = readdirSync(directory, { withFileTypes: true }).map((entry) => {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`${label} branding directory contains an unsafe entry: ${entry.name}`);
    }
    const filePath = path.join(directory, entry.name);
    regularFile(filePath, `${label} branding file`);
    return filePath;
  }).sort();
  return {
    existed: true,
    metadata: { mode: Number(stat.mode & 0o777n), uid: Number(stat.uid), gid: Number(stat.gid) },
    files,
  };
}

function decimalParts(value, label) {
  if (value == null) return { coefficient: 0n, scale: 0 };
  const match = String(value).trim().match(/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/);
  if (!match) throw new Error(`${label} is not an exact decimal value`);
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10_000) {
    throw new Error(`${label} has an unsupported decimal exponent`);
  }
  let coefficient = BigInt(`${match[2]}${fraction}`) * (match[1] === "-" ? -1n : 1n);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function addExactDecimal(total, value, label) {
  const next = decimalParts(value, label);
  if (next.scale > total.scale) {
    total.coefficient *= 10n ** BigInt(next.scale - total.scale);
    total.scale = next.scale;
  }
  total.coefficient += next.coefficient * (10n ** BigInt(total.scale - next.scale));
}

function formatExactDecimal(total) {
  let { coefficient, scale } = total;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const integer = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? `.${digits.slice(-scale)}` : "";
  return `${negative ? "-" : ""}${integer}${fraction}`;
}

function sqliteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function cutoverTableRowCount(db, table) {
  const present = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(String(table));
  if (!present) return 0;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${sqliteIdentifier(table)}`).get().count);
}

export function preparePrivacyLedgerForRuntime({ databasePath, ledgerPath }) {
  const database = regularFile(databasePath, "Canonical Relay database");
  regularFile(ledgerPath, "Canonical privacy ledger");
  applyMetadata(ledgerPath, { mode: 0o600, uid: database.uid, gid: database.gid });
  syncFile(ledgerPath);
  syncDirectory(path.dirname(ledgerPath));
  return fileIdentity(ledgerPath);
}

function databaseOperationalTotals(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const aggregate = (table, columns) => {
    const selected = columns.map((column) => `CAST(${sqliteIdentifier(column)} AS TEXT) AS ${sqliteIdentifier(column)}`).join(", ");
    const totals = Object.fromEntries(columns.map((column) => [column, { coefficient: 0n, scale: 0 }]));
    let count = 0;
    for (const row of db.prepare(`SELECT ${selected} FROM ${sqliteIdentifier(table)}`).iterate()) {
      count += 1;
      if (!Number.isSafeInteger(count)) throw new Error(`Row count for ${table} exceeds the supported exact range`);
      for (const column of columns) addExactDecimal(totals[column], row[column], `${table}.${column}`);
    }
    return {
      count,
      ...Object.fromEntries(columns.map((column) => [
        column,
        formatExactDecimal(totals[column]),
      ])),
    };
  };
  try {
    return {
      contributions: {
        aggregates: aggregate("production_contributions", ["contributed_progress", "contributed_xp", "contribution_count"]),
        events: aggregate("production_contribution_events", ["contributed_progress", "contributed_xp"]),
      },
      market: {
        events: aggregate("market_events", ["quantity", "price", "total_value"]),
        trades: aggregate("market_trades", ["quantity", "unit_price", "total_price"]),
      },
    };
  } finally {
    db.close();
  }
}

function outboxState(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT status, COUNT(*) AS count FROM discord_notification_outbox GROUP BY status ORDER BY status").all();
    return Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count)]));
  } finally {
    db.close();
  }
}

function providerSubscriptionSummary(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT provider, source_key, domain, generation, connected, last_error
      FROM provider_subscription_health
      ORDER BY provider, source_key, domain
    `).all();
    if (!rows.length) throw new Error("Relay has no recorded provider subscriptions");
    const invalid = rows.filter((row) => Number(row.connected) !== 1 || Number(row.generation) <= 0 || row.last_error != null);
    if (invalid.length) throw new Error("Relay provider subscriptions are not all connected and applied");
    return {
      count: rows.length,
      minimumGeneration: Math.min(...rows.map((row) => Number(row.generation))),
      subscriptions: Object.fromEntries(rows.map((row) => [
        `${row.provider}:${row.source_key}:${row.domain}`,
        Number(row.generation),
      ])),
    };
  } finally {
    db.close();
  }
}

function sqliteIntegrity(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
    const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => String(row.integrity_check));
    if (foreignKeys.length || integrity.length !== 1 || integrity[0] !== "ok") {
      throw new Error("Canonical Relay SQLite integrity verification failed");
    }
    return { foreignKeyViolations: 0, integrity: "ok" };
  } finally {
    db.close();
  }
}

function assertNoDeletionResurrection(databasePath, plan, at) {
  if (!plan) return { activeRecords: 0 };
  const keyPaths = [
    plan.target.key.path,
    ...(plan.target.previousKeys ?? []).map((entry) => entry.path),
    plan.previousKeyConfiguration.installedOldKeyPath,
  ];
  const keys = keyPaths.map((keyPath) => {
    regularFile(keyPath, "Privacy verification key");
    return readFileSync(keyPath, "utf8").trim();
  });
  const records = parseDeletionLedgerContent(readFileSync(plan.target.ledger.path, "utf8"), keys, "Installed privacy deletion ledger");
  const subjects = committedDeletionSubjects(records, at);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    for (const account of db.prepare("SELECT discord_id FROM user_accounts ORDER BY id").all()) {
      if (keys.some((key) => subjects.has(deletionLedgerSubject(account.discord_id, key)))) {
        throw new Error("Privacy deletion non-resurrection verification failed");
      }
    }
    return { activeRecords: subjects.size };
  } finally {
    db.close();
  }
}

function healthJson(run, paths, url, label, extraArgs = []) {
  const output = requireCommand(
    run,
    paths.curlBinary,
    ["--fail", "--silent", "--show-error", "--max-time", "20", ...extraArgs, url],
    label,
  );
  return parseJsonOutput(output, label);
}

function assertCanonicalHealth(health, revision) {
  if (health.ok !== true
    || health.deploymentMode !== "canonical"
    || health.canonicalOrigin !== "https://app.timbersteeltrade.com"
    || health.discordReady !== true
    || health.version !== CANONICAL_VERSION
    || health.buildSha !== revision.slice(0, 12)) {
    throw new Error("Canonical health payload does not match the admitted revision and runtime");
  }
}

function migrationInputFromState(paths, state) {
  const discovered = state.preflight?.discoveredPaths ?? {};
  return {
    claimId: CANONICAL_CLAIM_ID,
    manifestPath: state.migration?.manifestPath,
    sourceDatabasePath: paths.sourceDatabasePath,
    targetDatabasePath: paths.targetDatabasePath,
    sourceBrandingDirectory: paths.sourceBrandingDirectory,
    targetBrandingDirectory: paths.targetBrandingDirectory,
    contributionRepairManifest: state.repair?.manifest,
    privacyPlan: state.migration?.manifest?.privacyDeletionLedger,
    privacy: {
      sourceLedgerPath: discovered.sourceLedgerPath,
      targetLedgerPath: discovered.targetLedgerPath,
      sourceKeyFilePath: discovered.sourceKeyPath,
      targetKeyFilePath: discovered.targetKeyPath,
      targetPreviousKeyFilePaths: discovered.targetPreviousKeyPaths ?? [],
      installedPreviousKeyFilePath: paths.installedPreviousPrivacyKey,
      readinessArtifactPath: paths.privacyReadinessArtifact,
      sourceConfigRoot: paths.sourceConfigRoot,
      targetConfigRoot: paths.relayConfigRoot,
      sourceBackupRoot: paths.sourceBackupRoot,
      targetBackupRoot: paths.relayBackupRoot,
    },
  };
}

export function createSystemCutoverOperations({
  paths: pathOverrides = {},
  run = defaultRun,
  now = () => new Date(),
  request = globalThis.fetch,
  statFilesystem = statfsSync,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  soakVerifier = runCanonicalSoak,
  soakFetch = globalThis.fetch,
  log = () => {},
} = {}) {
  const paths = { ...DEFAULT_SYSTEM_PATHS, ...pathOverrides };
  const audit = (operation, metadata = {}) => log({ at: now().toISOString(), operation, ...metadata });

  function currentOperationStem(state) {
    return `${state.preparedAt.replace(/[^0-9TZ]/g, "")}-${state.revision}`;
  }

  async function discordJson(token, endpoint, label) {
    let response;
    try {
      response = await request(`https://discord.com/api/v10${endpoint}`, {
        headers: { Authorization: `Bot ${token}` },
      });
    } catch {
      throw new Error(`${label} could not be reached`);
    }
    if (!response?.ok) throw new Error(`${label} failed with status ${Number(response?.status ?? 0)}`);
    try {
      return await response.json();
    } catch {
      throw new Error(`${label} returned invalid JSON`);
    }
  }

  async function validatePrepare({ revision }) {
    audit("validate-prepare", { revision });
    const gitEnvironment = [
      `HOME=${paths.runHome}`,
      `GIT_SSH_COMMAND=ssh -F ${path.join(paths.runHome, ".ssh", "config")}`,
    ];
    requireCommand(run, "sudo", [
      "-u", paths.runUser, "env", ...gitEnvironment,
      "git", "-C", paths.sourceCheckout, "fetch", "--prune", "origin", "main",
    ], "Fetch Relay origin/main");
    const originMain = requireCommand(run, "sudo", [
      "-u", paths.runUser, "env", ...gitEnvironment,
      "git", "-C", paths.sourceCheckout, "rev-parse", "origin/main",
    ], "Resolve Relay origin/main").trim();
    if (originMain !== revision) throw new Error("Requested cutover revision is not the exact current origin/main SHA");
    assertCurrentRelayRelease(paths, revision);

    const units = Object.fromEntries([...SOURCE_UNITS, ...RELAY_UNITS].map((unit) => [unit, unitSnapshot(run, paths, unit)]));
    for (const unit of REQUIRED_ACTIVE_UNITS) {
      const snapshot = units[unit];
      if (snapshot.activeState !== "active" || !["enabled", "enabled-runtime"].includes(snapshot.unitFileState)) {
        throw new Error(`Unit ${unit} is not in its expected installed state`);
      }
    }
    for (const unit of REQUIRED_PASSIVE_UNITS) {
      const snapshot = units[unit];
      if (snapshot.activeState !== "inactive" || snapshot.unitFileState !== "static") {
        throw new Error(`Unit ${unit} is not in its expected installed state`);
      }
    }
    const sourceEnvironmentFile = unitEnvironmentFile(run, paths, "bitcraft-claim-monitor.service");
    const relayEnvironmentFile = unitEnvironmentFile(run, paths, "bitcraft-claim-monitor-relay.service");
    if (sourceEnvironmentFile !== path.resolve(paths.sourceEnvironmentFile)
      || relayEnvironmentFile !== path.resolve(paths.relayEnvironmentFile)) {
      throw new Error("Installed service environment-file identity does not match the supported deployment");
    }
    regularFile(sourceEnvironmentFile, "Old production environment file");
    regularFile(relayEnvironmentFile, "Relay environment file");
    const sourceUnitEnvironment = unitEnvironment(run, paths, "bitcraft-claim-monitor.service");
    const targetUnitEnvironment = unitEnvironment(run, paths, "bitcraft-claim-monitor-relay.service");
    const discoveredPaths = {
      sourceLedgerPath: sourceUnitEnvironment.PRIVACY_LEDGER_PATH,
      sourceKeyPath: sourceUnitEnvironment.PRIVACY_LEDGER_KEY_FILE,
      targetLedgerPath: targetUnitEnvironment.PRIVACY_LEDGER_PATH,
      targetKeyPath: targetUnitEnvironment.PRIVACY_LEDGER_KEY_FILE,
      targetPreviousKeyPaths: [],
    };
    const supportedPaths = [
      ["source privacy ledger", discoveredPaths.sourceLedgerPath, paths.sourcePrivacyLedger],
      ["source privacy key", discoveredPaths.sourceKeyPath, paths.sourcePrivacyKey],
      ["Relay privacy ledger", discoveredPaths.targetLedgerPath, paths.relayPrivacyLedger],
      ["Relay privacy key", discoveredPaths.targetKeyPath, paths.relayPrivacyKey],
    ];
    for (const [label, discovered, expected] of supportedPaths) {
      if (path.resolve(String(discovered ?? "")) !== path.resolve(expected)) throw new Error(`Installed ${label} path is unsupported`);
    }
    for (const [label, filePath] of [
      ["old production database", paths.sourceDatabasePath],
      ["Relay database", paths.targetDatabasePath],
      ["old privacy key", discoveredPaths.sourceKeyPath],
      ["Relay privacy key", discoveredPaths.targetKeyPath],
      ["backup encryption key", paths.backupEncryptionKeyFile],
      ["backup helper", paths.backupHelper],
      ["backup crypto helper", paths.backupCryptoHelper],
      ["live Caddy configuration", paths.liveCaddyFile],
      ["maintenance Caddy candidate", paths.maintenanceCaddyCandidate],
      ["final Caddy candidate", paths.finalCaddyCandidate],
    ]) regularFile(filePath, label);
    if (existsSync(discoveredPaths.sourceLedgerPath)) regularFile(discoveredPaths.sourceLedgerPath, "Old privacy ledger");
    if (existsSync(discoveredPaths.targetLedgerPath)) regularFile(discoveredPaths.targetLedgerPath, "Relay privacy ledger");

    sqliteIntegrity(paths.sourceDatabasePath);
    sqliteIntegrity(paths.targetDatabasePath);
    const sourceDb = new DatabaseSync(paths.sourceDatabasePath, { readOnly: true });
    const relayDb = new DatabaseSync(paths.targetDatabasePath, { readOnly: true });
    let sourceDiscord;
    try {
      if (String(databaseSetting(sourceDb, "claim_id") ?? "") !== CANONICAL_CLAIM_ID
        || String(databaseSetting(relayDb, "claim_id") ?? "") !== CANONICAL_CLAIM_ID) {
        throw new Error(`Both database claim settings must be exactly ${CANONICAL_CLAIM_ID}`);
      }
      sourceDiscord = safeJsonObject(databaseSetting(sourceDb, "discord_json"), "Old production discord_json");
    } finally {
      sourceDb.close();
      relayDb.close();
    }

    adaptAndValidateCaddy(run, paths, paths.liveCaddyFile, "preflight");
    adaptAndValidateCaddy(run, paths, paths.maintenanceCaddyCandidate, "maintenance");
    adaptAndValidateCaddy(run, paths, paths.finalCaddyCandidate, "final");

    const relayEnvironment = parseEnvironmentDocument(readFileSync(paths.relayEnvironmentFile));
    const configuredPreviousKeys = String(relayEnvironment.PRIVACY_LEDGER_PREVIOUS_KEY_FILES ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const keyPath of configuredPreviousKeys) {
      if (!pathIsWithin(paths.relayConfigRoot, keyPath)) {
        throw new Error("Configured Relay previous privacy key is outside its approved config root");
      }
      regularFile(keyPath, "Configured Relay previous privacy key");
    }
    discoveredPaths.targetPreviousKeyPaths = configuredPreviousKeys;
    for (const destination of [paths.installedPreviousPrivacyKey, paths.privacyReadinessArtifact]) {
      if (existsSync(destination)) throw new Error("A canonical privacy cutover destination already exists; refusing overwrite");
    }
    if (String(relayEnvironment.LEGAL_CONFIGURATION_CONFIRMED ?? "").toLowerCase() !== "true") {
      throw new Error("Relay legal configuration must be explicitly confirmed");
    }
    if (relayEnvironment.DISCORD_OAUTH_REDIRECT_URI
      && relayEnvironment.DISCORD_OAUTH_REDIRECT_URI !== "https://app.timbersteeltrade.com/api/local/auth/discord/callback") {
      throw new Error("Relay OAuth callback is not canonical");
    }
    if (String(relayEnvironment.ENABLE_RELAY_PROVIDER ?? "").toLowerCase() !== "true") {
      throw new Error("Relay provider must be enabled before cutover");
    }
    for (const key of ["DISCORD_BOT_TOKEN", "DISCORD_OAUTH_CLIENT_ID", "DISCORD_OAUTH_CLIENT_SECRET"]) {
      if (!String(relayEnvironment[key] ?? "").trim()) {
        throw new Error(`Canonical runtime credential ${key} is required in the Relay environment`);
      }
    }
    const botToken = String(relayEnvironment.DISCORD_BOT_TOKEN).trim();
    const applicationId = String(relayEnvironment.DISCORD_OAUTH_CLIENT_ID).trim();
    const guildId = String(relayEnvironment.DISCORD_GUILD_ID ?? sourceDiscord.guildId ?? "").trim();
    const announcementsChannelId = String(sourceDiscord.channels?.announcements ?? "").trim();
    if (!sourceDiscord.enabled || sourceDiscord.presence?.enabled === false
      || !/^\d+$/.test(applicationId) || !/^\d+$/.test(guildId) || !/^\d+$/.test(announcementsChannelId)) {
      throw new Error("Canonical Discord identity, guild, announcements channel, and gateway presence must be configured");
    }
    const bot = await discordJson(botToken, "/users/@me", "Discord bot identity preflight");
    const application = await discordJson(botToken, "/oauth2/applications/@me", "Discord OAuth application preflight");
    const guild = await discordJson(botToken, `/guilds/${guildId}`, "Discord guild access preflight");
    const channel = await discordJson(botToken, `/channels/${announcementsChannelId}`, "Discord announcements-channel access preflight");
    const callback = "https://app.timbersteeltrade.com/api/local/auth/discord/callback";
    if (String(sourceDiscord.applicationId ?? "") !== applicationId
      || String(bot.id ?? "") !== applicationId || String(application.id ?? "") !== applicationId
      || !Array.isArray(application.redirect_uris) || !application.redirect_uris.includes(callback)
      || String(guild.id ?? "") !== guildId || String(channel.guild_id ?? "") !== guildId
      || String(channel.id ?? "") !== announcementsChannelId || ![0, 5].includes(Number(channel.type))) {
      throw new Error("Discord bot, OAuth callback, guild, or announcements-channel identity is not canonical");
    }

    const subscriptions = providerSubscriptionSummary(paths.targetDatabasePath);
    const gatewayProcesses = requireCommand(run, "pgrep", ["-a", "-f", "/apps/bitcraft-local/worker\\.mjs"], "Inspect live Discord gateway workers").trim().split(/\r?\n/).filter(Boolean);
    const knownWorkerPids = new Set([
      units["bitcraft-claim-monitor-worker.service"].mainPid,
      units["bitcraft-claim-monitor-relay-worker.service"].mainPid,
    ].filter((pid) => /^\d+$/.test(pid) && pid !== "0"));
    if (gatewayProcesses.some((line) => !knownWorkerPids.has(line.trim().split(/\s+/, 1)[0]))) {
      throw new Error("An unexpected live Discord gateway worker exists");
    }

    const assets = [
      paths.sourceDatabasePath,
      paths.targetDatabasePath,
      sourceEnvironmentFile,
      relayEnvironmentFile,
      paths.liveCaddyFile,
      ...referencedBrandingFiles(paths.sourceDatabasePath, paths.sourceBrandingDirectory, "Old"),
      ...referencedBrandingFiles(paths.targetDatabasePath, paths.targetBrandingDirectory, "Relay"),
      ...[discoveredPaths.sourceLedgerPath, discoveredPaths.targetLedgerPath].filter((filePath) => existsSync(filePath)),
      discoveredPaths.sourceKeyPath,
      discoveredPaths.targetKeyPath,
      ...configuredPreviousKeys,
    ];
    const bytesToProtect = assets.reduce((total, filePath) => total + statSync(filePath).size, 0);
    const disk = statFilesystem(paths.relayBackupRoot, { bigint: true });
    const availableBytes = BigInt(disk.bavail) * BigInt(disk.bsize);
    const requiredBytes = BigInt(bytesToProtect) * 3n + 1024n * 1024n * 1024n;
    if (availableBytes < requiredBytes) throw new Error("Insufficient disk space for cutover staging, encryption, verification, and 1 GiB reserve");

    const health = healthJson(run, paths, "http://127.0.0.1:19430/api/local/health", "Validate Relay preview health");
    if (health.ok !== true || health.deploymentMode !== "preview" || health.version !== CANONICAL_VERSION || health.buildSha !== revision.slice(0, 12)) {
      throw new Error("Relay preview health does not match the requested cutover revision");
    }
    return {
      revision,
      version: CANONICAL_VERSION,
      claimId: CANONICAL_CLAIM_ID,
      units,
      discoveredPaths,
      caddy: { original: fileIdentity(paths.liveCaddyFile) },
      subscriptions,
      operationalTotals: databaseOperationalTotals(paths.targetDatabasePath),
      discord: { applicationId, guildId, announcementsChannelId },
      disk: { availableBytes: String(availableBytes), requiredBytes: String(requiredBytes) },
    };
  }

  async function installMaintenance(state) {
    audit("install-maintenance", { revision: state.revision });
    assertRecordedIdentity(state.preflight?.caddy?.original, "Pre-cutover Caddy configuration");
    adaptAndValidateCaddy(run, paths, paths.liveCaddyFile, "preflight");
    adaptAndValidateCaddy(run, paths, paths.maintenanceCaddyCandidate, "maintenance");
    const savedPath = path.join(paths.stateDirectory, `caddy-before-${currentOperationStem(state)}.caddyfile`);
    const originalBytes = readFileSync(paths.liveCaddyFile);
    const original = state.preflight.caddy.original;
    writeBytesExclusive(savedPath, originalBytes, { mode: 0o600, uid: 0, gid: 0 });
    const saved = fileIdentity(savedPath);
    if (saved.sha256 !== original.sha256) throw new Error("Saved pre-cutover Caddy configuration failed hash verification");
    state.maintenance = {
      savedPath,
      saved,
      installed: null,
      originalMetadata: { mode: original.mode, uid: original.uid, gid: original.gid },
      originalSha256: original.sha256,
    };
    const candidateBytes = readFileSync(paths.maintenanceCaddyCandidate);
    writeBytesAtomic(paths.liveCaddyFile, candidateBytes, {
      mode: original.mode,
      uid: original.uid,
      gid: original.gid,
    });
    state.maintenance.installed = fileIdentity(paths.liveCaddyFile);
    requireCommand(run, paths.caddyBinary, ["reload", "--config", paths.liveCaddyFile], "Reload maintenance Caddy configuration");
    adaptAndValidateCaddy(run, paths, paths.liveCaddyFile, "maintenance");
    return state.maintenance;
  }

  async function stopAndCaptureWriters(state) {
    audit("stop-and-capture-writers", { revision: state.revision });
    const units = Object.fromEntries([...SOURCE_UNITS, ...RELAY_UNITS].map((unit) => [unit, unitSnapshot(run, paths, unit)]));
    state.serviceCapture = { units, stoppedAt: now().toISOString() };
    for (const unit of WRITER_STOP_ORDER) {
      requireCommand(run, paths.systemctlBinary, ["stop", unit], `Stop ${unit}`);
    }
    return state.serviceCapture;
  }

  async function assertWritersStopped() {
    audit("assert-writers-stopped");
    for (const unit of WRITER_STOP_ORDER) {
      const state = systemctlValue(run, paths, unit, "ActiveState");
      if (state !== "inactive") throw new Error(`Writer unit ${unit} is still ${state}`);
    }
    const listeners = requireCommand(run, "ss", ["-H", "-ltnp", "sport", "=", ":18430", "or", "sport", "=", ":19430"], "Inspect cutover TCP listeners").trim();
    if (listeners) throw new Error("A process still owns cutover port 18430 or 19430");
    const gateways = run("pgrep", ["-a", "-f", "/apps/bitcraft-local/worker\\.mjs"]);
    if (!gateways?.error && gateways?.status === 0 && String(gateways.stdout ?? "").trim()) {
      throw new Error("A Discord gateway worker remains after writer stop");
    }
    if (gateways?.error || ![0, 1].includes(Number(gateways?.status))) throw new Error("Discord gateway process verification failed");
  }

  async function installPreviousPrivacyKey(state, checkpoint = () => {}) {
    const plan = privacyPlanFromState(state);
    const sourcePath = plan.source?.key?.path;
    const currentPath = plan.target?.key?.path;
    const destination = plan.previousKeyConfiguration?.installedOldKeyPath;
    const sourceStat = regularFile(sourcePath, "Old privacy verification key");
    const currentStat = regularFile(currentPath, "Current Relay privacy verification key");
    if (existsSync(destination)) {
      if (state.preApply?.previousKey) {
        assertRecordedIdentity(state.preApply.previousKey, "Installed previous privacy key");
        return state.preApply.previousKey;
      }
      if (state.preApply?.previousKeyIntent) {
        removeRecoveryTemporary(state.preApply.previousKeyIntent, "Installed previous privacy key");
        const recoveredIdentity = assertIntendedFile(state.preApply.previousKeyIntent, "Installed previous privacy key");
        state.preApply.previousKey = recoveredIdentity;
        checkpoint(state);
        return recoveredIdentity;
      }
      throw new Error("Installed previous privacy key destination already exists; refusing overwrite");
    }
    const bytes = readFileSync(sourcePath);
    if (sha256(bytes) !== plan.source.key.fileSha256) throw new Error("Old privacy verification key changed since manifest creation");
    const expectedMetadata = {
      mode: Number(currentStat.mode & 0o777n),
      uid: Number(currentStat.uid),
      gid: Number(currentStat.gid),
    };
    const temporaryPath = cutoverTemporaryPath(destination, state, "previous-key");
    if (existsSync(temporaryPath)) throw new Error("Previous privacy key staging path already exists; abort is required");
    state.preApply ??= {};
    state.preApply.previousKeyIntent = {
      destinationWasAbsent: true,
      expectedMetadata,
      expectedSha256: plan.source.key.fileSha256,
      expectedSize: bytes.length,
      path: destination,
      temporaryPath,
    };
    checkpoint(state);
    writeBytesExclusive(destination, bytes, expectedMetadata, temporaryPath);
    const identity = fileIdentity(destination);
    state.preApply.previousKey = identity;
    if (identity.sha256 !== plan.source.key.fileSha256 || String(sourceStat.nlink) !== "1") throw new Error("Installed previous privacy key verification failed");
    checkpoint(state);
    return identity;
  }

  async function editCanonicalEnvironment(state, checkpoint = () => {}) {
    if (state.preApply?.environment) {
      assertRecordedIdentity(state.preApply.environment.updated, "Canonical Relay environment");
      return state.preApply.environment;
    }
    const plan = privacyPlanFromState(state);
    const originalStat = regularFile(paths.relayEnvironmentFile, "Relay environment file");
    const original = readFileSync(paths.relayEnvironmentFile);
    const originalIdentity = fileIdentity(paths.relayEnvironmentFile);
    if (originalIdentity.sha256 !== sha256(original)) throw new Error("Relay environment changed while recording recovery bytes");
    const updated = editEnvironmentDocument(original, {
      BITCRAFT_DEPLOYMENT_MODE: "canonical",
      DISCORD_DELIVERY_MODE: "live",
      ENABLE_DISCORD_STARTUP: "true",
      LEGAL_CONFIGURATION_CONFIRMED: "true",
      DISCORD_OAUTH_REDIRECT_URI: "https://app.timbersteeltrade.com/api/local/auth/discord/callback",
      PRIVACY_LEDGER_PREVIOUS_KEY_FILES: plan.previousKeyConfiguration.value,
    });
    const metadata = {
      mode: Number(originalStat.mode & 0o777n),
      uid: Number(originalStat.uid),
      gid: Number(originalStat.gid),
    };
    const intent = {
      expectedUpdatedMetadata: metadata,
      expectedUpdatedSha256: sha256(updated),
      expectedSize: updated.length,
      originalIdentity,
      path: paths.relayEnvironmentFile,
      temporaryPath: cutoverTemporaryPath(paths.relayEnvironmentFile, state, "environment"),
      originalBase64: original.toString("base64"),
      originalSha256: sha256(original),
      originalMetadata: metadata,
    };
    if (existsSync(intent.temporaryPath)) throw new Error("Relay environment staging path already exists; abort is required");
    state.preApply ??= {};
    state.preApply.environmentIntent = intent;
    checkpoint(state);
    writeBytesAtomic(paths.relayEnvironmentFile, updated, metadata, intent.temporaryPath);
    const record = { ...intent, updated: fileIdentity(paths.relayEnvironmentFile) };
    state.preApply.environment = record;
    checkpoint(state);
    return record;
  }

  async function writePrivacyReadiness(state, checkpoint = () => {}) {
    const plan = privacyPlanFromState(state);
    const destination = plan.readinessArtifact?.path;
    if (existsSync(destination)) {
      if (state.preApply?.readiness) {
        assertRecordedIdentity(state.preApply.readiness, "Privacy readiness artifact");
        return state.preApply.readiness;
      }
      if (state.preApply?.readinessIntent) {
        removeRecoveryTemporary(state.preApply.readinessIntent, "Privacy readiness artifact");
        const recoveredIdentity = assertIntendedFile(state.preApply.readinessIntent, "Privacy readiness artifact");
        state.preApply.readiness = recoveredIdentity;
        checkpoint(state);
        return recoveredIdentity;
      }
      throw new Error("Privacy readiness artifact destination already exists; refusing overwrite");
    }
    verifyInstalledPrivacyInputs(state, plan);
    const artifact = createCanonicalCutoverPrivacyReadinessArtifact(plan, state.manifestHash);
    const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
    const expectedMetadata = { mode: 0o600, uid: 0, gid: 0 };
    const temporaryPath = cutoverTemporaryPath(destination, state, "readiness");
    if (existsSync(temporaryPath)) throw new Error("Privacy readiness staging path already exists; abort is required");
    state.preApply ??= {};
    state.preApply.readinessIntent = {
      destinationWasAbsent: true,
      expectedMetadata,
      expectedSha256: sha256(bytes),
      expectedSize: bytes.length,
      path: destination,
      temporaryPath,
    };
    checkpoint(state);
    writeBytesExclusive(destination, bytes, expectedMetadata, temporaryPath);
    const identity = fileIdentity(destination);
    state.preApply.readiness = identity;
    checkpoint(state);
    return identity;
  }

  function verifyInstalledPrivacyInputs(state, plan) {
    const previousKey = assertRecordedIdentity(state.preApply?.previousKey, "Installed previous privacy key");
    if (previousKey.path !== plan.previousKeyConfiguration.installedOldKeyPath
      || previousKey.sha256 !== plan.source.key.fileSha256) throw new Error("Installed previous privacy key does not match the frozen manifest");
    assertRecordedIdentity(state.preApply?.environment?.updated, "Canonical Relay environment");
    const environment = parseEnvironmentDocument(readFileSync(paths.relayEnvironmentFile));
    const expected = {
      BITCRAFT_DEPLOYMENT_MODE: "canonical",
      DISCORD_DELIVERY_MODE: "live",
      ENABLE_DISCORD_STARTUP: "true",
      LEGAL_CONFIGURATION_CONFIRMED: "true",
      DISCORD_OAUTH_REDIRECT_URI: "https://app.timbersteeltrade.com/api/local/auth/discord/callback",
      PRIVACY_LEDGER_PREVIOUS_KEY_FILES: plan.previousKeyConfiguration.value,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (environment[key] !== value) throw new Error(`Canonical Relay environment readiness mismatch for ${key}`);
    }
    return { previousKey, environment };
  }

  async function verifyPrivacyReadiness(state) {
    const plan = privacyPlanFromState(state);
    verifyInstalledPrivacyInputs(state, plan);
    const readiness = assertRecordedIdentity(state.preApply?.readiness, "Privacy readiness artifact");
    if (readiness.path !== plan.readinessArtifact.path) throw new Error("Privacy readiness artifact path does not match the frozen manifest");
    const expectedArtifact = createCanonicalCutoverPrivacyReadinessArtifact(plan, state.manifestHash);
    const actualArtifact = JSON.parse(readFileSync(readiness.path, "utf8"));
    if (JSON.stringify(actualArtifact) !== JSON.stringify(expectedArtifact)) throw new Error("Privacy readiness artifact does not match the frozen manifest");
  }

  async function restoreEnvironment(state) {
    const record = state.preApply?.environment ?? state.preApply?.environmentIntent;
    if (!record) return;
    removeRecoveryTemporary(state.preApply?.environmentIntent, "Canonical Relay environment");
    const original = Buffer.from(record.originalBase64, "base64");
    if (sha256(original) !== record.originalSha256) throw new Error("Saved Relay environment bytes are invalid");
    const current = fileIdentity(record.path);
    if (current.sha256 === record.originalSha256
      && current.mode === record.originalMetadata.mode
      && (process.platform === "win32"
        || (current.uid === record.originalMetadata.uid && current.gid === record.originalMetadata.gid))) return;
    if (record.updated) {
      assertRecordedIdentity(record.updated, "Canonical Relay environment");
    } else if (current.sha256 !== record.expectedUpdatedSha256
      || current.mode !== record.expectedUpdatedMetadata.mode
      || (process.platform !== "win32"
        && (current.uid !== record.expectedUpdatedMetadata.uid || current.gid !== record.expectedUpdatedMetadata.gid))) {
      throw new Error("Canonical Relay environment does not match its pre-mutation recovery intent");
    }
    writeBytesAtomic(record.path, original, record.originalMetadata);
  }

  async function quiesceServicesForRestore(state) {
    if (!state.serviceCapture?.units) return;
    audit("quiesce-services-for-restore");
    const recordedUnits = Object.keys(state.serviceCapture.units);
    const orderedUnits = [
      ...WRITER_STOP_ORDER,
      ...recordedUnits.filter((unit) => !WRITER_STOP_ORDER.includes(unit)).sort(),
    ].filter((unit) => Object.hasOwn(state.serviceCapture.units, unit));
    const failures = [];
    for (const unit of orderedUnits) {
      try {
        requireCommand(run, paths.systemctlBinary, ["stop", unit], `Quiesce ${unit} before restoration`);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    try {
      await assertWritersStopped();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    if (failures.length) throw new Error(`Service quiescence before restoration was incomplete: ${failures.join("; ")}`);
  }

  function verifiedRecoveryBackup(state, sourceLabel, { required = true } = {}) {
    const matches = (state.backups ?? []).filter((backup) => backup.sourceLabel === sourceLabel);
    if (!matches.length) {
      if (!required) return null;
      throw new Error(`Verified encrypted ${sourceLabel} recovery backup is missing`);
    }
    if (matches.length !== 1) throw new Error(`Verified encrypted ${sourceLabel} recovery backup is ambiguous`);
    const backup = matches[0];
    const identity = assertRecordedIdentity(backup.identity, `Encrypted recovery backup ${sourceLabel}`);
    if (identity.sha256 !== backup.encryptedSha256 || identity.size !== backup.size) {
      throw new Error(`Encrypted recovery backup changed: ${sourceLabel}`);
    }
    if (!CANONICAL_MANIFEST_HASH_PATTERN.test(String(backup.originalSha256 ?? ""))) {
      throw new Error(`Encrypted recovery backup has an invalid original hash: ${sourceLabel}`);
    }
    if (!backup.originalMetadata || !Number.isInteger(backup.originalMetadata.mode)) {
      throw new Error(`Encrypted recovery backup has no original metadata: ${sourceLabel}`);
    }
    return backup;
  }

  function removeSqliteRecoverySidecars(databasePath) {
    let removed = false;
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const sidecar = `${databasePath}${suffix}`;
      if (!existsSync(sidecar)) continue;
      regularFile(sidecar, `Relay SQLite recovery sidecar ${suffix}`);
      rmSync(sidecar);
      removed = true;
    }
    if (removed) syncDirectory(path.dirname(databasePath));
  }

  function decryptedRecoveryStage(state, backup, destination, label, { sqlite = false } = {}) {
    const temporary = cutoverTemporaryPath(destination, state, `abort-${label}`);
    if (existsSync(temporary)) {
      regularFile(temporary, `${label} recovery stage`);
      if (sha256File(temporary) !== backup.originalSha256) {
        rmSync(temporary);
        syncDirectory(path.dirname(temporary));
      }
    }
    if (!existsSync(temporary)) {
      requireCommand(
        run,
        process.execPath,
        [paths.backupCryptoHelper, "decrypt", backup.path, temporary, paths.backupEncryptionKeyFile],
        `Decrypt ${label} recovery backup`,
      );
      syncDirectory(path.dirname(temporary));
    }
    regularFile(temporary, `${label} recovery stage`);
    syncFile(temporary);
    if (sha256File(temporary) !== backup.originalSha256) {
      throw new Error(`${label} recovery plaintext hash mismatch`);
    }
    if (sqlite) sqliteIntegrity(temporary);
    applyMetadata(temporary, backup.originalMetadata);
    syncFile(temporary);
    return temporary;
  }

  function privacyRecoveryKeys(state) {
    const discovered = state.preflight?.discoveredPaths ?? {};
    const keyPaths = [
      discovered.targetKeyPath,
      ...(discovered.targetPreviousKeyPaths ?? []),
    ].filter(Boolean);
    return [...new Set(keyPaths)].map((keyPath) => {
      regularFile(keyPath, "Privacy recovery key");
      const key = readFileSync(keyPath, "utf8").trim();
      if (!/^[A-Za-z0-9_-]{43}$/.test(key) || Buffer.from(key, "base64url").length !== 32) {
        throw new Error("Privacy recovery key is invalid");
      }
      return key;
    });
  }

  function recoveredFileMatches(filePath, backup) {
    if (!existsSync(filePath)) return false;
    const identity = fileIdentity(filePath);
    return identity.sha256 === backup.originalSha256
      && identity.mode === backup.originalMetadata.mode
      && (process.platform === "win32"
        || (identity.uid === backup.originalMetadata.uid && identity.gid === backup.originalMetadata.gid));
  }

  function safeBrandingDirectoryEntries(directory, label) {
    const stat = regularDirectory(directory, label);
    const files = readdirSync(directory, { withFileTypes: true }).map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${label} contains an unsafe entry: ${entry.name}`);
      const filePath = path.join(directory, entry.name);
      regularFile(filePath, `${label} file`);
      return filePath;
    });
    return { stat, files };
  }

  function recoveredBrandingMatches(recovery, backups) {
    if (!recovery.brandingExisted) return !existsSync(recovery.brandingDirectory);
    if (!existsSync(recovery.brandingDirectory)) return false;
    const { stat, files } = safeBrandingDirectoryEntries(recovery.brandingDirectory, "Recovered Relay branding directory");
    const expected = new Map(recovery.brandingFiles.map((file) => [file.fileName, backups.get(file.backupLabel)]));
    if (files.length !== expected.size) return false;
    if (Number(stat.mode & 0o777n) !== recovery.brandingMetadata.mode
      || (process.platform !== "win32"
        && (Number(stat.uid) !== recovery.brandingMetadata.uid || Number(stat.gid) !== recovery.brandingMetadata.gid))) return false;
    return files.every((filePath) => {
      const backup = expected.get(path.basename(filePath));
      return backup && recoveredFileMatches(filePath, backup);
    });
  }

  function stagePreCutoverBranding(state, recovery, brandingBackups) {
    const directory = recovery.brandingDirectory;
    const stage = `${directory}.pre-cutover-recovery-${state.revision.slice(0, 12)}`;
    if (!recovery.brandingExisted || recoveredBrandingMatches(recovery, brandingBackups)) return null;
    if (existsSync(stage)) {
      safeBrandingDirectoryEntries(stage, "Stale Relay branding recovery stage");
      rmSync(stage, { recursive: true });
    }
    mkdirSync(stage, { mode: 0o700 });
    try {
      for (const file of recovery.brandingFiles) {
        const backup = brandingBackups.get(file.backupLabel);
        const stagedFile = decryptedRecoveryStage(state, backup, path.join(stage, file.fileName), `relay-branding-${file.fileName}`);
        renameSync(stagedFile, path.join(stage, file.fileName));
      }
      applyMetadata(stage, recovery.brandingMetadata);
      syncDirectory(stage);
      const stagedRecovery = { ...recovery, brandingDirectory: stage };
      if (!recoveredBrandingMatches(stagedRecovery, brandingBackups)) {
        throw new Error("Staged Relay branding does not match its verified encrypted backups");
      }
      return stage;
    } catch (error) {
      if (existsSync(stage)) {
        safeBrandingDirectoryEntries(stage, "Failed Relay branding recovery stage");
        rmSync(stage, { recursive: true });
      }
      throw error;
    }
  }

  function validateBrandingRecoveryDestination(state, recovery) {
    if (existsSync(recovery.brandingDirectory)) {
      safeBrandingDirectoryEntries(recovery.brandingDirectory, "Relay branding directory selected for recovery");
    }
    const displaced = `${recovery.brandingDirectory}.cutover-displaced-${state.revision.slice(0, 12)}`;
    if (existsSync(displaced)) safeBrandingDirectoryEntries(displaced, "Displaced Relay branding directory");
  }

  function restorePreCutoverBranding(state, recovery, brandingBackups, stage) {
    const directory = recovery.brandingDirectory;
    const expectedStage = `${directory}.pre-cutover-recovery-${state.revision.slice(0, 12)}`;
    const displaced = `${directory}.cutover-displaced-${state.revision.slice(0, 12)}`;
    if (recoveredBrandingMatches(recovery, brandingBackups)) {
      if (existsSync(expectedStage)) {
        safeBrandingDirectoryEntries(expectedStage, "Stale Relay branding recovery stage");
        rmSync(expectedStage, { recursive: true });
      }
      if (existsSync(displaced)) {
        safeBrandingDirectoryEntries(displaced, "Displaced Relay branding directory");
        rmSync(displaced, { recursive: true });
      }
      return;
    }
    if (!recovery.brandingExisted) {
      if (existsSync(directory)) {
        safeBrandingDirectoryEntries(directory, "Relay branding directory created during cutover");
        rmSync(directory, { recursive: true });
      }
      if (existsSync(displaced)) {
        safeBrandingDirectoryEntries(displaced, "Displaced Relay branding directory");
        rmSync(displaced, { recursive: true });
      }
      syncDirectory(path.dirname(directory));
      return;
    }
    if (stage !== expectedStage || !existsSync(stage)) throw new Error("Verified Relay branding recovery stage is unavailable");
    try {
      if (existsSync(directory)) {
        safeBrandingDirectoryEntries(directory, "Relay branding directory selected for recovery");
        if (existsSync(displaced)) {
          safeBrandingDirectoryEntries(displaced, "Displaced Relay branding directory");
          rmSync(directory, { recursive: true });
        } else {
          renameSync(directory, displaced);
        }
      }
      renameSync(stage, directory);
      syncDirectory(path.dirname(directory));
      if (!recoveredBrandingMatches(recovery, brandingBackups)) {
        throw new Error("Restored Relay branding does not match its verified encrypted backups");
      }
      if (existsSync(displaced)) {
        safeBrandingDirectoryEntries(displaced, "Displaced Relay branding directory");
        rmSync(displaced, { recursive: true });
        syncDirectory(path.dirname(directory));
      }
    } catch (error) {
      if (existsSync(expectedStage)) {
        safeBrandingDirectoryEntries(expectedStage, "Failed Relay branding recovery stage");
        rmSync(expectedStage, { recursive: true });
      }
      throw error;
    }
  }

  async function restorePreCutoverRelayData(state) {
    if (!state.applyStartedAt && !["applying", "abort-failed"].includes(state.status)) return;
    audit("restore-pre-cutover-relay-data");
    const recovery = state.preCutoverRelayData;
    const discovered = state.preflight?.discoveredPaths ?? {};
    if (recovery?.formatVersion !== 2
      || recovery.databasePath !== paths.targetDatabasePath
      || recovery.ledgerPath !== discovered.targetLedgerPath
      || typeof recovery.ledgerExisted !== "boolean"
      || recovery.brandingDirectory !== paths.targetBrandingDirectory
      || typeof recovery.brandingExisted !== "boolean"
      || !Array.isArray(recovery.brandingFiles)
      || (recovery.brandingExisted && !recovery.brandingMetadata)) {
      throw new Error("Pre-cutover Relay data recovery record is invalid");
    }

    const databaseBackup = verifiedRecoveryBackup(state, "relay-db");
    const ledgerBackup = verifiedRecoveryBackup(state, "relay-ledger", { required: recovery.ledgerExisted });
    if (!recovery.ledgerExisted && ledgerBackup) {
      throw new Error("Pre-cutover Relay ledger recovery record conflicts with its encrypted backup");
    }
    const brandingBackups = new Map(recovery.brandingFiles.map((file) => {
      if (!file || path.basename(String(file.fileName ?? "")) !== file.fileName
        || !/^relay-branding-\d+$/.test(String(file.backupLabel ?? ""))) {
        throw new Error("Pre-cutover Relay branding recovery record is invalid");
      }
      return [file.backupLabel, verifiedRecoveryBackup(state, file.backupLabel)];
    }));
    validateBrandingRecoveryDestination(state, recovery);

    const databaseAlreadyRestored = recoveredFileMatches(recovery.databasePath, databaseBackup);
    const ledgerAlreadyRestored = recovery.ledgerExisted
      ? recoveredFileMatches(recovery.ledgerPath, ledgerBackup)
      : !existsSync(recovery.ledgerPath);
    const databaseStage = databaseAlreadyRestored
      ? null
      : decryptedRecoveryStage(state, databaseBackup, recovery.databasePath, "relay-database", { sqlite: true });
    const ledgerStage = recovery.ledgerExisted && !ledgerAlreadyRestored
      ? decryptedRecoveryStage(state, ledgerBackup, recovery.ledgerPath, "relay-ledger")
      : null;

    if (ledgerStage) {
      parseDeletionLedgerContent(
        readFileSync(ledgerStage, "utf8"),
        privacyRecoveryKeys(state),
        "Staged pre-cutover Relay privacy ledger",
      );
    }

    // All encrypted members are authenticated and staged before any live recovery target is replaced.
    const brandingStage = stagePreCutoverBranding(state, recovery, brandingBackups);

    removeSqliteRecoverySidecars(recovery.databasePath);
    if (databaseStage) {
      if (existsSync(recovery.databasePath)) regularFile(recovery.databasePath, "Relay database selected for recovery");
      renameSync(databaseStage, recovery.databasePath);
      syncDirectory(path.dirname(recovery.databasePath));
    }
    if (ledgerStage) {
      if (existsSync(recovery.ledgerPath)) regularFile(recovery.ledgerPath, "Relay privacy ledger selected for recovery");
      renameSync(ledgerStage, recovery.ledgerPath);
      syncDirectory(path.dirname(recovery.ledgerPath));
    } else if (!recovery.ledgerExisted && existsSync(recovery.ledgerPath)) {
      regularFile(recovery.ledgerPath, "Relay privacy ledger created during cutover");
      rmSync(recovery.ledgerPath);
      syncDirectory(path.dirname(recovery.ledgerPath));
    }
    restorePreCutoverBranding(state, recovery, brandingBackups, brandingStage);

    removeSqliteRecoverySidecars(recovery.databasePath);
    if (!recoveredFileMatches(recovery.databasePath, databaseBackup)) {
      throw new Error("Restored Relay database does not match its verified encrypted backup");
    }
    sqliteIntegrity(recovery.databasePath);
    if (recovery.ledgerExisted) {
      if (!recoveredFileMatches(recovery.ledgerPath, ledgerBackup)) {
        throw new Error("Restored Relay privacy ledger does not match its verified encrypted backup");
      }
      parseDeletionLedgerContent(
        readFileSync(recovery.ledgerPath, "utf8"),
        privacyRecoveryKeys(state),
        "Restored pre-cutover Relay privacy ledger",
      );
    } else if (existsSync(recovery.ledgerPath)) {
      throw new Error("Relay privacy ledger created during cutover was not removed");
    }
  }

  async function removeCreatedReadiness(state) {
    removeRecordedOrIntendedFile(
      state.preApply?.readiness,
      state.preApply?.readinessIntent,
      "Privacy readiness artifact",
    );
  }

  async function removeCreatedPreviousKey(state) {
    removeRecordedOrIntendedFile(
      state.preApply?.previousKey,
      state.preApply?.previousKeyIntent,
      "Installed previous privacy key",
    );
  }

  async function createAndVerifyEncryptedBackups(state) {
    regularDirectory(paths.relayBackupRoot, "Relay backup root");
    regularFile(paths.backupEncryptionKeyFile, "Backup encryption key");
    regularFile(paths.backupCryptoHelper, "Backup crypto helper");
    const stageDirectory = path.join(paths.stateDirectory, "backup-stage");
    mkdirSync(stageDirectory, { recursive: true, mode: 0o700 });
    chmodSync(stageDirectory, 0o700);
    const discovered = state.preflight?.discoveredPaths ?? {};
    if (!discovered.targetLedgerPath) throw new Error("Relay privacy ledger path was not discovered before backup");
    const relayBranding = brandingDirectorySnapshot(paths.targetBrandingDirectory, "Relay");
    state.preCutoverRelayData = {
      formatVersion: 2,
      databasePath: paths.targetDatabasePath,
      ledgerPath: discovered.targetLedgerPath,
      ledgerExisted: existsSync(discovered.targetLedgerPath),
      brandingDirectory: paths.targetBrandingDirectory,
      brandingExisted: relayBranding.existed,
      brandingMetadata: relayBranding.metadata,
      brandingFiles: relayBranding.files.map((filePath, index) => ({
        fileName: path.basename(filePath),
        backupLabel: `relay-branding-${index + 1}`,
      })),
    };
    const artifacts = [
      { label: "old-db", source: paths.sourceDatabasePath, sqlite: true },
      { label: "relay-db", source: paths.targetDatabasePath, sqlite: true },
      { label: "old-environment", source: paths.sourceEnvironmentFile },
      { label: "relay-environment", source: paths.relayEnvironmentFile },
      { label: "caddy", source: state.maintenance?.savedPath ?? paths.liveCaddyFile },
      ...referencedBrandingFiles(paths.sourceDatabasePath, paths.sourceBrandingDirectory, "Old").map((source, index) => ({ label: `old-branding-${index + 1}`, source })),
      ...relayBranding.files.map((source, index) => ({ label: `relay-branding-${index + 1}`, source })),
      { label: "old-ledger", source: discovered.sourceLedgerPath, optional: true },
      { label: "relay-ledger", source: discovered.targetLedgerPath, optional: true },
      { label: "old-privacy-key", source: discovered.sourceKeyPath },
      { label: "relay-privacy-key", source: discovered.targetKeyPath },
      ...(discovered.targetPreviousKeyPaths ?? []).map((source, index) => ({
        label: `relay-previous-privacy-key-${index + 1}`,
        source,
      })),
    ].filter((artifact) => artifact.source && (!artifact.optional || existsSync(artifact.source)));
    const timestamp = timestampForFile(now);
    const results = [];
    state.backups = results;
    for (let index = 0; index < artifacts.length; index += 1) {
      const artifact = artifacts[index];
      regularFile(artifact.source, `Backup source ${artifact.label}`);
      const plaintext = path.join(stageDirectory, `${String(index + 1).padStart(2, "0")}-${artifact.label}.plain`);
      const validation = path.join(stageDirectory, `${String(index + 1).padStart(2, "0")}-${artifact.label}.validation`);
      const identifier = `cutover-migration-${state.revision.slice(0, 12)}-${timestamp}-${String(index + 1).padStart(2, "0")}-${artifact.label}`;
      const encrypted = path.join(paths.relayBackupRoot, `${identifier}.enc`);
      if (existsSync(encrypted)) throw new Error(`Encrypted cutover backup already exists: ${identifier}`);
      try {
        if (artifact.sqlite) {
          requireCommand(run, paths.sqliteBinary, [artifact.source, "PRAGMA wal_checkpoint(TRUNCATE);"], `Checkpoint ${artifact.label}`);
          const quoted = `'${plaintext.replaceAll("'", "''")}'`;
          requireCommand(run, paths.sqliteBinary, [artifact.source, `.backup ${quoted}`], `SQLite backup ${artifact.label}`);
        } else {
          copyFileSync(artifact.source, plaintext);
        }
        const sourceIdentity = fileIdentity(artifact.source);
        chmodSync(plaintext, 0o600);
        const originalSha256 = sha256File(plaintext);
        requireCommand(run, process.execPath, [paths.backupCryptoHelper, "encrypt", plaintext, encrypted, paths.backupEncryptionKeyFile], `Encrypt ${artifact.label}`);
        requireCommand(run, process.execPath, [paths.backupCryptoHelper, "decrypt", encrypted, validation, paths.backupEncryptionKeyFile], `Decrypt-verify ${artifact.label}`);
        if (sha256File(validation) !== originalSha256) throw new Error(`Decrypted backup hash mismatch for ${artifact.label}`);
        if (artifact.sqlite) {
          const integrity = requireCommand(run, paths.sqliteBinary, [validation, "PRAGMA integrity_check;"], `Validate SQLite ${artifact.label}`).trim();
          if (integrity !== "ok") throw new Error(`Encrypted SQLite backup failed integrity validation for ${artifact.label}`);
        }
        results.push({
          identifier,
          path: encrypted,
          sourceLabel: artifact.label,
          originalSha256,
          encryptedSha256: sha256File(encrypted),
          size: statSync(encrypted).size,
          identity: fileIdentity(encrypted),
          originalMetadata: {
            mode: sourceIdentity.mode,
            uid: sourceIdentity.uid,
            gid: sourceIdentity.gid,
          },
        });
      } catch (error) {
        if (existsSync(encrypted)) rmSync(encrypted);
        throw error;
      } finally {
        if (existsSync(plaintext)) rmSync(plaintext);
        if (existsSync(validation)) rmSync(validation);
      }
    }
    syncDirectory(stageDirectory);
    syncDirectory(paths.relayBackupRoot);
    return results;
  }

  async function createRepairManifest(state) {
    audit("create-repair-manifest", { revision: state.revision });
    const manifestPath = path.join(paths.stateDirectory, `contribution-repair-${currentOperationStem(state)}.json`);
    const db = new DatabaseSync(paths.targetDatabasePath, { readOnly: true });
    let manifest;
    try {
      manifest = createContributionProfessionManifest(db, CANONICAL_CLAIM_ID);
    } finally {
      db.close();
    }
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    writeBytesExclusive(manifestPath, bytes, { mode: 0o600, uid: 0, gid: 0 });
    const selectedIds = {
      aggregates: manifest.selection.aggregates.map((row) => String(row.id)),
      events: manifest.selection.events.map((row) => String(row.id)),
    };
    return {
      manifest,
      manifestPath,
      manifestSha256: sha256(canonicalJson(manifest)),
      identity: fileIdentity(manifestPath),
      selectionHash: manifest.selectionHash,
      selectedCount: selectedIds.aggregates.length + selectedIds.events.length,
      selectedIds,
      counts: manifest.counts,
    };
  }

  async function createMigrationManifest(state) {
    audit("create-migration-manifest", { revision: state.revision });
    const manifestPath = path.join(paths.stateDirectory, `canonical-migration-${currentOperationStem(state)}.json`);
    const input = migrationInputFromState(paths, {
      ...state,
      migration: { manifestPath },
    });
    delete input.privacyPlan;
    const manifest = createCanonicalCutoverManifest(input, { now });
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    writeBytesExclusive(manifestPath, bytes, { mode: 0o600, uid: 0, gid: 0 });
    const tableCounts = Object.values(manifest.tableCounts);
    return {
      manifest,
      manifestPath,
      manifestSha256: sha256(canonicalJson(manifest)),
      identity: fileIdentity(manifestPath),
      selectionHash: manifest.selectionHash,
      counts: {
        selected: tableCounts.reduce((total, entry) => total + Number(entry.selected ?? 0), 0),
        excludedRows: tableCounts.filter((entry) => entry.excluded).reduce((total, entry) => total + Number(entry.target ?? 0), 0),
        excludedTables: tableCounts.filter((entry) => entry.excluded).length,
      },
      privacy: { plan: manifest.privacyDeletionLedger },
    };
  }

  async function armWatchdog(state) {
    audit("arm-watchdog", { revision: state.revision, manifestHash: state.manifestHash });
    const unit = `bitcraft-claim-monitor-relay-cutover-abort-${state.revision.slice(0, 12)}-${state.manifestHash.slice(0, 12)}`;
    const deadline = new Date(now().getTime() + 15 * 60 * 1000).toISOString();
    requireCommand(run, paths.systemdRunBinary, [
      `--unit=${unit}`,
      "--on-active=15m",
      "--property=Type=oneshot",
      "--property=TimeoutStartSec=infinity",
      "--setenv=BITCRAFT_CUTOVER_WATCHDOG=1",
      paths.updater,
      "--revision", state.revision,
      "--abort-cutover",
      "--manifest-hash", state.manifestHash,
    ], "Arm cutover abort watchdog");
    return { unit, deadline };
  }

  async function verifyPrepared(state) {
    audit("verify-prepared", { revision: state.revision, manifestHash: state.manifestHash });
    assertCurrentRelayRelease(paths, state.revision);
    if (Date.parse(state.watchdog?.deadline ?? "") <= now().getTime()) throw new Error("Cutover watchdog expired before apply");
    requireCommand(run, paths.systemctlBinary, ["is-active", "--quiet", `${state.watchdog.unit}.timer`], "Verify cutover watchdog timer");
    assertRecordedIdentity(state.maintenance?.installed, "Maintenance Caddy configuration");
    adaptAndValidateCaddy(run, paths, paths.liveCaddyFile, "maintenance");
    await assertWritersStopped();
    for (const backup of state.backups ?? []) {
      const current = assertRecordedIdentity(backup.identity, `Encrypted backup ${backup.identifier}`);
      if (current.sha256 !== backup.encryptedSha256) throw new Error(`Encrypted backup changed: ${backup.identifier}`);
    }
    const repairIdentity = assertRecordedIdentity(state.repair?.identity, "Contribution repair manifest");
    if (repairIdentity.sha256 !== state.repair.identity.sha256
      || sha256(canonicalJson(state.repair.manifest)) !== state.repair.manifestSha256) {
      throw new Error("Contribution repair manifest changed after prepare");
    }
    const currentRepairDb = new DatabaseSync(paths.targetDatabasePath, { readOnly: true });
    try {
      const currentRepair = createContributionProfessionManifest(currentRepairDb, CANONICAL_CLAIM_ID);
      if (canonicalJson(currentRepair) !== canonicalJson(state.repair.manifest)) throw new Error("Contribution repair selection changed after prepare");
    } finally {
      currentRepairDb.close();
    }
    assertRecordedIdentity(state.migration?.identity, "Canonical migration manifest");
    const loaded = readCanonicalCutoverManifest(state.migration.manifestPath);
    if (loaded.manifest.selectionHash !== state.manifestHash
      || sha256(canonicalJson(loaded.manifest)) !== state.migration.manifestSha256) {
      throw new Error("Canonical migration manifest changed after prepare");
    }
    verifyCanonicalCutoverPrivacyPlan(loaded.manifest.privacyDeletionLedger);
    const recomputed = createCanonicalCutoverManifest({
      ...migrationInputFromState(paths, state),
      contributionRepairManifest: state.repair.manifest,
      privacyPlan: loaded.manifest.privacyDeletionLedger,
    }, { allowExistingManifest: true, now });
    if (canonicalJson(recomputed) !== canonicalJson(loaded.manifest)) {
      throw new Error("Frozen canonical migration inputs changed after prepare");
    }
    if (canonicalJson(databaseOperationalTotals(paths.targetDatabasePath)) !== canonicalJson(state.preflight.operationalTotals)) {
      throw new Error("Relay contribution or market totals changed after prepare");
    }
    const environment = parseEnvironmentDocument(readFileSync(paths.relayEnvironmentFile));
    if (environment.BITCRAFT_DEPLOYMENT_MODE !== "preview"
      || environment.DISCORD_DELIVERY_MODE !== "record"
      || environment.ENABLE_DISCORD_STARTUP !== "false") {
      throw new Error("Relay left preview record-only mode before migration admission");
    }
    for (const destination of [paths.installedPreviousPrivacyKey, paths.privacyReadinessArtifact]) {
      if (existsSync(destination)) throw new Error("A manifest-bound privacy destination already exists; refusing overwrite");
    }
  }

  async function applyContributionRepair(state) {
    audit("apply-contribution-repair", { selectedCount: state.repair.selectedCount });
    const db = new DatabaseSync(paths.targetDatabasePath, { timeout: 5_000 });
    try {
      const current = createContributionProfessionManifest(db, CANONICAL_CLAIM_ID);
      if (canonicalJson(current) !== canonicalJson(state.repair.manifest)) {
        throw new Error("Contribution repair manifest no longer matches the Relay database");
      }
      return applyContributionProfessionRepair(db, state.repair.manifest);
    } finally {
      db.close();
    }
  }

  async function verifyContributionRepair(state) {
    audit("verify-contribution-repair", { selectedCount: state.repair.selectedCount });
    if (state.repair.selectedCount > 0) {
      if (state.repairApply?.selectionHash !== state.repair.selectionHash
        || canonicalJson(state.repairApply?.counts) !== canonicalJson(state.repair.counts)) {
        throw new Error("Contribution repair apply result did not match its frozen manifest");
      }
      requireCommand(run, paths.sqliteBinary, [paths.targetDatabasePath, "PRAGMA wal_checkpoint(TRUNCATE);"], "Checkpoint repaired Relay database");
    } else {
      const db = new DatabaseSync(paths.targetDatabasePath, { readOnly: true });
      try {
        const current = createContributionProfessionManifest(db, CANONICAL_CLAIM_ID);
        if (canonicalJson(current) !== canonicalJson(state.repair.manifest)) throw new Error("Frozen no-repair selection changed");
      } finally {
        db.close();
      }
    }
    sqliteIntegrity(paths.targetDatabasePath);
    if (canonicalJson(databaseOperationalTotals(paths.targetDatabasePath)) !== canonicalJson(state.preflight.operationalTotals)) {
      throw new Error("Contribution repair changed protected contribution or market totals");
    }
  }

  async function applyMigration(state) {
    audit("apply-migration", { revision: state.revision, manifestHash: state.manifestHash });
    const script = path.join(paths.releasesDirectory, state.revision, "scripts", "repair-relay-canonical-cutover.mjs");
    regularFile(script, "Canonical migration CLI");
    const output = requireCommand(run, process.execPath, [
      script,
      "--apply",
      "--manifest", state.migration.manifestPath,
      "--privacy-key-ready-artifact", state.preApply.readiness.path,
    ], "Apply canonical data and privacy migration");
    const result = parseJsonOutput(output, "Canonical migration apply");
    if (result.selectionHash !== state.manifestHash || result.integrity !== "ok") {
      throw new Error("Canonical migration apply result did not match the prepared manifest");
    }
    return result;
  }

  async function verifyMigratedData(state) {
    audit("verify-migrated-data", { revision: state.revision, manifestHash: state.manifestHash });
    const appliedVerification = verifyAppliedCanonicalCutoverManifest({
      manifest: state.migration.manifest,
      manifestPath: state.migration.manifestPath,
    });
    const integrity = sqliteIntegrity(paths.targetDatabasePath);
    const appliedMarker = `${state.migration.manifestPath}.applied`;
    regularFile(appliedMarker, "Canonical migration applied marker");
    if (appliedVerification.selectionHash !== state.manifestHash) throw new Error("Canonical migration applied marker does not match the frozen manifest");
    const operationalTotals = databaseOperationalTotals(paths.targetDatabasePath);
    if (canonicalJson(operationalTotals) !== canonicalJson(state.preflight.operationalTotals)) {
      throw new Error("Canonical migration changed protected contribution or market totals");
    }
    const privacy = assertNoDeletionResurrection(
      paths.targetDatabasePath,
      state.migration.manifest.privacyDeletionLedger,
      new Date(state.migration.manifest.privacyDeletionLedger.manifestCreatedAt),
    );
    const actualCounts = {};
    const db = new DatabaseSync(paths.targetDatabasePath, { readOnly: true });
    try {
      for (const [table, expected] of Object.entries(state.migration.manifest.tableCounts)) {
        const count = cutoverTableRowCount(db, table);
        actualCounts[table] = count;
        if (expected.excluded && !["production_contributions", "production_contribution_events"].includes(table)
          && count !== Number(expected.target)) {
          throw new Error(`Excluded table ${table} count changed during migration`);
        }
      }
    } finally {
      db.close();
    }
    const privacyLedgerRuntime = preparePrivacyLedgerForRuntime({
      databasePath: paths.targetDatabasePath,
      ledgerPath: paths.relayPrivacyLedger,
    });
    return { appliedVerification, integrity, operationalTotals, privacy, actualCounts, privacyLedgerRuntime, appliedMarker: fileIdentity(appliedMarker) };
  }

  async function seedReleaseAnnouncementMarker() {
    audit("seed-release-announcement-marker", { version: CANONICAL_VERSION });
    const db = new DatabaseSync(paths.targetDatabasePath, { timeout: 5_000 });
    try {
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_at) VALUES ('discord_last_announced_version', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(CANONICAL_VERSION, now().toISOString());
    } finally {
      db.close();
    }
  }

  async function captureOutboxState() {
    audit("capture-outbox-state");
    return outboxState(paths.targetDatabasePath);
  }

  async function startRelayServices() {
    audit("start-relay-services");
    for (const unit of RELAY_START_UNITS) {
      requireCommand(run, paths.systemctlBinary, ["enable", "--now", unit], `Enable and start ${unit}`);
    }
  }

  async function retryVerification(label, verify, { attempts = 20, intervalMs = 3_000 } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await verify();
      } catch (error) {
        lastError = error;
        if (attempt < attempts) await wait(intervalMs);
      }
    }
    throw new Error(`${label} did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async function verifyLocalCanonical(state) {
    audit("verify-local-canonical", { revision: state.revision });
    return retryVerification("Local canonical Relay", async () => {
      for (const unit of RELAY_START_UNITS) {
        if (systemctlValue(run, paths, unit, "ActiveState") !== "active") throw new Error(`${unit} is not active`);
      }
      for (const unit of SOURCE_UNITS) {
        if (systemctlValue(run, paths, unit, "ActiveState") === "active") throw new Error(`Old unit ${unit} restarted before admission`);
      }
      const health = healthJson(run, paths, "http://127.0.0.1:19430/api/local/health", "Validate local canonical health");
      assertCanonicalHealth(health, state.revision);
      const subscriptions = providerSubscriptionSummary(paths.targetDatabasePath);
      const prior = state.preflight.subscriptions.subscriptions;
      for (const [key, generation] of Object.entries(prior)) {
        if (!Object.hasOwn(subscriptions.subscriptions, key)
          || Number(subscriptions.subscriptions[key]) <= Number(generation)) {
          throw new Error(`Relay subscription generation did not advance for ${key}`);
        }
      }
      const relayPid = systemctlValue(run, paths, "bitcraft-claim-monitor-relay-worker.service", "MainPID");
      const oldPid = systemctlValue(run, paths, "bitcraft-claim-monitor-worker.service", "MainPID");
      const gateways = requireCommand(run, "pgrep", ["-a", "-f", "/apps/bitcraft-local/worker\\.mjs"], "Inspect admitted Relay gateway worker")
        .trim().split(/\r?\n/).filter(Boolean).map((line) => line.trim().split(/\s+/, 1)[0]);
      if (!/^\d+$/.test(relayPid) || relayPid === "0" || oldPid !== "0"
        || gateways.length !== 1 || gateways[0] !== relayPid) {
        throw new Error("Canonical runtime does not have exactly one Relay Discord gateway and zero old gateways");
      }
      const currentOutbox = outboxState(paths.targetDatabasePath);
      if (canonicalJson(currentOutbox) !== canonicalJson(state.outboxBeforeStart)) {
        throw new Error("Discord outbox pending/sent state changed during canonical startup");
      }
      return { health, subscriptions, gatewayPid: relayPid, outbox: currentOutbox };
    }, { attempts: LOCAL_CANONICAL_RETRY_ATTEMPTS });
  }

  async function verifyMaintenanceCanary(state) {
    audit("verify-maintenance-canary", { revision: state.revision });
    const resolve = ["--resolve", "app.timbersteeltrade.com:443:127.0.0.1"];
    const health = healthJson(
      run,
      paths,
      "https://app.timbersteeltrade.com/api/local/health",
      "Validate canonical HTTPS maintenance canary",
      resolve,
    );
    assertCanonicalHealth(health, state.revision);
    for (const resource of ["/", "/sounds/notifications/ui-pop.mp3"]) {
      requireCommand(run, paths.curlBinary, [
        "--fail", "--silent", "--show-error", "--max-time", "20",
        ...resolve,
        "--output", "/dev/null",
        `https://app.timbersteeltrade.com${resource}`,
      ], `Validate maintenance canary resource ${resource}`);
    }
    return { health: true, pages: 2 };
  }

  async function validateFinalCaddyForAdmission(state) {
    audit("validate-final-caddy-for-admission", { revision: state.revision, manifestHash: state.manifestHash });
    assertRecordedIdentity(state.maintenance?.installed, "Maintenance Caddy configuration");
    adaptAndValidateCaddy(run, paths, paths.liveCaddyFile, "maintenance");
    adaptAndValidateCaddy(run, paths, paths.finalCaddyCandidate, "final");
    return {
      maintenance: fileIdentity(paths.liveCaddyFile),
      candidate: fileIdentity(paths.finalCaddyCandidate),
    };
  }

  async function installFinalCaddy(state) {
    audit("install-final-caddy", { revision: state.revision, manifestHash: state.manifestHash });
    const candidate = assertRecordedIdentity(state.finalCaddyValidation?.candidate, "Admission-validated final Caddy candidate");
    const current = fileIdentity(paths.liveCaddyFile);
    if (current.sha256 !== candidate.sha256) {
      assertRecordedIdentity(state.finalCaddyValidation?.maintenance, "Admission-validated maintenance Caddy configuration");
      writeBytesAtomic(paths.liveCaddyFile, readFileSync(paths.finalCaddyCandidate), {
        mode: current.mode,
        uid: current.uid,
        gid: current.gid,
      });
    }
    requireCommand(run, paths.caddyBinary, ["reload", "--config", paths.liveCaddyFile], "Reload final canonical Caddy configuration");
    adaptAndValidateCaddy(run, paths, paths.liveCaddyFile, "final");
    return fileIdentity(paths.liveCaddyFile);
  }

  async function verifyPublicCanonical(state) {
    audit("verify-public-canonical", { revision: state.revision });
    const health = healthJson(run, paths, `${paths.sourcePublicOrigin}/api/local/health`, "Validate public canonical health");
    assertCanonicalHealth(health, state.revision);
    for (const resource of ["/", "/sounds/notifications/ui-pop.mp3"]) {
      requireCommand(run, paths.curlBinary, [
        "--fail", "--silent", "--show-error", "--max-time", "20",
        "--output", "/dev/null", `${paths.sourcePublicOrigin}${resource}`,
      ], `Validate public canonical resource ${resource}`);
    }
    const headers = requireCommand(run, paths.curlBinary, [
      "--fail", "--silent", "--show-error", "--max-time", "20", "--head", `${paths.sourcePublicOrigin}/`,
    ], "Validate canonical TLS and security headers").toLowerCase();
    for (const expected of [
      "x-content-type-options: nosniff",
      "referrer-policy: strict-origin-when-cross-origin",
      "permissions-policy:",
      "x-frame-options: sameorigin",
    ]) if (!headers.includes(expected)) throw new Error(`Canonical public response is missing security header ${expected}`);
    const redirect = requireCommand(run, paths.curlBinary, [
      "--silent", "--show-error", "--max-time", "20", "--head", "--output", "/dev/null",
      "--write-out", "%{http_code}\n%{redirect_url}",
      `${paths.relayPublicOrigin}/cutover-path?probe=1`,
    ], "Validate Relay canonical redirect").trim().split(/\r?\n/);
    if (redirect[0] !== "301" || redirect[1] !== `${paths.sourcePublicOrigin}/cutover-path?probe=1`) {
      throw new Error("Relay redirect does not preserve canonical path and query");
    }
    const subscriptions = providerSubscriptionSummary(paths.targetDatabasePath);
    for (const [key, generation] of Object.entries(state.preflight.subscriptions.subscriptions)) {
      if (Number(subscriptions.subscriptions[key] ?? 0) <= Number(generation)) {
        throw new Error(`Public canonical generation did not advance for ${key}`);
      }
    }
    return { health: true, pages: 2, redirect: true, securityHeaders: true, subscriptions };
  }

  function relocatedUnitMatches(archivePath, captured) {
    const archived = fileIdentity(archivePath);
    return ["dev", "ino", "nlink", "mode", "uid", "gid", "size", "sha256"]
      .every((key) => String(archived[key]) === String(captured[key]));
  }

  function archiveOldUnit(state, unit) {
    const captured = state.serviceCapture?.units?.[unit];
    if (!captured?.fragmentIdentity || captured.fragmentPath !== captured.fragmentIdentity.path
      || path.basename(captured.fragmentPath) !== unit) {
      throw new Error(`Captured local unit identity is missing for ${unit}`);
    }
    const archivePath = `${captured.fragmentPath}.canonical-cutover-${state.revision.slice(0, 12)}.retained`;
    if (existsSync(archivePath)) {
      if (!relocatedUnitMatches(archivePath, captured.fragmentIdentity)) {
        throw new Error(`Archived old unit identity changed for ${unit}`);
      }
    } else {
      if (!existsSync(captured.fragmentPath)) throw new Error(`Old unit file and its archive are both missing for ${unit}`);
      const current = lstatSync(captured.fragmentPath);
      if (current.isSymbolicLink()) {
        if (readlinkSync(captured.fragmentPath) !== "/dev/null") throw new Error(`Old unit ${unit} has an unsafe mask link`);
        throw new Error(`Old unit archive is missing for already-masked unit ${unit}`);
      }
      if (!relocatedUnitMatches(captured.fragmentPath, captured.fragmentIdentity)) {
        throw new Error(`Old unit identity changed before archival for ${unit}`);
      }
      renameSync(captured.fragmentPath, archivePath);
      syncDirectory(path.dirname(captured.fragmentPath));
    }
    if (existsSync(captured.fragmentPath)) {
      const current = lstatSync(captured.fragmentPath);
      if (!current.isSymbolicLink() || readlinkSync(captured.fragmentPath) !== "/dev/null") {
        throw new Error(`Old unit path is occupied after archival for ${unit}`);
      }
    }
    return {
      unit,
      originalPath: captured.fragmentPath,
      archivePath,
      identity: fileIdentity(archivePath),
      retainedUntil: new Date(now().getTime() + (14 * 24 * 60 * 60 * 1000)).toISOString(),
    };
  }

  async function maskOldUnits(state) {
    audit("mask-old-units");
    const archivedUnits = [];
    for (const unit of SOURCE_UNITS) {
      requireCommand(run, paths.systemctlBinary, ["disable", "--now", unit], `Disable old unit ${unit}`);
      archivedUnits.push(archiveOldUnit(state, unit));
      requireCommand(run, paths.systemctlBinary, ["mask", "--force", unit], `Persistently mask old unit ${unit}`);
      if (systemctlValue(run, paths, unit, "ActiveState") !== "inactive"
        || systemctlValue(run, paths, unit, "UnitFileState") !== "masked") {
        throw new Error(`Old unit ${unit} was not stopped, disabled, and masked`);
      }
    }
    return { units: [...SOURCE_UNITS], maskScope: "persistent", archivedUnits };
  }

  async function cancelWatchdog(state) {
    if (!state.watchdog?.unit) return;
    audit("cancel-watchdog", { unit: state.watchdog.unit });
    const result = run(paths.systemctlBinary, ["stop", `${state.watchdog.unit}.timer`, `${state.watchdog.unit}.service`]);
    if (result?.error || ![0, 5].includes(Number(result?.status))) throw new Error("Cancel cutover watchdog failed");
  }

  async function recordForensicRetention(state) {
    audit("record-forensic-retention", { revision: state.revision });
    for (const backup of state.backups ?? []) assertRecordedIdentity(backup.identity, `Forensic backup ${backup.identifier}`);
    for (const archived of state.oldUnitsMasked?.archivedUnits ?? []) {
      assertRecordedIdentity(archived.identity, `Archived old unit ${archived.unit}`);
      if (new Date(archived.retainedUntil).getTime() < now().getTime()) {
        throw new Error(`Archived old unit retention expired prematurely for ${archived.unit}`);
      }
    }
    const currentIdentifiers = new Set((state.backups ?? []).map((backup) => backup.identifier));
    const recoverySets = new Map();
    regularDirectory(paths.relayBackupRoot, "Relay backup root");
    for (const entry of readdirSync(paths.relayBackupRoot, { withFileTypes: true })) {
      const match = /^cutover-migration-([a-f0-9]{12})-(\d{8}T\d{6}Z)-(\d{2})-([a-z0-9][a-z0-9-]*)\.enc$/.exec(entry.name);
      if (!match) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Cutover migration retention encountered an unsafe matching entry");
      const backupPath = path.join(paths.relayBackupRoot, entry.name);
      regularFile(backupPath, "Cutover migration backup");
      const compact = match[2];
      const timestamp = new Date(`${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}Z`);
      if (Number.isNaN(timestamp.getTime())) throw new Error("Cutover migration backup timestamp is invalid");
      const setKey = `${match[1]}-${match[2]}`;
      const set = recoverySets.get(setKey) ?? { timestamp, entries: [], labels: new Set() };
      set.entries.push({ identifier: entry.name.slice(0, -4), path: backupPath });
      set.labels.add(match[4]);
      recoverySets.set(setKey, set);
    }
    const orderedSets = [...recoverySets.values()]
      .filter((recoverySet) => CUTOVER_RECOVERY_REQUIRED_LABELS.every((label) => recoverySet.labels.has(label)))
      .sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());
    const nowMs = now().getTime();
    const forensicMilliseconds = 14 * 24 * 60 * 60 * 1000;
    const maximumAgeMilliseconds = 90 * 24 * 60 * 60 * 1000;
    const prunedBackupIdentifiers = [];
    for (const [index, recoverySet] of orderedSets.entries()) {
      const age = nowMs - recoverySet.timestamp.getTime();
      const isCurrent = recoverySet.entries.some((entry) => currentIdentifiers.has(entry.identifier));
      const isForensic = age >= 0 && age < forensicMilliseconds;
      const mustPrune = age > maximumAgeMilliseconds || index >= 3;
      if (!mustPrune || isCurrent || isForensic || age < 0) continue;
      for (const entry of recoverySet.entries) {
        regularFile(entry.path, "Cutover migration backup selected for retention pruning");
        rmSync(entry.path);
        prunedBackupIdentifiers.push(entry.identifier);
      }
    }
    if (prunedBackupIdentifiers.length) syncDirectory(paths.relayBackupRoot);
    return {
      deadline: new Date(now().getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      policy: { class: "migration", maximumAgeDays: 90, recoveryPoints: 3 },
      backupIdentifiers: (state.backups ?? []).map((backup) => backup.identifier),
      prunedBackupIdentifiers,
    };
  }

  async function verifyIntensiveSoak(state) {
    audit("verify-intensive-soak", { revision: state.revision });
    const summary = await soakVerifier({
      profile: "intensive",
      revision: state.revision,
      version: CANONICAL_VERSION,
      expectedSubscriptionKeys: Object.keys(state.preflight?.subscriptions?.subscriptions ?? {}).sort(),
      fetchImpl: soakFetch,
      sampleOperations: createSystemOperationalSampler({
        databasePath: paths.targetDatabasePath,
        run: (command, arguments_) => run(command === "systemctl" ? paths.systemctlBinary : command, arguments_),
      }),
    });
    if (summary?.outboxValidated !== true || !summary.outboxBaseline || !summary.outboxFinal) {
      throw new Error("Discord outbox did not produce a validated intensive-soak baseline");
    }
    return summary;
  }

  async function enqueueCutoverAnnouncement(state) {
    audit("enqueue-cutover-announcement", { revision: state.revision });
    return enqueueCanonicalCutoverAnnouncement({
      databasePath: paths.targetDatabasePath,
      revision: state.revision,
      state,
      now,
    });
  }

  async function restoreCaddy(state) {
    if (!state.maintenance?.savedPath) return;
    audit("restore-caddy");
    const saved = assertRecordedIdentity(state.maintenance.saved, "Saved pre-cutover Caddy configuration");
    const current = fileIdentity(paths.liveCaddyFile);
    if (current.sha256 === state.maintenance.originalSha256) return;
    assertRecordedIdentity(state.maintenance.installed, "Installed maintenance Caddy configuration");
    adaptAndValidateCaddy(run, paths, state.maintenance.savedPath, "preflight");
    writeBytesAtomic(paths.liveCaddyFile, readFileSync(state.maintenance.savedPath), state.maintenance.originalMetadata);
    if (fileIdentity(paths.liveCaddyFile).sha256 !== saved.sha256) throw new Error("Restored Caddy hash does not match saved configuration");
  }

  async function restoreServiceStates(state) {
    if (!state.serviceCapture?.units) return;
    audit("restore-service-states");
    for (const snapshot of Object.values(state.serviceCapture.units)) {
      const enabled = ["enabled", "enabled-runtime", "linked", "linked-runtime", "alias"].includes(snapshot.unitFileState);
      const disabled = ["disabled", "masked", "masked-runtime"].includes(snapshot.unitFileState);
      if (enabled) requireCommand(run, paths.systemctlBinary, ["enable", snapshot.unit], `Restore enabled state for ${snapshot.unit}`);
      else if (disabled) requireCommand(run, paths.systemctlBinary, ["disable", snapshot.unit], `Restore disabled state for ${snapshot.unit}`);
      if (snapshot.activeState === "active") requireCommand(run, paths.systemctlBinary, ["start", snapshot.unit], `Restore active state for ${snapshot.unit}`);
      else requireCommand(run, paths.systemctlBinary, ["stop", snapshot.unit], `Restore inactive state for ${snapshot.unit}`);
    }
  }

  async function validateAndReloadRestoredCaddy() {
    audit("validate-reload-restored-caddy");
    adaptAndValidateCaddy(run, paths, paths.liveCaddyFile, "preflight");
    requireCommand(run, paths.caddyBinary, ["reload", "--config", paths.liveCaddyFile], "Reload restored pre-cutover Caddy configuration");
  }

  async function verifyOldPublicHealth() {
    audit("verify-old-public-health");
    const health = healthJson(run, paths, `${paths.sourcePublicOrigin}/api/local/health`, "Validate restored old public health");
    if (health.ok !== true) throw new Error("Restored old public application is unhealthy");
  }

  async function cleanupPlaintext() {
    audit("cleanup-cutover-plaintext");
    const stageDirectory = path.join(paths.stateDirectory, "backup-stage");
    if (!existsSync(stageDirectory)) return;
    regularDirectory(stageDirectory, "Cutover plaintext stage directory");
    for (const entry of readdirSync(stageDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Cutover plaintext stage contains an unsafe entry");
      regularFile(path.join(stageDirectory, entry.name), "Cutover plaintext stage entry");
      rmSync(path.join(stageDirectory, entry.name));
    }
    syncDirectory(stageDirectory);
  }

  return {
    applyContributionRepair,
    applyMigration,
    armWatchdog,
    assertWritersStopped,
    cancelWatchdog,
    captureOutboxState,
    cleanupPlaintext,
    createAndVerifyEncryptedBackups,
    createMigrationManifest,
    createRepairManifest,
    editCanonicalEnvironment,
    enqueueCutoverAnnouncement,
    installPreviousPrivacyKey,
    installFinalCaddy,
    installMaintenance,
    maskOldUnits,
    quiesceServicesForRestore,
    recordForensicRetention,
    removeCreatedPreviousKey,
    removeCreatedReadiness,
    restoreCaddy,
    restoreEnvironment,
    restorePreCutoverRelayData,
    restoreServiceStates,
    seedReleaseAnnouncementMarker,
    startRelayServices,
    stopAndCaptureWriters,
    validateAndReloadRestoredCaddy,
    validateFinalCaddyForAdmission,
    validatePrepare,
    verifyContributionRepair,
    verifyIntensiveSoak,
    verifyLocalCanonical,
    verifyMaintenanceCanary,
    verifyMigratedData,
    verifyOldPublicHealth,
    verifyPrepared,
    verifyPublicCanonical,
    verifyPrivacyReadiness,
    writePrivacyReadiness,
  };
}

function createPrivateCutoverLogger(paths, parsed, now = () => new Date()) {
  ensureRootPrivateDirectory(paths.logDirectory, "Cutover log directory");
  const timestamp = timestampForFile(now);
  const logPath = path.join(paths.logDirectory, `cutover-${parsed.mode}-${parsed.revision}-${timestamp}.log`);
  const descriptor = openSync(logPath, "wx", 0o600);
  closeSync(descriptor);
  const write = (event) => {
    const line = `${JSON.stringify(event)}\n`;
    appendFileSync(logPath, line, { encoding: "utf8", mode: 0o600 });
  };
  write({ at: now().toISOString(), operation: "cutover-invoked", mode: parsed.mode, revision: parsed.revision, manifestHash: parsed.manifestHash });
  return { logPath, write };
}

async function main() {
  if (process.env.BITCRAFT_CUTOVER_UPDATER !== "1") throw new Error("Invoke cutover only through update-bitcraft-claim-monitor-relay");
  const parsed = parseCutoverArguments(process.argv.slice(2));
  if (typeof process.getuid !== "function" || process.getuid() !== 0) throw new Error("Run this command as root");
  if (process.env.BITCRAFT_CUTOVER_LOCKS_HELD !== "1") {
    process.exitCode = runWithLocks(process.argv.slice(2), {
      waitForLocks: parsed.mode === "abort" && process.env.BITCRAFT_CUTOVER_WATCHDOG === "1",
    });
    return;
  }
  const paths = { ...DEFAULT_SYSTEM_PATHS };
  ensureRootPrivateDirectory(paths.stateDirectory, "Cutover state directory");
  ensureRootPrivateDirectory(paths.logDirectory, "Cutover log directory");
  const privateLog = createPrivateCutoverLogger(paths, parsed);
  const stateDirectory = paths.stateDirectory;
  const orchestrator = createCutoverOrchestrator({
    operations: createSystemCutoverOperations({ paths, log: privateLog.write }),
    stateDirectory,
  });
  try {
    const result = await orchestrator[parsed.mode](parsed);
    privateLog.write({ at: new Date().toISOString(), operation: "cutover-finished", mode: parsed.mode, status: result.status ?? "prepared" });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    privateLog.write({
      at: new Date().toISOString(),
      operation: "cutover-failed",
      mode: parsed.mode,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

if (process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
