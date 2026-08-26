import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";
import { React, act, installDom, mount } from "./react-dom-test-harness.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("home and utility dialog use the same claim finder contract", async () => {
  const dom = installDom("http://localhost/");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicClaimFinder } = await vite.ssrLoadModule("/src/public/PublicClaimFinder.tsx");
    view = await mount(React.createElement(PublicClaimFinder, { mode: "home", idPrefix: "home-claim-finder" }));
    assert.equal(document.querySelector('label[for="home-claim-finder-input"]')?.textContent, "FIND A BITCRAFT CLAIM");
    assert.equal(document.querySelector("#home-claim-finder-input")?.getAttribute("placeholder"), "Claim name or exact claim ID");
    assert.match(document.body.textContent, /Enter at least 3 characters from the claim name, or paste the exact claim ID\./);
    await view.unmount();

    view = await mount(React.createElement(PublicClaimFinder, { mode: "dialog", idPrefix: "dialog-claim-finder", autoFocus: true }));
    assert.equal(document.querySelector("#dialog-claim-finder-input"), document.activeElement);
    assert.ok(document.querySelector('[role="dialog"][aria-label="Find a claim"]'));
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});

test("public utility command opens and closes the global claim finder", async () => {
  const dom = installDom("http://localhost/");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const { PublicAppShell } = await vite.ssrLoadModule("/src/public/PublicAppShell.tsx");
    view = await mount(React.createElement(PublicAppShell, {
      route: { id: "home", params: {} },
      features: { publicProfileEnabled: true, publicCollaborationEnabled: false, publicLegalConfigurationConfirmed: true },
    }));

    await act(async () => document.querySelector(".app-utility-command").click());
    assert.ok(document.querySelector('[role="dialog"][aria-label="Find a claim"]'));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector('[role="dialog"][aria-label="Find a claim"]'), null);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));
    assert.ok(document.querySelector('[role="dialog"][aria-label="Find a claim"]'));
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});
