# Public Profile Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `claim-monitor.com` public product profile, its persisted data, credentials, and production routing while preserving every dedicated Timbersteel capability.

**Architecture:** Replace the dual-profile entry and router with a dedicated-only browser entry plus an exact-host server boundary. Remove all runtime public identity, data, planning, moderation, and legal integrations, then use an explicit one-way cleanup module and protected operational workflow to erase public tables, contaminated backups, credentials, and Caddy sites only after the dedicated-only release passes production verification.

**Tech Stack:** React 19, TypeScript, Vite, Node.js 24, Node built-in SQLite, Node test runner, Bash deployment helpers, GitHub Actions, Caddy 2.11.

**Spec:** `docs/superpowers/specs/2026-08-27-public-profile-removal-design.md`

## Global Constraints

- Preserve all dedicated pages, routes, cookies, local-storage keys, settings, configured claim, active craft plan, collection, history, notifications, Discord, Admin, and `/bot` behavior.
- Preserve owner-role safeguards, Discord guild fencing, shared AppShell chrome, and the stylesheet-entry fix in commit `df38c5c8`.
- Do not remove the dedicated Public Craft Finder, `src/pages/PublicCraftFinderPage.tsx`, `src/pages/publicCraftMath.ts`, `src/styles/public-craft.css`, or `src/server/game-data/publicCraft*` modules.
- Do not create a public-data export.
- Do not automatically drop public tables during ordinary server bootstrap; production cleanup occurs only through the explicit protected removal workflow after the reversible deploy gate.
- Preserve `PUBLIC_URL` and `--no-public-check` in the updater because those names refer to the existing externally reachable Relay deployment check, not the removed public product profile.
- Preserve dedicated privacy-deletion ledger records and Caddy certificate storage.
- Use `secure_delete`, a truncated WAL checkpoint, and `VACUUM` during the maintenance cleanup so deleted public rows are not left in reusable SQLite pages.
- All destructive production paths require the exact confirmation `remove-claim-monitor.com` and must verify every resolved target is beneath `/var/lib/bitcraft-claim-monitor-relay`, `/var/backups/bitcraft-claim-monitor-relay`, or the exact `/etc/caddy/Caddyfile` and `/etc/bitcraft-claim-monitor-relay.env` files.
- The code-removal release uses `0.63.0-beta.13`; post-cleanup repository hygiene uses `0.63.0-beta.14` only if the one-time protected workflow/helper is removed in a second release.

---

### Task 1: Freeze the Dedicated Baseline

**Files:**
- Create: `apps/bitcraft-local/test/dedicated-profile-regression-contract.test.mjs`
- Modify: `apps/bitcraft-local/test/host-profiles.test.mjs`
- Modify: `apps/bitcraft-local/test/host-profile-boundaries.test.mjs`

**Interfaces:**
- Consumes: current dedicated bootstrap, host-boundary, AppShell, Admin, Discord, worker, history, and craft-plan source contracts.
- Produces: preservation assertions that every subsequent task must keep green.

- [ ] **Step 1: Record the dedicated-only source contract before deleting anything**

Add assertions that the maintained code still contains these dedicated anchors:

```js
const requiredDedicatedAnchors = [
  ["src/AppShell.tsx", "const LOCAL_API = \"/api/local\""],
  ["src/AppShell.tsx", "PublicCraftFinderPage"],
  ["src/TimbersteelRoot.tsx", "FeaturebaseProvider"],
  ["server.mjs", "createDiscordGateway"],
  ["server.mjs", "createDiscordOutboxLeaser"],
  ["server.mjs", "craft_plan_settings"],
  ["worker.mjs", "claimId"],
];
for (const [file, anchor] of requiredDedicatedAnchors) {
  assert.match(readFileSync(join(appRoot, file), "utf8"), new RegExp(escapeRegExp(anchor)));
}
```

Also assert that the dedicated security modules and tests remain present: `adminRoleAssignment.mjs`, `discordGuildBoundary.mjs`, `server-default-owner-admin.test.mjs`, and the correct-guild Discord tests.

- [ ] **Step 2: Run the focused baseline tests**

Run:

```text
node --experimental-strip-types --test apps/bitcraft-local/test/dedicated-profile-regression-contract.test.mjs apps/bitcraft-local/test/host-profiles.test.mjs apps/bitcraft-local/test/host-profile-boundaries.test.mjs
```

Expected: PASS against the current dual-profile code; these tests establish preservation rather than removal.

- [ ] **Step 3: Capture the current dedicated frontend storage and route anchors**

Extend the new test with explicit assertions for the current `NAV`, `NAV_GROUPS`, `/bot`, `/terms`, `/privacy`, dedicated cookie constants, and dedicated local-storage prefixes. Do not use a broad snapshot; assert stable identifiers individually so intentional layout changes do not invalidate the rollback safety test.

- [ ] **Step 4: Re-run the focused baseline tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit the baseline**

