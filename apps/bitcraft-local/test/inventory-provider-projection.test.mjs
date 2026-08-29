import assert from "node:assert/strict";
import test from "node:test";

const {
  addDecimalQuantities,
  buildCatalogItemDetail,
  enrichInventoryWithCatalog,
  formatDecimalQuantity,
  inventoryStackKey,
  mergeClaimInventoryWithBanks,
  mergeClaimInventoryWithLiveStorages,
  resolveLiveStorageOverlay,
} = await import(
  new URL("../src/server/game-data/inventoryProjection.ts", import.meta.url).href,
);

test("claim inventory composition adds live Town Bank containers without duplicating shared storage", () => {
  const shared = {
    claim: { entityId: "1369094286777412590", regionId: "19" },
    dimensions: [{
      dimensionId: "77",
      kind: "Claim",
      buildings: [{ entityId: "100", name: "Chest", inventory: [] }],
    }],
    buildings: [{ entityId: "100", name: "Chest", inventory: [] }],
  };
  const banks = {
    buildings: [
      { entityId: "8001", name: "Town Bank — Ada", inventory: [] },
      { entityId: "100", name: "Impossible duplicate", inventory: [] },
    ],
  };

  assert.deepEqual(mergeClaimInventoryWithBanks(shared, banks), {
    claim: { entityId: "1369094286777412590", regionId: "19" },
    dimensions: [{
      dimensionId: "77",
      kind: "Claim",
      buildings: [{ entityId: "100", name: "Chest", inventory: [] }],
    }],
    buildings: [
      { entityId: "100", name: "Chest", inventory: [] },
      { entityId: "8001", name: "Town Bank — Ada", inventory: [] },
    ],
  });
});

test("live settlement storage quantities replace stale HTTP values while preserving display metadata", () => {
  const shared = {
    claim: { entityId: "1369094286777412590", regionId: "19" },
    dimensions: [{
      dimensionId: "77",
      kind: "Claim",
      buildings: [{
        entityId: "100",
        name: "Fine Large Chest",
        nickname: "Smithing Supplies",
        dimensionId: "77",
        inventory: [{ contents: { itemId: "42", itemType: "item", quantity: "2" } }],
      }],
    }],
    buildings: [{
      entityId: "100",
      name: "Fine Large Chest",
      nickname: "Smithing Supplies",
      dimensionId: "77",
      inventory: [{ contents: { itemId: "42", itemType: "item", quantity: "2" } }],
    }],
  };
  const live = {
    buildings: [{
      entityId: "100",
      inventoryEntityId: "900",
      buildingDescriptionId: "6020",
      inventory: [{ contents: { itemId: "42", itemType: "item", quantity: "11" } }],
    }],
  };

  const merged = mergeClaimInventoryWithLiveStorages(shared, live);

  assert.equal(merged.buildings[0].nickname, "Smithing Supplies");
  assert.equal(merged.buildings[0].inventory[0].contents.quantity, "11");
  assert.equal(merged.dimensions[0].buildings[0].inventory[0].contents.quantity, "11");
  assert.equal(merged.buildings[0].inventoryEntityId, "900");
});

test("an authoritative empty live storage snapshot clears stale HTTP quantities", () => {
  const shared = {
    dimensions: [{
      dimensionId: "77",
      buildings: [{
        entityId: "100",
        name: "Fine Large Chest",
        items: [{ itemId: "42", itemType: "item", quantity: "2" }],
        inventory: [{ contents: { itemId: "42", itemType: "item", quantity: "2" } }],
      }],
    }],
    buildings: [{
      entityId: "100",
      name: "Fine Large Chest",
      items: [{ itemId: "42", itemType: "item", quantity: "2" }],
      inventory: [{ contents: { itemId: "42", itemType: "item", quantity: "2" } }],
    }],
  };

  assert.equal(mergeClaimInventoryWithLiveStorages(shared, undefined), shared, "missing live state must retain the HTTP fallback");

  const merged = mergeClaimInventoryWithLiveStorages(shared, { buildings: [] });

  assert.deepEqual(merged.buildings[0].items, []);
  assert.deepEqual(merged.buildings[0].inventory, []);
  assert.deepEqual(merged.dimensions[0].buildings[0].inventory, []);
});

