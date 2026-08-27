import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash, createHmac, randomUUID as cryptoRandomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";

const RECORD_VERSION = 1;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RECORD_STATES = new Set(["pending", "committed", "aborted"]);
const RECORD_STATE_ORDER = Object.freeze({ pending: 0, aborted: 1, committed: 2 });
const RECORD_KEYS = ["expiresAt", "keyId", "occurredAt", "operationId", "signature", "state", "subject", "version"];
const DEFAULT_ATOMIC_FILESYSTEM = Object.freeze({
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
});

function assertSingleLinkedFileDescriptor(filesystem, descriptor, filePath, label) {
  const descriptorStats = filesystem.fstatSync(descriptor, { bigint: true });
  const pathStats = filesystem.lstatSync(filePath, { bigint: true });
  if (!descriptorStats.isFile() || !pathStats.isFile() || pathStats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  if (descriptorStats.nlink !== 1n || pathStats.nlink !== 1n) {
    throw new Error(`${label} must have exactly one filesystem link`);
  }
  if (descriptorStats.dev !== pathStats.dev || descriptorStats.ino !== pathStats.ino) {
    throw new Error(`${label} changed filesystem identity before access`);
  }
}

function assertAtomicDestination(filesystem, filePath) {
  let descriptor;
  try {
    descriptor = filesystem.openSync(filePath, "r");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  try {
    assertSingleLinkedFileDescriptor(filesystem, descriptor, filePath, "Target privacy deletion ledger");
  } finally {
    filesystem.closeSync(descriptor);
  }
}

function readSingleLinkedFile(filesystem, filePath, label) {
  const descriptor = filesystem.openSync(filePath, "r");
  try {
    assertSingleLinkedFileDescriptor(filesystem, descriptor, filePath, label);
    return filesystem.readFileSync(descriptor, "utf8");
  } finally {
    filesystem.closeSync(descriptor);
  }
}

function syncAtomicParent(filesystem, filePath, platform) {
  const directoryDescriptor = filesystem.openSync(path.dirname(filePath), platform === "win32" ? "r+" : "r");
  try {
    filesystem.fsyncSync(directoryDescriptor);
  } finally {
    filesystem.closeSync(directoryDescriptor);
  }
}

function atomicPathIdentity(filePath, platform) {
  const resolved = path.resolve(filePath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function canonical(record) {
  return JSON.stringify({
    version: record.version,
    operationId: record.operationId,
    state: record.state,
    subject: record.subject,
    occurredAt: record.occurredAt,
    expiresAt: record.expiresAt,
    keyId: record.keyId,
  });
}

function canonicalSigned(record) {
  return JSON.stringify({
    version: record.version,
    operationId: record.operationId,
    state: record.state,
    subject: record.subject,
    occurredAt: record.occurredAt,
    expiresAt: record.expiresAt,
    keyId: record.keyId,
    signature: record.signature,
  });
}

function recordIdentity(record) {
  return [record.keyId, record.operationId, record.state, record.occurredAt].join("\u0000");
}

function compareDeletionRecords(left, right) {
  return String(left.occurredAt).localeCompare(String(right.occurredAt))
    || String(left.keyId).localeCompare(String(right.keyId))
    || String(left.operationId).localeCompare(String(right.operationId))
    || RECORD_STATE_ORDER[left.state] - RECORD_STATE_ORDER[right.state];
}

function exactTimestamp(value, label) {
  if (typeof value !== "string") throw new Error(`${label} timestamp is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} timestamp is invalid`);
  }
  return milliseconds;
}

function assertDeletionLedgerRecord(record, keys, label) {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`${label} record is invalid`);
  const keysPresent = Object.keys(record).sort();
  if (JSON.stringify(keysPresent) !== JSON.stringify(RECORD_KEYS)) throw new Error(`${label} record fields are invalid`);
  if (record.version !== RECORD_VERSION) throw new Error(`${label} record version is invalid`);
  if (typeof record.operationId !== "string" || !record.operationId.trim()) throw new Error(`${label} operation ID is invalid`);
  if (!RECORD_STATES.has(record.state)) throw new Error(`${label} state is invalid`);
  if (typeof record.subject !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(record.subject)) throw new Error(`${label} subject is invalid`);
  if (typeof record.keyId !== "string" || !/^[a-f0-9]{16}$/.test(record.keyId)) throw new Error(`${label} key ID is invalid`);
  if (typeof record.signature !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(record.signature)) throw new Error(`${label} signature is invalid`);
  const occurredAt = exactTimestamp(record.occurredAt, `${label} occurrence`);
  const expiresAt = exactTimestamp(record.expiresAt, `${label} expiry`);
  const retention = expiresAt - occurredAt;
  if (retention <= 0 || retention > RETENTION_MS) throw new Error(`${label} retention interval is invalid`);
  if (!verifyDeletionLedgerRecord(record, keys)) throw new Error(`${label} verification failed`);
  return record;
}

export function deletionLedgerKeyId(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function deletionLedgerSubject(discordId, key) {
  return createHmac("sha256", key).update(`discord:${String(discordId)}`).digest("base64url");
}

export function signDeletionLedgerRecord(record, key) {
  const unsigned = { ...record, keyId: deletionLedgerKeyId(key) };
  return {
    ...unsigned,
    signature: createHmac("sha256", key).update(canonical(unsigned)).digest("base64url"),
  };
}

export function verifyDeletionLedgerRecord(record, keys) {
  const key = keys.find((candidate) => deletionLedgerKeyId(candidate) === String(record?.keyId ?? ""));
  if (!key || Number(record?.version) !== RECORD_VERSION) return false;
  const expected = createHmac("sha256", key).update(canonical(record)).digest();
  let supplied;
  try {
    supplied = Buffer.from(String(record.signature ?? ""), "base64url");
  } catch {
    return false;
  }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function parseDeletionLedgerContent(content, keys, label = "Privacy deletion ledger") {
  const lines = String(content).split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 1 && lines[0] === "") return [];
  return lines.map((line, index) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`${label} ledger line ${index + 1} contains invalid JSON`);
    }
    return assertDeletionLedgerRecord(record, keys, `${label} ledger line ${index + 1}`);
  });
}

