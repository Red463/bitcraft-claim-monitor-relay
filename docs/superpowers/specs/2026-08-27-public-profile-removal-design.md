# Public Profile Removal Design

**Date:** 2026-08-27
**Status:** Approved
**Scope:** Remove the `claim-monitor.com` public product profile and all of its data and deployment paths while preserving the dedicated application at `app.timbersteeltrade.com`.

## Objective

Return the maintained application to a single dedicated profile. The dedicated Timbersteel experience must retain all current pages, URLs, settings, collection, durable history, notifications, Discord behavior, Admin behavior, craft planning, cookies, and browser preferences.

The public profile is removed rather than merely disabled. Its frontend, APIs, identity, collaborative plans, moderation surface, legal configuration, deployment automation, credentials, Caddy sites, and persisted data must no longer remain as dormant product functionality.

## Locked Decisions

- Use a targeted removal rather than a blanket Git revert.
- Preserve dedicated security hardening introduced alongside the public work, including owner-role safeguards and Discord guild fencing.
- Preserve shared application chrome and the pending shared stylesheet-entry fix where the dedicated application now depends on them.
- Permanently delete public-profile database data without producing a public-data export.
- Remove `claim-monitor.com` and `www.claim-monitor.com` from Caddy entirely; do not redirect them or serve a retired page.
- Remove public OAuth and collaboration credentials from the server and repository configuration.
- Keep the existing dedicated web process, worker, database, scheduler, and deployment topology.

## Considered Approaches

### 1. Targeted subsystem removal — selected

Remove every public-only seam while retaining mixed commits and modules that now protect or support the dedicated application. This requires more deliberate dependency work but gives the strongest dedicated-regression protection.

### 2. Blanket revert to the pre-public commit range

Rejected because public development was interleaved with dedicated security fixes, deployment hardening, tests, and shared chrome changes. Reverting the whole range would silently remove unrelated dedicated improvements.

### 3. Disable flags and leave the implementation dormant

Rejected because it would retain public data, credentials, routes, maintenance burden, accidental re-enablement paths, and Caddy infrastructure. It does not meet the requirement to remove the public version entirely.

## Application Architecture

The browser startup and server routing return to one dedicated product profile.

Remove:

- `src/public/` and public-only React roots, adapters, preferences, legal surfaces, and styles.
- `src/server/public/`, public-user repositories, public search/snapshot APIs, OAuth, sessions, collaborative plans, bearer links, moderation, retention, and deletion integrations.
- Public-service panels and permissions from the dedicated Admin application.
- Public-profile feature flags, environment validation, callback configuration, and health metrics.
- Public-only tests, import boundaries, route fixtures, and browser expectations.

Preserve:

- The dedicated application root, pages, local API, Admin, `/bot`, Discord, worker, collection, history, notifications, and active craft plan.
- Existing dedicated cookies and local-storage keys.
- Shared visual chrome now used by the dedicated application.
- Dedicated security improvements, including owner-role and correct-guild enforcement.
- The dedicated feature named Public Craft Finder and provider concepts such as public game records; these are not part of the removed public product profile.

Production requests must be accepted only for the allowlisted dedicated hostname and local development hosts. Unknown production hosts fail closed. Once the Caddy sites are removed, `claim-monitor.com` must not be routed to the application.

## Database and Privacy Removal

The destructive cleanup drops these additive public-profile tables in dependency-safe order:

1. `public_craft_plan_events`
2. `public_craft_plan_share_links`
3. `public_craft_plan_invites`
4. `public_craft_plan_members`
5. `public_craft_plans`
6. `public_user_legal_acceptances`
7. `public_user_sessions`
8. `public_user_accounts`

The same transaction deletes shared `admin_audit_log` records whose action has the exact `public.` prefix. Dedicated Admin audit records are retained.

Public retention jobs and public account-deletion/replay paths are removed. Existing dedicated privacy-deletion records remain intact. The shared signed deletion ledger is not erased wholesale because doing so would destroy dedicated privacy receipts; any remaining HMAC-only receipt that cannot be attributed without deleted identity data is retained as a non-plaintext integrity marker until normal expiry.

No public-data export is created. Backups made after the public schema first entered production may contain the removed tables. The deployment must identify that boundary from deployment or backup metadata, purge those encrypted backup artifacts, retain only verified pre-public backups, and create a new encrypted post-removal backup after cleanup. Backup deletion targets must be resolved and verified beneath `/var/backups/bitcraft-claim-monitor-relay` before removal.

The migration is covered by a seeded temporary-database test that proves public objects and exact public audit rows disappear while dedicated settings, configured claim, active plan, accounts, history, notification state, Discord outbox, and Admin data remain unchanged.

## Repository and Credential Removal

Remove public-profile deployment and configuration paths, including:

