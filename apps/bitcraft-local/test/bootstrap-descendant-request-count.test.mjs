import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";

import { loadBootstrap } from "../src/api/bootstrap.ts";
import { React, installDom, mount } from "./react-dom-test-harness.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const bootstrapFixture = {
  config: { claimId: "55", refreshSeconds: 30, theme: {} },
  auth: {
    authenticated: true,
    user: { id: 1, discordId: "2", username: "tester", globalName: "Tester", avatarUrl: null, characterPlayerId: "", characterName: "", characterStatus: "unlinked", settings: {} },
    csrfToken: "bootstrap-csrf",
    discordLoginEnabled: true,
    legal: { version: "v1", termsDigest: "terms", privacyDigest: "privacy", acceptedAt: "now", requiresAcceptance: false },
  },
  legal: { version: "v1", effectiveDate: "2026-01-01", acceptanceRequired: false, operator: {} },
  build: { version: "test", buildSha: "build-a" },
};

function responseFor(url, { dealWatchUnauthorized = false } = {}) {
  if (url === "/api/local/bootstrap") return bootstrapFixture;
  if (url.includes("/market/regions")) return { regions: [{ regionId: "19", regionName: "Region 19" }] };
  if (url === "/api/local/market/deal-watches") return dealWatchUnauthorized ? { error: "Authentication required" } : { watches: [], settings: {} };
  if (url === "/api/local/config") return bootstrapFixture.config;
  if (url === "/api/local/auth/me") return bootstrapFixture.auth;
  return {};
}

test("direct and refreshed Deal Watch descendants reuse bootstrap auth without auth/me requests", async () => {
  const dom = installDom("http://localhost/?page=market&tab=deal-watch");
  const requests = [];
  const originalFetch = globalThis.fetch;
  let dealWatchUnauthorized = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    const status = dealWatchUnauthorized && url === "/api/local/market/deal-watches" ? 401 : 200;
    return new Response(JSON.stringify(responseFor(url, { dealWatchUnauthorized })), { status, headers: { "content-type": "application/json" } });
  };
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  try {
    const bootstrap = await loadBootstrap(globalThis.fetch);
    const [{ Market }, { PageRefreshProvider }] = await Promise.all([
      vite.ssrLoadModule("/src/pages/MarketPage.tsx"),
      vite.ssrLoadModule("/src/refresh/ManualRefreshContext.tsx"),
    ]);
    const coordinator = { trackPromise: (_cycleId, _taskKey, promise) => promise };
    function DealWatchRoute({ sequence }) {
      const [auth, setAuth] = React.useState(bootstrap.auth);
      const onAuthInvalidated = React.useCallback(() => setAuth((current) => ({ ...current, user: null, csrfToken: null })), []);
      return React.createElement(PageRefreshProvider, {
        page: "market",
        cycle: { id: `market-${sequence}`, page: "market", sequence, reason: "manual", requestedAt: sequence },
        coordinator,
      }, React.createElement(Market, {
        claimId: bootstrap.config.claimId,
        access: null,
        locationSearch: dom.window.location.search,
        fallbackRegionId: "19",
        auth,
        onAuthInvalidated,
        onQueryStateChange() {},
        onNavigate() {},
        onShowMap() {},
        onDiscordLogin() {},
      }));
    }
    const view = await mount(React.createElement(DealWatchRoute, { sequence: 0 }));
    await dom.flush();
    assert.match(document.body.textContent, /Watch item/);

    dealWatchUnauthorized = true;
    await view.render(React.createElement(DealWatchRoute, { sequence: 1 }));
    await dom.flush();

    assert.equal(requests.filter((url) => url === "/api/local/bootstrap").length, 1);
    assert.equal(requests.filter((url) => url === "/api/local/auth/me").length, 0);
    assert.ok(requests.filter((url) => url === "/api/local/market/deal-watches").length >= 2, "refresh still reloads deal data");
    assert.match(document.body.textContent, /Sign in with Discord/);
    assert.doesNotMatch(document.body.textContent, /Watch item/);
    await view.unmount();
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    dom.restore();
  }
});
