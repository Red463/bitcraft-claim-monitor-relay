#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dedicatedStateFingerprint,
  inspectRetiredPublicProfile,
  removeRetiredPublicProfileData,
  RETIRED_PUBLIC_PROFILE_TABLES,
} from "../apps/bitcraft-local/src/server/retiredPublicProfileCleanup.mjs";

export const REMOVAL_CONFIRMATION = "remove-claim-monitor.com";
export const RETIRED_PUBLIC_ENVIRONMENT_KEYS = Object.freeze([
  "PUBLIC_PROFILE_ENABLED",
  "PUBLIC_COLLABORATION_ENABLED",
  "PUBLIC_LEGAL_CONFIGURATION_CONFIRMED",
  "PUBLIC_ORIGIN",
  "PUBLIC_DISCORD_OAUTH_CLIENT_ID",
  "PUBLIC_DISCORD_OAUTH_CLIENT_SECRET",
  "PUBLIC_PLAN_TOKEN_HMAC_KEY",
]);

const RETIRED_HOSTS = Object.freeze(["claim-monitor.com", "www.claim-monitor.com"]);
const SERVICE_UNITS = Object.freeze([
  "bitcraft-claim-monitor-relay.service",
  "bitcraft-claim-monitor-relay-worker.service",
  "bitcraft-claim-monitor-relay-collector.service",
  "bitcraft-claim-monitor-relay-collector.timer",
]);

const DEFAULT_PATHS = Object.freeze({
  databasePath: "/var/lib/bitcraft-claim-monitor-relay/bitcraft-local.sqlite",
  environmentPath: "/etc/bitcraft-claim-monitor-relay.env",
  caddyPath: "/etc/caddy/Caddyfile",
  backupDirectory: "/var/backups/bitcraft-claim-monitor-relay",
  backupBinary: "/usr/local/bin/backup-bitcraft-claim-monitor-relay",
  backupCryptoHelper: "/usr/local/lib/bitcraft-claim-monitor-relay/backup-crypto.mjs",
  backupKeyFile: "/etc/bitcraft-claim-monitor-relay/backup-encryption.key",
  deployLock: "/run/lock/bitcraft-claim-monitor-relay-deploy.lock",
  backupLock: "/run/lock/bitcraft-claim-monitor-relay-backup.lock",
  caddyBinary: "caddy",
  systemctlBinary: "systemctl",
  curlBinary: "curl",
  flockBinary: "flock",
});

function normalizedNewlines(source) {
  return String(source).replace(/\r\n/g, "\n");
}

export function publicEnvironmentRemoval(source) {
  const retired = new Set(RETIRED_PUBLIC_ENVIRONMENT_KEYS);
  const removed = new Set();
  const hadTrailingNewline = /\r?\n$/.test(String(source));
  const lines = normalizedNewlines(source).split("\n").filter((line) => {
    const match = line.match(/^\s*(PUBLIC_[A-Z0-9_]+)\s*=/);
    if (!match || !retired.has(match[1])) return true;
    removed.add(match[1]);
    return false;
  });
  if (hadTrailingNewline && lines.at(-1) !== "") lines.push("");
  return {
    source: lines.join("\n"),
    removedKeys: RETIRED_PUBLIC_ENVIRONMENT_KEYS.filter((key) => removed.has(key)),
  };
}

export function removePublicEnvironmentValues(source) {
  return publicEnvironmentRemoval(source).source;
}

function braceDelta(line) {
  let delta = 0;
  let quote = null;
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") delta += 1;
    if (character === "}") delta -= 1;
  }
  return delta;
}

