# Native Map Production Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Deliver full-world pre-generated terrain and roads plus fast all-region live resources without blocking or crashing the production web service.

**Architecture:** Static layers are generated off-peak into validated immutable packs and installed through atomic pointer swaps; web tile requests perform one file read. Live resources are configured in the production web role, normalized once per regional generation, paged without repeated sorting, and rendered progressively by region/type partition.

**Tech Stack:** Node.js 24, React, TypeScript, Leaflet, Canvas, Sharp, SpacetimeDB typed bindings, Node test runner, pnpm, Bash, systemd.

## Global Constraints

- No browser or web request may contact Relay, BitJita, Prism, BitCraftMap, or a third-party tile host.
- Map interactive within 2 seconds under normal production load.
- Cached tile p95 under 100 ms; cold tile p95 under 250 ms.
- First cold resource region visible within 3 seconds; retained resource selection within 500 ms.
- Health p95 under 250 ms during generation, installation, and dense resource loading.
- Terrain generation runs weekly; road generation runs daily; both run off-peak outside the web process.
- Tile requests perform no generation, Sharp composition, directory pruning, SQLite writes, or Relay access.
- Aggregate selected resource nodes may exceed 50,000; protection is per partition/request and by bounded concurrency.
- Preserve decimal-string 64-bit identities, overworld dimension 1, map x/z ordering, and world bounds 0..38400.
- Preserve last-good static packs and complete resource partitions on transient failure.
- Keep generated databases, packs, logs, coordinates, and private selections out of commits and request logs.
- Unless a task says otherwise, Tasks 1-11 run from `apps/bitcraft-local`; Task 12 runs from the repository root.

---

## File map and execution tracks

Track A — static layers:

- Create apps/bitcraft-local/src/server/mapTilePackStore.mjs for immutable reads, atomic installation, pointer reload, and maintenance pruning.
- Create apps/bitcraft-local/src/server/mapTilePackComposer.mjs for offline batch composition.
- Modify terrainTileStore.mjs, roadTileStore.mjs, terrainOverviewStore.mjs, mapTiles.mjs, and server.mjs.
- Create build-relay-terrain-world.mjs and build-relay-road-world.mjs.
- Add four systemd map-generation units and transactional updater support.

Track B — live resources:

- Create apps/bitcraft-local/src/server/game-data/mapResourceReadiness.ts.
- Modify mapResourceProjection.ts, mapResourceRegionSession.ts, mapResourceRuntime.ts, mapResourcePages.mjs, and server.mjs.
- Modify mapResourcePartitionLoader.mjs, mapResourcePartitionState.mjs, NativeMap.tsx, and nativeMapRequest.mjs.

Track C — acceptance and release:

- Add production-shaped benchmark/load scripts.
- Run split-role smoke, full build/tests, browser smoke, release/version work, staged deployment, and live monitoring.

### Task 1: Immutable tile pack store

**Files:**
- Create: apps/bitcraft-local/src/server/mapTilePackStore.mjs
- Create: apps/bitcraft-local/test/map-tile-pack-store.test.mjs

**Interfaces:**
- Produces createMapTilePackStore({ root, allowedStyles, maxTileBytes, pointerTtlMs, now }).
- Produces readManifest(), readTile({ style, z, x, y }), install({ stagedVersionDir, version, manifestHash }), prune({ graceMs, keepGenerations }), close().
- Disk layout: current.json; versions/<version>/complete.json; manifest.json; tiles/<style>/<z>/<x>/<y>.webp.

- [ ] **Step 1: Write failing race, last-good, and traversal tests**

~~~js
test("cached reader A never deletes newly installed B", async () => {
  const store = createMapTilePackStore({ root, allowedStyles: ["terrain"], pointerTtlMs: 0 });
  await installFixture(root, "g-1", { generation: "1" });
  assert.equal((await store.readManifest()).generation, "1");
  await installFixture(root, "g-2", { generation: "2" });
  await store.readTile({ style: "terrain", z: -1, x: 45, y: -47 });
  assert.equal(await exists(path.join(root, "versions", "g-2")), true);
});

test("malformed replacement pointer retains last-good", async () => {
  await installFixture(root, "g-1", { generation: "1" });
  assert.equal((await store.readManifest()).generation, "1");
  await writeFile(path.join(root, "current.json"), "{");
  assert.equal((await store.readManifest()).generation, "1");
});

test("tile paths cannot escape the installed version", async () => {
  assert.equal(await store.readTile({ style: "terrain", z: -1, x: 45, y: Number.NaN }), null);
});
~~~

- [ ] **Step 2: Run focused test and verify RED**

Run from apps/bitcraft-local:

~~~sh
node --experimental-strip-types --test test/map-tile-pack-store.test.mjs
~~~

Expected: FAIL because mapTilePackStore.mjs does not exist.

- [ ] **Step 3: Implement minimal validated reader**

