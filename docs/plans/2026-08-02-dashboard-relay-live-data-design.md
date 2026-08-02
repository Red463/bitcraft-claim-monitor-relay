# Dashboard Relay Live Data Design

Date: 2026-08-02

## Goal

Make the Dashboard show authoritative Relay-backed settlement capacity, production, and regional wealth while removing the current false blank and zero states. Repair the primary-region subscription instability that leaves Dashboard dependencies stale instead of hiding legitimate freshness warnings.

## Confirmed Causes

- The Dashboard requests `claim`, `members`, `citizens`, `players`, `construction`, and `market`, but does not request `research`, `crafts`, or `region-claims`.
- Storage capacity is not present in the joined claim response. It is derived from learned `claim_tech_state` IDs joined to global `claim_tech_desc` rows.
- Relay Explorer shows that Timbersteel Trade has learned the 30,000, 50,000, and 85,000 maximum-supplies technologies. The current authoritative capacity is therefore 85,000.
- Regional wealth is already implemented as a sum over normalized regional claim treasuries, but the missing `region-claims` request leaves the input empty.
- The Dashboard craft count and production summaries receive an empty collection because `crafts` is not requested.
- Primary-region subscription health is becoming stale while the worker emits repeated subscription apply/delete warnings. The runtime currently includes changing craft-contribution scope in the signature of the session that also owns players, construction, research, recruitment, equipment, inventories, and contribution state. Reconciliation can therefore restart the broad session when only contribution scope changes.

## Chosen Approach

Use a focused end-to-end fix rather than a UI-only fallback or a new Dashboard-specific aggregate endpoint.

The browser will continue using the provider-neutral `/api/local/game-data` contract. The Dashboard page-domain declaration will add:

- `research`, for learned maximum-supplies technology.
- `crafts`, for current production and diagnostic counts.
- `region-claims`, for regional treasury aggregation.

No Relay wire record will enter React directly, and no new browser-to-Relay request will be introduced.

## Storage Capacity

The Dashboard will calculate capacity from the normalized research domain using the same learned-technology semantics as the Research page:

1. Keep only technologies marked researched.
2. Read the normalized `supplies` value from learned maximum-supplies technologies.
3. Use the greatest learned capacity, with the existing direct claim-cap fields retained as a compatibility fallback.
4. Show `Unknown` only when neither an authoritative learned value nor a valid direct value exists.

For the current Timbersteel Trade data, the displayed value will be `85,000`, and the capacity percentage will use that denominator.

## Region Wealth

Region Wealth will sum `treasury` across the normalized `region-claims` rows for the configured region, excluding rows where `neutral` is true.

This definition includes player-run settlements only and excludes neutral ruins, dungeons, and other system claims. The Dashboard will not use rows from another region or another configured claim source.

Missing owner usernames do not invalidate the treasury calculation because ownership labels are not required for this metric. That enrichment warning may remain visible on pages that display owners, but it must not turn the Dashboard into an error state by itself.

## Subscription Stability

The primary-region runtime must keep the broad member and settlement subscriptions connected when only craft-contribution targets or their warnings change.

The implementation will separate stable session scope from volatile contribution scope:

- Member identities, configured claim, region, and Relay source remain session-defining.
- Contribution target changes must not repeatedly tear down and recreate unrelated player, construction, research, recruitment, equipment, and inventory subscriptions.
- If the SpacetimeDB client cannot safely replace only the contribution queries within the existing connection, contribution reconciliation will be isolated behind a narrowly scoped session or deferred to an explicit stable refresh boundary. It must not regress contribution data correctness.
- Topology/schema changes and actual member-scope changes will continue to restart the affected session.
- Genuine disconnected, stale, or schema-incompatible states will continue to surface through freshness envelopes and the Dashboard warning banner.

The implementation choice between in-session contribution replacement and a dedicated contribution session will be based on the smallest change supported by the existing session abstraction and tests.

## Error and Freshness Behaviour

- The Dashboard remains readable from last-good snapshots during an outage.
- A genuinely stale requested dependency continues to show the existing refresh issue.
- Missing owner-name enrichment from `region-claims` will not be treated as a Dashboard-blocking error.
- Manual refresh will not claim that all data is live if requested envelopes remain stale.
- No warning will be suppressed globally merely to make the Dashboard appear healthy.

## Tests

Focused tests will cover:

- Dashboard page domains include `research`, `crafts`, and `region-claims`.
- Storage capacity selects the greatest learned researched supply-cap value.
- Region Wealth includes non-neutral claims and excludes neutral/system claims.
- Missing regional owner usernames do not invalidate the Dashboard wealth metric.
- Unchanged member/source scope does not restart the broad primary-region session when contribution scope changes.
- Actual member, region, topology, or schema changes still reconcile correctly.
- Stale last-good data still produces honest freshness state.

After focused red-green-refactor cycles, verification will run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
```

## Deployment and Verification

After tests and review pass:

1. Update the beta release metadata and changelog for the production deployment.
2. Commit and push the focused branch.
3. Deploy the relay service beside the maintained application.
4. Restart only the relay units affected by the release.
5. Verify service health and recent logs.
6. Browser-check `https://relay.timbersteeltrade.com/?page=dashboard`.
7. Confirm the Dashboard shows an 85,000 storage cap, nonblank player-settlement Region Wealth, correct craft data, and no stale banner when all required subscriptions are healthy.

The maintained BitJita-backed application and its data remain unchanged.
