import React from "react";
import "../styles/map.css";
import { MapPin, Maximize2 } from "lucide-react";

import { toNumber, unwrap, type AnyRecord } from "../main-app-data";
import { activeRegionLabel, useActiveRegions } from "../hooks/useActiveRegions";
import { useGameDataGeneration } from "../hooks/useGameDataGeneration";
import { usePageRefresh } from "../refresh/ManualRefreshContext";
import { pageRefreshHeaders } from "../refresh/pageRefresh.mjs";
import { usePersistedState } from "../hooks/usePersistedState";
import { memberDisplayName, memberTrackingId } from "../utils/memberIdentity";
import { normalizeData } from "../utils/normalize";
import { unique } from "../utils/array";
import { dedicatedMapHref, updateQueryState } from "../navigation";
import { mapResourceCategory, mapResourceToken, normalizeMapResourceToken, type MapFocus } from "./map/mapUtils";
import { currentMapPlayerSelection, defaultMapPlayerSelection, mapPlayerTrackingId, type MapTrackedExternalPlayer } from "./map/playerTracking";
import { NativeMap } from "./map/NativeMap";
import { MapPlayerTrackingPanel } from "./map/MapPlayerTrackingPanel";
import { MapRegionSelect } from "./map/MapRegionSelect";
import { MapResourceFinderPanel } from "./map/MapResourceFinderPanel";
import { boundedNativeMapRegions, nativeMapResourceRegions, nativeMapResourceSelectionLimit, normalizeNativeMapRegionSelection } from "./map/nativeMapRequest.mjs";
import { selectedResourceColourMap } from "./map/resourceNodeColours.mjs";
import { RESOURCE_FINDER_BATCH_SIZE, nextResourceLimit, visibleResourceMatches } from "./map/resourceFinderWindow.mjs";

