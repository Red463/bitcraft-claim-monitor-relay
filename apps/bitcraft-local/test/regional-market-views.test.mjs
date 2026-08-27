import assert from "node:assert/strict";
import test from "node:test";

let views = null;
try {
  views = await import("../src/server/regionalMarketViews.mjs");
} catch {
  // The first TDD run proves the provider-neutral regional market view is absent.
}

const snapshot = {
  orders: [{
    entityId: "501",
    claimEntityId: "100",
    claimName: "Timbersteel Trade",
    regionId: "19",
    ownerEntityId: "701",
    ownerUsername: "Buyer One",
    itemId: "43",
    itemType: "cargo",
    price: "25",
    quantity: "8",
    storedCoins: "200",
    timestamp: "2026-07-30T12:01:00.000Z",
  }, {
    entityId: "502",
    claimEntityId: "101",
    claimName: "Other Market",
    regionId: "7",
    ownerEntityId: "702",
    ownerUsername: "Buyer Two",
    itemId: "44",
    itemType: "item",
    price: "12",
    quantity: "3",
    storedCoins: "36",
    timestamp: "2026-07-30T12:02:00.000Z",
  }],
};

test("regional market view filters and enriches the live generation without SQL current tables", () => {
  assert.ok(views, "regional market views module must exist");
  const result = views.regionalBuyOrdersView(snapshot, {
    regionId: "19",
    search: "timber",
    page: 1,
    pageSize: 25,
    sort: "unitPrice",
    direction: "desc",
    observedAt: "2026-07-30T12:03:00.000Z",
    getEntity: (key) => key === "cargo:43"
      ? { name: "Timber Package", tier: 3, rarity: "Uncommon", iconAssetName: "timber.png" }
      : null,
  });
  assert.equal(result.total, 1);
  assert.deepEqual(result.rows[0], {
    orderKey: "501",
    regionId: "19",
    regionName: "R19",
    marketClaimId: "100",
    marketClaimName: "Timbersteel Trade",
    buyerEntityId: "701",
    buyerName: "Buyer One",
    itemId: "43",
    itemType: "cargo",
    itemName: "Timber Package",
    tier: 3,
    rarity: "Uncommon",
    rarityStr: "Uncommon",
    iconAssetName: "timber.png",
    quantity: "8",
    unitPrice: "25",
    totalValue: "200",
    storedCoins: "200",
    listedAt: "2026-07-30T12:01:00.000Z",
    firstSeen: "2026-07-30T12:01:00.000Z",
    lastSeen: "2026-07-30T12:03:00.000Z",
    averageUnitPrice: null,
    salesCount: 0,
    premiumPercent: null,
    opportunityEligible: false,
    baselineObservedSince: null,
    baselineLastSoldAt: null,
  });
  assert.deepEqual(result.opportunities, []);
});

test("buy-order view applies exact same-region baselines before paging", () => {
  const saleBaselines = new Map([
    ["19:cargo:43", {
      regionId: "19", itemType: "cargo", itemId: "43",
      salesCount: 3, unitsSold: "3", totalValue: "60",
      observedSince: "2026-07-28T00:00:00.000Z",
      lastSoldAt: "2026-07-31T00:00:00.000Z",
    }],
  ]);
  const result = views.regionalBuyOrdersView({
    orders: [
      { ...snapshot.orders[0], entityId: "low", price: "20" },
      { ...snapshot.orders[0], entityId: "high", price: "25" },
    ],
  }, {
    regionId: "19",
    page: 1,
    pageSize: 25,
    sort: "premium",
    direction: "desc",
    saleBaselines,
    historyObservedSince: "2026-07-28T00:00:00.000Z",
    getEntity: () => null,
  });
  assert.equal(result.rows[0].orderKey, "high");
  assert.equal(result.rows[0].averageUnitPrice, "20");
  assert.equal(result.rows[0].premiumPercent, "25");
  assert.equal(result.rows[0].opportunityEligible, true);
  assert.equal(result.rows[1].premiumPercent, "0");
  assert.equal(result.rows[1].opportunityEligible, false);
  assert.deepEqual(result.opportunities.map((row) => row.orderKey), ["high"]);
  assert.equal(result.baselineWindowDays, 7);
  assert.equal(result.minimumSales, 3);
  assert.equal(result.historyObservedSince, "2026-07-28T00:00:00.000Z");
});

test("buy-order view displays a premium below the minimum confirmed-sale threshold without qualifying it", () => {
  const result = views.regionalBuyOrdersView(snapshot, {
    regionId: "19",
    saleBaselines: new Map([["19:cargo:43", {
      regionId: "19", itemType: "cargo", itemId: "43",
      salesCount: 2, unitsSold: "3", totalValue: "60",
      observedSince: "2026-07-28T00:00:00.000Z",
      lastSoldAt: "2026-07-31T00:00:00.000Z",
    }]]),
    getEntity: () => null,
  });

  assert.equal(result.rows[0].averageUnitPrice, "20");
  assert.equal(result.rows[0].premiumPercent, "25");
  assert.equal(result.rows[0].salesCount, 2);
  assert.equal(result.rows[0].opportunityEligible, false);
  assert.deepEqual(result.opportunities, []);
});

test("buy-order view keeps item and cargo sale baselines separate for colliding IDs", () => {
  const result = views.regionalBuyOrdersView({
    orders: [
      { ...snapshot.orders[0], entityId: "cargo", itemType: "cargo", itemId: "43", price: "25" },
      { ...snapshot.orders[0], entityId: "item", itemType: "item", itemId: "43", price: "30" },
    ],
  }, {
    regionId: "19",
    sort: "item",
    direction: "asc",
    saleBaselines: new Map([
      ["19:cargo:43", { regionId: "19", itemType: "cargo", itemId: "43", salesCount: 3, unitsSold: "3", totalValue: "60" }],
      ["19:item:43", { regionId: "19", itemType: "item", itemId: "43", salesCount: 3, unitsSold: "2", totalValue: "30" }],
    ]),
    getEntity: (key) => key === "cargo:43" ? { name: "Cargo" } : { name: "Item" },
  });

  assert.deepEqual(result.rows.map((row) => ({ orderKey: row.orderKey, averageUnitPrice: row.averageUnitPrice, premiumPercent: row.premiumPercent })), [
    { orderKey: "cargo", averageUnitPrice: "20", premiumPercent: "25" },
    { orderKey: "item", averageUnitPrice: "15", premiumPercent: "100" },
  ]);
});

test("buy-order view joins numeric cargo orders to cargo baselines when item IDs collide", () => {
  const result = views.regionalBuyOrdersView({
    orders: [{
      ...snapshot.orders[0],
      entityId: "numeric-cargo",
      itemType: 1,
      itemId: "43",
      price: "25",
    }],
  }, {
    regionId: "19",
    saleBaselines: new Map([
      ["19:item:43", {
        regionId: "19", itemType: "item", itemId: "43",
        salesCount: 3, unitsSold: "3", totalValue: "30",
      }],
      ["19:cargo:43", {
        regionId: "19", itemType: "cargo", itemId: "43",
        salesCount: 3, unitsSold: "3", totalValue: "60",
      }],
    ]),
    getEntity: () => null,
  });

  assert.equal(result.rows[0].itemType, "cargo");
  assert.equal(result.rows[0].averageUnitPrice, "20");
  assert.equal(result.rows[0].premiumPercent, "25");
  assert.equal(result.rows[0].opportunityEligible, true);
});

