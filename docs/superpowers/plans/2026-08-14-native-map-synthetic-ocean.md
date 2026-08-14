# Native Map Synthetic Ocean Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill every ungenerated corner inside the native map's `38,400 × 38,400` world envelope with a subtle, palette-coupled ocean underlay beneath verified terrain.

**Architecture:** A focused pure module builds one deterministic inline SVG from `MAP_WORLD_BOUNDS` and `TERRAIN_WATER_COLOURS.ocean`. `NativeMap` installs that SVG in a dedicated Leaflet pane only while a usable terrain generation is available; the coordinate grid remains the fallback below it, and all verified tiles and operational overlays remain above it.

**Tech Stack:** React 19, TypeScript 5.9, Leaflet 1.9.4, plain CSS, Node.js 24 test runner.

## Global Constraints

- Do not create synthetic Relay rows, terrain cells, biome classifications, generated tile-pack content, SQLite state, or provider-specific browser data.
- Do not add network requests, remote assets, dependencies, animation, randomness, interactivity, controls, or tooltips.
- Restrict the ocean to `MAP_WORLD_BOUNDS` (`0…38,400` on both X and Z axes).
- Derive the base and texture colours from `TERRAIN_WATER_COLOURS.ocean`; do not introduce a second independent ocean palette.
- Keep the coordinate grid visible whenever terrain is unavailable or building; show the underlay for live or stale usable terrain.
- Keep the pane order grid → synthetic ocean → terrain → water → biome masks/roads/markers/resources/players.
- Use only memory-capped focused local tests. Do not run the local full suite, full build, world generation, or dense benchmark on this workstation.
- Run broad tests and the production build in GitHub CI before merge.

---

## File Structure

- Create `apps/bitcraft-local/src/pages/map/syntheticOceanUnderlay.mjs`: pure palette conversion, bounds, and deterministic SVG construction.
- Create `apps/bitcraft-local/src/pages/map/syntheticOceanUnderlay.d.mts`: TypeScript contract for the JavaScript module.
- Create `apps/bitcraft-local/test/native-map-synthetic-ocean.test.mjs`: focused unit coverage without Leaflet or a browser DOM.
- Modify `apps/bitcraft-local/src/pages/map/NativeMap.tsx`: pane creation, layer lifecycle, cleanup, and grid placement.
- Modify `apps/bitcraft-local/src/styles/map.css`: biome-highlight dimming for the ocean pane.
- Modify `apps/bitcraft-local/test/map-page-boundary.test.mjs`: source-boundary coverage for ordering, lifecycle, and provider neutrality.
- Modify `CHANGELOG.md` and `apps/bitcraft-local/package.json`: release metadata for `0.55.0-beta.18`.

### Task 1: Deterministic Synthetic Ocean SVG

**Files:**
- Create: `apps/bitcraft-local/src/pages/map/syntheticOceanUnderlay.mjs`
- Create: `apps/bitcraft-local/src/pages/map/syntheticOceanUnderlay.d.mts`
- Test: `apps/bitcraft-local/test/native-map-synthetic-ocean.test.mjs`

**Interfaces:**
- Consumes: `MAP_WORLD_BOUNDS` and `TERRAIN_WATER_COLOURS.ocean`.
- Produces: `SYNTHETIC_OCEAN_LEAFLET_BOUNDS`, a frozen `[[minZ, minX], [maxZ, maxX]]` tuple.
- Produces: `syntheticOceanColours(): Readonly<{ base: string; light: string; dark: string }>`.
- Produces: `createSyntheticOceanSvg(documentLike: Pick<Document, "createElementNS">): SVGSVGElement`.

- [ ] **Step 1: Write the failing unit tests**

Create a minimal fake SVG DOM and lock the bounds, palette derivation, static SVG structure, accessibility attributes, and deterministic output:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { TERRAIN_WATER_COLOURS } from "../src/shared/terrainPaletteDefinition.mjs";
import {
  SYNTHETIC_OCEAN_LEAFLET_BOUNDS,
  createSyntheticOceanSvg,
  syntheticOceanColours,
} from "../src/pages/map/syntheticOceanUnderlay.mjs";

class FakeSvgElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  appendChild(child) { this.children.push(child); return child; }
}

const fakeDocument = {
  createElementNS(_namespace, tagName) { return new FakeSvgElement(tagName); },
};

