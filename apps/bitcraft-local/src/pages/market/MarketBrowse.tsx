import React from "react";
import { ArrowDownUp, ArrowLeft, BarChart3, Bell, MapPin, Search, ShoppingBag, Star, X } from "lucide-react";

import { DataTable } from "../../components/main/DataTable";
import { useGameDataGeneration } from "../../hooks/useGameDataGeneration";
import { ItemIcon, ItemLabel } from "../../components/main/ItemDisplay";
import { RarityBadge, TierBadge } from "../../components/main/Badges";
import { MiniStat } from "../../components/main/Stats";
import { toNumber, type AnyRecord } from "../../main-app-data";
import { updateQueryState } from "../../navigation";
import { createDelayedRefreshTask } from "../../refresh/pageRefresh.mjs";
import { formatGoldAmount, formatNumber, timeAgo } from "../../utils/format";
import type { MapFocus } from "../map/mapUtils";
import type { MarketItemKey, MarketRefreshProps } from "./globalMarket";
import {
  marketBrowseItemUrls,
  marketBrowseSearchUrl,
  marketFreshnessNotice,
  marketItemType,
  normalizeMarketOrders,
} from "./globalMarket";
import { availabilityFlags, exactMarketInteger, marketDetailLoadingState, marketDetailRequestPlan, marketPriceClass, marketRequestCanCommit, marketSuggestionResults, nextOptionIndex, regionalMarketQuotes, type MarketAvailability } from "./marketUi";
import { MarketPriceChart } from "./MarketPriceChart";

type Props = MarketRefreshProps & {
  claimId: string;
  mode: "browse" | "buy";
  regionId: string;
  favorites: MarketItemKey[];
  onToggleFavorite: (key: MarketItemKey) => void;
  canWatch: boolean;
  onWatchItem: (item: AnyRecord) => void;
  onShowMap: (focus: NonNullable<MapFocus>, regionId?: string) => void;
  locationSearch: string;
  onQueryStateChange: () => void;
};

function itemKey(item: AnyRecord): MarketItemKey {
  const itemId = String(item.id ?? item.itemId ?? "0").trim();
  return {
    itemType: marketItemType(item.itemType),
    itemId: /^\d+$/.test(itemId) ? itemId : "0",
  };
}