test("buy-order view sorts fractional premiums by their exact values beyond display rounding", () => {
  const result = views.regionalBuyOrdersView({
    orders: [
      { ...snapshot.orders[0], entityId: "lower", itemType: "item", itemId: "1", price: "100" },
      { ...snapshot.orders[0], entityId: "higher", itemType: "item", itemId: "2", price: "100" },
    ],
  }, {
    regionId: "19",
    sort: "premium",
    direction: "desc",
    saleBaselines: new Map([
      ["19:item:1", { regionId: "19", itemType: "item", itemId: "1", salesCount: 3, unitsSold: "10000", totalValue: "999955" }],
      ["19:item:2", { regionId: "19", itemType: "item", itemId: "2", salesCount: 3, unitsSold: "10000", totalValue: "999954" }],
    ]),
    getEntity: () => null,
  });

  assert.deepEqual(result.rows.map((row) => row.orderKey), ["higher", "lower"]);
  assert.deepEqual(result.rows.map((row) => row.premiumPercent), ["0", "0"]);
});

test("buy-order view displays negative premiums but never qualifies them", () => {
  const result = views.regionalBuyOrdersView({
    orders: [{ ...snapshot.orders[0], entityId: "below", price: "19" }],
  }, {
    regionId: "19",
    saleBaselines: new Map([["19:cargo:43", {
      regionId: "19", itemType: "cargo", itemId: "43", salesCount: 3, unitsSold: "3", totalValue: "60",
    }]]),
    getEntity: () => null,
  });

  assert.equal(result.rows[0].premiumPercent, "-5");
  assert.equal(result.rows[0].opportunityEligible, false);
  assert.deepEqual(result.opportunities, []);
});

test("buy-order view caps opportunities before paginating its table", () => {
  const eligibleOrders = Array.from({ length: 11 }, (_, index) => ({
    ...snapshot.orders[0],
    entityId: `eligible-${index}`,
    itemType: "item",
    itemId: String(index + 1),
    price: String(index + 10),
  }));
  const ineligibleOrders = Array.from({ length: 15 }, (_, index) => ({
    ...snapshot.orders[0],
    entityId: `ineligible-${index}`,
    itemType: "item",
    itemId: String(index + 20),
    price: "1000",
  }));
  const saleBaselines = new Map(eligibleOrders.map((order) => [
    `19:item:${order.itemId}`,
    { regionId: "19", itemType: "item", itemId: order.itemId, salesCount: 3, unitsSold: "1", totalValue: "1" },
  ]));
  const result = views.regionalBuyOrdersView({ orders: [...eligibleOrders, ...ineligibleOrders] }, {
    regionId: "19",
    page: 2,
    pageSize: 25,
    sort: "unitPrice",
    direction: "desc",
    saleBaselines,
    getEntity: () => null,
  });

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].orderKey, "eligible-0");
  assert.deepEqual(result.opportunities.map((row) => row.orderKey), [
    "eligible-10", "eligible-9", "eligible-8", "eligible-7", "eligible-6",
    "eligible-5", "eligible-4", "eligible-3", "eligible-2", "eligible-1",
  ]);
});

test("buy-order opportunities honor the text-filtered result", () => {
  const result = views.regionalBuyOrdersView({
    orders: [
      { ...snapshot.orders[0], entityId: "shown", itemType: "item", itemId: "1", price: "20" },
      { ...snapshot.orders[0], entityId: "hidden", itemType: "item", itemId: "2", price: "30" },
    ],
  }, {
    regionId: "19",
    search: "visible",
    saleBaselines: new Map([
      ["19:item:1", { regionId: "19", itemType: "item", itemId: "1", salesCount: 3, unitsSold: "1", totalValue: "10" }],
      ["19:item:2", { regionId: "19", itemType: "item", itemId: "2", salesCount: 3, unitsSold: "1", totalValue: "10" }],
    ]),
    getEntity: (key) => key === "items:1" ? { name: "Visible item" } : { name: "Hidden item" },
  });

  assert.deepEqual(result.rows.map((row) => row.orderKey), ["shown"]);
  assert.deepEqual(result.opportunities.map((row) => row.orderKey), ["shown"]);
});

test("regional market view preserves exact decimal quantities and sorts before paging", () => {
  assert.ok(views, "regional market views module must exist");
  const result = views.regionalBuyOrdersView({
    orders: [
      ...snapshot.orders,
      { ...snapshot.orders[0], entityId: "503", price: "9007199254740993", quantity: "2" },
    ],
  }, {
    regionId: "all",
    page: 1,
    pageSize: 25,
    sort: "unitPrice",
    direction: "desc",
    getEntity: () => null,
  });
  assert.equal(result.rows[0].orderKey, "503");
  assert.equal(result.rows[0].unitPrice, "9007199254740993");
  assert.equal(result.rows[0].totalValue, "18014398509481986");
});

test("regional market view enforces the current allowed scope and uses each region receive time", () => {
  assert.ok(views, "regional market views module must exist");
  const currentData = {
    activeRegionIds: ["7", "19"],
    orders: snapshot.orders,
    regions: [{
      regionId: "7",
      count: 1,
      receivedAt: "2026-07-30T11:00:00.000Z",
      warnings: [],
    }, {
      regionId: "19",
      count: 1,
      receivedAt: "2026-07-30T12:03:00.000Z",
      warnings: [],
    }],
  };
  const result = views.regionalBuyOrdersView(currentData, {
    regionId: "all",
    allowedRegionIds: ["19"],
    observedAt: "2026-07-30T12:10:00.000Z",
    page: 1,
    pageSize: 25,
    getEntity: () => null,
  });
  assert.deepEqual(result.rows.map((row) => row.regionId), ["19"]);
  assert.equal(result.rows[0].lastSeen, "2026-07-30T12:03:00.000Z");
  assert.equal(result.unfilteredRegionRows, 1);

  const status = views.regionalMarketStatus({
    data: currentData,
    confidence: "authoritative",
    lastError: null,
    warnings: ["Relay regional market has not loaded region 7 yet."],
  }, {
    regionId: "all",
    allowedRegionIds: ["19"],
    nowMs: Date.parse("2026-07-30T12:03:30.000Z"),
    staleAfterMs: 60_000,
    runtimeHealth: { running: false, pool: null },
  });
  assert.equal(status.freshness, "fresh");
  assert.equal(status.ageMs, 30_000);
  assert.doesNotMatch(status.warnings.join(" "), /region 7/i);
});

test("regional market view counts region rows before applying text search", () => {
  assert.ok(views, "regional market views module must exist");
  const result = views.regionalBuyOrdersView(snapshot, {
    regionId: "all",
    allowedRegionIds: ["7", "19"],
    search: "timbersteel",
    page: 1,
    pageSize: 25,
    getEntity: () => null,
  });
  assert.equal(result.total, 1);
  assert.equal(result.unfilteredRegionRows, 2);
});

