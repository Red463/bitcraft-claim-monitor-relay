# Task 3 report: preview, route review, and optimistic concurrency

## Commit

`72d375237f19a027aa8d4e9552416bc31d2136e6` — `feat(craft-plan): add preview route review`

`963017866a86ac0e7500f976717ee59da26da916` — `fix(craft-plan): bind route review evidence`

## Files changed

- `apps/bitcraft-local/server.mjs`
- `apps/bitcraft-local/src/server/accountDeletion.mjs`
- `apps/bitcraft-local/src/server/adminPermissions.mjs`
- `apps/bitcraft-local/src/server/craftPlanRepository.mjs`
- `apps/bitcraft-local/src/server/craftPlanRouteReview.mjs`
- `apps/bitcraft-local/src/server/preparedStatements.mjs`
- `apps/bitcraft-local/src/server/schemaBootstrap.mjs`
- `apps/bitcraft-local/test/craft-plan-preview-route-review.test.mjs`
- `apps/bitcraft-local/test/craft-plan-route-review-repository.test.mjs`
- `apps/bitcraft-local/test/server-account-deletion.test.mjs`
- `apps/bitcraft-local/test/server-admin-permissions.test.mjs`
- `apps/bitcraft-local/test/server-craft-plan-preview-boundary.test.mjs`
- `apps/bitcraft-local/test/server-craft-plan-preview-http.test.mjs`
- `apps/bitcraft-local/test/server-schema-bootstrap.test.mjs`
- `docs/relay-migration/table-inventory.md`

## Implemented behavior

- Added authenticated, same-origin, CSRF-protected, rate-limited preview routes for shared/admin and owned personal plans. Both reuse the existing normalized calculation, validation, baseline, and personal-source authorization seams.
- Preview configuration is staged without persistence. The response includes exact material impact and compatibility aliases, route alternatives and ambiguity, safest guaranteed non-logistics preselection, validation, scope, baseline/configuration revisions, and a deterministic fingerprint.
- Added exact typed-output route-review persistence with normalized material signatures, selected route, confirmed fingerprint, reviewer, timestamp, and configuration revision. Item and cargo identities remain distinct.
- Hidden and personal drafts may remain unreviewed. Public shared creation/publication rejects only current newly ambiguous fingerprints; unchanged legacy-public ambiguity is grandfathered, current confirmations remain valid, and changed outputs invalidate independently.
- Shared creation and plan updates persist configuration, route confirmations, and Task 2 configuration audit evidence in one transaction. Failed, stale, or publication-gated writes leave all three unchanged.
- Modern updates require the last-seen revision. A mismatch returns `409 craft_plan_revision_conflict` with the authorized current revision, plan metadata, and configuration for rebase, before staged configuration validation can mask the conflict.
- Added account-deletion cleanup/anonymization and explicit least-privilege permissions for the multi-plan admin routes. No immediate-save route endpoint was added.

## RED/GREEN evidence

- Preview/signature domain RED began with the focused module import missing; the first implementation passed 2/2. The final stability RED showed a display-label-only rename changed the fingerprint; material-only signature normalization made the final domain set pass 3/3.
- Route-review repository/schema RED began with the repository export and table absent. Successive RED cases covered exact item/cargo keys, selective invalidation, legacy null fingerprints, hidden/public gating, legacy-public grandfathering, atomic failure, staged authorization, shared creation, and revision preflight. Final repository set passed 7/7.
- A calculation-layer safest-route attempt caused locked byproduct-route regressions. It was reverted; safest selection remains preview-only and the unchanged Craft Planner calculation suite passed 111/111.
- Server-boundary RED failed all 3 initial route/wiring assertions; implementation passed 3/3.
- Executable HTTP RED first exposed the absent behavior and later reproduced stale source validation returning `400` before conflict handling. Revision preflight changed that case to the required `409`; final HTTP route test passed 1/1 while exercising owner/admin success, unauthenticated, cross-owner, missing-CSRF, cross-origin, rate-limit, no-persistence, stale conflict, and exact revision increment behavior.
- Account-deletion RED exposed missing retained-reviewer anonymization, and admin-permission RED exposed the prior `status.view` fallback. Their focused suites passed after the additive fixes.
- Independent-review RED produced one signature-domain failure and four repository/orchestration failures: display-only building/name drift and omitted calculation metadata; submitted/stored selected-route mismatches; stale persisted catalog evidence; legacy-null evidence grandfathering; and a real calculated ambiguous route accepting confirmation of a different alternative.
- The independent-review GREEN runs passed 4/4 signature tests and 11/11 repository/orchestration tests. The real route case uses `computeCraftPlan` to produce two non-empty production alternatives, proves the calculated selection, rejects a different selected route, and persists only the exact calculated selection.
- Final focused planner/preview/repository/schema/auth/server set: 143 passed, 0 failed.

## Final verification

- `node --test` focused planner/preview/repository/schema/auth/server files — 143 passed, 0 failed.
- `corepack pnpm --filter @workspace/bitcraft-local test` — 2710 passed, 0 failed, 3 skipped (2713 total).
- `corepack pnpm --filter @workspace/bitcraft-local run build` — passed server/provider/bindings builds, 1462-asset verification, TypeScript, Vite, and Relay runtime-boundary verification.
- `git diff --cached --check` — passed before both implementation commits; only expected Windows line-ending notices were emitted while staging.

## Migration notes

- `craft_plan_route_reviews` is additive and idempotent through `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
- Its primary key is `(plan_id, output_key)` and its foreign key cascades with plan deletion. Existing plans and Task 1/2 evidence are unchanged.
- Legacy rows without `confirmed_fingerprint` are deliberately treated as unconfirmed rather than trusted.
- Account deletion removes reviews belonging to deleted personal plans and anonymizes a deleted app user's reviewer identity on surviving shared plans.
- No manual data migration or VPS action is required beyond normal deployment/startup so schema bootstrap runs.

## API notes

- `POST /api/local/admin/craft-plans/:planId/preview`
- `POST /api/local/user/craft-plans/:planId/preview`
- Preview accepts staged configuration in `body.config` and returns `Cache-Control: no-store`.
- Modern `PUT` saves accept `expectedRevision` and optional `routeReviewConfirmations` entries containing `outputKey`, `fingerprint`, and `selectedRouteId`.
- Shared-plan creation accepts the same confirmation list when duplicating an ambiguous public configuration.
- Conflict responses contain `code`, `conflict.currentRevision`, authorized plan metadata, and the current configuration. Route-review gates return only typed output key, fingerprint, and preselected route metadata.

## Self-review

- Standards review: the implementation stays in the requested backend seams, uses additive SQLite schema and existing repository transactions, keeps route orchestration in `server.mjs`, and leaves the locked Task 1 calculation/Task 2 audit contracts intact.
- Spec review found and fixed five issues before handoff: a personal update variable temporal-dead-zone error, an unsafe attempt to alter locked byproduct route selection, stale validation preceding `409`, missing shared-create ambiguity gating, and display labels participating in material fingerprints.
- Independent review corrections bind submitted and stored evidence to the preview's exact calculated selection; make any stale or legacy-null persisted evidence defeat grandfathering; and include route type, gathering mode/skill/source, producer identity, producer-recipe identity/skill, all expected/drop/guaranteed yield fields, resource health, action count, probability state, and typed inputs in the material signature while excluding display-only names and building labels.
- Preview routes have executable behavioral coverage at the HTTP seam; authorization and atomic gating have executable coverage at the HTTP/repository seams. Static boundary tests supplement rather than replace them.
- No unresolved correctness, security, migration, privacy, or compatibility finding remains in the Task 3 diff.
