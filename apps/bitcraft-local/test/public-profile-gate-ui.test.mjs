import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";
import { React, installDom, mount } from "./react-dom-test-harness.mjs";
import { resolvePublicRoute } from "../src/public/routes.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const disabledFeatures = {
  publicProfileEnabled: false,
  publicCollaborationEnabled: false,
  publicLegalConfigurationConfirmed: false,
};

test("disabled public profile renders maintenance without an operable settlement search", async () => {
  const dom = installDom("http://localhost/");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, {
      route: { id: "home", params: {} },
      features: disabledFeatures,
    }));
    assert.match(document.body.textContent, /not enabled yet/i);
    assert.equal(document.querySelector("#home-claim-finder-input"), null);
    assert.doesNotMatch(document.body.textContent, /Not found|being prepared/i);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});

test("public shell fails closed when a caller omits server-owned feature flags", async () => {
  const dom = installDom("http://localhost/");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, { route: { id: "home", params: {} } }));
    assert.match(document.body.textContent, /not enabled yet/i);
    assert.equal(document.querySelector("#home-claim-finder-input"), null);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});

test("enabled read-only profile presents settlement search without unfinished placeholder copy", async () => {
  const dom = installDom("http://localhost/");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, {
      route: resolvePublicRoute("/"),
      features: { ...disabledFeatures, publicProfileEnabled: true, publicLegalConfigurationConfirmed: true },
    }));
    const search = document.querySelector("#home-claim-finder-input");
    assert.ok(search);
    assert.equal(document.querySelector('label[for="home-claim-finder-input"]')?.textContent, "FIND A BITCRAFT CLAIM");
    assert.equal(search.getAttribute("placeholder"), "Claim name or exact claim ID");
    assert.match(document.body.textContent, /Enter at least 3 characters from the claim name, or paste the exact claim ID\./);
    assert.doesNotMatch(document.body.textContent, /being prepared/i);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});

test("first-time public visitors receive compact claim selection guidance", async () => {
  const dom = installDom("http://localhost/");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, {
      route: resolvePublicRoute("/"),
      features: { ...disabledFeatures, publicProfileEnabled: true, publicLegalConfigurationConfirmed: true },
    }));

    assert.match(document.body.textContent, /Welcome to Claim Monitor/);
    assert.match(document.body.textContent, /current, read-only data/i);
    assert.match(document.body.textContent, /Enter at least three characters/i);
    assert.match(document.body.textContent, /Select the correct claim/i);
    assert.match(document.body.textContent, /Use the claim navigation/i);
    assert.match(document.body.textContent, /does not continuously monitor public claims/i);
    assert.match(document.body.textContent, /public history, notifications, or Discord services/i);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});

test("returning public visitors receive compact search until clearing recents restores onboarding", async () => {
  const dom = installDom("http://localhost/");
  window.localStorage.setItem("claim-monitor.public.recent-settlements", JSON.stringify([
    { claimId: "1369094286819518507", name: "Basin of Cairn", regionId: "19" },
  ]));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, {
      route: resolvePublicRoute("/"),
      features: { ...disabledFeatures, publicProfileEnabled: true, publicLegalConfigurationConfirmed: true },
    }));

    assert.doesNotMatch(document.body.textContent, /Welcome to Claim Monitor/);
    assert.match(document.body.textContent, /Recent claims/);
    assert.match(document.body.textContent, /Basin of Cairn/);
    assert.ok(document.querySelector("#home-claim-finder-input"));

    window.localStorage.removeItem("claim-monitor.public.recent-settlements");
    await view.unmount();
    view = await mount(React.createElement(PublicAppShell, {
      route: resolvePublicRoute("/"),
      features: { ...disabledFeatures, publicProfileEnabled: true, publicLegalConfigurationConfirmed: true },
    }));
    assert.match(document.body.textContent, /Welcome to Claim Monitor/);
    assert.doesNotMatch(document.body.textContent, /Recent claims/);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});

test("public Help explains claim selection and on-demand limitations", async () => {
  const dom = installDom("http://localhost/help");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, {
      route: { id: "help", params: {} },
      features: { ...disabledFeatures, publicProfileEnabled: true, publicLegalConfigurationConfirmed: true },
    }));

    assert.match(document.body.textContent, /Finding a claim/i);
    assert.match(document.body.textContent, /at least three characters/i);
    assert.match(document.body.textContent, /loaded on demand/i);
    assert.match(document.body.textContent, /no public history, alerts, notifications, or Discord services/i);
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});
