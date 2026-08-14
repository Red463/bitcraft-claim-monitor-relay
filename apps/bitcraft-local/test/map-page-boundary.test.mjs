import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Map page lives outside the legacy MainPages bundle", () => {
  const mainPagesUrl = new URL("../src/pages/MainPages.tsx", import.meta.url);
  const mainPages = existsSync(mainPagesUrl) ? readFileSync(mainPagesUrl, "utf8") : "";
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const mapPageUrl = new URL("../src/pages/MapPage.tsx", import.meta.url);

  assert.equal(existsSync(mapPageUrl), true);
  assert.doesNotMatch(mainPages, new RegExp("export function MapPanel\\b"));
  assert.match(appShell, /React\.lazy\(\(\) => import\("\.\/pages\/MapPage"\)/);
});

test("Map page has one first-party renderer and no iframe recovery path", () => {
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");

  assert.match(mapPage, /<NativeMap/);
  assert.doesNotMatch(mapPage, /<iframe|FrameState|Loading embedded map|Open full page|currentFrameUrl/);
});

test("Map page supplies the complete player panel to the native map", () => {
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");

  assert.match(mapPage, /usePersistedState<string\[\] \| null>\("map\.players", null\)/);
  assert.match(mapPage, /usePersistedState<MapTrackedExternalPlayer\[\]>\("map\.external-players", \[\]\)/);
  assert.match(mapPage, /<MapPlayerTrackingPanel/);
  assert.match(mapPage, /playerTool=\{\{/);
  assert.doesNotMatch(mapPage, /MapPlayerTrackingControls|Manage players|<Dialog/);
});
test("Map player selection feeds the native renderer directly", () => {
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");

  assert.match(mapPage, /const currentPlayerIds = React\.useMemo\(\(\) => \[\.\.\.current\]\.sort\(\), \[current\]\)/);
  assert.match(mapPage, /playerIds=\{currentPlayerIds\}/);
  assert.doesNotMatch(mapPage, /bitcraftMapUrl|mapEmbedSignature|currentFrameUrl/);
});

test("Native map tools use a full-width desktop workspace and mobile bottom sheet", () => {
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");
  const mapCss = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");

  assert.match(mapPage, /has-native-tools/);
  assert.doesNotMatch(mapPage, /resources-collapsed|map\.resource-finder-collapsed/);
  assert.match(mapCss, /\.map-workspace\.native-tools\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(mapCss, /\.native-map-tool-panel\s*\{[^}]*position:\s*fixed;[^}]*top:\s*var\(--map-tool-anchor-top/s);
  assert.match(mapCss, /@media \(max-width:\s*620px\)[\s\S]*\.native-map-tool-panel\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*[^;]+;[^}]*max-height:\s*66dvh;[^}]*overflow:\s*auto/s);
});

test("Native map tool panels keep close controls compact and resource results as the desktop scroll region", () => {
  const mapCss = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");

  assert.match(mapCss, /\.native-map-tool-panel-header \.icon-button\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
  assert.match(mapCss, /\.native-map-tool-panel-header \.icon-button\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--muted\);/s);
  assert.match(mapCss, /\.native-map-tool-panel-header \.icon-button svg\s*\{[^}]*width:\s*15px;[^}]*height:\s*15px;/s);
  assert.match(mapCss, /\.native-map-tool-panel-header \.icon-button:hover,\s*\.native-map-tool-panel-header \.icon-button:focus-visible\s*\{[^}]*border-color:[^}]*background:[^}]*color:\s*var\(--text\);/s);
  assert.match(mapCss, /\.native-map-tool-panel--resources\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(mapCss, /\.native-map-tool-panel--resources \.map-resource-list\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(mapCss, /\.native-map-tool-panel--resources \.map-resource-list\s*\{[^}]*min-height:\s*0;/s);
  assert.match(mapCss, /@media \(max-width:\s*620px\)[\s\S]*\.native-map-tool-panel--resources\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(mapCss, /@media \(max-width:\s*620px\)[\s\S]*\.native-map-tool-count\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*overflow:\s*hidden;[^}]*clip:\s*rect\(0 0 0 0\);[^}]*white-space:\s*nowrap;/s);
  assert.match(mapCss, /\.map-player-list label\s*\{[^}]*grid-template-columns:\s*[^;]+;/s);
  assert.match(mapCss, /\.map-player-row-colour\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*1;/s);
  assert.match(mapCss, /\.map-resource-filters\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
});

