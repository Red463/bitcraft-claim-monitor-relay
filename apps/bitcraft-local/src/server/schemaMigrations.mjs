export const additiveColumnMigrations = [
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
];

export const schemaIndexStatements = [
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_source ON activity_events (claim_id, event_type, source_key) WHERE source_key IS NOT NULL;",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_market_events_source ON market_events (claim_id, source_key) WHERE source_key IS NOT NULL;",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_discord_id ON admin_users (discord_id) WHERE discord_id IS NOT NULL AND discord_id <> '';",
  "CREATE INDEX IF NOT EXISTS idx_game_catalog_entities_item_list ON game_catalog_entities (item_list_id, catalog_key);",
  "CREATE INDEX IF NOT EXISTS idx_market_trades_claim_region_item_time ON market_trades (claim_id, region_id, item_id, item_type, occurred_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_production_contrib_claim ON production_contributions (claim_id, last_contributed_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_production_contrib_profession ON production_contributions (claim_id, profession, contributed_progress DESC);",
  "CREATE INDEX IF NOT EXISTS idx_production_contrib_events_claim ON production_contribution_events (claim_id, occurred_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_production_contrib_events_craft ON production_contribution_events (claim_id, craft_entity_id, occurred_at DESC);",
];

export const retiredTableNames = [
  "current_claim_state",
  "recipe_catalog_entries",
  "game_catalog_refresh_targets",
  "game_catalog_refresh_runs",
  "market_listings",
  "market_buy_orders_current",
  "market_regional_sale_averages_current",
  "global_market_price_snapshots",
  "empire_hexite_targets",
  "empire_hexite_snapshots",
  "empire_hexite_sweep_empires",
  "empire_hexite_sources",
  "empire_hexite_sweeps",
];

