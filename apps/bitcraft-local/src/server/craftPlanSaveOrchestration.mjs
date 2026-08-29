export function craftPlanSaveErrorBody(error) {
  return {
    error: error instanceof Error ? error.message : String(error),
    code: error?.code,
    conflict: error?.conflict,
    unconfirmedRoutes: error?.unconfirmedRoutes,
  };
}

export async function orchestrateCraftPlanSave({
  planId,
  body = {},
  currentPlan,
  configInput = body.config,
  normalizeConfig,
  prepareConfig = async (config) => config,
  previewConfig,
  updatePlan,
  invalidate,
  subject = {},
  actor = null,
  claimId = null,
  resolveName = (_config, submittedBody) => submittedBody.name,
} = {}) {
  const hasConfig = configInput !== undefined;
  const config = hasConfig ? await prepareConfig(normalizeConfig(configInput)) : currentPlan?.config;
  const needsReview = hasConfig || Array.isArray(body.routeReviewConfirmations);
  const preview = needsReview
    ? await previewConfig(planId, config, { ...subject, expectedRevision: body.expectedRevision })
    : null;
  const previousPreview = needsReview
    ? await previewConfig(planId, currentPlan?.config, subject)
    : null;
  const changes = { name: resolveName(config, body, currentPlan) };
  if (hasConfig) changes.config = config;
  const planRecord = updatePlan(planId, changes, {
    expectedRevision: body.expectedRevision,
    ...subject,
    actor,
    claimId,
    routeReviewState: preview ? {
      routeReviews: preview.routeReviews,
      previousRouteReviews: previousPreview.routeReviews,
      confirmations: Array.isArray(body.routeReviewConfirmations) ? body.routeReviewConfirmations : [],
      reviewer: actor,
    } : null,
  });
  invalidate();
  return { planRecord, config, preview, previousPreview };
}
