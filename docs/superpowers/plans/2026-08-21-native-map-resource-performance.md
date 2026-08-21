# Native Map Resource Performance Implementation Plan

> **For Codex:** REQUIRED SUB-SKILLS: Use superpowers:subagent-driven-development to execute this plan task-by-task, superpowers:test-driven-development for every behavior change, and superpowers:verification-before-completion before claiming success.

**Goal:** Make a clicked resource produce a visible, identifiable map position from the first useful partition, while bounding Relay/browser fan-out, preserving progressive packed rendering, eliminating unrelated marker churn, and replacing the verified-character halo with a compact diamond.

**Architecture:** Keep the server-owned Relay and same-origin binary partition seam. Add an explicit transient locate intent and deterministic point-selection helper on the client, prioritize that intent through the resource event scope, bound client/server work queues, reuse immutable decoded generations briefly, share Relay topology discovery across map runtimes, and isolate dense-resource rendering from ordinary Leaflet marker lifecycle.

**Tech Stack:** React 19, TypeScript, Leaflet 1.9, Node 24, Node test runner, Vite, Relay HTTP, typed SpacetimeDB subscriptions.

**Spec:** `docs/superpowers/specs/2026-08-21-native-map-resource-latency-and-performance-design.md`

## Global Constraints

- Browsers must use only same-origin `/api/local/map/*` routes; Relay HTTP, typed subscriptions, schema validation, normalization, and provider records remain server-side.
- `All regions` means every Relay-ready region. Never satisfy a budget by silently truncating the ready-region list.
- Total selected resource partitions are at most 256; type selection is at most 16 and becomes `min(16, floor(256 / readyRegionCount))`.
- Resource event lease acquisition concurrency is at most 8. Browser binary fetch/decode/commit concurrency is at most 4.
- Exact decimal identities, schema-mismatch fail-closed behavior, provisional/committed separation, stale last-good behavior, and immutable binary generations remain intact.
- Existing selected resource buffers remain visible while new work loads. A new activation is consumed only after a matching point exists and never reframes later generations.
- Resource updates must not clear/recreate claims, watchtowers, players, or focus markers.
- Ordinary players remain circular/pulsed; only the approved exact verified character becomes a non-animated compact diamond.
- Preserve viewport culling, zoom budgets, Canvas layer ordering, colours, point radius, and outline. Do not add a spatial index/rendering framework without measured need.
- Do not edit `CHANGELOG.md`, package versions, the lockfile, legacy app exports, or unrelated code.

### Task 1: Implement explicit click-to-first-useful resource locating and the shared partition budget

**Files:**
- Create: `apps/bitcraft-local/src/map/mapResourceSelection.mjs`
- Create: `apps/bitcraft-local/src/map/mapResourceSelection.d.mts`
- Modify: `apps/bitcraft-local/src/pages/map/resourceViewport.mjs`
- Modify: `apps/bitcraft-local/src/pages/map/mapResourcePartitionState.mjs`
- Modify: `apps/bitcraft-local/src/pages/map/nativeMapRequest.mjs`
- Modify: `apps/bitcraft-local/src/pages/map/nativeMapRequest.d.mts`
- Modify: `apps/bitcraft-local/src/pages/MapPage.tsx`
- Modify: `apps/bitcraft-local/src/pages/map/NativeMap.tsx`
- Test: `apps/bitcraft-local/test/map-resource-viewport.test.mjs`
- Test: `apps/bitcraft-local/test/map-resource-partition-state.test.mjs`
- Test: `apps/bitcraft-local/test/native-map-request.test.mjs`
- Test: `apps/bitcraft-local/test/map-page-boundary.test.mjs`

**Step 1: Write the failing behavior tests**

Add literal, hand-derived tests proving:

- `mapResourceTypeLimitForRegions` admits 16 types for 13 and 16 regions, admits 15 for 17 regions, returns zero for no ready region, and never exceeds 256 partitions.
- `[]` persisted regions is explicit All; a non-empty stale persisted selection falls back to the ready claim region and then the first ready region rather than broadening to All.
- Browser partition order is resource-major and accepts optional in-scope priority resource/region values: exact priority pair, priority resource across other regions, then remaining resources/regions.
- Adding resource B produces a new locate activation for B; existing A points cannot consume it. Removing does not activate; removing/re-adding creates a new activation.
- A matching committed or provisional point is eligible even while unrelated partitions are loading. Empty partitions leave the activation pending.
- Preferred-region points win when available; otherwise any first-ready region is eligible. Within the chosen tier the nearest squared distance to the current map centre wins, with deterministic ties.
- The same activation is consumed once and preserves later user pan/zoom.
- The React boundary passes the raw persisted region selection, claim fallback, transient locate request, and priority query; aggregate `packedResourceBounds`/all-partition framing is no longer wired.

