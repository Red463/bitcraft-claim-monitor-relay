import assert from "node:assert/strict";
import test from "node:test";

import {
  LAZY_ROUTE_RELOAD_KEY,
  loadLazyRoute,
} from "../src/utils/lazyRouteRecovery.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("a failed lazy page download reloads once instead of exposing the route error", async () => {
  const storage = memoryStorage();
  let reloads = 0;
  const loading = loadLazyRoute(
    () => Promise.reject(new TypeError("Failed to fetch dynamically imported module: /assets/MembersPage-old.js")),
    { storage, reload: () => { reloads += 1; } },
  );

  await Promise.resolve();

  assert.equal(reloads, 1);
  assert.equal(storage.getItem(LAZY_ROUTE_RELOAD_KEY), "1");
  assert.equal(await Promise.race([loading.then(() => "settled", () => "rejected"), Promise.resolve("pending")]), "pending");
});

test("a repeated lazy page download failure reaches the error boundary without a reload loop", async () => {
  const storage = memoryStorage({ [LAZY_ROUTE_RELOAD_KEY]: "1" });
  const failure = new TypeError("Failed to fetch dynamically imported module: /assets/MembersPage-old.js");
  let reloads = 0;

  await assert.rejects(
    loadLazyRoute(() => Promise.reject(failure), { storage, reload: () => { reloads += 1; } }),
    failure,
  );
  assert.equal(reloads, 0);
});

test("a successful lazy page download clears the reload guard", async () => {
  const storage = memoryStorage({ [LAZY_ROUTE_RELOAD_KEY]: "1" });
  const routeModule = { default: () => null };

  assert.equal(await loadLazyRoute(() => Promise.resolve(routeModule), { storage, reload: () => {} }), routeModule);
  assert.equal(storage.getItem(LAZY_ROUTE_RELOAD_KEY), null);
});

test("a page module evaluation error is reported without forcing a reload", async () => {
  const storage = memoryStorage();
  const failure = new Error("MembersPage render setup failed");
  let reloads = 0;

  await assert.rejects(
    loadLazyRoute(() => Promise.reject(failure), { storage, reload: () => { reloads += 1; } }),
    failure,
  );
  assert.equal(reloads, 0);
  assert.equal(storage.getItem(LAZY_ROUTE_RELOAD_KEY), null);
});
