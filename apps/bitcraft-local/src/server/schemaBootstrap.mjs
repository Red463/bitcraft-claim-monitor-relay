import { operationalHistoryRetentionSchemaSql } from "./operationalHistoryRetention.mjs";

export const schemaBootstrapSql = `
  PRAGMA journal_mode = WAL;
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
  CREATE TABLE IF NOT EXISTS market_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    listing_key TEXT NOT NULL,
    item_name TEXT NOT NULL,
    side TEXT,
    owner TEXT,
    quantity TEXT,
    price TEXT,
    total_value TEXT,
    tier TEXT,
    rarity TEXT,
    occurred_at TEXT NOT NULL,
    source_key TEXT,
    raw_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS market_trades (
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
  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES admin_users(id)
  );
  CREATE TABLE IF NOT EXISTS user_accounts (
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
    last_login_at TEXT,
    inactivity_warning_sent_at TEXT
  );
  CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reauthenticated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES user_accounts(id)
  );
  CREATE TABLE IF NOT EXISTS user_legal_acceptances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    legal_version TEXT NOT NULL,
    terms_digest TEXT NOT NULL,
    privacy_digest TEXT NOT NULL,
    age_confirmed INTEGER NOT NULL CHECK (age_confirmed IN (0, 1)),
    accepted_at TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('oauth', 'existing-session')),
    FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE,
    UNIQUE (user_id, legal_version, terms_digest, privacy_digest)
  );
  CREATE INDEX IF NOT EXISTS idx_user_legal_acceptances_user_time
    ON user_legal_acceptances (user_id, accepted_at DESC);
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS domain_payload_current (
    claim_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    data_json TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    last_attempt_at TEXT NOT NULL,
    last_success_at TEXT NOT NULL,
    last_error TEXT,
    updated_at TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'legacy',
    source_key TEXT,
    region_id TEXT,
    database_name TEXT,
    schema_fingerprint TEXT,
    source_observed_at TEXT,
    received_at TEXT,
    freshness TEXT NOT NULL DEFAULT 'unavailable',
    confidence TEXT NOT NULL DEFAULT 'unknown',
    generation INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (claim_id, domain)
  );
  CREATE TABLE IF NOT EXISTS provider_source_health (
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    ready INTEGER NOT NULL DEFAULT 0,
    database_name TEXT,
    schema_fingerprint TEXT,
    last_observed_at TEXT,
    last_error TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider, source_key)
  );
  CREATE TABLE IF NOT EXISTS provider_subscription_health (
    provider TEXT NOT NULL,
    source_key TEXT NOT NULL,
    domain TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0,
    connected INTEGER NOT NULL DEFAULT 0,
    runtime_state TEXT NOT NULL DEFAULT 'disconnected'
      CHECK (runtime_state IN ('connected', 'disconnected', 'blocked_by_schema')),
    apply_duration_ms INTEGER,
    lag_ms INTEGER,
    reconnects INTEGER NOT NULL DEFAULT 0,
    malformed_rows INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider, source_key, domain)
  );
  CREATE TABLE IF NOT EXISTS provider_transition_outbox (
    transition_key TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    locked_by TEXT,
    lease_token TEXT,
    locked_at TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_provider_transition_pending
    ON provider_transition_outbox (claim_id, domain, created_at, transition_key);
  CREATE TABLE IF NOT EXISTS app_secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scheduled_jobs (
    job_key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    description TEXT,
    schedule TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    next_run_at TEXT,
    running INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS empire_membership_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    empire_id TEXT NOT NULL,
    empire_name TEXT NOT NULL,
    tracking_started_at TEXT NOT NULL,
    last_success_at TEXT,
    tracking_ended_at TEXT,
    initial_roster_complete INTEGER NOT NULL DEFAULT 0,
    last_cleanup_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS empire_membership_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_session_id INTEGER NOT NULL,
    empire_id TEXT NOT NULL,
    player_entity_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    observed_joined_at TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    first_missing_at TEXT,
    observed_left_at TEXT,
    departure_confirmed_at TEXT,
    period_ended_at TEXT,
    end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('departure', 'tracking_ended')),
    initial_roster INTEGER NOT NULL DEFAULT 0,
    rejoin INTEGER NOT NULL DEFAULT 0,
    missing_checks INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (tracking_session_id) REFERENCES empire_membership_tracking(id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_empire_membership_active_tracking
    ON empire_membership_tracking ((1))
    WHERE tracking_ended_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_empire_membership_open_period
    ON empire_membership_periods (tracking_session_id, player_entity_id)
    WHERE period_ended_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_empire_membership_current
    ON empire_membership_periods (tracking_session_id, period_ended_at, observed_joined_at DESC, player_name);
  CREATE INDEX IF NOT EXISTS idx_empire_membership_departures
    ON empire_membership_periods (empire_id, end_reason, observed_left_at DESC, player_entity_id);
  CREATE INDEX IF NOT EXISTS idx_empire_membership_retention
    ON empire_membership_periods (period_ended_at)
    WHERE period_ended_at IS NOT NULL;
  CREATE TABLE IF NOT EXISTS server_metric_buckets (
    bucket_at TEXT NOT NULL,
    process_role TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (bucket_at, process_role)
  );
  CREATE INDEX IF NOT EXISTS server_metric_buckets_time_idx ON server_metric_buckets(bucket_at DESC);
  CREATE TABLE IF NOT EXISTS server_health_incidents (
    incident_key TEXT PRIMARY KEY,
    severity TEXT NOT NULL,
    state TEXT NOT NULL,
    consecutive_bad INTEGER NOT NULL DEFAULT 0,
    consecutive_good INTEGER NOT NULL DEFAULT 0,
    first_observed_at TEXT NOT NULL,
    last_observed_at TEXT NOT NULL,
    opened_at TEXT,
    recovered_at TEXT,
    opened_notified_at TEXT,
    recovered_notified_at TEXT,
    last_delivery_error TEXT
  );
  CREATE TABLE IF NOT EXISTS game_catalog_entities (
    catalog_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    item_type INTEGER NOT NULL DEFAULT 0,
    name TEXT,
    tag TEXT,
    tier INTEGER,
    rarity TEXT,
    icon_asset_name TEXT,
    item_list_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_catalog_source_state (
    source_key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    database_name TEXT NOT NULL,
    schema_fingerprint TEXT NOT NULL,
    generation INTEGER NOT NULL,
    received_at TEXT NOT NULL,
    row_count INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_catalog_descriptions (
    description_kind TEXT NOT NULL,
    description_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (description_kind, description_id)
  );
  CREATE TABLE IF NOT EXISTS game_catalog_recipes (
    recipe_key TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL,
    source_id TEXT NOT NULL,
    action_count REAL NOT NULL DEFAULT 0,
    activity_kind TEXT NOT NULL DEFAULT 'craft' CHECK (activity_kind IN ('craft', 'gathering')),
    gathering_mode TEXT NOT NULL DEFAULT 'ordinary' CHECK (gathering_mode IN ('ordinary', 'prospecting')),
    name TEXT,
    station_name TEXT,
    skill_name TEXT,
    is_passive INTEGER NOT NULL DEFAULT 0,
    is_transport_route INTEGER NOT NULL DEFAULT 0,
    resource_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_catalog_recipe_inputs (
    recipe_key TEXT NOT NULL,
    input_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    PRIMARY KEY (recipe_key, input_key),
    FOREIGN KEY (recipe_key) REFERENCES game_catalog_recipes(recipe_key) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_catalog_recipe_outputs (
    recipe_key TEXT NOT NULL,
    output_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    occurrence_rate REAL NOT NULL DEFAULT 1,
    yield_basis TEXT NOT NULL DEFAULT 'per_craft' CHECK (yield_basis IN ('per_craft', 'per_progress')),
    guaranteed_quantity REAL,
    is_primary_output INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (recipe_key, output_key),
    FOREIGN KEY (recipe_key) REFERENCES game_catalog_recipes(recipe_key) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_catalog_recipe_sources (
    catalog_key TEXT NOT NULL,
    recipe_key TEXT NOT NULL,
    PRIMARY KEY (catalog_key, recipe_key),
    FOREIGN KEY (catalog_key) REFERENCES game_catalog_entities(catalog_key) ON DELETE CASCADE,
    FOREIGN KEY (recipe_key) REFERENCES game_catalog_recipes(recipe_key) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_catalog_item_list_outputs (
    producer_key TEXT NOT NULL,
    output_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    chance REAL,
    guaranteed_quantity REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (producer_key, output_key)
  );
  CREATE TABLE IF NOT EXISTS game_catalog_recipe_output_components (
    recipe_key TEXT NOT NULL,
    component_index INTEGER NOT NULL,
    output_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    occurrence_rate REAL NOT NULL DEFAULT 1,
    yield_basis TEXT NOT NULL DEFAULT 'per_craft' CHECK (yield_basis IN ('per_craft', 'per_progress')),
    is_primary_output INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (recipe_key, component_index),
    FOREIGN KEY (recipe_key) REFERENCES game_catalog_recipes(recipe_key) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_catalog_item_lists (
    item_list_id TEXT PRIMARY KEY,
    name TEXT,
    total_weight REAL NOT NULL,
    source_url TEXT NOT NULL,
    source_revision TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_catalog_item_list_possibilities (
    item_list_id TEXT NOT NULL,
    possibility_index INTEGER NOT NULL,
    raw_weight REAL NOT NULL,
    normalized_probability REAL NOT NULL,
    PRIMARY KEY (item_list_id, possibility_index),
    FOREIGN KEY (item_list_id) REFERENCES game_catalog_item_lists(item_list_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_catalog_item_list_possibility_outputs (
    item_list_id TEXT NOT NULL,
    possibility_index INTEGER NOT NULL,
    output_index INTEGER NOT NULL,
    output_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    nested_item_list_id TEXT,
    quantity REAL NOT NULL,
    PRIMARY KEY (item_list_id, possibility_index, output_index),
    FOREIGN KEY (item_list_id, possibility_index)
      REFERENCES game_catalog_item_list_possibilities(item_list_id, possibility_index) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_catalog_resources (
    resource_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tier INTEGER,
    tag TEXT,
    max_health REAL NOT NULL,
    source_url TEXT NOT NULL,
    source_revision TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_catalog_resource_completion_outputs (
    resource_id TEXT NOT NULL,
    output_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    occurrence_rate REAL NOT NULL DEFAULT 1,
    PRIMARY KEY (resource_id, output_key),
    FOREIGN KEY (resource_id) REFERENCES game_catalog_resources(resource_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS game_catalog_probability_snapshot (
    snapshot_id INTEGER PRIMARY KEY CHECK (snapshot_id = 1),
    source_url TEXT NOT NULL,
    source_revision TEXT,
    item_list_count INTEGER NOT NULL,
    resource_count INTEGER NOT NULL,
    warning_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_catalog_probability_sources (
    source_kind TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    source_revision TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS game_catalog_effort_weights (
    catalog_key TEXT PRIMARY KEY,
    model_version INTEGER NOT NULL,
    effort_weight REAL NOT NULL CHECK (effort_weight > 0),
    method TEXT NOT NULL CHECK (method IN ('crafting', 'gathering')),
    source_key TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS craft_plan_settings (
    plan_key TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS craft_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    scope TEXT NOT NULL CHECK (scope IN ('shared', 'personal')),
    owner_user_id INTEGER,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES user_accounts(id) ON DELETE CASCADE,
    CHECK ((scope = 'shared' AND owner_user_id IS NULL) OR (scope = 'personal' AND owner_user_id IS NOT NULL)),
    CHECK (is_primary = 0 OR scope = 'shared')
  );
  CREATE TABLE IF NOT EXISTS craft_plan_progress_audit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    plan_id TEXT NOT NULL DEFAULT 'legacy-primary',
    captured_at TEXT NOT NULL,
    baseline_revision TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    full_snapshot INTEGER NOT NULL DEFAULT 1,
    payload_gzip BLOB NOT NULL,
    app_version TEXT NOT NULL,
    build_id TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS craft_plan_progress_audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_id TEXT NOT NULL,
    plan_id TEXT NOT NULL DEFAULT 'legacy-primary',
    captured_at TEXT NOT NULL,
    baseline_revision TEXT,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS craft_plan_progress_audit_state (
    claim_id TEXT NOT NULL,
    plan_id TEXT NOT NULL DEFAULT 'legacy-primary',
    last_fingerprint TEXT,
    last_payload_gzip BLOB,
    last_snapshot_id INTEGER,
    last_full_snapshot_at TEXT,
    last_success_at TEXT,
    last_failure_fingerprint TEXT,
    last_error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (claim_id, plan_id)
  );
  CREATE TABLE IF NOT EXISTS market_deal_watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    region_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT '0',
    item_name TEXT NOT NULL,
    tier INTEGER,
    rarity TEXT,
    icon_asset_name TEXT,
    threshold_percent REAL NOT NULL DEFAULT 30,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    last_alert_at TEXT,
    last_baseline_window_days INTEGER,
    last_baseline_average TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, claim_id, region_id, item_id, item_type)
  );
  CREATE TABLE IF NOT EXISTS market_deal_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    discord_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    region_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    item_type TEXT NOT NULL DEFAULT '0',
    item_name TEXT NOT NULL,
    tier INTEGER,
    rarity TEXT,
    icon_asset_name TEXT,
    listing_key TEXT NOT NULL,
    market_claim_id TEXT,
    market_claim_name TEXT,
    seller_name TEXT,
    quantity TEXT,
    unit_price TEXT,
    total_value TEXT,
    baseline_window_days INTEGER NOT NULL,
    baseline_average TEXT NOT NULL,
    sales_count INTEGER NOT NULL DEFAULT 0,
    discount_percent REAL NOT NULL,
    dm_status TEXT NOT NULL DEFAULT 'pending',
    dm_error TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT,
    raw_json TEXT NOT NULL,
    UNIQUE (watch_id, listing_key)
  );
  CREATE TABLE IF NOT EXISTS production_jobs (
    job_key TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    label TEXT NOT NULL,
    building_name TEXT,
    crafter_name TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    status TEXT NOT NULL,
    raw_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS production_contributions (
    contribution_key TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    craft_entity_id TEXT NOT NULL,
    contributor_entity_id TEXT,
    contributor_name TEXT NOT NULL,
    attribution_confidence TEXT NOT NULL DEFAULT 'unknown'
      CHECK (attribution_confidence IN ('authoritative', 'matched_action', 'owner_fallback', 'unknown')),
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
  CREATE TABLE IF NOT EXISTS production_contribution_events (
    source_key TEXT PRIMARY KEY,
    claim_id TEXT NOT NULL,
    region_id TEXT NOT NULL,
    craft_entity_id TEXT NOT NULL,
    contributor_entity_id TEXT,
    attribution_confidence TEXT NOT NULL DEFAULT 'unknown'
      CHECK (attribution_confidence IN ('authoritative', 'matched_action', 'owner_fallback', 'unknown')),
    contributed_progress TEXT NOT NULL,
    contributed_xp TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    raw_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    details_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    successful INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    remote_address TEXT
  );
  CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_key TEXT NOT NULL,
    session_key TEXT NOT NULL,
    event_name TEXT NOT NULL,
    page TEXT NOT NULL,
    properties_json TEXT NOT NULL,
    duration_seconds INTEGER,
    occurred_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visitor_security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL,
    method TEXT NOT NULL,
    route_group TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    status_class TEXT NOT NULL,
    ip_address TEXT,
    ip_anonymized TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    visitor_key TEXT NOT NULL,
    user_agent_hash TEXT,
    country TEXT,
    city TEXT
  );
  CREATE TABLE IF NOT EXISTS geoip_ranges (
    ip_start INTEGER NOT NULL,
    ip_end INTEGER NOT NULL,
    country TEXT NOT NULL,
    city TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (ip_start, ip_end)
  );
  CREATE TABLE IF NOT EXISTS visitor_geoip_cache (
    ip_hash TEXT PRIMARY KEY,
    ip_anonymized TEXT NOT NULL,
    provider TEXT NOT NULL,
    country TEXT NOT NULL,
    city TEXT,
    looked_up_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS discord_delivery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    summary TEXT,
    channel_id TEXT,
    channel_key TEXT,
    reason TEXT,
    error TEXT,
    metadata_json TEXT NOT NULL,
    response_json TEXT,
    occurred_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discord_notification_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL,
    locked_at TEXT,
    locked_by TEXT,
    lease_token TEXT,
    lease_expires_at TEXT,
    sent_at TEXT,
    skipped_at TEXT,
    failed_at TEXT,
    last_error TEXT,
    response_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discord_craft_plan_report_occurrences (
    rule_id TEXT NOT NULL,
    occurrence_key TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'claimed',
    discord_message_id TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (rule_id, occurrence_key)
  );
  CREATE TABLE IF NOT EXISTS discord_youtube_channels (
    channel_id TEXT PRIMARY KEY,
    input TEXT NOT NULL,
    title TEXT,
    url TEXT,
    discord_channel_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_checked_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    last_video_id TEXT,
    last_video_title TEXT,
    last_video_published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discord_youtube_videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    thumbnail_url TEXT,
    published_at TEXT,
    seen_at TEXT NOT NULL,
    notified_at TEXT,
    FOREIGN KEY (channel_id) REFERENCES discord_youtube_channels(channel_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS discord_craft_watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    profession_key TEXT NOT NULL,
    profession_name TEXT NOT NULL,
    mode TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (guild_id, user_id, profession_key)
  );
  CREATE TABLE IF NOT EXISTS discord_mod_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    case_type TEXT NOT NULL,
    user_id TEXT,
    moderator TEXT NOT NULL,
    reason TEXT,
    details_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discord_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator TEXT NOT NULL,
    reason TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discord_mod_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discord_custom_commands (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    response TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS discord_component_votes (
    message_id TEXT NOT NULL,
    component_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, kind)
  );
  CREATE TABLE IF NOT EXISTS discord_component_messages (
    message_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (message_id, kind)
  );
  CREATE TABLE IF NOT EXISTS discord_temp_bans (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    unban_at TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_market_events_claim_time ON market_events (claim_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_market_trades_claim_time ON market_trades (claim_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_market_trades_claim_item_time
    ON market_trades (claim_id, item_id, item_type, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_market_trades_claim_region_item_time
    ON market_trades (claim_id, region_id, item_id, item_type, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_craft_plan_settings_updated ON craft_plan_settings (updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_craft_plans_scope_owner ON craft_plans (scope, owner_user_id, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_craft_plans_primary ON craft_plans (is_primary) WHERE is_primary = 1;
  CREATE INDEX IF NOT EXISTS idx_craft_plan_progress_snapshots_claim_time
    ON craft_plan_progress_audit_snapshots (claim_id, captured_at DESC);
  CREATE INDEX IF NOT EXISTS idx_craft_plan_progress_events_claim_time
    ON craft_plan_progress_audit_events (claim_id, captured_at DESC);
  CREATE INDEX IF NOT EXISTS idx_market_deal_watches_user ON market_deal_watches (user_id, enabled, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_market_deal_watches_scan ON market_deal_watches (claim_id, region_id, enabled, item_id, item_type);
  CREATE INDEX IF NOT EXISTS idx_market_deal_alerts_user ON market_deal_alerts (user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_market_deal_alerts_watch ON market_deal_alerts (watch_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_claim_time ON activity_events (claim_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_analytics_time ON analytics_events (occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_analytics_page_time ON analytics_events (page, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_visitor_security_time ON visitor_security_events (occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_visitor_security_location ON visitor_security_events (country, city, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_geoip_ranges_lookup ON geoip_ranges (ip_start, ip_end);
  CREATE INDEX IF NOT EXISTS idx_visitor_geoip_cache_expires ON visitor_geoip_cache (expires_at);
  CREATE INDEX IF NOT EXISTS idx_production_claim_status ON production_jobs (claim_id, status, last_seen DESC);
  CREATE INDEX IF NOT EXISTS idx_production_contrib_claim ON production_contributions (claim_id, last_contributed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_production_contrib_profession ON production_contributions (claim_id, profession, contributed_progress DESC);
  CREATE INDEX IF NOT EXISTS idx_production_contrib_events_claim ON production_contribution_events (claim_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_production_contrib_events_craft ON production_contribution_events (claim_id, craft_entity_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_discord_delivery_time ON discord_delivery_log (occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_discord_notification_outbox_status ON discord_notification_outbox (status, next_attempt_at, id);
  CREATE INDEX IF NOT EXISTS idx_discord_craft_plan_report_occurrences_time ON discord_craft_plan_report_occurrences (scheduled_at DESC);
  CREATE INDEX IF NOT EXISTS idx_discord_youtube_videos_channel ON discord_youtube_videos (channel_id, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_discord_craft_watches_profession ON discord_craft_watches (guild_id, profession_key, mode);
  CREATE INDEX IF NOT EXISTS idx_discord_mod_cases_time ON discord_mod_cases (guild_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_discord_warnings_user ON discord_warnings (guild_id, user_id, active);
  CREATE INDEX IF NOT EXISTS idx_discord_mod_notes_user ON discord_mod_notes (guild_id, user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON user_accounts (character_status, last_login_at DESC);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_entities_kind_target ON game_catalog_entities (kind, target_id);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_recipes_source ON game_catalog_recipes (source_kind, source_id);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_recipe_outputs_output ON game_catalog_recipe_outputs (output_key, is_primary_output DESC, recipe_key);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_recipe_output_components_output ON game_catalog_recipe_output_components (output_key, recipe_key, component_index);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_recipe_sources_recipe ON game_catalog_recipe_sources (recipe_key, catalog_key);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_recipe_inputs_input ON game_catalog_recipe_inputs (input_key, recipe_key);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_item_list_outputs_output_producer ON game_catalog_item_list_outputs (output_key, producer_key);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_item_list_possibility_outputs_output ON game_catalog_item_list_possibility_outputs (output_key, item_list_id);
  CREATE INDEX IF NOT EXISTS idx_game_catalog_resource_completion_outputs_output ON game_catalog_resource_completion_outputs (output_key, resource_id);
  CREATE INDEX IF NOT EXISTS idx_domain_payload_claim ON domain_payload_current (claim_id, domain);
  ${operationalHistoryRetentionSchemaSql}
`;

export function applySchemaBootstrap(db) {
  db.exec(schemaBootstrapSql);
}
