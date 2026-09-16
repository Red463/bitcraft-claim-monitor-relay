import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

export const manifestPath = "apps/bitcraft-local/src/server/game-data/bindings/schema-manifest.json";
const packagePath = "apps/bitcraft-local/package.json";
const branch = "automation/relay-schema-bindings";
const hash = /^[a-f0-9]{64}$/;
const commit = /^[a-f0-9]{40}$/;
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const jsonAt = (ref, file) => JSON.parse(git("show", `${ref}:${file}`));
const api = (path, ...args) => JSON.parse(gh("api", path, ...args));
const output = (key, value) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`); };

export function validateAutomationConfig(env) {
  const origin = new URL(env.SCHEMA_APP_ORIGIN);
  assert.ok(origin.protocol === "https:" && !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash, "Configure an HTTPS application origin without credentials or a path.");
  assert.match(env.SCHEMA_CLAIM_ID ?? "", /^\d+$/, "Configure the monitored claim ID.");
  assert.match(env.SCHEMA_REGION_ID ?? "", /^\d+$/, "Configure the monitored region ID.");
  assert.match(env.SCHEMA_RESOURCE_ID ?? "54", /^\d+$/, "Configure a map resource ID.");
  const regions = String(env.SCHEMA_REGION_IDS ?? "").split(",").map(id => id.trim());
  assert.ok(regions.length && regions.every(id => /^\d+$/.test(id)) && regions.includes(env.SCHEMA_REGION_ID), "Configure all active regions, including the monitored region.");
}

export function classifyRefresh(files, before, after) {
  const reject = reason => ({ eligible: false, reason });
  if (files.length !== 1 || files[0] !== manifestPath) return reject("Generated code or other files changed; manual review required.");
  if (!Number.isFinite(Date.parse(after.capturedAt))) return reject("Invalid manifest capture time.");
  const normalized = structuredClone(after);
  normalized.capturedAt = before.capturedAt;
  let changed = false;
  for (const kind of ["global", "regional"]) {
    const previous = before.schemas?.[kind], next = normalized.schemas?.[kind];
    if (!previous || !next || !hash.test(previous.fingerprint) || previous.fingerprint !== previous.schemaSha256
      || !hash.test(next.fingerprint) || next.fingerprint !== next.schemaSha256 || next.bindingsGenerated !== true) return reject("Invalid schema fingerprint metadata.");
    changed ||= previous.fingerprint !== next.fingerprint;
    next.fingerprint = previous.fingerprint;
    next.schemaSha256 = previous.schemaSha256;
  }
  if (!changed || !isDeepStrictEqual(before, normalized)) return reject("Manifest changes extend beyond fingerprints and capture time.");
  return { eligible: true, reason: "Pinned regeneration produced identical generated bindings." };
}

export function releaseMetadata(beforePackage, beforeChangelog, date) {
  const match = /^0\.(\d+)\.(\d+)-beta\.([1-9]\d*)$/.exec(beforePackage.version);
  if (!match) throw new Error("Automatic releases require a pre-1.0 beta version.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid release date.");
  const version = `0.${match[1]}.${match[2]}-beta.${BigInt(match[3]) + 1n}`;
  const text = beforeChangelog.replaceAll("\r\n", "\n");
  const section = /## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/.exec(text);
  if (!section || section[1].trim()) throw new Error("Nonempty or missing Unreleased section requires manual release review.");
  if (text.includes(`## [${version}]`)) throw new Error("Release version already exists in changelog.");
  const entry = `## [Unreleased]\n\n## [${version}] - ${date}\n\n### Fixed\n\n- Restored live settlement and map updates after a Relay schema fingerprint change.\n`;
  return { package: { ...beforePackage, version }, changelog: text.replace(section[0], entry) };
}

export function assertReleaseCandidate({ files, beforeManifest, afterManifest, beforePackage, afterPackage, beforeChangelog, afterChangelog }) {
  assert.deepEqual([...files].sort(), [manifestPath, packagePath, "CHANGELOG.md"].sort(), "Unexpected release files");
  const policy = classifyRefresh([manifestPath], beforeManifest, afterManifest);
  assert.ok(policy.eligible, policy.reason);
  const date = /^## \[0\.\d+\.\d+-beta\.\d+\] - (\d{4}-\d{2}-\d{2})$/m.exec(afterChangelog)?.[1];
  const expected = releaseMetadata(beforePackage, beforeChangelog, date ?? "");
  assert.deepEqual(afterPackage, expected.package, "Unexpected package changes");
  assert.equal(afterChangelog.replaceAll("\r\n", "\n"), expected.changelog, "Unexpected changelog changes");
}

