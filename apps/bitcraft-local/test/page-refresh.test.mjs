import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createDelayedRefreshTask,
  createPageRefreshController,
  createPageRefreshCycle,
  createPageRefreshTaskCoordinator,
  pageRefreshHeaders,
  pageRefreshPolicy,
  pageRefreshShowsRetainedDataProgress,
} from "../src/refresh/pageRefresh.mjs";
import * as generationWatcherModule from "../src/refresh/generationWatcher.mjs";

const { createGameDataGenerationWatcher } = generationWatcherModule;

function createFakeClock(start = 0) {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  const activeIntervals = new Set();
  const setTimeout = (callback, delay = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, Number(delay)), callback });
    return id;
  };
  const clearTimeout = (id) => {
    activeIntervals.delete(id);
    timers.delete(id);
  };
  const setInterval = (callback, delay) => {
    const id = nextId++;
    const tick = () => {
      if (!activeIntervals.has(id)) return;
      callback();
      if (activeIntervals.has(id)) timers.set(id, { at: now + delay, callback: tick });
    };
    activeIntervals.add(id);
    timers.set(id, { at: now + delay, callback: tick });
    return id;
  };
  const advance = (elapsed) => {
    const target = now + elapsed;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = target;
  };
  const elapse = (elapsed) => { now += elapsed; };
  return {
    now: () => now,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval: clearTimeout,
    advance,
    elapse,
    pendingTimers: () => timers.size,
  };
}

test("route policy keeps only Craft Monitor near-live and demand pages manual", () => {
  assert.equal(pageRefreshPolicy("craft-monitor").mode, "near-live");
  assert.equal(pageRefreshPolicy("craft-monitor").coalesceMs, 2_000);
  assert.equal(pageRefreshPolicy("craftcalc").mode, "manual");
  assert.equal(pageRefreshPolicy("sync").mode, "manual");

  for (const page of [
    "dashboard", "members", "skills", "leaderboard", "planning", "inventory",
    "construction", "research", "market", "settlement-market", "region",
    "empires", "map", "activity", "publiccrafts",
  ]) {
    assert.equal(pageRefreshPolicy(page).mode, "interval", page);
  }
});

test("delayed refresh tasks enroll immediately and cancellation settles as an abort", async () => {
  const clock = createFakeClock();
  let starts = 0;
  const delayed = createDelayedRefreshTask(() => {
    starts += 1;
    return Promise.resolve("done");
  }, 250, clock);

  assert.equal(starts, 0);
  clock.advance(249);
  assert.equal(starts, 0);
  clock.advance(1);
  assert.equal(await delayed.promise, "done");
  assert.equal(starts, 1);

  const cancelled = createDelayedRefreshTask(() => Promise.resolve("late"), 250, clock);
  cancelled.cancel();
  await assert.rejects(cancelled.promise, (error) => error?.name === "AbortError");
  clock.advance(250);
});

