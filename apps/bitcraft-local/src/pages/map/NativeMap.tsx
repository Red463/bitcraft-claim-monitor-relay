import React from "react";
import L from "leaflet";
import { Layers3, Pickaxe, Trees, Users } from "lucide-react";
import "leaflet/dist/leaflet.css";

import { MapBiomeKey } from "./MapBiomeKey";
import { MapLayersControl } from "./MapLayersControl";
import { MapToolDock, type MapToolDescriptor } from "./MapToolDock";
import { createBiomeHighlightController } from "./biomeHighlightState.mjs";
import { MAP_HEX_APOTHEM, MAP_WORLD_BOUNDS, displayHexPoint, gridTileOrigin, leafletPoint } from "./mapCoordinates.mjs";
import { planDensePointDraw } from "./mapDensePointPlan.mjs";
import { MAP_LAYER_DEFINITIONS, defaultMapLayerVisibility, loadMapLayerVisibility, saveMapLayerVisibility, type MapLayerKey } from "./mapLayerPreferences.mjs";
import { MAP_MARKER_PRESENTATIONS, claimDisplayTier, claimMarkerPresentation, mapMarkerPresentation, type MapMarkerPresentation } from "./mapMarkerPresentation.mjs";
import { mapFeatureInRegionScope, mapFeaturesInRegionScope } from "./mapRegionVisibility.mjs";
import { nativeMapRequest } from "./nativeMapRequest.mjs";
import { assignPlayerMarkerColours } from "./playerMarkerColours.mjs";
import { applyResourceViewport, resourceLayerStatus } from "./resourceViewport.mjs";
import { createMapResourcePartitionLoader } from "./mapResourcePartitionLoader.mjs";
import { applyResourcePartitionPage, resourceRowsFromPartitions, retainResourcePartitions, type ResourcePartition } from "./mapResourcePartitionState.mjs";
import { mapResourceFeatures } from "./mapResourceSnapshotState.mjs";
import { createMapSnapshotLoader, mapEventNeedsSnapshot } from "./mapSnapshotLoader.mjs";
import { replaceMapSnapshot } from "./mapSnapshotState.mjs";
import { RESOURCE_NODE_FALLBACK_COLOUR, resourceFeatureColour } from "./resourceNodeColours.mjs";
import { SYNTHETIC_OCEAN_LEAFLET_BOUNDS, createSyntheticOceanSvg } from "./syntheticOceanUnderlay.mjs";
import { biomeTileUrl, loadTerrainTileStatus, mapTileUrl, type TerrainTileStatus } from "./terrainTileStatus.mjs";
import type { MapFocus } from "./mapUtils";

type MapPoint = { x: number; z: number; dimension: string; coordinateSpace: string };
type MapFeature = {
  kind: string;
  entityId: string;
  regionId?: string;
  name?: string;
  identity?: string;
  resourceId?: string;
  playerEntityId?: string;
  tier?: number | null;
  npc?: boolean;
  point: MapPoint;
};
type MapSnapshot = {
  generation: string;
  generatedAt: string;
  freshness: "live" | "partial" | "stale" | "unavailable";
  ageMs: number | null;
  warnings: string[];
  scope?: { resourceIds?: string[] };
  layers: Record<string, MapFeature[]>;
  layerAvailability?: Record<string, {
    available: boolean;
    status?: "live" | "partial" | "stale" | "loading" | "unavailable";
    pending?: boolean;
    reason: string | null;
  }>;
};

type LayerAvailability = {
  available: boolean;
  status?: "live" | "partial" | "stale" | "loading" | "unavailable";
  pending?: boolean;
  reason: string | null;
};

export type NativeMapToolContent = {
  label: string;
  count: number;
  content: React.ReactNode;
  primaryFocusSelector?: string;
};

const MAP_PROJECTION: L.Projection = {
  project(latlng) {
    return new L.Point(latlng.lng, -latlng.lat / MAP_HEX_APOTHEM);
  },
  unproject(point) {
    const projected = L.point(point);
    return new L.LatLng(-projected.y * MAP_HEX_APOTHEM, projected.x);
  },
  bounds: L.bounds([-Infinity, -Infinity], [Infinity, Infinity]),
};

const NATIVE_CRS = L.extend({}, L.CRS.Simple, {
  projection: MAP_PROJECTION,
  transformation: new L.Transformation(1, 0, 1, 0),
  scale: (zoom: number) => 2 ** zoom,
});

class CoordinateGridLayer extends L.GridLayer {
  createTile(coords: L.Coords) {
    const tile = document.createElement("canvas");
    const size = this.getTileSize();
    tile.width = size.x;
    tile.height = size.y;
    tile.setAttribute("aria-hidden", "true");
    const context = tile.getContext("2d");
    if (!context) return tile;
    context.fillStyle = "#0e1517";
    context.fillRect(0, 0, size.x, size.y);
    context.strokeStyle = "rgba(126, 164, 151, 0.24)";
    context.strokeRect(0.5, 0.5, size.x - 1, size.y - 1);
    context.fillStyle = "rgba(218, 229, 221, 0.58)";
    context.font = "12px system-ui";
    const origin = gridTileOrigin(coords, size.x);
    context.fillText(`N ${origin.north} · E ${origin.east}`, 10, 20);
    return tile;
  }
}

