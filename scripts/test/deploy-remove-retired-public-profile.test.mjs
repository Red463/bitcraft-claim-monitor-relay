import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  assertPathWithin,
  assertRemovalPathSafety,
  assertSafeExistingPath,
  backupContainsRetiredPublicSchema,
  inspectRemovalTargets,
  publicCaddyRemoval,
  publicEnvironmentRemoval,
  removePublicCaddySites,
  removePublicEnvironmentValues,
  restoreActiveServices,
} from "../../deploy/remove-retired-public-profile.mjs";

test("public environment removal deletes every retired key without exposing values", () => {
  const source = [
    "NODE_ENV=production",
    "PUBLIC_PROFILE_ENABLED=true",
    "PUBLIC_PROFILE_ENABLED=false",
    "PUBLIC_COLLABORATION_ENABLED=true",
    "PUBLIC_LEGAL_CONFIGURATION_CONFIRMED=true",
    "PUBLIC_ORIGIN=https://claim-monitor.com",
    "PUBLIC_DISCORD_OAUTH_CLIENT_ID=id",
    "PUBLIC_DISCORD_OAUTH_CLIENT_SECRET=secret",
    "PUBLIC_PLAN_TOKEN_HMAC_KEY=token",
    "DISCORD_TOKEN=dedicated",
    "",
  ].join("\n");
  const result = publicEnvironmentRemoval(source);
  assert.equal(removePublicEnvironmentValues(source), result.source);
  assert.doesNotMatch(result.source, /^PUBLIC_(PROFILE|COLLABORATION|LEGAL|ORIGIN|DISCORD|PLAN)/m);
  assert.deepEqual(result.removedKeys, [
    "PUBLIC_PROFILE_ENABLED",
    "PUBLIC_COLLABORATION_ENABLED",
    "PUBLIC_LEGAL_CONFIGURATION_CONFIRMED",
    "PUBLIC_ORIGIN",
    "PUBLIC_DISCORD_OAUTH_CLIENT_ID",
    "PUBLIC_DISCORD_OAUTH_CLIENT_SECRET",
    "PUBLIC_PLAN_TOKEN_HMAC_KEY",
  ]);
  assert.match(result.source, /DISCORD_TOKEN=dedicated/);
});

test("Caddy removal deletes only the retired apex and www site blocks", () => {
  const source = `app.timbersteeltrade.com {
  reverse_proxy 127.0.0.1:19430
}

claim-monitor.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:19430
}

www.claim-monitor.com {
  redir https://claim-monitor.com{uri} permanent
}

relay.timbersteeltrade.com {
  reverse_proxy 127.0.0.1:3000
}
`;
  const result = publicCaddyRemoval(source);
  assert.equal(removePublicCaddySites(source), result.source);
  assert.doesNotMatch(result.source, /(^|\n)(?:www\.)?claim-monitor\.com\s*\{/);
  assert.deepEqual(result.removedHosts, ["claim-monitor.com", "www.claim-monitor.com"]);
  assert.match(result.source, /app\.timbersteeltrade\.com/);
  assert.match(result.source, /relay\.timbersteeltrade\.com/);
  assert.throws(() => removePublicCaddySites("claim-monitor.com {\n  reverse_proxy 127.0.0.1:19430\n"), /malformed|unterminated/i);
});

test("target safety rejects escapes and symbolic links", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "retired-public-path-"));
  const target = path.join(directory, "target.sqlite");
  const link = path.join(directory, "link.sqlite");
  writeFileSync(target, "safe");
  assert.equal(assertPathWithin(directory, target), path.resolve(target));
  assert.throws(() => assertPathWithin(directory, path.join(directory, "..", "other.sqlite")), /outside/i);
  try {
    symlinkSync(target, link);
    assert.throws(() => assertSafeExistingPath(directory, link), /symbolic link/i);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }
});

test("production removal preflight requires exact regular targets and a real backup directory", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "retired-public-production-paths-"));
  const backupDirectory = path.join(directory, "backups");
  mkdirSync(backupDirectory);
  const paths = {
    databasePath: path.join(directory, "app.sqlite"),
    environmentPath: path.join(directory, "app.env"),
    caddyPath: path.join(directory, "Caddyfile"),
    backupDirectory,
    backupBinary: path.join(directory, "backup"),
    backupCryptoHelper: path.join(directory, "crypto.mjs"),
    backupKeyFile: path.join(directory, "backup.key"),
    deployLock: path.join(directory, "deploy.lock"),
    backupLock: path.join(directory, "backup.lock"),
  };
  for (const pathname of [paths.databasePath, paths.environmentPath, paths.caddyPath, paths.backupBinary, paths.backupCryptoHelper, paths.backupKeyFile]) {
    writeFileSync(pathname, "fixture");
  }
  assert.deepEqual(assertRemovalPathSafety(paths, paths), paths);
  assert.throws(() => assertRemovalPathSafety({ ...paths, databasePath: path.join(directory, "other.sqlite") }, paths), /exact approved path/i);
  try {
    const linked = path.join(directory, "linked.sqlite");
    symlinkSync(paths.databasePath, linked);
    const linkedPaths = { ...paths, databasePath: linked };
    assert.throws(() => assertRemovalPathSafety(linkedPaths, linkedPaths), /symbolic link/i);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }
});

