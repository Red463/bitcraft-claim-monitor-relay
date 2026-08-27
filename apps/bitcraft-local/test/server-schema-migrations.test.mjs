import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, constants as sqliteConstants } from "node:sqlite";
import test from "node:test";

import {
  additiveColumnMigrations,
  applyAdditiveColumnMigrations,
  applyLegacySchemaCleanup,
  applyOperationalHistoryRetentionMigration,
  applyMarketHistoryExactAmountMigration,
  applyMarketTradeRegionBackfill,
  applyProductionContributionExactAmountMigration,
  applyProviderTransitionLeaseMigration,
  applySchemaIndexStatements,
  providerTransitionLeaseColumnMigrations,
  providerTransitionLeaseIndexStatements,
  retiredTableNames,
  schemaIndexStatements,
} from "../src/server/schemaMigrations.mjs";
import { installRetiredTableAuthorizer } from "../src/server/retiredTableAuthorizer.mjs";
import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import { createCurrentStateRepository } from "../src/server/game-data/currentStateRepository.ts";

test("operational history retention migration is additive, narrow, and idempotent", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  db.prepare(`
    INSERT INTO market_trades (
      trade_id, claim_id, item_name, quantity, unit_price, total_price,
      occurred_at, imported_at, raw_json
    ) VALUES ('kept', '1', 'Timber', '1', '2', '2', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:01.000Z', '{}')
  `).run();

  applyOperationalHistoryRetentionMigration(db);
  applyOperationalHistoryRetentionMigration(db);

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM market_trades").get().count, 1);
  for (const table of [
    "operational_history_market_trade_daily",
    "operational_history_market_event_daily",
    "operational_history_activity_daily",
    "operational_history_source_ingestion_ids",
    "operational_history_source_mutations",
    "operational_history_rollup_watermarks",
    "operational_history_retention_runs",
    "operational_history_backup_verifications",
  ]) {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table).count, 1);
    assert.equal(db.prepare(`PRAGMA table_info("${table}")`).all().some((column) => column.name === "raw_json"), false);
  }
  const watermarkColumns = db.prepare("PRAGMA table_info(operational_history_rollup_watermarks)").all().map((column) => column.name);
  assert.ok(watermarkColumns.includes("source_max_occurred_at"));
  assert.ok(watermarkColumns.includes("source_max_ingestion_id"));
  assert.ok(watermarkColumns.includes("source_max_mutation_id"));
  assert.ok(watermarkColumns.includes("source_fingerprint"));
  assert.ok(watermarkColumns.includes("remaining_source_fingerprint"));
  const backupColumns = db.prepare("PRAGMA table_info(operational_history_backup_verifications)").all().map((column) => column.name);
  assert.ok(backupColumns.includes("backup_path"));
  assert.ok(backupColumns.includes("manifest_path"));
  assert.ok(backupColumns.includes("restored_database_sha256"));
  assert.ok(backupColumns.includes("restored_manifest_sha256"));
  assert.equal(db.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_schema
    WHERE type = 'trigger' AND name IN (
      'operational_history_market_trade_ingestion_id',
      'operational_history_market_trade_update',
      'operational_history_market_trade_delete'
    )
  `).get().count, 3);
  db.close();
});

test("operational history migration reconciles every market trade to one safe positive ingestion identity", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  db.exec(`
    DROP TRIGGER operational_history_market_trade_ingestion_id;
    DROP TRIGGER operational_history_market_trade_update;
    DROP TRIGGER operational_history_market_trade_delete;
    INSERT INTO market_trades (
      trade_id, claim_id, item_name, quantity, unit_price, total_price,
      occurred_at, imported_at, raw_json
    ) VALUES
      ('missing', '1', 'Timber', '1', '2', '2', '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:01.000Z', '{}'),
      ('invalid', '1', 'Timber', '1', '2', '2', '2026-08-21T00:01:00.000Z', '2026-08-21T00:01:01.000Z', '{}'),
      ('too-large', '1', 'Timber', '1', '2', '2', '2026-08-21T00:02:00.000Z', '2026-08-21T00:02:01.000Z', '{}');
    INSERT INTO operational_history_source_ingestion_ids (ingestion_id, source_table, source_key)
    VALUES
      (0, 'market_trades', 'invalid'),
      (9007199254740992, 'market_trades', 'too-large');
  `);

  applyOperationalHistoryRetentionMigration(db);
  applyOperationalHistoryRetentionMigration(db);

  const identities = db.prepare(`
    SELECT source.trade_id, COUNT(ingestion.ingestion_id) AS identity_count,
      MIN(ingestion.ingestion_id) AS ingestion_id
    FROM market_trades AS source
    LEFT JOIN operational_history_source_ingestion_ids AS ingestion
      ON ingestion.source_table = 'market_trades' AND ingestion.source_key = source.trade_id
    GROUP BY source.trade_id
    ORDER BY source.trade_id
  `).all().map((row) => ({ ...row }));
  assert.equal(identities.length, 3);
  for (const row of identities) {
    assert.equal(row.identity_count, 1);
    assert.equal(Number.isSafeInteger(Number(row.ingestion_id)) && Number(row.ingestion_id) > 0, true);
  }
  db.close();
});

test("operational history migration excludes concurrent writers and reconciles after a blocked attempt", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "operational-retention-migration-"));
  const databasePath = path.join(directory, "fixture.sqlite");
  const migrationConnection = new DatabaseSync(databasePath);
  const writerConnection = new DatabaseSync(databasePath);
  try {
    applySchemaBootstrap(migrationConnection);
    migrationConnection.exec(`
      DROP TRIGGER operational_history_market_trade_ingestion_id;
      DROP TRIGGER operational_history_market_trade_update;
      DROP TRIGGER operational_history_market_trade_delete;
    `);
    writerConnection.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
    writerConnection.prepare(`
      INSERT INTO market_trades (
        trade_id, claim_id, item_name, quantity, unit_price, total_price,
        occurred_at, imported_at, raw_json
      ) VALUES ('racing', '1', 'Timber', '1', '2', '2',
        '2026-08-21T00:00:00.000Z', '2026-08-21T00:00:01.000Z', '{}')
    `).run();
    assert.throws(() => applyOperationalHistoryRetentionMigration(migrationConnection), /busy|locked/i);
    writerConnection.exec("COMMIT");

    const criticalTransactionStates = [];
    migrationConnection.setAuthorizer((action, name) => {
      if ((action === sqliteConstants.SQLITE_DROP_TRIGGER || action === sqliteConstants.SQLITE_CREATE_TRIGGER)
        && String(name).startsWith("operational_history_market_trade_")) {
        criticalTransactionStates.push(migrationConnection.isTransaction);
      }
      if ((action === sqliteConstants.SQLITE_INSERT || action === sqliteConstants.SQLITE_DELETE)
        && name === "operational_history_source_ingestion_ids") {
        criticalTransactionStates.push(migrationConnection.isTransaction);
      }
      return sqliteConstants.SQLITE_OK;
    });
    applyOperationalHistoryRetentionMigration(migrationConnection);
    migrationConnection.setAuthorizer(null);
    writerConnection.prepare(`
      INSERT INTO market_trades (
        trade_id, claim_id, item_name, quantity, unit_price, total_price,
        occurred_at, imported_at, raw_json
      ) VALUES ('after', '1', 'Timber', '1', '2', '2',
        '2026-08-21T00:02:00.000Z', '2026-08-21T00:02:01.000Z', '{}')
    `).run();

    assert.ok(criticalTransactionStates.length > 0);
    assert.equal(criticalTransactionStates.every(Boolean), true);
    const unsafe = migrationConnection.prepare(`
      SELECT COUNT(*) AS count
      FROM market_trades AS source
      LEFT JOIN operational_history_source_ingestion_ids AS ingestion
        ON ingestion.source_table = 'market_trades' AND ingestion.source_key = source.trade_id
      WHERE ingestion.ingestion_id IS NULL
        OR typeof(ingestion.ingestion_id) <> 'integer'
        OR ingestion.ingestion_id <= 0
        OR ingestion.ingestion_id > 9007199254740991
    `).get().count;
    assert.equal(unsafe, 0);
  } finally {
    try { writerConnection.exec("ROLLBACK"); } catch {}
    migrationConnection.setAuthorizer(null);
    writerConnection.close();
    migrationConnection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("provider transition lease migration is additive and preserves pending rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE provider_transition_outbox (
      transition_key TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO provider_transition_outbox VALUES (
      'claim-market:100:market:2', '100', 'market',
      '2026-08-22T10:00:00.000Z', '{"version":1,"events":[]}',
      0, NULL, '2026-08-22T10:00:00.000Z', '2026-08-22T10:00:00.000Z'
    );
  `);

  applyProviderTransitionLeaseMigration(db);
  applyProviderTransitionLeaseMigration(db);

  assert.deepEqual(providerTransitionLeaseColumnMigrations, [
    { table: "provider_transition_outbox", column: "locked_by", definition: "TEXT" },
    { table: "provider_transition_outbox", column: "lease_token", definition: "TEXT" },
    { table: "provider_transition_outbox", column: "locked_at", definition: "TEXT" },
    { table: "provider_transition_outbox", column: "lease_expires_at", definition: "TEXT" },
  ]);
  assert.deepEqual(providerTransitionLeaseIndexStatements, [
    "CREATE INDEX IF NOT EXISTS idx_provider_transition_lease ON provider_transition_outbox (claim_id, domain, updated_at, lease_expires_at, created_at, transition_key);",
  ]);
  const row = db.prepare(`
    SELECT transition_key, locked_by, lease_token, locked_at, lease_expires_at
    FROM provider_transition_outbox
  `).get();
  assert.deepEqual({ ...row }, {
    transition_key: "claim-market:100:market:2",
    locked_by: null,
    lease_token: null,
    locked_at: null,
    lease_expires_at: null,
  });
  assert.equal(
    db.prepare("PRAGMA index_list(provider_transition_outbox)").all()
      .some((index) => index.name === "idx_provider_transition_lease"),
    true,
  );
  db.close();
});

