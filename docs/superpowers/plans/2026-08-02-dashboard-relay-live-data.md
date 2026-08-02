# Dashboard Relay Live Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the live Dashboard show the authoritative 85,000 storage cap, current craft data, and player-settlement Region Wealth while stabilizing the Relay subscriptions that currently leave Dashboard dependencies stale.

**Architecture:** Keep the existing provider-neutral `/api/local/game-data` boundary. Add the missing Dashboard domains, derive presentation metrics through small pure view helpers, filter only the known owner-enrichment warning that is irrelevant to Dashboard wealth, and update volatile craft-contribution subscriptions without replacing the broad primary-region connection.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Node.js 24, Node test runner, official `spacetimedb` TypeScript SDK 2.7.0, SQLite current-state repository.

## Global Constraints

- Work only in the standalone Relay clone; do not change the maintained BitJita-backed application or its data.
- Keep `apps/bitcraft-local` and `@workspace/bitcraft-local` as the internal app identity.
- Keep React isolated from Relay and SpacetimeDB wire records.
- Preserve decimal-string handling for 64-bit IDs and large amounts.
- Region Wealth includes only rows where `neutral !== true`.
- Keep genuine stale/unavailable states visible; do not suppress the Dashboard warning globally.
- Missing regional owner usernames are non-blocking for Dashboard wealth only.
- Use the existing provider-neutral route and freshness envelopes; do not add a Dashboard-specific Relay request.
- Use Node.js 24+ and the pinned workspace `pnpm` version.
- Implement production changes test-first and make focused commits.
- Deploy only the Relay services at `relay.timbersteeltrade.com`; Discord remains record-only.

---

### Task 1: Dashboard Domains and Authoritative Metrics

**Files:**
- Modify: `apps/bitcraft-local/test/provider-neutral-browser-data.test.mjs:8-15`
- Modify: `apps/bitcraft-local/test/research-view.test.mjs:10-41`
- Create: `apps/bitcraft-local/test/dashboard-view.test.mjs`
- Modify: `apps/bitcraft-local/src/api/pageDomains.ts:20-25`
- Create: `apps/bitcraft-local/src/pages/dashboardView.ts`
- Modify: `apps/bitcraft-local/src/pages/DashboardPage.tsx:8-70`

**Interfaces:**
- Consumes: `researchSettlementCaps(claim: AnyRecord, technologies: AnyRecord[])` from `src/pages/researchView.ts`.
- Produces: `dashboardRegionWealth(rows: AnyRecord[]): { settlements: AnyRecord[]; settlementCount: number; treasury: number }`.
- Produces: Dashboard requests for `research`, `crafts`, and `region-claims`.

- [ ] **Step 1: Update the domain test to require every Dashboard input**

Change the Dashboard expectation to:

```js
assert.deepEqual(pageDomains("dashboard"), [
  "claim",
  "members",
  "citizens",
  "players",
  "construction",
  "market",
  "research",
  "crafts",
  "region-claims",
]);
```

- [ ] **Step 2: Add failing metric tests**

Extend `research-view.test.mjs` with an unresearched larger cap and the current learned capacity:

```js
test("research settlement caps use the greatest learned supply capacity", () => {
  assert.deepEqual(viewModule.researchSettlementCaps(
    {},
    [
      { id: "1826500486", state: "researched", isResearched: true, supplies: "30000" },
      { id: "1157053499", state: "researched", isResearched: true, supplies: "50000" },
      { id: "688169271", state: "researched", isResearched: true, supplies: "85000" },
      { id: "733358069", state: "locked", supplies: "115000" },
    ],
  ), {
    maxTiles: 0,
    maxSupplies: 85000,
  });
});
```

