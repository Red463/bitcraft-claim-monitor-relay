import { createHmac, randomBytes as cryptoRandomBytes, timingSafeEqual } from "node:crypto";

import {
  collectRecipeDetails,
  compactCraftPlanResponse,
  computeCraftPlan,
} from "../craftPlanning.mjs";

const MAX_UNSIGNED_64 = 18_446_744_073_709_551_615n;
const MAX_PUBLIC_PLAN_BYTES = 256 * 1024;
const MAX_PUBLIC_PLAN_TARGETS = 100;
const MAX_PUBLIC_PLAN_MULTIPLIER = 20;

export class PublicPlanError extends Error {
  constructor(message, status = 400, code = "public_plan_invalid") {
    super(message);
    this.name = "PublicPlanError";
    this.status = status;
    this.code = code;
  }
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PublicPlanError(`${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new PublicPlanError(`${label} contains unsupported fields.`);
}

function decimalString(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new PublicPlanError(`${label} must be a canonical decimal string.`);
  }
  const number = BigInt(value);
  if (number > MAX_UNSIGNED_64 || (positive && number === 0n)) {
    throw new PublicPlanError(`${label} is outside the supported decimal range.`);
  }
  return value;
}

function stringRecord(value, label, project) {
  const source = record(value, label);
  return Object.fromEntries(Object.entries(source).map(([key, child]) => [String(key), project(child, key)]));
}

function normalizePlainText(value, label, { maxLength = 80, allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new PublicPlanError(`Public plan ${label} must be plain text.`);
  const normalized = value.normalize("NFKC").trim();
  if ((!allowEmpty && !normalized) || [...normalized].length > maxLength || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(normalized)) {
    throw new PublicPlanError(`Public plan ${label} must contain ${allowEmpty ? "plain text" : `1-${maxLength} plain-text characters`}.`);
  }
  return normalized;
}

export function normalizePublicPlanLabel(value, label = "label") {
  return normalizePlainText(value, label);
}

export function normalizePublicCraftPlanDocument(input) {
  const source = record(input, "Public plan document");
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(source), "utf8");
  } catch {
    throw new PublicPlanError("Public plan document must be JSON serializable.");
  }
  if (bytes > MAX_PUBLIC_PLAN_BYTES) throw new PublicPlanError("Public plan document exceeds 256 KiB.", 413);
  exactKeys(source, new Set([
    "schemaVersion",
    "targets",
    "routeOverrides",
    "multipliers",
    "sectionOverrides",
    "rowNameOverrides",
  ]), "Public plan document");
  if (source.schemaVersion !== 1) throw new PublicPlanError("Public plan schemaVersion must be 1.");
  if (!Array.isArray(source.targets)) throw new PublicPlanError("Public plan targets must be an array.");
  if (source.targets.length > MAX_PUBLIC_PLAN_TARGETS) throw new PublicPlanError("Public plan documents support at most 100 targets.", 413);
  const targets = source.targets.map((value, index) => {
    const target = record(value, `Public plan target ${index}`);
    exactKeys(target, new Set(["catalogKey", "quantity"]), `Public plan target ${index}`);
    const match = /^(items|cargo):(.+)$/.exec(String(target.catalogKey ?? ""));
    if (!match) throw new PublicPlanError(`Public plan target ${index} has an invalid catalog key.`);
    const id = decimalString(match[2], `Public plan target ${index} catalog id`);
    return {
      catalogKey: `${match[1]}:${id}`,
      quantity: decimalString(target.quantity, `Public plan target ${index} quantity`, { positive: true }),
    };
  });
  const routeOverrides = stringRecord(source.routeOverrides, "Public plan routeOverrides", (value) => normalizePublicPlanLabel(value, "route override"));
  const multipliers = stringRecord(source.multipliers, "Public plan multipliers", (value, key) => {
    const multiplier = record(value, `Public plan multiplier ${key}`);
    exactKeys(multiplier, new Set(["multiplier", "note"]), `Public plan multiplier ${key}`);
    if (typeof multiplier.multiplier !== "number"
      || !Number.isFinite(multiplier.multiplier)
      || multiplier.multiplier < 1
      || multiplier.multiplier > MAX_PUBLIC_PLAN_MULTIPLIER) {
      throw new PublicPlanError(`Public plan multiplier ${key} must be a finite number from 1 through ${MAX_PUBLIC_PLAN_MULTIPLIER}.`);
    }
    return {
      multiplier: multiplier.multiplier,
      ...(multiplier.note == null ? {} : { note: normalizePlainText(multiplier.note, "multiplier note", { maxLength: MAX_PUBLIC_PLAN_BYTES, allowEmpty: true }) }),
    };
  });
  const sectionOverrides = stringRecord(source.sectionOverrides, "Public plan sectionOverrides", (value) => normalizePublicPlanLabel(value, "section override"));
  const rowNameOverrides = stringRecord(source.rowNameOverrides, "Public plan rowNameOverrides", (value) => normalizePublicPlanLabel(value, "row name"));
  return { schemaVersion: 1, targets, routeOverrides, multipliers, sectionOverrides, rowNameOverrides };
}

function transaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function generatedId(prefix, randomBytes) {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

export function publicPlanTokenHash(token, key) {
  return createHmac("sha256", String(key)).update(String(token)).digest("hex");
}

function planView(row) {
  if (!row) return null;
  let document;
  try {
    document = normalizePublicCraftPlanDocument(JSON.parse(String(row.document_json)));
  } catch {
    throw new PublicPlanError("Stored public plan document is invalid.", 503, "stored_document_invalid");
  }
  return {
    id: String(row.id),
    claimId: String(row.claim_id),
    title: String(row.title),
    status: String(row.status),
    role: String(row.role),
    document,
    revisions: { document: Number(row.document_revision), access: Number(row.access_revision) },
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createPublicPlanRepository(db, {
  now = () => new Date(),
  randomBytes = cryptoRandomBytes,
  tokenHmacKey,
} = {}) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("Public plan repository requires SQLite.");
  if (!String(tokenHmacKey ?? "")) throw new TypeError("Public plan repository requires PUBLIC_PLAN_TOKEN_HMAC_KEY.");
  const hmacKey = String(tokenHmacKey);

  const accessiblePlan = db.prepare(`
    SELECT plan.*,
      CASE WHEN plan.owner_user_id = ? THEN 'owner' ELSE member.role END AS role
    FROM public_craft_plans AS plan
    LEFT JOIN public_craft_plan_members AS member
      ON member.plan_id = plan.id AND member.user_id = ?
    WHERE plan.id = ? AND (plan.owner_user_id = ? OR member.user_id IS NOT NULL)
  `);

  function accessiblePlanRow(planId, userId) {
    return accessiblePlan.get(userId, userId, String(planId), userId) ?? null;
  }

  function planForUser(planId, userId) {
    const row = accessiblePlanRow(planId, userId);
    if (row && String(row.status) === "suspended") {
      throw new PublicPlanError("Public plan is suspended.", 423, "plan_suspended");
    }
    return planView(row);
  }

  function addEvent(planId, actorUserId, eventType, payload, createdAt) {
    db.prepare(`
      INSERT INTO public_craft_plan_events (plan_id, actor_user_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(planId), actorUserId ?? null, String(eventType), JSON.stringify(payload ?? {}), createdAt);
  }

