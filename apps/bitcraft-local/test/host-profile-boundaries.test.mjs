import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startTestServer(t, { nodeEnv = "development" } = {}) {
  const port = await availablePort();
  const dataDir = path.join(appDir, `.test-host-profiles-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: nodeEnv,
      BITCRAFT_TEST: "true",
      LEGAL_CONFIGURATION_CONFIRMED: "true",
      ENABLE_SERVER_POLLING: "false",
      ENABLE_SCHEDULED_JOBS: "false",
      ENABLE_RELAY_PROVIDER: "false",
      ENABLE_RELAY_GLOBAL_CATALOG: "false",
      BITCRAFT_PROCESS_ROLE: "all",
      APP_HOST: "127.0.0.1",
      APP_PORT: String(port),
      BITCRAFT_LOCAL_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  t.after(async () => {
    if (child.exitCode == null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3_000))]);
    }
    await rm(dataDir, { recursive: true, force: true });
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const health = nodeEnv === "production"
        ? await requestAsHost(origin, "/api/local/health", { host: "app.timbersteeltrade.com" })
        : await fetch(`${origin}/api/local/health`);
      if (health.status === 200 || health.ok) return { origin };
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for the test server: ${stderr}`);
}

async function requestAsHost(origin, pathname, { method = "GET", host } = {}) {
  const { port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const clientRequest = request({
      hostname: "127.0.0.1",
      port,
      method,
      path: pathname,
      headers: { host },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    clientRequest.on("error", reject);
    clientRequest.end();
  });
}

test("development accepts localhost and rejects the retired public alias", async (t) => {
  const { origin } = await startTestServer(t);
  assert.equal((await requestAsHost(origin, "/api/local/health", { host: "127.0.0.1" })).status, 200);
  assert.equal((await requestAsHost(origin, "/api/profile", { host: "127.0.0.1" })).status, 404);
  assert.equal((await requestAsHost(origin, "/api/public/claims/search?q=oak", { host: "127.0.0.1" })).status, 404);
  assert.equal((await requestAsHost(origin, "/", { host: "public.localhost" })).status, 421);
  assert.equal((await requestAsHost(origin, "/", { host: "claim-monitor.com" })).status, 421);
});

test("production accepts the dedicated host and rejects retired and unknown hosts", async (t) => {
  const { origin } = await startTestServer(t, { nodeEnv: "production" });
  assert.equal((await requestAsHost(origin, "/api/local/health", { host: "app.timbersteeltrade.com" })).status, 200);
  assert.equal((await requestAsHost(origin, "/", { host: "claim-monitor.com" })).status, 421);
  assert.equal((await requestAsHost(origin, "/", { host: "www.claim-monitor.com" })).status, 421);
  assert.equal((await requestAsHost(origin, "/", { host: "unknown.example" })).status, 421);
});

test("production accepts only the direct loopback health probe without a canonical host", async (t) => {
  const { origin } = await startTestServer(t, { nodeEnv: "production" });
  assert.equal((await requestAsHost(origin, "/api/local/health", { host: "127.0.0.1" })).status, 200);
  assert.equal((await requestAsHost(origin, "/api/profile", { host: "127.0.0.1" })).status, 421);
  assert.equal((await requestAsHost(origin, "/api/local/members", { host: "127.0.0.1" })).status, 421);
});