function compareDecimal(left: unknown, right: unknown): number {
  const a = exactMarketInteger(left);
  const b = exactMarketInteger(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function multiplyDecimal(left: unknown, right: unknown): string {
  return (exactMarketInteger(left) * exactMarketInteger(right)).toString();
}

export function MarketBrowse({ claimId, mode, regionId, favorites, onToggleFavorite, canWatch, onWatchItem, onShowMap, locationSearch, onQueryStateChange, refreshSequence, refreshHeaders, trackRefresh }: Props) {
  const params = React.useMemo(() => new URLSearchParams(locationSearch), [locationSearch]);
  const [query, setQuery] = React.useState(mode === "browse" ? params.get("q") ?? "" : params.get("buyQ") ?? "");
  const [suggestions, setSuggestions] = React.useState<AnyRecord[]>([]);
  const [activeSuggestion, setActiveSuggestion] = React.useState(-1);
  const [catalogItems, setCatalogItems] = React.useState<AnyRecord[]>([]);
  const [selectedItem, setSelectedItem] = React.useState<AnyRecord | null>(() => {
    const id = params.get(mode === "browse" ? "item" : "buyItem");
    const name = params.get(mode === "browse" ? "itemName" : "buyItemName");
    const type = params.get(mode === "browse" ? "itemType" : "buyItemType");
    return id && name ? { id, name, itemType: toNumber(type) } : null;
  });
  const [catalogState, setCatalogState] = React.useState<{ loading: boolean; error: string; categories: string[] }>({ loading: false, error: "", categories: [] });
  const [detailState, setDetailState] = React.useState<{ loading: boolean; error: string; historyLoading: boolean; historyRequestKey: string; historyError: string; detail: AnyRecord | null; history: AnyRecord | null }>({ loading: false, error: "", historyLoading: false, historyRequestKey: "", historyError: "", detail: null, history: null });
  const [category, setCategory] = React.useState(params.get("category") ?? "");
  const [availability, setAvailability] = React.useState<MarketAvailability>(() => {
    if (mode === "buy") return "buy";
    const sell = params.get("sell") === "true";
    const buy = params.get("buy") === "true";
    return sell && buy ? "both" : sell ? "sell" : buy ? "buy" : "any";
  });
  const [catalogSort, setCatalogSort] = React.useState<"relevance" | "name" | "orders" | "lowest-sell" | "highest-buy" | "spread">(() => {
    const saved = params.get("sort");
    return saved === "relevance" || saved === "orders" || saved === "lowest-sell" || saved === "highest-buy" || saved === "spread" ? saved : "name";
  });
  const [orderTab, setOrderTab] = React.useState<"sell" | "buy">(mode === "buy" ? "buy" : "sell");
  const [minimumQuantity, setMinimumQuantity] = React.useState("0");
  const [minimumPrice, setMinimumPrice] = React.useState("0");
  const [locationFilter, setLocationFilter] = React.useState("");
  const [playerFilter, setPlayerFilter] = React.useState("");
  const [detailTab, setDetailTab] = React.useState<"orders" | "stats">("orders");
  const [range, setRange] = React.useState<"24h" | "7d" | "30d" | "all">("30d");
  const [page, setPage] = React.useState(1);
  const catalogScrollRef = React.useRef(0);
  const suggestionsOpenRef = React.useRef(false);
  const generationSequence = useGameDataGeneration(claimId, ["catalogs", "regional-market"]);
  const availabilityFilter = availabilityFlags(availability);
  const detailRequestPlan = marketDetailRequestPlan(Boolean(selectedItem), detailTab);
  const selectedRequestIdentity = selectedItem
    ? `${marketItemType(selectedItem.itemType)}:${String(selectedItem.id)}`
    : "";
  const catalogRequestKey = JSON.stringify([claimId, regionId, query, category, availability, catalogSort, generationSequence, refreshSequence]);
  const orderBookRequestKey = JSON.stringify([claimId, regionId, selectedRequestIdentity, generationSequence, refreshSequence]);
  const priceHistoryRequestKey = JSON.stringify([claimId, regionId, selectedRequestIdentity, range, detailTab, refreshSequence]);
  const catalogRequestKeyRef = React.useRef(catalogRequestKey);
  const orderBookRequestKeyRef = React.useRef(orderBookRequestKey);
  const priceHistoryRequestKeyRef = React.useRef(priceHistoryRequestKey);
  catalogRequestKeyRef.current = catalogRequestKey;
  orderBookRequestKeyRef.current = orderBookRequestKey;
  priceHistoryRequestKeyRef.current = priceHistoryRequestKey;

  React.useEffect(() => {
    if (mode === "buy" && query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const refresh = createDelayedRefreshTask(() => {
      const catalogUrl = marketBrowseSearchUrl({
        query,
        regionId: regionId || "all",
        ...availabilityFilter,
        category,
        sort: catalogSort,
      });
      setCatalogState((current) => ({ ...current, loading: true, error: "" }));
      return fetch(catalogUrl, { headers: refreshHeaders, signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`market search HTTP ${response.status}`)));
    }, 220);
    trackRefresh("global-market-catalog", refresh.promise)
      .then((payload) => {
        if (!marketRequestCanCommit(catalogRequestKey, catalogRequestKeyRef.current, controller.signal.aborted)) return;
        const items = Array.isArray(payload.items) ? payload.items : [];
        const categories = Array.isArray(payload.categories) ? payload.categories.map(String) : [];
        setCatalogItems(items);
        setSuggestions(marketSuggestionResults(items, query, suggestionsOpenRef.current));
        setActiveSuggestion(-1);
        setCatalogState({ loading: false, error: "", categories });
      })
      .catch((error) => {
        if (marketRequestCanCommit(catalogRequestKey, catalogRequestKeyRef.current, controller.signal.aborted)) {
          setCatalogState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    return () => {
      refresh.cancel();
      controller.abort();
    };
  }, [availability, catalogRequestKey, catalogSort, category, generationSequence, query, refreshSequence, regionId]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      updateQueryState(mode === "browse" ? {
        q: query || null,
        category: category || null,
        available: availabilityFilter.availableOnly ? "true" : null,
        sell: availabilityFilter.hasSell ? "true" : null,
        buy: availabilityFilter.hasBuy ? "true" : null,
        sort: catalogSort === "name" ? null : catalogSort,
      } : {
        buyQ: query || null,
      });
      onQueryStateChange();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [availability, catalogSort, category, mode, onQueryStateChange, query]);

  React.useEffect(() => {
    if (!selectedItem) {
      setDetailState((current) => ({ ...current, loading: false, error: "", detail: null }));
      return;
    }
    const controller = new AbortController();
    const urls = marketBrowseItemUrls({
      itemType: marketItemType(selectedItem.itemType),
      itemId: String(selectedItem.id),
      regionId: regionId || "all",
      range,
    });
    setDetailState((current) => ({ ...current, loading: true, error: "" }));
    trackRefresh(
      "global-market-item-detail",
      fetch(urls.orderBook, { headers: refreshHeaders, signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`order book HTTP ${response.status}`))),
    ).then((detail) => {
      if (marketRequestCanCommit(orderBookRequestKey, orderBookRequestKeyRef.current, controller.signal.aborted)) {
        setDetailState((current) => ({ ...current, loading: false, error: "", detail }));
      }
    })
      .catch((error) => {
        if (marketRequestCanCommit(orderBookRequestKey, orderBookRequestKeyRef.current, controller.signal.aborted)) {
          setDetailState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : String(error) }));
        }
      });
    return () => controller.abort();
  }, [generationSequence, orderBookRequestKey, refreshSequence, regionId, selectedItem, detailRequestPlan.orderBook]);

  React.useEffect(() => {
    if (!selectedItem) {
      setDetailState((current) => ({ ...current, historyLoading: false, historyRequestKey: "", historyError: "", history: null }));
      return;
    }
    if (!detailRequestPlan.priceHistory) {
      setDetailState((current) => current.historyLoading ? { ...current, historyLoading: false } : current);
      return;
    }
    const controller = new AbortController();
    const urls = marketBrowseItemUrls({
      itemType: marketItemType(selectedItem.itemType),
      itemId: String(selectedItem.id),
      regionId: regionId || "all",
      range,
    });
    setDetailState((current) => ({ ...current, historyLoading: true, historyError: "" }));
    trackRefresh(
      "global-market-item-history",
      fetch(urls.priceHistory, { headers: refreshHeaders, signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`price history HTTP ${response.status}`))),
    ).then((history) => {
      if (marketRequestCanCommit(priceHistoryRequestKey, priceHistoryRequestKeyRef.current, controller.signal.aborted)) {
        setDetailState((current) => ({ ...current, historyLoading: false, historyRequestKey: priceHistoryRequestKey, historyError: "", history }));
      }
    })
      .catch((error) => {
        if (marketRequestCanCommit(priceHistoryRequestKey, priceHistoryRequestKeyRef.current, controller.signal.aborted)) {
          setDetailState((current) => ({
            ...current,
            historyLoading: false,
            historyRequestKey: priceHistoryRequestKey,
            historyError: error instanceof Error ? error.message : String(error),
            history: null,
          }));
        }
      });
    return () => controller.abort();
  }, [detailRequestPlan.priceHistory, priceHistoryRequestKey, range, refreshSequence, regionId, selectedItem]);

  function chooseItem(item: AnyRecord) {
    catalogScrollRef.current = window.scrollY;
    suggestionsOpenRef.current = false;
    setDetailState(marketDetailLoadingState());
    setSelectedItem(item);
    setSuggestions([]);
    setPage(1);
    const key = itemKey(item);
    updateQueryState(mode === "browse" ? {
      item: String(key.itemId),
      itemName: String(item.name ?? item.itemName ?? ""),
      itemType: key.itemType === "cargo" ? "1" : "0",
      q: query || null,
    } : {
      buyItem: String(key.itemId),
      buyItemName: String(item.name ?? item.itemName ?? ""),
      buyItemType: key.itemType === "cargo" ? "1" : "0",
      buyQ: query || null,
    }, "replace");
    onQueryStateChange();
  }

  function showResults() {
    suggestionsOpenRef.current = false;
    setSelectedItem(null);
    setDetailState(marketDetailLoadingState(false));
    setSuggestions([]);
    updateQueryState(mode === "browse" ? { item: null, itemName: null, itemType: null } : { buyItem: null, buyItemName: null, buyItemType: null }, "replace");
    onQueryStateChange();
    requestAnimationFrame(() => window.scrollTo(0, catalogScrollRef.current));
  }

  function clearCatalogFilters() {
    setQuery("");
    setCategory("");
    setAvailability(mode === "buy" ? "buy" : "any");
    setCatalogSort("name");
    showResults();
  }

  function onSuggestionKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) && suggestions.length) {
      event.preventDefault();
      setActiveSuggestion((current) => nextOptionIndex(current, suggestions.length, event.key));
      return;
    }
    if (event.key === "Enter" && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
      event.preventDefault();
      chooseItem(suggestions[activeSuggestion]);
      return;
    }
    if (event.key === "Escape") {
      suggestionsOpenRef.current = false;
      setSuggestions([]);
      setActiveSuggestion(-1);
    }
  }

  const selectedKey = selectedItem ? itemKey(selectedItem) : null;
  const itemMetadata = { ...selectedItem, ...(detailState.detail?.item ?? {}) };
  const freshnessNotice = marketFreshnessNotice(detailState.detail);
  const favorite = selectedKey ? favorites.some((entry) => entry.itemType === selectedKey.itemType && entry.itemId === selectedKey.itemId) : false;
  const orders = React.useMemo(() => normalizeMarketOrders(detailState.detail ?? {}).filter((order) => (!regionId || String(order.regionId) === regionId)), [detailState.detail, regionId]);
  const filteredOrders = React.useMemo(() => orders.filter((order) => {
    if (order.side !== orderTab) return false;
    if (compareDecimal(order.quantity, minimumQuantity) < 0) return false;
    if (orderTab === "buy" && compareDecimal(order.unitPrice, minimumPrice) < 0) return false;
    if (locationFilter && !`${order.claimName} ${order.regionName}`.toLowerCase().includes(locationFilter.toLowerCase())) return false;
    if (playerFilter && !order.ownerName.toLowerCase().includes(playerFilter.toLowerCase())) return false;
    return true;
  }).sort(
    (a, b) => orderTab === "buy"
      ? compareDecimal(b.unitPrice, a.unitPrice)
      : compareDecimal(a.unitPrice, b.unitPrice),
  ), [locationFilter, minimumPrice, minimumQuantity, orderTab, orders, playerFilter]);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const sells = orders.filter((order) => order.side === "sell");
  const buys = orders.filter((order) => order.side === "buy");
  const regionalQuotes = React.useMemo(() => regionalMarketQuotes(orders), [orders]);
  const bestSellOrder = sells.reduce<AnyRecord | null>((best, order) => (
    best == null || compareDecimal(order.unitPrice, best.unitPrice) < 0 ? order : best
  ), null);
  const bestBuyOrder = buys.reduce<AnyRecord | null>((best, order) => (
    best == null || compareDecimal(order.unitPrice, best.unitPrice) > 0 ? order : best
  ), null);
  const bestSell = bestSellOrder?.unitPrice ?? null;
  const bestBuy = bestBuyOrder?.unitPrice ?? null;
  const spread = bestSell != null && bestBuy != null
    ? (exactMarketInteger(bestSell) - exactMarketInteger(bestBuy)).toString()
    : null;
  const stats = detailState.history?.priceStats ?? {};
  const priceData: AnyRecord[] = Array.isArray(detailState.history?.priceData) ? detailState.history.priceData : [];
  const recentTrades: AnyRecord[] = Array.isArray(detailState.history?.recentTrades) ? detailState.history.recentTrades : [];
  const historyPending = detailRequestPlan.priceHistory
    && (detailState.historyLoading || detailState.historyRequestKey !== priceHistoryRequestKey);
  const hasCatalogFilters = Boolean(query || category || availability !== (mode === "buy" ? "buy" : "any") || catalogSort !== "name");

  return (
    <section className={`global-market-workspace market-workspace market-browse ${selectedItem ? "has-selection" : ""}`}>
      <div className="market-split-exchange">
      <section className="market-catalog-pane" aria-label="Market item catalogue">
      <div className="global-market-searchbar">
        <label className="field market-catalog-search">
          <span>{mode === "buy" ? "Find an item with buy orders" : "Search global catalog"}</span>
          <div className="suggestion-anchor">
            <Search size={16} />
            <input value={query} onFocus={() => { suggestionsOpenRef.current = true; setSuggestions(marketSuggestionResults(catalogItems, query, true)); }} onChange={(event) => { suggestionsOpenRef.current = true; setQuery(event.target.value); setSelectedItem(null); setDetailState(marketDetailLoadingState(false)); setActiveSuggestion(-1); }} onKeyDown={onSuggestionKeyDown} placeholder="Item or cargo name" role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls={`${mode}-market-suggestions`} aria-activedescendant={activeSuggestion >= 0 ? `${mode}-market-option-${activeSuggestion}` : undefined} />
            {suggestions.length ? <div className="suggestion-menu" id={`${mode}-market-suggestions`} role="listbox">{suggestions.map((item, index) => (
              <button id={`${mode}-market-option-${index}`} role="option" aria-selected={activeSuggestion === index} key={`${item.itemType}-${item.id}`} type="button" onMouseEnter={() => setActiveSuggestion(index)} onClick={() => chooseItem(item)}>
                <ItemIcon item={item} /><strong>{item.name}</strong>{item.tier ? <TierBadge tier={item.tier} /> : null}<small>{item.rarityStr ? <RarityBadge rarity={item.rarityStr} /> : null}{item.tag ?? ""}</small>
              </button>
            ))}</div> : null}
          </div>
        </label>
        {mode === "browse" ? <>
          <label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{catalogState.categories.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
          <label className="field"><span>Sort</span><select value={catalogSort} onChange={(event) => setCatalogSort(event.target.value as typeof catalogSort)}><option value="relevance">Relevance</option><option value="name">Item name</option><option value="orders">Order count</option><option value="lowest-sell">Lowest sell order</option><option value="highest-buy">Highest buy order</option><option value="spread">Smallest spread</option></select></label>
          <label className="field market-availability-field"><span>Availability</span><select value={availability} onChange={(event) => setAvailability(event.target.value as MarketAvailability)}><option value="any">Any</option><option value="sell">For sale</option><option value="buy">Wanted</option><option value="both">Both</option></select></label>
          <div className="market-filter-actions"><button className="toolbar-button" type="button" disabled={!hasCatalogFilters} onClick={clearCatalogFilters}><X size={14} /> Clear filters</button></div>
        </> : null}
      </div>
      {catalogState.error ? <div className="error">Market search unavailable: {catalogState.error}</div> : null}
      {mode === "browse" ? (
        <div className="market-catalog-results" aria-label="Market item catalog">
          {catalogState.loading && !catalogItems.length ? <div className="market-loading-strip">Loading market catalog…</div> : null}
          {catalogItems.map((item) => (
            <button className={`market-catalog-result ${selectedKey?.itemType === item.itemType && selectedKey?.itemId === item.id ? "active" : ""}`} aria-pressed={selectedKey?.itemType === item.itemType && selectedKey?.itemId === item.id} type="button" key={`${item.itemType}-${item.id}`} onClick={() => chooseItem(item)}>
              <ItemIcon item={item} />
              <span className="market-catalog-result-name"><strong>{item.name}</strong><small>{item.category || "Uncategorised"}</small></span>
              <span className="market-catalog-quote market-catalog-quote-primary"><small>Lowest sell order</small><strong className={marketPriceClass(item.lowestSellPrice == null ? "neutral" : "ask")}>{item.lowestSellPrice == null ? "Unavailable" : formatGoldAmount(item.lowestSellPrice)}</strong><small>{item.lowestSellLocation || "No seller location"}</small></span>
              <span className="market-catalog-quote market-catalog-quote-secondary"><small>Highest buy order</small><strong className={marketPriceClass(item.highestBuyPrice == null ? "neutral" : "bid")}>{item.highestBuyPrice == null ? "Unavailable" : formatGoldAmount(item.highestBuyPrice)}</strong><small>{item.highestBuyLocation || "No buyer location"}</small></span>
              <span className="market-catalog-quote market-catalog-quote-secondary"><small>Spread</small><strong className={marketPriceClass("profit", item.lowestSellPrice == null || item.highestBuyPrice == null ? null : (exactMarketInteger(item.lowestSellPrice) - exactMarketInteger(item.highestBuyPrice)).toString())}>{item.lowestSellPrice == null || item.highestBuyPrice == null ? "Unavailable" : formatGoldAmount((exactMarketInteger(item.lowestSellPrice) - exactMarketInteger(item.highestBuyPrice)).toString())}</strong><small>{formatNumber(item.orderCount)} current orders</small></span>
            </button>
          ))}
          {!catalogState.loading && !catalogItems.length ? <div className="empty-state"><ShoppingBag size={28} /><strong>No catalog items match these filters</strong><span>Clear a filter or search for another item or cargo name.</span></div> : null}
        </div>
      ) : null}
      </section>
      <section className="market-instrument-pane" aria-label="Selected item regional market">
      {!selectedItem ? <div className="empty-state market-global-empty"><ShoppingBag size={28} /><strong>Choose an item to compare regions</strong><span>Select an item to compare the lowest sell orders and highest buy orders across active regions.</span></div> : (
        <div className="market-item-detail">
          <header>
            <div className="market-item-heading">
              <button className="toolbar-button market-back-results" type="button" onClick={showResults}><ArrowLeft size={15} /> Back to results</button>
              <div className="market-item-identity">
              <ItemIcon item={itemMetadata} />
              <div>
                <h2>{itemMetadata.name}</h2>
                <div className="market-item-meta">
                  <span>{selectedKey?.itemType === "cargo" ? "Cargo" : "Item"}</span>
                  <span>{regionId ? `Region ${regionId}` : "All active regions"}</span>
                  {toNumber(itemMetadata.tier) > 0 ? <span>Tier {itemMetadata.tier}</span> : null}
                  <span>{itemMetadata.rarityStr ?? itemMetadata.rarity ?? "Rarity unavailable"}</span>
                  <span>{itemMetadata.category ?? itemMetadata.tag ?? "Category unavailable"}</span>
                </div>
              </div>
              </div>
            </div>
            <div className="market-item-actions"><button className={`toolbar-button ${favorite ? "active" : ""}`} type="button" onClick={() => selectedKey && onToggleFavorite(selectedKey)} aria-pressed={favorite}><Star size={15} fill={favorite ? "currentColor" : "none"} /> {favorite ? "Saved" : "Save"}</button>{canWatch ? <button className="toolbar-button" type="button" onClick={() => onWatchItem(itemMetadata)}><Bell size={15} /> Watch</button> : null}</div>
          </header>
          {detailState.error ? <div className="error">Unable to load this market: {detailState.error}</div> : null}
          {freshnessNotice ? <div className="info">{freshnessNotice}</div> : null}
          {detailState.loading && !detailState.detail ? <div className="market-loading-strip">Loading live orders…</div> : null}
          <div className="metric-grid market-order-summary">
            <MiniStat icon={<ArrowDownUp />} label="Lowest Sell Order" value={<span className={marketPriceClass(bestSell == null ? "neutral" : "ask")}>{bestSell == null ? "—" : `${formatNumber(bestSell)}g`}</span>} />
            <MiniStat icon={<ArrowDownUp />} label="Highest Buy Order" value={<span className={marketPriceClass(bestBuy == null ? "neutral" : "bid")}>{bestBuy == null ? "—" : `${formatNumber(bestBuy)}g`}</span>} />
            <MiniStat icon={<ArrowDownUp />} label="Spread" value={<span className={marketPriceClass("profit", spread)}>{spread == null ? "—" : `${formatNumber(spread)}g`}</span>} />
          </div>
          <div className="market-depth-summary" aria-label="Current market depth"><span><small>Liquidity</small><strong>{formatNumber(orders.reduce((sum, order) => sum + exactMarketInteger(order.quantity), 0n))} units</strong></span><span><small>Orders</small><strong>{formatNumber(sells.length)} sell orders · {formatNumber(buys.length)} buy orders</strong></span><span><small>Lowest sell location</small><strong>{bestSellOrder?.claimName || bestSellOrder?.regionName || "Unavailable"}</strong></span><span><small>Highest buy location</small><strong>{bestBuyOrder?.claimName || bestBuyOrder?.regionName || "Unavailable"}</strong></span></div>
          {regionalQuotes.length ? <div className="market-regional-book table-wrap" role="region" aria-label="Regional order comparison" tabIndex={0}>
            <table><thead><tr><th>Region</th><th>Lowest sell order</th><th>Sell quantity</th><th>Highest buy order</th><th>Buy quantity</th><th>Orders</th><th>Seen</th></tr></thead><tbody>
              {regionalQuotes.map((quote, index) => <tr className="market-region-card" key={quote.regionKey}>
                <th scope="row"><span>{index === 0 && quote.bestSell != null ? "Best price" : "Region"}</span>{quote.regionName}</th>
                <td><span className={marketPriceClass(quote.bestSell == null ? "neutral" : "ask")}>{quote.bestSell == null ? "—" : formatGoldAmount(quote.bestSell)}</span></td><td>{formatNumber(quote.sellQuantity)}</td>
                <td><span className={marketPriceClass(quote.bestBuy == null ? "neutral" : "bid")}>{quote.bestBuy == null ? "—" : formatGoldAmount(quote.bestBuy)}</span></td><td>{formatNumber(quote.buyQuantity)}</td>
                <td>{formatNumber(quote.sellOrders + quote.buyOrders)}</td><td>{quote.lastSeen ? timeAgo(quote.lastSeen) : "—"}</td>
              </tr>)}
            </tbody></table>
          </div> : null}
          <div className="tabs market-order-tabs">
            <button className={detailTab === "orders" ? "active" : ""} onClick={() => setDetailTab("orders")}>Orders</button>
            <button className={detailTab === "stats" ? "active" : ""} onClick={() => setDetailTab("stats")}>Stats</button>
          </div>
          {detailTab === "orders" ? <>
            <div className="market-order-filters">
              <div className="tabs market-order-tabs"><button className={orderTab === "sell" ? "active" : ""} onClick={() => { setOrderTab("sell"); setPage(1); }}>Sell orders ({sells.length})</button><button className={orderTab === "buy" ? "active" : ""} onClick={() => { setOrderTab("buy"); setPage(1); }}>Buy orders ({buys.length})</button></div>
              <label className="field"><span>Minimum quantity</span><input type="number" min="0" value={minimumQuantity} onChange={(event) => setMinimumQuantity(event.target.value)} /></label>
              {orderTab === "buy" ? <label className="field"><span>Minimum price</span><input type="number" min="0" value={minimumPrice} onChange={(event) => setMinimumPrice(event.target.value)} /></label> : null}
              <label className="field"><span>Settlement or region</span><input value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} /></label>
              <label className="field"><span>{orderTab === "buy" ? "Buyer" : "Seller"}</span><input value={playerFilter} onChange={(event) => setPlayerFilter(event.target.value)} /></label>
            </div>
            <DataTable
              rows={filteredOrders}
              rowOffset={(Math.min(page, pageCount) - 1) * pageSize}
              rowLimit={pageSize}
              scrollLabel={`${orderTab} market orders table`}
              emptyState={`No ${orderTab} orders match these filters.`}
              columns={[
                ["Price", (order) => <span className={marketPriceClass(orderTab === "sell" ? "ask" : "bid")}>{formatGoldAmount(order.unitPrice)}</span>, (order) => order.unitPrice],
                ["Quantity", (order) => formatNumber(order.quantity), (order) => order.quantity],
                ["Total", (order) => formatGoldAmount(multiplyDecimal(order.unitPrice, order.quantity)), (order) => multiplyDecimal(order.unitPrice, order.quantity)],
                ["Region", (order) => order.regionName || (order.regionId ? `R${order.regionId}` : "—"), (order) => order.regionName || String(order.regionId ?? "")],
                ["Settlement", (order) => order.claimName || "Unknown settlement", (order) => order.claimName],
                [orderTab === "buy" ? "Buyer" : "Seller", (order) => order.ownerName || "—", (order) => order.ownerName],
                ["Map", (order) => order.locationX != null && order.locationZ != null ? <button className="market-map-button" type="button" title="Show on map" aria-label="Show order on map" onClick={() => onShowMap({ name: order.claimName || selectedItem.name, locationX: order.locationX, locationZ: order.locationZ }, String(order.regionId ?? ""))}><MapPin size={15} /></button> : "—", undefined, false],
              ]}
            />
            <div className="pagination-row"><span>Page {Math.min(page, pageCount)} of {pageCount} · {formatNumber(filteredOrders.length)} orders</span><div><button className="toolbar-button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button className="toolbar-button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button></div></div>
          </> : (
            <div className="market-stats-workspace">
              {!historyPending && detailState.historyError ? <div className="error">Price history unavailable: {detailState.historyError}</div> : null}
              <div className="market-range-tabs">{(["24h", "7d", "30d", "all"] as const).map((entry) => <button className={range === entry ? "active" : ""} key={entry} onClick={() => setRange(entry)}>{entry}</button>)}</div>
              {historyPending ? <div className="market-loading-strip">Loading price history…</div> : <>
                <div className="metric-grid"><MiniStat icon={<BarChart3 />} label="24h VWAP" value={stats.avg24h == null ? "—" : `${formatNumber(stats.avg24h)}g`} /><MiniStat icon={<BarChart3 />} label="7d VWAP" value={stats.avg7d == null ? "—" : `${formatNumber(stats.avg7d)}g`} /><MiniStat icon={<BarChart3 />} label="30d Average" value={stats.avg30d == null ? "—" : `${formatNumber(stats.avg30d)}g`} /><MiniStat icon={<BarChart3 />} label="High / Low" value={stats.allTimeHigh == null ? "—" : `${formatNumber(stats.allTimeHigh)} / ${formatNumber(stats.allTimeLow)}g`} /><MiniStat icon={<BarChart3 />} label="Volume" value={formatNumber(stats.totalVolume)} /><MiniStat icon={<BarChart3 />} label="24h Change" value={stats.priceChange24h == null ? "—" : `${toNumber(stats.priceChange24h) >= 0 ? "+" : ""}${formatNumber(stats.priceChange24h)}%`} /></div>
                <MarketPriceChart rows={priceData} range={range} />
                {detailState.history?.coverage === "collecting" ? <div className="info">Collecting confirmed local sales for this selection. Current buy and sell orders remain live.</div> : null}
                {detailState.history?.coverage === "locally-observed" ? <div className="info">This chart contains confirmed sales observed by this app only.{detailState.history?.observedSince ? ` Local observation window began ${timeAgo(detailState.history.observedSince)}.` : ""}</div> : null}
                <section className="market-recent-trades"><h3>Recent trades <small>Representative item history</small></h3>{recentTrades.length ? recentTrades.slice(0, 20).map((trade, index) => <div key={String(trade.id ?? `${trade.timestamp}-${index}`)}><ItemLabel item={{ ...selectedItem, itemName: selectedItem.name }} /><span>{formatNumber(trade.quantity)} @ {formatNumber(trade.unitPrice ?? trade.price)}g</span><small>{trade.regionName ?? trade.claimName ?? "Unknown market"} · {timeAgo(trade.createdAt ?? trade.timestamp)}</small></div>) : <div className="empty-state">No recent trades were returned.</div>}</section>
              </>}
            </div>
          )}
        </div>
      )}
      </section>
      </div>
    </section>
  );
}
