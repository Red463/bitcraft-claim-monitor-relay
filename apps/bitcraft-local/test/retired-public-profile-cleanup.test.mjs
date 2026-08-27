import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import {
  dedicatedStateFingerprint,
  inspectRetiredPublicProfile,
  removeRetiredPublicProfileData,
  RETIRED_PUBLIC_PROFILE_TABLES,
} from "../src/server/retiredPublicProfileCleanup.mjs";

function readDedicatedSentinels(db) {
  return {
    settings: db.prepare("SELECT key, value FROM app_settings WHERE key = 'sentinel'").all(),
    plan: db.prepare("SELECT plan_key, config_json FROM craft_plan_settings WHERE plan_key = 'active'").all(),
    accounts: db.prepare("SELECT discord_id, character_status FROM user_accounts WHERE discord_id = 'dedicated-user'").all(),
    admins: db.prepare("SELECT username, role FROM admin_users WHERE username = 'dedicated-admin'").all(),
    history: db.prepare("SELECT claim_id, summary FROM activity_events WHERE claim_id = '42'").all(),
    audit: db.prepare("SELECT action FROM admin_audit_log WHERE action NOT LIKE 'public.%' ORDER BY action").all(),
    outbox: db.prepare("SELECT source_key, status FROM discord_notification_outbox WHERE source_key = 'dedicated-outbox'").all(),
  };
}

