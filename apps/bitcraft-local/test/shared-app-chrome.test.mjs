import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";
import { React, installDom, mount } from "./react-dom-test-harness.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

test("shared chrome renders grouped navigation, disabled destinations, utility actions, and footer slots", async () => {
  const dom = installDom("http://localhost/");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const chrome = await vite.ssrLoadModule("/src/components/app-chrome/index.ts");
    const { Home, Map: MapIcon, Search, CircleHelp } = await import("lucide-react");
    const sidebar = ({ mobileOpen, onRequestClose }) => React.createElement(chrome.AppSidebar, {
      brand: { logoUrl: "/claim-monitor-logo.png", title: "Claim Monitor", subtitle: "Public claim data" },
      collapsed: false,
      onCollapsedChange() {},
      groups: [{ id: "overview", label: "Overview", expanded: true, onExpandedChange() {}, items: [
        { id: "dashboard", label: "Dashboard", href: "/", icon: Home, active: true },
        { id: "map", label: "Map", icon: MapIcon, disabled: true, disabledReason: "Coming soon" },
      ] }],
      account: React.createElement("span", null, "Account state"),
      status: React.createElement("span", null, "On-demand data"),
      mobileOpen,
      onRequestClose,
    });
    const utility = React.createElement(chrome.AppUtilityBar, {
      contextLabel: "Claim Monitor",
      pageLabel: "Dashboard",
      command: { label: "Find a claim", ariaLabel: "Find a claim", shortcut: "Ctrl K", icon: Search, onActivate() {} },
      actions: [{ id: "help", label: "Help", icon: CircleHelp, onActivate() {} }],
    });
    view = await mount(React.createElement(chrome.AppFrame, {
      pageLabel: "Dashboard",
      routeKey: "dashboard",
      sidebar,
      utilityBar: utility,
      footer: React.createElement(chrome.AppFooter, {
        primary: React.createElement("span", null, "Primary"),
        secondary: React.createElement("span", null, "Secondary"),
      }),
    }, React.createElement("section", null, "Page body")));

    assert.ok(document.querySelector(".app-shell"));
    assert.ok(document.querySelector(".app-sidebar"));
    assert.equal(document.querySelector('[aria-disabled="true"]')?.textContent.replace(/\s+/g, " ").trim(), "Map Coming soon");
    assert.equal(document.querySelector(".app-utility-command")?.textContent.replace(/\s+/g, " ").trim(), "Find a claimCtrl K");
    assert.equal(document.querySelector(".footer-primary")?.textContent, "Primary");
    assert.equal(document.querySelector(".footer-secondary")?.textContent, "Secondary");
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});

test("shared chrome stays profile-neutral", () => {
  const joined = ["types.ts", "AppSidebar.tsx", "AppFrame.tsx", "AppUtilityBar.tsx", "AppFooter.tsx"]
    .map((name) => readFileSync(new URL(`../src/components/app-chrome/${name}`, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(joined, /AppShell|TimbersteelRoot|api\/local|api\/public|Admin|Discord|notification|history/i);
});
