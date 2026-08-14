# Native Map Synthetic Ocean Underlay Design

## Summary

Fill the empty corner areas inside the native map's rectangular world envelope with a subtle, static ocean texture. The underlay is decorative renderer data, not fabricated Relay terrain. Verified terrain and water tiles remain authoritative and render above it.

## Goals

- Make the full-world view read as one continuous map instead of a cross of region tiles on a dark background.
- Fill every gap inside the existing `38,400 × 38,400` world envelope.
- Match the approved soft-texture direction: visible depth without competing with terrain, roads, markers, or dense resource points.
- Add no server generation work, network requests, persistent data, or meaningful runtime memory cost.
- Derive the base colour from the canonical terrain water palette so future palette changes remain consistent.

## Non-goals

- Do not create synthetic Relay rows, terrain cells, biome classifications, or map tile-pack content.
- Do not make the ocean interactive, searchable, selectable, or toggleable.
- Do not extend the rendered world beyond the existing map bounds.
- Do not change terrain, road, resource, player, or marker collection.
- Do not attempt to reproduce BitCraftMap's texture exactly.

## Architecture

Add a focused client-side ocean-underlay module used by `NativeMap`. It owns the construction of one non-interactive SVG overlay sized to `MAP_WORLD_BOUNDS`.

The map pane order will be explicit:

1. Coordinate fallback grid.
2. Synthetic ocean underlay.
3. Verified terrain tiles.
4. Verified water tiles.
5. Biome masks, roads, markers, dense resources, and players.

The coordinate grid moves to its own pane below the ocean. This preserves the existing fallback when terrain is unavailable while preventing grid tiles from covering the ocean in gaps between installed terrain regions.

The SVG contains a canonical ocean-colour base and a small fixed set of low-opacity radial gradients. The texture uses world coordinates, contains no animation or randomness, and is represented by one overlay rather than viewport tile canvases.

## Rendering Lifecycle

The ocean underlay is installed only when the terrain status reports an available generation. It is removed when terrain is unavailable or building, allowing the coordinate fallback to remain visible.

A stale but usable installed terrain generation still receives the underlay because it has valid last-good tiles. Ordinary pan and zoom operations transform the existing SVG; they do not recreate it or trigger React state changes.

Real terrain and water tiles fully cover the underlay wherever they contain rendered pixels. Transparent or absent tiles reveal the synthetic ocean. The overlay is clipped to the world bounds, so the map background outside the world remains unchanged.

When biome highlighting is active, the synthetic-ocean pane is dimmed with the terrain and water panes. It has `pointer-events: none`, no accessibility role, and no tooltip because it is decorative.

## Palette Contract

The base fill comes from `TERRAIN_WATER_COLOURS.ocean` in the shared terrain palette definition. A small pure conversion helper produces the CSS colour used by the SVG. Gradient stops are derived from that base with fixed opacity changes rather than defining a second independent ocean palette.

This keeps the underlay tied to the real ocean colour while allowing the generated water renderer to retain its richer depth and shoreline treatment.

## Data and Trust Boundary

No request or provider data flows into the underlay beyond the provider-neutral terrain availability status. The feature does not modify map snapshots, tile status payloads, tile packs, SQLite state, or Relay sessions.

The UI will not describe the underlay as verified terrain. It is simply a basemap treatment beneath verified layers. Diagnostics and biome lookup continue to report only real generated data.

## Failure Handling

- Missing or invalid terrain status: show the coordinate fallback and no synthetic ocean.
- Terrain generation building: show the coordinate fallback and no synthetic ocean.
- Stale but available terrain generation: show the last-good terrain and synthetic ocean.
- Overlay construction failure: leave the map usable with verified terrain and the existing fallback; do not retry on every map movement.
- Component unmount or terrain availability change: remove the SVG and release its Leaflet references.

## Verification

Focused automated coverage will prove:

- the underlay uses the full `MAP_WORLD_BOUNDS` rectangle;
- the base colour derives from the canonical ocean palette;
- pane ordering keeps the grid below the ocean and verified tiles above it;
- unavailable/building terrain removes the underlay;
- stale available terrain retains it;
- the implementation contains no remote tile or asset URL;
- biome highlighting includes the ocean pane;
- unmount cleanup removes the layer.

Visual smoke checks will cover the full-world zoom, a close regional zoom, biome highlighting, and the visibility of roads, claims, watchtowers, players, and selected resources above the ocean.

Local checks must remain focused and memory-capped because this workstation previously crashed during high-memory Node workloads. The full build and broad test suite will run in GitHub CI before merge.

## Rollout

Ship the underlay with the native map renderer. No migration, settings change, tile regeneration, or VPS data action is required. The existing provider-neutral terrain availability gate determines whether it appears.