Create `dashboard-view.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

const { dashboardRegionWealth } = await import(
  new URL("../src/pages/dashboardView.ts", import.meta.url).href,
);

test("Dashboard Region Wealth includes only player-run settlements", () => {
  const result = dashboardRegionWealth([
    { entityId: "1", name: "Timbersteel Trade", neutral: false, treasury: "2789" },
    { entityId: "2", name: "Player Town", neutral: false, treasury: "10000" },
    { entityId: "3", name: "Sunken Ruin", neutral: true, treasury: "999999" },
  ]);

  assert.equal(result.settlementCount, 2);
  assert.equal(result.treasury, 12789);
  assert.deepEqual(result.settlements.map((row) => row.entityId), ["1", "2"]);
});
```

- [ ] **Step 3: Run the focused tests and verify red**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/provider-neutral-browser-data.test.mjs test/research-view.test.mjs test/dashboard-view.test.mjs
```

Expected: the domain assertion fails and `dashboardView.ts` cannot be imported.

- [ ] **Step 4: Add the missing page domains**

Change the Dashboard branch in `pageDomains.ts` to:

```ts
case "dashboard":
  return [
    "claim",
    "members",
    "citizens",
    "players",
    "construction",
    "market",
    "research",
    "crafts",
    "region-claims",
  ];
```

- [ ] **Step 5: Implement the pure Region Wealth helper**

Create `dashboardView.ts`:

```ts
import { toNumber, type AnyRecord } from "../main-app-data.ts";

export function dashboardRegionWealth(rows: AnyRecord[]) {
  const settlements = rows.filter((row) => row.neutral !== true);
  return {
    settlements,
    settlementCount: settlements.length,
    treasury: settlements.reduce(
      (total, row) => total + toNumber(row.treasury),
      0,
    ),
  };
}
```

- [ ] **Step 6: Wire authoritative metrics into Dashboard**

In `DashboardPage.tsx`:

```ts
import { researchSettlementCaps } from "./researchView";
import { dashboardRegionWealth } from "./dashboardView";
```

Replace the claim-only capacity and unfiltered wealth calculations with:

```ts
const { claim, members, market, construction, crafts, research } = data;
const { maxSupplies: supplyCap } = researchSettlementCaps(claim, research);
const {
  settlements: regionSettlements,
  settlementCount: regionSettlementCount,
  treasury: regionWealth,
} = dashboardRegionWealth(data.region);
const regionWealthDetail = regionSettlementCount
  ? `${formatNumber(regionSettlementCount)} player settlement${regionSettlementCount === 1 ? "" : "s"} in region`
  : "Region data loading";
```

Keep the existing capacity percentage and formatting, but render the Region Wealth value based on `regionSettlementCount`.

- [ ] **Step 7: Run the focused tests and verify green**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/provider-neutral-browser-data.test.mjs test/research-view.test.mjs test/dashboard-view.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 8: Commit the Dashboard data slice**

```powershell
git add apps/bitcraft-local/src/api/pageDomains.ts apps/bitcraft-local/src/pages/dashboardView.ts apps/bitcraft-local/src/pages/DashboardPage.tsx apps/bitcraft-local/test/provider-neutral-browser-data.test.mjs apps/bitcraft-local/test/research-view.test.mjs apps/bitcraft-local/test/dashboard-view.test.mjs
git commit -m "fix: show authoritative Relay Dashboard metrics"
```

---

### Task 2: Dashboard-Relevant Warnings and Honest Manual Refresh

**Files:**
- Create: `apps/bitcraft-local/src/api/pageGameDataWarnings.ts`
- Create: `apps/bitcraft-local/test/page-game-data-warnings.test.mjs`
- Modify: `apps/bitcraft-local/src/AppShell.tsx:785-840`
- Modify: `apps/bitcraft-local/test/appshell-chrome-boundary.test.mjs:15-42`

**Interfaces:**
- Produces: `pageGameDataWarnings(activePanel: ActivePanel, warnings: string[]): string[]`.
- Consumes: `state.stale` and the manual refresh coordinator status already present in `AppShell.tsx`.

- [ ] **Step 1: Write the failing page-warning test**

Create `page-game-data-warnings.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