export function mergeDeletionLedgerRecords({
  sourceRecords,
  targetRecords,
  sourceKey,
  targetKey,
  targetPreviousKeys = [],
  manifestCreatedAt,
}) {
  const createdAtMs = exactTimestamp(manifestCreatedAt, "Privacy ledger manifest creation");
  const retained = [];
  let expired = 0;
  let expiredSource = 0;
  let expiredTarget = 0;
  const verifiedIdentities = new Map();
  const addRecords = (records, keys, source) => {
    for (const record of records) {
      assertDeletionLedgerRecord(record, keys, `Privacy deletion ${source} ledger`);
      const identity = recordIdentity(record);
      const existing = verifiedIdentities.get(identity);
      if (existing && canonicalSigned(existing) !== canonicalSigned(record)) {
        throw new Error("Privacy deletion ledger contains a conflicting duplicate record");
      }
      if (!existing) verifiedIdentities.set(identity, record);
      if (Date.parse(record.occurredAt) > createdAtMs) {
        throw new Error(`Privacy deletion ${source} ledger record occurred after manifest creation`);
      }
      if (Date.parse(record.expiresAt) <= createdAtMs) {
        expired += 1;
        if (source === "source") expiredSource += 1;
        else expiredTarget += 1;
        continue;
      }
      retained.push({ record, source });
    }
  };
  addRecords(targetRecords, [targetKey, ...targetPreviousKeys], "target");
  addRecords(sourceRecords, [sourceKey], "source");

  const deduplicated = new Map();
  let duplicates = 0;
  for (const entry of retained) {
    const identity = recordIdentity(entry.record);
    const existing = deduplicated.get(identity);
    if (existing) {
      if (canonicalSigned(existing.record) !== canonicalSigned(entry.record)) {
        throw new Error("Privacy deletion ledger contains a conflicting duplicate record");
      }
      duplicates += 1;
      continue;
    }
    deduplicated.set(identity, entry);
  }
  const records = [...deduplicated.values()].map((entry) => entry.record).sort(compareDeletionRecords);
  const content = records.map(canonicalSigned).join("\n") + (records.length ? "\n" : "");
  const retainedSource = [...deduplicated.values()].filter((entry) => entry.source === "source").length;
  const retainedTarget = records.length - retainedSource;
  const sourceKeyId = deletionLedgerKeyId(sourceKey);
  const retainedOldRecords = records.filter((record) => record.keyId === sourceKeyId);
  const previousKeyRetireAfter = retainedOldRecords.length
    ? retainedOldRecords.map((record) => record.expiresAt).sort().at(-1)
    : null;
  return {
    records,
    content,
    fileSha256: createHash("sha256").update(content).digest("hex"),
    previousKeyRetireAfter,
    counts: {
      source: sourceRecords.length,
      target: targetRecords.length,
      retained: records.length,
      retainedSource,
      retainedTarget,
      expired,
      expiredSource,
      expiredTarget,
      duplicates,
    },
  };
}

