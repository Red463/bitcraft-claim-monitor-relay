import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const routeStyles = new Map([
  ["DashboardPage.tsx", "dashboard.css"],
  ["LeaderboardPage.tsx", "leaderboard.css"],
  ["MembersPage.tsx", "members.css"],
  ["SkillsPage.tsx", "skills.css"],
  ["ProductionPage.tsx", "production.css"],
  ["CraftPlanningPage.tsx", "craft-planning.css"],
  ["InventoryPage.tsx", "inventory.css"],
  ["ConstructionPage.tsx", "construction.css"],
  ["ResearchPage.tsx", "research.css"],
  ["MarketPage.tsx", "market.css"],
  ["RegionPage.tsx", "region.css"],
  ["EmpiresPage.tsx", "empires.css"],
  ["ActivityPage.tsx", "activity.css"],
  ["PublicCraftFinderPage.tsx", "public-craft.css"],
  ["CraftCalculatorPage.tsx", "craftcalc.css"],
  ["MapPage.tsx", "map.css"],
  ["SyncPage.tsx", "sync.css"],
]);

test("main keeps feature styles out of the eager entry graph", () => {
  const main = source("../src/main.tsx");

  for (const stylesheet of routeStyles.values()) {
    assert.doesNotMatch(main, new RegExp(`styles/${stylesheet.replace(".", "\\.")}`));
  }
  assert.match(main, /import "\.\/styles\.css";/);
  assert.match(main, /React\.lazy/);
  assert.match(main, /Suspense/);
  assert.match(main, /RouteErrorBoundary/);
});

test("public and admin pages are delivered through lazy route boundaries", () => {
  const appShell = source("../src/AppShell.tsx");
  const routes = [
    "DashboardPage", "LeaderboardPage", "MembersPage", "SkillsPage", "ProductionPage",
    "CraftPlanningPage", "InventoryPage", "ConstructionPage", "ResearchPage", "MarketPage",
    "RegionPage", "EmpiresPage", "ActivityPage", "PublicCraftFinderPage", "CraftCalculatorPage",
    "MapPage", "SyncPage",
  ];

  for (const route of routes) {
    assert.match(appShell, new RegExp(`React\\.lazy\\(\\(\\) => import\\(\"\\./pages/${route}`), route);
  }
  assert.match(appShell, /React\.lazy\(\(\) => import\("\.\/components\/admin\/AdminPanel"\)/);
  assert.match(appShell, /<React\.Suspense\s+fallback=\{<RouteLoadingState/);
  assert.match(appShell, /<RouteErrorBoundary/);
  assert.match(appShell, /Try again/);
  assert.doesNotMatch(appShell, /^import \{[^\n]+\} from "\.\/pages\//m);
  assert.doesNotMatch(appShell, /^import \{ AdminPanel \}/m);
});

test("each feature route owns its stylesheet", () => {
  const main = source("../src/main.tsx");
  for (const [page, stylesheet] of routeStyles) {
    const pageSource = source(`../src/pages/${page}`);
    const ownedImport = new RegExp(`import \"\\.\\.\\/styles\\/${stylesheet.replace(".", "\\.")}\";`, "g");
    assert.equal(pageSource.match(ownedImport)?.length ?? 0, 1, `${page} should import ${stylesheet} exactly once`);
    assert.doesNotMatch(main, new RegExp(stylesheet.replace(".", "\\.")), stylesheet);
  }
});

test("sync owns recoverable iframe state while map is first-party", () => {
  const syncSource = source("../src/pages/SyncPage.tsx");
  assert.match(syncSource, /type FrameState = "loading" \| "ready" \| "timed-out" \| "failed"/);
  assert.match(syncSource, /setTimeout/);
  assert.match(syncSource, /onLoad=/);
  assert.match(syncSource, /onError=/);
  assert.match(syncSource, /Loading embedded/);
  assert.match(syncSource, /taking longer than expected/);
  assert.match(syncSource, /Retry/);
  assert.match(syncSource, /Open full page/);

  const mapSource = source("../src/pages/MapPage.tsx");
  assert.match(mapSource, /<NativeMap/);
  assert.doesNotMatch(mapSource, /<iframe|FrameState|Loading embedded map/);
});