test("Craft Monitor coalesces generation changes and queues one trailing cycle", () => {
  const clock = createFakeClock();
  const cycles = [];
  let id = 0;
  const controller = createPageRefreshController({
    page: "craft-monitor",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `cycle-${++id}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial"]);
  controller.complete(cycles[0].id, true);

  controller.invalidateNearLive();
  controller.invalidateNearLive();
  clock.advance(1_999);
  assert.equal(cycles.length, 1);
  clock.advance(1);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "near-live"]);

  controller.invalidateNearLive();
  controller.invalidateNearLive();
  clock.advance(2_000);
  assert.equal(cycles.length, 2, "single flight blocks another start");
  controller.complete(cycles[1].id, true);
  assert.equal(cycles.length, 3, "one trailing cycle starts after completion");
  assert.equal(cycles[2].reason, "near-live");
});

test("Dashboard coalesces generation changes and queues one trailing generation cycle", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `dashboard-generation-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  controller.invalidateGeneration();
  clock.advance(1_999);
  assert.equal(cycles.length, 1);
  clock.advance(1);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation"]);

  controller.invalidateGeneration();
  controller.invalidateGeneration();
  clock.advance(2_000);
  assert.equal(cycles.length, 2, "an active request remains single-flight");
  controller.complete(cycles[1].id, true);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation", "generation"]);
});

test("Craft Monitor failures retry with bounded 5-30 second exponential backoff", () => {
  const clock = createFakeClock();
  const cycles = [];
  let id = 0;
  const controller = createPageRefreshController({
    page: "craft-monitor",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `backoff-${++id}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  for (const delay of [5_000, 10_000, 20_000, 30_000, 30_000]) {
    controller.complete(cycles.at(-1).id, false);
    clock.advance(delay - 1);
    assert.equal(cycles.length, id);
    clock.advance(1);
    assert.equal(cycles.at(-1).reason, "near-live");
  }

  controller.complete(cycles.at(-1).id, true);
  clock.advance(30_000);
  assert.equal(cycles.length, id, "success clears the failure retry");
});

test("generation-triggered failures retry at 5, 10, 20, then capped 30 seconds without accumulation", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `generation-backoff-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  assert.equal(cycles[1].reason, "generation");

  for (const delay of [5_000, 10_000, 20_000, 30_000, 30_000]) {
    const beforeRetry = cycles.length;
    controller.invalidateGeneration();
    controller.invalidateGeneration();
    controller.complete(cycles.at(-1).id, false);
    clock.advance(delay - 1);
    assert.equal(cycles.length, beforeRetry, `no request starts before ${delay} ms`);
    clock.advance(1);
    assert.equal(cycles.length, beforeRetry + 1);
    assert.equal(cycles.at(-1).reason, "generation");
  }
});

test("a successful generation cycle resets the failure retry to five seconds", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `generation-reset-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[1].id, false);
  clock.advance(5_000);
  controller.complete(cycles[2].id, true);

  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[3].id, false);
  clock.advance(4_999);
  assert.equal(cycles.length, 4);
  clock.advance(1);
  assert.equal(cycles.length, 5);
  assert.equal(cycles[4].reason, "generation");
});

test("ordinary interval failures wait for the ordinary next interval", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `ordinary-interval-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, false);
  clock.advance(29_999);
  assert.equal(cycles.length, 1);
  clock.advance(1);
  assert.equal(cycles.length, 2);
  assert.equal(cycles[1].reason, "interval");
});

test("generation invalidation does not overwrite a queued manual refresh", () => {
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    createId: () => `manual-priority-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.requestManual();
  controller.invalidateGeneration();
  controller.invalidateGeneration();
  controller.complete(cycles[0].id, true);

  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "manual"]);
});

test("a failed generation runs a queued manual cycle before its pending retry", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `manual-after-retry-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.requestManual();
  controller.complete(cycles[1].id, false);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation", "manual"]);

  controller.complete(cycles[2].id, true);
  clock.advance(4_999);
  assert.equal(cycles.length, 3);
  clock.advance(1);
  assert.equal(cycles[3].reason, "generation");

  controller.complete(cycles[3].id, false);
  clock.advance(9_999);
  assert.equal(cycles.length, 4);
  clock.advance(1);

  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation", "manual", "generation", "generation"]);
});

test("generation events during a priority manual cycle honor the retained retry deadline", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `manual-generation-deadline-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[1].id, false);
  controller.requestManual();
  clock.advance(3_000);
  controller.invalidateGeneration();
  controller.invalidateGeneration();
  controller.complete(cycles[2].id, true);

  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation", "manual"]);
  clock.advance(1_999);
  assert.equal(cycles.length, 3);
  clock.advance(1);
  assert.equal(cycles.length, 4);
  assert.equal(cycles[3].reason, "generation");

  controller.complete(cycles[3].id, false);
  clock.advance(9_999);
  assert.equal(cycles.length, 4);
  clock.advance(1);
  assert.equal(cycles.length, 5);
  assert.equal(cycles[4].reason, "generation");
});

test("a manual cycle completed before generation retry keeps its original deadline and backoff", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `manual-before-retry-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[1].id, false);
  clock.advance(1_000);
  controller.requestManual();
  controller.complete(cycles[2].id, true);

  clock.advance(3_999);
  assert.equal(cycles.length, 3);
  clock.advance(1);
  assert.equal(cycles.length, 4);
  assert.equal(cycles[3].reason, "generation");
  controller.complete(cycles[3].id, false);

  clock.advance(9_999);
  assert.equal(cycles.length, 4);
  clock.advance(1);
  assert.equal(cycles.length, 5);
  assert.equal(cycles[4].reason, "generation");
  controller.complete(cycles[4].id, true);

  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[5].id, false);
  clock.advance(4_999);
  assert.equal(cycles.length, 6);
  clock.advance(1);
  assert.equal(cycles.length, 7);
  assert.equal(cycles[6].reason, "generation");
});

