import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { mapToolNeedsInitialFocus, nextMapTool } from "../src/pages/map/mapToolDockState.mjs";

test("requesting a closed map tool opens it", () => {
  assert.equal(nextMapTool(null, "layers"), "layers");
});

test("requesting the active map tool closes it", () => {
  assert.equal(nextMapTool("players", "players"), null);
});

test("requesting another map tool switches directly", () => {
  assert.equal(nextMapTool("biomes", "resources"), "resources");
});

test("map tool state rejects unknown tool identities", () => {
  assert.throws(() => nextMapTool("layers", "unknown"), /Unknown map tool/);
});

test("map tool autofocus runs only when the active tool changes", () => {
  assert.equal(mapToolNeedsInitialFocus(null, "resources"), true);
  assert.equal(mapToolNeedsInitialFocus("resources", "resources"), false);
  assert.equal(mapToolNeedsInitialFocus("resources", "players"), true);
  assert.equal(mapToolNeedsInitialFocus("resources", null), false);
});

test("tool panels render at the viewport root so mobile bottom sheets are not trapped by transformed ancestors", () => {
  const source = fs.readFileSync(path.resolve("src/pages/map/MapToolDock.tsx"), "utf8");
  assert.match(source, /createPortal/);
  assert.match(source, /document\.body/);
});
