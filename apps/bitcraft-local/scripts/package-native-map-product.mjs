import { copyFile, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { isExecutedMainModule } from "../src/server/executedMainModule.mjs";
import { verifyNativeMapPack } from "./verify-native-map-pack.mjs";

const VERSION = /^[A-Za-z0-9._-]+$/;
const MANIFEST_HASH = /^[a-f0-9]{64}$/;

const PRODUCTS = Object.freeze({
  terrain: Object.freeze({
    directory: "map-tiles",
    allowedStyles: Object.freeze(["terrain", "water", ...Array.from({ length: 256 }, (_, biomeType) => `biome-${biomeType}`)]),
  }),
  roads: Object.freeze({ directory: "map-road-tiles", allowedStyles: Object.freeze(["roads"]) }),
});

export function nativeMapProductDefinition(product) {
  const definition = PRODUCTS[product];
  if (!definition) throw new TypeError("Native map pack product must be terrain or roads");
  return definition;
}

export async function readNativeMapProductPointer(dataDir, product) {
  const definition = nativeMapProductDefinition(product);
  const productRoot = path.join(path.resolve(dataDir), definition.directory);
  const pointer = JSON.parse(await readFile(path.join(productRoot, "current.json"), "utf8"));
  if (!VERSION.test(pointer?.version ?? "") || !MANIFEST_HASH.test(pointer?.manifestHash ?? "") || !/^\d+$/.test(String(pointer?.generation ?? ""))) {
    throw new Error(`Native map ${product} has no readable installed pointer`);
  }
  return Object.freeze({
    definition,
    productRoot,
    version: pointer.version,
    generation: String(pointer.generation),
    manifestHash: pointer.manifestHash,
  });
}

export async function copyRegularTree(source, destination) {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
    throw new Error("Native map product contains a non-regular filesystem entry");
  }
  if (metadata.isFile()) {
    await copyFile(source, destination);
    return;
  }
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error("Native map product contains a non-regular filesystem entry");
    }
    await copyRegularTree(path.join(source, entry.name), path.join(destination, entry.name));
  }
}

export async function packageNativeMapProduct({ dataDir, product, outputDir }) {
  if (!dataDir || !outputDir) throw new TypeError("Native map product packaging requires data and output directories");
  const manifest = await verifyNativeMapPack({ dataDir, product });
  const pointer = await readNativeMapProductPointer(dataDir, product);
  if (String(manifest.generation) !== pointer.generation) throw new Error(`Native map ${product} pointer generation does not match its manifest`);

  const outputRoot = path.resolve(outputDir);
  const sourceRoot = path.resolve(dataDir);
  if (outputRoot === sourceRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new TypeError("Native map product output must be outside its source data directory");
  }
  await mkdir(outputRoot);
  const packagedProductRoot = path.join(outputRoot, pointer.definition.directory);
  await mkdir(path.join(packagedProductRoot, "versions"), { recursive: true });
  await copyRegularTree(
    path.join(pointer.productRoot, "versions", pointer.version),
    path.join(packagedProductRoot, "versions", pointer.version),
  );
  await copyRegularTree(path.join(pointer.productRoot, "current.json"), path.join(packagedProductRoot, "current.json"));
  await verifyNativeMapPack({ dataDir: outputRoot, product });
  return {
    product,
    directory: pointer.definition.directory,
    version: pointer.version,
    manifestHash: pointer.manifestHash,
    generation: pointer.generation,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (isExecutedMainModule(import.meta.url)) {
  packageNativeMapProduct({
    dataDir: argument("--data-dir"),
    product: argument("--product"),
    outputDir: argument("--output-dir"),
  }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
