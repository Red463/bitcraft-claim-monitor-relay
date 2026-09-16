import assert from "node:assert/strict";
import test from "node:test";
import { checkRecovery, waitForRecovery } from "../verify-relay-schema-recovery.mjs";

const revision = "a".repeat(40);
const since = "2026-09-16T12:00:00.000Z";
const now = Date.parse("2026-09-16T12:01:00.000Z");
const fresh = "2026-09-16T12:00:30.000Z";
const good = { health: { ok: true, buildSha: revision.slice(0,12) }, generations: { claim: { generation: 2, generatedAt: fresh, changedDomains: ["claim"] }, players: { generation: 3, generatedAt: fresh, changedDomains: ["players"] } }, map: { freshness: "live", generatedAt: fresh, generation: 1, layerAvailability: { resources: { available: true, status: "live" } } } };
test("recovery requires fresh individual generations and live map, not just HTTP health", () => {
  const options = { revision, since, now, domains: ["claim", "players"] };
  assert.equal(checkRecovery(good, options).ok, true);
  for (const mutate of [s => s.health.buildSha = "b".repeat(12), s => s.generations.claim.generatedAt = "2026-09-15T00:00:00Z", s => delete s.generations.players, s => s.generations.players.changedDomains = [], s => s.map.freshness = "partial", s => s.map.layerAvailability.resources.available = false, s => s.map.generation = 0, s => s.map.generatedAt = "2026-09-15T00:00:00Z", s => s.generations.claim.generatedAt = "2027-01-01T00:00:00Z"]) {
    const sample = structuredClone(good); mutate(sample);
    assert.equal(checkRecovery(sample, options).ok, false);
  }
});
test("recovery is bounded and waits for two consecutive healthy samples", async () => {
  let attempts = 0, clock = now;
  const result = await waitForRecovery({ revision, since, domains: ["claim", "players"], now: () => clock, sleep: async ms => { clock += ms; }, sample: async () => { attempts++; if (attempts === 1) throw Error("HTTP 503"); return good; }, timeoutMs: 5000, intervalMs: 1000 });
  assert.equal(result.ok, true);
  assert.equal(attempts, 3);
  await assert.rejects(waitForRecovery({ revision, since, domains: ["claim", "players"], now: () => clock, sleep: async ms => { clock += ms; }, sample: async () => ({ ...good, map: null }), timeoutMs: 2000, intervalMs: 1000 }), /recovery/i);
});
