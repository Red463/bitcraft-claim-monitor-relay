import assert from "node:assert/strict";
import test from "node:test";

import { serviceCpuPercent, serviceIsRequired } from "../../deploy/server-health-cpu.mjs";

test("service CPU derives one-minute usage from cumulative systemd counters", () => {
  assert.equal(serviceCpuPercent({ currentUsageNSec: 25_000_000_000, previousUsageNSec: 10_000_000_000, elapsedSeconds: 30, cores: 4 }), 50);
  assert.equal(serviceCpuPercent({ currentUsageNSec: 5, previousUsageNSec: 10, elapsedSeconds: 30, cores: 4 }), 0);
  assert.equal(serviceCpuPercent({ currentUsageNSec: 40_000_000_000, previousUsageNSec: 0, elapsedSeconds: 10, cores: 2 }), 200);
});

test("inactive batch generators are observed without becoming required services", () => {
  assert.equal(serviceIsRequired("bitcraft-claim-monitor-relay"), true);
  assert.equal(serviceIsRequired("caddy"), true);
  assert.equal(serviceIsRequired("bitcraft-claim-monitor-relay-map-terrain"), false);
  assert.equal(serviceIsRequired("bitcraft-claim-monitor-relay-map-roads.service"), false);
});