  function tokenHash(token) {
    return publicPlanTokenHash(token, hmacKey);
  }

  function tokenMatches(token, expectedHash) {
    const supplied = Buffer.from(tokenHash(token), "hex");
    const expected = Buffer.from(String(expectedHash ?? ""), "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  function invitationForToken(inviteId, token, currentTime) {
    const invite = db.prepare(`
      SELECT invite.*, plan.owner_user_id, plan.document_revision, plan.access_revision, plan.status
      FROM public_craft_plan_invites AS invite
      JOIN public_craft_plans AS plan ON plan.id = invite.plan_id
      WHERE invite.id = ?
    `).get(String(inviteId));
    if (!invite || !tokenMatches(token, invite.token_hash) || invite.accepted_at || invite.revoked_at) {
      throw new PublicPlanError("Public plan invitation was not found.", 404, "invite_not_found");
    }
    if (String(invite.expires_at) <= currentTime) {
      throw new PublicPlanError("Public plan invitation has expired.", 410, "invite_expired");
    }
    return invite;
  }

  function requireExpectedRevision(plan, expectedRevision, kind = "access") {
    if (expectedRevision == null || expectedRevision === "") {
      throw new PublicPlanError("If-Match is required for public plan mutations.", 428, "revision_required");
    }
    const current = Number(plan[`${kind}_revision`]);
    if (!Number.isInteger(Number(expectedRevision)) || Number(expectedRevision) !== current) {
      const error = new PublicPlanError("Public plan revision conflict.", 409, "revision_conflict");
      error.currentRevisions = {
        document: Number(plan.document_revision),
        access: Number(plan.access_revision),
      };
      throw error;
    }
  }

  function ownerPlan(planId, actorUserId) {
    const plan = db.prepare("SELECT * FROM public_craft_plans WHERE id = ? AND owner_user_id = ?")
      .get(String(planId), actorUserId);
    if (!plan) throw new PublicPlanError("Public plan was not found.", 404, "plan_not_found");
    return plan;
  }

  function requireMutablePlan(plan) {
    if (String(plan.status) === "archived") {
      throw new PublicPlanError("Archived public plans are immutable until unarchived.", 423, "plan_archived");
    }
    if (String(plan.status) === "suspended") {
      throw new PublicPlanError("Public plan is suspended.", 423, "plan_suspended");
    }
  }

  function requireEditorPlan(planId, actorUserId) {
    const plan = accessiblePlanRow(planId, actorUserId);
    if (!plan) throw new PublicPlanError("Public plan was not found.", 404, "plan_not_found");
    if (plan.role !== "owner" && plan.role !== "editor") {
      throw new PublicPlanError("Public plan editor access is required.", 403, "editor_required");
    }
    return plan;
  }

  function revisions(planId) {
    const row = db.prepare("SELECT document_revision, access_revision FROM public_craft_plans WHERE id = ?").get(String(planId));
    return { document: Number(row.document_revision), access: Number(row.access_revision) };
  }

  return Object.freeze({
    createPlan({ ownerUserId, claimId, title, document }) {
      const normalizedClaimId = decimalString(claimId, "Public plan claim id");
      const normalizedTitle = normalizePublicPlanLabel(title, "title");
      const normalizedDocument = normalizePublicCraftPlanDocument(document);
      const createdAt = now().toISOString();
      return transaction(db, () => {
        const counts = db.prepare(`
          SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
          FROM public_craft_plans WHERE owner_user_id = ?
        `).get(ownerUserId);
        if (Number(counts.total) >= 100) throw new PublicPlanError("Public plan total quota reached.", 409, "total_plan_quota");
        if (Number(counts.active ?? 0) >= 20) throw new PublicPlanError("Public plan active quota reached.", 409, "active_plan_quota");
        const id = generatedId("plan", randomBytes);
        db.prepare(`
          INSERT INTO public_craft_plans (
            id, owner_user_id, claim_id, title, document_json, status,
            document_revision, access_revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', 1, 1, ?, ?)
        `).run(id, ownerUserId, normalizedClaimId, normalizedTitle, JSON.stringify(normalizedDocument), createdAt, createdAt);
        addEvent(id, ownerUserId, "plan.created", { claimId: normalizedClaimId, title: normalizedTitle }, createdAt);
        return planForUser(id, ownerUserId);
      });
    },
    planForUser,
    listPlans(userId) {
      return db.prepare(`
        SELECT plan.*,
          CASE WHEN plan.owner_user_id = ? THEN 'owner' ELSE member.role END AS role
        FROM public_craft_plans AS plan
        LEFT JOIN public_craft_plan_members AS member
          ON member.plan_id = plan.id AND member.user_id = ?
        WHERE plan.status <> 'suspended'
          AND (plan.owner_user_id = ? OR member.user_id IS NOT NULL)
        ORDER BY plan.updated_at DESC, plan.id
      `).all(userId, userId, userId).map(planView);
    },
    planDetailsForUser(planId, userId) {
      const plan = planForUser(planId, userId);
      if (!plan || (plan.role !== "owner" && plan.role !== "editor")) return plan;
      const members = db.prepare(`
        SELECT member.user_id, member.role, member.created_at, member.updated_at,
          account.discord_username, account.discord_global_name
        FROM public_craft_plan_members AS member
        JOIN public_user_accounts AS account ON account.id = member.user_id
        WHERE member.plan_id = ? ORDER BY member.created_at, member.user_id
      `).all(String(planId)).map((member) => ({
        userId: Number(member.user_id),
        role: String(member.role),
        username: String(member.discord_username ?? ""),
        globalName: String(member.discord_global_name ?? ""),
        createdAt: String(member.created_at),
        updatedAt: String(member.updated_at),
      }));
      const access = { members };
      if (plan.role === "owner") {
        const currentTime = now().toISOString();
        access.invites = db.prepare(`
          SELECT id, role, expires_at, created_at
          FROM public_craft_plan_invites
          WHERE plan_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
          ORDER BY created_at, id
        `).all(String(planId), currentTime).map((invite) => ({
          id: String(invite.id),
          role: String(invite.role),
          expiresAt: String(invite.expires_at),
          createdAt: String(invite.created_at),
        }));
        access.shareLinks = db.prepare(`
          SELECT id, label, created_at
          FROM public_craft_plan_share_links
          WHERE plan_id = ? AND revoked_at IS NULL
          ORDER BY created_at, id
        `).all(String(planId)).map((link) => ({
          id: String(link.id),
          label: String(link.label),
          createdAt: String(link.created_at),
        }));
      }
      return { ...plan, access };
    },
    eventsForUser(planId, userId) {
      const plan = planForUser(planId, userId);
      if (!plan) throw new PublicPlanError("Public plan was not found.", 404, "plan_not_found");
      const rows = db.prepare(`
        SELECT event.id, event.event_type, event.payload_json, event.created_at,
          event.actor_deleted_marker IS NOT NULL AS actor_deleted,
          account.id AS actor_user_id, account.discord_username, account.discord_global_name
        FROM public_craft_plan_events AS event
        LEFT JOIN public_user_accounts AS account ON account.id = event.actor_user_id
        WHERE event.plan_id = ? ORDER BY event.created_at DESC, event.id DESC
      `).all(String(planId));
      if (plan.role === "viewer") {
        return rows.map((event) => ({
          id: Number(event.id),
          type: String(event.event_type),
          createdAt: String(event.created_at),
        }));
      }
      return rows.map((event) => {
        let payload = {};
        try {
          const parsed = JSON.parse(String(event.payload_json));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
        } catch {
          payload = {};
        }
        return {
          id: Number(event.id),
          type: String(event.event_type),
          createdAt: String(event.created_at),
          actor: event.actor_user_id == null
            ? Number(event.actor_deleted) === 1 ? { deleted: true } : null
            : {
              userId: Number(event.actor_user_id),
              username: String(event.discord_username ?? ""),
              globalName: String(event.discord_global_name ?? ""),
            },
          payload,
        };
      });
    },
    updateDocument({ planId, actorUserId, document, expectedDocumentRevision }) {
      const normalizedDocument = normalizePublicCraftPlanDocument(document);
      return transaction(db, () => {
        const plan = requireEditorPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedDocumentRevision, "document");
        requireMutablePlan(plan);
        const updatedAt = now().toISOString();
        db.prepare(`
          UPDATE public_craft_plans
          SET document_json = ?, document_revision = document_revision + 1, updated_at = ?
          WHERE id = ?
        `).run(JSON.stringify(normalizedDocument), updatedAt, String(planId));
        addEvent(planId, actorUserId, "document.updated", {}, updatedAt);
        return planForUser(planId, actorUserId);
      });
    },
    updateStatus({ planId, actorUserId, status, expectedAccessRevision }) {
      const normalizedStatus = String(status);
      if (normalizedStatus === "suspended") {
        throw new PublicPlanError("Only Claim Monitor administrators can suspend public plans.", 403, "moderation_required");
      }
      if (!new Set(["active", "archived"]).has(normalizedStatus)) {
        throw new PublicPlanError("Public plan status must be active or archived.");
      }
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        if (String(plan.status) === "suspended") {
          throw new PublicPlanError("Public plan is suspended.", 423, "plan_suspended");
        }
        if (String(plan.status) === "archived" && normalizedStatus !== "active") {
          throw new PublicPlanError("Archived public plans must be unarchived before other changes.", 423, "plan_archived");
        }
        if (String(plan.status) === normalizedStatus) {
          throw new PublicPlanError("Public plan already has that status.", 409, "status_unchanged");
        }
        if (normalizedStatus === "active" && String(plan.status) !== "active") {
          const active = Number(db.prepare(`
            SELECT COUNT(*) AS count FROM public_craft_plans
            WHERE owner_user_id = ? AND status = 'active' AND id <> ?
          `).get(actorUserId, String(planId)).count);
          if (active >= 20) throw new PublicPlanError("Public plan active quota reached.", 409, "active_plan_quota");
        }
        const updatedAt = now().toISOString();
        db.prepare(`
          UPDATE public_craft_plans SET status = ?, access_revision = access_revision + 1, updated_at = ? WHERE id = ?
        `).run(normalizedStatus, updatedAt, String(planId));
        addEvent(planId, actorUserId, `plan.${normalizedStatus}`, {}, updatedAt);
        return planView({ ...db.prepare("SELECT * FROM public_craft_plans WHERE id = ?").get(String(planId)), role: "owner" });
      });
    },
    updateMember({ planId, actorUserId, userId, role, expectedAccessRevision }) {
      const normalizedRole = String(role);
      if (normalizedRole !== "editor" && normalizedRole !== "viewer") {
        throw new PublicPlanError("Public plan member role must be editor or viewer.");
      }
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        requireMutablePlan(plan);
        const updatedAt = now().toISOString();
        const changed = db.prepare(`
          UPDATE public_craft_plan_members SET role = ?, updated_at = ?
          WHERE plan_id = ? AND user_id = ?
        `).run(normalizedRole, updatedAt, String(planId), userId);
        if (Number(changed.changes) !== 1) throw new PublicPlanError("Public plan member was not found.", 404, "member_not_found");
        db.prepare("UPDATE public_craft_plans SET access_revision = access_revision + 1, updated_at = ? WHERE id = ?")
          .run(updatedAt, String(planId));
        addEvent(planId, actorUserId, "member.updated", { userId: Number(userId), role: normalizedRole }, updatedAt);
        return { ok: true, revisions: revisions(planId) };
      });
    },
    removeMember({ planId, actorUserId, userId, expectedAccessRevision }) {
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        requireMutablePlan(plan);
        const updatedAt = now().toISOString();
        const removed = db.prepare("DELETE FROM public_craft_plan_members WHERE plan_id = ? AND user_id = ?")
          .run(String(planId), userId);
        if (Number(removed.changes) !== 1) throw new PublicPlanError("Public plan member was not found.", 404, "member_not_found");
        db.prepare("UPDATE public_craft_plans SET access_revision = access_revision + 1, updated_at = ? WHERE id = ?")
          .run(updatedAt, String(planId));
        addEvent(planId, actorUserId, "member.removed", { userId: Number(userId) }, updatedAt);
        return { ok: true, revisions: revisions(planId) };
      });
    },
    transferPlan({ planId, actorUserId, userId, expectedAccessRevision }) {
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        requireMutablePlan(plan);
        const member = db.prepare("SELECT role FROM public_craft_plan_members WHERE plan_id = ? AND user_id = ?")
          .get(String(planId), userId);
        if (member?.role !== "editor") {
          throw new PublicPlanError("Public plan ownership can transfer only to an accepted editor.", 409, "transfer_requires_editor");
        }
        const recipientCounts = db.prepare(`
          SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
          FROM public_craft_plans WHERE owner_user_id = ?
        `).get(userId);
        if (Number(recipientCounts.total) >= 100) {
          throw new PublicPlanError("Public plan total quota reached.", 409, "total_plan_quota");
        }
        if (String(plan.status) === "active" && Number(recipientCounts.active ?? 0) >= 20) {
          throw new PublicPlanError("Public plan active quota reached.", 409, "active_plan_quota");
        }
        const updatedAt = now().toISOString();
        db.prepare("DELETE FROM public_craft_plan_members WHERE plan_id = ? AND user_id = ?").run(String(planId), userId);
        db.prepare(`
          INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at)
          VALUES (?, ?, 'editor', ?, ?)
        `).run(String(planId), actorUserId, updatedAt, updatedAt);
        db.prepare(`
          UPDATE public_craft_plans
          SET owner_user_id = ?, access_revision = access_revision + 1, updated_at = ?
          WHERE id = ?
        `).run(userId, updatedAt, String(planId));
        addEvent(planId, actorUserId, "plan.transferred", { previousOwnerUserId: Number(actorUserId), ownerUserId: Number(userId) }, updatedAt);
        return planForUser(planId, userId);
      });
    },
    clonePlan({ planId, actorUserId, title, expectedAccessRevision }) {
      return transaction(db, () => {
        const source = requireEditorPlan(planId, actorUserId);
        requireExpectedRevision(source, expectedAccessRevision);
        if (String(source.status) === "suspended") throw new PublicPlanError("Public plan is suspended.", 423, "plan_suspended");
        const cloneTitle = normalizePublicPlanLabel(title ?? `${source.title} copy`, "title");
        const counts = db.prepare(`
          SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
          FROM public_craft_plans WHERE owner_user_id = ?
        `).get(actorUserId);
        if (Number(counts.total) >= 100) throw new PublicPlanError("Public plan total quota reached.", 409, "total_plan_quota");
        if (Number(counts.active ?? 0) >= 20) throw new PublicPlanError("Public plan active quota reached.", 409, "active_plan_quota");
        const id = generatedId("plan", randomBytes);
        const createdAt = now().toISOString();
        db.prepare(`
          INSERT INTO public_craft_plans (
            id, owner_user_id, claim_id, title, document_json, status,
            document_revision, access_revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', 1, 1, ?, ?)
        `).run(id, actorUserId, String(source.claim_id), cloneTitle, String(source.document_json), createdAt, createdAt);
        addEvent(id, actorUserId, "plan.cloned", { sourcePlanId: String(planId) }, createdAt);
        return planForUser(id, actorUserId);
      });
    },
    deletePlan({ planId, actorUserId, expectedAccessRevision }) {
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        requireMutablePlan(plan);
        db.prepare("DELETE FROM public_craft_plans WHERE id = ?").run(String(planId));
        return { ok: true };
      });
    },
    createInvite({ planId, actorUserId, role, expectedAccessRevision }) {
      const normalizedRole = String(role);
      if (normalizedRole !== "editor" && normalizedRole !== "viewer") {
        throw new PublicPlanError("Public plan invite role must be editor or viewer.");
      }
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        requireMutablePlan(plan);
        const createdAt = now().toISOString();
        const outstanding = Number(db.prepare(`
          SELECT COUNT(*) AS count FROM public_craft_plan_invites
          WHERE plan_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
        `).get(String(planId), createdAt).count);
        if (outstanding >= 10) throw new PublicPlanError("Public plan outstanding invite quota reached.", 409, "invite_quota");
        const id = generatedId("invite", randomBytes);
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(now().getTime() + (7 * 24 * 60 * 60 * 1000)).toISOString();
        db.prepare(`
          INSERT INTO public_craft_plan_invites (
            id, plan_id, created_by_user_id, role, token_hash, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, String(planId), actorUserId, normalizedRole, tokenHash(token), expiresAt, createdAt);
        db.prepare(`
          UPDATE public_craft_plans SET access_revision = access_revision + 1, updated_at = ? WHERE id = ?
        `).run(createdAt, String(planId));
        addEvent(planId, actorUserId, "invite.created", { inviteId: id, role: normalizedRole, expiresAt }, createdAt);
        return { id, planId: String(planId), role: normalizedRole, expiresAt, token, revisions: revisions(planId) };
      });
    },
    revokeInvite({ planId, inviteId, actorUserId, expectedAccessRevision }) {
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        requireMutablePlan(plan);
        const revokedAt = now().toISOString();
        const updated = db.prepare(`
          UPDATE public_craft_plan_invites SET revoked_at = ?
          WHERE id = ? AND plan_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
        `).run(revokedAt, String(inviteId), String(planId));
        if (Number(updated.changes) !== 1) throw new PublicPlanError("Public plan invitation was not found.", 404, "invite_not_found");
        db.prepare("UPDATE public_craft_plans SET access_revision = access_revision + 1, updated_at = ? WHERE id = ?")
          .run(revokedAt, String(planId));
        addEvent(planId, actorUserId, "invite.revoked", { inviteId: String(inviteId) }, revokedAt);
        return { ok: true, revisions: revisions(planId) };
      });
    },
    createShareLink({ planId, actorUserId, label, expectedAccessRevision }) {
      const normalizedLabel = normalizePublicPlanLabel(label, "share label");
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        requireMutablePlan(plan);
        const createdAt = now().toISOString();
        const active = Number(db.prepare(`
          SELECT COUNT(*) AS count FROM public_craft_plan_share_links
          WHERE plan_id = ? AND revoked_at IS NULL
        `).get(String(planId)).count);
        if (active >= 5) throw new PublicPlanError("Public plan share-link quota reached.", 409, "share_link_quota");
        const id = generatedId("share", randomBytes);
        const token = randomBytes(32).toString("base64url");
        db.prepare(`
          INSERT INTO public_craft_plan_share_links (
            id, plan_id, created_by_user_id, label, token_hash, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, String(planId), actorUserId, normalizedLabel, tokenHash(token), createdAt);
        db.prepare("UPDATE public_craft_plans SET access_revision = access_revision + 1, updated_at = ? WHERE id = ?")
          .run(createdAt, String(planId));
        addEvent(planId, actorUserId, "share.created", { shareId: id, label: normalizedLabel }, createdAt);
        return { id, planId: String(planId), label: normalizedLabel, token, revisions: revisions(planId) };
      });
    },
    revokeShareLink({ planId, shareId, actorUserId, expectedAccessRevision }) {
      return transaction(db, () => {
        const plan = ownerPlan(planId, actorUserId);
        requireExpectedRevision(plan, expectedAccessRevision);
        requireMutablePlan(plan);
        const revokedAt = now().toISOString();
        const updated = db.prepare(`
          UPDATE public_craft_plan_share_links SET revoked_at = ?
          WHERE id = ? AND plan_id = ? AND revoked_at IS NULL
        `).run(revokedAt, String(shareId), String(planId));
        if (Number(updated.changes) !== 1) throw new PublicPlanError("Public plan share link was not found.", 404, "share_not_found");
        db.prepare("UPDATE public_craft_plans SET access_revision = access_revision + 1, updated_at = ? WHERE id = ?")
          .run(revokedAt, String(planId));
        addEvent(planId, actorUserId, "share.revoked", { shareId: String(shareId) }, revokedAt);
        return { ok: true, revisions: revisions(planId) };
      });
    },
    planForShare(planId, token) {
      const row = db.prepare(`
        SELECT plan.*, link.token_hash
        FROM public_craft_plan_share_links AS link
        JOIN public_craft_plans AS plan ON plan.id = link.plan_id
        WHERE link.plan_id = ? AND link.revoked_at IS NULL
      `).all(String(planId)).find((candidate) => tokenMatches(token, candidate.token_hash));
      if (!row || String(row.status) === "suspended") {
        throw new PublicPlanError("Public plan was not found.", 404, "plan_not_found");
      }
      return planView({ ...row, role: "bearer" });
    },
    inviteAccessRevision({ inviteId, token }) {
      const invite = invitationForToken(inviteId, token, now().toISOString());
      return Number(invite.access_revision);
    },
    acceptInvite({ inviteId, userId, token, expectedAccessRevision }) {
      return transaction(db, () => {
        const acceptedAt = now().toISOString();
        const invite = invitationForToken(inviteId, token, acceptedAt);
        requireExpectedRevision(invite, expectedAccessRevision);
        requireMutablePlan(invite);
        if (Number(invite.owner_user_id) === Number(userId)) {
          throw new PublicPlanError("The public plan owner cannot accept a collaborator invitation.", 409, "owner_already_has_access");
        }
        const existing = db.prepare("SELECT role FROM public_craft_plan_members WHERE plan_id = ? AND user_id = ?")
          .get(String(invite.plan_id), userId);
        const collaborators = Number(db.prepare("SELECT COUNT(*) AS count FROM public_craft_plan_members WHERE plan_id = ?")
          .get(String(invite.plan_id)).count);
        if (!existing && collaborators >= 10) {
          throw new PublicPlanError("Public plan collaborator quota reached.", 409, "collaborator_quota");
        }
        db.prepare(`
          INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(plan_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
        `).run(String(invite.plan_id), userId, String(invite.role), acceptedAt, acceptedAt);
        const accepted = db.prepare(`
          UPDATE public_craft_plan_invites SET accepted_at = ?, accepted_by_user_id = ?
          WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL
        `).run(acceptedAt, userId, String(inviteId));
        if (Number(accepted.changes) !== 1) throw new PublicPlanError("Public plan invitation was not found.", 404, "invite_not_found");
        db.prepare("UPDATE public_craft_plans SET access_revision = access_revision + 1, updated_at = ? WHERE id = ?")
          .run(acceptedAt, String(invite.plan_id));
        addEvent(invite.plan_id, userId, "invite.accepted", { inviteId: String(inviteId), role: String(invite.role) }, acceptedAt);
        return planForUser(invite.plan_id, userId);
      });
    },
  });
}