test("legacy provider transitions survive production bootstrap before lease migration", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE provider_transition_outbox (
      transition_key TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO provider_transition_outbox VALUES (
      'claim-market:100:market:2', '100', 'market',
      '2026-08-22T10:00:00.000Z', '{"version":1,"events":[]}',
      0, NULL, '2026-08-22T10:00:00.000Z', '2026-08-22T10:00:00.000Z'
    );
  `);

  applySchemaBootstrap(db);
  applyProviderTransitionLeaseMigration(db);
  applySchemaBootstrap(db);
  applyProviderTransitionLeaseMigration(db);

  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM provider_transition_outbox").get().count,
    1,
  );
  assert.equal(
    db.prepare("PRAGMA index_list(provider_transition_outbox)").all()
      .some((index) => index.name === "idx_provider_transition_lease"),
    true,
  );
  db.close();
});

test("fresh production bootstrap plus lease migration creates the lease index idempotently", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyProviderTransitionLeaseMigration(db);
  applySchemaBootstrap(db);
  applyProviderTransitionLeaseMigration(db);

  assert.equal(
    db.prepare("PRAGMA index_list(provider_transition_outbox)").all()
      .filter((index) => index.name === "idx_provider_transition_lease").length,
    1,
  );
  db.close();
});

test("production contribution repair acquires its write transaction before reading counters", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  db.prepare(`
    INSERT INTO production_contributions (
      contribution_key, claim_id, craft_entity_id, contributor_entity_id,
      contributor_name, contributed_progress, contributed_xp,
      contribution_count, first_seen, updated_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "1:2:3",
    "1",
    "2",
    "3",
    "Ada",
    "24.0",
    "48.0",
    "1.0",
    "2026-08-01T09:00:00.000Z",
    "2026-08-01T09:00:00.000Z",
    "{}",
  );

  const operations = [];
  const observedDb = {
    exec(sql) {
      operations.push({ kind: "exec", sql: String(sql) });
      return db.exec(sql);
    },
    prepare(sql) {
      operations.push({ kind: "prepare", sql: String(sql) });
      return db.prepare(sql);
    },
  };
  applyProductionContributionExactAmountMigration(observedDb);

  const transactionIndex = operations.findIndex(
    ({ kind, sql }) => kind === "exec" && sql.trim() === "BEGIN IMMEDIATE",
  );
  const counterReadIndex = operations.findIndex(
    ({ kind, sql }) => kind === "prepare"
      && sql.includes("SELECT contribution_key, contributed_progress, contribution_count"),
  );
  assert.notEqual(transactionIndex, -1);
  assert.notEqual(counterReadIndex, -1);
  assert.ok(
    transactionIndex < counterReadIndex,
    "counter repair candidates must be read after acquiring the write transaction",
  );
  db.close();
});

