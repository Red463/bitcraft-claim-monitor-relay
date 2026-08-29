import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

import { legalPolicyForEnvironment } from "../src/legal/legalPolicy.mjs";
import { legalPolicyDigests } from "../src/server/legalPolicyDigest.mjs";
import { createTimbersteelFetch } from "./support/timbersteelFetch.mjs";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEST_WRITE_BUSY_TIMEOUT_MS = 5_000;
const { fetch, registerOrigin } = createTimbersteelFetch();

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(origin, child) {
  registerOrigin(origin);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Server exited with ${child.exitCode}: ${child.previewError ?? ""}`);
    try {
      if ((await fetch(`${origin}/api/local/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for preview test server");
}

async function stop(child) {
  if (child.exitCode != null) return;
  child.kill();
  await new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 3_000); });
}

function writableTestDatabase(dbPath, { busyTimeoutMs = TEST_WRITE_BUSY_TIMEOUT_MS } = {}) {
  return new DatabaseSync(dbPath, { timeout: busyTimeoutMs });
}

function session(dbPath, discordId, options = {}) {
  const token = `session-${discordId}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const csrf = createHash("sha256").update(`csrf:${token}`).digest("base64url");
  const legal = legalPolicyForEnvironment({});
  const digests = legalPolicyDigests(legal);
  const db = writableTestDatabase(dbPath, options);
  try {
    const userId = Number(db.prepare(`INSERT INTO user_accounts (
      discord_id, discord_username, character_status, settings_json, created_at
    ) VALUES (?, ?, 'unlinked', '{}', ?) RETURNING id`).get(discordId, discordId, new Date().toISOString()).id);
    db.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, userId, "2099-01-01T00:00:00.000Z", new Date().toISOString());
    db.prepare(`INSERT INTO user_legal_acceptances (
      user_id, legal_version, terms_digest, privacy_digest, age_confirmed, accepted_at, source
    ) VALUES (?, ?, ?, ?, 1, ?, 'existing-session')`).run(
      userId, legal.version, digests.termsDigest, digests.privacyDigest, new Date().toISOString(),
    );
    return { userId, cookie: `bitcraft_user_session=${encodeURIComponent(token)}`, csrf };
  } finally {
    db.close();
  }
}

function adminSession(dbPath, username) {
  const token = createHash("sha256").update(`admin:${username}:${Date.now()}:${Math.random()}`).digest("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const csrfToken = createHash("sha256").update(`csrf:${token}`).digest("base64url");
  const db = writableTestDatabase(dbPath);
  try {
    const now = new Date().toISOString();
    const userId = db.prepare(`INSERT INTO admin_users (
      username, password_hash, role, active, created_at
    ) VALUES (?, 'discord-oauth-admin', 'owner', 1, ?) RETURNING id`).get(username, now).id;
    db.prepare("INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, userId, "2099-01-01T00:00:00.000Z", now);
    return { cookie: `bitcraft_admin_session=${encodeURIComponent(token)}`, csrfToken };
  } finally {
    db.close();
  }
}

async function holdWriteLock(dbPath, durationMs) {
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(workerData.dbPath);
    db.exec("BEGIN IMMEDIATE");
    parentPort.postMessage("locked");
    setTimeout(() => {
      db.exec("COMMIT");
      db.close();
    }, workerData.durationMs);
  `, { eval: true, workerData: { dbPath, durationMs } });
  await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", resolve);
  });
  return worker;
}