Run and record RED:

```powershell
node --experimental-strip-types --test test/map-resource-viewport.test.mjs test/map-resource-partition-state.test.mjs test/native-map-request.test.mjs test/map-page-boundary.test.mjs
```

**Step 2: Add the shared selection contract**

In `mapResourceSelection.mjs`, export:

```js
export const MAP_RESOURCE_PARTITION_BUDGET = 256;
export const MAP_RESOURCE_TYPE_LIMIT = 16;
export function mapResourceTypeLimitForRegions(regionIds, options) { /* bounded unique decimal regions */ }
```

Use this helper from `nativeMapRequest.mjs`; keep all ready regions and slice only admitted resource types. Change stale-region fallback semantics using the raw persisted selection and preferred claim region.

**Step 3: Add deterministic locate planning**

Replace the obsolete aggregate viewport helper with pure functions that identify newly added resource IDs and choose one packed point for an activation. Do not materialize all points into feature objects. Support committed and provisional `Uint32Array` buffers directly.

**Step 4: Wire click intent and priority**

When `MapPage.toggleResource` successfully adds a `resource:*` token, create a monotonically unique, non-persisted locate request containing the resource ID. Pass it and the preferred ready region to `NativeMap`. Extend `nativeMapRequest` so the resource event URL carries validated priority hints and its partition list uses the same priority order.

**Step 5: Locate on first useful point**

Put resource Canvas synchronization and locate-camera work in a resource-only effect. On the first point for the active request:

- measure click-to-visible with fixed, non-identifying browser performance mark/measure names;
- add a short-lived single-point first-party highlight;
- preserve the viewport if already visible, otherwise `flyTo` the point at at least zoom 1;
- consume only that activation.

Do not wait for `resourceLayerLoading` to become false and do not calculate aggregate bounds.

**Step 6: Run GREEN and build**

```powershell
node --experimental-strip-types --test test/map-resource-viewport.test.mjs test/map-resource-partition-state.test.mjs test/native-map-request.test.mjs test/map-page-boundary.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

**Step 7: Commit**

```powershell
git add apps/bitcraft-local/src/map/mapResourceSelection.mjs apps/bitcraft-local/src/map/mapResourceSelection.d.mts apps/bitcraft-local/src/pages/map/resourceViewport.mjs apps/bitcraft-local/src/pages/map/mapResourcePartitionState.mjs apps/bitcraft-local/src/pages/map/nativeMapRequest.mjs apps/bitcraft-local/src/pages/map/nativeMapRequest.d.mts apps/bitcraft-local/src/pages/MapPage.tsx apps/bitcraft-local/src/pages/map/NativeMap.tsx apps/bitcraft-local/test/map-resource-viewport.test.mjs apps/bitcraft-local/test/map-resource-partition-state.test.mjs apps/bitcraft-local/test/native-map-request.test.mjs apps/bitcraft-local/test/map-page-boundary.test.mjs
git commit -m "perf(map): locate newly selected resources first"
```

### Task 2: Isolate ordinary markers, batch resource Canvas drawing, and render the own marker as a diamond

**Files:**
- Modify: `apps/bitcraft-local/src/pages/map/NativeMap.tsx`
- Modify: `apps/bitcraft-local/src/pages/map/PackedResourceCanvasLayer.ts`
- Modify: `apps/bitcraft-local/src/styles/map.css`
- Test: `apps/bitcraft-local/test/map-page-boundary.test.mjs`
- Test: `apps/bitcraft-local/test/map-packed-resource-canvas.test.mjs`

**Step 1: Write failing lifecycle/presentation tests**

Add focused boundary tests using the repository's established map-boundary style:

- the ordinary-marker synchronization effect owns `clearLayers()` and does not depend on resource partitions, resource selection key, resource colours, or resource loading;
- the resource effect calls only packed Canvas synchronization and locate planning;
- debug samples are derived only when Debug is visible, while the cheap aggregate resource count remains available to layer/status UI;
- one Canvas path is begun, stroked, and filled per non-empty planned partition rather than per point;
- current-user markup omits the pulse element, current-user CSS has a compact square rotated 45 degrees, and no current-user halo/glow/pulse/reduced-motion override remains;
- ordinary player dot/pulse rules and verified identity/accessibility text remain unchanged.

Run and record RED:

```powershell
node --experimental-strip-types --test test/map-page-boundary.test.mjs test/map-packed-resource-canvas.test.mjs
```

**Step 2: Split marker/resource effects**

Keep focus/snapshot/enemy synchronization independent of resource buffers. A resource publication must not clear any ordinary marker group. Preserve cleanup and Leaflet hook order.

**Step 3: Gate debug sampling and batch Canvas paths**

Avoid deriving the 250 packed samples while Debug is hidden. In the Canvas layer, collect same-colour partition arcs in one path and stroke/fill once, preserving point index/stride semantics exactly.

**Step 4: Change only the approved marker presentation**

For current user only, omit pulse markup and use a 12px or smaller square rotated 45 degrees with a contrasting border. Keep the transparent hit target compact, preserve colour and accessible labels, and leave ordinary players unchanged.

**Step 5: Run GREEN and build**

```powershell
node --experimental-strip-types --test test/map-page-boundary.test.mjs test/map-packed-resource-canvas.test.mjs test/map-player-marker-identity.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

