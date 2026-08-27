import type React from "react";

export type MarketAvailability = "any" | "sell" | "buy" | "both";

export function marketSuggestionResults<T>(items: T[], query: string, open: boolean): T[] {
  return open && query.trim().length >= 2 ? items.slice(0, 12) : [];
}

export function marketDetailLoadingState(loading = true) {
  return {
    loading,
    error: "",
    historyError: "",
    detail: null,
    history: null,
  };
}

export function marketDetailRequestPlan(hasSelectedItem: boolean, detailTab: "orders" | "stats") {
  return {
    orderBook: hasSelectedItem,
    priceHistory: hasSelectedItem && detailTab === "stats",
  };
}

export function marketRequestCanCommit(requestKey: string, currentKey: string, aborted: boolean): boolean {
  return !aborted && requestKey === currentKey;
}

export function availabilityFlags(value: MarketAvailability) {
  return {
    availableOnly: value !== "any",
    hasSell: value === "sell" || value === "both",
    hasBuy: value === "buy" || value === "both",
  };
}

export function nextOptionIndex(current: number, count: number, key: string): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  return current;
}

export function nextTabIndex(current: number, count: number, key: string): number {
  if (current < 0 || count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "ArrowRight") return (current + 1) % count;
  return current;
}

export function handleTablistKeyDown(event: React.KeyboardEvent<HTMLDivElement>, onActivate: (index: number, button: HTMLButtonElement) => void): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = nextTabIndex(current, buttons.length, event.key);
  const button = buttons[next];
  if (!button) return;
  event.preventDefault();
  button.focus();
  onActivate(next, button);
}

export type MarketChartPoint = {
  x: number;
  y: number;
  price: string;
  label: string;
};

export function exactMarketInteger(value: unknown): bigint {
  const normalized = String(value ?? "0").trim();
  return /^\d+$/.test(normalized) ? BigInt(normalized) : 0n;
}

export function marketChartPoints(rows: Array<Record<string, unknown>>, width: number, height: number): MarketChartPoint[] {
  const values = rows.map((row) => ({
    price: String(row.vwap ?? row.avgPrice ?? row.price ?? "").trim(),
    label: String(row.bucket ?? row.timestamp ?? row.createdAt ?? ""),
  })).filter((row) => /^\d+$/.test(row.price));
  if (!values.length) return [];
  const prices = values.map((row) => exactMarketInteger(row.price));
  const low = prices.reduce((best, price) => price < best ? price : best);
  const high = prices.reduce((best, price) => price > best ? price : best);
  const spread = high - low;
  return values.map((row, index) => {
    const relative = exactMarketInteger(row.price) - low;
    const scaledY = spread === 0n ? height / 2 : height - Number((relative * BigInt(Math.round(height * 1_000))) / spread) / 1_000;
    return {
      ...row,
      x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
      y: scaledY,
    };
  });
}