```text
git add apps/bitcraft-local/test/dedicated-profile-regression-contract.test.mjs apps/bitcraft-local/test/host-profiles.test.mjs apps/bitcraft-local/test/host-profile-boundaries.test.mjs
git commit -m "test: freeze dedicated profile behavior"
```

### Task 2: Restore a Dedicated-Only Browser Entry

**Files:**
- Modify: `apps/bitcraft-local/src/main.tsx`
- Modify: `apps/bitcraft-local/src/styles.css`
- Delete: `apps/bitcraft-local/src/api/profile.ts`
- Delete: `apps/bitcraft-local/src/public/`
- Delete: `apps/bitcraft-local/src/styles/public-shell.css`
- Delete: public-profile UI tests under `apps/bitcraft-local/test/` whose names begin `public-account-`, `public-api-`, `public-auth-`, `public-chrome-`, `public-claim-`, `public-copy-`, `public-moderation`, `public-plan-`, `public-plans`, `public-profile-`, `public-router`, and `public-shell`
- Modify: `apps/bitcraft-local/test/frontend-profile.test.mjs`

**Interfaces:**
- Consumes: default export `TimbersteelRoot()` from `src/TimbersteelRoot.tsx` and shared global CSS imports.
- Produces: a single React entry that never fetches `/api/profile` or imports a public bundle.

- [ ] **Step 1: Change the frontend-profile test to require one entrypoint**

Replace the dual-root assertions with:

```js
assert.match(mainSource, /import TimbersteelRoot from "\.\/TimbersteelRoot"/);
assert.doesNotMatch(mainSource, /loadHostProfile|rootForProfile|PublicRoot|\.\/public\//);
assert.doesNotMatch(mainSource, /capturePublicPlanFragmentSecret/);
assert.match(mainSource, /import "\.\/styles\/app-chrome\.css"/);
```

Run:

```text
node --experimental-strip-types --test apps/bitcraft-local/test/frontend-profile.test.mjs
```

Expected: FAIL because `main.tsx` still selects between two profiles.

- [ ] **Step 2: Replace the dual-root startup with the dedicated root**

Use this entry shape in `src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import TimbersteelRoot from "./TimbersteelRoot";
import "./styles.css";
import "./styles/app-chrome.css";

createRoot(document.getElementById("root")!).render(<TimbersteelRoot />);
```

`TimbersteelRoot` already owns bootstrap loading, Suspense, the route error boundary, and Featurebase, so do not recreate those layers in `main.tsx`.

- [ ] **Step 3: Delete public-only frontend modules and CSS**

Delete `src/public/`, `src/api/profile.ts`, and `src/styles/public-shell.css`. Remove only the `public-shell.css` import from `styles.css`; keep `public-craft.css` and `app-chrome.css` behavior intact.

- [ ] **Step 4: Remove obsolete public UI tests and run the dedicated frontend boundary**

Run:

```text
node --experimental-strip-types --test apps/bitcraft-local/test/frontend-profile.test.mjs apps/bitcraft-local/test/dedicated-profile-regression-contract.test.mjs apps/bitcraft-local/test/public-craft-finder-page-boundary.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: all tests PASS and the production build contains no public root chunk.

- [ ] **Step 5: Commit the frontend removal**

```text
git add -A apps/bitcraft-local/src/main.tsx apps/bitcraft-local/src/api apps/bitcraft-local/src/public apps/bitcraft-local/src/styles apps/bitcraft-local/test
git commit -m "refactor: restore dedicated-only frontend entry"
```

### Task 3: Replace Host Profiles with a Dedicated Host Boundary

**Files:**
- Create: `apps/bitcraft-local/src/server/dedicatedHostBoundary.mjs`
- Modify: `apps/bitcraft-local/server.mjs`
- Delete: `apps/bitcraft-local/src/server/public/`
- Delete: `apps/bitcraft-local/test/public-data.test.mjs`
- Delete: `apps/bitcraft-local/test/public-identity.test.mjs`
- Delete: `apps/bitcraft-local/test/public-moderation.test.mjs`
- Delete: `apps/bitcraft-local/test/public-auth-contract.test.mjs`
- Delete: `apps/bitcraft-local/test/public-auth-routes.test.mjs`
- Delete: `apps/bitcraft-local/test/public-plan-routes.test.mjs`
- Delete: `apps/bitcraft-local/test/public-plans.test.mjs`
- Modify: `apps/bitcraft-local/test/host-profiles.test.mjs`
- Modify: `apps/bitcraft-local/test/host-profile-boundaries.test.mjs`

**Interfaces:**
- Consumes: Node request headers/socket address and existing `send(res, 421, ...)` response behavior.
- Produces: `isDedicatedRequestHost(request, options): boolean` and `isLoopbackAddress(address): boolean`.

- [ ] **Step 1: Write dedicated-host-only expectations**

Use the exact matrix:

```js
assert.equal(isDedicatedRequestHost({ host: "app.timbersteeltrade.com" }, production), true);
assert.equal(isDedicatedRequestHost({ host: "claim-monitor.com" }, production), false);
assert.equal(isDedicatedRequestHost({ host: "www.claim-monitor.com" }, production), false);
assert.equal(isDedicatedRequestHost({ host: "public.localhost" }, development), false);
assert.equal(isDedicatedRequestHost({ host: "localhost" }, development), true);
assert.equal(isDedicatedRequestHost({ host: "evil.example" }, production), false);
```

Retain tests proving forwarded hosts are trusted only from loopback and the direct loopback health exception applies only to `GET /api/local/health`.

Run the two host tests and expect FAIL because the existing resolver still admits the public profile.

- [ ] **Step 2: Implement the focused host boundary**

Move the safe `hostname()` and `isLoopbackAddress()` logic into `dedicatedHostBoundary.mjs`. Return `true` only for `app.timbersteeltrade.com`, permitted local development hosts, or the exact production loopback health exception. Do not return a profile object.

- [ ] **Step 3: Remove public server construction and routing from `server.mjs`**

Remove imports, repositories, OAuth config, public legal snapshot, public data services, public plan services, public moderation, public Admin router, public retention deletion callbacks, `/api/profile`, and `/api/public/**` routing. Keep the host check before session lookup:

```js
if (!isDedicatedRequestHost(requestHostInput(req), hostOptionsFor(url, req))) {
  return send(res, 421, { error: "Unknown host" });
}
```

Ensure an `/api/public/**` request sent with the dedicated host reaches normal API not-found behavior and never static frontend fallback.

- [ ] **Step 4: Delete public server modules and run backend boundaries**

Run:

```text
node --experimental-strip-types --test apps/bitcraft-local/test/host-profiles.test.mjs apps/bitcraft-local/test/host-profile-boundaries.test.mjs apps/bitcraft-local/test/dedicated-profile-regression-contract.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: PASS; `claim-monitor.com` is rejected and dedicated localhost smoke behavior remains.

- [ ] **Step 5: Commit the server boundary**

```text
git add -A apps/bitcraft-local/server.mjs apps/bitcraft-local/src/server apps/bitcraft-local/test
git commit -m "refactor: remove public runtime routing"
```

### Task 4: Remove Public Admin, Legal, Retention, and Privacy Integrations

**Files:**
- Modify: `apps/bitcraft-local/src/components/admin/AdminPanel.tsx`
- Modify: `apps/bitcraft-local/src/components/admin/adminNavigationState.ts`
- Delete: `apps/bitcraft-local/src/components/admin/PublicServiceAdminSection.tsx`
- Modify: `apps/bitcraft-local/src/server/adminPermissions.mjs`
- Modify: `apps/bitcraft-local/src/server/privacyRetention.mjs`
- Modify: `apps/bitcraft-local/src/server/privacyDeletionLedger.mjs`
- Modify: `apps/bitcraft-local/src/legal/legalPolicy.mjs`
- Modify: `apps/bitcraft-local/src/legal/legalPolicy.d.mts`
- Delete: `apps/bitcraft-local/test/public-admin-router.test.mjs`
- Delete: `apps/bitcraft-local/test/public-admin-server-boundary.test.mjs`
- Delete: `apps/bitcraft-local/test/public-account-deletion.test.mjs`
- Delete: `apps/bitcraft-local/test/server-public-users.test.mjs` only if its remaining assertions duplicate dedicated `publicAdminUser`/`publicAppUser` coverage; otherwise rename it to `server-user-projections.test.mjs` and retain dedicated assertions
- Modify: `apps/bitcraft-local/test/server-admin-permissions.test.mjs`
- Modify: `apps/bitcraft-local/test/server-privacy-retention.test.mjs`
- Modify: `apps/bitcraft-local/test/server-privacy-deletion-ledger.test.mjs`

**Interfaces:**
- Consumes: existing dedicated Admin tabs/roles and dedicated legal/privacy functions.
- Produces: Admin permissions and legal/retention modules with no public-service branch.

- [ ] **Step 1: Add failing absence assertions**

Assert that Admin navigation has no `public-service` tab and no `public.health`, `public.lookup`, `public.moderate`, `public.restore`, or `public.privacy` permissions. Assert `legalPolicy.mjs` exports only the dedicated policy and the deletion ledger exports only dedicated coordination/replay functions.

Run the four affected focused tests and expect FAIL.

- [ ] **Step 2: Remove the Admin surface and permissions**

Delete the section component, its import, tab metadata, capability booleans, extracted-message branch, render branch, and navigation-state key. Remove the five public permissions and the `/api/local/admin/public-service/**` mapping from `adminPermissions.mjs`. Preserve every other role and permission unchanged.

- [ ] **Step 3: Remove public legal and privacy branches**

Delete `CLAIM_MONITOR_*`, `claimMonitorProviders`, `claimMonitorRetention`, the public terms/privacy section builders, and `claimMonitorLegalPolicyForEnvironment`. Remove public-account queries/callbacks from retention while leaving all dedicated retention counts and actions unchanged. Remove only `publicDeletionLedgerSubject`, `coordinatePublicPrivacyDeletion`, and `replayPublicPrivacyDeletions`; retain the signed ledger format and dedicated functions.

- [ ] **Step 4: Run focused Admin/privacy tests and build**

```text
node --experimental-strip-types --test apps/bitcraft-local/test/server-admin-permissions.test.mjs apps/bitcraft-local/test/server-privacy-retention.test.mjs apps/bitcraft-local/test/server-privacy-deletion-ledger.test.mjs apps/bitcraft-local/test/admin-navigation-state.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: PASS.

- [ ] **Step 5: Commit the cross-cutting removal**

```text
git add -A apps/bitcraft-local/src/components/admin apps/bitcraft-local/src/server apps/bitcraft-local/src/legal apps/bitcraft-local/test
git commit -m "refactor: remove public account administration"
```

### Task 5: Remove Public Schema Bootstrap and Add the One-Way Data Cleanup

**Files:**
- Modify: `apps/bitcraft-local/src/server/schemaBootstrap.mjs`
- Modify: `apps/bitcraft-local/src/server/schemaMigrations.mjs`
- Create: `apps/bitcraft-local/src/server/retiredPublicProfileCleanup.mjs`
- Create: `apps/bitcraft-local/test/retired-public-profile-cleanup.test.mjs`
- Modify: `apps/bitcraft-local/test/server-schema-bootstrap.test.mjs`
- Modify: `apps/bitcraft-local/test/server-schema-migrations.test.mjs`

**Interfaces:**
- Produces: `RETIRED_PUBLIC_PROFILE_TABLES`, `inspectRetiredPublicProfile(db)`, and `removeRetiredPublicProfileData(db)`.
- Consumes: `DatabaseSync`-compatible `exec()` and `prepare()` methods.

- [ ] **Step 1: Write a mixed-data cleanup test**

Seed an in-memory database with all eight public tables, one row in each dependency chain, a `public.plan.suspended` audit row, and dedicated sentinels in `app_settings`, `craft_plan_settings`, `user_accounts`, `admin_users`, history, notifications, and `discord_notification_outbox`.

Capture dedicated rows before cleanup, call `removeRetiredPublicProfileData(db)`, and assert:

```js
assert.deepEqual(inspectRetiredPublicProfile(db), {
  tables: [],
  publicAuditRows: 0,
});
assert.deepEqual(readDedicatedSentinels(db), before);
assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
```

Also call cleanup a second time and assert it is idempotent. Run the test and expect FAIL because the module does not exist.

- [ ] **Step 2: Implement the cleanup module**

Use the locked child-first table order:

```js
export const RETIRED_PUBLIC_PROFILE_TABLES = Object.freeze([
  "public_craft_plan_events",
  "public_craft_plan_share_links",
  "public_craft_plan_invites",
  "public_craft_plan_members",
  "public_craft_plans",
  "public_user_legal_acceptances",
  "public_user_sessions",
  "public_user_accounts",
]);
```

`removeRetiredPublicProfileData(db)` must run `BEGIN IMMEDIATE`, delete `admin_audit_log` rows with `action LIKE 'public.%'`, drop only tables returned by `sqlite_master`, commit, and roll back on error. It returns before/after inventory and deleted audit count. The caller, not this transaction, performs WAL checkpoint and `VACUUM`.

- [ ] **Step 3: Stop recreating the removed schema**

Delete the public table/index SQL from `schemaBootstrap.mjs` and the four public additive-column entries from `schemaMigrations.mjs`. Update schema tests so a new database contains none of the eight public tables while every dedicated table remains present.

- [ ] **Step 4: Run cleanup and schema tests**

```text
node --experimental-strip-types --test apps/bitcraft-local/test/retired-public-profile-cleanup.test.mjs apps/bitcraft-local/test/server-schema-bootstrap.test.mjs apps/bitcraft-local/test/server-schema-migrations.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the schema change**

```text
git add apps/bitcraft-local/src/server/schemaBootstrap.mjs apps/bitcraft-local/src/server/schemaMigrations.mjs apps/bitcraft-local/src/server/retiredPublicProfileCleanup.mjs apps/bitcraft-local/test/retired-public-profile-cleanup.test.mjs apps/bitcraft-local/test/server-schema-bootstrap.test.mjs apps/bitcraft-local/test/server-schema-migrations.test.mjs
git commit -m "feat: add irreversible public data cleanup"
```

### Task 6: Build the Protected Production Removal Tool

**Files:**
- Create: `deploy/remove-retired-public-profile.mjs`
- Create: `scripts/test/deploy-remove-retired-public-profile.test.mjs`
- Create: `.github/workflows/remove-retired-public-profile.yml`
- Modify: `deploy/database-schema-version`

**Interfaces:**
- Consumes: `removeRetiredPublicProfileData(db)`, `/usr/local/bin/backup-bitcraft-claim-monitor-relay`, `/usr/local/lib/bitcraft-claim-monitor-relay/backup-crypto.mjs`, systemd, and Caddy.
- Produces: `inspect` and `apply` CLI modes guarded by `BITCRAFT_RETIRED_PUBLIC_REMOVAL=1` and exact confirmation `remove-claim-monitor.com`.

- [ ] **Step 1: Write pure transformation and target-safety tests**

Cover these exported helpers from the deploy module:

```js
assert.doesNotMatch(removePublicEnvironmentValues(envSource), /^PUBLIC_(PROFILE|COLLABORATION|LEGAL|ORIGIN|DISCORD|PLAN)/m);
assert.doesNotMatch(removePublicCaddySites(caddySource), /(^|\n)(?:www\.)?claim-monitor\.com\s*\{/);
assert.throws(() => assertPathWithin("/var/backups/bitcraft-claim-monitor-relay", "/var/backups/other.sqlite"));
assert.equal(backupContainsRetiredPublicSchema(cleanDb), false);
assert.equal(backupContainsRetiredPublicSchema(publicDb), true);
```

Test dry-run immutability, duplicate environment keys, symlink rejection, malformed Caddy blocks, backup decrypt failure, database rollback, service restoration, and idempotent second application. Run the focused test and expect FAIL.

- [ ] **Step 2: Implement inspection mode**

`--inspect` must report only counts and paths:

- Eight table-presence flags and row counts.
- Exact count of `admin_audit_log` actions beginning `public.`.
- Public environment key names, never values.
- Presence of the apex and `www` Caddy blocks.
- Each encrypted or plaintext backup whose decrypted schema contains one of the eight retired tables.
- Current dedicated health/fingerprint endpoints and service active states.

It must make no writes.

- [ ] **Step 3: Implement apply mode with maintenance safety**

Require:

```text
BITCRAFT_RETIRED_PUBLIC_REMOVAL=1
--apply
--confirmation remove-claim-monitor.com
```

Acquire the existing deployment and backup locks; stop the web, worker, collector, and collector timer while recording prior states; enable `PRAGMA secure_delete=ON`; call the cleanup function; execute `PRAGMA wal_checkpoint(TRUNCATE)` and `VACUUM`; run `PRAGMA integrity_check`; atomically remove the seven public environment keys; remove only the two public Caddy blocks; validate Caddy before reload; delete only backups proven by schema inspection to contain retired public tables; create and decrypt-verify a new manual backup; restore each previously active service; and verify the dedicated health endpoint.

Keep the temporary Caddy recovery copy only until validation, reload, and dedicated health succeed, then delete it. Never delete Caddy certificate storage or the shared privacy ledger.

- [ ] **Step 4: Add the protected workflow**

The workflow must:

- Require `main` and exact typed confirmation `remove-claim-monitor.com`.
- Run repository build/tests first.
- Run `--inspect` through pinned SSH and upload only its sanitized report.
- Put `--apply` behind the existing `relay-cutover` protected environment.
- Run post-apply dedicated health, worker, collector timer, Discord gateway, configured-claim, active-plan, database integrity, Caddy, and unknown-host checks.
- Never print environment values, OAuth credentials, plan tokens, cookie values, or database rows.

- [ ] **Step 5: Increment the schema marker and run deployment tests**

Change `deploy/database-schema-version` from `3` to `4`, then run:

```text
node --experimental-strip-types --test scripts/test/deploy-remove-retired-public-profile.test.mjs scripts/test/deploy-update-script.test.mjs scripts/test/deploy-update-integration.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the protected cleanup tooling**

```text
git add deploy/remove-retired-public-profile.mjs deploy/database-schema-version scripts/test/deploy-remove-retired-public-profile.test.mjs .github/workflows/remove-retired-public-profile.yml
git commit -m "ops: add protected public profile removal"
```

### Task 7: Remove Public Re-enablement and Credential Paths

**Files:**
- Delete: `.github/workflows/configure-public-caddy.yml`
- Delete: `.github/workflows/enable-public-readonly.yml`
- Delete: `.github/workflows/install-public-oauth-credentials.yml`
- Delete: `deploy/configure-public-caddy.mjs`
- Delete: `deploy/enable-public-readonly.mjs`
- Delete: `deploy/install-public-oauth-credentials.mjs`
- Delete: `scripts/test/deploy-public-readonly-workflow.test.mjs`
- Delete: `scripts/test/deploy-public-readonly-activation.test.mjs`
- Delete: `scripts/test/deploy-public-oauth-workflow.test.mjs`
- Delete: `scripts/test/deploy-public-oauth-credentials.test.mjs`
- Delete: `scripts/test/deploy-public-caddy.test.mjs`
- Delete: `scripts/test/deploy-public-caddy-workflow.test.mjs`
- Modify: `deploy/update-bitcraft-claim-monitor-relay`
- Modify: `deploy/bitcraft-claim-monitor-relay.env.example`
- Modify: `deploy/Caddyfile.example`
- Modify: `deploy/replay-privacy-deletions.mjs`
- Modify: `scripts/test/deploy-update-script.test.mjs`
- Modify: `scripts/test/deploy-update-integration.test.mjs`
- Modify: `scripts/test/deploy-runtime-config.test.mjs`
- Modify: `scripts/test/deploy-cutover-system.test.mjs`
- Modify: `scripts/test/deploy-privacy-replay.test.mjs`

**Interfaces:**
- Consumes: existing ordinary Relay deploy, backup, recovery, cutover, map, and external-health modes.
- Produces: an updater with no command capable of configuring, enabling, authenticating, or validating the removed public profile.

- [ ] **Step 1: Add failing updater/config absence assertions**

Assert the updater, environment example, and active Caddy example contain none of:

```text
--configure-public-caddy
--install-public-oauth-credentials
--enable-public-readonly
--disable-public-readonly
PUBLIC_PROFILE_ENABLED
PUBLIC_COLLABORATION_ENABLED
PUBLIC_LEGAL_CONFIGURATION_CONFIRMED
PUBLIC_ORIGIN
PUBLIC_DISCORD_OAUTH_CLIENT_ID
PUBLIC_DISCORD_OAUTH_CLIENT_SECRET
PUBLIC_PLAN_TOKEN_HMAC_KEY
claim-monitor.com {
www.claim-monitor.com {
```

Also assert the updater still contains `PUBLIC_URL`, `--no-public-check`, backup modes, map modes, ordinary deploy, and rollback. Run the focused deployment tests and expect FAIL.

- [ ] **Step 2: Remove public updater modes and installed helper handling**

Delete only public Caddy/OAuth/read-only arguments, state variables, mode validation, staging, installation, snapshots/restores, dispatch, capability markers, and summaries. Preserve the unrelated external Relay `PUBLIC_URL` check and `SKIP_PUBLIC_CHECK` logic.

- [ ] **Step 3: Remove public workflow/helpers/configuration**

Delete the three enable/configure workflows and helpers. Remove seven public environment lines and the two Caddy blocks. Remove public-account replay from `replay-privacy-deletions.mjs`, retaining dedicated replay behavior.

- [ ] **Step 4: Update deployment contracts**

Remove public-host expectations from runtime config and cutover topology fixtures. Keep `app.timbersteeltrade.com`, `relay.timbersteeltrade.com`, claims routing, maintenance behavior, and canonical dedicated checks unchanged. Delete tests that exist solely for removed helpers.

- [ ] **Step 5: Run all deployment tests**

```text
node --experimental-strip-types --test scripts/test/deploy-*.test.mjs scripts/test/relay-build-artifact.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit re-enablement removal**

```text
git add -A .github/workflows deploy scripts/test
git commit -m "ops: remove public service deployment paths"
```

### Task 8: Remove Operational Documentation and Add a Runtime Boundary Guard

**Files:**
- Delete: `docs/public-claim-monitor-operations.md`
- Delete: `docs/superpowers/plans/2026-08-25-one-deployment-public-claim-monitor.md`
- Delete: `docs/superpowers/plans/2026-08-26-public-shared-chrome.md`
- Delete: `docs/superpowers/specs/2026-08-26-public-shared-chrome-design.md`
- Modify: `docs/privacy-operations-runbook.md`
- Create: `apps/bitcraft-local/test/removed-public-profile-boundary.test.mjs`

**Interfaces:**
- Consumes: final runtime/deployment tree from Tasks 2–7.
- Produces: a guard that permits historical removal records but prevents public product code or configuration from returning.

- [ ] **Step 1: Write the boundary scanner**

Scan runtime source, active deployment configuration, and workflows while excluding `CHANGELOG.md`, `docs/superpowers/specs/2026-08-27-public-profile-removal-design.md`, this plan, `retiredPublicProfileCleanup.mjs`, its test, and the temporary protected removal workflow/helper.

Reject `/api/public/`, `claim-monitor.com`, the seven public environment names, `src/public/`, `public_user_`, `public_craft_plan`, `public-service`, `PublicRoot`, and `PublicAppShell` in all other scanned files. Add positive assertions that the dedicated Public Craft Finder files still exist.

Run the test and expect FAIL until documentation/config references are removed.

- [ ] **Step 2: Remove public operating and implementation instructions**

Delete the public operations runbook and superseded public product implementation/shared-chrome plan documents. Remove public-profile retention and restore instructions from `docs/privacy-operations-runbook.md`; keep its dedicated account and backup procedures unchanged. Retain historical changelog entries and the approved removal design/plan as audit history.

- [ ] **Step 3: Run the boundary scanner and documentation diff check**

```text
node --experimental-strip-types --test apps/bitcraft-local/test/removed-public-profile-boundary.test.mjs
git diff --check
```

Expected: PASS; only the explicit cleanup/audit allowlist contains retired public identifiers.

- [ ] **Step 4: Commit documentation and guard changes**

```text
git add -A docs apps/bitcraft-local/test/removed-public-profile-boundary.test.mjs
git commit -m "docs: retire public profile operations"
```

### Task 9: Prepare and Verify the Reversible Removal Release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `apps/bitcraft-local/package.json`

**Interfaces:**
- Consumes: all code and tests from Tasks 1–8.
- Produces: release `0.63.0-beta.13` ready for review, merge, and the reversible production gate.

- [ ] **Step 1: Add the release entry and version**

Set `apps/bitcraft-local/package.json` to `0.63.0-beta.13`. Move current unreleased notes into a dated `0.63.0-beta.13` section and add user-facing entries:

```text
Removed
- Removed the claim-monitor.com public application, public accounts, collaborative public plans, and public-service administration.
- Removed public OAuth, public feature flags, and public deployment controls.

Security
- Added a protected, one-way production cleanup for retired public data, credentials, backups, and proxy routes.
```

Do not remove historical release entries.

- [ ] **Step 2: Run the complete application verification**

```text
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
node --experimental-strip-types --test scripts/test/deploy-*.test.mjs scripts/test/relay-build-artifact.test.mjs
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Run the local dedicated browser smoke**

```text
node scripts/start-bitcraft-local-smoke.mjs --force-restart
curl.exe -s http://127.0.0.1:18449/api/local/health
```

Browser-check Dashboard, Leaderboard, Members, Professions, Craft Monitor, Craft Planning, Inventory, Construction, Research, Local Market, Global Market, Region, Empires, Map/fullscreen Map, Activity, Public Craft Finder, Craft Calculator, Sync, User Settings, Admin, `/bot`, Terms, and Privacy at desktop and mobile widths. Confirm top bar, navigation, footer, cookies, and preferences match the dedicated baseline.

- [ ] **Step 4: Run a removal-focused source audit**

```text
rg -n "claim-monitor\.com|PUBLIC_PROFILE_ENABLED|PUBLIC_COLLABORATION_ENABLED|PUBLIC_LEGAL_CONFIGURATION_CONFIRMED|PUBLIC_DISCORD_OAUTH|PUBLIC_PLAN_TOKEN|/api/public/|src/public/|public-service" apps/bitcraft-local/src apps/bitcraft-local/server.mjs deploy .github/workflows README.md docs
```

Expected: matches only in the approved removal spec/plan, cleanup module/test, and temporary protected cleanup tool/workflow.

- [ ] **Step 5: Commit the release**

```text
git add CHANGELOG.md apps/bitcraft-local/package.json
git commit -m "chore: prepare 0.63.0-beta.13"
```

### Task 10: Review, Merge, and Deploy the Reversible Gate

**Files:**
- No source changes unless review finds a defect.

**Interfaces:**
- Consumes: verified beta.13 commit on the feature branch.
- Produces: beta.13 active on the Relay host with public runtime unavailable but public tables still recoverable until Task 11.

- [ ] **Step 1: Perform the required code review**

Use the code-review/requesting-code-review workflow against the merge base. Resolve every correctness, dedicated-regression, destructive-target, secret-redaction, and spec-compliance issue, then rerun Task 9 verification.

- [ ] **Step 2: Push the identical branch to both repositories**

```text
git push origin HEAD:codex/remove-public-profile
git push upstream HEAD:codex/remove-public-profile
```

Open pull requests against `main` in `Red463/bitcraft-claim-monitor-relay` and `Red463/bitcraft-claim-monitor`, require their checks, and merge only when the resulting trees are identical for the maintained app/deploy files.

- [ ] **Step 3: Deploy beta.13 from Relay `main`**

Dispatch `Deploy Relay preview` on the merged `main` revision with `force_database_backup=false`. Approve the `relay-preview` environment only after the workflow's build, application tests, deployment contracts, systemd validation, and Caddy validation pass.

- [ ] **Step 4: Verify the reversible production gate**

Check:

```text
https://app.timbersteeltrade.com/api/local/health
https://app.timbersteeltrade.com/?page=dashboard
https://app.timbersteeltrade.com/?page=admin
https://app.timbersteeltrade.com/bot
```

Compare configured claim ID, active craft plan, app settings, user/admin counts, history counts, notification outbox counts, worker health, collector timer health, Discord gateway guild, and application version to the predeployment fingerprint. Confirm requests bearing `Host: claim-monitor.com` receive `421` from the app even though the public Caddy site still exists.

- [ ] **Step 5: Stop if any dedicated regression appears**

If any invariant differs, use the existing updater rollback to the previous release while leaving the retired public profile unavailable. Do not run Task 11 until beta.13 is healthy.

### Task 11: Execute the Irreversible Production Cleanup

**Files:**
- Production state changes only.

**Interfaces:**
- Consumes: healthy beta.13 active release and the protected removal workflow.
- Produces: no public tables, contaminated backups, environment values, Caddy sites, or public credentials.

- [ ] **Step 1: Dispatch protected inspection**

Run `Remove retired public profile` from Relay `main` with confirmation `remove-claim-monitor.com`. Review its sanitized inventory and verify targets are exactly:

```text
/var/lib/bitcraft-claim-monitor-relay/bitcraft-local.sqlite
/var/backups/bitcraft-claim-monitor-relay
/etc/bitcraft-claim-monitor-relay.env
/etc/caddy/Caddyfile
claim-monitor.com
www.claim-monitor.com
```

- [ ] **Step 2: Approve the protected apply job**

Approve the `relay-cutover` environment. The workflow must stop and restore only the recorded service states, erase the eight tables and `public.*` audit entries, checkpoint/VACUUM/integrity-check SQLite, purge only backups whose schema proves they contain retired public tables, make a fresh encrypted verified backup, strip public environment keys, validate/reload the Caddyfile without the two public hosts, and verify dedicated health.

- [ ] **Step 3: Delete repository secrets**

Run for both repositories:

```text
gh secret delete PUBLIC_DISCORD_OAUTH_CLIENT_ID --repo Red463/bitcraft-claim-monitor-relay
gh secret delete PUBLIC_DISCORD_OAUTH_CLIENT_SECRET --repo Red463/bitcraft-claim-monitor-relay
gh secret delete PUBLIC_DISCORD_OAUTH_CLIENT_ID --repo Red463/bitcraft-claim-monitor
gh secret delete PUBLIC_DISCORD_OAUTH_CLIENT_SECRET --repo Red463/bitcraft-claim-monitor
```

Treat “secret not found” as an already-clean state; do not print secret values.

- [ ] **Step 4: Verify irreversible acceptance**

Confirm:

- SQLite inventory reports none of the eight tables and zero `public.*` audit rows.
- `PRAGMA integrity_check` is `ok`.
- No retained encrypted backup decrypts to a schema containing a retired public table.
- A new encrypted post-removal backup decrypts and passes `quick_check`.
- The seven public environment keys are absent.
- `caddy validate --config /etc/caddy/Caddyfile` succeeds.
- `claim-monitor.com` and `www.claim-monitor.com` are absent from active Caddy configuration and do not reach the application.
- Dedicated fingerprints and every service state still match.

- [ ] **Step 5: Complete external user actions**

Ask the user to delete the public Discord application in the Discord Developer Portal and remove the apex/`www` A and AAAA DNS records. Recheck DNS after propagation without attempting to delete Caddy's shared certificate storage.

### Task 12: Remove the One-Time Cleanup Path and Ship Final Hygiene

**Files:**
- Delete: `.github/workflows/remove-retired-public-profile.yml`
- Delete: `deploy/remove-retired-public-profile.mjs`
- Delete: `scripts/test/deploy-remove-retired-public-profile.test.mjs`
- Modify: `apps/bitcraft-local/test/removed-public-profile-boundary.test.mjs`
- Modify: `CHANGELOG.md`
- Modify: `apps/bitcraft-local/package.json`

**Interfaces:**
- Consumes: successful irreversible cleanup receipt from Task 11.
- Produces: final repository with no executable public-profile operational path; only the inert audited schema-cleanup module/test and approved removal documentation remain.

- [ ] **Step 1: Delete the one-time workflow and deploy helper**

Remove the three temporary files. Tighten the boundary scanner by removing their temporary allowlist entries. Keep `retiredPublicProfileCleanup.mjs` and its test as the audited one-way schema tombstone; it is not imported by the server or updater.

- [ ] **Step 2: Prepare beta.14**

Set the package version to `0.63.0-beta.14` and add:

```text
Removed
- Removed the completed one-time public-profile cleanup workflow and production helper.
```

- [ ] **Step 3: Run final verification**

```text
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
node --experimental-strip-types --test scripts/test/deploy-*.test.mjs scripts/test/relay-build-artifact.test.mjs
git diff --check
```

Expected: PASS. The boundary scanner now permits retired identifiers only in the inert cleanup module/test, changelog, and approved removal design/plan.

- [ ] **Step 4: Commit, review, merge, and deploy beta.14**

```text
git add -A .github/workflows deploy scripts/test apps/bitcraft-local/test CHANGELOG.md apps/bitcraft-local/package.json
git commit -m "chore: finalize public profile removal"
```

Push the identical commit to both repositories, merge after checks, and run `Deploy Relay preview` from Relay `main`. Verify version `0.63.0-beta.14`, dedicated routes, worker/collector/Discord health, database integrity, fresh backup verification, and the continued absence of public Caddy routing.

- [ ] **Step 5: Produce the final operator report**

Record the two deployed revisions, versions, dedicated before/after fingerprints, deleted table/audit counts, purged backup filenames and counts, fresh backup verification, removed environment key names, removed GitHub secret names, Caddy validation result, service states, and remaining user actions. Do not record credentials, tokens, cookies, user rows, or plan documents.