test("changing the interval cadence does not replace a pending generation retry", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `interval-during-retry-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[1].id, false);
  clock.advance(1_000);
  controller.setIntervalMs(60_000);

  clock.advance(3_999);
  assert.equal(cycles.length, 2);
  clock.advance(1);
  assert.equal(cycles.length, 3);
  assert.equal(cycles[2].reason, "generation");
  controller.complete(cycles[2].id, true);

  clock.advance(59_999);
  assert.equal(cycles.length, 3);
  clock.advance(1);
  assert.equal(cycles.length, 4);
  assert.equal(cycles[3].reason, "interval");
});

test("a generation retry crossed by a manual cycle runs once immediately afterward", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `manual-crosses-retry-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[1].id, false);
  clock.advance(1_000);
  controller.requestManual();
  clock.advance(5_000);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation", "manual"]);

  controller.complete(cycles[2].id, true);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation", "manual", "generation"]);
  clock.advance(0);
  assert.equal(cycles.length, 4, "one elapsed retry produces one generation cycle");
  controller.complete(cycles[3].id, false);

  clock.advance(9_999);
  assert.equal(cycles.length, 4);
  clock.advance(1);
  assert.equal(cycles.length, 5);
  assert.equal(cycles[4].reason, "generation");
});

test("cold-start failures are sealed outside the data branch and enter Craft Monitor backoff", async () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  assert.match(appShell, /state\.error && !state\.data \? \([\s\S]*<ApiErrorState[\s\S]*<PageRefreshCycleSeal[\s\S]*\) : \(/);
  assert.match(appShell, /<PageRefreshProvider[\s\S]*\{activePanel\}[\s\S]*<PageRefreshCycleSeal[\s\S]*<\/PageRefreshProvider>/);

  const clock = createFakeClock();
  const cycles = [];
  let controller;
  const coordinator = createPageRefreshTaskCoordinator({
    onComplete: (cycle, succeeded) => controller.complete(cycle.id, succeeded),
  });
  controller = createPageRefreshController({
    page: "craft-monitor",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `cold-start-${cycles.length + 1}`,
    onCycle: (cycle) => {
      cycles.push(cycle);
      coordinator.beginCycle(cycle);
      void coordinator.trackPromise(cycle.id, "main-data", Promise.reject(new Error("cold start failed"))).catch(() => {});
      coordinator.seal(cycle.id);
    },
  });

  controller.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(coordinator.snapshot().status, "complete");
  clock.advance(4_999);
  assert.equal(cycles.length, 1);
  clock.advance(1);
  assert.equal(cycles.length, 2);
  assert.equal(cycles[1].reason, "near-live");
});