export function publicCaddyRemoval(source) {
  const lines = normalizedNewlines(source).split("\n");
  const output = [];
  const removed = [];
  for (let index = 0; index < lines.length;) {
    const match = lines[index].match(/^\s*(claim-monitor\.com|www\.claim-monitor\.com)\s*\{\s*$/);
    if (!match) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const host = match[1];
    let depth = 0;
    let cursor = index;
    for (; cursor < lines.length; cursor += 1) {
      depth += braceDelta(lines[cursor]);
      if (depth === 0) break;
      if (depth < 0) throw new Error(`Malformed Caddy block for ${host}`);
    }
    if (cursor >= lines.length || depth !== 0) throw new Error(`Unterminated or malformed Caddy block for ${host}`);
    removed.push(host);
    index = cursor + 1;
    while (index < lines.length && lines[index] === "" && output.at(-1) === "") index += 1;
  }
  return { source: output.join("\n"), removedHosts: RETIRED_HOSTS.filter((host) => removed.includes(host)) };
}

export function removePublicCaddySites(source) {
  return publicCaddyRemoval(source).source;
}

export function assertPathWithin(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Target is outside the approved directory: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

export function assertSafeExistingPath(root, target) {
  const resolved = assertPathWithin(root, target);
  const details = lstatSync(resolved);
  if (details.isSymbolicLink()) throw new Error(`Target must not be a symbolic link: ${resolved}`);
  if (!details.isFile()) throw new Error(`Target must be a regular file: ${resolved}`);
  return resolved;
}

export function assertRemovalPathSafety(paths, expected = DEFAULT_PATHS) {
  const exactPathKeys = [
    "databasePath",
    "environmentPath",
    "caddyPath",
    "backupDirectory",
    "backupBinary",
    "backupCryptoHelper",
    "backupKeyFile",
    "deployLock",
    "backupLock",
  ];
  for (const key of exactPathKeys) {
    if (path.resolve(paths[key]) !== path.resolve(expected[key])) {
      throw new Error(`${key} must use the exact approved path`);
    }
  }
  for (const key of ["databasePath", "environmentPath", "caddyPath", "backupBinary", "backupCryptoHelper", "backupKeyFile"]) {
    const details = lstatSync(paths[key]);
    if (details.isSymbolicLink()) throw new Error(`${key} must not be a symbolic link`);
    if (!details.isFile()) throw new Error(`${key} must be a regular file`);
  }
  const backupDirectory = lstatSync(paths.backupDirectory);
  if (backupDirectory.isSymbolicLink()) throw new Error("backupDirectory must not be a symbolic link");
  if (!backupDirectory.isDirectory()) throw new Error("backupDirectory must be a directory");
  return paths;
}

export function backupContainsRetiredPublicSchema(db) {
  const names = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all().map((row) => String(row.name));
  const retired = new Set(RETIRED_PUBLIC_PROFILE_TABLES);
  return names.some((name) => retired.has(name));
}

function environmentKeyNames(source) {
  const retired = new Set(RETIRED_PUBLIC_ENVIRONMENT_KEYS);
  const names = new Set();
  for (const line of normalizedNewlines(source).split("\n")) {
    const match = line.match(/^\s*(PUBLIC_[A-Z0-9_]+)\s*=/);
    if (match && retired.has(match[1])) names.add(match[1]);
  }
  return RETIRED_PUBLIC_ENVIRONMENT_KEYS.filter((key) => names.has(key));
}

function caddyHostPresence(source) {
  return Object.fromEntries(RETIRED_HOSTS.map((host) => [host, new RegExp(`(^|\\n)\\s*${host.replaceAll(".", "\\.")}\\s*\\{`).test(normalizedNewlines(source))]));
}

function runCommand(command, args, label, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.stdio ?? "pipe" });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
  return String(result.stdout ?? "");
}

