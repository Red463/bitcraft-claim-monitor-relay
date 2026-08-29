# Task 5 report: final whole-branch review corrections

## Implementation commit

- `fa404bb1a997fe774f11ec735e1aa50a94fe21ec` — `fix(craft-plan): close final review gaps`

## Corrections completed

- Stable totals now union baseline-only materials into the published top-level material list by exact typed key. Live rows retain their order; suppressed canonical rows follow in canonical order with fixed `planRequired`, zero live need/coverage quantities, preserved compatibility aliases, and no change to live `gatherNext` grouping.
- Publication last-good state is durable across response-cache invalidation and repository/process reconstruction. A validated, recursively sanitized publication is stored as gzip JSON in additive SQLite state only after successful publication; defensive reads expose corruption limitations and otherwise fail closed. Plan/account deletion removes the checkpoint.
- Publication validation now considers only the source categories and identifiers selected by the plan. Unselected settlement and personal sources cannot block publication; selected player inventory, craft, passive-craft, bank, storage, and deployable scopes still fail closed when unavailable or absent.
- Lifetime configuration history now captures structured route-review confirmation, grandfathering, and invalidation state before and after every successful save, including review-only saves. Actor, revision, and action remain first-class audit metadata, mutable display labels are not duplicated, and review reconciliation plus audit insertion roll back together.
- Audit controls expose 3-, 7-, 14-, and 30-day presets plus exact since/until inputs bounded to the 30-day retention window. Requests send `range`, `since`, and `until`, reset pagination, and remain bound to the latest request identity.
- Personal plural, admin plural, and legacy singular mutations now share `craftPlanSaveOrchestration.mjs` for normalization, revision preflight, current/previous preview, route-review state, transactional repository update, cache invalidation, and conflict/gate response shaping. Route adapters retain their existing authentication, ownership, audit, and response contracts.

## RED/GREEN evidence

- Stable totals RED omitted baseline-only item/cargo rows after upstream stock suppression. GREEN verifies live-first/canonical-second order, exact `items:7` versus `cargo:7` identity, zero live quantities, canonical `planRequired`, aliases, and unchanged `gatherNext`.
- Durable publication RED had no restart-safe repository. GREEN lifecycle coverage stores one valid publication, reconstructs the repository with no memory cache, resolves an invalid next candidate to the exact stale last-good values, strips a sensitive token, and proves corrupt/no-prior cases return the existing 502 fail-closed result.
- Required-source RED allowed unselected collection failures to affect validation. GREEN covers shared storage-only and personal inventory/craft selections, missing selected scopes, legacy aliases, and the absence of unselected craft failures from `unavailableSources`.
- Route-review audit RED omitted review state from lifetime history. GREEN covers a review-only revision with exact before/after state and a forced audit-write failure that rolls back both route-review reconciliation and the plan revision.
- Audit-range RED rejected 14d/30d and the UI emitted no range or exact bounds. GREEN verifies all requested presets, bounded exact windows, 30-day selection, exact encoded parameters, page reset, and request-race binding.
- Save orchestration RED failed because the shared module did not exist. GREEN verifies the single normalize/prepare/preflight/previous-preview/update/invalidate order and proves conflict failures preserve metadata without invalidating caches.

## Verification

- Final focused planner/publication/audit/repository/preview/HTTP/UI/migration/account-deletion set: **235 passed, 0 failed**.
- Durable restart lifecycle regression: **passed**, including stale exact last-good and corrupt/no-prior fail-closed branches.
- Save-orchestration focused tests: **passed**.
- Audit-range UI and server tests: **passed**.
- `corepack pnpm --filter @workspace/bitcraft-local run build`: **passed** after the final production changes, including provider/bindings generation, 1,462-asset verification, TypeScript, Vite, and Relay runtime-boundary verification.
- `corepack pnpm --filter @workspace/bitcraft-local test`: **2,761 total; 2,757 passed, 1 failed, 3 environment-skipped**. The sole failure was a transient SQLite `database is locked` result in `server-craft-plan-preview-http.test.mjs`; that file passed in the 235-test focused run and its immediate isolated rerun passed **2/2**. No functional failure remained reproducible, so the aggregate suite was not rerun a third time.
- The first aggregate attempt exposed only the required table-inventory classification for the new checkpoint table. After documenting it, the affected inventory boundary passed **2/2**.
- `git diff --cached --check`: **passed** before the implementation commit; only expected Windows line-ending notices were emitted.

## Self-review

- Standards review confirmed the change stays within the maintained local app, uses additive SQLite schema, preserves route-level authorization and public response shapes, avoids secrets in retained JSON, and introduces no dependency, version, changelog, retired-provider, or broad unrelated change.
- Specification review traced each of the six findings to executable coverage and confirmed typed item/cargo identity, live `gatherNext` semantics, restart-safe stale publication, selected-source fail-closed behavior, transactional route-review history, bounded/race-safe audit queries, and all three save adapters.
- The explicit no-subagent constraint was preserved; the final two-axis review was performed locally rather than invoking the parallel-agent review flow.
- No browser run was repeated because Task 4 already records two bounded browser-smoke hangs and these corrections are covered by React/server tests plus a successful production build.
- No unresolved correctness, authorization, migration, retention, contract, or data-deletion finding remains in the requested scope. The one aggregate SQLite lock is recorded above as a non-reproducible test-environment limitation.

## Deployment

The SQLite table is additive and bootstrapped automatically. No manual migration, VPS action, changelog entry, version bump, or dependency update is required.