test("interval pages ignore generations, pause while hidden, and catch up once visible", () => {
  const clock = createFakeClock();
  const cycles = [];
  let id = 0;
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `interval-${++id}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateNearLive();
  clock.advance(29_999);
  assert.equal(cycles.length, 1, "Relay generations do not refresh interval pages");
  controller.setVisible(false);
  clock.advance(1);
  assert.equal(cycles.length, 1, "hidden tabs do not fetch");
  controller.setVisible(true);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "visibility-catch-up"]);
  controller.setVisible(true);
  assert.equal(cycles.length, 2, "visibility catch-up is emitted once");
});

test("visibility restoration catches up from elapsed time even when the hidden timer was throttled", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `throttled-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.setVisible(false);
  clock.elapse(30_000);
  controller.setVisible(true);

  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "visibility-catch-up"]);
});

test("manual pages run initially and on demand without an interval", () => {
  const clock = createFakeClock();
  const cycles = [];
  let id = 0;
  const controller = createPageRefreshController({
    page: "craftcalc",
    intervalMs: 15_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `manual-${++id}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  clock.advance(60_000);
  assert.equal(cycles.length, 1);
  controller.requestManual();
  assert.equal(cycles.at(-1).reason, "manual");
});

test("whole-page completion waits for every task and timestamps only full success", () => {
  let now = 10_000;
  const completions = [];
  const coordinator = createPageRefreshTaskCoordinator({
    now: () => now,
    onComplete: (cycle, succeeded) => completions.push([cycle.id, succeeded]),
  });
  const initial = createPageRefreshCycle("dashboard", 1, "initial", { createId: () => "initial", now: () => 1_000 });

  coordinator.beginCycle(initial);
  const finishMain = coordinator.beginTask(initial.id, "main-data");
  const finishHistory = coordinator.beginTask(initial.id, "local-history");
  coordinator.seal(initial.id);
  finishMain();
  assert.equal(coordinator.snapshot().status, "refreshing");
  assert.equal(coordinator.snapshot().lastSuccessfulAt, null);
  finishHistory();
  assert.equal(coordinator.snapshot().status, "complete");
  assert.equal(coordinator.snapshot().lastSuccessfulAt, 10_000);
  assert.equal(coordinator.snapshot().visibleProgress, false);
  assert.deepEqual(completions, [["initial", true]]);

  now = 20_000;
  const interval = createPageRefreshCycle("dashboard", 2, "interval", { createId: () => "interval", now: () => 2_000 });
  coordinator.beginCycle(interval);
  const finishInterval = coordinator.beginTask(interval.id, "main-data");
  assert.equal(coordinator.snapshot().visibleProgress, false, "automatic progress is silent");
  coordinator.seal(interval.id);
  finishInterval(new Error("history unavailable"));
  assert.equal(coordinator.snapshot().lastSuccessfulAt, 10_000, "failed cycle retains the last whole-page timestamp");
  assert.deepEqual(completions.at(-1), ["interval", false]);
});

test("only manual cycles attach the compatibility refresh header", () => {
  const manual = createPageRefreshCycle("planning", 3, "manual", { createId: () => "manual-id", now: () => 1_000 });
  const interval = createPageRefreshCycle("planning", 4, "interval", { createId: () => "interval-id", now: () => 2_000 });

  assert.deepEqual(pageRefreshHeaders(manual, "planning"), { "x-manual-refresh-id": "manual-id" });
  assert.deepEqual(pageRefreshHeaders(interval, "planning"), {});
  assert.deepEqual(pageRefreshHeaders(manual, "dashboard"), {});
});

test("retained-data progress is visible for manual cycles and silent for automatic cycles", () => {
  const cycle = (reason) => createPageRefreshCycle("leaderboard", 1, reason, { createId: () => reason });

  assert.equal(pageRefreshShowsRetainedDataProgress(cycle("manual")), true);
  assert.equal(pageRefreshShowsRetainedDataProgress(cycle("initial")), false);
  assert.equal(pageRefreshShowsRetainedDataProgress(cycle("interval")), false);
  assert.equal(pageRefreshShowsRetainedDataProgress(cycle("generation")), false);
  assert.equal(pageRefreshShowsRetainedDataProgress(cycle("near-live")), false);
  assert.equal(pageRefreshShowsRetainedDataProgress(cycle("visibility-catch-up")), false);
  assert.equal(pageRefreshShowsRetainedDataProgress(null), false);
});

test("route changes start a page-scoped initial cycle and cleanup cancels stale timers", () => {
  const clock = createFakeClock();
  const cycles = [];
  let id = 0;
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `route-${++id}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.setPage("craft-monitor");
  assert.deepEqual(cycles.at(-1), {
    id: "route-2",
    page: "craft-monitor",
    sequence: 2,
    reason: "initial",
    requestedAt: 0,
  });
  controller.complete(cycles.at(-1).id, true);
  controller.invalidateNearLive();
  controller.stop();
  clock.advance(60_000);
  assert.equal(cycles.length, 2);
});

test("controller cleanup cancels an independently owned generation retry timer", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `cleanup-generation-retry-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[1].id, false);
  assert.equal(clock.pendingTimers(), 1);
  controller.stop();
  assert.equal(clock.pendingTimers(), 0);
  clock.advance(60_000);

  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation"]);
});

test("late generation completions are inert after controller cleanup", () => {
  for (const succeeded of [false, true]) {
    const clock = createFakeClock();
    const cycles = [];
    const controller = createPageRefreshController({
      page: "dashboard",
      intervalMs: 30_000,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      createId: () => `late-generation-${succeeded}-${cycles.length + 1}`,
      onCycle: (cycle) => cycles.push(cycle),
    });

    controller.start();
    controller.complete(cycles[0].id, true);
    controller.invalidateGeneration();
    clock.advance(2_000);
    const lateCycle = cycles[1];

    controller.stop();
    assert.equal(clock.pendingTimers(), 0);
    controller.complete(lateCycle.id, succeeded);
    assert.equal(clock.pendingTimers(), 0);
    clock.advance(60_000);

    assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation"]);
  }
});

test("generation watcher combines SSE with a 1000 ms poll and deduplicates generations", async () => {
  const clock = createFakeClock();
  const observed = [];
  const sources = [];
  let polledGeneration = 1;
  let visible = true;
  let fetchCalls = 0;
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sources.push(this);
    }
    close() { this.closed = true; }
  }
  const watcher = createGameDataGenerationWatcher({
    claimId: "20",
    domains: ["crafts", "members"],
    fetch: async () => { fetchCalls += 1; return { ok: true, json: async () => ({ generation: polledGeneration }) }; },
    EventSource: FakeEventSource,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    isVisible: () => visible,
    onGeneration: (generation) => observed.push(generation),
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(observed, [1]);
  assert.match(sources[0].url, /domains=crafts%2Cmembers/);
  sources[0].onmessage({ data: JSON.stringify({ generation: 2 }) });
  sources[0].onmessage({ data: JSON.stringify({ generation: 2 }) });
  assert.deepEqual(observed, [1, 2]);
  polledGeneration = 3;
  clock.advance(999);
  assert.deepEqual(observed, [1, 2]);
  clock.advance(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(observed, [1, 2, 3]);

  visible = false;
  polledGeneration = 4;
  clock.advance(1_000);
  await Promise.resolve();
  assert.equal(fetchCalls, 2, "hidden tabs pause fallback polling");
  visible = true;
  clock.advance(1_000);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(observed, [1, 2, 3, 4]);

  watcher.stop();
  assert.equal(sources[0].closed, true);
  polledGeneration = 4;
  clock.advance(2_000);
  await Promise.resolve();
  assert.deepEqual(observed, [1, 2, 3, 4]);
});

test("generation watcher ignores events outside its claim and domain scope", async () => {
  const clock = createFakeClock();
  const observed = [];
  let source;
  class FakeEventSource {
    constructor() { source = this; }
    close() {}
  }
  const watcher = createGameDataGenerationWatcher({
    claimId: "20",
    domains: ["claim", "market"],
    fetch: async () => ({ ok: false }),
    EventSource: FakeEventSource,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    onGeneration: (generation) => observed.push(generation),
  });
  await Promise.resolve();

  source.onmessage({ data: JSON.stringify({ claimId: "20", generation: 90, changedDomains: ["members"] }) });
  source.onmessage({ data: JSON.stringify({ claimId: "21", generation: 91, changedDomains: ["market"] }) });
  source.onmessage({ data: JSON.stringify({ claimId: "20", generation: 2, changedDomains: ["market"] }) });

  assert.deepEqual(observed, [2], "ignored high generations must not poison the watched scope");
  watcher.stop();
});

test("page generation watcher enrolls only provider pages with page-specific recovery polling and prompt SSE", async () => {
  assert.equal(typeof generationWatcherModule.createPageGameDataGenerationWatcher, "function");
  const clock = createFakeClock();
  const sources = [];
  const pollDelays = [];
  const activePolls = new Set();
  const observed = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      sources.push(this);
    }
    close() { this.closed = true; }
  }
  const setInterval = (callback, delay) => {
    pollDelays.push(delay);
    const timer = clock.setInterval(callback, delay);
    activePolls.add(timer);
    return timer;
  };
  const clearInterval = (timer) => {
    activePolls.delete(timer);
    clock.clearInterval(timer);
  };
  const create = (activePanel) => generationWatcherModule.createPageGameDataGenerationWatcher({
    activePanel,
    claimId: "20",
    fetch: async () => ({ ok: false }),
    EventSource: FakeEventSource,
    setInterval,
    clearInterval,
    onGeneration: (generation) => observed.push(generation),
  });

  assert.equal(create("craftcalc"), null);
  assert.equal(create("sync"), null);
  assert.equal(create("market"), null, "interval pages without provider-neutral data do not watch");
  assert.equal(sources.length, 0);
  assert.equal(activePolls.size, 0);

  const dashboard = create("dashboard");
  assert.equal(activePolls.size, 1);
  assert.equal(pollDelays.at(-1), 30_000);
  assert.match(sources.at(-1).url, /claimId=20/);
  assert.match(sources.at(-1).url, /domains=.*market/);
  sources.at(-1).onmessage({ data: JSON.stringify({ claimId: "20", generation: 7, changedDomains: ["market"] }) });
  assert.deepEqual(observed, [7], "SSE invalidation does not wait for the recovery poll");

  dashboard.stop();
  assert.equal(sources[0].closed, true);
  assert.equal(activePolls.size, 0);

  const planning = create("planning");
  assert.ok(planning, "Craft Planning must refresh when its Relay-backed source generations change");
  assert.equal(activePolls.size, 1);
  assert.equal(pollDelays.at(-1), 30_000);
  const planningSearch = new URL(sources.at(-1).url, "http://local").searchParams;
  assert.deepEqual(planningSearch.get("domains").split(","), [
    "catalogs",
    "construction",
    "crafts",
    "inventories",
    "members",
  ]);
  sources.at(-1).onmessage({ data: JSON.stringify({ claimId: "20", generation: 8, changedDomains: ["market"] }) });
  sources.at(-1).onmessage({ data: JSON.stringify({ claimId: "20", generation: 9, changedDomains: ["inventories"] }) });
  assert.deepEqual(observed, [7, 9], "only a relevant Craft Planning generation should invalidate the page");
  planning.stop();
  assert.equal(activePolls.size, 0);

  const craftMonitor = create("craft-monitor");
  assert.equal(activePolls.size, 1, "navigation leaves one watcher poll enrolled");
  assert.equal(pollDelays.at(-1), 1_000);
  craftMonitor.stop();
  assert.equal(activePolls.size, 0);
});

test("hidden Craft Monitor defers generation invalidation to one visible catch-up", () => {
  const clock = createFakeClock();
  const cycles = [];
  let id = 0;
  const controller = createPageRefreshController({
    page: "craft-monitor",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `hidden-live-${++id}`,
    onCycle: (cycle) => cycles.push(cycle),
  });
  controller.start();
  controller.complete(cycles[0].id, true);
  controller.setVisible(false);
  controller.invalidateNearLive();
  clock.advance(10_000);
  assert.equal(cycles.length, 1);
  controller.setVisible(true);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "visibility-catch-up"]);
  controller.complete(cycles.at(-1).id, true);
  clock.advance(2_000);
  assert.equal(cycles.length, 2);
});

test("hidden interval provider pages defer generation invalidation to one visible catch-up", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `hidden-provider-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.setVisible(false);
  controller.invalidateGeneration();
  clock.advance(60_000);
  assert.equal(cycles.length, 1);
  controller.setVisible(true);
  controller.setVisible(true);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "visibility-catch-up"]);
});

