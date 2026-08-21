# Native Map Resource Latency and Performance Design

Date: 2026-08-21

## Goal

Make a resource selected in the Map resource list visibly locatable as soon as the first useful coordinate is available, while reducing Relay cold-start bursts, browser work, and unrelated Leaflet marker churn. Replace the verified user's large circular halo with a compact diamond marker.

## Existing architecture to preserve

- Browsers use only authenticated, same-origin `/api/local/map/*` routes. Relay HTTP, topology discovery, typed SpacetimeDB subscriptions, schema validation, normalization, and cache ownership remain server-side.
- Ordinary map snapshots exclude resource coordinates. Resources use `/api/local/map/resource-events` plus immutable binary `/api/local/map/resource-partition` generations.
- A resource partition remains `{regionId, resourceId}`. Provisional packed coordinates may render while a complete generation is hydrating; only a validated complete generation becomes committed last-good data.
- Resource nodes remain a packed, viewport-culled Canvas layer. They must not become one DOM or Leaflet marker per node.
- `All regions` continues to mean every Relay-ready region. A workload budget must constrain the Cartesian selection without silently changing `All` into an arbitrary subset.
- Existing schema mismatch, stale last-good, access-control, exact decimal identity, and same-origin rules remain unchanged.

## Problems confirmed in the current release

1. Resource framing waits until every selected partition stops loading. The visible result is therefore gated by the slowest partition, even when the newly selected resource already has a provisional or committed point.
2. Framing considers all selected resources and regions. An existing on-screen resource can prevent a newly clicked resource from being located at all.
3. Every resource-state publication clears and rebuilds ordinary claim, watchtower, player, and focus markers because resources and ordinary markers share one React effect.
4. The browser starts a binary fetch for every ready event without a concurrency bound. The server likewise admits up to 256 resource leases concurrently.
5. Deselecting a partition discards its decoded committed buffer, even though the server retains the matching immutable generation for warm reselection.
6. Map resource readiness and each cold regional resource/spatial session can repeat identical Relay topology HTTP discovery.
7. The client can request up to sixteen resource types independently of ready-region count, while the server's true safety boundary is 256 partitions.
8. `/api/local/map/events` listens to unrelated generation domains, causing avoidable snapshot reloads.
9. Resource Canvas drawing begins, strokes, and fills a path for every point instead of batching the same-colour partition path.
10. The native end-to-end benchmark still measures the legacy JSON resource-page route rather than the browser's SSE-to-binary path.
11. The verified character is rendered as a larger circular halo/pulse instead of the requested compact diamond or square.

## Selected resource locate behavior

- Adding a resource type creates a transient locate activation. It is not persisted and is distinct from the complete selected-resource set.
- Removing a resource does not create a locate activation. Removing and later re-adding it creates a new activation.
- The browser and server prioritize the newly activated resource and the preferred region. The preferred region is the explicitly selected region when there is one; otherwise it is the monitored claim region when Relay-ready; otherwise it is the first canonical ready region.
- As soon as any selected partition for the activated resource contains a provisional or committed point, the client selects a useful target. A point from the preferred region wins when available; otherwise the first available region is eligible. Within the chosen priority tier, the point nearest the current map centre wins, with a deterministic key/coordinate tie-break.
- If the target is outside the current viewport, the map flies to it at a useful close zoom. If it is already visible, the viewport is preserved and a short-lived first-party highlight identifies it.
- One activation is consumed only after a point has been selected. Empty/loading partitions keep it pending. Later partitions and generations never reframe the same activation, so user pan and zoom remain authoritative.
- Existing selected partitions remain drawn while a new resource is loading. The first useful result never waits for unrelated partitions to complete.

This behavior supersedes the aggregate framing rule in `docs/superpowers/specs/2026-08-12-native-map-resource-framing-design.md`; its one-shot and preserve-user-navigation principles remain in force.

## Bounded and prioritized resource work

- The total browser selection budget is 256 `(region, resource)` partitions, matching server validation. The resource-type selection limit is `min(16, floor(256 / readyRegionCount))`. The existing 13-region world therefore retains all 16 selectable types (208 partitions).
- An explicitly empty region selection remains `All`. A non-empty persisted selection that no longer contains a ready region falls back to the ready monitored-claim region, then the first ready region; it must not silently broaden to `All`.
- The resource event stream accepts optional priority resource/region identities only when they are members of the validated scope. Lease planning orders that exact pair first, then the priority resource across remaining regions, then the remaining canonical Cartesian plan.
- The server starts at most eight resource lease acquisitions concurrently per event connection.
- The browser performs at most four binary fetch/decode/commit operations concurrently. Duplicate queued generations coalesce; a newer generation supersedes obsolete queued or in-flight work for the same key.
- Pause, scope removal, and stop cancel both active and queued work. No cancelled item may later commit.