const { pageGameDataWarnings } = await import(
  new URL("../src/api/pageGameDataWarnings.ts", import.meta.url).href,
);

test("Dashboard ignores missing owner enrichment but preserves operational warnings", () => {
  const warnings = [
    "region-claims: Regional claims missing owner usernames: 999.",
    "research: data is stale.",
  ];
  assert.deepEqual(pageGameDataWarnings("dashboard", warnings), [
    "research: data is stale.",
  ]);
  assert.deepEqual(pageGameDataWarnings("region", warnings), warnings);
});
```

Add assertions to `appshell-chrome-boundary.test.mjs` proving that completed manual refreshes treat stale data as an issue:

```js
assert.match(appShell, /manualRefreshIssueCount/);
assert.match(appShell, /state\.stale \? 1 : 0/);
assert.match(appShell, /Refresh finished with issues/);
assert.match(appShell, /pageGameDataWarnings\(active, partialErrors\)/);
```

- [ ] **Step 2: Run the focused tests and verify red**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/page-game-data-warnings.test.mjs test/appshell-chrome-boundary.test.mjs
```

Expected: `pageGameDataWarnings.ts` is absent and the stale-manual-refresh assertion fails.

- [ ] **Step 3: Implement page-specific warning relevance**

Create `pageGameDataWarnings.ts`:

```ts
import type { ActivePanel } from "../types/app.ts";

const DASHBOARD_OWNER_ENRICHMENT_WARNING =
  /^region-claims: Regional claims missing owner usernames: \d+\.$/;

export function pageGameDataWarnings(
  activePanel: ActivePanel,
  warnings: string[],
): string[] {
  if (activePanel !== "dashboard") return warnings;
  return warnings.filter(
    (warning) => !DASHBOARD_OWNER_ENRICHMENT_WARNING.test(warning),
  );
}
```

- [ ] **Step 4: Use relevant warnings and stale-aware refresh status**

Import `pageGameDataWarnings` in `AppShell.tsx`. Change:

```ts
const manualRefreshIssueCount = manualRefreshState.errors.length
  + (state.stale ? 1 : 0);
const manualRefreshHasErrors = manualRefreshState.status === "complete"
  && manualRefreshIssueCount > 0;
```

When rendering the completed status, use `manualRefreshIssueCount` for the
singular/plural issue count. When announcing completion in the effect, use
`manualRefreshHasErrors` rather than checking only
`manualRefreshState.errors.length`, and include `manualRefreshHasErrors` in the
effect dependency array.

In `apiWarnings`, replace the raw partial error append with:

```ts
const partialErrors = Array.isArray(data.raw?.partialErrors)
  ? data.raw.partialErrors.map((error) => String(error))
  : [];
const relevantPartialErrors = pageGameDataWarnings(active, partialErrors);
```

Append `relevantPartialErrors` and include `active` in the memo dependencies.

- [ ] **Step 5: Run the focused tests and verify green**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/page-game-data-warnings.test.mjs test/appshell-chrome-boundary.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit warning and refresh behaviour**

```powershell
git add apps/bitcraft-local/src/api/pageGameDataWarnings.ts apps/bitcraft-local/src/AppShell.tsx apps/bitcraft-local/test/page-game-data-warnings.test.mjs apps/bitcraft-local/test/appshell-chrome-boundary.test.mjs
git commit -m "fix: keep Dashboard freshness warnings relevant"
```

---

### Task 3: Update Contribution Scope Without Restarting Primary-Region Data

**Files:**
- Modify: `apps/bitcraft-local/test/primary-region-player-session.test.mjs:1-480`
- Modify: `apps/bitcraft-local/test/primary-region-runtime.test.mjs:1-535`
- Modify: `apps/bitcraft-local/src/server/game-data/primaryRegionPlayerSession.ts:20-610`
- Modify: `apps/bitcraft-local/src/server/game-data/primaryRegionRuntime.ts:10-430`

