import { unavailableCraftPlanEffortProgress } from "./craftPlanEffortProgress.mjs";
import { staleCraftPlanProgress } from "./craftPlanProgressAudit.mjs";
import { gunzipSync, gzipSync } from "node:zlib";

const pristinePlansByStalePlan = new WeakMap();
const SENSITIVE_PLAN_KEY = /(authorization|cookie|password|secret|session|token)/i;

function sanitizedPublicationValue(value) {
  if (Array.isArray(value)) return value.map(sanitizedPublicationValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_PLAN_KEY.test(key))
    .map(([key, child]) => [key, sanitizedPublicationValue(child)]));
}

function validRetainedPublication(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.materials) || !Array.isArray(plan.gatherNext) || !Array.isArray(plan.steps)) return false;
  return plan.materials.every((material) => /^(items|cargo):[0-9]+$/.test(String(material?.key ?? ""))
    && ["planRequired", "requiredNow", "missingNow", "required", "missing"].every((field) => (
      typeof material?.[field] === "number" && Number.isFinite(material[field]) && material[field] >= 0
    )));
}

export function createCraftPlanLastGoodPublicationRepository(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS craft_plan_last_good_publications (
    claim_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    payload_gzip BLOB NOT NULL,
    published_at TEXT NOT NULL,
    PRIMARY KEY (claim_id, plan_id)
  )`);
  const upsert = db.prepare(`INSERT INTO craft_plan_last_good_publications (
    claim_id, plan_id, schema_version, payload_gzip, published_at
  ) VALUES (?, ?, 1, ?, ?)
  ON CONFLICT(claim_id, plan_id) DO UPDATE SET
    schema_version = excluded.schema_version,
    payload_gzip = excluded.payload_gzip,
    published_at = excluded.published_at`);
  const select = db.prepare("SELECT * FROM craft_plan_last_good_publications WHERE claim_id = ? AND plan_id = ?");
  const remove = db.prepare("DELETE FROM craft_plan_last_good_publications WHERE plan_id = ?");
  return {
    store(claimId, planId, plan, publishedAt = new Date().toISOString()) {
      const sanitizedPlan = sanitizedPublicationValue(plan);
      if (!validRetainedPublication(sanitizedPlan)) throw new Error("Refusing to persist an invalid Craft Plan publication.");
      const payload = gzipSync(Buffer.from(JSON.stringify(sanitizedPlan)));
      upsert.run(String(claimId), String(planId), payload, String(publishedAt));
    },
    load(claimId, planId) {
      const row = select.get(String(claimId), String(planId));
      if (!row) return { plan: null, limitation: null };
      try {
        if (Number(row.schema_version) !== 1) throw new Error("unsupported retained publication schema");
        const plan = JSON.parse(gunzipSync(row.payload_gzip).toString("utf8"));
        if (!validRetainedPublication(plan)) throw new Error("invalid retained publication payload");
        return { plan, limitation: null };
      } catch (error) {
        return {
          plan: null,
          limitation: {
            at: String(row.published_at ?? ""),
            error: `Corrupt or invalid retained Craft Plan publication: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
          },
        };
      }
    },
    deleteForPlan(planId) {
      return remove.run(String(planId));
    },
  };
}

function pristinePlan(plan) {
  if (!plan || typeof plan !== "object") return plan;
  return pristinePlansByStalePlan.get(plan) ?? plan;
}

function validationSourceFailure(validation = {}) {
  if (validation?.valid === true) return null;
  const count = Array.isArray(validation?.errors) ? validation.errors.length : 0;
  return {
    sourceId: "craft-plan-validation",
    label: "Craft Plan calculation validation",
    type: "Planner validation",
    error: `${count} calculation invariant${count === 1 ? "" : "s"} failed.`,
  };
}

function auditErrorDetails(error, capturedAt) {
  return {
    at: capturedAt,
    error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
  };
}

export function resolveFailedCraftPlanPublication({
  claimId,
  planId,
  candidatePlan,
  publication,
  validation,
  sourceFailures = [],
  capturedAt = new Date().toISOString(),
  validationWarnings = new Map(),
  progressAudit,
  baselineChange = () => null,
} = {}) {
  const validationFailure = validationSourceFailure(validation);
  const publicationFailures = validationFailure ? [...sourceFailures, validationFailure] : [...sourceFailures];
  if (!publicationFailures.length) return { plan: candidatePlan, publicationFailures, auditError: null };

  if (validationFailure) {
    validationWarnings.set(planId, {
      at: capturedAt,
      planId,
      baselineRevision: validation?.baselineRevision ?? "",
      retainedLastGood: publication?.retainedLastGood === true,
      errors: validation?.errors ?? [],
    });
  }

  let auditError = null;
  try {
    progressAudit?.recordFailure(claimId, publicationFailures, capturedAt, planId);
  } catch (error) {
    auditError = auditErrorDetails(error, capturedAt);
  }

  if (!publication?.plan) {
    throw Object.assign(
      new Error("Craft Plan calculation validation failed before a complete plan was available."),
      { statusCode: 502, auditError },
    );
  }

  if (publication.retainedLastGood) {
    const lastGoodPlan = pristinePlan(publication.plan);
    const retainedPlan = {
      ...lastGoodPlan,
      effortProgress: staleCraftPlanProgress(lastGoodPlan?.effortProgress, publicationFailures, capturedAt),
      unavailableSources: [
        ...(Array.isArray(lastGoodPlan?.unavailableSources) ? lastGoodPlan.unavailableSources : []),
        ...publicationFailures,
      ],
      warnings: [
        ...(Array.isArray(lastGoodPlan?.warnings) ? lastGoodPlan.warnings : []),
        "Craft Plan calculation validation failed; showing the last successful complete plan.",
      ],
    };
    retainedPlan.effortProgress.baselineChange = baselineChange({ claimId, planId, capturedAt });
    pristinePlansByStalePlan.set(retainedPlan, lastGoodPlan);
    return { plan: retainedPlan, publicationFailures, auditError };
  }

  let lastSuccess = null;
  try {
    lastSuccess = progressAudit?.latestSuccess(claimId, planId) ?? null;
  } catch (error) {
    auditError = auditErrorDetails(error, capturedAt);
  }
  const failedPlan = { ...candidatePlan };
  failedPlan.effortProgress = lastSuccess?.effortProgress
    ? staleCraftPlanProgress(lastSuccess.effortProgress, publicationFailures, capturedAt)
    : unavailableCraftPlanEffortProgress();
  failedPlan.effortProgress.baselineChange = baselineChange({ claimId, planId, capturedAt });
  failedPlan.unavailableSources = [
    ...(Array.isArray(candidatePlan?.unavailableSources) ? candidatePlan.unavailableSources : []),
    ...publicationFailures,
  ];
  return { plan: failedPlan, publicationFailures, auditError };
}
