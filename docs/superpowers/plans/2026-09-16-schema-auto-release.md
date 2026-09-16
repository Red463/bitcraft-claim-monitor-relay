# Guarded schema auto-release implementation plan

**Goal:** Automatically release fingerprint-only Relay refreshes after regeneration, CI and live checks; retain manual review for generated-code changes.

**Design:** Approved in the task conversation. Extend the existing schema and deployment workflows, use a repository-scoped GitHub App, fence every merge/deployment to its tested revision, and verify production data recovery before closing the incident. Do not bypass the runtime schema guard or send test Discord notifications.

**Execution:** Inline with focused tests and an independent code review. Node 24, pinned pnpm and existing GitHub Actions; no new application dependencies.

- [x] Add a pure release policy and CLI in `scripts/relay-schema-release.mjs`. Tests cover fingerprint-only classification, immutable manifest fields, package/changelog release metadata, unexpected files, exact-head and required-check fences. Reject generated TypeScript changes and unrelated production/main revisions.
- [x] Extend `check-relay-schema-drift.mjs` with opt-in topology-wide validation; test mixed regional rollouts, missing sources and HTTP failures. Preserve default callers.
- [x] Extend the schema workflow with ten-minute detection, opt-in App authentication, idempotent incident reporting, release classification, PR checks, fenced merge and explicit deployment dispatch. Extend Verify with the release-policy tests and automation-branch validation.
- [x] Extend deployment with expected revision/base inputs and bounded recovery verification of each required generation and a fresh map subscription; keep manual deployments intact. Test stale data, wrong revisions and failed map recovery. Report a single incident state change and close only after recovery.
- [x] Document repository App permissions, secrets/variables, required checks, activation, failure handling and the kill switch. No current version/changelog bump is needed for this implementation request; future automated releases generate their own metadata.
- [x] Run `node --test scripts/test/relay-schema-*.test.mjs scripts/test/deploy-relay-preview-workflow.test.mjs`, application build and tests. Inspect YAML with an available parser/actionlint. Review independently; fix findings. No deployment or real messages during testing.

## Verification result

- 34 focused release, topology, incident, recovery and workflow tests passed; includes real temporary-Git preparation and mocked interrupted-dispatch reconciliation.
- Application build passed.
- Full bounded-concurrency application suite: 2,957 passed, three skipped, zero failures. Default-concurrency run hit the previously observed 10-second worker-exit timeout. An unprivileged isolated retry could not load a linked dependency; the bounded run with normal dependency access passed.
- Official checksum-verified actionlint 1.7.12 passed for all three workflows (shellcheck unavailable). Diff whitespace checks passed.
- Fresh live checks matched the global schema and all 13 advertised regional schemas.
- Independent review findings addressed: reject partially loaded topology, preserve exact incident identity, resume interrupted incident closure.
- Real GitHub App merge/deployment and production recovery were not exercised; credentials and repository protection require one-time setup. No production configuration or real notifications changed during verification.
