import assert from "node:assert/strict";
import test from "node:test";

import { groupNeedCellActiveCrafts, groupNeedCellRecipeUsages, groupNeedCellSources, groupNeedCellSourceRoutes } from "../src/pages/craftPlanningNeedDetails.ts";

const roughLogCell = {
  item: { key: "item:100", id: "100", kind: "item", name: "Rough Wood Log", tier: 1 },
  items: [
    {
      key: "item:100",
      id: "100",
      kind: "item",
      name: "Rough Wood Log",
      tier: 1,
      sources: [
        { sourceId: "chest-1", label: "Carpentry Mats", type: "Settlement storage", quantity: 1000 },
        { sourceId: "chest-2", label: "Carpentry Mats", type: "Settlement storage", quantity: 489 },
        { sourceId: "cache-1", label: "Personal Cache (II)", type: "Player deployable", quantity: 1000 },
      ],
      recipeUsages: [
        {
          outputKey: "item:200",
          output: { key: "item:200", id: "200", kind: "item", name: "Rough Brick", tier: 1, quantity: 1365 },
          recipeName: "Bake Rough Brick",
          selectedRecipeId: "bake-brick",
          requiredQuantity: 1365,
          craftCount: 1365,
          quantityPerCraft: 1,
          buildingName: "Rough Kiln",
          alternatives: [
            { id: "bake-brick", label: "Bake Rough Brick", inputs: [{ key: "item:100", name: "Rough Wood Log", quantity: 1 }] },
          ],
        },
        {
          outputKey: "item:200",
          output: { key: "item:200", id: "200", kind: "item", name: "Rough Brick", tier: 1, quantity: 310 },
          recipeName: "Bake Rough Brick",
          selectedRecipeId: "bake-brick",
          requiredQuantity: 310,
          craftCount: 310,
          quantityPerCraft: 1,
          buildingName: "Rough Kiln",
          alternatives: [
            { id: "bake-brick", label: "Bake Rough Brick", inputs: [{ key: "item:100", name: "Rough Wood Log", quantity: 1 }] },
          ],
        },
        {
          outputKey: "item:300",
          output: { key: "item:300", id: "300", kind: "item", name: "Rough Stripped Wood", tier: 1, quantity: 584 },
          recipeName: "Saw Rough Stripped Wood",
          selectedRecipeId: "saw-stripped",
          requiredQuantity: 1752,
          craftCount: 584,
          quantityPerCraft: 3,
          buildingName: "Rough Carpentry Station",
          alternatives: [],
        },
      ],
    },
  ],
};

test("groupNeedCellSources combines duplicate stock labels while retaining drilldown entries", () => {
  const groups = groupNeedCellSources(roughLogCell);
  assert.deepEqual(groups.map((group) => [group.label, group.quantity, group.entries.length]), [
    ["Carpentry Mats", 1489, 2],
    ["Personal Cache (II)", 1000, 1],
  ]);
});

test("groupNeedCellSources keeps same-named player deployables separate by owner", () => {
  const groups = groupNeedCellSources({
    ...roughLogCell,
    items: [{ ...roughLogCell.items[0], sources: [
      { sourceId: "one:cart", label: "Cart", type: "Player deployable", playerName: "Oddfawn", quantity: 5 },
      { sourceId: "two:cart", label: "Cart", type: "Player deployable", playerName: "Modular", quantity: 7 },
    ] }],
  });
  assert.deepEqual(groups.map((group) => [group.label, group.quantity]), [["Modular — Cart", 7], ["Oddfawn — Cart", 5]]);
});

test("groupNeedCellSources labels player banks with owner and settlement", () => {
  const groups = groupNeedCellSources({
    ...roughLogCell,
    items: [{ ...roughLogCell.items[0], sources: [{
      sourceId: "player-1:bank-remote",
      label: "Town Bank — Remote Settlement",
      type: "Player bank",
      playerName: "Modular",
      quantity: 7,
    }] }],
  });

  assert.deepEqual(groups.map((group) => [group.label, group.quantity]), [
    ["Modular — Town Bank — Remote Settlement", 7],
  ]);
});

