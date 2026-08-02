import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { claimPendingAction, releasePendingAction } from "../src/utils/pendingActions.ts";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("pending action registry rejects duplicate submissions until release", () => {
  const pending = new Set();
  assert.equal(claimPendingAction(pending, "discord:test"), true);
  assert.equal(claimPendingAction(pending, "discord:test"), false);
  releasePendingAction(pending, "discord:test");
  assert.equal(claimPendingAction(pending, "discord:test"), true);
});

test("shared async states expose distinct accessible semantics without owning page copy", () => {
  const url = new URL("../src/components/main/AsyncState.tsx", import.meta.url);
  assert.equal(existsSync(url), true);
  const component = readFileSync(url, "utf8");

  assert.match(component, /"loading"\s*\|\s*"empty"\s*\|\s*"no-match"\s*\|\s*"restricted"\s*\|\s*"stale"\s*\|\s*"warning"\s*\|\s*"error"/);
  assert.match(component, /kind === "error" \? "alert" : "status"/);
  assert.match(component, /aria-live=/);
  assert.match(component, /title: string/);
  assert.doesNotMatch(component, /Nothing here|No records found|Something went wrong/);
});

test("action buttons preserve validation disabling while announcing pending work", () => {
  const url = new URL("../src/components/main/ActionButton.tsx", import.meta.url);
  assert.equal(existsSync(url), true);
  const component = readFileSync(url, "utf8");

  assert.match(component, /pending: boolean/);
  assert.match(component, /pendingLabel: string/);
  assert.match(component, /disabled=\{disabled \|\| pending\}/);
  assert.match(component, /aria-busy=\{pending\}/);
});

test("public routes distinguish initial loading, settled empty, no match, restricted, partial, stale, and error states", () => {
  const files = [
    "../src/pages/LeaderboardPage.tsx",
    "../src/pages/EmpiresPage.tsx",
    "../src/pages/PublicCraftFinderPage.tsx",
    "../src/pages/InventoryPage.tsx",
    "../src/pages/CraftCalculatorPage.tsx",
  ].map(source).join("\n");

  for (const kind of ["loading", "empty", "no-match", "restricted", "error"]) {
    assert.match(files, new RegExp(`kind=[{]?\\"${kind}\\"`));
  }
  const appChrome = source("../src/components/main/AppChrome.tsx");
  assert.match(appChrome, /kind: "stale" as const/);
  assert.match(appChrome, /kind: "warning" as const/);
  assert.match(files, /AppSkeleton/);
});

test("refresh failures preserve previously rendered public data", () => {
  const leaderboard = source("../src/pages/LeaderboardPage.tsx");
  const empires = source("../src/pages/EmpiresPage.tsx");

  assert.match(leaderboard, /setState\(\(current\) => \(\{ \.{3}current, error:/);
  assert.match(empires, /setState\(\(current\) => \(\{ \.{3}current, loading: false, error:/);
});

test("admin mutations have keyed duplicate protection and accessible result announcements", () => {
  const admin = source("../src/components/admin/AdminPanel.tsx");

  assert.match(admin, /claimPendingAction\(pendingActionsRef\.current, busyKey\)/);
  assert.match(admin, /releasePendingAction\(pendingActionsRef\.current, busyKey\)/);
  assert.match(admin, /async function run\([\s\S]*?busyKey: string\)/);
  assert.match(admin, /role=\{messageKind === "error" \? "alert" : "status"\}/);
  assert.match(admin, /aria-live=\{messageKind === "error" \? "assertive" : "polite"\}/);
});

test("listed Discord mutation surfaces render pending-aware action buttons", () => {
  const files = [
    "../src/components/bot/DiscordNotificationsSection.tsx",
    "../src/components/bot/DiscordColourRolesSection.tsx",
    "../src/components/bot/DiscordRoleManagerSection.tsx",
    "../src/components/bot/DiscordRolePanelsSection.tsx",
    "../src/components/bot/DiscordModerationSection.tsx",
    "../src/components/bot/DiscordSafetySection.tsx",
    "../src/components/bot/DiscordTestsPanel.tsx",
    "../src/components/bot/DiscordDiagnosticsPanel.tsx",
  ].map(source);

  for (const file of files) {
    assert.match(file, /ActionButton/);
    assert.match(file, /pending=/);
    assert.match(file, /pendingLabel=/);
  }
});

test("YouTube monitor gives every external action stable pending ownership", () => {
  const youtube = source("../src/components/bot/DiscordYouTubeMonitorSection.tsx");
  const admin = source("../src/components/admin/AdminPanel.tsx");

  assert.match(youtube, /import \{ ActionButton \}/);
  assert.match(youtube, /isPending: \(key: string\) => boolean/);
  for (const key of [
    "youtube-refresh",
    "youtube-add",
    "youtube-target:${channel.channelId}",
    "youtube-check:${channel.channelId}",
    "youtube-toggle:${channel.channelId}",
    "youtube-remove:${channel.channelId}",
  ]) {
    assert.ok(youtube.includes(key), `missing stable pending key ${key}`);
  }
  assert.equal((youtube.match(/<ActionButton/g) ?? []).length, 5);
  assert.equal((youtube.match(/pending=\{isPending\(/g) ?? []).length, 5);
  assert.match(youtube, /optionalChannelIdSelect\([\s\S]*?isPending\(`youtube-target:\$\{channel\.channelId\}`\)/);
  assert.match(youtube, /Updating channel\.\.\./);
  assert.match(admin, /<DiscordYouTubeMonitorSection[\s\S]*?isPending=\{isBusyAction\}/);
});

test("initial route failures and skeletons are exclusive from empty operational content", () => {
  const leaderboard = source("../src/pages/LeaderboardPage.tsx");
  const publicCrafts = source("../src/pages/PublicCraftFinderPage.tsx");
  const empires = source("../src/pages/EmpiresPage.tsx");

  assert.match(leaderboard, /if \(state\.loading && !state\.data\) return <AppSkeleton \/>;\s*if \(state\.error && !state\.data\) return <AsyncState kind="error"/);
  assert.match(publicCrafts, /if \(providerLoading && !providerData\) return <AppSkeleton \/>;\s*if \(providerError && !providerData\) return <AsyncState kind="error"/);
  assert.match(empires, /overview\.loading && !overview\.data\s*\? <AppSkeleton \/>\s*:\s*overview\.error && !overview\.data\s*\? <AsyncState kind="error"/);
  assert.match(empires, /watchtowers\.loading && !watchtowers\.data\s*\? <AppSkeleton \/>\s*:\s*watchtowers\.error && !watchtowers\.data\s*\? <AsyncState kind="error"/);
});