test("production contribution migration canonicalizes legacy counters before appending", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE production_contributions (
      contribution_key TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      craft_entity_id TEXT NOT NULL,
      contributor_entity_id TEXT NOT NULL,
      contributor_name TEXT NOT NULL,
      profession TEXT,
      craft_label TEXT,
      structure_name TEXT,
      item_tier TEXT,
      contributed_progress REAL NOT NULL DEFAULT 0,
      contributed_xp REAL NOT NULL DEFAULT 0,
      contribution_count REAL NOT NULL DEFAULT 0,
      first_contributed_at TEXT,
      last_contributed_at TEXT,
      first_seen TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    INSERT INTO production_contributions VALUES (
      '1:2:3', '1', '2', '3', 'Ada', 'Forestry', 'Timber', 'Forester',
      '3', 24, 48, 1, '2026-08-01T09:00:00.000Z',
      '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z',
      '2026-08-01T09:00:00.000Z', '{}'
    );
  `);

  applySchemaBootstrap(db);
  applyAdditiveColumnMigrations(db);
  db.prepare(`
    INSERT INTO production_contribution_events (
      source_key, claim_id, region_id, craft_entity_id, contributor_entity_id,
      attribution_confidence, contributed_progress, contributed_xp, occurred_at,
      received_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "relay-craft-contribution:19:authoritative:reducer:0xabc:2:0:24",
    "1", "19", "2", "3", "authoritative", "24", "48",
    "2026-08-01T09:00:00.000Z", "2026-08-01T09:00:00.000Z",
    JSON.stringify({ contributorName: "Ada", profession: "Forestry", craftLabel: "Timber", structureName: "Forester", itemTier: "3", evidenceKey: "reducer:0xabc" }),
  );
  applyProductionContributionExactAmountMigration(db);
  applyProductionContributionExactAmountMigration(db);
  applySchemaIndexStatements(db);

  const types = new Map(db.prepare("PRAGMA table_info(production_contributions)").all().map(
    (column) => [String(column.name), String(column.type)],
  ));
  assert.equal(types.get("contributed_progress"), "TEXT");
  assert.equal(types.get("contributed_xp"), "TEXT");
  assert.equal(types.get("contribution_count"), "TEXT");
  assert.deepEqual(
    { ...db.prepare(`
      SELECT contributed_progress, contributed_xp, contribution_count
      FROM production_contributions
    `).get() },
    {
      contributed_progress: "24",
      contributed_xp: "48",
      contribution_count: "1",
    },
  );
  const repository = createCurrentStateRepository(db);
  await repository.appendEvents([{
    claimId: "1",
    domain: "contributions",
    sourceKey: "relay-craft-contribution:19:matched_action:action:100:2:24:25",
    occurredAt: "2026-08-01T09:00:01.000Z",
    data: {
      eventType: "craft_contribution",
      regionId: "19",
      craftEntityId: "2",
      contributorEntityId: "3",
      contributorName: "Ada",
      attributionConfidence: "matched_action",
      evidenceKey: "action:100",
      craftOwnerEntityId: "3",
      profession: "Forestry",
      craftLabel: "Timber",
      structureName: "Forester",
      itemTier: "3",
      contributedProgress: "1",
      contributedXp: "1.76",
      contributionCount: "1",
      previousProgress: "24",
      currentProgress: "25",
      observedSince: "2026-08-01T09:00:01.000Z",
    },
  }]);
  assert.deepEqual(
    { ...db.prepare(`
      SELECT contributed_progress, contributed_xp, contribution_count
      FROM production_contributions
      WHERE contribution_key = '1:2:3'
    `).get() },
    {
      contributed_progress: "25",
      contributed_xp: "49.76",
      contribution_count: "2",
    },
  );
  db.close();
});

