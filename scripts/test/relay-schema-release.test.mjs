import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRefresh, releaseMetadata, assertReleaseCandidate, assertMergeReady, validateAutomationConfig, reconcile } from "../relay-schema-release.mjs";

const manifestPath = "apps/bitcraft-local/src/server/game-data/bindings/schema-manifest.json";
const packagePath = "apps/bitcraft-local/package.json";
const manifest = () => ({ capturedAt: "2026-09-12T00:00:00.000Z", relayOrigin: "https://relay.bitcraftsync.app", codegen: { cliVersion: "2.7.0" }, schemas: Object.fromEntries(["global", "regional"].map(kind => [kind, { fingerprint: "a".repeat(64), schemaSha256: "a".repeat(64), databaseObserved: kind, generatedFileCount: 5, bindingsGenerated: true }])) });
const updated = () => { const m = manifest(); m.schemas.regional.fingerprint = m.schemas.regional.schemaSha256 = "b".repeat(64); m.capturedAt = "2026-09-16T00:00:00.000Z"; return m; };
const pkg = { name: "app", version: "0.66.2-beta.24", scripts: { test: "node --test" } };
const changelog = "# Changelog\n\n## [Unreleased]\n\n## [0.66.2-beta.24] - 2026-09-12\n\n### Fixed\n\n- Earlier fix.\n";
const base = "a".repeat(40), head = "b".repeat(40);

test("unattended releases require explicit deployment and monitored-scope configuration", () => {
  const env = { SCHEMA_APP_ORIGIN: "https://example.test", SCHEMA_CLAIM_ID: "1369094286777412590", SCHEMA_REGION_ID: "19", SCHEMA_REGION_IDS: "7,19" };
  assert.doesNotThrow(() => validateAutomationConfig(env));
  for (const change of [{ SCHEMA_REGION_IDS: "7" }, { SCHEMA_CLAIM_ID: "" }, { SCHEMA_APP_ORIGIN: "http://example.test" }, { SCHEMA_APP_ORIGIN: "https://user:secret@example.test" }]) assert.throws(() => validateAutomationConfig({ ...env, ...change }));
});

test("only a regenerated fingerprint-only manifest is eligible", () => {
  assert.equal(classifyRefresh([manifestPath], manifest(), updated()).eligible, true);
  for (const file of ["apps/bitcraft-local/src/server/game-data/bindings/regional/types.ts", ".github/workflows/verify.yml", "unknown.txt"]) {
    assert.equal(classifyRefresh([manifestPath, file], manifest(), updated()).eligible, false);
  }
  assert.equal(classifyRefresh([], manifest(), manifest()).eligible, false);
  for (const mutate of [m => m.codegen.cliVersion = "3", m => m.relayOrigin = "https://evil.example", m => m.schemas.regional.generatedFileCount++, m => m.schemas.regional.fingerprint = "c".repeat(64), m => m.schemas.extra = {}, m => m.capturedAt = "invalid"]) {
    const m = updated(); mutate(m);
    assert.equal(classifyRefresh([manifestPath], manifest(), m).eligible, false);
  }
});

