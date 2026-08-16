import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const setupWorkflowCss = readFileSync(new URL("../src/styles/setup-workflow.css", import.meta.url), "utf8");

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return collectSourceFiles(url);
    return entry.name.endsWith(".tsx") ? [url] : [];
  });
}

function extractMediaBody(css, condition) {
  const mediaStart = css.indexOf(`@media ${condition}`);
  assert.notEqual(mediaStart, -1, `Expected ${condition} media query`);
  const bodyStart = css.indexOf("{", mediaStart);
  let depth = 1;
  for (let index = bodyStart + 1; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(bodyStart + 1, index);
  }
  assert.fail(`Unclosed ${condition} media query`);
}

test("confirmed legacy selector families are absent from active markup and global CSS", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const source = collectSourceFiles(new URL("../src/", import.meta.url))
    .map((url) => readFileSync(url, "utf8"))
    .join("\n");
  const deadClassTokens = [...source.matchAll(/["'`]([^"'`\r\n]+)["'`]/g)]
    .flatMap((match) => match[1].split(/\s+/))
    .filter((token) => /^(?:overview-|command-centre-|row-enter$)/.test(token));

  const legacyFamilySelector = /\.(?:overview|command-centre)-[a-z0-9-]+/;
  assert.match("button.overview-card.is-active", legacyFamilySelector);
  assert.match(".panel.command-centre-toolbar:hover", legacyFamilySelector);
  assert.doesNotMatch(globalCss, legacyFamilySelector);
  assert.doesNotMatch(globalCss, /@keyframes\s+row-enter\b/);
  assert.doesNotMatch(globalCss, /@media\s*\(max-width:\s*520px\)\s*\{\s*\}/);
  assert.doesNotMatch(globalCss, /\.sidebar-auth-cta\b/);
  assert.deepEqual([...new Set(deadClassTokens)].sort(), []);
});

test("map mobile queries do not duplicate desktop player-control declarations", () => {
  const mapCss = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");
  const mobile = extractMediaBody(mapCss, "(max-width: 700px)");
  const duplicatedDesktopSelectors = [
    ".map-player-tracking",
    ".map-player-tracking-summary",
    ".map-player-tracking-summary svg",
    ".map-player-tracking-summary div",
    ".map-player-tracking-summary strong",
    ".map-player-tracking-summary span",
    ".map-player-tracking-actions",
    ".map-player-bulk-actions",
    ".map-player-tabs",
    ".map-player-tracking-actions button",
    ".map-player-bulk-actions button",
    ".map-player-tabs button",
    ".map-player-tracking-actions button:hover",
    ".map-player-bulk-actions button:hover",
    ".map-player-tabs button:hover",
    ".map-player-tracking-actions button.active",
    ".map-player-tabs button.active",
    ".map-player-dialog-overlay",
    ".map-player-dialog",
    ".map-player-dialog header",
    ".map-player-dialog h3",
    ".map-player-dialog p",
    ".map-player-dialog .icon-button",
    ".map-player-manager-controls",
    ".map-player-manager-controls .search",
    ".map-player-list",
    ".map-player-list label",
    ".map-player-list label:hover",
    ".map-player-list label.active",
    ".map-player-list input",
    ".map-player-list .online-dot",
    ".map-player-list label > span:last-child",
    ".map-player-list strong",
    ".map-player-list small",
  ];

  for (const selector of duplicatedDesktopSelectors) {
    assert.equal(mobile.includes(selector), false, `${selector} belongs to the desktop owning block`);
  }
});

test("native map controls stay viewport-contained with touch-sized phone toggles", () => {
  const mapCss = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");
  const phone = extractMediaBody(mapCss, "(max-width: 620px)");

  assert.match(mapCss, /\.native-map-controls\s*\{[^}]*position:\s*absolute[^}]*z-index:/s);
  assert.match(mapCss, /\.native-map-layers-popover\s*\{[^}]*max-height:\s*min\([^}]*overflow:\s*auto/s);
  assert.match(phone, /\.native-map-layer-row\s*\{[^}]*min-height:\s*44px/s);
});

test("Bot Setup, Notifications, and Diagnostics share one semantic status info row", () => {
  const sharedUrl = new URL("../src/components/bot/BotStatusInfo.tsx", import.meta.url);
  assert.equal(existsSync(sharedUrl), true, "BotStatusInfo should own the shared Bot status/info vocabulary");
  const consumers = [
    "../src/components/bot/DiscordSetupSection.tsx",
    "../src/components/bot/DiscordNotificationsSection.tsx",
    "../src/components/bot/DiscordDiagnosticsPanel.tsx",
  ];

  for (const relativePath of consumers) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /import \{ BotStatusInfo \} from "\.\/BotStatusInfo";/);
    assert.match(source, /<BotStatusInfo\b/);
    assert.doesNotMatch(source, /function\s+(?:StatusInfo|Info)\s*\(/);
  }

  const shared = readFileSync(sharedUrl, "utf8");
  assert.match(shared, /className="info-row bot-status-info"/);
  assert.match(shared, /export type BotStatusTone = "neutral" \| "success" \| "warning" \| "danger"/);
  assert.doesNotMatch(shared, /\| "info"/);
  assert.match(shared, /content: ReactNode/);
  assert.match(shared, /tone\?: BotStatusTone/);
  assert.match(shared, /role\?: "status" \| "alert"/);
  assert.match(shared, /data-tone=\{tone\}/);
  assert.match(shared, /content \?\? "-"/);

  const setup = readFileSync(new URL(consumers[0], import.meta.url), "utf8");
  const notifications = readFileSync(new URL(consumers[1], import.meta.url), "utf8");
  const diagnostics = readFileSync(new URL(consumers[2], import.meta.url), "utf8");
  const discordCss = readFileSync(new URL("../src/styles/discord-admin.css", import.meta.url), "utf8");
  assert.match(setup, /tone=\{[^}]*\? "success" : "warning"\}/);
  assert.match(notifications, /tone=\{[^}]*\? "success" : "warning"\}/);
  assert.match(diagnostics, /tone="success"/);
  assert.match(diagnostics, /tone="danger"/);
  assert.doesNotMatch(discordCss, /\.bot-status-info\[data-tone="info"\]/);
});

test("routine toast decoration is tonal while Discord and diagnostic status accents remain encoded", () => {
  const notificationsCss = readFileSync(new URL("../src/styles/notifications.css", import.meta.url), "utf8");
  const discordCss = readFileSync(new URL("../src/styles/discord-admin.css", import.meta.url), "utf8");

  assert.doesNotMatch(notificationsCss, /\.toast[^{}]*\{[^}]*border-left(?:-color)?:/s);
  assert.match(discordCss, /\.discord-preview-embed\s*\{[^}]*border-left:\s*4px\s+solid/s);
  assert.match(discordCss, /\.discord-diagnostic-card\s*\{[^}]*border-left:\s*3px\s+solid/s);
  assert.match(discordCss, /\.discord-diagnostic-card\.failed\s*\{[^}]*border-left-color:\s*var\(--danger\)/s);
});

test("Admin status summaries do not contain confirmed mojibake separators", () => {
  const adminSources = [
    "../src/components/admin/AdminPanel.tsx",
    "../src/components/admin/AdminAnalyticsSection.tsx",
  ].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8"));

  for (const source of adminSources) assert.doesNotMatch(source, /Â·/);
});

test("application shell uses a compact drawer at narrow widths", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const narrow = [...css.matchAll(/@media \(max-width: 920px\)\s*\{(?<body>[\s\S]*?)\n\}/g)]
    .map((match) => match.groups?.body ?? "")
    .find((body) => body.includes(".mobile-shell-bar")) ?? "";

  for (const selector of [".mobile-shell-bar", ".mobile-navigation-backdrop", ".mobile-navigation-close"]) {
    assert.match(css, new RegExp(`\\${selector}[^\\{]*\\{[^}]*display:\\s*none\\b`, "s"));
  }
  assert.match(narrow, /\.mobile-shell-bar\s*\{[^}]*position:\s*fixed\b[^}]*height:\s*52px\b/s);
  assert.match(narrow, /\.mobile-shell-bar\s*>\s*span\s*\{[^}]*display:\s*grid\b/s);
  assert.match(narrow, /\.mobile-shell-route\s*\{[^}]*text-overflow:\s*ellipsis\b/s);
  assert.match(narrow, /\.mobile-shell-bar\s*>\s*button\s*\{[^}]*min-width:\s*44px\b[^}]*min-height:\s*44px\b/s);
  assert.match(narrow, /\.mobile-navigation-backdrop\s*\{[^}]*position:\s*fixed\b[^}]*inset:\s*0\b/s);
  assert.match(narrow, /\.app-sidebar\s*\{[^}]*position:\s*fixed\b[^}]*width:\s*min\(320px,\s*calc\(100vw\s*-\s*44px\)\)/s);
  assert.match(narrow, /\.app-sidebar\.mobile-open\s*\{[^}]*transform:\s*translateX\(0\)/s);
  assert.match(narrow, /\.sidebar-section-title[^\{]*\{[^}]*display:\s*flex\b/s);
  assert.match(narrow, /nav[^\{]*\{[^}]*overflow-y:\s*auto\b/s);
  assert.match(narrow, /\.mobile-navigation-close\s*\{[^}]*min-width:\s*44px\b[^}]*min-height:\s*44px\b/s);
  assert.match(narrow, /main\s*\{[^}]*--shell-page-gutter:\s*16px\b[^}]*padding-left:\s*0\b[^}]*padding-right:\s*0\b/s);
  assert.match(narrow, /\.sidebar-toggle\s*\{[^}]*display:\s*none\b/s);
  assert.doesNotMatch(narrow, /scroll-snap-type:\s*x|overflow-x:\s*auto|\.sidebar-section-title[^\{]*\{[^}]*display:\s*none/);
  const collapsedLabels = narrow.match(/\.sidebar-collapsed nav \.nav-label\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  assert.match(collapsedLabels, /width:\s*auto\b/);
  assert.match(collapsedLabels, /min-width:\s*0\b/);
  assert.match(collapsedLabels, /max-height:\s*none\b/);
  const collapsedBrandCopy = narrow.match(/\.brand > div,\s*\.sidebar-collapsed \.brand > div\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  assert.match(collapsedBrandCopy, /max-height:\s*none\b/);
  assert.match(collapsedBrandCopy, /overflow:\s*visible\b/);
  const collapsedAccountCopy = narrow.match(/\.sidebar-collapsed \.sidebar-account-copy\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  assert.match(collapsedAccountCopy, /min-width:\s*0\b/);
});

test("shell owns compact page gutters without stacking main and panel padding", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.app-shell\s*\{[^}]*--shell-page-gutter:\s*20px\b/s);
  assert.match(css, /\.panel\s*\{[^}]*padding:\s*var\(--shell-page-gutter\)\s*;/s);
});

test("inline collapsed navigation labels remain hidden in desktop and mobile modes", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.collapsed-nav-label\s*\{[^}]*display:\s*none\b/s);
  const narrow = [...css.matchAll(/@media \(max-width: 920px\)\s*\{(?<body>[\s\S]*?)\n\}/g)]
    .map((match) => match.groups?.body ?? "")
    .find((body) => body.includes(".mobile-shell-bar")) ?? "";
  assert.match(narrow, /\.collapsed-nav-label,\s*\.collapsed-nav-tooltip\s*\{[^}]*display:\s*none\s*!important/s);
});

test("collapsed navigation tooltip escapes the vertically scrolling nav", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const navRule = css.match(/nav\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const tooltipRule = css.match(/\.collapsed-nav-tooltip\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  assert.match(navRule, /overflow-y:\s*auto\b/);
  assert.match(tooltipRule, /position:\s*fixed\b/);
  assert.match(tooltipRule, /pointer-events:\s*none\b/);
});

test("sidebar decoration stays neutral outside active and primary states", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of ["aside", ".brand", ".brand svg", ".brand h1", ".sidebar-account-avatar", ".discord-cta", ".nav-tools-menu", ".refresh-breakdown", ".app-footer", "button.sidebar-account-main:hover", ".sidebar-toggle:hover", ".sidebar-account-action:hover"]) {
    const escaped = selector.replaceAll(".", "\\.").replaceAll(" ", "\\s+");
    const rule = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]+)\\}`))?.groups?.body ?? "";
    assert.notEqual(rule, "", `${selector} should have a shell rule`);
    assert.doesNotMatch(rule, /var\(--gold\)|var\(--active-color\)|var\(--active-bg\)|rgba\(240,198,79/);
  }
  const footerHover = css.match(/\.app-footer a:not\(\.footer-bmc\):hover,\s*\.footer-link:hover\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  assert.notEqual(footerHover, "", "ordinary footer hover should have a shell rule");
  assert.doesNotMatch(footerHover, /var\(--gold\)|var\(--active-color\)|var\(--active-bg\)|rgba\(240,198,79/);
});

test("reduced motion explicitly disables drawer and backdrop transitions", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const reducedMotion = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{(?<body>[\s\S]*?)\n\}/)?.groups?.body ?? "";
  assert.match(reducedMotion, /\.app-sidebar,\s*\.mobile-navigation-backdrop\s*\{[^}]*transition:\s*none\s*!important/s);
});

test("setup workflow stylesheet keeps ownership to setup, workflow, and admin-message selectors", () => {
  const forbiddenGlobalSelectors = setupWorkflowCss
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /^(aside|nav\b|nav,|\.sidebar-collapsed nav\b|\.bot-section-nav\b)/.test(line));

  assert.deepEqual(forbiddenGlobalSelectors, []);
});

