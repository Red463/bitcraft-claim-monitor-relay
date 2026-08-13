# Native Map Final Cutover

## Decision

The Map page is native-only. The application no longer supports external or native-beta renderer modes. This is an intentional beta release cutover; incomplete native-map layers will be improved through later beta updates rather than by switching users back to BitCraftMap.

## Runtime behavior

- `MapPanel` always mounts `NativeMap` and retains the current native toolbar, region scope, player tracking, resource finder, waypoint, and freshness behavior.
- The app no longer constructs or embeds selection-bearing BitCraftMap URLs.
- The admin settings form and public settings model no longer expose a map-renderer choice.
- Persisted `map_renderer_mode` values are retired and cannot alter rendering.
- The Content Security Policy no longer grants `bitcraftmap.com` frame access.
- A generic non-selection-bearing external documentation link may remain outside the renderer.

## Compatibility and data

No spatial history or user data is removed. The obsolete renderer setting may remain in SQLite until ordinary settings cleanup removes it, but it is ignored. Existing native layer and selection persistence remains unchanged.

## Verification

- Boundary tests prove `MapPanel` has no renderer mode, iframe, iframe lifecycle state, or BitCraftMap URL builder.
- Settings tests prove native is the only renderer behavior and the admin form contains no renderer selector.
- CSP tests prove `bitcraftmap.com` is absent from `frame-src`.
- Full app tests and production build pass.
- Live production smoke proves `v0.55.0-beta.2`, one native map, zero map iframes, and usable regional claims.
