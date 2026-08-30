# Craft Plan Authoritative Route Evidence Design

## Problem

Recipe selection worked when both the manager and item-detail chooser consumed `steps` and material `sourceRoutes` from the full calculated plan. The four-workspace manager replaced that path with an authenticated preview request whose `routeReviews` are rediscovered from a separate zero-stock baseline.

Production now demonstrates a split-brain result for the same personal plan and output:

- Rough Plank item details contain three routes and a selected recipe.
- Following the item-detail link to Recipe Review produces a successful preview with zero route reviews.
- No calculation validation error, HTTP error, or browser console error is shown.
- The provider-neutral recipe-detail endpoint still returns the expected catalogue routes.

Removing probability and selectability filters did not change the result, proving that the empty inventory is upstream of React filtering.

## Root Cause

The regression was introduced when Recipe Review stopped consuming the known-good full-plan route evidence and became exclusively dependent on a second discovery path:

- `72d375237f19a027aa8d4e9552416bc31d2136e6` introduced preview route review.
- `aece139cc014d50730f64b45787f273cc0e99d30` removed the working manager and item-detail selectors and made Recipe Review preview-only.

The current contract can return a valid-looking empty preview even while the manager's full calculated plan contains reviewable routes. It also exposes no stage-by-stage counts, so it cannot distinguish an intentionally route-free plan from route evidence lost during preview construction.

The T7 preset identity is not the cause. Comprehensive Codex is canonically `items:2080555135`; `output=items:1020003` is a Rough Plank dependency focus key.

## Goals

- Use one authoritative route inventory across manager load, item details, and Recipe Review.
- Preserve staged route and buffer changes and the single Save Plan action.
- Keep complete zero-stock dependency coverage when it is available.
- Fall back to the loaded full-plan inventory only for an unchanged draft.
- Never silently substitute stale routes after targets, routes, gathered overrides, or buffers change.
- Distinguish a genuinely route-free plan from lost route evidence.
- Preserve typed `items:<id>` and `cargo:<id>` identity and existing review fingerprints.

## Non-goals

- Do not restore immediate route saves in item details.
- Do not replace the four-workspace manager.
- Do not change recipe-selection policy, probability calculations, or catalogue authority.
- Do not migrate the live plan based on its dependency deep link.
- Do not add a framework, service, or database migration.

## Design

### Authoritative server contract

`craftPlanRouteReview.mjs` will expose one route-evidence contract builder. It will merge direct `plan.routeInventory`, `plan.steps`, and material `sourceRoutes`, retaining one review per typed output key. It will return:

```js
{
  routeInventory: RouteReview[],
  evidence: "current" | "retained" | "none",
  diagnostics: {
    steps: number,
    materialSourceRoutes: number,
    directInventory: number,
    returnedReviews: number,
    fallbackReturnedReviews: number
  }
}
```

The manager-load response will include the contract derived from its full calculated plan. Preview will use the same builder for the staged calculation and may use the retained plan only when the normalized staged configuration is calculation-equivalent to the stored configuration.

The zero-stock baseline remains useful for discovering dependencies suppressed by live stock. It contributes to `plan.routeInventory`, but it is no longer a separate UI-only source of truth.

### Manager selection rules

Recipe Review resolves its visible inventory in this order:

1. Non-empty route reviews returned for the exact current draft.
2. For an unchanged draft only, the authoritative inventory returned by manager load.
3. An explicit route-evidence diagnostic when the loaded plan has routes but the exact preview loses them.
4. The existing valid empty state only when neither source has routes and diagnostics do not indicate loss.

Loaded-plan fallback is display evidence, not an immediate mutation. Selecting a route still updates the staged configuration, triggers a preview for that exact draft, and is persisted only by Save Plan.

### Error handling and observability

Preview responses will expose route diagnostics without actor identity or sensitive source data. The manager will show a concise error when a changed draft loses route evidence, rather than claiming no recipes exist.

Catalogue warnings will use the canonical entity name resolved from the typed key, so a caller-supplied display name cannot make an unrelated identity look corrupt.

### Compatibility

- Existing `routeReviews`, fingerprints, confirmations, and route overrides remain readable.
- The additional manager/preview fields are additive.
- Public compact plan responses remain compact; only authenticated manager responses receive the full route inventory.
- Hidden drafts remain editable when catalogue evidence is incomplete. Public-plan ambiguity gates continue to use the exact staged preview.

## Verification

- A full calculated plan with routes followed by an empty unchanged preview must still populate Recipe Review.
- A changed draft must never reuse the loaded plan's stale inventory.
- A true no-route plan must keep the current empty state.
- Route diagnostics must identify current, retained, and missing evidence counts.
- T7 preset target identity remains `items:2080555135`, while `items:1020003` focuses Rough Plank without changing the target.
- Focused backend and manager tests, the full test suite, production build, local browser smoke, and the exact production workflow are required before release.
