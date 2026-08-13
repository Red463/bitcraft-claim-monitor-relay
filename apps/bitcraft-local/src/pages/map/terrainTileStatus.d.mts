export type TerrainTileStatus = {
  provider: "relay";
  available: boolean;
  generation: string | null;
  generatedAt: string | null;
  observedAt: string | null;
  freshness: "live" | "stale" | "unavailable";
  ageMs: number | null;
  regionIds: string[];
  dimension: "1";
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  zoomRange: { min: number; max: number };
  paletteVersion: number | null;
  tileCount: number;
  totalBytes: number;
  buildStage: string;
  warnings: string[];
  biomes: TerrainBiomeStatus[];
  waterTypes: Array<"lake" | "river" | "ocean" | "ocean-biome" | "swamp">;
  channels: {
    terrain: { tileCount: number; totalBytes: number };
    water: { tileCount: number; totalBytes: number };
    biomeMasks: { tileCount: number; totalBytes: number };
  };
  roads?: {
    available: boolean;
    generation: string | null;
    generatedAt: string | null;
    ageMs: number | null;
    freshness: "live" | "stale" | "unavailable";
    regionIds: string[];
    tileCount: number;
    totalBytes: number;
    featureCount: number;
    warnings: string[];
  };
};

export type TerrainBiomeStatus = {
  biomeType: number;
  name: string;
  description: string;
  hazardLevel: string;
  disallowPlayerBuild: boolean;
  present: boolean;
};

export function loadTerrainTileStatus(signal?: AbortSignal): Promise<TerrainTileStatus>;
export function mapTileUrl(style: "terrain" | "water" | "roads", generation: string): string;
export function terrainTileUrl(generation: string): string;
export function biomeTileUrl(biomeType: number, generation: string): string;
