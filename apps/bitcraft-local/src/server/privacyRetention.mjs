export const RETENTION = Object.freeze({
  userSessionsDays: 30,
  adminSessionsDays: 7,
  fullIpDays: 7,
  analyticsDays: 90,
  discordDeliveryDays: 90,
  discordDeliveryMaximumRows: 250,
  assignmentAuditDays: 365,
  marketAlertsDays: 180,
  inactiveAccountMonths: 24,
  inactiveWarningDays: 30,
  deletionLedgerDays: 90,
});

const DAY_MS = 24 * 60 * 60 * 1000;

function isoBefore(now, days) {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function calendarMonthsBefore(now, months) {
  const result = new Date(now);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

export function privacyRetentionPlan(now = new Date()) {
  const inactiveDelete = calendarMonthsBefore(now, RETENTION.inactiveAccountMonths);
  return {
    now: now.toISOString(),
    userSessions: isoBefore(now, RETENTION.userSessionsDays),
    adminSessions: isoBefore(now, RETENTION.adminSessionsDays),
    fullIp: isoBefore(now, RETENTION.fullIpDays),
    analytics: isoBefore(now, RETENTION.analyticsDays),
    discordDelivery: isoBefore(now, RETENTION.discordDeliveryDays),
    assignmentAudit: isoBefore(now, RETENTION.assignmentAuditDays),
    marketAlerts: isoBefore(now, RETENTION.marketAlertsDays),
    inactiveDelete: inactiveDelete.toISOString(),
    inactiveWarn: new Date(inactiveDelete.getTime() + RETENTION.inactiveWarningDays * DAY_MS).toISOString(),
  };
}

function rowCount(db, sql, ...params) {
  return Number(db.prepare(sql).get(...params)?.count ?? 0);
}

function deleteCount(db, sql, ...params) {
  return Number(db.prepare(sql).run(...params).changes);
}

export async function runPrivacyRetention(db, {
  now = new Date(),
  dryRun = false,
  deleteInactiveAccount = async () => undefined,
  sendInactiveWarning = async () => undefined,
} = {}) {
  const plan = privacyRetentionPlan(now);
  const counts = {
    user_sessions: rowCount(db, "SELECT COUNT(*) AS count FROM user_sessions WHERE expires_at < ?", plan.now),
    admin_sessions: rowCount(db, "SELECT COUNT(*) AS count FROM admin_sessions WHERE expires_at < ?", plan.now),
    market_deal_alerts: rowCount(db, "SELECT COUNT(*) AS count FROM market_deal_alerts WHERE created_at < ?", plan.marketAlerts),
    analytics_events: rowCount(db, "SELECT COUNT(*) AS count FROM analytics_events WHERE occurred_at < ?", plan.analytics),
    discord_delivery_log: rowCount(db, "SELECT COUNT(*) AS count FROM discord_delivery_log WHERE occurred_at < ?", plan.discordDelivery),
    admin_audit_log: rowCount(db, "SELECT COUNT(*) AS count FROM admin_audit_log WHERE occurred_at < ?", plan.assignmentAudit),
    discord_component_votes: rowCount(db, "SELECT COUNT(*) AS count FROM discord_component_votes WHERE updated_at < ?", plan.analytics),
    visitor_security_full_ip: rowCount(db, "SELECT COUNT(*) AS count FROM visitor_security_events WHERE occurred_at < ? AND ip_address <> ''", plan.fullIp),
  };
  const inactive = db.prepare(`
    SELECT id, discord_id AS discordId, discord_username AS username,
      COALESCE(last_login_at, created_at) AS inactiveSince,
      inactivity_warning_sent_at AS warningSentAt
    FROM user_accounts
    WHERE COALESCE(last_login_at, created_at) <= ?
    ORDER BY id
  `).all(plan.inactiveWarn);
  const toDelete = inactive.filter((account) => String(account.inactiveSince) <= plan.inactiveDelete);
  const toWarn = inactive.filter((account) => String(account.inactiveSince) > plan.inactiveDelete && !account.warningSentAt);
  counts.inactive_accounts = toDelete.length;
  counts.inactivity_warnings = toWarn.length;
  if (dryRun) return { dryRun: true, plan, counts };

  counts.user_sessions = deleteCount(db, "DELETE FROM user_sessions WHERE expires_at < ?", plan.now);
  counts.admin_sessions = deleteCount(db, "DELETE FROM admin_sessions WHERE expires_at < ?", plan.now);
  counts.market_deal_alerts = deleteCount(db, "DELETE FROM market_deal_alerts WHERE created_at < ?", plan.marketAlerts);
  counts.analytics_events = deleteCount(db, "DELETE FROM analytics_events WHERE occurred_at < ?", plan.analytics);
  counts.discord_delivery_log = deleteCount(db, "DELETE FROM discord_delivery_log WHERE occurred_at < ?", plan.discordDelivery);
  const overflow = db.prepare("SELECT id FROM discord_delivery_log ORDER BY occurred_at DESC, id DESC LIMIT -1 OFFSET ?")
    .all(RETENTION.discordDeliveryMaximumRows);
  if (overflow.length) {
    const remove = db.prepare("DELETE FROM discord_delivery_log WHERE id = ?");
    for (const row of overflow) counts.discord_delivery_log += Number(remove.run(row.id).changes);
  }
  counts.admin_audit_log = deleteCount(db, "DELETE FROM admin_audit_log WHERE occurred_at < ?", plan.assignmentAudit);
  counts.discord_component_votes = deleteCount(db, "DELETE FROM discord_component_votes WHERE updated_at < ?", plan.analytics);
  counts.visitor_security_full_ip = Number(db.prepare(`
    UPDATE visitor_security_events SET ip_address = ''
    WHERE occurred_at < ? AND ip_address <> ''
  `).run(plan.fullIp).changes);

  const warnings = [];
  for (const account of toWarn) {
    let delivered = true;
    try {
      await sendInactiveWarning(account);
    } catch {
      delivered = false;
    }
    db.prepare("UPDATE user_accounts SET inactivity_warning_sent_at = ? WHERE id = ?").run(plan.now, account.id);
    warnings.push({ userId: account.id, delivered });
  }
  const deletions = [];
  for (const account of toDelete) {
    try {
      await deleteInactiveAccount(account);
      deletions.push({ userId: account.id, deleted: true });
    } catch (error) {
      deletions.push({ userId: account.id, deleted: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { dryRun: false, plan, counts, warnings, deletions };
}