test("regional market status reports per-region age and disconnected sessions as stale", () => {
  assert.ok(views, "regional market views module must exist");
  const current = {
    data: {
      activeRegionIds: ["7", "19"],
      orders: snapshot.orders,
      regions: [{
        regionId: "19",
        count: 1,
        receivedAt: "2026-07-30T12:00:00.000Z",
        warnings: [],
      }],
    },
    confidence: "partial",
    lastError: null,
    warnings: ["Relay regional market has not loaded region 7 yet."],
  };
  const disconnected = views.regionalMarketStatus(current, {
    regionId: "19",
    nowMs: Date.parse("2026-07-30T12:00:30.000Z"),
    staleAfterMs: 60_000,
    runtimeHealth: {
      running: true,
      pool: {
        sessions: [{
          regionId: "19",
          health: { connected: false, lastError: "socket lost" },
        }],
      },
    },
  });
  assert.equal(disconnected.freshness, "stale");
  assert.equal(disconnected.ageMs, 30_000);
  assert.match(disconnected.warnings.join(" "), /disconnected/i);
  assert.deepEqual(disconnected.errors, ["socket lost"]);

  const connectedWithError = views.regionalMarketStatus(current, {
    regionId: "19",
    nowMs: Date.parse("2026-07-30T12:00:30.000Z"),
    staleAfterMs: 60_000,
    runtimeHealth: {
      running: true,
      pool: {
        sessions: [{
          regionId: "19",
          health: { connected: true, lastError: "detail subscription reset" },
        }],
      },
    },
  });
  assert.equal(connectedWithError.freshness, "stale");
  assert.deepEqual(connectedWithError.errors, ["detail subscription reset"]);

  const quietButConnected = views.regionalMarketStatus(current, {
    regionId: "19",
    nowMs: Date.parse("2026-07-30T12:02:00.000Z"),
    staleAfterMs: 60_000,
    runtimeHealth: {
      running: true,
      pool: {
        sessions: [{
          regionId: "19",
          health: { connected: true, applied: true, lastError: null },
        }],
      },
    },
  });
  assert.equal(quietButConnected.freshness, "fresh");
  assert.equal(quietButConnected.ageMs, 120_000);
  assert.doesNotMatch(quietButConnected.warnings.join(" "), /older than/i);

  const aged = views.regionalMarketStatus(current, {
    regionId: "19",
    nowMs: Date.parse("2026-07-30T12:02:00.000Z"),
    staleAfterMs: 60_000,
    runtimeHealth: { running: false, pool: null },
  });
  assert.equal(aged.freshness, "stale");
  assert.equal(aged.ageMs, 120_000);
  assert.match(aged.warnings.join(" "), /older than/i);
  assert.deepEqual(aged.errors, []);

  const neverLoaded = views.regionalMarketStatus(current, {
    regionId: "7",
    nowMs: Date.parse("2026-07-30T12:00:30.000Z"),
    staleAfterMs: 60_000,
    runtimeHealth: { running: false, pool: null },
  });
  assert.equal(neverLoaded.freshness, "unavailable");
  assert.equal(neverLoaded.confidence, "partial");
});

test("regional market catalog view joins live order counts to item and cargo identities", () => {
  assert.equal(
    typeof views.regionalMarketCatalogView,
    "function",
    "regional market catalog view must exist",
  );
  const result = views.regionalMarketCatalogView({
    activeRegionIds: ["7", "19"],
    orders: [
      ...snapshot.orders,
      {
        ...snapshot.orders[0],
        entityId: "503",
        side: "sell",
        regionId: "19",
      },
    ],
  }, [{
    catalogKey: "cargo:43",
    kind: "cargo",
    targetId: "43",
    name: "Timber Package",
    tag: "Wood",
    tier: 3,
    rarity: "Uncommon",
    iconAssetName: "timber.png",
  }, {
    catalogKey: "items:44",
    kind: "items",
    targetId: "44",
    name: "Leather Strap",
    tag: "Leather",
    tier: 2,
    rarity: "Common",
    iconAssetName: "leather.png",
  }], {
    regionId: "19",
    allowedRegionIds: ["7", "19"],
    query: "timber",
    availableOnly: true,
    hasSell: true,
    hasBuy: true,
    limit: 12,
  });

  assert.deepEqual(result.categories, ["Wood"]);
  assert.deepEqual(result.items, [{
    id: "43",
    itemId: "43",
    itemType: "cargo",
    name: "Timber Package",
    category: "Wood",
    tag: "Wood",
    tier: 3,
    rarity: "Uncommon",
    rarityStr: "Uncommon",
    iconAssetName: "timber.png",
    sellOrders: 1,
    buyOrders: 1,
    orderCount: 2,
    hasSellOrders: true,
    hasBuyOrders: true,
    lowestSellPrice: "25",
    lowestSellLocation: "Timbersteel Trade",
    highestBuyPrice: "25",
    highestBuyLocation: "Timbersteel Trade",
  }]);
});

test("regional market catalog applies live-order filters before its response limit", () => {
  const catalogRows = Array.from({ length: 75 }, (_, index) => ({
    kind: "items",
    targetId: String(index + 1),
    name: `Timber ${String(index + 1).padStart(3, "0")}`,
  }));
  const result = views.regionalMarketCatalogView({
    orders: [{
      entityId: "900",
      side: "sell",
      regionId: "19",
      itemType: "item",
      itemId: "75",
    }],
  }, catalogRows, {
    query: "timber",
    regionId: "19",
    availableOnly: true,
    hasSell: true,
    limit: 12,
  });

  assert.deepEqual(result.items.map((item) => item.itemId), ["75"]);
});

test("regional market catalog exposes exact best prices and locations", () => {
  const result = views.regionalMarketCatalogView({
    orders: [
      { entityId: "1", side: "sell", regionId: "19", itemType: "item", itemId: "44", price: "120", claimName: "High Market" },
      { entityId: "2", side: "sell", regionId: "19", itemType: "item", itemId: "44", price: "90", claimName: "Low Market" },
      { entityId: "3", side: "buy", regionId: "19", itemType: "item", itemId: "44", priceThreshold: "70", claimName: "Buyer Hall" },
    ],
  }, [{ kind: "items", targetId: "44", name: "Leather Strap", tag: "Leather" }], {
    regionId: "19",
    sort: "name",
  });

  assert.equal(result.items[0].lowestSellPrice, "90");
  assert.equal(result.items[0].lowestSellLocation, "Low Market");
  assert.equal(result.items[0].highestBuyPrice, "70");
  assert.equal(result.items[0].highestBuyLocation, "Buyer Hall");
});

test("regional market catalog sorts exact price and spread signals before limiting", () => {
  const snapshot = { orders: [
    { entityId: "1", side: "sell", regionId: "19", itemType: "item", itemId: "1", price: "90071992547409931" },
    { entityId: "2", side: "buy", regionId: "19", itemType: "item", itemId: "1", priceThreshold: "90071992547409930" },
    { entityId: "3", side: "sell", regionId: "19", itemType: "item", itemId: "2", price: "20" },
    { entityId: "4", side: "buy", regionId: "19", itemType: "item", itemId: "2", priceThreshold: "10" },
  ] };
  const catalog = [
    { kind: "items", targetId: "1", name: "Exact" },
    { kind: "items", targetId: "2", name: "Wide" },
  ];

  assert.deepEqual(views.regionalMarketCatalogView(snapshot, catalog, { regionId: "19", sort: "lowest-sell" }).items.map((item) => item.name), ["Wide", "Exact"]);
  assert.deepEqual(views.regionalMarketCatalogView(snapshot, catalog, { regionId: "19", sort: "highest-buy" }).items.map((item) => item.name), ["Exact", "Wide"]);
  assert.deepEqual(views.regionalMarketCatalogView(snapshot, catalog, { regionId: "19", sort: "spread" }).items.map((item) => item.name), ["Exact", "Wide"]);
});

