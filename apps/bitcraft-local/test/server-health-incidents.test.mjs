import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import vm from "node:vm";
import * as health from "../src/server/serverHealth.mjs";

// Exercise the server's evaluator without booting providers or Discord.
const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
const evaluator = source.slice(source.indexOf("async function evaluateServerHealthIncidents()"), source.indexOf("let serverHealthIncidentTimer = null;"));
const schema = readFileSync(new URL("../src/server/schemaBootstrap.mjs", import.meta.url), "utf8");

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(schema.match(/CREATE TABLE IF NOT EXISTS server_health_incidents \([\s\S]*?\);/)[0]);
  const snapshot = { ageMs: 0, host: { diskPercent: 20, memoryPercent: 30 }, services: [] };
  let application = {};
  const messages = [];
  const context = vm.createContext({
    ...health, db, processRole: "worker", processRoleConfig: { runBackgroundJobs: true },
    readCachedServerHealthFiles: async () => ({ snapshot }),
    applicationHealthTelemetry: () => application,
    notifyServerHealthOwner: async (title, description, color) => messages.push({ title, description, color }),
  });
  vm.runInContext(evaluator, context);
  return {
    db, snapshot, messages,
    async sample(maximum, overrides = {}) {
      application = { eventLoopDelayMs: 24, eventLoopDelayP99Ms: 23, eventLoopDelayMaxMs: maximum, eventLoopMonitoringReady: true, ...overrides };
      await context.evaluateServerHealthIncidents();
    },
  };
}

test("observed near-one-second stalls never open critical Discord incidents", async (t) => {
  const f = fixture(t);
  for (const maximum of [983, 1012, 1017, 1037, 1024, 966, 1026, 989, 1014, 1066, 1014, 1013, 1027, 978, 1059, 1100, 1007, 1033, 1030, 996, 1094, 992, 991, 991]) await f.sample(maximum);
  assert.equal(f.messages.length, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM server_health_incidents").get().n, 0);
});

test("a critical host condition cannot promote an event-loop warning to a critical incident", async (t) => {
  const f = fixture(t);
  f.snapshot.host.diskPercent = 95;
  for (let i = 0; i < 3; i++) await f.sample(1037);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].description, "Disk usage is critical");
});

test("critical stalls require three samples and recover with hysteresis and warning-level wording", async (t) => {
  const f = fixture(t);
  await f.sample(3500);
  await f.sample(3500);
  assert.equal(f.messages.length, 0);
  await f.sample(3500);
  assert.equal(f.messages.length, 1);
  for (let i = 0; i < 3; i++) await f.sample(2500);
  assert.equal(f.messages.length, 1, "near-critical spikes must not trigger recovery");
  await f.sample(1900);
  await f.sample(1900);
  await f.sample(2100);
  await f.sample(1900);
  await f.sample(1900);
  assert.equal(f.messages.length, 1, "an intervening high sample resets the recovery streak");
  await f.sample(1900);
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[1].title, /improved/i);
  assert.match(f.messages[1].description, /warning/i);
  assert.doesNotMatch(f.messages[1].description, /is critical/i);
  assert.notEqual(f.messages[1].color, 0x4ee28a);
});

test("sustained delay remains critical and recovery requires lower mean and p99", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) await f.sample(400, { eventLoopDelayP99Ms: 300 });
  assert.equal(f.messages.length, 1);
  for (let i = 0; i < 3; i++) await f.sample(400, { eventLoopDelayP99Ms: 210 });
  assert.equal(f.messages.length, 1);
  for (let i = 0; i < 3; i++) await f.sample(400, { eventLoopDelayMs: 210 });
  assert.equal(f.messages.length, 1);
  for (let i = 0; i < 3; i++) await f.sample(40);
  assert.equal(f.messages.length, 2);
  assert.match(f.messages[1].title, /recovered/i);
  assert.match(f.messages[1].description, /healthy/i);
  assert.doesNotMatch(f.messages[1].description, /is critical/i);
  assert.equal(f.messages[1].color, 0x4ee28a);
});
