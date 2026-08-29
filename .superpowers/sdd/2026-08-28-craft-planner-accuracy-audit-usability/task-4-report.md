# Task 4 report: four-workspace manager and read-only item route details

## Commit

- `aece139cc014d50730f64b45787f273cc0e99d30` — `feat(craft-plan): focus manager workspaces`
- `68f86d175b93231f1258295c4f8bb977b3c069c1` — `fix(craft-plan): finish manager workspace review`
- `c272639987159e4f99dd6b2ef57bc25caea3b5f3` — `fix(craft-plan): close manager review gaps`
- `29c18ceda8918b7909acf04a2fa2319741f86fa8` — `fix(craft-plan): harden manager draft races`
- `0cde1de42a568b7eb3e3c63fc7aca7d5f09f58ab` — `fix(craft-plan): correct manager audit and retry states`

## Implemented behavior

- Replaced the seven-tab manager with `Goals`, `Counted Sources`, `Recipe Review`, and permission-gated `Audit` workspaces while retaining one staged `Save Plan` action.
- Consolidated storage, player inventory/crafts, deployables, and banks into one searchable source workspace. New empty configurations show an unselected, explicitly confirmed settlement-storage or owner-inventory suggestion; craft, bank, and deployable sources remain opt-in.
- Connected Recipe Review to Task 3 preview routes, with ambiguous-first typed outputs, accessible route cards, server-safe preselection, staged route/buffer/review state, Task 1 material impact, public ambiguity confirmation, and revision-conflict recovery that preserves the draft.
- Rendered Task 2 causal groups, server-provided observed/derived/unresolved evidence, dependency paths, filters, pagination, checkpoint comparison, and separate `audit.view`/`data.export` authorization.
- Updated Needs Board and item detail presentation to prefer `missingNow` as `Needed now` and `planRequired` as `Plan total`, while keeping stock, guaranteed output, estimated output, and building completion separate with legacy aliases only as fallback.
- Removed immediate route and buffer persistence from item details. Authorized editors now deep-link to the exact typed output in Recipe Review, which receives keyboard focus after preview loading.
- Added dense desktop and narrow-screen CSS without adding dependencies or changing locked backend/API contracts.

## Main files

- `apps/bitcraft-local/src/pages/CraftPlanManagerDialog.tsx`
- `apps/bitcraft-local/src/pages/craftPlanManagerModel.ts`
- `apps/bitcraft-local/src/pages/CraftPlanningPage.tsx`
- `apps/bitcraft-local/src/pages/craftPlanningNeedsBoard.ts`
- `apps/bitcraft-local/src/styles/craft-planning.css`
- Focused manager, item-detail, Needs Board, CSS, and existing boundary tests under `apps/bitcraft-local/test/`

## RED/GREEN evidence

- Manager model RED: the focused test failed with `ERR_MODULE_NOT_FOUND`; initial GREEN passed the workspace, suggestion, typed-route ordering, material mapping, and deep-link cases.
- Component RED: all three initial manager scenarios failed against the legacy seven-tab UI. GREEN covered one-save staging, explicit suggestions, ambiguous-first preview cards, route/buffer/review persistence, the public gate, revision conflicts, and dirty-refresh preservation.
- Item-detail RED: immediate route/buffer paths remained and no typed Recipe Review link existed. GREEN removed those paths and verified the exact deep link.
- Needs Board RED: compatibility aliases won (`99 !== 4`). GREEN made Task 1 fields authoritative.
- CSS RED: both focused workspace boundary cases failed before the new classes and responsive rules. GREEN passed both desktop/focus and narrow/viewport cases.
- Self-review RED: the server's safer recommendation lost to the calculated route, and the public confirmation payload did not stage it. GREEN now preserves explicit overrides but otherwise stages the safest recommendation before save.
- Final post-review focused model/item/CSS set: 9 passed, 0 failed.
- Final post-review React manager/refresh set: 6 passed, 0 failed.
- Finalization review RED: an authenticated audit-only administrator still received plan-edit controls, and Counted Sources rendered a second bank-only search disconnected from the workspace search. The focused tests failed 1/7 and 1/3 respectively before the corrections.
- Finalization review GREEN: editor access now requires plan ownership or `settings.manage`, and the single Counted Sources search covers storage, inventory, crafts, deployables, and banks. The combined manager model/React set passed 10/10 after the corrections.
- Full boundary/CSS/Needs set: 68 passed, 0 failed.
- Standalone frontend TypeScript check: passed.

## Final verification