test("market response freshness includes the older global catalog dependency", () => {
  const orderStatus = {
    freshness: "fresh",
    confidence: "authoritative",
    ageMs: 500,
    warnings: [],
  };
  assert.deepEqual(views.combinedMarketStatus(orderStatus, {
    receivedAt: "2026-07-30T11:58:00.000Z",
  }, {
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
  }), {
    freshness: "stale",
    confidence: "partial",
    ageMs: 120_000,
    warnings: ["Relay global catalog is older than 60 seconds."],
    errors: [],
  });

  assert.deepEqual(views.combinedMarketStatus(orderStatus, null, {
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
  }), {
    freshness: "unavailable",
    confidence: "unknown",
    ageMs: null,
    warnings: ["Relay global catalog has not loaded yet."],
    errors: [],
  });
});

test("regional market status trusts a fresh persisted worker heartbeat in the split web process", () => {
  const status = views.regionalMarketStatus({
    data: {
      activeRegionIds: ["3"],
      regions: [{ regionId: "3", receivedAt: "2026-07-30T11:55:00.000Z" }],
    },
    confidence: "authoritative",
    warnings: [],
  }, {
    allowedRegionIds: ["3"],
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
    runtimeHealth: {
      running: false,
      persisted: true,
      lastError: null,
      subscription: {
        connected: true,
        applied: true,
        lastError: null,
      },
    },
  });

  assert.equal(status.freshness, "fresh");
  assert.deepEqual(status.warnings, []);
  assert.deepEqual(status.errors, []);
});

test("connected global catalog remains live when its data has not changed", () => {
  assert.deepEqual(views.globalCatalogStatus({
    receivedAt: "2026-07-30T11:58:00.000Z",
  }, {
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
    runtimeExpected: true,
    runtimeHealth: {
      running: true,
      lastError: null,
      subscription: {
        connected: true,
        applied: true,
        lastError: null,
      },
    },
  }), {
    freshness: "fresh",
    confidence: "authoritative",
    ageMs: 120_000,
    warnings: [],
    errors: [],
  });
});

test("global catalog status immediately marks a failed expected runtime stale", () => {
  assert.equal(
    typeof views.globalCatalogStatus,
    "function",
    "global catalog status must be shared by catalog-backed routes",
  );
  assert.deepEqual(views.globalCatalogStatus({
    receivedAt: "2026-07-30T11:59:59.500Z",
  }, {
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
    runtimeExpected: true,
    runtimeHealth: {
      running: false,
      lastError: "Relay topology unavailable",
      subscription: {
        connected: false,
        applied: false,
        lastError: null,
      },
    },
  }), {
    freshness: "stale",
    confidence: "partial",
    ageMs: 500,
    warnings: [],
    errors: ["Relay global catalog error: Relay topology unavailable"],
  });
});

test("global catalog status allows a split web process to use fresh worker data", () => {
  assert.deepEqual(views.globalCatalogStatus({
    receivedAt: "2026-07-30T11:59:59.500Z",
  }, {
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
    runtimeExpected: false,
    runtimeHealth: {
      running: false,
      lastError: null,
      subscription: {
        connected: false,
        applied: false,
        lastError: null,
      },
    },
  }), {
    freshness: "fresh",
    confidence: "authoritative",
    ageMs: 500,
    warnings: [],
    errors: [],
  });
});

test("global catalog status trusts a persisted worker heartbeat when the web runtime is expected", () => {
  assert.deepEqual(views.globalCatalogStatus({
    receivedAt: "2026-07-30T11:55:00.000Z",
  }, {
    nowMs: Date.parse("2026-07-30T12:00:00.000Z"),
    staleAfterMs: 60_000,
    runtimeExpected: true,
    runtimeHealth: {
      running: false,
      persisted: true,
      lastError: null,
      subscription: {
        connected: true,
        applied: true,
        lastError: null,
      },
    },
  }), {
    freshness: "fresh",
    confidence: "authoritative",
    ageMs: 300_000,
    warnings: [],
    errors: [],
  });
});

test("regional market order-book view preserves exact prices and scopes regions", () => {
  assert.equal(
    typeof views.regionalMarketOrderBookView,
    "function",
    "regional market order-book view must exist",
  );
  const result = views.regionalMarketOrderBookView({
    activeRegionIds: ["7", "19"],
    orders: [
      {
        ...snapshot.orders[0],
        entityId: "9007199254740993",
        side: "sell",
        price: "9007199254740993",
        quantity: "2",
      },
      snapshot.orders[1],
    ],
  }, {
    catalogKey: "cargo:43",
    kind: "cargo",
    targetId: "43",
    name: "Timber Package",
    tag: "Wood",
    tier: 3,
    rarity: "Uncommon",
    iconAssetName: "timber.png",
  }, {
    itemType: "cargo",
    itemId: "43",
    regionId: "19",
    allowedRegionIds: ["7", "19"],
  });

  assert.equal(result.sellOrders.length, 1);
  assert.equal(result.buyOrders.length, 0);
  assert.equal(result.sellOrders[0].entityId, "9007199254740993");
  assert.equal(result.sellOrders[0].price, "9007199254740993");
  assert.equal(result.sellOrders[0].quantity, "2");
  assert.deepEqual(result.item, {
    id: "43",
    itemId: "43",
    itemType: "cargo",
    name: "Timber Package",
    category: "Wood",
    tag: "Wood",
    tier: 3,
    rarity: "Uncommon",
    rarityStr: "Uncommon",
    iconAssetName: "timber.png",
  });
});

test("regional market order index cache reuses one scoped generation for catalog and order-book projections", () => {
  assert.equal(typeof views.createRegionalMarketOrderIndexCache, "function");
  const cache = views.createRegionalMarketOrderIndexCache();
  const liveSnapshot = {
    orders: [{
      entityId: "9007199254740993",
      side: "sell",
      regionId: "19",
      itemType: "item",
      itemId: "30",
      price: "9007199254740993",
      quantity: "2",
      claimName: "Low Market",
    }, {
      entityId: "9007199254740994",
      side: "buy",
      regionId: "19",
      itemType: "item",
      itemId: "30",
      price: "9007199254740994",
      quantity: "3",
      claimName: "Buyer Hall",
    }, {
      entityId: "9007199254740995",
      side: "sell",
      regionId: "7",
      itemType: "cargo",
      itemId: "30",
      price: "17",
      quantity: "4",
    }],
  };
  const scope = { claimId: "100", generation: 42, allowedRegionIds: ["7", "19"] };
  const index = cache.get(liveSnapshot, scope);

  const catalog = views.regionalMarketCatalogView(liveSnapshot, [
    { kind: "items", targetId: "30", name: "Item Thirty" },
    { kind: "cargo", targetId: "30", name: "Cargo Thirty" },
  ], {
    ...scope,
    regionId: "19",
    orderIndex: index,
    availableOnly: true,
    sort: "name",
  });
  const book = views.regionalMarketOrderBookView(liveSnapshot, {
    kind: "items",
    targetId: "30",
    name: "Item Thirty",
  }, {
    ...scope,
    regionId: "19",
    itemType: "item",
    itemId: "30",
    orderIndex: index,
  });

  assert.deepEqual(catalog.items.map((item) => [item.itemType, item.itemId, item.lowestSellPrice, item.highestBuyPrice]), [
    ["item", "30", "9007199254740993", "9007199254740994"],
  ]);
  assert.deepEqual(book.sellOrders.map((order) => order.entityId), ["9007199254740993"]);
  assert.deepEqual(book.buyOrders.map((order) => order.entityId), ["9007199254740994"]);
  assert.equal(cache.get(liveSnapshot, scope), index);
  assert.deepEqual(cache.cacheStats(), {
    entries: 1,
    builds: 1,
    hits: 1,
    maxEntries: 2,
  });
});