test("groupNeedCellActiveCrafts combines expected and guaranteed quantities independently", () => {
  const crafts = groupNeedCellActiveCrafts({
    ...roughLogCell,
    items: [{ ...roughLogCell.items[0], activeCraftSources: [
      { craftId: "craft-1", playerName: "Farmer", quantity: 0.6, expectedQuantity: 0.6, guaranteedQuantity: 0 },
      { craftId: "craft-1", playerName: "Farmer", quantity: 1.4, expectedQuantity: 1.4, guaranteedQuantity: 1 },
    ] }],
  });

  assert.equal(crafts.length, 1);
  assert.equal(crafts[0].quantity, 2);
  assert.equal(crafts[0].expectedQuantity, 2);
  assert.equal(crafts[0].guaranteedQuantity, 1);
});

test("groupNeedCellActiveCrafts keeps passive craft metadata and identity separate", () => {
  const crafts = groupNeedCellActiveCrafts({
    ...roughLogCell,
    items: [{ ...roughLogCell.items[0], activeCraftSources: [
      { craftId: "craft:grain", quantity: 1, sourceType: "Active craft" },
      { craftId: "passive:farmer:grain", quantity: 2, passive: true, sourceType: "Passive craft", locationUnknown: true },
    ] }],
  });
  assert.equal(crafts.length, 2);
  assert.equal(crafts.find((craft) => craft.passive)?.locationUnknown, true);
});

test("groupNeedCellActiveCrafts consolidates passive crafts by player", () => {
  const crafts = groupNeedCellActiveCrafts({
    ...roughLogCell,
    items: [{ ...roughLogCell.items[0], activeCraftSources: [
      { craftId: "passive-1", playerId: "player-mosswick", playerName: "Mosswick", buildingName: "Large Farming Field", quantity: 1, expectedQuantity: 1, guaranteedQuantity: 1, passive: true, completed: true, status: "Ready to collect" },
      { craftId: "passive-2", playerId: "player-mosswick", playerName: "Mosswick", buildingName: "Large Farming Field", quantity: 1, expectedQuantity: 1, guaranteedQuantity: 1, passive: true, completed: true, status: "Ready to collect", locationUnknown: true },
      { craftId: "passive-3", playerId: "player-mosswick", playerName: "Mosswick", buildingName: "Small Farming Field", quantity: 1, expectedQuantity: 1, guaranteedQuantity: 0, passive: true, completed: false, status: "Processing" },
      { craftId: "passive-4", playerId: "player-other", playerName: "Other", buildingName: "Large Farming Field", quantity: 5, expectedQuantity: 5, guaranteedQuantity: 0, passive: true, completed: false, status: "Processing" },
      { craftId: "active-1", playerId: "player-mosswick", playerName: "Mosswick", buildingName: "Farming Station", quantity: 2, expectedQuantity: 2, guaranteedQuantity: 2, passive: false, completed: false, status: "In progress" },
    ] }],
  });

  assert.equal(crafts.length, 3);
  const mosswick = crafts.find((craft) => craft.passiveGroup && craft.playerName === "Mosswick");
  const ordinary = crafts.find((craft) => craft.craftId === "active-1");
  assert.ok(mosswick);
  assert.ok(ordinary);
  assert.equal(mosswick.craftCount, 3);
  assert.equal(mosswick.quantity, 3);
  assert.equal(mosswick.expectedQuantity, 3);
  assert.equal(mosswick.guaranteedQuantity, 2);
  assert.equal(mosswick.readyCount, 2);
  assert.equal(mosswick.processingCount, 1);
  assert.deepEqual(mosswick.structures, [
    { name: "Large Farming Field", count: 2 },
    { name: "Small Farming Field", count: 1 },
  ]);
  assert.equal(mosswick.locationUnknown, true);
  assert.equal(ordinary.passiveGroup, undefined);
});

test("groupNeedCellActiveCrafts falls back to player name for passive grouping", () => {
  const crafts = groupNeedCellActiveCrafts({
    ...roughLogCell,
    items: [{ ...roughLogCell.items[0], activeCraftSources: [
      { craftId: "passive-1", playerName: " Mosswick ", buildingName: "Large Farming Field", quantity: 1, expectedQuantity: 1, guaranteedQuantity: 0, passive: true, status: "Processing" },
      { craftId: "passive-2", playerName: "mosswick", buildingName: "Large Farming Field", quantity: 1, expectedQuantity: 1, guaranteedQuantity: 0, passive: true, status: "Processing" },
    ] }],
  });

  assert.equal(crafts.length, 1);
  assert.equal(crafts[0].craftCount, 2);
  assert.equal(crafts[0].expectedQuantity, 2);
});

