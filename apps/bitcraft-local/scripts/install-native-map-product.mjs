import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { isExecutedMainModule } from "../src/server/executedMainModule.mjs";
import { createMapTilePackStore } from "../src/server/mapTilePackStore.mjs";
import {
  copyRegularTree,
  nativeMapProductDefinition,
  readNativeMapProductPointer,
} from "./package-native-map-product.mjs";
import { verifyNativeMapPack } from "./verify-native-map-pack.mjs";

export async function installNativeMapProduct({ sourceDataDir, dataDir, product }) {
  if (!sourceDataDir || !dataDir) throw new TypeError("Native map product installation requires source and destination data directories");
  const sourceRoot = path.resolve(sourceDataDir);
  const destinationRoot = path.resolve(dataDir);
  if (sourceRoot === destinationRoot) throw new TypeError("Native map product source and destination must differ");

  const manifest = await verifyNativeMapPack({ dataDir: sourceRoot, product });
  const pointer = await readNativeMapProductPointer(sourceRoot, product);
  const definition = nativeMapProductDefinition(product);
  if (String(manifest.generation) !== pointer.generation) throw new Error(`Native map ${product} pointer generation does not match its manifest`);

  const productRoot = path.join(destinationRoot, definition.directory);
  const staging = path.join(productRoot, `.staging-import-${process.pid}-${Date.now()}`);
  await mkdir(productRoot, { recursive: true });
  const store = createMapTilePackStore({ root: productRoot, allowedStyles: definition.allowedStyles });
  try {
    await copyRegularTree(path.join(pointer.productRoot, "versions", pointer.version), staging);
    const installed = await store.install({
      stagedVersionDir: staging,
      version: pointer.version,
      manifestHash: pointer.manifestHash,
    });
    await store.prune({ graceMs: 24 * 60 * 60 * 1000, keepGenerations: 2 });
    return {
      product,
      version: pointer.version,
      manifestHash: pointer.manifestHash,
      generation: String(installed.generation),
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
    await store.close();
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (isExecutedMainModule(import.meta.url)) {
  installNativeMapProduct({
    sourceDataDir: argument("--source-data-dir"),
    dataDir: argument("--data-dir"),
    product: argument("--product"),
  }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