function safePlannerInteger(value) {
  const normalized = typeof value === "string" ? value : "";
  if (!/^(?:0|[1-9]\d*)$/.test(normalized)) return null;
  const integer = BigInt(normalized);
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : null;
}

function computationUnavailable(document, message = "Public plan computation is unavailable until current claim and catalog data can be read safely.") {
  return {
    available: false,
    document,
    warnings: [{ code: "public_plan_computation_unavailable", message }],
  };
}

function publicPlanTargets(document) {
  const targets = [];
  for (const target of document.targets) {
    const quantity = safePlannerInteger(target.quantity);
    if (quantity == null || quantity <= 0) return null;
    const [kind, id] = target.catalogKey.split(":", 2);
    targets.push({
      id,
      kind,
      itemType: kind === "cargo" ? 1 : 0,
      name: `${kind === "cargo" ? "Cargo" : "Item"} #${id}`,
      quantity,
    });
  }
  return targets;
}

function publicStorageSources(snapshot) {
  const buildings = snapshot?.domains?.inventories?.data?.buildings;
  if (!Array.isArray(buildings)) return null;
  const sources = [];
  for (const building of buildings) {
    const items = [];
    for (const stack of Array.isArray(building?.items) ? building.items : []) {
      const quantity = safePlannerInteger(stack?.quantity);
      const kind = stack?.itemType === "cargo" ? "cargo" : stack?.itemType === "item" ? "items" : null;
      const id = String(stack?.itemId ?? "");
      if (quantity == null || !kind || !/^(?:0|[1-9]\d*)$/.test(id) || String(stack?.catalogKey ?? "") !== `${kind}:${id}`) return null;
      items.push({ id, kind, quantity, guaranteedQuantity: quantity });
    }
    sources.push({
      sourceId: String(building?.entityId ?? "settlement-storage"),
      label: String(building?.nickname ?? building?.name ?? "Claim storage"),
      items,
    });
  }
  return sources;
}

