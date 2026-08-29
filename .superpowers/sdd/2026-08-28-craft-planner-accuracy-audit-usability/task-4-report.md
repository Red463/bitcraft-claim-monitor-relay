# Task 4 report: four-workspace manager and read-only item route details

## Commit

`aece139cc014d50730f64b45787f273cc0e99d30` — `feat(craft-plan): focus manager workspaces`

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
