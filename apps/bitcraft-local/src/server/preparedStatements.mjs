export function createPreparedStatements(db) {
  return {
  getSettlementState: db.prepare(`
    SELECT claim_id, captured_at, supplies, treasury, members_count, buildings_count, market_count, updated_at
    FROM settlement_state_current
    WHERE claim_id = ?
  `),
  upsertSettlementState: db.prepare(`
    INSERT INTO settlement_state_current (
      claim_id, captured_at, supplies, treasury, members_count,
      buildings_count, market_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(claim_id) DO UPDATE SET
      captured_at = excluded.captured_at,
      supplies = excluded.supplies,
      treasury = excluded.treasury,
      members_count = excluded.members_count,
      buildings_count = excluded.buildings_count,
      market_count = excluded.market_count,
      updated_at = excluded.updated_at
  `),
  insertMarketEvent: db.prepare(`
    INSERT OR IGNORE INTO market_events (claim_id, event_type, listing_key, item_name, side, owner, owner_entity_id, item_id, item_type, quantity, price, total_value, tier, rarity, occurred_at, trade_id, source_key, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  resolveMarketEvent: db.prepare("UPDATE market_events SET event_type = ?, raw_json = ? WHERE id = ? AND claim_id = ?"),
  insertActivity: db.prepare(`
    INSERT INTO activity_events (claim_id, event_type, summary, occurred_at, metadata_json)
    VALUES (?, ?, ?, ?, ?)
  `),
  insertSourcedActivity: db.prepare(`
    INSERT OR IGNORE INTO activity_events (claim_id, event_type, summary, occurred_at, metadata_json, source_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getCraftPlan: db.prepare("SELECT * FROM craft_plan_settings WHERE plan_key = ?"),
  upsertCraftPlan: db.prepare(`
    INSERT INTO craft_plan_settings (plan_key, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(plan_key) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
  `),
  insertCraftPlanConfigAudit: db.prepare(`
    INSERT INTO craft_plan_config_audit (
      plan_id, claim_id, actor_type, actor_id, actor_display_name, occurred_at,
      previous_revision, new_revision, action, changes_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listCraftPlanConfigAudit: db.prepare(`
    SELECT * FROM craft_plan_config_audit
    WHERE plan_id = ?
    ORDER BY occurred_at ASC, id ASC
  `),
  deleteCraftPlanConfigAudit: db.prepare("DELETE FROM craft_plan_config_audit WHERE plan_id = ?"),
  anonymizeCraftPlanConfigAuditActor: db.prepare(`
    UPDATE craft_plan_config_audit
    SET actor_id = NULL, actor_display_name = ?
    WHERE actor_type = 'user_account' AND actor_id = ?
  `),
  insertCraftPlanProgressSnapshot: db.prepare(`
    INSERT INTO craft_plan_progress_audit_snapshots (
      claim_id, plan_id, captured_at, baseline_revision, fingerprint, full_snapshot,
      payload_gzip, app_version, build_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  latestCraftPlanProgressSnapshot: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_snapshots
    WHERE claim_id = ? AND plan_id = ?
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  `),
  latestCraftPlanProgressSnapshotBefore: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_snapshots
    WHERE claim_id = ? AND plan_id = ? AND captured_at <= ?
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  `),
  craftPlanProgressSnapshotAt: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_snapshots
    WHERE claim_id = ? AND plan_id = ? AND captured_at = ?
    ORDER BY id DESC
    LIMIT 1
  `),
  listLatestCraftPlanProgressSnapshots: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_snapshots
    WHERE claim_id = ? AND plan_id = ?
    ORDER BY captured_at DESC, id DESC
    LIMIT ?
  `),
  listCraftPlanProgressSnapshotsSince: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_snapshots
    WHERE claim_id = ? AND plan_id = ? AND captured_at >= ?
    ORDER BY captured_at ASC, id ASC
  `),
  insertCraftPlanProgressEvent: db.prepare(`
    INSERT INTO craft_plan_progress_audit_events (
      claim_id, plan_id, captured_at, baseline_revision, event_type, summary, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  insertCraftPlanProgressCausalGroup: db.prepare(`
    INSERT OR IGNORE INTO craft_plan_progress_audit_causal_groups (
      claim_id, plan_id, group_id, from_captured_at, to_captured_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `),
  listCraftPlanProgressCausalGroups: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_causal_groups
    WHERE claim_id = ? AND plan_id = ? AND to_captured_at >= ? AND to_captured_at <= ?
    ORDER BY to_captured_at DESC, id DESC
    LIMIT 10000
  `),
  exportCraftPlanProgressCausalGroups: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_causal_groups
    WHERE claim_id = ? AND plan_id = ? AND to_captured_at >= ? AND to_captured_at <= ?
    ORDER BY to_captured_at DESC, id DESC
  `),
  listCraftPlanProgressEvents: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_events
    WHERE claim_id = ? AND plan_id = ? AND captured_at >= ?
    ORDER BY captured_at ASC, id ASC
    LIMIT ?
  `),
  latestCraftPlanBaselineChange: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_events
    WHERE claim_id = ? AND plan_id = ? AND event_type = 'baseline_change'
    ORDER BY captured_at DESC, id DESC
    LIMIT 1
  `),
  upsertCraftPlanProgressAuditState: db.prepare(`
    INSERT INTO craft_plan_progress_audit_state (
      claim_id, plan_id, last_fingerprint, last_payload_gzip, last_snapshot_id,
      last_full_snapshot_at, last_success_at, last_failure_fingerprint,
      last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(claim_id, plan_id) DO UPDATE SET
      last_fingerprint = excluded.last_fingerprint,
      last_payload_gzip = excluded.last_payload_gzip,
      last_snapshot_id = excluded.last_snapshot_id,
      last_full_snapshot_at = excluded.last_full_snapshot_at,
      last_success_at = excluded.last_success_at,
      last_failure_fingerprint = excluded.last_failure_fingerprint,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `),
  getCraftPlanProgressAuditState: db.prepare(`
    SELECT * FROM craft_plan_progress_audit_state WHERE claim_id = ? AND plan_id = ?
  `),
  craftPlanProgressAuditCounts: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM craft_plan_progress_audit_snapshots WHERE claim_id = ? AND plan_id = ?) AS snapshot_count,
      (SELECT COUNT(*) FROM craft_plan_progress_audit_events WHERE claim_id = ? AND plan_id = ?) AS event_count,
      COALESCE((SELECT SUM(LENGTH(payload_gzip)) FROM craft_plan_progress_audit_snapshots WHERE claim_id = ? AND plan_id = ?), 0)
        + COALESCE((SELECT SUM(LENGTH(payload_json)) FROM craft_plan_progress_audit_events WHERE claim_id = ? AND plan_id = ?), 0)
        AS stored_bytes
  `),
  pruneCraftPlanProgressSnapshots: db.prepare(`
    DELETE FROM craft_plan_progress_audit_snapshots
    WHERE id IN (
      SELECT id FROM craft_plan_progress_audit_snapshots
      WHERE captured_at < ?
      ORDER BY id ASC
      LIMIT ?
    )
  `),
  pruneCraftPlanProgressEvents: db.prepare(`
    DELETE FROM craft_plan_progress_audit_events
    WHERE id IN (
      SELECT id FROM craft_plan_progress_audit_events
      WHERE captured_at < ?
      ORDER BY id ASC
      LIMIT ?
    )
  `),
  pruneCraftPlanProgressCausalGroups: db.prepare(`
    DELETE FROM craft_plan_progress_audit_causal_groups
    WHERE id IN (
      SELECT id FROM craft_plan_progress_audit_causal_groups
      WHERE to_captured_at < ?
      ORDER BY id ASC
      LIMIT ?
    )
  `),
  dealWatchCountForUser: db.prepare("SELECT COUNT(*) AS count FROM market_deal_watches WHERE user_id = ? AND claim_id = ?"),
  dealWatchByUserItem: db.prepare("SELECT * FROM market_deal_watches WHERE user_id = ? AND claim_id = ? AND region_id = ? AND item_id = ? AND item_type = ?"),
  dealWatchByIdForUser: db.prepare("SELECT * FROM market_deal_watches WHERE id = ? AND user_id = ?"),
  listDealWatchesForUser: db.prepare("SELECT * FROM market_deal_watches WHERE user_id = ? AND claim_id = ? ORDER BY enabled DESC, updated_at DESC"),
  listEnabledDealWatches: db.prepare("SELECT * FROM market_deal_watches WHERE enabled = 1 ORDER BY region_id ASC, item_name ASC"),
  insertDealWatch: db.prepare(`
    INSERT INTO market_deal_watches (
      user_id, discord_id, claim_id, region_id, item_id, item_type, item_name, tier, rarity, icon_asset_name,
      threshold_percent, enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `),
  updateDealWatch: db.prepare(`
    UPDATE market_deal_watches
    SET enabled = COALESCE(?, enabled), threshold_percent = COALESCE(?, threshold_percent), updated_at = ?
    WHERE id = ? AND user_id = ?
  `),
  deleteDealWatch: db.prepare("DELETE FROM market_deal_watches WHERE id = ? AND user_id = ?"),
  updateDealWatchChecked: db.prepare(`
    UPDATE market_deal_watches
    SET last_checked_at = ?, last_baseline_window_days = ?, last_baseline_average = ?, last_error = ?, updated_at = ?
    WHERE id = ?
  `),
  updateDealWatchAlerted: db.prepare("UPDATE market_deal_watches SET last_alert_at = ?, updated_at = ? WHERE id = ?"),
  insertDealAlert: db.prepare(`
    INSERT OR IGNORE INTO market_deal_alerts (
      watch_id, user_id, discord_id, claim_id, region_id, item_id, item_type, item_name, tier, rarity, icon_asset_name,
      listing_key, market_claim_id, market_claim_name, seller_name, quantity, unit_price, total_value,
      baseline_window_days, baseline_average, sales_count, discount_percent, dm_status, dm_error, created_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listDealAlertsForUser: db.prepare("SELECT * FROM market_deal_alerts WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?"),
  updateDealAlertDm: db.prepare("UPDATE market_deal_alerts SET dm_status = ?, dm_error = ? WHERE id = ?"),
  unreadDealAlertCount: db.prepare("SELECT COUNT(*) AS count FROM market_deal_alerts WHERE user_id = ? AND read_at IS NULL"),
  activeProductionJobs: db.prepare("SELECT * FROM production_jobs WHERE claim_id = ? AND status = 'active'"),
  productionJobCount: db.prepare("SELECT COUNT(*) AS count FROM production_jobs WHERE claim_id = ?"),
  markProductionStartNotified: db.prepare("UPDATE production_jobs SET start_notified = 1 WHERE job_key = ?"),
  rekeyProductionJob: db.prepare("UPDATE OR IGNORE production_jobs SET job_key = ? WHERE job_key = ?"),
  upsertProductionJob: db.prepare(`
    INSERT INTO production_jobs (job_key, claim_id, label, building_name, crafter_name, first_seen, last_seen, status, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT(job_key) DO UPDATE SET
      label = excluded.label,
      building_name = excluded.building_name,
      crafter_name = excluded.crafter_name,
      last_seen = excluded.last_seen,
      status = 'active',
      start_notified = CASE WHEN production_jobs.status = 'active' THEN production_jobs.start_notified ELSE 0 END,
      raw_json = excluded.raw_json
  `),
  completeProductionJob: db.prepare("UPDATE production_jobs SET status = 'completed', last_seen = ? WHERE job_key = ? AND status = 'active'"),
  getSetting: db.prepare("SELECT value FROM app_settings WHERE key = ?"),
  upsertSetting: db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  getSecret: db.prepare("SELECT value FROM app_secrets WHERE key = ?"),
  upsertSecret: db.prepare(`
    INSERT INTO app_secrets (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  deleteSecret: db.prepare("DELETE FROM app_secrets WHERE key = ?"),
  upsertScheduledJob: db.prepare(`
    INSERT INTO scheduled_jobs (job_key, label, description, schedule, enabled, next_run_at, running, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, '{}', ?)
    ON CONFLICT(job_key) DO UPDATE SET
      label = excluded.label,
      description = excluded.description,
      updated_at = excluded.updated_at
  `),
  listScheduledJobs: db.prepare("SELECT * FROM scheduled_jobs ORDER BY job_key"),
  getScheduledJob: db.prepare("SELECT * FROM scheduled_jobs WHERE job_key = ?"),
  dueScheduledJobs: db.prepare("SELECT * FROM scheduled_jobs WHERE enabled = 1 AND running = 0 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC"),
  setScheduledJobEnabled: db.prepare("UPDATE scheduled_jobs SET enabled = ?, updated_at = ? WHERE job_key = ?"),
  updateScheduledJobSettings: db.prepare("UPDATE scheduled_jobs SET schedule = ?, enabled = ?, next_run_at = ?, updated_at = ? WHERE job_key = ?"),
  markScheduledJobRunning: db.prepare("UPDATE scheduled_jobs SET running = 1, last_run_at = ?, last_error = NULL, updated_at = ? WHERE job_key = ?"),
  markScheduledJobSuccess: db.prepare("UPDATE scheduled_jobs SET running = 0, last_success_at = ?, last_error = NULL, next_run_at = ?, metadata_json = ?, updated_at = ? WHERE job_key = ?"),
  markScheduledJobContinuation: db.prepare("UPDATE scheduled_jobs SET running = 0, last_error = NULL, next_run_at = ?, metadata_json = ?, updated_at = ? WHERE job_key = ?"),
  markScheduledJobFailure: db.prepare("UPDATE scheduled_jobs SET running = 0, last_error = ?, next_run_at = ?, metadata_json = ?, updated_at = ? WHERE job_key = ?"),
  updateScheduledJobMetadata: db.prepare("UPDATE scheduled_jobs SET metadata_json = ?, updated_at = ? WHERE job_key = ?"),
  resetStaleScheduledJobs: db.prepare("UPDATE scheduled_jobs SET running = 0, last_error = ?, next_run_at = ?, metadata_json = ?, updated_at = ? WHERE running = 1 AND (last_run_at IS NULL OR last_run_at < ?)"),
  adminCount: db.prepare("SELECT COUNT(*) AS count FROM admin_users"),
  adminByUsername: db.prepare("SELECT * FROM admin_users WHERE username = ? AND active = 1"),
  adminByDiscordId: db.prepare("SELECT * FROM admin_users WHERE discord_id = ? AND active = 1"),
  adminBySession: db.prepare(`
    SELECT admin_users.id, admin_users.username, admin_users.role, admin_users.discord_id, admin_users.discord_username, admin_users.discord_global_name, admin_users.discord_avatar
    FROM admin_sessions
    JOIN admin_users ON admin_users.id = admin_sessions.user_id
    WHERE admin_sessions.token_hash = ? AND admin_sessions.expires_at > ? AND admin_users.active = 1
  `),
  insertAdmin: db.prepare("INSERT INTO admin_users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)"),
  insertDiscordAdmin: db.prepare("INSERT INTO admin_users (username, password_hash, role, created_at, discord_id, discord_username, discord_global_name, discord_avatar) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
  updateAdminDiscordProfile: db.prepare("UPDATE admin_users SET username = ?, discord_username = ?, discord_global_name = ?, discord_avatar = ?, last_login_at = ? WHERE id = ?"),
  updatePassword: db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?"),
  updateAdminActive: db.prepare("UPDATE admin_users SET active = ? WHERE id = ?"),
  updateAdminRole: db.prepare("UPDATE admin_users SET role = ? WHERE id = ?"),
  updateLastLogin: db.prepare("UPDATE admin_users SET last_login_at = ? WHERE id = ?"),
  insertSession: db.prepare("INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"),
  deleteSession: db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?"),
  deleteUserSessions: db.prepare("DELETE FROM admin_sessions WHERE user_id = ?"),
  deleteOtherSessions: db.prepare("DELETE FROM admin_sessions WHERE user_id = ? AND token_hash <> ?"),
  deleteExpiredSessions: db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?"),
  userBySession: db.prepare(`
    SELECT user_accounts.*
    FROM user_sessions
    JOIN user_accounts ON user_accounts.id = user_sessions.user_id
    WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > ?
  `),
  userByDiscordId: db.prepare("SELECT * FROM user_accounts WHERE discord_id = ?"),
  upsertUserAccount: db.prepare(`
    INSERT INTO user_accounts (discord_id, discord_username, discord_global_name, discord_avatar, character_status, settings_json, created_at, last_login_at)
    VALUES (?, ?, ?, ?, 'unlinked', '{}', ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      discord_username = excluded.discord_username,
      discord_global_name = excluded.discord_global_name,
      discord_avatar = excluded.discord_avatar,
      last_login_at = excluded.last_login_at
  `),
  updateUserLastLogin: db.prepare("UPDATE user_accounts SET last_login_at = ?, inactivity_warning_sent_at = NULL WHERE id = ?"),
  insertUserSession: db.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at, reauthenticated_at) VALUES (?, ?, ?, ?, ?)"),
  deleteAppUserSession: db.prepare("DELETE FROM user_sessions WHERE token_hash = ?"),
  deleteExpiredUserSessions: db.prepare("DELETE FROM user_sessions WHERE expires_at <= ?"),
  appUserSessionByToken: db.prepare("SELECT * FROM user_sessions WHERE token_hash = ? AND user_id = ?"),
  updateUserSessionReauthenticatedAt: db.prepare("UPDATE user_sessions SET reauthenticated_at = ? WHERE token_hash = ? AND user_id = ?"),
  currentUserLegalAcceptance: db.prepare(`
    SELECT *
    FROM user_legal_acceptances
    WHERE user_id = ?
    ORDER BY accepted_at DESC, id DESC
    LIMIT 1
  `),
  insertUserLegalAcceptance: db.prepare(`
    INSERT INTO user_legal_acceptances (
      user_id, legal_version, terms_digest, privacy_digest,
      age_confirmed, accepted_at, source
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, legal_version, terms_digest, privacy_digest)
    DO UPDATE SET
      age_confirmed = excluded.age_confirmed,
      accepted_at = excluded.accepted_at,
      source = excluded.source
  `),
  updateUserCharacter: db.prepare("UPDATE user_accounts SET character_player_id = ?, character_name = ?, character_status = ? WHERE id = ?"),
  approvedUserAccountByCharacterId: db.prepare(`
    SELECT *
    FROM user_accounts
    WHERE character_player_id = ?
      AND character_status = 'approved'
      AND id <> ?
    LIMIT 1
  `),
  updateUserSettings: db.prepare("UPDATE user_accounts SET settings_json = ? WHERE id = ?"),
  listUserAccounts: db.prepare("SELECT * FROM user_accounts ORDER BY last_login_at DESC, created_at DESC"),
  updateUserCharacterStatus: db.prepare("UPDATE user_accounts SET character_status = ? WHERE id = ?"),
  insertAudit: db.prepare("INSERT INTO admin_audit_log (user_id, username, action, details_json, occurred_at) VALUES (?, ?, ?, ?, ?)"),
  insertLoginEvent: db.prepare("INSERT INTO admin_login_events (username, successful, occurred_at, remote_address) VALUES (?, ?, ?, ?)"),
  insertAnalyticsEvent: db.prepare(`
    INSERT INTO analytics_events (visitor_key, session_key, event_name, page, properties_json, duration_seconds, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  insertVisitorSecurityEvent: db.prepare(`
    INSERT INTO visitor_security_events (
      occurred_at, method, route_group, status_code, status_class, ip_address,
      ip_anonymized, ip_hash, visitor_key, user_agent_hash, country, city
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  clearGeoipRanges: db.prepare("DELETE FROM geoip_ranges"),
  insertGeoipRange: db.prepare("INSERT INTO geoip_ranges (ip_start, ip_end, country, city, updated_at) VALUES (?, ?, ?, ?, ?)"),
  lookupGeoipRange: db.prepare("SELECT country, city FROM geoip_ranges WHERE ip_start <= ? AND ip_end >= ? ORDER BY ip_start DESC LIMIT 1"),
  geoipRangeCount: db.prepare("SELECT COUNT(*) AS count FROM geoip_ranges"),
  geoipRangeLastUpdated: db.prepare("SELECT MAX(updated_at) AS updated_at FROM geoip_ranges"),
  getVisitorGeoipCache: db.prepare("SELECT * FROM visitor_geoip_cache WHERE ip_hash = ?"),
  upsertVisitorGeoipCache: db.prepare(`
    INSERT INTO visitor_geoip_cache (ip_hash, ip_anonymized, provider, country, city, looked_up_at, expires_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ip_hash) DO UPDATE SET
      ip_anonymized = excluded.ip_anonymized,
      provider = excluded.provider,
      country = excluded.country,
      city = excluded.city,
      looked_up_at = excluded.looked_up_at,
      expires_at = excluded.expires_at,
      error = excluded.error
  `),
  pruneVisitorGeoipCache: db.prepare("DELETE FROM visitor_geoip_cache WHERE expires_at < ?"),
  visitorGeoipCacheCount: db.prepare("SELECT COUNT(*) AS count FROM visitor_geoip_cache"),
  visitorGeoipCacheLastLookup: db.prepare("SELECT MAX(looked_up_at) AS looked_up_at FROM visitor_geoip_cache"),
  updateVisitorSecurityLocationByIpHash: db.prepare(`
    UPDATE visitor_security_events
    SET country = ?, city = ?
    WHERE ip_hash = ? AND COALESCE(country, 'Unknown') = 'Unknown'
  `),
  insertDiscordDelivery: db.prepare(`
    INSERT INTO discord_delivery_log (event_type, status, summary, channel_id, channel_key, reason, error, metadata_json, response_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  enqueueDiscordNotification: db.prepare(`
    INSERT INTO discord_notification_outbox (source_key, event_type, summary, occurred_at, metadata_json, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    ON CONFLICT(source_key) DO UPDATE SET
      summary = excluded.summary,
      occurred_at = excluded.occurred_at,
      metadata_json = excluded.metadata_json,
      status = CASE WHEN discord_notification_outbox.status IN ('sent', 'sending') THEN discord_notification_outbox.status ELSE 'pending' END,
      attempts = CASE WHEN discord_notification_outbox.status IN ('sent', 'sending') THEN discord_notification_outbox.attempts ELSE 0 END,
      next_attempt_at = CASE WHEN discord_notification_outbox.status IN ('sent', 'sending') THEN discord_notification_outbox.next_attempt_at ELSE excluded.next_attempt_at END,
      locked_at = CASE WHEN discord_notification_outbox.status = 'sending' THEN discord_notification_outbox.locked_at ELSE NULL END,
      locked_by = CASE WHEN discord_notification_outbox.status = 'sending' THEN discord_notification_outbox.locked_by ELSE NULL END,
      lease_token = CASE WHEN discord_notification_outbox.status = 'sending' THEN discord_notification_outbox.lease_token ELSE NULL END,
      lease_expires_at = CASE WHEN discord_notification_outbox.status = 'sending' THEN discord_notification_outbox.lease_expires_at ELSE NULL END,
      skipped_at = CASE WHEN discord_notification_outbox.status IN ('sent', 'sending') THEN discord_notification_outbox.skipped_at ELSE NULL END,
      failed_at = CASE WHEN discord_notification_outbox.status IN ('sent', 'sending') THEN discord_notification_outbox.failed_at ELSE NULL END,
      last_error = CASE WHEN discord_notification_outbox.status IN ('sent', 'sending') THEN discord_notification_outbox.last_error ELSE NULL END,
      updated_at = excluded.updated_at
  `),
  discordNotificationOutboxCounts: db.prepare("SELECT status, COUNT(*) AS count FROM discord_notification_outbox GROUP BY status"),
  discordNotificationOutboxDuplicateRisk: db.prepare(`
    SELECT
      SUM(CASE
        WHEN attempts > 1
          OR (status = 'sending' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?1)
          OR last_error LIKE 'Delivery lease expired before completion;%'
          OR last_error = 'Canonical announcement delivery outcome is unknown; automatic retry is suppressed'
          OR last_error = 'Canonical announcement delivery was interrupted; automatic retry is suppressed'
        THEN 1 ELSE 0
      END) AS potential_duplicate_rows,
      SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) AS active_leases,
      SUM(CASE
        WHEN (status = 'sending' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?1)
          OR last_error LIKE 'Delivery lease expired before completion;%'
        THEN 1 ELSE 0
      END) AS expired_lease_rows,
      SUM(CASE
        WHEN last_error = 'Canonical announcement delivery outcome is unknown; automatic retry is suppressed'
          OR last_error = 'Canonical announcement delivery was interrupted; automatic retry is suppressed'
        THEN 1 ELSE 0
      END) AS unknown_outcome_rows
    FROM discord_notification_outbox
  `),
  recentDiscordDeliveries: db.prepare("SELECT * FROM discord_delivery_log ORDER BY occurred_at DESC, id DESC LIMIT ?"),
  pruneDiscordDeliveries: db.prepare("DELETE FROM discord_delivery_log WHERE id NOT IN (SELECT id FROM discord_delivery_log ORDER BY occurred_at DESC, id DESC LIMIT 250)"),
  claimDiscordCraftPlanReportOccurrence: db.prepare(`
    INSERT OR IGNORE INTO discord_craft_plan_report_occurrences
      (rule_id, occurrence_key, scheduled_at, status, created_at, updated_at)
    VALUES (?, ?, ?, 'claimed', ?, ?)
  `),
  getDiscordCraftPlanReportOccurrence: db.prepare("SELECT * FROM discord_craft_plan_report_occurrences WHERE rule_id = ? AND occurrence_key = ?"),
  latestSentDiscordCraftPlanReportOccurrence: db.prepare("SELECT * FROM discord_craft_plan_report_occurrences WHERE rule_id = ? AND status = 'sent' ORDER BY updated_at DESC LIMIT 1"),
  deleteDiscordCraftPlanReportOccurrence: db.prepare("DELETE FROM discord_craft_plan_report_occurrences WHERE rule_id = ? AND occurrence_key = ? AND status = 'claimed'"),
  updateDiscordCraftPlanReportOccurrence: db.prepare("UPDATE discord_craft_plan_report_occurrences SET status = ?, discord_message_id = ?, last_error = ?, updated_at = ? WHERE rule_id = ? AND occurrence_key = ?"),
  recentDiscordCraftPlanReportOccurrences: db.prepare("SELECT * FROM discord_craft_plan_report_occurrences ORDER BY scheduled_at DESC LIMIT ?"),
  pruneDiscordCraftPlanReportOccurrences: db.prepare("DELETE FROM discord_craft_plan_report_occurrences WHERE scheduled_at < ? OR rowid NOT IN (SELECT rowid FROM discord_craft_plan_report_occurrences ORDER BY scheduled_at DESC LIMIT 1000)"),
  listDiscordYouTubeChannels: db.prepare("SELECT * FROM discord_youtube_channels ORDER BY title COLLATE NOCASE, channel_id"),
  getDiscordYouTubeChannel: db.prepare("SELECT * FROM discord_youtube_channels WHERE channel_id = ?"),
  upsertDiscordYouTubeChannel: db.prepare(`
    INSERT INTO discord_youtube_channels (channel_id, input, title, url, discord_channel_id, enabled, last_checked_at, last_success_at, last_error, last_video_id, last_video_title, last_video_published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET
      input = excluded.input,
      title = COALESCE(excluded.title, discord_youtube_channels.title),
      url = COALESCE(excluded.url, discord_youtube_channels.url),
      discord_channel_id = COALESCE(excluded.discord_channel_id, discord_youtube_channels.discord_channel_id),
      enabled = excluded.enabled,
      last_checked_at = COALESCE(excluded.last_checked_at, discord_youtube_channels.last_checked_at),
      last_success_at = COALESCE(excluded.last_success_at, discord_youtube_channels.last_success_at),
      last_error = excluded.last_error,
      last_video_id = COALESCE(excluded.last_video_id, discord_youtube_channels.last_video_id),
      last_video_title = COALESCE(excluded.last_video_title, discord_youtube_channels.last_video_title),
      last_video_published_at = COALESCE(excluded.last_video_published_at, discord_youtube_channels.last_video_published_at),
      updated_at = excluded.updated_at
  `),
  setDiscordYouTubeChannelEnabled: db.prepare("UPDATE discord_youtube_channels SET enabled = ?, updated_at = ? WHERE channel_id = ?"),
  setDiscordYouTubeChannelDiscordChannel: db.prepare("UPDATE discord_youtube_channels SET discord_channel_id = ?, updated_at = ? WHERE channel_id = ?"),
  updateDiscordYouTubeChannelStatus: db.prepare("UPDATE discord_youtube_channels SET title = COALESCE(?, title), url = COALESCE(?, url), last_checked_at = ?, last_success_at = ?, last_error = ?, last_video_id = COALESCE(?, last_video_id), last_video_title = COALESCE(?, last_video_title), last_video_published_at = COALESCE(?, last_video_published_at), updated_at = ? WHERE channel_id = ?"),
  deleteDiscordYouTubeChannel: db.prepare("DELETE FROM discord_youtube_channels WHERE channel_id = ?"),
  deleteDiscordYouTubeVideosForChannel: db.prepare("DELETE FROM discord_youtube_videos WHERE channel_id = ?"),
  listDiscordYouTubeVideosForChannel: db.prepare("SELECT * FROM discord_youtube_videos WHERE channel_id = ?"),
  getDiscordYouTubeVideo: db.prepare("SELECT * FROM discord_youtube_videos WHERE video_id = ?"),
  insertDiscordYouTubeVideo: db.prepare(`
    INSERT INTO discord_youtube_videos (video_id, channel_id, title, url, thumbnail_url, published_at, seen_at, notified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      thumbnail_url = excluded.thumbnail_url,
      published_at = excluded.published_at,
      notified_at = COALESCE(discord_youtube_videos.notified_at, excluded.notified_at)
  `),
  upsertDiscordCraftWatch: db.prepare(`
    INSERT INTO discord_craft_watches (guild_id, user_id, profession_key, profession_name, mode, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, profession_key) DO UPDATE SET
      profession_name = excluded.profession_name,
      mode = excluded.mode,
      updated_at = excluded.updated_at
  `),
  getDiscordCraftWatch: db.prepare("SELECT * FROM discord_craft_watches WHERE guild_id = ? AND user_id = ? AND profession_key = ?"),
  deleteDiscordCraftWatch: db.prepare("DELETE FROM discord_craft_watches WHERE guild_id = ? AND user_id = ? AND profession_key = ?"),
  clearDiscordCraftWatches: db.prepare("DELETE FROM discord_craft_watches WHERE guild_id = ? AND user_id = ?"),
  listDiscordCraftWatches: db.prepare("SELECT * FROM discord_craft_watches WHERE guild_id = ? AND user_id = ? ORDER BY profession_name"),
  matchingDiscordCraftWatches: db.prepare("SELECT user_id, mode FROM discord_craft_watches WHERE guild_id = ? AND profession_key = ?"),
  insertDiscordModCase: db.prepare("INSERT INTO discord_mod_cases (guild_id, case_type, user_id, moderator, reason, details_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
  recentDiscordModCases: db.prepare("SELECT * FROM discord_mod_cases WHERE guild_id = ? ORDER BY occurred_at DESC, id DESC LIMIT ?"),
  insertDiscordWarning: db.prepare("INSERT INTO discord_warnings (guild_id, user_id, moderator, reason, active, created_at) VALUES (?, ?, ?, ?, 1, ?)"),
  listDiscordWarnings: db.prepare("SELECT * FROM discord_warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50"),
  clearDiscordWarnings: db.prepare("UPDATE discord_warnings SET active = 0 WHERE guild_id = ? AND user_id = ? AND active = 1"),
  insertDiscordModNote: db.prepare("INSERT INTO discord_mod_notes (guild_id, user_id, moderator, note, created_at) VALUES (?, ?, ?, ?, ?)"),
  listDiscordModNotes: db.prepare("SELECT * FROM discord_mod_notes WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50"),
  deleteDiscordModNote: db.prepare("DELETE FROM discord_mod_notes WHERE id = ? AND guild_id = ?"),
  upsertDiscordCustomCommand: db.prepare("INSERT INTO discord_custom_commands (name, description, response, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, response = excluded.response, updated_at = excluded.updated_at"),
  deleteDiscordCustomCommand: db.prepare("DELETE FROM discord_custom_commands WHERE name = ?"),
  listDiscordCustomCommands: db.prepare("SELECT * FROM discord_custom_commands ORDER BY name"),
  getDiscordCustomCommand: db.prepare("SELECT * FROM discord_custom_commands WHERE name = ?"),
  upsertDiscordComponentVote: db.prepare("INSERT INTO discord_component_votes (message_id, component_key, user_id, kind, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(message_id, user_id, kind) DO UPDATE SET component_key = excluded.component_key, updated_at = excluded.updated_at"),
  componentVoteCounts: db.prepare("SELECT component_key, COUNT(*) AS count FROM discord_component_votes WHERE message_id = ? AND kind = ? GROUP BY component_key"),
  upsertDiscordComponentMessage: db.prepare("INSERT INTO discord_component_messages (message_id, kind, metadata_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(message_id, kind) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at"),
  getDiscordComponentMessage: db.prepare("SELECT * FROM discord_component_messages WHERE message_id = ? AND kind = ?"),
  upsertDiscordTempBan: db.prepare("INSERT INTO discord_temp_bans (guild_id, user_id, unban_at, reason, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET unban_at = excluded.unban_at, reason = excluded.reason"),
  dueDiscordTempBans: db.prepare("SELECT * FROM discord_temp_bans WHERE unban_at <= ? LIMIT 25"),
  deleteDiscordTempBan: db.prepare("DELETE FROM discord_temp_bans WHERE guild_id = ? AND user_id = ?"),

  };
}