test("Map Resource Finder uses the shared icon fallback for compound item identities", () => {
  const finder = readFileSync(new URL("../src/pages/map/MapResourceFinderPanel.tsx", import.meta.url), "utf8");

  assert.match(finder, /import \{ ItemIcon \} from "\.\.\/\.\.\/components\/main\/ItemDisplay"/);
  assert.match(finder, /itemType:\s*resource\.itemType/);
  assert.match(finder, /itemId:\s*resource\.itemId/);
  assert.match(finder, /iconAssetName:\s*resource\.iconAssetName/);
  assert.match(finder, /<ItemIcon item=\{resourceIcon\} \/>/);
  assert.doesNotMatch(finder, /const iconUrl = gameIconUrl\(resource\)/);
});

test("Map Resource Finder bounds rendered rows and reveals deterministic batches", () => {
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");
  const finder = readFileSync(new URL("../src/pages/map/MapResourceFinderPanel.tsx", import.meta.url), "utf8");

  assert.match(mapPage, /import \{ RESOURCE_FINDER_BATCH_SIZE, nextResourceLimit, visibleResourceMatches \} from "\.\/map\/resourceFinderWindow\.mjs"/);
  assert.match(mapPage, /useState<number>\(RESOURCE_FINDER_BATCH_SIZE\)/);
  assert.match(mapPage, /setResourceVisibleLimit\(RESOURCE_FINDER_BATCH_SIZE\)/);
  assert.match(mapPage, /\[resourceSearch, resourceTier, resourceCategory\]/);
  assert.match(mapPage, /const renderedResources = React\.useMemo/);
  assert.match(mapPage, /visibleResourceMatches\(visibleResources, resourceVisibleLimit\)/);
  assert.match(finder, /resources\.map\(\(resource\) =>/);
  assert.match(finder, /Showing \{resources\.length\} of \{visibleCount\}/);
  assert.match(mapPage, /nextResourceLimit\(current, visibleResources\.length\)/);
  assert.match(finder, />Show more</);
});

test("Map page owns the region selector and supplies its selected scope to the native map", () => {
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const dock = readFileSync(new URL("../src/pages/map/MapToolDock.tsx", import.meta.url), "utf8");
  const mapCss = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");

  assert.match(mapPage, /<MapRegionSelect/);
  assert.match(mapPage, /const normalizedRegionSelection = React\.useMemo/);
  assert.match(mapPage, /boundedNativeMapRegions\(\[\], readyResourceRegionIds, 16\)/);
  assert.match(mapPage, /nativeMapResourceRegions\(normalizedRegionSelection, readyResourceRegionIds\)/);
  assert.match(mapPage, /playerRegionIds=\{readyPlayerRegionIds\}/);
  assert.match(mapPage, /visibleRegionIds=\{normalizedRegionSelection\}/);
  assert.match(mapPage, /boundedNativeMapRegions\(normalizedRegionSelection, regionOptions\)/);
  assert.doesNotMatch(mapPage, /boundedNativeMapRegions\(normalizedRegionSelection, operationalRegionOptions\)/);
  assert.doesNotMatch(mapPage, /visibleRegionIds=\{resourceRegions\}/);
  assert.match(nativeMap, /trailingControl=\{regionControl\}/);
  assert.doesNotMatch(dock, /regionControl/);
  assert.match(mapCss, /\.native-map-region-select\s*\{[^}]*min-height:\s*34px;[^}]*border:\s*1px solid var\(--border\);[^}]*background:[^;]+;[^}]*font-size:[^;]+;/s);
  assert.match(mapCss, /\.native-map-region-select:(?:hover|focus-within)[^}]*border-color:/s);
  assert.match(mapCss, /@media \(max-width:\s*620px\)[\s\S]*\.native-map-region-select\s*\{[^}]*min-width:\s*0;[^}]*max-width:[^;]+;/s);
});

test("native map owns one global Region selector", () => {
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(mapPage, /map-external-region-control|nativeRenderer/);
  assert.equal((mapPage.match(/regionControl=\{regionControl\}/g) ?? []).length, 1);
});

