import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { coordinatePrivacyDeletion, deletionLedgerSubject } from "../../apps/bitcraft-local/src/server/privacyDeletionLedger.mjs";
import { applySchemaBootstrap } from "../../apps/bitcraft-local/src/server/schemaBootstrap.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");
const replayScript = path.join(repositoryRoot, "deploy", "replay-privacy-deletions.mjs");

function createFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "deploy-privacy-replay-"));
  const dataDir = path.join(root, "data");
  const backupDir = path.join(root, "backups");
  const configDir = path.join(root, "config");
  for (const directory of [dataDir, backupDir, configDir]) mkdirSync(directory);
  const databasePath = path.join(dataDir, "restore.sqlite");
  const ledgerPath = path.join(backupDir, "privacy-deletion-ledger.jsonl");
  const currentKeyPath = path.join(configDir, "privacy-ledger.key");
  const currentKey = Buffer.alloc(32, 41).toString("base64url");
  writeFileSync(currentKeyPath, `${currentKey}\n`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { dataDir, backupDir, configDir, databasePath, ledgerPath, currentKeyPath, currentKey };
}

function openSchema(databasePath) {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  return db;
}

function insertAccount(db, discordId, username) {
  db.prepare(`
    INSERT INTO user_accounts (discord_id, discord_username, character_status, settings_json, created_at)
    VALUES (?, ?, 'unlinked', '{}', '2026-01-01T00:00:00.000Z')
  `).run(discordId, username);
}

function recordDeletion(fixture, { discordId, key = fixture.currentKey, operationId }) {
  coordinatePrivacyDeletion({
    ledgerPath: fixture.ledgerPath,
    key,
    discordId,
    deleteAccount: () => ({ ok: true }),
    now: () => new Date(Date.now() - 60_000),
    randomUUID: () => operationId,
  });
}

function runReplay(fixture, environment = {}) {
  return spawnSync(process.execPath, [replayScript, fixture.databasePath, fixture.ledgerPath, fixture.currentKeyPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      DATA_DIR: fixture.dataDir,
      BACKUP_DIR: fixture.backupDir,
      CONFIG_DIR: fixture.configDir,
      ...environment,
    },
  });
}

test("restore replay removes a resurrected dedicated account without exposing identifiers", (t) => {
  const fixture = createFixture(t);
  const discordId = "111111111111111111";
  const db = openSchema(fixture.databasePath);
  insertAccount(db, discordId, "restored-user");
  db.close();
  recordDeletion(fixture, { discordId, operationId: "dedicated-restore-operation" });

  const replay = runReplay(fixture);
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(JSON.parse(replay.stdout).profiles, {
    timbersteel: { status: "ok", scanned: 1, deleted: 1 },
  });
  assert.doesNotMatch(replay.stdout + replay.stderr, new RegExp(discordId));
  assert.doesNotMatch(replay.stdout + replay.stderr, new RegExp(deletionLedgerSubject(discordId, fixture.currentKey)));
  const restored = new DatabaseSync(fixture.databasePath);
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM user_accounts").get().count, 0);
  restored.close();

  const repeated = runReplay(fixture);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout).profiles, {
    timbersteel: { status: "ok", scanned: 0, deleted: 0 },
  });
});

test("restore replay verifies current and configured previous dedicated keys", (t) => {
  const fixture = createFixture(t);
  const previousKey = Buffer.alloc(32, 57).toString("base64url");
  const previousKeyPath = path.join(fixture.configDir, "privacy-ledger.previous.key");
  writeFileSync(previousKeyPath, `${previousKey}\n`);
  const db = openSchema(fixture.databasePath);
  insertAccount(db, "222222222222222222", "current-key-user");
  insertAccount(db, "333333333333333333", "previous-key-user");
  db.close();
  recordDeletion(fixture, { discordId: "222222222222222222", operationId: "current-key-operation" });
  recordDeletion(fixture, { discordId: "333333333333333333", key: previousKey, operationId: "previous-key-operation" });

  const replay = runReplay(fixture, { PRIVACY_LEDGER_PREVIOUS_KEY_FILES: previousKeyPath });
  assert.equal(replay.status, 0, replay.stderr);
  const summary = JSON.parse(replay.stdout);
  assert.equal(summary.recordsVerified, 4);
  assert.equal(summary.verificationKeys, 2);
  assert.equal(summary.profiles.timbersteel.deleted, 2);
});

test("dedicated replay failure rolls back the database", (t) => {
  const fixture = createFixture(t);
  const discordId = "444444444444444444";
  const db = openSchema(fixture.databasePath);
  insertAccount(db, discordId, "rollback-user");
  db.exec(`
    CREATE TRIGGER reject_dedicated_replay
    BEFORE DELETE ON user_accounts
    BEGIN
      SELECT RAISE(ABORT, 'forced replay failure');
    END
  `);
  db.close();
  recordDeletion(fixture, { discordId, operationId: "rollback-operation" });

  const replay = runReplay(fixture);
  assert.equal(replay.status, 1);
  assert.match(replay.stderr, /replay failed|database was unchanged/i);
  assert.doesNotMatch(replay.stderr, /forced replay failure/);
  const restored = new DatabaseSync(fixture.databasePath);
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM user_accounts").get().count, 1);
  restored.close();
});

test("duplicate previous key configuration is rejected without database mutation", (t) => {
  const fixture = createFixture(t);
  writeFileSync(fixture.ledgerPath, "");
  const db = openSchema(fixture.databasePath);
  insertAccount(db, "555555555555555555", "untouched-user");
  db.close();
  const replay = runReplay(fixture, { PRIVACY_LEDGER_PREVIOUS_KEY_FILES: fixture.currentKeyPath });
  assert.equal(replay.status, 1);
  assert.match(replay.stderr, /duplicate/i);
  const restored = new DatabaseSync(fixture.databasePath);
  assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM user_accounts").get().count, 1);
  restored.close();
});
