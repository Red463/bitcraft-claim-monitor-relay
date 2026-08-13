import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployRoot = new URL("../../deploy/", import.meta.url);

test("terrain and road generation timers use the approved off-peak cadence", async () => {
  const [terrainTimer, roadTimer] = await Promise.all([
    readFile(new URL("bitcraft-claim-monitor-relay-map-terrain.timer", deployRoot), "utf8"),
    readFile(new URL("bitcraft-claim-monitor-relay-map-roads.timer", deployRoot), "utf8"),
  ]);
  assert.match(terrainTimer, /OnCalendar=Sun \*-\*-\* 03:10:00/);
  assert.match(roadTimer, /OnCalendar=\*-\*-\* 02:10:00/);
  for (const timer of [terrainTimer, roadTimer]) {
    assert.match(timer, /Persistent=true/);
    assert.match(timer, /RandomizedDelaySec=15m/);
  }
});

test("map generation services share one non-blocking lock and strict resource controls", async () => {
  const services = await Promise.all([
    readFile(new URL("bitcraft-claim-monitor-relay-map-terrain.service", deployRoot), "utf8"),
    readFile(new URL("bitcraft-claim-monitor-relay-map-roads.service", deployRoot), "utf8"),
  ]);
  for (const service of services) {
    assert.match(service, /MemoryHigh=60%/);
    assert.match(service, /MemoryMax=70%/);
    assert.match(service, /Nice=10/);
    assert.match(service, /CPUWeight=20/);
    assert.match(service, /IOWeight=10/);
    assert.match(service, /RuntimeMaxSec=3h/);
    assert.match(service, /flock -n \/run\/lock\/bitcraft-claim-monitor-relay-map-generation\.lock/);
    assert.match(service, /BITCRAFT_LOCAL_DATA_DIR=\/var\/lib\/bitcraft-claim-monitor-relay/);
  }
  assert.match(services[0], /build-relay-terrain-world\.mjs/);
  assert.match(services[1], /build-relay-road-world\.mjs/);
});
