import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("application shell exposes contextual Obsidian Ledger surface modes", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  assert.match(appShell, /surfaceModeForPanel\(active\)/);
  assert.match(appShell, /surface-mode-\$\{surfaceMode\}/);
  assert.match(appShell, /surface-mode-bot/);
});

test("application tools use one anchored utility bar", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const utility = readFileSync(new URL("../src/components/app-chrome/AppUtilityBar.tsx", import.meta.url), "utf8");
  assert.match(appShell, /<AppUtilityBar/);
  assert.doesNotMatch(appShell, /layout\.floatingActionsCollapsed|mobileFloatingActionsOpen|floating-actions/);
  assert.match(utility, /aria-label="Application tools"/);
  assert.match(appShell, /Search commands/);
});

test("global refresh uses the page-cycle lifecycle with consistent manual feedback", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const utility = readFileSync(new URL("../src/components/app-chrome/AppUtilityBar.tsx", import.meta.url), "utf8");

  assert.match(appShell, /createPageRefreshController/);
  assert.match(appShell, /createPageRefreshTaskCoordinator/);
  assert.match(appShell, /cooldownRemainingMs/);
  assert.match(appShell, /PageRefreshProvider/);
  assert.match(appShell, /requestManualRefresh/);
  assert.match(appShell, /pageRefreshCycle/);
  assert.match(appShell, /pageRefreshCoordinator/);
  assert.match(utility, /aria-busy=\{action\.busy/);
  assert.match(utility, /aria-disabled=\{action\.disabled/);
  assert.match(appShell, /manualRefreshButtonLabel/);
  assert.match(appShell, /is-refreshing/);
  assert.match(appShell, /const manualRefreshIsCoolingDown = !manualRefreshIsRefreshing && manualRefreshCooldownMs > 0/);
  assert.match(appShell, /is-cooldown/);
  assert.match(utility, /className="refresh-cooldown-countdown"/);
  assert.match(appShell, /manualRefreshCooldownSeconds\}s/);
  assert.match(appShell, /role="status"[^>]*aria-live="polite"/s);
  assert.match(appShell, /Data refreshed/);
  assert.match(appShell, /Refresh available in/);
  assert.match(appShell, /manualRefreshIssueCount/);
  assert.match(appShell, /state\.stale \? 1 : 0/);
  assert.match(appShell, /pageGameDataWarnings\(active, partialErrors\)/);
  assert.match(appShell, /<PageRefreshProvider[\s\S]*\{activePanel\}[\s\S]*<\/PageRefreshProvider>/);
});