test("regional market order index cache bounds retained generations", () => {
  const cache = views.createRegionalMarketOrderIndexCache({ maxEntries: 2 });
  const liveSnapshot = { orders: [] };

  cache.get(liveSnapshot, { claimId: "100", generation: 1, allowedRegionIds: ["19"] });
  cache.get(liveSnapshot, { claimId: "100", generation: 2, allowedRegionIds: ["19"] });
  cache.get(liveSnapshot, { claimId: "100", generation: 3, allowedRegionIds: ["19"] });

  assert.deepEqual(cache.cacheStats(), {
    entries: 2,
    builds: 3,
    hits: 0,
    maxEntries: 2,
  });
});

test("regional market order index cache replaces an existing key without over-evicting", () => {
  const cache = views.createRegionalMarketOrderIndexCache({ maxEntries: 2 });
  const scopeOne = { claimId: "100", generation: 1, allowedRegionIds: ["19"] };
  const scopeTwo = { claimId: "100", generation: 2, allowedRegionIds: ["19"] };
  const first = { orders: [] };
  const second = { orders: [] };

  cache.get(first, scopeOne);
  cache.get(second, scopeTwo);
  cache.get(first, scopeOne);
  cache.get({ orders: [] }, scopeOne);

  assert.equal(cache.cacheStats().entries, 2);
});

test("regional market order index cache rebuilds when a same-generation payload changes", () => {
  const cache = views.createRegionalMarketOrderIndexCache();
  const scope = { claimId: "100", generation: 7, allowedRegionIds: ["19"] };
  const firstSnapshot = {
    orders: [{ regionId: "19", itemType: "item", itemId: "30", side: "sell", price: "10" }],
  };
  const replacementSnapshot = {
    orders: [{ regionId: "19", itemType: "item", itemId: "30", side: "sell", price: "20" }],
  };

  const first = cache.get(firstSnapshot, scope);
  const replacement = cache.get(replacementSnapshot, scope);
  const catalog = views.regionalMarketCatalogView(replacementSnapshot, [
    { kind: "items", targetId: "30", name: "Item Thirty" },
  ], {
    ...scope,
    regionId: "19",
    orderIndex: replacement,
  });

  assert.notStrictEqual(replacement, first);
  assert.equal(catalog.items[0].lowestSellPrice, "20");
  assert.deepEqual(cache.cacheStats(), {
    entries: 1,
    builds: 2,
    hits: 0,
    maxEntries: 2,
  });
});

test("regional market order index preserves all-region equal-price location ties", () => {
  const cache = views.createRegionalMarketOrderIndexCache();
  const snapshot = {
    orders: [
      { regionId: "19", itemType: "item", itemId: "30", side: "sell", price: "20", claimName: "A expensive" },
      { regionId: "7", itemType: "item", itemId: "30", side: "sell", price: "10", claimName: "B first sell" },
      { regionId: "19", itemType: "item", itemId: "30", side: "sell", price: "10", claimName: "A later sell" },
      { regionId: "19", itemType: "item", itemId: "30", side: "buy", price: "10", claimName: "A cheap" },
      { regionId: "7", itemType: "item", itemId: "30", side: "buy", price: "20", claimName: "B first buy" },
      { regionId: "19", itemType: "item", itemId: "30", side: "buy", price: "20", claimName: "A later buy" },
    ],
  };
  const catalogRows = [{ kind: "items", targetId: "30", name: "Item Thirty" }];
  const scope = { claimId: "100", generation: 9, allowedRegionIds: ["7", "19"], regionId: "all" };

  const fallback = views.regionalMarketCatalogView(snapshot, catalogRows, scope);
  const indexed = views.regionalMarketCatalogView(snapshot, catalogRows, {
    ...scope,
    orderIndex: cache.get(snapshot, scope),
  });

  assert.deepEqual(indexed.items, fallback.items);
  assert.equal(indexed.items[0].lowestSellLocation, "B first sell");
  assert.equal(indexed.items[0].highestBuyLocation, "B first buy");
});

test("favorite quotes index one scoped generation once without colliding typed identities", () => {
  assert.equal(
    typeof views.regionalMarketFavoriteQuotesView,
    "function",
    "regional market favorite-quotes view must exist",
  );
  const orders = [{
    entityId: "1",
    side: "sell",
    regionId: "19",
    itemType: "item",
    itemId: "30",
    price: "9007199254740995",
  }, {
    entityId: "2",
    side: "sell",
    regionId: "19",
    itemType: "item",
    itemId: "30",
    price: "9007199254740993",
  }, {
    entityId: "3",
    side: "buy",
    regionId: "19",
    itemType: "item",
    itemId: "30",
    price: "9007199254740994",
  }, {
    entityId: "4",
    side: "sell",
    regionId: "19",
    itemType: "cargo",
    itemId: "30",
    price: "17",
  }, {
    entityId: "5",
    side: "buy",
    regionId: "19",
    itemType: "cargo",
    itemId: "30",
    price: "15",
  }, {
    entityId: "6",
    side: "buy",
    regionId: "7",
    itemType: "item",
    itemId: "30",
    price: "999999999999999999999",
  }];
  let orderReads = 0;
  const liveSnapshot = {
    get orders() {
      orderReads += 1;
      return orders;
    },
  };
  const favorites = [
    { itemType: "item", itemId: "30" },
    { itemType: "cargo", itemId: "30" },
    { itemType: "item", itemId: "9007199254740997" },
  ];
  const options = { generation: 123, regionId: "19", allowedRegionIds: ["7", "19"] };

  const first = views.regionalMarketFavoriteQuotesView(liveSnapshot, favorites, options);
  const second = views.regionalMarketFavoriteQuotesView(liveSnapshot, favorites, options);

  assert.deepEqual(first, {
    "item:30": { bestSell: "9007199254740993", bestBuy: "9007199254740994", sellCount: 2, buyCount: 1 },
    "cargo:30": { bestSell: "17", bestBuy: "15", sellCount: 1, buyCount: 1 },
    "item:9007199254740997": { bestSell: null, bestBuy: null, sellCount: 0, buyCount: 0 },
  });
  assert.deepEqual(second, first);
  assert.equal(orderReads, 1, "a cache hit must not scan the snapshot again");

  for (const favorite of favorites.slice(0, 2)) {
    const key = `${favorite.itemType}:${favorite.itemId}`;
    const book = views.regionalMarketOrderBookView(liveSnapshot, null, {
      ...options,
      ...favorite,
    });
    const sellPrices = book.sellOrders.map((order) => BigInt(order.price));
    const buyPrices = book.buyOrders.map((order) => BigInt(order.price));
    assert.deepEqual(first[key], {
      bestSell: sellPrices.length ? String(sellPrices.reduce((best, price) => price < best ? price : best)) : null,
      bestBuy: buyPrices.length ? String(buyPrices.reduce((best, price) => price > best ? price : best)) : null,
      sellCount: book.sellOrders.length,
      buyCount: book.buyOrders.length,
    }, `${key} must match the existing order-book projection`);
  }
});

