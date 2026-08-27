import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as filesystem from "node:fs";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  applyCanonicalCutoverManifest,
  createCanonicalCutoverManifest,
  createCanonicalCutoverDurability,
  readCanonicalCutoverManifest,
  verifyAppliedCanonicalCutoverManifest,
} from "../src/server/canonicalCutoverMigration.mjs";
import {
  createCanonicalCutoverPrivacyPlan,
  createCanonicalCutoverPrivacyReadinessArtifact,
  prepareCanonicalCutoverPrivacyApply,
} from "../src/server/canonicalCutoverPrivacy.mjs";
import {
  deletionLedgerSubject,
  readDeletionLedger,
  signDeletionLedgerRecord,
} from "../src/server/privacyDeletionLedger.mjs";
import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import {
  applyContributionProfessionRepair,
  createContributionProfessionManifest,
} from "../src/server/contributionProfessionRepair.mjs";

const CLAIM_ID = "1369094286777412590";
const SCRIPT_PATH = fileURLToPath(new URL("../../../scripts/repair-relay-canonical-cutover.mjs", import.meta.url));
const MIGRATION_MODULE_PATH = fileURLToPath(new URL("../src/server/canonicalCutoverMigration.mjs", import.meta.url));

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const WEBP_BYTES = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
const PASSWORD_HASH = `scrypt:${"a".repeat(32)}:${"b".repeat(128)}`;
const SOURCE_PRIVACY_KEY = Buffer.alloc(32, 31).toString("base64url");
const TARGET_PRIVACY_KEY = Buffer.alloc(32, 47).toString("base64url");
const PRIVACY_MANIFEST_CREATED_AT = "2026-08-09T12:00:00.000Z";
const PRIVACY_TEST_BASE_MS = Date.now();
const PRIVACY_RECORD_OCCURRED_AT = new Date(PRIVACY_TEST_BASE_MS - 24 * 60 * 60 * 1000).toISOString();
const PRIVACY_RECORD_EXPIRES_AT = new Date(PRIVACY_TEST_BASE_MS + 89 * 24 * 60 * 60 * 1000).toISOString();
const PRIVACY_EXPIRED_AT = new Date(PRIVACY_TEST_BASE_MS - 60 * 1000).toISOString();
const PRIVACY_EXPIRED_OCCURRED_AT = new Date(PRIVACY_TEST_BASE_MS - (89 * 24 * 60 * 60 * 1000) - 60 * 1000).toISOString();

