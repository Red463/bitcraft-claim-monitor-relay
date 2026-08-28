import { unavailableCraftPlanEffortProgress } from "./craftPlanEffortProgress.mjs";
import { staleCraftPlanProgress } from "./craftPlanProgressAudit.mjs";

const pristinePlansByStalePlan = new WeakMap();

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
