# Native Map Production Reliability Design

## Outcome

The app-owned map becomes a production-safe replacement for the external BitCraft map.

The release must provide:

- a responsive map shell;
- full-world land, water, biome, and road tiles generated from Relay data;
- selected live resources across every Relay-ready region;
- claims, claim areas, watchtowers, players, and the existing map controls;
- last-good behavior during Relay, generation, deployment, and schema failures; and
- isolation between infrequent high-memory generation work and ordinary web requests.

No browser request may contact Relay, BitJita, Prism, BitCraftMap, or a third-party tile host.

## Accepted performance targets

- The map becomes interactive within 2 seconds under normal production load.
- Cached tile responses complete within 100 ms at p95.
- Cold on-disk tile responses complete within 250 ms at p95.
- The first selected resource region becomes visible within 3 seconds from a cold subscription.
- A retained resource selection becomes visible within 500 ms.
- Additional resource regions appear progressively instead of blocking the first usable result.
- The health endpoint completes within 250 ms at p95.
- Terrain generation, road generation, artifact installation, and dense resource selection do not restart or block the web service.

These are acceptance gates, not aspirational telemetry. A release that misses them remains in smoke until the cause is understood.

## Confirmed production faults

### 1. The resource runtime has the wrong process owner

Production separates the HTTP web role from the worker role. The map resource routes execute in the web role, but `RelayMapResourceRuntime.reconcile()` is currently reached only from `startBackgroundTasks()`, which does not run in the web role.

The combined local smoke role masks this fault. In production, a selected resource can therefore reach an unconfigured runtime and remain unavailable. A live Ghost Succulent selection reproduced this as `0/1` loaded partitions followed by an unavailable state.

### 2. Tile installation races the active reader

The existing terrain store caches `current.json`. Every tile read then calls its pruning routine. A different process can install generation B while the web process still holds generation A; the next read from the old process treats B as non-current and deletes it.

A deterministic local reproduction installed a valid version-shaped generation B after generation A was cached. Reading one generation-A tile deleted B.

The current updater also extracts the static bundle directly into the live data directory before restarting the web service. The reader/writer race makes that installation path unsafe even when the archive itself is valid.

### 3. Low-zoom terrain is composed on the request path

The current full-world overview consists of 13 batch stores. A single overview tile can cause 13 file lookups, repeated store pruning, and Sharp compositing inside the web request.

That work belongs in the infrequent generation job. A production tile request must resolve to one immutable file read.

### 4. Current static coverage is incomplete

The bundled detail terrain covers Region 19. The bundled roads also cover only Region 19. Thirteen terrain overview batches provide low-zoom coverage, but they do not provide full-world detail at zooms `-1..0`.

The static generation pipeline therefore needs to build all Relay-ready overworld regions, not merely install the current bundle more safely.

### 5. Resource generations repeat expensive work

The regional resource session currently scans the shared SDK resource and location caches once for every selected resource after a dirty event. The page builder then normalizes and sorts the complete partition again for every page request.

With dense resources and several selected types, those repeated full-cache scans and sorts can block the Node event loop even though the network queries themselves are correctly filtered.

## Architecture

The map uses two deliberately different data paths.

### Static operational layers

Terrain, water, biome masks, and roads are immutable versioned tile packs.

- Terrain and water generate once per week during an off-peak window.
- Roads generate once per day during an off-peak window.
- A browser request never starts either job.
- A web process never renders, composites, installs, or prunes a tile pack.
- The web process reads one already-composed WebP file for each requested layer tile.
- Generation failure leaves the previous complete pack installed.

### Live dense layers

Selected resources remain event-driven Relay subscriptions.

- The web role owns the resource runtime because it owns the authenticated HTTP and event-stream lifecycle.
- One regional connection is shared by all selected types for that region.
- One filtered subscription pair is retained per selected resource type and region.
- Equivalent browser scopes share the same runtime entries.
- Resource partitions remain independently usable so Region 19 can render while another region is still connecting.
- Exact points remain lossless and provider-neutral.

Claims, claim areas, watchtowers, and player positions continue through their existing normalized seams. This design does not reintroduce the external iframe or a direct browser Relay client.

## Static tile generation

