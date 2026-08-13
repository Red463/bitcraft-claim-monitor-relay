import { securityHeaders } from "./httpRoutes.mjs";

const TILE_PREFIX = "/api/local/map/tiles/";
const TILE_PATH = /^\/api\/local\/map\/tiles\/(terrain|water|game|roads|biome-(\d{1,3}))\/(-?\d+)\/(-?\d+)\/(-?\d+)\.webp$/;
const MIN_ZOOM = -5;
const MAX_ZOOM = 0;
const MAX_TILE_INDEX = 1_000_000;
const TERRAIN_FRESH_MS = 8 * 24 * 60 * 60_000;
const ROADS_FRESH_MS = 36 * 60 * 60_000;
const EMPTY_CHANNELS = Object.freeze({
  terrain: Object.freeze({ tileCount: 0, totalBytes: 0 }),
  water: Object.freeze({ tileCount: 0, totalBytes: 0 }),
  biomeMasks: Object.freeze({ tileCount: 0, totalBytes: 0 }),
});
const PUBLIC_WATER_TYPES = new Set(["lake", "river", "ocean", "ocean-biome", "swamp"]);

function publicWaterTypes(manifest) {
  return [...new Set(manifest?.waterTypes ?? [])]
    .filter((waterType) => typeof waterType === "string" && PUBLIC_WATER_TYPES.has(waterType))
    .sort();
}

function publicBiomes(manifest) {
  return [...(manifest?.biomes ?? [])].map((biome) => ({
    biomeType: Number(biome.biomeType),
    name: String(biome.name),
    description: String(biome.description ?? ""),
    hazardLevel: String(biome.hazardLevel ?? ""),
    disallowPlayerBuild: Boolean(biome.disallowPlayerBuild),
    present: Boolean(biome.present),
  })).filter(({ biomeType, name }) => Number.isInteger(biomeType) && biomeType >= 0 && biomeType <= 255 && name.trim())
    .sort((left, right) => left.biomeType - right.biomeType);
}

function publicChannels(manifest) {
  return Object.fromEntries(["terrain", "water", "biomeMasks"].map((key) => [key, {
    tileCount: Number(manifest?.channels?.[key]?.tileCount ?? 0),
    totalBytes: Number(manifest?.channels?.[key]?.totalBytes ?? 0),
  }]));
}

function finish(res, status, body = null, headers = {}) {
  res.writeHead(status, securityHeaders(headers));
  res.end(body);
}

