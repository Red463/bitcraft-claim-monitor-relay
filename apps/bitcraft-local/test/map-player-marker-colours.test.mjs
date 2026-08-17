import assert from "node:assert/strict";
import test from "node:test";

import {
  assignPlayerMarkerColours,
  accountPlayerMarkerColourOverrides,
  normalizePlayerMarkerColourOverrides,
  playerMarkerColourInputValue,
  resolvePlayerMarkerColours,
  withPlayerMarkerColourOverride,
} from "../src/map/playerMarkerColours.mjs";

test("player colours are stable and unique within the visible palette", () => {
  const ids = ["1369094286756659093", "576460752388321942", "1224979098660030450"];
  const first = assignPlayerMarkerColours(ids);
  const reordered = assignPlayerMarkerColours(ids.toReversed());
  assert.deepEqual(first, reordered);
  assert.equal(new Set(Object.values(first)).size, ids.length);
});

test("player colour allocation hashes the full lossless decimal identity", () => {
  const id = "9007199254740993";
  assert.equal(assignPlayerMarkerColours([id])[id], assignPlayerMarkerColours([id])[id]);
  assert.notEqual(assignPlayerMarkerColours([id])[id], assignPlayerMarkerColours(["9007199254740994"])["9007199254740994"]);
});

test("player colour allocation rejects invalid identities and spreads a typical visible range", () => {
  assert.throws(() => assignPlayerMarkerColours([""]), /decimal/i);
  assert.throws(() => assignPlayerMarkerColours(["player-1"]), /decimal/i);
  const ids = Array.from({ length: 12 }, (_, index) => String(10_000 + index));
  assert.equal(new Set(Object.values(assignPlayerMarkerColours(ids))).size, ids.length);
});

test("player colours do not change when a colliding identity is omitted from a returned subset", () => {
  const complete = assignPlayerMarkerColours(["1", "14"]);
  const subset = assignPlayerMarkerColours(["14"]);

  assert.equal(complete["14"], subset["14"]);
  assert.notEqual(complete["1"], complete["14"]);
});

test("player colours keep distinct identities apart beyond the former coarse HSL range", () => {
  const colours = assignPlayerMarkerColours(["216172782115000006", "216172782115000190", "40189", "797186"]);

  assert.notEqual(colours["216172782115000006"], colours["216172782115000190"]);
  assert.notEqual(colours["40189"], colours["797186"], "distinct 64-bit identities must survive a 32-bit hash collision");
});

test("player hues remain distinct after CSS normalizes angles modulo 360", () => {
  const ids = ["7046029254386353131", "8423405970448732829"];
  const colours = assignPlayerMarkerColours(ids);
  const normalizedHue = (colour) => Number(/^hsl\(([^,]+)/.exec(colour)?.[1]) % 360;

  assert.notEqual(normalizedHue(colours[ids[0]]), normalizedHue(colours[ids[1]]));
  assert.ok(Object.values(colours).every((colour) => normalizedHue(colour) >= 0 && normalizedHue(colour) < 360));
});

test("player colour overrides canonicalize valid identities and colours while dropping malformed entries", () => {
  assert.deepEqual(normalizePlayerMarkerColourOverrides({
    "00042": "#Aa00Ff",
    "43": "not-a-colour",
    "player-44": "#123456",
    "18446744073709551616": "#654321",
  }), { "42": "#aa00ff" });
  assert.deepEqual(normalizePlayerMarkerColourOverrides(null), {});
  assert.deepEqual(normalizePlayerMarkerColourOverrides([]), {});
});

test("player colour overrides retain at most 256 valid entries", () => {
  const source = Object.fromEntries(Array.from({ length: 260 }, (_, index) => [String(10_000 + index), "#123456"]));
  const normalized = normalizePlayerMarkerColourOverrides(source);

  assert.equal(Object.keys(normalized).length, 256);
  assert.equal(normalized["10000"], "#123456");
  assert.equal(normalized["10255"], "#123456");
  assert.equal(normalized["10256"], undefined);
});

test("custom player colours override generated defaults without changing other players", () => {
  const resolved = resolvePlayerMarkerColours(["42", "43"], { "42": "#aa00ff", "999": "#000000" });
  const generated = assignPlayerMarkerColours(["42", "43"]);

  assert.equal(resolved["42"], "#aa00ff");
  assert.equal(resolved["43"], generated["43"]);
  assert.equal(resolved["999"], undefined);
});

test("native player colour inputs open at the displayed marker colour", () => {
  assert.equal(playerMarkerColourInputValue("hsl(0, 100%, 50%)"), "#ff0000");
  assert.equal(playerMarkerColourInputValue("hsl(120, 100%, 50%)"), "#00ff00");
  assert.equal(playerMarkerColourInputValue("hsl(240, 100%, 50%)"), "#0000ff");
  assert.equal(playerMarkerColourInputValue("#Aa00Ff"), "#aa00ff");
});

test("setting and resetting an override preserves other saved player colours", () => {
  const changed = withPlayerMarkerColourOverride({ "42": "#111111" }, "43", "#ABCDEF");
  assert.deepEqual(changed, { "42": "#111111", "43": "#abcdef" });
  assert.deepEqual(withPlayerMarkerColourOverride(changed, "43", null), { "42": "#111111" });
});

test("account colour hydration keeps local fallback only when the account has no saved colour setting", () => {
  const local = { "42": "#111111" };

  assert.deepEqual(accountPlayerMarkerColourOverrides({}, local), local);
  assert.deepEqual(accountPlayerMarkerColourOverrides({ mapPlayerColours: {} }, local), {});
  assert.deepEqual(accountPlayerMarkerColourOverrides({ mapPlayerColours: { "43": "#ABCDEF" } }, local), { "43": "#abcdef" });
});
