type PublicResponse<T> = T & { error?: string };

export type PublicHint = { claimId: string; name: string; regionId?: string; tier?: number };
export type PublicDomain<T> = { data: T | null; warnings: unknown[] };
export type PublicSnapshot = {
  claimId: string;
  regionId: string;
  receivedAt: string;
  stale: boolean;
  ageMs: number;
  warnings: unknown[];
  domains: Record<string, PublicDomain<unknown>>;
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal, headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({})) as PublicResponse<T>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Public data is temporarily unavailable.");
  return payload;
}

export function searchPublicClaims(query: string, signal?: AbortSignal) {
  return getJson<{ query: string; hints: PublicHint[]; stale: boolean; ageMs: number; warnings: unknown[] }>(
    `/api/public/settlements/search?q=${encodeURIComponent(query)}`,
    signal,
  );
}

export const searchPublicSettlements = searchPublicClaims;

export function loadPublicSnapshot(claimId: string, domains: string[], signal?: AbortSignal) {
  return getJson<PublicSnapshot>(
    `/api/public/settlements/${encodeURIComponent(claimId)}?domains=${encodeURIComponent(domains.join(","))}`,
    signal,
  );
}

export function searchPublicCatalog(query: string, signal?: AbortSignal) {
  return getJson<{ items?: unknown[]; cargos?: unknown[] }>(`/api/public/catalog/search?q=${encodeURIComponent(query)}`, signal);
}