test("groupNeedCellRecipeUsages groups repeated usages by output item", () => {
  const groups = groupNeedCellRecipeUsages(roughLogCell);
  assert.equal(groups.length, 2);
  const roughBrick = groups.find((group) => group.output.name === "Rough Brick");
  const strippedWood = groups.find((group) => group.output.name === "Rough Stripped Wood");
  assert.ok(roughBrick);
  assert.ok(strippedWood);
  assert.equal(roughBrick.output.quantity, 1675);
  assert.equal(roughBrick.requiredQuantity, 1675);
  assert.equal(roughBrick.entries.length, 2);
  assert.equal(strippedWood.requiredQuantity, 1752);
});

test("groupNeedCellRecipeUsages preserves gross usage while keeping renewable source and recycled quantities visible", () => {
  const groups = groupNeedCellRecipeUsages({
    items: [{
      recipeUsages: [{
        outputKey: "items:300",
        output: { key: "items:300", id: "300", kind: "items", name: "Basic Starbulb Plant", quantity: 15 },
        selectedRecipeId: "grow-from-seed",
        recipeName: "Grow Basic Starbulb Plant",
        requiredQuantity: 15,
        sourceRequiredQuantity: 1,
        recycledQuantity: 14,
        craftCount: 15,
      }],
    }],
  });

  assert.equal(groups[0].requiredQuantity, 15);
  assert.equal(groups[0].sourceRequiredQuantity, 1);
  assert.equal(groups[0].recycledQuantity, 14);
});

test("groupNeedCellSourceRoutes finds selected plan recipes that create the clicked item", () => {
  const routes = groupNeedCellSourceRoutes(roughLogCell, [
    {
      output: { key: "item:100", id: "100", kind: "item", name: "Rough Wood Log", tier: 1, quantity: 6259 },
      recipeName: "Process Rough Trunk",
      buildingName: "Rough Forestry Station",
      inputs: [{ key: "cargo:10", id: "10", kind: "cargo", name: "Rough Trunk", tier: 1, quantity: 3130 }],
      selectedRecipeId: "process-trunk",
      alternatives: [],
    },
  ]);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].recipeName, "Process Rough Trunk");
  assert.equal(routes[0].inputs[0].name, "Rough Trunk");
});


test("groupNeedCellSourceRoutes also uses item source routes when no craft step was required", () => {
  const routes = groupNeedCellSourceRoutes({
    item: { key: "item:500", id: "500", kind: "item", name: "Rough Wispweave Filament", tier: 1 },
    items: [{
      key: "item:500",
      id: "500",
      kind: "item",
      name: "Rough Wispweave Filament",
      tier: 1,
      sourceRoutes: [{
        output: { key: "item:500", id: "500", kind: "item", name: "Rough Wispweave Filament", tier: 1 },
        recipeName: "Basic Wispweave Plant",
        selectedRecipeId: "basic-wispweave-plant",
        inputs: [{ key: "item:501", name: "Rough Wispweave Plant", quantity: 1 }],
      }],
    }],
  }, []);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].recipeName, "Basic Wispweave Plant");
  assert.equal(routes[0].inputs[0].name, "Rough Wispweave Plant");
});

test("groupNeedCellSourceRoutes enriches catalog routes with calculated buffered step metadata", () => {
  const output = { key: "items:200", id: "200", kind: "items", name: "Rough Animal Hair" };
  const routes = groupNeedCellSourceRoutes({
    item: output,
    items: [{ ...output, sourceRoutes: [{ output, recipeName: "Harvest", selectedRecipeId: "possibility:harvest:items:200", inputs: [] }] }],
  }, [{
    output: { ...output, quantity: 460 },
    recipeName: "Harvest",
    selectedRecipeId: "possibility:harvest:items:200",
    unbufferedCraftCount: 1472,
    craftCount: 1840,
    multiplier: 1.25,
    inputs: [{ key: "items:202", id: "202", kind: "items", name: "Sagi Bird", quantity: 1840 }],
  }]);

  assert.equal(routes.length, 1);
  assert.equal(routes[0].unbufferedCraftCount, 1472);
  assert.equal(routes[0].craftCount, 1840);
  assert.equal(routes[0].multiplier, 1.25);
  assert.equal(routes[0].inputs[0].name, "Sagi Bird");
  assert.equal(routes[0].inputs[0].quantity, 1840);
});