function seedMixedData(db) {
  const now = "2026-08-27T12:00:00.000Z";
  db.exec(`
    CREATE TABLE public_user_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT NOT NULL UNIQUE,
      discord_username TEXT,
      settings_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE public_user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES public_user_accounts(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE public_user_legal_acceptances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES public_user_accounts(id) ON DELETE CASCADE,
      legal_version TEXT NOT NULL,
      terms_digest TEXT NOT NULL,
      privacy_digest TEXT NOT NULL,
      age_confirmed INTEGER NOT NULL,
      accepted_at TEXT NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE public_craft_plans (
      id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES public_user_accounts(id) ON DELETE RESTRICT,
      claim_id TEXT NOT NULL,
      title TEXT NOT NULL,
      document_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      document_revision INTEGER NOT NULL DEFAULT 1,
      access_revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE public_craft_plan_members (
      plan_id TEXT NOT NULL REFERENCES public_craft_plans(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES public_user_accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (plan_id, user_id)
    );
    CREATE TABLE public_craft_plan_invites (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES public_craft_plans(id) ON DELETE CASCADE,
      created_by_user_id INTEGER NOT NULL REFERENCES public_user_accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE public_craft_plan_share_links (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES public_craft_plans(id) ON DELETE CASCADE,
      created_by_user_id INTEGER NOT NULL REFERENCES public_user_accounts(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE public_craft_plan_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL REFERENCES public_craft_plans(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES public_user_accounts(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('sentinel', 'preserve', ?)").run(now);
  db.prepare("INSERT INTO craft_plan_settings (plan_key, config_json, created_at, updated_at) VALUES ('active', '{}', ?, ?)").run(now, now);
  db.prepare("INSERT INTO user_accounts (discord_id, character_status, settings_json, created_at) VALUES ('dedicated-user', 'unlinked', '{}', ?)").run(now);
  db.prepare("INSERT INTO admin_users (username, password_hash, role, created_at) VALUES ('dedicated-admin', 'hash', 'owner', ?)").run(now);
  db.prepare("INSERT INTO activity_events (claim_id, event_type, summary, occurred_at, metadata_json) VALUES ('42', 'sentinel', 'Preserve history', ?, '{}')").run(now);
  db.prepare("INSERT INTO discord_notification_outbox (source_key, event_type, summary, occurred_at, metadata_json, next_attempt_at, created_at, updated_at) VALUES ('dedicated-outbox', 'sentinel', 'Preserve notification', ?, '{}', ?, ?, ?)").run(now, now, now, now);
  db.prepare("INSERT INTO admin_audit_log (username, action, details_json, occurred_at) VALUES ('dedicated-admin', 'settings.updated', '{}', ?)").run(now);
  db.prepare("INSERT INTO admin_audit_log (username, action, details_json, occurred_at) VALUES ('dedicated-admin', 'public.plan.suspended', '{}', ?)").run(now);

  const publicUserId = Number(db.prepare("INSERT INTO public_user_accounts (discord_id, discord_username, settings_json, created_at) VALUES ('public-user', 'Public User', '{}', ?)").run(now).lastInsertRowid);
  db.prepare("INSERT INTO public_user_sessions (token_hash, user_id, expires_at, created_at) VALUES ('public-session', ?, ?, ?)").run(publicUserId, now, now);
  db.prepare("INSERT INTO public_user_legal_acceptances (user_id, legal_version, terms_digest, privacy_digest, age_confirmed, accepted_at, source) VALUES (?, 'v1', 'terms', 'privacy', 1, ?, 'oauth')").run(publicUserId, now);
  db.prepare("INSERT INTO public_craft_plans (id, owner_user_id, claim_id, title, document_json, created_at, updated_at) VALUES ('public-plan', ?, '42', 'Retired', '{}', ?, ?)").run(publicUserId, now, now);
  db.prepare("INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at) VALUES ('public-plan', ?, 'editor', ?, ?)").run(publicUserId, now, now);
  db.prepare("INSERT INTO public_craft_plan_invites (id, plan_id, created_by_user_id, role, token_hash, expires_at, created_at) VALUES ('invite', 'public-plan', ?, 'viewer', 'invite-token', ?, ?)").run(publicUserId, now, now);
  db.prepare("INSERT INTO public_craft_plan_share_links (id, plan_id, created_by_user_id, label, token_hash, created_at) VALUES ('share', 'public-plan', ?, 'Share', 'share-token', ?)").run(publicUserId, now);
  db.prepare("INSERT INTO public_craft_plan_events (plan_id, actor_user_id, event_type, payload_json, created_at) VALUES ('public-plan', ?, 'created', '{}', ?)").run(publicUserId, now);
}

test("retired public profile cleanup removes only public data and is idempotent", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  seedMixedData(db);
  assert.deepEqual(inspectRetiredPublicProfile(db), {
    tables: [...RETIRED_PUBLIC_PROFILE_TABLES].reverse().map((name) => ({ name, rows: 1 })).sort((a, b) => a.name.localeCompare(b.name)),
    publicAuditRows: 1,
  });
  const before = readDedicatedSentinels(db);
  const dedicatedBefore = dedicatedStateFingerprint(db);

  const result = removeRetiredPublicProfileData(db);
  assert.equal(result.deletedAuditRows, 1);
  assert.deepEqual(inspectRetiredPublicProfile(db), { tables: [], publicAuditRows: 0 });
  assert.deepEqual(readDedicatedSentinels(db), before);
  assert.deepEqual(dedicatedStateFingerprint(db), dedicatedBefore);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");

  const repeated = removeRetiredPublicProfileData(db);
  assert.equal(repeated.deletedAuditRows, 0);
  assert.deepEqual(repeated.before, { tables: [], publicAuditRows: 0 });
  assert.deepEqual(repeated.after, { tables: [], publicAuditRows: 0 });
  assert.deepEqual(readDedicatedSentinels(db), before);
  db.close();
});

test("dedicated fingerprint detects settings, plan, and row-count drift without exposing values", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  seedMixedData(db);
  const before = dedicatedStateFingerprint(db);
  assert.match(before.appSettingsSha256, /^[0-9a-f]{64}$/);
  assert.match(before.craftPlanSha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(before), /preserve|dedicated-user|dedicated-admin/);

  db.prepare("UPDATE app_settings SET value = 'changed' WHERE key = 'sentinel'").run();
  assert.notEqual(dedicatedStateFingerprint(db).appSettingsSha256, before.appSettingsSha256);
  db.close();
});