**Step 6: Commit**

```powershell
git add apps/bitcraft-local/src/pages/map/NativeMap.tsx apps/bitcraft-local/src/pages/map/PackedResourceCanvasLayer.ts apps/bitcraft-local/src/styles/map.css apps/bitcraft-local/test/map-page-boundary.test.mjs apps/bitcraft-local/test/map-packed-resource-canvas.test.mjs
git commit -m "perf(map): isolate dense resource rendering"
```

### Task 3: Bound browser binary loading and reuse warm decoded partitions

**Files:**
- Modify: `apps/bitcraft-local/src/pages/map/mapResourceBinaryState.mjs`
- Modify: `apps/bitcraft-local/src/pages/map/mapResourceBinaryState.d.mts`
- Modify: `apps/bitcraft-local/src/pages/map/mapResourceBinaryLoader.mjs`
- Modify: `apps/bitcraft-local/src/pages/map/mapResourceBinaryLoader.d.mts`
- Test: `apps/bitcraft-local/test/map-resource-binary-state.test.mjs`
- Test: `apps/bitcraft-local/test/map-resource-binary-loader.test.mjs`

**Step 1: Write failing queue/cache tests**

Using deferred real promises and real encoded partition bytes, prove:

- five ready events start four loads; completing one starts the fifth; maximum fetch/decode/commit concurrency is four;
- duplicate queued generation coalesces; a newer queued generation replaces the old; a newer active generation aborts obsolete work and queues one replacement;
- 409 recovery uses the same active slot;
- pause, scope removal, and stop clear queued work, abort active work, and prevent late publication;
- a fresh committed generation enters an eight-entry/16 MiB LRU on deselection and is immediately restored on reselection;
- matching initial `partition-ready` confirms cached data and performs no fetch; changed generation performs exactly one fetch;
- stale, unavailable, provisional, or oversized data is never cached; entry/byte LRU eviction is deterministic;
- a cached partition cannot incorrectly satisfy a missed-base delta.

Run and record RED:

```powershell
node --experimental-strip-types --test test/map-resource-binary-state.test.mjs test/map-resource-binary-loader.test.mjs
```

**Step 2: Add the bounded keyed queue**

Extend the existing loader with scalar options `maxConcurrentLoads = 4`, `cacheMaxEntries = 8`, and `cacheMaxBytes = 16 * 1024 * 1024`. Use insertion-ordered pending work plus active work keyed by partition; a slot covers fetch, decode, validation, and publication.

**Step 3: Add private decoded LRU hydration**

Admit only fresh committed buffers on deselection. Reconcile active scope from cache before opening the SSE connection, mark the restored value as awaiting confirmation, and let the initial exact-generation event promote it or request the new generation. Do not expose cache state outside the loader.

**Step 4: Run GREEN and build**

