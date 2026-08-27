import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeRoutePerformancePath } from "./routePerformance.mjs";

export const SERVER_HEALTH_SCHEMA_VERSION = 1;
export const SERVER_HEALTH_THRESHOLDS = Object.freeze({ staleMs: 180_000, diskWarning: 80, diskCritical: 90, memoryWarning: 80, memoryCritical: 90, eventLoopWarningMs: 100, eventLoopCriticalMs: 250, eventLoopMaxWarningMs: 500, eventLoopMaxCriticalMs: 1_000, http5xxWarningRate: 0.02, http5xxCriticalRate: 0.1 });

const SECRET_VALUE = /((?:token|secret|password|passwd|api[_-]?key|authorization|cookie|session|dsn)\s*[=:]\s*)([^\s,;]+)/gi;
const BEARER = /\b(Bearer|Bot)\s+[A-Za-z0-9._~+\/-]+/gi;
const URL_CREDENTIALS = /(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi;
const DISCORD_ID = /\b\d{17,20}\b/g;

export function redactServerHealthText(value) {
  return String(value ?? "")
    .replace(URL_CREDENTIALS, "$1[redacted]@")
    .replace(SECRET_VALUE, "$1[redacted]")
    .replace(BEARER, "$1 [redacted]")
    .replace(DISCORD_ID, "[discord-id]")
    .slice(0, 4000);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

export function normalizeServerHealthSnapshot(raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Monitoring snapshot is not an object");
  if (number(raw.schemaVersion) !== SERVER_HEALTH_SCHEMA_VERSION) throw new Error("Unsupported monitoring snapshot schema");
  const capturedAt = new Date(raw.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) throw new Error("Monitoring snapshot timestamp is invalid");
  const services = safeArray(raw.services, 8).map((service) => ({ name: redactServerHealthText(service.name), active: Boolean(service.active), required: service.required !== false, state: redactServerHealthText(service.state), pid: number(service.pid), restarts: number(service.restarts), memoryBytes: number(service.memoryBytes), cpuPercent: number(service.cpuPercent), uptimeSeconds: number(service.uptimeSeconds) }));
  const processes = safeArray(raw.processes, 20).map((process) => ({ pid: number(process.pid), user: redactServerHealthText(process.user), name: redactServerHealthText(process.name), cpuPercent: number(process.cpuPercent), memoryPercent: number(process.memoryPercent), command: redactServerHealthText(process.command) }));
  const logs = safeArray(raw.logs, 250).map((entry, index) => ({ id: String(entry.id ?? index), at: String(entry.at ?? raw.capturedAt), service: redactServerHealthText(entry.service), severity: ["error", "warning", "info"].includes(entry.severity) ? entry.severity : "info", message: redactServerHealthText(entry.message) }));
  return {
    schemaVersion: SERVER_HEALTH_SCHEMA_VERSION,
    capturedAt: capturedAt.toISOString(),
    ageMs: Math.max(0, now - capturedAt.getTime()),
    host: { cpuPercent: number(raw.host?.cpuPercent), load1: number(raw.host?.load1), cores: Math.max(1, number(raw.host?.cores, 1)), memoryPercent: number(raw.host?.memoryPercent), swapPercent: number(raw.host?.swapPercent), diskPercent: number(raw.host?.diskPercent), diskBytes: number(raw.host?.diskBytes), inodePercent: number(raw.host?.inodePercent), networkRxBytesPerSecond: number(raw.host?.networkRxBytesPerSecond), networkTxBytesPerSecond: number(raw.host?.networkTxBytesPerSecond), networkErrors: number(raw.host?.networkErrors) },
    services, processes, logs,
  };
}

export function serverHealthState(snapshot, application = {}, { includeHost = true } = {}) {
  const reasons = [];
  let state = "healthy";
  const raise = (next, reason) => { if (next === "critical" || state === "healthy") state = next; reasons.push(reason); };
  if (includeHost) {
    if (!snapshot) raise("warning", "Host collector unavailable");
    else {
      if (snapshot.ageMs > SERVER_HEALTH_THRESHOLDS.staleMs) raise("critical", "Host collector is stale");
      if (snapshot.host.diskPercent >= SERVER_HEALTH_THRESHOLDS.diskCritical) raise("critical", "Disk usage is critical"); else if (snapshot.host.diskPercent >= SERVER_HEALTH_THRESHOLDS.diskWarning) raise("warning", "Disk usage is high");
      if (snapshot.host.memoryPercent >= SERVER_HEALTH_THRESHOLDS.memoryCritical) raise("critical", "Memory usage is critical"); else if (snapshot.host.memoryPercent >= SERVER_HEALTH_THRESHOLDS.memoryWarning) raise("warning", "Memory usage is high");
      if (snapshot.services.some((service) => service.required !== false && !service.active)) raise("critical", "One or more monitored services are inactive");
    }
  }
  if (application.eventLoopMonitoringReady !== false) {
    const intervalDelay = Math.max(number(application.eventLoopDelayMs), number(application.eventLoopDelayP99Ms));
    const intervalMax = number(application.eventLoopDelayMaxMs);
    if (intervalDelay >= SERVER_HEALTH_THRESHOLDS.eventLoopCriticalMs || intervalMax >= SERVER_HEALTH_THRESHOLDS.eventLoopMaxCriticalMs) raise("critical", "Node event-loop delay is critical");
    else if (intervalDelay >= SERVER_HEALTH_THRESHOLDS.eventLoopWarningMs || intervalMax >= SERVER_HEALTH_THRESHOLDS.eventLoopMaxWarningMs) raise("warning", "Node event-loop delay is elevated");
  }
  return { state, reasons: [...new Set(reasons)] };
}

function normalizedIncidentKey(reason) {
  return String(reason).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80);
}

export function serverHealthIncidentIdentity(reason, { processRole = "unknown" } = {}) {
  const key = normalizedIncidentKey(reason);
  return key.startsWith("node_event_loop_delay_") ? `${normalizedIncidentKey(processRole)}_${key}` : key;
}

export function serverHealthIncidentOwnedByEvaluator(key, { processRole = "unknown", includeHost = true, eventLoopMonitoringReady = true } = {}) {
  const normalizedKey = normalizedIncidentKey(key);
  if (normalizedKey.startsWith("node_event_loop_delay_")) return includeHost && eventLoopMonitoringReady !== false;
  const eventLoopMatch = normalizedKey.match(/^([^_]+)_node_event_loop_delay_/);
  if (eventLoopMatch) return eventLoopMonitoringReady !== false && eventLoopMatch[1] === normalizedIncidentKey(processRole);
  return includeHost;
}

export function serverHealthIncidentFields({ hostname = "Claim Monitor VPS", processRole = "unknown", at = new Date().toISOString(), application = {} } = {}) {
  const fields = [
    { name: "Server", value: String(hostname), inline: true },
    { name: "Role", value: String(processRole), inline: true },
    { name: "Time", value: String(at), inline: true },
  ];
  if (application.eventLoopMonitoringReady !== false && Number.isFinite(Number(application.eventLoopDelayMs))) {
    fields.push({
      name: "Event loop",
      value: `mean ${number(application.eventLoopDelayMs).toFixed(0)} ms · p99 ${number(application.eventLoopDelayP99Ms).toFixed(0)} ms · max ${number(application.eventLoopDelayMaxMs).toFixed(0)} ms`,
      inline: false,
    });
  }
  return fields;
}

export async function readServerHealthFiles(dataDir, { now = Date.now(), maxBytes = 2_000_000 } = {}) {
  const directory = path.join(dataDir, "monitoring");
  const snapshotPath = path.join(directory, "snapshot.json");
  const historyPath = path.join(directory, "history.jsonl");
  let snapshot = null;
  let warning = "";
  try {
    const info = await stat(snapshotPath);
    if (info.size > maxBytes) throw new Error("Monitoring snapshot exceeds size limit");
    if (process.platform === "linux" && process.env.NODE_ENV === "production" && info.uid !== 0) throw new Error("Monitoring snapshot has unexpected ownership");
    snapshot = normalizeServerHealthSnapshot(JSON.parse(await readFile(snapshotPath, "utf8")), { now });
  } catch (error) {
    warning = error?.code === "ENOENT" ? "Host collector has not produced a snapshot" : redactServerHealthText(error.message);
  }
  let history = [];
  try {
    const info = await stat(historyPath);
    if (info.size <= maxBytes * 5) {
      history = (await readFile(historyPath, "utf8")).trim().split("\n").filter(Boolean).slice(-10_080).map((line) => JSON.parse(line)).filter((row) => now - new Date(row.capturedAt).getTime() <= 7 * 86_400_000).map((row) => normalizeServerHealthSnapshot({ ...row, services: row.services ?? [], processes: [], logs: [] }, { now }));
    }
  } catch {}
  return { snapshot, history, warning };
}

export function filterServerHealthLogs(logs, { service = "", severity = "", search = "", cursor = 0, limit = 50 } = {}) {
  const needle = String(search).trim().toLowerCase();
  const filtered = safeArray(logs, 1000).filter((entry) => (!service || entry.service === service) && (!severity || entry.severity === severity) && (!needle || `${entry.service} ${entry.message}`.toLowerCase().includes(needle)));
  const start = Math.max(0, Math.floor(number(cursor)));
  const size = Math.min(100, Math.max(10, Math.floor(number(limit, 50))));
  return { entries: filtered.slice(start, start + size), nextCursor: start + size < filtered.length ? start + size : null, total: filtered.length };
}

export function downsampleServerHealthHistory(history, limit = 360) {
  const rows = Array.isArray(history) ? history : [];
  const size = Math.max(2, Math.floor(number(limit, 360)));
  if (rows.length <= size) return rows;
  const lastIndex = rows.length - 1;
  const indexes = new Set([0, lastIndex]);
  for (let index = 1; index < size - 1; index += 1) indexes.add(Math.round((index / (size - 1)) * lastIndex));
  return [...indexes].sort((left, right) => left - right).map((index) => rows[index]);
}

export function buildServerHealthResponse(base = {}, { includeDiagnosticBundle = false, historyLimit = 360 } = {}) {
  const normal = { ...base, history: downsampleServerHealthHistory(base.history, historyLimit) };
  if (!includeDiagnosticBundle) return normal;
  const bundleLogs = base.logs && typeof base.logs === "object"
    ? { ...base.logs, entries: safeArray(base.logs.entries, 50) }
    : base.logs;
  return { ...normal, diagnosticBundle: { ...base, logs: bundleLogs } };
}

export function createCachedServerHealthReader(load, { ttlMs = 30_000, now = Date.now } = {}) {
  const entries = new Map();
  return async (...args) => {
    const key = JSON.stringify(args);
    const cached = entries.get(key);
    const readAt = now();
    if (cached?.value !== undefined && cached.expiresAt > readAt) return cached.value;
    if (cached?.inflight) return cached.inflight;
    const entry = cached ?? { value: undefined, expiresAt: 0, inflight: null };
    const inflight = Promise.resolve().then(() => load(...args)).then((value) => {
      entry.value = value;
      entry.expiresAt = now() + Math.max(0, number(ttlMs, 30_000));
      return value;
    }).finally(() => {
      entry.inflight = null;
    });
    entry.inflight = inflight;
    entries.set(key, entry);
    return inflight;
  };
}

export function applicationMetricInitialDelayMs(processRole) {
  return String(processRole) === "worker" ? 35_000 : 5_000;
}

export function runApplicationMetricPersistence(write, warn = () => {}) {
  try {
    write();
    return { ok: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`Application health metric persistence skipped: ${message}`);
    return { ok: false, error: message };
  }
}

function publicPercentiles(raw) {
  return { p50: number(raw?.p50), p95: number(raw?.p95), p99: number(raw?.p99) };
}

function publicGate(raw) {
  return {
    active: Math.max(0, Math.floor(number(raw?.active))),
    queued: Math.max(0, Math.floor(number(raw?.queued))),
    rejected: Math.max(0, Math.floor(number(raw?.rejected))),
    maxConcurrent: Math.max(0, Math.floor(number(raw?.maxConcurrent))),
    maxQueued: Math.max(0, Math.floor(number(raw?.maxQueued))),
  };
}

export function publicRoutePerformanceHealth(raw = {}, { gates = {} } = {}) {
  const allowedProfiles = ["gameDataRead", "orderBookRead", "favoriteQuotesRead"];
  const rateLimits = {};
  for (const name of allowedProfiles) {
    if (!raw.rateLimits?.[name]) continue;
    rateLimits[name] = {
      reportOnly: Boolean(raw.rateLimits[name].reportOnly),
      wouldLimit: Math.max(0, Math.floor(number(raw.rateLimits[name].wouldLimit))),
    };
  }
  return {
    sampleCount: Math.max(0, Math.floor(number(raw.sampleCount))),
    routes: safeArray(raw.routes, 20).map((route) => ({
      path: normalizeRoutePerformancePath(route.path),
      sampleCount: Math.max(0, Math.floor(number(route.sampleCount))),
      statusCounts: Object.fromEntries(Object.entries(route.statusCounts ?? {}).filter(([status]) => /^[1-5]\d\d$/.test(status)).map(([status, count]) => [status, Math.max(0, Math.floor(number(count)))])),
      status429: Math.max(0, Math.floor(number(route.status429))),
      durationMs: publicPercentiles(route.durationMs),
      responseBytes: publicPercentiles(route.responseBytes),
      projectionMs: publicPercentiles(route.projectionMs),
    })),
    rateLimits,
    gates: Object.fromEntries(["gameData", "market"].filter((name) => gates[name]).map((name) => [name, publicGate(gates[name])])),
  };
}