## Warm decoded partition cache

- The browser loader owns a private LRU of at most eight fresh committed partitions and at most 16 MiB of packed coordinate bytes.
- A deselected fresh committed partition may enter the LRU. Provisional, stale, unavailable, or oversized partitions do not.
- Reselecting hydrates the active scoped state from the LRU immediately and opens the normal event stream. The cached generation remains non-authoritative until the server's initial event confirms it.
- A matching `partition-ready` generation promotes the cached partition to the server-reported freshness and performs no binary fetch. A different generation performs one normal bounded fetch. Exact-base delta rules remain unchanged.
- The LRU never broadens active scope and exposes no browser-global cache API.

## Shared Relay topology discovery

- A focused shared resolver wraps the existing discovery function with a 60-second TTL and per-key singleflight.
- The cache key includes normalized Relay base URL and discovery options that affect the result.
- Successful results are cached. Failures are not cached. Concurrent identical calls share one promise.
- The server injects the same resolver into map resource readiness, resource runtime, and spatial scope manager so a cold multi-region request does not repeat `/health` and cache-health requests.
- Existing direct dependency injection remains available for unit tests and non-map runtimes.

## Rendering and event work

- Resource Canvas synchronization and locate-camera logic live in resource-only effects.
- Ordinary snapshot markers, focus markers, and enemies update only when their own snapshot, scope, colour, identity, or focus inputs change. A resource delta must not clear or recreate ordinary marker layers.
- Debug resource samples are derived only while Debug is visible. The cheap aggregate partition count may remain available for the layer badge/status.
- Resource Canvas draws all sampled arcs for one partition in one path, then strokes/fills once. Viewport culling, zoom budgets, ordering, colours, outline, radius, and projection remain unchanged.
- `/api/local/map/events` subscribes only to generation domains capable of changing requested layers. Resource events remain on the dedicated resource stream used by the native client.

No spatial index, direct-projection rewrite, offscreen canvas, or new rendering framework is approved without browser evidence that the bounded/batched path still misses its frame budget.

## Verified character marker

- Eligibility, player colour resolution, tooltip, title, accessible label, layer ordering, and exact approved-character matching remain unchanged.
- The verified character receives a compact square rotated 45 degrees (diamond), with a contrasting border.
- The current-user marker has no circular pulse, pseudo-element halo, or glow. Ordinary player markers keep their existing circular dot and pulse.
- Reduced-motion behavior remains correct because the current-user marker has no animation.

This presentation supersedes `docs/superpowers/specs/2026-08-17-verified-marker-halo-design.md` only for shape, size, and animation.

## Measurement and acceptance

- Warm single-region click to first visible target: p95 at or below 500 ms in a representative authorized environment.
- Cold single-region click to first visible target: p95 at or below 2 seconds and p99 at or below 4 seconds.
- Multi-region selection meets the same first-useful-result target; full-selection completion is measured separately.
- First visible target does not wait for all partitions.
- A resource update does not recreate ordinary claim, watchtower, focus, or player markers.
- Maximum observed browser binary concurrency is four; maximum per-stream server lease-start concurrency is eight; accepted workloads produce no admission burst caused solely by local fan-out.
- Warm reselection of an unchanged generation performs zero binary fetches.
- The real resource-client benchmark reports first committed partition, complete selection, warm reselection, request counts, bytes, and maximum concurrency. Timing thresholds are opt-in outside deterministic tests.
- A 400,000-point codec/delta benchmark remains green. Browser smoke shows no console error, no third-party resource request, responsive pan/zoom, progressive points, locate/highlight behavior, and exactly one approved diamond marker when a verified character is present.

## Route and representation decision

The duplicate `/api/local/map/resources` handlers and redundant full-row/tuple runtime representations are inspected as part of implementation. They may be removed only if current server scripts and provider-neutral consumers do not require them. If a live verifier or supported rollback seam still consumes the full snapshot, the implementation will resolve the ambiguous route name without deleting that evidence path and will record the reason.

## Non-goals

- Direct browser Relay or SpacetimeDB connections.
- Persisting resource locations/history in SQLite.
- Prewarming every resource type continuously.
- Changing terrain/road generation or map geometry.
- Expanding player authorization or external-player tracking.
- Adding a new state framework, rendering library, or browser test framework.