test("favorite quote cache is bounded and oversized indexes are returned without retention", () => {
  assert.equal(typeof views.createRegionalMarketFavoriteQuotesView, "function");
  const favorite = [{ itemType: "item", itemId: "30" }];
  const bounded = views.createRegionalMarketFavoriteQuotesView({ maxEntries: 8, maxEstimatedBytes: 2 * 1024 * 1024 });
  for (let generation = 1; generation <= 9; generation += 1) {
    bounded({ orders: [] }, favorite, { generation, regionId: "all", allowedRegionIds: ["19"] });
  }
  assert.deepEqual(bounded.cacheStats(), {
    entries: 8,
    estimatedBytes: bounded.cacheStats().estimatedBytes,
    maxEntries: 8,
    maxEstimatedBytes: 2 * 1024 * 1024,
  });
  assert.ok(bounded.cacheStats().estimatedBytes <= 2 * 1024 * 1024);

  let oversizedReads = 0;
  const oversized = views.createRegionalMarketFavoriteQuotesView({ maxEntries: 8, maxEstimatedBytes: 2_500 });
  const oversizedPrice = "9".repeat(1_000);
  const oversizedSnapshot = {
    get orders() {
      oversizedReads += 1;
      return [{ side: "sell", regionId: "19", itemType: "item", itemId: "30", price: oversizedPrice }];
    },
  };
  assert.equal(oversized(oversizedSnapshot, favorite, { generation: 1, regionId: "19", allowedRegionIds: ["19"] })["item:30"].bestSell, oversizedPrice);
  assert.equal(oversized(oversizedSnapshot, favorite, { generation: 1, regionId: "19", allowedRegionIds: ["19"] })["item:30"].bestSell, oversizedPrice);
  assert.equal(oversizedReads, 2, "an oversized index must not be retained");
  assert.equal(oversized.cacheStats().entries, 0);
  assert.ok(oversized.cacheStats().estimatedBytes <= 2_500);
});

test("favorite quote cache evicts entries before its conservative aggregate byte budget is exceeded", () => {
  const project = views.createRegionalMarketFavoriteQuotesView({ maxEntries: 8, maxEstimatedBytes: 2_500 });
  let orderReads = 0;
  const liveSnapshot = {
    get orders() {
      orderReads += 1;
      return [];
    },
  };
  const favorite = [{ itemType: "item", itemId: "30" }];
  project(liveSnapshot, favorite, { generation: 1, regionId: "19", allowedRegionIds: ["19"] });
  project(liveSnapshot, favorite, { generation: 2, regionId: "19", allowedRegionIds: ["19"] });
  assert.equal(project.cacheStats().entries, 1);
  assert.ok(project.cacheStats().estimatedBytes <= 2_500);
  project(liveSnapshot, favorite, { generation: 1, regionId: "19", allowedRegionIds: ["19"] });
  assert.equal(orderReads, 3, "the first generation must have been evicted by the aggregate byte cap");
});

test("favorite metadata is projected from the current catalog outside the quote cache", () => {
  assert.equal(typeof views.regionalMarketFavoriteItemsView, "function");
  let catalogReads = 0;
  const getEntity = (key) => {
    catalogReads += 1;
    return key === "items:30" ? {
      kind: "items",
      targetId: "30",
      name: "Leather",
      tag: "Hide",
      tier: 3,
      rarity: "Rare",
      iconAssetName: "leather.webp",
    } : null;
  };
  const favorites = [{ itemType: "item", itemId: "30" }, { itemType: "cargo", itemId: "30" }];
  const first = views.regionalMarketFavoriteItemsView(favorites, { getEntity });
  const second = views.regionalMarketFavoriteItemsView(favorites, { getEntity });
  assert.equal(catalogReads, 4, "metadata must be read at request time rather than retained in the quote cache");
  assert.deepEqual(first["item:30"], {
    id: "30", itemId: "30", itemType: "item", name: "Leather", category: "Hide", tag: "Hide",
    tier: 3, rarity: "Rare", rarityStr: "Rare", iconAssetName: "leather.webp",
  });
  assert.deepEqual(second, first);
});

test("favorite quote cache rebuilds when generation or normalized region scope changes", () => {
  const project = views.createRegionalMarketFavoriteQuotesView();
  let orderReads = 0;
  const liveSnapshot = {
    get orders() {
      orderReads += 1;
      return [{ side: "sell", regionId: "19", itemType: "item", itemId: "30", price: "11" }];
    },
  };
  const favorite = [{ itemType: "item", itemId: "30" }];
  project(liveSnapshot, favorite, { generation: 1, regionId: "all", allowedRegionIds: ["19", "7"] });
  project(liveSnapshot, favorite, { generation: 1, regionId: "all", allowedRegionIds: ["7", "19"] });
  project(liveSnapshot, favorite, { generation: 2, regionId: "all", allowedRegionIds: ["7", "19"] });
  project(liveSnapshot, favorite, { generation: 2, regionId: "19", allowedRegionIds: ["7", "19"] });
  assert.equal(orderReads, 3, "equivalent scopes reuse while generation and selected-region changes rebuild");
});

test("regional market price quote derives exact live order statistics without sale history", () => {
  assert.equal(
    typeof views.regionalMarketPriceQuote,
    "function",
    "regional market live price quote must exist",
  );
  const result = views.regionalMarketPriceQuote({
    activeRegionIds: ["7", "19"],
    orders: [{
      entityId: "901",
      side: "sell",
      claimEntityId: "100",
      regionId: "19",
      ownerEntityId: "701",
      itemId: "43",
      itemType: "cargo",
      price: "9007199254740993",
      quantity: "2",
    }, {
      entityId: "902",
      side: "sell",
      claimEntityId: "101",
      regionId: "19",
      ownerEntityId: "702",
      itemId: "43",
      itemType: "cargo",
      price: "9007199254740994",
      quantity: "3",
    }, {
      entityId: "903",
      side: "buy",
      claimEntityId: "102",
      regionId: "19",
      ownerEntityId: "703",
      itemId: "43",
      itemType: "cargo",
      price: "9007199254740992",
      quantity: "4",
    }, {
      entityId: "904",
      side: "sell",
      claimEntityId: "103",
      regionId: "7",
      ownerEntityId: "704",
      itemId: "43",
      itemType: "cargo",
      price: "1",
      quantity: "99",
    }, {
      entityId: "905",
      side: "sell",
      claimEntityId: "104",
      regionId: "19",
      ownerEntityId: "705",
      itemId: "43",
      itemType: "item",
      price: "2",
      quantity: "88",
    }],
  }, {
    catalogKey: "cargo:43",
    kind: "cargo",
    targetId: "43",
    name: "Timber Package",
  }, {
    itemType: "cargo",
    itemId: "43",
    regionId: "19",
    allowedRegionIds: ["7", "19"],
  });

  assert.deepEqual(result, {
    item: {
      id: "43",
      itemId: "43",
      itemType: "cargo",
      name: "Timber Package",
      category: "",
      tag: "",
      tier: null,
      rarity: "",
      rarityStr: "",
      iconAssetName: null,
    },
    regionId: "19",
    sell: {
      orderCount: 2,
      totalQuantity: "5",
      lowestUnitPrice: "9007199254740993",
      medianUnitPrice: "9007199254740993.5",
    },
    buy: {
      orderCount: 1,
      totalQuantity: "4",
      highestUnitPrice: "9007199254740992",
    },
  });
});

