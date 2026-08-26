import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";
import { React, installDom, mount } from "./react-dom-test-harness.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("public navigation mirrors product groups and separates claim-required from coming-soon", async () => {
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  try {
    const { buildPublicNavigation } = await vite.ssrLoadModule("/src/public/publicNavigation.ts");
    const groups = buildPublicNavigation({ route: { id: "home", params: {} }, claimId: null, claimName: "", collaborationEnabled: false });
    assert.deepEqual(groups.map((group) => group.label), ["Overview", "Claim", "Economy & Region", "Tools"]);
    const items = new Map(groups.flatMap((group) => group.items.map((item) => [item.label, item])));
    assert.equal(items.get("Dashboard").disabledReason, "Select a claim");
    assert.equal(items.get("Members").disabledReason, "Select a claim");
    assert.equal(items.get("Leaderboard").disabledReason, "Coming soon");
    assert.equal(items.get("Map").disabledReason, "Coming soon");
    assert.equal(items.get("Craft Planning").disabledReason, "Coming soon");
    assert.equal(items.has("Admin"), false);
    assert.equal(items.has("Sync"), false);
  } finally {
    await vite.close();
  }
});

test("public chrome uses the shared app structure without operational controls", async () => {
  const dom = installDom("http://localhost/claims/42");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicChrome } = await vite.ssrLoadModule("/src/public/PublicChrome.tsx");
    const controller = {
      claimId: "42",
      snapshot: { claimId: "42", regionId: "7", receivedAt: new Date().toISOString(), stale: false, ageMs: 0, warnings: [], domains: {} },
      claim: { name: "Northwatch" },
      loading: false,
      refreshing: false,
      error: "",
      warnings: [],
      lastUpdated: new Date(),
      async refresh() {},
    };
    view = await mount(React.createElement(PublicChrome, {
      route: { id: "dashboard", params: { claimId: "42" } },
      features: { publicProfileEnabled: true, publicCollaborationEnabled: false, publicLegalConfigurationConfirmed: true },
      controller,
      onOpenClaimFinder() {},
    }, React.createElement("section", null, "Claim page")));

    assert.ok(document.querySelector(".app-shell.public-profile-shell"));
    assert.ok(document.querySelector(".app-sidebar"));
    assert.equal(document.querySelector(".brand h1")?.textContent, "Northwatch");
    assert.equal(document.querySelector(".brand span")?.textContent, "Claim Monitor");
    assert.match(document.querySelector(".refresh-status")?.textContent, /On-demand data/);
    assert.ok(document.querySelector(".mobile-shell-bar"));
    assert.equal(document.querySelectorAll('[aria-disabled="true"]').length > 0, true);
    assert.doesNotMatch(document.body.textContent, /Admin|Sync|Updates|Join Discord Server/);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});