export function readDeletionLedger(path, keys) {
  if (!existsSync(path)) return [];
  return parseDeletionLedgerContent(readFileSync(path, "utf8"), keys);
}

export function stageDeletionLedgerReplacement(
  { ledgerPath, temporaryPath: requestedTemporaryPath = null, content, verificationKeys },
  {
    filesystem = DEFAULT_ATOMIC_FILESYSTEM,
    platform = process.platform,
    processId = null,
    randomUUID = cryptoRandomUUID,
  } = {},
) {
  const resolved = path.resolve(ledgerPath);
  const suffix = processId ?? randomUUID();
  const temporaryPath = requestedTemporaryPath
    ? path.resolve(requestedTemporaryPath)
    : path.join(path.dirname(resolved), `.${path.basename(resolved)}.tmp-${suffix}`);
  if (atomicPathIdentity(path.dirname(temporaryPath), platform) !== atomicPathIdentity(path.dirname(resolved), platform)
    || atomicPathIdentity(temporaryPath, platform) === atomicPathIdentity(resolved, platform)) {
    throw new Error("Staged privacy deletion ledger must be a distinct same-directory path");
  }
  const stagedDescription = () => Object.freeze({
    content,
    fileSha256: createHash("sha256").update(content).digest("hex"),
    ledgerPath: resolved,
    platform,
    temporaryPath,
    verificationKeys,
  });
  if (filesystem.existsSync(temporaryPath)) {
    let descriptor;
    try {
      descriptor = filesystem.openSync(temporaryPath, "r+");
      assertSingleLinkedFileDescriptor(filesystem, descriptor, temporaryPath, "Stale staged privacy deletion ledger");
      const stale = filesystem.readFileSync(descriptor, "utf8");
      parseDeletionLedgerContent(stale, verificationKeys, "Stale staged privacy deletion");
      if (stale === content) {
        filesystem.fchmodSync(descriptor, 0o600);
        filesystem.fsyncSync(descriptor);
        assertSingleLinkedFileDescriptor(filesystem, descriptor, temporaryPath, "Stale staged privacy deletion ledger");
        return stagedDescription();
      }
    } catch {}
    finally {
      if (descriptor !== undefined) filesystem.closeSync(descriptor);
    }
    filesystem.rmSync(temporaryPath, { force: true });
    syncAtomicParent(filesystem, temporaryPath, platform);
  }
  let created = false;
  try {
    assertAtomicDestination(filesystem, resolved);
    const descriptor = filesystem.openSync(temporaryPath, "wx", 0o600);
    created = true;
    try {
      assertSingleLinkedFileDescriptor(filesystem, descriptor, temporaryPath, "Staged privacy deletion ledger");
      filesystem.writeFileSync(descriptor, content, "utf8");
      filesystem.fsyncSync(descriptor);
    } finally {
      filesystem.closeSync(descriptor);
    }
    filesystem.chmodSync(temporaryPath, 0o600);
    const staged = readSingleLinkedFile(filesystem, temporaryPath, "Staged privacy deletion ledger");
    parseDeletionLedgerContent(staged, verificationKeys, "Staged privacy deletion");
    if (staged !== content) throw new Error("Staged privacy deletion ledger content changed before replacement");
  } catch (error) {
    if (created) {
      try { filesystem.rmSync(temporaryPath, { force: true }); } catch {}
    }
    throw error;
  }
  return stagedDescription();
}

