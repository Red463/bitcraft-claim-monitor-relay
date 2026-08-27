import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { deleteUserAccount, deletedSubjectMarker } from "../src/server/accountDeletion.mjs";
import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import { applyAdditiveColumnMigrations } from "../src/server/schemaMigrations.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  const now = "2026-07-25T12:00:00.000Z";
  db.prepare("INSERT INTO admin_users (username, password_hash, role, discord_id, created_at) VALUES ('Thomas', 'hash', 'owner', '111111111111111111', ?)").run(now);
  const insert = db.prepare(`
    INSERT INTO user_accounts (
      discord_id, discord_username, discord_global_name, discord_avatar,
      character_player_id, character_name, character_status, settings_json, created_at, last_login_at
    ) VALUES (?, ?, ?, '', ?, ?, 'approved', '{"density":"compact"}', ?, ?)
  `);
  const target = insert.run("111111111111111111", "Thomas", "Thomas Bush", "12345678", "Timber Wolf", now, now);
  const other = insert.run("222222222222222222", "Other", "Other User", "87654321", "Other Character", now, now);
  const userId = Number(target.lastInsertRowid);
  const otherUserId = Number(other.lastInsertRowid);
  db.prepare("INSERT INTO craft_plans (id, name, scope, owner_user_id, is_primary, revision, config_json, created_at, updated_at) VALUES ('personal', 'Private', 'personal', ?, 0, 1, '{}', ?, ?)").run(userId, now, now);
  db.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at, reauthenticated_at) VALUES ('one', ?, ?, ?, ?)").run(userId, "2026-08-25T12:00:00.000Z", now, now);
  db.prepare("INSERT INTO user_legal_acceptances (user_id, legal_version, terms_digest, privacy_digest, age_confirmed, accepted_at, source) VALUES (?, 'v1', 't', 'p', 1, ?, 'existing-session')").run(userId, now);
  const watch = db.prepare(`
    INSERT INTO market_deal_watches (
      user_id, discord_id, claim_id, region_id, item_id, item_type, item_name,
      threshold_percent, enabled, created_at, updated_at
    ) VALUES (?, ?, 'claim', '19', '1', '0', 'Ore', 30, 1, ?, ?)
  `).run(userId, "111111111111111111", now, now);
  db.prepare(`
    INSERT INTO market_deal_alerts (
      watch_id, user_id, discord_id, claim_id, region_id, item_id, item_type,
      item_name, listing_key, baseline_window_days, baseline_average,
      discount_percent, dm_status, created_at, raw_json
    ) VALUES (?, ?, ?, 'claim', '19', '1', '0', 'Ore', 'listing', 30, 10, 25, 'sent', ?, '{}')
  `).run(Number(watch.lastInsertRowid), userId, "111111111111111111", now);
  db.prepare("INSERT INTO discord_craft_watches (guild_id, user_id, profession_key, profession_name, mode, updated_at) VALUES ('g', ?, 'smith', 'Smith', 'all', ?)").run("111111111111111111", now);
  db.prepare("INSERT INTO discord_component_votes (message_id, component_key, user_id, kind, updated_at) VALUES ('m', 'yes', ?, 'rsvp', ?)").run("111111111111111111", now);
  db.prepare("INSERT INTO discord_warnings (guild_id, user_id, moderator, reason, created_at) VALUES ('g', ?, 'Owner', 'warning', ?)").run("111111111111111111", now);
  db.prepare("INSERT INTO discord_mod_notes (guild_id, user_id, moderator, note, created_at) VALUES ('g', ?, 'Owner', 'note', ?)").run("111111111111111111", now);
  db.prepare("INSERT INTO discord_temp_bans (guild_id, user_id, unban_at, reason, created_at) VALUES ('g', ?, ?, 'ban', ?)").run("111111111111111111", "2026-07-26T12:00:00.000Z", now);
  db.prepare("INSERT INTO discord_mod_cases (guild_id, case_type, user_id, moderator, reason, details_json, occurred_at) VALUES ('g', 'warning', ?, 'Owner', ?, ?, ?)").run(
    "111111111111111111",
    "Case for Timber Wolf",
    JSON.stringify({ discordId: "111111111111111111", character: "Timber Wolf" }),
    now,
  );
  db.prepare("INSERT INTO admin_audit_log (user_id, username, action, details_json, occurred_at) VALUES (?, 'Thomas', 'privacy.test', ?, ?)").run(
    userId,
    JSON.stringify({ discordId: "111111111111111111", characterPlayerId: "12345678" }),
    now,
  );
  db.prepare(`
    INSERT INTO discord_delivery_log (
      event_type, status, summary, channel_id, channel_key, reason, error,
      metadata_json, response_json, occurred_at
    ) VALUES ('test', 'sent', ?, 'dm', 'dm', NULL, NULL, ?, NULL, ?)
  `).run("Sent to Thomas for Timber Wolf", JSON.stringify({ discordId: "111111111111111111" }), now);
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('access_control_json', ?, ?)").run(JSON.stringify({
    rules: {
      "page:market": { mode: "specificUsers", allowedDiscordIds: ["111111111111111111", "222222222222222222"] },
      "page:map": { mode: "specificUsers", allowedDiscordIds: ["111111111111111111"] },
      "page:members": { mode: "verified", allowedDiscordIds: [] },
    },
  }), now);
  return { db, userId, otherUserId, now };
}