**Interfaces:**
- Produces: `RelayPrimaryRegionPlayerSession.updateContributionScope(targets: CraftContributionTarget[], warnings?: string[]): void`.
- Consumes: the existing SpacetimeDB `SubscriptionHandle.unsubscribe()` and `subscriptionBuilder().subscribe(queries)` APIs.
- Preserves: broad-session restart on claim, region, member identity, topology, or schema changes.

- [ ] **Step 1: Add a failing session test for dynamic contribution subscriptions**

Extend `primary-region-player-session.test.mjs`:

```js
test("primary-region session replaces contribution queries without replacing base data", async () => {
  const fake = fakeBindings();
  const session = new sessionModule.RelayPrimaryRegionPlayerSession({
    loadBindings: async () => fake.module,
    onSnapshot: () => {},
  });
  const first = {
    craftEntityId: "9001",
    profession: "Forestry",
    craftLabel: "Planks",
    structureName: "Forester",
    itemTier: "3",
    xpPerProgress: "2",
  };
  const second = { ...first, craftEntityId: "9002", craftLabel: "Beams" };

  await session.start({
    uri: "wss://relay.example:4000",
    database: "bitcraft-live-19",
    schemaFingerprint: "regional-v1",
    manifest,
    generation: 1,
    regionId: "19",
    claimId: "1369094286777412590",
    members: [{ playerEntityId: "101", userName: "Ada" }],
    contributionTargets: [first],
  });
  fake.state.onConnect(fake.connection);

  const base = fake.state.subscriptions[0];
  const initialContribution = fake.state.subscriptions[1];
  assert.doesNotMatch(base.queries.join("\n"), /progressive_action_state/);
  assert.match(initialContribution.queries.join("\n"), /entity_id = 9001/);

  session.updateContributionScope([second], []);

  assert.equal(base.unsubscribed, false);
  assert.equal(initialContribution.unsubscribed, true);
  assert.match(fake.state.subscriptions[2].queries.join("\n"), /entity_id = 9002/);
  assert.equal(fake.state.disconnected, false);
});
```

Update the existing contribution-event test to read the contribution query from `fake.state.subscriptions[1]`, not the base query.

- [ ] **Step 2: Add a failing runtime test proving no broad restart**

Add to `primary-region-runtime.test.mjs`:

```js
test("primary-region runtime updates contribution scope without restarting member data", async () => {
  const starts = [];
  const stops = [];
  const updates = [];
  const runtime = new runtimeModule.RelayPrimaryRegionRuntime({
    manifest: { schemas: { regional: { fingerprint: "regional-v1", bindingsGenerated: true } } },
    discoverTopology: async () => topology(),
    createSession: () => ({
      start: async (config) => starts.push(config),
      updateContributionScope: (targets, warnings) => updates.push({ targets, warnings }),
      stop: async () => stops.push(true),
      health: () => ({ connected: true, applied: true, lastAppliedAt: null, lastError: null }),
    }),
    currentStateRepository: {
      nextGeneration: () => 1,
      commitGeneration: () => {},
    },
  });
  const members = [{ playerEntityId: "101", userName: "Ada" }];
  const first = [{
    craftEntityId: "9001",
    profession: "Forestry",
    craftLabel: "Planks",
    structureName: "Forester",
    itemTier: "3",
    xpPerProgress: "2",
  }];
  const second = [{ ...first[0], craftEntityId: "9002" }];

  await runtime.start({
    relayBaseUrl: "https://relay.example",
    claimId: "1",
    regionId: "19",
    members,
    contributionTargets: first,
  });
  await runtime.reconcile({
    claimId: "1",
    regionId: "19",
    members,
    contributionTargets: second,
    contributionWarnings: ["one target changed"],
  });

  assert.equal(starts.length, 1);
  assert.deepEqual(stops, []);
  assert.deepEqual(updates, [{ targets: second, warnings: ["one target changed"] }]);
});
```

