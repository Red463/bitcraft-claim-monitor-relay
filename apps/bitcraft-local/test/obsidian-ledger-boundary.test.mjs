import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Obsidian Ledger exposes one semantic token layer and contextual modes", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const token of [
    "--canvas", "--surface-1", "--surface-2", "--surface-3", "--line-subtle",
    "--line-strong", "--signal-info", "--signal-discord", "--space-1", "--space-6",
    "--radius-panel", "--radius-dialog", "--font-data",
  ]) assert.match(styles, new RegExp(`${token}:`), token);
  for (const mode of ["operations", "market", "public", "admin", "bot"]) {
    assert.match(styles, new RegExp(`\\.surface-mode-${mode}\\s*\\{`), mode);
  }
  assert.match(styles, /\.panel\s*\{[^}]*gap:\s*var\(--workspace-density/s);
  assert.match(styles, /\.page-view > \.panel\s*\{[^}]*var\(--workspace-accent/s);
});

test("Obsidian Ledger uses sharp shared geometry and excludes legacy blue-steel defaults", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const [token, value] of [
    ["--radius-control", "2px"],
    ["--radius-panel", "4px"],
    ["--radius-card", "4px"],
    ["--radius-dialog", "6px"],
  ]) assert.match(styles, new RegExp(`${token}:\\s*${value.replace(".", "\\.")}`), token);
  const root = styles.match(/:root\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
  assert.doesNotMatch(root, /#111923|#080d14|#353b46/i);
  assert.match(root, /--canvas:\s*#050506/);
  assert.match(root, /--surface-1:\s*#090a0c/);
  assert.match(root, /--surface-2:\s*#0e1012/);
  assert.match(root, /--surface-3:\s*#15181b/);
  assert.doesNotMatch(root, /#030403|#070907|#0b0e0b|#111510/i);
  assert.match(root, /--active-color:\s*#d9af3d/);
  const enforcementControls = styles.slice(styles.indexOf("/* Obsidian Ledger enforcement"), styles.indexOf(".app-shell :where(.dialog-surface"));
  assert.match(enforcementControls, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.doesNotMatch(enforcementControls, /, input,/);
});

test("application tools live in an anchored utility component", () => {
  const shell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const utility = readFileSync(new URL("../src/components/app-chrome/AppUtilityBar.tsx", import.meta.url), "utf8");
  assert.match(utility, /aria-label="Application tools"/);
  for (const label of ["Search commands", "Admin console", "Updates", "Browser settings", "Help and application information"]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(utility, /aria-busy=\{action\.busy/);
  assert.match(utility, /disabled=\{action\.disabled\}/);
});

test("the utility route label replaces duplicated visible page-title heroes", () => {
  const header = readFileSync(new URL("../src/components/main/PageHeader.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(header, /route-title-copy/);
  assert.match(styles, /\.route-title-copy\s*\{/);
  assert.match(styles, /\.page-header:has\(\.page-header-aside\)/);
});

test("primary page families use flat Obsidian surfaces instead of legacy card gradients", () => {
  const dashboard = readFileSync(new URL("../src/styles/dashboard.css", import.meta.url), "utf8");
  const market = readFileSync(new URL("../src/styles/market.css", import.meta.url), "utf8");
  const admin = readFileSync(new URL("../src/styles/admin.css", import.meta.url), "utf8");
  const bot = readFileSync(new URL("../src/styles/bot-dashboard.css", import.meta.url), "utf8");

  for (const selector of ["dashboard-metric", "dashboard-card"]) {
    const body = dashboard.match(new RegExp(`\\.${selector}\\s*\\{(?<body>[\\s\\S]*?)\\n\\}`))?.groups?.body ?? "";
    assert.match(body, /background:\s*var\(--surface-2\)/, selector);
    assert.match(body, /box-shadow:\s*none/, selector);
    assert.doesNotMatch(body, /(?:linear|radial)-gradient\(/, selector);
  }

  assert.doesNotMatch(market, /rgba\(22,\s*32,\s*43/);
  assert.match(market, /\.market-page th\s*\{[^}]*background:\s*var\(--surface-3\)/s);

  const loader = admin.match(/\.admin-session-loader\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
  assert.match(loader, /border-radius:\s*var\(--radius-dialog\)/);
  assert.match(loader, /background:\s*var\(--surface-2\)/);
  assert.match(loader, /box-shadow:\s*none/);

  assert.match(bot, /\.bot-control-page\s*\{[^}]*background:\s*var\(--canvas\)/s);
  assert.match(bot, /\.bot-section-nav\s*\{[^}]*background:\s*var\(--surface-1\)[^}]*box-shadow:\s*none/s);
});

test("Global Market warnings retain an accessible expandable disclosure", () => {
  const marketPage = readFileSync(new URL("../src/pages/MarketPage.tsx", import.meta.url), "utf8");
  assert.match(marketPage, /className="global-market-data-alert error"\s+role="alert"/);
  assert.match(marketPage, /<details>[\s\S]*?<summary>[\s\S]*?<ul>\{marketErrorIssues\.map/s);
});
