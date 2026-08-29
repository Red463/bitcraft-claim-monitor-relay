import assert from "node:assert/strict";
import test from "node:test";

import { filterSelectedPlayerBankSources, playerBankOptions, playerInventoryContainerSources, selectedPlayerInventoryIds, settlementStorageSourcesFromInventories, sourceItemFromContents, trackedCraftPlanOutputs, trackedPassiveCraftPlanOutputs, trackedRelayCraftPlanOutputs } from "../src/server/craftPlanSources.mjs";

const MONITORED_CLAIM_ID = "claim-monitored";

test("settlementStorageSourcesFromInventories reads normalized Relay buildings and catalog identities", () => {
  const result = settlementStorageSourcesFromInventories({
    catalog: {
      "items:100": {
        catalogKey: "items:100",
        targetId: "100",
        kind: "items",
        itemType: 0,
        name: "Simple Wood Log",
        tier: 1,
      },
      "cargo:100": {
        catalogKey: "cargo:100",
        targetId: "100",
        kind: "cargo",
        itemType: 1,
        name: "Simple Wood Cargo",
        tier: 1,
      },
    },
    buildings: [{
      entityId: "500",
      name: "Town Bank",
      nickname: "Trade Hall",
      inventory: [
        { contents: { itemId: "100", itemType: "item", quantity: "12" } },
        { contents: { itemId: "100", itemType: "cargo", quantity: "3" } },
      ],
    }],
  }, []);

  assert.equal(result.length, 1);
  assert.equal(result[0].sourceId, "500");
  assert.equal(result[0].label, "Trade Hall");
  assert.deepEqual(result[0].items.map((item) => [item.kind, item.id, item.name, item.quantity]), [
    ["items", "100", "Simple Wood Log", 12],
    ["cargo", "100", "Simple Wood Cargo", 3],
  ]);
});

test("trackedPassiveCraftPlanOutputs counts processing and complete jobs but ignores other states", () => {
  const outputs = trackedPassiveCraftPlanOutputs([{
    playerId: "farmer-1",
    playerName: "Farmer",
    payload: {
      items: [{ id: 3200001, name: "Basic Embergrain Products", tier: 1 }],
      craftResults: [
        { entityId: "growing", status: "processing", buildingName: "Basic Farming Station", craftedItem: [{ item_id: 3200001, quantity: 2 }] },
        { entityId: "ready", status: "complete", buildingName: "Basic Farming Station", craftedItem: [{ item_id: 3200001, quantity: 3 }] },
        { entityId: "unsupported", status: "queued", buildingName: "Basic Farming Station", craftedItem: [{ item_id: 3200001, quantity: 100 }] },
      ],
    },
  }], new Map());

  assert.deepEqual(outputs.map((output) => [output.craftId, output.quantity, output.status]), [
    ["passive:farmer-1:growing", 2, "Passive craft in progress"],
    ["passive:farmer-1:ready", 3, "Passive craft ready to collect"],
  ]);
  assert.equal(outputs.every((output) => output.passive === true && output.sourceType === "Passive craft" && output.locationUnknown === true), true);
});

test("trackedPassiveCraftPlanOutputs expands probabilistic farming products", () => {
  const product = { id: 3200001, name: "Basic Embergrain Products", tier: 1 };
  const detailsByKey = new Map([["items:3200001", {
    item: product,
    itemListPossibilities: [{
      targetId: "straw",
      targetItem: { id: "straw", name: "Rough Straw", tier: 1 },
      quantity: 0.2,
      chance: 1,
      guaranteedQuantity: 0,
    }],
  }]]);
  const outputs = trackedPassiveCraftPlanOutputs([{
    playerId: "farmer-1",
    playerName: "Farmer",
    payload: {
      items: [product],
      craftResults: [{ entityId: "grain", status: "processing", craftCount: 10, craftedItem: [{ item_id: 3200001, quantity: 1 }] }],
    },
  }], detailsByKey);

  const straw = outputs.find((output) => output.itemId === "straw");
  assert.equal(straw?.quantity, 2);
  assert.equal(straw?.guaranteedQuantity, 0);
  assert.equal(straw?.status, "Passive craft in progress");
});