test("synthetic ocean spans the full world in Leaflet z-x order", () => {
  assert.deepEqual(SYNTHETIC_OCEAN_LEAFLET_BOUNDS, [[0, 0], [38_400, 38_400]]);
});

test("synthetic ocean colours derive from the canonical ocean palette", () => {
  const [red, green, blue] = TERRAIN_WATER_COLOURS.ocean;
  const colours = syntheticOceanColours();
  assert.equal(colours.base, `rgb(${red} ${green} ${blue})`);
  assert.notEqual(colours.light, colours.base);
  assert.notEqual(colours.dark, colours.base);
});

test("synthetic ocean SVG is static, decorative, and world-sized", () => {
  const svg = createSyntheticOceanSvg(fakeDocument);
  assert.equal(svg.tagName, "svg");
  assert.equal(svg.attributes.get("viewBox"), "0 0 38400 38400");
  assert.equal(svg.attributes.get("preserveAspectRatio"), "none");
  assert.equal(svg.attributes.get("aria-hidden"), "true");
  assert.equal(svg.attributes.get("focusable"), "false");
  assert.deepEqual(svg.children.map(({ tagName }) => tagName), ["defs", "rect", "ellipse", "ellipse", "ellipse"]);
  assert.equal(svg.children[1].attributes.get("fill"), syntheticOceanColours().base);
  assert.doesNotMatch(JSON.stringify(svg), /https?:|animation|animate/i);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run from `apps/bitcraft-local`:

```powershell
node --max-old-space-size=256 --experimental-strip-types --test test/native-map-synthetic-ocean.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `syntheticOceanUnderlay.mjs`.

- [ ] **Step 3: Implement the pure SVG module**

Implement palette-derived colour mixing and SVG construction. Use a fixed layout and no random values:

```js
import { TERRAIN_WATER_COLOURS } from "../../shared/terrainPaletteDefinition.mjs";
import { MAP_WORLD_BOUNDS } from "./mapCoordinates.mjs";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));
const mixChannel = (source, target, ratio) => clampChannel(source + ((target - source) * ratio));
const rgb = ([red, green, blue]) => `rgb(${red} ${green} ${blue})`;
const mixRgb = (colour, target, ratio) => colour.slice(0, 3).map((channel, index) => mixChannel(channel, target[index], ratio));

export const SYNTHETIC_OCEAN_LEAFLET_BOUNDS = Object.freeze([
  Object.freeze([MAP_WORLD_BOUNDS.minZ, MAP_WORLD_BOUNDS.minX]),
  Object.freeze([MAP_WORLD_BOUNDS.maxZ, MAP_WORLD_BOUNDS.maxX]),
]);

export function syntheticOceanColours() {
  const ocean = TERRAIN_WATER_COLOURS.ocean;
  return Object.freeze({
    base: rgb(ocean),
    light: rgb(mixRgb(ocean, [255, 255, 255], 0.2)),
    dark: rgb(mixRgb(ocean, [0, 0, 0], 0.28)),
  });
}

