import assert from "node:assert/strict";
import test from "node:test";

const {
  craftVisibilityEvidence,
  enrichCraftsForPlanning,
  enrichCraftsWithCatalog,
} = await import(
  new URL("../src/server/game-data/craftProjection.ts", import.meta.url).href,
);

test("craft visibility uses exact public marker membership", () => {
  const visibility = craftVisibilityEvidence({
    craftResults: [{ entityId: "1369094287471625781" }],
  });
  const projected = enrichCraftsWithCatalog(
    { craftResults: [
      { entityId: "1369094287471625781", recipeId: "10" },
      { entityId: "1369094286813753789", recipeId: "10" },
    ] },
    () => null,
    () => ({ id: "10", isPassive: false }),
    visibility,
  );
  assert.deepEqual(
    projected.craftResults.map(({ entityId, visibility, isPublic }) => [
      entityId, visibility, isPublic,
    ]),
    [
      ["1369094287471625781", "public", true],
      ["1369094286813753789", "private", false],
    ],
  );
});

test("missing marker readiness produces unknown visibility", () => {
  const projected = enrichCraftsWithCatalog(
    { craftResults: [{ entityId: "100", recipeId: "10" }] },
    () => null,
    () => ({ id: "10", isPassive: false }),
  );
  assert.equal(projected.craftResults[0].visibility, "unknown");
  assert.equal(projected.craftResults[0].isPublic, null);
});

test("craft projection separates active and passive rows using normalized Relay recipes", () => {
  const entities = new Map([
    ["items:42", {
      catalogKey: "items:42",
      kind: "items",
      targetId: "42",
      name: "Nubi Crop",
      tier: 3,
    }],
    ["cargo:42", {
      catalogKey: "cargo:42",
      kind: "cargo",
      targetId: "42",
      name: "Packed Nubi Crop",
      tier: 3,
    }],
  ]);
  const recipes = new Map([
    ["10", {
      id: "10",
      name: "Pack Nubi Crop",
      isPassive: false,
      levelRequirements: [{ skillId: "5", level: 20 }],
      toolRequirements: [{ toolType: 4, level: 3, power: 25 }],
      experiencePerProgress: [{ skillId: "5", quantity: 2.5 }],
      outputs: [{ kind: "cargo", id: "42", quantity: "1" }],
    }],
    ["20", {
      id: "20",
      name: "Grow Nubi Crop",
      isPassive: true,
      levelRequirements: [],
      toolRequirements: [],
      experiencePerProgress: [],
      outputs: [{ kind: "item", id: "42", quantity: "100" }],
    }],
  ]);
  const projected = enrichCraftsWithCatalog({
    craftResults: [
      {
        entityId: "100",
        recipeId: "10",
        ownerUsername: "Ada",
        buildingName: "Exquisite Loom",
        completed: false,
        craftCount: "9007199254740993",
        progress: "4",
        totalActionsRequired: "10",
        craftedItem: [{ itemId: "42", itemType: "cargo", quantity: "1" }],
      },
      {
        entityId: "200",
        recipeId: "20",
        ownerUsername: "Grace",
        buildingName: "Large Farming Field",
        completed: false,
        craftCount: "2",
        progress: "0",
        totalActionsRequired: "1",
        craftedItem: [{ itemId: "42", itemType: "item", quantity: "100" }],
      },
      {
        entityId: "201",
        recipeId: "20",
        ownerUsername: "Grace",
        buildingName: "Large Farming Field",
        completed: true,
        craftCount: "1",
        progress: "1",
        totalActionsRequired: "1",
        craftedItem: [{ itemId: "42", itemType: "item", quantity: "100" }],
      },
      {
        entityId: "101",
        recipeId: "10",
        ownerUsername: "Ada",
        buildingName: "Exquisite Loom",
        completed: true,
        craftCount: "1",
        progress: "10",
        totalActionsRequired: "10",
        craftedItem: [{ itemId: "42", itemType: "cargo", quantity: "1" }],
      },
    ],
  }, (key) => entities.get(key) ?? null, (id) => recipes.get(id) ?? null);

  assert.equal(projected.craftResults.length, 1);
  assert.equal(projected.craftResults[0].recipeName, "Pack Nubi Crop");
  assert.equal(projected.craftResults[0].craftCount, "9007199254740993");
  assert.equal(projected.catalog["cargo:42"].name, "Packed Nubi Crop");
  assert.equal(projected.catalog["items:42"].name, "Nubi Crop");
  assert.deepEqual(projected.passiveCraftResults.map((row) => ({
    id: row.entityId,
    status: row.status,
    quantity: row.quantity,
  })), [
    { id: "200", status: "processing", quantity: "200" },
    { id: "201", status: "complete", quantity: "100" },
  ]);
});

test("craft projection preserves unknown recipes without misclassifying them as passive", () => {
  const projected = enrichCraftsWithCatalog({
    craftResults: [{
      entityId: "300",
      recipeId: "999",
      completed: false,
      craftCount: "1",
      progress: "0",
      totalActionsRequired: "5",
      craftedItem: [{ itemId: "7", itemType: "item", quantity: "1" }],
    }],
  }, () => null, () => null);

  assert.equal(projected.craftResults.length, 1);
  assert.equal(projected.passiveCraftResults.length, 0);
});

test("planner craft projection retains complete rows and marks unknown recipe kinds safely", () => {
  const projected = enrichCraftsForPlanning({
    craftResults: [{
      entityId: "complete-passive",
      recipeId: "20",
      completed: true,
      craftCount: "2",
      craftedItem: [{ itemId: "42", itemType: "item", quantity: "3" }],
    }, {
      entityId: "unknown",
      recipeId: "999",
      completed: false,
      craftCount: "1",
      craftedItem: [{ itemId: "7", itemType: "cargo", quantity: "1" }],
    }],
  }, (key) => ({
    catalogKey: key,
    targetId: key.split(":")[1],
    name: key === "items:42" ? "Nubi Crop" : "Unknown Cargo",
  }), (id) => id === "20" ? {
    id: "20",
    name: "Grow Nubi Crop",
    isPassive: true,
  } : null);

  assert.deepEqual(projected.craftResults.map((row) => [
    row.entityId,
    row.completed,
    row.isPassive,
  ]), [
    ["complete-passive", true, true],
    ["unknown", false, null],
  ]);
  assert.equal(projected.catalog["items:42"].name, "Nubi Crop");
  assert.equal(projected.catalog["cargo:7"].name, "Unknown Cargo");
  assert.deepEqual(projected.warnings, [
    "Craft unknown references unavailable recipe 999.",
  ]);
});
