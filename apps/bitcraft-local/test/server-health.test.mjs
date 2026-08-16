import assert from "node:assert/strict";
import test from "node:test";
import { filterServerHealthLogs, normalizeServerHealthSnapshot, redactServerHealthText, serverHealthState } from "../src/server/serverHealth.mjs";
import * as serverHealth from "../src/server/serverHealth.mjs";

const snapshot = (overrides = {}) => normalizeServerHealthSnapshot({ schemaVersion: 1, capturedAt: new Date().toISOString(), host: { diskPercent: 40, memoryPercent: 50, cores: 2 }, services: [{ name: "web", active: true }], processes: [], logs: [], ...overrides });

test("server health redaction removes credentials and Discord ids", () => {
  const output = redactServerHealthText("--token=secret Bearer abc.def https://tom:pass@example.com user 145544610234630144");
  assert.doesNotMatch(output, /secret|abc\.def|tom:pass|145544610234630144/);
});

test("server health normalizes bounded process and log records", () => {
  const result = snapshot({ processes: [{ pid: "12", command: "app --password=hunter2" }], logs: [{ severity: "error", message: "token=abc" }] });
  assert.equal(result.processes[0].pid, 12);
  assert.doesNotMatch(result.processes[0].command, /hunter2/);
  assert.doesNotMatch(result.logs[0].message, /abc/);
});

test("server health state reports critical host conditions", () => {
  assert.equal(serverHealthState(snapshot({ host: { diskPercent: 91, memoryPercent: 50, cores: 2 } })).state, "critical");
  assert.equal(serverHealthState(snapshot({ services: [{ name: "worker", active: false }] })).state, "critical");
  assert.equal(serverHealthState(snapshot({ services: [{ name: "roads", active: false, required: false }] })).state, "healthy");
});

test("server health preserves bounded optional service CPU telemetry", () => {
  const result = snapshot({ services: [{ name: "roads", active: false, required: false, cpuPercent: 50, cpuUsageNSec: 15_000_000_000 }] });
  assert.deepEqual(result.services[0], {
    name: "roads",
    active: false,
    required: false,
    state: "",
    pid: 0,
    restarts: 0,
    memoryBytes: 0,
    cpuPercent: 50,
    uptimeSeconds: 0,
  });
});

test("server health log filters and pagination remain bounded", () => {
  const logs = [{ service: "web", severity: "error", message: "Failed request" }, { service: "worker", severity: "warning", message: "Retry" }];
  assert.equal(filterServerHealthLogs(logs, { service: "web", search: "failed", limit: 500 }).entries.length, 1);
});

test("normal server health responses omit the diagnostic bundle and downsample history", () => {
  assert.equal(typeof serverHealth.buildServerHealthResponse, "function");
  const history = Array.from({ length: 1_000 }, (_, index) => ({ capturedAt: new Date(index * 60_000).toISOString(), host: { cpuPercent: index } }));
  const base = { overall: { state: "healthy" }, history, logs: { entries: Array.from({ length: 80 }, (_, index) => ({ id: index })) } };

  const normal = serverHealth.buildServerHealthResponse(base);
  assert.equal(Object.hasOwn(normal, "diagnosticBundle"), false);
  assert.ok(normal.history.length <= 360);
  assert.equal(normal.history[0].capturedAt, history[0].capturedAt);
  assert.equal(normal.history.at(-1).capturedAt, history.at(-1).capturedAt);

  const bundled = serverHealth.buildServerHealthResponse(base, { includeDiagnosticBundle: true });
  assert.equal(bundled.diagnosticBundle.history.length, history.length);
  assert.equal(bundled.diagnosticBundle.logs.entries.length, 50);
});

test("cached server health reads share in-flight work and obey the TTL", async () => {
  assert.equal(typeof serverHealth.createCachedServerHealthReader, "function");
  let now = 1_000;
  let loads = 0;
  const load = async () => ({ load: ++loads });
  const read = serverHealth.createCachedServerHealthReader(load, { ttlMs: 30_000, now: () => now });

  const [first, shared] = await Promise.all([read("data"), read("data")]);
  assert.equal(loads, 1);
  assert.deepEqual(first, shared);
  assert.deepEqual(await read("data"), first);
  now += 30_001;
  assert.equal((await read("data")).load, 2);
});

test("application metric persistence is staggered by process role", () => {
  assert.equal(typeof serverHealth.applicationMetricInitialDelayMs, "function");
  assert.equal(serverHealth.applicationMetricInitialDelayMs("web"), 5_000);
  assert.equal(serverHealth.applicationMetricInitialDelayMs("worker"), 35_000);
});

test("application metric persistence reports SQLite locks without terminating the process", () => {
  assert.equal(typeof serverHealth.runApplicationMetricPersistence, "function");
  const warnings = [];
  const result = serverHealth.runApplicationMetricPersistence(
    () => { throw new Error("database is locked"); },
    (message) => warnings.push(message),
  );
  assert.equal(result.ok, false);
  assert.match(warnings[0], /database is locked/);
});
