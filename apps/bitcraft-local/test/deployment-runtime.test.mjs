import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(new URL("../server.mjs", import.meta.url)));

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(null);
    }, timeoutMs);
    const onExit = (code) => {
      clearTimeout(timeout);
      resolve(code);
    };
    child.once("exit", onExit);
  });
}

let deploymentRuntime = null;
try {
  deploymentRuntime = await import("../src/server/deploymentRuntime.mjs");
} catch {
  // The first TDD run proves the deployment runtime guard is absent.
}
const processRole = await import("../src/server/processRole.mjs");

const canonicalWorker = {
  NODE_ENV: "production",
  BITCRAFT_DEPLOYMENT_MODE: "canonical",
  BITCRAFT_PROCESS_ROLE: "worker",
  DISCORD_DELIVERY_MODE: "live",
  ENABLE_DISCORD_STARTUP: "true",
  LEGAL_CONFIGURATION_CONFIRMED: "true",
  DISCORD_OAUTH_CLIENT_ID: "123456789012345678",
  DISCORD_OAUTH_CLIENT_SECRET: "oauth-secret",
  DISCORD_BOT_TOKEN: "bot-secret",
};

test("preview defaults to record-only Discord with no gateway", () => {
  assert.ok(deploymentRuntime, "deployment runtime module must exist");
  const { health, ...runtime } = deploymentRuntime.resolveDeploymentRuntime({});
  assert.equal(typeof health, "function");
  assert.deepEqual(runtime, {
    mode: "preview",
    canonicalOrigin: "https://app.timbersteeltrade.com",
    oauthCallbackUrl: "https://app.timbersteeltrade.com/api/local/auth/discord/callback",
    discordDeliveryMode: "record",
    discordGatewayEnabled: false,
    discordReady: false,
  });
});

test("canonical worker requires live Discord, legal confirmation, identity, token, and canonical callback", () => {
  assert.ok(deploymentRuntime, "deployment runtime module must exist");
  const runtime = deploymentRuntime.resolveDeploymentRuntime({
    ...canonicalWorker,
    DISCORD_OAUTH_REDIRECT_URI: "https://app.timbersteeltrade.com/api/local/auth/discord/callback",
  });
  assert.equal(runtime.mode, "canonical");
  assert.equal(runtime.discordDeliveryMode, "live");
  assert.equal(runtime.discordGatewayEnabled, true);
  assert.equal(runtime.discordReady, true);

  for (const [key, value] of [
    ["DISCORD_DELIVERY_MODE", "record"],
    ["ENABLE_DISCORD_STARTUP", "false"],
    ["LEGAL_CONFIGURATION_CONFIRMED", "false"],
    ["DISCORD_OAUTH_CLIENT_ID", ""],
    ["DISCORD_OAUTH_CLIENT_SECRET", ""],
    ["DISCORD_BOT_TOKEN", ""],
    ["DISCORD_OAUTH_REDIRECT_URI", "https://preview.example/api/local/auth/discord/callback"],
  ]) {
    assert.throws(() => deploymentRuntime.resolveDeploymentRuntime({
      ...canonicalWorker,
      DISCORD_OAUTH_REDIRECT_URI: "https://app.timbersteeltrade.com/api/local/auth/discord/callback",
      [key]: value,
    }), /canonical/i, `${key} mismatch must fail startup`);
  }
});

test("canonical web remains HTTP-only and production rejects a combined process role", () => {
  assert.ok(deploymentRuntime, "deployment runtime module must exist");
  const web = deploymentRuntime.resolveDeploymentRuntime({
    ...canonicalWorker,
    BITCRAFT_PROCESS_ROLE: "web",
  });
  assert.equal(web.discordGatewayEnabled, false);
  assert.throws(() => deploymentRuntime.resolveDeploymentRuntime({
    ...canonicalWorker,
    BITCRAFT_PROCESS_ROLE: "all",
  }), /separate web and worker/i);
});

test("canonical production rejects a combined role even in a test runtime", () => {
  assert.ok(deploymentRuntime, "deployment runtime module must exist");
  assert.throws(() => deploymentRuntime.resolveDeploymentRuntime({
    ...canonicalWorker,
    BITCRAFT_PROCESS_ROLE: "all",
    BITCRAFT_TEST: "true",
  }), /separate web and worker/i);
});