- `configure-public-caddy`, `enable-public-readonly`, and `install-public-oauth-credentials` workflows and helpers.
- Public Caddy reference blocks and validators that expect both hosts.
- `PUBLIC_PROFILE_ENABLED`, `PUBLIC_COLLABORATION_ENABLED`, `PUBLIC_LEGAL_CONFIGURATION_CONFIRMED`, `PUBLIC_ORIGIN`, `PUBLIC_DISCORD_OAUTH_CLIENT_ID`, `PUBLIC_DISCORD_OAUTH_CLIENT_SECRET`, and `PUBLIC_PLAN_TOKEN_HMAC_KEY` from application code, examples, deployment validation, and production environment configuration.
- Public-domain and public-OAuth instructions from architecture, deployment, operator, privacy, and release documentation.

The corresponding GitHub Actions secrets are deleted after the replacement release is stable. The user must delete the public Discord application in the Discord Developer Portal. Deleting that application revokes its OAuth credentials. The user must also remove the public domain's DNS records.

## Caddy Removal

Remove the exact `claim-monitor.com` and `www.claim-monitor.com` site blocks from `/etc/caddy/Caddyfile`. Before reloading:

1. Resolve and inspect the exact Caddyfile target.
2. Make a recoverable configuration copy outside the active file.
3. Validate the resulting configuration with Caddy.
4. Reload Caddy without stopping the dedicated application.
5. Verify `app.timbersteeltrade.com` still serves the dedicated profile and the public host no longer reaches it.

Caddy's shared certificate storage is not manually edited. Orphaned public certificates are left to Caddy's normal safe cleanup because deleting shared certificate storage could affect the dedicated hostname.

## Safe Deployment Sequence

### Gate 1: repository verification

- Implement the targeted removal and one-way cleanup migration/helper.
- Seed and test a mixed dedicated/public temporary database.
- Build the application and run the complete test suite.
- Inspect production dependency and deployment graphs for removed public-profile paths.
- Smoke-test all dedicated routes, Admin, `/bot`, worker health, collection freshness, Discord health, cookies, and preferences.

### Gate 2: reversible production cutover

- Disable the public feature gates so no new public accounts or plans can be created.
- Capture dedicated-state fingerprints before deployment.
- Deploy the dedicated-only code while temporarily leaving public tables present.
- Verify dedicated web, worker, collector, history, Discord, Admin, active plan, and settings behavior.
- If verification fails, roll back the application release while keeping the public gates disabled. No destructive data step has occurred yet.

### Gate 3: irreversible data cleanup

- Run the tested cleanup transaction against the exact production database.
- Run SQLite `integrity_check` and compare dedicated-state fingerprints.
- Purge post-public-launch encrypted backups and create and decrypt-verify a fresh post-removal backup.
- Remove public environment values and GitHub Actions secrets.
- Remove public Caddy sites, validate, and reload Caddy.
- Re-run the dedicated production smoke suite.

After this gate, rollback means repairing or redeploying the dedicated-only release. The deleted public data is intentionally unrecoverable and the removed public implementation must not be restored as an operational fallback.

### Gate 4: external cleanup

- The user deletes the public Discord application.
- The user removes `claim-monitor.com` and `www.claim-monitor.com` DNS records.
- Verify the public domain no longer reaches the application and the dedicated domain remains healthy.

## Verification and Acceptance

Automated checks must cover:

- Dedicated route, bootstrap, session, cookie, configured-claim, active-plan, Admin, bot, worker, history, notification, Discord, and outbox contracts.
- Unknown-host denial and absence of `/api/public/**` behavior.
- Destructive migration targeting and dedicated-data preservation.
- No public-profile frontend dependency, API router, OAuth flow, plan store, Admin permission, feature flag, Caddy helper, protected workflow, or domain configuration remains.
- No accidental removal of the dedicated Public Craft Finder or generic public game-data bindings.

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
```

Browser verification covers every current dedicated page at desktop and mobile widths, with special checks for AppShell chrome, Admin, `/bot`, terms/privacy, route titles, footer, and the top-bar stylesheet fix.

The work is complete only when:

- The dedicated hostname has no functional or visual regression.
- Existing dedicated cookies and browser settings remain valid.
- Configured claim, active plan, collection, retained history, notifications, Discord, Admin, and bot remain unchanged.
- No public profile, UI, route, API, identity, plan, moderation, legal surface, data table, credential, workflow, Caddy site, or re-enablement flag remains.
- No post-public-launch backup containing public-profile data remains.
- `claim-monitor.com` does not reach the application.

## Explicit Exclusions

- Do not rewrite or revert unrelated dedicated features.
- Do not remove the dedicated Public Craft Finder merely because its name contains “Public.”
- Do not delete the shared privacy ledger or shared Caddy certificate storage wholesale.
- Do not stop, replace, or reconfigure the existing worker, collector, timers, database location, or deployment topology.
- Do not create a public-data export or migration into the dedicated account/plan system.
