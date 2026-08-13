import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PRODUCTS = Object.freeze({ terrain: "map-tiles", roads: "map-road-tiles" });

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

export async function verifyNativeMapPack({ dataDir, product }) {
  const directory = PRODUCTS[product];
  if (!directory) throw new TypeError("Native map pack product must be terrain or roads");
  const pointer = JSON.parse(await readFile(path.join(path.resolve(dataDir), directory, "current.json"), "utf8"));
  const manifest = pointer?.manifest;
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

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyNativeMapPack({ dataDir: argument("--data-dir"), product: argument("--product") })
    .then((manifest) => process.stdout.write(`${JSON.stringify({ product: manifest.product, generation: manifest.generation, regionCount: manifest.regionIds.length, tileCount: manifest.tileCount })}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
