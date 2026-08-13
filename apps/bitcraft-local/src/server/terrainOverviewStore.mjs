import { readdir } from "node:fs/promises";
import path from "node:path";

import { createTerrainTileStore } from "./terrainTileStore.mjs";
import { canonicalMapRegionIds } from "./mapRegionIds.mjs";

function unionBounds(manifests) {
  const bounds = manifests.map((manifest) => manifest?.bounds).filter(Boolean);
  return bounds.length ? {
    minX: Math.min(...bounds.map(({ minX }) => minX)),
    minZ: Math.min(...bounds.map(({ minZ }) => minZ)),
    maxX: Math.max(...bounds.map(({ maxX }) => maxX)),
    maxZ: Math.max(...bounds.map(({ maxZ }) => maxZ)),
  } : null;
}

function mergeBiomes(manifests) {
  const merged = new Map();
  for (const manifest of manifests) for (const biome of manifest?.biomes ?? []) {
    const biomeType = Number(biome.biomeType);
    if (!Number.isInteger(biomeType) || biomeType < 0 || biomeType > 255) continue;
    const previous = merged.get(biomeType);
    merged.set(biomeType, { ...(previous ?? {}), ...biome, biomeType, present: Boolean(previous?.present || biome.present) });
  }
  return [...merged.values()].sort((left, right) => left.biomeType - right.biomeType);
}

function mergeChannels(manifests) {
  const result = {};
  for (const key of ["terrain", "water", "biomeMasks"]) result[key] = {
    tileCount: manifests.reduce((total, manifest) => total + Number(manifest?.channels?.[key]?.tileCount ?? 0), 0),
    totalBytes: manifests.reduce((total, manifest) => total + Number(manifest?.channels?.[key]?.totalBytes ?? 0), 0),
  };
  return result;
}

function mergeWaterTypes(manifests) {
  return [...new Set(manifests.flatMap((manifest) => manifest?.waterTypes ?? []))].sort();
}

// Legacy overview batches are metadata/import sources only. Runtime tile requests
// must use the precomposed full-world pack installed in the primary terrain store.
export function createTerrainOverviewStore({ dataDir }) {
  const batchesRoot = path.resolve(dataDir, "map-overview");
  let stores;
  async function loadStores() {
    if (stores) return stores;
    let entries = [];
    try {
      entries = await readdir(batchesRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    stores = entries
      .filter((entry) => entry.isDirectory() && /^batch-\d+$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
      .map((entry) => ({
        root: path.join(batchesRoot, entry.name),
        store: createTerrainTileStore({
          dataDir: path.join(batchesRoot, entry.name),
          encoder: async () => { throw new Error("Overview compatibility store is read-only"); },
        }),
      }));
    return stores;
  }
  return {
    async readManifest() {
      const manifests = (await Promise.all((await loadStores()).map(({ store }) => store.readManifest()))).filter(Boolean);
      if (!manifests.length) return null;
      const generatedAt = manifests.map(({ generatedAt: value }) => value).filter(Boolean).sort().at(-1) ?? null;
      return {
        provider: "relay",
        generation: String(Date.parse(generatedAt ?? "") || 1),
        generatedAt,
        observedAt: manifests.map(({ observedAt }) => observedAt).filter(Boolean).sort().at(0) ?? null,
        regionIds: canonicalMapRegionIds(manifests.flatMap(({ regionIds = [] }) => regionIds)),
        dimension: "1",
        bounds: unionBounds(manifests),
        zoomRange: { min: -5, max: -2 },
        paletteVersion: manifests[0].paletteVersion ?? null,
        tileCount: manifests.reduce((total, value) => total + Number(value.tileCount ?? 0), 0),
        totalBytes: manifests.reduce((total, value) => total + Number(value.totalBytes ?? 0), 0),
        biomes: mergeBiomes(manifests),
        waterTypes: mergeWaterTypes(manifests),
        channels: mergeChannels(manifests),
      };
    },
    async batchRoots() {
      return (await loadStores()).map(({ root }) => root);
    },
    async readTile() {
      return null;
    },
    async close() {
      await Promise.all((await loadStores()).map(({ store }) => store.close()));
    },
  };
}

// Kept as a compatibility export for callers compiled against the earlier seam.
// It intentionally delegates to one precomposed store and never reads both stores.
export function createLayeredTerrainTileStore({ detailStore, overviewStore }) {
  const precomposedStore = detailStore ?? overviewStore;
  return {
    readManifest() {
      return precomposedStore.readManifest();
    },
    readTile(request) {
      return precomposedStore.readTile(request);
    },
    close() {
      return precomposedStore.close?.();
    },
  };
}
