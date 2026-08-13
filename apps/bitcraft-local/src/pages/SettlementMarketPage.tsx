import React from "react";
import "../styles/market.css";
import {
  Activity,
  AlertTriangle,
  Bell,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Box,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ExternalLink,
  Factory,
  Globe2,
  GraduationCap,
  Hammer,
  Lock,
  Map as MapIcon,
  MapPin,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  RefreshCw,
  Save,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
  User,
  Wrench,
  X,
} from "lucide-react";
import { RarityBadge, TierBadge, TrackedOwnerName } from "../components/main/Badges";
import { DataTable } from "../components/main/DataTable";
import { AsyncState } from "../components/main/AsyncState";
import { ItemIcon, ItemLabel, TierMaterialIcon } from "../components/main/ItemDisplay";
import { SearchBox } from "../components/main/SearchBox";
import { Segmented } from "../components/main/Segmented";
import { MiniStat } from "../components/main/Stats";
import {
  buildConstructionProjects,
  toNumber,
  unwrap,
  type AnyRecord,
} from "../main-app-data";
import {
  dateLabel,
  formatCompactNumber,
  formatCurrentSession,
  formatDuration,
  formatEquipmentSlot,
  formatNumber,
  shortDateLabel,
  timeAgo,
  timestampMs,
} from "../utils/format";
import { mapWithBrowserConcurrency } from "../utils/concurrency";
import { activeRegionLabel, useActiveRegions } from "../hooks/useActiveRegions";
import { hasPersistedState, usePersistedState } from "../hooks/usePersistedState";
import { settlementMarketTitle } from "../navigation/navigationLabels";
import { getTrackedOwnerName } from "../utils/ownership";
import { isMarketableItem, playerToolbeltTools } from "../utils/items";
import { memberDisplayName, memberTrackingId } from "../utils/memberIdentity";
import { normalizeData } from "../utils/normalize";
import { unique } from "../utils/array";
import { SKILL_IDS, SKILL_NAMES, TOOL_TAG_BY_TYPE } from "../utils/professions";
import { updateQueryState } from "../navigation";
import { resolveAllowedView, settlementMarketViewLocation, type SettlementMarketViewId } from "../navigation/routeState.ts";
import { effectiveTargetAllowed, targetIdForTab, type EffectiveAccess } from "../access/accessControl.mjs";
import { trackAnalyticsEvent } from "../utils/analytics";
import type { ActivePanel, LoadState } from "../types/app";
import { useManualRefresh } from "../refresh/ManualRefreshContext";
import { manualRefreshHeaders } from "../refresh/manualRefresh.mjs";
import { mapResourceCategory, mapResourceToken, normalizeMapResourceToken, type MapFocus } from "./map/mapUtils";
import { BEST_SELLER_SORTS, bestSellerSortValue, buildMarketRangeAnalytics, formatMarketDay, type BestSellerSortKey } from "./market/marketAnalytics";
import { displayItemName, listingDate, listingTrackingKey, liveDaysSince, safeDisplayJson, settlementListingState } from "./market/listingUtils";

/*
 * Main application pages that still share a large amount of display logic.
 *
 * AppShell passes normalized provider data and locally observed history into
 * these pages. Page components contact only provider-neutral local routes.
 */

