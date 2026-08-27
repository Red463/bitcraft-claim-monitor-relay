import assert from "node:assert/strict";
import test from "node:test";

import {
  availabilityFlags,
  marketChartPoints,
  marketDetailLoadingState,
  marketDetailRequestPlan,
  marketRequestCanCommit,
  marketSuggestionResults,
  nextOptionIndex,
  nextTabIndex,
} from "../src/pages/market/marketUi.ts";

test("catalog refresh does not reopen suggestions after an item is selected", () => {
  const items = [
    { id: "1", name: "Simple Plank" },
    { id: "2", name: "Simple Plank Output" },
  ];

  assert.deepEqual(marketSuggestionResults(items, "simple plank", false), []);
  assert.deepEqual(marketSuggestionResults(items, "simple plank", true), items);
});

test("market detail selection clears previous order and history responses before loading", () => {
  assert.deepEqual(marketDetailLoadingState(), {
    loading: true,
    error: "",
    historyError: "",
    detail: null,
    history: null,
  });
  assert.deepEqual(marketDetailLoadingState(false), {
    loading: false,
    error: "",
    historyError: "",
    detail: null,
    history: null,
  });
});

test("market price history waits for the Stats detail tab", () => {
  assert.deepEqual(marketDetailRequestPlan(false, "orders"), { orderBook: false, priceHistory: false });
  assert.deepEqual(marketDetailRequestPlan(true, "orders"), { orderBook: true, priceHistory: false });
  assert.deepEqual(marketDetailRequestPlan(true, "stats"), { orderBook: true, priceHistory: true });
});

test("market requests cannot commit after their scope changes or they are aborted", () => {
  assert.equal(marketRequestCanCommit("item:30|19", "item:30|19", false), true);
  assert.equal(marketRequestCanCommit("item:30|19", "item:31|19", false), false);
  assert.equal(marketRequestCanCommit("item:30|19", "item:30|19", true), false);
});

test("market availability modes map to the existing catalog contract", () => {
  assert.deepEqual(availabilityFlags("any"), { availableOnly: false, hasSell: false, hasBuy: false });
  assert.deepEqual(availabilityFlags("sell"), { availableOnly: true, hasSell: true, hasBuy: false });
  assert.deepEqual(availabilityFlags("buy"), { availableOnly: true, hasSell: false, hasBuy: true });
  assert.deepEqual(availabilityFlags("both"), { availableOnly: true, hasSell: true, hasBuy: true });
});

test("market tab navigation wraps and supports boundary keys", () => {
  assert.equal(nextTabIndex(0, 3, "ArrowLeft"), 2);
  assert.equal(nextTabIndex(2, 3, "ArrowRight"), 0);
  assert.equal(nextTabIndex(1, 3, "Home"), 0);
  assert.equal(nextTabIndex(1, 3, "End"), 2);
});

test("market chart points stay bounded and place higher prices above lower prices", () => {
  assert.deepEqual(marketChartPoints([], 100, 50), []);

  const rising = marketChartPoints([
    { price: 10, bucket: "2026-08-01" },
    { price: 20, bucket: "2026-08-02" },
  ], 100, 50);
  assert.deepEqual(rising.map(({ x }) => x), [0, 100]);
  assert.ok(rising[1].y < rising[0].y);
  assert.deepEqual(rising.map(({ price }) => price), ["10", "20"]);
  assert.deepEqual(rising.map(({ label }) => label), ["2026-08-01", "2026-08-02"]);
  assert.ok(rising.every(({ y }) => y >= 0 && y <= 50));

  const constant = marketChartPoints([{ vwap: 7 }, { avgPrice: 7 }], 80, 40);
  assert.deepEqual(constant.map(({ y }) => y), [20, 20]);

  const exact = marketChartPoints([
    { price: "90071992547409930" },
    { price: "90071992547409931" },
  ], 100, 50);
  assert.deepEqual(exact.map(({ price }) => price), ["90071992547409930", "90071992547409931"]);
  assert.deepEqual(exact.map(({ y }) => y), [50, 0]);
});

test("market suggestion navigation wraps and supports boundary keys", () => {
  assert.equal(nextOptionIndex(0, 4, "ArrowUp"), 3);
  assert.equal(nextOptionIndex(3, 4, "ArrowDown"), 0);
  assert.equal(nextOptionIndex(2, 4, "Home"), 0);
  assert.equal(nextOptionIndex(1, 4, "End"), 3);
  assert.equal(nextOptionIndex(-1, 4, "ArrowDown"), 0);
  assert.equal(nextOptionIndex(-1, 0, "ArrowDown"), -1);
});