test("native resource interactions retain the full 16-type selection across ready regions", () => {
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");

  assert.match(mapPage, /const maxNativeResourceSelections = React\.useMemo\(\(\) => nativeMapResourceSelectionLimit\(resourceMapRegionIds\)/);
  assert.match(mapPage, /normalizedToken\.startsWith\("resource:"\) && !next\.has\(normalizedToken\) && selectedResourceCount >= maxNativeResourceSelections/);
  assert.match(mapPage, /resourceIds\.slice\(0, maxNativeResourceSelections\)/);
});

test("phone toolbar gives all four tools and Region a bounded five-column layout", () => {
  const mapCss = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");

  assert.match(mapCss, /@media \(max-width:\s*620px\)[\s\S]*\.native-map-tool-dock\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
  assert.match(mapCss, /@media \(max-width:\s*620px\)[\s\S]*\.native-map-tool-triggers\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(4,\s*34px\)\s+minmax\(0,\s*1fr\);/s);
  assert.match(mapCss, /@media \(max-width:\s*620px\)[\s\S]*\.native-map-region-select\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s);
});

test("Native map projection preserves X and squishes only Leaflet Y", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");

  assert.match(nativeMap, /new L\.Point\(latlng\.lng, -latlng\.lat \/ MAP_HEX_APOTHEM\)/);
  assert.match(nativeMap, /new L\.LatLng\(-projected\.y \* MAP_HEX_APOTHEM, projected\.x\)/);
  assert.match(nativeMap, /new L\.Transformation\(1, 0, 1, 0\)/);
});

test("Native map renders the current waypoint as a visible first-party marker", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");

  assert.match(nativeMap, /focusMarker/);
  assert.match(nativeMap, /leafletPoint\(\{ x: focus\.locationX, z: focus\.locationZ \}\)/);
  assert.match(nativeMap, /bindTooltip\(`\$\{focus\.name\}/);
});

test("Native map reuses one canvas renderer and fixed marker presentations", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");

  assert.match(nativeMap, /const ordinaryRendererRef = React\.useRef<L\.Canvas \| null>\(null\)/);
  assert.equal((nativeMap.match(/L\.canvas\(\{ padding: 0\.25 \}\)/g) ?? []).length, 1);
  assert.match(nativeMap, /ordinaryRendererRef\.current = L\.canvas\(\{ padding: 0\.25 \}\)/);
  assert.match(nativeMap, /renderer: ordinaryRendererRef\.current/);
  assert.doesNotMatch(nativeMap, /renderer: L\.canvas\(\)/);
  assert.match(nativeMap, /mapMarkerPresentation\(feature\.kind\)/);
  assert.match(nativeMap, /L\.divIcon\(/);
  assert.match(nativeMap, /planDensePointDraw\(this\.#points,/);
  assert.match(nativeMap, /const accessibleFeatures =/);
  assert.match(nativeMap, /presentation\.mode === "canvas"/);
  assert.match(nativeMap, /accessibleFeatures\.slice\(0, 250\)/);
  assert.match(nativeMap, /feature\.kind === "claim"\s*\? claimMarkerPresentation\(feature\.tier, feature\.npc\)/);
  assert.match(nativeMap, /claimDisplayTier\(feature\.tier\)/);
  assert.match(nativeMap, /feature\.npc\s*\?\s*" · NPC town"/);
  assert.match(nativeMap, /variant === "claim-tier" \|\| variant === "claim-npc" \? 32/);
  const css = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");
  assert.match(css, /native-map-marker--claim\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s);
  assert.match(css, /native-map-marker-content--badge-crop\s*img\s*\{[^}]*width:\s*43px;[^}]*height:\s*43px;/s);
  assert.match(nativeMap, /keyboard: true/);
});

test("Native map gives each visible player a stable accessible colour marker", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");
  assert.match(nativeMap, /assignPlayerMarkerColours/);
  assert.match(nativeMap, /snapshot\.layers\.players/);
  assert.match(nativeMap, /--player-marker-color/);
  assert.match(nativeMap, /markerIcon\(feature\.kind, presentation, playerColours/);
  assert.match(nativeMap, /alt:\s*accessibleLabel,\s*title:\s*accessibleLabel/s);
  assert.match(nativeMap, /setAttribute\("aria-label", accessibleLabel\)/);
  assert.match(css, /native-map-player-dot[^}]*--player-marker-color/s);
  assert.match(css, /native-map-marker--player[^}]*border[^}]*box-shadow/s);
  assert.match(nativeMap, /native-map-player-pulse/);
  assert.match(nativeMap, /native-map-player-dot/);
  assert.match(nativeMap, /kind === "player" \|\| variant === "watchtower" \? 24/);
  assert.match(css, /native-map-player-dot[^}]*width:\s*8px[^}]*height:\s*8px/s);
  assert.match(css, /native-map-player-pulse[^}]*animation:\s*native-map-player-pulse/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce[^}]*native-map-player-pulse[^}]*animation:\s*none/s);
});

test("Native map keeps resource canvases and player markers above ordinary features", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  assert.match(nativeMap, /createPane\("native-map-resources"\)/);
  assert.match(nativeMap, /createPane\("native-map-players"\)/);
  assert.match(nativeMap, /resourcePane\.style\.zIndex\s*=\s*"650"/);
  assert.match(nativeMap, /playerPane\.style\.zIndex\s*=\s*"700"/);
  assert.match(nativeMap, /new DensePointLayer\([^\n]+"native-map-resources"/);
  assert.match(nativeMap, /new DensePointLayer\(RESOURCE_NODE_FALLBACK_COLOUR, "native-map-resources", \{ strokeColour: "rgba\(3, 8, 12, \.92\)", strokeWidth: 1\.25 \}\)/);
  assert.match(nativeMap, /context\.strokeStyle = this\.#strokeColour/);
  assert.match(nativeMap, /context\.lineWidth = this\.#strokeWidth/);
  assert.match(nativeMap, /if \(this\.#strokeColour && this\.#strokeWidth > 0\) \{[^}]*context\.stroke\(\)/s);
  assert.match(nativeMap, /new DensePointLayer\("rgba\(255, 112, 112, 0\.92\)"\)\.addTo\(map\)/);
  assert.match(nativeMap, /L\.layerGroup\(\[\], \{ pane: "native-map-players" \}\)/);
  assert.match(nativeMap, /\.\.\.\(feature\.kind === "player" \? \{ pane: "native-map-players" \} : \{\}\)/);
  assert.doesNotMatch(nativeMap, /pane: feature\.kind === "player" \? "native-map-players" : undefined/);
});

test("Native map projects region-scoped dense points before rendering and resource framing", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");

  assert.match(nativeMap, /const visibleResourcePoints = React\.useMemo\(\(\) => mapFeaturesInRegionScope\(resourcePoints, visibleRegionIds\)/);
  assert.match(nativeMap, /const visibleEnemyPoints = React\.useMemo\(\(\) => mapFeaturesInRegionScope\(snapshot\?\.layers\.enemies \?\? \[\], visibleRegionIds\)/);
  assert.match(nativeMap, /resourcesRef\.current\?\.setPoints\(visibleResourcePoints\)/);
  assert.match(nativeMap, /enemiesRef\.current\?\.setPoints\(visibleEnemyPoints\)/);
  assert.match(nativeMap, /applyResourceViewport\(\{[\s\S]*points: visibleResourcePoints,/);
  assert.doesNotMatch(nativeMap, /resourcesRef\.current\?\.setPoints\(resourcePoints\)/);
  assert.doesNotMatch(nativeMap, /enemiesRef\.current\?\.setPoints\(snapshot\.layers\.enemies \?\? \[\]\)/);
});

test("Native map frames a newly selected off-screen resource result once", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  assert.match(nativeMap, /applyResourceViewport/);
  assert.match(nativeMap, /resourceFrameSelectionRef/);
  assert.match(nativeMap, /map\.fitBounds\(L\.latLngBounds\(features\.map/);
  assert.match(nativeMap, /padding:\s*\[32, 32\]/);
  assert.match(nativeMap, /maxZoom:\s*1/);
});

test("Native map requests only same-origin locally provisioned terrain tiles", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  assert.match(nativeMap, /mapTileUrl\("terrain", terrainStatus\.generation\)/);
  assert.match(nativeMap, /mapTileUrl\("water", terrainStatus\.generation\)/);
  assert.match(nativeMap, /mapTileUrl\("roads", roadStatus\.generation\)/);
  assert.match(nativeMap, /biomeTileUrl\(biomeHighlight\.active, terrainStatus\.generation\)/);
  assert.match(nativeMap, /createPane\("native-map-terrain"\)/);
  assert.match(nativeMap, /createPane\("native-map-water"\)/);
  assert.match(nativeMap, /createPane\("native-map-biome-mask"\)/);
  assert.match(nativeMap, /terrainPane\.style\.zIndex\s*=\s*"200"/);
  assert.match(nativeMap, /waterPane\.style\.zIndex\s*=\s*"210"/);
  assert.match(nativeMap, /biomeMaskPane\.style\.zIndex\s*=\s*"250"/);
  assert.match(nativeMap, /biomeMaskPane\.style\.pointerEvents\s*=\s*"none"/);
  assert.match(nativeMap, /pane:\s*"native-map-terrain"/);
  assert.match(nativeMap, /pane:\s*"native-map-water"/);
  assert.match(nativeMap, /pane:\s*"native-map-biome-mask"/);
  assert.match(nativeMap, /biomeMaskTilesRef/);
  assert.match(nativeMap, /roadTilesRef/);
  assert.match(nativeMap, /loadTerrainTileStatus/);
  assert.match(nativeMap, /visibilitychange/);
  assert.match(nativeMap, /60_000/);
  assert.match(nativeMap, /minNativeZoom: -5/);
  assert.match(nativeMap, /maxNativeZoom: 0/);
  assert.doesNotMatch(nativeMap, /layerVisibility\.terrain|layerVisibility\.water/);
  assert.match(nativeMap, /L\.map\(hostRef\.current, \{ crs: NATIVE_CRS, minZoom: -6, maxZoom: 5,/);
  assert.match(nativeMap, /const tileOptions = \{\s*tileSize: 256,\s*minZoom: -6,\s*maxZoom: 5,\s*minNativeZoom: -5,/);
  assert.doesNotMatch(nativeMap, /prism\.brico\.app|bitcraftmap\.com/);
  assert.match(nativeMap, /Terrain\/water tiles are not installed on this server/);
  assert.ok(nativeMap.indexOf("new CoordinateGridLayer") < nativeMap.indexOf('mapTileUrl("terrain", terrainStatus.generation)'));
});

test("Native map fills verified terrain gaps with a bounded synthetic ocean underlay", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");
  assert.match(nativeMap, /createPane\("native-map-grid"\)/);
  assert.match(nativeMap, /gridPane\.style\.zIndex\s*=\s*"100"/);
  assert.match(nativeMap, /createPane\("native-map-ocean"\)/);
  assert.match(nativeMap, /oceanPane\.style\.zIndex\s*=\s*"190"/);
  assert.match(nativeMap, /oceanPane\.style\.pointerEvents\s*=\s*"none"/);
  assert.match(nativeMap, /new CoordinateGridLayer\(\{[^}]*pane:\s*"native-map-grid"/s);
  assert.match(nativeMap, /const syntheticOceanBounds = L\.latLngBounds\([\s\S]*SYNTHETIC_OCEAN_LEAFLET_BOUNDS[\s\S]*const syntheticOceanController = createSyntheticOceanLayerController\([\s\S]*createLayer:\s*\(\) => L\.svgOverlay\([\s\S]*createSyntheticOceanSvg\(document\)[\s\S]*syntheticOceanBounds[\s\S]*pane:\s*"native-map-ocean"[\s\S]*interactive:\s*false/);
  assert.match(nativeMap, /if \(!terrainStatus\?\.available \|\| !terrainStatus\.generation\)/);
  assert.match(nativeMap, /syntheticOceanControllerRef\.current\?\.sync\(terrainStatusSupportsSyntheticOcean\(terrainStatus\)\)/);
  assert.match(nativeMap, /syntheticOceanController\.dispose\(\)/);
  assert.doesNotMatch(nativeMap, /syntheticOcean[^\n]*(?:https?:|mapTileUrl)/i);
  assert.match(css, /is-biome-highlight-active[^}]*leaflet-native-map-ocean-pane[^}]*filter:\s*brightness\(32%\)/s);
});

test("Native map browser source excludes bank tracking and remote map assets", () => {
  const sources = [
    readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../src/pages/map/nativeMapRequest.mjs", import.meta.url), "utf8"),
    readFileSync(new URL("../src/pages/map/mapMarkerPresentation.mjs", import.meta.url), "utf8"),
  ].join("\n");

  assert.doesNotMatch(sources, /["']banks?["']/i);
  assert.doesNotMatch(sources, /https?:\/\//i);
  assert.doesNotMatch(sources, /renderer:\s*L\.canvas\(\)/);
});

test("Native map exposes persisted layer controls without clearing dense selections", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const control = readFileSync(new URL("../src/pages/map/MapLayersControl.tsx", import.meta.url), "utf8");

  assert.match(nativeMap, /loadMapLayerVisibility\(\(\) => window\.localStorage\)/);
  assert.match(nativeMap, /saveMapLayerVisibility\(\(\) => window\.localStorage, layerVisibility\)/);
  assert.match(nativeMap, /setVisible\(layerVisibility\.resources\)/);
  assert.match(nativeMap, /setVisible\(layerVisibility\.enemies\)/);
  assert.match(nativeMap, /<MapLayersControl/);
  assert.doesNotMatch(control, /setResourceIds|setEnemyTypes|resourceIds\s*=|enemyTypes\s*=/);
  assert.match(control, /aria-describedby/);
  assert.match(nativeMap, /id: "layers"[\s\S]*label: "Layers"/);
  assert.match(nativeMap, /alt:\s*accessibleLabel,\s*title:\s*accessibleLabel/s);
  assert.match(nativeMap, /setAttribute\("aria-label", accessibleLabel\)/);
  assert.match(nativeMap, /zoomend/);
  assert.match(nativeMap, /--native-map-claim-scale/);
  const css = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");
  assert.match(css, /native-map-marker--claim[^}]*width:\s*32px[^}]*height:\s*32px/s);
  assert.match(css, /badge-crop[^}]*padding:\s*0/s);
  assert.match(css, /badge-crop[^}]*box-shadow:\s*none/s);
  assert.match(css, /badge-crop[^}]*background:\s*transparent/s);
  assert.match(css, /badge-crop[^}]*clip-path:\s*polygon\(50% 0%, 93\.3% 25%, 93\.3% 75%, 50% 100%, 6\.7% 75%, 6\.7% 25%\)/s);
  assert.match(css, /badge-crop img[^}]*inset:\s*-5\.5px[^}]*width:\s*43px[^}]*height:\s*43px/s);
  assert.match(nativeMap, /selectionRequired.*resourceIds\.length.*enemyTypes\.length/s);
});

test("Native map tool dock exposes exclusive accessible controls", () => {
  const dock = readFileSync(new URL("../src/pages/map/MapToolDock.tsx", import.meta.url), "utf8");

  assert.match(dock, /role="toolbar"/);
  assert.match(dock, /aria-label="Map tools"/);
  assert.match(dock, /aria-expanded=\{activeTool === tool\.id\}/);
  assert.match(dock, /aria-controls=\{panelId\}/);
  assert.match(dock, /event\.key !== "Escape"/);
  assert.match(dock, /triggerRefs\.current\.get\(closingTool\)\?\.focus\(\)/);
  assert.match(dock, /closest\("\[data-map-tool-panel\]"\)/);
});

test("Native map combines renderer and page tools in the approved order", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const layers = readFileSync(new URL("../src/pages/map/MapLayersControl.tsx", import.meta.url), "utf8");

  assert.match(nativeMap, /<MapToolDock tools=\{mapTools\}/);
  assert.ok(nativeMap.indexOf('id: "layers"') < nativeMap.indexOf('id: "biomes"'));
  assert.ok(nativeMap.indexOf('id: "biomes"') < nativeMap.indexOf('id: "players"'));
  assert.ok(nativeMap.indexOf('id: "players"') < nativeMap.indexOf('id: "resources"'));
  assert.doesNotMatch(layers, /React\.useState|aria-expanded|native-map-layers-button/);
  assert.match(layers, /aria-label="Map layer visibility"/);
});

test("Native map places the biome key inside the shared tool dock", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const key = readFileSync(new URL("../src/pages/map/MapBiomeKey.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");

  assert.match(nativeMap, /id: "layers"[\s\S]*<MapLayersControl[\s\S]*id: "biomes"[\s\S]*<MapBiomeKey/);
  assert.match(nativeMap, /biomes=\{terrainStatus\?\.biomes \?\? \[\]\}/);
  assert.match(nativeMap, /waterTypes=\{terrainStatus\?\.waterTypes \?\? \[\]\}/);
  assert.match(nativeMap, /activeBiomeType=\{biomeHighlight\.active\}/);
  assert.match(nativeMap, /pinnedBiomeType=\{biomeHighlight\.pinned\}/);
  assert.match(nativeMap, /onPreview=\{biomeHighlightController\.preview\}/);
  assert.match(nativeMap, /onClear=\{biomeHighlightController\.clear\}/);
  assert.match(nativeMap, /React\.useEffect\(\(\) => \{\s*const controller = createBiomeHighlightController/);
  assert.match(nativeMap, /biomeHighlightControllerRef\.current === controller[\s\S]*biomeHighlightControllerRef\.current = null/);
  assert.match(css, /native-map-biome-key-popover[^}]*max-height:\s*min\(30rem, calc\(100dvh - 8rem\)\)[^}]*overflow:\s*auto/s);
  assert.match(css, /native-map-biome-key-grid[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*native-map-biome-key-grid[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /is-biome-highlight-active[^}]*leaflet-native-map-terrain-pane[^}]*filter:\s*brightness\(32%\)/s);
  assert.match(css, /is-biome-highlight-active[^}]*leaflet-native-map-water-pane[^}]*filter:\s*brightness\(32%\)/s);
  assert.match(css, /native-map-biome-key-row\.is-active/);
  assert.match(css, /native-map-biome-key-row\.is-pinned/);
});

test("Native map separates event and snapshot limits and ignores the initial stream event", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(nativeMap, /mapEventNeedsSnapshot/);
  assert.match(nativeMap, /createMapSnapshotLoader/);
  assert.match(server, /"map-snapshot", RATE_LIMITS\.mapSnapshot/);
  assert.match(server, /"map-events", RATE_LIMITS\.mapEvents/);
  assert.match(server, /initial: true/);
  assert.match(server, /MAP_SPATIAL_INITIAL_WAIT_MS\s*=\s*2_000/);
  assert.match(server, /waitForSnapshot\(MAP_SPATIAL_INITIAL_WAIT_MS\).*combineMapResourceLeases/s);
});

test("Native map uses event-driven snapshot loading without a snapshot polling timer", () => {
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const snapshotEffect = nativeMap.slice(nativeMap.indexOf("const loader = createMapSnapshotLoader"), nativeMap.indexOf("React.useEffect(() => {\n    const markerGroups"));

  assert.match(snapshotEffect, /new EventSource\(request\.eventsUrl/);
  assert.match(snapshotEffect, /mapEventNeedsSnapshot\(JSON\.parse\(message\.data\)\)/);
  assert.match(snapshotEffect, /void loader\.request\(request\.eventsUrl\)/);
  assert.match(snapshotEffect, /fetch\(request\.snapshotUrl/);
  assert.match(snapshotEffect, /createMapResourcePartitionLoader/);
  assert.match(snapshotEffect, /new EventSource\(request\.resourceEventUrl/);
  assert.doesNotMatch(snapshotEffect, /setInterval|setTimeout/);
});

test("configured-region resource and verified player tracking are enabled without enabling unverified enemy identities", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /const MAP_RESOURCE_COORDINATES_VERIFIED = true/);
  assert.match(server, /const MAP_SPATIAL_COLLECTION_VERIFIED = true/);
  assert.match(server, /const MAP_PLAYER_MOBILE_IDENTITY_VERIFIED = true/);
  assert.match(server, /const MAP_ENEMY_IDENTITY_VERIFIED = false/);
  assert.match(server, /RelayMapResourceRuntime/);
  assert.match(server, /resourceIds:\s*\[\]/);
  assert.match(server, /mapResourceLeaseInputs\(scope\)/);
  assert.match(server, /mapResourceScopeKeys/);
  assert.match(server, /RelayMapResourceReadiness/);
  assert.match(server, /ensureCurrentMapResourceRegions/);
  assert.match(server, /relayClaimScopeFence[\s\S]*relayMapResourceRuntime\.stop\(\)/);
});

test("map lease acquisition is serialized through the active claim fence", () => {
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /const acquiredForCurrentClaim = await relayClaimScopeFence\.run\(claimId, async \(\) => \{[\s\S]*relayMapResourceRuntime\.acquire/);
  assert.match(server, /if \(!acquiredForCurrentClaim \|\| currentClaimId\(\) !== claimId\)/);
});

