import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer as createViteServer } from "vite";

import { React, installDom } from "./react-dom-test-harness.mjs";

const appRoot = fileURLToPath(new URL("..", import.meta.url));

function findElement(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  if (predicate(node)) return node;
  return findElement(node.props.children, predicate);
}

function elementText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(elementText).join("");
  return React.isValidElement(node) ? elementText(node.props.children) : "";
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function flushAsyncWork(count = 2) {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { callback, at: now + Number(delay) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.callback();
      }
      now = target;
    },
  };
}

function dependenciesChanged(previous, next) {
  if (!previous || !next || previous.length !== next.length) return true;
  return next.some((value, index) => !Object.is(value, previous[index]));
}

function installHookHarness(refreshContext) {
  const originals = Object.fromEntries([
    "useContext", "useEffect", "useMemo", "useRef", "useState",
  ].map((key) => [key, React[key]]));
  const hooks = [];
  let cursor = 0;
  let effects = [];
  React.useContext = () => refreshContext;
  React.useEffect = (effect, dependencies) => {
    const index = cursor++;
    if (!hooks[index] || dependenciesChanged(hooks[index].dependencies, dependencies)) {
      hooks[index]?.cleanup?.();
      hooks[index] = { dependencies, cleanup: null };
      effects.push({ effect, index });
    }
  };
  React.useMemo = (calculate, dependencies) => {
    const index = cursor++;
    if (!hooks[index] || dependenciesChanged(hooks[index].dependencies, dependencies)) hooks[index] = { value: calculate(), dependencies };
    return hooks[index].value;
  };
  React.useRef = (initial) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = { value: { current: initial } };
    return hooks[index].value;
  };
  React.useState = (initial) => {
    const index = cursor++;
    if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
    return [hooks[index].value, (update) => {
      hooks[index].value = typeof update === "function" ? update(hooks[index].value) : update;
    }];
  };
  return {
    async render(Component, props) {
      cursor = 0;
      effects = [];
      const tree = Component(props);
      for (const { effect, index } of effects) hooks[index].cleanup = effect() ?? null;
      await new Promise((resolve) => setImmediate(resolve));
      return tree;
    },
    restore() {
      for (const hook of hooks) hook?.cleanup?.();
      Object.assign(React, originals);
    },
  };
}

