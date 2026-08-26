export type RecentSettlement = { claimId: string; name: string; regionId: string };
export type RecentClaim = RecentSettlement;
export function settlementPreferenceKey(claimIdValue: unknown, suffix: unknown): string;
export function readRecentSettlements(storage: Pick<Storage, "getItem">): RecentSettlement[];
export function addRecentSettlement(
  storage: Pick<Storage, "getItem" | "setItem">,
  settlement: { claimId?: unknown; name?: unknown; regionId?: unknown },
): RecentSettlement[];
export const claimPreferenceKey: typeof settlementPreferenceKey;
export const readRecentClaims: typeof readRecentSettlements;
export const addRecentClaim: typeof addRecentSettlement;
