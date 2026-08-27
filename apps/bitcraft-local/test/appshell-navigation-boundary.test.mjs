import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
const appFrame = readFileSync(new URL("../src/components/app-chrome/AppFrame.tsx", import.meta.url), "utf8");
const appSidebar = readFileSync(new URL("../src/components/app-chrome/AppSidebar.tsx", import.meta.url), "utf8");
const adminPanel = readFileSync(new URL("../src/components/admin/AdminPanel.tsx", import.meta.url), "utf8");
const commandPalette = readFileSync(new URL("../src/components/main/CommandPalette.tsx", import.meta.url), "utf8");
const dashboardPage = readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../src/navigation.ts", import.meta.url), "utf8");
const productionPage = readFileSync(new URL("../src/pages/ProductionPage.tsx", import.meta.url), "utf8");
const settlementMarketPage = readFileSync(new URL("../src/pages/SettlementMarketPage.tsx", import.meta.url), "utf8");
const routeStateUrl = new URL("../src/navigation/routeState.ts", import.meta.url);
const routeState = existsSync(routeStateUrl) ? readFileSync(routeStateUrl, "utf8") : "";
const shellCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

let routeStateModule = {};
try {
  routeStateModule = await import("../src/navigation/routeState.ts");
} catch {
  // RED starts with the route-state module absent.
}

let navigationLabelsModule = {};
try {
  navigationLabelsModule = await import("../src/navigation/navigationLabels.ts");
} catch {
  // RED starts with the navigation-label helpers absent.
}

const { normalizeBootstrap } = await import("../src/api/bootstrap.ts");

test("route-state helpers distinguish explicit navigation from normalization", () => {
  assert.equal(typeof routeStateModule.writePageLocation, "function");
  assert.match(routeState, /export type NavigationMode = "push" \| "replace"/);

  const calls = [];
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { href: "http://localhost/?page=dashboard&tab=live#status" },
    history: {
      pushState: (_state, _title, href) => calls.push(["push", href]),
      replaceState: (_state, _title, href) => calls.push(["replace", href]),
    },
  };
  try {
    routeStateModule.writePageLocation("market", "push");
    routeStateModule.writePageLocation("craft-monitor", "replace");
  } finally {
    globalThis.window = originalWindow;
  }

  assert.deepEqual(calls, [
    ["push", "/?page=market&tab=live#status"],
    ["replace", "/?page=craft-monitor#status"],
  ]);
});

test("page navigation removes query state owned by other pages", () => {
  const calls = [];
  const originalWindow = globalThis.window;
  globalThis.window = {
    location: { href: "http://localhost/?page=map&mapLayers=resource%3A42&mapView=fullscreen&plan=shared-plan&privacy=delete-ready#status" },
    history: {
      pushState: (_state, _title, href) => calls.push(href),
      replaceState: (_state, _title, href) => calls.push(href),
    },
  };
  try {
    routeStateModule.writePageLocation("planning", "push");
  } finally {
    globalThis.window = originalWindow;
  }

  assert.deepEqual(calls, [
    "/?page=planning&plan=shared-plan&privacy=delete-ready#status",
  ]);
});

test("legacy page IDs resolve to canonical page IDs", () => {
  assert.equal(typeof routeStateModule.canonicalPageId, "function");
  assert.equal(routeStateModule.canonicalPageId("production"), "craft-monitor");
  assert.equal(routeStateModule.canonicalPageId("empire"), "region");
  assert.equal(routeStateModule.canonicalPageId("craft-monitor"), "craft-monitor");
  assert.equal(routeStateModule.canonicalPageId("region"), "region");
  assert.equal(routeStateModule.canonicalPageId(null), null);
});

