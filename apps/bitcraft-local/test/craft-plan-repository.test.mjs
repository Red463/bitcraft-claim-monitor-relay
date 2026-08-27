import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import { createCraftPlanRepository, applyCraftPlanRecordsMigration } from "../src/server/craftPlanRepository.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  applyCraftPlanRecordsMigration(db, { now: () => "2026-08-27T10:00:00.000Z" });
  return { db, repository: createCraftPlanRepository(db, { randomUUID: () => "new-plan-id", now: () => "2026-08-27T10:00:00.000Z" }) };
}

test("migration promotes the singleton config to the primary shared plan", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  db.prepare("INSERT INTO craft_plan_settings VALUES (?, ?, ?, ?)").run("settlement", JSON.stringify({ name: "Citadel", enabled: true, targets: [{ id: "7" }] }), "old", "new");

  applyCraftPlanRecordsMigration(db, { now: () => "2026-08-27T10:00:00.000Z" });

  const row = db.prepare("SELECT * FROM craft_plans").get();
  assert.equal(row.id, "legacy-primary");
  assert.equal(row.name, "Citadel");
  assert.equal(row.scope, "shared");
  assert.equal(row.is_primary, 1);
  assert.equal(JSON.parse(row.config_json).name, undefined);
  assert.deepEqual(JSON.parse(row.config_json).targets, [{ id: "7" }]);
  db.close();
});

test("migration backfills audit state and makes it plan-specific", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  db.exec(`
    DROP TABLE craft_plan_progress_audit_state;
    CREATE TABLE craft_plan_progress_audit_state (
      claim_id TEXT PRIMARY KEY,
      last_fingerprint TEXT,
      last_payload_gzip BLOB,
      last_snapshot_id INTEGER,
      last_full_snapshot_at TEXT,
      last_success_at TEXT,
      last_failure_fingerprint TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO craft_plan_progress_audit_state (claim_id, last_fingerprint, updated_at)
    VALUES ('claim', 'legacy-fingerprint', 'old');
  `);

  applyCraftPlanRecordsMigration(db, { now: () => "2026-08-27T10:00:00.000Z" });

  assert.deepEqual(db.prepare("SELECT claim_id, plan_id, last_fingerprint FROM craft_plan_progress_audit_state").all().map((row) => ({ ...row })), [
    { claim_id: "claim", plan_id: "legacy-primary", last_fingerprint: "legacy-fingerprint" },
  ]);
  db.prepare("INSERT INTO craft_plan_progress_audit_state (claim_id, plan_id, updated_at) VALUES ('claim', 'another-plan', 'new')").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_state WHERE claim_id = 'claim'").get().count, 2);
  db.close();
});

test("repository lists shared plans plus only the viewer's personal plans", () => {
  const { db, repository } = fixture();
  db.prepare("INSERT INTO user_accounts (discord_id, character_status, settings_json, created_at) VALUES ('one', 'unlinked', '{}', 'now')").run();
  db.prepare("INSERT INTO user_accounts (discord_id, character_status, settings_json, created_at) VALUES ('two', 'unlinked', '{}', 'now')").run();
  const one = db.prepare("SELECT id FROM user_accounts WHERE discord_id = 'one'").get().id;
  const two = db.prepare("SELECT id FROM user_accounts WHERE discord_id = 'two'").get().id;
  repository.createPersonal({ ownerUserId: one, name: "Mine" });
  repository.createPersonal({ ownerUserId: two, name: "Hidden" }, { randomUUID: () => "other-plan" });

  assert.deepEqual(repository.listVisible({ userId: one }).map((plan) => plan.name), ["Settlement craft plan", "Mine"]);
  assert.equal("config" in repository.listVisible({ userId: one })[0], false);
  assert.equal(repository.getVisible("other-plan", { userId: one }), null);
  db.close();
});

test("repository rejects stale updates and protects the primary plan", () => {
  const { db, repository } = fixture();
  const primary = repository.primary();
  const updated = repository.update(primary.id, { name: "New name", config: { enabled: true } }, { expectedRevision: 1, admin: true });
  assert.equal(updated.revision, 2);
  const renamed = repository.update(primary.id, { name: "Renamed only" }, { expectedRevision: 2, admin: true });
  assert.equal(renamed.config.enabled, true);
  assert.throws(() => repository.update(primary.id, { name: "Lost update", config: {} }, { expectedRevision: 1, admin: true }), /changed since/);
  assert.throws(() => repository.remove(primary.id, { expectedRevision: 3, admin: true }), /primary shared plan/);
  const secondary = repository.createShared({ name: "Secondary" }, { admin: true });
  const nextPrimary = repository.setPrimary(secondary.id, { expectedRevision: secondary.revision, admin: true });
  assert.equal(nextPrimary.primary, true);
  assert.equal(nextPrimary.revision, 2);
  assert.equal(repository.getAdmin(primary.id).primary, false);
  assert.equal(repository.getAdmin(primary.id).revision, 4);
  db.close();
});

test("personal duplication strips another player's character sources", () => {
  const { db, repository } = fixture();
  db.prepare("INSERT INTO user_accounts (discord_id, character_player_id, character_status, settings_json, created_at) VALUES ('one', '42', 'approved', '{}', 'now')").run();
  const owner = db.prepare("SELECT id FROM user_accounts WHERE discord_id = 'one'").get().id;
  const primary = repository.primary();
  repository.update(primary.id, { name: primary.name, config: { enabled: true, sourceRules: { storageContainerIds: ["s1"], playerIds: ["99"], craftPlayerIds: ["42", "99"], bankPlayerIds: ["99"], bankContainerIds: ["99:b"], deployableContainerIds: ["99:d"] } } }, { expectedRevision: 1, admin: true });

  const result = repository.createPersonal({ ownerUserId: owner, name: "Copy", duplicateFromPlanId: primary.id });

  assert.deepEqual(result.plan.config.sourceRules, { storageContainerIds: ["s1"], playerIds: [], craftPlayerIds: ["42"], bankPlayerIds: [], bankContainerIds: [], deployableContainerIds: [] });
  assert.equal(result.warnings.length, 1);
  db.close();
});

test("personal plans reject sources for an unapproved character link", () => {
  const { db, repository } = fixture();
  db.prepare("INSERT INTO user_accounts (discord_id, character_player_id, character_status, settings_json, created_at) VALUES ('pending', '42', 'pending', '{}', 'now')").run();
  const owner = db.prepare("SELECT id FROM user_accounts WHERE discord_id = 'pending'").get().id;
  const created = repository.createPersonal({ ownerUserId: owner, name: "Pending" });

  assert.throws(() => repository.update(created.plan.id, {
    config: { sourceRules: { playerIds: ["42"] } },
  }, { expectedRevision: 1, userId: owner }), /verified character sources/);
  db.close();
});