test("full account deletion removes account data, de-identifies retained records, and preserves owner identity", () => {
  const { db, userId, otherUserId, now } = fixture();
  const receipt = deleteUserAccount(db, {
    userId,
    discordId: "111111111111111111",
    deletionKey: "test-deletion-key",
    now: () => new Date(now),
    randomUUID: () => "receipt-id",
  });
  const marker = deletedSubjectMarker("111111111111111111", "test-deletion-key");

  assert.equal(receipt.receiptId, "receipt-id");
  assert.equal(receipt.deleted.user_accounts, 1);
  assert.equal(receipt.deleted.user_sessions, 1);
  assert.equal(receipt.deleted.user_legal_acceptances, 1);
  assert.equal(receipt.deleted.market_deal_watches, 1);
  assert.equal(receipt.deleted.market_deal_alerts, 1);
  assert.equal(receipt.deleted.access_control_allowlist_entries, 2);
  assert.equal(receipt.anonymized.discord_mod_cases, 1);
  assert.equal(receipt.anonymized.admin_audit_log, 1);
  assert.equal(receipt.anonymized.discord_delivery_log, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_accounts WHERE id = ?").get(userId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plans WHERE owner_user_id = ?").get(userId).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM user_accounts WHERE id = ?").get(otherUserId).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM admin_users WHERE username = 'Thomas' AND role = 'owner' AND discord_id = '111111111111111111'").get().count, 1);
  assert.equal(db.prepare("SELECT user_id FROM discord_mod_cases").get().user_id, marker);
  const accessControl = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'access_control_json'").get().value);
  assert.deepEqual(accessControl.rules["page:market"].allowedDiscordIds, ["222222222222222222"]);
  assert.deepEqual(accessControl.rules["page:map"].allowedDiscordIds, []);
  assert.equal(accessControl.rules["page:members"].mode, "verified");
  const retainedText = JSON.stringify({
    moderation: db.prepare("SELECT * FROM discord_mod_cases").all(),
    audit: db.prepare("SELECT * FROM admin_audit_log").all(),
    delivery: db.prepare("SELECT * FROM discord_delivery_log").all(),
  });
  assert.doesNotMatch(retainedText, /111111111111111111|12345678|Timber Wolf|Thomas Bush/);
  db.close();
});

test("account deletion is idempotent and returns no raw identifiers", () => {
  const { db, userId, now } = fixture();
  deleteUserAccount(db, {
    userId,
    discordId: "111111111111111111",
    deletionKey: "test-deletion-key",
    now: () => new Date(now),
    randomUUID: () => "first",
  });
  const repeated = deleteUserAccount(db, {
    userId,
    discordId: "111111111111111111",
    deletionKey: "test-deletion-key",
    now: () => new Date(now),
    randomUUID: () => "second",
  });

  assert.deepEqual(repeated, { receiptId: "second", deletedAt: now, deleted: {}, anonymized: {} });
  assert.doesNotMatch(JSON.stringify(repeated), /111111111111111111/);
  db.close();
});