test("trackedRelayCraftPlanOutputs preserves tracked-player completion rules from one claim snapshot", () => {
  const payload = {
    catalog: {
      "items:100": { targetId: "100", kind: "items", name: "Rough Plank", tier: 1 },
      "items:200": { targetId: "200", kind: "items", name: "Embergrain Products", tier: 1 },
    },
    craftResults: [
      {
        entityId: "ordinary-active",
        claimEntityId: MONITORED_CLAIM_ID,
        ownerEntityId: "untracked-player",
        ownerUsername: "Builder",
        buildingName: "Carpentry Station",
        completed: false,
        isPassive: false,
        craftCount: 2,
        craftedItem: [{ itemId: "100", itemType: "item", quantity: "3" }],
      },
      {
        entityId: "ordinary-ready-tracked",
        claimEntityId: MONITORED_CLAIM_ID,
        ownerEntityId: "tracked-player",
        ownerUsername: "Planner",
        buildingName: "Carpentry Station",
        completed: true,
        isPassive: false,
        craftCount: 4,
        craftedItem: [{ itemId: "100", itemType: "item", quantity: "1" }],
      },
      {
        entityId: "ordinary-ready-untracked",
        claimEntityId: MONITORED_CLAIM_ID,
        ownerEntityId: "untracked-player",
        completed: true,
        isPassive: false,
        craftCount: 99,
        craftedItem: [{ itemId: "100", itemType: "item", quantity: "1" }],
      },
      {
        entityId: "passive-processing",
        claimEntityId: MONITORED_CLAIM_ID,
        ownerEntityId: "tracked-player",
        ownerUsername: "Planner",
        buildingName: "Farming Station",
        completed: false,
        isPassive: true,
        craftCount: 5,
        craftedItem: [{ itemId: "200", itemType: "item", quantity: "1" }],
      },
      {
        entityId: "passive-untracked",
        claimEntityId: MONITORED_CLAIM_ID,
        ownerEntityId: "untracked-player",
        completed: false,
        isPassive: true,
        craftCount: 100,
        craftedItem: [{ itemId: "200", itemType: "item", quantity: "1" }],
      },
      {
        entityId: "unknown-recipe-kind",
        claimEntityId: MONITORED_CLAIM_ID,
        ownerEntityId: "tracked-player",
        completed: false,
        isPassive: null,
        craftCount: 100,
        craftedItem: [{ itemId: "200", itemType: "item", quantity: "1" }],
      },
      {
        entityId: "foreign-craft",
        claimEntityId: "foreign-claim",
        ownerEntityId: "tracked-player",
        completed: false,
        isPassive: false,
        craftCount: 100,
        craftedItem: [{ itemId: "100", itemType: "item", quantity: "1" }],
      },
    ],
  };

  const outputs = trackedRelayCraftPlanOutputs(
    payload,
    new Map(),
    MONITORED_CLAIM_ID,
    ["tracked-player"],
  );

  assert.deepEqual(outputs.map((output) => [
    output.craftId,
    output.name,
    output.quantity,
    output.status,
    output.passive === true,
    output.locationUnknown,
  ]), [
    ["ordinary-active", "Rough Plank", 6, "In progress", false, undefined],
    ["ordinary-ready-tracked", "Rough Plank", 4, "Ready to collect", false, undefined],
    ["passive-processing", "Embergrain Products", 5, "Passive craft in progress", true, false],
  ]);
});

test("trackedCraftPlanOutputs counts only ordinary crafts that prove monitored claim ownership", () => {
  const payload = {
    craftResults: [
      {
        entityId: "matching",
        claimEntityId: MONITORED_CLAIM_ID,
        buildingName: "Fine Forestry Station",
        craftedItem: [{ item_id: 100, quantity: 2, item_type: "item" }],
      },
      {
        entityId: "foreign",
        claimEntityId: "claim-foreign",
        buildingName: "Ancient Forestry Station",
        craftedItem: [{ item_id: 100, quantity: 26, item_type: "item" }],
      },
      {
        entityId: "unverified",
        buildingName: "Unknown Forestry Station",
        craftedItem: [{ item_id: 100, quantity: 99, item_type: "item" }],
      },
    ],
    items: [{ id: 100, name: "Simple Wood Log" }],
  };

  const outputs = trackedCraftPlanOutputs([payload], new Map(), MONITORED_CLAIM_ID);

  assert.deepEqual(outputs.map((output) => [output.craftId, output.buildingName, output.quantity]), [
    ["matching", "Fine Forestry Station", 2],
  ]);
});

