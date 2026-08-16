import type { ActivePanel } from "../types/app";

export type PageId = ActivePanel;
export type NavigationMode = "push" | "replace";
export type GlobalMarketViewId = "overview" | "browse" | "deals" | "buy-orders" | "deal-watch" | "stalls";
export type SettlementMarketViewId = "live" | "analytics";

const LEGACY_PAGE_ALIASES: Readonly<Record<string, PageId>> = {
  buildings: "dashboard",
  overview: "dashboard",
  production: "craft-monitor",
  empire: "region",
};

export function canonicalPageId(page: string | null): string | null {
  if (!page) return null;
  return LEGACY_PAGE_ALIASES[page] ?? page;
}

export type MarketViewLocation = {
  page: "market" | "settlement-market";
  view: GlobalMarketViewId | SettlementMarketViewId;
  canonicalTab: string;
  shouldReplace: boolean;
};

function locationHref(): string {
  const url = new URL(window.location.href);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function writeQueryLocation(values: Record<string, string | null>, mode: NavigationMode): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  const nextHref = `${url.pathname}${url.search}${url.hash}`;
  if (nextHref === locationHref()) return;
  window.history[mode === "push" ? "pushState" : "replaceState"](null, "", nextHref);
}

export function writePageLocation(page: PageId, mode: NavigationMode): void {
  writeQueryLocation({ page }, mode);
}

export function isDedicatedMapView(search: string): boolean {
  const query = new URLSearchParams(search);
  return query.get("page") === "map" && query.get("mapView") === "fullscreen";
}

export function dedicatedMapHref(href: string): string {
  const url = new URL(href);
  url.searchParams.set("page", "map");
  url.searchParams.set("mapView", "fullscreen");
  return url.toString();
}

export function resolveAllowedView<T extends string>(requested: T, allowed: readonly T[]): T | null {
  if (!allowed.length) return null;
  return allowed.includes(requested) ? requested : allowed[0];
}

export function marketViewLocation(tab: string | null): MarketViewLocation {
  if (tab === "live" || tab === "analytics") {
    return { page: "settlement-market", view: tab, canonicalTab: tab, shouldReplace: true };
  }
  if (tab === "pricing") {
    return { page: "market", view: "browse", canonicalTab: "browse", shouldReplace: true };
  }
  if (tab === "deal-watchlist" || tab === "dealWatchlist") {
    return { page: "market", view: "deal-watch", canonicalTab: "deal-watch", shouldReplace: true };
  }
  if (tab === "buyOrders") {
    return { page: "market", view: "buy-orders", canonicalTab: "buy-orders", shouldReplace: true };
  }
  if (tab === "overview" || tab === "browse" || tab === "deals" || tab === "buy-orders" || tab === "deal-watch" || tab === "stalls") {
    return { page: "market", view: tab, canonicalTab: tab, shouldReplace: false };
  }
  return { page: "market", view: "browse", canonicalTab: "browse", shouldReplace: true };
}

export function settlementMarketViewLocation(tab: string | null): MarketViewLocation {
  if (tab === "live" || tab === "analytics") {
    return { page: "settlement-market", view: tab, canonicalTab: tab, shouldReplace: false };
  }
  return { page: "settlement-market", view: "live", canonicalTab: "live", shouldReplace: true };
}