const LOCAL_API = "/api/local";
function BestSellersLeaderboard({ rows, itemMeta }: { rows: AnyRecord[]; itemMeta: Map<string, AnyRecord> }) {
  const [sort, setSort] = React.useState<BestSellerSortKey>("units");
  const sortedRows = React.useMemo(
    () => [...rows].sort((a, b) => bestSellerSortValue(b, sort) - bestSellerSortValue(a, sort)),
    [rows, sort],
  );
  const featured = sortedRows.slice(0, 3);
  const remaining = sortedRows.slice(3);

  if (!sortedRows.length) {
    return (
      <div className="market-best-empty">
        <Star size={24} />
        <strong>No confirmed best sellers yet</strong>
        <span>Confirmed sales will appear here when an authoritative completed-trade signal is available for this selection.</span>
      </div>
    );
  }

  const renderItem = (row: AnyRecord, index: number, variant: "featured" | "compact") => {
    const itemName = String(row.itemName ?? row.item_name ?? row.name ?? "Unknown item");
    const meta = itemMeta.get(itemName) ?? {};
    const item: AnyRecord = { ...meta, ...row, name: itemName, itemName };
    const tier = item.itemTier ?? item.tier;
    const rarity = item.itemRarityStr ?? item.rarity;
    const rank = index + 1;
    return (
      <article className={`market-best-row ${variant}`} key={`${itemName}-${rank}`}>
        <span className={`market-best-rank rank-${rank}`}>#{rank}</span>
        <ItemIcon item={item} />
        <div className="market-best-name">
          <strong>{itemName}</strong>
          <span>
            {tier ? <TierBadge tier={tier} /> : null}
            {rarity ? <RarityBadge rarity={rarity} /> : null}
            <small title={dateLabel(row.lastSoldAt)}>Last trade {timeAgo(row.lastSoldAt)}</small>
          </span>
        </div>
        <div className="market-best-stats">
          <span><b>{formatNumber(row.unitsSold)}</b><small>units</small></span>
          <span><b>{formatCompactNumber(row.totalValue)}</b><small>revenue</small></span>
          <span><b>{formatNumber(row.avgUnitPrice)}g</b><small>avg</small></span>
          <span><b>{formatNumber(row.salesCount)}</b><small>sales</small></span>
        </div>
      </article>
    );
  };

  return (
    <div className="market-best-leaderboard">
      <div className="market-best-toolbar" aria-label="Best sellers ranking controls">
        <span>Ranked by</span>
        <div>
          {BEST_SELLER_SORTS.map((option) => (
            <button key={option.key} type="button" className={sort === option.key ? "active" : ""} onClick={() => setSort(option.key)} aria-pressed={sort === option.key}>
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="market-best-featured">
        {featured.map((row, index) => renderItem(row, index, "featured"))}
      </div>
      {remaining.length ? (
        <div className="market-best-compact">
          {remaining.map((row, index) => renderItem(row, index + featured.length, "compact"))}
        </div>
      ) : null}
    </div>
  );
}
export function SettlementMarket({ data, history, claimId, access, locationSearch, listingsLoading = false, listingError = null, onQueryStateChange }: { data: ReturnType<typeof normalizeData>; history: AnyRecord | null; claimId: string; access?: EffectiveAccess | null; locationSearch: string; listingsLoading?: boolean; listingError?: string | null; onQueryStateChange: () => void }) {
  const { request, trackPromise } = useManualRefresh();
  const [q, setQ] = React.useState("");
  const [view, setView] = usePersistedState<SettlementMarketViewId>("settlementMarket.view", "live");
  const [tab, setTab] = React.useState<"sell" | "buy">("sell");
  const [tier, setTier] = usePersistedState("market.tier", "All");
  const [rarity, setRarity] = usePersistedState("market.rarity", "All");
  const [memberFilter, setMemberFilter] = usePersistedState("market.member", "All");
  const [memberHistory, setMemberHistory] = React.useState<AnyRecord | null>(null);
  const marketViews = React.useMemo(() => [
    { id: "live" as const, label: "Live Listings", icon: <ShoppingCart size={15} /> },
    { id: "analytics" as const, label: "Analytics", icon: <TrendingUp size={15} /> },
  ].filter((entry) => effectiveTargetAllowed(access, targetIdForTab("settlement-market", entry.id))), [access]);
  const resolvedView = resolveAllowedView(view, marketViews.map((entry) => entry.id));
  React.useEffect(() => {
    if (!resolvedView || resolvedView === view) return;
    setView(resolvedView);
    updateQueryState({ page: "settlement-market", tab: resolvedView });
    onQueryStateChange();
  }, [onQueryStateChange, resolvedView, setView, view]);
  const locationView = React.useMemo(() => settlementMarketViewLocation(new URLSearchParams(locationSearch).get("tab")), [locationSearch]);
  React.useEffect(() => {
    if (locationView.view) setView(locationView.view as SettlementMarketViewId);
    if (locationView.shouldReplace) {
      updateQueryState({ page: "settlement-market", tab: locationView.canonicalTab });
      onQueryStateChange();
    }
  }, [locationSearch, locationView, onQueryStateChange, setView]);
  const selectView = (next: SettlementMarketViewId) => {
    setView(next);
    updateQueryState({ page: "settlement-market", tab: next }, "push");
    onQueryStateChange();
    trackAnalyticsEvent("market_tab_viewed", { tab: next });
  };
  const memberOptions = React.useMemo(() => {
    const names = [
      ...data.members.map((member) => member.userName ?? member.username ?? member.playerUsername ?? member.name),
      ...data.market.map((listing) => listing.ownerUsername ?? listing.owner ?? listing.ownerName),
    ].filter(Boolean).map(String);
    return unique(names).sort((a, b) => a.localeCompare(b));
  }, [data.members, data.market]);
  const ownerMatches = React.useCallback((owner: unknown) => memberFilter === "All" || String(owner ?? "").toLowerCase() === memberFilter.toLowerCase(), [memberFilter]);
  const all = data.market.filter((listing) => ownerMatches(listing.ownerUsername ?? listing.owner ?? listing.ownerName));
  React.useEffect(() => {
    if (memberFilter === "All") {
      setMemberHistory(null);
      return;
    }
    const controller = new AbortController();
    if (!request) setMemberHistory(null);
    const refresh = fetch(`${LOCAL_API}/market/history?claimId=${encodeURIComponent(claimId)}&limit=120&owner=${encodeURIComponent(memberFilter)}`, { headers: manualRefreshHeaders(request, "settlement-market"), signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`market history HTTP ${response.status}`)))
      .then((result) => setMemberHistory(result));
    void trackPromise("market-member-history", refresh)
      .catch(() => {
        if (!controller.signal.aborted) setMemberHistory((current: AnyRecord | null) => current ?? { sales: [], topItems: [], daily: [], totals: {} });
      });
    return () => controller.abort();
  }, [claimId, memberFilter, history, request?.sequence, trackPromise]);
  const analytics = memberFilter === "All" ? history : memberHistory;
  const apiTrades: AnyRecord[] = (analytics?.sales ?? [])
    .map((event: AnyRecord) => {
      const raw = safeDisplayJson(event.raw_json) ?? {};
      return {
        id: event.id,
        itemName: event.item_name,
        name: event.item_name,
        itemId: event.itemId ?? event.item_id,
        itemType: event.itemType ?? event.item_type,
        iconAssetName: event.iconAssetName ?? raw.iconAssetName,
        quantity: event.quantity,
        unitPrice: event.price,
        totalPrice: event.total_value,
        sellerUsername: event.owner,
        purchaserUsername: raw.purchaserUsername,
        itemTier: event.tier ?? raw.itemTier,
        itemRarityStr: event.rarity ?? raw.itemRarityStr,
        timestamp: event.occurred_at,
      };
    })
    .sort((a: AnyRecord, b: AnyRecord) => String(b.timestamp).localeCompare(String(a.timestamp)));
  const marketItemMeta = React.useMemo(() => {
    const entries = [...data.market, ...apiTrades].map((item: AnyRecord) => [String(item.itemName ?? item.name ?? ""), item] as const);
    return new Map(entries.filter(([name]) => Boolean(name)));
  }, [apiTrades, data.market]);
  const trackedLiveListings = React.useMemo(
    () => new Map<string, AnyRecord>((history?.liveListings ?? []).map((listing: AnyRecord) => [String(listing.listing_key), listing])),
    [history?.liveListings],
  );
  const listingListedAt = (listing: AnyRecord) => listingDate(listing, trackedLiveListings.get(listingTrackingKey(listing))?.first_seen);
  const sellOrders = all.filter((m) => String(m.side ?? m.orderType ?? "sell").toLowerCase().includes("sell"));
  const buyOrders = all.filter((m) => String(m.side ?? m.orderType ?? "").toLowerCase().includes("buy"));
  const current = tab === "sell" ? (sellOrders.length ? sellOrders : all) : buyOrders;
  const tiers = unique(all.map((m) => String(m.itemTier ?? m.tier)).filter((value) => value && value !== "undefined"));
  const rarities = unique(all.map((m) => m.itemRarityStr ?? m.rarity).filter(Boolean));
  const rows = current.filter((m) => {
    if (q && !String(m.itemName ?? "").toLowerCase().includes(q.toLowerCase())) return false;
    if (tier !== "All" && String(m.itemTier ?? m.tier) !== tier) return false;
    if (rarity !== "All" && (m.itemRarityStr ?? m.rarity) !== rarity) return false;
    return true;
  });
  const renderedRows = rows.slice(0, 500);
  const emptyListingState = settlementListingState({
    loading: listingsLoading,
    error: listingError,
    totalListings: data.market.length,
    visibleListings: rows.length,
  });
  const highest = [...all].sort((a, b) => toNumber(b.price) * toNumber(b.quantity || 1) - toNumber(a.price) * toNumber(a.quantity || 1)).slice(0, 3);
  const saleEvents = apiTrades.map((trade: AnyRecord) => ({
    itemName: trade.itemName,
    item_name: trade.itemName,
    itemId: trade.itemId,
    item_id: trade.itemId,
    itemType: trade.itemType,
    item_type: trade.itemType,
    quantity: trade.quantity,
    price: trade.unitPrice,
    totalValue: trade.totalPrice,
    total_value: trade.totalPrice,
    occurredAt: trade.timestamp ?? trade.createdAt,
    occurred_at: trade.timestamp ?? trade.createdAt,
  }));
  const marketRange = buildMarketRangeAnalytics(saleEvents, new Date(), 365);
  const topItems = marketRange.topItems;
  const daily = marketRange.daily;
  const confirmedSales = marketRange.totals.confirmedSales;
  const confirmedRevenue = marketRange.totals.trackedValue;
  const unitsSold = marketRange.totals.confirmedUnits;
  const averageSaleValue = confirmedSales ? toNumber(confirmedRevenue) / confirmedSales : 0;
  const listingValue = all.reduce((total, listing) => total + toNumber(listing.price) * Math.max(1, toNumber(listing.quantity)), 0);
  const maxDailyValue = Math.max(...daily.map((row: AnyRecord) => toNumber(row.totalValue)), 1);
  const trendRange = daily.length ? `${formatMarketDay(daily[0].day)} to ${formatMarketDay(daily[daily.length - 1].day)}` : "No confirmed sales";
  const filterLabel = memberFilter === "All" ? "all members" : memberFilter;
  const currentView = resolvedView ?? view;
  if (!resolvedView) return (
    <div className="panel restricted-access-panel">
      <section className="empty-state restricted-access-state">
        <Lock size={34} />
        <strong>Settlement Market is restricted</strong>
        <span>No settlement market views are available for your account.</span>
      </section>
    </div>
  );
  return (
    <div className="panel market-page">
      <header className="members-topbar market-topbar">
        <div>
          <h2>{settlementMarketTitle(data.claim?.name)}</h2>
          <p>{`${formatNumber(all.length)} monitored listing${all.length === 1 ? "" : "s"} for ${filterLabel}`}</p>
        </div>
        <div className="dashboard-top-meta">
          <div className="dashboard-meta-cluster">
            <span><ShoppingCart size={14} /> {formatNumber(all.length)} listings</span>
            <span>{formatNumber(confirmedSales)} confirmed sales</span>
          </div>
          <div className="dashboard-settlement-pill">
            <span className="status-pill">R{data.claim?.regionId ?? "?"}</span>
            <span>{data.claim?.name ?? "Settlement market"}</span>
          </div>
        </div>
      </header>
      <div className="summary-grid market-summary">
        <MiniStat icon={<ShoppingCart />} label="Live Listings" value={formatNumber(all.length)} />
        <MiniStat icon={<CircleDollarSign />} label="Listing Value" value={formatCompactNumber(listingValue)} />
        <MiniStat icon={<CheckCircle2 />} label="Confirmed Sales" value={formatNumber(confirmedSales)} />
        <MiniStat icon={<TrendingUp />} label="Sales Revenue" value={formatCompactNumber(confirmedRevenue)} />
      </div>
      <section className="command-filter-panel market-command-panel" data-tour="market-tools">
        <div className="command-filter-header">
          <span className="command-filter-title"><CircleDollarSign size={15} /> Settlement market</span>
          <span className="market-command-note">Browse only the configured settlement's monitored listings and confirmed sales.</span>
        </div>
        <div className="market-tool-row">
          <div className="tabs primary-tabs market-tabs">
            {marketViews.map((entry) => <button key={entry.id} className={currentView === entry.id ? "active" : ""} onClick={() => selectView(entry.id)}>{entry.icon} {entry.label}</button>)}
          </div>
          <label className="market-member-field">
            <span>Member</span>
            <select className="select-control" value={memberFilter} onChange={(event) => { setMemberFilter(event.target.value); trackAnalyticsEvent("market_member_filter_used", { scope: event.target.value === "All" ? "all" : "member" }); }}>
              <option>All</option>
              {memberOptions.map((name) => <option key={name}>{name}</option>)}
            </select>
          </label>
        </div>
      </section>
      {currentView === "analytics" ? (
        <>
          <p className="legend market-legend">Completed sales for orders listed at this settlement market, confirmed from Relay closed-listing proceeds.</p>
          <div className="metric-grid market-analytics-metrics">
            <MiniStat icon={<CheckCircle2 />} label="Confirmed Sales" value={formatNumber(confirmedSales)} />
            <MiniStat icon={<Package />} label="Units Sold" value={formatNumber(unitsSold)} />
            <MiniStat icon={<CircleDollarSign />} label="Sales Revenue" value={formatCompactNumber(confirmedRevenue)} />
            <MiniStat icon={<TrendingUp />} label="Average Sale Value" value={`${formatNumber(averageSaleValue)}g`} />
          </div>
          <div className="two-col market-analytics">
            <section>
              <h3><Star size={17} /> Best Sellers</h3>
              <p className="legend">Top confirmed sellers from locally recorded Relay sale evidence.</p>
              <BestSellersLeaderboard rows={topItems} itemMeta={marketItemMeta} />
            </section>
            <section>
              <h3><TrendingUp size={17} /> Revenue By Day</h3>
              <p className="legend">{trendRange}. Confirmed sales only; bar length represents revenue.</p>
              <div className="daily-sales">
                {daily.length ? daily.map((row: AnyRecord) => (
                  <div className="daily-sale-row" key={row.day}>
                    <span>{formatMarketDay(row.day)}</span>
                    <div className="daily-sale-bar"><i style={{ width: `${(toNumber(row.totalValue) / maxDailyValue) * 100}%` }} /></div>
                    <strong>{formatNumber(row.totalValue)}g</strong>
                    <small>{formatNumber(row.salesCount)} sale{row.salesCount === 1 ? "" : "s"} - {formatNumber(row.unitsSold)} units</small>
                  </div>
                )) : <p className="legend">No confirmed sales have been observed for this selection.</p>}
              </div>
            </section>
          </div>
          <section className="market-section">
            <h3><CheckCircle2 size={17} /> Recent Confirmed Sales</h3>
            <p className="legend">Imported completed sales retained in this monitor's history for the selected current settlement member(s).</p>
            <DataTable rows={apiTrades} scrollLabel="Completed market trades table" emptyState="No completed trades were returned for this window." columns={[
              ["When", r => dateLabel(r.timestamp ?? r.createdAt)],
              ["Item", r => <ItemLabel item={r} name={r.itemName ?? "-"} />],
              ["Tier", r => r.itemTier ? <TierBadge tier={r.itemTier} /> : "-"],
              ["Qty", r => formatNumber(r.quantity)],
              ["Unit Price", r => `${formatNumber(r.unitPrice)}g`],
              ["Value", r => `${formatNumber(r.totalPrice)}g`],
              ["Seller", r => r.sellerUsername ?? "-"],
              ["Buyer", r => r.purchaserUsername ?? r.buyerUsername ?? "-"],
            ]} />
          </section>
        </>
      ) : (
        <>
      <div className="market-live-grid">
        <MiniStat icon={<ShoppingCart />} label="Visible Listings" value={all.length} />
        <MiniStat icon={<TrendingDown />} label="Sell Orders" value={sellOrders.length || all.length} />
        <MiniStat icon={<TrendingUp />} label="Buy Orders" value={buyOrders.length} />
        <MiniStat icon={<CircleDollarSign />} label="Top Value" value={highest[0] ? formatCompactNumber(toNumber(highest[0].price) * toNumber(highest[0].quantity || 1)) : "-"} />
      </div>
      <div className="highlight-grid market-highlights">{highest.map((listing) => <div key={listing.entityId ?? listing.itemName}><ItemLabel item={{ ...listing, name: listing.itemName }} name={listing.itemName} /><span>{formatNumber(toNumber(listing.price) * toNumber(listing.quantity || 1))}g - {formatNumber(listing.price)}g ea</span></div>)}</div>
      <section className="command-filter-panel market-filter-panel">
        <div className="command-filter-header">
          <span className="command-filter-title"><Search size={15} /> Listing filters</span>
          <span>{formatNumber(rows.length)} visible rows</span>
        </div>
        <div className="market-filter-grid">
          <label className="research-filter-field">
            <span>Search</span>
            <SearchBox label="Search market listings" value={q} onChange={setQ} placeholder="Search market" />
          </label>
          <label className="research-filter-field">
            <span>Order Type</span>
            <div className="segmented market-order-tabs"><button className={tab === "sell" ? "active" : ""} onClick={() => setTab("sell")}><TrendingDown size={15} /> Sell</button><button className={tab === "buy" ? "active" : ""} onClick={() => setTab("buy")}><TrendingUp size={15} /> Buy</button></div>
          </label>
          <label className="research-filter-field">
            <span>Tier</span>
            <select className="select-control" value={tier} onChange={(event) => setTier(event.target.value)}><option>All</option>{tiers.map((value) => <option key={value}>{value}</option>)}</select>
          </label>
          <label className="research-filter-field">
            <span>Rarity</span>
            <select className="select-control" value={rarity} onChange={(event) => setRarity(event.target.value)}><option>All</option>{rarities.map((value) => <option key={value}>{value}</option>)}</select>
          </label>
        </div>
      </section>
      {rows.length > renderedRows.length ? <p className="legend market-legend">Showing the first {formatNumber(renderedRows.length)} of {formatNumber(rows.length)} matching listings. Narrow the filters to inspect more specific results.</p> : null}
      <DataTable rows={renderedRows} scrollLabel="Market listings table" emptyState={emptyListingState ? <AsyncState {...emptyListingState} compact /> : null} columns={[
        ["Item", r => <ItemLabel item={{ ...r, name: r.itemName }} name={r.itemName ?? "Unknown"} />],
        ["Side", r => <span className={`pill ${String(r.side ?? r.orderType).includes("buy") ? "buy" : "sell"}`}>{r.side ?? r.orderType ?? "sell"}</span>],
        ["Qty", r => formatNumber(r.quantity)],
          ["Unit Price", r => `${formatNumber(r.price)}g`],
          ["Total Price", r => `${formatNumber(r.totalValue ?? r.total_value ?? (toNumber(r.price) * toNumber(r.quantity)))}g`],
          ["Tier", r => (r.itemTier ?? r.tier) ? <TierBadge tier={r.itemTier ?? r.tier} /> : "-"],
        ["Rarity", r => (r.itemRarityStr ?? r.rarity) ? <RarityBadge rarity={r.itemRarityStr ?? r.rarity} /> : "-"],
        ["Owner", r => <TrackedOwnerName name={r.ownerUsername ?? "-"} claim={data.claim} members={data.members} />],
        ["Listed", r => listingListedAt(r) ? dateLabel(listingListedAt(r)) : "-"],
        ["Live", r => liveDaysSince(listingListedAt(r))],
      ]} />
        </>
      )}
    </div>
  );
}
