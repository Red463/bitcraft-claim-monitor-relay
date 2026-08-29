# Task 3 report: preview, route review, and optimistic concurrency

## Commit

`72d375237f19a027aa8d4e9552416bc31d2136e6` — `feat(craft-plan): add preview route review`

`963017866a86ac0e7500f976717ee59da26da916` — `fix(craft-plan): bind route review evidence`

`71c27d970f1d42935728b21c83a85555f2d9ad50` — `fix(craft-plan): preserve route review baselines`

`eae636ad81aaa11e53477f8e51748e3bf10a78c6` — `fix(craft-plan): guard legacy plan saves`

`1989686e9c547fb41a55a89ddc6d1a4b4b7d502a` — `fix(craft-plan): close route review race gaps`

`aa37e77e94496433a17ece41de37a2fbce571937` — `fix(craft-plan): explore viable child routes`

## Files changed

- `apps/bitcraft-local/server.mjs`
- `apps/bitcraft-local/src/server/accountDeletion.mjs`
- `apps/bitcraft-local/src/server/adminPermissions.mjs`
- `apps/bitcraft-local/src/server/craftPlanRepository.mjs`
- `apps/bitcraft-local/src/server/craftPlanRouteReview.mjs`
- `apps/bitcraft-local/src/server/craftPlanning.mjs`
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
- Hidden and personal drafts may remain unreviewed. Public shared creation/publication rejects only current newly ambiguous fingerprints; the first successful legacy-public save stores a durable non-confirmed grandfather baseline, unchanged fingerprint-and-selected-route baselines remain eligible, current confirmations remain valid, and changed outputs invalidate independently.
- Planner alternatives now expose memoized, bounded dependency-expansion viability using the planner's typed recipe graph, route overrides, and blocked-input semantics. Each craftable dependency may use any viable non-logistics production expansion, with a viable explicit override taking precedence; cyclic branches do not hide safe siblings. Direct and indirect cyclic or ancestor-blocked alternatives remain visible to planner consumers but are not selectable production alternatives and therefore cannot create false ambiguity. When no safe route exists, the prior locked nearest-source fallback remains unchanged.
- Shared creation and plan updates persist configuration, route confirmations, and Task 2 configuration audit evidence in one transaction. Failed, stale, or publication-gated writes leave all three unchanged.
- Modern updates require the last-seen revision. Update, delete, and primary-selection reads and revision checks run after `BEGIN IMMEDIATE`, in the same write transaction as their mutation and audit/review side effects. A mismatch returns `409 craft_plan_revision_conflict` with the authorized current revision, plan metadata, and configuration for rebase, before staged configuration validation can mask the conflict.
- The singular legacy admin `PUT /api/local/admin/craft-plan` compatibility route now requires the caller's last-seen revision and uses the same preview, public ambiguity gate, exact confirmation, atomic route-review/configuration-audit persistence, and conflict metadata as the plural plan update. Legacy `GET` and raw-config request compatibility remain available.
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
- Fresh re-review RED produced three focused failures: no persisted legacy-public baseline, no additive evidence-status migration, and no planner viability marker for a real cyclic alternative.
- Re-review GREEN persists an explicitly non-confirmed `grandfathered` baseline atomically with the first legacy save, continues unchanged saves only while fingerprint and selection match, gates catalog drift without discarding the baseline evidence, migrates existing confirmed rows to explicit `confirmed` status, and excludes cyclic alternatives using the planner's existing selection viability rule.
- Third-review HTTP RED showed a stale singular legacy save returned `200`, incremented the plan revision, and ignored the supplied revision. The GREEN case uses a real two-recipe catalog target and proves stale save `409`/no writes, newly ambiguous save `409`/no writes, and exact current confirmation persisting one review and one configuration-audit revision atomically.
- Fourth-review grandfather RED accepted changing the selected route from A to B when the alternatives fingerprint was unchanged. GREEN binds grandfather eligibility to both fingerprint and selected route: unchanged A continues, A-to-B gates, and exact explicit confirmation of B succeeds.
- Fourth-review concurrency RED reproduced all three pre-transaction races by injecting a committed revision change immediately before `BEGIN IMMEDIATE`: update overwrote it, delete removed it, and primary selection switched it. GREEN moves each authoritative row read and revision check under the acquired write transaction; all three now return conflict with no mutation or related writes.
- Fourth-review viability RED marked the real typed dependency cycle `80 -> 81 -> 80` selectable. The first bounded-DFS implementation exposed two locked sole-cycle/co-product fallback regressions; retaining the existing selected-route fallback when no viable alternative exists restored those contracts while the unsafe indirect alternative remains non-selectable whenever a valid route is available.
- Final-review RED reproduced the remaining sibling-search defect: a parent `80 -> 81` was marked non-selectable because the first child expansion `81 -> 82 -> 80` cycled, even though the sibling `81 -> 84` was safe. GREEN explores all viable non-logistics child alternatives with memoized typed path state, retains both valid root alternatives in preview, and preserves the public ambiguity gate and no-write behavior. The locked sole-cycle nearest-source regression remains green.
- Final focused planner/preview/repository/schema/auth/server set: 171 passed, 0 failed.

