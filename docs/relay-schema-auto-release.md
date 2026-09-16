# Automatic Relay schema recovery

The schema workflow checks every ten minutes (GitHub schedules can run late). It discovers Relay topology, requires ready sources, and hashes exact v9 schema responses for the global source and every advertised regional source. Explicitly configured regional IDs must also be present. Runtime schema checks and last-good data remain unchanged.

With automatic releases enabled, the existing pinned generator still runs. A release is eligible only when generated files are identical and the manifest changes only its capture time and valid matching fingerprints/hashes. Changes to types, codegen pins, database identities, file counts, application code or dependencies require review. A nonempty Unreleased changelog also requires manual release preparation, so unrelated notes cannot silently ship.

An eligible release increments the current beta counter and adds a dated changelog entry. It must pass application tests/build, live global/primary-region/map subscriptions, and the exact-head Verify workflow. Main must still equal the tested baseline, and production must already be running that baseline. Strict branch checks and the expected-head merge API prevent untested revisions from merging. This uses a guarded merge API call, not GitHub's persistent auto-merge flag.

Deployment is explicitly dispatched to the existing `deploy-relay-preview.yml` workflow (which also serves the canonical Relay installation). Expected revision and parent checks prevent a dispatch race from deploying a different main revision. Deployment rechecks schema compatibility after any environment wait and before accessing VPS credentials. The normal deployment artifact checks, serialized deployment group and updater rollback remain in effect.

Recovery requires two consecutive samples showing the expected production revision, post-deployment generations for claim, players, region-claims, regional-market, public-crafts and empires, and a fresh on-demand map resource snapshot. Each domain is queried separately so one fresh source cannot hide a stale one. Another topology-wide fingerprint check follows recovery. The single GitHub incident stays open until this succeeds. Repeated identical incident states do not produce comments; no Discord notifications are added by this automation.

## One-time setup

Merge and deploy the automation code normally first, with automatic releases disabled. This makes the production-baseline guard valid for the next schema-only release. The implementation itself does not create an App, store credentials, modify repository protection, push, or deploy.

1. Create a dedicated GitHub App and install it on **only** `Red463/bitcraft-claim-monitor-relay`. Disable webhooks if not otherwise needed. Repository permissions:
   - Contents: read/write (publish generated branch and merge).
   - Pull requests: read/write (create/update and merge the PR).
   - Actions: read/write (inspect exact-head verification and dispatch deployment).
   - Issues: read/write (incident state updates).
   - Administration: read (verify branch protection).
   - Metadata: read (automatic).
2. Generate an App private key. Add repository variable `RELAY_SCHEMA_APP_ID` and repository secret `RELAY_SCHEMA_APP_PRIVATE_KEY`. Do not put the key in the checkout or paste it into chat. App installation tokens are created per run, scoped to this repository and revoked on job completion. `GITHUB_TOKEN` remains sufficient when automatic releases are disabled, but bot-created PR checks may require approval.
3. Protect `main`: require pull requests, require the **application** check from GitHub Actions, require the branch to be up to date, and enforce the rules for administrators. Do not give the schema App a bypass. Required human approvals or environment reviewers intentionally stop unattended releases; choose repository rules consistent with unattended generated-only updates. The automation refuses to operate without strict required `application` checks and admin enforcement.
4. Set these repository variables:

   | Variable | Value |
   | --- | --- |
   | `RELAY_SCHEMA_APP_ORIGIN` | `https://app.timbersteeltrade.com` |
   | `RELAY_SCHEMA_CLAIM_ID` | Current configured monitored claim ID, as a decimal string |
   | `RELAY_SCHEMA_REGION_ID` | Monitored claim's region ID, e.g. `19` |
   | `RELAY_SCHEMA_REGION_IDS` | Comma-separated IDs for all configured active regions; include the monitored region |
   | `RELAY_SCHEMA_RESOURCE_ID` | A valid public resource catalog ID for the map smoke check; defaults to `54` |
   | `RELAY_SCHEMA_AUTO_RELEASE` | Set to `true` only after setup and the baseline deployment |

   The recovery probes use existing public GET endpoints. If access controls restrict the map endpoint, the recovery check fails instead of bypassing access controls. Confirm the selected claim/region/resource and public map access before enabling.
5. Keep the existing `relay-preview` environment secrets and allowed-main branch policy. No new VPS credentials or VPS commands are needed. Repository-level App credentials are separate from the existing environment-scoped deployment secrets.

Example credential commands (run locally with your own App values; never commit the PEM):

```powershell
gh variable set RELAY_SCHEMA_APP_ID --repo Red463/bitcraft-claim-monitor-relay --body YOUR_APP_ID
Get-Content -Raw -LiteralPath C:\secure\schema-app.pem | gh secret set RELAY_SCHEMA_APP_PRIVATE_KEY --repo Red463/bitcraft-claim-monitor-relay
```

Enable after all other variables and protection are configured:

```powershell
gh variable set RELAY_SCHEMA_AUTO_RELEASE --repo Red463/bitcraft-claim-monitor-relay --body true
gh workflow run relay-schema-drift.yml --repo Red463/bitcraft-claim-monitor-relay --ref main
```

## Failure and recovery

- **Kill switch:** set `RELAY_SCHEMA_AUTO_RELEASE=false`. Detection and review PR preparation continue. Already-running deployments are not cancelled automatically; cancel a pending workflow explicitly if needed. Deployment checks the variable again before mutation, but an already-running job has its captured configuration.
- **Mixed regional rollout or missing/unready region:** retain last-good data and wait for convergence. No unsafe fingerprint acceptance. All advertised regions are checked conservatively, including regions outside configured active scope.
- **Structural generated changes:** review PR stays open. No automatic merge or deployment.
- **Main or production advanced:** automatic release stops rather than bundling unrelated changes. The next scheduled generation starts from current main; deploy unrelated main changes normally first.
- **Runner stopped after merge but before dispatch:** the next compatible check can resume dispatch for the validated merged schema PR. It does not repeatedly redeploy a revision that already has a deployment run.
- **Failed/cancelled deployment or failed recovery:** the incident stays open with the Actions link. Inspect and rerun the appropriate deployment after addressing the failure. If the candidate is already deployed, first verify production recovery rather than rerunning an automatic deployment against a now-different baseline. A normal deployment can be run manually; confirm data recovery before closing the incident manually.
- **Source changes again during deployment:** the final topology check prevents a false recovery announcement. A later scheduled refresh prepares the next compatible candidate.
- **Application rollback:** the existing updater may restore the previous release on installation/startup failure. A rollback cannot restore upstream schema compatibility, so the schema guard and incident remain until a matching deployment succeeds. This feature never rolls back SQLite history or disables schema checks.

Do not use `pull_request_target` with an untrusted checkout to avoid workflow approval. The dedicated App is the intended identity for unattended PR checks. See [GitHub token event behavior](https://docs.github.com/en/actions/concepts/security/github_token).

## Verification

```powershell
node --test scripts/test/relay-schema-*.test.mjs scripts/test/deploy-relay-preview-workflow.test.mjs apps/bitcraft-local/test/relay-schema-drift.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
node apps/bitcraft-local/scripts/check-relay-schema-drift.mjs --all-regions
```

Local tests use fixture manifests, temporary Git repositories, mocked GitHub calls and simulated recovery samples. They never merge, deploy, or send real notifications. Workflow behavior still needs an enabled GitHub App and a real eligible schema refresh for end-to-end production validation.