test("market history migration stores exact integer amounts as text", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE market_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      listing_key TEXT NOT NULL,
      item_name TEXT NOT NULL,
      side TEXT,
      owner TEXT,
      owner_entity_id TEXT,
      item_id TEXT,
      item_type TEXT,
      quantity REAL,
      price REAL,
      total_value REAL,
      tier TEXT,
      rarity TEXT,
      occurred_at TEXT NOT NULL,
      trade_id TEXT,
      source_key TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE market_trades (
      trade_id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      order_entity_id TEXT,
      seller_entity_id TEXT,
      seller_username TEXT,
      purchaser_entity_id TEXT,
      purchaser_username TEXT,
      item_id TEXT,
      item_type TEXT,
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      tier TEXT,
      rarity TEXT,
      occurred_at TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    INSERT INTO market_events (
      claim_id, event_type, listing_key, item_name, quantity, price,
      total_value, occurred_at, source_key, raw_json
    ) VALUES (
      '100', 'sale_confirmed', '10', 'Timber', 3, 5, 15,
      '2026-07-30T15:00:00.000Z', 'event:10', '{}'
    );
    INSERT INTO market_trades (
      trade_id, claim_id, item_name, quantity, unit_price, total_price,
      occurred_at, imported_at, raw_json
    ) VALUES (
      'trade:10', '100', 'Timber', 3, 5, 15,
      '2026-07-30T15:00:00.000Z', '2026-07-30T15:00:01.000Z', '{}'
    );
  `);

  applyMarketHistoryExactAmountMigration(db);
  applyMarketHistoryExactAmountMigration(db);

  const eventTypes = new Map(db.prepare("PRAGMA table_info(market_events)").all().map(
    (column) => [String(column.name), String(column.type)],
  ));
  const tradeTypes = new Map(db.prepare("PRAGMA table_info(market_trades)").all().map(
    (column) => [String(column.name), String(column.type)],
  ));
  assert.equal(eventTypes.get("quantity"), "TEXT");
  assert.equal(eventTypes.get("price"), "TEXT");
  assert.equal(eventTypes.get("total_value"), "TEXT");
  assert.equal(tradeTypes.get("quantity"), "TEXT");
  assert.equal(tradeTypes.get("unit_price"), "TEXT");
  assert.equal(tradeTypes.get("total_price"), "TEXT");
  assert.equal(tradeTypes.get("region_id"), "TEXT");
  assert.deepEqual(
    { ...db.prepare(`
      SELECT quantity, price, total_value, source_key FROM market_events
    `).get() },
    { quantity: "3.0", price: "5.0", total_value: "15.0", source_key: "event:10" },
  );
  assert.deepEqual(
    { ...db.prepare(`
      SELECT quantity, unit_price, total_price FROM market_trades
    `).get() },
    { quantity: "3.0", unit_price: "5.0", total_price: "15.0" },
  );
  db.close();
});

test("market trade region migration backfills authoritative Relay identities", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE market_trades (
      trade_id TEXT PRIMARY KEY,
      region_id TEXT,
      raw_json TEXT NOT NULL
    );
    INSERT INTO market_trades VALUES (
      'relay_closed_listing:19:100', NULL, '{}'
    );
    INSERT INTO market_trades VALUES (
      'legacy:200', NULL, '{"listing":{"regionId":"7"}}'
    );
    INSERT INTO market_trades VALUES (
      'unknown:300', NULL, '{}'
    );
  `);

  applyMarketTradeRegionBackfill(db);
  applyMarketTradeRegionBackfill(db);

  assert.deepEqual(
    db.prepare("SELECT trade_id, region_id FROM market_trades ORDER BY trade_id").all()
      .map((row) => ({ ...row })),
    [{
      trade_id: "legacy:200",
      region_id: "7",
    }, {
      trade_id: "relay_closed_listing:19:100",
      region_id: "19",
    }, {
      trade_id: "unknown:300",
      region_id: null,
    }],
  );
  db.close();
});

test("additiveColumnMigrations preserves bootstrap column migration order", () => {
  assert.deepEqual(additiveColumnMigrations, [
    { table: "market_events", column: "owner_entity_id", definition: "TEXT" },
    { table: "market_events", column: "item_id", definition: "TEXT" },
    { table: "market_events", column: "item_type", definition: "TEXT" },
    { table: "market_events", column: "trade_id", definition: "TEXT" },
    { table: "market_events", column: "source_key", definition: "TEXT" },
    { table: "market_trades", column: "region_id", definition: "TEXT" },
    { table: "activity_events", column: "source_key", definition: "TEXT" },
    { table: "admin_users", column: "active", definition: "INTEGER NOT NULL DEFAULT 1" },
    { table: "admin_users", column: "last_login_at", definition: "TEXT" },
    { table: "admin_users", column: "role", definition: "TEXT NOT NULL DEFAULT 'owner'" },
    { table: "admin_users", column: "discord_id", definition: "TEXT" },
    { table: "admin_users", column: "discord_username", definition: "TEXT" },
    { table: "admin_users", column: "discord_global_name", definition: "TEXT" },
    { table: "admin_users", column: "discord_avatar", definition: "TEXT" },
    { table: "user_sessions", column: "reauthenticated_at", definition: "TEXT" },
    { table: "user_accounts", column: "inactivity_warning_sent_at", definition: "TEXT" },
    { table: "production_jobs", column: "start_notified", definition: "INTEGER NOT NULL DEFAULT 0" },
    { table: "provider_subscription_health", column: "runtime_state", definition: "TEXT NOT NULL DEFAULT 'disconnected' CHECK (runtime_state IN ('connected', 'disconnected', 'blocked_by_schema'))" },
    { table: "domain_payload_current", column: "updated_at", definition: "TEXT" },
    { table: "domain_payload_current", column: "provider", definition: "TEXT NOT NULL DEFAULT 'legacy'" },
    { table: "domain_payload_current", column: "source_key", definition: "TEXT" },
    { table: "domain_payload_current", column: "region_id", definition: "TEXT" },
    { table: "domain_payload_current", column: "database_name", definition: "TEXT" },
    { table: "domain_payload_current", column: "schema_fingerprint", definition: "TEXT" },
    { table: "domain_payload_current", column: "source_observed_at", definition: "TEXT" },
    { table: "domain_payload_current", column: "received_at", definition: "TEXT" },
    { table: "domain_payload_current", column: "freshness", definition: "TEXT NOT NULL DEFAULT 'unavailable'" },
    { table: "domain_payload_current", column: "confidence", definition: "TEXT NOT NULL DEFAULT 'unknown'" },
    { table: "domain_payload_current", column: "generation", definition: "INTEGER NOT NULL DEFAULT 0" },
    { table: "domain_payload_current", column: "warnings_json", definition: "TEXT NOT NULL DEFAULT '[]'" },
    { table: "discord_youtube_channels", column: "discord_channel_id", definition: "TEXT" },
    { table: "game_catalog_item_list_outputs", column: "guaranteed_quantity", definition: "REAL NOT NULL DEFAULT 0" },
    { table: "game_catalog_recipes", column: "action_count", definition: "REAL NOT NULL DEFAULT 0" },
    { table: "game_catalog_recipes", column: "activity_kind", definition: "TEXT NOT NULL DEFAULT 'craft' CHECK (activity_kind IN ('craft', 'gathering'))" },
    { table: "game_catalog_recipes", column: "gathering_mode", definition: "TEXT NOT NULL DEFAULT 'ordinary' CHECK (gathering_mode IN ('ordinary', 'prospecting'))" },
    { table: "game_catalog_entities", column: "item_list_id", definition: "TEXT" },
    { table: "game_catalog_recipes", column: "resource_id", definition: "TEXT" },
    { table: "game_catalog_recipe_outputs", column: "occurrence_rate", definition: "REAL NOT NULL DEFAULT 1" },
    { table: "game_catalog_recipe_outputs", column: "yield_basis", definition: "TEXT NOT NULL DEFAULT 'per_craft' CHECK (yield_basis IN ('per_craft', 'per_progress'))" },
    { table: "game_catalog_recipe_outputs", column: "guaranteed_quantity", definition: "REAL" },
    { table: "game_catalog_item_list_possibility_outputs", column: "nested_item_list_id", definition: "TEXT" },
  ]);
});

