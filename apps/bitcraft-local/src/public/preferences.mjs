import { publicStorageKey } from "./routes.mjs";

const MAX_RECENT_SETTLEMENTS = 8;
const U64_MAX = 18_446_744_073_709_551_615n;

function canonicalClaimId(value) {
  const claimId = String(value ?? "");
  if (!/^(0|[1-9]\d*)$/.test(claimId) || BigInt(claimId) > U64_MAX) return null;
  return claimId;
}

function validSegment(value, label) {
  const segment = String(value ?? "").trim();
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(segment)) throw new Error(`${label} must be a safe preference segment`);
  return segment;
}

export function settlementPreferenceKey(claimIdValue, suffix) {
  const claimId = canonicalClaimId(claimIdValue);
  if (!claimId) throw new Error("Claim ID must be a canonical unsigned 64-bit decimal string");
  return publicStorageKey(`settlement.${claimId}.${validSegment(suffix, "Preference suffix")}`);
}

export function readRecentSettlements(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(publicStorageKey("recent-settlements")) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.flatMap((value) => {
      const claimId = canonicalClaimId(value?.claimId);
      const name = String(value?.name ?? "").trim();
      const regionId = String(value?.regionId ?? "").trim();
      if (!claimId || !name || seen.has(claimId)) return [];
      seen.add(claimId);
      return [{ claimId, name, regionId }];
    }).slice(0, MAX_RECENT_SETTLEMENTS);
  } catch {
    return [];
  }
}

export function addRecentSettlement(storage, settlement) {
  const claimId = canonicalClaimId(settlement?.claimId);
  const name = String(settlement?.name ?? "").trim();
  if (!claimId || !name) return readRecentSettlements(storage);
  const next = [
    { claimId, name, regionId: String(settlement.regionId ?? "").trim() },
    ...readRecentSettlements(storage).filter((entry) => entry.claimId !== claimId),
  ].slice(0, MAX_RECENT_SETTLEMENTS);
  try {
    storage?.setItem?.(publicStorageKey("recent-settlements"), JSON.stringify(next));
  } catch {
    // Preference storage is optional; public data rendering must continue.
  }
  return next;
}

export const readRecentClaims = readRecentSettlements;
export const addRecentClaim = addRecentSettlement;
export const claimPreferenceKey = settlementPreferenceKey;