test("trackedCraftPlanOutputs retains matching private craft details during deduplication", () => {
  const publicPayload = {
    craftResults: [{
      entityId: "shared",
      claimEntityId: MONITORED_CLAIM_ID,
      completed: false,
      craftedItem: [{ item_id: 100, quantity: 1, item_type: "item" }],
    }],
  };
  const playerPayload = {
    craftResults: [{
      entityId: "shared",
      claimEntityId: MONITORED_CLAIM_ID,
      ownerUsername: "Oddfawn",
      buildingName: "Fine Forestry Station",
      completed: true,
      craftedItem: [{ item_id: 100, quantity: 1, item_type: "item" }],
    }],
  };

  const outputs = trackedCraftPlanOutputs([publicPayload, playerPayload], new Map(), MONITORED_CLAIM_ID);

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].playerName, "Oddfawn");
  assert.equal(outputs[0].status, "Ready to collect");
});

test("trackedCraftPlanOutputs expands farming product possibilities into expected Needs Board outputs", () => {
  const payload = {
    craftResults: [{
      entityId: "craft-wispweave",
      claimEntityId: MONITORED_CLAIM_ID,
      ownerEntityId: "player-oddfawn",
      ownerUsername: "Oddfawn",
      buildingName: "Exquisite Farming Station",
      craftCount: 506,
      completed: false,
      craftedItem: [{ item_id: 3220023, quantity: 1, item_type: "item" }],
    }],
    items: [{ id: 3220023, name: "Infused Wispweave Products", tier: 3, tag: "Wispweave Output" }],
  };
  const detailsByKey = new Map([["items:3220023", {
    item: payload.items[0],
    itemListPossibilities: [
      { targetId: "3100017", targetItem: { id: "3100017", name: "Sturdy Wispweave Filament", tier: 3, tag: "Filament" }, quantity: 3, chance: 0.2 },
      { targetId: "3100017", targetItem: { id: "3100017", name: "Sturdy Wispweave Filament", tier: 3, tag: "Filament" }, quantity: 4, chance: 0.2 },
      { targetId: "3100017", targetItem: { id: "3100017", name: "Sturdy Wispweave Filament", tier: 3, tag: "Filament" }, quantity: 5, chance: 0.2 },
      { targetId: "3100017", targetItem: { id: "3100017", name: "Sturdy Wispweave Filament", tier: 3, tag: "Filament" }, quantity: 6, chance: 0.2 },
      { targetId: "3100017", targetItem: { id: "3100017", name: "Sturdy Wispweave Filament", tier: 3, tag: "Filament" }, quantity: 7, chance: 0.2 },
    ],
  }]]);

  const outputs = trackedCraftPlanOutputs([payload], detailsByKey, MONITORED_CLAIM_ID);
  const filament = outputs.find((output) => output.itemId === "3100017");

  assert.equal(filament?.quantity, 2530);
  assert.equal(filament?.guaranteedQuantity, 1518);
  assert.equal(filament?.playerName, "Oddfawn");
  assert.equal(filament?.buildingName, "Exquisite Farming Station");
  assert.equal(filament?.status, "In progress");
});

test("trackedCraftPlanOutputs preserves ordinary direct craft outputs", () => {
  const payload = {
    craftResults: [{
      entityId: "craft-plank",
      claimEntityId: MONITORED_CLAIM_ID,
      ownerEntityId: "player-modular",
      ownerUsername: "Modular",
      buildingName: "Exquisite Carpentry Station",
      craftCount: 612,
      completed: true,
      craftedItem: [{ item_id: 1020003, quantity: 1, item_type: "item" }],
    }],
    items: [{ id: 1020003, name: "Rough Plank", tier: 1, tag: "Plank" }],
  };

  const outputs = trackedCraftPlanOutputs([payload], new Map(), MONITORED_CLAIM_ID);

  assert.equal(outputs.length, 1);
  assert.equal(outputs[0].itemId, "1020003");
  assert.equal(outputs[0].quantity, 612);
  assert.equal(outputs[0].guaranteedQuantity, 612);
  assert.equal(outputs[0].status, "Ready to collect");
});

