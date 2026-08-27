#!/usr/bin/env node
import { lstatSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { deleteUserAccount } from "../apps/bitcraft-local/src/server/accountDeletion.mjs";
import {
  readDeletionLedger,
  replayPrivacyDeletions,
} from "../apps/bitcraft-local/src/server/privacyDeletionLedger.mjs";

function regularPath(candidate, expectedRoot) {
  const resolved = path.resolve(candidate);
  const root = path.resolve(expectedRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`Path is outside ${root}`);
  const stat = lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Path is not a regular file: ${resolved}`);
  return resolved;
}

function readLedgerKey(keyFile, label) {
  const key = readFileSync(keyFile, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(key) || Buffer.from(key, "base64url").length !== 32) {
    throw new Error(`${label} key configuration must contain one base64url-encoded 32-byte value`);
  }
  return key;
}

const [databaseArg, ledgerArg, keyArg] = process.argv.slice(2);
if (!databaseArg || !ledgerArg || !keyArg) {
  console.error("Usage: replay-privacy-deletions.mjs <database> <ledger> <key-file>");
  process.exit(2);
}

try {
  const database = regularPath(databaseArg, process.env.DATA_DIR ?? "/var/lib/bitcraft-claim-monitor-relay");
  const ledger = regularPath(ledgerArg, process.env.BACKUP_DIR ?? "/var/backups/bitcraft-claim-monitor-relay");
  const configRoot = process.env.CONFIG_DIR ?? "/etc/bitcraft-claim-monitor-relay";
  const keyFile = regularPath(keyArg, configRoot);
  const key = readLedgerKey(keyFile, "Current privacy ledger");
  const previousKeyFiles = String(process.env.PRIVACY_LEDGER_PREVIOUS_KEY_FILES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((candidate) => regularPath(candidate, configRoot));
  const keyPathIdentity = (candidate) => process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const configuredKeyFiles = [keyFile, ...previousKeyFiles].map(keyPathIdentity);
  if (new Set(configuredKeyFiles).size !== configuredKeyFiles.length) {
    throw new Error("Privacy ledger key configuration contains a duplicate file");
  }
  const previousKeys = previousKeyFiles.map((previousKeyFile) => {
    return readLedgerKey(previousKeyFile, "Previous privacy ledger");
  });
  const keys = [key, ...previousKeys];
  if (new Set(keys).size !== keys.length) {
    throw new Error("Privacy ledger key configuration contains duplicate key material");
  }
  const records = readDeletionLedger(ledger, keys);
  const db = new DatabaseSync(database);
  let summary;
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN IMMEDIATE");
    const accounts = db.prepare("SELECT id, discord_id AS discordId FROM user_accounts").all();
    const timbersteel = replayPrivacyDeletions({
      records,
      accounts,
      key,
      keys,
      deleteAccount: (account) => deleteUserAccount(db, {
        userId: account.id,
        discordId: account.discordId,
        deletionKey: key,
        manageTransaction: false,
      }),
    });
    db.exec("COMMIT");
    summary = {
      status: "ok",
      recordsVerified: records.length,
      verificationKeys: keys.length,
      profiles: {
        timbersteel: { status: "ok", scanned: accounts.length, deleted: timbersteel.deleted },
      },
    };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw new Error("Privacy deletion replay failed; restored database was unchanged", { cause: error });
  } finally {
    db.close();
  }
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
