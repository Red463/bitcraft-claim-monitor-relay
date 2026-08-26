import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("AppShell wires first-run tour manager and suppresses app popups while tour is active", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /import \{ FirstRunTourManager \} from "\.\/components\/main\/FirstRunTourManager";/);
  assert.match(appShell, /const \[tourVisible, setTourVisible\] = React\.useState\(false\);/);
  assert.match(appShell, /<FirstRunTourManager/);
  assert.match(appShell, /onNavigate=\{\(panel\) => navigate\(panel\)\}/);
  assert.match(appShell, /onVisibilityChange=\{setTourVisible\}/);
  assert.doesNotMatch(appShell, /<FirstRunTourManager[\s\S]*onOpenUserSettings=/);
  assert.doesNotMatch(appShell, /onCloseUserSettings=/);
  assert.match(appShell, /<FirstRunTourManager[\s\S]*enabled=\{[\s\S]*consent != null[\s\S]*replayToken=/);
  assert.match(appShell, /\{!tourVisible \? <ToastStack/);
  assert.match(appShell, /<AppPopupManager[\s\S]*!tourVisible/);
});

test("HelpCenter exposes a manual app tour replay action", () => {
  const legalDialogs = readFileSync(new URL("../src/components/main/LegalDialogs.tsx", import.meta.url), "utf8");

  assert.match(legalDialogs, /onStartTour/);
  assert.match(legalDialogs, /Start app tour/);
});


test("first-run tour prompt introduces Claim Monitor before offering the tour", () => {
  const manager = readFileSync(new URL("../src/components/main/FirstRunTourManager.tsx", import.meta.url), "utf8");

  assert.match(manager, /Welcome to Claim Monitor/);
  assert.match(manager, /Claim Monitor helps your settlement keep track of production, members, markets, inventory, construction, research, empire activity, and map information in one place\./);
  assert.match(manager, /Take a short tour to find what needs attention, jump to a task, and know where to get help\./);
});

test("settings remains modal while a disabled tour hands visibility back", () => {
  const manager = readFileSync(new URL("../src/components/main/FirstRunTourManager.tsx", import.meta.url), "utf8");
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(manager, /reportedTourVisibility\(enabled, tourState\)/);
  assert.match(appShell, /<UserSettingsDialog[\s\S]*?\bmodal\b[\s\S]*?onClose=/);
  assert.doesNotMatch(appShell, /modal=\{!tourVisible\}/);
});

test("tour replay waits for the shared modal coordinator to clear", () => {
  const manager = readFileSync(new URL("../src/components/main/FirstRunTourManager.tsx", import.meta.url), "utf8");

  assert.match(manager, /shouldHandleTourReplay\(enabled, replayToken, handledReplayTokenRef\.current\)/);
  assert.match(manager, /handledReplayTokenRef\.current = replayToken/);
  assert.match(manager, /if \(!enabled\) return null;/);
  assert.doesNotMatch(manager, /if \(!enabled && !running\) return null;/);
});

test("command palette keeps restricted public routes actionable while hiding unauthenticated Admin", () => {
  const palette = readFileSync(new URL("../src/components/main/CommandPalette.tsx", import.meta.url), "utf8");

  assert.match(palette, /visiblePagePaletteItems\(NAV, adminAuthenticated\)/);
  assert.match(palette, /buildPagePaletteCommands\(pageItems, allowedPages\)/);
  assert.match(palette, /activatePagePaletteCommand\(command, onNavigate\)/);
  assert.match(palette, /data-restricted=\{command\.locked \|\| undefined\}/);
  assert.doesNotMatch(palette, /aria-disabled=\{command\.locked\}/);
});

test("tour card stacks above the spotlight dim layer", () => {
  const css = readFileSync(new URL("../src/styles/first-run-tour.css", import.meta.url), "utf8");
  const rootCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(css, /\.first-run-tour-overlay \{[^}]*z-index: calc\(var\(--z-overlay\) \+ 12\)/);
  assert.match(css, /\.first-run-tour-spotlight \{[^}]*z-index: 1/);
  assert.match(css, /\.first-run-tour-card \{[^}]*z-index: 2/);
  assert.match(rootCss, /--z-cookie: 60;/);
});

