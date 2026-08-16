import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { installRelayBuildArtifact } from "../../deploy/install-relay-build-artifact.mjs";
import { packageRelayBuild } from "../package-relay-build.mjs";

const REVISION = "1".repeat(40);

async function createBuild(root) {
  await mkdir(path.join(root, "apps", "bitcraft-local", "dist"), { recursive: true });
  await mkdir(path.join(root, "apps", "bitcraft-local", "dist-server", "game-data"), { recursive: true });
  await writeFile(path.join(root, "apps", "bitcraft-local", "dist", "index.html"), "verified frontend");
  await writeFile(path.join(root, "apps", "bitcraft-local", "dist-server", "game-data", "index.js"), "export const verified = true;\n");
}

test("revision-bound frontend and server outputs install into the candidate release", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-build-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const artifact = path.join(root, "artifact");
  const release = path.join(root, "release");
  await createBuild(repository);
  await mkdir(release);

  const packaged = await packageRelayBuild({ repositoryRoot: repository, revision: REVISION, outputDir: artifact });
  const installed = await installRelayBuildArtifact({ sourceRoot: artifact, releaseDir: release, revision: REVISION });

  assert.equal(packaged.revision, REVISION);
  assert.equal(installed.fileCount, 2);
  assert.equal(await readFile(path.join(release, "apps", "bitcraft-local", "dist", "index.html"), "utf8"), "verified frontend");
  assert.match(await readFile(path.join(release, "apps", "bitcraft-local", "dist-server", "game-data", "index.js"), "utf8"), /verified/);
});

test("revision mismatch and unexpected artifact paths fail before release outputs change", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-build-reject-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository");
  const artifact = path.join(root, "artifact");
  const release = path.join(root, "release");
  await createBuild(repository);
  await mkdir(path.join(release, "apps", "bitcraft-local", "dist"), { recursive: true });
  await writeFile(path.join(release, "apps", "bitcraft-local", "dist", "index.html"), "last good");
  await packageRelayBuild({ repositoryRoot: repository, revision: REVISION, outputDir: artifact });

  await assert.rejects(
    () => installRelayBuildArtifact({ sourceRoot: artifact, releaseDir: release, revision: "2".repeat(40) }),
    /revision/i,
  );
  await writeFile(path.join(artifact, "unexpected.txt"), "not allowed");
  await assert.rejects(
    () => installRelayBuildArtifact({ sourceRoot: artifact, releaseDir: release, revision: REVISION }),
    /unexpected|allow/i,
  );
  assert.equal(await readFile(path.join(release, "apps", "bitcraft-local", "dist", "index.html"), "utf8"), "last good");
});

test("missing outputs and changed bytes are rejected", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-build-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = path.join(root, "missing");
  await mkdir(missing);
  await assert.rejects(
    () => packageRelayBuild({ repositoryRoot: missing, revision: REVISION, outputDir: path.join(root, "missing-artifact") }),
    /dist/i,
  );

  const repository = path.join(root, "repository");
  const artifact = path.join(root, "artifact");
  await createBuild(repository);
  await packageRelayBuild({ repositoryRoot: repository, revision: REVISION, outputDir: artifact });
  await writeFile(path.join(artifact, "apps", "bitcraft-local", "dist", "index.html"), "changed");
  await assert.rejects(
    () => installRelayBuildArtifact({ sourceRoot: artifact, releaseDir: path.join(root, "release"), revision: REVISION }),
    /hash|byte/i,
  );
});

test("symlinks are rejected from packaged build outputs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-build-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const symlinkRepository = path.join(root, "symlink-repository");
  await createBuild(symlinkRepository);
  try {
    await symlink("index.html", path.join(symlinkRepository, "apps", "bitcraft-local", "dist", "linked.html"));
  } catch (error) {
    if (error?.code === "EPERM") return t.skip("Windows symlink creation is unavailable");
    throw error;
  }
  await assert.rejects(
    () => packageRelayBuild({ repositoryRoot: symlinkRepository, revision: REVISION, outputDir: path.join(root, "symlink-artifact") }),
    /non-regular|symbolic/i,
  );
});
