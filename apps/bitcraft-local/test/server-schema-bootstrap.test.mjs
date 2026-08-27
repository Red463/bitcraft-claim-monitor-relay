import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { applySchemaBootstrap, schemaBootstrapSql } from "../src/server/schemaBootstrap.mjs";

test("schemaBootstrapSql preserves critical release tables and indexes", () => {
  for (const fragment of [
    "CREATE TABLE IF NOT EXISTS settlement_state_current",
    "CREATE TABLE IF NOT EXISTS app_settings",
    "CREATE TABLE IF NOT EXISTS admin_users",
    "CREATE TABLE IF NOT EXISTS user_accounts",
    "CREATE TABLE IF NOT EXISTS user_legal_acceptances",
    "CREATE TABLE IF NOT EXISTS market_deal_alerts",
    "CREATE TABLE IF NOT EXISTS craft_plan_settings",
    "CREATE TABLE IF NOT EXISTS craft_plan_progress_audit_snapshots",
    "CREATE TABLE IF NOT EXISTS craft_plan_progress_audit_events",
    "CREATE TABLE IF NOT EXISTS craft_plan_progress_audit_state",
    "CREATE TABLE IF NOT EXISTS production_jobs",
    "CREATE TABLE IF NOT EXISTS discord_delivery_log",
    "CREATE TABLE IF NOT EXISTS discord_notification_outbox",
    "CREATE TABLE IF NOT EXISTS discord_craft_plan_report_occurrences",
    "CREATE TABLE IF NOT EXISTS discord_youtube_channels",
    "discord_channel_id TEXT",
    "CREATE TABLE IF NOT EXISTS discord_youtube_videos",
    "CREATE TABLE IF NOT EXISTS provider_transition_outbox",
    "CREATE TABLE IF NOT EXISTS operational_history_market_trade_daily",
    "CREATE TABLE IF NOT EXISTS operational_history_market_event_daily",
    "CREATE TABLE IF NOT EXISTS operational_history_activity_daily",
    "CREATE TABLE IF NOT EXISTS operational_history_source_ingestion_ids",
    "CREATE TABLE IF NOT EXISTS operational_history_source_mutations",
    "CREATE INDEX IF NOT EXISTS idx_operational_history_source_mutations_coverage",
    "CREATE TRIGGER IF NOT EXISTS operational_history_market_trade_ingestion_id",
    "CREATE TRIGGER IF NOT EXISTS operational_history_market_trade_update",
    "CREATE TRIGGER IF NOT EXISTS operational_history_market_trade_delete",
    "CREATE TABLE IF NOT EXISTS operational_history_rollup_watermarks",
    "CREATE TABLE IF NOT EXISTS operational_history_retention_runs",
    "CREATE TABLE IF NOT EXISTS operational_history_backup_verifications",
    "locked_by TEXT",
    "lease_token TEXT",
    "locked_at TEXT",
    "lease_expires_at TEXT",
    "CREATE TABLE IF NOT EXISTS empire_membership_tracking",
    "CREATE TABLE IF NOT EXISTS empire_membership_periods",
    "CREATE INDEX IF NOT EXISTS idx_market_events_claim_time",
    "CREATE INDEX IF NOT EXISTS idx_market_trades_claim_item_time",
    "CREATE INDEX IF NOT EXISTS idx_market_trades_claim_region_item_time",
    "CREATE INDEX IF NOT EXISTS idx_provider_transition_pending",
    "CREATE INDEX IF NOT EXISTS idx_user_legal_acceptances_user_time",
    "CREATE INDEX IF NOT EXISTS idx_activity_claim_time",
    "CREATE INDEX IF NOT EXISTS idx_discord_notification_outbox_status",
    "CREATE INDEX IF NOT EXISTS idx_discord_craft_plan_report_occurrences_time",
    "CREATE INDEX IF NOT EXISTS idx_domain_payload_claim",
    "CREATE INDEX IF NOT EXISTS idx_craft_plan_settings_updated",
    "CREATE INDEX IF NOT EXISTS idx_craft_plan_progress_snapshots_claim_time",
    "CREATE INDEX IF NOT EXISTS idx_craft_plan_progress_events_claim_time",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_empire_membership_active_tracking",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_empire_membership_open_period",
    "CREATE INDEX IF NOT EXISTS idx_empire_membership_current",
    "CREATE INDEX IF NOT EXISTS idx_empire_membership_departures",
    "CREATE INDEX IF NOT EXISTS idx_empire_membership_retention",
  ]) {
    assert.match(schemaBootstrapSql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(schemaBootstrapSql, /CREATE TABLE IF NOT EXISTS snapshots/);
  assert.doesNotMatch(schemaBootstrapSql, /idx_snapshots_/);
  assert.doesNotMatch(schemaBootstrapSql, /CREATE TABLE IF NOT EXISTS market_listings/);
  assert.doesNotMatch(schemaBootstrapSql, /CREATE TABLE IF NOT EXISTS market_buy_orders_current/);
  assert.doesNotMatch(schemaBootstrapSql, /CREATE TABLE IF NOT EXISTS market_regional_sale_averages_current/);
  assert.doesNotMatch(schemaBootstrapSql, /CREATE TABLE IF NOT EXISTS empire_hexite_/);
  assert.doesNotMatch(schemaBootstrapSql, /idx_provider_transition_lease/);
  assert.match(schemaBootstrapSql, /CREATE TABLE IF NOT EXISTS market_trades[\s\S]*region_id TEXT/);
  assert.doesNotMatch(schemaBootstrapSql, /operational_history_[\s\S]*raw_json/);
});

test("applySchemaBootstrap executes the complete bootstrap SQL once", () => {
  const statements = [];
  const db = { exec: (sql) => statements.push(sql) };

  applySchemaBootstrap(db);

  assert.deepEqual(statements, [schemaBootstrapSql]);
});

test("fresh Deal Watch history stores exact market amounts as text", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);

  const watchColumns = new Map(
    db.prepare("PRAGMA table_info(market_deal_watches)").all()
      .map((column) => [column.name, column.type]),
  );
  const alertColumns = new Map(
    db.prepare("PRAGMA table_info(market_deal_alerts)").all()
      .map((column) => [column.name, column.type]),
  );

  assert.equal(watchColumns.get("last_baseline_average"), "TEXT");
  for (const column of ["quantity", "unit_price", "total_value", "baseline_average"]) {
    assert.equal(alertColumns.get(column), "TEXT");
  }
  db.close();
});