function svgElement(documentLike, tagName, attributes) {
  const element = documentLike.createElementNS(SVG_NAMESPACE, tagName);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

export function createSyntheticOceanSvg(documentLike) {
  if (!documentLike || typeof documentLike.createElementNS !== "function") {
    throw new TypeError("Synthetic ocean SVG requires createElementNS");
  }
  const width = MAP_WORLD_BOUNDS.maxX - MAP_WORLD_BOUNDS.minX;
  const height = MAP_WORLD_BOUNDS.maxZ - MAP_WORLD_BOUNDS.minZ;
  const colours = syntheticOceanColours();
  const svg = svgElement(documentLike, "svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
    focusable: "false",
  });
  const definitions = svgElement(documentLike, "defs", {});
  for (const [id, colour, opacity] of [
    ["native-map-ocean-light", colours.light, "0.3"],
    ["native-map-ocean-dark", colours.dark, "0.34"],
  ]) {
    const gradient = svgElement(documentLike, "radialGradient", { id });
    gradient.appendChild(svgElement(documentLike, "stop", { offset: "0", "stop-color": colour, "stop-opacity": opacity }));
    gradient.appendChild(svgElement(documentLike, "stop", { offset: "1", "stop-color": colour, "stop-opacity": "0" }));
    definitions.appendChild(gradient);
  }
  svg.appendChild(definitions);
  svg.appendChild(svgElement(documentLike, "rect", { width, height, fill: colours.base }));
  svg.appendChild(svgElement(documentLike, "ellipse", { cx: "6912", cy: "9216", rx: "15360", ry: "11520", fill: "url(#native-map-ocean-light)" }));
  svg.appendChild(svgElement(documentLike, "ellipse", { cx: "29952", cy: "26112", rx: "14592", ry: "13056", fill: "url(#native-map-ocean-dark)" }));
  svg.appendChild(svgElement(documentLike, "ellipse", { cx: "18432", cy: "35328", rx: "9984", ry: "6912", fill: "url(#native-map-ocean-light)" }));
  return svg;
}
```

Add the declaration contract:

```ts
export const SYNTHETIC_OCEAN_LEAFLET_BOUNDS: readonly [readonly [number, number], readonly [number, number]];
export function syntheticOceanColours(): Readonly<{ base: string; light: string; dark: string }>;
export function createSyntheticOceanSvg(documentLike: Pick<Document, "createElementNS">): SVGSVGElement;
```

- [ ] **Step 4: Run the focused unit test and verify GREEN**

```powershell
node --max-old-space-size=256 --experimental-strip-types --test test/native-map-synthetic-ocean.test.mjs
```

Expected: 3 tests pass, 0 fail, and the Node process remains below the 256 MiB heap cap.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- apps/bitcraft-local/src/pages/map/syntheticOceanUnderlay.mjs apps/bitcraft-local/src/pages/map/syntheticOceanUnderlay.d.mts apps/bitcraft-local/test/native-map-synthetic-ocean.test.mjs
git commit -m "feat(map): build synthetic ocean underlay"
```

### Task 2: Leaflet Pane and Terrain Lifecycle Integration

**Files:**
- Modify: `apps/bitcraft-local/src/pages/map/NativeMap.tsx`
- Modify: `apps/bitcraft-local/src/styles/map.css`
- Modify: `apps/bitcraft-local/test/map-page-boundary.test.mjs`

**Interfaces:**
- Consumes: `SYNTHETIC_OCEAN_LEAFLET_BOUNDS` and `createSyntheticOceanSvg(document)` from Task 1.
- Produces: one `L.SVGOverlay` in pane `native-map-ocean` while `terrainStatus.available && terrainStatus.generation` is truthy.
- Preserves: coordinate fallback, terrain/water URLs, biome masks, roads, markers, dense resource canvas, player canvas, and terrain-status polling.

- [ ] **Step 1: Extend boundary tests and verify the current code fails them**

Add assertions to the existing terrain test in `map-page-boundary.test.mjs`:

```js
assert.match(nativeMap, /createPane\("native-map-grid"\)/);
assert.match(nativeMap, /gridPane\.style\.zIndex\s*=\s*"100"/);
assert.match(nativeMap, /createPane\("native-map-ocean"\)/);
assert.match(nativeMap, /oceanPane\.style\.zIndex\s*=\s*"190"/);
assert.match(nativeMap, /oceanPane\.style\.pointerEvents\s*=\s*"none"/);
assert.match(nativeMap, /new CoordinateGridLayer\(\{[^}]*pane:\s*"native-map-grid"/s);
assert.match(nativeMap, /const syntheticOceanBounds = L\.latLngBounds\([\s\S]*SYNTHETIC_OCEAN_LEAFLET_BOUNDS[\s\S]*L\.svgOverlay\([\s\S]*createSyntheticOceanSvg\(document\)[\s\S]*syntheticOceanBounds[\s\S]*pane:\s*"native-map-ocean"[\s\S]*interactive:\s*false/);
assert.match(nativeMap, /if \(!terrainStatus\?\.available \|\| !terrainStatus\.generation\)/);
assert.match(nativeMap, /syntheticOceanRef\.current\?\.removeFrom\(map\)/);
assert.doesNotMatch(nativeMap, /syntheticOcean[^\n]*(?:https?:|mapTileUrl)/i);
assert.match(css, /is-biome-highlight-active[^}]*leaflet-native-map-ocean-pane[^}]*filter:\s*brightness\(32%\)/s);
```

Run:

```powershell
node --max-old-space-size=256 --experimental-strip-types --test test/map-page-boundary.test.mjs
```

Expected: FAIL on the first missing synthetic-ocean assertion while all unrelated assertions remain unchanged.

- [ ] **Step 2: Add explicit panes and the layer reference**