test("a fresh hidden generation catch-up failure enters bounded generation backoff and success resets it", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `fresh-hidden-generation-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.setVisible(false);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.setVisible(true);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "visibility-catch-up"]);

  for (const delay of [5_000, 10_000, 20_000, 30_000, 30_000]) {
    controller.complete(cycles.at(-1).id, false);
    const beforeRetry = cycles.length;
    clock.advance(delay - 1);
    assert.equal(cycles.length, beforeRetry);
    clock.advance(1);
    assert.equal(cycles.length, beforeRetry + 1);
    assert.equal(cycles.at(-1).reason, "generation");
  }

  controller.complete(cycles.at(-1).id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles.at(-1).id, false);
  const beforeResetRetry = cycles.length;
  clock.advance(4_999);
  assert.equal(cycles.length, beforeResetRetry);
  clock.advance(1);
  assert.equal(cycles.length, beforeResetRetry + 1);
  assert.equal(cycles.at(-1).reason, "generation");
});

test("Craft Monitor visibility catch-up preserves the two-second coalescing deadline", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "craft-monitor",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `hidden-coalesce-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  clock.advance(500);
  controller.setVisible(false);
  controller.invalidateNearLive();
  clock.advance(500);
  controller.setVisible(true);

  assert.equal(cycles.length, 1, "visibility restoration must not bypass coalescing");
  clock.advance(999);
  assert.equal(cycles.length, 1);
  clock.advance(1);
  assert.equal(cycles.length, 2);
  assert.equal(cycles[1].reason, "visibility-catch-up");
  clock.advance(5_000);
  assert.equal(cycles.length, 2, "one hidden invalidation produces one catch-up");
});

