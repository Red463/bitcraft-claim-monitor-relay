import assert from "node:assert/strict";
import test from "node:test";

import { canonicalMapRegionIds } from "../src/server/mapRegionIds.mjs";

test("map region IDs remain lossless and numerically ordered beyond JavaScript safe integers", () => {
  assert.deepEqual(
    canonicalMapRegionIds(["9007199254740993", "019", "9007199254740992", "3", "19"]),
    ["3", "19", "9007199254740992", "9007199254740993"],
  );
});

test("map region IDs reject non-decimal identities", () => {
  assert.throws(() => canonicalMapRegionIds(["19", "3.5"]), /decimal region IDs/i);
});
