import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("floating action rail can be collapsed with persisted state and accessible toggle", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /usePersistedState\("layout\.floatingActionsCollapsed", false\)/);
  assert.match(appShell, /useState\(false\).*mobileFloatingActionsOpen|mobileFloatingActionsOpen.*useState\(false\)/s);
  assert.match(appShell, /isNarrowViewport\s*\?\s*!mobileFloatingActionsOpen\s*:\s*floatingActionsCollapsed/);
  assert.match(appShell, /isNarrowViewport\s*\?\s*setMobileFloatingActionsOpen/);
  assert.match(appShell, /floating-actions-collapsed/);
  assert.match(appShell, /aria-expanded=\{!narrowAwareFloatingActionsCollapsed\}/);
  assert.match(appShell, /Hide tools/);
  assert.match(appShell, /Show tools/);
});

test("global refresh uses the page-cycle lifecycle with consistent manual feedback", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /createPageRefreshController/);
  assert.match(appShell, /createPageRefreshTaskCoordinator/);
  assert.match(appShell, /cooldownRemainingMs/);
  assert.match(appShell, /PageRefreshProvider/);
  assert.match(appShell, /requestManualRefresh/);
  assert.match(appShell, /pageRefreshCycle/);
  assert.match(appShell, /pageRefreshCoordinator/);
  assert.match(appShell, /aria-busy=\{manualRefreshIsRefreshing\}/);
  assert.match(appShell, /aria-disabled=\{manualRefreshButtonDisabled\}/);
  assert.match(appShell, /manualRefreshButtonLabel/);
  assert.match(appShell, /is-refreshing/);
  assert.match(appShell, /const manualRefreshIsCoolingDown = !manualRefreshIsRefreshing && manualRefreshCooldownMs > 0/);
  assert.match(appShell, /manualRefreshIsCoolingDown \? "is-cooldown"/);
  assert.match(appShell, /className="refresh-cooldown-countdown"/);
  assert.match(appShell, /\{manualRefreshCooldownSeconds\}s/);
  assert.match(appShell, /manualRefreshIsCoolingDown\s*\?\s*\(\s*<span[\s\S]*:\s*\(\s*<RefreshCw size=\{18\}/);
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
  assert.match(appShell, /active !== "craft-monitor"/);
  assert.match(appShell, /createGameDataGenerationWatcher/);
  assert.match(appShell, /schedule\(setNotificationRefreshToken/);
  assert.match(appShell, /schedule\(setDealRefreshToken/);
  assert.doesNotMatch(appShell, /schedule\(setRefreshToken|schedule\(setHistoryAutoRefreshToken/);
});

test("floating action rail CSS slides collapsed rail offscreen with reduced motion support", () => {
  const css = readFileSync(new URL("../src/styles/app-chrome.css", import.meta.url), "utf8");

  assert.match(css, /\.floating-actions\.floating-actions-collapsed\s*\{[^}]*translateX\(calc\(100% - 24px\)\)/s);
  assert.match(css, /\.floating-actions\.floating-actions-collapsed\s+\.floating-action-item\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.floating-actions-toggle/);
  assert.match(css, /\.floating-actions\.floating-actions-collapsed\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.floating-actions\s+\.floating-actions-toggle\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});
test("footer shows the app version and build id", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /fetch\(`\$\{LOCAL_API\}\/health`, \{ cache: "no-store" \}\)/);
  assert.match(appShell, /setAppBuildId/);
  assert.match(appShell, /appBuildIdRef/);
  assert.match(appShell, /footer-build/);
  assert.match(appShell, /APP_VERSION/);
});

test("dedicated map mode keeps the map route while omitting optional application chrome", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /const dedicatedMapView = isDedicatedMapView\(routeSearch\)/);
  assert.match(appShell, /<MapPanel[^>]*dedicated=\{dedicatedMapView\}/s);
  assert.match(appShell, /!dedicatedMapView \? \([\s\S]*className="mobile-shell-bar"/);
  assert.match(appShell, /\{!dedicatedMapView \? <footer className="app-footer">/);
  assert.match(appShell, /app-shell[^`]*\$\{dedicatedMapView \? "map-dedicated-shell" : ""\}/);
  assert.match(appShell, /\{!dedicatedMapView \? \([\s\S]*release-update-banner[\s\S]*floating-actions/);
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
  assert.match(appShell, /appSettings\.branding\.logo\s*\?\s*<img[\s\S]*:\s*<img src=\{DEFAULT_APP_LOGO_URL\} alt=""/);
  assert.equal(existsSync(new URL("claim-monitor-logo.png", publicDirectory)), true);
  assert.equal(existsSync(new URL("favicon.ico", publicDirectory)), true);
});

test("configured branding falls back to bundled logo and favicon after load errors", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /onError=\{\(event\) => \{\s*event\.currentTarget\.onerror = null;\s*event\.currentTarget\.src = DEFAULT_APP_LOGO_URL;/s);
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

