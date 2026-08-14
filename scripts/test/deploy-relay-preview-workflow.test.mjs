import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowUrl = new URL("../../.github/workflows/deploy-relay-preview.yml", import.meta.url);
const generationWorkflowUrl = new URL("../../.github/workflows/generate-native-map.yml", import.meta.url);
const deploymentUrl = new URL("../../DEPLOYMENT.md", import.meta.url);

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
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.doesNotMatch(workflow, /printf[^\n]*DEPLOY_OUTPUT/);
  assert.doesNotMatch(workflow, /```text\\n%s\\n```[\s\S]*DEPLOY_OUTPUT/);
});

test("workflow supports explicit backups and long-running SSH keepalives", () => {
  assert.match(workflow, /force_database_backup:[\s\S]*type: boolean[\s\S]*default: false/);
  assert.match(workflow, /deploy:[\s\S]*timeout-minutes: 75/);
  assert.match(workflow, /ServerAliveInterval=30/);
  assert.match(workflow, /ServerAliveCountMax=10/);
  assert.match(workflow, /FORCE_DATABASE_BACKUP/);
});

test("workflow preserves slow-changing native map packs for independent validated generators", () => {
  assert.doesNotMatch(workflow, /native-map-static-bundle\.tar\.gz/);
  assert.doesNotMatch(workflow, /Install native map terrain and roads/);
  assert.doesNotMatch(workflow, /build-relay-terrain-overview\.mjs|BITCRAFT_INSTALL_ROAD_TILES=true/);
});

test("workflow publishes only an allow-listed native map failure category", () => {
  assert.match(workflow, /ROAD_FAILURE_CATEGORY=.*DEPLOY_OUTPUT/);
  assert.match(workflow, /empty-region\|join-mismatch\|timeout\|schema\|invalid-coordinate\|other\|unavailable/);
  assert.match(workflow, /Road generator failure category/);
  assert.match(workflow, /printf 'Road generator failure category: %s\\n' "\$ROAD_FAILURE_CATEGORY"/);
  assert.doesNotMatch(workflow, /printf[^\n]*DEPLOY_OUTPUT/);
});

test("protected native map generation runs sequentially through the restricted updater", () => {
  assert.match(generationWorkflow, /workflow_dispatch:/);
  assert.match(generationWorkflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(generationWorkflow, /environment: relay-preview/);
  assert.match(generationWorkflow, /timeout-minutes: 360/);
  assert.match(generationWorkflow, /update-bitcraft-claim-monitor-relay --revision '\$GITHUB_SHA' --generate-map all/);
  assert.doesNotMatch(generationWorkflow, /systemctl start|build-relay-terrain-world|build-relay-road-world/);
});

test("protected native map generation reports a redacted local and canonical serving comparison", () => {
  assert.match(generationWorkflow, /update-bitcraft-claim-monitor-relay --revision '\$GITHUB_SHA' --generate-map all/);
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
