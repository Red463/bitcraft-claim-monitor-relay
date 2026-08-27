import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function source(relativePath) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

test("dedicated application anchors survive public profile removal", () => {
  const requiredDedicatedAnchors = [
    ["src/AppShell.tsx", 'const LOCAL_API = "/api/local"'],
    ["src/AppShell.tsx", "PublicCraftFinderPage"],
    ["src/TimbersteelRoot.tsx", "FeaturebaseProvider"],
    ["server.mjs", "createDiscordOutboxLeaser"],
    ["src/server/preparedStatements.mjs", "craft_plan_settings"],
    ["worker.mjs", "BITCRAFT_PROCESS_ROLE"],
  ];
  for (const [relativePath, anchor] of requiredDedicatedAnchors) {
    assert.ok(source(relativePath).includes(anchor), `${relativePath} must retain ${anchor}`);
  }

  for (const relativePath of [
    "src/pages/PublicCraftFinderPage.tsx",
    "src/pages/publicCraftMath.ts",
    "src/styles/public-craft.css",
    "src/server/game-data/publicCraftRuntime.ts",
    "src/server/game-data/publicCraftRegionSession.ts",
    "src/server/game-data/publicCraftProjection.ts",
    "test/server-security-boundaries.test.mjs",
  ]) {
    assert.equal(existsSync(path.join(appRoot, relativePath)), true, `${relativePath} must remain present`);
  }
});

test("dedicated routes, cookies, and browser preference namespaces remain stable", () => {
  const shell = source("src/AppShell.tsx");
  const navigation = source("src/navigation.ts");
  const sessions = source("src/server/serverSessions.mjs");
  const preferences = source("src/hooks/usePersistedState.ts");

  for (const route of ["/bot", "/terms", "/privacy"]) assert.ok(shell.includes(route));
  for (const page of [
    "dashboard", "leaderboard", "members", "skills", "craft-monitor", "planning",
    "inventory", "construction", "research", "settlement-market", "market", "region",
    "empires", "map", "activity", "publiccrafts", "craftcalc", "sync", "admin",
  ]) assert.ok(navigation.includes(`\"${page}\"`), `navigation must retain ${page}`);

  assert.ok(sessions.includes('ADMIN_SESSION_COOKIE_NAME = "bitcraft_admin_session"'));
  assert.ok(sessions.includes('APP_USER_SESSION_COOKIE_NAME = "bitcraft_user_session"'));
  assert.ok(preferences.includes('STORAGE_PREFIX = "claim-monitor."'));
});

test("dedicated security regression coverage remains active", () => {
  const securityTests = source("test/server-security-boundaries.test.mjs");
  assert.ok(securityTests.includes("final active owner remains enabled"));
  assert.ok(securityTests.includes("owner role changes revoke affected sessions"));
  assert.ok(securityTests.includes("Discord commands from another guild are rejected before dispatch"));
  assert.ok(securityTests.includes("Admin session outside Timbersteel OAuth"));
});