test("typed subscription runtime state migrates additively without losing its heartbeat", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE provider_subscription_health (
      provider TEXT NOT NULL,
      source_key TEXT NOT NULL,
      domain TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0,
      connected INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (provider, source_key, domain)
    );
    INSERT INTO provider_subscription_health (
      provider, source_key, domain, generation, connected, updated_at
    ) VALUES (
      'relay', 'global', 'region', 7, 1, '2026-08-22T09:45:00.000Z'
    );
  `);

  applyAdditiveColumnMigrations(db, [{
    table: "provider_subscription_health",
    column: "runtime_state",
    definition: "TEXT NOT NULL DEFAULT 'disconnected' CHECK (runtime_state IN ('connected', 'disconnected', 'blocked_by_schema'))",
  }]);

  assert.deepEqual(
    { ...db.prepare(`
      SELECT generation, connected, runtime_state, updated_at
      FROM provider_subscription_health
    `).get() },
    {
      generation: 7,
      connected: 1,
      runtime_state: "disconnected",
      updated_at: "2026-08-22T09:45:00.000Z",
    },
  );
  db.close();
});

test("reauthentication timestamp migrates existing user sessions without losing them", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO user_sessions VALUES (
      'session-hash', 7, '2026-08-24T00:00:00.000Z', '2026-07-25T00:00:00.000Z'
    );
  `);

  applyAdditiveColumnMigrations(db, [{
    table: "user_sessions",
    column: "reauthenticated_at",
    definition: "TEXT",
  }]);

  assert.deepEqual(
    { ...db.prepare("SELECT token_hash, user_id, reauthenticated_at FROM user_sessions").get() },
    { token_hash: "session-hash", user_id: 7, reauthenticated_at: null },
  );
  db.close();
});

test("guaranteed item-list quantity migrates an existing catalog additively", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE game_catalog_item_list_outputs (
      producer_key TEXT NOT NULL,
      output_key TEXT NOT NULL,
      quantity REAL NOT NULL,
      chance REAL,
      PRIMARY KEY (producer_key, output_key)
    );
    INSERT INTO game_catalog_item_list_outputs (producer_key, output_key, quantity, chance)
    VALUES ('items:products', 'items:oil', 3.05, 1);
  `);

  applyAdditiveColumnMigrations(db, [{
    table: "game_catalog_item_list_outputs",
    column: "guaranteed_quantity",
    definition: "REAL NOT NULL DEFAULT 0",
  }]);

  assert.deepEqual(
    { ...db.prepare("SELECT quantity, guaranteed_quantity FROM game_catalog_item_list_outputs").get() },
    { quantity: 3.05, guaranteed_quantity: 0 },
  );
  db.close();
});

test("probability catalogue columns migrate existing recipe and item-list rows without data loss", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE game_catalog_entities (catalog_key TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE game_catalog_recipes (recipe_key TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE game_catalog_recipe_outputs (
      recipe_key TEXT NOT NULL,
      output_key TEXT NOT NULL,
      quantity REAL NOT NULL,
      PRIMARY KEY (recipe_key, output_key)
    );
    CREATE TABLE game_catalog_item_list_possibility_outputs (
      item_list_id TEXT NOT NULL,
      possibility_index INTEGER NOT NULL,
      output_index INTEGER NOT NULL,
      output_key TEXT NOT NULL,
      PRIMARY KEY (item_list_id, possibility_index, output_index)
    );
    INSERT INTO game_catalog_entities VALUES ('items:1', 'Existing Item');
    INSERT INTO game_catalog_recipes VALUES ('recipe:1', 'Existing Recipe');
    INSERT INTO game_catalog_recipe_outputs VALUES ('recipe:1', 'items:1', 2);
    INSERT INTO game_catalog_item_list_possibility_outputs VALUES ('10', 0, 0, 'items:1');
  `);

  applyAdditiveColumnMigrations(db, [
    { table: "game_catalog_entities", column: "item_list_id", definition: "TEXT" },
    { table: "game_catalog_recipes", column: "resource_id", definition: "TEXT" },
    { table: "game_catalog_recipes", column: "gathering_mode", definition: "TEXT NOT NULL DEFAULT 'ordinary' CHECK (gathering_mode IN ('ordinary', 'prospecting'))" },
    { table: "game_catalog_recipe_outputs", column: "occurrence_rate", definition: "REAL NOT NULL DEFAULT 1" },
    { table: "game_catalog_recipe_outputs", column: "yield_basis", definition: "TEXT NOT NULL DEFAULT 'per_craft' CHECK (yield_basis IN ('per_craft', 'per_progress'))" },
    { table: "game_catalog_recipe_outputs", column: "guaranteed_quantity", definition: "REAL" },
    { table: "game_catalog_item_list_possibility_outputs", column: "nested_item_list_id", definition: "TEXT" },
  ]);

  assert.deepEqual(
    { ...db.prepare("SELECT output_key, quantity, occurrence_rate, yield_basis, guaranteed_quantity FROM game_catalog_recipe_outputs").get() },
    { output_key: "items:1", quantity: 2, occurrence_rate: 1, yield_basis: "per_craft", guaranteed_quantity: null },
  );
  assert.equal(db.prepare("SELECT gathering_mode FROM game_catalog_recipes").get().gathering_mode, "ordinary");
  assert.equal(db.prepare("SELECT name FROM game_catalog_entities WHERE catalog_key = 'items:1'").get().name, "Existing Item");
  assert.equal(db.prepare("SELECT output_key FROM game_catalog_item_list_possibility_outputs").get().output_key, "items:1");
  db.close();
});