test("guided tour keeps highlighted targets crisp while the welcome prompt may blur", () => {
  const css = readFileSync(new URL("../src/styles/first-run-tour.css", import.meta.url), "utf8");

  assert.match(css, /\.first-run-tour-overlay\s*\{[^}]*backdrop-filter:\s*none;/s);
  assert.match(css, /\.first-run-tour-prompt-overlay,\s*\.first-run-tour-overlay\.is-centered\s*\{[^}]*backdrop-filter:\s*blur\(3px\);/s);
});

test("tour does not force a settings modal open during guided steps", () => {
  const manager = readFileSync(new URL("../src/components/main/FirstRunTourManager.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(manager, /step\.action === "settings"/);
  assert.doesNotMatch(manager, /onOpenUserSettings\?\.\(\);/);
});
test("tour anchors are stable data attributes rather than CSS selectors", () => {
  const appSidebar = readFileSync(new URL("../src/components/app-chrome/AppSidebar.tsx", import.meta.url), "utf8");
  const appUtilityBar = readFileSync(new URL("../src/components/app-chrome/AppUtilityBar.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/pages/DashboardPage.tsx", import.meta.url), "utf8");
  const leaderboard = readFileSync(new URL("../src/pages/LeaderboardPage.tsx", import.meta.url), "utf8");
  const members = readFileSync(new URL("../src/pages/MembersPage.tsx", import.meta.url), "utf8");
  const skills = readFileSync(new URL("../src/pages/SkillsPage.tsx", import.meta.url), "utf8");
  const production = readFileSync(new URL("../src/pages/ProductionPage.tsx", import.meta.url), "utf8");
  const inventory = readFileSync(new URL("../src/pages/InventoryPage.tsx", import.meta.url), "utf8");
  const construction = readFileSync(new URL("../src/pages/ConstructionPage.tsx", import.meta.url), "utf8");
  const research = readFileSync(new URL("../src/pages/ResearchPage.tsx", import.meta.url), "utf8");
  const market = readFileSync(new URL("../src/pages/MarketPage.tsx", import.meta.url), "utf8");
  const region = readFileSync(new URL("../src/pages/RegionPage.tsx", import.meta.url), "utf8");
  const empires = readFileSync(new URL("../src/pages/EmpiresPage.tsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("../src/pages/map/MapPlayerTrackingPanel.tsx", import.meta.url), "utf8");
  const activity = readFileSync(new URL("../src/pages/ActivityPage.tsx", import.meta.url), "utf8");
  const publicCrafts = readFileSync(new URL("../src/pages/PublicCraftFinderPage.tsx", import.meta.url), "utf8");
  const craftCalculator = readFileSync(new URL("../src/pages/CraftCalculatorPage.tsx", import.meta.url), "utf8");
  const sync = readFileSync(new URL("../src/pages/SyncPage.tsx", import.meta.url), "utf8");
  const userSettingsDialog = readFileSync(new URL("../src/components/main/UserSettingsDialog.tsx", import.meta.url), "utf8");

  assert.match(appSidebar, /data-tour="sidebar-navigation"/);
  assert.match(appUtilityBar, /data-tour="floating-actions"/);
  assert.match(dashboard, /data-tour="dashboard-summary"/);
  assert.match(leaderboard, /data-tour="leaderboard-page"/);
  assert.match(members, /data-tour="members-page"/);
  assert.match(skills, /data-tour="skills-page"/);
  assert.match(production, /data-tour="production-controls"/);
  assert.match(inventory, /data-tour="inventory-page"/);
  assert.match(construction, /data-tour="construction-page"/);
  assert.match(research, /data-tour="research-page"/);
  assert.match(market, /data-tour="market-tools"/);
  assert.match(region, /data-tour="region-page"/);
  assert.match(empires, /data-tour="empires-page"/);
  assert.match(map, /data-tour="map-player-tracking"/);
  assert.match(activity, /data-tour="activity-controls"/);
  assert.match(publicCrafts, /data-tour="publiccrafts-page"/);
  assert.match(craftCalculator, /data-tour="craftcalc-page"/);
  assert.match(sync, /data-tour="sync-page"/);
  assert.match(userSettingsDialog, /dataTour="user-settings"/);
});

