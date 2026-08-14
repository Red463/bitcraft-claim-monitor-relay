import assert from "node:assert/strict";
import test from "node:test";

test("classifies road generator failures without returning raw journal text", async () => {
  let classifyNativeMapUnitFailure;
  try {
    ({ classifyNativeMapUnitFailure } = await import("../../deploy/native-map-unit-failure.mjs"));
  } catch {
    assert.fail("native map unit failure classifier is unavailable");
  }

  const cases = [
    ["Road world generation failed for region 7: Relay road region 7 returned no verified paving points", "empty-region"],
    ["Road paving entity 123456789 is missing location data", "join-mismatch"],
    ["Timed out waiting for roads from bitcraft-live-7", "timeout"],
    ["regional schema fingerprint mismatch", "schema"],
    ["Road paving entity 123 has impossible coordinates", "invalid-coordinate"],
    ["some unrecognized internal failure carrying entity 998877", "other"],
    ["", "unavailable"],
  ];

  for (const [journal, expected] of cases) {
    const result = classifyNativeMapUnitFailure(journal);
    assert.deepEqual(result, { category: expected });
    assert.equal(JSON.stringify(result).includes("998877"), false);
    assert.equal(JSON.stringify(result).includes("bitcraft-live-7"), false);
  }
});