function publicCraftSources(snapshot) {
  const rows = snapshot?.domains?.crafts?.data?.craftResults;
  if (!Array.isArray(rows)) return null;
  const crafts = [];
  const playerIds = new Set();
  for (const craft of rows) {
    const playerId = String(craft?.ownerEntityId ?? `public-craft:${craft?.entityId ?? crafts.length}`);
    playerIds.add(playerId);
    for (const output of Array.isArray(craft?.craftedItem) ? craft.craftedItem : []) {
      const quantity = safePlannerInteger(output?.quantity);
      const kind = output?.itemType === "cargo" ? "cargo" : output?.itemType === "item" ? "items" : null;
      const id = String(output?.itemId ?? "");
      if (quantity == null || !kind || !/^(?:0|[1-9]\d*)$/.test(id) || String(output?.catalogKey ?? "") !== `${kind}:${id}`) return null;
      crafts.push({
        id: String(craft?.entityId ?? ""),
        itemId: id,
        itemType: kind,
        kind,
        quantity,
        guaranteedQuantity: quantity,
        playerId,
        playerName: String(craft?.ownerUsername ?? ""),
        buildingName: String(craft?.buildingName ?? ""),
        craftId: String(craft?.entityId ?? ""),
        completed: craft?.completed === true,
        status: craft?.completed === true ? "Ready to collect" : "In progress",
        sourceType: craft?.completed === true ? "Completed claim craft" : "Current claim craft",
      });
    }
  }
  return { crafts, playerIds: [...playerIds] };
}

