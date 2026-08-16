# VPS CPU Safety Design

## Goal

Prevent Hostworld CPU penalties without slowing interactive map, resource, player, or ordinary application requests.

## Confirmed cause

The production road and terrain generators run on the VPS as `Type=oneshot` services. `CPUWeight` changes scheduling priority but does not cap CPU consumption, and systemd reports that their current `RuntimeMaxSec` has no effect for this service type. The GitHub map workflow also SSHes to the VPS to perform generation, while ordinary deployments repeat a production build that CI already completed.

## Architecture

### Live-service isolation

The web and worker services remain unchanged and uncapped. The emergency/manual VPS map generators retain their shared lock, low scheduling weights, memory limits, and last-good installation behavior, and gain:

- a one-core `CPUQuota=100%` cgroup ceiling;
- `TimeoutStartSec=12h`, which applies to a `Type=oneshot` start;
- one libvips thread per image and a two-entry libuv pool;
- control-group termination so timed-out native image work cannot escape the unit.

These limits can make fallback generation slower, but cannot slow the live service through CPU contention.

### Off-box map generation

GitHub-hosted runners build the server bindings and generate map packs in runner-local storage. Scheduled runs generate roads Monday through Saturday and both terrain and roads on Sunday; manual runs can choose either product or both. Each product is generated in an independent job so terrain cannot block roads.

The runner packages only the selected product's current immutable version, records a SHA-256 digest, uploads the archive to the deploy user's incoming directory, and invokes the restricted updater. The updater validates the digest, validates archive paths before extraction, verifies the pack with the existing verifier, copies the immutable version into the product store, and atomically replaces only that product's `current.json`. Any failure leaves the installed last-good generation untouched. Production terrain and road timers are disabled after the off-box schedule is installed; their services remain available as a controlled fallback.

### CI-built application releases

The verification job produces a revision-bound build archive containing the generated frontend and server outputs. The deploy job uploads this archive with its SHA-256 digest. The updater still creates the revision-pinned worktree and installs locked dependencies, but validates and extracts the CI outputs instead of running the production build again. If no valid artifact is supplied, deployment fails closed rather than falling back to an uncapped VPS build.

### Telemetry

The collector monitors web, worker, Caddy, terrain generation, and road generation. It derives per-service CPU percentage from `CPUUsageNSec` deltas between one-minute snapshots and retains bounded service CPU rows in recent history. This identifies whether future CPU use belongs to live traffic or a batch unit without exposing secrets or game coordinates.

## Error handling and security

- Archives must be regular files within the deploy user's fixed incoming directory.
- The updater accepts a caller-supplied SHA-256 digest and rejects mismatches.
- Archive entries must remain under the expected product/build prefixes and may not contain absolute paths, parent traversal, links, devices, or unrelated files.
- Map pack verification runs before the live pointer changes.
- Incoming files and extraction directories are removed on both success and failure.
- Logs contain product names, revisions, byte counts, durations, and allow-listed failure categories only.
- Existing immutable browser caching and live resource subscription behavior do not change.

## Verification

- Deployment contract tests lock the CPU quota, effective timeout, image concurrency, disabled VPS timers, fixed incoming paths, hash checks, and atomic installer invocation.
- Map generation tests lock runner-local generation and product-specific artifact creation.
- Updater integration fixtures prove invalid hashes and unsafe archives fail before the current pointer changes.
- Collector tests prove CPU deltas and generator services are projected without leaking commands or identifiers.
- Local verification is limited to focused, memory-capped test files and syntax checks because prior full local Node builds exhausted the workstation. GitHub CI remains the full build/test authority.