### Terrain product

The weekly job discovers the complete current set of schema-ready overworld regional modules and processes them sequentially or in a bounded batch size.

For every region it:

1. validates the schema fingerprint;
2. subscribes to the verified terrain tables for dimension `1`;
3. waits for a complete normalized generation;
4. renders terrain, water, and biome-mask tiles for zooms `-5..0` into a job-private staging directory; and
5. disconnects before processing the next bounded batch.

After every expected region succeeds, an offline composition pass merges overlapping regional tiles into one full-world tile pack. Composition uses Sharp only inside the job. The final pack contains one file per style/zoom/x/y and one manifest.

The manifest records:

- provider and schema fingerprints;
- generation and source observation times;
- every included region;
- dimension and world bounds;
- zoom range;
- biome and water metadata derived from the same generation;
- per-channel tile and byte counts;
- total tile and byte counts;
- evidence hash and palette version; and
- generation duration and warnings.

No partially completed regional set may become current.

### Road product

The daily road job uses the verified `paved_tile_state.entity_id = location_state.entity_id` join for dimension `1`.

It processes every schema-ready overworld region in bounded sequence. Each region is converted to transparent road tiles in job-private staging. A final offline pass composes overlaps into one full-world road pack for zooms `-5..0`.

The road manifest records all included regions, the verified join version, feature count, tile count, byte count, bounds, source observation time, and generation duration.

The daily job fails closed if any expected region has a schema mismatch, invalid dimension, impossible coordinates, or an incomplete subscription generation. The previous road pack remains current.

### Job resource policy

Generation may use a substantial but bounded amount of RAM because it runs infrequently and outside peak hours. It must not compete with the web service indefinitely.

- Jobs run as dedicated one-shot systemd services, not inside the long-running web or Discord worker process.
- Terrain and road jobs cannot overlap each other.
- systemd applies a generous memory ceiling and a finite runtime deadline.
- Jobs have lower CPU and I/O scheduling priority than the web service.
- One failed job does not trigger a service deployment or web restart.
- Raw regional caches are released between batches.
- Job logs contain counts, durations, hashes, and region IDs, never player positions or secret configuration.

## Atomic installation and retention

Every generated or release-bundled tile pack uses the same installer contract.

1. Extract or generate beneath a unique staging root outside all live map directories.
2. Validate archive paths before extraction.
3. Validate every manifest, referenced file, tile count, total byte count, world bound, and required layer.
4. Set ownership and permissions on staging, never recursively on the live tree.
5. Write a durable completion marker containing the manifest hash.
6. Rename the completed version into a versioned immutable pack directory.
7. Atomically replace a small `current.json` pointer only after the installed version is durable.
8. Health-check the new pointer and representative tiles.
9. Retain the previous complete generation for rollback.
10. Prune older generations only from a separate maintenance path after a grace period.

Tile reads never call pruning. Active response leases are no longer used as cross-process deletion protection because process-local leases cannot protect a generation from another installer process.

The web store revalidates the small current pointer by file identity/mtime with a short cache, and keeps its last valid pointer when a replacement is malformed or briefly unreadable. It never switches to a version until the completion marker and manifest validate.

Release deployment may bootstrap a known-good tile pack, but it uses the same staging installer. The updater must not extract into live directories while the existing web process is serving them.

## Tile request path

The production tile path is intentionally shallow:

```text
validate path
  -> read cached current pointer
  -> resolve one immutable file
  -> read/send bytes
```

There is no Relay access, SQLite write, directory scan, Sharp call, tile composition, generation, or pruning in this path.

Tile URLs include their generation query value. Successful tiles therefore use a one-year immutable cache policy. Status responses remain no-store and return independent terrain and road generations.

Terrain freshness reflects its weekly schedule and roads freshness reflects their daily schedule. They are not marked stale after five minutes. Recommended initial thresholds are eight days for terrain and 36 hours for roads, with last-good warnings after those thresholds.

## Resource readiness and process ownership

The web role gains one focused map-resource readiness service.

It:

- discovers Relay topology through the existing provider seam;
- caches and single-flights topology reads for 60 seconds;
- retains the last-good ready-region catalog during a transient discovery failure;
- intersects ready regions with the configured/approved map scope;
- reconciles `RelayMapResourceRuntime` in the web process; and
- supplies the same region catalog to `/api/local/map/regions`, resource partitions, snapshots containing resources, and resource event streams.

The first request after web startup may trigger one bounded reconciliation. Concurrent callers await the same promise. An unready regional source affects only that region and does not make ready regions disappear.

The worker role no longer owns or configures the web resource runtime. Smoke tests must run with split web/worker roles so the production ownership boundary cannot regress again.

## Resource normalization and indexing

One dirty regional SDK generation is normalized once.

The session takes one snapshot of the shared filtered `resource_state` and `location_state` caches, then:

1. indexes locations by entity ID once;
2. groups resource entities by selected resource ID once;
3. validates overworld dimension and coordinates once;
4. sorts each resulting resource partition once by lossless entity ID; and
5. publishes complete immutable per-type snapshots.

If any selected type is incomplete, only that type retains its last-good partition and receives a partial warning. Other complete types publish normally.

The page API slices the already normalized compact partition. It does not rebuild, re-filter, or re-sort all rows for every continuation page.

Dense resources are governed by per-partition byte and node ceilings rather than one aggregate 50,000-feature cap. Valid selections may exceed 50,000 total points across regions. Initial safety ceilings remain explicit and benchmarked, but are applied independently so one dense region cannot discard other usable regions.

## Progressive browser loading

The browser keeps the existing region/resource partition model but makes progress visible sooner.

- Up to four partition requests run concurrently initially.
- Pages for one region/type keep one generation token.
- On a first cold load, validated pages may render progressively with that partition marked loading/partial.
- A completed prior generation remains visible while its replacement is assembled.
- If the generation changes during paging, the staging pages are discarded and restarted once.
- A permanent failure is distinct from a pending subscription.
- Resource event notifications refresh only affected partition keys.
- Hidden pages release/stop refresh work and resume with one generation check.
- Canvas rendering remains above operational markers where required, uses viewport culling and deterministic level of detail, and never creates one DOM node per resource.

The all-regions selection means every Relay-ready region. It must not silently collapse to the settlement region.

## Backpressure and server protection

The web service remains authoritative for admission control.

- Equivalent scopes share subscriptions.
- Resource subscriptions retain the existing idle timeout.
- Cold starts enter a bounded queue instead of returning a false permanent-unavailable state for an otherwise valid selection.
- The queue prioritizes the selected/settlement region, then other visible or numerically ordered regions.
- Reconnects use exponential backoff with jitter.
- Row-change bursts coalesce into one normalization pass per region.
- Normalization yields between bounded chunks when measurements show event-loop delay approaching the health budget.
- Request and event-stream rate limits remain separate.
- Response bodies are paged and compressed; no single response is allowed to monopolize the event loop or socket buffer.
- Runtime health exposes aggregate connection, queue, row, byte, generation-latency, reconnect, and rejection counters without resource selections or coordinates.

If resource workload threatens the web service, new cold scopes are queued or rejected while existing map, health, and non-resource routes remain available. Static terrain and roads never depend on the live resource runtime.

## Public API behavior

Existing same-origin URLs remain stable where practical:

```text
GET /api/local/map/tiles/status
GET /api/local/map/tiles/{terrain|water|biome-N|roads}/{z}/{x}/{y}.webp
GET /api/local/map/regions
GET /api/local/map/resources?region=...&resourceId=...&cursor=...
GET /api/local/map/resource-events?regions=...&resourceIds=...
```

Resource payloads continue to preserve entity, region, and resource IDs as decimal strings. Coordinates remain integers in verified `map-xz` space and dimension `1`.

Status responses distinguish:

- not installed;
- generation running;
- current;
- last-good stale;
- region pending;
- schema unavailable; and
- capacity/backpressure.

HTTP `200` is used for usable progressive or last-good data, `422` for invalid/out-of-scope identity, `413` only for a documented per-partition/request budget, `429` with a retry delay for admission pressure, and `503` only when no requested partition is usable.

## Failure behavior

