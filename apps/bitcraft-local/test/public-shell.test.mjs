import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publicClaimPath, publicStorageKey, resolvePublicRoute } from "../src/public/routes.mjs";
import { addRecentClaim, claimPreferenceKey, readRecentClaims } from "../src/public/preferences.mjs";
import { createVisibleRefreshController } from "../src/public/visibleRefresh.mjs";

test("public routes use claim URLs and canonicalize legacy bookmarks", () => {
  assert.deepEqual(resolvePublicRoute("/"), { id: "home", params: {} });
  assert.deepEqual(resolvePublicRoute("/claims/42"), { id: "dashboard", params: { claimId: "42" } });
  assert.deepEqual(resolvePublicRoute("/claims/42/professions"), { id: "professions", params: { claimId: "42" } });
  assert.deepEqual(resolvePublicRoute("/settlements/42/members"), {
    id: "members",
    params: { claimId: "42" },
    canonicalPath: "/claims/42/members",
  });
  assert.deepEqual(resolvePublicRoute("/claims/42/map"), {
    id: "coming-soon",
    params: { claimId: "42", feature: "map" },
  });
  assert.deepEqual(resolvePublicRoute("/calculator"), { id: "calculator", params: {} });
  assert.deepEqual(resolvePublicRoute("/settings"), { id: "settings", params: {} });
  assert.deepEqual(resolvePublicRoute("/admin"), { id: "not-found", params: {} });
});

test("public name and exact-ID search hints select their server claim IDs", () => {
  assert.equal(
    publicClaimPath({ claimId: "42", name: "Northwatch", regionId: "7" }),
    "/claims/42",
    "name-search hints must select the server claimId",
  );
  assert.equal(
    publicClaimPath({ claimId: "18446744073709551615", name: "Exact match", regionId: "7" }),
    "/claims/18446744073709551615",
    "exact-ID search hints must preserve the complete canonical claimId",
  );
  assert.equal(publicClaimPath({ entityId: "42" }), null, "legacy entityId must not become a public URL authority");
  assert.equal(publicClaimPath({ claimId: "18446744073709551616" }), null, "overflowing claim IDs must remain invalid");
});

test("public route declarations include every runtime route helper used by the shell", () => {
  const declarations = readFileSync(new URL("../src/public/routes.d.mts", import.meta.url), "utf8");
  assert.match(declarations, /export function publicClaimPath\(/);
  assert.match(declarations, /canonicalPath\?: string/);
  for (const routeId of ["home", "dashboard", "members", "professions", "inventory", "crafts", "calculator", "account", "settings", "help", "terms", "privacy", "coming-soon"]) {
    assert.match(declarations, new RegExp(`"${routeId}"`), `${routeId} must remain represented in the public route declaration`);
  }
});

test("claim-named preferences retain existing recent-claim storage", () => {
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };

  addRecentClaim(localStorage, { claimId: "42", name: "Northwatch", regionId: "7" });
  addRecentClaim(localStorage, { claimId: "19", name: "Riverbend", regionId: "7" });
  addRecentClaim(localStorage, { claimId: "42", name: "Northwatch Updated", regionId: "7" });

  assert.deepEqual(readRecentClaims(localStorage), [
    { claimId: "42", name: "Northwatch Updated", regionId: "7" },
    { claimId: "19", name: "Riverbend", regionId: "7" },
  ]);
  assert.equal(claimPreferenceKey("42", "inventory-filter"), "claim-monitor.public.settlement.42.inventory-filter");
  assert.equal(publicStorageKey("recent-settlements"), "claim-monitor.public.recent-settlements");
  assert.throws(() => claimPreferenceKey("42/other", "inventory-filter"), /claim/i);
});

test("visible refresh pauses while hidden, catches up once, and does not bypass server cache", async () => {
  let visible = true;
  let scheduled = null;
  let refreshes = 0;
  const controller = createVisibleRefreshController({
    intervalMs: 60_000,
    isVisible: () => visible,
    setInterval: (callback, ms) => {
      scheduled = { callback, ms };
      return 9;
    },
    clearInterval: (id) => {
      assert.equal(id, 9);
      scheduled = null;
    },
    refresh: async () => { refreshes += 1; },
  });

  controller.start();
  assert.equal(scheduled.ms, 60_000);
  await scheduled.callback();
  assert.equal(refreshes, 1);

  visible = false;
  controller.visibilityChanged();
  assert.equal(scheduled, null);
  visible = true;
  controller.visibilityChanged();
  await Promise.resolve();
  assert.equal(refreshes, 2, "one catch-up refresh runs when the page becomes visible");
  assert.equal(scheduled.ms, 60_000);
  controller.stop();
});

test("public shell stays isolated from Timbersteel bootstrap, featurebase, analytics, and app shell imports", () => {
  const root = readFileSync(new URL("../src/public/PublicRoot.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../src/public/PublicAppShell.tsx", import.meta.url), "utf8");
  const claimPages = readFileSync(new URL("../src/public/PublicClaimPages.tsx", import.meta.url), "utf8");
  const api = readFileSync(new URL("../src/public/api.ts", import.meta.url), "utf8");
  const planAccess = readFileSync(new URL("../src/public/PublicPlanAccessPage.tsx", import.meta.url), "utf8");
  const planApi = readFileSync(new URL("../src/public/planApi.ts", import.meta.url), "utf8");
  const joined = `${root}\n${shell}\n${claimPages}\n${api}\n${planAccess}\n${planApi}`;

  for (const forbidden of ["TimbersteelRoot", "loadBootstrap", "Featurebase", "analytics", "useGameDataGeneration", "Admin", "BotControlApp", "/api/local/"]) {
    assert.equal(joined.includes(forbidden), false, `public shell must not depend on ${forbidden}`);
  }
  assert.doesNotMatch(joined, /from\s+["']\.\.\/AppShell["']/);
  assert.match(api, /\/api\/public\/settlements/);
  assert.match(claimPages, /catalogKey/);
});

test("public profile composes the shared application chrome", () => {
  const chrome = readFileSync(new URL("../src/public/PublicChrome.tsx", import.meta.url), "utf8");
  for (const component of ["AppFrame", "AppSidebar", "AppUtilityBar", "AppFooter"]) {
    assert.match(chrome, new RegExp(`<${component}`));
  }
  assert.doesNotMatch(chrome, /public-app-shell|public-sidebar/);
});