test("schemaIndexStatements preserves release-sensitive unique indexes", () => {
  assert.deepEqual(schemaIndexStatements, [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_source ON activity_events (claim_id, event_type, source_key) WHERE source_key IS NOT NULL;",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_market_events_source ON market_events (claim_id, source_key) WHERE source_key IS NOT NULL;",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_discord_id ON admin_users (discord_id) WHERE discord_id IS NOT NULL AND discord_id <> '';",
    "CREATE INDEX IF NOT EXISTS idx_game_catalog_entities_item_list ON game_catalog_entities (item_list_id, catalog_key);",
    "CREATE INDEX IF NOT EXISTS idx_market_trades_claim_region_item_time ON market_trades (claim_id, region_id, item_id, item_type, occurred_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_production_contrib_claim ON production_contributions (claim_id, last_contributed_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_production_contrib_profession ON production_contributions (claim_id, profession, contributed_progress DESC);",
    "CREATE INDEX IF NOT EXISTS idx_production_contrib_events_claim ON production_contribution_events (claim_id, occurred_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_production_contrib_events_craft ON production_contribution_events (claim_id, craft_entity_id, occurred_at DESC);",
  ]);
});

test("recipe action count migrates without inventing effort for old rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE game_catalog_recipes (
      recipe_key TEXT PRIMARY KEY,
      name TEXT
    );
    INSERT INTO game_catalog_recipes (recipe_key, name) VALUES ('recipe:old', 'Old recipe');
  `);

  applyAdditiveColumnMigrations(db, [{
    table: "game_catalog_recipes",
    column: "action_count",
    definition: "REAL NOT NULL DEFAULT 0",
  }]);

  assert.deepEqual(
    { ...db.prepare("SELECT recipe_key, action_count FROM game_catalog_recipes").get() },
    { recipe_key: "recipe:old", action_count: 0 },
  );
  db.close();
});

test("recipe activity kind migrates old catalog rows safely as crafts", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE game_catalog_recipes (
      recipe_key TEXT PRIMARY KEY,
      name TEXT
    );
    INSERT INTO game_catalog_recipes (recipe_key, name) VALUES ('recipe:old', 'Split a trunk');
  `);

  applyAdditiveColumnMigrations(db, [{
    table: "game_catalog_recipes",
    column: "activity_kind",
    definition: "TEXT NOT NULL DEFAULT 'craft' CHECK (activity_kind IN ('craft', 'gathering'))",
  }]);

  assert.deepEqual(
    { ...db.prepare("SELECT recipe_key, activity_kind FROM game_catalog_recipes").get() },
    { recipe_key: "recipe:old", activity_kind: "craft" },
  );
  db.close();
});

test("applyAdditiveColumnMigrations adds only missing columns", () => {
  const existingColumns = new Map([
    ["example_table", new Set(["owner_entity_id"])],
    ["market_events", new Set()],
  ]);
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(["prepare", sql]);
      const table = sql.match(/PRAGMA table_info\(([^)]+)\)/)?.[1];
      return { all: () => [...(existingColumns.get(table) ?? new Set())].map((name) => ({ name })) };
    },
    exec(sql) {
      calls.push(["exec", sql]);
    },
  };

  applyAdditiveColumnMigrations(db, [
    { table: "example_table", column: "owner_entity_id", definition: "TEXT" },
    { table: "market_events", column: "source_key", definition: "TEXT" },
  ]);

  assert.deepEqual(calls, [
    ["prepare", "PRAGMA table_info(example_table)"],
    ["prepare", "PRAGMA table_info(market_events)"],
    ["exec", "ALTER TABLE market_events ADD COLUMN source_key TEXT"],
  ]);
});