test("Craft Monitor visibility catch-up preserves an active failure-backoff deadline", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "craft-monitor",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `hidden-backoff-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, false);
  clock.advance(1_000);
  controller.setVisible(false);
  controller.invalidateNearLive();
  clock.advance(1_000);
  controller.setVisible(true);

  assert.equal(cycles.length, 1, "visibility restoration must not bypass failure backoff");
  clock.advance(2_999);
  assert.equal(cycles.length, 1);
  clock.advance(1);
  assert.equal(cycles.length, 2);
  assert.equal(cycles[1].reason, "visibility-catch-up");
  clock.advance(5_000);
  assert.equal(cycles.length, 2, "one hidden invalidation produces one retry catch-up");
});

test("interval-page visibility catch-up preserves a generation failure-backoff deadline", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `hidden-generation-backoff-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[1].id, false);
  controller.setVisible(false);
  controller.invalidateGeneration();
  clock.advance(1_000);
  controller.setVisible(true);

  assert.equal(cycles.length, 2, "visibility restoration must not bypass generation backoff");
  clock.advance(3_999);
  assert.equal(cycles.length, 2);
  clock.advance(1);
  assert.equal(cycles.length, 3);
  assert.equal(cycles[2].reason, "visibility-catch-up");
  controller.complete(cycles[2].id, false);
  clock.advance(9_999);
  assert.equal(cycles.length, 3);
  clock.advance(1);
  assert.equal(cycles.length, 4);
  assert.equal(cycles[3].reason, "generation");
});