function decryptBackup(input, paths) {
  const directory = path.join(os.tmpdir(), `bitcraft-public-removal-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  const output = path.join(directory, "backup.sqlite");
  try {
    runCommand(process.execPath, [paths.backupCryptoHelper, "decrypt", input, output, paths.backupKeyFile], `Decrypt backup ${path.basename(input)}`);
    return { output, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function inspectBackup(pathname, paths) {
  const encrypted = pathname.endsWith(".enc");
  const decrypted = encrypted ? decryptBackup(pathname, paths) : { output: pathname, cleanup: () => undefined };
  try {
    const db = new DatabaseSync(decrypted.output, { readOnly: true });
    try {
      return {
        path: pathname,
        retiredSchema: backupContainsRetiredPublicSchema(db),
        integrity: db.prepare("PRAGMA integrity_check").get()?.integrity_check === "ok",
      };
    } finally {
      db.close();
    }
  } finally {
    decrypted.cleanup();
  }
}

function backupCandidates(paths) {
  if (!existsSync(paths.backupDirectory)) return [];
  return readdirSync(paths.backupDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && /\.sqlite(?:\.enc)?$/.test(entry.name))
    .map((entry) => assertSafeExistingPath(paths.backupDirectory, path.join(paths.backupDirectory, entry.name)))
    .sort();
}

export function inspectRemovalTargets(options = {}) {
  const paths = { ...DEFAULT_PATHS, ...options };
  const db = new DatabaseSync(paths.databasePath, { readOnly: true });
  let database;
  try {
    database = inspectRetiredPublicProfile(db);
  } finally {
    db.close();
  }
  const environmentSource = readFileSync(paths.environmentPath, "utf8");
  const caddySource = readFileSync(paths.caddyPath, "utf8");
  const backups = backupCandidates(paths).map((candidate) => inspectBackup(candidate, paths)).filter((entry) => entry.retiredSchema);
  return {
    database,
    environmentKeys: environmentKeyNames(environmentSource),
    caddyHosts: caddyHostPresence(caddySource),
    backups: backups.map(({ path: pathname, integrity }) => ({ path: pathname, integrity })),
  };
}

function atomicReplace(pathname, source) {
  const current = lstatSync(pathname);
  if (current.isSymbolicLink() || !current.isFile()) throw new Error(`Refusing unsafe replacement target: ${pathname}`);
  const temporary = `${pathname}.public-removal-${process.pid}.tmp`;
  writeFileSync(temporary, source, { flag: "wx", mode: current.mode & 0o777 });
  try {
    chmodSync(temporary, current.mode & 0o777);
    if (process.platform !== "win32") chownSync(temporary, current.uid, current.gid);
    renameSync(temporary, pathname);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function serviceState(unit, paths) {
  return spawnSync(paths.systemctlBinary, ["is-active", "--quiet", unit]).status === 0;
}

export function restoreActiveServices(states, paths, execute = runCommand) {
  const failures = [];
  for (const unit of SERVICE_UNITS) {
    if (!states[unit]) continue;
    try {
      execute(paths.systemctlBinary, ["start", unit], `Restore ${unit}`);
    } catch (error) {
      failures.push(`${unit}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new Error(`Service restoration failed: ${failures.join("; ")}`);
}

function verifyDedicatedHealth(paths) {
  runCommand(paths.curlBinary, [
    "-fsS",
    "--connect-timeout", "2",
    "--max-time", "10",
    "--header", "Host: app.timbersteeltrade.com",
    "http://127.0.0.1:19430/api/local/health",
  ], "Verify dedicated health");
}

function actualApply(paths) {
  const states = Object.fromEntries(SERVICE_UNITS.map((unit) => [unit, serviceState(unit, paths)]));
  const caddyRecovery = `${paths.caddyPath}.public-removal-${Date.now()}.recovery`;
  let caddyChanged = false;
  try {
    for (const unit of SERVICE_UNITS) runCommand(paths.systemctlBinary, ["stop", unit], `Stop ${unit}`);

    const db = new DatabaseSync(paths.databasePath);
    let cleanup;
    try {
      db.exec("PRAGMA secure_delete=ON");
      const dedicatedBefore = dedicatedStateFingerprint(db);
      cleanup = removeRetiredPublicProfileData(db);
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.exec("VACUUM");
      const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
      if (integrity !== "ok") throw new Error(`Database integrity check failed: ${integrity}`);
      const dedicatedAfter = dedicatedStateFingerprint(db);
      if (JSON.stringify(dedicatedAfter) !== JSON.stringify(dedicatedBefore)) {
        throw new Error("Dedicated database fingerprint changed during retired public profile removal");
      }
    } finally {
      db.close();
    }

    const environment = publicEnvironmentRemoval(readFileSync(paths.environmentPath, "utf8"));
    atomicReplace(paths.environmentPath, environment.source);

    const caddy = publicCaddyRemoval(readFileSync(paths.caddyPath, "utf8"));
    const candidate = `${paths.caddyPath}.public-removal-${process.pid}.candidate`;
    writeFileSync(candidate, caddy.source, { flag: "wx", mode: statSync(paths.caddyPath).mode & 0o777 });
    try {
      runCommand(paths.caddyBinary, ["validate", "--config", candidate], "Validate dedicated-only Caddy configuration");
      copyFileSync(paths.caddyPath, caddyRecovery);
      renameSync(candidate, paths.caddyPath);
      caddyChanged = true;
      runCommand(paths.systemctlBinary, ["reload", "caddy"], "Reload Caddy");
    } finally {
      if (existsSync(candidate)) rmSync(candidate, { force: true });
    }

    for (const backup of backupCandidates(paths)) {
      const inspection = inspectBackup(backup, paths);
      if (inspection.retiredSchema) rmSync(assertSafeExistingPath(paths.backupDirectory, backup));
    }

    restoreActiveServices(states, paths);
    verifyDedicatedHealth(paths);
    if (existsSync(caddyRecovery)) rmSync(caddyRecovery, { force: true });
    return {
      cleanup,
      dedicatedStatePreserved: true,
      removedEnvironmentKeys: environment.removedKeys,
      removedCaddyHosts: caddy.removedHosts,
    };
  } catch (error) {
    const recoveryFailures = [];
    if (caddyChanged && existsSync(caddyRecovery)) {
      try {
        copyFileSync(caddyRecovery, paths.caddyPath);
        runCommand(paths.caddyBinary, ["validate", "--config", paths.caddyPath], "Validate restored Caddy configuration");
        runCommand(paths.systemctlBinary, ["reload", "caddy"], "Reload restored Caddy configuration");
      } catch (recoveryError) {
        recoveryFailures.push(recoveryError);
      }
    }
    try {
      restoreActiveServices(states, paths);
    } catch (recoveryError) {
      recoveryFailures.push(recoveryError);
    }
    if (recoveryFailures.length) {
      throw new AggregateError(
        [error, ...recoveryFailures],
        `Retired public profile removal failed and recovery also failed: ${recoveryFailures.map((failure) => failure instanceof Error ? failure.message : String(failure)).join("; ")}`,
      );
    }
    throw error;
  }
}

function newestBackup(paths, since) {
  return backupCandidates(paths)
    .map((pathname) => ({ pathname, modified: statSync(pathname).mtimeMs }))
    .filter((entry) => entry.modified >= since)
    .sort((a, b) => b.modified - a.modified)[0]?.pathname ?? null;
}

function runManualBackup(paths, revision) {
  const startedAt = Date.now();
  runCommand(paths.backupBinary, ["manual", "--revision", revision], "Create encrypted manual backup", { stdio: "pipe" });
  const backup = newestBackup(paths, startedAt - 1000);
  if (!backup) throw new Error("Manual backup did not create a verifiable backup file");
  const inspection = inspectBackup(backup, paths);
  if (!inspection.integrity || inspection.retiredSchema) throw new Error("Manual backup verification failed");
  return backup;
}

export function parseArguments(argv) {
  const result = { mode: null, confirmation: null, revision: process.env.GITHUB_SHA ?? "", locked: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--inspect") result.mode = result.mode ? "invalid" : "inspect";
    else if (value === "--apply") result.mode = result.mode ? "invalid" : "apply";
    else if (value === "--confirmation") result.confirmation = argv[++index] ?? null;
    else if (value === "--revision") result.revision = argv[++index] ?? "";
    else if (value === "--locked-deploy" || value === "--locked-all") result.locked = value.slice(2);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!result.mode || result.mode === "invalid") throw new Error("Choose exactly one of --inspect or --apply");
  return result;
}

function cliPaths() {
  return { ...DEFAULT_PATHS };
}

function reexecWithLock(lockPath, args, paths) {
  const result = spawnSync(paths.flockBinary, ["--nonblock", lockPath, process.execPath, fileURLToPath(import.meta.url), ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Could not acquire protected removal lock: ${lockPath}`);
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  const paths = cliPaths();
  assertRemovalPathSafety(paths);
  if (parsed.mode === "inspect") {
    process.stdout.write(`${JSON.stringify(inspectRemovalTargets(paths), null, 2)}\n`);
    return;
  }
  if (process.env.BITCRAFT_RETIRED_PUBLIC_REMOVAL !== "1") throw new Error("BITCRAFT_RETIRED_PUBLIC_REMOVAL=1 is required");
  if (parsed.confirmation !== REMOVAL_CONFIRMATION) throw new Error(`Confirmation must be exactly ${REMOVAL_CONFIRMATION}`);
  if (!/^[0-9a-f]{40}$/i.test(parsed.revision)) throw new Error("A full 40-character revision is required");
  const baseArgs = ["--apply", "--confirmation", parsed.confirmation, "--revision", parsed.revision];
  if (!parsed.locked) {
    reexecWithLock(paths.deployLock, [...baseArgs, "--locked-deploy"], paths);
    return;
  }
  if (parsed.locked === "locked-deploy") {
    runCommand(paths.backupBinary, ["manual", "--revision", parsed.revision], "Create pre-removal encrypted backup");
    reexecWithLock(paths.backupLock, [...baseArgs, "--locked-all"], paths);
    runManualBackup(paths, parsed.revision);
    return;
  }
  if (parsed.locked !== "locked-all") throw new Error("Invalid protected lock state");
  process.stdout.write(`${JSON.stringify(actualApply(paths), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