test("live storage overlay uses only a healthy authoritative subscription and exposes fallback freshness", () => {
  const snapshot = {
    data: { buildings: [{ entityId: "100", inventory: [] }] },
    confidence: "authoritative",
    generation: 12,
    lastError: null,
    provenance: { sourceKey: "region:19", receivedAt: "2026-08-29T10:00:00.000Z" },
    warnings: [],
  };
  const healthy = {
    connected: true,
    generation: 11,
    lastError: null,
    updatedAt: "2026-08-29T10:00:01.000Z",
  };

  assert.deepEqual(resolveLiveStorageOverlay(snapshot, healthy, {
    now: new Date("2026-08-29T10:00:02.000Z"),
    liveForMs: 30_000,
  }), {
    data: snapshot.data,
    freshness: "live",
    warning: null,
  });

  const stale = resolveLiveStorageOverlay(snapshot, { ...healthy, connected: false }, {
    now: new Date("2026-08-29T10:00:02.000Z"),
    liveForMs: 30_000,
  });
  assert.equal(stale.data, null);
  assert.equal(stale.freshness, "stale");
  assert.match(stale.warning, /using the latest Relay HTTP snapshot/i);

  const unavailable = resolveLiveStorageOverlay(null, null, {
    now: new Date("2026-08-29T10:00:02.000Z"),
    liveForMs: 30_000,
  });
  assert.equal(unavailable.data, null);
  assert.equal(unavailable.freshness, "unavailable");
});

test("inventory catalog enrichment preserves item/cargo collisions and exact quantities", () => {
  const entities = new Map([
    ["items:42", {
      catalogKey: "items:42",
      kind: "items",
      targetId: "42",
      name: "Ancient Timber",
      tier: 4,
    }],
    ["cargo:42", {
      catalogKey: "cargo:42",
      kind: "cargo",
      targetId: "42",
      name: "Ancient Timber Package",
      tier: 4,
    }],
  ]);
  const inventory = enrichInventoryWithCatalog({
    claim: { entityId: "1369094286777412590", regionId: "19" },
    dimensions: [{
      dimensionId: "77",
      kind: "Claim",
      buildings: [{
        entityId: "100",
        name: "Chest",
        nickname: "Materials",
        items: [
          { itemId: "42", itemType: "item", quantity: "9007199254740993" },
          { itemId: "42", itemType: "cargo", quantity: "2" },
        ],
      }],
    }],
    buildings: [],
  }, (key) => entities.get(key) ?? null);

  assert.equal(inventory.catalog["items:42"].name, "Ancient Timber");
  assert.equal(inventory.catalog["cargo:42"].name, "Ancient Timber Package");
  assert.equal(inventoryStackKey({ itemId: "42", itemType: "item" }), "items:42");
  assert.equal(inventoryStackKey({ itemId: "42", itemType: "cargo" }), "cargo:42");
  assert.equal(inventory.dimensions[0].buildings[0].items[0].quantity, "9007199254740993");
});

test("inventory quantity helpers do not round decimal integer strings", () => {
  assert.equal(addDecimalQuantities(["9007199254740993", "7"]), "9007199254741000");
  assert.equal(formatDecimalQuantity("9007199254740993", "en-GB"), "9,007,199,254,740,993");
});

test("catalog item detail is composed from normalized Relay descriptions", () => {
  const detail = buildCatalogItemDetail({
    kind: "item",
    id: "42",
    entity: {
      catalogKey: "items:42",
      kind: "items",
      targetId: "42",
      name: "Timber",
      tier: 2,
    },
    recipes: [
      {
        kind: "crafting_recipe",
        id: "10",
        name: "Saw Timber",
        actionsRequired: 12,
        buildingRequirement: { buildingType: "5", tier: 2 },
        levelRequirements: [{ skillId: "7", level: 10 }],
        inputs: [{ kind: "item", id: "41", quantity: "2" }],
        outputs: [{ kind: "item", id: "42", quantity: "1" }],
      },
      {
        kind: "crafting_recipe",
        id: "11",
        name: "Build Frame",
        actionsRequired: 4,
        buildingRequirement: null,
        levelRequirements: [{ skillId: "7", level: 5 }],
        inputs: [{ kind: "item", id: "42", quantity: "3" }],
        outputs: [{ kind: "cargo", id: "42", quantity: "1" }],
      },
    ],
    skills: [{
      kind: "skill",
      id: "7",
      name: "Carpentry",
    }],
  });

  assert.equal(detail.item.name, "Timber");
  assert.deepEqual(detail.craftingRecipes.map((recipe) => recipe.name), ["Saw Timber"]);
  assert.deepEqual(detail.recipesUsingItem.map((recipe) => recipe.name), ["Build Frame"]);
  assert.deepEqual(detail.relatedSkills, [{ id: "7", name: "Carpentry" }]);
  assert.equal(detail.marketStats, null);
});