async function terrainStatus(tileStore, now, runtimeHealth, roadTileStore) {
  const manifest = typeof tileStore?.readManifest === "function" ? await tileStore.readManifest() : null;
  const roadManifest = typeof roadTileStore?.readManifest === "function" ? await roadTileStore.readManifest() : null;
  const nowMs = now().getTime();
  const roadObservedTime = Date.parse(roadManifest?.observedAt ?? roadManifest?.generatedAt ?? "");
  const roadAgeMs = Number.isFinite(roadObservedTime) ? Math.max(0, nowMs - roadObservedTime) : null;
  const roadFreshness = roadManifest && roadAgeMs != null && roadAgeMs <= ROADS_FRESH_MS ? "live" : roadManifest ? "stale" : "unavailable";
  const roads = roadManifest ? {
    available: true,
    generation: String(roadManifest.generation),
    generatedAt: roadManifest.generatedAt ?? null,
    ageMs: roadAgeMs,
    freshness: roadFreshness,
    regionIds: Array.isArray(roadManifest.regionIds) ? roadManifest.regionIds.map(String) : [],
    tileCount: Number(roadManifest.tileCount ?? 0),
    totalBytes: Number(roadManifest.totalBytes ?? 0),
    featureCount: Number(roadManifest.featureCount ?? 0),
    warnings: roadFreshness === "stale" ? ["Relay roads are stale; showing the last-good installed generation."] : [],
  } : { available: false, generation: null, generatedAt: null, ageMs: null, freshness: "unavailable", regionIds: [], tileCount: 0, totalBytes: 0, featureCount: 0, warnings: [] };
  const roadStatus = roadTileStore ? { roads } : {};
  const buildStage = String(runtimeHealth?.buildStage ?? "idle");
  const lastError = String(runtimeHealth?.lastError ?? "").trim().slice(0, 500);
  if (!manifest) return {
    provider: "relay", available: false, generation: null, generatedAt: null, observedAt: null,
    freshness: "unavailable", ageMs: null, regionIds: [], dimension: "1", bounds: null,
    zoomRange: { min: MIN_ZOOM, max: MAX_ZOOM }, paletteVersion: null, tileCount: 0, totalBytes: 0,
    biomes: [], waterTypes: [], channels: EMPTY_CHANNELS,
    buildStage,
    warnings: [buildStage === "building"
      ? "Relay terrain is building its first complete tile bundle."
      : buildStage === "error" && lastError
        ? `Relay terrain is unavailable: ${lastError}`
        : "Relay terrain has not been installed yet."], ...roadStatus,
  };
  const observedTime = Date.parse(manifest.observedAt ?? manifest.generatedAt ?? "");
  const ageMs = Number.isFinite(observedTime) ? Math.max(0, nowMs - observedTime) : null;
  const freshness = ageMs != null && ageMs <= TERRAIN_FRESH_MS ? "live" : "stale";
  return {
    provider: "relay", available: true, generation: String(manifest.generation),
    generatedAt: manifest.generatedAt ?? null, observedAt: manifest.observedAt ?? null,
    freshness, ageMs, regionIds: Array.isArray(manifest.regionIds) ? manifest.regionIds.map(String) : [],
    dimension: "1", bounds: manifest.bounds ?? null, zoomRange: manifest.zoomRange ?? { min: MIN_ZOOM, max: MAX_ZOOM },
    paletteVersion: manifest.paletteVersion ?? null, tileCount: Number(manifest.tileCount ?? 0), totalBytes: Number(manifest.totalBytes ?? 0), buildStage,
    biomes: publicBiomes(manifest), waterTypes: publicWaterTypes(manifest), channels: publicChannels(manifest),
    warnings: freshness === "stale" ? ["Relay terrain is stale; showing the last-good installed generation."] : [], ...roadStatus,
  };
}

export async function serveLocalMapTile(pathname, res, tileStore, now = () => new Date(), runtimeHealth = null, roadTileStore = null) {
  if (!pathname.startsWith(TILE_PREFIX)) return false;
  if (pathname === "/api/local/map/tiles/status") {
    finish(res, 200, JSON.stringify(await terrainStatus(tileStore, now, runtimeHealth, roadTileStore)), {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    return true;
  }
  const match = TILE_PATH.exec(pathname);
  if (!match) {
    finish(res, 400, null, { "cache-control": "no-store" });
    return true;
  }
  const [, style, rawBiomeType, rawZoom, rawX, rawY] = match;
  const biomeType = rawBiomeType == null ? null : Number(rawBiomeType);
  const zoom = Number(rawZoom);
  const x = Number(rawX);
  const y = Number(rawY);
  if ((biomeType != null && (biomeType < 0 || biomeType > 255)) || zoom < MIN_ZOOM || zoom > MAX_ZOOM || Math.abs(x) > MAX_TILE_INDEX || Math.abs(y) > MAX_TILE_INDEX) {
    finish(res, 400, null, { "cache-control": "no-store" });
    return true;
  }
  const selectedStore = style === "roads" ? roadTileStore : tileStore;
  const tile = typeof selectedStore?.readTile === "function" ? await selectedStore.readTile({ style, z: zoom, x, y }) : null;
  if (tile) {
    if (tile.bytes.byteLength > 2 * 1024 * 1024) throw new RangeError("Installed map tile exceeds response budget");
    finish(res, 200, tile.bytes, {
      "content-type": tile.contentType,
      "cache-control": "public, max-age=31536000, immutable",
    });
  } else {
    finish(res, 404, null, { "cache-control": "public, max-age=60" });
  }
  return true;
}