test("Market tab locations canonicalize aliases and clean invalid values", () => {
  assert.equal(typeof routeStateModule.marketViewLocation, "function");
  assert.deepEqual(routeStateModule.marketViewLocation("pricing"), { page: "market", view: "browse", canonicalTab: "browse", shouldReplace: true });
  assert.deepEqual(routeStateModule.marketViewLocation("buyOrders"), { page: "market", view: "opportunities", canonicalTab: "opportunities", shouldReplace: true });
  assert.deepEqual(routeStateModule.marketViewLocation("dealWatchlist"), { page: "market", view: "saved", canonicalTab: "saved", shouldReplace: true });
  assert.deepEqual(routeStateModule.marketViewLocation("live"), { page: "settlement-market", view: "live", canonicalTab: "live", shouldReplace: true });
  assert.deepEqual(routeStateModule.marketViewLocation("unknown"), { page: "market", view: "overview", canonicalTab: "overview", shouldReplace: true });
  assert.deepEqual(routeStateModule.marketViewLocation(null), { page: "market", view: "overview", canonicalTab: "overview", shouldReplace: true });
});

test("route shell restores history and announces explicit route changes", () => {
  assert.match(appShell, /window\.addEventListener\("popstate", restoreFromHistory\)/);
  assert.match(appShell, /function restoreFromHistory\(\) \{[\s\S]*?setRouteStatus\(""\)/);
  assert.match(appShell, /document\.title = `\$\{[^}]+\} — BitCraft Claim Monitor`/);
  assert.match(appShell, /role="status" aria-live="polite"/);
  assert.match(appShell, /mainRef\.current\?\.focus\(\)/);
  assert.match(appShell, /updateQueryState\(\{[\s\S]*?page: panel,[\s\S]*?\}, "push"\)/);
  assert.match(appShell, /const \[routeSearch, setRouteSearch\] = React\.useState\(\(\) => window\.location\.search\)/);
  assert.match(appShell, /function restoreFromHistory\(\) \{[\s\S]*?setRouteSearch\(window\.location\.search\)/);
  assert.match(appShell, /updateQueryState\([\s\S]*?"push"\);[\s\S]*?setRouteSearch\(window\.location\.search\)/);
  assert.match(appShell, /<Market[\s\S]*?locationSearch=\{routeSearch\}[\s\S]*?onQueryStateChange=\{syncRouteSearch\}/);
});

test("AppShell composes game data only from the active claim and page scope", () => {
  assert.match(appShell, /gameDataScopeKey\(claimId, activePanel\)/);
  assert.match(appShell, /state\.scopeKey === requestedGameDataScopeKey/);
  assert.match(appShell, /normalizeData\(state\.data\)/);
  assert.match(appShell, /state\.loading && !state\.data/);
});

test("AppShell owns one page-scoped provider generation watcher", () => {
  assert.match(appShell, /createPageGameDataGenerationWatcher\(\{/);
  assert.match(appShell, /activePanel:\s*active/);
  assert.match(appShell, /claimId,/);
  assert.match(appShell, /onGeneration:\s*\(\) => pageRefreshController\.invalidateGeneration\(\)/);
  assert.match(appShell, /return \(\) => watcher\?\.stop\(\)/);
  assert.doesNotMatch(appShell, /active !== "craft-monitor"/);
});

test("sidebar and command palette consume the same effective page access", () => {
  assert.match(appShell, /<CommandPalette adminAuthenticated=\{Boolean\(adminAuth\.authenticated\)\} access=\{effectiveAccess\}/);
  assert.match(commandPalette, /visiblePagePaletteItems\(NAV, adminAuthenticated\)/);
  assert.match(commandPalette, /effectiveTargetAllowed\(access, targetIdForPage\(id\)\)/);
  assert.match(commandPalette, /effectiveTargetAllowed\(access, targetIdForTab\("market", tab\)\)/);
  assert.match(commandPalette, /allowedPages\.has\("members"\)/);
});

test("dedicated bot route has a route title and level-one panel heading", () => {
  assert.match(appShell, /document\.title = "Discord Bot Control — BitCraft Claim Monitor"/);
  assert.match(appShell, /<AdminPanel[\s\S]*?botOnly headingLevel=\{1\}/);
  assert.match(adminPanel, /headingLevel\?: 1 \| 2/);
  assert.match(adminPanel, /const Heading = headingLevel === 1 \? "h1" : "h2"/);
});

test("bot console exposes Linked Accounts through the shared admin tab navigation", () => {
  assert.match(adminPanel, /const BOT_CONSOLE_TAB_GROUPS: AdminTabGroup\[\] = \[/);
  assert.match(adminPanel, /key: "discord", label: "Discord Bot Control"/);
  assert.match(adminPanel, /key: "accounts", label: "Linked Accounts"/);
  assert.match(adminPanel, /botOnly \? BOT_CONSOLE_TAB_GROUPS : ADMIN_TAB_GROUPS/);
  assert.match(adminPanel, /if \(!tabs\.some\(\(item\) => item\.key === tab\)\) setTab\(botOnly \? "discord" : "status"\)/);
});

test("dedicated legal routes set their titles from an effect", () => {
  assert.match(appShell, /function DedicatedLegalApp\([\s\S]*?React\.useEffect\(\(\) => \{[\s\S]*?document\.title/);
  assert.match(appShell, /return <DedicatedLegalPage type=\{type\} \/>/);
});

test("sidebar destinations keep restricted public pages discoverable and preserve active-route semantics", () => {
  assert.doesNotMatch(appShell, /group\.items\.filter\(\(\[id\]\) => isPageAllowed\(id\)\)/);
  assert.match(appShell, /const restricted = !isPageAllowed\(id\)/);
  assert.match(appShell, /href:\s*panelHref\(id\)/);
  assert.match(appShell, /active:\s*active === id/);
  assert.match(appSidebar, /className=\{\["nav-destination"/);
  assert.match(appSidebar, /<LockKeyhole className="nav-access-lock"/);
  assert.match(appSidebar, /aria-current=\{item\.active \? "page" : undefined\}/);
});

test("navigation retains existing groups and non-admin route IDs", () => {
  for (const groupId of ["command", "settlement", "economy", "tools"]) {
    assert.match(navigation, new RegExp(`id:\\s*"${groupId}"`));
  }

  for (const routeId of [
    "dashboard", "leaderboard", "members", "skills", "craft-monitor", "planning",
    "inventory", "construction", "research", "market", "region", "empires",
    "map", "activity", "publiccrafts", "craftcalc", "sync",
  ]) {
    assert.match(navigation, new RegExp(`\\["${routeId}",`));
  }
});

test("settlement navigation labels derive from the configured claim name", () => {
  assert.equal(typeof navigationLabelsModule.settlementNavigationLabel, "function");
  assert.equal(typeof navigationLabelsModule.settlementMarketTitle, "function");
  assert.equal(navigationLabelsModule.settlementNavigationLabel(" Timbersteel Trade "), "Timbersteel Trade");
  assert.equal(navigationLabelsModule.settlementNavigationLabel(""), "Settlement");
  assert.equal(navigationLabelsModule.settlementMarketTitle(" Timbersteel Trade "), "Timbersteel Trade Market");
  assert.equal(navigationLabelsModule.settlementMarketTitle(null), "Settlement Market");
});

test("settlement navigation identity survives pages without claim data", () => {
  const bootstrap = normalizeBootstrap({
    config: { claimId: "123", claimName: " Timbersteel Trade ", refreshSeconds: 30 },
    auth: {},
    legal: {},
    build: {},
  });

  assert.equal(bootstrap.config.claimName, "Timbersteel Trade");
  assert.match(appShell, /settlementNamesByClaim/);
  assert.match(appShell, /initialBootstrap\.config\.claimName/);
  assert.match(appShell, /settlementNavigationLabel\(settlementName\)/);
  assert.doesNotMatch(appShell, /settlementNavigationLabel\(data\.claim\.name\)/);
});

test("navigation and page headings use the approved settlement naming", () => {
  assert.match(navigation, /\["craft-monitor", "Craft Monitor", Factory\]/);
  assert.match(navigation, /\["settlement-market", "Local Market", CircleDollarSign\]/);
  assert.match(navigation, /\["region", "Region", Globe2\]/);
  assert.match(appShell, /group\.id === "settlement"\s*\?\s*settlementNavigationLabel\(settlementName\)\s*:\s*group\.label/);
  assert.match(productionPage, /title="Craft Monitor"/);
  assert.match(settlementMarketPage, /<h2>\{settlementMarketTitle\(data\.claim\?\.name\)\}<\/h2>/);
});

test("dashboard shortcuts navigate to canonical Craft Monitor and Region routes", () => {
  assert.match(dashboardPage, /onNavigate\("craft-monitor"\)/);
  assert.match(dashboardPage, /onNavigate\("region"\)/);
  assert.doesNotMatch(dashboardPage, /onNavigate\("(?:production|empire)"\)/);
});

test("narrow navigation exposes an accessible grouped drawer", () => {
  assert.match(appFrame, /const \[mobileOpen, setMobileOpen\] = React\.useState\(false\)/);
  assert.match(appFrame, /aria-controls="mobile-navigation"/);
  assert.match(appFrame, /aria-expanded=\{mobileOpen\}/);
  assert.match(appSidebar, /id="mobile-navigation"/);
  assert.match(appSidebar, /aria-label="Mobile navigation"/);
  assert.match(appFrame, /className="mobile-navigation-backdrop"/);
  const openClass = appSidebar.match(/className=\{`app-sidebar \$\{mobileOpen \? "([^"]+)"/)?.[1] ?? "";
  assert.equal(openClass, "mobile-open");
  assert.match(shellCss, new RegExp(`\\.app-sidebar\\.${openClass}\\s*\\{[^}]*transform:\\s*translateX\\(0\\)`, "s"));
  assert.match(appShell, /NAV_GROUPS\.map\(\(group\) =>/);
  assert.match(appShell, /group\.items\.map\(\(\[id, label, Icon\]\) =>/);
});

test("closed narrow drawer is hidden from accessibility and keyboard navigation without disabling desktop sidebar", () => {
  assert.match(appSidebar, /window\.matchMedia\("\(max-width: 760px\)"\)/);
  assert.match(appSidebar, /const mobileNavigationUnavailable = isNarrowViewport && !mobileOpen/);
  assert.match(appSidebar, /inert=\{mobileNavigationUnavailable \? true : undefined\}/);
  assert.match(appSidebar, /aria-hidden=\{mobileNavigationUnavailable \? true : undefined\}/);
});

test("mobile drawer closes with Escape and restores focus to its trigger", () => {
  assert.match(appFrame, /menuTriggerRef\.current\?\.focus\(\)/);
  assert.match(appFrame, /setMobileOpen\(false\)/);
});

test("ordinary route activation navigates before closing the mobile drawer", () => {
  assert.match(appShell, /event\.preventDefault\(\);\s*navigate\(id\);/);
  assert.match(appShell, /if \(event\.button !== 0 \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey\) return;/);
  assert.match(appSidebar, /item\.onActivate\?\.\(event\);[\s\S]*onRequestClose\(\)/);
});

test("restricted navigation has distinct expanded, collapsed, and mobile styling without relying on colour alone", () => {
  assert.match(shellCss, /\.nav-destination\.is-restricted/);
  assert.match(shellCss, /\.nav-access-lock/);
  assert.match(shellCss, /\.sidebar-collapsed nav a \.nav-access-lock/);
  assert.match(shellCss, /@media \(max-width: 760px\)[\s\S]*?\.nav-access-lock/);
});

test("route links expose collapsed labels while route changes retain scroll orientation", () => {
  assert.match(appSidebar, /<span className="nav-label">\{item\.label\}<\/span>[\s\S]*<span className="collapsed-nav-label" aria-hidden="true">\{item\.label\}<\/span>/);
  assert.match(appShell, /if \(mainRef\.current\) mainRef\.current\.scrollTop = 0;/);
  assert.match(appShell, /mainRef=\{mainRef\}/);
});

test("collapsed route tooltip is rendered outside the scrolling sidebar", () => {
  assert.match(appSidebar, /const \[tooltip, setTooltip\] = React\.useState/);
  assert.match(appSidebar, /onMouseEnter=\{\(event\) => showTooltip\(event\.currentTarget, accessibleLabel\)\}/);
  assert.match(appSidebar, /onFocus=\{\(event\) => showTooltip\(event\.currentTarget, accessibleLabel\)\}/);
  assert.match(appSidebar, /<\/aside>[\s\S]*className="collapsed-nav-tooltip"/);
  assert.match(appSidebar, /aria-hidden="true"/);
});

test("collapsed route tooltip is owned by the shared sidebar", () => {
  assert.doesNotMatch(appShell, /collapsedNavTooltip|navigationRef/);
  assert.match(appSidebar, /setTooltip\(null\)/);
});