test("applySchemaIndexStatements executes each bootstrap index statement", () => {
  const statements = [];
  const db = { exec: (sql) => statements.push(sql) };

  applySchemaIndexStatements(db, ["CREATE INDEX one;", "CREATE INDEX two;"]);

  assert.deepEqual(statements, ["CREATE INDEX one;", "CREATE INDEX two;"]);
});
test("applyLegacySchemaCleanup drops legacy server-owned cache tables", () => {
  const executed = [];
  const db = { exec: (sql) => executed.push(sql) };
  applyLegacySchemaCleanup(db);
  assert.equal(executed.length, 1);
  assert.match(executed[0], /DROP TABLE IF EXISTS current_claim_state/);
  assert.match(executed[0], /DROP TABLE IF EXISTS recipe_catalog_entries/);
  assert.match(executed[0], /DROP TABLE IF EXISTS game_catalog_refresh_targets/);
  assert.match(executed[0], /DROP TABLE IF EXISTS game_catalog_refresh_runs/);
  assert.match(executed[0], /DROP TABLE IF EXISTS market_listings/);
  assert.match(executed[0], /DROP TABLE IF EXISTS market_buy_orders_current/);
  assert.match(executed[0], /DROP TABLE IF EXISTS market_regional_sale_averages_current/);
  assert.match(executed[0], /DROP TABLE IF EXISTS global_market_price_snapshots/);
  assert.match(executed[0], /DROP TABLE IF EXISTS empire_hexite_targets/);
  assert.match(executed[0], /DROP TABLE IF EXISTS empire_hexite_sweep_empires/);
  assert.match(executed[0], /DROP TABLE IF EXISTS empire_hexite_sources/);
  assert.match(executed[0], /DROP TABLE IF EXISTS empire_hexite_snapshots/);
  assert.match(executed[0], /DROP TABLE IF EXISTS empire_hexite_sweeps/);
  assert.match(executed[0], /DELETE FROM scheduled_jobs WHERE job_key = 'recipe_catalog_refresh'/);
  assert.match(executed[0], /DELETE FROM scheduled_jobs WHERE job_key = 'global_market_insights'/);
  assert.match(executed[0], /DELETE FROM scheduled_jobs WHERE job_key = 'empire_hexite_reserves_refresh'/);
  assert.match(executed[0], /DELETE FROM app_settings WHERE key = 'global_market_overview_json'/);
  assert.match(executed[0], /key LIKE 'market_trade_backfill:%'/);
  assert.match(executed[0], /key LIKE 'collector_resume:marketTrades:%'/);
  assert.match(executed[0], /DELETE FROM domain_payload_current WHERE domain = 'layout'/);
  assert.match(executed[0], /domain IN \('regionStatus', 'tradeVolume'\)/);
  assert.match(executed[0], /domain = 'region' AND json_type\(data_json, '\$\.claims'\) = 'array'/);
  assert.doesNotMatch(executed[0], /provider = 'legacy'/);
});

test("retired tables share cleanup ownership and are absent from a fresh schema", () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  applyLegacySchemaCleanup(db);
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const table of retiredTableNames) assert.equal(tables.has(table), false, `${table} must be retired`);
  assert.equal(tables.has("app_settings"), true);
  db.close();
});

