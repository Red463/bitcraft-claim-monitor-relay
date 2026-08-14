import path from "node:path";

import { createMapTilePackStore } from "../src/server/mapTilePackStore.mjs";
import { isExecutedMainModule } from "../src/server/executedMainModule.mjs";

const PRODUCTS = Object.freeze({
  terrain: { directory: "map-tiles", allowedStyles: ["terrain", "water", ...Array.from({ length: 256 }, (_, biomeType) => `biome-${biomeType}`)], sampleStyles: ["terrain", "water"] },
  roads: { directory: "map-road-tiles", allowedStyles: ["roads"], sampleStyles: ["roads"] },
});

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

export async function verifyNativeMapPack({ dataDir, product }) {
  const definition = PRODUCTS[product];
  if (!definition) throw new TypeError("Native map pack product must be terrain or roads");
  const store = createMapTilePackStore({ root: path.join(path.resolve(dataDir), definition.directory), allowedStyles: definition.allowedStyles });
  let manifest;
  try {
    manifest = await store.readManifest();
    if (!manifest) throw new Error(`Native map ${product} has no readable installed pointer`);
    for (const style of definition.sampleStyles) {
      const sample = manifest.files?.find((file) => typeof file?.path === "string" && file.path.startsWith(`tiles/${style}/`));
      const match = /^tiles\/[^/]+\/(-?\d+)\/(-?\d+)\/(-?\d+)\.webp$/.exec(sample?.path ?? "");
      if (!match) throw new Error(`Native map ${product} has no readable ${style} tile sample`);
      const tile = await store.readTile({ style, z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) });
      if (!tile?.bytes?.byteLength) throw new Error(`Native map ${product} cannot read its ${style} tile sample`);
    }
  } finally {
    await store.close();
  }
  if (!manifest || manifest.product !== product) throw new Error(`Native map ${product} pointer has no matching manifest`);
  if (!/^\d+$/.test(String(manifest.generation ?? ""))) throw new Error(`Native map ${product} generation is invalid`);
  if (!Array.isArray(manifest.regionIds) || !manifest.regionIds.length || manifest.regionIds.some((value) => !/^\d+$/.test(String(value)))) {
    throw new Error(`Native map ${product} has no verified regions`);
  }
  if (String(manifest.dimension) !== "1") throw new Error(`Native map ${product} is not overworld dimension 1`);
  if (Number(manifest.zoomRange?.min) !== -5 || Number(manifest.zoomRange?.max) !== 0) {
    throw new Error(`Native map ${product} must cover zoom -5 through 0`);
  }
  positiveInteger(manifest.tileCount, `Native map ${product} tile count`);
  positiveInteger(manifest.totalBytes, `Native map ${product} byte total`);
  if (!Array.isArray(manifest.files) || manifest.files.length !== manifest.tileCount) throw new Error(`Native map ${product} file count is incomplete`);
  if (product === "terrain") {
    positiveInteger(manifest.channels?.terrain?.tileCount, "Native map terrain channel count");
    positiveInteger(manifest.channels?.water?.tileCount, "Native map water channel count");
  } else {
    positiveInteger(manifest.featureCount, "Native map road feature count");
    if (manifest.joinVersion !== "paved-location-overworld-v1") throw new Error("Native map roads have no verified join version");
  }
  return manifest;
}

function sampleTileUrl(baseUrl, manifest, style) {
  const sample = manifest.files.find((file) => typeof file?.path === "string" && file.path.startsWith(`tiles/${style}/`));
  const match = /^tiles\/[^/]+\/(-?\d+)\/(-?\d+)\/(-?\d+)\.webp$/.exec(sample?.path ?? "");
  if (!match) throw new Error(`Native map has no ${style} tile sample`);
  return `${String(baseUrl).replace(/\/+$/, "")}/api/local/map/tiles/${style}/${match[1]}/${match[2]}/${match[3]}.webp?generation=${encodeURIComponent(manifest.generation)}`;
}

export async function verifyNativeMapServing({ dataDir, baseUrl, fetchImpl = fetch, attempts = 20, delayMs = 500, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) }) {
  const terrain = await verifyNativeMapPack({ dataDir, product: "terrain" });
  const roads = await verifyNativeMapPack({ dataDir, product: "roads" });
  let status = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/api/local/map/tiles/status`, { headers: { accept: "application/json" } });
    if (response.ok) status = await response.json();
    if (status?.available && status?.roads?.available
      && String(status.generation) === String(terrain.generation)
      && String(status.roads.generation) === String(roads.generation)) break;
    status = null;
    if (attempt + 1 < attempts) await sleep(delayMs);
  }
  if (!status) throw new Error("Native map packs are installed but unavailable from the local web service");
  for (const [manifest, style] of [[terrain, "terrain"], [terrain, "water"], [roads, "roads"]]) {
    const response = await fetchImpl(sampleTileUrl(baseUrl, manifest, style));
    const bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
    if (!response.ok || !String(response.headers.get("content-type") ?? "").startsWith("image/webp") || !bytes.byteLength) {
      throw new Error(`Native map ${style} sample is not served by the local web service`);
    }
  }
  return { terrain, roads };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (isExecutedMainModule(import.meta.url)) {
  const dataDir = argument("--data-dir");
  const baseUrl = argument("--serve-base-url");
  const operation = baseUrl
    ? verifyNativeMapServing({ dataDir, baseUrl }).then(({ terrain, roads }) => ({ product: "served", generation: terrain.generation, roadGeneration: roads.generation, regionCount: terrain.regionIds.length, tileCount: terrain.tileCount + roads.tileCount }))
    : verifyNativeMapPack({ dataDir, product: argument("--product") }).then((manifest) => ({ product: manifest.product, generation: manifest.generation, regionCount: manifest.regionIds.length, tileCount: manifest.tileCount }));
  operation
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