Import the Task 1 API, add `const syntheticOceanRef = React.useRef<L.SVGOverlay | null>(null);`, and create panes in this order during map initialization:

```ts
const gridPane = map.createPane("native-map-grid");
gridPane.style.zIndex = "100";
gridPane.style.pointerEvents = "none";
const oceanPane = map.createPane("native-map-ocean");
oceanPane.style.zIndex = "190";
oceanPane.style.pointerEvents = "none";
const terrainPane = map.createPane("native-map-terrain");
terrainPane.style.zIndex = "200";
```

Place the existing grid explicitly:

```ts
new CoordinateGridLayer({ tileSize: 256, noWrap: false, pane: "native-map-grid" }).addTo(map);
```

Set `syntheticOceanRef.current = null` in the map-unmount cleanup beside the terrain and water refs.

- [ ] **Step 3: Install the ocean in the existing terrain effect**

At the start of the terrain effect, remove the previous ocean alongside the previous terrain and water layers. After the availability guard and before adding verified terrain tiles, build the one SVG overlay:

```ts
let syntheticOcean: L.SVGOverlay | null = null;
try {
  const syntheticOceanBounds = L.latLngBounds(
    [SYNTHETIC_OCEAN_LEAFLET_BOUNDS[0][0], SYNTHETIC_OCEAN_LEAFLET_BOUNDS[0][1]],
    [SYNTHETIC_OCEAN_LEAFLET_BOUNDS[1][0], SYNTHETIC_OCEAN_LEAFLET_BOUNDS[1][1]],
  );
  syntheticOcean = L.svgOverlay(
    createSyntheticOceanSvg(document),
    syntheticOceanBounds,
    { pane: "native-map-ocean", interactive: false },
  ).addTo(map);
  syntheticOceanRef.current = syntheticOcean;
} catch {
  console.warn("Synthetic ocean underlay is unavailable.");
}
```

The effect cleanup must remove `syntheticOcean`, clear the ref only when it still owns that instance, and then perform the existing terrain/water cleanup. The availability guard must remove and clear any prior synthetic ocean before returning so unavailable/building terrain shows the coordinate grid.

- [ ] **Step 4: Dim the underlay during biome highlighting**

Update the existing selectors without adding animation:

```css
.native-map-canvas .leaflet-native-map-ocean-pane,
.native-map-canvas .leaflet-native-map-terrain-pane,
.native-map-canvas .leaflet-native-map-water-pane {
  transition: filter 120ms ease;
}

.native-map-canvas.is-biome-highlight-active .leaflet-native-map-ocean-pane,
.native-map-canvas.is-biome-highlight-active .leaflet-native-map-terrain-pane,
.native-map-canvas.is-biome-highlight-active .leaflet-native-map-water-pane {
  filter: brightness(32%);
}
```

- [ ] **Step 5: Run both focused test files and verify GREEN**

```powershell
node --max-old-space-size=256 --experimental-strip-types --test test/native-map-synthetic-ocean.test.mjs test/map-page-boundary.test.mjs
```

Expected: all tests in both files pass with 0 failures under the 256 MiB heap cap.

- [ ] **Step 6: Run lightweight static verification**

From the repository root:

```powershell
git diff --check
rg -n "https?://|bitcraftmap|prism|bitjita" apps/bitcraft-local/src/pages/map/syntheticOceanUnderlay.mjs apps/bitcraft-local/src/pages/map/NativeMap.tsx
```

Expected: `git diff --check` exits 0. The URL scan finds only pre-existing imports or no matches; it must find no URL in `syntheticOceanUnderlay.mjs` and no new provider URL in `NativeMap.tsx`.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- apps/bitcraft-local/src/pages/map/NativeMap.tsx apps/bitcraft-local/src/styles/map.css apps/bitcraft-local/test/map-page-boundary.test.mjs
git commit -m "feat(map): fill world gaps with ocean"
```

### Task 3: Release Metadata and Focused Final Verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `apps/bitcraft-local/package.json`

**Interfaces:**
- Produces: release version `0.55.0-beta.18` and one user-facing changelog entry.
- Consumes: the complete Task 1 and Task 2 implementation.

- [ ] **Step 1: Add the release entry and version**

Insert above `0.55.0-beta.17`:

```markdown
## [0.55.0-beta.18] - 2026-08-14

### Added

