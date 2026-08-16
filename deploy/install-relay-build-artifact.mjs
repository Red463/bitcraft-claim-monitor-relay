import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { isExecutedMainModule } from "../apps/bitcraft-local/src/server/executedMainModule.mjs";
import {
  copyRegularBuildFile,
  hashRegularFile,
  listRegularFiles,
  RELAY_BUILD_OUTPUTS,
} from "../scripts/package-relay-build.mjs";

const REVISION = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const allowedPrefixes = RELAY_BUILD_OUTPUTS.map(({ relativePath }) => `${relativePath}/`);

function safeBuildPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !value.includes("\\")
    && !/(^|\/)\.\.(\/|$)/.test(value)
    && allowedPrefixes.some((prefix) => value.startsWith(prefix));
}

async function readVerifiedManifest(sourceRoot, revision) {
  const text = await readFile(path.join(sourceRoot, "build-manifest.json"), "utf8");
  const manifest = JSON.parse(text);
  if (manifest?.formatVersion !== 1 || manifest?.revision !== revision || !REVISION.test(manifest?.revision ?? "")) {
    throw new Error("Relay build artifact revision does not match the candidate release");
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Relay build artifact has no files");
  const files = manifest.files.map((file) => {
    if (!safeBuildPath(file?.path) || !Number.isSafeInteger(file?.bytes) || file.bytes < 0 || !SHA256.test(file?.sha256 ?? "")) {
      throw new Error("Relay build artifact manifest contains an invalid or unallowed file");
    }
    return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) throw new Error("Relay build artifact manifest contains duplicate files");
  for (const output of RELAY_BUILD_OUTPUTS.filter(({ required }) => required)) {
    if (!files.some((file) => file.path.startsWith(`${output.relativePath}/`))) {
      throw new Error(`Relay build artifact is missing required output ${output.relativePath}`);
    }
  }
  return files;
}

export async function installRelayBuildArtifact({ sourceRoot, releaseDir, revision }) {
  if (!REVISION.test(revision ?? "")) throw new TypeError("Relay build revision must be a full lowercase commit SHA");
  const source = path.resolve(sourceRoot);
  const release = path.resolve(releaseDir);
  if (source === release) throw new TypeError("Relay build source and candidate release must differ");

  const files = await readVerifiedManifest(source, revision);
  const actualFiles = (await listRegularFiles(source)).sort();
  const expectedFiles = ["build-manifest.json", ...files.map((file) => file.path)].sort();
  if (actualFiles.length !== expectedFiles.length || actualFiles.some((file, index) => file !== expectedFiles[index])) {
    throw new Error("Relay build artifact contains an unexpected or unallowed file");
  }
  for (const file of files) {
    const digest = await hashRegularFile(path.join(source, ...file.path.split("/")));
    if (digest.bytes !== file.bytes || digest.sha256 !== file.sha256) {
      throw new Error(`Relay build artifact byte count or hash differs for ${file.path}`);
    }
  }

  await mkdir(release, { recursive: true });
  const staging = path.join(release, `.build-artifact-stage-${process.pid}-${Date.now()}`);
  try {
    await mkdir(staging);
    for (const file of files) await copyRegularBuildFile(source, staging, file.path);
    for (const output of RELAY_BUILD_OUTPUTS) {
      if (!files.some((file) => file.path.startsWith(`${output.relativePath}/`))) continue;
      const stagedOutput = path.join(staging, ...output.relativePath.split("/"));
      const installedOutput = path.join(release, ...output.relativePath.split("/"));
      await rm(installedOutput, { recursive: true, force: true });
      await mkdir(path.dirname(installedOutput), { recursive: true });
      await rename(stagedOutput, installedOutput);
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return { revision, fileCount: files.length };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (isExecutedMainModule(import.meta.url)) {
  installRelayBuildArtifact({
    sourceRoot: argument("--source-root"),
    releaseDir: argument("--release-dir"),
    revision: argument("--revision"),
  }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
