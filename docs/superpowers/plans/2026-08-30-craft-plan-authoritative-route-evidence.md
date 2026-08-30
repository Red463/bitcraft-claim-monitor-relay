# Craft Plan Authoritative Route Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore complete Recipe Review route selection by making the full calculated plan's route inventory authoritative while preserving staged previews and one-save behavior.

**Architecture:** Build one additive route-evidence contract from full-plan steps, material source routes, and any zero-stock baseline inventory. Return that contract from both manager load and preview, then let the manager use loaded evidence only for an unchanged draft and surface explicit route-loss diagnostics for changed drafts.

**Tech Stack:** Node.js 24+, React, TypeScript, plain CSS, Node built-in test runner, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-30-craft-plan-authoritative-route-evidence-design.md`

## Global Constraints

- Preserve typed item/cargo identity, existing route IDs, review fingerprints, route confirmations, compatibility fields, and provider-neutral Relay boundaries.
- Keep item-detail route information read-only and retain the single Save Plan action.
- Loaded-plan route fallback is allowed only when the staged configuration is calculation-equivalent to the stored configuration.
- Do not introduce a framework, external service, database migration, changelog entry, version bump, push, or deployment.
- Use failing behavior tests before every production-code change.

---

### Task 1: Authoritative server route-evidence contract

**Files:**
- Modify: `apps/bitcraft-local/src/server/craftPlanRouteReview.mjs`
- Modify: `apps/bitcraft-local/server.mjs`
- Test: `apps/bitcraft-local/test/craft-plan-preview-route-review.test.mjs`
- Test: `apps/bitcraft-local/test/server-craft-plan-preview-boundary.test.mjs`

**Interfaces:**
- Consumes: full calculated plans containing `steps`, material `sourceRoutes`, and optional `routeInventory`.
- Produces: `buildCraftPlanRouteEvidence({ plan, fallbackPlan, allowFallback }) -> { routeInventory, evidence, diagnostics }`.
- Produces: authenticated manager responses with `routeInventory`, `routeEvidence`, and `routeDiagnostics`.
- Produces: preview responses with the same evidence labels and diagnostics.

- [ ] **Step 1: Add a failing route-evidence contract test**

Add a real-plan fixture with one Rough Plank material route, two non-transport alternatives, and one transport alternative. Assert literal results:

```js
const evidence = buildCraftPlanRouteEvidence({ plan });
assert.deepEqual(evidence.routeInventory.map(({ outputKey }) => outputKey), ["items:1020003"]);
assert.deepEqual(evidence.routeInventory[0].alternatives.map(({ id }) => id), ["1014176789", "102009"]);
assert.deepEqual(evidence.diagnostics, {
  steps: 0,
  materialSourceRoutes: 1,
  directInventory: 0,
  returnedReviews: 1,
  fallbackReturnedReviews: 0,
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
corepack pnpm exec node --experimental-strip-types --test test/craft-plan-preview-route-review.test.mjs
```

Expected: FAIL because `buildCraftPlanRouteEvidence` is not exported.

- [ ] **Step 3: Implement the minimal route-evidence builder**

In `craftPlanRouteReview.mjs`, retain the existing normalization and fingerprint behavior and expose:

```js
export function buildCraftPlanRouteEvidence({ plan = {}, fallbackPlan = {}, allowFallback = false } = {}) {
  const current = mergedRouteInventory(plan);
  const fallback = current.length || !allowFallback ? [] : mergedRouteInventory(fallbackPlan);
  const routeInventory = current.length ? current : fallback;
  return {
    routeInventory,
    evidence: current.length ? "current" : fallback.length ? "retained" : "none",
    diagnostics: {
      steps: Array.isArray(plan.steps) ? plan.steps.length : 0,
      materialSourceRoutes: countMaterialSourceRoutes(plan),
      directInventory: directRouteInventory(plan).length,
      returnedReviews: routeInventory.length,
      fallbackReturnedReviews: fallback.length,
    },
  };
}
```

Keep `selectCraftPlanRouteInventory` as a compatibility wrapper until all existing callers and tests are migrated.

- [ ] **Step 4: Add failing manager/preview response tests**

Extend the server boundary fixture so the authenticated manager response must expose the full calculated plan's route contract and preview must expose the same diagnostic fields. Assert response behavior through imported helpers or the existing HTTP harness; do not assert source-code text.

- [ ] **Step 5: Run the server test and verify RED**

Run:

```powershell
corepack pnpm exec node --experimental-strip-types --test test/server-craft-plan-preview-boundary.test.mjs
```

Expected: FAIL because manager responses do not contain the route contract.

- [ ] **Step 6: Wire the contract through the server**

In `craftPlanAdminResponse`, derive the contract from `computedPlan` and add its fields to the authenticated response. In `previewCraftPlanConfig`, derive the current contract, use the retained full plan only when `craftPlanRouteFallbackAllowed` returns true, and pass the resulting inventory into `buildCraftPlanPreview`. Return `routeEvidence` and `routeDiagnostics` alongside `routeReviews`.

- [ ] **Step 7: Run focused backend tests and verify GREEN**

Run:

```powershell
corepack pnpm exec node --experimental-strip-types --test test/craft-plan-preview-route-review.test.mjs test/server-craft-plan-preview-boundary.test.mjs
```

Expected: all selected tests pass with zero warnings.

- [ ] **Step 8: Commit Task 1**

```powershell
git add apps/bitcraft-local/src/server/craftPlanRouteReview.mjs apps/bitcraft-local/server.mjs apps/bitcraft-local/test/craft-plan-preview-route-review.test.mjs apps/bitcraft-local/test/server-craft-plan-preview-boundary.test.mjs
git commit -m "fix(craft-plan): make route evidence authoritative"
```

### Task 2: Manager fallback and explicit route-loss state

**Files:**
- Modify: `apps/bitcraft-local/src/pages/craftPlanManagerModel.ts`
- Modify: `apps/bitcraft-local/src/pages/CraftPlanManagerDialog.tsx`
- Test: `apps/bitcraft-local/test/craft-plan-manager-workspaces.test.mjs`
- Test: `apps/bitcraft-local/test/craft-plan-manager-ui.test.mjs`

**Interfaces:**
- Consumes: manager-load `routeInventory`; exact-draft preview `routeReviews`, `routeEvidence`, and `routeDiagnostics`; `draftDirty`.
- Produces: `resolveCraftPlanRouteReviewState({ preview, loadedRouteInventory, draftDirty }) -> { routeReviews, evidence, routeLoss }`.

- [ ] **Step 1: Add failing model tests for the three selection branches**

Add literal fixtures asserting:

```ts
assert.equal(resolveCraftPlanRouteReviewState({
  preview: { routeReviews: [] },
  loadedRouteInventory: roughPlankReviews,
  draftDirty: false,
}).evidence, "loaded_plan");

assert.deepEqual(resolveCraftPlanRouteReviewState({
  preview: { routeReviews: [] },
  loadedRouteInventory: roughPlankReviews,
  draftDirty: true,
}).routeReviews, []);

assert.equal(resolveCraftPlanRouteReviewState({
  preview: { routeReviews: [], routeDiagnostics: { materialSourceRoutes: 1, returnedReviews: 0 } },
  loadedRouteInventory: [],
  draftDirty: true,
}).routeLoss, true);
```

The first catches loss of unchanged loaded evidence, the second catches stale fallback after edits, and the third catches a misleading valid-empty state.

- [ ] **Step 2: Run the model test and verify RED**

Run:

```powershell
corepack pnpm exec node --experimental-strip-types --test test/craft-plan-manager-workspaces.test.mjs
```

Expected: FAIL because `resolveCraftPlanRouteReviewState` does not exist.

- [ ] **Step 3: Implement the minimal model helper**

Prefer non-empty exact-preview reviews. Otherwise use loaded inventory only when `draftDirty` is false. Set `routeLoss` when diagnostics report raw route evidence but zero returned reviews, or when an unchanged loaded plan has routes that the preview omitted.

- [ ] **Step 4: Add a failing rendered-manager regression test**

In the existing React harness, load a plan whose manager response includes the Rough Plank inventory, return an empty successful preview, open Recipe Review, and assert that the rendered output includes `Rough Plank`, both production recipe choices, and a loaded-plan evidence banner. Assert the no-route empty state is absent.

- [ ] **Step 5: Run the UI test and verify RED**

Run:

```powershell
corepack pnpm exec node --experimental-strip-types --test test/craft-plan-manager-ui.test.mjs
```

Expected: FAIL because the dialog currently reads only `currentPreview.routeReviews`.

- [ ] **Step 6: Consume the authoritative inventory in Recipe Review**

Replace the direct `currentPreview.routeReviews` derivation with `resolveCraftPlanRouteReviewState`. Show an informational banner for `loaded_plan`; show an error alert for `routeLoss`; retain the current valid empty state only when `routeLoss` is false. Route selections, confirmations, preview refreshes, and Save Plan continue using the exact staged configuration.

- [ ] **Step 7: Run focused manager tests and verify GREEN**

Run:

```powershell
corepack pnpm exec node --experimental-strip-types --test test/craft-plan-manager-workspaces.test.mjs test/craft-plan-manager-ui.test.mjs
```

Expected: all selected tests pass with zero warnings.

- [ ] **Step 8: Commit Task 2**

```powershell
git add apps/bitcraft-local/src/pages/craftPlanManagerModel.ts apps/bitcraft-local/src/pages/CraftPlanManagerDialog.tsx apps/bitcraft-local/test/craft-plan-manager-workspaces.test.mjs apps/bitcraft-local/test/craft-plan-manager-ui.test.mjs
git commit -m "fix(craft-plan): retain loaded recipe routes"
```

### Task 3: Canonical warnings and integrated verification

**Files:**
- Modify: `apps/bitcraft-local/src/server/craftPlanning.mjs`
- Test: `apps/bitcraft-local/test/craft-planning.test.mjs`
- Test: `apps/bitcraft-local/test/craft-plan-manager-ui.test.mjs`

**Interfaces:**
- Consumes: typed catalogue identity and the entity resolved for that key.
- Produces: catalogue warnings named from canonical entity metadata, without changing the typed ID.

- [ ] **Step 1: Add a failing canonical-warning test**

Provide a caller target named `Comprehensive Codex` with typed key `items:1020003` and catalogue detail named `Rough Plank`. Assert the warning names `Rough Plank (items:1020003)` and does not contain `Comprehensive Codex (items:1020003)`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
corepack pnpm exec node --experimental-strip-types --test test/craft-planning.test.mjs
```

Expected: FAIL because warnings currently interpolate the caller-supplied name.

- [ ] **Step 3: Use canonical resolved names in catalogue warnings**

Keep typed `kind:id` authoritative. Change only warning/display metadata after a successful catalogue lookup; never select or rewrite an ID by name.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
corepack pnpm exec node --experimental-strip-types --test test/craft-planning.test.mjs test/craft-plan-manager-ui.test.mjs
```

Expected: all selected tests pass with zero warnings.

- [ ] **Step 5: Run full automated verification**

Run from the repository root:

```powershell
corepack pnpm --filter @workspace/bitcraft-local test
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: zero test failures and build exit code 0.

- [ ] **Step 6: Run local browser smoke verification**

```powershell
node scripts/start-bitcraft-local-smoke.mjs --force-restart
curl.exe -s http://127.0.0.1:18449/api/local/health
```

Open the T7 plan manager and verify Goals, Recipe Review, route selection staging, Save Plan, and the Rough Plank deep link. Confirm a true no-route plan still shows the valid empty state.

- [ ] **Step 7: Commit Task 3**

```powershell
git add apps/bitcraft-local/src/server/craftPlanning.mjs apps/bitcraft-local/test/craft-planning.test.mjs apps/bitcraft-local/test/craft-plan-manager-ui.test.mjs
git commit -m "fix(craft-plan): clarify canonical route diagnostics"
```

- [ ] **Step 8: Review the completed branch**

Run the repository code-review workflow against the implementation start commit. Resolve every Critical or Important finding, then repeat focused tests for amended code and the full verification commands before reporting completion.
