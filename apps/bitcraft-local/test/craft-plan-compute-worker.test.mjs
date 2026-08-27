import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { createWorkerTaskRunner, runWorkerTask } from "../src/server/workerTask.mjs";
import { computeCraftPlanOffThread } from "../src/server/craftPlanComputeExecutor.mjs";
import { computeCraftPlan, normalizeCraftPlanConfig, recipeKey } from "../src/server/craftPlanning.mjs";
import { refreshFailureEntry, nextRefreshRetry, refreshRetryAllowed, serveLastGoodOrWait } from "../src/server/lastGoodRefresh.mjs";

test("worker tasks keep the Node event loop responsive during CPU-heavy work", async () => {
  const workerUrl = new URL("./fixtures/cpu-worker.mjs", import.meta.url);
  const heartbeats = [];
  const startedAt = performance.now();
  const timer = setInterval(() => heartbeats.push(performance.now() - startedAt), 10);

  try {
    const result = await runWorkerTask(workerUrl, { durationMs: 250 });
    assert.equal(result, "complete");
  } finally {
    clearInterval(timer);
  }

  assert.ok(heartbeats.length >= 5, `expected at least 5 heartbeats, received ${heartbeats.length}`);
  assert.ok(Math.max(...heartbeats.map((value, index) => index === 0 ? value : value - heartbeats[index - 1])) < 100);
});

test("off-thread craft-plan computation preserves the synchronous planner result", async () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "900", kind: "items", itemType: 0, name: "Simple Plank", quantity: 10 }],
    sourceRules: { bankPlayerIds: ["player-1"] },
  });
  const detailsByKey = new Map([[recipeKey("items", "900"), {
    item: { id: "900", itemType: 0, name: "Simple Plank", tier: 2 },
  }]]);
  const bankSources = [{
    sourceId: "player-1:bank-remote",
    label: "Town Bank",
    type: "Player bank",
    playerId: "player-1",
    items: [{ id: "900", kind: "items", itemType: 0, name: "Simple Plank", quantity: 7 }],
  }];
  const input = { config, detailsByKey, bankSources };

  assert.deepEqual(await computeCraftPlanOffThread(input), computeCraftPlan(input));
});

test("stale craft-plan responses return immediately while refresh continues", async () => {
  let completeRefresh;
  const refresh = new Promise((resolve) => { completeRefresh = resolve; });
  const response = serveLastGoodOrWait({
    lastGood: { revision: "old" },
    refresh,
  });

  assert.deepEqual(await Promise.race([response, Promise.resolve("not-immediate")]), { revision: "old" });
  completeRefresh({ revision: "new" });
  assert.deepEqual(await refresh, { revision: "new" });
});

test("manual craft-plan refresh waits for the new result", async () => {
  const response = serveLastGoodOrWait({
    lastGood: { revision: "old" },
    refresh: Promise.resolve({ revision: "new" }),
    forceRefresh: true,
  });

  assert.deepEqual(await response, { revision: "new" });
});

test("worker task runner bounds concurrency and queue depth", async () => {
  const workerUrl = new URL("./fixtures/cpu-worker.mjs", import.meta.url);
  const runner = createWorkerTaskRunner({ maxConcurrent: 1, maxQueued: 2, timeoutMs: 2_000 });
  const first = runner.run(workerUrl, { durationMs: 100, result: "first" });
  const second = runner.run(workerUrl, { durationMs: 50, result: "second" });
  const third = runner.run(workerUrl, { durationMs: 10, result: "third" });

  assert.deepEqual(runner.stats(), { active: 1, queued: 2, maxConcurrent: 1, maxQueued: 2 });
  await assert.rejects(
    runner.run(workerUrl, { durationMs: 10 }),
    (error) => error?.code === "WORKER_QUEUE_FULL",
  );
  assert.deepEqual(await Promise.all([first, second, third]), ["first", "second", "third"]);
  assert.deepEqual(runner.stats(), { active: 0, queued: 0, maxConcurrent: 1, maxQueued: 2 });
});

test("worker task runner terminates tasks that exceed their deadline", async () => {
  const workerUrl = new URL("./fixtures/cpu-worker.mjs", import.meta.url);
  const runner = createWorkerTaskRunner({ maxConcurrent: 1, maxQueued: 1, timeoutMs: 30 });

  await assert.rejects(
    runner.run(workerUrl, { durationMs: 250 }),
    (error) => error?.code === "WORKER_TASK_TIMEOUT",
  );
  assert.deepEqual(runner.stats(), { active: 0, queued: 0, maxConcurrent: 1, maxQueued: 1 });
});

test("failed background refreshes use bounded exponential retry delays", () => {
  const first = nextRefreshRetry({}, { now: 1_000, baseDelayMs: 15_000, maxDelayMs: 60_000 });
  const second = nextRefreshRetry(first, { now: 2_000, baseDelayMs: 15_000, maxDelayMs: 60_000 });
  const third = nextRefreshRetry(second, { now: 3_000, baseDelayMs: 15_000, maxDelayMs: 60_000 });
  const fourth = nextRefreshRetry(third, { now: 4_000, baseDelayMs: 15_000, maxDelayMs: 60_000 });

  assert.deepEqual(first, { refreshFailures: 1, retryAfter: 16_000 });
  assert.deepEqual(second, { refreshFailures: 2, retryAfter: 32_000 });
  assert.deepEqual(third, { refreshFailures: 3, retryAfter: 63_000 });
  assert.deepEqual(fourth, { refreshFailures: 4, retryAfter: 64_000 });
  assert.equal(refreshRetryAllowed(fourth, { now: 63_999 }), false);
  assert.equal(refreshRetryAllowed(fourth, { now: 63_999, forceRefresh: true }), true);
  assert.equal(refreshRetryAllowed(fourth, { now: 64_000 }), true);
});

test("an older failed refresh cannot replace a newer successful workspace", () => {
  const stale = { workspace: { revision: "old" }, refreshFailures: 0 };
  const current = { workspace: { revision: "new" }, refreshFailures: 0 };

  assert.equal(refreshFailureEntry(current, stale, { now: 1_000 }), current);
  assert.deepEqual(refreshFailureEntry(stale, stale, { now: 1_000 }), {
    workspace: { revision: "old" },
    refreshFailures: 1,
    retryAfter: 16_000,
  });
});

test("queued worker tasks cancel immediately without waiting for the active task", async () => {
  const workerUrl = new URL("./fixtures/cpu-worker.mjs", import.meta.url);
  const runner = createWorkerTaskRunner({ maxConcurrent: 1, maxQueued: 2, timeoutMs: 2_000 });
  const active = runner.run(workerUrl, { durationMs: 150 });
  const controller = new AbortController();
  const queued = runner.run(workerUrl, { durationMs: 10 }, { signal: controller.signal });

  controller.abort();

  const firstSettled = await Promise.race([
    queued.then(() => "queued-resolved", (error) => error?.code),
    active.then(() => "active-finished"),
  ]);
  assert.equal(firstSettled, "WORKER_TASK_CANCELLED");
  assert.equal(runner.stats().queued, 0);
  await active;
});

test("a worker that exits without a result fails immediately", async () => {
  const runner = createWorkerTaskRunner({ maxConcurrent: 1, maxQueued: 1, timeoutMs: 2_000 });

  await assert.rejects(
    runner.run(new URL("./fixtures/exit-worker.mjs", import.meta.url), {}),
    (error) => error?.code === "WORKER_TASK_NO_RESULT",
  );
});