const LOCAL_API = "/api/local";
export function MapPanel({ data, focus, onClearFocus, activeRegionScopeKey, dedicated = false }: {
  data: ReturnType<typeof normalizeData>;
  focus: MapFocus;
  onClearFocus: () => void;
  activeRegionScopeKey?: string;
  dedicated?: boolean;
}) {
  const { cycle, trackPromise } = usePageRefresh();
  const [selectedIds, setSelectedIds] = usePersistedState<string[] | null>("map.players", null);
  const [externalPlayers, setExternalPlayers] = usePersistedState<MapTrackedExternalPlayer[]>("map.external-players", []);
  const [selectedResources, setSelectedResources] = usePersistedState<string[]>("map.resources", []);
  const urlSelectionsApplied = React.useRef(false);
  const [resourceSearch, setResourceSearch] = usePersistedState("map.resource-search", "");
  const [resourceTier, setResourceTier] = usePersistedState("map.resource-tier", "All");
  const [resourceCategory, setResourceCategory] = usePersistedState("map.resource-category", "All");
  const [resourceVisibleLimit, setResourceVisibleLimit] = React.useState<number>(RESOURCE_FINDER_BATCH_SIZE);
  const [resourceRegions, setResourceRegions] = usePersistedState<string[]>("map.regions", data.claim.regionId != null ? [String(data.claim.regionId)] : []);
  const [resources, setResources] = React.useState<AnyRecord[]>([]);
  const [resourceError, setResourceError] = React.useState("");
  const [resourceNotice, setResourceNotice] = React.useState("");
  const [resourceCatalogLoaded, setResourceCatalogLoaded] = React.useState(false);
  const [mapResourceRegions, setMapResourceRegions] = React.useState<AnyRecord[]>([]);
  React.useEffect(() => {
    if (!urlSelectionsApplied.current) {
      urlSelectionsApplied.current = true;
      const value = new URLSearchParams(window.location.search).get("mapLayers");
      if (value != null) {
        setSelectedResources([...new Set(value.split(",").map(normalizeMapResourceToken).filter(Boolean))]);
        return;
      }
    }
    updateQueryState({ mapLayers: selectedResources.length ? selectedResources.map(normalizeMapResourceToken).filter(Boolean).join(",") : null });
  }, [selectedResources.join(",")]);
  const memberRoster = React.useMemo(() => {
    const detailById = new Map(data.players
      .map((player) => [String(player.entityId ?? player.playerEntityId ?? player.playerId ?? ""), player] as const)
      .filter(([id]) => Boolean(id)));
    const rows: AnyRecord[] = data.members.map((member) => {
      const playerId = memberTrackingId(member);
      const detail = detailById.get(playerId);
      return {
        ...(detail ?? {}),
        ...member,
        entityId: playerId,
        playerEntityId: playerId,
        username: detail?.username ?? detail?.userName ?? memberDisplayName(member),
        userName: detail?.userName ?? detail?.username ?? memberDisplayName(member),
        signedIn: detail?.signedIn === true,
        sessionSeconds: detail?.sessionSeconds ?? null,
        detailAvailable: detail ? detail.detailAvailable !== false : false,
        detailError: detail?.detailError,
      };
    });
    const memberIds = new Set(rows.map((player) => String(player.entityId)).filter(Boolean));
    for (const player of data.players) {
      const playerId = String(player.entityId ?? player.playerEntityId ?? player.playerId ?? "");
      if (playerId && !memberIds.has(playerId)) rows.push({ ...player, entityId: playerId, playerEntityId: playerId });
    }
    return rows;
  }, [data.members, data.players]);
  const roster = memberRoster;
  const rawData = (data as ReturnType<typeof normalizeData> & { raw?: AnyRecord | null }).raw;
  const playerDetailDiagnostics = rawData?.playerDetailDiagnostics ?? {};
  const degradedPlayerCount = roster.filter((player) => player.detailAvailable === false).length;
  const rosterSource = degradedPlayerCount ? "members + partial detail" : roster.length ? "members + player detail" : "empty";
  const activeRegions = useActiveRegions(
    String(data.claim.regionId ?? ""),
    String(data.claim.entityId ?? ""),
    activeRegionScopeKey,
  );
  const catalogGeneration = useGameDataGeneration(String(data.claim.entityId ?? ""), ["catalogs"]);
  React.useEffect(() => {
    const controller = new AbortController();
    const refresh = fetch(`${LOCAL_API}/map/catalog`, { headers: cycle ? pageRefreshHeaders(cycle, "map") : {}, signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`map catalog HTTP ${response.status}`)));
    void trackPromise("map-catalog", refresh)
      .then((catalogPayload) => {
        const resourceRows: AnyRecord[] = unwrap<AnyRecord[]>(catalogPayload, "resources", [])
          .filter((resource) => resource?.id != null && resource?.name)
          .map((resource) => ({ ...resource, mapKind: "resource", mapId: String(resource.id), mapSortOrder: toNumber(resource.id) }));
        const creatureRows: AnyRecord[] = unwrap<AnyRecord[]>(catalogPayload, "creatures", [])
          .filter((creature) => creature?.enemyType != null && creature?.name && (creature.huntable === true || String(creature.tag ?? "").toLowerCase().includes("animal")))
          .map((creature) => ({ ...creature, id: `enemy:${creature.enemyType}`, mapKind: "enemy", mapId: String(creature.enemyType), mapSortOrder: 100000 + toNumber(creature.enemyType), tag: "Huntable Animal" }));
        setResources([...resourceRows, ...creatureRows].sort((a, b) => toNumber(a.mapSortOrder) - toNumber(b.mapSortOrder) || String(a.name).localeCompare(String(b.name))));
        setResourceError("");
        setResourceNotice(String(catalogPayload.freshness ?? "") === "stale"
          ? String(catalogPayload.warnings?.[0] ?? "Relay catalog is stale.")
          : "");
        setResourceCatalogLoaded(true);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResourceError(error instanceof Error ? error.message : String(error));
      });
    return () => controller.abort();
  }, [catalogGeneration, trackPromise]);
  React.useEffect(() => {
    const controller = new AbortController();
    const refresh = fetch(`${LOCAL_API}/map/regions`, {
      headers: cycle ? pageRefreshHeaders(cycle, "map") : {},
      signal: controller.signal,
    }).then((response) => response.ok ? response.json() : Promise.reject(new Error(`map regions HTTP ${response.status}`)));
    void trackPromise("map-regions", refresh)
      .then((payload) => {
        const rows = Array.isArray(payload?.regions) ? payload.regions : [];
        setMapResourceRegions(rows.map((region: AnyRecord) => ({
          ...region,
          regionId: String(region.regionId ?? ""),
        })).filter((region: AnyRecord) => /^\d+$/.test(region.regionId) && region.relayReady === true));
      })
      .catch(() => {
        if (!controller.signal.aborted) setMapResourceRegions([]);
      });
    return () => controller.abort();
  }, [cycle?.sequence, trackPromise]);
  const current = React.useMemo(() => currentMapPlayerSelection(selectedIds, roster), [selectedIds, roster]);
  const defaultFocus = data.claim.locationX != null && data.claim.locationZ != null ? {
    name: data.claim.name ?? "Monitored settlement",
    locationX: toNumber(data.claim.locationX),
    locationZ: toNumber(data.claim.locationZ),
  } : null;
  const normalizedSelectedResources = React.useMemo(() => selectedResources.map(normalizeMapResourceToken).filter(Boolean), [selectedResources]);
  const resourceByToken = React.useMemo(() => new Map(resources.map((resource) => [mapResourceToken(resource), resource])), [resources]);
  const resourceCategories = React.useMemo(() => unique(resources.map(mapResourceCategory).filter(Boolean)).sort((a, b) => a.localeCompare(b)), [resources]);
  const resourceTiers = React.useMemo(() => unique(resources.map((resource) => String(resource.tier ?? "")).filter(Boolean)).sort((a, b) => toNumber(a) - toNumber(b)), [resources]);
  const operationalRegionOptions = React.useMemo(() => unique([
    ...activeRegions.map((region) => String(region.regionId ?? "")),
    String(data.claim.regionId ?? ""),
    ...data.regionStatus.map((region) => String(region.regionId ?? "")),
  ].filter(Boolean)).sort((a, b) => toNumber(a) - toNumber(b)), [activeRegions, data.claim.regionId, data.regionStatus]);
  const readyResourceRegionIds = React.useMemo(
    () => unique(mapResourceRegions.map((region) => String(region.regionId ?? "")).filter(Boolean)).sort((a, b) => toNumber(a) - toNumber(b)),
    [mapResourceRegions],
  );
  const regionOptions = React.useMemo(() => unique([
    ...readyResourceRegionIds,
    ...operationalRegionOptions,
  ].filter(Boolean)).sort((a, b) => toNumber(a) - toNumber(b)), [readyResourceRegionIds, operationalRegionOptions]);
  const normalizedRegionSelection = React.useMemo(
    () => normalizeNativeMapRegionSelection(resourceRegions, regionOptions),
    [resourceRegions.join(","), regionOptions.join(",")],
  );
  const mapMarker = focus ?? defaultFocus;
  const mapRegionIds = React.useMemo(() => boundedNativeMapRegions(normalizedRegionSelection, regionOptions), [normalizedRegionSelection.join(","), regionOptions.join(",")]);
  const readyPlayerRegionIds = React.useMemo(() => boundedNativeMapRegions([], readyResourceRegionIds, 16), [readyResourceRegionIds.join(",")]);
  const resourceMapRegionIds = React.useMemo(() => nativeMapResourceRegions(normalizedRegionSelection, readyResourceRegionIds), [normalizedRegionSelection.join(","), readyResourceRegionIds.join(",")]);
  const maxNativeResourceSelections = React.useMemo(() => nativeMapResourceSelectionLimit(resourceMapRegionIds), [resourceMapRegionIds.join(",")]);
  const selectedResourceIds = React.useMemo(() => {
    const resourceIds = normalizedSelectedResources.filter((token) => token.startsWith("resource:")).map((token) => token.slice("resource:".length));
    return resourceIds.slice(0, maxNativeResourceSelections);
  }, [maxNativeResourceSelections, normalizedSelectedResources]);
  const selectedResourceColours = React.useMemo(
    () => selectedResourceColourMap(selectedResourceIds, resourceByToken),
    [selectedResourceIds.join(","), resourceByToken],
  );
  const selectedEnemyIds = React.useMemo(() => normalizedSelectedResources.filter((token) => token.startsWith("enemy:")).map((token) => token.slice("enemy:".length)), [normalizedSelectedResources]);
  const currentPlayerIds = React.useMemo(() => [...current].sort(), [current]);
  const focusKey = focus ? `${focus.name}:${focus.locationX}:${focus.locationZ}` : "";
  React.useEffect(() => {
    if (focus) updateQueryState({ label: focus.name, x: String(focus.locationX), z: String(focus.locationZ), regionId: focus.regionId ?? null, mapName: null, mapX: null, mapZ: null });
  }, [focusKey]);
  const visibleResources = React.useMemo(() => {
    const query = resourceSearch.trim().toLowerCase();
    return resources.filter((resource) => {
      const name = String(resource.name ?? "");
      const tag = mapResourceCategory(resource);
      if (query && !`${name} ${tag}`.toLowerCase().includes(query)) return false;
      if (resourceTier !== "All" && String(resource.tier ?? "") !== resourceTier) return false;
      if (resourceCategory !== "All" && tag !== resourceCategory) return false;
      return true;
    }).sort((a, b) => {
      if (resourceCategory !== "All") return toNumber(a.tier) - toNumber(b.tier) || String(a.name).localeCompare(String(b.name));
      return toNumber(a.mapSortOrder) - toNumber(b.mapSortOrder) || String(a.name).localeCompare(String(b.name));
    });
  }, [resources, resourceSearch, resourceTier, resourceCategory]);
  React.useEffect(() => {
    setResourceVisibleLimit(RESOURCE_FINDER_BATCH_SIZE);
  }, [resourceSearch, resourceTier, resourceCategory]);
  const renderedResources = React.useMemo(
    () => visibleResourceMatches(visibleResources, resourceVisibleLimit),
    [visibleResources, resourceVisibleLimit],
  );
  const resourceRegionOptions = React.useMemo(() => regionOptions.map((id) => {
    const region = mapResourceRegions.find((entry) => String(entry.regionId) === String(id)) ?? activeRegions.find((entry) => String(entry.regionId) === String(id)) ?? data.regionStatus.find((entry) => String(entry.regionId) === String(id)) ?? { regionId: id };
    return { id, label: activeRegionLabel({ ...region, regionId: String(region.regionId ?? id) }, String(data.claim.regionId ?? "")) };
  }), [regionOptions, mapResourceRegions, activeRegions, data.regionStatus, data.claim.regionId]);
  const resourceRegionValue = normalizedRegionSelection.length === 1 ? normalizedRegionSelection[0] : "All";
  function setResourceRegion(value: string) {
    setResourceRegions(value === "All" ? [] : [value]);
  }
  function setManualPlayers(ids: string[]) {
    setSelectedIds([...new Set(ids.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  }
  function trackOnlinePlayers() {
    setManualPlayers(defaultMapPlayerSelection(roster));
  }
  function trackAllPlayers() {
    setManualPlayers(roster.map(mapPlayerTrackingId));
  }
  function trackNoPlayers() {
    setSelectedIds([]);
  }
  function togglePlayerTracking(id: string, tracked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev === null ? defaultMapPlayerSelection(roster) : prev.filter(Boolean));
      if (tracked) next.add(id);
      else next.delete(id);
      return [...next].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    });
  }
  function toggleResource(token: string) {
    const normalizedToken = normalizeMapResourceToken(token);
    setSelectedResources((prev) => {
      const next = new Set(prev.map(normalizeMapResourceToken).filter(Boolean));
      const selectedResourceCount = [...next].filter((value) => value.startsWith("resource:")).length;
      if (next.has(normalizedToken)) next.delete(normalizedToken);
      else if (normalizedToken.startsWith("resource:") && !next.has(normalizedToken) && selectedResourceCount >= maxNativeResourceSelections) return [...next];
      else next.add(normalizedToken);
      return [...next].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    });
  }
  const trackedPlayerCount = new Set([...current, ...externalPlayers.map((player) => player.playerId)]).size;
  const playerPanel = <MapPlayerTrackingPanel
    roster={roster}
    selectedIds={selectedIds}
    current={current}
    externalPlayers={externalPlayers}
    onAutoOnline={() => setSelectedIds(null)}
    onTrackOnline={trackOnlinePlayers}
    onTrackAll={trackAllPlayers}
    onTrackNone={trackNoPlayers}
    onTogglePlayer={togglePlayerTracking}
    onRemoveExternal={(playerId) => setExternalPlayers((players) => players.filter((player) => player.playerId !== playerId))}
    onClearExternal={() => setExternalPlayers([])}
  />;
  const resourceFinder = <MapResourceFinderPanel
    search={resourceSearch}
    tier={resourceTier}
    category={resourceCategory}
    tiers={resourceTiers}
    categories={resourceCategories}
    selectedTokens={normalizedSelectedResources}
    resourceByToken={resourceByToken}
    resourceColours={selectedResourceColours}
    resources={renderedResources}
    visibleCount={visibleResources.length}
    catalogCount={resources.length}
    catalogLoaded={resourceCatalogLoaded}
    error={resourceError}
    notice={resourceNotice}
    onSearchChange={setResourceSearch}
    onTierChange={setResourceTier}
    onCategoryChange={setResourceCategory}
    onToggle={toggleResource}
    onRemove={toggleResource}
    onClear={() => setSelectedResources([])}
    onShowMore={() => setResourceVisibleLimit((current) => nextResourceLimit(current, visibleResources.length))}
  />;
  const regionControl = <MapRegionSelect value={resourceRegionValue} options={resourceRegionOptions} onChange={setResourceRegion} />;
  return (
    <div className={`panel map-panel full-height has-native-tools ${focus && !dedicated ? "has-focus" : ""} ${dedicated ? "is-dedicated" : ""}`}>
      {!dedicated && focus ? (
        <div className="map-focus">
          <MapPin size={17} />
          <div><strong>{focus.name}</strong><span>{focus.locationX}, {focus.locationZ}</span></div>
          <button className="mini-action" onClick={onClearFocus}>Clear</button>
        </div>
      ) : null}
      <div className="map-workspace native-tools">
        <div className="native-map-host">
          <NativeMap regionIds={mapRegionIds} visibleRegionIds={normalizedRegionSelection} playerRegionIds={readyPlayerRegionIds} resourceRegionIds={resourceMapRegionIds} playerIds={currentPlayerIds} resourceIds={selectedResourceIds} resourceColours={selectedResourceColours} enemyTypes={selectedEnemyIds} focus={mapMarker} playerTool={{ label: "Players", count: trackedPlayerCount, content: playerPanel, primaryFocusSelector: "input[placeholder='Find settlement members']" }} resourceTool={{ label: "Resources", count: normalizedSelectedResources.length, content: resourceFinder, primaryFocusSelector: ".map-resource-finder-search input" }} regionControl={regionControl} />
          {!dedicated ? (
            <a
              className="map-dedicated-tab-link"
              href={dedicatedMapHref(window.location.href)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open map in dedicated tab"
              title="Open map in dedicated tab"
            >
              <Maximize2 size={17} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