test("shared command panel primitives use neutral class names", () => {
  const checkedFiles = [
    "../src/styles.css",
    "../src/styles/public-craft.css",
    "../src/styles/market.css",
    "../src/pages/ActivityPage.tsx",
    "../src/pages/CraftCalculatorPage.tsx",
    "../src/pages/EmpiresPage.tsx",
    "../src/pages/InventoryPage.tsx",
    "../src/pages/MarketPage.tsx",
    "../src/pages/ProductionPage.tsx",
    "../src/pages/PublicCraftFinderPage.tsx",
    "../src/pages/ResearchPage.tsx",
    "../src/pages/RegionPage.tsx",
    "../src/pages/market/DealWatchlist.tsx",
  ];
  const forbidden = [];
  for (const relativePath of checkedFiles) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    for (const className of ["production-command-panel", "production-command-main", "production-command-title", "market-command-header"]) {
      if (source.includes(className)) forbidden.push(relativePath + ": " + className);
    }
  }

  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.equal(globalCss.includes(".command-filter-panel"), true);
  assert.equal(globalCss.includes(".command-filter-main"), true);
  assert.equal(globalCss.includes(".command-filter-title"), true);
  assert.equal(globalCss.includes(".command-filter-header"), true);
  assert.deepEqual(forbidden, []);
});