## Final verification

- `node --test` focused planner/preview/repository/schema/auth/server files — 171 passed, 0 failed.
- `corepack pnpm --filter @workspace/bitcraft-local test` — 2719 passed, 0 failed, 3 skipped (2722 total).
- `corepack pnpm --filter @workspace/bitcraft-local run build` — passed server/provider/bindings builds, 1462-asset verification, TypeScript, Vite, and Relay runtime-boundary verification.
- `git diff --cached --check` — passed before the implementation commits; only expected Windows line-ending notices were emitted while staging.

## Migration notes

- `craft_plan_route_reviews` is additive and idempotent through `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`; existing tables receive an additive `review_status` column during startup migration.
- Its primary key is `(plan_id, output_key)` and its foreign key cascades with plan deletion. Existing plans and Task 1/2 evidence are unchanged.
- Existing rows with a non-null `confirmed_fingerprint` migrate to explicit `confirmed` status. Legacy rows without it remain unconfirmed rather than trusted, while newly grandfathered legacy-public baselines use distinct `grandfathered` status and never masquerade as user confirmation.
- Account deletion removes reviews belonging to deleted personal plans and anonymizes a deleted app user's reviewer identity on surviving shared plans.
- No manual data migration or VPS action is required beyond normal deployment/startup so schema bootstrap runs.

## API notes

- `POST /api/local/admin/craft-plans/:planId/preview`
- `POST /api/local/user/craft-plans/:planId/preview`
- Preview accepts staged configuration in `body.config` and returns `Cache-Control: no-store`.
- Modern `PUT` saves accept `expectedRevision` and optional `routeReviewConfirmations` entries containing `outputKey`, `fingerprint`, and `selectedRouteId`.
- Legacy `PUT /api/local/admin/craft-plan` accepts the same top-level concurrency and confirmation fields plus either nested `config` or the prior raw configuration shape. It never substitutes the server's latest revision for the caller's expected revision.
- Shared-plan creation accepts the same confirmation list when duplicating an ambiguous public configuration.
- Conflict responses contain `code`, `conflict.currentRevision`, authorized plan metadata, and the current configuration. Route-review gates return only typed output key, fingerprint, and preselected route metadata.

## Self-review

- Standards review: the implementation stays in the requested backend seams, uses additive SQLite schema and existing repository transactions, keeps route orchestration in `server.mjs`, and leaves the locked Task 1 calculation/Task 2 audit contracts intact.
- Spec review found and fixed five issues before handoff: a personal update variable temporal-dead-zone error, an unsafe attempt to alter locked byproduct route selection, stale validation preceding `409`, missing shared-create ambiguity gating, and display labels participating in material fingerprints.
- Independent review corrections bind submitted and stored evidence to the preview's exact calculated selection; make any stale or legacy-null persisted evidence defeat grandfathering; and include route type, gathering mode/skill/source, producer identity, producer-recipe identity/skill, all expected/drop/guaranteed yield fields, resource health, action count, probability state, and typed inputs in the material signature while excluding display-only names and building labels.
- Fresh re-review corrections make legacy-public compatibility durable and drift-sensitive through explicit baseline evidence, and reuse the planner's own blocked-route viability decision to prevent cyclic/blocked alternatives from creating ambiguity without changing recipe selection semantics.
- Third-review correction removes the singular legacy mutation bypass while preserving its read/raw-config compatibility and committed Relay building reconciliation. The executable HTTP regression checks authoritative conflict metadata and all three persistence tables rather than source text.
- Fourth-review corrections prevent a same-fingerprint route-selection change from inheriting a legacy baseline, close update/delete/primary optimistic-concurrency race windows under SQLite's immediate writer transaction, and exclude indirect cyclic alternatives through typed bounded traversal while preserving the locked no-safe-route behavior.
- Final-review correction keeps viability classification separate from route selection while trying safe sibling expansions after a cyclic child. Memoization is local to each selection/UI evaluation and includes route identity, typed inputs/outputs, blocked ancestry, and depth; the 64-level bound, viable override precedence, logistics exclusion, and existing fallback remain intact.
- Preview routes have executable behavioral coverage at the HTTP seam; authorization and atomic gating have executable coverage at the HTTP/repository seams. Static boundary tests supplement rather than replace them.
- No unresolved correctness, security, migration, privacy, or compatibility finding remains in the Task 3 diff.
