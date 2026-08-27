import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { filterServerHealthLogs, normalizeServerHealthSnapshot, redactServerHealthText, serverHealthState } from "../src/server/serverHealth.mjs";
import * as serverHealth from "../src/server/serverHealth.mjs";
import { readCraftContributionDiagnostics } from "../src/server/craftContributionVisibility.mjs";
import { createEventLoopHealthSampler } from "../src/server/eventLoopHealth.mjs";

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

test("server health ignores event-loop samples until process warm-up completes", () => {
  const result = serverHealthState(snapshot(), {
    eventLoopDelayMs: 900,
    eventLoopMonitoringReady: false,
  });

  assert.equal(result.state, "healthy");
  assert.deepEqual(result.reasons, []);
});

test("server health catches a long interval stall even when the interval mean is low", () => {
  const result = serverHealthState(snapshot(), {
    eventLoopDelayMs: 24,
    eventLoopDelayP99Ms: 31,
    eventLoopDelayMaxMs: 1_800,
    eventLoopMonitoringReady: true,
  });

  assert.equal(result.state, "critical");
  assert.deepEqual(result.reasons, ["Node event-loop delay is critical"]);
});

test("web-role health evaluation excludes shared host incidents", () => {
  const result = serverHealthState(
    snapshot({ host: { diskPercent: 95, memoryPercent: 50, cores: 2 } }),
    {},
    { includeHost: false },
  );

  assert.equal(result.state, "healthy");
  assert.deepEqual(result.reasons, []);
});

test("server health incident identities isolate web and worker event-loop state", () => {
  const reason = "Node event-loop delay is critical";
  const webKey = serverHealth.serverHealthIncidentIdentity(reason, { processRole: "web" });
  const workerKey = serverHealth.serverHealthIncidentIdentity(reason, { processRole: "worker" });
  const hostKey = serverHealth.serverHealthIncidentIdentity("Disk usage is critical", { processRole: "worker" });

  assert.equal(webKey, "web_node_event_loop_delay_is_critical");
  assert.equal(workerKey, "worker_node_event_loop_delay_is_critical");
  assert.equal(hostKey, "disk_usage_is_critical");
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator(webKey, { processRole: "web", includeHost: false }), true);
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator(workerKey, { processRole: "web", includeHost: false }), false);
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator(hostKey, { processRole: "web", includeHost: false }), false);
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator(workerKey, { processRole: "worker", includeHost: true }), true);
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator(webKey, { processRole: "worker", includeHost: true }), false);
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator(hostKey, { processRole: "worker", includeHost: true }), true);
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator(webKey, { processRole: "web", includeHost: false, eventLoopMonitoringReady: false }), false);
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator("node_event_loop_delay_is_critical", { processRole: "worker", includeHost: true, eventLoopMonitoringReady: false }), false);
  assert.equal(serverHealth.serverHealthIncidentOwnedByEvaluator("node_event_loop_delay_is_critical", { processRole: "worker", includeHost: true, eventLoopMonitoringReady: true }), true);
});

test("event-loop health samples one interval and resets startup history", () => {
  let now = 1_000;
  let resets = 0;
  const histogram = {
    mean: 420_000_000,
    max: 1_800_000_000,
    percentile: (value) => value === 99 ? 900_000_000 : 0,
    reset: () => { resets += 1; },
  };
  const sampler = createEventLoopHealthSampler(histogram, {
    now: () => now,
    warmupMs: 180_000,
  });

  assert.deepEqual(sampler.sampleAndReset(), {
    eventLoopDelayMs: 420,
    eventLoopDelayP99Ms: 900,
    eventLoopDelayMaxMs: 1_800,
    eventLoopMonitoringReady: false,
  });
  assert.equal(resets, 1);

  histogram.mean = 24_000_000;
  histogram.max = 55_000_000;
  histogram.percentile = () => 31_000_000;
  now += 180_001;

  assert.deepEqual(sampler.sampleAndReset(), {
    eventLoopDelayMs: 24,
    eventLoopDelayP99Ms: 31,
    eventLoopDelayMaxMs: 55,
    eventLoopMonitoringReady: true,
  });
  assert.equal(resets, 2);
});

test("server incident fields identify the process role and measured interval", () => {
  assert.deepEqual(serverHealth.serverHealthIncidentFields({
    hostname: "claim-monitor",
    processRole: "worker",
    at: "2026-08-27T21:10:06.940Z",
    application: {
      eventLoopDelayMs: 320,
      eventLoopDelayP99Ms: 480,
      eventLoopDelayMaxMs: 1_240,
      eventLoopMonitoringReady: true,
    },
  }), [
    { name: "Server", value: "claim-monitor", inline: true },
    { name: "Role", value: "worker", inline: true },
    { name: "Time", value: "2026-08-27T21:10:06.940Z", inline: true },
    { name: "Event loop", value: "mean 320 ms · p99 480 ms · max 1240 ms", inline: false },
  ]);
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

test("server health exposes bounded route performance without identifiers or raw queries", () => {
  assert.equal(typeof serverHealth.publicRoutePerformanceHealth, "function");
  const result = serverHealth.publicRoutePerformanceHealth({
    sampleCount: 4,
    routes: [
      { path: "/api/local/market/order-book/987?claimId=123", sampleCount: 3, statusCounts: { 200: 2, 429: 1 }, status429: 1, durationMs: { p50: 2, p95: 4, p99: 5 }, responseBytes: { p50: 100, p95: 200, p99: 300 }, projectionMs: { p50: 1, p95: 2, p99: 3 }, cookie: "private" },
      ...Array.from({ length: 30 }, (_, index) => ({ path: `/api/local/history/${index}`, sampleCount: 1 })),
    ],
    rateLimits: { gameDataRead: { reportOnly: true, wouldLimit: 2, address: "203.0.113.5" } },
  }, {
    gates: { gameData: { active: 1, queued: 2, rejected: 3, maxConcurrent: 8, maxQueued: 16 } },
  });

  assert.equal(result.routes.length, 20);
  assert.equal(result.routes[0].path, "/api/local/market/order-book/:id");
  assert.deepEqual(result.rateLimits, { gameDataRead: { reportOnly: true, wouldLimit: 2 } });
  assert.deepEqual(result.gates.gameData, { active: 1, queued: 2, rejected: 3, maxConcurrent: 8, maxQueued: 16 });
  assert.doesNotMatch(JSON.stringify(result), /987|123|private|203\.0\.113\.5|claimId/);
});

test("Server Health contribution diagnostics use one fixed aggregate SQL row", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE production_contribution_events (
      source_key TEXT PRIMARY KEY,
      contributor_entity_id TEXT,
      attribution_confidence TEXT NOT NULL
    );
    INSERT INTO production_contribution_events VALUES
      ('a', '1', 'authoritative'),
      ('b', '2', 'matched_action'),
      ('c', NULL, 'authoritative'),
      ('d', '4', 'owner_fallback'),
      ('e', '5', 'unknown');
  `);
  const sql = [];
  const wrapped = {
    prepare(statement) {
      sql.push(statement);
      return db.prepare(statement);
    },
  };

  assert.deepEqual(readCraftContributionDiagnostics(wrapped), {
    totalEventCount: 5,
    attributableEventCount: 2,
    unknownAttributionCount: 3,
  });
  assert.equal(sql.length, 1);
  assert.match(sql[0], /COUNT\(\*\)[\s\S]*SUM\(CASE/);
  assert.doesNotMatch(sql[0], /SELECT\s+contributor_entity_id|SELECT\s+\*/i);
  db.close();
});
