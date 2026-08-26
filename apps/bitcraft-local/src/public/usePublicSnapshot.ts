import React from "react";

import { loadPublicSnapshot, type PublicSnapshot } from "./api";
import { publicDomainsForRoute } from "./PublicClaimPages";
import { addRecentClaim } from "./preferences.mjs";
import { publicClaimPath, type PublicRoute } from "./routes.mjs";
import { createVisibleRefreshController } from "./visibleRefresh.mjs";

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function warning(value: unknown): string {
  const data = row(value);
  return String(data.message ?? data.code ?? value ?? "Some live data is incomplete.");
}

export type PublicSnapshotController = {
  claimId: string | null;
  snapshot: PublicSnapshot | null;
  claim: Record<string, unknown>;
  loading: boolean;
  refreshing: boolean;
  error: string;
  warnings: string[];
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
};

export function usePublicSnapshot(route: PublicRoute): PublicSnapshotController {
  const routeClaimId = route.params.claimId ?? "";
  const claimId = publicClaimPath({ claimId: routeClaimId }) ? routeClaimId : null;
  const domains = React.useMemo(() => publicDomainsForRoute(route.id), [route.id]);
  const requestKey = claimId && domains.length ? `${claimId}|${domains.join(",")}` : "";
  const activeRequestKey = React.useRef(requestKey);
  activeRequestKey.current = requestKey;
  const [snapshot, setSnapshot] = React.useState<PublicSnapshot | null>(null);
  const [loading, setLoading] = React.useState(Boolean(requestKey));
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
  const refreshRef = React.useRef<() => Promise<void>>(async () => {});

  const refresh = React.useCallback(async () => {
    if (!claimId || domains.length === 0 || !requestKey) return;
    const startedFor = requestKey;
    setLoading(true);
    setRefreshing(true);
    setError("");
    try {
      const next = await loadPublicSnapshot(claimId, domains);
      if (activeRequestKey.current !== startedFor) return;
      const receivedAt = new Date();
      setSnapshot(next);
      setLastUpdated(receivedAt);
      const nextClaim = row(row(next.domains.claim).data);
      const name = String(nextClaim.name ?? "").trim();
      if (name) addRecentClaim(window.localStorage, { claimId, name, regionId: next.regionId });
    } catch (reason) {
      if (activeRequestKey.current === startedFor) setError(reason instanceof Error ? reason.message : "Public data is temporarily unavailable.");
    } finally {
      if (activeRequestKey.current === startedFor) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [claimId, domains, requestKey]);
  refreshRef.current = refresh;

  React.useEffect(() => {
    setSnapshot(null);
    setLastUpdated(null);
    setError("");
    setLoading(Boolean(requestKey));
    setRefreshing(false);
    if (requestKey) void refresh();
  }, [refresh, requestKey]);

  React.useEffect(() => {
    const controller = createVisibleRefreshController({
      isVisible: () => document.visibilityState === "visible",
      refresh: () => refreshRef.current(),
    });
    const listener = () => controller.visibilityChanged();
    controller.start();
    document.addEventListener("visibilitychange", listener);
    return () => {
      document.removeEventListener("visibilitychange", listener);
      controller.stop();
    };
  }, []);

  const claim = row(row(snapshot?.domains.claim).data);
  const warnings = snapshot
    ? [
      ...snapshot.warnings.map(warning),
      ...Object.values(snapshot.domains).flatMap((domain) => domain.warnings.map(warning)),
    ]
    : [];

  return { claimId, snapshot, claim, loading, refreshing, error, warnings, lastUpdated, refresh };
}
