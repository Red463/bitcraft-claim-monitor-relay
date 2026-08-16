#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { compactMonitoringHistory } from "./monitoring-history.mjs";
import { serviceCpuPercent, serviceIsRequired } from "./server-health-cpu.mjs";

const exec = promisify(execFile);
const dataDir = process.env.BITCRAFT_LOCAL_DATA_DIR || "/var/lib/bitcraft-claim-monitor-relay";
const outputDir = path.join(dataDir, "monitoring");
const now = new Date();
const services = String(process.env.BITCRAFT_MONITOR_SERVICES ?? "bitcraft-claim-monitor-relay,bitcraft-claim-monitor-relay-worker,caddy")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .slice(0, 12);
const secret = /((?:token|secret|password|passwd|api[_-]?key|authorization|cookie|session|dsn)\s*[=:]\s*)([^\s,;]+)/gi;
const redact = (value) => String(value ?? "").replace(secret, "$1[redacted]").replace(/\b(Bearer|Bot)\s+\S+/gi, "$1 [redacted]").replace(/\b\d{17,20}\b/g, "[discord-id]").slice(0, 4000);
const run = async (command, args) => (await exec(command, args, { timeout: 10_000, maxBuffer: 1_000_000 })).stdout.trim();
const procText = async (name) => readFile(`/proc/${name}`, "utf8").catch(() => "");

async function serviceRow(name, { previousUsageNSec, elapsedSeconds, cores }) {
  try {
    const values = Object.fromEntries((await run("systemctl", ["show", name, "--property=ActiveState,SubState,MainPID,NRestarts,MemoryCurrent,CPUUsageNSec,ActiveEnterTimestampMonotonic"])).split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)));
    const cpuUsageNSec = Number(values.CPUUsageNSec) || 0;
    return { name, active: values.ActiveState === "active", required: serviceIsRequired(name), state: `${values.ActiveState}/${values.SubState}`, pid: Number(values.MainPID) || 0, restarts: Number(values.NRestarts) || 0, memoryBytes: Number(values.MemoryCurrent) || 0, cpuPercent: serviceCpuPercent({ currentUsageNSec: cpuUsageNSec, previousUsageNSec, elapsedSeconds, cores }), uptimeSeconds: Math.max(0, os.uptime() - (Number(values.ActiveEnterTimestampMonotonic) || 0) / 1e6), _cpuUsageNSec: cpuUsageNSec };
  } catch (error) { return { name, active: false, required: serviceIsRequired(name), state: redact(error.message), pid: 0, restarts: 0, memoryBytes: 0, cpuPercent: 0, uptimeSeconds: 0, _cpuUsageNSec: 0 }; }
}

async function journalRows() {
  const rows = [];
  for (const service of services) {
    try {
      const output = await run("journalctl", ["-u", service, "--since", "-10 minutes", "-p", "warning", "-n", "80", "--no-pager", "-o", "json"]);
      for (const line of output.split("\n").filter(Boolean)) {
        const entry = JSON.parse(line);
        rows.push({ id: `${service}:${entry.__CURSOR ?? entry.__REALTIME_TIMESTAMP}`, at: new Date(Number(entry.__REALTIME_TIMESTAMP ?? 0) / 1000).toISOString(), service, severity: Number(entry.PRIORITY) <= 3 ? "error" : "warning", message: redact(entry.MESSAGE) });
      }
    } catch {}
  }
  return rows.slice(-250);
}

const cpus = os.cpus();
const cpuTotal = cpus.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);
const cpuIdle = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
const disk = await statfs(dataDir);
const diskBytes = disk.blocks * disk.bsize;
const diskFree = disk.bavail * disk.bsize;
const memoryInfo = Object.fromEntries((await procText("meminfo")).split("\n").map((line) => line.match(/^(\w+):\s+(\d+)/)).filter(Boolean).map((match) => [match[1], Number(match[2]) * 1024]));
const swapTotal = memoryInfo.SwapTotal || 0;
const swapPercent = swapTotal ? ((swapTotal - (memoryInfo.SwapFree || 0)) / swapTotal) * 100 : 0;
const networkTotals = (await procText("net/dev")).split("\n").slice(2).map((line) => line.trim().match(/^(\S+):\s*(\d+)\s+\d+\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+\d+\s+(\d+)/)).filter(Boolean).filter((match) => match[1] !== "lo").reduce((total, match) => ({ rx: total.rx + Number(match[2]), errors: total.errors + Number(match[3]) + Number(match[5]), tx: total.tx + Number(match[4]) }), { rx: 0, tx: 0, errors: 0 });
let previousSnapshot = null;
try { previousSnapshot = JSON.parse(await readFile(path.join(outputDir, "snapshot.json"), "utf8")); } catch {}
const elapsedSeconds = Math.max(1, (now.getTime() - new Date(previousSnapshot?.capturedAt ?? 0).getTime()) / 1000);
let processes = [];
try {
  const output = await run("ps", ["-eo", "pid=,user=,pcpu=,pmem=,comm=,args=", "--sort=-pcpu"]);
  processes = output.split("\n").slice(0, 20).map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/);
    return match ? { pid: Number(match[1]), user: match[2], cpuPercent: Number(match[3]), memoryPercent: Number(match[4]), name: match[5], command: redact(match[6]) } : null;
  }).filter(Boolean);
} catch {}

const serviceRows = await Promise.all(services.map((name) => serviceRow(name, { previousUsageNSec: previousSnapshot?._serviceCpuUsage?.[name], elapsedSeconds, cores: cpus.length })));
const serviceCpuUsage = Object.fromEntries(serviceRows.map((row) => [row.name, row._cpuUsageNSec]));
const publicServiceRows = serviceRows.map(({ _cpuUsageNSec, ...row }) => row);
const snapshot = { schemaVersion: 1, capturedAt: now.toISOString(), host: { cpuPercent: cpuTotal ? ((cpuTotal - cpuIdle) / cpuTotal) * 100 : 0, load1: os.loadavg()[0], cores: cpus.length, memoryPercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100, swapPercent, diskPercent: diskBytes ? ((diskBytes - diskFree) / diskBytes) * 100 : 0, diskBytes, inodePercent: disk.files ? ((disk.files - disk.ffree) / disk.files) * 100 : 0, networkRxBytesPerSecond: previousSnapshot?._networkTotals ? Math.max(0, (networkTotals.rx - previousSnapshot._networkTotals.rx) / elapsedSeconds) : 0, networkTxBytesPerSecond: previousSnapshot?._networkTotals ? Math.max(0, (networkTotals.tx - previousSnapshot._networkTotals.tx) / elapsedSeconds) : 0, networkErrors: networkTotals.errors }, _networkTotals: networkTotals, _serviceCpuUsage: serviceCpuUsage, services: publicServiceRows, processes, logs: await journalRows() };
await mkdir(outputDir, { recursive: true, mode: 0o750 });
const snapshotPath = path.join(outputDir, "snapshot.json");
await writeFile(`${snapshotPath}.tmp`, JSON.stringify(snapshot), { mode: 0o640 });
await rename(`${snapshotPath}.tmp`, snapshotPath);
const historyPath = path.join(outputDir, "history.jsonl");
let history = [];
try { history = (await readFile(historyPath, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch {}
history.push({ schemaVersion: 1, capturedAt: snapshot.capturedAt, host: snapshot.host, services: publicServiceRows });
history = compactMonitoringHistory(history, { now: now.getTime() });
await writeFile(`${historyPath}.tmp`, `${history.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o640 });
await rename(`${historyPath}.tmp`, historyPath);