test("regional market price history derives progressive daily buckets from confirmed local sales", () => {
  assert.equal(
    typeof views.regionalMarketPriceHistoryView,
    "function",
    "regional market price-history view must exist",
  );
  const result = views.regionalMarketPriceHistoryView([{
    tradeId: "relay_closed_listing:19:1",
    regionId: "19",
    claimEntityId: "100",
    itemId: "44",
    itemType: "item",
    quantity: "2",
    unitPrice: "10",
    totalPrice: "20",
    occurredAt: "2026-07-29T06:00:00.000Z",
  }, {
    tradeId: "relay_closed_listing:19:2",
    regionId: "19",
    claimEntityId: "100",
    itemId: "44",
    itemType: "item",
    quantity: "3",
    unitPrice: "20",
    totalPrice: "60",
    occurredAt: "2026-07-29T18:00:00.000Z",
  }, {
    tradeId: "relay_closed_listing:19:3",
    regionId: "19",
    claimEntityId: "101",
    itemId: "44",
    itemType: "item",
    quantity: "1",
    unitPrice: "30",
    totalPrice: "30",
    occurredAt: "2026-07-30T06:00:00.000Z",
  }, {
    tradeId: "relay_closed_listing:7:4",
    regionId: "7",
    claimEntityId: "102",
    itemId: "44",
    itemType: "item",
    quantity: "99",
    unitPrice: "999",
    totalPrice: "98901",
    occurredAt: "2026-07-30T06:00:00.000Z",
  }, {
    tradeId: "relay_closed_listing:19:5",
    regionId: "19",
    claimEntityId: "100",
    itemId: "44",
    itemType: "cargo",
    quantity: "99",
    unitPrice: "999",
    totalPrice: "98901",
    occurredAt: "2026-07-30T06:00:00.000Z",
  }], {
    itemId: "44",
    itemType: "item",
    regionId: "19",
    allowedRegionIds: ["7", "19"],
    range: "7d",
    now: () => Date.parse("2026-07-30T12:00:00.000Z"),
  });

  assert.equal(result.coverage, "locally-observed");
  assert.equal(result.observedSince, "2026-07-29T06:00:00.000Z");
  assert.deepEqual(result.priceData, [{
    bucket: "2026-07-29",
    quantity: "5",
    tradeCount: 2,
    totalValue: "80",
    vwap: "16",
    low: "10",
    high: "20",
  }, {
    bucket: "2026-07-30",
    quantity: "1",
    tradeCount: 1,
    totalValue: "30",
    vwap: "30",
    low: "30",
    high: "30",
  }]);
  assert.equal(result.priceStats.avg24h, "22.5");
  assert.equal(result.priceStats.avg7d, "18.333333");
  assert.equal(result.priceStats.avg30d, "18.333333");
  assert.equal(result.priceStats.allTimeHigh, "30");
  assert.equal(result.priceStats.allTimeLow, "10");
  assert.equal(result.priceStats.totalVolume, "6");
  assert.equal(result.priceStats.priceChange24h, "125");
  assert.deepEqual(
    result.recentTrades.map((trade) => trade.id),
    ["relay_closed_listing:19:3", "relay_closed_listing:19:2", "relay_closed_listing:19:1"],
  );
  assert.deepEqual(result.warnings, [
    "Price history contains only sales observed locally since 2026-07-29T06:00:00.000Z.",
  ]);
});

test("regional market price history reports collecting without inventing observations", () => {
  const result = views.regionalMarketPriceHistoryView([], {
    itemId: "44",
    itemType: "item",
    regionId: "19",
    allowedRegionIds: ["19"],
    range: "30d",
    now: () => Date.parse("2026-07-30T12:00:00.000Z"),
  });

  assert.equal(result.coverage, "collecting");
  assert.equal(result.observedSince, null);
  assert.deepEqual(result.priceData, []);
  assert.deepEqual(result.recentTrades, []);
  assert.deepEqual(result.warnings, [
    "No confirmed local sales have been observed for this selection yet.",
  ]);
});

test("regional market deals derive truthful live arbitrage without trade history", () => {
  const result = views.regionalMarketDealsView({
    activeRegionIds: ["7", "19"],
    orders: [{
      entityId: "801",
      side: "sell",
      claimEntityId: "100",
      claimName: "Low Market",
      regionId: "19",
      ownerEntityId: "701",
      itemId: "43",
      itemType: "cargo",
      price: "9007199254740993",
      quantity: "5",
      timestamp: "2026-07-30T12:00:00.000Z",
    }, {
      entityId: "802",
      side: "buy",
      claimEntityId: "101",
      claimName: "High Market",
      regionId: "7",
      ownerEntityId: "702",
      itemId: "43",
      itemType: "cargo",
      price: "9007199254741003",
      quantity: "3",
      timestamp: "2026-07-30T12:01:00.000Z",
    }],
  }, {
    allowedRegionIds: ["7", "19"],
    getEntity: (key) => key === "cargo:43"
      ? { name: "Timber Package", iconAssetName: "timber.png" }
      : null,
    limit: 50,
  });

  assert.deepEqual(result.deals, [{
    routeKey: "801:802",
    itemId: "43",
    itemType: "cargo",
    itemName: "Timber Package",
    itemIconAssetName: "timber.png",
    buyOrderId: "801",
    sellOrderId: "802",
    buyPrice: "9007199254740993",
    sellPrice: "9007199254741003",
    buyQuantity: "5",
    sellQuantity: "3",
    maxQuantity: "3",
    profit: "10",
    totalPotential: "30",
    profitPercent: 0,
    buyClaimId: "100",
    buyLocation: "Low Market",
    buyRegionId: "19",
    sellClaimId: "101",
    sellLocation: "High Market",
    sellRegionId: "7",
    buyCoordinates: null,
    sellCoordinates: null,
    distance: null,
  }]);
  assert.equal(result.coverage, "current-orders");
  assert.deepEqual(result.historyUnavailable, ["movers", "trade-volume", "completed-sales"]);
});

test("regional market deals calculate bounded same-region route distance", () => {
  const result = views.regionalMarketDealsView({
    activeRegionIds: ["19"],
    orders: [{
      entityId: "901",
      side: "sell",
      claimEntityId: "100",
      claimName: "Low Market",
      regionId: "19",
      ownerEntityId: "701",
      itemId: "44",
      itemType: "item",
      price: "10",
      quantity: "5",
      locationX: -10,
      locationZ: 20,
      dimension: "19",
    }, {
      entityId: "902",
      side: "buy",
      claimEntityId: "101",
      claimName: "High Market",
      regionId: "19",
      ownerEntityId: "702",
      itemId: "44",
      itemType: "item",
      price: "15",
      quantity: "3",
      locationX: 15,
      locationZ: 45,
      dimension: "19",
    }],
  }, {
    allowedRegionIds: ["19"],
    getEntity: () => ({ name: "Iron Nail" }),
  });

  assert.equal(result.deals[0].distance, 50);
  assert.deepEqual(result.deals[0].buyCoordinates, {
    locationX: -10,
    locationZ: 20,
    dimension: "19",
  });
  assert.deepEqual(result.deals[0].sellCoordinates, {
    locationX: 15,
    locationZ: 45,
    dimension: "19",
  });
});

