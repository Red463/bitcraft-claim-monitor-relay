import { createHmac, randomUUID as cryptoRandomUUID } from "node:crypto";

function count(result) {
  return Number(result?.changes ?? 0);
}

function safeJson(value) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return null;
  }
}

function identifierValues(account) {
  return [
    account.discord_id,
    account.discord_username,
    account.discord_global_name,
    account.character_player_id,
    account.character_name,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

function scrubText(value, identifiers, replacement) {
  let text = String(value ?? "");
  for (const identifier of identifiers) {
    if (text.includes(identifier)) text = text.split(identifier).join(replacement);
  }
  return text;
}

function scrubJson(value, identifiers, replacement) {
  if (Array.isArray(value)) return value.map((entry) => scrubJson(entry, identifiers, replacement));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubJson(entry, identifiers, replacement)]));
  }
  return typeof value === "string" ? scrubText(value, identifiers, replacement) : value;
}

function anonymizeModerationCases(db, account, anonymizedSubject) {
  const identifiers = identifierValues(account);
  const rows = db.prepare("SELECT id, user_id, moderator, reason, details_json FROM discord_mod_cases WHERE user_id = ?").all(account.discord_id);
  const update = db.prepare("UPDATE discord_mod_cases SET user_id = ?, moderator = ?, reason = ?, details_json = ? WHERE id = ?");
  for (const row of rows) {
    const parsed = safeJson(row.details_json);
    update.run(
      anonymizedSubject,
      scrubText(row.moderator, identifiers, "[deleted user]"),
      scrubText(row.reason, identifiers, "[deleted user]"),
      JSON.stringify(scrubJson(parsed ?? {}, identifiers, "[deleted user]")),
      row.id,
    );
  }
  return rows.length;
}

function scrubAuditRows(db, account, anonymizedSubject) {
  const identifiers = identifierValues(account);
  const rows = db.prepare("SELECT id, user_id, username, details_json FROM admin_audit_log").all();
  const update = db.prepare("UPDATE admin_audit_log SET user_id = NULL, username = ?, details_json = ? WHERE id = ?");
  let changed = 0;
  for (const row of rows) {
    const parsed = safeJson(row.details_json);
    const scrubbedUsername = scrubText(row.username, identifiers, anonymizedSubject);
    const scrubbedDetails = scrubJson(parsed ?? {}, identifiers, anonymizedSubject);
    const detailsJson = JSON.stringify(scrubbedDetails);
    if (scrubbedUsername === row.username && detailsJson === JSON.stringify(parsed ?? {})) continue;
    update.run(scrubbedUsername, detailsJson, row.id);
    changed += 1;
  }
  return changed;
}

function scrubDeliveryRows(db, account) {
  const identifiers = identifierValues(account);
  const rows = db.prepare("SELECT id, summary, reason, error, metadata_json, response_json FROM discord_delivery_log").all();
  const update = db.prepare(`
    UPDATE discord_delivery_log
    SET summary = ?, reason = ?, error = ?, metadata_json = ?, response_json = ?
    WHERE id = ?
  `);
  let changed = 0;
  for (const row of rows) {
    const metadata = safeJson(row.metadata_json);
    const response = safeJson(row.response_json);
    const next = {
      summary: scrubText(row.summary, identifiers, "[deleted user]"),
      reason: scrubText(row.reason, identifiers, "[deleted user]"),
      error: scrubText(row.error, identifiers, "[deleted user]"),
      metadata_json: JSON.stringify(scrubJson(metadata ?? {}, identifiers, "[deleted user]")),
      response_json: row.response_json == null ? null : JSON.stringify(scrubJson(response ?? {}, identifiers, "[deleted user]")),
    };
    if (
      next.summary === String(row.summary ?? "")
      && next.reason === String(row.reason ?? "")
      && next.error === String(row.error ?? "")
      && next.metadata_json === JSON.stringify(metadata ?? {})
      && next.response_json === (row.response_json == null ? null : JSON.stringify(response ?? {}))
    ) continue;
    update.run(next.summary, next.reason, next.error, next.metadata_json, next.response_json, row.id);
    changed += 1;
  }
  return changed;
}