~~~js
export function createMapTilePackStore({
  root,
  allowedStyles,
  maxTileBytes = 2 * 1024 * 1024,
  pointerTtlMs = 1000,
  now = Date.now,
}) {
  let lastGood = null;
  let checkedAt = -Infinity;
  async function current() {
    if (lastGood && now() - checkedAt < pointerTtlMs) return lastGood;
    checkedAt = now();
    try {
      const candidate = JSON.parse(await readFile(path.join(root, "current.json"), "utf8"));
      if (await validInstalledPointer(root, candidate)) lastGood = candidate;
    } catch (error) {
      if (!lastGood && error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    return lastGood;
  }
  return Object.freeze({ readManifest, readTile, install, prune, close });
}
~~~

readTile must validate the allowlisted style and safe integer coordinates, resolve beneath the immutable version root, enforce maxTileBytes, and never call readdir, rm, Sharp, install, or prune.

- [ ] **Step 4: Run tests and diff check**

~~~sh
node --experimental-strip-types --test test/map-tile-pack-store.test.mjs
git diff --check
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/mapTilePackStore.mjs apps/bitcraft-local/test/map-tile-pack-store.test.mjs
git commit -m "feat(map): add immutable tile pack store"
~~~

### Task 2: Atomic installation and retention

**Files:**
- Modify: apps/bitcraft-local/src/server/mapTilePackStore.mjs
- Modify: apps/bitcraft-local/test/map-tile-pack-store.test.mjs

**Interfaces:**
- Consumes Task 1 store.
- install() switches current only after complete validation and durable rename.
- prune() is maintenance-only and retains current plus the newest previous generation for at least 24 hours.

- [ ] **Step 1: Add failing installation tests**

~~~js
test("invalid staged pack cannot replace current", async () => {
  await installFixture(root, "g-1", { generation: "1" });
  const staged = await stagedFixture(root, "g-2", { missingReferencedTile: true });
  await assert.rejects(store.install({ stagedVersionDir: staged, version: "g-2", manifestHash: hash }), /missing tile/i);
  assert.equal((await store.readManifest()).generation, "1");
});

test("prune keeps current and previous generation during grace", async () => {
  await installThreeGenerations(root);
  await store.prune({ graceMs: 86_400_000, keepGenerations: 2 });
  assert.deepEqual(await installedVersions(root), ["g-2", "g-3"]);
});
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-tile-pack-store.test.mjs
~~~

- [ ] **Step 3: Implement durable ordering**

~~~js
await validatePack(stagedVersionDir, manifestHash);
await writeDurableJson(path.join(stagedVersionDir, "complete.json"), { manifestHash });
await rename(stagedVersionDir, installedVersionDir);
await writeDurableJson(temporaryPointer, { version, manifest, manifestHash });
await rename(temporaryPointer, currentPath);
lastGood = { version, manifest, manifestHash };
~~~

Do not call prune from install or read. prune must skip current, incomplete/staging directories, generations newer than grace, and the newest keepGenerations complete versions.

- [ ] **Step 4: Run test**

~~~sh
node --experimental-strip-types --test test/map-tile-pack-store.test.mjs
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/mapTilePackStore.mjs apps/bitcraft-local/test/map-tile-pack-store.test.mjs
git commit -m "fix(map): make tile pack installs atomic"
~~~

### Task 3: Remove request-time pruning and overview composition

**Files:**
- Modify: apps/bitcraft-local/src/server/terrainTileStore.mjs
- Modify: apps/bitcraft-local/src/server/roadTileStore.mjs
- Modify: apps/bitcraft-local/src/server/terrainOverviewStore.mjs
- Modify: apps/bitcraft-local/server.mjs
- Modify: apps/bitcraft-local/test/terrain-tile-store.test.mjs
- Modify: apps/bitcraft-local/test/road-tile-store.test.mjs
- Modify: apps/bitcraft-local/test/terrain-overview-store.test.mjs

**Interfaces:**
- Existing readManifest/readTile APIs stay stable.
- Installed reads delegate to Task 1.
- The 13-batch overview remains import-only compatibility; server.mjs reads a precomposed full-world pack.

- [ ] **Step 1: Add failing hot-path boundaries**

~~~js
test("terrain read performs no pruning", async () => {
  const source = await readFile(new URL("../src/server/terrainTileStore.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async readTile"), source.indexOf("async close"));
  assert.doesNotMatch(body, /pruneVersions|readdir|\brm\(/);
});

test("production overview performs no Sharp composition", async () => {
  const result = await composedStore.readTile(request);
  assert.equal(result.bytes.toString(), "precomposed");
  assert.equal(sharpCalls, 0);
});
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/terrain-tile-store.test.mjs test/road-tile-store.test.mjs test/terrain-overview-store.test.mjs
~~~

- [ ] **Step 3: Delegate reads and remove layered fan-out**

terrainTileStore and roadTileStore retain builder-facing methods but delegate installed reads and pointers to createMapTilePackStore. Remove pruneVersions from read finally. Configure server.mjs with the precomposed terrain store, not createLayeredTerrainTileStore over 13 overview batches.

- [ ] **Step 4: Run focused tests and build**

~~~sh
node --experimental-strip-types --test test/terrain-tile-store.test.mjs test/road-tile-store.test.mjs test/terrain-overview-store.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/terrainTileStore.mjs apps/bitcraft-local/src/server/roadTileStore.mjs apps/bitcraft-local/src/server/terrainOverviewStore.mjs apps/bitcraft-local/server.mjs apps/bitcraft-local/test/terrain-tile-store.test.mjs apps/bitcraft-local/test/road-tile-store.test.mjs apps/bitcraft-local/test/terrain-overview-store.test.mjs
git commit -m "fix(map): remove tile work from request path"
~~~

### Task 4: Offline full-world pack composer

**Files:**
- Create: apps/bitcraft-local/src/server/mapTilePackComposer.mjs
- Create: apps/bitcraft-local/test/map-tile-pack-composer.test.mjs

**Interfaces:**
- Produces composeMapTilePack({ batchRoots, outputRoot, product, expectedRegionIds, styles, manifestBase }).
- Returns { stagedVersionDir, manifest, manifestHash }, accepted by Task 2 install().

- [ ] **Step 1: Write failing deterministic composition tests**

~~~js
test("overlapping regional tiles become one output tile", async () => {
  const result = await composeMapTilePack({
    batchRoots: [north, south],
    outputRoot,
    product: "terrain",
    expectedRegionIds: ["3", "19"],
    styles: ["terrain", "water"],
    manifestBase,
  });
  assert.deepEqual(result.manifest.regionIds, ["3", "19"]);
  assert.equal(await countTiles(result.stagedVersionDir, "terrain"), 1);
  assert.deepEqual(await samplePixel(result.stagedVersionDir), expectedCompositePixel);
});

test("missing expected region prevents output", async () => {
  await assert.rejects(composeMapTilePack({
    batchRoots: [north],
    outputRoot,
    product: "terrain",
    expectedRegionIds: ["3", "19"],
    styles: ["terrain"],
    manifestBase,
  }), /missing region 19/i);
});
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-tile-pack-composer.test.mjs
~~~

- [ ] **Step 3: Implement offline composition**

Enumerate manifests once; key tiles by style/z/x/y; process keys in lexical numeric order; copy a single source without decoding; composite overlaps with Sharp in stable region order; calculate file hashes, channel counts, total counts, and bytes; write manifest.json. Do not import this module from server.mjs.

- [ ] **Step 4: Run test**

~~~sh
node --experimental-strip-types --test test/map-tile-pack-composer.test.mjs
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/mapTilePackComposer.mjs apps/bitcraft-local/test/map-tile-pack-composer.test.mjs
git commit -m "feat(map): precompose full world tile packs"
~~~

### Task 5: Full-world terrain and road jobs

**Files:**
- Create: apps/bitcraft-local/scripts/build-relay-terrain-world.mjs
- Create: apps/bitcraft-local/scripts/build-relay-road-world.mjs
- Modify: apps/bitcraft-local/package.json
- Create: apps/bitcraft-local/test/map-world-generation-boundary.test.mjs

**Interfaces:**
- Produces package scripts map:build-terrain-world and map:build-road-world.
- Consumes existing topology, typed regional bindings, renderers, Task 4 composer, and Task 2 installer.

- [ ] **Step 1: Write failing job-boundary tests**

~~~js
test("terrain job includes every ready region at zoom -5 through 0", async () => {
  const result = await runTerrainWorldFixture({ readyRegionIds: ["3", "19"] });
  assert.deepEqual(result.manifest.regionIds, ["3", "19"]);
  assert.deepEqual(result.manifest.zoomRange, { min: -5, max: 0 });
});

test("one failed road region retains previous pack", async () => {
  await assert.rejects(runRoadWorldFixture({ readyRegionIds: ["3", "19"], failRegionId: "19" }), /region 19/i);
  assert.equal(await installedGeneration(outputRoot), "previous");
});
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-world-generation-boundary.test.mjs
~~~

- [ ] **Step 3: Implement bounded jobs**

Discover schema-ready overworld regions. Honor BITCRAFT_MAP_REGION_IDS when explicitly supplied. Process BITCRAFT_MAP_GENERATION_BATCH_SIZE regions concurrently, default 1. Release each Relay connection and raw cache before the next batch. Compose only after all expected regions succeed. Terrain renders terrain/water/biome masks at zooms -5..0; roads use paved_tile_state.entity_id = location_state.entity_id at dimension 1 and render transparent roads at zooms -5..0. Install once.

~~~json
{
  "map:build-terrain-world": "node scripts/build-relay-terrain-world.mjs",
  "map:build-road-world": "node scripts/build-relay-road-world.mjs"
}
~~~

- [ ] **Step 4: Run tests and build**

~~~sh
node --experimental-strip-types --test test/map-world-generation-boundary.test.mjs test/terrain-runtime.test.mjs test/road-tile-renderer.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/scripts/build-relay-terrain-world.mjs apps/bitcraft-local/scripts/build-relay-road-world.mjs apps/bitcraft-local/package.json apps/bitcraft-local/test/map-world-generation-boundary.test.mjs
git commit -m "feat(map): generate full world static layers"
~~~

### Task 6: Static status, caching, deployment, and timers

**Files:**
- Modify: apps/bitcraft-local/src/server/mapTiles.mjs
- Modify: apps/bitcraft-local/test/map-tiles.test.mjs
- Modify: apps/bitcraft-local/test/terrain-tile-status.test.mjs
- Create: deploy/bitcraft-claim-monitor-relay-map-terrain.service
- Create: deploy/bitcraft-claim-monitor-relay-map-terrain.timer
- Create: deploy/bitcraft-claim-monitor-relay-map-roads.service
- Create: deploy/bitcraft-claim-monitor-relay-map-roads.timer
- Modify: deploy/update-bitcraft-claim-monitor-relay
- Modify: .github/workflows/deploy-relay-preview.yml
- Modify: scripts/test/deploy-update-script.test.mjs
- Modify: scripts/test/deploy-update-integration.test.mjs
- Create: scripts/test/deploy-map-generation-units.test.mjs

**Interfaces:**
- Terrain stale threshold: 8 days. Road stale threshold: 36 hours.
- Generation-addressed tiles: public, max-age=31536000, immutable.
- Timers: terrain Sunday 03:10; roads daily 02:10; RandomizedDelaySec 15m.

- [ ] **Step 1: Add failing route and deployment tests**

~~~js
assert.equal(statusAtSevenDays.freshness, "live");
assert.equal(statusAtNineDays.freshness, "stale");
assert.equal(roadsAtThirtyHours.freshness, "live");
assert.equal(roadsAtFortyHours.freshness, "stale");
assert.match(tileHeaders["cache-control"], /max-age=31536000, immutable/);
assert.doesNotMatch(updater, /tar .* -C "\$DATA_DIR"/);
assert.match(updater, /\.map-install-\$REVISION/);
assert.match(terrainTimer, /OnCalendar=Sun \*-\*-\* 03:10:00/);
assert.match(roadTimer, /OnCalendar=\*-\*-\* 02:10:00/);
assert.match(terrainService, /MemoryMax=70%/);
assert.match(terrainService, /flock -n \/run\/lock\/bitcraft-claim-monitor-relay-map-generation\.lock/);
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-tiles.test.mjs test/terrain-tile-status.test.mjs
node --test ../../scripts/test/deploy-update-script.test.mjs ../../scripts/test/deploy-update-integration.test.mjs ../../scripts/test/deploy-map-generation-units.test.mjs
~~~

- [ ] **Step 3: Implement status and operational units**

Status returns independent terrain/road freshness and age. The updater extracts bootstrap packs beneath DATA_DIR/.map-install-REVISION, validates them, invokes atomic install, and never recursively chowns or extracts over live roots. Install/snapshot/restore all four units in the existing updater transaction. Use Persistent=true, Nice=10, CPUWeight=20, IOWeight=10, MemoryHigh=60%, MemoryMax=70%, RuntimeMaxSec=3h, and one shared non-blocking flock. Install the timers disabled; Task 12 enables them only after live acceptance.

- [ ] **Step 4: Run route/deploy tests and syntax**

~~~sh
node --experimental-strip-types --test test/map-tiles.test.mjs test/terrain-tile-status.test.mjs
node --test ../../scripts/test/deploy-update-script.test.mjs ../../scripts/test/deploy-update-integration.test.mjs ../../scripts/test/deploy-map-generation-units.test.mjs
bash -n ../../deploy/update-bitcraft-claim-monitor-relay
corepack pnpm --filter @workspace/bitcraft-local run build
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/mapTiles.mjs apps/bitcraft-local/test/map-tiles.test.mjs apps/bitcraft-local/test/terrain-tile-status.test.mjs deploy .github/workflows/deploy-relay-preview.yml scripts/test/deploy-update-script.test.mjs scripts/test/deploy-update-integration.test.mjs scripts/test/deploy-map-generation-units.test.mjs
git commit -m "fix(deploy): install and schedule map packs safely"
~~~

### Task 7: Web-owned resource readiness

**Files:**
- Create: apps/bitcraft-local/src/server/game-data/mapResourceReadiness.ts
- Modify: apps/bitcraft-local/src/server/game-data/index.ts
- Modify: apps/bitcraft-local/server.mjs
- Create: apps/bitcraft-local/test/map-resource-readiness.test.mjs
- Modify: apps/bitcraft-local/test/map-resource-route-integration.test.mjs
- Modify: apps/bitcraft-local/test/server-process-role.test.mjs

**Interfaces:**
- Produces RelayMapResourceReadiness with ensure({ relayBaseUrl, primaryRegionId, configuredRegionIds }) and catalog().
- Caches/single-flights topology for 60 seconds, retains last-good ready IDs, and reconciles RelayMapResourceRuntime in the web role.
- All map region/resource/snapshot/resource-event routes consume the same readiness snapshot.

- [ ] **Step 1: Write failing split-role tests**

~~~js
test("web role configures map resources without worker background jobs", async () => {
  const readiness = new RelayMapResourceReadiness({ discoverTopology, runtime, now });
  const catalog = await readiness.ensure({
    relayBaseUrl: "https://relay.example",
    primaryRegionId: "19",
    configuredRegionIds: ["3", "19"],
  });
  assert.deepEqual(catalog.regionIds, ["3", "19"]);
  assert.deepEqual(runtime.reconciliations, [{
    relayBaseUrl: "https://relay.example",
    primaryRegionId: "19",
    activeRegionIds: ["3", "19"],
  }]);
});

test("concurrent callers share one topology discovery", async () => {
  await Promise.all([readiness.ensure(input), readiness.ensure(input)]);
  assert.equal(discoveryCalls, 1);
});
~~~

Add a route integration case with BITCRAFT_PROCESS_ROLE=web that expects /api/local/map/regions to return both ready fixture regions and a resource partition to enter loading/live instead of unconfigured 503.

Add authorization assertions proving denied Map-page subjects still receive 403 before readiness discovery or lease creation.

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-resource-readiness.test.mjs test/map-resource-route-integration.test.mjs test/server-process-role.test.mjs
~~~

- [ ] **Step 3: Implement readiness service and route seam**

~~~ts
export class RelayMapResourceReadiness {
  async ensure(input: ReadinessInput): Promise<MapResourceRegionCatalog> {
    if (this.#fresh(input)) return this.#lastGood!;
    if (this.#inflight) return this.#inflight;
    this.#inflight = this.#refresh(input).finally(() => { this.#inflight = null; });
    return this.#inflight;
  }
}
~~~

Call ensure before /map/regions, /map/resources, resource-bearing /map/snapshot, and /map/resource-events. Remove the worker-only reconciliation block for relayMapResourceRuntime. A discovery failure returns last-good stale ready regions; it does not empty the catalog.

- [ ] **Step 4: Run tests and build**

~~~sh
node --experimental-strip-types --test test/map-resource-readiness.test.mjs test/map-resource-route-integration.test.mjs test/server-process-role.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/game-data/mapResourceReadiness.ts apps/bitcraft-local/src/server/game-data/index.ts apps/bitcraft-local/server.mjs apps/bitcraft-local/test/map-resource-readiness.test.mjs apps/bitcraft-local/test/map-resource-route-integration.test.mjs apps/bitcraft-local/test/server-process-role.test.mjs
git commit -m "fix(map): configure resources in the web role"
~~~

### Task 8: Single-pass regional resource normalization

**Files:**
- Modify: apps/bitcraft-local/src/server/game-data/mapResourceProjection.ts
- Modify: apps/bitcraft-local/src/server/game-data/mapResourceRegionSession.ts
- Modify: apps/bitcraft-local/test/map-resource-projection.test.mjs
- Modify: apps/bitcraft-local/test/map-resource-region-session.test.mjs

**Interfaces:**
- Produces normalizeMapResourceRegionGeneration({ regionId, resourceIds, resourceRows, locationRows, observedAt }): Map<string, MapResourceGenerationData>.
- Session snapshots shared SDK rows once per coalesced dirty event and publishes complete per-type results independently.

- [ ] **Step 1: Write failing one-pass and partial-isolation tests**

~~~js
test("two selected types iterate each shared table once", async () => {
  const result = normalizeMapResourceRegionGeneration({
    regionId: "19",
    resourceIds: ["28", "130"],
    resourceRows: counted(resourceRows, resourceIterations),
    locationRows: counted(locationRows, locationIterations),
    observedAt,
  });
  assert.equal(resourceIterations.count, 1);
  assert.equal(locationIterations.count, 1);
  assert.equal(result.get("28").resources.length, 2);
  assert.equal(result.get("130").resources.length, 1);
});

test("missing type 130 location does not block complete type 28", async () => {
  const result = normalizeMapResourceRegionGeneration(fixture);
  assert.equal(result.get("28").complete, true);
  assert.equal(result.get("130").complete, false);
});
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-resource-projection.test.mjs test/map-resource-region-session.test.mjs
~~~

- [ ] **Step 3: Implement grouping/indexing once**

Build one location map keyed by entity ID and one resource entity group keyed by selected resource ID. Sort each output once by decimal-string entity ID. In the session, replace the loop that calls #applyResource for each subscription with #applyGeneration(connection), which reads both tables once and publishes each complete result; incomplete types emit status while other types publish.

- [ ] **Step 4: Run tests**

~~~sh
node --experimental-strip-types --test test/map-resource-projection.test.mjs test/map-resource-region-session.test.mjs
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/game-data/mapResourceProjection.ts apps/bitcraft-local/src/server/game-data/mapResourceRegionSession.ts apps/bitcraft-local/test/map-resource-projection.test.mjs apps/bitcraft-local/test/map-resource-region-session.test.mjs
git commit -m "perf(map): normalize regional resources once"
~~~

### Task 9: Zero-resort resource paging and valid large totals

**Files:**
- Modify: apps/bitcraft-local/src/server/mapResourcePages.mjs
- Modify: apps/bitcraft-local/src/server/game-data/mapResourceRuntime.ts
- Modify: apps/bitcraft-local/src/pages/map/nativeMapRequest.mjs
- Modify: apps/bitcraft-local/test/map-resource-pages.test.mjs
- Modify: apps/bitcraft-local/test/map-resource-runtime.test.mjs
- Modify: apps/bitcraft-local/test/map-resource-route-integration.test.mjs
- Modify: apps/bitcraft-local/test/map-page-boundary.test.mjs

**Interfaces:**
- Runtime snapshots expose `compactPartitions: Map<string, readonly [string, string, string, number, number][]>`; the page builder slices the already sorted exact partition.
- Maximum resource types remains 16.
- Maximum region/type partitions becomes 256, sufficient for 16 types across 13 regions.
- No aggregate 50,000 feature cap; page limits remain 20,000 rows and 4 MiB.

- [ ] **Step 1: Write failing paging and scope tests**

~~~js
test("120000 rows page without sorting the partition again", () => {
  const rows = instrumentedSortedRows(120_000);
  const payload = buildMapResourcePartitionPayload({
    scope: { regionId: "19", resourceId: "130", cursor: null },
    resourceCollection: collectionWithCompactPartition(rows),
    cursorCodec,
  });
  assert.equal(payload.resources.length, 20_000);
  assert.equal(payload.complete, false);
  assert.equal(rows.sortCalls, 0);
});

test("16 resources across 13 regions is a valid scope", () => {
  const scope = parseMapResourceSelectionScope(paramsFor(13, 16), {
    allowedRegionIds: regionIds(13),
    allowedResourceIds: resourceIds(16),
    maxResourceIds: 16,
    maxPartitions: 256,
  });
  assert.equal(scope.regionIds.length * scope.resourceIds.length, 208);
});
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-resource-pages.test.mjs test/map-resource-runtime.test.mjs test/map-resource-route-integration.test.mjs test/map-page-boundary.test.mjs
~~~

- [ ] **Step 3: Implement slice-only paging and bounded admission**

Store compact sorted tuples with each accepted runtime snapshot. Page by offset and byte budget without compactRows over the full partition. Change nativeMapResourceSelectionLimit to return 16 when at least one ready region exists. Replace the 64-partition request ceiling with 256. Keep the per-region session type cap 16 and per-partition node/byte safeguards. Cold overload must report pending/429 with retry delay, not false permanent unavailable.

- [ ] **Step 4: Run tests and build**

~~~sh
node --experimental-strip-types --test test/map-resource-pages.test.mjs test/map-resource-runtime.test.mjs test/map-resource-route-integration.test.mjs test/map-page-boundary.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/mapResourcePages.mjs apps/bitcraft-local/src/server/game-data/mapResourceRuntime.ts apps/bitcraft-local/src/pages/map/nativeMapRequest.mjs apps/bitcraft-local/test/map-resource-pages.test.mjs apps/bitcraft-local/test/map-resource-runtime.test.mjs apps/bitcraft-local/test/map-resource-route-integration.test.mjs apps/bitcraft-local/test/map-page-boundary.test.mjs
git commit -m "perf(map): page dense resources without global caps"
~~~

### Task 10: Progressive partition rendering

**Files:**
- Modify: apps/bitcraft-local/src/pages/map/mapResourcePartitionLoader.mjs
- Modify: apps/bitcraft-local/src/pages/map/mapResourcePartitionLoader.d.mts
- Modify: apps/bitcraft-local/src/pages/map/mapResourcePartitionState.mjs
- Modify: apps/bitcraft-local/src/pages/map/mapResourcePartitionState.d.mts
- Modify: apps/bitcraft-local/src/pages/map/NativeMap.tsx
- Modify: apps/bitcraft-local/test/map-resource-partition-loader.test.mjs
- Modify: apps/bitcraft-local/test/map-resource-partition-state.test.mjs
- Modify: apps/bitcraft-local/test/map-resource-snapshot-state.test.mjs

**Interfaces:**
- Loader adds onPage({ key, regionId, resourceId, generation, rows, complete, freshness, warnings }).
- State adds applyResourcePartitionPage(state, page) and preserves lastComplete while replacement staging is incomplete.
- Cold staging rows may render as loading/partial; a previous complete generation remains visible until atomic replacement.

- [ ] **Step 1: Write failing progressive and stale-generation tests**

~~~js
test("first page publishes before final page", async () => {
  const pages = [];
  const loader = createMapResourcePartitionLoader({
    fetchPage: twoPageFetch,
    onPage: (page) => pages.push(page),
    onPartition: () => {},
    onStatus: () => {},
  });
  loader.setScope([partition]);
  await firstPageGate;
  assert.equal(pages.length, 1);
  assert.equal(pages[0].complete, false);
});

test("generation change clears cold staging but keeps prior complete", () => {
  const withPrior = completePartition("19|resource:130", "7", priorRows);
  const staged = applyResourcePartitionPage(withPrior, page("8", firstRows, false));
  const restarted = applyResourcePartitionPage(staged, page("9", replacementRows, false));
  assert.deepEqual(resourceRowsFromPartitions(restarted), priorRows);
  assert.deepEqual(stagingRows(restarted), replacementRows);
});
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-resource-partition-loader.test.mjs test/map-resource-partition-state.test.mjs test/map-resource-snapshot-state.test.mjs
~~~

- [ ] **Step 3: Implement progressive staging**

Emit onPage after each validated page. Deduplicate tuple entity IDs inside one generation. For a cold partition, expose staging rows with status loading; for replacement, render lastComplete until complete. On complete, atomically promote staging. Abort removes only obsolete staging. A stale-cursor restart clears staging once and never clears lastComplete.

- [ ] **Step 4: Run tests and build**

~~~sh
node --experimental-strip-types --test test/map-resource-partition-loader.test.mjs test/map-resource-partition-state.test.mjs test/map-resource-snapshot-state.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/pages/map/mapResourcePartitionLoader.mjs apps/bitcraft-local/src/pages/map/mapResourcePartitionLoader.d.mts apps/bitcraft-local/src/pages/map/mapResourcePartitionState.mjs apps/bitcraft-local/src/pages/map/mapResourcePartitionState.d.mts apps/bitcraft-local/src/pages/map/NativeMap.tsx apps/bitcraft-local/test/map-resource-partition-loader.test.mjs apps/bitcraft-local/test/map-resource-partition-state.test.mjs apps/bitcraft-local/test/map-resource-snapshot-state.test.mjs
git commit -m "feat(map): render resource partitions progressively"
~~~

### Task 11: Map performance and failure observability

**Files:**
- Create: apps/bitcraft-local/src/server/mapPerformance.mjs
- Modify: apps/bitcraft-local/server.mjs
- Modify: apps/bitcraft-local/src/server/game-data/mapResourceRuntime.ts
- Create: apps/bitcraft-local/test/map-performance.test.mjs
- Modify: apps/bitcraft-local/test/map-resource-runtime.test.mjs
- Create: apps/bitcraft-local/scripts/benchmark-native-map.mjs

**Interfaces:**
- Produces aggregate-only metrics: tile latency, pointer reload failures, partition states, rows/bytes distributions, generation latency, normalization duration, queue depth, reconnects, rejections, and event-loop delay.
- Benchmark exits non-zero when accepted p95/first-result thresholds fail.

- [ ] **Step 1: Write failing privacy and threshold tests**

~~~js
test("public map health contains aggregates but no coordinates or selected ids", () => {
  const health = publicMapHealth(runtimeHealth);
  assert.equal(JSON.stringify(health).includes("locationX"), false);
  assert.equal(JSON.stringify(health).includes("resourceIds"), false);
  assert.equal(health.resources.partitionCounts.live, 2);
});

test("benchmark rejects health p95 above 250ms", () => {
  const result = evaluateMapBenchmark({ healthMs: [90, 110, 290], cachedTileMs: [40, 70, 80] });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(" "), /health p95/i);
});
~~~

- [ ] **Step 2: Verify RED**

~~~sh
node --experimental-strip-types --test test/map-performance.test.mjs test/map-resource-runtime.test.mjs
~~~

- [ ] **Step 3: Implement aggregate telemetry and benchmark**

Use bounded histograms, never raw coordinates/selections. benchmark-native-map.mjs must continuously probe health and representative static tiles while selecting fixture partitions through injectable HTTP/SSE clients; record first-page, complete-partition, warm reselect, RSS, event-loop delay, response bytes, queue depth, 429, and 503 counts.

- [ ] **Step 4: Run tests and build**

~~~sh
node --experimental-strip-types --test test/map-performance.test.mjs test/map-resource-runtime.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
~~~

- [ ] **Step 5: Commit**

~~~sh
git add apps/bitcraft-local/src/server/mapPerformance.mjs apps/bitcraft-local/server.mjs apps/bitcraft-local/src/server/game-data/mapResourceRuntime.ts apps/bitcraft-local/test/map-performance.test.mjs apps/bitcraft-local/test/map-resource-runtime.test.mjs apps/bitcraft-local/scripts/benchmark-native-map.mjs
git commit -m "feat(map): add production performance gates"
~~~

### Task 12: Full verification, browser smoke, release, and deployment

**Files:**
- Modify only after checks pass: CHANGELOG.md
- Modify only after checks pass: apps/bitcraft-local/package.json
- Create uncommitted evidence: .superpowers/sdd/2026-08-13-native-map-production-reliability/final-report.md

**Interfaces:**
- Consumes every prior task.
- Produces a release candidate, ready PR, production deployment, enabled timers, and rollback evidence.

- [ ] **Step 1: Run focused map and deployment suites**

~~~sh
corepack pnpm --filter @workspace/bitcraft-local run build
node --experimental-strip-types --test apps/bitcraft-local/test/map-tile-pack-store.test.mjs apps/bitcraft-local/test/map-tile-pack-composer.test.mjs apps/bitcraft-local/test/terrain-tile-store.test.mjs apps/bitcraft-local/test/road-tile-store.test.mjs apps/bitcraft-local/test/map-tiles.test.mjs apps/bitcraft-local/test/map-world-generation-boundary.test.mjs apps/bitcraft-local/test/map-resource-readiness.test.mjs apps/bitcraft-local/test/map-resource-projection.test.mjs apps/bitcraft-local/test/map-resource-region-session.test.mjs apps/bitcraft-local/test/map-resource-runtime.test.mjs apps/bitcraft-local/test/map-resource-pages.test.mjs apps/bitcraft-local/test/map-resource-partition-loader.test.mjs apps/bitcraft-local/test/map-resource-partition-state.test.mjs apps/bitcraft-local/test/map-performance.test.mjs
node --test scripts/test/deploy-update-script.test.mjs scripts/test/deploy-update-integration.test.mjs scripts/test/deploy-map-generation-units.test.mjs
~~~

Expected: PASS.

- [ ] **Step 2: Run full application verification once at final head**

~~~sh
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
git diff --check
~~~

Expected: build PASS, full test suite PASS except documented environment skips, diff check PASS.

- [ ] **Step 3: Generate smoke full-world packs**

Use a job-private smoke data directory, never apps/bitcraft-local/data:

~~~powershell
$env:BITCRAFT_LOCAL_DATA_DIR = (Resolve-Path ".dev-data").Path
$env:BITCRAFT_FORCE_TERRAIN_WORLD = "true"
corepack pnpm --filter @workspace/bitcraft-local run map:build-terrain-world
$env:BITCRAFT_FORCE_ROAD_WORLD = "true"
corepack pnpm --filter @workspace/bitcraft-local run map:build-road-world
Remove-Item Env:BITCRAFT_FORCE_TERRAIN_WORLD
Remove-Item Env:BITCRAFT_FORCE_ROAD_WORLD
~~~

Verify manifests include every ready region and zooms -5..0.

- [ ] **Step 4: Start production-shaped split-role smoke**

Build, force-restart only because server code changed, then probe:

~~~sh
corepack pnpm --filter @workspace/bitcraft-local run build
node scripts/start-bitcraft-local-smoke.mjs --force-restart
curl.exe -s http://127.0.0.1:18449/api/local/health
~~~

Run benchmark-native-map.mjs against 18449 with Ghost Succulent plus one second dense resource across All regions. Expected: all accepted thresholds pass, no health interruption, no repeated 429/503, and released scopes idle/close.

- [ ] **Step 5: Browser smoke desktop and mobile**

At http://127.0.0.1:18449/?page=map:

1. Zoom to -5 and confirm full-world land/water remain.
2. Zoom to 0 in Regions 3, 12, and 19 and confirm detailed terrain.
3. Toggle roads, claims, claim areas, watchtowers, and biome highlighting.
4. Select Ghost Succulent plus another resource with All regions.
5. Confirm first region appears progressively and loaded partition count grows beyond one.
6. Hide/show the page and confirm one resume generation check.
7. Inspect console/network for third-party map requests, failed-fetch loops, and 429 loops.
8. Repeat with a mobile viewport.

- [ ] **Step 6: Prepare release metadata only after acceptance**

Follow VERSIONING.md beta rules. Move accumulated unreleased map notes into the new dated version in CHANGELOG.md and set the same version in apps/bitcraft-local/package.json. Entries must mention full-world terrain/roads, resource reliability, and safer static generation installation from the user's perspective.

~~~sh
git add CHANGELOG.md apps/bitcraft-local/package.json
git commit -m "chore(release): prepare native map reliability beta"
~~~

- [ ] **Step 7: Final two-axis review**

Use code-review against origin/main. Fix every Critical and Important finding test-first. Rerun affected focused tests, build, and the full suite after production-code corrections. Commit review fixes separately.

- [ ] **Step 8: Push and open a ready PR**

~~~sh
git push -u origin codex/map-production-reliability
gh pr create --base main --head codex/map-production-reliability --title "Release reliable full-world native map" --body-file .superpowers/sdd/2026-08-13-native-map-production-reliability/pr-body.md
~~~

Wait for required checks. Merge only after they pass.

- [ ] **Step 9: Deploy with static timers initially disabled**

Run the existing protected deployment workflow for the merged main SHA. Confirm web health before worker/collector. Validate installed terrain/road manifests and representative tile reads. Keep previous packs present.

- [ ] **Step 10: Live acceptance before enabling timers**

Continuously probe health and tiles while testing Ghost Succulent across All regions in the live browser. Confirm p95 targets, full-world coverage, no restart count change, no failed-fetch/429 loop, and no third-party map requests.

- [ ] **Step 11: Enable scheduled jobs**

~~~sh
sudo systemctl enable --now bitcraft-claim-monitor-relay-map-terrain.timer
sudo systemctl enable --now bitcraft-claim-monitor-relay-map-roads.timer
sudo systemctl list-timers 'bitcraft-claim-monitor-relay-map-*'
~~~

Do not manually start both generation services together. The shared lock must reject overlap.

- [ ] **Step 12: Record rollback and final evidence**

Record deployed SHA/version, manifest hashes, region coverage, benchmark results, service restart counts, timer next-run times, and previous retained pack versions in final-report.md. Rollback procedure: atomically repoint each product to its retained previous generation and restart only the web service if pointer reload does not occur within its TTL.