test("Buy Order Finder waits for typing to settle before fetching", async () => {
  const dom = installDom("http://localhost/?page=market&tab=opportunities");
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const requests = [];
  const response = (total) => new Response(JSON.stringify({ rows: [], opportunities: [], warnings: [], total, pageCount: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  let vite = null;
  let harness = null;
  try {
    globalThis.fetch = (input) => new Promise((resolve) => requests.push({ url: String(input), resolve }));
    vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
    const { BuyOrderFinder } = await vite.ssrLoadModule("/src/pages/market/BuyOrderFinder.tsx");
    const clock = createFakeClock();
    globalThis.setTimeout = clock.setTimeout;
    globalThis.clearTimeout = clock.clearTimeout;
    harness = installHookHarness({ cycle: null, request: null, trackPromise: (_taskKey, promise) => promise });
    const props = {
      claimId: "55",
      regionId: "19",
      locationSearch: dom.window.location.search,
      onQueryStateChange() {},
      refreshSequence: 0,
      refreshHeaders: {},
      trackRefresh: (_taskKey, promise) => promise,
    };

    let tree = await harness.render(BuyOrderFinder, props);
    const baselineRequests = requests.length;
    const input = findElement(tree, (element) => element.type === "input" && element.props.placeholder === "Item, buyer, settlement, rarity…");
    assert.ok(input);

    input.props.onChange({ target: { value: "plank" } });
    tree = await harness.render(BuyOrderFinder, props);
    const updatedInput = findElement(tree, (element) => element.type === "input" && element.props.placeholder === "Item, buyer, settlement, rarity…");
    assert.equal(updatedInput.props.value, "plank", "the input remains immediately controlled");

    clock.advance(239);
    assert.equal(requests.length, baselineRequests, "typing must not start a request inside the debounce window");
    clock.advance(1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, baselineRequests + 1, "only the settled search starts a request");
    assert.match(requests.at(-1).url, /search=plank/);

    const settledInput = findElement(tree, (element) => element.type === "input" && element.props.placeholder === "Item, buyer, settlement, rarity…");
    settledInput.props.onChange({ target: { value: "planks" } });
    tree = await harness.render(BuyOrderFinder, props);
    requests[0].resolve(response(999));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(BuyOrderFinder, props);
    assert.doesNotMatch(elementText(tree), /999 live buy orders/, "an obsolete response cannot replace the newer search state");

    clock.advance(240);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, baselineRequests + 2);
    assert.match(requests.at(-1).url, /search=planks/);
    requests[1].resolve(response(1));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(BuyOrderFinder, props);
    assert.match(elementText(tree), /1 live buy orders/);
  } finally {
    harness?.restore();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.fetch = originalFetch;
    await vite?.close();
    dom.restore();
  }
});

test("Market Browse loads price history only on Stats and keeps its empty state hidden while pending", async () => {
  const dom = installDom("http://localhost/?page=market&tab=browse&item=30&itemName=Leather&itemType=0");
  const originalFetch = globalThis.fetch;
  const requests = [];
  let vite = null;
  let harness = null;
  try {
    globalThis.fetch = (input, options = {}) => new Promise((resolve) => requests.push({
      url: String(input),
      signal: options.signal,
      resolve,
    }));
    vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
    const { MarketBrowse } = await vite.ssrLoadModule("/src/pages/market/MarketBrowse.tsx");
    harness = installHookHarness({ cycle: null, request: null, trackPromise: (_taskKey, promise) => promise });
    const props = {
      claimId: "55",
      mode: "browse",
      regionId: "19",
      favorites: [],
      onToggleFavorite() {},
      canWatch: false,
      onWatchItem() {},
      onShowMap() {},
      locationSearch: dom.window.location.search,
      onQueryStateChange() {},
      refreshSequence: 0,
      refreshHeaders: {},
      trackRefresh: (_taskKey, promise) => promise,
    };

    let tree = await harness.render(MarketBrowse, props);
    assert.equal(requests.filter(({ url }) => url.includes("/price-history?")).length, 0, "Orders must not request price history");

    const orderBook = requests.find(({ url }) => url.includes("/order-book?"));
    assert.ok(orderBook);
    orderBook.resolve(new Response(JSON.stringify({
      item: { id: "30", itemId: "30", itemType: "item", name: "Leather" },
      sellOrders: [],
      buyOrders: [],
      freshness: "fresh",
      ageMs: 0,
      warnings: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(MarketBrowse, props);

    const statsTab = findElement(tree, (element) => element.type === "button" && elementText(element) === "Stats");
    assert.ok(statsTab);
    statsTab.props.onClick();
    tree = await harness.render(MarketBrowse, props);
    assert.match(elementText(tree), /Loading price history…/, "the transition render must not expose empty history before its effect starts");
    assert.doesNotMatch(elementText(tree), /No recent trades were returned/);
    const historyRequests = requests.filter(({ url }) => url.includes("/price-history?"));
    assert.equal(historyRequests.length, 1, "Stats starts one price-history request");
    assert.match(historyRequests[0].url, /itemType=item/);
    assert.match(historyRequests[0].url, /itemId=30/);
    assert.match(historyRequests[0].url, /range=30d/);

    tree = await harness.render(MarketBrowse, props);
    assert.match(elementText(tree), /Loading price history…/);
    assert.doesNotMatch(elementText(tree), /No recent trades were returned/);

    historyRequests[0].resolve(new Response(JSON.stringify({
      coverage: "collecting",
      observedSince: null,
      priceStats: {},
      priceData: [],
      recentTrades: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    tree = await harness.render(MarketBrowse, props);
    assert.doesNotMatch(elementText(tree), /Loading price history…/);
    assert.match(elementText(tree), /No recent trades were returned/);
  } finally {
    harness?.restore();
    globalThis.fetch = originalFetch;
    await vite?.close();
    dom.restore();
  }
});

test("Market Browse hides committed history immediately when its request scope changes", async () => {
  const dom = installDom("http://localhost/?page=market&tab=browse&item=30&itemName=Leather&itemType=0");
  const originalFetch = globalThis.fetch;
  const requests = [];
  let vite = null;
  let harness = null;
  try {
    globalThis.fetch = (input, options = {}) => new Promise((resolve) => requests.push({
      url: String(input),
      signal: options.signal,
      resolve,
    }));
    vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
    const { MarketBrowse } = await vite.ssrLoadModule("/src/pages/market/MarketBrowse.tsx");
    harness = installHookHarness({ cycle: null, request: null, trackPromise: (_taskKey, promise) => promise });
    const baseProps = {
      claimId: "55",
      mode: "browse",
      favorites: [],
      onToggleFavorite() {},
      canWatch: false,
      onWatchItem() {},
      onShowMap() {},
      locationSearch: dom.window.location.search,
      onQueryStateChange() {},
      refreshSequence: 0,
      refreshHeaders: {},
      trackRefresh: (_taskKey, promise) => promise,
    };

    let tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "19" });
    const statsTab = findElement(tree, (element) => element.type === "button" && elementText(element) === "Stats");
    assert.ok(statsTab);
    statsTab.props.onClick();
    await harness.render(MarketBrowse, { ...baseProps, regionId: "19" });
    const region19History = requests.find(({ url }) => url.includes("/price-history?") && url.includes("regionId=19"));
    assert.ok(region19History);
    region19History.resolve(jsonResponse({
      priceStats: {},
      priceData: [],
      recentTrades: [{
        id: "committed-region",
        quantity: "1",
        unitPrice: "1",
        regionName: "COMMITTED_REGION19_HISTORY_MARKER",
        createdAt: "2026-08-27T12:00:00Z",
      }],
    }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "19" });
    assert.match(elementText(tree), /COMMITTED_REGION19_HISTORY_MARKER/);

    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    assert.match(elementText(tree), /Loading price history…/, "the transition render must be pending for the new region");
    assert.doesNotMatch(elementText(tree), /COMMITTED_REGION19_HISTORY_MARKER/);
  } finally {
    harness?.restore();
    globalThis.fetch = originalFetch;
    await vite?.close();
    dom.restore();
  }
});

test("Market Browse ignores catalog results from a previous region", async () => {
  const dom = installDom("http://localhost/?page=market&tab=browse");
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const requests = [];
  let vite = null;
  let harness = null;
  try {
    globalThis.fetch = (input, options = {}) => new Promise((resolve) => requests.push({
      url: String(input),
      signal: options.signal,
      resolve,
    }));
    vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
    const { MarketBrowse } = await vite.ssrLoadModule("/src/pages/market/MarketBrowse.tsx");
    const clock = createFakeClock();
    globalThis.setTimeout = clock.setTimeout;
    globalThis.clearTimeout = clock.clearTimeout;
    harness = installHookHarness({ cycle: null, request: null, trackPromise: (_taskKey, promise) => promise });
    const baseProps = {
      claimId: "55",
      mode: "browse",
      favorites: [],
      onToggleFavorite() {},
      canWatch: false,
      onWatchItem() {},
      onShowMap() {},
      locationSearch: dom.window.location.search,
      onQueryStateChange() {},
      refreshSequence: 0,
      refreshHeaders: {},
      trackRefresh: (_taskKey, promise) => promise,
    };

    await harness.render(MarketBrowse, { ...baseProps, regionId: "19" });
    clock.advance(220);
    await flushAsyncWork(1);
    const region19Catalog = requests.find(({ url }) => url.includes("/market/catalog?") && url.includes("regionId=19"));
    assert.ok(region19Catalog);

    await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    clock.advance(220);
    await flushAsyncWork(1);
    const region22Catalog = requests.find(({ url }) => url.includes("/market/catalog?") && url.includes("regionId=22"));
    assert.ok(region22Catalog);

    region19Catalog.resolve(jsonResponse({ items: [{ id: "30", itemType: "item", name: "OBSOLETE_CATALOG_MARKER" }], categories: [] }));
    await flushAsyncWork();
    let tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    assert.doesNotMatch(elementText(tree), /OBSOLETE_CATALOG_MARKER/);

    region22Catalog.resolve(jsonResponse({ items: [{ id: "31", itemType: "item", name: "CURRENT_CATALOG_MARKER" }], categories: [] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    assert.match(elementText(tree), /CURRENT_CATALOG_MARKER/);
  } finally {
    harness?.restore();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.fetch = originalFetch;
    await vite?.close();
    dom.restore();
  }
});

test("Market Browse keeps item and cargo order-book and history responses scoped to the selected identity", async () => {
  const dom = installDom("http://localhost/?page=market&tab=browse&item=30&itemName=Simple%20Plank&itemType=0");
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const requests = [];
  let vite = null;
  let harness = null;
  try {
    globalThis.fetch = (input, options = {}) => new Promise((resolve) => requests.push({
      url: String(input),
      signal: options.signal,
      resolve,
    }));
    vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
    const { MarketBrowse } = await vite.ssrLoadModule("/src/pages/market/MarketBrowse.tsx");
    const clock = createFakeClock();
    globalThis.setTimeout = clock.setTimeout;
    globalThis.clearTimeout = clock.clearTimeout;
    harness = installHookHarness({ cycle: null, request: null, trackPromise: (_taskKey, promise) => promise });
    const props = {
      claimId: "55",
      mode: "browse",
      regionId: "19",
      favorites: [],
      onToggleFavorite() {},
      canWatch: false,
      onWatchItem() {},
      onShowMap() {},
      locationSearch: dom.window.location.search,
      onQueryStateChange() {},
      refreshSequence: 0,
      refreshHeaders: {},
      trackRefresh: (_taskKey, promise) => promise,
    };

    await harness.render(MarketBrowse, props);
    const item30OrderBook = requests.find(({ url }) => url.includes("/order-book?") && url.includes("itemType=item") && url.includes("itemId=30"));
    assert.ok(item30OrderBook);
    clock.advance(220);
    await flushAsyncWork(1);
    const catalog = requests.find(({ url }) => url.includes("/market/catalog?"));
    assert.ok(catalog);
    catalog.resolve(jsonResponse({
      items: [
        { id: "30", itemType: "item", name: "Simple Plank" },
        { id: "31", itemType: "item", name: "Pine Board" },
        { id: "31", itemType: "cargo", name: "Cargo Board" },
      ],
      categories: [],
    }));
    await flushAsyncWork();
    let tree = await harness.render(MarketBrowse, props);

    const item31Button = findElement(tree, (element) => element.type === "button" && element.props.className?.includes("market-catalog-result") && elementText(element).includes("Pine Board"));
    assert.ok(item31Button);
    item31Button.props.onClick();
    tree = await harness.render(MarketBrowse, props);
    const item31OrderBook = requests.find(({ url }) => url.includes("/order-book?") && url.includes("itemType=item") && url.includes("itemId=31"));
    assert.ok(item31OrderBook);
    item30OrderBook.resolve(jsonResponse({ item: { id: "30", itemType: "item", name: "Simple Plank", category: "OBSOLETE_ITEM_ID_MARKER" }, sellOrders: [], buyOrders: [] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, props);
    assert.doesNotMatch(elementText(tree), /OBSOLETE_ITEM_ID_MARKER/);

    const cargo31Button = findElement(tree, (element) => element.type === "button" && element.props.className?.includes("market-catalog-result") && elementText(element).includes("Cargo Board"));
    assert.ok(cargo31Button);
    cargo31Button.props.onClick();
    tree = await harness.render(MarketBrowse, props);
    const cargo31OrderBook = requests.find(({ url }) => url.includes("/order-book?") && url.includes("itemType=cargo") && url.includes("itemId=31"));
    assert.ok(cargo31OrderBook);
    item31OrderBook.resolve(jsonResponse({ item: { id: "31", itemType: "item", name: "Pine Board", category: "OBSOLETE_ITEM_TYPE_MARKER" }, sellOrders: [], buyOrders: [] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, props);
    assert.doesNotMatch(elementText(tree), /OBSOLETE_ITEM_TYPE_MARKER/);

    cargo31OrderBook.resolve(jsonResponse({ item: { id: "31", itemType: "cargo", name: "Cargo Board", category: "CURRENT_TYPED_ITEM_MARKER" }, sellOrders: [], buyOrders: [] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, props);
    assert.match(elementText(tree), /CURRENT_TYPED_ITEM_MARKER/);

    const statsTab = findElement(tree, (element) => element.type === "button" && elementText(element) === "Stats");
    assert.ok(statsTab);
    statsTab.props.onClick();
    tree = await harness.render(MarketBrowse, props);
    const cargo31History = requests.find(({ url }) => url.includes("/price-history?") && url.includes("itemType=cargo") && url.includes("itemId=31"));
    assert.ok(cargo31History);

    item31Button.props.onClick();
    tree = await harness.render(MarketBrowse, props);
    const item31History = requests.find(({ url }) => url.includes("/price-history?") && url.includes("itemType=item") && url.includes("itemId=31"));
    assert.ok(item31History);
    cargo31History.resolve(jsonResponse({ priceStats: {}, priceData: [], recentTrades: [{ id: "old-type", quantity: "1", unitPrice: "1", regionName: "OBSOLETE_CARGO_HISTORY_MARKER", createdAt: "2026-08-27T12:00:00Z" }] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, props);
    assert.doesNotMatch(elementText(tree), /OBSOLETE_CARGO_HISTORY_MARKER/);

    item31History.resolve(jsonResponse({ priceStats: {}, priceData: [], recentTrades: [{ id: "current-type", quantity: "1", unitPrice: "1", regionName: "CURRENT_ITEM_HISTORY_MARKER", createdAt: "2026-08-27T12:00:00Z" }] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, props);
    assert.match(elementText(tree), /CURRENT_ITEM_HISTORY_MARKER/);
  } finally {
    harness?.restore();
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.fetch = originalFetch;
    await vite?.close();
    dom.restore();
  }
});

test("Market Browse ignores order and history responses from previous regions and ranges", async () => {
  const dom = installDom("http://localhost/?page=market&tab=browse&item=30&itemName=Leather&itemType=0");
  const originalFetch = globalThis.fetch;
  const requests = [];
  let vite = null;
  let harness = null;
  try {
    globalThis.fetch = (input, options = {}) => new Promise((resolve) => requests.push({
      url: String(input),
      signal: options.signal,
      resolve,
    }));
    vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
    const { MarketBrowse } = await vite.ssrLoadModule("/src/pages/market/MarketBrowse.tsx");
    harness = installHookHarness({ cycle: null, request: null, trackPromise: (_taskKey, promise) => promise });
    const baseProps = {
      claimId: "55",
      mode: "browse",
      favorites: [],
      onToggleFavorite() {},
      canWatch: false,
      onWatchItem() {},
      onShowMap() {},
      locationSearch: dom.window.location.search,
      onQueryStateChange() {},
      refreshSequence: 0,
      refreshHeaders: {},
      trackRefresh: (_taskKey, promise) => promise,
    };

    let tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "19" });
    const region19Order = requests.find(({ url }) => url.includes("/order-book?") && url.includes("regionId=19"));
    assert.ok(region19Order);
    const statsTab = findElement(tree, (element) => element.type === "button" && elementText(element) === "Stats");
    assert.ok(statsTab);
    statsTab.props.onClick();
    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "19" });
    const region19History = requests.find(({ url }) => url.includes("/price-history?") && url.includes("regionId=19") && url.includes("range=30d"));
    assert.ok(region19History);

    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    const region22Order = requests.find(({ url }) => url.includes("/order-book?") && url.includes("regionId=22"));
    const region22History30d = requests.find(({ url }) => url.includes("/price-history?") && url.includes("regionId=22") && url.includes("range=30d"));
    assert.ok(region22Order);
    assert.ok(region22History30d);

    region19Order.resolve(jsonResponse({ item: { id: "30", itemType: "item", name: "Leather", category: "OBSOLETE_REGION_ORDER_MARKER" }, sellOrders: [], buyOrders: [] }));
    region19History.resolve(jsonResponse({ priceStats: {}, priceData: [], recentTrades: [{ id: "old-region", quantity: "1", unitPrice: "1", regionName: "OBSOLETE_REGION_HISTORY_MARKER", createdAt: "2026-08-27T12:00:00Z" }] }));
    await flushAsyncWork(3);
    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    assert.doesNotMatch(elementText(tree), /OBSOLETE_REGION_ORDER_MARKER|OBSOLETE_REGION_HISTORY_MARKER/);

    region22Order.resolve(jsonResponse({ item: { id: "30", itemType: "item", name: "Leather", category: "CURRENT_REGION_ORDER_MARKER" }, sellOrders: [], buyOrders: [] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    assert.match(elementText(tree), /CURRENT_REGION_ORDER_MARKER/);

    const sevenDayTab = findElement(tree, (element) => element.type === "button" && elementText(element) === "7d");
    assert.ok(sevenDayTab);
    sevenDayTab.props.onClick();
    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    const region22History7d = requests.find(({ url }) => url.includes("/price-history?") && url.includes("regionId=22") && url.includes("range=7d"));
    assert.ok(region22History7d);

    region22History30d.resolve(jsonResponse({ priceStats: {}, priceData: [], recentTrades: [{ id: "old-range", quantity: "1", unitPrice: "1", regionName: "OBSOLETE_RANGE_MARKER", createdAt: "2026-08-27T12:00:00Z" }] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    assert.doesNotMatch(elementText(tree), /OBSOLETE_RANGE_MARKER/);

    region22History7d.resolve(jsonResponse({ priceStats: {}, priceData: [], recentTrades: [{ id: "current-range", quantity: "1", unitPrice: "1", regionName: "CURRENT_RANGE_MARKER", createdAt: "2026-08-27T12:00:00Z" }] }));
    await flushAsyncWork();
    tree = await harness.render(MarketBrowse, { ...baseProps, regionId: "22" });
    assert.match(elementText(tree), /CURRENT_RANGE_MARKER/);
  } finally {
    harness?.restore();
    globalThis.fetch = originalFetch;
    await vite?.close();
    dom.restore();
  }
});