test("canonical worker fails closed when effective Discord settings cannot start the gateway", () => {
  assert.equal(
    typeof deploymentRuntime?.assertCanonicalDiscordGatewayReady,
    "function",
    "canonical Discord readiness validator must exist",
  );
  const worker = deploymentRuntime.resolveDeploymentRuntime(canonicalWorker);
  const ready = {
    settings: { enabled: true, botToken: "bot-secret", presence: { enabled: true } },
    webSocketAvailable: true,
  };
  assert.doesNotThrow(() => deploymentRuntime.assertCanonicalDiscordGatewayReady(worker, ready));
  assert.throws(() => deploymentRuntime.assertCanonicalDiscordGatewayReady(worker, {
    ...ready,
    settings: { ...ready.settings, enabled: false },
  }), /Discord integration must be enabled/);
  assert.throws(() => deploymentRuntime.assertCanonicalDiscordGatewayReady(worker, {
    ...ready,
    settings: { ...ready.settings, presence: { enabled: false } },
  }), /Discord presence must be enabled/);
  assert.throws(() => deploymentRuntime.assertCanonicalDiscordGatewayReady(worker, {
    ...ready,
    webSocketAvailable: false,
  }), /WebSocket/);

  const web = deploymentRuntime.resolveDeploymentRuntime({ ...canonicalWorker, BITCRAFT_PROCESS_ROLE: "web" });
  assert.doesNotThrow(() => deploymentRuntime.assertCanonicalDiscordGatewayReady(web, {
    settings: { enabled: false, botToken: "", presence: { enabled: false } },
    webSocketAvailable: false,
  }));
});

test("canonical worker exits when persisted Discord settings disable the gateway", async (t) => {
  const dataDir = path.join(appDir, `.test-deployment-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      ...canonicalWorker,
      BITCRAFT_TEST: "true",
      BITCRAFT_LOCAL_DATA_DIR: dataDir,
      ENABLE_SERVER_POLLING: "false",
      ENABLE_SCHEDULED_JOBS: "false",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        child.kill();
      });
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  const exitCode = await waitForExit(child, 10_000);
  assert.notEqual(exitCode, null, "canonical worker must exit instead of silently skipping its gateway");
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /Discord integration must be enabled/);
});

test("health exposes only safe deployment readiness metadata", () => {
  assert.ok(deploymentRuntime, "deployment runtime module must exist");
  const runtime = deploymentRuntime.resolveDeploymentRuntime(canonicalWorker);
  assert.deepEqual(runtime.health({ version: "0.53.0-beta.1", buildSha: "0123456789ab" }), {
    ok: true,
    deploymentMode: "canonical",
    canonicalOrigin: "https://app.timbersteeltrade.com",
    discordReady: true,
    version: "0.53.0-beta.1",
    buildSha: "0123456789ab",
  });
});

test("production terrain keeps collection in the worker and bundle reads in the web role", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.dependencies.sharp, "0.35.3");
  assert.match(server, /const relayTerrainRuntime = new RelayTerrainRuntime/);
  assert.match(server, /if \(processRoleConfig\.runBackgroundJobs\) startBackgroundTasks\(\)/);
  assert.match(server, /serveLocalMapTile\(url\.pathname, res, terrainTileStore, undefined, relayTerrainRuntime\.health\(\), roadTileStore\)/);
  assert.doesNotMatch(server, /layeredTerrainTileStore|createTerrainOverviewStore/);
  assert.match(server, /await import\("\.\/src\/server\/terrainTileRenderer\.mjs"\)/);
  assert.doesNotMatch(server, /fetch\([^\n]*(?:terrain|map\/tiles)[^\n]*https?:/i);
  assert.deepEqual(processRole.processRoleCapabilities("web"), {
    serveHttp: true,
    runBackgroundJobs: false,
  });
  assert.deepEqual(processRole.processRoleCapabilities("worker"), {
    serveHttp: false,
    runBackgroundJobs: true,
  });
});
