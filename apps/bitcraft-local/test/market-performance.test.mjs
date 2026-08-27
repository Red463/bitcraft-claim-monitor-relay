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
  globalThis.fetch = (input) => new Promise((resolve) => requests.push({ url: String(input), resolve }));
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let harness = null;
  try {
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
    await vite.close();
    dom.restore();
  }
});
