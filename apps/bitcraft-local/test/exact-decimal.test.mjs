import assert from "node:assert/strict";
import test from "node:test";

const {
  addDecimal,
  canonicalF32Decimal,
  canonicalNonNegativeDecimal,
  multiplyDecimalByInteger,
} = await import(
  new URL("../src/server/game-data/exactDecimal.ts", import.meta.url).href,
);

test("Relay F32 XP rates normalize without binary noise", () => {
  assert.equal(canonicalF32Decimal(1.7599999904632568, "xp"), "1.76");
  assert.equal(canonicalF32Decimal(1.9199999570846558, "xp"), "1.92");
});

test("exact decimal XP multiplies and accumulates without Number", () => {
  assert.equal(multiplyDecimalByInteger("1.76", "24"), "42.24");
  assert.equal(addDecimal("42.24", "9007199254740993.76"), "9007199254741036");
});

test("invalid Relay XP is rejected", () => {
  assert.throws(() => canonicalF32Decimal(-1, "xp"), /non-negative/i);
  assert.throws(() => canonicalF32Decimal(Infinity, "xp"), /finite/i);
  assert.throws(() => canonicalNonNegativeDecimal("1.2.3", "xp"), /decimal/i);
});