test("backup schema inspection distinguishes clean and retired databases", () => {
  const clean = new DatabaseSync(":memory:");
  clean.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY)");
  const retired = new DatabaseSync(":memory:");
  retired.exec("CREATE TABLE public_user_accounts (id INTEGER PRIMARY KEY)");
  assert.equal(backupContainsRetiredPublicSchema(clean), false);
  assert.equal(backupContainsRetiredPublicSchema(retired), true);
  clean.close();
  retired.close();
});

test("inspection mode reports counts and key names without mutating files or exposing values", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "retired-public-inspect-"));
  const databasePath = path.join(directory, "app.sqlite");
  const environmentPath = path.join(directory, "app.env");
  const caddyPath = path.join(directory, "Caddyfile");
  const backupDirectory = path.join(directory, "backups");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE public_user_accounts (id INTEGER PRIMARY KEY); CREATE TABLE admin_audit_log (action TEXT NOT NULL); INSERT INTO public_user_accounts VALUES (1); INSERT INTO admin_audit_log VALUES ('public.account.suspended')");
  db.close();
  writeFileSync(environmentPath, "PUBLIC_DISCORD_OAUTH_CLIENT_SECRET=never-print\nNODE_ENV=production\n");
  writeFileSync(caddyPath, "claim-monitor.com {\n  reverse_proxy 127.0.0.1:19430\n}\n");
  const before = [readFileSync(environmentPath, "utf8"), readFileSync(caddyPath, "utf8")];
  const report = inspectRemovalTargets({ databasePath, environmentPath, caddyPath, backupDirectory });
  assert.deepEqual(report.environmentKeys, ["PUBLIC_DISCORD_OAUTH_CLIENT_SECRET"]);
  assert.doesNotMatch(JSON.stringify(report), /never-print/);
  assert.equal(report.database.tables[0].rows, 1);
  assert.equal(report.database.publicAuditRows, 1);
  assert.deepEqual([readFileSync(environmentPath, "utf8"), readFileSync(caddyPath, "utf8")], before);
});

test("protected workflow requires main, tests first, sanitised inspection, and relay-cutover approval", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/remove-retired-public-profile.yml", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../../deploy/remove-retired-public-profile.mjs", import.meta.url), "utf8");
  const updater = readFileSync(new URL("../../deploy/update-bitcraft-claim-monitor-relay", import.meta.url), "utf8");
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /remove-claim-monitor\.com/);
  assert.match(workflow, /corepack pnpm --filter @workspace\/bitcraft-local run build/);
  assert.match(workflow, /corepack pnpm --filter @workspace\/bitcraft-local test/);
  assert.match(workflow, /update-bitcraft-claim-monitor-relay --revision '\$GITHUB_SHA' --inspect-retired-public-profile[\s\S]*upload-artifact@v4/);
  assert.match(workflow, /approve:[\s\S]*needs: inspect[\s\S]*environment: relay-cutover/);
  assert.match(workflow, /remove:[\s\S]*needs: approve[\s\S]*environment: relay-preview[\s\S]*update-bitcraft-claim-monitor-relay --revision '\$GITHUB_SHA' --remove-retired-public-profile[\s\S]*--confirmation 'remove-claim-monitor\.com'/);
  assert.doesNotMatch(workflow, /sudo (?:env[^\n]+ )?node /);
  assert.match(updater, /retired-public-profile-removal-v1/);
  assert.match(updater, /delegate_retired_public_profile_mode/);
  assert.match(updater, /BITCRAFT_RETIRED_PUBLIC_REMOVAL=1/);
  assert.match(workflow, /app\.timbersteeltrade\.com\/api\/local\/health/);
  assert.match(workflow, /bootstrap\.config\?\.claimId/);
  assert.match(workflow, /health\.buildSha !== expectedRevision/);
  assert.doesNotMatch(workflow, /bootstrap\.claim\?\.id|bootstrap\.craftPlan/);
  assert.match(workflow, /bitcraft-claim-monitor-relay-worker\.service/);
  assert.match(workflow, /bitcraft-claim-monitor-relay-collector\.timer/);
  assert.match(workflow, /gateway_pids=.*sudo pgrep -f/);
  assert.match(workflow, /PRAGMA integrity_check/);
  assert.doesNotMatch(workflow, /PUBLIC_DISCORD_OAUTH_CLIENT_SECRET|PUBLIC_PLAN_TOKEN_HMAC_KEY/);
  assert.doesNotMatch(helper, /BITCRAFT_(?:DATABASE_PATH|ENVIRONMENT_PATH|CADDY_PATH|BACKUP_DIRECTORY)/);
  assert.match(helper, /recoveryFailures/);
  assert.match(helper, /AggregateError/);
  assert.doesNotMatch(helper, /catch \{\}/);
});

test("service restoration attempts every previously active unit and reports all failures", () => {
  const calls = [];
  assert.throws(() => restoreActiveServices({
    "bitcraft-claim-monitor-relay.service": true,
    "bitcraft-claim-monitor-relay-worker.service": true,
    "bitcraft-claim-monitor-relay-collector.service": false,
    "bitcraft-claim-monitor-relay-collector.timer": true,
  }, { systemctlBinary: "systemctl" }, (_command, args, label) => {
    calls.push({ args, label });
    if (args[1] !== "bitcraft-claim-monitor-relay-collector.timer") throw new Error(`failed ${args[1]}`);
  }), /relay\.service.*relay-worker\.service/s);
  assert.deepEqual(calls.map(({ args }) => args[1]), [
    "bitcraft-claim-monitor-relay.service",
    "bitcraft-claim-monitor-relay-worker.service",
    "bitcraft-claim-monitor-relay-collector.timer",
  ]);
});