class DensePointLayer extends L.Layer {
  #map: L.Map | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #points: MapFeature[] = [];
  #frame = 0;
  #colour: string | ((point: MapFeature) => string);
  #pane: string;
  #strokeColour: string | null;
  #strokeWidth: number;
  #visible = true;

  constructor(
    colour: string | ((point: MapFeature) => string),
    pane = "overlayPane",
    presentation: { strokeColour?: string; strokeWidth?: number } = {},
  ) {
    super();
    this.#colour = colour;
    this.#pane = pane;
    this.#strokeColour = presentation.strokeColour ?? null;
    this.#strokeWidth = presentation.strokeWidth ?? 0;
  }

  setPoints(points: MapFeature[]) {
    this.#points = points;
    this.#scheduleDraw();
  }

  setPointColour(colour: string | ((point: MapFeature) => string)) {
    this.#colour = colour;
    this.#scheduleDraw();
  }

  setVisible(visible: boolean) {
    this.#visible = visible;
    if (this.#canvas) this.#canvas.style.display = visible ? "" : "none";
    this.#scheduleDraw();
  }

  onAdd(map: L.Map) {
    this.#map = map;
    this.#canvas = L.DomUtil.create("canvas", "leaflet-zoom-animated native-map-dense-canvas") as HTMLCanvasElement;
    (map.getPane(this.#pane) ?? map.getPanes().overlayPane).appendChild(this.#canvas);
    map.on("move zoom resize", this.#scheduleDraw, this);
    this.#scheduleDraw();
    return this;
  }

  onRemove(map: L.Map) {
    cancelAnimationFrame(this.#frame);
    map.off("move zoom resize", this.#scheduleDraw, this);
    this.#canvas?.remove();
    this.#canvas = null;
    this.#map = null;
    return this;
  }

  #scheduleDraw = () => {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#draw());
  };

  #draw() {
    if (!this.#map || !this.#canvas || !this.#visible) return;
    const size = this.#map.getSize();
    const topLeft = this.#map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.#canvas, topLeft);
    this.#canvas.width = size.x;
    this.#canvas.height = size.y;
    const context = this.#canvas.getContext("2d");
    if (!context) return;
    const bounds = this.#map.getBounds().pad(0.1);
    const plan = planDensePointDraw(this.#points, (point) => bounds.contains(leafletPoint(point.point)), 25_000);
    for (const point of plan.points) {
      context.fillStyle = typeof this.#colour === "function" ? this.#colour(point) : this.#colour;
      const pixel = this.#map.latLngToContainerPoint(leafletPoint(point.point));
      context.beginPath();
      context.arc(pixel.x, pixel.y, 3, 0, Math.PI * 2);
      if (this.#strokeColour && this.#strokeWidth > 0) {
        context.strokeStyle = this.#strokeColour;
        context.lineWidth = this.#strokeWidth;
        context.stroke();
      }
      context.fill();
    }
  }
}

const FEATURE_COLORS: Record<string, string> = {
  claim: "#f0c64f",
};
const MARKER_LAYER_KEYS = ["claims", "watchtowers", "players", "claim-areas"] as const;

function markerKindClass(kind: string) {
  return Object.hasOwn(MAP_MARKER_PRESENTATIONS, kind) ? kind : "fallback";
}

function markerIcon(kind: string, presentation: MapMarkerPresentation, color?: string) {
  const content = document.createElement("span");
  const variant = presentation.mode === "image" ? presentation.variant : undefined;
  content.className = `native-map-marker-content${presentation.mode === "image" && presentation.badgeCrop ? " native-map-marker-content--badge-crop" : ""}${variant ? ` native-map-marker-content--${variant}` : ""}`;
  if (kind === "player") {
    if (color) content.style.setProperty("--player-marker-color", color);
    const pulse = document.createElement("span");
    pulse.className = "native-map-player-pulse";
    const dot = document.createElement("span");
    dot.className = "native-map-player-dot";
    content.append(pulse, dot);
  } else {
    const glyph = document.createElement("span");
    glyph.className = "native-map-marker-glyph";
    glyph.textContent = presentation.glyph;
    content.appendChild(glyph);
  }
  if (kind !== "player" && presentation.mode === "image") {
    const image = document.createElement("img");
    image.src = presentation.iconUrl;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.addEventListener("error", () => image.remove(), { once: true });
    content.prepend(image);
  }
  const size = kind === "player" || variant === "watchtower" ? 24 : variant === "claim-tier" || variant === "claim-npc" ? 32 : 30;
  return L.divIcon({
    className: `native-map-marker native-map-marker--${markerKindClass(kind)}`,
    html: content,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function featureLabel(feature: MapFeature) {
  return feature.name || feature.identity || `${feature.kind} ${feature.entityId}`;
}

function displayedPoint(feature: MapFeature) {
  const point = displayHexPoint(feature.point);
  return `N ${point.north}, E ${point.east}`;
}

export function NativeMap({
  regionIds,
  visibleRegionIds = [],
  playerRegionIds,
  resourceRegionIds,
  playerIds,
  resourceIds,
  resourceTiers,
  enemyTypes,
  focus,
  playerTool,
  resourceTool,
  regionControl,
}: {
  regionIds: string[];
  visibleRegionIds?: string[];
  playerRegionIds: string[];
  resourceRegionIds: string[];
  playerIds: string[];
  resourceIds: string[];
  resourceTiers: Readonly<Record<string, number | null>>;
  enemyTypes: string[];
  focus: MapFocus;
  playerTool?: NativeMapToolContent;
  resourceTool?: NativeMapToolContent;
  regionControl?: React.ReactNode;
}) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<L.Map | null>(null);
  const markerGroupsRef = React.useRef<Record<string, L.LayerGroup> | null>(null);
  const focusGroupRef = React.useRef<L.LayerGroup | null>(null);
  const ordinaryRendererRef = React.useRef<L.Canvas | null>(null);
  const resourcesRef = React.useRef<DensePointLayer | null>(null);
  const enemiesRef = React.useRef<DensePointLayer | null>(null);
  const syntheticOceanRef = React.useRef<L.SVGOverlay | null>(null);
  const terrainTilesRef = React.useRef<L.TileLayer | null>(null);
  const waterTilesRef = React.useRef<L.TileLayer | null>(null);
  const biomeMaskTilesRef = React.useRef<L.TileLayer | null>(null);
  const roadTilesRef = React.useRef<L.TileLayer | null>(null);
  const resourceFrameSelectionRef = React.useRef("");
  const [snapshot, setSnapshot] = React.useState<MapSnapshot | null>(null);
  const [resourcePartitions, setResourcePartitions] = React.useState<Map<string, ResourcePartition>>(() => new Map());
  const [resourcePartitionStatuses, setResourcePartitionStatuses] = React.useState<Map<string, { status: string; warning?: string | null; pending?: boolean }>>(() => new Map());
  const [resourceStreamError, setResourceStreamError] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [terrainStatus, setTerrainStatus] = React.useState<TerrainTileStatus | null>(null);
  const [terrainStatusError, setTerrainStatusError] = React.useState("");
  const [biomeHighlight, setBiomeHighlight] = React.useState<{ active: number | null; pinned: number | null }>({ active: null, pinned: null });
  const biomeHighlightControllerRef = React.useRef<ReturnType<typeof createBiomeHighlightController> | null>(null);
  const biomeHighlightController = React.useMemo(() => ({
    preview: (biomeType: number) => biomeHighlightControllerRef.current?.preview(biomeType),
    leave: () => biomeHighlightControllerRef.current?.leave(),
    pin: (biomeType: number) => biomeHighlightControllerRef.current?.pin(biomeType),
    clear: () => biomeHighlightControllerRef.current?.clear(),
  }), []);
  const [layerVisibility, setLayerVisibility] = React.useState(() => typeof window === "undefined"
    ? defaultMapLayerVisibility()
    : loadMapLayerVisibility(() => window.localStorage));
  const request = React.useMemo(() => nativeMapRequest({ operationalRegionIds: regionIds, playerRegionIds, resourceRegionIds, playerIds, resourceIds, enemyTypes }), [regionIds.join(","), playerRegionIds.join(","), resourceRegionIds.join(","), playerIds.join(","), resourceIds.join(","), enemyTypes.join(",")]);
  const snapshotRequestKeyRef = React.useRef(request.eventsUrl);
  snapshotRequestKeyRef.current = request.eventsUrl;
  const resourceSelectionKey = React.useMemo(() => request.resourcePartitions.map((partition) => partition.key).join(","), [request.resourcePartitions]);
  const wantedResourceKeys = React.useMemo(() => request.resourcePartitions.map((partition) => partition.key), [resourceSelectionKey]);
  const resourceRows = React.useMemo(() => resourceRowsFromPartitions(resourcePartitions), [resourcePartitions]);
  const resourcePoints = React.useMemo(() => mapResourceFeatures(resourceRows) as MapFeature[], [resourceRows]);
  const visibleResourcePoints = React.useMemo(() => mapFeaturesInRegionScope(resourcePoints, visibleRegionIds), [resourcePoints, visibleRegionIds.join(",")]);
  const visibleEnemyPoints = React.useMemo(() => mapFeaturesInRegionScope(snapshot?.layers.enemies ?? [], visibleRegionIds), [snapshot?.layers.enemies, visibleRegionIds.join(",")]);
  const resourceStatuses = wantedResourceKeys.map((key) => resourcePartitionStatuses.get(key));
  const startedResourcePartitionCount = wantedResourceKeys.filter((key) => resourcePartitions.has(key)).length;
  const loadedResourcePartitionCount = wantedResourceKeys.filter((key) => resourcePartitions.get(key)?.complete === true).length;
  const pendingResourcePartitionCount = resourceStatuses.filter((status) => status == null || status.status === "loading" || status.pending === true).length;
  const unavailableResourcePartitionCount = resourceStatuses.filter((status) => status?.status === "unavailable").length;
  const resourceLayerLoading = wantedResourceKeys.length > 0 && pendingResourcePartitionCount > 0;
  const snapshotResourceSelectionKey = resourceLayerLoading ? "" : resourceSelectionKey;

  React.useEffect(() => {
    const controller = createBiomeHighlightController({ onChange: setBiomeHighlight });
    biomeHighlightControllerRef.current = controller;
    return () => {
      controller.dispose();
      if (biomeHighlightControllerRef.current === controller) biomeHighlightControllerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = L.map(hostRef.current, { crs: NATIVE_CRS, minZoom: -6, maxZoom: 5, zoomControl: true, preferCanvas: true, attributionControl: false });
    const gridPane = map.createPane("native-map-grid");
    gridPane.style.zIndex = "100";
    gridPane.style.pointerEvents = "none";
    const oceanPane = map.createPane("native-map-ocean");
    oceanPane.style.zIndex = "190";
    oceanPane.style.pointerEvents = "none";
    const terrainPane = map.createPane("native-map-terrain");
    terrainPane.style.zIndex = "200";
    const waterPane = map.createPane("native-map-water");
    waterPane.style.zIndex = "210";
    const biomeMaskPane = map.createPane("native-map-biome-mask");
    biomeMaskPane.style.zIndex = "250";
    biomeMaskPane.style.pointerEvents = "none";
    const resourcePane = map.createPane("native-map-resources");
    resourcePane.style.zIndex = "650";
    resourcePane.style.pointerEvents = "none";
    const playerPane = map.createPane("native-map-players");
    playerPane.style.zIndex = "700";
    const bounds = L.latLngBounds([MAP_WORLD_BOUNDS.minZ, MAP_WORLD_BOUNDS.minX], [MAP_WORLD_BOUNDS.maxZ, MAP_WORLD_BOUNDS.maxX]);
    const updateClaimScale = () => {
      const scale = Math.max(0.72, Math.min(1.1, 0.72 + (map.getZoom() + 5) * 0.038));
      hostRef.current?.style.setProperty("--native-map-claim-scale", scale.toFixed(3));
    };
    map.setView([19_200, 19_200], -4);
    map.setMaxBounds(bounds.pad(0.25));
    map.on("zoomend", updateClaimScale);
    updateClaimScale();
    new CoordinateGridLayer({ tileSize: 256, noWrap: false, pane: "native-map-grid" }).addTo(map);
    ordinaryRendererRef.current = L.canvas({ padding: 0.25 });
    const markerGroups = Object.fromEntries(MARKER_LAYER_KEYS.map((key) => [key, key === "players" ? L.layerGroup([], { pane: "native-map-players" }) : L.layerGroup()]));
    for (const [key, group] of Object.entries(markerGroups)) if (layerVisibility[key as MapLayerKey]) group.addTo(map);
    markerGroupsRef.current = markerGroups;
    focusGroupRef.current = L.layerGroup().addTo(map);
    resourcesRef.current = new DensePointLayer(RESOURCE_NODE_FALLBACK_COLOUR, "native-map-resources", { strokeColour: "rgba(3, 8, 12, .92)", strokeWidth: 1.25 }).addTo(map);
    enemiesRef.current = new DensePointLayer("rgba(255, 112, 112, 0.92)").addTo(map);
    mapRef.current = map;
    return () => {
      map.off("zoomend", updateClaimScale);
      map.remove();
      mapRef.current = null;
      markerGroupsRef.current = null;
      focusGroupRef.current = null;
      ordinaryRendererRef.current = null;
      resourcesRef.current = null;
      enemiesRef.current = null;
      syntheticOceanRef.current = null;
      terrainTilesRef.current = null;
      waterTilesRef.current = null;
      biomeMaskTilesRef.current = null;
      roadTilesRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    saveMapLayerVisibility(() => window.localStorage, layerVisibility);
    const map = mapRef.current;
    if (!map) return;
    for (const [key, group] of Object.entries(markerGroupsRef.current ?? {})) {
      const visible = layerVisibility[key as MapLayerKey];
      if (visible && !map.hasLayer(group)) group.addTo(map);
      else if (!visible && map.hasLayer(group)) group.removeFrom(map);
    }
    resourcesRef.current?.setVisible(layerVisibility.resources);
    enemiesRef.current?.setVisible(layerVisibility.enemies);
    const roads = roadTilesRef.current;
    if (roads) {
      if (layerVisibility.roads && !map.hasLayer(roads)) roads.addTo(map);
      else if (!layerVisibility.roads && map.hasLayer(roads)) roads.removeFrom(map);
    }
  }, [layerVisibility]);

  React.useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const status = await loadTerrainTileStatus(controller.signal);
        if (!disposed) {
          setTerrainStatus(status);
          setTerrainStatusError("");
        }
      } catch (statusError) {
        if (!disposed && !controller.signal.aborted) setTerrainStatusError(statusError instanceof Error ? statusError.message : String(statusError));
      }
    };
    const visibility = () => { if (!document.hidden) void load(); };
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    syntheticOceanRef.current?.removeFrom(map);
    syntheticOceanRef.current = null;
    if (!terrainStatus?.available || !terrainStatus.generation) {
      terrainTilesRef.current?.removeFrom(map);
      waterTilesRef.current?.removeFrom(map);
      terrainTilesRef.current = null;
      waterTilesRef.current = null;
      return;
    }
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
    const tileOptions = {
      tileSize: 256,
      minZoom: -6,
      maxZoom: 5,
      minNativeZoom: -5,
      maxNativeZoom: 0,
      noWrap: false,
      keepBuffer: 2,
    };
    const terrainTiles = L.tileLayer(mapTileUrl("terrain", terrainStatus.generation), { ...tileOptions, pane: "native-map-terrain" });
    const waterTiles = L.tileLayer(mapTileUrl("water", terrainStatus.generation), { ...tileOptions, pane: "native-map-water" });
    terrainTilesRef.current?.removeFrom(map);
    waterTilesRef.current?.removeFrom(map);
    terrainTiles.addTo(map);
    waterTiles.addTo(map);
    terrainTilesRef.current = terrainTiles;
    waterTilesRef.current = waterTiles;
    return () => {
      syntheticOcean?.removeFrom(map);
      terrainTiles.removeFrom(map);
      waterTiles.removeFrom(map);
      if (syntheticOceanRef.current === syntheticOcean) syntheticOceanRef.current = null;
      if (terrainTilesRef.current === terrainTiles) terrainTilesRef.current = null;
      if (waterTilesRef.current === waterTiles) waterTilesRef.current = null;
    };
  }, [terrainStatus?.available, terrainStatus?.generation]);

  const activeBiomePresent = biomeHighlight.active != null
    && terrainStatus?.biomes.some((biome) => biome.biomeType === biomeHighlight.active && biome.present) === true;

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    biomeMaskTilesRef.current?.removeFrom(map);
    biomeMaskTilesRef.current = null;
    hostRef.current?.classList.remove("is-biome-highlight-active");
    if (!terrainStatus?.available || !terrainStatus.generation || biomeHighlight.active == null || !activeBiomePresent) return;
    const biomeMaskTiles = L.tileLayer(biomeTileUrl(biomeHighlight.active, terrainStatus.generation), {
      tileSize: 256,
      minZoom: -6,
      maxZoom: 5,
      minNativeZoom: -5,
      maxNativeZoom: 0,
      noWrap: false,
      keepBuffer: 2,
      pane: "native-map-biome-mask",
    });
    biomeMaskTiles.addTo(map);
    biomeMaskTilesRef.current = biomeMaskTiles;
    hostRef.current?.classList.add("is-biome-highlight-active");
    return () => {
      biomeMaskTiles.removeFrom(map);
      if (biomeMaskTilesRef.current === biomeMaskTiles) biomeMaskTilesRef.current = null;
      hostRef.current?.classList.remove("is-biome-highlight-active");
    };
  }, [activeBiomePresent, biomeHighlight.active, terrainStatus?.available, terrainStatus?.generation]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    roadTilesRef.current?.removeFrom(map);
    roadTilesRef.current = null;
    const roadStatus = terrainStatus?.roads;
    if (!roadStatus?.available || !roadStatus.generation) return;
    const roads = L.tileLayer(mapTileUrl("roads", roadStatus.generation), {
      tileSize: 256,
      minZoom: -6,
      maxZoom: 5,
      minNativeZoom: -5,
      maxNativeZoom: 0,
      noWrap: false,
      keepBuffer: 2,
      pane: "overlayPane",
    });
    if (layerVisibility.roads) roads.addTo(map);
    roadTilesRef.current = roads;
    return () => {
      roads.removeFrom(map);
      if (roadTilesRef.current === roads) roadTilesRef.current = null;
    };
  }, [terrainStatus?.roads?.available, terrainStatus?.roads?.generation]);

  React.useEffect(() => {
    if (!focus || !mapRef.current) return;
    mapRef.current.flyTo(leafletPoint({ x: focus.locationX, z: focus.locationZ }), 1, { duration: 0.6 });
  }, [focus?.name, focus?.locationX, focus?.locationZ]);

  React.useEffect(() => {
    const controller = new AbortController();
    let events: EventSource | null = null;
    let disposed = false;
    const loader = createMapSnapshotLoader<MapSnapshot>({
      isHidden: () => document.hidden,
      currentRequestKey: () => snapshotRequestKeyRef.current,
      onLoading: setLoading,
      load: async () => {
        const response = await fetch(request.snapshotUrl, { signal: controller.signal, credentials: "same-origin" });
        const payload = await response.json();
        if (!response.ok && !payload?.provider) throw new Error(payload.error || `Native map HTTP ${response.status}`);
        return payload;
      },
      onValue: ({ requestKey, value }) => {
        const nextSnapshot = replaceMapSnapshot({ currentRequestKey: snapshotRequestKeyRef.current, requested: { requestKey, value } });
        if (!disposed && nextSnapshot) {
          setSnapshot(nextSnapshot);
          setError("");
        }
      },
      onError: (loadError) => {
        if (!disposed && !controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : String(loadError));
      },
    });
    const connect = () => {
      if (document.hidden || disposed) return;
      events?.close();
      events = new EventSource(request.eventsUrl, { withCredentials: true });
      events.onmessage = (message) => {
        try {
          if (mapEventNeedsSnapshot(JSON.parse(message.data))) void loader.request(request.eventsUrl);
        } catch {
          setError("A live map update was malformed; reconnecting.");
        }
      };
      events.onerror = () => setError((current) => current || "Live map updates are reconnecting.");
    };
    const visibility = () => {
      if (document.hidden) events?.close();
      else {
        void loader.request(request.eventsUrl);
        connect();
      }
    };
    void loader.request(request.eventsUrl);
    connect();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      loader.stop();
      controller.abort();
      events?.close();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [request.snapshotUrl, request.eventsUrl]);

  React.useEffect(() => {
    const wanted = new Set(wantedResourceKeys);
    setResourcePartitions((current) => retainResourcePartitions(current, wantedResourceKeys));
    setResourcePartitionStatuses((current) => new Map([...current].filter(([key]) => wanted.has(key))));
    setResourceStreamError("");
    const loader = createMapResourcePartitionLoader({
      concurrency: 4,
      fetchPage: async ({ partition, cursor, signal }) => {
        const url = new URL(request.resourcePartitions.find((entry) => entry.key === partition.key)?.url ?? "", window.location.origin);
        if (cursor) url.searchParams.set("cursor", cursor);
        const response = await fetch(`${url.pathname}${url.search}`, { signal, credentials: "same-origin" });
        const payload = await response.json();
        if (!response.ok && !payload?.provider) {
          const requestError = new Error(payload?.error || `Map resource partition HTTP ${response.status}`) as Error & { staleCursor?: boolean };
          if (response.status === 422 && cursor) requestError.staleCursor = true;
          throw requestError;
        }
        return payload;
      },
      onPage: (page) => setResourcePartitions((current) => applyResourcePartitionPage(current, page)),
      onStatus: (status) => setResourcePartitionStatuses((current) => {
        const next = new Map(current);
        next.set(status.key, { status: status.status, warning: status.warning, pending: status.pending });
        return next;
      }),
    });
    loader.setScope(request.resourcePartitions);
    let events: EventSource | null = null;
    const connect = () => {
      if (!request.resourceEventUrl || document.hidden) return;
      events?.close();
      events = new EventSource(request.resourceEventUrl, { withCredentials: true });
      events.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data);
          if (typeof payload?.mapResourceScopeKey === "string") loader.refresh([payload.mapResourceScopeKey]);
        } catch {
          setResourceStreamError("A resource update was malformed; reconnecting.");
        }
      };
      events.onerror = () => setResourceStreamError((current) => current || "Live resource updates are reconnecting.");
      events.onopen = () => setResourceStreamError("");
    };
    const visibility = () => {
      if (document.hidden) {
        loader.pause();
        events?.close();
      } else {
        loader.resume();
        connect();
      }
    };
    connect();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      loader.stop();
      events?.close();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [resourceSelectionKey, request.resourceEventUrl]);

  React.useEffect(() => {
    const markerGroups = markerGroupsRef.current;
    const focusGroup = focusGroupRef.current;
    if (!markerGroups || !focusGroup || !ordinaryRendererRef.current) return;
    for (const group of Object.values(markerGroups)) group.clearLayers();
    focusGroup.clearLayers();
    if (focus) {
      const readable = displayHexPoint({ x: focus.locationX, z: focus.locationZ });
      const focusPresentation = mapMarkerPresentation("focus");
      const focusMarker = L.marker(leafletPoint({ x: focus.locationX, z: focus.locationZ }), { icon: markerIcon("focus", focusPresentation), keyboard: true });
      focusMarker.bindTooltip(`${focus.name} · N ${readable.north}, E ${readable.east}`, { permanent: true, direction: "top" });
      focusMarker.addTo(focusGroup);
    }
    resourcesRef.current?.setPointColour((feature) => resourceFeatureColour(feature, resourceTiers));
    resourcesRef.current?.setPoints(visibleResourcePoints);
    if (!snapshot) return;
    const playerColours = assignPlayerMarkerColours((snapshot.layers.players ?? []).map((feature) => String(feature.playerEntityId ?? feature.entityId)));
    for (const [layer, features] of Object.entries(snapshot.layers)) {
      if (layer === "resources" || layer === "enemies" || layer === "empire-territory") continue;
      const markerGroup = markerGroups[layer];
      if (!markerGroup) continue;
      for (const feature of features) {
        if (!mapFeatureInRegionScope(feature, visibleRegionIds)) continue;
        const presentation = feature.kind === "claim"
          ? claimMarkerPresentation(feature.tier, feature.npc)
          : mapMarkerPresentation(feature.kind);
        const displayTier = claimDisplayTier(feature.tier);
        const claimLabel = feature.kind !== "claim"
          ? ""
          : feature.npc
            ? " · NPC town"
            : displayTier != null
              ? ` · Tier ${displayTier}`
              : "";
        const accessibleLabel = `${featureLabel(feature)}${claimLabel} · ${displayedPoint(feature)}`;
        const marker = presentation.mode === "canvas"
          ? L.circleMarker(leafletPoint(feature.point), {
              radius: 5,
              color: FEATURE_COLORS[feature.kind] ?? "#dbe5df",
              weight: 2,
              fillOpacity: 0.85,
              renderer: ordinaryRendererRef.current,
            })
          : L.marker(leafletPoint(feature.point), {
              icon: markerIcon(feature.kind, presentation, playerColours[String(feature.playerEntityId ?? feature.entityId)]),
              ...(feature.kind === "player" ? { pane: "native-map-players" } : {}),
              keyboard: true,
              alt: accessibleLabel,
              title: accessibleLabel,
            });
        marker.bindTooltip(accessibleLabel);
        marker.on("add", () => marker.getElement()?.setAttribute("aria-label", accessibleLabel));
        marker.addTo(markerGroup);
      }
    }
    enemiesRef.current?.setPoints(visibleEnemyPoints);
    const map = mapRef.current;
    if (!resourceSelectionKey) resourceFrameSelectionRef.current = "";
    else if (map) {
      resourceFrameSelectionRef.current = applyResourceViewport({
        selectionKey: resourceSelectionKey,
        snapshotSelectionKey: snapshotResourceSelectionKey,
        consumedSelectionKey: resourceFrameSelectionRef.current,
        loading: resourceLayerLoading,
        points: visibleResourcePoints,
        isVisible: (feature: MapFeature) => map.getBounds().contains(leafletPoint(feature.point)),
        frame: (features: readonly MapFeature[]) => {
          map.fitBounds(L.latLngBounds(features.map((feature) => leafletPoint(feature.point))), {
            padding: [32, 32],
            maxZoom: 1,
          });
        },
      });
    }
  }, [snapshot, visibleResourcePoints, visibleEnemyPoints, resourceSelectionKey, resourceTiers, resourceLayerLoading, visibleRegionIds.join(","), focus?.name, focus?.locationX, focus?.locationZ]);

  const accessibleFeatures = snapshot
    ? Object.entries(snapshot.layers).flatMap(([layer, features]) => {
        if (!layerVisibility[layer as MapLayerKey]) return [];
        if (layer === "empire-territory") return [];
        const visibleFeatures = mapFeaturesInRegionScope(features, visibleRegionIds);
        if (layer === "resources" || layer === "enemies") return visibleFeatures;
        return visibleFeatures.filter((feature) => (feature.kind === "claim" ? claimMarkerPresentation(feature.tier, feature.npc) : mapMarkerPresentation(feature.kind)).mode === "canvas");
      }).concat(layerVisibility.resources ? visibleResourcePoints : [])
    : [];
  const layerAvailability: Record<string, LayerAvailability> = Object.fromEntries(MAP_LAYER_DEFINITIONS.map(({ key, available, unavailableReason, selectionRequired }) => {
    const hasSelection = !selectionRequired || (key === "resources" ? resourceIds.length > 0 : enemyTypes.length > 0);
    const selectionReason = key === "resources" ? "Select at least one resource to enable this layer." : "Select at least one enemy to enable this layer.";
    return [key, { available: available && hasSelection, reason: available && !hasSelection ? selectionReason : unavailableReason as string | null }];
  }));
  Object.assign(layerAvailability, snapshot?.layerAvailability ?? {});
  const resourceWarnings = [...new Set([
    ...[...resourcePartitions.values()].flatMap((partition) => [...partition.warnings]),
    ...resourceStatuses.map((status) => status?.warning).filter((warning): warning is string => Boolean(warning)),
  ])];
  layerAvailability.resources = !wantedResourceKeys.length
    ? { available: false, status: "unavailable", pending: false, reason: "Select at least one resource to enable this layer." }
    : loadedResourcePartitionCount === wantedResourceKeys.length
      ? {
          available: true,
          status: [...resourcePartitions.values()].some((partition) => partition.freshness === "stale") ? "stale" : "live",
          pending: false,
          reason: resourceWarnings[0] ?? null,
        }
      : startedResourcePartitionCount > 0
        ? { available: true, status: "partial", pending: pendingResourcePartitionCount > 0, reason: resourceWarnings[0] ?? "Some selected resource regions are still loading." }
        : pendingResourcePartitionCount > 0
          ? { available: false, status: "loading", pending: true, reason: "Selected resource regions are loading." }
          : { available: false, status: "unavailable", pending: false, reason: resourceWarnings[0] ?? `${unavailableResourcePartitionCount} resource partition${unavailableResourcePartitionCount === 1 ? " is" : "s are"} unavailable.` };
  layerAvailability.roads = terrainStatus?.roads?.available
    ? { available: true, reason: null }
    : { available: false, reason: "Road tiles have not been generated for this server yet." };
  const layerCounts = Object.fromEntries(MAP_LAYER_DEFINITIONS.map(({ key, dataLayer }) => [key, key === "resources" ? resourcePoints.length : dataLayer ? snapshot?.layers[dataLayer]?.length ?? 0 : null]));
  const resourceStatus = resourceLayerStatus({
    selectionKey: resourceSelectionKey,
    snapshotSelectionKey: snapshotResourceSelectionKey,
    available: layerAvailability.resources?.available,
    status: layerAvailability.resources?.status,
    pending: layerAvailability.resources?.pending,
    reason: layerAvailability.resources?.reason,
    visible: layerVisibility.resources,
    freshness: snapshot?.freshness ?? "unavailable",
  });
  const toggleLayer = (key: MapLayerKey) => setLayerVisibility((current) => ({ ...current, [key]: !current[key] }));
  const mapTools: MapToolDescriptor[] = [
    {
      id: "layers",
      label: "Layers",
      icon: <Layers3 size={16} aria-hidden="true" />,
      panel: <MapLayersControl visibility={layerVisibility} availability={layerAvailability} counts={layerCounts} onToggle={toggleLayer} />,
    },
    {
      id: "biomes",
      label: "Biomes",
      icon: <Trees size={16} aria-hidden="true" />,
      panel: <MapBiomeKey
        biomes={terrainStatus?.biomes ?? []}
        waterTypes={terrainStatus?.waterTypes ?? []}
        activeBiomeType={biomeHighlight.active}
        pinnedBiomeType={biomeHighlight.pinned}
        onPreview={biomeHighlightController.preview}
        onLeave={biomeHighlightController.leave}
        onPin={biomeHighlightController.pin}
        onClear={biomeHighlightController.clear}
      />,
    },
    {
      id: "players",
      label: playerTool?.label ?? "Players",
      count: playerTool?.count ?? playerIds.length,
      icon: <Users size={16} aria-hidden="true" />,
      panel: playerTool?.content ?? <p>Player tracking controls are unavailable.</p>,
      primaryFocusSelector: playerTool?.primaryFocusSelector,
    },
    {
      id: "resources",
      label: resourceTool?.label ?? "Resources",
      count: resourceTool?.count ?? resourceIds.length,
      icon: <Pickaxe size={16} aria-hidden="true" />,
      panel: resourceTool?.content ?? <p>Resource finder controls are unavailable.</p>,
      primaryFocusSelector: resourceTool?.primaryFocusSelector,
    },
  ];
  return (
    <section className="native-map-shell" aria-label="Native BitCraft map">
      <div ref={hostRef} className="native-map-canvas" role="application" aria-label="Interactive BitCraft coordinate map" tabIndex={0} />
      <div className="native-map-controls">
        <MapToolDock tools={mapTools} trailingControl={regionControl} />
      </div>
      <div className="native-map-status" aria-live="polite">
        <strong>{loading && !snapshot ? "Loading native map…" : snapshot ? `${snapshot.freshness} · generation ${snapshot.generation}` : "Native map unavailable"}</strong>
        {snapshot?.ageMs != null ? <span>{Math.round(snapshot.ageMs / 1000)}s old</span> : null}
        {error ? <span className="error">{error}</span> : null}
        {resourceStatus === "loading" ? <span>Loading selected resource positions from Relay...</span> : null}
        {wantedResourceKeys.length ? <span>Resources {loadedResourcePartitionCount}/{wantedResourceKeys.length} region/type partitions loaded</span> : null}
        {resourceStreamError ? <span className="error">{resourceStreamError}</span> : null}
        {terrainStatus?.available ? <span>Terrain {terrainStatus.freshness} · generation {terrainStatus.generation}</span> : null}
        {terrainStatus?.roads?.available ? <span>Roads · generation {terrainStatus.roads.generation} · {terrainStatus.roads.featureCount.toLocaleString()} paving points</span> : null}
        {terrainStatus && !terrainStatus.available ? <span>{terrainStatus.buildStage === "building"
          ? "Terrain and water are building from live Relay data; showing the coordinate fallback meanwhile."
          : "Terrain/water tiles are not installed on this server; showing the coordinate fallback."}</span> : null}
        {terrainStatusError ? <span className="error">{terrainStatusError}</span> : null}
        {terrainStatus?.warnings?.map((warning) => <span key={warning}>{warning}</span>)}
        {snapshot ? <ul className="native-map-legend" aria-label="Map layer status">{Object.entries(snapshot.layers).map(([layer, features]) => <li key={layer}><span>{layer}</span><strong>{features.length}</strong><small>{layerAvailability[layer]?.available === false ? "unavailable" : layerVisibility[layer as MapLayerKey] ? snapshot.freshness : "hidden"}</small></li>)}{wantedResourceKeys.length ? <li><span>resources</span><strong>{resourcePoints.length}</strong><small>{resourceStatus}</small></li> : null}</ul> : null}
        {snapshot?.warnings?.length ? <details><summary>{snapshot.warnings.length} data warning{snapshot.warnings.length === 1 ? "" : "s"}</summary><ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
        {resourceWarnings.length ? <details><summary>{resourceWarnings.length} resource warning{resourceWarnings.length === 1 ? "" : "s"}</summary><ul>{resourceWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
      </div>
      {accessibleFeatures.length ? <details className="native-map-accessible-points"><summary>{accessibleFeatures.length} canvas map points</summary><ul>{accessibleFeatures.slice(0, 250).map((feature) => <li key={`${feature.kind}:${feature.regionId}:${feature.entityId}`}>{featureLabel(feature)} at {displayedPoint(feature)}</li>)}</ul></details> : null}
    </section>
  );
}