- Filled the native map's ungenerated world-corner gaps with a lightweight ocean underlay that follows the canonical water palette.
```

Change `apps/bitcraft-local/package.json` from `0.55.0-beta.17` to `0.55.0-beta.18`.

- [ ] **Step 2: Re-run the complete focused verification set once**

From `apps/bitcraft-local`:

```powershell
node --max-old-space-size=256 --experimental-strip-types --test test/native-map-synthetic-ocean.test.mjs test/map-page-boundary.test.mjs test/terrain-palette-definition.test.mjs test/map-coordinates.test.mjs
```

Expected: all selected tests pass, 0 fail, and the process remains within the 256 MiB heap cap.

Do not run the local full suite, build, world generation, or dense benchmark.

- [ ] **Step 3: Inspect the final diff and commit release metadata**

```powershell
git diff --check
git status --short
git diff -- CHANGELOG.md apps/bitcraft-local/package.json
git add -- CHANGELOG.md apps/bitcraft-local/package.json
git commit -m "chore(release): prepare 0.55.0-beta.18"
```

Expected: only the intended source, CSS, focused tests, specification/plan, changelog, and package version differ from `origin/main`.

### Task 4: CI, Deployment, and Live Visual Acceptance

**Files:**
- No production file changes unless CI or review identifies a concrete defect.

**Interfaces:**
- Consumes: the committed `codex/map-synthetic-ocean` branch.
- Produces: a reviewed pull request, successful GitHub verification/deployment, and live visual acceptance.

- [ ] **Step 1: Push and open a ready pull request**

```powershell
git push -u origin codex/map-synthetic-ocean
gh pr create --repo Red463/bitcraft-claim-monitor-relay --base main --head codex/map-synthetic-ocean --title "feat(map): fill world gaps with ocean" --body "Adds the approved palette-coupled synthetic ocean beneath verified terrain. Local verification is intentionally limited to four memory-capped focused test files because broad Node workloads previously crashed the workstation; GitHub CI owns the full application test and production-build gates."
```

The PR body must state that local verification was intentionally limited to the four memory-capped focused test files and that GitHub CI owns the full application test/build gate.

- [ ] **Step 2: Require GitHub verification before merge**

```powershell
$oceanPrNumber = gh pr view codex/map-synthetic-ocean --repo Red463/bitcraft-claim-monitor-relay --json number --jq ".number"
gh pr checks $oceanPrNumber --watch --repo Red463/bitcraft-claim-monitor-relay
```

Expected: application tests and the production build pass. If a check fails, inspect that check's log, reproduce only the narrow failing test locally under `--max-old-space-size=256`, implement the smallest test-first fix, and rerun the PR checks.

- [ ] **Step 3: Merge and deploy**

```powershell
gh pr merge $oceanPrNumber --repo Red463/bitcraft-claim-monitor-relay --squash --delete-branch
gh workflow run deploy-relay-preview.yml --repo Red463/bitcraft-claim-monitor-relay --ref main
```

Monitor the returned deployment run until it completes successfully. Do not start a second deployment while one is in progress.

- [ ] **Step 4: Verify live health and tile status**

```powershell
curl.exe -fsS https://app.timbersteeltrade.com/api/local/health
curl.exe -fsS https://app.timbersteeltrade.com/api/local/map/tiles/status
```

Expected: both endpoints return HTTP 200; terrain remains available; installed generation metadata remains valid; the ocean feature requires no tile regeneration.

- [ ] **Step 5: Perform live browser acceptance**

Open `https://app.timbersteeltrade.com/?page=map` in the authenticated in-app browser and verify:

1. At full-world zoom, every corner inside the rectangular world envelope shows the approved soft ocean texture.
2. Outside the world envelope retains the normal map background.
3. At regional zoom, real terrain and water fully cover the underlay.
4. Biome hover/pin highlighting dims the ocean with terrain and water.
5. Roads, claims, watchtowers, selected players, and selected resources render above the underlay.
6. The browser console has no new errors and the network log contains no third-party map/tile/asset request.
7. Pan and zoom do not recreate visible textures, shimmer, or cause noticeable frame drops.

- [ ] **Step 6: Close the release task**

Record the merged PR URL, deployed version `0.55.0-beta.18`, CI run, deployment run, health result, tile-status result, and live visual result. Keep the separate road-generation heartbeat active until roads and selected resources also pass their existing live acceptance criteria.