test("trackedCraftPlanOutputs keeps expected output without guaranteeing a partial distribution", () => {
  const payload = {
    craftResults: [{
      entityId: "craft-fish-products",
      claimEntityId: MONITORED_CLAIM_ID,
      ownerEntityId: "player-fisher",
      craftCount: 2,
      craftedItem: [{ item_id: 1903, quantity: 1, item_type: "item" }],
    }],
    items: [{ id: 1903, name: "Ocean Fish Products", tier: 1, tag: "Fish Products" }],
  };
  const detailsByKey = new Map([["items:1903", {
    item: payload.items[0],
    itemListPossibilities: [{
      targetId: "1900",
      targetItem: { id: "1900", name: "Basic Fish Oil", tier: 1, tag: "Fish Oil" },
      quantity: 4,
      chance: 0.5,
    }],
  }]]);

  const oil = trackedCraftPlanOutputs([payload], detailsByKey, MONITORED_CLAIM_ID).find((output) => output.itemId === "1900");

  assert.equal(oil?.quantity, 4);
  assert.equal(oil?.guaranteedQuantity, 0);
});

test("trackedCraftPlanOutputs estimates Straw from active Embergrain processing", () => {
  const payload = {
    craftResults: [{
      entityId: "craft-embergrain",
      claimEntityId: MONITORED_CLAIM_ID,
      ownerEntityId: "player-farmer",
      ownerUsername: "Farmer",
      buildingName: "Basic Farming Station",
      craftCount: 10,
      craftedItem: [{ item_id: 3200001, quantity: 1, item_type: "item" }],
    }],
    items: [{ id: 3200001, name: "Basic Embergrain Products", tier: 1, tag: "Grain Output" }],
  };
  const detailsByKey = new Map([["items:3200001", {
    item: payload.items[0],
    itemListPossibilities: [{
      targetId: "straw",
      targetItem: { id: "straw", name: "Rough Straw", tier: 1, tag: "Straw" },
      quantity: 0.2,
      chance: 1,
      guaranteedQuantity: 0,
    }],
  }]]);

  const straw = trackedCraftPlanOutputs([payload], detailsByKey, MONITORED_CLAIM_ID).find((output) => output.itemId === "straw");

  assert.equal(straw?.quantity, 2);
  assert.equal(straw?.guaranteedQuantity, 0);
  assert.equal(straw?.buildingName, "Basic Farming Station");
});

test("playerInventoryContainerSources reads wrapped BitJita inventories and separates player storage", () => {
  const result = playerInventoryContainerSources("player-1", "Modular", {
    data: {
      items: [
        { id: "100", name: "Simple Wood Log", tier: 1 },
        { id: "200", name: "Fine Plank", tier: 4 },
        { id: "300", name: "Honey", tier: 1 },
      ],
      inventories: [
        {
          entityId: "player-inventory",
          inventoryName: "Inventory",
          pockets: [{ contents: { itemId: 100, itemType: 0, quantity: 5 } }],
        },
        {
          entityId: "personal-cache-1",
          playerOwnerEntityId: "player-1",
          inventoryName: "Modular's Personal Cache (III)",
          pockets: [{ contents: { itemId: 200, itemType: 0, quantity: 12 } }],
        },
        {
          entityId: "town-bank-1",
          playerOwnerEntityId: "player-1",
          inventoryName: "Town Bank",
          claimName: "Timbersteel Trade",
          pockets: [{ contents: { itemId: 300, itemType: 0, quantity: 99 } }],
        },
        {
          entityId: "town-bank-2",
          playerOwnerEntityId: "player-1",
          inventoryName: "Town Bank",
          claimName: "Remote Settlement",
          pockets: [{ contents: { itemId: 200, itemType: 0, quantity: 8 } }],
        },
        {
          entityId: "town-bank-2",
          playerOwnerEntityId: "player-1",
          inventoryName: "Town Bank",
          claimName: "Remote Settlement",
          pockets: [{ contents: { itemId: 200, itemType: 0, quantity: 8 } }],
        },
      ],
    },
  });

  assert.deepEqual(result.inventory.items.map((item) => item.name), ["Simple Wood Log"]);
  assert.equal(result.inventory.playerName, "Modular");
  assert.equal(result.inventory.label, "Modular inventory");
  assert.equal(result.deployableOptions.length, 2);
  assert.equal(result.deployableOptions.some((source) => source.sourceId === "player-1:cart" && source.label === "Cart"), true);
  const cache = result.deployableOptions.find((source) => source.sourceId === "player-1:personal-cache-1");
  assert.equal(cache?.label, "Personal Cache (III)");
  assert.equal(cache?.playerName, "Modular");
  assert.equal(cache?.containerKind, "Personal Cache");
  assert.equal(cache?.items[0].name, "Fine Plank");
  assert.equal(result.deployableOptions.some((source) => /Town Bank/.test(source.label)), false);
  assert.deepEqual(result.banks.map((source) => source.sourceId), ["player-1:town-bank-1", "player-1:town-bank-2"]);
  assert.deepEqual(result.banks.map((source) => source.label), ["Town Bank — Timbersteel Trade", "Town Bank — Remote Settlement"]);
  assert.equal(result.banks[0].playerName, "Modular");
  assert.equal(result.banks[0].type, "Player bank");
  assert.deepEqual(result.banks[0].items.map((item) => item.name), ["Honey"]);
});

