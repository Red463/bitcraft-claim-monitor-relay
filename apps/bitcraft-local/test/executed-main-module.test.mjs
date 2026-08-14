import assert from "node:assert/strict";
import test from "node:test";

import { isExecutedMainModule } from "../src/server/executedMainModule.mjs";

test("CLI entry detection accepts a symlinked argv path resolving to the imported release file", () => {
  const aliases = new Map([
    ["/opt/app/current/script.mjs", "/opt/app/releases/abc/script.mjs"],
    ["/opt/app/releases/abc/script.mjs", "/opt/app/releases/abc/script.mjs"],
  ]);
  assert.equal(isExecutedMainModule(
    "file:///opt/app/releases/abc/script.mjs",
    "/opt/app/current/script.mjs",
    (value) => aliases.get(value) ?? value,
    (value) => new URL(value).pathname,
  ), true);
});

test("CLI entry detection rejects a different executable and unresolved paths", () => {
  assert.equal(isExecutedMainModule("file:///opt/app/script.mjs", "/opt/app/other.mjs", (value) => value), false);
  assert.equal(isExecutedMainModule("file:///opt/app/script.mjs", "/missing", () => { throw new Error("missing"); }), false);
});