test("page cadence is centralized while notification and deal timers stay independent", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  assert.match(appShell, /pageRefreshController\.setIntervalMs\(appSettings\.refreshSeconds \* 1000\)/);
  assert.match(appShell, /createPageGameDataGenerationWatcher/);
  assert.match(appShell, /activePanel:\s*active/);
  assert.doesNotMatch(appShell, /createGameDataGenerationWatcher\(/);
  assert.match(appShell, /schedule\(setNotificationRefreshToken/);
  assert.match(appShell, /schedule\(setDealRefreshToken/);
  assert.doesNotMatch(appShell, /schedule\(setRefreshToken|schedule\(setHistoryAutoRefreshToken/);
});

test("obsolete floating action rail CSS is removed after tools move to the utility bar", () => {
  const css = readFileSync(new URL("../src/styles/app-chrome.css", import.meta.url), "utf8");

  assert.doesNotMatch(css, /\.floating-actions|\.floating-action-item|\.floating-actions-toggle/);
  assert.match(css, /\.app-utility-refresh\.is-refreshing\s+svg/);
});
test("footer presents build provenance and secondary actions in a flat two-part layout", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const footer = readFileSync(new URL("../src/components/app-chrome/AppFooter.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(appShell, /fetch\(`\$\{LOCAL_API\}\/health`, \{ cache: "no-store" \}\)/);
  assert.match(appShell, /setAppBuildId/);
  assert.match(appShell, /appBuildIdRef/);
  assert.match(appShell, /footer-build/);
  assert.match(appShell, /<AppFooter/);
  assert.match(footer, /className="footer-primary"/);
  assert.match(footer, /className="footer-secondary"/);
  assert.match(appShell, /APP_VERSION/);
  assert.match(css, /\.app-footer\s*\{[^}]*border-top:\s*1px solid var\(--line-subtle\)[^}]*background:\s*var\(--canvas\)[^}]*box-shadow:\s*none/s);
  const buildRule = css.match(/\.app-footer \.footer-build\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";
  assert.doesNotMatch(buildRule, /border|border-radius|background|padding/);
});

test("dedicated map mode keeps the map route while omitting optional application chrome", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /const dedicatedMapView = isDedicatedMapView\(routeSearch\)/);
  assert.match(appShell, /<MapPanel[^>]*dedicated=\{dedicatedMapView\}/s);
  assert.match(appShell, /sidebar=\{dedicatedMapView \? null/);
  assert.match(appShell, /footer=\{!dedicatedMapView && active !== "admin" \? <AppFooter/);
  assert.match(appShell, /app-shell[^`]*\$\{dedicatedMapView \? "map-dedicated-shell" : ""\}/);
  assert.match(appShell, /utilityBar=\{dedicatedMapView \? null : <AppUtilityBar/);
  assert.match(appShell, /\{!dedicatedMapView \? \([\s\S]*release-update-banner/);
  assert.match(appShell, /LegalAcceptanceDialog/);
});
test("shared refresh chrome is provider-neutral during the Relay migration", () => {
  const appChrome = readFileSync(new URL("../src/components/main/AppChrome.tsx", import.meta.url), "utf8");
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appChrome, /Technical warning details/);
  assert.match(appChrome, /Copyable diagnostic context/);
  assert.match(appShell, /warnings=\{apiWarnings\}/);
  assert.match(appChrome, /Unable to refresh live game data/);
  assert.match(appChrome, /data provider may be having a temporary issue/i);
  assert.doesNotMatch(appChrome, /bitjita/i);
});
test("app chrome uses the approved Claim Monitor logo and favicon as defaults", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const publicDirectory = new URL("../public/", import.meta.url);

  assert.match(index, /type="image\/x-icon" href="\/favicon\.ico"/);
  assert.match(appShell, /const DEFAULT_APP_LOGO_URL = "\/claim-monitor-logo\.png"/);
  assert.match(appShell, /const DEFAULT_FAVICON_URL = "\/favicon\.ico"/);
  assert.match(appShell, /logoUrl:\s*appSettings\.branding\.logo/);
  assert.match(appShell, /fallbackLogoUrl:\s*DEFAULT_APP_LOGO_URL/);
  assert.equal(existsSync(new URL("claim-monitor-logo.png", publicDirectory)), true);
  assert.equal(existsSync(new URL("favicon.ico", publicDirectory)), true);
});

test("configured branding falls back to bundled logo and favicon after load errors", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("../src/components/app-chrome/AppSidebar.tsx", import.meta.url), "utf8");

  assert.match(appShell, /fallbackLogoUrl:\s*DEFAULT_APP_LOGO_URL/);
  assert.match(sidebar, /event\.currentTarget\.onerror = null/);
  assert.match(appShell, /const probe = new Image\(\)/);
  assert.match(appShell, /probe\.onerror = \(\) => \{[\s\S]*link\.href = DEFAULT_FAVICON_URL;[\s\S]*link\.type = "image\/x-icon";/);
  assert.match(appShell, /let disposed = false;/);
  assert.match(appShell, /return \(\) => \{\s*disposed = true;/s);
});
test("sidebar exposes a persistent app account sign-in affordance", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(appShell, /sidebar-account-card/);
  assert.match(appShell, /Not signed in/);
  assert.match(appShell, /Sign in to save settings and verify your character/);
  assert.match(appShell, /Sign in with Discord/);
  assert.match(appShell, /Join Discord Server/);
  assert.match(appShell, /setUserSettingsOpen\(true\)/);
  assert.match(css, /\.sidebar-account-card/);
  assert.match(css, /\.sidebar-account-avatar/);
  assert.match(css, /\.sidebar-account-action/);
  assert.match(css, /\.sidebar-top-stack/);
  assert.match(css, /nav a, nav button \{[^}]*min-height:\s*34px/s);
  assert.match(css, /nav a\.active, nav button\.active \{[^}]*inset 2px 0 0 var\(--active-color\)/s);
});
test("sidebar overview label preserves the existing command group key", () => {
  const navigation = readFileSync(new URL("../src/navigation.ts", import.meta.url), "utf8");

  assert.match(navigation, /\{\s*id:\s*"command",\s*label:\s*"Overview"/);
  assert.doesNotMatch(navigation, /\{\s*id:\s*"overview"/);
  assert.doesNotMatch(navigation, /label:\s*"Command"/);
});

test("dedicated AppShell supplies every existing chrome capability to shared components", () => {
  const shell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /from "\.\/components\/app-chrome"/);
  assert.match(shell, /<AppFrame/);
  assert.match(shell, /<AppSidebar/);
  assert.match(shell, /<AppUtilityBar/);
  assert.match(shell, /<AppFooter/);
  for (const capability of ["Sign in with Discord", "Join Discord Server", "Search commands", "Admin console", "Browser settings", "Updates", "Help and application information", "Privacy & Analytics", "Terms & Bot Use"]) {
    assert.match(shell, new RegExp(capability.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("both profiles keep one shared frame contract", () => {
  const dedicated = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const publicChrome = readFileSync(new URL("../src/public/PublicChrome.tsx", import.meta.url), "utf8");
  assert.match(dedicated, /<AppFrame/);
  assert.match(publicChrome, /<AppFrame/);
  assert.doesNotMatch(publicChrome, /from\s+["']\.\.\/AppShell["']/);
});