- A terrain or road generation failure leaves the installed pointer unchanged.
- An installer failure leaves staging isolated and the previous version readable.
- A malformed new pointer is ignored in favor of the cached last-good pointer.
- A schema mismatch stops only the affected generator or resource region/type.
- A resource disconnect retains last-good public resource points as stale but does not invent updates.
- Player positions keep their stricter live-only behavior and disappear when no longer current.
- A resource runtime failure does not remove static terrain, claims, roads, or watchtowers.
- A terrain absence preserves the coordinate fallback, but production acceptance requires an installed full-world pack.

## Observability

Public health remains privacy-safe. Administrative/server metrics add:

- tile status and representative read latency;
- pointer reload failures;
- generation age and duration per static product;
- generation and installer last error;
- number of retained tile generations;
- resource ready/loading/stale/unavailable partition counts;
- resource rows and bytes by aggregate distribution;
- first-generation and retained-generation latency distributions;
- normalization duration and event-loop delay;
- queued cold starts, reconnects, and capacity rejections; and
- map route p50/p95/p99 latency.

Coordinates, selected player IDs, full resource selections, cursor contents, and snapshot bodies remain absent from logs.

## Rollout

1. Fix resource process ownership and prove production-style split-role smoke behavior.
2. Remove prune/composition work from the tile request path and add the atomic installer.
3. Generate and validate a full-world terrain pack and full-world road pack in smoke/staging.
4. Install those packs through the new transaction and verify representative world-edge, settlement, water, biome, and road tiles.
5. Optimize single-pass resource normalization and progressive partition rendering.
6. Load-test high-density resources across all ready regions while continuously probing health and tile latency.
7. Add and enable the off-peak systemd timers only after manual generation succeeds.
8. Deploy with the previous tile generation retained for rollback.

The map may ship updates incrementally during beta, but the web process must not be exposed again to direct bundle extraction or request-time tile generation.

## Verification strategy

### Deterministic unit and integration tests

- Reproduce the old-reader/new-installer deletion race and prove the new generation survives.
- Prove tile reads perform no directory pruning or image composition.
- Prove pointer replacement is atomic and malformed pointers retain last-good.
- Prove old generations are retained until grace-period maintenance.
- Prove overview and roads are each one-file reads at every zoom.
- Prove terrain and road freshness use their schedule-specific windows.
- Prove a production web role configures resources without starting general worker jobs.
- Prove all ready regions appear in the resource catalog and All creates every expected partition.
- Prove one dirty event scans shared resource/location rows once, not once per selected type.
- Prove continuation pages slice an immutable normalized partition without repeated sorting.
- Prove progressive first-load, last-good replacement, generation restart, and abort cleanup.
- Prove aggregate totals greater than 50,000 remain usable while per-partition budgets still protect the server.

### Static generation acceptance

- Every ready overworld region appears in the terrain and road manifests.
- Terrain, water, and biome layers exist at zooms `-5..0` across the world bounds.
- Road tiles contain every verified regional batch.
- Installed tile counts and bytes match the manifests exactly.
- Representative known inland, coast, ocean, settlement, and road points align with claims and watchtowers.

### Production-shaped load test

Run the split web and worker services plus the same static stores used in production. While selecting dense resources across all ready regions:

- probe `/api/local/health` continuously;
- probe warm and cold representative tiles;
- record event-loop delay, RSS, CPU, response bytes, resource queue depth, and generation latency;
- verify claims and static layers remain interactive;
- verify no 429/503 storm or request fan-out occurs; and
- verify releasing the scope returns resource sessions to idle and then closes them.

### Browser smoke

- Open the whole world at zoom `-5` and confirm land/water never disappear.
- Zoom to `0` in multiple regions and confirm detailed terrain remains present.
- Toggle roads, claims, claim areas, watchtowers, resources, and biome highlighting.
- Select Ghost Succulent and another dense resource with All regions.
- Confirm the first region appears progressively and later regions increase the loaded partition count.
- Confirm no third-party map requests, console errors, failed-fetch loop, or 429 loop.
- Repeat at desktop and mobile widths.

## Deferred work

This reliability release does not add caves, portals, dungeons, enemy positions, or new POI categories whose Relay coordinate source remains unverified. Those layers cannot block terrain, roads, claims, players, and resource reliability.