- [ ] **Step 3: Run the focused tests and verify red**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/primary-region-player-session.test.mjs test/primary-region-runtime.test.mjs
```

Expected: `updateContributionScope` is missing and the runtime still replaces the session.

- [ ] **Step 4: Split base and contribution subscription handles**

In `RelayPrimaryRegionPlayerSession`:

```ts
#baseSubscription: SubscriptionHandle | null = null;
#contributionSubscription: SubscriptionHandle | null = null;
```

Remove `contributionQueries(...)` from the base `queries` array. After creating the base subscription in `onConnect`, call a private replacement method:

```ts
#replaceContributionSubscription(connection: BindingConnection): void {
  this.#contributionSubscription?.unsubscribe();
  this.#contributionSubscription = null;
  const queries = contributionQueries(this.#config?.contributionTargets ?? []);
  if (!queries.length) return;
  this.#contributionSubscription = connection.subscriptionBuilder()
    .onApplied(() => this.#queueSnapshot())
    .onError((_context, error) => this.#recordError(error))
    .subscribe(queries);
}
```

Add the public method:

```ts
updateContributionScope(
  targets: CraftContributionTarget[],
  warnings: string[] = [],
): void {
  if (!this.#config) {
    throw new Error("Relay primary-region player session is not started");
  }
  this.#config = {
    ...this.#config,
    contributionTargets: [...targets],
    contributionWarnings: [...warnings],
  };
  if (this.#connection) {
    this.#replaceContributionSubscription(this.#connection);
    this.#queueSnapshot();
  }
}
```

On `stop()`, unsubscribe and clear `#contributionSubscription` before disconnecting.

- [ ] **Step 5: Separate stable and volatile runtime signatures**

Change `RegionalSession` in `primaryRegionRuntime.ts` to include:

```ts
updateContributionScope?(
  targets: ContributionTarget[],
  warnings?: string[],
): void;
```

Make `sessionSignature` contain only `membershipSignature(regionId, members)`. Track `#contributionSignature` separately, including both targets and normalized warnings.

In `reconcile()`:

```ts
const contributionScopeSignature = contributionSessionSignature(
  contributionTargets,
  contributionWarnings,
);
const contributionChanged =
  contributionScopeSignature !== this.#contributionSignature;

if (sameScope && contributionChanged) {
  this.#session?.updateContributionScope?.(
    contributionTargets,
    contributionWarnings,
  );
  this.#contributionSignature = contributionScopeSignature;
}
```

Run this update before the topology cadence early return. Set the contribution signature after a successful session start and clear it on stop/replacement.

- [ ] **Step 6: Run focused session tests and verify green**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/primary-region-player-session.test.mjs test/primary-region-runtime.test.mjs
```

Expected: all primary-region session and runtime tests pass.

- [ ] **Step 7: Commit subscription stability**

```powershell
git add apps/bitcraft-local/src/server/game-data/primaryRegionPlayerSession.ts apps/bitcraft-local/src/server/game-data/primaryRegionRuntime.ts apps/bitcraft-local/test/primary-region-player-session.test.mjs apps/bitcraft-local/test/primary-region-runtime.test.mjs
git commit -m "fix: update Relay contribution scope in place"
```

---

### Task 4: Full Verification, Review, and Release Metadata

**Files:**
- Modify: `CHANGELOG.md:8-12`
- Modify: `apps/bitcraft-local/package.json:3`

**Interfaces:**
- Produces: release `0.50.0-beta.5`.
- Preserves: no dependency or lockfile changes.

- [ ] **Step 1: Run the production build**

```powershell
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: provider/server compilation, asset verification, TypeScript, Vite, and Relay boundary verification all pass.

- [ ] **Step 2: Run the complete app test suite**

```powershell
corepack pnpm --filter @workspace/bitcraft-local test
```

Expected: all tests pass with no real Discord delivery.

- [ ] **Step 3: Inspect the complete diff**

```powershell
git diff --check
git diff origin/main...HEAD
git status --short
```

Confirm that only the approved Dashboard, warning, primary-region subscription, tests, design/plan, changelog, and package-version files are present.

- [ ] **Step 4: Run the repository code-review workflow**

Use the `code-review` skill against `origin/main`. Address only actionable findings within this approved scope, then rerun the focused test covering each correction.

- [ ] **Step 5: Update the release notes and version**

Move the Dashboard changes into:

```markdown
## [0.50.0-beta.5] - 2026-08-02

### Fixed

- Fixed Dashboard storage capacity, production, and player-settlement regional wealth using authoritative Relay data.
- Prevented craft-contribution scope updates from restarting unrelated primary-region subscriptions.
- Kept Dashboard warnings focused on data required by its visible metrics.
```

Set `apps/bitcraft-local/package.json`:

```json
"version": "0.50.0-beta.5"
```

- [ ] **Step 6: Re-run build and tests after versioning**

```powershell
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
```

Expected: both commands pass.

- [ ] **Step 7: Commit the release**

```powershell
git add CHANGELOG.md apps/bitcraft-local/package.json docs/superpowers/plans/2026-08-02-dashboard-relay-live-data.md
git commit -m "chore: prepare 0.50.0-beta.5"
```

---

### Task 5: Publish, Deploy, and Verify Live Dashboard

**Files:**
- No source files changed.

**Interfaces:**
- Consumes: GitHub repository `Red463/bitcraft-claim-monitor-relay`.
- Consumes: manual `Deploy Relay preview` GitHub Actions workflow on `main`.
- Produces: verified deployment at `https://relay.timbersteeltrade.com/`.

- [ ] **Step 1: Push the focused branch**

```powershell
git push -u origin codex/dashboard-relay-live-data
```

Expected: branch is present on the standalone relay repository.

- [ ] **Step 2: Create and merge the reviewed pull request**

Create a pull request targeting `main`, verify required checks, and merge only after they pass. Record the exact merge SHA.

- [ ] **Step 3: Dispatch the exact main revision**

```powershell
gh workflow run deploy-relay-preview.yml --repo Red463/bitcraft-claim-monitor-relay --ref main
```

Watch the dispatched run:

```powershell
gh run watch --repo Red463/bitcraft-claim-monitor-relay --exit-status
```

Expected: verify and deploy jobs succeed for the merged `main` revision.

- [ ] **Step 4: Verify the public health endpoint**

```powershell
curl.exe -s https://relay.timbersteeltrade.com/api/local/health
```

Confirm:

- `ok` is `true`.
- The deployed app version is `0.50.0-beta.5`.
- Relay topology and cache readiness are healthy.
- Primary-region subscription health is connected and applied.

- [ ] **Step 5: Verify provider envelopes**

Request:

```text
https://relay.timbersteeltrade.com/api/local/game-data?claimId=1369094286777412590&domains=claim,research,crafts,region-claims,players,construction,market
```

Confirm:

- `research`, `crafts`, and `region-claims` contain data.
- Primary-region domains are `live` or `fresh`, not silently stale.
- The learned research rows include the 85,000 maximum-supplies technology.
- Regional claim rows include `neutral` and `treasury`.

- [ ] **Step 6: Browser-verify the live Dashboard**

Open:

```text
https://relay.timbersteeltrade.com/?page=dashboard
```

Confirm visually and through page state:

- Storage cap displays `85,000`.
- Capacity percentage uses 85,000.
- Region Wealth is nonblank and counts player settlements only.
- Production/craft diagnostics are populated.
- The refresh issue banner is absent while the requested domains are healthy.
- No console error appears.

- [ ] **Step 7: Inspect post-deployment service logs**

Read the latest Relay worker logs and confirm that subscription scope updates no longer create a sustained `SubscribeApplied for unknown querySetId` or cache-delete warning loop. A one-off reconnect during deployment is acceptable; continuous warning churn is not.

- [ ] **Step 8: Record completion**

Report:

- Merge SHA and deployed workflow run.
- Live version.
- Health and envelope freshness.
- Observed storage cap, Region Wealth state, and craft count.
- Any remaining genuine Relay warnings.