function publicComputationConfig(plan, targets, craftPlayerIds) {
  return {
    enabled: true,
    name: plan.title,
    targets,
    sourceRules: {
      storageContainerIds: [],
      playerIds: [],
      craftPlayerIds,
      bankPlayerIds: [],
      bankContainerIds: [],
      deployableContainerIds: [],
    },
    routeOverrides: plan.document.routeOverrides,
    multipliers: plan.document.multipliers,
    sectionOverrides: plan.document.sectionOverrides,
    rowNameOverrides: plan.document.rowNameOverrides,
    gatheredItemKeys: [],
    buildingProgress: {},
  };
}

function safePublicComputationValue(value, seen = new Set()) {
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (typeof value === "bigint") return false;
  if (!value || typeof value !== "object") return true;
  if (seen.has(value)) return false;
  seen.add(value);
  const safe = (Array.isArray(value) ? value : Object.values(value))
    .every((child) => safePublicComputationValue(child, seen));
  seen.delete(value);
  return safe;
}

function publicComputationIdentityKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
  return normalized === "sources"
    || normalized === "activecraftsources"
    || normalized === "sourcerules"
    || /(?:source|player|crafter|container|entity|craft|owner|building|storage|bank|deployable)ids?$/.test(normalized);
}

export function redactPublicPlanComputation(value) {
  if (Array.isArray(value)) return value.map(redactPublicPlanComputation);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !publicComputationIdentityKey(key))
    .map(([key, child]) => [key, redactPublicPlanComputation(child)]));
}

