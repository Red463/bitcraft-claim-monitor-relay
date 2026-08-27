import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = readFileSync(new URL("../../deploy/update-bitcraft-claim-monitor-relay", import.meta.url), "utf8");
const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
const deployment = readFileSync(new URL("../../DEPLOYMENT.md", import.meta.url), "utf8");
const gitAttributes = readFileSync(new URL("../../.gitattributes", import.meta.url), "utf8");
const mapDiagnostic = readFileSync(new URL("../../deploy/diagnose-native-map-serving.mjs", import.meta.url), "utf8");

test("the beta.12 updater transition helpers are inert and fail closed", () => {
  for (const relative of [
    "../../deploy/configure-public-caddy.mjs",
    "../../deploy/install-public-oauth-credentials.mjs",
    "../../deploy/enable-public-readonly.mjs",
  ]) {
    const helper = new URL(relative, import.meta.url);
    const source = readFileSync(helper, "utf8");
    assert.doesNotMatch(source, /\bimport\b|\brequire\s*\(|child_process|node:fs|systemctl|caddy/);
    const result = spawnSync(process.execPath, [fileURLToPath(helper)], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Retired public deployment operation is unavailable.\n");
  }
});

test("Relay deployment surfaces cannot re-enable the retired public profile", () => {
  const environment = readFileSync(new URL("../../deploy/bitcraft-claim-monitor-relay.env.example", import.meta.url), "utf8");
  const caddy = readFileSync(new URL("../../deploy/Caddyfile.example", import.meta.url), "utf8");
  const replay = readFileSync(new URL("../../deploy/replay-privacy-deletions.mjs", import.meta.url), "utf8");
  const combined = `${script}\n${environment}\n${caddy}\n${replay}`;
  for (const retired of [
    "--configure-public-caddy",
    "--install-public-oauth-credentials",
    "--enable-public-readonly",
    "--disable-public-readonly",
    "PUBLIC_PROFILE_ENABLED",
    "PUBLIC_COLLABORATION_ENABLED",
    "PUBLIC_LEGAL_CONFIGURATION_CONFIRMED",
    "PUBLIC_ORIGIN",
    "PUBLIC_DISCORD_OAUTH_CLIENT_ID",
    "PUBLIC_DISCORD_OAUTH_CLIENT_SECRET",
    "PUBLIC_PLAN_TOKEN_HMAC_KEY",
  ]) assert.equal(combined.includes(retired), false, `${retired} must be absent`);
  assert.doesNotMatch(caddy, /(^|\n)(?:www\.)?claim-monitor\.com\s*\{/);
  assert.match(script, /PUBLIC_URL/);
  assert.match(script, /--no-public-check/);
  assert.match(script, /--force-backup/);
  assert.match(script, /--generate-map/);
  assert.match(script, /restore_live_installation/);
});

test("Relay updater has only isolated defaults", () => {
  for (const expected of [
    /APP_ROOT="\$\{APP_ROOT:-\/opt\/bitcraft-claim-monitor-relay\}"/,
    /DATA_DIR="\$\{DATA_DIR:-\/var\/lib\/bitcraft-claim-monitor-relay\}"/,
    /BACKUP_DIR="\$\{BACKUP_DIR:-\/var\/backups\/bitcraft-claim-monitor-relay\}"/,
    /CONFIG_DIR="\$\{CONFIG_DIR:-\/etc\/bitcraft-claim-monitor-relay\}"/,
    /BACKUP_HELPER_PATH="\$\{BACKUP_HELPER_PATH:-\/usr\/local\/bin\/backup-bitcraft-claim-monitor-relay\}"/,
    /LOCK_FILE="\$\{LOCK_FILE:-\/run\/lock\/bitcraft-claim-monitor-relay-deploy\.lock\}"/,
    /WEB_SERVICE="\$\{WEB_SERVICE:-bitcraft-claim-monitor-relay\.service\}"/,
    /WORKER_SERVICE="\$\{WORKER_SERVICE:-bitcraft-claim-monitor-relay-worker\.service\}"/,
    /HEALTH_URL="\$\{HEALTH_URL:-http:\/\/127\.0\.0\.1:19430\/api\/local\/health\}"/,
    /HEALTH_HOST="\$\{HEALTH_HOST:-app\.timbersteeltrade\.com\}"/,
    /PUBLIC_URL="\$\{PUBLIC_URL:-https:\/\/relay\.timbersteeltrade\.com\}"/,
    /LOG_DIR="\$\{LOG_DIR:-\/var\/log\/bitcraft-claim-monitor-relay\}"/,
    /LOG_FILE="\$\{LOG_FILE:-\}"/,
    /UPDATER_PATH="\$\{UPDATER_PATH:-\/usr\/local\/bin\/update-bitcraft-claim-monitor-relay\}"/,
    /SYSTEMD_DIR="\$\{SYSTEMD_DIR:-\/etc\/systemd\/system\}"/,
    /RUN_HOME="\$\{RUN_HOME:-\$APP_ROOT\}"/,
    /RUN_SSH_CONFIG="\$\{RUN_SSH_CONFIG:-\$RUN_HOME\/\.ssh\/config\}"/,
  ]) {
    assert.match(script, expected);
  }
});

test("Relay updater creates a private unpredictable root log", () => {
  assert.match(script, /initialize_log\(\)/);
  assert.match(script, /umask 077/);
  assert.match(script, /install -d -o root -g root -m 0700 "\$LOG_DIR"/);
  assert.match(script, /mktemp "\$LOG_DIR\/update\.XXXXXX\.log"/);
  assert.match(script, /chmod 0600 "\$LOG_FILE"/);
  assert.match(script, /Refusing to overwrite existing log path/);
  assert.match(script, /set -o noclobber/);
  assert.doesNotMatch(script, /LOG_FILE=.*\/tmp\/bitcraft-claim-monitor-relay-update/);
});

test("Relay updater validates an exact main-branch revision before preparing a release", () => {
  assert.match(script, /--revision/);
  assert.match(script, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(script, /merge-base --is-ancestor/);
  assert.match(script, /origin\/main/);
  assert.match(script, /flock/);
});

test("Relay updater builds an immutable release before cutover", () => {
  assert.match(script, /SOURCE_DIR="\$\{SOURCE_DIR:-\$APP_ROOT\/source\}"/);
  assert.match(script, /RELEASES_DIR="\$\{RELEASES_DIR:-\$APP_ROOT\/releases\}"/);
  assert.match(script, /CURRENT_LINK="\$\{CURRENT_LINK:-\$APP_ROOT\/current\}"/);
  assert.match(script, /run_git_as_user[\s\\]+-C "\$SOURCE_DIR" worktree add --detach/);
  assert.match(
    script,
    /prepare_release "\$release_dir"[\s\S]*validate_release_config "\$release_dir"[\s\S]*schema_backup_kind[\s\S]*atomic_switch "\$release_dir"/,
  );
  assert.doesNotMatch(script, /log "Stopping services"[\s\S]*Fetching latest code/);
});

test("Relay updater installs revision-bound CI outputs instead of rebuilding them", () => {
  assert.match(script, /--capabilities[\s\S]*relay-build-artifact-v1/);
  assert.match(script, /--build-artifact-sha256/);
  assert.match(script, /bitcraft-build-\$\{BUILD_ARTIFACT_SHA256\}\.tar\.gz/);
  assert.match(script, /install -d -o root -g root -m 0700 "\$LOG_DIR\/incoming"/);
  assert.match(script, /chown root:root "\$secured_archive"/);
  assert.match(script, /install-relay-build-artifact\.mjs/);
  assert.match(script, /prepare_release\(\)[\s\S]*Installing dependencies[\s\S]*Installing verified CI build/);
  assert.doesNotMatch(script, /sudo -u "\$RUN_USER" tar --no-same-owner --no-same-permissions -xzf "\$BUILD_IMPORT_ARCHIVE"/);
  assert.match(script, /tar --no-same-owner --no-same-permissions -xzf "\$BUILD_IMPORT_ARCHIVE" -C "\$BUILD_IMPORT_DIR"[\s\S]*chown -R "\$RUN_USER:\$RUN_USER" "\$BUILD_IMPORT_DIR"/);
  assert.doesNotMatch(script, /run_logged "Building app"/);
});

test("Relay updater exposes a revision-pinned sequential native map generation mode", () => {
  assert.match(script, /--generate-map all/);
  assert.match(script, /generate_native_map_packs\(\)/);
  assert.match(script, /current_revision.*REVISION/);
  assert.match(script, /start_and_wait_for_map_generation.*MAP_TERRAIN_SERVICE[\s\S]*start_and_wait_for_map_generation.*MAP_ROADS_SERVICE/);
  assert.match(script, /verify-native-map-pack\.mjs[\s\S]*--product terrain/);
  assert.match(script, /verify-native-map-pack\.mjs[\s\S]*--product roads/);
  assert.match(script, /sudo -u "\$RUN_USER" node[\s\S]*--serve-base-url "http:\/\/127\.0\.0\.1:19430"/);
  assert.match(script, /Validating served native map[\s\S]*systemctl enable --now/);
  assert.match(script, /Reporting native map serving diagnostics[\s\S]*diagnose-native-map-serving\.mjs/);
  assert.match(script, /if ! start_and_wait_for_map_generation "\$MAP_ROADS_SERVICE"[\s\S]*diagnose-native-map-serving\.mjs[\s\S]*return 1/);
  assert.match(script, /MAP_GENERATION_MODE.*all[\s\S]*DATA_DIR="\/var\/lib\/bitcraft-claim-monitor-relay"/);
  assert.doesNotMatch(script, /MAP_GENERATION_MODE.*all[^\n]*&&[^\n]*APP_ROOT/);
  assert.match(script, /systemctl enable --now "\$MAP_TERRAIN_TIMER" "\$MAP_ROADS_TIMER"/);
});

test("Relay updater installs only a hashed product archive through the atomic pack store", () => {
  assert.match(script, /--install-map-product terrain\|roads/);
  assert.match(script, /--artifact-sha256 <64hex>/);
  assert.match(script, /bitcraft-map-\$\{MAP_INSTALL_PRODUCT\}-\$\{MAP_ARTIFACT_SHA256\}\.tar\.gz/);
  assert.match(script, /mv -- "\$expected_archive" "\$secured_archive"/);
  assert.match(script, /sha256sum[\s\S]*MAP_ARTIFACT_SHA256/);
  assert.match(script, /tar -tzf[\s\S]*tar -tvzf/);
  assert.match(script, /install-native-map-product\.mjs/);
  assert.doesNotMatch(script, /sudo -u "\$RUN_USER" tar --no-same-owner --no-same-permissions -xzf "\$MAP_IMPORT_ARCHIVE"/);
  assert.match(script, /tar --no-same-owner --no-same-permissions -xzf "\$MAP_IMPORT_ARCHIVE" -C "\$MAP_IMPORT_DIR"[\s\S]*chown -R "\$RUN_USER:\$RUN_USER" "\$MAP_IMPORT_DIR"/);
  assert.match(script, /systemctl disable --now "\$MAP_TERRAIN_TIMER" "\$MAP_ROADS_TIMER"/);
  assert.doesNotMatch(script, /--install-map-product[\s\S]{0,300}eval/);
});

test("native map diagnostics compare effective unit storage without publishing raw settings", () => {
  assert.match(mapDiagnostic, /unitSummary\(TERRAIN_SERVICE, "build-relay-terrain-world\.mjs"\)/);
  assert.match(mapDiagnostic, /unitSummary\(ROAD_SERVICE, "build-relay-road-world\.mjs"\)/);
  assert.match(mapDiagnostic, /releaseDataTerrainPointer/);
  assert.match(mapDiagnostic, /releaseDataRoadPointer/);
  assert.doesNotMatch(mapDiagnostic, /stdout:\s*stdout|environment:\s*environment/);
});

test("Relay updater preserves last-good native map packs during application cutover", () => {
  assert.doesNotMatch(script, /install_native_map_bundle\(\)/);
  assert.doesNotMatch(script, /native-map-static-bundle\.tar\.gz/);
  assert.doesNotMatch(script, /\.map-install-\$REVISION/);
  assert.match(script, /install_release_config "\$release_dir"[\s\S]*atomic_switch "\$release_dir"/);
});

test("Relay updater validates cutover and restores the previous release on failure", () => {
  assert.match(script, /expected_version/);
  assert.match(script, /rollback_deployment_transaction\(\)/);
  assert.match(script, /restore_live_path current-link "\$CURRENT_LINK"/);
  assert.doesNotMatch(script, /sqlite3[^\n]+\.backup/);
  assert.match(
    script,
    /restart_service "\$WEB_SERVICE"[\s\S]*wait_for_health "\$expected_version"[\s\S]*restart_service "\$WORKER_SERVICE"/,
  );
});

test("Relay updater retains three releases only after success", () => {
  assert.match(script, /KEEP_RELEASES="\$\{KEEP_RELEASES:-3\}"/);
  assert.match(script, /prune_releases\(\)/);
  assert.match(script, /deployment_succeeded=1[\s\S]*post_commit_prune "\$release_dir"/);
  assert.match(script, /run_git_as_user -C "\$SOURCE_DIR" worktree remove --force/);
  assert.match(script, /run_git_as_user -C "\$SOURCE_DIR" worktree prune/);
});

test("every runtime-user Git boundary uses the isolated Relay HOME", () => {
  assert.match(
    script,
    /run_git_as_user\(\) \{\s+sudo -u "\$RUN_USER" env HOME="\$RUN_HOME" \\\s+GIT_SSH_COMMAND="ssh -F \$RUN_SSH_CONFIG" git "\$@"/,
  );
  for (const operation of [
    /run_git_as_user[\s\\]+-C "\$SOURCE_DIR" fetch --prune origin main/,
    /run_git_as_user -C "\$SOURCE_DIR" merge-base --is-ancestor "\$REVISION" origin\/main/,
    /run_git_as_user[\s\\]+-C "\$SOURCE_DIR" worktree add --detach/,
    /run_git_as_user -C "\$SOURCE_DIR" worktree remove --force/,
    /run_git_as_user -C "\$SOURCE_DIR" worktree prune/,
  ]) {
    assert.match(script, operation);
  }
  assert.doesNotMatch(script, /sudo -u "\$RUN_USER" git /);
});

test("Relay updater waits for service and release health", () => {
  assert.match(script, /wait_for_service\(\)/);
  assert.match(script, /wait_for_health\(\)/);
  assert.match(script, /curl -fsS --connect-timeout 1 --max-time 10 --header "Host: \$HEALTH_HOST" "\$HEALTH_URL"/);
  assert.match(script, /curl -v --max-time 5 --header "Host: \$HEALTH_HOST" "\$HEALTH_URL"/);
  assert.match(script, /sleep 2/);
  assert.match(script, /Waiting for web health/);
});

test("Relay updater keeps successful output compact while logging details", () => {
  assert.match(script, /printf "Full log: %s\\n" "\$LOG_FILE"/);
  assert.match(script, /run_logged\(\)/);
  assert.match(script, /run_logged "Installing dependencies"/);
  assert.match(script, /run_logged "Installing verified CI build"/);
  assert.match(script, /Preparation: %ss/);
  assert.match(script, /Cutover: %ss/);
  assert.match(script, /--verbose/);
  assert.match(script, /--no-public-check/);
});

test("Relay updater creates encrypted backups only for migrations or an explicit force", () => {
  assert.match(script, /--force-backup/);
  assert.match(script, /database-schema-version/);
  assert.match(script, /"\$BACKUP_HELPER_PATH" migration --revision/);
  assert.match(script, /"\$BACKUP_HELPER_PATH" manual --revision/);
  assert.match(script, /stage_backup_helper\(\)/);
  assert.match(script, /restore_live_installation\(\)/);
  assert.match(script, /trap cleanup_deployment_transaction EXIT/);
  assert.match(
    script,
    /restore_live_path backup-crypto-helper "\$BACKUP_CRYPTO_HELPER_PATH"/,
  );
  assert.match(
    script,
    /restore_live_path privacy-replay-helper "\$PRIVACY_REPLAY_HELPER_PATH"/,
  );
  assert.doesNotMatch(script, /create_predeploy_backup/);
  assert.doesNotMatch(script, /sqlite3[^\n]+\.backup/);
});

test("Relay updater snapshots and restores every live install target transactionally", () => {
  assert.match(script, /snapshot_live_installation\(\)/);
  assert.match(script, /restore_live_installation\(\)/);
  for (const target of [
    "$BACKUP_HELPER_PATH",
    "$BACKUP_CRYPTO_HELPER_PATH",
    "$PRIVACY_REPLAY_HELPER_PATH",
    "$UPDATER_PATH",
    "$CURRENT_LINK",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay.service",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-worker.service",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-collector.service",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-collector.timer",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-backup.service",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-backup.timer",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-map-terrain.service",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-map-terrain.timer",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-map-roads.service",
    "$SYSTEMD_DIR/bitcraft-claim-monitor-relay-map-roads.timer",
    "$DATA_DIR/map-tiles/current.json",
    "$DATA_DIR/map-road-tiles/current.json",
  ]) {
    assert.match(script, new RegExp(target.replaceAll("$", "\\$").replaceAll(".", "\\.")));
  }
  assert.match(script, /trap cleanup_deployment_transaction EXIT/);
  assert.match(script, /restore_live_installation[\s\S]*systemctl daemon-reload/);
  assert.match(script, /restore_previous_runtime\(\)/);
  assert.match(script, /restart_service "\$WEB_SERVICE"/);
  assert.match(script, /restart_service "\$WORKER_SERVICE"/);
});

test("Relay rollback accumulates every restore failure and retains incomplete snapshots", () => {
  const restore = script.slice(
    script.indexOf("restore_live_installation()"),
    script.indexOf("restore_service_runtime()"),
  );
  assert.match(restore, /local status=0/);
  assert.equal((restore.match(/restore_live_path [^\n]+ \|\| status=1/g) || []).length, 17);
  assert.match(restore, /systemctl daemon-reload \|\| status=1/);
  assert.match(restore, /return "\$status"/);
  assert.match(script, /rollback_attempted=1/);
  assert.match(script, /Recovery snapshot retained at: \$transaction_dir/);
  assert.match(script, /log_detail "\$recovery_message"/);
  assert.match(
    script,
    /if \[\[ \( "\$deployment_succeeded" == "1" \|\| "\$transaction_restored" == "1" \)[\s\S]*rm -rf -- "\$transaction_dir"/,
  );
});

test("Relay updater cannot roll back help or pre-snapshot failures", () => {
  const main = script.slice(script.indexOf("main()"));
  assert.ok(main.indexOf('parse_args "$@"') < main.indexOf("trap cleanup_deployment_transaction EXIT"));
  assert.ok(main.indexOf("trap cleanup_deployment_transaction EXIT") < main.indexOf("snapshot_live_installation"));
  assert.match(
    script,
    /if \[\[ "\$transaction_started" == "1"[\s\S]*"\$deployment_succeeded" != "1"[\s\S]*rollback_deployment_transaction/,
  );
});

test("Relay updater commits success only after every finalization step", () => {
  const main = script.slice(script.indexOf("main()"));
  const successIndex = main.indexOf("deployment_succeeded=1");
  for (const required of [
    'install -m 0755 "$release_dir/deploy/update-bitcraft-claim-monitor-relay"',
    'systemctl enable --now "$BACKUP_TIMER"',
  ]) {
    const requiredIndex = main.indexOf(required);
    assert.ok(requiredIndex >= 0, `missing finalization step: ${required}`);
    assert.ok(successIndex > requiredIndex, `success must follow: ${required}`);
  }
  assert.ok(successIndex < main.indexOf('post_commit_prune "$release_dir"'));
  assert.match(script, /post_commit_prune\(\)[\s\S]*if ! prune_releases "\$release_dir"/);
  assert.match(script, /Release pruning failed after deployment commit; continuing/);
  const prune = script.slice(script.indexOf("prune_releases()"), script.indexOf("post_commit_prune()"));
  assert.match(prune, /local status=0/);
  assert.match(prune, /worktree remove --force "\$path" \|\| status=1/);
  assert.match(prune, /worktree prune \|\| status=1/);
  assert.match(prune, /return "\$status"/);
});

test("Relay updater validates and installs only Relay units", () => {
  for (const unit of [
    "bitcraft-claim-monitor-relay.service",
    "bitcraft-claim-monitor-relay-worker.service",
    "bitcraft-claim-monitor-relay-collector.service",
    "bitcraft-claim-monitor-relay-collector.timer",
    "bitcraft-claim-monitor-relay-backup.service",
    "bitcraft-claim-monitor-relay-backup.timer",
    "bitcraft-claim-monitor-relay-map-terrain.service",
    "bitcraft-claim-monitor-relay-map-terrain.timer",
    "bitcraft-claim-monitor-relay-map-roads.service",
    "bitcraft-claim-monitor-relay-map-roads.timer",
  ]) {
    assert.match(script, new RegExp(unit.replaceAll(".", "\\.")));
  }
  assert.match(script, /systemctl enable --now "\$BACKUP_TIMER"/);
});

test("routine Relay updates validate but never overwrite or reload Caddy", () => {
  assert.match(script, /caddy validate[\s\S]*Caddyfile\.example/);
  assert.doesNotMatch(script, /install[^\n]*Caddyfile\.example[^\n]*\/etc\/caddy\/Caddyfile/);
  assert.doesNotMatch(script, /systemctl (?:reload|restart) caddy/);
});

test("Relay updater never targets maintained deployment identities", () => {
  for (const target of [
    /http:\/\/127\.0\.0\.1:18430/,
    /\/usr\/local\/bin\/update-bitcraft-monitor(?!-relay)/,
    /\/opt\/bitcraft-claim-monitor(?:\/|")/,
    /\/var\/lib\/bitcraft-claim-monitor(?:\/|")/,
    /\/var\/backups\/bitcraft-claim-monitor(?:\/|")/,
    /(^|[^-])bitcraft-claim-monitor\.service/m,
    /(^|[^-])bitcraft-claim-monitor-worker\.service/m,
    /(^|[^-])bitcraft-monitor-collector\.(?:service|timer)/m,
    /(^|[^-])bitcraft-claim-monitor-backup\.(?:service|timer)/m,
  ]) {
    assert.doesNotMatch(script, target);
  }
});

test("Relay updater prints concise readiness and failure diagnostics", () => {
  assert.match(script, /service_summary\(\)/);
  assert.match(script, /systemctl show "\$service"/);
  assert.match(script, /journalctl -u "\$service"/);
  assert.match(script, /tail -n 80 "\$LOG_FILE"/);
  assert.match(script, /Health: ok=/);
  assert.match(script, /Public: /);
  assert.match(script, /Requested revision:/);
  assert.match(script, /Previous revision:/);
  assert.match(script, /Rollback:/);
  assert.match(script, /Active release:/);
  assert.match(script, /Failed release retained:/);
});

test("deployment docs install and explain the tracked Relay updater", () => {
  assert.match(deployment, /deploy\/update-bitcraft-claim-monitor-relay/);
  assert.match(
    deployment,
    /install -m 0755 .*deploy\/update-bitcraft-claim-monitor-relay.*\/usr\/local\/bin\/update-bitcraft-claim-monitor-relay/,
  );
  assert.match(deployment, /concise summary/);
  assert.match(deployment, /full VPS log/);
  assert.match(deployment, /--verbose/);
  assert.match(deployment, /--no-public-check/);
});

test("deployment docs bootstrap private GitHub access with a pinned read-only deploy key", () => {
  assert.match(deployment, /read-only GitHub deploy key/i);
  assert.match(deployment, /write access.*unchecked/i);
  assert.match(deployment, /git@github\.com:Red463\/bitcraft-claim-monitor-relay\.git/);
  assert.match(deployment, /known_hosts/);
  assert.match(deployment, /StrictHostKeyChecking yes/);
  assert.match(deployment, /UserKnownHostsFile/);
  assert.match(deployment, /\/opt\/bitcraft-claim-monitor-relay\/\.ssh/);
  assert.match(deployment, /HOME=\/opt\/bitcraft-claim-monitor-relay/);
  assert.match(deployment, /already-generated private checkout key/i);
  assert.match(deployment, /maintained account home.*not used or changed/i);
  assert.doesNotMatch(
    deployment,
    /(?:install|sudo|IdentityFile|UserKnownHostsFile)[^\n]*\/home\/bitcraft\/\.ssh/,
  );
  assert.doesNotMatch(
    deployment,
    /(?:install|sudo|IdentityFile|UserKnownHostsFile)[^\n]*\/opt\/bitcraft-claim-monitor\/\.ssh/,
  );
  assert.doesNotMatch(deployment, /https:\/\/[^/\s]*:[^@\s]+@github\.com/);
});

test("deployment docs protect key creation before the first write", () => {
  const keySection = deployment.slice(
    deployment.indexOf("## Create isolated directories and keys"),
    deployment.indexOf("## Clone and prepare the initial immutable release"),
  );
  const umaskIndex = keySection.indexOf("umask 077");
  assert.ok(umaskIndex >= 0);
  assert.ok(umaskIndex < keySection.indexOf("openssl rand 32"));
  assert.match(keySection, /chmod 0600 .*backup-encryption\.key/);
  assert.match(keySection, /chmod 0640 .*privacy-ledger\.key/);
});

test("README points to the Relay preview workflow, environment, and runbook", () => {
  assert.match(readme, /Deploy Relay preview/);
  assert.match(readme, /relay-preview/);
  assert.match(readme, /\[`?DEPLOYMENT\.md`?\]\(\.\/DEPLOYMENT\.md\)/);
  assert.doesNotMatch(readme, /manually run \*\*Deploy production\*\*/);
});

test("Relay shell helpers are checked out with Unix line endings", () => {
  assert.match(gitAttributes, /deploy\/update-bitcraft-claim-monitor-relay\s+text\s+eol=lf/);
  assert.match(gitAttributes, /deploy\/backup-bitcraft-claim-monitor-relay\s+text\s+eol=lf/);
  assert.doesNotMatch(gitAttributes, /deploy\/update-bitcraft-monitor\s/);
  assert.doesNotMatch(gitAttributes, /deploy\/backup-bitcraft-monitor\s/);
});
