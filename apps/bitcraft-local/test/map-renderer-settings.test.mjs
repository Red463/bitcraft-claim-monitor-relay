import assert from "node:assert/strict";
import test from "node:test";

import { defaultAppSettingRows } from "../src/server/defaultAppSettings.mjs";
import { readFileSync } from "node:fs";

test("map renderer setting is retired from fresh installations", () => {
  const rows = defaultAppSettingRows({ serverRefreshSeconds: 30, updatedAt: "2026-08-11T12:00:00.000Z" });
  assert.equal(rows.some((row) => row.key === "map_renderer_mode"), false);
});

test("Map page is native-only and contains no external renderer path", () => {
  const source = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");
  assert.match(source, /<NativeMap/);
  assert.doesNotMatch(source, /rendererMode|nativeRenderer|<iframe|bitcraftmap\.com|mapRendererPolicy|bitcraftMapUrl/);
});