test("shared panel headers keep title and count separated", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const panelHeadRule = globalCss.match(/\.panel-head\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const panelHeadStrongRule = globalCss.match(/\.panel-head strong\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const panelHeadMetaRule = globalCss.match(/\.panel-head > span\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

  assert.match(panelHeadRule, /display:\s*flex\b/);
  assert.match(panelHeadRule, /justify-content:\s*space-between\b/);
  assert.match(panelHeadRule, /gap:\s*12px\b/);
  assert.match(panelHeadStrongRule, /gap:\s*7px\b/);
  assert.match(panelHeadStrongRule, /min-width:\s*0\b/);
  assert.match(panelHeadMetaRule, /white-space:\s*nowrap\b/);
});
test("shared table sort buttons keep a usable click target", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const sortRule = globalCss.match(/\.table-sort-button\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

  assert.match(sortRule, /min-height:\s*28px\b/);
  assert.match(sortRule, /padding:\s*0\s+6px\b/);
});
test("shared app chrome controls keep usable click targets", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const sidebarTitleRule = globalCss.match(/\.sidebar-section-title\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const footerLinkRule = globalCss.match(/\.app-footer a:not\(\.footer-bmc\),\s*\.footer-link\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const sidebarToggleRule = globalCss.match(/\.sidebar-toggle\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

  assert.match(sidebarTitleRule, /min-height:\s*30px\b/);
  assert.match(footerLinkRule, /min-height:\s*30px\b/);
  assert.match(sidebarToggleRule, /(?:width:\s*30px\b[\s\S]*height:\s*30px\b|height:\s*30px\b[\s\S]*width:\s*30px\b)/);
});
test("public craft table actions keep usable click targets", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const publicCraftCss = readFileSync(new URL("../src/styles/public-craft.css", import.meta.url), "utf8");
  const sortRule = globalCss.match(/\.sort-button\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const mapLinkRule = publicCraftCss.match(/\.map-location-link\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

  assert.match(sortRule, /min-height:\s*28px\b/);
  assert.match(sortRule, /min-width:\s*28px\b/);
  assert.match(sortRule, /padding:\s*0\s+6px\b/);
  assert.match(mapLinkRule, /min-height:\s*28px\b/);
  assert.match(mapLinkRule, /padding:\s*0\s+4px\b/);
});

test("craft planning modals keep close buttons and target actions properly spaced", () => {
  const css = readFileSync(new URL("../src/styles/craft-planning.css", import.meta.url), "utf8");
  const overrideHeaderRule = css.match(/\.craft-plan-section-override \.modal-header\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const overrideCloseRule = css.match(/\.craft-plan-section-override \.modal-header \.icon-button\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const targetRowRule = css.match(/\.craft-plan-target-editor-row\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const targetActionsRule = css.match(/\.craft-plan-target-editor-actions\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const targetQuantityRule = css.match(/\.craft-plan-target-editor-actions \.compact-field\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  const targetRemoveRule = css.match(/\.craft-plan-target-editor-actions > \.toolbar-button\.danger\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

  assert.match(overrideHeaderRule, /position:\s*relative\b/);
  assert.match(overrideHeaderRule, /padding:\s*18px\s+54px\s+12px\s+18px\b/);
  assert.match(overrideCloseRule, /position:\s*absolute\b/);
  assert.match(overrideCloseRule, /top:\s*14px\b/);
  assert.match(overrideCloseRule, /right:\s*14px\b/);
  assert.match(targetRowRule, /display:\s*flex\b/);
  assert.match(targetRowRule, /gap:\s*16px\b/);
  assert.match(targetActionsRule, /display:\s*flex\b/);
  assert.match(targetActionsRule, /flex:\s*0\s+0\s+auto\b/);
  assert.match(targetQuantityRule, /width:\s*120px\b/);
  assert.match(targetQuantityRule, /min-width:\s*0\b/);
  assert.match(targetRemoveRule, /min-width:\s*112px\b/);
});
test("bot dashboard shell styles live in the bot dashboard stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const botCssUrl = new URL("../src/styles/bot-dashboard.css", import.meta.url);
  assert.equal(existsSync(botCssUrl), true);
  const botCss = readFileSync(botCssUrl, "utf8");
  const botShellSelectors = [
    ".bot-control-page",
    ".bot-console",
    ".bot-dashboard",
    ".bot-overview",
    ".bot-layout",
    ".bot-section-nav",
    ".bot-nav-title",
    ".bot-nav-group",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  for (const selector of botShellSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(botCss.includes(selector), true, `${selector} should live in bot-dashboard.css`);
  }
});
test("dashboard page styles live in the dashboard stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const dashboardCssUrl = new URL("../src/styles/dashboard.css", import.meta.url);
  assert.equal(existsSync(dashboardCssUrl), true);
  const dashboardCss = readFileSync(dashboardCssUrl, "utf8");
  const dashboardSelectors = [
    ".dashboard-page",
    ".dashboard-topbar",
    ".dashboard-kpis",
    ".dashboard-metric",
    ".dashboard-main-grid",
    ".dashboard-feed",
    ".dashboard-feed-row",
    ".dashboard-member-list",
    ".dashboard-production-list",
    ".dashboard-alert-list",
    ".dashboard-empty",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/dashboard\.css";/);
  for (const selector of dashboardSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(dashboardCss.includes(selector), true, `${selector} should live in dashboard.css`);
  }
});test("leaderboard page styles live in the leaderboard stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const leaderboardCssUrl = new URL("../src/styles/leaderboard.css", import.meta.url);
  assert.equal(existsSync(leaderboardCssUrl), true);
  const leaderboardCss = readFileSync(leaderboardCssUrl, "utf8");
  const leaderboardSelectors = [
    ".leaderboard-page",
    ".leaderboard-tabs",
    ".leaderboard-summary",
    ".leaderboard-card",
    ".leaderboard-grid",
    ".leaderboard-profession-list",
    ".leaderboard-recent-list",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/LeaderboardPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/leaderboard\.css";/);
  for (const selector of leaderboardSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(leaderboardCss.includes(selector), true, `${selector} should live in leaderboard.css`);
  }
});
test("production page styles live in the production stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const productionCssUrl = new URL("../src/styles/production.css", import.meta.url);
  assert.equal(existsSync(productionCssUrl), true);
  const productionCss = readFileSync(productionCssUrl, "utf8");
  const productionSelectors = [
    ".production-page",
    ".production-topbar",
    ".production-summary",
    ".production-grid",
    ".production-card",
    ".production-member-banner",
    ".production-page .production-member-banner",
    ".settlement-passive-crafts",
    ".private-craft-pill",
    ".production-private-toggle",
    ".production-crafter-line",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/ProductionPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/production\.css";/);
  for (const selector of productionSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(productionCss.includes(selector), true, `${selector} should live in production.css`);
  }
});
test("public craft finder page styles live in the public craft stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const publicCraftCssUrl = new URL("../src/styles/public-craft.css", import.meta.url);
  assert.equal(existsSync(publicCraftCssUrl), true);
  const publicCraftCss = readFileSync(publicCraftCssUrl, "utf8");
  const publicCraftSelectors = [
    ".public-craft-page",
    ".public-craft-finder",
    ".public-craft-topbar",
    ".public-craft-summary",
    ".public-craft-command-panel",
    ".public-craft-hint",
    ".map-location-link",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/PublicCraftFinderPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/public-craft\.css";/);
  for (const selector of publicCraftSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(publicCraftCss.includes(selector), true, `${selector} should live in public-craft.css`);
  }
});
test("market page styles live in the market stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const marketCssUrl = new URL("../src/styles/market.css", import.meta.url);
  assert.equal(existsSync(marketCssUrl), true);
  const marketCss = readFileSync(marketCssUrl, "utf8");
  const marketSelectors = [
    ".market-page",
    ".market-topbar",
    ".market-summary",
    ".market-command-panel",
    ".market-filter-panel",
    ".market-tool-row",
    ".market-member-field",
    ".market-tabs",
    ".market-filter-grid",
    ".market-analytics",
    ".market-best-leaderboard",
    ".price-finder",
    ".pagination-row",
    ".deal-watch-action",
    ".deal-watch-add-card",
    ".deal-watchlist-section",
    ".deal-watch-list",
    ".deal-watch-row",
    ".deal-watch-meta",
    ".deal-watch-actions",
    ".deal-watch-threshold",
    ".deal-watch-empty",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/MarketPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/market\.css";/);
  for (const selector of marketSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(marketCss.includes(selector), true, `${selector} should live in market.css`);
  }
});

test("craft calculator page styles live in the craft calculator stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const craftcalcCssUrl = new URL("../src/styles/craftcalc.css", import.meta.url);
  assert.equal(existsSync(craftcalcCssUrl), true);
  const craftcalcCss = readFileSync(craftcalcCssUrl, "utf8");
  const craftcalcSelectors = [
    ".craftcalc-page",
    ".craftcalc-topbar",
    ".craftcalc-controls",
    ".craftcalc-recipe-picker",
    ".craftcalc-control-grid",
    ".craftcalc-route-list",
    ".craftcalc-route-card",
    ".craftcalc-route-heading",
    ".craftcalc-route-pill",
    ".craftcalc-summary",
    ".craftcalc-section",
    ".craftcalc-material-grid",
    ".craftcalc-material-row",
    ".craftcalc-step-list",
    ".craftcalc-step-card",
    ".craftcalc-warning",
    ".craftcalc-empty",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/CraftCalculatorPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/craftcalc\.css";/);
  for (const selector of craftcalcSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(craftcalcCss.includes(selector), true, `${selector} should live in craftcalc.css`);
  }
});
test("skills page styles live in the skills stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const skillsCssUrl = new URL("../src/styles/skills.css", import.meta.url);
  assert.equal(existsSync(skillsCssUrl), true);
  const skillsCss = readFileSync(skillsCssUrl, "utf8");
  const skillsSelectors = [
    ".skills-page",
    ".skills-topbar",
    ".skills-summary",
    ".skills-dashboard",
    ".focus-panel",
    ".coverage-panel",
    ".focus-metrics",
    ".focus-tier-strip",
    ".focus-tier-segment",
    ".focus-list",
    ".coverage-list",
    ".adventure-skills-panel",
    ".adventure-skill-grid",
    ".skills-toolbar",
    ".heatmap-wrap",
    ".skill-table",
    ".skill-cell",
    ".tier-legend",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/SkillsPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/skills\.css";/);
  for (const selector of skillsSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(skillsCss.includes(selector), true, `${selector} should live in skills.css`);
  }
});
test("skills profession heatmap headers stay on one line", () => {
  const skillsCss = readFileSync(new URL("../src/styles/skills.css", import.meta.url), "utf8");

  assert.match(skillsCss, /\.skill-table \{[^}]*min-width:\s*1580px;[^}]*table-layout:\s*fixed;/s);
  assert.match(skillsCss, /\.skill-table \.profession-header \{[^}]*width:\s*100px;[^}]*white-space:\s*nowrap;/s);
  assert.match(skillsCss, /\.skill-table \.profession-header span \{[^}]*white-space:\s*nowrap;[^}]*overflow-wrap:\s*normal;/s);
  assert.match(skillsCss, /\.skill-cell \{[^}]*width:\s*100px;/s);
  assert.doesNotMatch(skillsCss, /\.skill-table \.profession-header span \{[^}]*overflow-wrap:\s*anywhere;/s);
});

test("members page styles live in the members stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const membersCssUrl = new URL("../src/styles/members.css", import.meta.url);
  assert.equal(existsSync(membersCssUrl), true);
  const membersCss = readFileSync(membersCssUrl, "utf8");
  const membersSelectors = [
    ".members-page",
    ".members-summary-grid",
    ".members-toolbar",
    ".members-roster-table",
    ".member-name-cell",
    ".member-row-avatar",
    ".member-row-copy",
    ".profile-actions",
    ".gear-preset-list",
    ".gear-preset",
    ".public-profile-grid",
    ".profile-history-panel",
    ".profile-section-heading",
    ".passive-craft-list",
    ".passive-craft-card",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/MembersPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/members\.css";/);
  for (const selector of membersSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(membersCss.includes(selector), true, `${selector} should live in members.css`);
  }
});
test("inventory page styles live in the inventory stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const inventoryCssUrl = new URL("../src/styles/inventory.css", import.meta.url);
  assert.equal(existsSync(inventoryCssUrl), true);
  const inventoryCss = readFileSync(inventoryCssUrl, "utf8");
  const inventorySelectors = [
    ".inventory-page",
    ".inventory-topbar",
    ".inventory-summary",
    ".inventory-command-header",
    ".inventory-command-actions",
    ".inventory-filter-grid",
    ".inventory-filter-field",
    ".inventory-inline-toggle",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/InventoryPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/inventory\.css";/);
  for (const selector of inventorySelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(inventoryCss.includes(selector), true, `${selector} should live in inventory.css`);
  }
});
test("construction page styles live in the construction stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const constructionCssUrl = new URL("../src/styles/construction.css", import.meta.url);
  assert.equal(existsSync(constructionCssUrl), true);
  const constructionCss = readFileSync(constructionCssUrl, "utf8");
  const constructionSelectors = [
    ".construction-page",
    ".construction-topbar",
    ".construction-summary",
    ".construction-section-heading",
    ".construction-need-card",
    ".construction-controls",
    ".construction-sort-field",
    ".construction-material-list",
    ".construction-material-row",
    ".construction-complete-toggle",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/ConstructionPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/construction\.css";/);
  for (const selector of constructionSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(constructionCss.includes(selector), true, `${selector} should live in construction.css`);
  }
});
test("research page styles live in the research stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const researchCssUrl = new URL("../src/styles/research.css", import.meta.url);
  assert.equal(existsSync(researchCssUrl), true);
  const researchCss = readFileSync(researchCssUrl, "utf8");
  const researchSelectors = [
    ".research-panel",
    ".research-topbar",
    ".research-summary",
    ".research-unlocks",
    ".research-command-panel",
    ".research-command-header",
    ".research-filter-grid",
    ".research-lanes",
    ".research-card",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/ResearchPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/research\.css";/);
  for (const selector of researchSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(researchCss.includes(selector), true, `${selector} should live in research.css`);
  }
});
test("activity page styles live in the activity stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const activityCssUrl = new URL("../src/styles/activity.css", import.meta.url);
  assert.equal(existsSync(activityCssUrl), true);
  const activityCss = readFileSync(activityCssUrl, "utf8");
  const activitySelectors = [
    ".activity-panel",
    ".activity-topbar",
    ".activity-overview",
    ".activity-command-panel",
    ".activity-command-head",
    ".activity-filter-grid",
    ".activity-filters",
    ".activity-options",
    ".activity-timeline",
    ".activity-event",
    ".activity-search-loading",
    ".activity-empty",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/ActivityPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/activity\.css";/);
  for (const selector of activitySelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(activityCss.includes(selector), true, `${selector} should live in activity.css`);
  }
});
test("region page styles live in the region stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const regionCssUrl = new URL("../src/styles/region.css", import.meta.url);
  assert.equal(existsSync(regionCssUrl), true);
  const regionCss = readFileSync(regionCssUrl, "utf8");
  const regionSelectors = [
    ".region-panel",
    ".region-topbar",
    ".region-rank-grid",
    ".region-summary-grid",
    ".region-insights",
    ".region-context",
    ".region-leaders-panel",
    ".region-table-panel",
    ".nearby-panel",
    ".mine-row",
    ".mine-text",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/RegionPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/region\.css";/);
  for (const selector of regionSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(regionCss.includes(selector), true, `${selector} should live in region.css`);
  }
});
test("sync page styles live in the sync stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const syncCssUrl = new URL("../src/styles/sync.css", import.meta.url);
  assert.equal(existsSync(syncCssUrl), true);
  const syncCss = readFileSync(syncCssUrl, "utf8");
  const syncSelectors = [
    ".sync-panel",
    ".sync-topbar",
    ".sync-frame",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/SyncPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/sync\.css";/);
  for (const selector of syncSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(syncCss.includes(selector), true, `${selector} should live in sync.css`);
  }
});
test("map page styles live in the map stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const mapCssUrl = new URL("../src/styles/map.css", import.meta.url);
  assert.equal(existsSync(mapCssUrl), true);
  const mapCss = readFileSync(mapCssUrl, "utf8");
  const mapSelectors = [
    ".map-panel.full-height",
    ".native-map-host",
    ".map-focus",
    ".map-workspace",
    ".map-resource-panel",
    ".map-resource-heading",
    ".map-resource-controls",
    ".map-selected-resources",
    ".map-resource-list",
    ".map-resource-icon",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8"), /import "\.\.\/styles\/map\.css";/);
  for (const selector of mapSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(mapCss.includes(selector), true, `${selector} should live in map.css`);
  }
});


test("admin page and loader styles live in the admin stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const adminCssUrl = new URL("../src/styles/admin.css", import.meta.url);
  assert.equal(existsSync(adminCssUrl), true);
  const adminCss = readFileSync(adminCssUrl, "utf8");
  const adminSelectors = [
    ".admin-loading-panel",
    ".admin-session-loader",
    ".admin-loader-orb",
    ".admin-loader-track",
    ".admin-loader-steps",
    ".admin-grid",
    ".admin-login",
    ".admin-console",
    ".admin-page",
    ".admin-tabs",
    ".admin-section",
    ".admin-metrics",
    ".scheduled-job-list",
    ".scheduled-job-row",
    ".database-browser",
    ".database-browser-header",
    ".database-toolbar",
    ".database-export-actions",
    ".admin-users",
    ".audit-list",
    ".backup-list",
    ".maintenance-card",
    ".analytics-admin",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8"), /import "\.\.\/\.\.\/styles\/admin\.css";/);
  for (const selector of adminSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(adminCss.includes(selector), true, `${selector} should live in admin.css`);
  }
});

test("Discord admin and bot section styles live in the Discord admin stylesheet", () => {
  const globalCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const mainTsx = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const discordAdminCssUrl = new URL("../src/styles/discord-admin.css", import.meta.url);
  assert.equal(existsSync(discordAdminCssUrl), true);
  const discordAdminCss = readFileSync(discordAdminCssUrl, "utf8");
  const discordAdminSelectors = [
    ".discord-admin",
    ".bot-admin-section",
    ".bot-section-setup",
    ".discord-presence-card",
    ".discord-rule-grid",
    ".discord-channel-card",
    ".craft-channel-grid",
    ".colour-role-grid",
    ".discord-panel-grid",
    ".role-option-list",
    ".discord-tool-actions",
    ".moderation-grid",
    ".discord-audit-report",
    ".discord-report",
    ".discord-test-grid",
    ".role-manager-layout",
    ".discord-terminal",
  ];

  const startsOwnedSelector = (css, selector) => css
    .split(/\r?\n/)
    .some((line) => line.trim().startsWith(`${selector} {`) || line.trim().startsWith(`${selector},`));

  assert.match(readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8"), /import "\.\.\/\.\.\/styles\/discord-admin\.css";/);
  for (const selector of discordAdminSelectors) {
    assert.equal(startsOwnedSelector(globalCss, selector), false, `${selector} standalone styles should not live in styles.css`);
    assert.equal(discordAdminCss.includes(selector), true, `${selector} should live in discord-admin.css`);
  }
});