- `corepack pnpm --filter @workspace/bitcraft-local run build` — passed after the final self-review correction, including server/provider/bindings builds, 1,462-asset verification, TypeScript, Vite, and Relay runtime-boundary verification.
- Finalization focused manager/item/boundary/CSS/Needs set — 82 passed, 0 failed; the production build was rerun afterward and passed.
- `corepack pnpm --filter @workspace/bitcraft-local test` — 2,734 total, 2,731 passed, 0 failed, 3 environment-skipped. This full run completed before the final narrow safest-route staging correction; the affected model, React, TypeScript, and production build checks were rerun afterward and passed.
- `git diff --cached --check` — passed before the implementation commit; only expected Windows line-ending notices were emitted.

## Browser result

Browser smoke was attempted twice after the production build. Both bounded attempts hung and were interrupted; no browser tab reached a reliable verification state. Browser smoke was therefore skipped after those two attempts, no third attempt was made, and dependencies were intentionally left unchanged.

## Self-review and findings

- Fixed safest-route priority and ensured an unoverridden server recommendation is staged in both Recipe Review and the public-confirmation retry payload.
- Restricted manager and item-detail Recipe Review controls to plan owners or administrators with `settings.manage`, matching the server mutation permission.
- Made the one Counted Sources search filter bank groups as well as storage, inventory/craft, and deployable sources.
- Confirmed the old seven-tab and immediate route/buffer-save paths are absent from production UI code.
- Confirmed audit/export rendering uses the locked permissions and React displays server causal evidence rather than deriving claims.
- Confirmed no backend, schema, provider, dependency, changelog, or version change was introduced.
- No unresolved Task 4 correctness, security, migration, or contract finding remains. Browser-only visual inspection remains unavailable after the two bounded hangs described above.

## Independent Task 4 review correction

- RED: the focused manager/model run reported 6 failures across 13 tests, covering audit-only access, exact causal rendering and race safety, aggregate grouped detail totals, quantitative route comparison, and staged reset/orphan-buffer cleanup.
- GREEN: audit-only administrators now enter a read-only Audit workspace with no Goals, Counted Sources, Recipe Review, or Save controls; editors still require ownership or `settings.manage`.
- GREEN: causal groups use `groupId`, render both `span.from` and `span.to`, and show observed, derived before/after/delta, dependency, and unresolved evidence directly from Task 2. Request identities prevent stale filter/page responses from replacing the latest query; the deferred-response regression resolves the older request last.
- GREEN: grouped item details use aggregate NeedCell totals and coverage layers while the read-only exact typed Recipe Review deep link remains unchanged.
- GREEN: route cards show Task 3 yield, progress/resource, probability/drop, action/resource, producer, gathering-mode, source, station, and skill data when present.
- GREEN: editors can stage removal of a route override back to calculated/default selection and can see/remove saved buffers whose output is absent from the current preview; neither path persists before Save Plan.
- Final focused manager/item/boundary/CSS/Needs verification: 85 passed, 0 failed.
- Final causal-detail refinement RED exposed a missing unresolved effect/material label (4/5 passed); GREEN passed the complete React manager file 5/5, and the production build was rerun afterward.
- A fresh aggregate suite was started but interrupted after exceeding the bounded 60-second review window; no failures were printed before interruption and therefore no aggregate result is claimed. Task 5 owns the final aggregate suite.
- The production build passed afterward, including provider/bindings builds, 1,462-asset verification, TypeScript, Vite, and Relay runtime-boundary verification.

## Deployment

No migration or manual VPS action is required.

## Independent Task 4 re-review correction

- RED: five manager UI tests failed across the six reported behaviors. The preview lifecycle case was then tightened from an initially insufficient passing test to resolve preview A after close while plan B's load remained deferred.
- GREEN: revision-conflict recovery keeps an explicit local conflict draft, rebases it onto the server's latest revision/config metadata, and preserves staged targets, routes, buffers, and sources for a retry using the new revision.
- GREEN: route cards and confirmation payloads now share `craftPlanRouteSelection`; deleting a risky override displays and confirms the same safe server preselection.
- GREEN: unresolved relationships always render their reason plus every available trigger, effect, typed material, and Task 2 relationship/dependency identity.
- GREEN: preview identities are invalidated on close, open/load, and plan changes. Stale preview responses return without mutating preview or configuration; the deferred A→close→B regression covers this boundary.
- GREEN: checkpoint results clear as soon as either input changes and request identities prevent an older comparison from replacing the result for the current from/to pair.
- GREEN: `audit.view` alone controls Audit visibility. `ownerManaged` continues to select the personal endpoint, so an administrator who owns a personal plan can use both permitted edit workspaces and Audit.
- Focused manager regression file: 8 passed, 0 failed.
- Broader Task 4 manager/item-detail/Needs Board/boundary/CSS set: 238 passed, 0 failed.
- Production build: passed, including server/provider/bindings builds, 1,462-asset verification, TypeScript, Vite, and Relay runtime-boundary verification.
- Final aggregate suite: 2,742 total; 2,739 passed, 0 failed, 3 environment-skipped.
- Browser automation was not retried because the two earlier bounded Task 4 smoke attempts hung; this follows the explicit re-review constraint and leaves the recorded browser limitation unchanged.
- Final focused self-review found no additional correctness, authorization, request-race, schema, dependency, migration, changelog, or version issue in Task 4 scope.

