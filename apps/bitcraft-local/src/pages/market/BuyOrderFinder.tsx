import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Package, ShoppingBag, TrendingUp } from "lucide-react";

import { RarityBadge, TierBadge } from "../../components/main/Badges";
import { ItemIcon, ItemLabel } from "../../components/main/ItemDisplay";
import { MiniStat } from "../../components/main/Stats";
import { useGameDataGeneration } from "../../hooks/useGameDataGeneration";
import { usePersistedState } from "../../hooks/usePersistedState";
import { toNumber, type AnyRecord } from "../../main-app-data";
import { updateQueryState } from "../../navigation";
import { createDelayedRefreshTask } from "../../refresh/pageRefresh.mjs";
import type { LoadState } from "../../types/app";
import { formatNumber, timeAgo } from "../../utils/format";
import {
  buyOrderQueryFromLocation,
  buyOrderSearchTransition,
  formatExactDecimalInteger,
  sumExactDecimalIntegers,
} from "./buyOrderFinderUtils";
import type { MarketRefreshProps } from "./globalMarket";
import { marketRequestCanCommit } from "./marketUi";

type BuyOrderFinderProps = MarketRefreshProps & {
  claimId: string;
  regionId: string;
  locationSearch: string;
  onQueryStateChange: () => void;
};

function freshnessAge(ageMs: unknown): string {
  const age = Number(ageMs);
  if (!Number.isFinite(age) || age < 0) return "age unavailable";
  if (age < 1_000) return "received just now";
  if (age < 60_000) return `received ${Math.floor(age / 1_000)}s ago`;
  return `received ${Math.floor(age / 60_000)}m ago`;
}

