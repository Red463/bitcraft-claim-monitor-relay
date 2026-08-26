import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";
import { React, installDom, mount } from "./react-dom-test-harness.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function fixtureController(domains) {
  return {
    claimId: "42",
    snapshot: { claimId: "42", regionId: "7", receivedAt: new Date().toISOString(), stale: false, ageMs: 0, warnings: [], domains },
    claim: domains.claim?.data ?? {},
    loading: false,
    refreshing: false,
    error: "",
    warnings: [],
    lastUpdated: new Date(),
    async refresh() {},
  };
}

test("public claim pages request the smallest supported domain set", async () => {
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  try {
    const module = await vite.ssrLoadModule("/src/public/PublicClaimPages.tsx");
    assert.deepEqual(module.publicDomainsForRoute("dashboard"), ["claim"]);
    assert.deepEqual(module.publicDomainsForRoute("members"), ["claim", "members", "citizens"]);
    assert.deepEqual(module.publicDomainsForRoute("professions"), ["claim", "members", "citizens"]);
    assert.deepEqual(module.publicDomainsForRoute("inventory"), ["claim", "inventories"]);
    assert.deepEqual(module.publicDomainsForRoute("crafts"), ["claim", "crafts"]);
  } finally {
    await vite.close();
  }
});

test("members and professions are separate projections of one roster snapshot", async () => {
  const dom = installDom("http://localhost/claims/42/members");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicClaimPages } = await vite.ssrLoadModule("/src/public/PublicClaimPages.tsx");
    const controller = fixtureController({
      claim: { data: { name: "Northwatch", tier: "5" } },
      members: { data: [{ entityId: "1", playerEntityId: "9", userName: "Moss", status: "Member" }] },
      citizens: { data: [{ playerEntityId: "9", skills: { "3": 62 }, skillNames: { "3": "Carpentry" } }] },
    });

    view = await mount(React.createElement(PublicClaimPages, { route: { id: "members", params: { claimId: "42" } }, controller }));
    assert.match(document.body.textContent, /Current claim roster/);
    assert.match(document.body.textContent, /Moss/);
    assert.doesNotMatch(document.body.textContent, /Carpentry 62/);
    await view.unmount();

    view = await mount(React.createElement(PublicClaimPages, { route: { id: "professions", params: { claimId: "42" } }, controller }));
    assert.match(document.body.textContent, /Claim professions/);
    assert.match(document.body.textContent, /Carpentry/);
    assert.match(document.body.textContent, /Moss/);
    assert.match(document.body.textContent, /62/);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});