test("selectedPlayerInventoryIds shares inventory requests across source families", () => {
  assert.deepEqual(selectedPlayerInventoryIds({
    playerIds: ["player-1", "player-2"],
    bankPlayerIds: ["player-1", "player-3"],
    bankContainerIds: ["player-4:bank-8", "player-2:bank-9"],
    deployableContainerIds: ["player-5:cart", "player-3:wagon-9"],
  }), ["player-1", "player-2", "player-3", "player-4", "player-5"]);
});

test("selectedPlayerInventoryIds discovers a player from deployable-only opt-in", () => {
  assert.deepEqual(selectedPlayerInventoryIds({
    playerIds: [],
    bankPlayerIds: [],
    bankContainerIds: [],
    deployableContainerIds: ["deployable-owner:personal-cache-7"],
  }), ["deployable-owner"]);
});

test("filterSelectedPlayerBankSources prefers exact bank IDs while preserving legacy players", () => {
  const sources = [
    { sourceId: "player-1:bank-a", playerId: "player-1" },
    { sourceId: "player-1:bank-b", playerId: "player-1" },
    { sourceId: "player-2:bank-a", playerId: "player-2" },
    { sourceId: "player-3:bank-a", playerId: "player-3" },
  ];

  assert.deepEqual(filterSelectedPlayerBankSources({
    bankContainerIds: ["player-1:bank-b"],
    bankPlayerIds: ["player-1", "player-2"],
  }, sources).map((source) => source.sourceId), ["player-1:bank-b", "player-2:bank-a"]);
});

test("playerBankOptions exposes normalized banks and preserves missing tracked bank IDs", () => {
  const banks = playerBankOptions("player-1", "Alice", {
    items: [{ id: 10, name: "Timber" }],
    inventories: [{
      entityId: "bank-stocked",
      inventoryName: "Town Bank",
      claimName: "Timbersteel",
      pockets: [{ contents: { itemId: 10, itemType: 0, quantity: 12 } }],
    }, {
      entityId: "bank-empty",
      inventoryName: "Town Bank",
      claimName: "Northwatch",
      pockets: [],
    }],
  }, ["player-1:bank-missing"]);

  assert.deepEqual(banks.map((bank) => ({ sourceId: bank.sourceId, claimName: bank.claimName, itemCount: bank.itemCount })), [
    { sourceId: "player-1:bank-stocked", claimName: "Timbersteel", itemCount: 1 },
    { sourceId: "player-1:bank-empty", claimName: "Northwatch", itemCount: 0 },
    { sourceId: "player-1:bank-missing", claimName: null, itemCount: 0 },
  ]);
  assert.deepEqual(banks[0].items.map((item) => [item.kind, item.id, item.quantity]), [["items", "10", 12]]);
});

test("player banks preserve item and cargo identity", () => {
  const result = playerInventoryContainerSources("player-1", "Modular", {
    items: [{ id: 700, name: "Regular Item 700", tier: 2 }],
    cargos: [{ id: 700, name: "Cargo 700", tier: 5 }],
    inventories: [{
      entityId: "bank-1",
      inventoryName: "Town Bank",
      claimName: "Remote Settlement",
      pockets: [
        { contents: { itemId: 700, itemType: 0, quantity: 4 } },
        { contents: { itemId: 700, itemType: 1, quantity: 6 } },
      ],
    }],
  });

  assert.deepEqual(result.banks[0].items.map((item) => [item.kind, item.id, item.quantity]), [
    ["items", "700", 4],
    ["cargo", "700", 6],
  ]);
  assert.deepEqual(result.banks[0].items.map((item) => [item.name, item.tier]), [
    ["Regular Item 700", 2],
    ["Cargo 700", 5],
  ]);
});