export function BuyOrderFinder({
  claimId,
  regionId,
  locationSearch,
  onQueryStateChange,
  refreshSequence,
  refreshHeaders,
  trackRefresh,
}: BuyOrderFinderProps) {
  const initial = buyOrderQueryFromLocation(locationSearch);
  const [search, setSearch] = React.useState(initial);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = usePersistedState("market.buyOrders.pageSize", "50");
  const [sort, setSort] = React.useState("unitPrice");
  const [direction, setDirection] = React.useState<"asc" | "desc">("desc");
  const [state, setState] = React.useState<LoadState<AnyRecord>>({
    data: null,
    error: null,
    loading: true,
  });
  const appliedLocationQuery = React.useRef(initial);
  const suppressQueryWrite = React.useRef<string | null>(null);
  const generationSequence = useGameDataGeneration(
    claimId,
    ["catalogs", "regional-market"],
  );
  const requestKey = JSON.stringify([
    claimId,
    regionId,
    search.trim(),
    page,
    pageSize,
    sort,
    direction,
    generationSequence,
    refreshSequence,
  ]);
  const requestKeyRef = React.useRef(requestKey);
  requestKeyRef.current = requestKey;

  React.useEffect(() => {
    const transition = buyOrderSearchTransition(appliedLocationQuery.current, locationSearch);
    if (!transition.changed) return;
    appliedLocationQuery.current = transition.search;
    suppressQueryWrite.current = transition.search;
    setSearch(transition.search);
    setPage(1);
  }, [locationSearch]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      if (suppressQueryWrite.current === search) {
        suppressQueryWrite.current = null;
        return;
      }
      const current = buyOrderQueryFromLocation(window.location.search);
      if (current === search) return;
      updateQueryState({ buyQ: search || null });
      onQueryStateChange();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [onQueryStateChange, search]);

  React.useEffect(() => {
    const controller = new AbortController();
    const refresh = createDelayedRefreshTask(() => {
      const params = new URLSearchParams({
        claimId,
        regionId: regionId || "all",
        search: search.trim(),
        page: String(page),
        pageSize: String(pageSize),
        sort,
        direction,
      });
      setState((current) => ({ ...current, error: null, loading: true }));
      return fetch(`/api/local/market/buy-orders?${params}`, {
        headers: refreshHeaders,
        signal: controller.signal,
      });
    }, 240);
    trackRefresh("buy-order-finder", refresh.promise)
      .then((response) => response.ok
        ? response.json()
        : Promise.reject(new Error(`buy orders HTTP ${response.status}`)))
      .then((payload) => {
        if (marketRequestCanCommit(requestKey, requestKeyRef.current, controller.signal.aborted)) {
          setState({ data: payload, error: null, loading: false });
        }
      })
      .catch((error) => {
        if (marketRequestCanCommit(requestKey, requestKeyRef.current, controller.signal.aborted)) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          }));
        }
      });
    return () => {
      refresh.cancel();
      controller.abort();
    };
  }, [
    claimId,
    direction,
    generationSequence,
    page,
    pageSize,
    requestKey,
    refreshHeaders,
    refreshSequence,
    regionId,
    search,
    sort,
    trackRefresh,
  ]);

  React.useEffect(() => setPage(1), [regionId]);

  const rows: AnyRecord[] = Array.isArray(state.data?.rows) ? state.data.rows : [];
  const opportunities: AnyRecord[] = Array.isArray(state.data?.opportunities) ? state.data.opportunities : [];
  const warnings: string[] = Array.isArray(state.data?.warnings) ? state.data.warnings.map(String).filter(Boolean) : [];
  const total = toNumber(state.data?.total);
  const pageCount = toNumber(state.data?.pageCount) || 1;
  const visibleDemand = sumExactDecimalIntegers(rows.map((order) => order.quantity));
  const visibleBuyValue = sumExactDecimalIntegers(rows.map((order) => order.totalValue));
  const regionLabel = regionId ? `R${regionId}` : "All active regions";
  const freshness = String(state.data?.freshness ?? "unavailable");

  function changeSort(nextSort: string) {
    if (sort === nextSort) {
      setDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSort(nextSort);
      setDirection(nextSort === "item" || nextSort === "buyer" || nextSort === "settlement" ? "asc" : "desc");
    }
    setPage(1);
  }

  function SortHeader({ id, children }: { id: string; children: React.ReactNode }) {
    const active = sort === id;
    return (
      <button className={`table-sort-button ${active ? "is-sorted" : ""}`} type="button" onClick={() => changeSort(id)}>
        {children}
        <span className="table-sort-indicator">{active ? (direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} />}</span>
      </button>
    );
  }

  return (
    <section className="price-finder buy-order-finder">
      <div className="command-filter-header price-finder-header">
        <span className="command-filter-title"><ShoppingBag size={15} /> Buy order lookup</span>
        <span>{state.loading ? "Updating live buy orders…" : `${formatNumber(total)} live buy orders`}</span>
      </div>
      <div className="price-finder-controls">
        <label className="research-filter-field price-item-search">
          <span>Search buy orders</span>
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Item, buyer, settlement, rarity…"
          />
        </label>
        <label className="research-filter-field price-page-size-field">
          <span>Rows</span>
          <select value={pageSize} onChange={(event) => { setPageSize(event.target.value); setPage(1); }}>
            <option value="25">25 per page</option>
            <option value="50">50 per page</option>
            <option value="100">100 per page</option>
          </select>
        </label>
      </div>
      {state.error ? <div className="error">Live buy orders unavailable: {state.error}. Last-good rows remain visible.</div> : null}
      {state.data ? (
        <div className={`info buy-order-freshness is-${freshness}`}>
          <strong>{freshness === "fresh" || freshness === "live" ? "Live Relay generation" : `${freshness} Relay generation`}</strong>
          <span>{freshnessAge(state.data.ageMs)}</span>
          {warnings.map((warning) => <span key={warning}>{warning}</span>)}
        </div>
      ) : null}
      <div className="metric-grid">
        <MiniStat icon={<ShoppingBag />} label="Current Buy Orders" value={formatNumber(total)} />
        <MiniStat icon={<Package />} label="Visible Demand" value={formatExactDecimalInteger(visibleDemand)} />
        <MiniStat icon={<TrendingUp />} label="Visible Buy Value" value={`${formatExactDecimalInteger(visibleBuyValue)}g`} />
      </div>
      <section className="buy-order-opportunities">
        <h3>
          <TrendingUp size={17} /> Best Opportunities
          <small>Requires 3+ same-region confirmed sales observed locally in the last 7 days</small>
        </h3>
        {state.data?.historyObservedSince ? (
          <p className="legend">Local confirmed-sale coverage begins {new Date(state.data.historyObservedSince).toLocaleString()}.</p>
        ) : (
          <p className="legend">Locally observed confirmed sales are still accumulating.</p>
        )}
        {opportunities.length ? (
          <div className="opportunity-strip">
            {opportunities.map((order) => (
              <article className="opportunity-card" key={order.orderKey}>
                <ItemIcon item={order} />
                <div>
                  <strong>{order.itemName}</strong>
                  <span>{formatExactDecimalInteger(order.unitPrice)}g buy order vs {formatExactDecimalInteger(order.averageUnitPrice)}g local average</span>
                  <small>{formatExactDecimalInteger(order.quantity)} wanted at {order.marketClaimName || `R${order.regionId}`}</small>
                </div>
                <b>{order.premiumPercent}% above 7d average</b>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state price-empty">
            <TrendingUp />
            No high-confidence opportunities yet. Current orders still appear in the table below.
          </div>
        )}
      </section>
      <section>
        <h3><ShoppingBag size={17} /> Current Buy Orders <small>{regionLabel}</small></h3>
        <div className="table-wrap" tabIndex={0} aria-label="Current buy orders table">
          <table>
            <thead>
              <tr>
                <th><SortHeader id="item">Item</SortHeader></th>
                <th><SortHeader id="tier">Tier</SortHeader></th>
                <th><SortHeader id="rarity">Rarity</SortHeader></th>
                <th><SortHeader id="region">Region</SortHeader></th>
                <th><SortHeader id="buyer">Buyer</SortHeader></th>
                <th><SortHeader id="settlement">Settlement</SortHeader></th>
                <th><SortHeader id="quantity">Qty</SortHeader></th>
                <th><SortHeader id="unitPrice">Unit Price</SortHeader></th>
                <th><SortHeader id="totalValue">Total Value</SortHeader></th>
                <th><SortHeader id="premium">Premium</SortHeader></th>
                <th><SortHeader id="lastSeen">Last Seen</SortHeader></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={order.orderKey}>
                  <td><ItemLabel item={order} /></td>
                  <td>{order.tier ? <TierBadge tier={order.tier} /> : "—"}</td>
                  <td>{order.rarity ? <RarityBadge rarity={order.rarity} /> : "—"}</td>
                  <td>{order.regionName || (order.regionId ? `R${order.regionId}` : "—")}</td>
                  <td>{order.buyerName || "—"}</td>
                  <td>{order.marketClaimName || "—"}</td>
                  <td>{formatExactDecimalInteger(order.quantity)}</td>
                  <td>{formatExactDecimalInteger(order.unitPrice)}g</td>
                  <td>{formatExactDecimalInteger(order.totalValue)}g</td>
                  <td>{order.premiumPercent == null ? <span className="muted">Insufficient local sales history</span> : `${order.premiumPercent}%`}</td>
                  <td>{order.lastSeen ? timeAgo(order.lastSeen) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? (
            <div className="empty-state price-empty">
              <ShoppingBag />
              {state.loading ? "Loading live buy orders…" : total ? "No buy orders match your search." : "No live buy orders are currently available for this region."}
            </div>
          ) : null}
        </div>
        <div className="pagination-row">
          <span>{formatNumber(total)} matching orders · page {page} of {pageCount}</span>
          <div>
            <button className="toolbar-button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
            <button className="toolbar-button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</button>
          </div>
        </div>
      </section>
    </section>
  );
}
