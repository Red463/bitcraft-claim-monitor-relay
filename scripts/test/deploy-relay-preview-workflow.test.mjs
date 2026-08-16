import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowUrl = new URL("../../.github/workflows/deploy-relay-preview.yml", import.meta.url);
const generationWorkflowUrl = new URL("../../.github/workflows/generate-native-map.yml", import.meta.url);
const deploymentUrl = new URL("../../DEPLOYMENT.md", import.meta.url);
const deployClassifierUrl = new URL("../classify-relay-deploy-failure.mjs", import.meta.url);
const deployClassifierPath = fileURLToPath(deployClassifierUrl);

const workflow = readFileSync(workflowUrl, "utf8");
const generationWorkflow = readFileSync(generationWorkflowUrl, "utf8");
const deployment = readFileSync(deploymentUrl, "utf8");

const maintainedTargets = [
  /http:\/\/127\.0\.0\.1:18430/,
  /\/usr\/local\/bin\/update-bitcraft-monitor(?!-relay)/,
  /(^|[^-])bitcraft-claim-monitor\.service/m,
  /(^|[^-])bitcraft-claim-monitor-worker\.service/m,
  /(^|[^-])bitcraft-monitor-collector\.(?:service|timer)/m,
  /(^|[^-])bitcraft-claim-monitor-backup\.(?:service|timer)/m,
];

