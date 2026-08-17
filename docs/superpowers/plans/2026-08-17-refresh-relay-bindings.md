# Relay Binding Refresh and Road CI Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh both generated Relay binding sets for the current live schemas and make road generation report schema drift directly instead of a misleading empty-region error.

**Architecture:** Preserve the existing fail-closed schema gate and last-good runtime data. Generate official TypeScript bindings from exact Relay v9 schema bytes with the repository-pinned SpacetimeDB 2.7.0 CLI, stage the output away from tracked directories, apply the documented generated-enum repair only if the current schema still requires it, and replace tracked bindings only after compile checks. Keep the road diagnostic change as a small pure selection helper covered by a behavioral test.

**Tech Stack:** Node.js 24, TypeScript, Node test runner, SpacetimeDB CLI/SDK 2.7.0, pnpm, GitHub Actions.

## Global Constraints

- Work only in `apps/bitcraft-local` and directly related workflow/release documentation.
- Use the pinned CLI release `v2.7.0-hotfix3` and verify its committed SHA-256 before generation.
- Do not hand-write a BSATN decoder or let wire records enter React or SQLite.
- A fingerprint mismatch must continue to stop the affected generation and preserve last-good data.
- Do not touch the installed road pack until a complete replacement artifact passes and installs atomically.
- Preserve unrelated and untracked user files.

---

### Task 1: Surface road schema drift

**Files:**
- Modify: `apps/bitcraft-local/test/map-world-generation-boundary.test.mjs`
- Modify: `apps/bitcraft-local/scripts/build-relay-road-world.mjs`

**Interfaces:**
- Consumes: topology `regions: Map<string, RelaySource>`, the schema manifest, an optional requested-region set, and `assertSchemaFingerprint`.
- Produces: `schemaReadyRoadRegionIds({ topology, manifest, requestedSet, assertFingerprint }): string[]`.

- [ ] **Step 1: Write the failing test**

Add a behavioral test with one ready regional source whose fingerprint is rejected. Assert that `schemaReadyRoadRegionIds` throws the original `/schema fingerprint mismatch/i` error and does not reduce it to `/requires decimal region IDs/i`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/map-world-generation-boundary.test.mjs`

Expected: FAIL because `schemaReadyRoadRegionIds` is not exported.

- [ ] **Step 3: Implement the minimal helper**

Move the ready/source/request filtering into the exported helper, call `assertFingerprint(manifest, "regional", fingerprint)` without swallowing its exception, canonicalize the resulting IDs, and use the helper from `runRoadWorldCli`.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 2: Regenerate live Relay bindings

**Files:**
- Replace generated output: `apps/bitcraft-local/src/server/game-data/bindings/global/`
- Replace generated output: `apps/bitcraft-local/src/server/game-data/bindings/regional/`
- Modify: `apps/bitcraft-local/src/server/game-data/bindings/schema-manifest.json`
- Modify: `apps/bitcraft-local/test/relay-schema-manifest.test.mjs`

**Interfaces:**
- Consumes: exact `/v1/database/{database}/schema?version=9` response bytes discovered from live Relay topology.
- Produces: official generated TypeScript binding directories and manifest fingerprints equal to each schema response SHA-256.

- [ ] **Step 1: Capture and validate live schemas**

Discover the live global source and a ready regional source, download exact schema bytes, calculate SHA-256, and require agreement with the topology fingerprint. Wrap each response as `{"V9": <schema>}` for the pinned CLI bridge.

- [ ] **Step 2: Verify the pinned generator**

Calculate SHA-256 for the cached official Windows CLI archive and require `d64a6b1ccb214892ee22571d71fc1cbd105a5f23a560d440a77843e8cec557e7`. Confirm the executable reports `2.7.0`.

- [ ] **Step 3: Generate into fresh staging directories**

From a directory containing the existing empty `spacetimedb/` module placeholder, run the pinned executable twice with `generate --lang typescript --module-def <wrapped-schema> --out-dir <fresh-stage> --yes --no-config`.

- [ ] **Step 4: Validate and repair generated output**

Confirm `PlayerVoteAnswer` still has exactly `None`, `No`, and `Yes`. If the generator still omits the named declaration, apply the same documented declaration to each staged `types.ts`; otherwise make no repair. Compile staged/tracked binding output before replacing files.

- [ ] **Step 5: Replace tracked generated directories and update manifest tests**

Mechanically replace only the two resolved binding directories, update database identities/fingerprints/schema hashes/file counts/capture time, and change the manifest test fixtures to the new fingerprints.

### Task 3: Release and verification

**Files:**
- Modify: `apps/bitcraft-local/src/server/game-data/bindings/README.md`
- Modify: `apps/bitcraft-local/package.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces release `0.57.1-beta.1` and records the current schema refresh and clearer road-job failure.

- [ ] **Step 1: Update documentation and release metadata**

Record the exact reproducible pinned generation command shape, bump the fix-only beta line to `0.57.1-beta.1`, and add user-facing Fixed/Changed changelog entries.

- [ ] **Step 2: Run focused and full verification**

Run the road boundary test, schema-manifest test, `corepack pnpm --filter @workspace/bitcraft-local run build`, and `corepack pnpm --filter @workspace/bitcraft-local test`.

- [ ] **Step 3: Run bounded live verification**

Run the existing global and primary-region live verifiers plus a one-region forced road generation in a temporary data directory. Confirm generated subscriptions apply without fingerprint errors and the road pack verifies before discarding the temporary output.

- [ ] **Step 4: Review and commit**

Inspect generated-code scope, run the required code review, confirm only intended files are staged, and commit the verified release.

- [ ] **Step 5: Publish and recover production**

Push the branch, open a PR, wait for required checks, merge, run the deployment workflow, verify live health/version, then dispatch `generate-native-map.yml` for `roads` and require a successful generation/install job.

