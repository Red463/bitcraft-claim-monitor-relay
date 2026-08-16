# VPS CPU Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove sustained compilation and map-rendering CPU from the live VPS while retaining bounded fallback jobs and atomic last-good map serving.

**Architecture:** GitHub runners produce revision-bound application and map artifacts. The restricted updater verifies hashes and archive structure before atomically installing outputs; VPS generator units remain as one-core, time-bounded fallbacks. The minute collector derives per-service CPU from cgroup counters.

**Tech Stack:** GitHub Actions, Bash, systemd, Node.js 24, pnpm, Sharp/libvips, existing map pack stores and verifier.

## Global Constraints

- Do not change live resource subscription cadence, resource response limits, browser rendering, or immutable tile cache policy.
- Keep current terrain and road packs available on any generation, upload, verification, or installation failure.
- Never log archive contents, coordinates, player selections, credentials, or raw upstream errors.
- Never run the local full suite, full build, world generation, or dense benchmark on this workstation.
- Use only focused, memory-capped tests locally; GitHub CI performs full verification.

---

### Task 1: Hard-limit fallback map generation

**Files:**
- Modify: `deploy/bitcraft-claim-monitor-relay-map-terrain.service`
- Modify: `deploy/bitcraft-claim-monitor-relay-map-roads.service`
- Modify: `apps/bitcraft-local/scripts/build-relay-terrain-world.mjs`
- Modify: `apps/bitcraft-local/scripts/build-relay-road-world.mjs`
- Create: `apps/bitcraft-local/src/server/mapGenerationConcurrency.mjs`
- Test: `scripts/test/deploy-map-generation-units.test.mjs`
- Test: `apps/bitcraft-local/test/map-generation-concurrency.test.mjs`

**Interfaces:**
- Produces: `configureMapGenerationConcurrency(sharpModule, environment): number`, returning the applied integer thread count.

- [ ] Add failing unit-contract assertions for `CPUQuota=100%`, `TimeoutStartSec=12h`, `KillMode=control-group`, `UV_THREADPOOL_SIZE=2`, and removal of ineffective `RuntimeMaxSec`.
- [ ] Run `node --test scripts/test/deploy-map-generation-units.test.mjs` and confirm the new assertions fail.
- [ ] Add a failing focused test proving invalid concurrency defaults to one and values clamp to one or two.
- [ ] Run `node --test apps/bitcraft-local/test/map-generation-concurrency.test.mjs` and confirm the module is missing.
- [ ] Implement the unit settings and call the concurrency helper before either CLI starts generation.
- [ ] Re-run both focused test files and confirm they pass.

### Task 2: Record generator CPU accurately

**Files:**
- Modify: `deploy/collect-server-health.mjs`
- Modify: `deploy/bitcraft-claim-monitor-relay-collector.service`
- Modify: `apps/bitcraft-local/src/server/serverHealth.mjs`
- Test: `scripts/test/deploy-runtime-config.test.mjs`
- Test: `apps/bitcraft-local/test/server-health.test.mjs`

**Interfaces:**
- Produces service rows containing bounded `cpuPercent` derived from the current and previous `CPUUsageNSec` counters.
- Recent history may contain bounded normalized service rows; existing host chart fields remain unchanged.

- [ ] Add failing assertions that both map units are monitored and that a 30-second, 15-second CPU delta reports 50%.
- [ ] Run the two focused tests and capture RED.
- [ ] Extract a pure `serviceCpuPercent` calculation, retain raw counters only in the private snapshot, and add bounded service rows to history.
- [ ] Normalize service history through the existing redaction and array limits.
- [ ] Re-run focused tests and capture GREEN.

### Task 3: Generate map packs on GitHub runners

**Files:**
- Modify: `.github/workflows/generate-native-map.yml`
- Create: `apps/bitcraft-local/scripts/package-native-map-product.mjs`
- Create: `apps/bitcraft-local/scripts/install-native-map-product.mjs`
- Modify: `deploy/update-bitcraft-claim-monitor-relay`
- Test: `scripts/test/deploy-map-generation-units.test.mjs`
- Test: `apps/bitcraft-local/test/map-pack-product-transfer.test.mjs`

**Interfaces:**
- `packageNativeMapProduct({ dataDir, product, outputDir }): Promise<{ archiveRoot, version, manifestHash }>` prepares a product-scoped regular-file tree.
- `installNativeMapProduct({ sourceRoot, dataDir, product }): Promise<manifest>` verifies and atomically installs the current immutable version.
- Updater mode: `--install-map-product <terrain|roads> --artifact <fixed incoming filename> --sha256 <64 lowercase hex>`.

- [ ] Add failing workflow tests proving scheduled runner-local generation, product matrix isolation, hash upload, restricted install invocation, and no `--generate-map all` SSH command.
- [ ] Add failing installer tests proving valid product installation changes only its pointer and malformed/traversal/mismatched products retain last-good.
- [ ] Implement product packaging and installation using existing pack verifier/store boundaries.
- [ ] Implement updater validation for a fixed incoming root, regular files, SHA-256, safe archive listing, cleanup traps, and product-specific installer invocation.
- [ ] Change the workflow to build bindings, generate in runner-local storage, package, upload, and install each matrix product.
- [ ] Disable production map timers after successful off-box installation while retaining fallback service units.
- [ ] Run the two focused test files and syntax-check the workflow/updater contracts.

### Task 4: Deploy CI-built application outputs

**Files:**
- Modify: `.github/workflows/deploy-relay-preview.yml`
- Create: `scripts/package-relay-build.mjs`
- Create: `deploy/install-relay-build-artifact.mjs`
- Modify: `deploy/update-bitcraft-claim-monitor-relay`
- Test: `scripts/test/deploy-relay-preview-workflow.test.mjs`
- Test: `scripts/test/deploy-update-script.test.mjs`
- Test: `scripts/test/relay-build-artifact.test.mjs`

**Interfaces:**
- Build archive allow-list: `apps/bitcraft-local/dist/**`, `apps/bitcraft-local/dist-server/**`, `apps/bitcraft-local/dist-bindings/**` when present, plus a manifest containing the exact revision and per-file SHA-256 digests.
- Updater options: `--build-artifact <fixed incoming filename> --build-artifact-sha256 <64 lowercase hex>`.

- [ ] Add failing workflow assertions for packaging/uploading the already verified build and passing its digest to the updater.
- [ ] Add failing artifact tests for revision mismatch, missing outputs, unexpected paths, symlinks, and digest mismatch.
- [ ] Implement deterministic build packaging and fail-closed installation into the revision worktree.
- [ ] Replace the updater's VPS build with artifact verification/extraction; retain locked dependency installation for runtime modules.
- [ ] Run the three focused test files and capture GREEN.

### Task 5: Focused verification and commit

**Files:**
- Review all files changed by Tasks 1-4.

- [ ] Run only the focused test files named above, with `NODE_OPTIONS=--max-old-space-size=768` where Node accepts it.
- [ ] Run `git diff --check` and Bash syntax checks for the updater.
- [ ] Inspect workflows for secret interpolation, unsafe archive paths, accidental VPS generation, and unbounded fallback behavior.
- [ ] Confirm no local full suite, full build, world generation, or dense benchmark was invoked.
- [ ] Commit the focused implementation on `codex/reduce-vps-cpu` with a production-safety message.