test("canonical database fingerprints stream files instead of buffering whole SQLite databases", () => {
  const source = readFileSync(MIGRATION_MODULE_PATH, "utf8");
  assert.match(source, /function sha256File\(/);
  assert.match(source, /readSync\(/);
  assert.doesNotMatch(source, /sha256\(readFileSync\((?:options\.(?:source|target)DatabasePath|paths\.sourcePath)\)\)/);
});

const SOURCE_SETTINGS = Object.freeze({
  claim_id: CLAIM_ID,
  bitcraft_sync_url: "https://old.invalid/api",
  theme_json: JSON.stringify({ accent: "#123456" }),
  refresh_seconds: "33",
  server_refresh_seconds: "44",
  default_page: "members",
  default_region: "777",
  active_region_overrides: "777 888",
  excluded_member_ids_json: JSON.stringify(["901", "902"]),
  visitor_security_json: JSON.stringify({ fullIpRetentionDays: 3, geoipLicenseKey: "private-license" }),
  toast_json: JSON.stringify({ marketSales: false }),
  market_deal_watch_json: JSON.stringify({ maxWatchesPerUser: 7 }),
  discord_json: JSON.stringify({ guildId: "123", channelId: "456" }),
  branding_json: JSON.stringify({
    logo: {
      fileName: "logo.png",
      contentType: "image/png",
      updatedAt: "2026-08-01T00:00:00.000Z",
      url: "/api/local/branding/logo",
    },
  }),
  app_popups_json: JSON.stringify({ popups: [{ id: "notice" }] }),
  access_control_json: JSON.stringify({ accounts: { "111": { pages: ["members"] } } }),
});

const EXPLICIT_PROTECTED_TABLES = Object.freeze([
  "market_events",
  "market_trades",
  "activity_events",
  "settlement_state_current",
  "domain_payload_current",
  "provider_source_health",
  "provider_subscription_health",
  "provider_transition_outbox",
  "production_jobs",
  "production_contributions",
  "production_contribution_events",
  "craft_plan_progress_audit_snapshots",
  "craft_plan_progress_audit_events",
  "craft_plan_progress_audit_state",
  "market_deal_alerts",
  "admin_login_events",
  "analytics_events",
  "visitor_security_events",
  "geoip_ranges",
  "visitor_geoip_cache",
  "discord_delivery_log",
  "discord_notification_outbox",
]);

const APPROVED_TABLES = new Set([
  "user_accounts", "user_sessions", "user_legal_acceptances", "admin_users", "admin_sessions",
  "app_settings", "app_secrets", "craft_plan_settings", "craft_plans", "market_deal_watches", "scheduled_jobs",
  "admin_audit_log", "discord_youtube_channels", "discord_youtube_videos", "discord_craft_watches",
  "discord_mod_cases", "discord_warnings", "discord_mod_notes", "discord_custom_commands",
  "discord_component_votes", "discord_component_messages", "discord_temp_bans",
  "discord_craft_plan_report_occurrences",
]);

function addMigratedColumns(db) {
  for (const [column, definition] of [
    ["active", "INTEGER NOT NULL DEFAULT 1"],
    ["last_login_at", "TEXT"],
    ["discord_id", "TEXT"],
    ["discord_username", "TEXT"],
    ["discord_global_name", "TEXT"],
    ["discord_avatar", "TEXT"],
  ]) {
    if (!db.prepare("PRAGMA table_info(admin_users)").all().some((entry) => entry.name === column)) {
      db.exec(`ALTER TABLE admin_users ADD COLUMN ${column} ${definition}`);
    }
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_discord_id ON admin_users (discord_id) WHERE discord_id IS NOT NULL AND discord_id <> ''");
}

function finishDatabase(db) {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

function insertSetting(db, key, value, updatedAt = "2026-08-01T00:00:00.000Z") {
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(key, value, updatedAt);
}

function createFixture({ liveSourceSchemas = false } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "canonical-cutover-"));
  const sourceDatabasePath = path.join(directory, "old.sqlite");
  const targetDatabasePath = path.join(directory, "relay.sqlite");
  const sourceBrandingDirectory = path.join(directory, "old-branding");
  const targetBrandingDirectory = path.join(directory, "relay-branding");
  const sourceConfigRoot = path.join(directory, "old-config");
  const targetConfigRoot = path.join(directory, "relay-config");
  const sourceBackupRoot = path.join(directory, "old-backups");
  const targetBackupRoot = path.join(directory, "relay-backups");
  const sourceKeyFilePath = path.join(sourceConfigRoot, "privacy.key");
  const targetKeyFilePath = path.join(targetConfigRoot, "privacy.key");
  const sourceLedgerPath = path.join(sourceBackupRoot, "privacy.jsonl");
  const targetLedgerPath = path.join(targetBackupRoot, "privacy.jsonl");
  const installedPreviousKeyFilePath = path.join(targetConfigRoot, "privacy-previous-old.key");
  const privacyReadinessArtifactPath = path.join(targetBackupRoot, "privacy-cutover-ready.json");
  mkdirSync(sourceBrandingDirectory);
  mkdirSync(targetBrandingDirectory);
  for (const root of [sourceConfigRoot, targetConfigRoot, sourceBackupRoot, targetBackupRoot]) mkdirSync(root);
  writeFileSync(sourceKeyFilePath, `${SOURCE_PRIVACY_KEY}\n`, { mode: 0o600 });
  writeFileSync(targetKeyFilePath, `${TARGET_PRIVACY_KEY}\n`, { mode: 0o600 });
  writeFileSync(targetLedgerPath, "", { mode: 0o600 });

  const source = new DatabaseSync(sourceDatabasePath);
  const target = new DatabaseSync(targetDatabasePath);
  applySchemaBootstrap(source);
  applySchemaBootstrap(target);
  addMigratedColumns(source);
  addMigratedColumns(target);
  if (liveSourceSchemas) {
    source.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE user_accounts;
      CREATE TABLE user_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT NOT NULL UNIQUE,
        discord_username TEXT,
        discord_global_name TEXT,
        discord_avatar TEXT,
        character_player_id TEXT,
        character_name TEXT,
        character_status TEXT NOT NULL DEFAULT 'unlinked',
        settings_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        last_login_at TEXT
      , inactivity_warning_sent_at TEXT);
      CREATE INDEX idx_user_accounts_status ON user_accounts (character_status, last_login_at DESC);
      DROP TABLE admin_users;
      CREATE TABLE admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      , active INTEGER NOT NULL DEFAULT 1, last_login_at TEXT, role TEXT NOT NULL DEFAULT 'owner', discord_id TEXT, discord_username TEXT, discord_global_name TEXT, discord_avatar TEXT);
      CREATE UNIQUE INDEX idx_admin_users_discord_id ON admin_users (discord_id) WHERE discord_id IS NOT NULL AND discord_id <> '';
      DROP TABLE discord_youtube_channels;
      CREATE TABLE discord_youtube_channels (
        channel_id TEXT PRIMARY KEY,
        input TEXT NOT NULL,
        title TEXT,
        url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_checked_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        last_video_id TEXT,
        last_video_title TEXT,
        last_video_published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      , discord_channel_id TEXT);
      PRAGMA foreign_keys = ON;
    `);
  }

  for (const [key, value] of Object.entries(SOURCE_SETTINGS)) insertSetting(source, key, value);
  insertSetting(source, "source_only_setting", "must-not-migrate");
  insertSetting(target, "claim_id", CLAIM_ID);
  insertSetting(target, "branding_json", JSON.stringify({
    favicon: {
      fileName: "favicon.webp",
      contentType: "image/webp",
      updatedAt: "2026-07-01T00:00:00.000Z",
      url: "/api/local/branding/favicon",
    },
  }));
  insertSetting(target, "target_only_setting", "keep-me");
  insertSetting(target, "cutover_marker_owned_by_task_4", "keep-marker");

  source.prepare(`
    INSERT INTO user_accounts (
      id, discord_id, discord_username, discord_global_name, discord_avatar,
      character_player_id, character_name, character_status, settings_json,
      created_at, last_login_at, inactivity_warning_sent_at
    ) VALUES (10, '111', 'old-user', 'Old User', 'old-avatar', '901', 'Old Character',
      'approved', '{"dense":true}', '2025-01-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
  `).run();
  source.prepare(`
    INSERT INTO user_accounts (
      id, discord_id, discord_username, discord_global_name, discord_avatar,
      character_player_id, character_name, character_status, settings_json,
      created_at, last_login_at, inactivity_warning_sent_at
    ) VALUES (20, '222', 'new-old-user', 'New Old User', 'avatar-222', '902',
      'Second Character', 'pending', '{"compact":true}', '2025-02-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z', NULL)
  `).run();
  target.prepare(`
    INSERT INTO user_accounts (
      id, discord_id, discord_username, discord_global_name, discord_avatar,
      character_player_id, character_name, character_status, settings_json,
      created_at, last_login_at, inactivity_warning_sent_at
    ) VALUES (1, '111', 'relay-user', 'Relay User', 'relay-avatar', NULL, NULL,
      'unlinked', '{}', '2026-01-01T00:00:00.000Z', NULL, NULL)
  `).run();
  target.prepare(`
    INSERT INTO user_accounts (
      id, discord_id, discord_username, discord_global_name, discord_avatar,
      character_player_id, character_name, character_status, settings_json,
      created_at, last_login_at, inactivity_warning_sent_at
    ) VALUES (2, '999', 'relay-only', 'Relay Only', NULL, NULL, NULL,
      'unlinked', '{"relay":true}', '2026-02-01T00:00:00.000Z', NULL, NULL)
  `).run();

  source.prepare(`
    INSERT INTO user_legal_acceptances
      (id, user_id, legal_version, terms_digest, privacy_digest, age_confirmed, accepted_at, source)
    VALUES
      (100, 10, 'v1', 'terms-1', 'privacy-1', 1, '2026-01-01T00:00:00.000Z', 'oauth'),
      (101, 20, 'v2', 'terms-2', 'privacy-2', 1, '2026-02-01T00:00:00.000Z', 'existing-session')
  `).run();
  target.prepare(`
    INSERT INTO user_legal_acceptances
      (id, user_id, legal_version, terms_digest, privacy_digest, age_confirmed, accepted_at, source)
    VALUES
      (1, 1, 'v1', 'terms-1', 'privacy-1', 1, '2026-01-01T00:00:00.000Z', 'oauth'),
      (2, 2, 'relay-v1', 'relay-terms', 'relay-privacy', 1, '2026-03-01T00:00:00.000Z', 'oauth')
  `).run();
  source.prepare("INSERT INTO user_sessions VALUES ('source-session', 10, '2099-01-01', '2026-01-01', NULL)").run();
  target.prepare("INSERT INTO user_sessions VALUES ('target-session', 1, '2099-01-01', '2026-01-01', NULL)").run();

  source.prepare(`
    INSERT INTO admin_users
      (id, username, password_hash, role, created_at, active, last_login_at, discord_id,
       discord_username, discord_global_name, discord_avatar)
    VALUES
      (10, 'owner', ?, 'owner', '2025-01-01', 1, '2026-08-01', '111', 'old-owner', 'Old Owner', 'old-admin-avatar'),
      (20, 'old-moderator', ?, 'moderator', '2025-02-01', 0, NULL, '222', 'old-mod', 'Old Mod', NULL)
  `).run(PASSWORD_HASH, PASSWORD_HASH);
  target.prepare(`
    INSERT INTO admin_users
      (id, username, password_hash, role, created_at, active, last_login_at, discord_id,
       discord_username, discord_global_name, discord_avatar)
    VALUES
      (2, 'owner', ?, 'viewer', '2026-01-01', 1, NULL, '111', 'relay-owner', 'Relay Owner', NULL),
      (3, 'relay-admin', ?, 'owner', '2026-02-01', 1, NULL, '999', 'relay-admin', 'Relay Admin', NULL)
  `).run(PASSWORD_HASH.replaceAll("b", "c"), PASSWORD_HASH.replaceAll("b", "d"));
  source.prepare("INSERT INTO admin_sessions VALUES ('source-admin-session', 10, '2099-01-01', '2026-01-01')").run();
  target.prepare("INSERT INTO admin_sessions VALUES ('target-admin-session', 3, '2099-01-01', '2026-01-01')").run();

  source.prepare("INSERT INTO craft_plan_settings VALUES ('active', '{\"source\":true}', '2025-01-01', '2026-08-01')").run();
  source.prepare("INSERT INTO craft_plan_settings VALUES ('old-extra', '{\"old\":true}', '2025-02-01', '2026-08-02')").run();
  target.prepare("INSERT INTO craft_plan_settings VALUES ('active', '{\"target\":true}', '2026-01-01', '2026-07-01')").run();
  target.prepare("INSERT INTO craft_plan_settings VALUES ('relay-only', '{\"relay\":true}', '2026-02-01', '2026-07-02')").run();

  source.prepare(`
    INSERT INTO market_deal_watches
      (id, user_id, discord_id, claim_id, region_id, item_id, item_type, item_name,
       threshold_percent, enabled, last_checked_at, last_alert_at, created_at, updated_at)
    VALUES
      (10, 10, '111', ?, '777', '42', '0', 'Old Item', 21, 1, 'source-check', 'source-alert', '2025-01-01', '2026-08-01'),
      (11, 20, '222', ?, '888', '42', '1', 'Old Cargo', 22, 1, NULL, NULL, '2025-02-01', '2026-08-02')
  `).run(CLAIM_ID, CLAIM_ID);
  target.prepare(`
    INSERT INTO market_deal_watches
      (id, user_id, discord_id, claim_id, region_id, item_id, item_type, item_name,
       threshold_percent, enabled, last_checked_at, last_alert_at, created_at, updated_at)
    VALUES
      (7, 1, '111', ?, '777', '42', '0', 'Relay Item', 99, 0, 'relay-check', 'relay-alert', '2026-01-01', '2026-07-01'),
      (9, 2, '999', ?, '999', '99', '0', 'Relay Only Item', 30, 1, NULL, NULL, '2026-02-01', '2026-07-02')
  `).run(CLAIM_ID, CLAIM_ID);
  target.prepare(`
    INSERT INTO market_deal_alerts
      (id, watch_id, user_id, discord_id, claim_id, region_id, item_id, item_type,
       item_name, listing_key, baseline_window_days, baseline_average, discount_percent,
       dm_status, created_at, raw_json)
    VALUES (50, 7, 1, '111', ?, '777', '42', '0', 'Relay Item', 'listing-1',
      7, '100', 40, 'sent', '2026-07-01', '{}')
  `).run(CLAIM_ID);

  source.prepare(`
    INSERT INTO scheduled_jobs
      (job_key, label, description, schedule, enabled, last_run_at, last_success_at,
       last_error, next_run_at, running, metadata_json, updated_at)
    VALUES
      ('shared-job', 'Old Label', 'Old Description', '*/9 * * * *', 0, 'old-run',
       'old-success', 'old-error', 'old-next', 1, '{"source":true}', '2026-08-01'),
      ('retired-source-job', 'Retired', 'Retired', '* * * * *', 1, NULL, NULL, NULL,
       NULL, 0, '{}', '2026-08-01')
  `).run();
  target.prepare(`
    INSERT INTO scheduled_jobs
      (job_key, label, description, schedule, enabled, last_run_at, last_success_at,
       last_error, next_run_at, running, metadata_json, updated_at)
    VALUES
      ('shared-job', 'Relay Label', 'Relay Description', '*/5 * * * *', 1, 'relay-run',
       'relay-success', 'relay-error', 'relay-next', 1, '{"target":true}', '2026-07-01'),
      ('relay-only-job', 'Relay Only', 'Keep all', '*/3 * * * *', 1, 'keep-run',
       'keep-success', NULL, 'keep-next', 0, '{"keep":true}', '2026-07-02')
  `).run();

  seedDiscordPreviewState(source, "source");
  seedDiscordPreviewState(target, "target");

  target.prepare("INSERT INTO admin_audit_log VALUES (1, 3, 'relay-admin', 'relay.action', '{}', '2026-01-01')").run();
  target.prepare("INSERT INTO admin_audit_log VALUES (2, 2, 'owner', 'old.action', '{\"safe\":true}', '2025-01-01')").run();
  source.prepare("INSERT INTO admin_audit_log VALUES (10, 10, 'owner', 'old.action', '{\"safe\":true}', '2025-01-01')").run();
  source.prepare("INSERT INTO admin_audit_log VALUES (11, 999, 'removed', 'old.orphan', '{}', '2025-01-02')").run();
  source.prepare("INSERT INTO admin_audit_log VALUES (12, 999, 'removed', 'old.orphan', '{}', '2025-01-02')").run();

  seedProtectedState(target);

  source.prepare("INSERT INTO app_secrets (key, value, updated_at) VALUES ('discord_bot_token', ?, ?)")
    .run("super-secret-token", "2026-08-01T00:00:00.000Z");
  source.prepare("INSERT INTO app_secrets (key, value, updated_at) VALUES ('oauth_state_secret', ?, ?)")
    .run("must-never-migrate", "2026-08-01T00:00:00.000Z");
  target.prepare("INSERT INTO app_secrets (key, value, updated_at) VALUES ('oauth_state_secret', ?, ?)")
    .run("keep-target-oauth", "2026-07-01T00:00:00.000Z");
  target.prepare("INSERT INTO app_secrets (key, value, updated_at) VALUES ('privacy_ledger_key', ?, ?)")
    .run("keep-target-privacy", "2026-07-01T00:00:00.000Z");

  writeFileSync(path.join(sourceBrandingDirectory, "logo.png"), PNG_BYTES);
  writeFileSync(path.join(sourceBrandingDirectory, "ignored.txt"), "ignore me");
  writeFileSync(path.join(targetBrandingDirectory, "favicon.webp"), WEBP_BYTES);

  finishDatabase(source);
  finishDatabase(target);
  return {
    directory,
    sourceDatabasePath,
    targetDatabasePath,
    sourceBrandingDirectory,
    targetBrandingDirectory,
    sourceConfigRoot,
    targetConfigRoot,
    sourceBackupRoot,
    targetBackupRoot,
    sourceKeyFilePath,
    targetKeyFilePath,
    sourceLedgerPath,
    targetLedgerPath,
    installedPreviousKeyFilePath,
    privacyReadinessArtifactPath,
  };
}

function seedDiscordPreviewState(db, prefix) {
  const digit = prefix === "source" ? "1" : "9";
  db.prepare("INSERT INTO discord_youtube_channels (channel_id, input, discord_channel_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(`${prefix}-youtube`, `${prefix}-input`, `${digit}01`, `${prefix}-created`, `${prefix}-updated`);
  db.prepare("INSERT INTO discord_youtube_videos (video_id, channel_id, title, url, seen_at) VALUES (?, ?, ?, ?, ?)")
    .run(`${prefix}-video`, `${prefix}-youtube`, `${prefix}-title`, `https://${prefix}.invalid`, `${prefix}-seen`);
  db.prepare("INSERT INTO discord_craft_watches (id, guild_id, user_id, profession_key, profession_name, mode, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(Number(digit), `${digit}02`, `${digit}03`, `${prefix}-profession`, `${prefix}-profession`, "single", `${prefix}-updated`);
  db.prepare("INSERT INTO discord_mod_cases (id, guild_id, case_type, user_id, moderator, details_json, occurred_at) VALUES (?, ?, 'note', ?, ?, '{}', ?)")
    .run(Number(digit), `${digit}04`, `${digit}05`, `${prefix}-moderator`, `${prefix}-occurred`);
  db.prepare("INSERT INTO discord_warnings (id, guild_id, user_id, moderator, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(Number(digit), `${digit}06`, `${digit}07`, `${prefix}-moderator`, `${prefix}-reason`, `${prefix}-created`);
  db.prepare("INSERT INTO discord_mod_notes (id, guild_id, user_id, moderator, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(Number(digit), `${digit}08`, `${digit}09`, `${prefix}-moderator`, `${prefix}-note`, `${prefix}-created`);
  db.prepare("INSERT INTO discord_custom_commands VALUES (?, ?, ?, ?)")
    .run(`${prefix}-command`, `${prefix}-description`, `${prefix}-response`, `${prefix}-updated`);
  db.prepare("INSERT INTO discord_component_votes VALUES (?, ?, ?, ?, ?)")
    .run(`${digit}10`, `${prefix}-component`, `${digit}11`, "up", `${prefix}-updated`);
  db.prepare("INSERT INTO discord_component_messages VALUES (?, ?, ?, ?)")
    .run(`${digit}12`, "poll", JSON.stringify({ prefix }), `${prefix}-updated`);
  db.prepare("INSERT INTO discord_temp_bans VALUES (?, ?, ?, ?, ?)")
    .run(`${digit}13`, `${digit}14`, `${prefix}-unban`, `${prefix}-reason`, `${prefix}-created`);
  db.prepare("INSERT INTO discord_craft_plan_report_occurrences VALUES (?, ?, ?, 'sent', ?, NULL, ?, ?)")
    .run(`${prefix}-rule`, `${prefix}-occurrence`, `${prefix}-scheduled`, `${digit}15`, `${prefix}-created`, `${prefix}-updated`);
}

function seedProtectedState(db) {
  db.prepare("INSERT INTO settlement_state_current (claim_id, captured_at, updated_at) VALUES (?, 'relay-captured', 'relay-updated')").run(CLAIM_ID);
  db.prepare("INSERT INTO market_events (id, claim_id, event_type, listing_key, item_name, occurred_at, raw_json) VALUES (1, ?, 'sale', 'relay-listing', 'Relay Item', 'relay-time', '{}')").run(CLAIM_ID);
  db.prepare("INSERT INTO market_trades (trade_id, claim_id, item_name, quantity, unit_price, total_price, occurred_at, imported_at, raw_json) VALUES ('relay-trade', ?, 'Relay Item', '1', '2', '2', 'relay-time', 'relay-import', '{}')").run(CLAIM_ID);
  db.prepare("INSERT INTO activity_events (id, claim_id, event_type, summary, occurred_at, metadata_json) VALUES (1, ?, 'relay', 'Relay history', 'relay-time', '{}')").run(CLAIM_ID);
  db.prepare(`
    INSERT INTO domain_payload_current
      (claim_id, domain, data_json, collected_at, last_attempt_at, last_success_at,
       updated_at, provider, freshness, confidence, generation, warnings_json)
    VALUES (?, 'members', '{"relay":true}', 'relay-time', 'relay-time', 'relay-time',
      'relay-time', 'relay', 'fresh', 'high', 7, '[]')
  `).run(CLAIM_ID);
  db.prepare("INSERT INTO provider_source_health (provider, source_key, ready, details_json, updated_at) VALUES ('relay', 'primary', 1, '{}', 'relay-time')").run();
  db.prepare("INSERT INTO provider_subscription_health (provider, source_key, domain, connected, updated_at) VALUES ('relay', 'primary', 'members', 1, 'relay-time')").run();
  db.prepare("INSERT INTO provider_transition_outbox (transition_key, claim_id, domain, observed_at, payload_json, created_at, updated_at) VALUES ('relay-transition', ?, 'members', 'relay-time', '{}', 'relay-time', 'relay-time')").run(CLAIM_ID);
  db.prepare("INSERT INTO game_catalog_entities (catalog_key, kind, target_id, updated_at) VALUES ('item:1', 'item', '1', 'relay-time')").run();
  db.prepare("INSERT INTO production_jobs (job_key, claim_id, label, first_seen, last_seen, status, raw_json) VALUES ('relay-production', ?, 'Relay Production', 'relay-time', 'relay-time', 'active', '{}')").run(CLAIM_ID);
  db.prepare("INSERT INTO production_contributions (contribution_key, claim_id, craft_entity_id, contributor_name, first_seen, updated_at, raw_json) VALUES ('relay-contribution', ?, 'craft-1', 'Relay User', 'relay-time', 'relay-time', '{}')").run(CLAIM_ID);
  db.prepare("INSERT INTO production_contribution_events (source_key, claim_id, region_id, craft_entity_id, contributed_progress, contributed_xp, occurred_at, received_at, raw_json) VALUES ('relay-event', ?, '777', 'craft-1', '1', '2', 'relay-time', 'relay-time', '{}')").run(CLAIM_ID);
  db.prepare("INSERT INTO craft_plan_progress_audit_snapshots (id, claim_id, captured_at, baseline_revision, fingerprint, payload_gzip, app_version, build_id) VALUES (1, ?, 'relay-time', 'rev', 'fp', X'00', '0.53.0-beta.1', 'sha')").run(CLAIM_ID);
  db.prepare("INSERT INTO craft_plan_progress_audit_events (id, claim_id, captured_at, event_type, summary, payload_json) VALUES (1, ?, 'relay-time', 'relay', 'Relay audit', '{}')").run(CLAIM_ID);
  db.prepare("INSERT INTO craft_plan_progress_audit_state (claim_id, updated_at) VALUES (?, 'relay-time')").run(CLAIM_ID);
  db.prepare("INSERT INTO admin_login_events (id, username, successful, occurred_at) VALUES (1, 'relay-admin', 1, 'relay-time')").run();
  db.prepare("INSERT INTO analytics_events (id, visitor_key, session_key, event_name, page, properties_json, occurred_at) VALUES (1, 'visitor', 'session', 'view', 'dashboard', '{}', 'relay-time')").run();
  db.prepare("INSERT INTO visitor_security_events (id, occurred_at, method, route_group, status_code, status_class, ip_anonymized, ip_hash, visitor_key) VALUES (1, 'relay-time', 'GET', 'public', 200, '2xx', '127.0.0.0', 'hash', 'visitor')").run();
  db.prepare("INSERT INTO geoip_ranges VALUES (1, 2, 'GB', 'London', 'relay-time')").run();
  db.prepare("INSERT INTO visitor_geoip_cache VALUES ('ip-hash', '127.0.0.0', 'relay', 'GB', 'London', 'relay-time', 'relay-expiry', NULL)").run();
  db.prepare("INSERT INTO discord_delivery_log (id, event_type, status, metadata_json, occurred_at) VALUES (1, 'relay', 'sent', '{}', 'relay-time')").run();
  db.prepare("INSERT INTO discord_notification_outbox (id, source_key, event_type, summary, occurred_at, metadata_json, next_attempt_at, created_at, updated_at) VALUES (1, 'relay-outbox', 'relay', 'Relay pending', 'relay-time', '{}', 'relay-next', 'relay-time', 'relay-time')").run();
}

function dryRunArguments(fixture, manifestPath) {
  return [
    "--dry-run",
    "--source-db", fixture.sourceDatabasePath,
    "--target-db", fixture.targetDatabasePath,
    "--source-branding", fixture.sourceBrandingDirectory,
    "--target-branding", fixture.targetBrandingDirectory,
    "--source-privacy-ledger", fixture.sourceLedgerPath,
    "--target-privacy-ledger", fixture.targetLedgerPath,
    "--source-privacy-key", fixture.sourceKeyFilePath,
    "--target-privacy-key", fixture.targetKeyFilePath,
    "--installed-previous-privacy-key", fixture.installedPreviousKeyFilePath,
    "--privacy-key-ready-artifact", fixture.privacyReadinessArtifactPath,
    "--source-config-root", fixture.sourceConfigRoot,
    "--target-config-root", fixture.targetConfigRoot,
    "--source-backup-root", fixture.sourceBackupRoot,
    "--target-backup-root", fixture.targetBackupRoot,
    "--claim-id", CLAIM_ID,
    "--manifest", manifestPath,
  ];
}

function runScript(arguments_) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...arguments_], {
    encoding: "utf8",
  });
}

function databaseRows(db, table) {
  return db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all().map((row) => ({ ...row }));
}

function mutateDatabase(databasePath, callback) {
  const db = new DatabaseSync(databasePath);
  callback(db);
  finishDatabase(db);
}

function rewriteMarketWatchAverageAffinity(databasePath, affinity) {
  mutateDatabase(databasePath, (db) => {
    const createSql = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'market_deal_watches'").get().sql
      .replace("last_baseline_average TEXT", `last_baseline_average ${affinity}`);
    const columns = db.prepare("PRAGMA table_info(market_deal_watches)").all().map((column) => `"${column.name}"`).join(", ");
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`CREATE TEMP TABLE saved_market_deal_watches AS SELECT * FROM market_deal_watches;
      DROP TABLE market_deal_watches;`);
    db.exec(createSql);
    db.exec(`INSERT INTO market_deal_watches (${columns}) SELECT ${columns} FROM saved_market_deal_watches;
      DROP TABLE saved_market_deal_watches;
      CREATE INDEX IF NOT EXISTS idx_market_deal_watches_user ON market_deal_watches (user_id, enabled, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_market_deal_watches_scan ON market_deal_watches (claim_id, region_id, enabled, item_id, item_type);`);
  });
}

function createManifest(fixture, name = "manifest.json") {
  const manifestPath = path.join(fixture.directory, name);
  const result = runScript(dryRunArguments(fixture, manifestPath));
  assert.equal(result.status, 0, result.stderr);
  return manifestPath;
}

function task4ReadinessArguments(fixture, manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(
    fixture.installedPreviousKeyFilePath,
    readFileSync(fixture.sourceKeyFilePath),
    { mode: 0o600 },
  );
  const artifact = createCanonicalCutoverPrivacyReadinessArtifact(
    manifest.privacyDeletionLedger,
    manifest.selectionHash,
  );
  writeFileSync(fixture.privacyReadinessArtifactPath, `${JSON.stringify(artifact)}\n`, { mode: 0o600 });
  return ["--privacy-key-ready-artifact", fixture.privacyReadinessArtifactPath];
}

function createRepairTransitionFixture({ selected = true } = {}) {
  const fixture = createFixture();
  mutateDatabase(fixture.targetDatabasePath, (db) => {
    if (selected) {
      db.prepare("UPDATE production_contributions SET craft_entity_id = '100' WHERE contribution_key = 'relay-contribution'").run();
      db.prepare("UPDATE production_contribution_events SET craft_entity_id = '100' WHERE source_key = 'relay-event'").run();
      db.prepare(`
        INSERT INTO domain_payload_current
          (claim_id, domain, data_json, collected_at, last_attempt_at, last_success_at,
           updated_at, provider, freshness, confidence, generation, warnings_json)
        VALUES (?, 'crafts', ?, 'relay-time', 'relay-time', 'relay-time',
          'relay-time', 'relay', 'fresh', 'high', 7, '[]')
      `).run(CLAIM_ID, JSON.stringify({
        craftResults: [{ entityId: "100", levelRequirements: [{ skillId: "3" }] }],
      }));
    }
  });
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  const repairManifest = createContributionProfessionManifest(target, CLAIM_ID);
  target.close();
  const repairManifestPath = path.join(fixture.directory, "profession-repair.json");
  writeFileSync(repairManifestPath, `${JSON.stringify(repairManifest, null, 2)}\n`, { mode: 0o600 });
  const manifestPath = path.join(fixture.directory, "manifest-with-repair.json");
  const dryRun = runScript([
    ...dryRunArguments(fixture, manifestPath),
    "--contribution-repair-manifest", repairManifestPath,
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  return { ...fixture, manifestPath, repairManifest };
}

function privacyRecord(key, discordId, overrides = {}) {
  return signDeletionLedgerRecord({
    version: 1,
    operationId: `operation-${discordId}`,
    state: "committed",
    subject: deletionLedgerSubject(discordId, key),
    occurredAt: PRIVACY_RECORD_OCCURRED_AT,
    expiresAt: PRIVACY_RECORD_EXPIRES_AT,
    ...overrides,
  }, key);
}

test("dry-run writes a redacted manifest with an internally frozen privacy timestamp", () => {
  const fixture = createFixture();
  const firstManifestPath = path.join(fixture.directory, "manifest-1.json");

  const before = Date.now();
  const first = runScript(dryRunArguments(fixture, firstManifestPath));
  const after = Date.now();
  assert.equal(first.status, 0, first.stderr);

  const firstText = readFileSync(firstManifestPath, "utf8");
  assert.doesNotMatch(firstText, /super-secret-token|must-never-migrate|private-license|scrypt:|token_hash|password_hash/i);

  const manifest = JSON.parse(firstText);
  const frozenPrivacyTime = Date.parse(manifest.privacyDeletionLedger.manifestCreatedAt);
  assert.ok(frozenPrivacyTime >= before && frozenPrivacyTime <= after);
  assert.equal(manifest.formatVersion, 1);
  assert.equal(manifest.claimId, CLAIM_ID);
  assert.match(manifest.source.database.schemaFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.source.database.fileSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.target.database.schemaFingerprint, /^[a-f0-9]{64}$/);
  assert.match(manifest.target.database.fileSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.privacyLedgerKeyIds, { source: "b172954dd36b65dc", target: "9ec2e434eef8ee61" });
  assert.equal(manifest.privacyDeletionLedger.merged.fileSha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(manifest.privacyDeletionLedger.merged.recordCount, 0);
  assert.deepEqual(manifest.accountMappings, [
    { action: "overwrite", sourceId: 10, targetId: 1 },
    { action: "insert", sourceId: 20, targetId: 3 },
  ]);
  assert.equal(manifest.branding.source.assets.logo.contentType, "image/png");
  assert.equal(manifest.branding.source.assets.logo.fileName, "logo.png");
  assert.equal(manifest.branding.source.assets.logo.size, 8);
  assert.match(manifest.branding.source.assets.logo.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.branding.source.unexpectedFileCount, 1);
  assert.equal(manifest.secret.discordBotToken.present, true);
  assert.match(manifest.secret.discordBotToken.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(manifest.secret.canonicalPreflightRequiresEnvironmentToken, false);
  assert.match(manifest.selectionHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.tableCounts.user_accounts, {
    conflicting: 1,
    excluded: false,
    operation: "approved",
    replaced: 0,
    retained: 1,
    selected: 2,
    source: 2,
    target: 2,
  });
  for (const table of EXPLICIT_PROTECTED_TABLES) assert.equal(manifest.tableCounts[table].operation, "protected", table);
  for (const table of Object.keys(manifest.tableCounts).filter((name) => name.startsWith("game_catalog_"))) {
    assert.equal(manifest.tableCounts[table].operation, "protected", table);
  }
  for (const [table, counts] of Object.entries(manifest.tableCounts)) {
    assert.deepEqual(Object.keys(counts).sort(), ["conflicting", "excluded", "operation", "replaced", "retained", "selected", "source", "target"], table);
    assert.equal(counts.operation, APPROVED_TABLES.has(table) ? "approved" : "protected", table);
    assert.equal(counts.excluded, !APPROVED_TABLES.has(table), table);
  }
});

test("dry-run accepts the exact live old-production selected schemas only as source shapes", () => {
  const fixture = createFixture({ liveSourceSchemas: true });
  try {
    mutateDatabase(fixture.sourceDatabasePath, (db) => {
      db.prepare("UPDATE admin_users SET password_hash = 'discord-oauth-admin'").run();
    });
    const manifestPath = path.join(fixture.directory, "live-source-schema-manifest.json");
    const result = runScript(dryRunArguments(fixture, manifestPath));
    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(readFileSync(manifestPath, "utf8")).selectionHash, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("dry-run accepts the Discord OAuth administrator sentinel only for a linked Discord identity", () => {
  const fixture = createFixture();
  try {
    mutateDatabase(fixture.sourceDatabasePath, (db) => {
      db.prepare("UPDATE admin_users SET password_hash = 'discord-oauth-admin' WHERE id = 10").run();
      db.prepare("UPDATE admin_users SET password_hash = 'discord-oauth-admin', discord_id = NULL WHERE id = 20").run();
    });
    const result = runScript(dryRunArguments(fixture, path.join(fixture.directory, "invalid-oauth-admin.json")));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Source administrator 20 has an unsupported password hash/);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("apply merges both ledgers and replays committed deletions without account resurrection", () => {
  const fixture = createFixture();
  const sourceRecords = [
    privacyRecord(SOURCE_PRIVACY_KEY, "222"),
    privacyRecord(SOURCE_PRIVACY_KEY, "999", { operationId: "old-pending", state: "pending" }),
    privacyRecord(SOURCE_PRIVACY_KEY, "999", { operationId: "old-aborted", state: "aborted" }),
    privacyRecord(SOURCE_PRIVACY_KEY, "999", {
      operationId: "old-expired",
      occurredAt: PRIVACY_EXPIRED_OCCURRED_AT,
      expiresAt: PRIVACY_EXPIRED_AT,
    }),
  ];
  const targetRecords = [
    privacyRecord(TARGET_PRIVACY_KEY, "111"),
    privacyRecord(TARGET_PRIVACY_KEY, "999", { operationId: "current-pending", state: "pending" }),
  ];
  writeFileSync(fixture.sourceLedgerPath, `${sourceRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
  writeFileSync(fixture.targetLedgerPath, `${targetRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
  mutateDatabase(fixture.sourceDatabasePath, (db) => {
    db.prepare("UPDATE app_settings SET value = ? WHERE key = 'access_control_json'").run(JSON.stringify({
      rules: { dashboard: { allowedDiscordIds: ["111", "222", "999"] } },
    }));
  });
  const manifestPath = createManifest(fixture, "privacy-replay-manifest.json");
  const manifestText = readFileSync(manifestPath, "utf8");

  const applied = runScript([
    "--apply",
    "--manifest", manifestPath,
    ...task4ReadinessArguments(fixture, manifestPath),
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const privacyManifestText = JSON.stringify(JSON.parse(manifestText).privacyDeletionLedger);
  for (const forbidden of [...sourceRecords.map((record) => record.subject), ...targetRecords.map((record) => record.subject)]) {
    assert.doesNotMatch(privacyManifestText, new RegExp(forbidden));
  }
  for (const forbidden of [SOURCE_PRIVACY_KEY, TARGET_PRIVACY_KEY, ...sourceRecords.map((record) => record.subject), ...targetRecords.map((record) => record.subject)]) {
    assert.doesNotMatch(`${manifestText}\n${applied.stdout}\n${applied.stderr}`, new RegExp(forbidden));
  }
  assert.deepEqual(Object.keys(JSON.parse(applied.stdout)).sort(), ["claimId", "integrity", "recovered", "selectionHash"]);

  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.deepEqual(target.prepare("SELECT discord_id FROM user_accounts ORDER BY discord_id").all().map((row) => ({ ...row })), [{ discord_id: "999" }]);
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 0);
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM market_deal_watches WHERE discord_id IN ('111', '222')").get().count, 0);
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM discord_notification_outbox").get().count, 1);
  assert.deepEqual(
    JSON.parse(target.prepare("SELECT value FROM app_settings WHERE key = 'access_control_json'").get().value)
      .rules.dashboard.allowedDiscordIds,
    ["999"],
  );
  assert.equal(
    target.prepare("SELECT updated_at FROM app_settings WHERE key = 'access_control_json'").get().updated_at,
    JSON.parse(manifestText).privacyDeletionLedger.manifestCreatedAt,
  );
  target.close();

  const merged = readDeletionLedger(fixture.targetLedgerPath, [TARGET_PRIVACY_KEY, SOURCE_PRIVACY_KEY]);
  assert.equal(merged.length, 5);
  assert.equal(merged.some((record) => record.operationId === "old-expired"), false);
});

test("apply refuses retained old-key records until Task 4 attests installed-key configuration", () => {
  const fixture = createFixture();
  const originalTargetLedger = `${JSON.stringify(privacyRecord(TARGET_PRIVACY_KEY, "999"))}\n`;
  writeFileSync(fixture.sourceLedgerPath, `${JSON.stringify(privacyRecord(SOURCE_PRIVACY_KEY, "222"))}\n`, { mode: 0o600 });
  writeFileSync(fixture.targetLedgerPath, originalTargetLedger, { mode: 0o600 });
  const manifestPath = createManifest(fixture, "readiness-required.json");

  const apply = runScript(["--apply", "--manifest", manifestPath]);

  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /readiness artifact path is required/i);
  assert.equal(readFileSync(fixture.targetLedgerPath, "utf8"), originalTargetLedger);
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 1);
  target.close();
});

test("apply performs every approved merge while preserving Relay-only and explicitly excluded state", () => {
  const fixture = createFixture();
  const manifestPath = path.join(fixture.directory, "manifest.json");
  const dryRun = runScript(dryRunArguments(fixture, manifestPath));
  assert.equal(dryRun.status, 0, dryRun.stderr);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal("approvedPreMigrationRepair" in manifest, false);
  assert.deepEqual(manifest.adminMappings, [
    { action: "overwrite", sourceId: 10, targetId: 2 },
    { action: "insert", sourceId: 20, targetId: 4 },
  ]);
  assert.deepEqual(manifest.watchMappings, [
    { action: "update", sourceId: 10, targetId: 7, targetUserId: 1 },
    { action: "insert", sourceId: 11, targetId: 10, targetUserId: 3 },
  ]);
  assert.deepEqual(manifest.conflictDecisions.adminAudit, {
    appended: 1,
    duplicates: 2,
    retainedTarget: 2,
  });

  const before = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  const protectedBefore = Object.fromEntries(EXPLICIT_PROTECTED_TABLES.map((table) => [table, databaseRows(before, table)]));
  before.close();

  const apply = runScript(["--apply", "--manifest", manifestPath]);
  assert.equal(apply.status, 0, apply.stderr);
  assert.doesNotMatch(`${apply.stdout}\n${apply.stderr}`, /super-secret-token|must-never-migrate|keep-target-oauth|keep-target-privacy/i);
  assert.equal(existsSync(`${manifestPath}.applied`), true);

  const source = new DatabaseSync(fixture.sourceDatabasePath, { readOnly: true });
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 0);
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM admin_sessions").get().count, 0);

  assert.deepEqual(target.prepare("SELECT id, discord_id, discord_username, character_player_id, character_status, settings_json FROM user_accounts ORDER BY id").all().map((row) => ({ ...row })), [
    { id: 1, discord_id: "111", discord_username: "old-user", character_player_id: "901", character_status: "approved", settings_json: '{"dense":true}' },
    { id: 2, discord_id: "999", discord_username: "relay-only", character_player_id: null, character_status: "unlinked", settings_json: '{"relay":true}' },
    { id: 3, discord_id: "222", discord_username: "new-old-user", character_player_id: "902", character_status: "pending", settings_json: '{"compact":true}' },
  ]);
  assert.deepEqual(target.prepare("SELECT user_id, legal_version FROM user_legal_acceptances ORDER BY user_id, legal_version").all().map((row) => ({ ...row })), [
    { user_id: 1, legal_version: "v1" },
    { user_id: 2, legal_version: "relay-v1" },
    { user_id: 3, legal_version: "v2" },
  ]);

  assert.deepEqual(target.prepare("SELECT id, username, role, active, discord_id FROM admin_users ORDER BY id").all().map((row) => ({ ...row })), [
    { id: 2, username: "owner", role: "owner", active: 1, discord_id: "111" },
    { id: 4, username: "old-moderator", role: "moderator", active: 0, discord_id: "222" },
  ]);
  assert.equal(target.prepare("SELECT password_hash FROM admin_users WHERE id = 2").get().password_hash, PASSWORD_HASH);

  const settings = Object.fromEntries(target.prepare("SELECT key, value FROM app_settings").all().map((row) => [row.key, row.value]));
  for (const [key, value] of Object.entries(SOURCE_SETTINGS)) assert.equal(settings[key], value, key);
  assert.equal(settings.target_only_setting, "keep-me");
  assert.equal(settings.cutover_marker_owned_by_task_4, "keep-marker");
  assert.equal(settings.source_only_setting, undefined);
  assert.equal(target.prepare("SELECT value FROM app_secrets WHERE key = 'discord_bot_token'").get().value, "super-secret-token");
  assert.equal(target.prepare("SELECT value FROM app_secrets WHERE key = 'oauth_state_secret'").get().value, "keep-target-oauth");
  assert.equal(target.prepare("SELECT value FROM app_secrets WHERE key = 'privacy_ledger_key'").get().value, "keep-target-privacy");

  assert.deepEqual(target.prepare("SELECT plan_key, config_json FROM craft_plan_settings ORDER BY plan_key").all().map((row) => ({ ...row })), [
    { plan_key: "active", config_json: '{"source":true}' },
    { plan_key: "old-extra", config_json: '{"old":true}' },
    { plan_key: "relay-only", config_json: '{"relay":true}' },
  ]);
  assert.deepEqual({ ...target.prepare("SELECT id, name, scope, is_primary, config_json FROM craft_plans").get() }, {
    id: "legacy-primary",
    name: "Settlement craft plan",
    scope: "shared",
    is_primary: 1,
    config_json: '{"old":true}',
  });
  assert.deepEqual(target.prepare("SELECT id, user_id, discord_id, region_id, item_id, item_type, item_name, threshold_percent, enabled, last_checked_at FROM market_deal_watches ORDER BY id").all().map((row) => ({ ...row })), [
    { id: 7, user_id: 1, discord_id: "111", region_id: "777", item_id: "42", item_type: "0", item_name: "Old Item", threshold_percent: 21, enabled: 1, last_checked_at: "source-check" },
    { id: 9, user_id: 2, discord_id: "999", region_id: "999", item_id: "99", item_type: "0", item_name: "Relay Only Item", threshold_percent: 30, enabled: 1, last_checked_at: null },
    { id: 10, user_id: 3, discord_id: "222", region_id: "888", item_id: "42", item_type: "1", item_name: "Old Cargo", threshold_percent: 22, enabled: 1, last_checked_at: null },
  ]);
  assert.deepEqual(databaseRows(target, "market_deal_alerts"), protectedBefore.market_deal_alerts);

  assert.deepEqual({ ...target.prepare("SELECT * FROM scheduled_jobs WHERE job_key = 'shared-job'").get() }, {
    job_key: "shared-job",
    label: "Relay Label",
    description: "Relay Description",
    schedule: "*/9 * * * *",
    enabled: 0,
    last_run_at: null,
    last_success_at: null,
    last_error: null,
    next_run_at: null,
    running: 0,
    metadata_json: '{"source":true}',
    updated_at: "2026-08-01",
  });
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM scheduled_jobs WHERE job_key = 'retired-source-job'").get().count, 0);
  assert.equal(target.prepare("SELECT last_run_at FROM scheduled_jobs WHERE job_key = 'relay-only-job'").get().last_run_at, "keep-run");

  for (const table of [
    "discord_youtube_channels", "discord_youtube_videos", "discord_craft_watches",
    "discord_mod_cases", "discord_warnings", "discord_mod_notes", "discord_custom_commands",
    "discord_component_votes", "discord_component_messages", "discord_temp_bans",
    "discord_craft_plan_report_occurrences",
  ]) {
    assert.deepEqual(databaseRows(target, table), databaseRows(source, table), table);
  }

  assert.deepEqual(target.prepare("SELECT id, user_id, username, action FROM admin_audit_log ORDER BY id").all().map((row) => ({ ...row })), [
    { id: 1, user_id: 3, username: "relay-admin", action: "relay.action" },
    { id: 2, user_id: 2, username: "owner", action: "old.action" },
    { id: 3, user_id: null, username: "removed", action: "old.orphan" },
  ]);
  for (const table of EXPLICIT_PROTECTED_TABLES) assert.deepEqual(databaseRows(target, table), protectedBefore[table], table);
  assert.equal(target.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(target.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  source.close();
  target.close();

  assert.deepEqual(readFileSync(path.join(fixture.targetBrandingDirectory, "logo.png")), PNG_BYTES);
  assert.equal(existsSync(path.join(fixture.targetBrandingDirectory, "favicon.webp")), false);
});

test("dry-run freezes the exact approved contribution repair and apply accepts only its post-repair fingerprints", () => {
  const fixture = createRepairTransitionFixture();
  try {
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    assert.equal(manifest.approvedPreMigrationRepair.selectionHash, fixture.repairManifest.selectionHash);
    assert.equal(manifest.approvedPreMigrationRepair.selectedCount, 2);
    assert.deepEqual(manifest.approvedPreMigrationRepair.selectedIds, {
      aggregates: ["relay-contribution"],
      events: ["relay-event"],
    });
    assert.match(manifest.approvedPreMigrationRepair.expectedPostRepair.databaseLogicalSha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.approvedPreMigrationRepair.expectedPostRepair.tables.production_contributions.contentSha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.approvedPreMigrationRepair.expectedPostRepair.tables.production_contribution_events.contentSha256, /^[a-f0-9]{64}$/);

    mutateDatabase(fixture.targetDatabasePath, (db) => applyContributionProfessionRepair(db, fixture.repairManifest));
    const readiness = task4ReadinessArguments(fixture, fixture.manifestPath);
    const apply = runScript(["--apply", "--manifest", fixture.manifestPath, ...readiness]);
    assert.equal(apply.status, 0, apply.stderr);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("zero-selection approved contribution repair preserves ordinary Task 2 apply behavior", () => {
  const fixture = createRepairTransitionFixture({ selected: false });
  try {
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    assert.equal(manifest.approvedPreMigrationRepair.selectedCount, 0);
    assert.deepEqual(manifest.approvedPreMigrationRepair.selectedIds, { aggregates: [], events: [] });
    const readiness = task4ReadinessArguments(fixture, fixture.manifestPath);
    const apply = runScript(["--apply", "--manifest", fixture.manifestPath, ...readiness]);
    assert.equal(apply.status, 0, apply.stderr);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("apply refuses an altered contribution repair transition", () => {
  const fixture = createRepairTransitionFixture();
  try {
    mutateDatabase(fixture.targetDatabasePath, (db) => {
      db.prepare("UPDATE production_contributions SET profession = 'Masonry', raw_json = ? WHERE contribution_key = 'relay-contribution'")
        .run(JSON.stringify({ profession: "Masonry" }));
      db.prepare("UPDATE production_contribution_events SET raw_json = ? WHERE source_key = 'relay-event'")
        .run(JSON.stringify({ profession: "Masonry" }));
    });
    const readiness = task4ReadinessArguments(fixture, fixture.manifestPath);
    const apply = runScript(["--apply", "--manifest", fixture.manifestPath, ...readiness]);
    assert.notEqual(apply.status, 0);
    assert.match(apply.stderr, /approved contribution repair transition|protected.*changed/i);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("approved contribution repair never permits unrelated protected-table drift", () => {
  const fixture = createRepairTransitionFixture();
  try {
    mutateDatabase(fixture.targetDatabasePath, (db) => {
      applyContributionProfessionRepair(db, fixture.repairManifest);
      db.prepare("UPDATE market_events SET item_name = 'unexpected drift' WHERE id = 1").run();
    });
    const readiness = task4ReadinessArguments(fixture, fixture.manifestPath);
    const apply = runScript(["--apply", "--manifest", fixture.manifestPath, ...readiness]);
    assert.notEqual(apply.status, 0);
    assert.match(apply.stderr, /approved contribution repair transition|protected.*changed|inputs changed/i);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("apply refuses a changed database, tampered manifest, and an already-applied marker", () => {
  const driftFixture = createFixture();
  writeFileSync(driftFixture.sourceLedgerPath, `${JSON.stringify(privacyRecord(SOURCE_PRIVACY_KEY, "222"))}\n`, { mode: 0o600 });
  const driftOriginalLedger = `${JSON.stringify(privacyRecord(TARGET_PRIVACY_KEY, "999"))}\n`;
  writeFileSync(driftFixture.targetLedgerPath, driftOriginalLedger, { mode: 0o600 });
  const driftManifestPath = createManifest(driftFixture);
  mutateDatabase(driftFixture.sourceDatabasePath, (db) => {
    db.prepare("UPDATE craft_plan_settings SET config_json = '{\"drifted\":true}' WHERE plan_key = 'active'").run();
  });
  const drift = runScript([
    "--apply",
    "--manifest", driftManifestPath,
    ...task4ReadinessArguments(driftFixture, driftManifestPath),
  ]);
  assert.notEqual(drift.status, 0);
  assert.match(drift.stderr, /changed since dry-run/i);
  const driftTarget = new DatabaseSync(driftFixture.targetDatabasePath, { readOnly: true });
  assert.equal(driftTarget.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 1);
  driftTarget.close();
  assert.equal(readFileSync(driftFixture.targetLedgerPath, "utf8"), driftOriginalLedger);

  const tamperFixture = createFixture();
  const tamperManifestPath = createManifest(tamperFixture);
  const tampered = JSON.parse(readFileSync(tamperManifestPath, "utf8"));
  tampered.tableCounts.user_accounts.selected = 999;
  writeFileSync(tamperManifestPath, `${JSON.stringify(tampered, null, 2)}\n`);
  const tamper = runScript(["--apply", "--manifest", tamperManifestPath]);
  assert.notEqual(tamper.status, 0);
  assert.match(tamper.stderr, /selection hash is invalid/i);

  const appliedFixture = createFixture();
  const appliedManifestPath = createManifest(appliedFixture);
  const firstApply = runScript(["--apply", "--manifest", appliedManifestPath]);
  assert.equal(firstApply.status, 0, firstApply.stderr);
  const secondApply = runScript(["--apply", "--manifest", appliedManifestPath]);
  assert.notEqual(secondApply.status, 0);
  assert.match(secondApply.stderr, /already applied/i);
});

test("dry-run rejects unsupported schemas, invalid Discord IDs, and malformed selected JSON", () => {
  const cases = [
    {
      expected: /unsupported.*discord_mod_notes/i,
      mutate(db) { db.exec("DROP TABLE discord_mod_notes"); },
      name: "unsupported-source-schema",
    },
    {
      expected: /exact decimal ID/i,
      mutate(db) { db.prepare("UPDATE user_accounts SET discord_id = 'not-a-discord-id' WHERE id = 20").run(); },
      name: "invalid-user-discord-id",
    },
    {
      expected: /valid JSON/i,
      mutate(db) { db.prepare("UPDATE craft_plan_settings SET config_json = '{broken' WHERE plan_key = 'active'").run(); },
      name: "malformed-json",
    },
    {
      expected: /cannot be mapped to its account/i,
      mutate(db) { db.prepare("UPDATE market_deal_watches SET user_id = 404 WHERE id = 10").run(); },
      name: "unmappable-watch-account",
    },
  ];
  for (const entry of cases) {
    const fixture = createFixture();
    mutateDatabase(fixture.sourceDatabasePath, entry.mutate);
    const result = runScript(dryRunArguments(fixture, path.join(fixture.directory, `${entry.name}.json`)));
    assert.notEqual(result.status, 0, entry.name);
    assert.match(result.stderr, entry.expected, entry.name);
  }
});

test("the supported selected schema makes duplicate administrator Discord IDs unrepresentable", () => {
  const fixture = createFixture();
  const db = new DatabaseSync(fixture.sourceDatabasePath);
  assert.throws(
    () => db.prepare("UPDATE admin_users SET discord_id = '111' WHERE id = 20").run(),
    /UNIQUE constraint failed: admin_users\.discord_id/i,
  );
  db.close();
});

test("dry-run rejects an extra column in a selected source table", () => {
  const fixture = createFixture();
  mutateDatabase(fixture.sourceDatabasePath, (db) => {
    db.exec("ALTER TABLE user_accounts ADD COLUMN shadow_profile TEXT");
  });

  const result = runScript(dryRunArguments(fixture, path.join(fixture.directory, "extra-selected-column.json")));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsupported.*user_accounts.*schema|schema.*fingerprint/i);
});

test("schema compatibility permits only the documented legacy source market-watch affinity", () => {
  const legacySource = createFixture();
  rewriteMarketWatchAverageAffinity(legacySource.sourceDatabasePath, "REAL");
  const accepted = runScript(dryRunArguments(legacySource, path.join(legacySource.directory, "legacy-real-source.json")));
  assert.equal(accepted.status, 0, accepted.stderr);

  const legacyTarget = createFixture();
  rewriteMarketWatchAverageAffinity(legacyTarget.targetDatabasePath, "REAL");
  const rejected = runScript(dryRunArguments(legacyTarget, path.join(legacyTarget.directory, "legacy-real-target.json")));
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /unsupported.*market_deal_watches.*schema fingerprint/i);
});

test("dry-run and apply enforce the exact claim and guarded filesystem roots", () => {
  const wrongArgument = createFixture();
  const wrongArgs = dryRunArguments(wrongArgument, path.join(wrongArgument.directory, "wrong-claim.json"));
  wrongArgs[wrongArgs.indexOf(CLAIM_ID)] = "123";
  const wrongClaim = runScript(wrongArgs);
  assert.notEqual(wrongClaim.status, 0);
  assert.match(wrongClaim.stderr, new RegExp(`exactly ${CLAIM_ID}`));

  const foreignWatch = createFixture();
  mutateDatabase(foreignWatch.sourceDatabasePath, (db) => {
    db.prepare("UPDATE market_deal_watches SET claim_id = '123' WHERE id = 10").run();
  });
  const foreign = runScript(dryRunArguments(foreignWatch, path.join(foreignWatch.directory, "foreign-watch.json")));
  assert.notEqual(foreign.status, 0);
  assert.match(foreign.stderr, /outside the canonical claim/i);

  const mismatchedSetting = createFixture();
  mutateDatabase(mismatchedSetting.targetDatabasePath, (db) => {
    db.prepare("UPDATE app_settings SET value = '123' WHERE key = 'claim_id'").run();
  });
  const mismatch = runScript(dryRunArguments(mismatchedSetting, path.join(mismatchedSetting.directory, "mismatch.json")));
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /claim settings must match/i);

  const escapedBranding = createFixture();
  mutateDatabase(escapedBranding.sourceDatabasePath, (db) => {
    db.prepare("UPDATE app_settings SET value = ? WHERE key = 'branding_json'").run(JSON.stringify({
      logo: {
        fileName: "../logo.png",
        contentType: "image/png",
        updatedAt: "2026-08-01T00:00:00.000Z",
        url: "/api/local/branding/logo",
      },
    }));
  });
  const escaped = runScript(dryRunArguments(escapedBranding, path.join(escapedBranding.directory, "escaped-branding.json")));
  assert.notEqual(escaped.status, 0);
  assert.match(escaped.stderr, /filename is unsupported|escapes its supplied root/i);

  const linkedBranding = createFixture();
  const linkedPath = path.join(linkedBranding.directory, "linked-old-branding");
  symlinkSync(linkedBranding.sourceBrandingDirectory, linkedPath, "junction");
  const linkedArgs = dryRunArguments({ ...linkedBranding, sourceBrandingDirectory: linkedPath }, path.join(linkedBranding.directory, "linked.json"));
  const linked = runScript(linkedArgs);
  assert.notEqual(linked.status, 0);
  assert.match(linked.stderr, /symlink/i);
});

test("dry-run rejects cutover files nested inside branding roots before creating a manifest", () => {
  const fixture = createFixture();
  const nestedTargetDatabasePath = path.join(fixture.targetBrandingDirectory, "relay.sqlite");
  renameSync(fixture.targetDatabasePath, nestedTargetDatabasePath);
  const unsafeFixture = { ...fixture, targetDatabasePath: nestedTargetDatabasePath };
  const manifestPath = path.join(fixture.directory, "unsafe-overlap.json");

  const result = runScript(dryRunArguments(unsafeFixture, manifestPath));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /disjoint|overlap|branding root/i);
  assert.equal(existsSync(manifestPath), false);
  assert.equal(existsSync(nestedTargetDatabasePath), true);
});

test("dry-run requires branding roots, databases, manifest, and markers to be mutually disjoint", () => {
  const manifestFixture = createFixture();
  const nestedManifestPath = path.join(manifestFixture.targetBrandingDirectory, "manifest.json");
  const nestedManifest = runScript(dryRunArguments(manifestFixture, nestedManifestPath));
  assert.notEqual(nestedManifest.status, 0);
  assert.match(nestedManifest.stderr, /disjoint|overlap|branding root/i);
  assert.equal(existsSync(nestedManifestPath), false);

  const nestedRootsFixture = createFixture();
  const nestedTargetRoot = path.join(nestedRootsFixture.sourceBrandingDirectory, "relay-branding");
  renameSync(nestedRootsFixture.targetBrandingDirectory, nestedTargetRoot);
  const nestedRoots = runScript(dryRunArguments(
    { ...nestedRootsFixture, targetBrandingDirectory: nestedTargetRoot },
    path.join(nestedRootsFixture.directory, "nested-roots.json"),
  ));
  assert.notEqual(nestedRoots.status, 0);
  assert.match(nestedRoots.stderr, /disjoint|overlap|branding root/i);
});

test("dry-run rejects a target privacy ledger that aliases either manifest marker", () => {
  for (const suffix of [".applied", ".applying"]) {
    const fixture = createFixture();
    const manifestPath = path.join(fixture.targetBackupRoot, "manifest.json");
    const result = runScript(dryRunArguments({
      ...fixture,
      targetLedgerPath: `${manifestPath}${suffix}`,
    }, manifestPath));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /disjoint|overlap/i);
    assert.equal(existsSync(manifestPath), false);
  }
});

test("every privacy file is disjoint from every cutover file, destructive root, and branding stage namespace", () => {
  const fixture = createFixture();
  const privacyPlan = createCanonicalCutoverPrivacyPlan({
    manifestCreatedAt: PRIVACY_MANIFEST_CREATED_AT,
    sourceConfigRoot: fixture.sourceConfigRoot,
    sourceBackupRoot: fixture.sourceBackupRoot,
    sourceKeyFilePath: fixture.sourceKeyFilePath,
    sourceLedgerPath: fixture.sourceLedgerPath,
    targetConfigRoot: fixture.targetConfigRoot,
    targetBackupRoot: fixture.targetBackupRoot,
    targetKeyFilePath: fixture.targetKeyFilePath,
    targetPreviousKeyFilePaths: [],
    installedPreviousKeyFilePath: fixture.installedPreviousKeyFilePath,
    readinessArtifactPath: fixture.privacyReadinessArtifactPath,
    targetLedgerPath: fixture.targetLedgerPath,
  });
  privacyPlan.target.previousKeys.push({
    path: path.join(fixture.targetConfigRoot, "existing-previous.key"),
    keyId: "previous-key-id",
    fileSha256: "a".repeat(64),
  });
  const privacyPaths = [
    ["source key", (plan, value) => { plan.source.key.path = value; }],
    ["source ledger", (plan, value) => { plan.source.ledger.path = value; }],
    ["current key", (plan, value) => { plan.target.key.path = value; }],
    ["previous key", (plan, value) => { plan.target.previousKeys[0].path = value; }],
    ["installed key", (plan, value) => { plan.previousKeyConfiguration.installedOldKeyPath = value; }],
    ["target ledger", (plan, value) => { plan.target.ledger.path = value; }],
    ["staged ledger", (plan, value) => { plan.target.stagedLedgerPath = value; }],
    ["readiness artifact", (plan, value) => { plan.readinessArtifact.path = value; }],
  ];
  const baseManifestPath = path.join(fixture.directory, "matrix-manifest.json");
  const destructivePaths = [
    ["source database", fixture.sourceDatabasePath],
    ["target database", fixture.targetDatabasePath],
    ["manifest", baseManifestPath],
    ["applied marker", `${baseManifestPath}.applied`],
    ["pending marker", `${baseManifestPath}.applying`],
    ["source branding root", fixture.sourceBrandingDirectory],
    ["target branding root", fixture.targetBrandingDirectory],
    ["branding backup root", `${fixture.targetBrandingDirectory}.canonical-cutover-backup`],
    ["branding stage namespace", path.join(fixture.directory, ".canonical-cutover-branding-stage-attacker")],
    ["nested branding stage namespace", path.join(fixture.directory, ".canonical-cutover-branding-stage-attacker", "privacy-file")],
  ];

  for (const [privacyLabel, setPrivacyPath] of privacyPaths) {
    for (const [cutoverLabel, destructivePath] of destructivePaths) {
      const conflictingPlan = structuredClone(privacyPlan);
      setPrivacyPath(conflictingPlan, destructivePath);
      assert.throws(
        () => createCanonicalCutoverManifest({
          claimId: CLAIM_ID,
          sourceDatabasePath: fixture.sourceDatabasePath,
          targetDatabasePath: fixture.targetDatabasePath,
          sourceBrandingDirectory: fixture.sourceBrandingDirectory,
          targetBrandingDirectory: fixture.targetBrandingDirectory,
          manifestPath: baseManifestPath,
          privacyPlan: conflictingPlan,
        }),
        /disjoint|overlap|destructive namespace/i,
        `${privacyLabel} must not overlap ${cutoverLabel}`,
      );
    }
  }
});

test("dry-run rejects database hard links before creating a manifest", () => {
  const sharedIdentity = createFixture();
  rmSync(sharedIdentity.targetDatabasePath);
  linkSync(sharedIdentity.sourceDatabasePath, sharedIdentity.targetDatabasePath);
  rmSync(path.join(sharedIdentity.targetBrandingDirectory, "favicon.webp"));
  writeFileSync(path.join(sharedIdentity.targetBrandingDirectory, "logo.png"), PNG_BYTES);
  const sharedManifestPath = path.join(sharedIdentity.directory, "shared-identity.json");

  const shared = runScript(dryRunArguments(sharedIdentity, sharedManifestPath));

  assert.notEqual(shared.status, 0);
  assert.match(shared.stderr, /same filesystem identity|hard link/i);
  assert.equal(existsSync(sharedManifestPath), false);

  const multiplyLinkedTarget = createFixture();
  const targetAliasPath = path.join(multiplyLinkedTarget.directory, "relay-alias.sqlite");
  linkSync(multiplyLinkedTarget.targetDatabasePath, targetAliasPath);
  const linkedManifestPath = path.join(multiplyLinkedTarget.directory, "multiply-linked-target.json");

  const linked = runScript(dryRunArguments(multiplyLinkedTarget, linkedManifestPath));

  assert.notEqual(linked.status, 0);
  assert.match(linked.stderr, /target database.*hard link|link count/i);
  assert.equal(existsSync(linkedManifestPath), false);
});

test("marker durability orders file fsync, atomic rename, directory fsync, and durable deletion", () => {
  const events = [];
  let nextDescriptor = 40;
  const filesystem = {
    closeSync(descriptor) { events.push(["close", descriptor]); },
    fsyncSync(descriptor) { events.push(["fsync", descriptor]); },
    openSync(filePath, flags, mode) {
      const descriptor = nextDescriptor;
      nextDescriptor += 1;
      events.push(["open", filePath, flags, mode, descriptor]);
      return descriptor;
    },
    renameSync(fromPath, toPath) { events.push(["rename", fromPath, toPath]); },
    rmSync(filePath, options) { events.push(["remove", filePath, options]); },
    writeFileSync(descriptor, contents) { events.push(["write", descriptor, String(contents)]); },
  };
  const markerPath = path.join("durability-root", "manifest.json.applying");
  const temporaryPath = `${markerPath}.tmp-4242`;
  const durability = createCanonicalCutoverDurability(filesystem, { platform: "linux", processId: 4242 });

  durability.writeMarker(markerPath, { state: "pending" });
  durability.removePath(markerPath, { force: true });

  assert.deepEqual(events, [
    ["open", temporaryPath, "wx", 0o600, 40],
    ["write", 40, '{"state":"pending"}\n'],
    ["fsync", 40],
    ["close", 40],
    ["rename", temporaryPath, markerPath],
    ["open", path.dirname(markerPath), "r", undefined, 41],
    ["fsync", 41],
    ["close", 41],
    ["remove", markerPath, { force: true }],
    ["open", path.dirname(markerPath), "r", undefined, 42],
    ["fsync", 42],
    ["close", 42],
  ]);
});

test("a marker directory-fsync failure leaves the renamed recovery marker in place", () => {
  const events = [];
  let nextDescriptor = 50;
  const filesystem = {
    closeSync(descriptor) { events.push(["close", descriptor]); },
    fsyncSync(descriptor) {
      events.push(["fsync", descriptor]);
      if (descriptor === 51) throw new Error("injected directory fsync failure");
    },
    openSync(filePath, flags, mode) {
      const descriptor = nextDescriptor;
      nextDescriptor += 1;
      events.push(["open", filePath, flags, mode, descriptor]);
      return descriptor;
    },
    renameSync(fromPath, toPath) { events.push(["rename", fromPath, toPath]); },
    rmSync(filePath, options) { events.push(["remove", filePath, options]); },
    writeFileSync(descriptor, contents) { events.push(["write", descriptor, String(contents)]); },
  };
  const markerPath = path.join("durability-root", "manifest.json.applying");
  const temporaryPath = `${markerPath}.tmp-5252`;
  const durability = createCanonicalCutoverDurability(filesystem, { platform: "linux", processId: 5252 });

  assert.throws(
    () => durability.writeMarker(markerPath, { state: "pending" }),
    /injected directory fsync failure/,
  );
  assert.deepEqual(events.filter(([operation]) => operation === "rename"), [
    ["rename", temporaryPath, markerPath],
  ]);
  assert.equal(events.some(([operation, filePath]) => operation === "remove" && filePath === markerPath), false);
});

test("apply preserves pre-commit recovery and finalizes markers in durable order", () => {
  const interrupted = createFixture();
  const interruptedManifestPath = createManifest(interrupted);
  const realDurability = createCanonicalCutoverDurability();
  const interruptedDurability = {
    ...realDurability,
    writeMarker(markerPath, payload) {
      realDurability.writeMarker(markerPath, payload);
      if (payload.state === "pending") throw new Error("injected crash after durable pending marker");
    },
  };

  assert.throws(
    () => applyCanonicalCutoverManifest(
      readCanonicalCutoverManifest(interruptedManifestPath),
      { durability: interruptedDurability },
    ),
    /injected crash after durable pending marker/,
  );
  assert.equal(existsSync(`${interruptedManifestPath}.applying`), true);
  assert.equal(existsSync(`${interruptedManifestPath}.applied`), false);
  const interruptedTarget = new DatabaseSync(interrupted.targetDatabasePath, { readOnly: true });
  assert.equal(interruptedTarget.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 1);
  interruptedTarget.close();
  const recovered = runScript(["--apply", "--manifest", interruptedManifestPath]);
  assert.equal(recovered.status, 0, recovered.stderr);

  const ambiguousCommit = createFixture();
  const ambiguousCommitManifestPath = createManifest(ambiguousCommit);
  const openAmbiguousTargetDatabase = (databasePath) => {
    const database = new DatabaseSync(databasePath, { timeout: 5_000 });
    return new Proxy(database, {
      get(target, property) {
        if (property === "exec") {
          return (sql) => {
            const result = target.exec(sql);
            if (sql === "COMMIT") throw new Error("injected ambiguous error after successful commit");
            return result;
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  };

  assert.throws(
    () => applyCanonicalCutoverManifest(
      readCanonicalCutoverManifest(ambiguousCommitManifestPath),
      { openTargetDatabase: openAmbiguousTargetDatabase },
    ),
    /injected ambiguous error after successful commit/,
  );
  assert.equal(existsSync(`${ambiguousCommitManifestPath}.applying`), true);
  assert.equal(existsSync(`${ambiguousCommitManifestPath}.applied`), false);
  const ambiguousTarget = new DatabaseSync(ambiguousCommit.targetDatabasePath, { readOnly: true });
  assert.equal(ambiguousTarget.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 0);
  ambiguousTarget.close();

  const ambiguityRecovered = runScript(["--apply", "--manifest", ambiguousCommitManifestPath]);

  assert.equal(ambiguityRecovered.status, 0, ambiguityRecovered.stderr);
  assert.equal(JSON.parse(ambiguityRecovered.stdout).recovered, true);

  const interruptedFinalization = createFixture();
  writeFileSync(interruptedFinalization.sourceLedgerPath, `${JSON.stringify(privacyRecord(SOURCE_PRIVACY_KEY, "222"))}\n`, { mode: 0o600 });
  const originalTargetLedger = `${JSON.stringify(privacyRecord(TARGET_PRIVACY_KEY, "111"))}\n`;
  writeFileSync(interruptedFinalization.targetLedgerPath, originalTargetLedger, { mode: 0o600 });
  const interruptedFinalizationManifestPath = createManifest(interruptedFinalization);
  const interruptedPrivacyReadiness = task4ReadinessArguments(
    interruptedFinalization,
    interruptedFinalizationManifestPath,
  );
  const finalizationDurability = {
    ...realDurability,
    writeMarker(markerPath, payload) {
      realDurability.writeMarker(markerPath, payload);
      if (payload.state === "applied") throw new Error("injected crash after durable applied marker");
    },
  };
  assert.throws(
    () => applyCanonicalCutoverManifest(
      readCanonicalCutoverManifest(interruptedFinalizationManifestPath),
      {
        durability: finalizationDurability,
        privacyReadinessArtifactPath: interruptedFinalization.privacyReadinessArtifactPath,
      },
    ),
    /injected crash after durable applied marker/,
  );
  assert.equal(existsSync(`${interruptedFinalizationManifestPath}.applying`), true);
  assert.equal(existsSync(`${interruptedFinalizationManifestPath}.applied`), true);
  const installedTargetLedger = readFileSync(interruptedFinalization.targetLedgerPath, "utf8");

  writeFileSync(interruptedFinalization.targetLedgerPath, originalTargetLedger, { mode: 0o600 });
  const refusedLedgerRollback = runScript([
    "--apply",
    "--manifest", interruptedFinalizationManifestPath,
    ...interruptedPrivacyReadiness,
  ]);
  assert.notEqual(refusedLedgerRollback.status, 0);
  assert.match(refusedLedgerRollback.stderr, /installed target ledger does not match/i);

  writeFileSync(interruptedFinalization.targetLedgerPath, installedTargetLedger, { mode: 0o600 });

  const finalized = runScript([
    "--apply",
    "--manifest", interruptedFinalizationManifestPath,
    ...interruptedPrivacyReadiness,
  ]);

  assert.equal(finalized.status, 0, finalized.stderr);
  assert.equal(existsSync(`${interruptedFinalizationManifestPath}.applying`), false);
  assert.equal(existsSync(`${interruptedFinalization.targetBrandingDirectory}.canonical-cutover-backup`), false);
  const recoveredPrivacyTarget = new DatabaseSync(interruptedFinalization.targetDatabasePath, { readOnly: true });
  assert.deepEqual(
    recoveredPrivacyTarget.prepare("SELECT discord_id FROM user_accounts ORDER BY discord_id").all().map((row) => row.discord_id),
    ["999"],
  );
  recoveredPrivacyTarget.close();

  const ordered = createFixture();
  const orderedManifestPath = createManifest(ordered);
  const events = [];
  const orderedDurability = {
    ...realDurability,
    removePath(entryPath, options) {
      events.push(["remove", path.basename(entryPath)]);
      return realDurability.removePath(entryPath, options);
    },
    writeMarker(markerPath, payload) {
      events.push(["write", payload.state, path.basename(markerPath)]);
      return realDurability.writeMarker(markerPath, payload);
    },
    syncDirectory(directoryPath) {
      const directoryName = path.basename(directoryPath);
      events.push(["sync-directory", directoryName.startsWith(".canonical-cutover-branding-stage-") ? "branding-stage" : directoryName]);
      return realDurability.syncDirectory(directoryPath);
    },
    syncFile(filePath) {
      events.push(["sync-file", path.basename(filePath)]);
      return realDurability.syncFile(filePath);
    },
  };

  const result = applyCanonicalCutoverManifest(
    readCanonicalCutoverManifest(orderedManifestPath),
    { durability: orderedDurability },
  );

  assert.equal(result.integrity, "ok");
  assert.equal(
    verifyAppliedCanonicalCutoverManifest(readCanonicalCutoverManifest(orderedManifestPath)).postDatabaseStateFingerprint.length,
    64,
  );
  mutateDatabase(ordered.targetDatabasePath, (db) => {
    db.prepare("UPDATE app_settings SET value = 'post-apply-drift' WHERE key = 'theme_json'").run();
  });
  assert.throws(
    () => verifyAppliedCanonicalCutoverManifest(readCanonicalCutoverManifest(orderedManifestPath)),
    /applied.*marker.*database state/i,
  );
  assert.deepEqual(events, [
    ["sync-file", "logo.png"],
    ["sync-directory", "branding-stage"],
    ["write", "pending", "manifest.json.applying"],
    ["write", "applied", "manifest.json.applied"],
    ["remove", "manifest.json.applying"],
    ["remove", "relay-branding.canonical-cutover-backup"],
  ]);
});

test("dry-run refuses a database with uncheckpointed WAL content", () => {
  const fixture = createFixture();
  const writer = new DatabaseSync(fixture.targetDatabasePath);
  writer.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('wal-only', 'drift', '2026-08-09')").run();
  const result = runScript(dryRunArguments(fixture, path.join(fixture.directory, "wal.json")));
  writer.close();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checkpoint|WAL/i);
});

test("dry-run rejects malformed Discord IDs inside durable Discord state", () => {
  const fixture = createFixture();
  mutateDatabase(fixture.sourceDatabasePath, (db) => {
    db.prepare("UPDATE discord_temp_bans SET guild_id = 'not-a-discord-id'").run();
  });
  const result = runScript(dryRunArguments(fixture, path.join(fixture.directory, "invalid-discord-state.json")));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact decimal ID/i);
});

test("dry-run rejects noncanonical decimal IDs instead of normalizing mapping keys", () => {
  const fixture = createFixture();
  mutateDatabase(fixture.sourceDatabasePath, (db) => {
    db.prepare("UPDATE user_accounts SET discord_id = ' 111 ' WHERE id = 10").run();
  });

  const result = runScript(dryRunArguments(fixture, path.join(fixture.directory, "whitespace-id.json")));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact decimal ID in canonical string form/i);
});

test("dry-run rejects numeric JSON snowflakes before JavaScript can round them", () => {
  const fixture = createFixture();
  mutateDatabase(fixture.sourceDatabasePath, (db) => {
    db.prepare("UPDATE app_settings SET value = ? WHERE key = 'discord_json'")
      .run('{"guildId":1369094286777412590}');
  });

  const result = runScript(dryRunArguments(fixture, path.join(fixture.directory, "numeric-json-snowflake.json")));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact decimal ID in canonical string form/i);
});

test("manifest records a missing source bot token without exposing or importing another secret", () => {
  const fixture = createFixture();
  mutateDatabase(fixture.sourceDatabasePath, (db) => {
    db.prepare("DELETE FROM app_secrets WHERE key = 'discord_bot_token'").run();
  });
  mutateDatabase(fixture.targetDatabasePath, (db) => {
    db.prepare("INSERT INTO app_secrets (key, value, updated_at) VALUES ('discord_bot_token', 'relay-preview-token', '2026-07-01')").run();
  });
  const manifestPath = createManifest(fixture);
  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(manifestText);
  assert.deepEqual(manifest.secret, {
    canonicalPreflightRequiresEnvironmentToken: true,
    discordBotToken: { fingerprint: null, present: false },
  });
  assert.doesNotMatch(manifestText, /relay-preview-token|must-never-migrate|keep-target-oauth|keep-target-privacy/i);
  const apply = runScript(["--apply", "--manifest", manifestPath]);
  assert.equal(apply.status, 0, apply.stderr);
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.equal(target.prepare("SELECT value FROM app_secrets WHERE key = 'discord_bot_token'").get().value, "relay-preview-token");
  assert.equal(target.prepare("SELECT value FROM app_secrets WHERE key = 'oauth_state_secret'").get().value, "keep-target-oauth");
  target.close();
});

test("missing source branding setting retains the target setting and files", () => {
  const fixture = createFixture();
  mutateDatabase(fixture.sourceDatabasePath, (db) => {
    db.prepare("DELETE FROM app_settings WHERE key = 'branding_json'").run();
  });
  const manifestPath = createManifest(fixture);
  const apply = runScript(["--apply", "--manifest", manifestPath]);
  assert.equal(apply.status, 0, apply.stderr);
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  const branding = JSON.parse(target.prepare("SELECT value FROM app_settings WHERE key = 'branding_json'").get().value);
  target.close();
  assert.equal(branding.favicon.fileName, "favicon.webp");
  assert.deepEqual(readFileSync(path.join(fixture.targetBrandingDirectory, "favicon.webp")), WEBP_BYTES);
  assert.equal(existsSync(path.join(fixture.targetBrandingDirectory, "logo.png")), false);
});

test("apply refuses branding hash drift before database mutation", () => {
  const fixture = createFixture();
  const manifestPath = createManifest(fixture);
  writeFileSync(path.join(fixture.sourceBrandingDirectory, "logo.png"), Buffer.concat([PNG_BYTES, Buffer.from("drift")]));
  const apply = runScript(["--apply", "--manifest", manifestPath]);
  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /changed since dry-run/i);
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 1);
  target.close();
  assert.deepEqual(readFileSync(path.join(fixture.targetBrandingDirectory, "favicon.webp")), WEBP_BYTES);
});

test("apply resumes post-commit branding and marker recovery without replaying database merges", () => {
  const fixture = createFixture();
  const manifestPath = createManifest(fixture);
  const firstApply = runScript(["--apply", "--manifest", manifestPath]);
  assert.equal(firstApply.status, 0, firstApply.stderr);
  const appliedMarkerPath = `${manifestPath}.applied`;
  const pendingMarkerPath = `${manifestPath}.applying`;
  renameSync(appliedMarkerPath, pendingMarkerPath);
  const pendingMarker = JSON.parse(readFileSync(pendingMarkerPath, "utf8"));
  writeFileSync(pendingMarkerPath, `${JSON.stringify({ ...pendingMarker, applied: false, state: "pending" }, null, 2)}\n`);
  rmSync(fixture.targetBrandingDirectory, { recursive: true });
  mkdirSync(fixture.targetBrandingDirectory);
  writeFileSync(path.join(fixture.targetBrandingDirectory, "favicon.webp"), WEBP_BYTES);

  const recovery = runScript(["--apply", "--manifest", manifestPath]);

  assert.equal(recovery.status, 0, recovery.stderr);
  assert.equal(existsSync(appliedMarkerPath), true);
  assert.equal(existsSync(pendingMarkerPath), false);
  assert.deepEqual(readFileSync(path.join(fixture.targetBrandingDirectory, "logo.png")), PNG_BYTES);
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM admin_audit_log").get().count, 3);
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 0);
  target.close();
});

test("dry-run rejects an external branding URL instead of copying raw metadata", () => {
  const fixture = createFixture();
  mutateDatabase(fixture.sourceDatabasePath, (db) => {
    db.prepare("UPDATE app_settings SET value = ? WHERE key = 'branding_json'").run(JSON.stringify({
      logo: {
        fileName: "logo.png",
        contentType: "image/png",
        updatedAt: "2026-08-01T00:00:00.000Z",
        url: "https://attacker.invalid/tracker.png",
      },
    }));
  });

  const result = runScript(dryRunArguments(fixture, path.join(fixture.directory, "external-branding-url.json")));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /branding URL must be same-origin|branding metadata is noncanonical/i);
});

test("foreign-key integrity failure rolls back the entire target transaction", () => {
  const fixture = createFixture();
  const originalTargetLedger = `${JSON.stringify(privacyRecord(TARGET_PRIVACY_KEY, "999"))}\n`;
  writeFileSync(fixture.sourceLedgerPath, `${JSON.stringify(privacyRecord(SOURCE_PRIVACY_KEY, "222"))}\n`, { mode: 0o600 });
  writeFileSync(fixture.targetLedgerPath, originalTargetLedger, { mode: 0o600 });
  mutateDatabase(fixture.targetDatabasePath, (db) => {
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(`
      INSERT INTO user_legal_acceptances
        (id, user_id, legal_version, terms_digest, privacy_digest, age_confirmed, accepted_at, source)
      VALUES (99, 404, 'broken', 'broken', 'broken', 1, '2026-01-01', 'oauth')
    `).run();
  });
  const manifestPath = createManifest(fixture);
  const apply = runScript([
    "--apply",
    "--manifest", manifestPath,
    ...task4ReadinessArguments(fixture, manifestPath),
  ]);
  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /foreign_key_check failed/i);
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 1);
  assert.equal(target.prepare("SELECT discord_username FROM user_accounts WHERE id = 1").get().discord_username, "relay-user");
  target.close();
  assert.equal(existsSync(`${manifestPath}.applied`), false);
  assert.equal(readFileSync(fixture.targetLedgerPath, "utf8"), originalTargetLedger);
  assert.doesNotThrow(() => readDeletionLedger(fixture.targetLedgerPath, [TARGET_PRIVACY_KEY]));
  assert.deepEqual(readFileSync(path.join(fixture.targetBrandingDirectory, "favicon.webp")), WEBP_BYTES);
});

test("post-commit ledger-install failure leaves the original readable and resumes from pending recovery", () => {
  const fixture = createFixture();
  writeFileSync(fixture.sourceLedgerPath, `${JSON.stringify(privacyRecord(SOURCE_PRIVACY_KEY, "222"))}\n`, { mode: 0o600 });
  const originalTargetLedger = `${JSON.stringify(privacyRecord(TARGET_PRIVACY_KEY, "999", { state: "pending" }))}\n`;
  writeFileSync(fixture.targetLedgerPath, originalTargetLedger, { mode: 0o600 });
  const manifestPath = createManifest(fixture, "post-commit-ledger-recovery.json");
  const readinessArguments = task4ReadinessArguments(fixture, manifestPath);
  const loaded = readCanonicalCutoverManifest(manifestPath);
  const privacyApplyContext = prepareCanonicalCutoverPrivacyApply(
    loaded.manifest.privacyDeletionLedger,
    {
      filesystem: {
        ...filesystem,
        renameSync(sourcePath, destinationPath) {
          if (destinationPath === fixture.targetLedgerPath) throw new Error("injected ledger rename failure");
          return filesystem.renameSync(sourcePath, destinationPath);
        },
      },
    },
  );

  assert.throws(
    () => applyCanonicalCutoverManifest(loaded, {
      privacyApplyContext,
      privacyReadinessArtifactPath: fixture.privacyReadinessArtifactPath,
    }),
    /database is committed.*injected ledger rename failure/i,
  );
  assert.equal(readFileSync(fixture.targetLedgerPath, "utf8"), originalTargetLedger);
  assert.doesNotThrow(() => readDeletionLedger(fixture.targetLedgerPath, [TARGET_PRIVACY_KEY]));
  assert.equal(existsSync(`${manifestPath}.applying`), true);
  assert.equal(existsSync(`${manifestPath}.applied`), false);
  const committedTarget = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.deepEqual(
    committedTarget.prepare("SELECT discord_id FROM user_accounts ORDER BY discord_id").all().map((row) => row.discord_id),
    ["111", "999"],
  );
  committedTarget.close();

  const recovered = runScript(["--apply", "--manifest", manifestPath, ...readinessArguments]);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).recovered, true);
  assert.deepEqual(
    readDeletionLedger(fixture.targetLedgerPath, [TARGET_PRIVACY_KEY, SOURCE_PRIVACY_KEY])
      .map((record) => record.operationId).sort(),
    ["operation-222", "operation-999"],
  );
});

test("SQLite CHECK integrity failure rolls back the entire target transaction", () => {
  const fixture = createFixture();
  mutateDatabase(fixture.targetDatabasePath, (db) => {
    db.exec("PRAGMA ignore_check_constraints = ON");
    db.prepare("UPDATE user_legal_acceptances SET age_confirmed = 2 WHERE id = 2").run();
  });
  const manifestPath = createManifest(fixture);
  const apply = runScript(["--apply", "--manifest", manifestPath]);
  assert.notEqual(apply.status, 0);
  assert.match(apply.stderr, /integrity_check failed/i);
  const target = new DatabaseSync(fixture.targetDatabasePath, { readOnly: true });
  assert.equal(target.prepare("SELECT COUNT(*) AS count FROM user_sessions").get().count, 1);
  assert.equal(target.prepare("SELECT discord_username FROM user_accounts WHERE id = 1").get().discord_username, "relay-user");
  target.close();
  assert.equal(existsSync(`${manifestPath}.applied`), false);
});

test("CLI rejects unknown arguments, missing files, and apply-time path overrides", () => {
  const unknown = runScript(["--wat"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown argument: --wat/);

  const fixture = createFixture();
  const cutoffOverride = runScript([
    ...dryRunArguments(fixture, path.join(fixture.directory, "operator-cutoff.json")),
    "--privacy-manifest-created-at", PRIVACY_MANIFEST_CREATED_AT,
  ]);
  assert.notEqual(cutoffOverride.status, 0);
  assert.match(cutoffOverride.stderr, /unknown argument.*privacy-manifest-created-at/i);

  const missingPrivacy = runScript([
    "--dry-run", "--source-db", fixture.sourceDatabasePath,
    "--target-db", fixture.targetDatabasePath,
    "--source-branding", fixture.sourceBrandingDirectory,
    "--target-branding", fixture.targetBrandingDirectory,
    "--claim-id", CLAIM_ID,
    "--manifest", path.join(fixture.directory, "no-privacy.json"),
  ]);
  assert.notEqual(missingPrivacy.status, 0);
  assert.match(missingPrivacy.stderr, /privacy cutover requires explicit/i);

  const missing = runScript([
    "--dry-run", "--source-db", path.join(fixture.directory, "missing.sqlite"),
    "--target-db", fixture.targetDatabasePath,
    "--source-branding", fixture.sourceBrandingDirectory,
    "--target-branding", fixture.targetBrandingDirectory,
    "--claim-id", CLAIM_ID,
    "--manifest", path.join(fixture.directory, "missing.json"),
    "--source-privacy-ledger", fixture.sourceLedgerPath,
    "--target-privacy-ledger", fixture.targetLedgerPath,
    "--source-privacy-key", fixture.sourceKeyFilePath,
    "--target-privacy-key", fixture.targetKeyFilePath,
    "--source-config-root", fixture.sourceConfigRoot,
    "--target-config-root", fixture.targetConfigRoot,
    "--source-backup-root", fixture.sourceBackupRoot,
    "--target-backup-root", fixture.targetBackupRoot,
    "--installed-previous-privacy-key", fixture.installedPreviousKeyFilePath,
    "--privacy-key-ready-artifact", fixture.privacyReadinessArtifactPath,
  ]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /does not exist/i);

  const manifestPath = createManifest(fixture);
  const override = runScript(["--apply", "--manifest", manifestPath, "--target-db", fixture.targetDatabasePath]);
  assert.notEqual(override.status, 0);
  assert.match(override.stderr, /accepts only --manifest/i);
});
