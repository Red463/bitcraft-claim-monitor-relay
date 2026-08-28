import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";

import { loadBootstrap } from "../src/api/bootstrap.ts";
import { React, installDom, mount } from "./react-dom-test-harness.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const bootstrapFixture = {
  config: { claimId: "55", refreshSeconds: 30, theme: {} },
  auth: { authenticated: false, user: null, csrfToken: null, discordLoginEnabled: true, legal: { version: "v1", termsDigest: "terms", privacyDigest: "privacy", acceptedAt: null, requiresAcceptance: false } },
  legal: { version: "v1", effectiveDate: "2026-01-01", acceptanceRequired: false, operator: {} },
  build: { version: "test", buildSha: "build-a" },
};
const authenticatedAdmin = {
  authenticated: true,
  csrfToken: "admin-csrf",
  roles: { owner: "Owner" },
  user: { id: 1, username: "owner", permissions: ["*"] },
};
const protectedAdminSettings = {
  ...bootstrapFixture.config,
  discord: { enabled: true, guildId: "protected-guild-id", applicationId: "protected-application-id", botTokenConfigured: true, botTokenSource: "environment" },
  visitorSecurity: { fullIpRetentionDays: 7, statsRetentionDays: 180, geoipCacheDays: 14, geoipProvider: "disabled" },
};

function ConsoleProbe({ settings, resolvedAuth }) {
  return resolvedAuth.authenticated
    ? React.createElement("section", { className: "bot-console", "data-guild-id": settings.discord.guildId }, React.createElement("button", null, "Save protected settings"))
    : React.createElement("section", { className: "bot-sign-in" }, "Sign in with an approved Discord administrator account");
}

test("/bot gates writable controls on authenticated protected settings and fails closed otherwise", async () => {
  const dom = installDom("http://localhost/bot");
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const requests = [];
  const originalFetch = globalThis.fetch;
  let adminMode = "authenticated";
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, method: init.method ?? "GET" });
    if (adminMode === "settings-error" && url === "/api/local/admin/settings") {
      return new Response(JSON.stringify({ error: "protected settings unavailable" }), { status: 503 });
    }
    const body = url === "/api/local/bootstrap" ? bootstrapFixture
      : url === "/api/local/config" ? bootstrapFixture.config
        : url === "/api/local/admin/me" ? adminMode === "signed-out" ? { authenticated: false, discordLoginEnabled: true } : authenticatedAdmin
          : url === "/api/local/admin/settings" ? protectedAdminSettings
            : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  try {
    const bootstrap = await loadBootstrap(globalThis.fetch);
    const { BotControlApp } = await vite.ssrLoadModule("/src/AppShell.tsx");

    let view = await mount(React.createElement(BotControlApp, { initialConfig: bootstrap.config, renderConsole: (props) => React.createElement(ConsoleProbe, props) }));
    await dom.flush();
    assert.equal(requests.filter(({ url }) => url === "/api/local/bootstrap").length, 1);
    assert.equal(requests.filter(({ url }) => url === "/api/local/config").length, 0);
    assert.equal(requests.filter(({ url }) => url === "/api/local/admin/me").length, 1);
    assert.equal(requests.filter(({ url, method }) => url === "/api/local/admin/settings" && method === "GET").length, 1);
    assert.equal(document.querySelector(".bot-console")?.getAttribute("data-guild-id"), "protected-guild-id");
    assert.match(document.body.textContent, /Save protected settings/);
    await view.unmount();

    requests.length = 0;
    view = await mount(React.createElement(BotControlApp, { renderConsole: (props) => React.createElement(ConsoleProbe, props) }));
    await dom.flush();
    assert.equal(requests.filter(({ url }) => url === "/api/local/config").length, 1, "legacy rendering retains its compatibility config request");
    assert.equal(requests.filter(({ url }) => url === "/api/local/admin/settings").length, 1);
    await view.unmount();

    requests.length = 0;
    adminMode = "signed-out";
    view = await mount(React.createElement(BotControlApp, { initialConfig: bootstrap.config, renderConsole: (props) => React.createElement(ConsoleProbe, props) }));
    await dom.flush();
    assert.equal(requests.filter(({ url }) => url === "/api/local/admin/settings").length, 0);
    assert.match(document.body.textContent, /Sign in with an approved Discord administrator account/);
    assert.equal(document.querySelector(".bot-console"), null);
    assert.doesNotMatch(document.body.textContent, /Save protected settings/);
    await view.unmount();

    requests.length = 0;
    adminMode = "settings-error";
    view = await mount(React.createElement(BotControlApp, { initialConfig: bootstrap.config, renderConsole: (props) => React.createElement(ConsoleProbe, props) }));
    await dom.flush();
    assert.equal(requests.filter(({ url }) => url === "/api/local/admin/settings").length, 1);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /protected settings unavailable/i);
    assert.equal(document.querySelector(".bot-console"), null);
    assert.equal(requests.filter(({ url, method }) => url === "/api/local/admin/settings" && method !== "GET").length, 0);
    await view.unmount();
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
    dom.restore();
  }
});