test("player banks ignore ambiguous containers and stack types", () => {
  const result = playerInventoryContainerSources("player-1", "Modular", {
    items: [{ id: 700, name: "Regular Item 700" }],
    inventories: [
      {
        inventoryName: "Town Bank",
        claimName: "Missing ID Settlement",
        pockets: [{ contents: { itemId: 700, itemType: 0, quantity: 20 } }],
      },
      {
        entityId: "bank-valid",
        inventoryName: "Town Bank",
        claimName: "Remote Settlement",
        pockets: [
          { contents: { itemId: 700, quantity: 30 } },
          { contents: { itemId: 700, itemType: 0, quantity: 4 } },
        ],
      },
    ],
  });

  assert.equal(result.banks.length, 1);
  assert.equal(result.banks[0].sourceId, "player-1:bank-valid");
  assert.deepEqual(result.banks[0].items.map((item) => [item.name, item.quantity]), [["Regular Item 700", 4]]);
});

test("playerInventoryContainerSources applies deployable allow-list only to counted sources", () => {
  const result = playerInventoryContainerSources("player-1", "Modular", {
    inventories: [
      { entityId: "cart-1", inventoryName: "Cart", pockets: [{ contents: { itemId: 1, itemType: 0, quantity: 1 } }] },
      { entityId: "stash-1", inventoryName: "Personal Stash", pockets: [{ contents: { itemId: 2, itemType: 0, quantity: 1 } }] },
    ],
  }, ["player-1:stash-1"]);

  assert.deepEqual(result.deployableOptions.map((source) => source.sourceId), ["player-1:cart", "player-1:stash-1"]);
  assert.deepEqual(result.deployables.map((source) => source.sourceId), ["player-1:stash-1"]);
});

test("craft plan source lookup ignores non-array catalog wrappers", () => {
  const result = playerInventoryContainerSources("player-1", "Modular", {
    items: { rows: [] },
    data: { items: { rows: [] }, inventories: [{ entityId: "player-inventory", inventoryName: "Inventory", pockets: [{ contents: { itemId: 999, itemType: 0, quantity: 3 } }] }] },
  });

  assert.equal(result.inventory.items[0].name, "Item #999");
  assert.equal(result.inventory.items[0].quantity, 3);
});
test("playerInventoryContainerSources uses one stable cart source id for carts and wagons", () => {
  const cartResult = playerInventoryContainerSources("player-1", "Modular", {
    inventories: [
      { entityId: "cart-iii", inventoryName: "Modular's Cart (III)", pockets: [{ contents: { itemId: 1, itemType: 0, quantity: 1 } }] },
    ],
  }, ["player-1:cart"]);
  const wagonResult = playerInventoryContainerSources("player-1", "Modular", {
    inventories: [
      { entityId: "wagon-i", inventoryName: "Modular's Wagon (I)", pockets: [{ contents: { itemId: 1, itemType: 0, quantity: 1 } }] },
    ],
  }, ["player-1:cart"]);

  assert.equal(cartResult.deployableOptions[0].sourceId, "player-1:cart");
  assert.equal(cartResult.deployables[0].sourceId, "player-1:cart");
  assert.equal(cartResult.deployableOptions[0].label, "Cart");
  assert.equal(wagonResult.deployableOptions[0].sourceId, "player-1:cart");
  assert.equal(wagonResult.deployables[0].sourceId, "player-1:cart");
  assert.equal(wagonResult.deployableOptions[0].label, "Cart");
});
test("playerInventoryContainerSources exposes a selectable cart source even when none is deployed", () => {
  const result = playerInventoryContainerSources("player-1", "Modular", {
    inventories: [
      { entityId: "player-inventory", inventoryName: "Inventory", pockets: [{ contents: { itemId: 1, itemType: 0, quantity: 1 } }] },
    ],
  }, ["player-1:cart"]);

  const option = result.deployableOptions.find((source) => source.sourceId === "player-1:cart");
  assert.equal(option?.label, "Cart");
  assert.equal(option?.itemCount, 0);
  assert.equal(result.deployables.find((source) => source.sourceId === "player-1:cart")?.items.length, 0);
});

test("sourceItemFromContents uses BitJita itemType to distinguish items and cargo", () => {
  const item = sourceItemFromContents({ itemId: 5130004, itemType: 0, quantity: 12 });
  const cargo = sourceItemFromContents({ itemId: 3100001, itemType: 1, quantity: 34 });

  assert.equal(item?.kind, "items");
  assert.equal(item?.itemType, 0);
  assert.equal(item?.name, "Item #5130004");
  assert.equal(cargo?.kind, "cargo");
  assert.equal(cargo?.itemType, 1);
  assert.equal(cargo?.name, "Cargo #3100001");
});