function removeAccessControlAllowlistEntries(db, discordId, updatedAt) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'access_control_json'").get();
  const config = safeJson(row?.value);
  if (!config || typeof config !== "object" || Array.isArray(config)) return 0;
  const rules = config.rules;
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return 0;

  let removed = 0;
  for (const rule of Object.values(rules)) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule) || !Array.isArray(rule.allowedDiscordIds)) continue;
    rule.allowedDiscordIds = rule.allowedDiscordIds.filter((value) => {
      if (String(value ?? "").trim() !== String(discordId)) return true;
      removed += 1;
      return false;
    });
  }
  if (removed) {
    db.prepare("UPDATE app_settings SET value = ?, updated_at = ? WHERE key = 'access_control_json'")
      .run(JSON.stringify(config), updatedAt);
  }
  return removed;
}

export function deletedSubjectMarker(discordId, deletionKey) {
  return `deleted:${createHmac("sha256", deletionKey)
    .update(`discord:${String(discordId)}`)
    .digest("base64url")
    .slice(0, 22)}`;
}

export function deleteUserAccount(db, {
  userId,
  discordId,
  deletionKey,
  now = () => new Date(),
  randomUUID = cryptoRandomUUID,
  manageTransaction = true,
} = {}) {
  const deletedAt = now().toISOString();
  const receiptId = randomUUID();
  const emptyReceipt = {
    receiptId,
    deletedAt,
    deleted: {},
    anonymized: {},
  };
  const account = db.prepare("SELECT * FROM user_accounts WHERE id = ? AND discord_id = ?").get(userId, discordId);
  if (!account) return emptyReceipt;
  const anonymizedSubject = deletedSubjectMarker(account.discord_id, deletionKey);

  try {
    if (manageTransaction) db.exec("BEGIN IMMEDIATE");
    const current = db.prepare("SELECT * FROM user_accounts WHERE id = ? AND discord_id = ?").get(userId, discordId);
    if (!current) {
      if (manageTransaction) db.exec("COMMIT");
      return emptyReceipt;
    }
    const deleted = {};
    deleted.market_deal_alerts = count(db.prepare("DELETE FROM market_deal_alerts WHERE user_id = ?").run(userId));
    deleted.market_deal_watches = count(db.prepare("DELETE FROM market_deal_watches WHERE user_id = ?").run(userId));
    deleted.discord_craft_watches = count(db.prepare("DELETE FROM discord_craft_watches WHERE user_id = ?").run(discordId));
    deleted.discord_component_votes = count(db.prepare("DELETE FROM discord_component_votes WHERE user_id = ?").run(discordId));
    deleted.discord_warnings = count(db.prepare("DELETE FROM discord_warnings WHERE user_id = ?").run(discordId));
    deleted.discord_mod_notes = count(db.prepare("DELETE FROM discord_mod_notes WHERE user_id = ?").run(discordId));
    deleted.discord_temp_bans = count(db.prepare("DELETE FROM discord_temp_bans WHERE user_id = ?").run(discordId));
    deleted.user_legal_acceptances = count(db.prepare("DELETE FROM user_legal_acceptances WHERE user_id = ?").run(userId));
    deleted.user_sessions = count(db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId));
    const ownedPlanIds = db.prepare("SELECT id FROM craft_plans WHERE owner_user_id = ?").all(userId).map((row) => String(row.id));
    deleted.craft_plan_progress_audit_events = 0;
    deleted.craft_plan_progress_audit_snapshots = 0;
    deleted.craft_plan_progress_audit_state = 0;
    for (const planId of ownedPlanIds) {
      deleted.craft_plan_progress_audit_events += count(db.prepare("DELETE FROM craft_plan_progress_audit_events WHERE plan_id = ?").run(planId));
      deleted.craft_plan_progress_audit_snapshots += count(db.prepare("DELETE FROM craft_plan_progress_audit_snapshots WHERE plan_id = ?").run(planId));
      deleted.craft_plan_progress_audit_state += count(db.prepare("DELETE FROM craft_plan_progress_audit_state WHERE plan_id = ?").run(planId));
    }
    deleted.access_control_allowlist_entries = removeAccessControlAllowlistEntries(db, discordId, deletedAt);

    const anonymized = {
      discord_mod_cases: anonymizeModerationCases(db, current, anonymizedSubject),
      admin_audit_log: scrubAuditRows(db, current, anonymizedSubject),
      discord_delivery_log: scrubDeliveryRows(db, current),
    };
    deleted.user_accounts = count(db.prepare("DELETE FROM user_accounts WHERE id = ? AND discord_id = ?").run(userId, discordId));
    if (manageTransaction) db.exec("COMMIT");
    return { receiptId, deletedAt, deleted, anonymized };
  } catch (error) {
    if (manageTransaction) {
      try { db.exec("ROLLBACK"); } catch {}
    }
    throw error;
  }
}