test("production contribution migration retains unknown events without rebuilding guessed aggregates", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE production_contributions (
      contribution_key TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      craft_entity_id TEXT NOT NULL,
      contributor_entity_id TEXT NOT NULL,
      contributor_name TEXT NOT NULL,
      profession TEXT,
      craft_label TEXT,
      structure_name TEXT,
      item_tier TEXT,
      contributed_progress TEXT NOT NULL DEFAULT '0',
      contributed_xp TEXT NOT NULL DEFAULT '0',
      contribution_count TEXT NOT NULL DEFAULT '0',
      first_contributed_at TEXT,
      last_contributed_at TEXT,
      first_seen TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE production_contribution_events (
      source_key TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      craft_entity_id TEXT NOT NULL,
      contributor_entity_id TEXT NOT NULL,
      contributed_progress TEXT NOT NULL,
      contributed_xp TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    CREATE INDEX idx_production_contrib_claim
      ON production_contributions (claim_id, last_contributed_at DESC);
    CREATE INDEX idx_production_contrib_profession
      ON production_contributions (claim_id, profession, contributed_progress DESC);
    CREATE INDEX idx_production_contrib_events_claim
      ON production_contribution_events (claim_id, occurred_at DESC);
    CREATE INDEX idx_production_contrib_events_craft
      ON production_contribution_events (claim_id, craft_entity_id, occurred_at DESC);
    INSERT INTO production_contributions VALUES (
      '1:2:3', '1', '2', '3', 'Ada', 'Forestry', 'Timber', 'Forester',
      '3', '24', '42.24', '1', '2026-08-01T09:00:00.000Z',
      '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:00.000Z',
      '2026-08-01T09:00:00.000Z', '{}'
    );
    INSERT INTO production_contribution_events VALUES (
      'legacy:1', '1', '19', '2', '3', '24', '42.24',
      '2026-08-01T09:00:00.000Z', '2026-08-01T09:00:01.000Z', '{}'
    );
  `);

  applyProductionContributionExactAmountMigration(db);
  applyProductionContributionExactAmountMigration(db);
  applySchemaIndexStatements(
    db,
    schemaIndexStatements.filter((statement) => statement.includes("idx_production_contrib")),
  );

  const contributionColumns = new Map(
    db.prepare("PRAGMA table_info(production_contributions)").all()
      .map((column) => [String(column.name), column]),
  );
  const eventColumns = new Map(
    db.prepare("PRAGMA table_info(production_contribution_events)").all()
      .map((column) => [String(column.name), column]),
  );
  assert.equal(contributionColumns.get("contributor_entity_id").notnull, 0);
  assert.equal(eventColumns.get("contributor_entity_id").notnull, 0);
  assert.equal(contributionColumns.get("attribution_confidence").dflt_value, "'unknown'");
  assert.equal(eventColumns.get("attribution_confidence").dflt_value, "'unknown'");
  assert.equal(contributionColumns.get("contributed_progress").type, "TEXT");
  assert.equal(contributionColumns.get("contributed_xp").type, "TEXT");
  assert.equal(contributionColumns.get("contribution_count").type, "TEXT");
  assert.deepEqual(
    db.prepare(`
      SELECT name
      FROM sqlite_schema
      WHERE type = 'index' AND name LIKE 'idx_production_contrib%'
      ORDER BY name
    `).all().map(({ name }) => name),
    [
      "idx_production_contrib_claim",
      "idx_production_contrib_events_claim",
      "idx_production_contrib_events_craft",
      "idx_production_contrib_profession",
    ],
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM production_contributions").get().count, 0);
  assert.deepEqual(
    { ...db.prepare(`
      SELECT source_key, contributor_entity_id, attribution_confidence,
        contributed_progress, contributed_xp
      FROM production_contribution_events
    `).get() },
    {
      source_key: "legacy:1",
      contributor_entity_id: "3",
      attribution_confidence: "unknown",
      contributed_progress: "24",
      contributed_xp: "42.24",
    },
  );
  db.close();
});

test("production contribution migration maps joined evidence and rebuilds only exact durable attribution", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE production_contributions (
      contribution_key TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      craft_entity_id TEXT NOT NULL,
      contributor_entity_id TEXT,
      contributor_name TEXT NOT NULL,
      attribution_confidence TEXT NOT NULL DEFAULT 'unknown'
        CHECK (attribution_confidence IN ('authoritative', 'joined', 'unknown')),
      profession TEXT,
      craft_label TEXT,
      structure_name TEXT,
      item_tier TEXT,
      contributed_progress TEXT NOT NULL DEFAULT '0',
      contributed_xp TEXT NOT NULL DEFAULT '0',
      contribution_count TEXT NOT NULL DEFAULT '0',
      first_contributed_at TEXT,
      last_contributed_at TEXT,
      first_seen TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    CREATE TABLE production_contribution_events (
      source_key TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      craft_entity_id TEXT NOT NULL,
      contributor_entity_id TEXT,
      attribution_confidence TEXT NOT NULL DEFAULT 'unknown'
        CHECK (attribution_confidence IN ('authoritative', 'joined', 'unknown')),
      contributed_progress TEXT NOT NULL,
      contributed_xp TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
  `);
  const insertEvent = db.prepare(`
    INSERT INTO production_contribution_events (
      source_key, claim_id, region_id, craft_entity_id, contributor_entity_id,
      attribution_confidence, contributed_progress, contributed_xp, occurred_at,
      received_at, raw_json
    ) VALUES (?, '1', '19', ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEvent.run(
    "action:1", "100", "10", "joined", "2", "3.5",
    "2026-08-08T10:00:00.000Z", "2026-08-08T10:00:01.000Z",
    JSON.stringify({ contributorName: "Ada", profession: "Forestry", craftLabel: "Timber", structureName: "Forester", evidenceKey: "action:99" }),
  );
  insertEvent.run(
    "owner:1", "101", "11", "unknown", "4", "5",
    "2026-08-08T11:00:00.000Z", "2026-08-08T11:00:01.000Z",
    JSON.stringify({ contributorName: "Grace", attributionConfidence: "owner_fallback", craftEntityId: "101", craftOwnerEntityId: "11", evidenceKey: "owner:11" }),
  );
  insertEvent.run(
    "unknown:1", "102", null, "unknown", "8", "9",
    "2026-08-08T12:00:00.000Z", "2026-08-08T12:00:01.000Z", "{}",
  );
  insertEvent.run(
    "unknown:malformed", "103", null, "unknown", "1", "1",
    "2026-08-08T12:01:00.000Z", "2026-08-08T12:01:01.000Z", "{malformed",
  );
  db.prepare(`
    INSERT INTO production_contributions (
      contribution_key, claim_id, craft_entity_id, contributor_entity_id,
      contributor_name, attribution_confidence, contributed_progress,
      contributed_xp, contribution_count, first_seen, updated_at, raw_json
    ) VALUES ('stale', '1', '999', NULL, 'Unknown contributor', 'unknown',
      '99', '99', '1', '2026-08-08T09:00:00.000Z',
      '2026-08-08T09:00:00.000Z', '{}')
  `).run();

  applyProductionContributionExactAmountMigration(db);

  assert.deepEqual(
    db.prepare(`
      SELECT source_key, attribution_confidence
      FROM production_contribution_events
      ORDER BY source_key
    `).all().map((row) => ({ ...row })),
    [
      { source_key: "action:1", attribution_confidence: "matched_action" },
      { source_key: "owner:1", attribution_confidence: "owner_fallback" },
      { source_key: "unknown:1", attribution_confidence: "unknown" },
      { source_key: "unknown:malformed", attribution_confidence: "unknown" },
    ],
  );
  assert.deepEqual(
    db.prepare(`
      SELECT craft_entity_id, contributor_entity_id, contributor_name,
        attribution_confidence, contributed_progress, contributed_xp,
        contribution_count
      FROM production_contributions
      ORDER BY craft_entity_id
    `).all().map((row) => ({ ...row })),
    [
      { craft_entity_id: "100", contributor_entity_id: "10", contributor_name: "Ada", attribution_confidence: "matched_action", contributed_progress: "2", contributed_xp: "3.5", contribution_count: "1" },
      { craft_entity_id: "101", contributor_entity_id: "11", contributor_name: "Grace", attribution_confidence: "owner_fallback", contributed_progress: "4", contributed_xp: "5", contribution_count: "1" },
    ],
  );
  assert.throws(() => db.prepare(`
    INSERT INTO production_contribution_events (
      source_key, claim_id, region_id, craft_entity_id, contributor_entity_id,
      attribution_confidence, contributed_progress, contributed_xp, occurred_at,
      received_at, raw_json
    ) VALUES ('joined-rejected', '1', '19', '1', '2', 'joined', '1', '1', 'now', 'now', '{}')
  `).run(), /check constraint/i);
  db.close();
});

test("retired table authorizer rejects post-cleanup access while permitting retained tables", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE scheduled_jobs (job_key TEXT PRIMARY KEY);
    CREATE TABLE domain_payload_current (domain TEXT, data_json TEXT);
  `);
  applyLegacySchemaCleanup(db);
  db.exec("CREATE TABLE market_listings (id INTEGER);");
  installRetiredTableAuthorizer(db, { enabled: true });

  for (const statement of [
    "SELECT * FROM market_listings",
    "INSERT INTO market_listings (id) VALUES (1)",
    "UPDATE market_listings SET id = 2",
    "DELETE FROM market_listings",
    "PRAGMA table_info(market_listings)",
    "PRAGMA table_info(MARKET_LISTINGS)",
    "DROP TABLE market_listings",
  ]) {
    assert.throws(
      () => db.prepare(statement).run(),
      /Retired SQLite table access: market_listings/,
      statement,
    );
  }
  assert.doesNotThrow(() => db.prepare("INSERT INTO app_settings (key, value) VALUES ('kept', 'yes')").run());
  db.close();
});