## Independent Task 4 third-review correction

- RED: the deferred failed-preview case made two automatic requests for the same unchanged draft (`2 !== 1`); the publication gate rendered two Save actions (`2 !== 1`); shared and personal Audit UI cases received no Task 2 config history; and the server boundary still selected `admin_audit_log`.
- GREEN: each draft signature now receives at most one automatic preview attempt after failure. The error remains stable, explicit Refresh can retry the same signature, and a changed staged config has a different signature and can auto-load again.
- GREEN: the existing audit-authorized endpoint now returns the selected plan's complete Task 2 `craft_plan_config_audit` history, newest first, for shared and personal plans. It no longer reads or normalizes legacy `admin_audit_log` rows.
- GREEN: Audit renders the server-provided actor/type/time, action, previous/new revisions, and exact JSON-pointer patch before/after values. Domain and UI fixtures cover target, route, multiplier/buffer, counted-source, and visibility changes without React-generated summaries.
- GREEN: the publication gate transforms the primary Save action into `Confirm routes and Save Plan`; the warning no longer adds a second persistence control.
- Focused server/domain/UI correction set: 16 passed, 0 failed.
- Broader Task 4 server/manager/item-detail/Needs Board/boundary/CSS set: 246 passed, 0 failed.
- Production build: passed with exit code 0, including server/provider/bindings builds, 1,462-asset verification, TypeScript, client Vite, and Relay runtime-boundary verification.
- One uninterrupted aggregate suite completed with 2,744 total: 2,740 passed, 1 failed, and 3 environment-skipped. The sole failure was the unrelated deployment-runtime worker-exit test timing out after 10 seconds; no Task 4 test failed.
- The requested one isolated follow-up of `deployment-runtime.test.mjs` passed 8/8, including the previously timed-out worker-exit case in 1.49 seconds. The aggregate suite was not rerun.
- Browser automation was not retried because the two earlier bounded Task 4 smoke attempts hung; dependencies remain unchanged.
- Final self-review found no remaining Task 4 correctness, authorization, audit-contract, request-loop, publication-gate, schema, migration, dependency, changelog, or version issue.

## Independent Task 4 fourth-review correction

- RED: the model regression could not import the requested three-way rebase or grouped-output helpers; the grouped item-detail boundary still linked only the first item; and the deferred preview race made one request instead of queuing the changed draft (`1 !== 2`). The conflict UI test also exposed that the former “reload latest” behavior silently retained overlapping stale local fields.
- GREEN: conflict recovery now retains the loaded base, computes structured base-to-local and base-to-server changes, applies non-overlapping local route/buffer changes onto the authoritative server configuration, and preserves concurrent server target/source edits. Overlapping JSON-pointer paths retain the server value, display both choices, and disable Save until explicitly resolved.
- GREEN: preview application is bound to both request identity and the exact staged-config signature. Every staged configuration mutation updates that signature immediately, so even a response resolving between the edit event and the next React render is ignored; after it settles, the latest draft preview is requested and may apply.
- GREEN: grouped Needs Board detail renders one Recipe Review link for every unique exact typed output, preserving item/cargo identity and later grouped items instead of always selecting `items[0]`.
- Focused fourth-review files: 24 passed, 0 failed. The tightened immediate-edit preview race also passed in isolation.
- Broader craft-plan regression set: 429 passed, 0 failed.
- Production build: passed after the final race hardening, including server/provider/bindings builds, 1,462-asset verification, TypeScript, Vite, and Relay runtime-boundary verification.
- One uninterrupted aggregate suite completed before the final mutation-time signature tightening: 2,749 total; 2,746 passed, 0 failed, and 3 environment-skipped. Per instruction, it was not rerun; the affected focused files and production build were rerun afterward and passed.
- Browser automation was not retried because the two earlier bounded Task 4 smoke attempts hung. Dependencies remain unchanged.
- Final self-review found no further Task 4 correctness, authorization, race, typed-identity, schema, migration, dependency, changelog, or version issue.
