import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const deployUrl = new URL("../../deploy/", import.meta.url);
const readDeployment = (name) => readFileSync(new URL(name, deployUrl), "utf8");

const web = readDeployment("bitcraft-claim-monitor-relay.service");
const worker = readDeployment("bitcraft-claim-monitor-relay-worker.service");
const collector = readDeployment("bitcraft-claim-monitor-relay-collector.service");
const caddy = readDeployment("Caddyfile.example");
const backupService = readDeployment("bitcraft-claim-monitor-relay-backup.service");
const backupTimer = readDeployment("bitcraft-claim-monitor-relay-backup.timer");
const schemaVersion = readDeployment("database-schema-version");
const environment = readDeployment("bitcraft-claim-monitor-relay.env.example");

test("Relay services execute through the isolated active release symlink", () => {
  for (const unit of [web, worker, collector]) {
    assert.match(unit, /\/opt\/bitcraft-claim-monitor-relay\/current\//);
    assert.doesNotMatch(unit, /\/opt\/bitcraft-claim-monitor\/current\//);
  }
});

test("systemd leaves Discord activation to the validated environment", () => {
  for (const unit of [web, worker]) {
    assert.match(unit, /EnvironmentFile=-\/etc\/bitcraft-claim-monitor-relay\.env/);
    assert.doesNotMatch(unit, /(?:Environment=|ExecStart=.*)(?:DISCORD_DELIVERY_MODE|ENABLE_DISCORD_STARTUP)/);
  }
});

test("systemd launch commands pin each process role outside the shared environment", () => {
  assert.doesNotMatch(environment, /^\s*BITCRAFT_PROCESS_ROLE=/m);
  assert.doesNotMatch(web, /^Environment=BITCRAFT_PROCESS_ROLE=/m);
  assert.doesNotMatch(worker, /^Environment=BITCRAFT_PROCESS_ROLE=/m);
  assert.match(
    web,
    /^ExecStart=\/usr\/bin\/env BITCRAFT_PROCESS_ROLE=web BITCRAFT_LOCAL_DATA_DIR=\/var\/lib\/bitcraft-claim-monitor-relay \/usr\/bin\/node \/opt\/bitcraft-claim-monitor-relay\/current\/apps\/bitcraft-local\/server\.mjs$/m,
  );
  assert.match(
    worker,
    /^ExecStart=\/usr\/bin\/env BITCRAFT_PROCESS_ROLE=worker BITCRAFT_LOCAL_DATA_DIR=\/var\/lib\/bitcraft-claim-monitor-relay \/usr\/bin\/node \/opt\/bitcraft-claim-monitor-relay\/current\/apps\/bitcraft-local\/worker\.mjs$/m,
  );
});

test("Caddy serves canonical traffic from the app and permanently redirects Relay paths", () => {
  assert.match(caddy, /app\.timbersteeltrade\.com\s*\{[\s\S]*reverse_proxy 127\.0\.0\.1:19430/);
  assert.match(caddy, /relay\.timbersteeltrade\.com\s*\{\s*redir https:\/\/app\.timbersteeltrade\.com\{uri\} permanent\s*\}/);
  assert.doesNotMatch(caddy, /18430/);
  assert.match(caddy, /lb_try_duration 5s/);
  assert.match(caddy, /lb_retry_match[\s\S]*method GET HEAD/);
  assert.doesNotMatch(caddy, /lb_retry_match[\s\S]*(POST|PUT|PATCH|DELETE)/);
});

test("canonical Caddy app route returns explicit browser and API maintenance responses", () => {
  assert.match(caddy, /handle_errors/);
  assert.match(caddy, /@api path \/api\/\*/);
  assert.match(caddy, /application\/json/);
  assert.match(caddy, /Claim Monitor is updating/);
  assert.match(caddy, /503/);
});

test("environment template is preview-safe by default", () => {
  assert.match(environment, /BITCRAFT_DEPLOYMENT_MODE=preview/);
  assert.match(environment, /DISCORD_DELIVERY_MODE=record/);
  assert.match(environment, /ENABLE_DISCORD_STARTUP=false/);
  assert.match(environment, /LEGAL_CONFIGURATION_CONFIRMED=false/);
});

test("Relay database backup schedule is persistent and runs daily in London time", () => {
  assert.equal(schemaVersion.trim(), "3");
  assert.match(backupService, /backup-bitcraft-claim-monitor-relay daily/);
  assert.match(backupTimer, /OnCalendar=\*-\*-\* 03:30:00 Europe\/London/);
  assert.match(backupTimer, /RandomizedDelaySec=15m/);
  assert.match(backupTimer, /Persistent=true/);
});

test("Relay repository contains no maintained service or updater artifacts", () => {
  for (const name of [
    "bitcraft-claim-monitor.service",
    "bitcraft-claim-monitor-worker.service",
    "bitcraft-monitor-collector.service",
    "bitcraft-monitor-collector.timer",
    "bitcraft-claim-monitor-backup.service",
    "bitcraft-claim-monitor-backup.timer",
    "update-bitcraft-monitor",
    "backup-bitcraft-monitor",
  ]) {
    assert.equal(existsSync(new URL(name, deployUrl)), false, `${name} must be removed`);
  }
});
