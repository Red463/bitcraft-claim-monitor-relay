import { execFile as execFileCallback } from "node:child_process";
import { access, readFile, readdir, readlink } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import { classifyNativeMapUnitFailure } from "./native-map-unit-failure.mjs";

const execFile = promisify(execFileCallback);
const DATA_DIR = "/var/lib/bitcraft-claim-monitor-relay";
const SERVICE = "bitcraft-claim-monitor-relay.service";
const TERRAIN_SERVICE = "bitcraft-claim-monitor-relay-map-terrain.service";
const ROAD_SERVICE = "bitcraft-claim-monitor-relay-map-roads.service";

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function versionCount(directory) {
  try {
    return (await readdir(path.join(directory, "versions"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

async function status(origin) {
  try {
    const response = await fetch(`${origin}/api/local/map/tiles/status`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const value = response.ok ? await response.json() : null;
    return {
      httpStatus: response.status,
      terrain: Boolean(value?.available),
      terrainGeneration: value?.generation == null ? null : String(value.generation),
      terrainTiles: Number(value?.tileCount ?? 0),
      roads: Boolean(value?.roads?.available),
      roadGeneration: value?.roads?.generation == null ? null : String(value.roads.generation),
      roadTiles: Number(value?.roads?.tileCount ?? 0),
    };
  } catch (error) {
    return { httpStatus: null, terrain: false, roads: false, error: error?.name ?? "Error" };
  }
}

async function unitSummary(service, scriptName) {
  const { stdout } = await execFile("systemctl", ["show", service, "--property=Environment,ExecStart,Result,ExecMainStatus"]);
  return {
    dataDirPinned: stdout.includes(`BITCRAFT_LOCAL_DATA_DIR=${DATA_DIR}`),
    scriptPinned: stdout.includes(`/opt/bitcraft-claim-monitor-relay/current/apps/bitcraft-local/scripts/${scriptName}`),
    successful: /(?:^|\n)Result=success(?:\n|$)/.test(stdout) && /(?:^|\n)ExecMainStatus=0(?:\n|$)/.test(stdout),
  };
}

async function unitFailure(service) {
  try {
    const { stdout, stderr } = await execFile("journalctl", ["--no-pager", "--output=cat", "--unit", service, "--lines=200"]);
    return classifyNativeMapUnitFailure(`${stdout}\n${stderr}`);
  } catch (error) {
    return classifyNativeMapUnitFailure(`${error?.stdout ?? ""}\n${error?.stderr ?? ""}`);
  }
}

async function main() {
  const { stdout: pidOutput } = await execFile("systemctl", ["show", SERVICE, "--property=MainPID", "--value"]);
  const pid = Number(pidOutput.trim());
  const environment = Number.isSafeInteger(pid) && pid > 0
    ? (await readFile(`/proc/${pid}/environ`)).toString().split("\0")
    : [];
  const current = await readlink("/opt/bitcraft-claim-monitor-relay/current");
  const terrainRoot = path.join(DATA_DIR, "map-tiles");
  const roadRoot = path.join(DATA_DIR, "map-road-tiles");
  const releaseDataRoot = "/opt/bitcraft-claim-monitor-relay/current/apps/bitcraft-local/data";
  const terrainUnit = await unitSummary(TERRAIN_SERVICE, "build-relay-terrain-world.mjs");
  const roadUnit = await unitSummary(ROAD_SERVICE, "build-relay-road-world.mjs");
  if (!roadUnit.successful) roadUnit.failure = await unitFailure(ROAD_SERVICE);
  const result = {
    activeRevision: path.basename(current),
    webProcessRunning: pid > 0,
    webDataDirPinned: environment.includes(`BITCRAFT_LOCAL_DATA_DIR=${DATA_DIR}`),
    terrainPointer: await exists(path.join(terrainRoot, "current.json")),
    terrainVersions: await versionCount(terrainRoot),
    roadPointer: await exists(path.join(roadRoot, "current.json")),
    roadVersions: await versionCount(roadRoot),
    terrainUnit,
    roadUnit,
    releaseDataTerrainPointer: await exists(path.join(releaseDataRoot, "map-tiles", "current.json")),
    releaseDataRoadPointer: await exists(path.join(releaseDataRoot, "map-road-tiles", "current.json")),
    local: await status("http://127.0.0.1:19430"),
    canonical: await status("https://app.timbersteeltrade.com"),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Native map serving diagnostics failed: ${error?.name ?? "Error"}\n`);
  process.exitCode = 1;
});