export function validateRevision(base, head) {
  assert.match(base, commit); assert.match(head, commit);
  git("merge-base", "--is-ancestor", base, head);
  assertReleaseCandidate({
    files: git("diff", "--name-only", base, head).split("\n").filter(Boolean),
    beforeManifest: jsonAt(base, manifestPath), afterManifest: jsonAt(head, manifestPath),
    beforePackage: jsonAt(base, packagePath), afterPackage: jsonAt(head, packagePath),
    beforeChangelog: git("show", `${base}:CHANGELOG.md`) + "\n", afterChangelog: git("show", `${head}:CHANGELOG.md`) + "\n",
  });
}

export function assertMergeReady({ base, head, main, deployedSha, pr, repository, run }) {
  assert.match(base, commit); assert.match(head, commit);
  assert.equal(main, base, "Main advanced; regenerate and retest.");
  assert.ok(/^[a-f0-9]{12,40}$/.test(deployedSha) && base.startsWith(deployedSha), "Production does not match the tested baseline; deploy main normally first.");
  assert.equal(pr.state, "open"); assert.equal(pr.draft, false);
  assert.equal(pr.head.sha, head, "PR head changed."); assert.equal(pr.head.ref, branch);
  assert.equal(pr.head.repo.full_name, repository); assert.equal(pr.base.ref, "main"); assert.equal(pr.base.sha, base);
  assert.equal(run.head_sha, head); assert.equal(run.event, "pull_request");
  assert.equal(run.path, ".github/workflows/verify.yml");
  assert.equal(run.status, "completed"); assert.equal(run.conclusion, "success", "Verify did not succeed for this exact head.");
}