export function applySettlementStateMigration(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settlement_state_current (
      claim_id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      supplies TEXT,
      treasury TEXT,
      members_count INTEGER,
      buildings_count INTEGER,
      market_count INTEGER,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    const checkpointColumns = db.prepare("PRAGMA table_info(settlement_state_current)").all();
    const checkpointTypes = new Map(checkpointColumns.map((column) => [
      String(column.name),
      String(column.type ?? "").toUpperCase(),
    ]));
    if (checkpointTypes.get("supplies") !== "TEXT" || checkpointTypes.get("treasury") !== "TEXT") {
      db.exec(`
        ALTER TABLE settlement_state_current RENAME TO settlement_state_current_legacy_amounts;
        CREATE TABLE settlement_state_current (
          claim_id TEXT PRIMARY KEY,
          captured_at TEXT NOT NULL,
          supplies TEXT,
          treasury TEXT,
          members_count INTEGER,
          buildings_count INTEGER,
          market_count INTEGER,
          updated_at TEXT NOT NULL
        );
        INSERT INTO settlement_state_current (
          claim_id, captured_at, supplies, treasury, members_count,
          buildings_count, market_count, updated_at
        )
        SELECT
          claim_id,
          captured_at,
          CASE
            WHEN supplies IS NULL THEN NULL
            WHEN supplies BETWEEN -9007199254740991 AND 9007199254740991
              AND supplies = CAST(supplies AS INTEGER)
              THEN CAST(CAST(supplies AS INTEGER) AS TEXT)
            ELSE NULL
          END,
          CASE
            WHEN treasury IS NULL THEN NULL
            WHEN treasury BETWEEN -9007199254740991 AND 9007199254740991
              AND treasury = CAST(treasury AS INTEGER)
              THEN CAST(CAST(treasury AS INTEGER) AS TEXT)
            ELSE NULL
          END,
          members_count,
          buildings_count,
          market_count,
          updated_at
        FROM settlement_state_current_legacy_amounts;
        DROP TABLE settlement_state_current_legacy_amounts;
      `);
    }
    const hasLegacySnapshots = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'snapshots'").get();
    if (hasLegacySnapshots) {
      db.exec(`
        INSERT INTO settlement_state_current (
          claim_id, captured_at, supplies, treasury, members_count,
          buildings_count, market_count, updated_at
        )
        SELECT
          s.claim_id,
          s.captured_at,
          CASE
            WHEN s.supplies IS NULL THEN NULL
            WHEN s.supplies BETWEEN -9007199254740991 AND 9007199254740991
              AND s.supplies = CAST(s.supplies AS INTEGER)
              THEN CAST(CAST(s.supplies AS INTEGER) AS TEXT)
            ELSE NULL
          END,
          CASE
            WHEN s.treasury IS NULL THEN NULL
            WHEN s.treasury BETWEEN -9007199254740991 AND 9007199254740991
              AND s.treasury = CAST(s.treasury AS INTEGER)
              THEN CAST(CAST(s.treasury AS INTEGER) AS TEXT)
            ELSE NULL
          END,
          s.members_count,
          s.buildings_count, s.market_count, s.captured_at
        FROM snapshots s
        WHERE NOT EXISTS (
          SELECT 1
          FROM snapshots newer
          WHERE newer.claim_id = s.claim_id
            AND (
              newer.captured_at > s.captured_at
              OR (newer.captured_at = s.captured_at AND newer.id > s.id)
            )
        )
        ON CONFLICT(claim_id) DO UPDATE SET
          captured_at = excluded.captured_at,
          supplies = excluded.supplies,
          treasury = excluded.treasury,
          members_count = excluded.members_count,
          buildings_count = excluded.buildings_count,
          market_count = excluded.market_count,
          updated_at = excluded.updated_at;
        DROP TABLE snapshots;
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function applyAdditiveColumnMigrations(db, migrations = additiveColumnMigrations) {
  for (const migration of migrations) {
    const exists = db.prepare(`PRAGMA table_info(${migration.table})`).all().some((row) => row.name === migration.column);
    if (!exists) db.exec(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`);
  }
}

export function applyMarketHistoryExactAmountMigration(db) {
  const needsExactAmounts = (table, columns) => {
    const types = new Map(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => [
      String(column.name),
      String(column.type ?? "").toUpperCase(),
    ]));
    return columns.some((column) => types.get(column) !== "TEXT");
  };
  const migrateEvents = needsExactAmounts(
    "market_events",
    ["quantity", "price", "total_value"],
  );
  const migrateTrades = needsExactAmounts(
    "market_trades",
    ["quantity", "unit_price", "total_price"],
  );
  if (!migrateEvents && !migrateTrades) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (migrateEvents) {
      db.exec(`
        ALTER TABLE market_events RENAME TO market_events_legacy_amounts;
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
          quantity TEXT,
          price TEXT,
          total_value TEXT,
          tier TEXT,
          rarity TEXT,
          occurred_at TEXT NOT NULL,
          trade_id TEXT,
          source_key TEXT,
          raw_json TEXT NOT NULL
        );
        INSERT INTO market_events (
          id, claim_id, event_type, listing_key, item_name, side, owner,
          owner_entity_id, item_id, item_type, quantity, price, total_value,
          tier, rarity, occurred_at, trade_id, source_key, raw_json
        )
        SELECT
          id, claim_id, event_type, listing_key, item_name, side, owner,
          owner_entity_id, item_id, item_type,
          CASE WHEN quantity IS NULL THEN NULL ELSE CAST(quantity AS TEXT) END,
          CASE WHEN price IS NULL THEN NULL ELSE CAST(price AS TEXT) END,
          CASE WHEN total_value IS NULL THEN NULL ELSE CAST(total_value AS TEXT) END,
          tier, rarity, occurred_at, trade_id, source_key, raw_json
        FROM market_events_legacy_amounts;
        DROP TABLE market_events_legacy_amounts;
      `);
    }
    if (migrateTrades) {
      const hasTradeRegion = db.prepare("PRAGMA table_info(market_trades)").all()
        .some((column) => String(column.name) === "region_id");
      db.exec(`
        ALTER TABLE market_trades RENAME TO market_trades_legacy_amounts;
        CREATE TABLE market_trades (
          trade_id TEXT PRIMARY KEY,
          claim_id TEXT NOT NULL,
          region_id TEXT,
          order_entity_id TEXT,
          seller_entity_id TEXT,
          seller_username TEXT,
          purchaser_entity_id TEXT,
          purchaser_username TEXT,
          item_id TEXT,
          item_type TEXT,
          item_name TEXT NOT NULL,
          quantity TEXT NOT NULL,
          unit_price TEXT NOT NULL,
          total_price TEXT NOT NULL,
          tier TEXT,
          rarity TEXT,
          occurred_at TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          raw_json TEXT NOT NULL
        );
        INSERT INTO market_trades (
          trade_id, claim_id, region_id, order_entity_id, seller_entity_id,
          seller_username, purchaser_entity_id, purchaser_username, item_id,
          item_type, item_name, quantity, unit_price, total_price, tier,
          rarity, occurred_at, imported_at, raw_json
        )
        SELECT
          trade_id, claim_id, ${hasTradeRegion ? "region_id" : "NULL"}, order_entity_id, seller_entity_id,
          seller_username, purchaser_entity_id, purchaser_username, item_id,
          item_type, item_name, CAST(quantity AS TEXT), CAST(unit_price AS TEXT),
          CAST(total_price AS TEXT), tier, rarity, occurred_at, imported_at,
          raw_json
        FROM market_trades_legacy_amounts;
        DROP TABLE market_trades_legacy_amounts;
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function applyMarketTradeRegionBackfill(db) {
  const rows = db.prepare(`
    SELECT trade_id, raw_json
    FROM market_trades
    WHERE region_id IS NULL OR region_id = ''
  `).all();
  if (!rows.length) return;
  const update = db.prepare(`
    UPDATE market_trades
    SET region_id = ?
    WHERE trade_id = ? AND (region_id IS NULL OR region_id = '')
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const tradeId = String(row.trade_id ?? "");
      const relayMatch = tradeId.match(/^relay_closed_listing:(\d+):/);
      let regionId = relayMatch?.[1] ?? "";
      if (!regionId) {
        try {
          const raw = JSON.parse(String(row.raw_json ?? "{}"));
          regionId = String(raw?.listing?.regionId ?? "").trim();
        } catch {
          regionId = "";
        }
      }
      if (/^\d+$/.test(regionId)) update.run(regionId, tradeId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function applyProductionContributionExactAmountMigration(db) {
  const contributionColumns = db.prepare("PRAGMA table_info(production_contributions)").all();
  const eventColumns = db.prepare("PRAGMA table_info(production_contribution_events)").all();
  const columnMap = (columns) => new Map(columns.map((column) => [
    String(column.name),
    column,
  ]));
  const contributions = columnMap(contributionColumns);
  const events = columnMap(eventColumns);
  const migrateContributions = contributionColumns.length > 0 && (
    String(contributions.get("contributed_progress")?.type ?? "").toUpperCase() !== "TEXT"
    || String(contributions.get("contributed_xp")?.type ?? "").toUpperCase() !== "TEXT"
    || String(contributions.get("contribution_count")?.type ?? "").toUpperCase() !== "TEXT"
    || Number(contributions.get("contributor_entity_id")?.notnull ?? 0) !== 0
    || !contributions.has("attribution_confidence")
  );
  const migrateEvents = eventColumns.length > 0 && (
    String(events.get("contributed_progress")?.type ?? "").toUpperCase() !== "TEXT"
    || String(events.get("contributed_xp")?.type ?? "").toUpperCase() !== "TEXT"
    || Number(events.get("contributor_entity_id")?.notnull ?? 0) !== 0
    || !events.has("attribution_confidence")
  );
  if (!migrateContributions && !migrateEvents) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (migrateContributions) {
      const confidence = contributions.has("attribution_confidence")
        ? `CASE
            WHEN attribution_confidence IN ('authoritative', 'joined', 'unknown')
              THEN attribution_confidence
            ELSE 'unknown'
          END`
        : "'unknown'";
      db.exec(`
        ALTER TABLE production_contributions
          RENAME TO production_contributions_legacy_amounts;
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
        INSERT INTO production_contributions (
          contribution_key, claim_id, craft_entity_id, contributor_entity_id,
          contributor_name, attribution_confidence, profession, craft_label,
          structure_name, item_tier, contributed_progress, contributed_xp,
          contribution_count, first_contributed_at, last_contributed_at,
          first_seen, updated_at, raw_json
        )
        SELECT
          contribution_key, claim_id, craft_entity_id, contributor_entity_id,
          contributor_name, ${confidence}, profession, craft_label,
          structure_name, item_tier, CAST(contributed_progress AS TEXT),
          CAST(contributed_xp AS TEXT), CAST(contribution_count AS TEXT),
          first_contributed_at, last_contributed_at, first_seen, updated_at,
          raw_json
        FROM production_contributions_legacy_amounts;
        DROP TABLE production_contributions_legacy_amounts;
      `);
    }
    if (migrateEvents) {
      const confidence = events.has("attribution_confidence")
        ? `CASE
            WHEN attribution_confidence IN ('authoritative', 'joined', 'unknown')
              THEN attribution_confidence
            ELSE 'unknown'
          END`
        : "'unknown'";
      db.exec(`
        ALTER TABLE production_contribution_events
          RENAME TO production_contribution_events_legacy_attribution;
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
        INSERT INTO production_contribution_events (
          source_key, claim_id, region_id, craft_entity_id,
          contributor_entity_id, attribution_confidence, contributed_progress,
          contributed_xp, occurred_at, received_at, raw_json
        )
        SELECT
          source_key, claim_id, region_id, craft_entity_id,
          contributor_entity_id, ${confidence},
          CAST(contributed_progress AS TEXT), CAST(contributed_xp AS TEXT),
          occurred_at, received_at, raw_json
        FROM production_contribution_events_legacy_attribution;
        DROP TABLE production_contribution_events_legacy_attribution;
      `);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function applySchemaIndexStatements(db, statements = schemaIndexStatements) {
  for (const statement of statements) db.exec(statement);
}
export function applyLegacySchemaCleanup(db) {
  db.exec(`
    ${retiredTableNames.map((table) => `DROP TABLE IF EXISTS ${table};`).join("\n")}
    DELETE FROM scheduled_jobs WHERE job_key = 'recipe_catalog_refresh';
    DELETE FROM scheduled_jobs WHERE job_key = 'global_market_insights';
    DELETE FROM scheduled_jobs WHERE job_key = 'empire_hexite_reserves_refresh';
    DELETE FROM app_settings WHERE key = 'global_market_overview_json';
    DELETE FROM app_settings
      WHERE key LIKE 'market_trade_backfill:%'
         OR key LIKE 'collector_resume:marketTrades:%';
    DELETE FROM domain_payload_current WHERE domain = 'layout';
    DELETE FROM domain_payload_current
      WHERE domain IN ('regionStatus', 'tradeVolume')
         OR (domain = 'region' AND json_type(data_json, '$.claims') = 'array');
  `);
}
