const SENSITIVE_KEY = /(authorization|cookie|password|secret|session|token)/i;

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "string") {
    return value
      .replace(/([?&](?:access_)?(?:token|secret|password|session|cookie)=)[^&#\s]+/gi, "$1[REDACTED]")
      .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]");
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => !SENSITIVE_KEY.test(key))
    .map((key) => [key, sanitize(value[key])]));
}

function patch(before, after, path = "") {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const beforeObject = before && typeof before === "object" && !Array.isArray(before);
  const afterObject = after && typeof after === "object" && !Array.isArray(after);
  if (beforeObject && afterObject) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .flatMap((key) => patch(before[key], after[key], `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
  }
  return [{ path: path || "/", before: before ?? null, after: after ?? null }];
}

function parse(row) {
  let changes = { before: null, after: null, patch: [], corrupt: true };
  try { changes = JSON.parse(String(row.changes_json)); } catch {}
  return {
    id: Number(row.id),
    planId: String(row.plan_id),
    claimId: row.claim_id == null ? null : String(row.claim_id),
    actor: {
      type: String(row.actor_type),
      id: row.actor_id == null ? null : String(row.actor_id),
      displayName: String(row.actor_display_name),
    },
    occurredAt: String(row.occurred_at),
    previousRevision: row.previous_revision == null ? null : Number(row.previous_revision),
    newRevision: Number(row.new_revision),
    action: String(row.action),
    changes,
  };
}

export function createCraftPlanConfigAuditRepository(db, { statements } = {}) {
  if (!db || !statements) throw new Error("Craft Plan config audit requires a database and prepared statements.");
  return {
    record({ planId, claimId = null, actor = {}, occurredAt, previousRevision = null, newRevision, action, before = null, after = null }) {
      const safeBefore = sanitize(before);
      const safeAfter = sanitize(after);
      statements.insertCraftPlanConfigAudit.run(
        cleanText(planId),
        cleanText(claimId) || null,
        cleanText(actor.type, "system") || "system",
        cleanText(actor.id) || null,
        cleanText(actor.displayName, "system") || "system",
        cleanText(occurredAt),
        previousRevision == null ? null : Number(previousRevision),
        Number(newRevision),
        cleanText(action),
        JSON.stringify({ before: safeBefore, after: safeAfter, patch: patch(safeBefore, safeAfter) }),
      );
    },
    listForPlan(planId) {
      return statements.listCraftPlanConfigAudit.all(cleanText(planId)).map(parse);
    },
    deleteForPlan(planId) {
      return Number(statements.deleteCraftPlanConfigAudit.run(cleanText(planId)).changes);
    },
    anonymizeActor(actorId, displayName) {
      return Number(statements.anonymizeCraftPlanConfigAuditActor.run(cleanText(displayName), cleanText(actorId)).changes);
    },
  };
}