test("Relay preview deployment is manual, main-only, and serialized", () => {
  assert.match(workflow, /^name: Deploy Relay preview$/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /concurrency:[\s\S]*group: relay-preview/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("Relay deployment credentials are gated behind verification and preview approval", () => {
  assert.match(workflow, /verify:/);
  assert.match(workflow, /pnpm --filter @workspace\/bitcraft-local test/);
  assert.match(workflow, /pnpm --filter @workspace\/bitcraft-local run build/);
  assert.match(workflow, /sudo "\$\(command -v node\)" --test scripts\/test\/deploy-\*\.test\.mjs/);
  assert.match(workflow, /deploy:[\s\S]*needs: verify/);
  assert.match(workflow, /environment: relay-preview/);
});

test("verification validates only Relay units and the coexistence Caddy example", () => {
  const verifyJob = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("  deploy:"));
  const nodePathIndex = verifyJob.indexOf('sudo ln -s "$(command -v node)" /usr/bin/node');
  const systemdVerifyIndex = verifyJob.indexOf("systemd-analyze verify");

  assert.match(verifyJob, /systemd-analyze verify/);
  for (const unit of [
    "bitcraft-claim-monitor-relay.service",
    "bitcraft-claim-monitor-relay-worker.service",
    "bitcraft-claim-monitor-relay-collector.service",
    "bitcraft-claim-monitor-relay-collector.timer",
    "bitcraft-claim-monitor-relay-backup.service",
    "bitcraft-claim-monitor-relay-backup.timer",
  ]) {
    assert.match(verifyJob, new RegExp(`deploy/${unit.replaceAll(".", "\\.")}`));
  }
  assert.match(verifyJob, /caddy validate --config deploy\/Caddyfile\.example/);
  assert.ok(nodePathIndex >= 0, "verifier must provide the production Node executable path");
  assert.ok(systemdVerifyIndex > nodePathIndex, "production Node path must exist before systemd validation");
});

test("workflow pins host identity and deploys the verified full commit with the Relay updater", () => {
  assert.match(workflow, /RELAY_VPS_KNOWN_HOSTS/);
  assert.match(workflow, /chmod 600.*known_hosts/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
  assert.match(workflow, /UserKnownHostsFile=.*known_hosts/);
  assert.match(
    workflow,
    /sudo \/usr\/local\/bin\/update-bitcraft-claim-monitor-relay --revision '\$GITHUB_SHA'/,
  );
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(workflow, /appleboy|ssh-action/);
});

test("workflow does not publish raw VPS output or journals", () => {
  assert.match(workflow, /DEPLOY_STATUS=\$\?/);
  assert.match(workflow, /classify-relay-deploy-failure\.mjs/);
  assert.match(workflow, /Deployment failure category/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(workflow, /printf[^\n]*DEPLOY_OUTPUT/);
  assert.doesNotMatch(workflow, /```text\\n%s\\n```[\s\S]*DEPLOY_OUTPUT/);
  assert.match(workflow, /artifact-capability\|artifact-argument\|artifact-archive\|argument-validation\|busy/);
});

test("workflow supports explicit backups and long-running SSH keepalives", () => {
  assert.match(workflow, /force_database_backup:[\s\S]*type: boolean[\s\S]*default: false/);
  assert.match(workflow, /deploy:[\s\S]*timeout-minutes: 75/);
  assert.match(workflow, /ServerAliveInterval=30/);
  assert.match(workflow, /ServerAliveCountMax=10/);
  assert.match(workflow, /FORCE_DATABASE_BACKUP/);
});

test("verified CI build outputs are transferred to capable updaters instead of rebuilt on the VPS", () => {
  assert.match(workflow, /package-relay-build\.mjs/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /--capabilities/);
  assert.match(workflow, /relay-build-artifact-v1/);
  assert.match(workflow, /bitcraft-build-\$\{DIGEST\}\.tar\.gz/);
  assert.match(workflow, /--build-artifact-sha256/);
});

test("workflow preserves slow-changing native map packs for independent validated generators", () => {
  assert.doesNotMatch(workflow, /native-map-static-bundle\.tar\.gz/);
  assert.doesNotMatch(workflow, /Install native map terrain and roads/);
  assert.doesNotMatch(workflow, /build-relay-terrain-overview\.mjs|BITCRAFT_INSTALL_ROAD_TILES=true/);
});

test("deployment diagnostics classify only secret-safe failure categories", () => {
  const classify = (input) => spawnSync(
    process.execPath,
    [deployClassifierPath],
    { input, encoding: "utf8" },
  );
  const cases = [
    ["FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory", "out-of-memory"],
    ["Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/opt/app/missing.mjs'", "startup-module"],
    ["Waiting for web service.............................. failed", "web-service"],
    ["Deployment failed.\nCandidate Health: not checked\nCandidate Public: skipped", "health-timeout"],
    ["Deployment failed.\nCandidate Health: ok=true, polling enabled=true, version=0.55.0-beta.24\nCandidate Public: check failed status=503", "public-check"],
    ["Deployment failed.\nRollback: failed; recovery snapshot retained", "rollback"],
    ["Installing dependencies failed (exit 1)\nsecret-token=must-not-escape", "prepare"],
    ["Installing verified CI build failed (exit 1)", "prepare"],
    ["Ordinary deployments require --build-artifact-sha256.", "artifact-capability"],
    ["--build-artifact-sha256 requires one lowercase SHA-256 value.", "artifact-argument"],
    ["Unknown option: --broken", "argument-validation"],
    ["tar: Exiting with failure status due to previous errors", "artifact-archive"],
    ["Another deployment is already running.", "busy"],
  ];

  for (const [input, expected] of cases) {
    const result = classify(input);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), expected);
    assert.equal(result.stderr, "");
    assert.doesNotMatch(result.stdout, /secret-token|missing\.mjs|0\.55\.0/);
  }
});

test("workflow publishes only an allow-listed native map failure category", () => {
  assert.match(workflow, /ROAD_FAILURE_CATEGORY=.*DEPLOY_OUTPUT/);
  assert.match(workflow, /empty-region\|join-mismatch\|timeout\|schema\|invalid-coordinate\|out-of-memory\|subscription\|connection\|module\|filesystem\|disk\|render\|busy\|implementation\|other\|unavailable/);
  assert.match(workflow, /Road generator failure category/);
  assert.match(workflow, /printf 'Road generator failure category: %s\\n' "\$ROAD_FAILURE_CATEGORY"/);
  assert.doesNotMatch(workflow, /printf[^\n]*DEPLOY_OUTPUT/);
});

test("protected native map generation runs as product-isolated GitHub jobs", () => {
  assert.match(generationWorkflow, /workflow_dispatch:/);
  assert.match(generationWorkflow, /schedule:/);
  assert.match(generationWorkflow, /cron: ['"]10 2 \* \* 1-6['"]/);
  assert.match(generationWorkflow, /cron: ['"]10 3 \* \* 0['"]/);
  assert.match(generationWorkflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(generationWorkflow, /environment: relay-preview/);
  assert.match(generationWorkflow, /timeout-minutes: 360/);
  assert.match(generationWorkflow, /matrix:[\s\S]*product:/);
  assert.match(generationWorkflow, /BITCRAFT_LOCAL_DATA_DIR: \/tmp\/bitcraft-native-map-data/);
  assert.match(generationWorkflow, /build-relay-(?:terrain|road)-world\.mjs/);
  assert.match(generationWorkflow, /package-native-map-product\.mjs/);
  assert.doesNotMatch(generationWorkflow, /--generate-map all|systemctl start/);
});

test("protected native map generation uploads a hashed archive for restricted atomic installation", () => {
  assert.match(generationWorkflow, /sha256sum/);
  assert.match(generationWorkflow, /scp[\s\S]*bitcraft-map-\$\{?PRODUCT\}?-/);
  assert.match(generationWorkflow, /update-bitcraft-claim-monitor-relay --revision '\$GITHUB_SHA' --install-map-product/);
  assert.match(generationWorkflow, /--artifact-sha256/);
  assert.doesNotMatch(generationWorkflow, /sudo \/usr\/bin\/node/);
  assert.doesNotMatch(generationWorkflow, /cat \/etc\/bitcraft-claim-monitor-relay\.env|\/proc\/[^\s]+\/environ/);
});

test("active deployment paths never target the maintained application", () => {
  for (const content of [workflow, deployment]) {
    for (const target of maintainedTargets) {
      assert.doesNotMatch(content, target);
    }
  }
  assert.doesNotMatch(workflow, /environment: production/);
  assert.doesNotMatch(workflow, /group: production/);
});

test("Relay runbook covers isolated preview deployment and protected recovery", () => {
  for (const expected of [
    /Red463\/bitcraft-claim-monitor-relay/,
    /\/opt\/bitcraft-claim-monitor-relay\/releases/,
    /\/var\/lib\/bitcraft-claim-monitor-relay/,
    /\/var\/backups\/bitcraft-claim-monitor-relay/,
    /\/etc\/bitcraft-claim-monitor-relay\.env/,
    /relay-preview/,
    /required reviewer/i,
    /VPS_KNOWN_HOSTS/,
    /fresh SQLite/i,
    /automatic rollback/i,
    /privacy deletion ledger/i,
    /maintained app remains running and untouched/i,
  ]) {
    assert.match(deployment, expected);
  }
  assert.match(deployment, /backup-bitcraft-claim-monitor-relay --dry-run-prune/);
  assert.match(deployment, /backup-bitcraft-claim-monitor-relay --apply-prune/);
  assert.match(deployment, /bitcraft-claim-monitor-relay-backup\.timer/);
  assert.match(deployment, /force_database_backup/);
  assert.match(deployment, /seven daily/i);
  assert.match(deployment, /three migration/i);
  assert.match(deployment, /three manual/i);
});

test("Caddy preview bootstrap is supervised and routine updates never overwrite it", () => {
  assert.match(deployment, /one-time supervised Caddy bootstrap/i);
  assert.match(deployment, /caddy validate --config \/etc\/caddy\/Caddyfile/);
  assert.match(deployment, /systemctl reload caddy/);
  assert.match(deployment, /must not copy.*Caddyfile\.example.*\/etc\/caddy\/Caddyfile/is);
});