test("release metadata increments only beta and preserves unreleased notes", () => {
  const result = releaseMetadata(pkg, changelog, "2026-09-16");
  assert.equal(result.package.version, "0.66.2-beta.25");
  assert.match(result.changelog, /## \[0\.66\.2-beta\.25\] - 2026-09-16/);
  assert.match(result.changelog, /Restored live settlement and map updates/);
  assert.ok(result.changelog.endsWith("- Earlier fix.\n"));
  assert.throws(() => releaseMetadata({ ...pkg, version: "1.0.0" }, changelog, "2026-09-16"), /beta/);
  assert.throws(() => releaseMetadata(pkg, changelog.replace("## [Unreleased]", "## [Unreleased]\n\n### Added\n- Pending unrelated feature."), "2026-09-16"), /unreleased/i);
});

test("candidate validation rejects package tampering and arbitrary changelog edits", () => {
  const release = releaseMetadata(pkg, changelog, "2026-09-16");
  const input = { files: [manifestPath, packagePath, "CHANGELOG.md"], beforeManifest: manifest(), afterManifest: updated(), beforePackage: pkg, afterPackage: release.package, beforeChangelog: changelog, afterChangelog: release.changelog };
  assert.doesNotThrow(() => assertReleaseCandidate(input));
  assert.throws(() => assertReleaseCandidate({ ...input, afterPackage: { ...release.package, scripts: {} } }), /package/);
  assert.throws(() => assertReleaseCandidate({ ...input, afterChangelog: release.changelog + "extra" }), /changelog/i);
  assert.throws(() => assertReleaseCandidate({ ...input, files: [...input.files, "server.mjs"] }), /files/i);
});

test("merge requires exact PR head/base, successful trusted Verify run and deployed baseline", () => {
  const state = { base, head, main: base, deployedSha: base.slice(0, 12), pr: { state: "open", draft: false, head: { sha: head, ref: "automation/relay-schema-bindings", repo: { full_name: "owner/repo" } }, base: { sha: base, ref: "main" } }, repository: "owner/repo", run: { head_sha: head, event: "pull_request", path: ".github/workflows/verify.yml", status: "completed", conclusion: "success" } };
  assert.doesNotThrow(() => assertMergeReady(state));
  for (const change of [{ main: head }, { deployedSha: "unknown" }, { run: { ...state.run, conclusion: "failure" } }, { run: { ...state.run, head_sha: base } }, { pr: { ...state.pr, head: { ...state.pr.head, sha: base } } }, { pr: { ...state.pr, base: { sha: head, ref: "main" } } }]) {
    assert.throws(() => assertMergeReady({ ...state, ...change }));
  }
});

test("real git CLI prepares and validates a release and rejects unrelated committed changes", t => {
  const root = mkdtempSync(path.join(tmpdir(), "relay-schema-release-test-"));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const script = fileURLToPath(new URL("../relay-schema-release.mjs", import.meta.url));
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "" } });
  git("init"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid"); git("config", "core.autocrlf", "false");
  mkdirSync(path.dirname(path.join(root, manifestPath)), { recursive: true });
  writeFileSync(path.join(root, manifestPath), JSON.stringify(manifest()));
  writeFileSync(path.join(root, packagePath), JSON.stringify(pkg));
  writeFileSync(path.join(root, "CHANGELOG.md"), changelog);
  git("add", "."); git("commit", "-m", "baseline");
  const baseline = git("rev-parse", "HEAD");
  writeFileSync(path.join(root, manifestPath), JSON.stringify(updated()));
  const prepared = cli("prepare");
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(root, packagePath))).version, "0.66.2-beta.25");
  git("add", "."); git("commit", "-m", "refresh");
  const validated = cli("validate", baseline, git("rev-parse", "HEAD"));
  assert.equal(validated.status, 0, validated.stderr);
  writeFileSync(path.join(root, "unrelated.txt"), "unsafe");
  git("add", "."); git("commit", "-m", "unrelated");
  const rejected = cli("validate", baseline, git("rev-parse", "HEAD"));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /Unexpected release files/);
});

test("reconciliation dispatches a stranded merged release once and carries its exact incident", async () => {
  const calls = [];
  const fixture = ({ runs = [], production = base.slice(0,12), main = head } = {}) => ({
    repository: "owner/repo",
    gitRun: (_, ref) => ref === "HEAD" ? head : base,
    github: endpoint => {
      if (endpoint.endsWith("/pulls")) return [{ merged_at: "2026-09-16", merge_commit_sha: head, head: { ref: "automation/relay-schema-bindings", repo: { full_name: "owner/repo" } }, body: "Related incident: #178\nFingerprint-only automatic release eligible: true" }];
      if (endpoint.includes("/runs?")) return { workflow_runs: runs };
      if (endpoint.endsWith("/heads/main")) return { object: { sha: main } };
      throw Error(`Unexpected API call ${endpoint}`);
    },
    readHealth: async () => ({ ok: true, buildSha: production }),
    validate: (before, after) => assert.deepEqual([before, after], [base, head]),
    dispatch: (...args) => calls.push(["dispatch", ...args]),
    notify: number => calls.push(["notify", number]),
  });
  await reconcile(fixture());
  assert.deepEqual(calls, [["dispatch", "owner/repo", head, base, "178"], ["notify", "178"]]);
  calls.length = 0;
  for (const conclusion of [null, "success", "failure", "cancelled"]) await reconcile(fixture({ runs: [{ conclusion }] }));
  await reconcile(fixture({ production: head.slice(0,12) }));
  assert.equal(calls.length, 0);
  await assert.rejects(reconcile(fixture({ production: "c".repeat(12) })), /baseline/);
  await assert.rejects(reconcile(fixture({ main: "c".repeat(40) })));
  assert.equal(calls.length, 0);
});
