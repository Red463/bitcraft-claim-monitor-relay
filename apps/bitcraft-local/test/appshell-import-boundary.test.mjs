import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadBootstrap } from "../src/api/bootstrap.ts";

const bootstrapFixture = {
  config: { claimId: "998877665544332211", refreshSeconds: 30 },
  auth: {
    authenticated: true,
    user: null,
    csrfToken: null,
    discordLoginEnabled: false,
    retiredIdentityToken: "signed-retired-token",
    legal: { version: "2026-08", termsDigest: "terms", privacyDigest: "privacy", acceptedAt: null, requiresAcceptance: false },
  },
  legal: {
    version: "2026-08",
    termsDigest: "terms",
    privacyDigest: "privacy",
    terms: "Terms",
    privacy: "Privacy",
    acceptanceRequired: false,
  },
  build: { version: "0.58.0-beta.4", buildSha: "c081890cc330" },
};

test("browser bootstrap makes one request, preserves the resolved claim, and discards retired identity fields", async () => {
  const requests = [];
  const bootstrap = await loadBootstrap(async (input, init) => {
    requests.push({ input: String(input), init });
    return new Response(JSON.stringify(bootstrapFixture), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.deepEqual(requests.map(({ input }) => input), ["/api/local/bootstrap"]);
  assert.equal(requests[0].init.cache, "no-store");
  assert.equal(bootstrap.config.claimId, "998877665544332211");
  assert.equal("retiredIdentityToken" in bootstrap.auth, false);
});

test("browser bootstrap fails closed before any claim can be selected and can be retried", async () => {
  let requests = 0;
  const fetchInvalidBootstrap = async () => {
    requests += 1;
    return new Response(JSON.stringify({ ...bootstrapFixture, config: { refreshSeconds: 30 } }), { status: 200 });
  };

  await assert.rejects(loadBootstrap(fetchInvalidBootstrap), /claim/i);
  await assert.rejects(loadBootstrap(fetchInvalidBootstrap), /claim/i);
  assert.equal(requests, 2, "each explicit retry should make one new bootstrap request");
});

test("AppShell imports only top-level shell dependencies after admin/settings extraction", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.equal(appShell.includes("./components/bot/"), false);
  assert.doesNotMatch(appShell, /DashboardWidgets|DataTable|ItemDisplay|SearchBox|Segmented|Stats/);
  assert.doesNotMatch(appShell, /buildConstructionProjects|constructionNeededMaterials|mapWithBrowserConcurrency|discordColorToHex|NOTIFICATION_SOUND_OPTIONS|THEME_FIELD_GROUPS/);
  assert.match(appShell, /lazyRoute\(\(\) => import\("\.\/components\/admin\/AdminPanel"\)/);
  assert.equal(appShell.includes('import { UserSettingsDialog } from "./components/main/UserSettingsDialog";'), true);
  assert.match(appShell, /from "\.\/components\/app-chrome"/);
});

test("main starts the dedicated root and TimbersteelRoot gates AppShell on bootstrap", () => {
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const timbersteelRoot = readFileSync(new URL("../src/TimbersteelRoot.tsx", import.meta.url), "utf8");
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(main, /import TimbersteelRoot from "\.\/TimbersteelRoot"/);
  assert.match(main, /render\(<TimbersteelRoot \/>\)/);
  assert.doesNotMatch(main, /loadHostProfile|PublicRoot|src\/public/);
  assert.match(timbersteelRoot, /loadBootstrap/);
  assert.match(timbersteelRoot, /React\.lazy\(\(\) => import\("\.\/AppShell"\)\)/);
  assert.match(timbersteelRoot, /<App initialBootstrap=\{bootstrap\}/);
  assert.doesNotMatch(main, /\/api\/local\/auth\/me/);
  assert.match(appShell, /function DashboardApp\(\{ initialBootstrap \}/);
  assert.match(appShell, /useState\<AppSettings\>\(\(\) => normalizeAppSettings\(initialBootstrap\.config\)\)/);
  assert.match(appShell, /useState\(initialBootstrap\.config\.claimId\)/);
  assert.doesNotMatch(appShell, /useState\(DEFAULT_CLAIM_ID\)/);
  assert.match(appShell, /<Market[^>]*auth=\{userAuth\}/);
  assert.match(appShell, /<BotControlApp initialConfig=\{initialBootstrap\.config\}/);
});

test("administrator settings stay behind authenticated admin loading instead of public bootstrap", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const adminSession = readFileSync(new URL("../src/api/adminSession.ts", import.meta.url), "utf8");

  assert.match(appShell, /loadAdminConsoleSession\(fetch\)/);
  assert.match(adminSession, /if \(!auth\?\.authenticated\)/);
  assert.match(adminSession, /fetchImpl\(`\$\{LOCAL_API\}\/admin\/settings`/);
});

test("AppShell wires public access-control decisions into navigation and blocked states", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /\/access-control\/effective/);
  assert.match(appShell, /effectiveTargetAllowed/);
  assert.match(appShell, /targetIdForPage/);
  assert.match(appShell, /RestrictedAccessState/);
  assert.doesNotMatch(appShell, /visibleItems = group\.items\.filter/);
  assert.match(appShell, /const restricted = !isPageAllowed\(id\)/);
});
