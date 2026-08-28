import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const leaderboardPage = readFileSync(new URL("../src/pages/LeaderboardPage.tsx", import.meta.url), "utf8");

test("Leaderboard renders a restricted state when every category is denied", () => {
  assert.match(leaderboardPage, /resolveAllowedView\(activeTab, visibleTabs\.map\(\(tab\) => tab\.id\)\)/);
  assert.match(leaderboardPage, /No leaderboard categories are available for your account\./);
});

test("Leaderboard page lives outside the legacy MainPages bundle", () => {
  const mainPagesUrl = new URL("../src/pages/MainPages.tsx", import.meta.url);
  const mainPages = existsSync(mainPagesUrl) ? readFileSync(mainPagesUrl, "utf8") : "";
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const leaderboardPageUrl = new URL("../src/pages/LeaderboardPage.tsx", import.meta.url);

  assert.equal(existsSync(leaderboardPageUrl), true);
  assert.doesNotMatch(mainPages, new RegExp("export function Leaderboard\\b"));
  assert.match(appShell, /lazyRoute\(\(\) => import\("\.\/pages\/LeaderboardPage"\)/);
});

test("Leaderboard summary steps down to two columns and then one", () => {
  const css = readFileSync(new URL("../src/styles/leaderboard.css", import.meta.url), "utf8");

  assert.match(css, /\.leaderboard-page\s*\{[^}]*align-content:\s*start;/s);
  assert.match(css, /@media \(max-width:\s*1250px\)[\s\S]*\.leaderboard-summary\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.leaderboard-summary\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.leaderboard-filter\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0/s);
});

test("Leaderboard time columns provide raw values for sorting", () => {
  const leaderboard = readFileSync(new URL("../src/pages/LeaderboardPage.tsx", import.meta.url), "utf8");

  for (const field of ["lastContributedAt", "lastActivityAt", "lastSaleAt", "lastLoginTimestamp"]) {
    assert.match(leaderboard, new RegExp(`timestampMs\\(entry\\.${field}\\)`), `${field} should sort by its timestamp`);
  }
  for (const field of ["sessionSeconds", "timePlayedSeconds", "timeSignedInSeconds"]) {
    assert.match(leaderboard, new RegExp(`toNumber\\(entry\\.${field}\\)`), `${field} should sort by raw seconds`);
  }
});

test("Leaderboard describes Relay current data without legacy provider coupling", () => {
  assert.match(leaderboardPage, /current Relay citizen profession data/);
  assert.match(leaderboardPage, /current Relay member and player data/);
  assert.doesNotMatch(leaderboardPage, /bitjita/i);
});

test("Leaderboard shows retained-data refresh progress only for manual cycles", () => {
  assert.match(leaderboardPage, /pageRefreshShowsRetainedDataProgress/);
  assert.match(leaderboardPage, /const showRefreshProgress = pageRefreshShowsRetainedDataProgress\(request\)/);
  assert.match(leaderboardPage, /state\.loading && state\.data && showRefreshProgress \? <AsyncState kind="loading" title="Refreshing contribution history"/);
  assert.doesNotMatch(leaderboardPage, /\{state\.loading \? <AsyncState kind="loading" title="Refreshing contribution history"/);
});
