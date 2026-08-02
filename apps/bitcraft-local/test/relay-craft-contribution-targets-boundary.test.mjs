import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  canonicalF32Decimal,
  canonicalNonNegativeDecimal,
} = await import(
  new URL("../src/server/game-data/exactDecimal.ts", import.meta.url).href,
);

const serverSource = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

function sourceBetween(startText, endText) {
  const start = serverSource.indexOf(startText);
  const end = serverSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `Expected server source boundary ${startText}`);
  return serverSource.slice(start, end);
}

const contributionHelpers = sourceBetween(
  "function craftOutputCatalog",
  "function recordSettlementState",
);
const contributionTargetSource = sourceBetween(
  "function relayCraftContributionTargets",
  "async function runScheduledSupplyReport",
);
const relayCraftContributionTargets = Function(
  "unwrap",
  "productionMetrics",
  "canonicalF32Decimal",
  "canonicalNonNegativeDecimal",
  "errorMessage",
  `"use strict"; ${contributionHelpers}\n${contributionTargetSource}\nreturn relayCraftContributionTargets;`,
)(
  (payload, key, fallback) => payload?.[key] ?? fallback,
  () => ({ skillName: "Forestry" }),
  canonicalF32Decimal,
  canonicalNonNegativeDecimal,
  (error) => error instanceof Error ? error.message : String(error),
);

function validCraft(overrides = {}) {
  return {
    entityId: "9007199254740993",
    buildingEntityId: "9007199254740994",
    recipeId: "9007199254740995",
    completed: false,
    levelRequirements: [{ skillId: "9007199254740993" }],
    experiencePerProgress: [
      { skillId: "9007199254740992", quantity: 9.5 },
      { skillId: "9007199254740993", quantity: 1.7599999904632568 },
    ],
    craftedItem: [{ itemId: "42", itemType: 0 }],
    ...overrides,
  };
}

test("contribution targets match skill IDs exactly and retain exact target IDs", () => {
  const result = relayCraftContributionTargets({
    craftResults: [validCraft()],
    items: [{ id: "42", name: "Nubi Crop", tier: 3 }],
  });

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.targets.map((target) => ({
    craftEntityId: target.craftEntityId,
    buildingEntityId: target.buildingEntityId,
    recipeId: target.recipeId,
    xpPerProgress: target.xpPerProgress,
  })), [{
    craftEntityId: "9007199254740993",
    buildingEntityId: "9007199254740994",
    recipeId: "9007199254740995",
    xpPerProgress: "1.76",
  }]);
});

test("contribution targets reject numeric craft, building, and recipe IDs", () => {
  const result = relayCraftContributionTargets({
    craftResults: [
      validCraft({ entityId: 9007199254740993 }),
      validCraft({ entityId: "2", buildingEntityId: 9007199254740993 }),
      validCraft({ entityId: "3", recipeId: 9007199254740993 }),
    ],
  });

  assert.equal(result.targets.length, 0);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /craft entity id/i);
  assert.match(result.warnings[1], /building entity id/i);
  assert.match(result.warnings[2], /recipe id/i);
});