async function productionHealth() {
  const origin = new URL(process.env.SCHEMA_APP_ORIGIN);
  assert.equal(origin.protocol, "https:");
  const response = await fetch(new URL("/api/local/health", origin), { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Production health HTTP ${response.status}`);
  const health = await response.json();
  assert.equal(health.ok, true);
  return health;
}

function dispatchDeployment(repository, revision, base, issue) {
  gh("workflow", "run", "deploy-relay-preview.yml", "--repo", repository, "--ref", "main", "-f", `expected_revision=${revision}`, "-f", `schema_base_revision=${base}`, "-f", `schema_issue=${issue}`);
}

// A crash after merge must not strand a release forever just because source drift
// has now disappeared on main. Resume dispatch only; failed deployments need review.
export async function reconcile({ repository = process.env.GITHUB_REPOSITORY, gitRun = git, github = api, readHealth = productionHealth, validate = validateRevision, dispatch = dispatchDeployment,
  notify = issue => execFileSync(process.execPath, ["scripts/relay-schema-incident.mjs", "deploying"], { stdio: "inherit", env: { ...process.env, SCHEMA_ISSUE_NUMBER: issue } }),
} = {}) {
  const head = gitRun("rev-parse", "HEAD"), base = gitRun("rev-parse", "HEAD^");
  const prs = github(`repos/${repository}/commits/${head}/pulls`);
  const pr = prs.find(row => row.merged_at && row.merge_commit_sha === head && row.head?.ref === branch && row.head?.repo?.full_name === repository);
  if (!pr || !pr.body?.includes("automatic release eligible: true")) return;
  validate(base, head);
  const issue = /Related incident: #(\d+)/.exec(pr.body)?.[1];
  assert.ok(issue, "Missing schema incident.");
  const runs = github(`repos/${repository}/actions/workflows/deploy-relay-preview.yml/runs?head_sha=${head}&event=workflow_dispatch&per_page=100`).workflow_runs;
  if (runs.length) {
    console.log("Deployment already dispatched; its outcome remains recorded in Actions and the schema incident.");
    return;
  }
  const health = await readHealth();
  const deployed = health.buildSha ?? "";
  if (/^[a-f0-9]{12,40}$/.test(deployed) && head.startsWith(deployed)) return;
  assert.ok(/^[a-f0-9]{12,40}$/.test(deployed) && base.startsWith(deployed), "Production no longer matches the schema release baseline.");
  assert.equal(github(`repos/${repository}/git/ref/heads/main`).object.sha, head);
  dispatch(repository, head, base, issue);
  notify(issue);
}

async function validateDeployment(base, head) {
  validateRevision(base, head);
  assert.equal(git("rev-parse", `${head}^`), base, "Schema release must be a single commit on its deployed baseline.");
  assert.equal(api(`repos/${process.env.GITHUB_REPOSITORY}/git/ref/heads/main`).object.sha, head, "Main advanced before deployment.");
  const health = await productionHealth();
  const deployed = health.buildSha ?? "";
  assert.ok(/^[a-f0-9]{12,40}$/.test(deployed) && base.startsWith(deployed), "Production advanced or differs from the release baseline.");
}

async function mergeAndDeploy() {
  const { GITHUB_REPOSITORY: repository, SCHEMA_BASE_SHA: base, SCHEMA_HEAD_SHA: head, SCHEMA_PR_NUMBER: number, SCHEMA_ISSUE_NUMBER: issue } = process.env;
  assert.match(number ?? "", /^\d+$/); assert.match(issue ?? "", /^\d+$/);
  assert.match(repository ?? "", /^[\w.-]+\/[\w.-]+$/);
  validateRevision(base, head);
  // Strict required checks close the main-branch race between inspection and merge.
  const protection = api(`repos/${repository}/branches/main/protection`);
  const checks = protection.required_status_checks;
  assert.ok(checks?.strict && checks.contexts?.includes("application") && protection.enforce_admins?.enabled,
    "Enable strict required application checks and enforcement for administrators before auto-release.");
  let run;
  const deadline = Date.now() + 35 * 60_000;
  while (Date.now() < deadline) {
    const current = api(`repos/${repository}/pulls/${number}`);
    assert.equal(current.head.sha, head, "PR changed while waiting for CI.");
    const runs = api(`repos/${repository}/actions/workflows/verify.yml/runs?head_sha=${head}&event=pull_request&per_page=10`).workflow_runs;
    run = runs.find(candidate => candidate.head_sha === head);
    if (run?.status === "completed") break;
    await sleep(15_000);
  }
  const health = await productionHealth();
  assertMergeReady({ base, head, repository, run: run ?? {}, deployedSha: health.buildSha, main: api(`repos/${repository}/git/ref/heads/main`).object.sha, pr: api(`repos/${repository}/pulls/${number}`) });
  execFileSync(process.execPath, ["apps/bitcraft-local/scripts/check-relay-schema-drift.mjs", "--all-regions"], { stdio: "inherit" });
  const merged = api(`repos/${repository}/pulls/${number}/merge`, "--method", "PUT", "-f", `sha=${head}`, "-f", "merge_method=squash");
  assert.equal(merged.merged, true, "GitHub refused the guarded merge.");
  assert.match(merged.sha, commit);
  output("merged_sha", merged.sha);
  dispatchDeployment(repository, merged.sha, base, issue);
  console.log(`Dispatched verified schema deployment for ${merged.sha}.`);
}

async function main() {
  const [command, base, head] = process.argv.slice(2);
  if (command === "prepare") {
    const before = jsonAt("HEAD", manifestPath);
    const after = JSON.parse(readFileSync(manifestPath, "utf8"));
    const files = git("diff", "HEAD", "--name-only").split("\n").filter(Boolean);
    files.push(...git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean));
    const policy = classifyRefresh(files, before, after);
    let eligible = policy.eligible;
    if (eligible) {
      try {
        const result = releaseMetadata(JSON.parse(readFileSync(packagePath, "utf8")), readFileSync("CHANGELOG.md", "utf8"), new Date().toISOString().slice(0, 10));
        writeFileSync(packagePath, `${JSON.stringify(result.package, null, 2)}\n`);
        writeFileSync("CHANGELOG.md", result.changelog);
      } catch (error) { eligible = false; console.log(error.message); }
    }
    output("eligible", eligible); console.log(policy.reason);
  } else if (command === "validate") {
    validateRevision(base, head);
  } else if (command === "merge-and-deploy") {
    await mergeAndDeploy();
  } else if (command === "reconcile") {
    await reconcile();
  } else if (command === "validate-deploy") {
    await validateDeployment(base, head);
  } else if (command === "preflight") {
    validateAutomationConfig(process.env);
  } else throw new Error("Expected prepare, validate, validate-deploy, reconcile or merge-and-deploy.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