export function createPublicPlanComputationService({ data, catalog, maxEntries = 128 } = {}) {
  if (typeof data?.snapshot !== "function" || typeof catalog?.recipe !== "function") {
    throw new TypeError("Public plan computation requires public snapshot and catalog services.");
  }
  const cache = new Map();

  function remember(key, value) {
    if (cache.has(key)) cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return value;
  }

  return Object.freeze({
    async compute(plan) {
      const document = normalizePublicCraftPlanDocument(plan?.document);
      const targets = publicPlanTargets(document);
      if (!targets) return computationUnavailable(document, "Public plan computation is unavailable because a quantity cannot be converted safely.");
      let snapshot;
      try {
        snapshot = await data.snapshot(String(plan.claimId), "inventories,crafts");
      } catch {
        return computationUnavailable(document);
      }
      if (String(snapshot?.claimId ?? "") !== String(plan.claimId)) return computationUnavailable(document);
      const sourceRevision = String(snapshot?.sourceRevision ?? snapshot?.receivedAt ?? "");
      if (!sourceRevision) return computationUnavailable(document);
      const viewClass = plan.role === "owner" || plan.role === "editor" ? "detailed" : "redacted";
      const cacheKey = `${String(plan.id)}:${String(plan.claimId)}:${Number(plan.revisions?.document)}:${sourceRevision}:${viewClass}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey);
      const storageSources = publicStorageSources(snapshot);
      const craftSources = publicCraftSources(snapshot);
      if (!storageSources || !craftSources) return remember(cacheKey, computationUnavailable(document));

      let catalogUnavailable = false;
      const detailsByKey = await collectRecipeDetails(targets, async (target) => {
        try {
          return await catalog.recipe(target.kind === "cargo" ? "cargo" : "item", target.id);
        } catch (error) {
          catalogUnavailable = true;
          throw error;
        }
      }, document.routeOverrides, 14);
      if (catalogUnavailable) return remember(cacheKey, computationUnavailable(document));

      const config = publicComputationConfig(plan, targets, craftSources.playerIds);
      const computed = computeCraftPlan({
        config,
        preparedConfig: config,
        detailsByKey,
        storageSources,
        playerSources: [],
        bankSources: [],
        deployableSources: [],
        activeCrafts: craftSources.crafts,
        craftSourceErrors: [],
        catalogWarnings: [],
      });
      if (!safePublicComputationValue(computed)) {
        return remember(cacheKey, computationUnavailable(document, "Public plan computation is unavailable because a calculated quantity cannot be represented safely."));
      }
      const warnings = [
        ...(Array.isArray(snapshot.warnings) ? snapshot.warnings : []),
        ...(Array.isArray(snapshot.domains?.inventories?.warnings) ? snapshot.domains.inventories.warnings : []),
        ...(Array.isArray(snapshot.domains?.crafts?.warnings) ? snapshot.domains.crafts.warnings : []),
      ];
      return remember(cacheKey, {
        available: true,
        document,
        source: {
          claimId: String(plan.claimId),
          revision: sourceRevision,
          receivedAt: String(snapshot.receivedAt ?? ""),
        },
        plan: viewClass === "detailed" ? computed : redactPublicPlanComputation(compactCraftPlanResponse(computed)),
        warnings,
      });
    },
    health() {
      return { entries: cache.size, maxEntries };
    },
  });
}