```powershell
node --experimental-strip-types --test test/map-resource-binary-state.test.mjs test/map-resource-binary-loader.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

**Step 5: Commit**

```powershell
git add apps/bitcraft-local/src/pages/map/mapResourceBinaryState.mjs apps/bitcraft-local/src/pages/map/mapResourceBinaryState.d.mts apps/bitcraft-local/src/pages/map/mapResourceBinaryLoader.mjs apps/bitcraft-local/src/pages/map/mapResourceBinaryLoader.d.mts apps/bitcraft-local/test/map-resource-binary-state.test.mjs apps/bitcraft-local/test/map-resource-binary-loader.test.mjs
git commit -m "perf(map): bound and cache resource partitions"
```

### Task 4: Bound and prioritize server Relay work, share topology discovery, and narrow event invalidation

**Files:**
- Modify: `apps/bitcraft-local/src/server/mapResourcePages.mjs`
- Modify: `apps/bitcraft-local/src/server/mapResourceBinaryRoute.mjs`
- Modify: `apps/bitcraft-local/src/server/mapSnapshot.mjs`
- Modify: `apps/bitcraft-local/src/server/game-data/topology.ts`
- Modify: `apps/bitcraft-local/src/server/game-data/gameDataRoute.ts`
- Modify: `apps/bitcraft-local/server.mjs`
- Test: `apps/bitcraft-local/test/map-resource-pages.test.mjs`
- Test: `apps/bitcraft-local/test/map-resource-binary-route.test.mjs`
- Test: `apps/bitcraft-local/test/map-snapshot.test.mjs`
- Test: `apps/bitcraft-local/test/relay-topology-http.test.mjs`
- Test: `apps/bitcraft-local/test/map-resource-route-integration.test.mjs`
- Test: `apps/bitcraft-local/test/map-page-boundary.test.mjs`

**Step 1: Write failing server behavior tests**

Prove:

- exact 16×16 scope is accepted and 17×16 is rejected; generic map scope cannot bypass the same 256 budget;
- priority hints are accepted only inside the validated scope and produce exact pair → priority resource/remaining regions → remaining resource-major order;
- a 20-task lease plan never exceeds eight active workers, starts the ninth only after a slot, preserves input result order, and waits for already-started siblings before propagating the first failure;
- resource-events and generic snapshot/events acquisition use the same concurrency cap and release every populated lease slot on failure/closure;
- a shared topology resolver coalesces concurrent normalized-base-URL calls, caches successful results for 60 seconds, refreshes after TTL, and immediately evicts failures;
- the same resolver instance is injected into map readiness, resource runtime, and spatial scope manager;
- `mapGenerationDomainsForLayers` returns only the exact canonical domains needed by requested layers, and `server.mjs` uses it for listener plus initial event;
- the server has exactly one `/api/local/map/resources` handler: keep the canonical paged rollback/diagnostic route and remove the unreachable duplicate grouped snapshot branch.

Run and record RED:

```powershell
node --experimental-strip-types --test test/map-resource-pages.test.mjs test/map-resource-binary-route.test.mjs test/map-snapshot.test.mjs test/relay-topology-http.test.mjs test/map-resource-route-integration.test.mjs test/map-page-boundary.test.mjs
```

**Step 2: Validate and prioritize scope**

Reuse the shared 256 constants. Extend selection scope with optional validated priority identities and make `mapResourceSelectionLeasePlan` return the deterministic priority order with `concurrency: min(8, inputs.length)`.

**Step 3: Make bounded acquisition failure-safe**

Update `runWithConcurrency` to retain the first failure, settle already-started work, and only then throw. Store acquired leases by input index so failure and request-close cleanup releases every lease regardless of completion order. Use the cap for resource-event and generic map acquisition work inside the existing claim fence.

**Step 4: Share topology discovery**

Add `createRelayTopologyDiscoveryCache({ discover, ttlMs = 60_000, now = Date.now })`. Normalize the base URL key, cache successes only, share one in-flight promise, and inject one server instance into resource readiness, resource runtime, and spatial manager.

**Step 5: Derive generation domains**

Implement exact mappings:

- claims → `region-claims`, `map-spatial`
- markets → `market`
- waystones → `region-claims`
- empire settlements/territory/watchtowers → `empires`
- players → `members`, `players`, `map-spatial`
- resources → `map-resources`
- enemies → `map-spatial`
- roads/claim-areas → none at current HEAD

Deduplicate in canonical domain order. Do not include `map-static`, which has no current generation producer.

**Step 6: Remove only proven-dead route code**

Keep the first paged `/api/local/map/resources` rollback/diagnostic endpoint and its compact/full runtime representations. Remove `/resources` from the later grouped snapshot/events route plus its unreachable validation/payload branch and now-unused `buildMapResourcePayload` surface. Do not remove runtime representations while the supported paged route and generic `snapshot?layers=resources` consume them.

**Step 7: Run GREEN, build, and server tests**

```powershell
node --experimental-strip-types --test test/map-resource-pages.test.mjs test/map-resource-binary-route.test.mjs test/map-snapshot.test.mjs test/relay-topology-http.test.mjs test/map-resource-route-integration.test.mjs test/map-page-boundary.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
```

**Step 8: Commit**

```powershell
git add apps/bitcraft-local/src/server/mapResourcePages.mjs apps/bitcraft-local/src/server/mapResourceBinaryRoute.mjs apps/bitcraft-local/src/server/mapSnapshot.mjs apps/bitcraft-local/src/server/game-data/topology.ts apps/bitcraft-local/src/server/game-data/gameDataRoute.ts apps/bitcraft-local/server.mjs apps/bitcraft-local/test/map-resource-pages.test.mjs apps/bitcraft-local/test/map-resource-binary-route.test.mjs apps/bitcraft-local/test/map-snapshot.test.mjs apps/bitcraft-local/test/relay-topology-http.test.mjs apps/bitcraft-local/test/map-resource-route-integration.test.mjs apps/bitcraft-local/test/map-page-boundary.test.mjs
git commit -m "perf(map): bound Relay resource fan-out"
```

### Task 5: Add a real SSE-to-binary resource-client benchmark

**Files:**
- Create: `apps/bitcraft-local/scripts/benchmark-map-resource-client.mjs`
- Create: `apps/bitcraft-local/test/map-resource-client-benchmark.test.mjs`
- Modify: `apps/bitcraft-local/test/map-performance.test.mjs`

**Step 1: Write failing injected-client benchmark tests**

With fake SSE and HTTP adapters plus real encoded bytes, prove the runner:

- commits every requested partition through the real `createMapResourceBinaryLoader`;
- records first-partition and complete-selection elapsed time, decoded bytes, cold/warm request counts, and maximum active loads;
- never exceeds configured concurrency;
- deselect/reselect of a matching generation is cache-only;
- changed generation fetches exactly once;
- fails deterministically on missing partitions, malformed binary, unexpected HTTP, or a functional concurrency/cache invariant;
- never includes authentication/cookie values in returned metrics or logs.

Run and record RED:

```powershell
node --experimental-strip-types --test test/map-resource-client-benchmark.test.mjs test/map-performance.test.mjs
```

**Step 2: Implement the benchmark**

Instantiate the production binary loader with injected adapters. Provide a small Node streaming-SSE adapter and native fetch adapter for manual authorized use. Keep timing thresholds opt-in via environment variables; deterministic tests enforce complete scope, concurrency, request-count, and warm-cache invariants.

Do not replace the existing codec/memory benchmark or the server health/tile/legacy-route benchmark; each retains a different diagnostic role.

**Step 3: Run GREEN and codec benchmark**

```powershell
node --experimental-strip-types --test test/map-resource-client-benchmark.test.mjs test/map-performance.test.mjs test/map-resource-binary-loader.test.mjs
node --expose-gc scripts/benchmark-map-resource-binary.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Run the live resource-client benchmark only when an authorized local server and explicit region/resource environment values are available. Never print credentials.