test("session fixture waits for transient writers without hiding persistent database locks", async (t) => {
  const dataDir = path.join(appDir, `.test-preview-session-lock-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "fixture.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE user_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT, discord_username TEXT, character_status TEXT, settings_json TEXT, created_at TEXT
    );
    CREATE TABLE user_sessions (token_hash TEXT, user_id INTEGER, expires_at TEXT, created_at TEXT);
    CREATE TABLE user_legal_acceptances (
      user_id INTEGER, legal_version TEXT, terms_digest TEXT, privacy_digest TEXT,
      age_confirmed INTEGER, accepted_at TEXT, source TEXT
    );
  `);
  db.close();
  const workers = [];
  t.after(async () => {
    await Promise.all(workers.map((worker) => worker.terminate()));
    await rm(dataDir, { recursive: true, force: true });
  });

  workers.push(await holdWriteLock(dbPath, 100));
  assert.equal(session(dbPath, "transient", { busyTimeoutMs: 1_000 }).userId, 1);

  workers.push(await holdWriteLock(dbPath, 500));
  assert.throws(() => session(dbPath, "persistent", { busyTimeoutMs: 50 }), /database is locked/i);
});

test("preview HTTP routes enforce auth, ownership, CSRF, rate limiting, and never persist staged changes", async (t) => {
  const port = await availablePort();
  const dataDir = path.join(appDir, `.test-preview-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LEGAL_CONFIGURATION_CONFIRMED: "true",
      BITCRAFT_TEST: "true",
      ENABLE_LEGACY_ADMIN_PASSWORD_AUTH: "true",
      ENABLE_SERVER_POLLING: "false",
      ENABLE_SCHEDULED_JOBS: "false",
      BITCRAFT_PROCESS_ROLE: "all",
      ADMIN_SETUP_KEY: "preview-setup",
      APP_HOST: "127.0.0.1",
      APP_PORT: String(port),
      BITCRAFT_LOCAL_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.previewError = "";
  child.stderr.on("data", (chunk) => { child.previewError += String(chunk); });
  t.after(async () => { await stop(child); await rm(dataDir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${port}`;
  await waitForHealth(origin, child);
  const dbPath = path.join(dataDir, "bitcraft-local.sqlite");

  const adminAuth = adminSession(dbPath, "preview-admin");
  const adminCookie = adminAuth.cookie;
  const adminPlansResponse = await fetch(`${origin}/api/local/admin/craft-plans`, { headers: { cookie: adminCookie, origin, "x-csrf-token": adminAuth.csrfToken } });
  const adminPlans = await adminPlansResponse.json();
  assert.equal(adminPlansResponse.status, 200, JSON.stringify(adminPlans));
  const sharedId = adminPlans.plans[0].id;
  const adminPreviewUrl = `${origin}/api/local/admin/craft-plans/${encodeURIComponent(sharedId)}/preview`;
  assert.equal((await fetch(adminPreviewUrl, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await fetch(adminPreviewUrl, { method: "POST", headers: { cookie: adminCookie, origin, "content-type": "application/json" }, body: "{}" })).status, 403);
  assert.equal((await fetch(adminPreviewUrl, { method: "POST", headers: { cookie: adminCookie, origin: "https://attacker.example", "content-type": "application/json", "x-csrf-token": adminAuth.csrfToken }, body: "{}" })).status, 403);

  const beforeAdmin = new DatabaseSync(dbPath, { readOnly: true });
  const adminCounts = {
    plans: beforeAdmin.prepare("SELECT COUNT(*) AS count FROM craft_plans").get().count,
    audits: beforeAdmin.prepare("SELECT COUNT(*) AS count FROM craft_plan_config_audit").get().count,
    reviews: beforeAdmin.prepare("SELECT COUNT(*) AS count FROM craft_plan_route_reviews").get().count,
    progress: beforeAdmin.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_snapshots").get().count,
  };
  beforeAdmin.close();
  const adminPreview = await fetch(adminPreviewUrl, {
    method: "POST",
    headers: { cookie: adminCookie, origin, "content-type": "application/json", "x-csrf-token": adminAuth.csrfToken },
    body: JSON.stringify({ config: { enabled: false, targets: [] } }),
  });
  assert.equal(adminPreview.status, 200);
  const adminBody = await adminPreview.json();
  assert.equal(adminBody.scope, "shared");
  assert.equal(adminBody.validation.valid, true);
  assert.match(adminBody.fingerprint, /^[a-f0-9]{64}$/);

  const owner = session(dbPath, "owner");
  const other = session(dbPath, "other");
  const ownerHeaders = { cookie: owner.cookie, origin, "content-type": "application/json", "x-csrf-token": owner.csrf };
  const created = await fetch(`${origin}/api/local/user/craft-plans`, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ name: "Private preview" }),
  }).then((response) => response.json());
  const personalId = created.plan.id;
  const personalPreviewUrl = `${origin}/api/local/user/craft-plans/${encodeURIComponent(personalId)}/preview`;
  assert.equal((await fetch(personalPreviewUrl, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await fetch(personalPreviewUrl, { method: "POST", headers: { cookie: other.cookie, origin, "content-type": "application/json", "x-csrf-token": other.csrf }, body: "{}" })).status, 404);
  const personalPreview = await fetch(personalPreviewUrl, {
    method: "POST", headers: ownerHeaders, body: JSON.stringify({ config: { enabled: false, targets: [] } }),
  });
  assert.equal(personalPreview.status, 200);
  assert.equal((await personalPreview.json()).scope, "personal");

  const after = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(after.prepare("SELECT revision FROM craft_plans WHERE id = ?").get(sharedId).revision, 1);
  assert.equal(after.prepare("SELECT revision FROM craft_plans WHERE id = ?").get(personalId).revision, 1);
  assert.equal(after.prepare("SELECT COUNT(*) AS count FROM craft_plans").get().count, adminCounts.plans + 1);
  assert.equal(after.prepare("SELECT COUNT(*) AS count FROM craft_plan_config_audit").get().count, adminCounts.audits + 1);
  assert.equal(after.prepare("SELECT COUNT(*) AS count FROM craft_plan_route_reviews").get().count, adminCounts.reviews);
  assert.equal(after.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_snapshots").get().count, adminCounts.progress);
  after.close();

  const firstSave = await fetch(`${origin}/api/local/user/craft-plans/${encodeURIComponent(personalId)}`, {
    method: "PUT",
    headers: ownerHeaders,
    body: JSON.stringify({ expectedRevision: 1, name: "Private preview", config: { enabled: false, targets: [] } }),
  });
  const firstSaveBody = await firstSave.json();
  assert.equal(firstSave.status, 200, JSON.stringify(firstSaveBody));
  assert.equal(firstSaveBody.planRecord.revision, 2);
  const beforeConflict = new DatabaseSync(dbPath, { readOnly: true });
  const historyBeforeConflict = beforeConflict.prepare("SELECT COUNT(*) AS count FROM craft_plan_config_audit WHERE plan_id = ?").get(personalId).count;
  beforeConflict.close();
  const staleSave = await fetch(`${origin}/api/local/user/craft-plans/${encodeURIComponent(personalId)}`, {
    method: "PUT",
    headers: ownerHeaders,
    body: JSON.stringify({
      expectedRevision: 1,
      name: "Overwritten",
      config: { enabled: true, targets: [], sourceRules: { playerIds: ["999999"] } },
    }),
  });
  assert.equal(staleSave.status, 409);
  const conflict = await staleSave.json();
  assert.equal(conflict.code, "craft_plan_revision_conflict");
  assert.equal(conflict.conflict.currentRevision, 2);
  assert.equal(conflict.conflict.plan.id, personalId);
  const conflictDb = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(conflictDb.prepare("SELECT revision FROM craft_plans WHERE id = ?").get(personalId).revision, 2);
  assert.equal(conflictDb.prepare("SELECT name FROM craft_plans WHERE id = ?").get(personalId).name, "Private preview");
  assert.equal(conflictDb.prepare("SELECT COUNT(*) AS count FROM craft_plan_config_audit WHERE plan_id = ?").get(personalId).count, historyBeforeConflict);
  assert.equal(conflictDb.prepare("SELECT COUNT(*) AS count FROM craft_plan_route_reviews WHERE plan_id = ?").get(personalId).count, 0);
  conflictDb.close();
  const rebasedSave = await fetch(`${origin}/api/local/user/craft-plans/${encodeURIComponent(personalId)}`, {
    method: "PUT",
    headers: ownerHeaders,
    body: JSON.stringify({ expectedRevision: conflict.conflict.currentRevision, name: "Rebased", config: { enabled: false, targets: [] } }),
  });
  assert.equal(rebasedSave.status, 200);
  assert.equal((await rebasedSave.json()).planRecord.revision, 3);

  let limited;
  for (let index = 0; index < 65; index += 1) {
    const response = await fetch(adminPreviewUrl, {
      method: "POST",
      headers: { cookie: adminCookie, origin, "content-type": "application/json", "x-csrf-token": adminAuth.csrfToken },
      body: JSON.stringify({ config: { enabled: false, targets: [] } }),
    });
    if (response.status === 429) { limited = response; break; }
  }
  assert.equal(limited?.status, 429);
});

test("legacy admin save enforces revision and ambiguous-route review atomically", async (t) => {
  const port = await availablePort();
  const dataDir = path.join(appDir, `.test-legacy-craft-plan-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LEGAL_CONFIGURATION_CONFIRMED: "true",
      BITCRAFT_TEST: "true",
      ENABLE_LEGACY_ADMIN_PASSWORD_AUTH: "true",
      ENABLE_SERVER_POLLING: "false",
      ENABLE_SCHEDULED_JOBS: "false",
      BITCRAFT_PROCESS_ROLE: "all",
      ADMIN_SETUP_KEY: "legacy-save-setup",
      APP_HOST: "127.0.0.1",
      APP_PORT: String(port),
      BITCRAFT_LOCAL_DATA_DIR: dataDir,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.previewError = "";
  child.stderr.on("data", (chunk) => { child.previewError += String(chunk); });
  t.after(async () => { await stop(child); await rm(dataDir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${port}`;
  await waitForHealth(origin, child);
  const dbPath = path.join(dataDir, "bitcraft-local.sqlite");

  const adminAuth = adminSession(dbPath, "legacy-save-admin");
  const adminCookie = adminAuth.cookie;
  const headers = { cookie: adminCookie, origin, "content-type": "application/json", "x-csrf-token": adminAuth.csrfToken };
  const plansResponse = await fetch(`${origin}/api/local/admin/craft-plans`, { headers });
  const plans = await plansResponse.json();
  assert.equal(plansResponse.status, 200, JSON.stringify(plans));
  const planId = plans.plans[0].id;
  const legacyUrl = `${origin}/api/local/admin/craft-plan?planId=${encodeURIComponent(planId)}`;
  const initialDb = new DatabaseSync(dbPath, { readOnly: true });
  const initialAuditCount = initialDb.prepare("SELECT COUNT(*) AS count FROM craft_plan_config_audit WHERE plan_id = ?").get(planId).count;
  initialDb.close();

  const stale = await fetch(legacyUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({ expectedRevision: 0, config: { enabled: false, targets: [] } }),
  });
  const staleBody = await stale.json();
  assert.equal(stale.status, 409, JSON.stringify(staleBody));
  assert.equal(staleBody.code, "craft_plan_revision_conflict");
  assert.equal(staleBody.conflict.currentRevision, 1);
  assert.equal(staleBody.conflict.plan.id, planId);
  const afterStale = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(afterStale.prepare("SELECT revision FROM craft_plans WHERE id = ?").get(planId).revision, 1);
  assert.equal(afterStale.prepare("SELECT COUNT(*) AS count FROM craft_plan_config_audit WHERE plan_id = ?").get(planId).count, initialAuditCount);
  assert.equal(afterStale.prepare("SELECT COUNT(*) AS count FROM craft_plan_route_reviews WHERE plan_id = ?").get(planId).count, 0);
  afterStale.close();

  const catalogDb = writableTestDatabase(dbPath);
  catalogDb.exec(`
    INSERT INTO game_catalog_entities (catalog_key, kind, target_id, item_type, name, updated_at) VALUES
      ('items:9001', 'items', '9001', 0, 'Plate', 'catalog-v1'),
      ('items:9002', 'items', '9002', 0, 'Ore A', 'catalog-v1'),
      ('items:9003', 'items', '9003', 0, 'Ore B', 'catalog-v1');
    INSERT INTO game_catalog_recipes (
      recipe_key, source_kind, source_id, action_count, activity_kind, gathering_mode,
      name, station_name, skill_name, is_passive, is_transport_route, updated_at
    ) VALUES
      ('recipe:plate-a', 'crafting_recipe', 'plate-a', 1, 'craft', 'ordinary', 'Plate route A', 'Forge', 'Smithing', 0, 0, 'catalog-v1'),
      ('recipe:plate-b', 'crafting_recipe', 'plate-b', 1, 'craft', 'ordinary', 'Plate route B', 'Forge', 'Smithing', 0, 0, 'catalog-v1');
    INSERT INTO game_catalog_recipe_outputs (
      recipe_key, output_key, kind, target_id, quantity, occurrence_rate, yield_basis, guaranteed_quantity, is_primary_output
    ) VALUES
      ('recipe:plate-a', 'items:9001', 'items', '9001', 1, 1, 'per_craft', 1, 1),
      ('recipe:plate-b', 'items:9001', 'items', '9001', 1, 1, 'per_craft', 1, 1);
    INSERT INTO game_catalog_recipe_inputs (recipe_key, input_key, kind, target_id, quantity) VALUES
      ('recipe:plate-a', 'items:9002', 'items', '9002', 1),
      ('recipe:plate-b', 'items:9003', 'items', '9003', 1);
  `);
  catalogDb.close();

  const stagedConfig = {
    name: "Default",
    enabled: true,
    targets: [{ id: "9001", kind: "items", name: "Plate", quantity: 1 }],
  };
  const gated = await fetch(legacyUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({ expectedRevision: 1, config: stagedConfig }),
  });
  const gatedBody = await gated.json();
  assert.equal(gated.status, 409, JSON.stringify(gatedBody));
  assert.equal(gatedBody.code, "craft_plan_route_review_required");
  assert.equal(gatedBody.unconfirmedRoutes.length, 1);
  assert.equal(gatedBody.unconfirmedRoutes[0].outputKey, "items:9001");
  const afterGate = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(afterGate.prepare("SELECT revision FROM craft_plans WHERE id = ?").get(planId).revision, 1);
  assert.equal(afterGate.prepare("SELECT COUNT(*) AS count FROM craft_plan_config_audit WHERE plan_id = ?").get(planId).count, initialAuditCount);
  assert.equal(afterGate.prepare("SELECT COUNT(*) AS count FROM craft_plan_route_reviews WHERE plan_id = ?").get(planId).count, 0);
  afterGate.close();

  const confirmation = gatedBody.unconfirmedRoutes[0];
  const saved = await fetch(legacyUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      expectedRevision: 1,
      config: stagedConfig,
      routeReviewConfirmations: [{
        outputKey: confirmation.outputKey,
        fingerprint: confirmation.fingerprint,
        selectedRouteId: confirmation.preselectedRouteId,
      }],
    }),
  });
  const savedBody = await saved.json();
  assert.equal(saved.status, 200, JSON.stringify(savedBody));
  assert.equal(savedBody.planRecord.revision, 2);
  const afterSave = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(afterSave.prepare("SELECT revision FROM craft_plans WHERE id = ?").get(planId).revision, 2);
  assert.equal(afterSave.prepare("SELECT COUNT(*) AS count FROM craft_plan_config_audit WHERE plan_id = ?").get(planId).count, initialAuditCount + 1);
  assert.equal(afterSave.prepare("SELECT COUNT(*) AS count FROM craft_plan_route_reviews WHERE plan_id = ? AND review_status = 'confirmed'").get(planId).count, 1);
  afterSave.close();
});