test("regional market overview derives liquidity, hubs, and open-order activity", () => {
  const result = views.regionalMarketOverviewView({
    activeRegionIds: ["19"],
    orders: [{
      entityId: "801",
      side: "sell",
      claimEntityId: "100",
      claimName: "Timbersteel Trade",
      regionId: "19",
      ownerEntityId: "701",
      ownerUsername: "Seller",
      itemId: "44",
      itemType: "item",
      price: "12",
      quantity: "4",
      timestamp: "2026-07-30T12:00:00.000Z",
    }, {
      entityId: "802",
      side: "buy",
      claimEntityId: "100",
      claimName: "Timbersteel Trade",
      regionId: "19",
      ownerEntityId: "702",
      ownerUsername: "Buyer",
      itemId: "44",
      itemType: "item",
      price: "15",
      quantity: "2",
      timestamp: "2026-07-30T12:01:00.000Z",
    }],
  }, {
    regionId: "19",
    allowedRegionIds: ["19"],
    getEntity: () => ({ name: "Leather Strap", iconAssetName: "leather.png" }),
  });

  assert.equal(result.topDeals.length, 1);
  assert.deepEqual(result.mostLiquid, [{
    itemId: "44",
    itemType: "item",
    itemName: "Leather Strap",
    iconAssetName: "leather.png",
    orderCount: 2,
    offeredQuantity: "4",
    wantedQuantity: "2",
    currentNotional: "78",
  }]);
  assert.deepEqual(result.hubs, [{
    claimId: "100",
    claimName: "Timbersteel Trade",
    regionId: "19",
    regionName: "R19",
    orderCount: 2,
    sellerCount: 1,
    buyerCount: 1,
  }]);
  assert.deepEqual(result.recentActivity.map((row) => row.id), ["802", "801"]);
  assert.deepEqual(result.movers, []);
  assert.equal(result.moverBaseline, "collecting");
});

test("regional market overview derives movers only from locally confirmed sales", () => {
  const result = views.regionalMarketOverviewView({
    activeRegionIds: ["19"],
    orders: [],
  }, {
    regionId: "19",
    allowedRegionIds: ["19"],
    now: () => Date.parse("2026-07-30T12:00:00.000Z"),
    getEntity: () => ({ name: "Leather Strap", iconAssetName: "leather.png" }),
    observedTrades: [{
      tradeId: "relay_closed_listing:19:1",
      regionId: "19",
      claimEntityId: "100",
      itemId: "44",
      itemType: "item",
      quantity: "2",
      unitPrice: "10",
      totalPrice: "20",
      occurredAt: "2026-07-29T00:00:00.000Z",
    }, {
      tradeId: "relay_closed_listing:19:2",
      regionId: "19",
      claimEntityId: "100",
      itemId: "44",
      itemType: "item",
      quantity: "3",
      unitPrice: "15",
      totalPrice: "45",
      occurredAt: "2026-07-30T06:00:00.000Z",
    }],
  });

  assert.deepEqual(result.movers, [{
    itemId: "44",
    itemType: "item",
    itemName: "Leather Strap",
    itemIconAssetName: "leather.png",
    previousAverage: "10",
    currentAverage: "15",
    changePercent: 50,
    salesCount: 2,
    unitsSold: "5",
  }]);
  assert.equal(result.moverBaseline, "locally-observed-24h");
  assert.equal(result.observedSince, "2026-07-29T00:00:00.000Z");
  assert.equal(result.confirmedSales, 2);
});

test("regional market overview calculates mover changes from exact weighted ratios", () => {
  const result = views.regionalMarketOverviewView({
    activeRegionIds: ["19"],
    orders: [],
  }, {
    regionId: "19",
    allowedRegionIds: ["19"],
    now: () => Date.parse("2026-07-30T12:00:00.000Z"),
    getEntity: () => ({ name: "Leather Strap" }),
    observedTrades: [{
      tradeId: "relay_closed_listing:19:previous",
      regionId: "19",
      itemId: "44",
      itemType: "item",
      quantity: "10",
      unitPrice: "1",
      totalPrice: "19",
      occurredAt: "2026-07-29T00:00:00.000Z",
    }, {
      tradeId: "relay_closed_listing:19:current",
      regionId: "19",
      itemId: "44",
      itemType: "item",
      quantity: "10",
      unitPrice: "2",
      totalPrice: "20",
      occurredAt: "2026-07-30T06:00:00.000Z",
    }],
  });

  assert.equal(result.movers[0].previousAverage, "1.9");
  assert.equal(result.movers[0].currentAverage, "2");
  assert.equal(result.movers[0].changePercent, 5.26);
});

test("regional market overview keeps the mover baseline collecting until both windows have sales", () => {
  const result = views.regionalMarketOverviewView({
    activeRegionIds: ["19"],
    orders: [],
  }, {
    regionId: "19",
    allowedRegionIds: ["19"],
    now: () => Date.parse("2026-07-30T12:00:00.000Z"),
    getEntity: () => ({ name: "Leather Strap" }),
    observedTrades: [{
      tradeId: "relay_closed_listing:19:historic",
      regionId: "19",
      claimEntityId: "100",
      itemId: "44",
      itemType: "item",
      quantity: "2",
      unitPrice: "10",
      totalPrice: "20",
      occurredAt: "2026-07-01T00:00:00.000Z",
    }],
  });

  assert.deepEqual(result.movers, []);
  assert.equal(result.moverBaseline, "collecting");
  assert.equal(result.observedSince, "2026-07-01T00:00:00.000Z");
  assert.equal(result.confirmedSales, 1);
});

test("regional market stalls view scopes, enriches, searches, and pages the live generation", () => {
  assert.equal(
    typeof views.regionalMarketStallsView,
    "function",
    "regional market stalls view must exist",
  );
  const result = views.regionalMarketStallsView({
    activeRegionIds: ["7", "19"],
    stalls: [{
      entityId: "9007199254740993",
      regionId: "19",
      claimEntityId: "100",
      claimName: "Timbersteel Trade",
      ownerEntityId: "701",
      ownerName: "Stall Keeper",
      nickname: "Exact Exchange",
      locationX: -123,
      locationZ: 456,
      orders: [{
        entityId: "9007199254740995",
        remainingStock: "2147483647",
        offers: [{ itemId: "44", itemType: "item", quantity: "2" }],
        requires: [{ itemId: "43", itemType: "cargo", quantity: "9007199254740993" }],
      }, {
        entityId: "9007199254740996",
        remainingStock: "0",
        offers: [{ itemId: "45", itemType: "item", quantity: "1" }],
        requires: [],
      }],
    }, {
      entityId: "800",
      regionId: "7",
      claimEntityId: "101",
      claimName: "Outside Scope",
      ownerEntityId: "702",
      ownerName: "Other Keeper",
      nickname: "",
      orders: [],
    }],
  }, {
    regionId: "19",
    allowedRegionIds: ["7", "19"],
    query: "timber package",
    activeOnly: true,
    page: 1,
    pageSize: 20,
    getEntity: (key) => ({
      "items:44": { name: "Timber Package", iconAssetName: "timber.png" },
      "cargo:43": { name: "Heavy Cargo", iconAssetName: "cargo.png" },
    })[key] ?? null,
  });

  assert.equal(result.totalStalls, 1);
  assert.equal(result.totalOrders, 1);
  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.deepEqual(result.stalls[0].orders, [{
    entityId: "9007199254740995",
    remainingStock: "2147483647",
    offers: [{
      itemId: "44",
      itemType: "item",
      quantity: "2",
      itemName: "Timber Package",
      iconAssetName: "timber.png",
    }],
    requires: [{
      itemId: "43",
      itemType: "cargo",
      quantity: "9007199254740993",
      itemName: "Heavy Cargo",
      iconAssetName: "cargo.png",
    }],
  }]);
});