test("generation retry provenance survives a hidden deadline and continues bounded backoff", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `hidden-retry-deadline-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  controller.start();
  controller.complete(cycles[0].id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles[1].id, false);
  controller.setVisible(false);
  clock.advance(5_000);
  controller.setVisible(true);
  assert.deepEqual(cycles.map(({ reason }) => reason), ["initial", "generation", "visibility-catch-up"]);

  for (const delay of [10_000, 20_000, 30_000, 30_000]) {
    controller.complete(cycles.at(-1).id, false);
    const beforeRetry = cycles.length;
    clock.advance(delay - 1);
    assert.equal(cycles.length, beforeRetry);
    clock.advance(1);
    assert.equal(cycles.length, beforeRetry + 1);
    assert.equal(cycles.at(-1).reason, "generation");
  }

  controller.complete(cycles.at(-1).id, true);
  controller.invalidateGeneration();
  clock.advance(2_000);
  controller.complete(cycles.at(-1).id, false);
  const beforeResetRetry = cycles.length;
  clock.advance(4_999);
  assert.equal(cycles.length, beforeResetRetry);
  clock.advance(1);
  assert.equal(cycles.length, beforeResetRetry + 1);
  assert.equal(cycles.at(-1).reason, "generation");
});

test("tracked non-OK HTTP responses fail the whole-page cycle", async () => {
  const coordinator = createPageRefreshTaskCoordinator();
  const cycle = createPageRefreshCycle("market", 1, "manual", { createId: () => "http-failure" });
  coordinator.beginCycle(cycle);
  const response = { ok: false, status: 503 };
  const tracked = coordinator.trackPromise(cycle.id, "market-overview", Promise.resolve(response));
  coordinator.seal(cycle.id);

  assert.equal(await tracked, response, "callers still receive and parse the response");
  assert.equal(coordinator.snapshot().status, "complete");
  assert.equal(coordinator.snapshot().lastSuccessfulAt, null);
  assert.deepEqual(coordinator.snapshot().errors, ["market-overview HTTP 503"]);
});

test("hidden initial and navigation starts defer to one visible catch-up", () => {
  const clock = createFakeClock();
  const cycles = [];
  const controller = createPageRefreshController({
    page: "dashboard",
    intervalMs: 30_000,
    visible: false,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    createId: () => `hidden-start-${cycles.length + 1}`,
    onCycle: (cycle) => cycles.push(cycle),
  });

  assert.equal(controller.start(), null);
  assert.equal(controller.setPage("members"), null);
  assert.equal(cycles.length, 0);
  controller.setVisible(true);
  assert.equal(cycles.length, 1);
  assert.equal(cycles[0].page, "members");
  assert.equal(cycles[0].reason, "visibility-catch-up");
});

test("duplicate task keys wait for every request and obsolete aborts do not fail the cycle", async () => {
  let resolveFirst;
  let rejectSecond;
  const first = new Promise((resolve) => { resolveFirst = resolve; });
  const second = new Promise((_resolve, reject) => { rejectSecond = reject; });
  const coordinator = createPageRefreshTaskCoordinator({ now: () => 42_000 });
  const cycle = createPageRefreshCycle("market", 1, "interval", { createId: () => "duplicates" });
  coordinator.beginCycle(cycle);
  const trackedFirst = coordinator.trackPromise(cycle.id, "market-detail", first);
  const trackedSecond = coordinator.trackPromise(cycle.id, "market-detail", second);
  coordinator.seal(cycle.id);

  resolveFirst("ok");
  await trackedFirst;
  assert.equal(coordinator.snapshot().status, "refreshing");
  const abort = new Error("obsolete filter request");
  abort.name = "AbortError";
  rejectSecond(abort);
  await assert.rejects(trackedSecond, { name: "AbortError" });
  assert.equal(coordinator.snapshot().status, "complete");
  assert.deepEqual(coordinator.snapshot().errors, []);
  assert.equal(coordinator.snapshot().lastSuccessfulAt, 42_000);
});
