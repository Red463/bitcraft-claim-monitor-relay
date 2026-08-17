import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("player panel is the complete settlement-first manager", async () => {
  const source = await readFile(new URL("../src/pages/map/MapPlayerTrackingPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /"settlement" \| "all-players" \| "tracked"/);
  assert.match(source, /label: "Settlement"/);
  assert.match(source, /label: "All players"/);
  assert.match(source, /label: "Tracked"/);
  assert.match(source, />Auto</);
  assert.match(source, />Online</);
  assert.match(source, />All</);
  assert.match(source, />None</);
  assert.match(source, /Find settlement members/);
  assert.match(source, /resolvePlayerMarkerColours/);
  assert.match(source, /--player-marker-color/);
  assert.doesNotMatch(source, /<Dialog|managerOpen/);
});

test("player panel retains explicit external identities while positions are unavailable", async () => {
  const source = await readFile(new URL("../src/pages/map/MapPlayerTrackingPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /Offline - waiting for live position/);
  assert.match(source, /Clear external players/);
  assert.match(source, /onRemoveExternal\(player\.playerId\)/);
  assert.match(source, /Global player search is unavailable until Relay identity and coordinate verification completes/);
});

test("settlement player rows expose independent toggle, colour, and copy placement hooks", async () => {
  const source = await readFile(new URL("../src/pages/map/MapPlayerTrackingPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /map-player-toggle/);
  assert.match(source, /map-player-row-colour/);
  assert.match(source, /map-player-row-copy/);
});

test("tracked player rows expose accessible colour editing and override reset controls", async () => {
  const source = await readFile(new URL("../src/pages/map/MapPlayerTrackingPanel.tsx", import.meta.url), "utf8");

  assert.match(source, /type="color"/);
  assert.match(source, /playerMarkerColourInputValue\(colour\)/);
  assert.match(source, /disabled=\{!tracked\}/);
  assert.match(source, /Set marker colour for \$\{name\}/);
  assert.match(source, /onPlayerColourChange\(playerId, event\.target\.value\)/);
  assert.match(source, /Reset marker colour for \$\{name\}/);
  assert.match(source, /tracked && override/);
  assert.match(source, /onPlayerColourChange\(playerId, null\)/);
  assert.match(source, /externalPlayers\.map[\s\S]*PlayerColourControl/);
});