test("membership history schema is additive and preserves existing data", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("claim_id", "123", "2026-07-24T00:00:00.000Z");

  applySchemaBootstrap(db);
  applySchemaBootstrap(db);

  assert.equal(db.prepare("SELECT value FROM app_settings WHERE key = 'claim_id'").get().value, "123");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM empire_membership_tracking").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM empire_membership_periods").get().count, 0);
  db.close();
});

test("fresh Relay schema keeps market history without a duplicate current-listing table", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);

  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'market_listings'").get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'market_events'").get().count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('market_buy_orders_current', 'market_regional_sale_averages_current')").get().count,
    0,
  );
  db.close();
});

test("fresh Relay subscription health starts explicitly disconnected", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);

  db.prepare(`
    INSERT INTO provider_subscription_health (
      provider, source_key, domain, connected, updated_at
    ) VALUES ('relay', 'global', 'region', 0, '2026-08-22T09:40:00.000Z')
  `).run();

  assert.deepEqual(
    { ...db.prepare(`
      SELECT connected, runtime_state
      FROM provider_subscription_health
      WHERE provider = 'relay' AND source_key = 'global' AND domain = 'region'
    `).get() },
    { connected: 0, runtime_state: "disconnected" },
  );
  db.close();
});

test("legal acceptance schema enforces one exact document snapshot per user", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);

  const userId = Number(db.prepare(`
    INSERT INTO user_accounts (discord_id, character_status, settings_json, created_at)
    VALUES ('legal-user', 'unlinked', '{}', '2026-07-25T00:00:00.000Z')
    RETURNING id
  `).get().id);
  const insert = db.prepare(`
    INSERT INTO user_legal_acceptances (
      user_id, legal_version, terms_digest, privacy_digest,
      age_confirmed, accepted_at, source
    ) VALUES (?, ?, ?, ?, 1, ?, 'oauth')
  `);
  insert.run(userId, "2026-07-25", "terms", "privacy", "2026-07-25T00:00:00.000Z");
  assert.throws(
    () => insert.run(userId, "2026-07-25", "terms", "privacy", "2026-07-25T00:00:01.000Z"),
    /UNIQUE constraint failed/,
  );
  db.close();
});

test("fresh schema does not recreate retired public-profile tables", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  const retiredTables = [
    "public_craft_plan_events",
    "public_craft_plan_share_links",
    "public_craft_plan_invites",
    "public_craft_plan_members",
    "public_craft_plans",
    "public_user_legal_acceptances",
    "public_user_sessions",
    "public_user_accounts",
  ];
  assert.deepEqual(
    db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${retiredTables.map(() => "?").join(",")})`).all(...retiredTables),
    [],
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'user_accounts'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'admin_users'").get().count, 1);
  db.close();
});