export function installStagedDeletionLedger(
  stagedReplacement,
  { filesystem = DEFAULT_ATOMIC_FILESYSTEM, platform = stagedReplacement.platform ?? process.platform } = {},
) {
  assertAtomicDestination(filesystem, stagedReplacement.ledgerPath);
  const staged = readSingleLinkedFile(
    filesystem,
    stagedReplacement.temporaryPath,
    "Staged privacy deletion ledger",
  );
  parseDeletionLedgerContent(staged, stagedReplacement.verificationKeys, "Staged privacy deletion");
  if (staged !== stagedReplacement.content
    || createHash("sha256").update(staged).digest("hex") !== stagedReplacement.fileSha256) {
    throw new Error("Staged privacy deletion ledger changed before installation");
  }
  filesystem.renameSync(stagedReplacement.temporaryPath, stagedReplacement.ledgerPath);
  syncAtomicParent(filesystem, stagedReplacement.ledgerPath, platform);
  return { fileSha256: stagedReplacement.fileSha256 };
}

export function discardStagedDeletionLedger(
  stagedReplacement,
  { filesystem = DEFAULT_ATOMIC_FILESYSTEM, platform = stagedReplacement?.platform ?? process.platform } = {},
) {
  if (!stagedReplacement || !filesystem.existsSync(stagedReplacement.temporaryPath)) return;
  filesystem.rmSync(stagedReplacement.temporaryPath, { force: true });
  syncAtomicParent(filesystem, stagedReplacement.temporaryPath, platform);
}

export function replaceDeletionLedgerAtomically(
  input,
  options = {},
) {
  const staged = stageDeletionLedgerReplacement(input, options);
  try {
    return installStagedDeletionLedger(staged, options);
  } catch (error) {
    try { discardStagedDeletionLedger(staged, options); } catch {}
    throw error;
  }
}

export function appendDeletionLedgerRecord(path, record, key) {
  const signed = signDeletionLedgerRecord(record, key);
  appendFileSync(path, `${JSON.stringify(signed)}\n`, { encoding: "utf8", mode: 0o600 });
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  return signed;
}

export function coordinatePrivacyDeletion({
  ledgerPath,
  key,
  discordId,
  deleteAccount,
  now = () => new Date(),
  randomUUID = cryptoRandomUUID,
}) {
  const operationId = randomUUID();
  const occurredAt = now();
  const base = {
    version: RECORD_VERSION,
    operationId,
    subject: deletionLedgerSubject(discordId, key),
    occurredAt: occurredAt.toISOString(),
    expiresAt: new Date(occurredAt.getTime() + RETENTION_MS).toISOString(),
  };
  appendDeletionLedgerRecord(ledgerPath, { ...base, state: "pending" }, key);
  let result;
  try {
    result = deleteAccount(operationId);
  } catch (error) {
    appendDeletionLedgerRecord(ledgerPath, { ...base, state: "aborted", occurredAt: now().toISOString() }, key);
    throw error;
  }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      appendDeletionLedgerRecord(ledgerPath, { ...base, state: "committed", occurredAt: now().toISOString() }, key);
      return result;
    } catch (error) {
      lastError = error;
    }
  }
  const integrityError = new Error("Account data was deleted but the privacy recovery marker could not be finalized");
  integrityError.code = "privacy_integrity_failure";
  integrityError.cause = lastError;
  throw integrityError;
}

export function committedDeletionSubjects(records, now = new Date()) {
  const state = new Map();
  for (const record of records) state.set(`${record.keyId}\u0000${record.operationId}`, record);
  return new Set([...state.values()]
    .filter((record) => record.state === "committed" && Date.parse(record.expiresAt) > now.getTime())
    .map((record) => record.subject));
}

export function replayPrivacyDeletions({ records, accounts, key, keys = [key], deleteAccount, now = new Date() }) {
  const subjects = committedDeletionSubjects(records, now);
  let deleted = 0;
  for (const account of accounts) {
    if (!keys.some((candidate) => subjects.has(deletionLedgerSubject(account.discordId, candidate)))) continue;
    deleteAccount(account);
    deleted += 1;
  }
  return { deleted };
}
