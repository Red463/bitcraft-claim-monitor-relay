import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

export const recoveryDomains = ["claim", "players", "region-claims", "regional-market", "public-crafts", "empires"];

export function checkRecovery(sample, { revision, since, now = Date.now(), domains = recoveryDomains }) {
  const reasons = [];
  const started = Date.parse(since);
  if (!/^[a-f0-9]{40}$/.test(revision) || !Number.isFinite(started) || !domains.length) throw new Error("Invalid recovery configuration.");
  const fresh = value => { const time = Date.parse(value); return Number.isFinite(time) && time >= started && time <= now + 5000 && now - time <= 300_000; };
  const sha = sample.health?.buildSha ?? "";
  if (sample.health?.ok !== true || !/^[a-f0-9]{12,40}$/.test(sha) || !revision.startsWith(sha)) reasons.push("deployed revision");
  for (const domain of domains) {
    const row = sample.generations?.[domain];
    if (!(row?.generation > 0) || !row.changedDomains?.includes(domain) || !fresh(row.generatedAt)) reasons.push(`${domain} generation`);
  }
  if (!(sample.map?.generation > 0) || sample.map?.freshness !== "live" || !fresh(sample.map.generatedAt)
    || sample.map.layerAvailability?.resources?.available !== true) reasons.push("live map resources");
  return { ok: reasons.length === 0, reasons };
}

export async function waitForRecovery({ sample, revision, since, domains = recoveryDomains, now = Date.now, sleep: pause = sleep, timeoutMs = 600_000, intervalMs = 15_000 }) {
  checkRecovery({}, { revision, since, now: now(), domains });
  if (!(timeoutMs > 0) || !(intervalMs > 0)) throw new Error("Invalid recovery timing.");
  const deadline = now() + timeoutMs;
  let consecutive = 0, last = { reasons: ["no samples"] };
  while (now() < deadline) {
    try { last = checkRecovery(await sample(), { revision, since, now: now(), domains }); }
    catch { last = { ok: false, reasons: ["recovery endpoint unavailable"] }; }
    consecutive = last.ok ? consecutive + 1 : 0;
    if (consecutive >= 2) return last;
    await pause(intervalMs);
  }
  throw new Error(`Schema recovery was not confirmed: ${last.reasons.join(", ")}`);
}

async function main() {
  const { SCHEMA_APP_ORIGIN: origin, SCHEMA_CLAIM_ID: claimId, SCHEMA_REGION_ID: regionId, SCHEMA_RESOURCE_ID: resourceId = "54", SCHEMA_EXPECTED_REVISION: revision, SCHEMA_DEPLOY_STARTED_AT: since } = process.env;
  if (!/^\d+$/.test(claimId ?? "") || !/^\d+$/.test(regionId ?? "") || !/^\d+$/.test(resourceId) || new URL(origin).protocol !== "https:") throw new Error("Configure the HTTPS app origin and decimal claim/region/resource IDs.");
  const get = async path => {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(20_000), cache: "no-store" });
    if (!response.ok) throw new Error(`Recovery endpoint HTTP ${response.status}`);
    return response.json();
  };
  await waitForRecovery({ revision, since, sample: async () => {
    const [health, map, ...generations] = await Promise.all([
      get("/api/local/health"),
      get(`/api/local/map/snapshot?regions=${regionId}&layers=resources&resourceIds=${resourceId}`),
      ...recoveryDomains.map(domain => get(`/api/local/game-data/generation?claimId=${claimId}&domains=${domain}`)),
    ]);
    return { health, map, generations: Object.fromEntries(recoveryDomains.map((domain, index) => [domain, generations[index]])) };
  } });
  console.log("Verified deployed revision, fresh settlement generations and live map resources in two consecutive samples.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
