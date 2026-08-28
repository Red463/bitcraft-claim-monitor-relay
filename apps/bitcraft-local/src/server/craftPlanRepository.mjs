import { randomUUID as cryptoRandomUUID } from "node:crypto";

export const LEGACY_PRIMARY_PLAN_ID = "legacy-primary";
export const MAX_SHARED_CRAFT_PLANS = 20;
export const MAX_PERSONAL_CRAFT_PLANS = 10;

function problem(message, statusCode = 400, code = "craft_plan_invalid") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function json(value, fallback = {}) {
  try { return JSON.parse(String(value ?? "")); } catch { return fallback; }
}

function name(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 80) throw problem("Plan name must be between 1 and 80 characters");
  return normalized;
}

function sourceRules(value = {}) {
  return {
    storageContainerIds: Array.isArray(value.storageContainerIds) ? value.storageContainerIds.map(String) : [],
    playerIds: Array.isArray(value.playerIds) ? value.playerIds.map(String) : [],
    craftPlayerIds: Array.isArray(value.craftPlayerIds) ? value.craftPlayerIds.map(String) : [],
    bankPlayerIds: Array.isArray(value.bankPlayerIds) ? value.bankPlayerIds.map(String) : [],
    bankContainerIds: Array.isArray(value.bankContainerIds) ? value.bankContainerIds.map(String) : [],
    deployableContainerIds: Array.isArray(value.deployableContainerIds) ? value.deployableContainerIds.map(String) : [],
  };
}

function personalConfig(config, characterPlayerId) {
  const rules = sourceRules(config?.sourceRules);
  const playerId = String(characterPlayerId ?? "").trim();
  const allowedPlayer = (value) => playerId && String(value) === playerId;
  const filtered = {
    ...rules,
    playerIds: rules.playerIds.filter(allowedPlayer),
    craftPlayerIds: rules.craftPlayerIds.filter(allowedPlayer),
    bankPlayerIds: rules.bankPlayerIds.filter(allowedPlayer),
    bankContainerIds: rules.bankContainerIds.filter((value) => playerId && String(value).startsWith(`${playerId}:`)),
    deployableContainerIds: rules.deployableContainerIds.filter((value) => playerId && String(value).startsWith(`${playerId}:`)),
  };
  const changed = JSON.stringify(rules) !== JSON.stringify(filtered);
  return { config: { ...(config ?? {}), sourceRules: filtered }, changed };
}

function publicPlan(row) {
  if (!row) return null;
  const config = json(row.config_json);
  return {
    id: String(row.id),
    name: String(row.name),
    scope: String(row.scope),
    ownerUserId: row.owner_user_id == null ? null : Number(row.owner_user_id),
    primary: Boolean(row.is_primary),
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    config: { ...config, name: String(row.name) },
  };
}

function planSummary(row) {
  const { config: ignored, ...summary } = publicPlan(row);
  return summary;
}