**Step 4: Commit**

```powershell
git add apps/bitcraft-local/scripts/benchmark-map-resource-client.mjs apps/bitcraft-local/test/map-resource-client-benchmark.test.mjs apps/bitcraft-local/test/map-performance.test.mjs
git commit -m "test(map): benchmark the binary resource client"
```

### Task 6: Final verification, browser smoke, and review

**Files:** no planned production edits; any review fix must receive its own focused test and scoped re-review.

**Step 1: Run full verification on the final tree**

```powershell
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
node --expose-gc apps/bitcraft-local/scripts/benchmark-map-resource-binary.mjs
```

If the known deployment worker test fails with a filesystem `EPERM` child-process error, rerun that one test outside the restricted filesystem sandbox and record both outputs; do not change deployment code.

**Step 2: Browser-smoke the built map**

```powershell
node scripts/start-bitcraft-local-smoke.mjs --restart
curl.exe -s http://127.0.0.1:18449/api/local/health
```

Open `http://127.0.0.1:18449/?page=map` and verify:

- selecting an off-screen resource moves/highlights the first available matching point without waiting for every partition;
- adding a second type locates that type, not a previously selected point;
- progressive points remain visible and deselect/reselect is warm;
- resource arrivals do not visibly recreate player/claim markers;
- pan/zoom remains responsive and console/network show no errors, 429/503 burst, or third-party resource request;
- Debug samples appear only with Debug enabled;
- when an approved verified character is available, exactly one marker is the compact diamond and ordinary players remain circular.

**Step 3: Whole-branch code review**

Generate a review package from the branch base to HEAD and dispatch the final reviewer using `superpowers:requesting-code-review`. Fix all Critical/Important findings in one fix wave, rerun covering tests, then perform one scoped re-review.

**Step 4: Commit any verified review fixes**

```powershell
git add <only reviewed fix files>
git commit -m "fix(map): address performance review findings"
```

**Step 5: Present integration options**

Use `superpowers:finishing-a-development-branch`. Do not merge or push without the user's explicit choice.
