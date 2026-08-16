import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { isExecutedMainModule } from "../apps/bitcraft-local/src/server/executedMainModule.mjs";

export const RELAY_BUILD_OUTPUTS = Object.freeze([
  Object.freeze({ relativePath: "apps/bitcraft-local/dist", required: true }),
  Object.freeze({ relativePath: "apps/bitcraft-local/dist-server", required: true }),
  Object.freeze({ relativePath: "apps/bitcraft-local/dist-bindings", required: false }),
]);

const REVISION = /^[a-f0-9]{40}$/;

export async function hashRegularFile(filePath) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.byteLength;
    hash.update(chunk);
  }
  return { bytes, sha256: hash.digest("hex") };
}

export async function listRegularFiles(root, relative = "") {
  const current = relative ? path.join(root, ...relative.split("/")) : root;
  const metadata = await lstat(current);
  if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
    throw new Error("Relay build contains a non-regular filesystem entry");
  }
  if (metadata.isFile()) return [relative];
  const files = [];
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
      throw new Error("Relay build contains a non-regular filesystem entry");
    }
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    files.push(...await listRegularFiles(root, child));
  }
  return files;
}

export async function copyRegularBuildFile(sourceRoot, outputRoot, relativePath) {
  const source = path.join(sourceRoot, ...relativePath.split("/"));
  const destination = path.join(outputRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export async function packageRelayBuild({ repositoryRoot, revision, outputDir }) {
  if (!REVISION.test(revision ?? "")) throw new TypeError("Relay build revision must be a full lowercase commit SHA");
  const sourceRoot = path.resolve(repositoryRoot);
  const artifactRoot = path.resolve(outputDir);
  if (artifactRoot === sourceRoot || artifactRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new TypeError("Relay build artifact output must be outside the repository");
  }
  await mkdir(artifactRoot);

  const files = [];
  for (const output of RELAY_BUILD_OUTPUTS) {
    let outputFiles;
    try {
      outputFiles = await listRegularFiles(sourceRoot, output.relativePath);
    } catch (error) {
      if (!output.required && error?.code === "ENOENT") continue;
      if (error?.code === "ENOENT") throw new Error(`Relay build is missing required output ${output.relativePath}`);
      throw error;
    }
    if (output.required && !outputFiles.length) throw new Error(`Relay build output ${output.relativePath} is empty`);
    for (const relativePath of outputFiles.sort()) {
      const digest = await hashRegularFile(path.join(sourceRoot, ...relativePath.split("/")));
      await copyRegularBuildFile(sourceRoot, artifactRoot, relativePath);
      files.push({ path: relativePath, ...digest });
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest = { formatVersion: 1, revision, files };
  await writeFile(path.join(artifactRoot, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { revision, fileCount: files.length };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (isExecutedMainModule(import.meta.url)) {
  packageRelayBuild({
    repositoryRoot: argument("--repository-root"),
    revision: argument("--revision"),
    outputDir: argument("--output-dir"),
  }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