export function applyCraftPlanRecordsMigration(db, { now = () => new Date().toISOString() } = {}) {
  const timestamp = now();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [table, column, definition] of [
      ["craft_plan_progress_audit_snapshots", "plan_id", "TEXT NOT NULL DEFAULT 'legacy-primary'"],
      ["craft_plan_progress_audit_events", "plan_id", "TEXT NOT NULL DEFAULT 'legacy-primary'"],
      ["craft_plan_progress_audit_state", "plan_id", "TEXT NOT NULL DEFAULT 'legacy-primary'"],
    ]) {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    const auditStatePrimaryKey = db.prepare("PRAGMA table_info(craft_plan_progress_audit_state)").all()
      .filter((entry) => Number(entry.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((entry) => entry.name);
    if (auditStatePrimaryKey.join(",") !== "claim_id,plan_id") {
      db.exec(`
        ALTER TABLE craft_plan_progress_audit_state RENAME TO craft_plan_progress_audit_state_legacy_plan_migration;
        CREATE TABLE craft_plan_progress_audit_state (
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
        INSERT INTO craft_plan_progress_audit_state (
          claim_id, plan_id, last_fingerprint, last_payload_gzip, last_snapshot_id,
          last_full_snapshot_at, last_success_at, last_failure_fingerprint, last_error, updated_at
        )
        SELECT claim_id, plan_id, last_fingerprint, last_payload_gzip, last_snapshot_id,
          last_full_snapshot_at, last_success_at, last_failure_fingerprint, last_error, updated_at
        FROM craft_plan_progress_audit_state_legacy_plan_migration;
        DROP TABLE craft_plan_progress_audit_state_legacy_plan_migration;
      `);
    }
    const count = Number(db.prepare("SELECT COUNT(*) AS count FROM craft_plans").get().count);
    if (!count) {
      const legacy = db.prepare("SELECT * FROM craft_plan_settings ORDER BY updated_at DESC LIMIT 1").get();
      const config = json(legacy?.config_json, {});
      const planName = String(config.name ?? "Settlement craft plan").trim().slice(0, 80) || "Settlement craft plan";
      delete config.name;
      db.prepare(`INSERT INTO craft_plans (id, name, scope, owner_user_id, is_primary, revision, config_json, created_at, updated_at)
        VALUES (?, ?, 'shared', NULL, 1, 1, ?, ?, ?)`)
        .run(LEGACY_PRIMARY_PLAN_ID, planName, JSON.stringify(config), legacy?.created_at ?? timestamp, legacy?.updated_at ?? timestamp);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createCraftPlanRepository(db, {
  randomUUID = cryptoRandomUUID,
  now = () => new Date().toISOString(),
  configAudit = null,
} = {}) {
  const row = (id) => db.prepare("SELECT * FROM craft_plans WHERE id = ?").get(String(id));
  const ownerCharacter = (ownerUserId) => db.prepare("SELECT character_player_id FROM user_accounts WHERE id = ? AND character_status = 'approved'").get(ownerUserId)?.character_player_id;
  const visible = (entry, subject = {}) => entry && (entry.scope === "shared" || subject.admin || Number(entry.owner_user_id) === Number(subject.userId));
  const requireRevision = (entry, expectedRevision) => {
    if (!Number.isInteger(Number(expectedRevision)) || Number(entry.revision) !== Number(expectedRevision)) throw problem("This plan changed since it was opened", 409, "craft_plan_revision_conflict");
  };
  const getVisible = (id, subject = {}) => {
    const entry = row(id);
    return visible(entry, subject) ? publicPlan(entry) : null;
  };
  const auditValue = (plan) => plan ? ({
    id: plan.id,
    name: plan.name,
    scope: plan.scope,
    ownerUserId: plan.ownerUserId,
    primary: plan.primary,
    config: plan.config,
  }) : null;
  const recordConfigAudit = (before, after, action, options, timestamp) => configAudit?.record({
    planId: after?.id ?? before?.id,
    claimId: options.claimId ?? null,
    actor: options.actor,
    occurredAt: timestamp,
    previousRevision: before?.revision ?? null,
    newRevision: after?.revision ?? before?.revision,
    action,
    before: auditValue(before),
    after: auditValue(after),
  });
  const createPersonal = ({ ownerUserId, name: requestedName, duplicateFromPlanId }, overrides = {}) => {
    const count = Number(db.prepare("SELECT COUNT(*) AS count FROM craft_plans WHERE scope = 'personal' AND owner_user_id = ?").get(ownerUserId).count);
    if (count >= MAX_PERSONAL_CRAFT_PLANS) throw problem(`Personal plans are limited to ${MAX_PERSONAL_CRAFT_PLANS}`, 409, "craft_plan_limit");
    const source = duplicateFromPlanId ? getVisible(duplicateFromPlanId, { userId: ownerUserId }) : null;
    if (duplicateFromPlanId && !source) throw problem("Craft plan not found", 404, "craft_plan_not_found");
    const sanitized = personalConfig(source?.config ?? { enabled: true, targets: [] }, ownerCharacter(ownerUserId));
    const timestamp = now();
    const id = (overrides.randomUUID ?? randomUUID)();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO craft_plans (id, name, scope, owner_user_id, is_primary, revision, config_json, created_at, updated_at)
        VALUES (?, ?, 'personal', ?, 0, 1, ?, ?, ?)`)
        .run(id, name(requestedName), ownerUserId, JSON.stringify({ ...sanitized.config, name: undefined }), timestamp, timestamp);
      const plan = publicPlan(row(id));
      recordConfigAudit(null, plan, "create", overrides, timestamp);
      db.exec("COMMIT");
      return { plan, warnings: sanitized.changed ? ["Character sources that do not belong to the plan owner were removed."] : [] };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const update = (id, changes, options = {}) => {
    const { expectedRevision, admin = false, userId = null } = options;
    const entry = row(id);
    if (!visible(entry, { admin, userId }) || (entry?.scope === "shared" && !admin)) throw problem("Craft plan not found", 404, "craft_plan_not_found");
    requireRevision(entry, expectedRevision);
    let config = changes.config ?? json(entry.config_json);
    if (entry.scope === "personal") {
      const sanitized = personalConfig(config, ownerCharacter(entry.owner_user_id));
      if (sanitized.changed) throw problem("Personal plans can only use the owner's verified character sources", 400, "craft_plan_source_forbidden");
      config = sanitized.config;
    }
    delete config.name;
    const timestamp = now();
    const before = publicPlan(entry);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE craft_plans SET name = ?, config_json = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(name(changes.name ?? entry.name), JSON.stringify(config), timestamp, entry.id);
      const after = publicPlan(row(entry.id));
      recordConfigAudit(before, after, "update", options, timestamp);
      db.exec("COMMIT");
      return after;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const remove = (id, { expectedRevision, admin = false, userId = null } = {}) => {
    const entry = row(id);
    if (!visible(entry, { admin, userId }) || (entry?.scope === "shared" && !admin)) throw problem("Craft plan not found", 404, "craft_plan_not_found");
    requireRevision(entry, expectedRevision);
    if (entry.is_primary) throw problem("Choose another primary shared plan before deleting this plan", 409, "craft_plan_primary_delete");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM craft_plan_progress_audit_events WHERE plan_id = ?").run(entry.id);
      db.prepare("DELETE FROM craft_plan_progress_audit_snapshots WHERE plan_id = ?").run(entry.id);
      db.prepare("DELETE FROM craft_plan_progress_audit_state WHERE plan_id = ?").run(entry.id);
      configAudit?.deleteForPlan(entry.id);
      db.prepare("DELETE FROM craft_plans WHERE id = ?").run(entry.id);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  return {
    primary: () => publicPlan(db.prepare("SELECT * FROM craft_plans WHERE is_primary = 1 LIMIT 1").get()),
    getVisible,
    getAdmin: (id) => publicPlan(row(id)),
    listVisible: ({ userId = null } = {}) => db.prepare("SELECT * FROM craft_plans WHERE scope = 'shared' OR owner_user_id = ? ORDER BY scope = 'personal', is_primary DESC, updated_at DESC").all(userId).map(planSummary),
    listAdmin: ({ scope = "", query = "" } = {}) => db.prepare("SELECT * FROM craft_plans WHERE (? = '' OR scope = ?) AND name LIKE ? ORDER BY is_primary DESC, updated_at DESC LIMIT 200").all(scope, scope, `%${query}%`).map(planSummary),
    createPersonal,
    createShared({ name: requestedName, duplicateFromPlanId }, options = {}) {
      const { admin = false } = options;
      if (!admin) throw problem("Administrator access required", 403, "admin_required");
      const count = Number(db.prepare("SELECT COUNT(*) AS count FROM craft_plans WHERE scope = 'shared'").get().count);
      if (count >= MAX_SHARED_CRAFT_PLANS) throw problem(`Shared plans are limited to ${MAX_SHARED_CRAFT_PLANS}`, 409, "craft_plan_limit");
      const source = duplicateFromPlanId ? publicPlan(row(duplicateFromPlanId)) : null;
      if (duplicateFromPlanId && !source) throw problem("Craft plan not found", 404, "craft_plan_not_found");
      const timestamp = now();
      const id = randomUUID();
      const config = { ...(source?.config ?? { enabled: true, targets: [] }) };
      delete config.name;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`INSERT INTO craft_plans (id, name, scope, owner_user_id, is_primary, revision, config_json, created_at, updated_at)
          VALUES (?, ?, 'shared', NULL, 0, 1, ?, ?, ?)`)
          .run(id, name(requestedName), JSON.stringify(config), timestamp, timestamp);
        const plan = publicPlan(row(id));
        recordConfigAudit(null, plan, "create", options, timestamp);
        db.exec("COMMIT");
        return plan;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    update,
    remove,
    setPrimary(id, options = {}) {
      const { expectedRevision, admin = false } = options;
      if (!admin) throw problem("Administrator access required", 403, "admin_required");
      const entry = row(id);
      if (!entry || entry.scope !== "shared") throw problem("Craft plan not found", 404, "craft_plan_not_found");
      requireRevision(entry, expectedRevision);
      if (entry.is_primary) return publicPlan(entry);
      const timestamp = now();
      const beforeTarget = publicPlan(entry);
      const previousPrimaryRow = db.prepare("SELECT * FROM craft_plans WHERE is_primary = 1 LIMIT 1").get();
      const beforePreviousPrimary = publicPlan(previousPrimaryRow);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE craft_plans SET is_primary = 0, revision = revision + 1, updated_at = ? WHERE is_primary = 1").run(timestamp);
        db.prepare("UPDATE craft_plans SET is_primary = 1, revision = revision + 1, updated_at = ? WHERE id = ?").run(timestamp, entry.id);
        recordConfigAudit(beforeTarget, publicPlan(row(entry.id)), "primary", options, timestamp);
        if (beforePreviousPrimary) recordConfigAudit(beforePreviousPrimary, publicPlan(row(beforePreviousPrimary.id)), "primary", options, timestamp);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return publicPlan(row(entry.id));
    },
  };
}
