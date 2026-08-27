import {
  marketIdentityKey,
  normalizeMarketItemType,
} from "./marketIdentity.mjs";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function decimal(value) {
  const normalized = String(value ?? "0").trim();
  return /^\d+$/.test(normalized) ? normalized : "0";
}

function compareBigInt(left, right) {
  const leftValue = BigInt(decimal(left));
  const rightValue = BigInt(decimal(right));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareText(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function multiply(left, right) {
  return (BigInt(decimal(left)) * BigInt(decimal(right))).toString();
}

function baselineKey(row) {
  return marketIdentityKey(row.regionId, row.itemType, row.itemId);
}

function divideRoundedHalfUp(numerator, denominator) {
  if (denominator <= 0n) return null;
  return ((2n * numerator + denominator) / (2n * denominator)).toString();
}

function premiumHundredths(unitPrice, baseline) {
  const units = BigInt(decimal(baseline.unitsSold));
  const total = BigInt(decimal(baseline.totalValue));
  if (units <= 0n || total <= 0n) return null;
  const delta = BigInt(decimal(unitPrice)) * units - total;
  const magnitude = delta < 0n ? -delta : delta;
  const rounded = (magnitude * 10_000n * 2n + total) / (2n * total);
  return delta < 0n ? -rounded : rounded;
}

function formatHundredths(value) {
  if (value == null) return null;
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  const whole = magnitude / 100n;
  const fraction = String(magnitude % 100n).padStart(2, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function comparePremium(left, right) {
  if (left._premiumNumerator == null) return right._premiumNumerator == null ? 0 : -1;
  if (right._premiumNumerator == null) return 1;
  const leftScaled = left._premiumNumerator * right._premiumDenominator;
  const rightScaled = right._premiumNumerator * left._premiumDenominator;
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function publicBuyOrderRow(row) {
  const { _premiumNumerator, _premiumDenominator, ...visible } = row;
  return visible;
}

function regionIds(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [])
      .map(String)
      .filter((regionId) => /^\d+$/.test(regionId)),
  )];
}

function itemType(value) {
  return normalizeMarketItemType(value);
}

function catalogItem(value) {
  const source = record(value);
  const type = itemType(source.itemType ?? source.kind);
  const id = decimal(source.itemId ?? source.targetId ?? source.id);
  const tag = String(source.tag ?? source.category ?? "");
  const rarity = String(source.rarity ?? source.rarityStr ?? "");
  return {
    id,
    itemId: id,
    itemType: type,
    name: String(source.name ?? `${type === "cargo" ? "Cargo" : "Item"} #${id}`),
    category: tag,
    tag,
    tier: source.tier ?? null,
    rarity,
    rarityStr: rarity,
    iconAssetName: source.iconAssetName ?? null,
  };
}

function scopedOrders(snapshot, options = {}) {
  const source = record(snapshot);
  const selectedRegion = String(options.regionId ?? "all").trim().toLowerCase() || "all";
  const allowedRegionIds = new Set(regionIds(options.allowedRegionIds));
  return (Array.isArray(source.orders) ? source.orders : [])
    .map(record)
    .filter((order) => {
      const regionId = decimal(order.regionId);
      return (!allowedRegionIds.size || allowedRegionIds.has(regionId))
        && (selectedRegion === "all" || regionId === selectedRegion);
    });
}

function normalizedOrderIndexScope(options = {}) {
  return {
    claimId: String(options.claimId ?? "").trim(),
    generation: String(options.generation ?? "").trim(),
    allowedRegionIds: regionIds(options.allowedRegionIds).sort(compareText),
  };
}

function sameOrderIndexScope(left, right) {
  return left.claimId === right.claimId
    && left.generation === right.generation
    && left.allowedRegionIds.length === right.allowedRegionIds.length
    && left.allowedRegionIds.every((regionId, index) => regionId === right.allowedRegionIds[index]);
}

function emptyOrderCounts() {
  return { sell: 0, buy: 0, bestSell: null, bestBuy: null };
}

function recordOrderCount(counts, order) {
  const rawPrice = String(order.price ?? order.priceThreshold ?? "").trim();
  const price = /^\d+$/.test(rawPrice) ? rawPrice : null;
  if (String(order.side ?? "buy").toLowerCase() === "sell") {
    counts.sell += 1;
    if (price != null && (!counts.bestSell || compareBigInt(price, counts.bestSell.price) < 0)) {
      counts.bestSell = { price, location: String(order.claimName ?? order.regionName ?? "") };
    }
  } else {
    counts.buy += 1;
    if (price != null && (!counts.bestBuy || compareBigInt(price, counts.bestBuy.price) > 0)) {
      counts.bestBuy = { price, location: String(order.claimName ?? order.regionName ?? "") };
    }
  }
}

function buildRegionalMarketOrderIndex(snapshot, scope) {
  const allowed = new Set(scope.allowedRegionIds);
  const byItem = new Map();
  for (const rawOrder of Array.isArray(record(snapshot).orders) ? record(snapshot).orders : []) {
    const order = record(rawOrder);
    const regionId = decimal(order.regionId);
    if (allowed.size && !allowed.has(regionId)) continue;
    const key = `${itemType(order.itemType)}:${decimal(order.itemId)}`;
    const item = byItem.get(key) ?? { orders: [], countsAll: emptyOrderCounts(), countsByRegion: new Map() };
    item.orders.push(order);
    recordOrderCount(item.countsAll, order);
    const counts = item.countsByRegion.get(regionId) ?? emptyOrderCounts();
    recordOrderCount(counts, order);
    item.countsByRegion.set(regionId, counts);
    byItem.set(key, item);
  }
  return { scope, snapshot, byItem };
}

function cachedOrderIndex(snapshot, options = {}) {
  const index = options.orderIndex;
  if (!index || !(index.byItem instanceof Map) || !index.scope) return null;
  return index.snapshot === snapshot
    && sameOrderIndexScope(index.scope, normalizedOrderIndexScope(options))
    ? index
    : null;
}

function indexedOrderCounts(index, key, selectedRegion) {
  const item = index?.byItem.get(key);
  if (!item) return emptyOrderCounts();
  const counts = selectedRegion === "all"
    ? item.countsAll
    : item.countsByRegion.get(selectedRegion);
  return counts ? { ...counts } : emptyOrderCounts();
}

function indexedItemOrders(index, key, selectedRegion) {
  const item = index?.byItem.get(key);
  if (!item) return [];
  return selectedRegion === "all"
    ? item.orders
    : item.orders.filter((order) => decimal(order.regionId) === selectedRegion);
}

export function createRegionalMarketOrderIndexCache({ maxEntries = 2 } = {}) {
  const entryLimit = Math.max(1, Math.floor(Number(maxEntries) || 2));
  const cache = new Map();
  let builds = 0;
  let hits = 0;

  return {
    get(snapshot, options = {}) {
      const scope = normalizedOrderIndexScope(options);
      const cacheable = Boolean(scope.claimId && scope.generation);
      const key = cacheable
        ? `${scope.claimId}:${scope.generation}:${scope.allowedRegionIds.join(",")}`
        : null;
      const cached = key ? cache.get(key) : null;
      if (cached && cached.snapshot === snapshot && sameOrderIndexScope(cached.scope, scope)) {
        hits += 1;
        cache.delete(key);
        cache.set(key, cached);
        return cached;
      }
      const index = buildRegionalMarketOrderIndex(snapshot, scope);
      builds += 1;
      if (key) {
        cache.delete(key);
        while (cache.size >= entryLimit) cache.delete(cache.keys().next().value);
        cache.set(key, index);
      }
      return index;
    },
    cacheStats() {
      return { entries: cache.size, builds, hits, maxEntries: entryLimit };
    },
  };
}

function scopedStalls(snapshot, options = {}) {
  const source = record(snapshot);
  const selectedRegion = String(options.regionId ?? "all").trim().toLowerCase() || "all";
  const allowedRegionIds = new Set(regionIds(options.allowedRegionIds));
  return (Array.isArray(source.stalls) ? source.stalls : [])
    .map(record)
    .filter((stall) => {
      const regionId = decimal(stall.regionId);
      return (!allowedRegionIds.size || allowedRegionIds.has(regionId))
        && (selectedRegion === "all" || regionId === selectedRegion);
    });
}

function warningInScope(warning, allowedRegionIds) {
  if (!allowedRegionIds.size) return true;
  const match = String(warning).match(/(?:^Region|region)\s+(\d+)/);
  return !match || allowedRegionIds.has(match[1]);
}

export function regionalMarketStatus(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      freshness: "unavailable",
      confidence: "unknown",
      ageMs: null,
      warnings: ["Relay regional market has not loaded yet."],
    };
  }
  const current = record(snapshot);
  const source = record(current.data);
  const selectedRegion = String(options.regionId ?? "all").trim().toLowerCase() || "all";
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const staleAfterMs = Math.max(1_000, Number(options.staleAfterMs) || 60_000);
  const metadata = (Array.isArray(source.regions) ? source.regions : [])
    .map(record)
    .filter((region) => /^\d+$/.test(String(region.regionId ?? "")));
  const configuredRegionIds = regionIds(options.allowedRegionIds);
  const allowedRegionIds = new Set(configuredRegionIds);
  const activeRegionIds = configuredRegionIds.length
    ? configuredRegionIds
    : regionIds(
      Array.isArray(source.activeRegionIds)
        ? source.activeRegionIds
        : metadata.map((region) => region.regionId),
    );
  const activeRegionSet = new Set(activeRegionIds);
  const targetRegionIds = selectedRegion === "all"
    ? activeRegionIds
    : activeRegionSet.size && !activeRegionSet.has(selectedRegion)
      ? []
      : [selectedRegion];
  const metadataByRegion = new Map(
    metadata
      .filter((region) => !activeRegionSet.size || activeRegionSet.has(String(region.regionId)))
      .map((region) => [String(region.regionId), region]),
  );
  const missingRegionIds = targetRegionIds.filter((regionId) => !metadataByRegion.has(regionId));
  const loadedRegions = targetRegionIds
    .map((regionId) => metadataByRegion.get(regionId))
    .filter(Boolean);
  const warnings = [
    ...(Array.isArray(current.warnings)
      ? current.warnings.map(String).filter((warning) => warningInScope(warning, allowedRegionIds))
      : []),
    ...missingRegionIds.map((regionId) => `Relay regional market has not loaded region ${regionId} yet.`),
  ];
  if (!loadedRegions.length) {
    return {
      freshness: "unavailable",
      confidence: current.confidence === "authoritative" ? "partial" : String(current.confidence ?? "unknown"),
      ageMs: null,
      warnings: [...new Set(warnings)],
    };
  }

  const ages = loadedRegions.map((region) => {
    const receivedAtMs = Date.parse(String(region.receivedAt ?? ""));
    return Number.isFinite(receivedAtMs) ? Math.max(0, nowMs - receivedAtMs) : null;
  });
  const knownAges = ages.filter((age) => age != null);
  const ageMs = knownAges.length ? Math.max(...knownAges) : null;
  let freshness = missingRegionIds.length ? "stale" : "fresh";
  for (const [index, region] of loadedRegions.entries()) {
    const regionId = String(region.regionId);
    const age = ages[index];
    if (age == null) {
      freshness = "stale";
      warnings.push(`Relay regional market region ${regionId} has no valid receive time.`);
    } else if (age > staleAfterMs) {
      freshness = "stale";
      warnings.push(`Relay regional market region ${regionId} is older than ${staleAfterMs}ms.`);
    }
  }
  if (current.lastError) {
    freshness = "stale";
    warnings.push(String(current.lastError));
  }
  const runtime = record(options.runtimeHealth);
  if (runtime.running === true) {
    const pool = record(runtime.pool);
    const sessions = Array.isArray(pool.sessions) ? pool.sessions.map(record) : [];
    for (const regionId of targetRegionIds) {
      const session = sessions.find((entry) => String(entry.regionId ?? "") === regionId);
      if (!session) continue;
      const health = record(session.health);
      if (health.connected === false) {
        freshness = "stale";
        warnings.push(`Relay regional market region ${regionId} is disconnected.`);
      }
      if (health.lastError) {
        freshness = "stale";
        warnings.push(String(health.lastError));
      }
    }
  }
  return {
    freshness,
    confidence: missingRegionIds.length
      ? "partial"
      : String(current.confidence ?? "unknown"),
    ageMs,
    warnings: [...new Set(warnings)],
  };
}

export function globalCatalogStatus(catalogSource, options = {}) {
  if (!catalogSource || typeof catalogSource !== "object" || Array.isArray(catalogSource)) {
    return {
      freshness: "unavailable",
      confidence: "unknown",
      ageMs: null,
      warnings: ["Relay global catalog has not loaded yet."],
    };
  }
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const staleAfterMs = Math.max(1_000, Number(options.staleAfterMs) || 60_000);
  const receivedAtMs = Date.parse(String(catalogSource.receivedAt ?? ""));
  const catalogAgeMs = Number.isFinite(receivedAtMs) ? Math.max(0, nowMs - receivedAtMs) : null;
  const runtime = record(options.runtimeHealth);
  const subscription = record(options.runtimeHealth?.subscription);
  const runtimeError = subscription.lastError ?? runtime.lastError;
  const runtimeExpected = options.runtimeExpected === true;
  const runtimeUnhealthy = runtimeError
    || (runtime.running === true && (
      subscription.connected !== true
      || subscription.applied !== true
    ))
    || (runtimeExpected && runtime.running !== true);
  const catalogStale = Boolean(runtimeUnhealthy)
    || catalogAgeMs == null
    || catalogAgeMs > staleAfterMs;
  const warnings = [];
  if (catalogStale) {
    if (runtimeError) {
      warnings.push(`Relay global catalog error: ${String(runtimeError)}`);
    } else if ((runtime.running === true || runtimeExpected) && subscription.connected !== true) {
      warnings.push("Relay global catalog subscription is disconnected.");
    } else if ((runtime.running === true || runtimeExpected) && subscription.applied !== true) {
      warnings.push("Relay global catalog subscription has not applied yet.");
    } else if (runtimeExpected && runtime.running !== true) {
      warnings.push("Relay global catalog runtime is not running.");
    } else if (catalogAgeMs == null) {
      warnings.push("Relay global catalog has no valid receive time.");
    } else {
      warnings.push(`Relay global catalog is older than ${Math.round(staleAfterMs / 1_000)} seconds.`);
    }
  }
  return {
    freshness: catalogStale ? "stale" : "fresh",
    confidence: catalogStale ? "partial" : "authoritative",
    ageMs: catalogAgeMs,
    warnings: [...new Set(warnings)],
  };
}

export function combinedMarketStatus(orderStatus, catalogSource, options = {}) {
  const orders = record(orderStatus);
  const runtimeSubscription = record(options.runtimeHealth?.subscription);
  const catalog = globalCatalogStatus(catalogSource, {
    ...options,
    runtimeExpected: options.runtimeExpected
      ?? Object.keys(runtimeSubscription).length > 0,
  });
  if (catalog.freshness === "unavailable") return catalog;
  const warnings = [
    ...(Array.isArray(orders.warnings) ? orders.warnings.map(String) : []),
    ...catalog.warnings,
  ];
  const orderAgeMs = Number.isFinite(Number(orders.ageMs)) ? Number(orders.ageMs) : null;
  const ageMs = [orderAgeMs, catalog.ageMs].filter((age) => age != null);
  return {
    freshness: orders.freshness === "unavailable"
      ? "unavailable"
      : catalog.freshness === "stale" || orders.freshness === "stale"
        ? "stale"
        : "fresh",
    confidence: catalog.confidence !== "authoritative" || orders.confidence !== "authoritative"
      ? (orders.freshness === "unavailable" ? "unknown" : "partial")
      : "authoritative",
    ageMs: ageMs.length ? Math.max(...ageMs) : null,
    warnings: [...new Set(warnings)],
  };
}

export function regionalBuyOrdersView(snapshot, options = {}) {
  const source = record(snapshot);
  const selectedRegion = String(options.regionId ?? "all").trim().toLowerCase();
  const allowedRegionIds = new Set(regionIds(options.allowedRegionIds));
  const query = String(options.search ?? options.q ?? "").trim().toLowerCase();
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const requestedPageSize = Number(options.pageSize);
  const pageSize = [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 50;
  const direction = String(options.direction ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
  const sort = String(options.sort ?? "unitPrice");
  const observedAt = options.observedAt == null ? null : String(options.observedAt);
  const getEntity = typeof options.getEntity === "function" ? options.getEntity : () => null;
  const saleBaselines = options.saleBaselines instanceof Map ? options.saleBaselines : new Map();
  const receivedAtByRegion = new Map(
    (Array.isArray(source.regions) ? source.regions : [])
      .map(record)
      .filter((region) => /^\d+$/.test(String(region.regionId ?? "")))
      .map((region) => [String(region.regionId), String(region.receivedAt ?? "") || null]),
  );

  const rows = (Array.isArray(source.orders) ? source.orders : [])
    .map(record)
    .filter((order) => String(order.side ?? "buy").toLowerCase() !== "sell")
    .map((order) => {
    const normalizedItemType = itemType(order.itemType);
    const itemId = decimal(order.itemId);
    const item = record(getEntity(`${normalizedItemType === "cargo" ? "cargo" : "items"}:${itemId}`));
    const quantity = decimal(order.quantity);
    const unitPrice = decimal(order.price ?? order.priceThreshold);
    const listedAt = order.timestamp == null ? null : String(order.timestamp);
    const baseRow = {
      orderKey: String(order.entityId ?? ""),
      regionId: decimal(order.regionId),
      regionName: String(order.regionName ?? `R${decimal(order.regionId)}`),
      marketClaimId: decimal(order.claimEntityId),
      marketClaimName: String(order.claimName ?? ""),
      buyerEntityId: decimal(order.ownerEntityId),
      buyerName: String(order.ownerUsername ?? ""),
      itemId,
      itemType: normalizedItemType,
      itemName: String(item.name ?? `${normalizedItemType === "cargo" ? "Cargo" : "Item"} #${itemId}`),
      tier: item.tier ?? null,
      rarity: String(item.rarity ?? ""),
      rarityStr: String(item.rarity ?? ""),
      iconAssetName: item.iconAssetName ?? null,
      quantity,
      unitPrice,
      totalValue: multiply(quantity, unitPrice),
      storedCoins: decimal(order.storedCoins),
      listedAt,
      firstSeen: listedAt,
      lastSeen: receivedAtByRegion.get(decimal(order.regionId)) ?? observedAt ?? listedAt,
    };
    const baseline = saleBaselines.get(baselineKey(baseRow));
    if (!baseline) {
      return {
        ...baseRow,
        averageUnitPrice: null,
        salesCount: 0,
        premiumPercent: null,
        opportunityEligible: false,
        baselineObservedSince: null,
        baselineLastSoldAt: null,
        _premiumNumerator: null,
        _premiumDenominator: null,
      };
    }
    const units = BigInt(decimal(baseline.unitsSold));
    const total = BigInt(decimal(baseline.totalValue));
    const validBaseline = units > 0n && total > 0n;
    const numerator = validBaseline ? BigInt(unitPrice) * units - total : null;
    return {
      ...baseRow,
      averageUnitPrice: divideRoundedHalfUp(total, units),
      salesCount: Number(baseline.salesCount) || 0,
      premiumPercent: formatHundredths(premiumHundredths(unitPrice, baseline)),
      opportunityEligible: Number(baseline.salesCount) >= 3 && numerator != null && numerator > 0n,
      baselineObservedSince: baseline.observedSince ?? null,
      baselineLastSoldAt: baseline.lastSoldAt ?? null,
      _premiumNumerator: numerator,
      _premiumDenominator: validBaseline ? total : null,
    };
    });
  const regionalRows = rows.filter((row) => (
    (!allowedRegionIds.size || allowedRegionIds.has(row.regionId))
    && (selectedRegion === "all" || row.regionId === selectedRegion)
  ));
  const unfilteredRegionRows = regionalRows.length;
  const filteredRows = regionalRows.filter((row) => (
    !query || [
      row.itemName,
      row.buyerName,
      row.marketClaimName,
      row.regionName,
      row.rarity,
    ].some((value) => String(value).toLowerCase().includes(query))
  ));

  const sorters = {
    item: (row) => row.itemName,
    tier: (row) => String(row.tier ?? ""),
    rarity: (row) => row.rarity,
    region: (row) => row.regionId,
    buyer: (row) => row.buyerName,
    settlement: (row) => row.marketClaimName,
    quantity: (row) => row.quantity,
    unitPrice: (row) => row.unitPrice,
    totalValue: (row) => row.totalValue,
    premium: (row) => row.premiumPercent ?? "0",
    lastSeen: (row) => row.lastSeen ?? "",
  };
  const numericSorts = new Set(["tier", "region", "quantity", "unitPrice", "totalValue", "premium"]);
  const sorter = sorters[sort] ?? sorters.unitPrice;
  filteredRows.sort((left, right) => {
    const result = sort === "premium"
      ? comparePremium(left, right)
      : numericSorts.has(sort)
        ? compareBigInt(sorter(left), sorter(right))
        : compareText(sorter(left), sorter(right));
    return direction === "asc" ? result : -result;
  });
  const total = filteredRows.length;
  const offset = (page - 1) * pageSize;
  const opportunities = filteredRows
    .filter((row) => row.opportunityEligible)
    .sort((left, right) => (
      comparePremium(right, left)
      || compareBigInt(right.unitPrice, left.unitPrice)
      || compareText(left.orderKey, right.orderKey)
    ))
    .slice(0, 10)
    .map(publicBuyOrderRow);
  return {
    rows: filteredRows.slice(offset, offset + pageSize).map(publicBuyOrderRow),
    opportunities,
    baselineWindowDays: 7,
    minimumSales: 3,
    historyObservedSince: options.historyObservedSince ?? null,
    total,
    unfilteredRegionRows,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    sort,
    direction,
    regionId: selectedRegion || "all",
    sortableFields: Object.keys(sorters),
  };
}

export function regionalMarketCatalogView(snapshot, catalogRows, options = {}) {
  const index = cachedOrderIndex(snapshot, options);
  const selectedRegion = String(options.regionId ?? "all").trim().toLowerCase() || "all";
  const counts = new Map();
  if (!index) {
    for (const order of scopedOrders(snapshot, options)) {
      const key = `${itemType(order.itemType)}:${decimal(order.itemId)}`;
      const current = counts.get(key) ?? emptyOrderCounts();
      recordOrderCount(current, order);
      counts.set(key, current);
    }
  }

  const query = String(options.query ?? options.q ?? "").trim().toLowerCase();
  const category = String(options.category ?? "").trim();
  const availableOnly = options.availableOnly === true || options.availableOnly === "true";
  const hasSell = options.hasSell === true || options.hasSell === "true";
  const hasBuy = options.hasBuy === true || options.hasBuy === "true";
  const limit = Math.max(1, Math.min(50, Math.floor(Number(options.limit) || 12)));
  const items = (Array.isArray(catalogRows) ? catalogRows : []).flatMap((value) => {
    const item = catalogItem(value);
    if (query && !item.name.toLowerCase().includes(query)) return [];
    if (category && item.category !== category) return [];
    const key = `${item.itemType}:${item.itemId}`;
    const orderCounts = index
      ? indexedOrderCounts(index, key, selectedRegion)
      : counts.get(key) ?? emptyOrderCounts();
    if (availableOnly && orderCounts.sell + orderCounts.buy === 0) return [];
    if (hasSell && orderCounts.sell === 0) return [];
    if (hasBuy && orderCounts.buy === 0) return [];
    return [{
      ...item,
      sellOrders: orderCounts.sell,
      buyOrders: orderCounts.buy,
      orderCount: orderCounts.sell + orderCounts.buy,
      hasSellOrders: orderCounts.sell > 0,
      hasBuyOrders: orderCounts.buy > 0,
      lowestSellPrice: orderCounts.bestSell?.price ?? null,
      lowestSellLocation: orderCounts.bestSell?.location ?? "",
      highestBuyPrice: orderCounts.bestBuy?.price ?? null,
      highestBuyLocation: orderCounts.bestBuy?.location ?? "",
    }];
  });
  const sort = String(options.sort ?? "relevance").toLowerCase();
  const compareNullablePrice = (left, right, direction) => {
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return direction * compareBigInt(String(left), String(right));
  };
  const itemSpread = (item) => item.lowestSellPrice == null || item.highestBuyPrice == null
    ? null
    : (BigInt(item.lowestSellPrice) - BigInt(item.highestBuyPrice)).toString();
  if (sort === "name") {
    items.sort((left, right) => left.name.localeCompare(right.name));
  } else if (sort === "orders") {
    items.sort((left, right) => (
      right.orderCount - left.orderCount || left.name.localeCompare(right.name)
    ));
  } else if (sort === "lowest-sell") {
    items.sort((left, right) => compareNullablePrice(left.lowestSellPrice, right.lowestSellPrice, 1) || left.name.localeCompare(right.name));
  } else if (sort === "highest-buy") {
    items.sort((left, right) => compareNullablePrice(left.highestBuyPrice, right.highestBuyPrice, -1) || left.name.localeCompare(right.name));
  } else if (sort === "spread") {
    items.sort((left, right) => compareNullablePrice(itemSpread(left), itemSpread(right), 1) || left.name.localeCompare(right.name));
  }
  return {
    items: items.slice(0, limit),
    categories: [...new Set(items.map((item) => item.category).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right)),
  };
}

export function regionalMarketOrderBookView(snapshot, catalogRow, options = {}) {
  const requestedType = itemType(options.itemType);
  const requestedId = decimal(options.itemId);
  const index = cachedOrderIndex(snapshot, options);
  const selectedRegion = String(options.regionId ?? "all").trim().toLowerCase() || "all";
  const matchingOrders = index
    ? indexedItemOrders(index, `${requestedType}:${requestedId}`, selectedRegion)
    : scopedOrders(snapshot, options).filter((order) => (
      itemType(order.itemType) === requestedType
      && decimal(order.itemId) === requestedId
    ));
  const orders = matchingOrders
    .map((order) => ({
      ...order,
      entityId: decimal(order.entityId),
      claimEntityId: decimal(order.claimEntityId),
      regionId: decimal(order.regionId),
      ownerEntityId: decimal(order.ownerEntityId),
      itemId: requestedId,
      itemType: requestedType,
      price: decimal(order.price ?? order.priceThreshold),
      priceThreshold: decimal(order.priceThreshold ?? order.price),
      quantity: decimal(order.quantity),
      storedCoins: decimal(order.storedCoins),
    }));
  return {
    item: catalogItem(catalogRow ?? {
      itemType: requestedType,
      targetId: requestedId,
    }),
    sellOrders: orders.filter((order) => String(order.side).toLowerCase() === "sell"),
    buyOrders: orders.filter((order) => String(order.side).toLowerCase() !== "sell"),
  };
}

function favoriteQuoteScope(options = {}) {
  const selectedRegion = String(options.regionId ?? "all").trim().toLowerCase() || "all";
  const allowedRegionIds = regionIds(options.allowedRegionIds).sort(compareText);
  return {
    selectedRegion,
    allowedRegionIds,
    key: `${selectedRegion}:${allowedRegionIds.join(",")}`,
  };
}

function emptyFavoriteQuote() {
  return { bestSell: null, bestBuy: null, sellCount: 0, buyCount: 0 };
}

const FAVORITE_QUOTE_CACHE_BASE_BYTES = 1_024;
const FAVORITE_QUOTE_CACHE_ENTRY_OVERHEAD_BYTES = 1_024;

function conservativeRetainedStringBytes(value) {
  // V8 may store Latin-1 strings compactly, but two bytes per UTF-16 code unit
  // plus allocator/header slack safely estimates either representation.
  return 64 + String(value).length * 2;
}

function estimateFavoriteQuoteCacheEntryBytes(cacheKey, serializedIndex) {
  // The retained form is deliberately one serialized string rather than a Map
  // of nested objects. One KiB of per-entry slack covers the Map slot, entry
  // object, number field, alignment, and allocator bookkeeping.
  return FAVORITE_QUOTE_CACHE_ENTRY_OVERHEAD_BYTES
    + conservativeRetainedStringBytes(cacheKey)
    + conservativeRetainedStringBytes(serializedIndex);
}

export function createRegionalMarketFavoriteQuotesView({
  maxEntries = 8,
  maxEstimatedBytes = 2 * 1024 * 1024,
} = {}) {
  const entryLimit = Math.max(1, Math.floor(Number(maxEntries) || 8));
  const byteLimit = Math.max(
    FAVORITE_QUOTE_CACHE_BASE_BYTES,
    Math.floor(Number(maxEstimatedBytes) || (2 * 1024 * 1024)),
  );
  const cache = new Map();
  let estimatedBytes = FAVORITE_QUOTE_CACHE_BASE_BYTES;

  function buildIndex(snapshot, scope) {
    const source = record(snapshot);
    const allowed = new Set(scope.allowedRegionIds);
    const index = new Map();
    const orders = source.orders;
    for (const rawOrder of Array.isArray(orders) ? orders : []) {
      const order = record(rawOrder);
      const regionId = decimal(order.regionId);
      if ((allowed.size && !allowed.has(regionId))
        || (scope.selectedRegion !== "all" && scope.selectedRegion !== regionId)) continue;
      const key = `${itemType(order.itemType)}:${decimal(order.itemId)}`;
      const quote = index.get(key) ?? emptyFavoriteQuote();
      const price = decimal(order.price ?? order.priceThreshold);
      if (String(order.side ?? "buy").toLowerCase() === "sell") {
        quote.sellCount += 1;
        if (quote.bestSell == null || compareBigInt(price, quote.bestSell) < 0) quote.bestSell = price;
      } else {
        quote.buyCount += 1;
        if (quote.bestBuy == null || compareBigInt(price, quote.bestBuy) > 0) quote.bestBuy = price;
      }
      index.set(key, quote);
    }
    return index;
  }

  function view(snapshot, favorites, options = {}) {
    const scope = favoriteQuoteScope(options);
    const generation = String(options.generation ?? "").trim();
    const cacheKey = generation ? `${generation}:${scope.key}` : null;
    const cachedEntry = cacheKey ? cache.get(cacheKey) : null;
    let index = cachedEntry ? new Map(JSON.parse(cachedEntry.serializedIndex)) : null;
    if (cachedEntry && cacheKey) {
      const entry = cache.get(cacheKey);
      cache.delete(cacheKey);
      cache.set(cacheKey, entry);
    } else {
      index = buildIndex(snapshot, scope);
      if (cacheKey) {
        const serializedIndex = JSON.stringify([...index]);
        const entryBytes = estimateFavoriteQuoteCacheEntryBytes(cacheKey, serializedIndex);
        if (FAVORITE_QUOTE_CACHE_BASE_BYTES + entryBytes <= byteLimit) {
          while (cache.size >= entryLimit || estimatedBytes + entryBytes > byteLimit) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey == null) break;
            estimatedBytes -= cache.get(oldestKey).estimatedBytes;
            cache.delete(oldestKey);
          }
          cache.set(cacheKey, { serializedIndex, estimatedBytes: entryBytes });
          estimatedBytes += entryBytes;
        }
      }
    }
    return Object.fromEntries((Array.isArray(favorites) ? favorites : []).map((favorite) => {
      const key = `${itemType(favorite?.itemType)}:${decimal(favorite?.itemId)}`;
      return [key, index.get(key) ?? emptyFavoriteQuote()];
    }));
  }

  view.cacheStats = () => ({
    entries: cache.size,
    estimatedBytes,
    maxEntries: entryLimit,
    maxEstimatedBytes: byteLimit,
  });
  return view;
}

export const regionalMarketFavoriteQuotesView = createRegionalMarketFavoriteQuotesView();

export function regionalMarketFavoriteItemsView(favorites, options = {}) {
  const getEntity = typeof options.getEntity === "function" ? options.getEntity : () => null;
  return Object.fromEntries((Array.isArray(favorites) ? favorites : []).map((favorite) => {
    const normalizedItemType = itemType(favorite?.itemType);
    const itemId = decimal(favorite?.itemId);
    const key = `${normalizedItemType}:${itemId}`;
    const catalogKey = `${normalizedItemType === "cargo" ? "cargo" : "items"}:${itemId}`;
    return [key, catalogItem(getEntity(catalogKey) ?? {
      itemType: normalizedItemType,
      targetId: itemId,
    })];
  }));
}

function exactMedian(values) {
  const sorted = values
    .map(decimal)
    .sort(compareBigInt);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  const numerator = BigInt(sorted[middle - 1]) + BigInt(sorted[middle]);
  const whole = numerator / 2n;
  return numerator % 2n === 0n ? whole.toString() : `${whole}.5`;
}

function sumDecimal(values) {
  return values.reduce((total, value) => total + BigInt(decimal(value)), 0n).toString();
}

export function regionalMarketPriceQuote(snapshot, catalogRow, options = {}) {
  const orderBook = regionalMarketOrderBookView(snapshot, catalogRow, options);
  const sellPrices = orderBook.sellOrders.map((order) => order.price);
  const buyPrices = orderBook.buyOrders.map((order) => order.price);
  const sortedSellPrices = [...sellPrices].sort(compareBigInt);
  const sortedBuyPrices = [...buyPrices].sort(compareBigInt);
  return {
    item: orderBook.item,
    regionId: String(options.regionId ?? "all").trim().toLowerCase() || "all",
    sell: {
      orderCount: orderBook.sellOrders.length,
      totalQuantity: sumDecimal(orderBook.sellOrders.map((order) => order.quantity)),
      lowestUnitPrice: sortedSellPrices[0] ?? null,
      medianUnitPrice: exactMedian(sellPrices),
    },
    buy: {
      orderCount: orderBook.buyOrders.length,
      totalQuantity: sumDecimal(orderBook.buyOrders.map((order) => order.quantity)),
      highestUnitPrice: sortedBuyPrices.at(-1) ?? null,
    },
  };
}

export function regionalMarketStallsView(snapshot, options = {}) {
  const getEntity = typeof options.getEntity === "function" ? options.getEntity : () => null;
  const query = String(options.query ?? options.search ?? "").trim().toLowerCase();
  const activeOnly = options.activeOnly === true
    || options.activeOnly === "true"
    || options.hideEmpty === true
    || options.hideEmpty === "true";
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(options.pageSize) || 20)));
  const requestedPage = Math.max(1, Math.floor(Number(options.page) || 1));
  const enrichStack = (value) => {
    const stack = record(value);
    const type = itemType(stack.itemType);
    const id = decimal(stack.itemId);
    const entity = record(getEntity(`${type === "cargo" ? "cargo" : "items"}:${id}`));
    return {
      itemId: id,
      itemType: type,
      quantity: decimal(stack.quantity),
      itemName: String(entity.name ?? `${type === "cargo" ? "Cargo" : "Item"} #${id}`),
      iconAssetName: entity.iconAssetName ?? null,
    };
  };
  const stalls = scopedStalls(snapshot, options).flatMap((value) => {
    const stall = record(value);
    const orders = (Array.isArray(stall.orders) ? stall.orders : [])
      .map((orderValue) => {
        const order = record(orderValue);
        return {
          entityId: decimal(order.entityId),
          remainingStock: decimal(order.remainingStock),
          offers: (Array.isArray(order.offers) ? order.offers : []).map(enrichStack),
          requires: (Array.isArray(order.requires) ? order.requires : []).map(enrichStack),
        };
      })
      .filter((order) => !activeOnly || BigInt(order.remainingStock) > 0n);
    if (activeOnly && !orders.length) return [];
    const normalized = {
      ...stall,
      entityId: decimal(stall.entityId),
      regionId: decimal(stall.regionId),
      regionName: `R${decimal(stall.regionId)}`,
      claimEntityId: stall.claimEntityId == null ? null : decimal(stall.claimEntityId),
      ownerEntityId: stall.ownerEntityId == null ? null : decimal(stall.ownerEntityId),
      orders,
      orderCount: orders.length,
    };
    if (query) {
      const values = [
        normalized.entityId,
        normalized.nickname,
        normalized.claimName,
        normalized.ownerName,
        ...orders.flatMap((order) => [
          ...order.offers.map((stack) => stack.itemName),
          ...order.requires.map((stack) => stack.itemName),
        ]),
      ];
      if (!values.some((entry) => String(entry ?? "").toLowerCase().includes(query))) {
        return [];
      }
    }
    return [normalized];
  });
  stalls.sort((left, right) => (
    compareText(left.nickname || left.ownerName, right.nickname || right.ownerName)
    || compareBigInt(left.entityId, right.entityId)
  ));
  const totalStalls = stalls.length;
  const totalOrders = stalls.reduce((total, stall) => total + stall.orders.length, 0);
  const totalPages = Math.max(1, Math.ceil(totalStalls / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  return {
    stalls: stalls.slice(offset, offset + pageSize),
    totalStalls,
    totalOrders,
    page,
    totalPages,
    limit: pageSize,
  };
}

function decimalRatio(numerator, denominator, precision = 6) {
  const divisor = BigInt(denominator);
  if (divisor <= 0n) return null;
  const value = BigInt(numerator);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / divisor;
  const remainder = absolute % divisor;
  if (remainder === 0n || precision <= 0) {
    return `${negative ? "-" : ""}${whole}`;
  }
  const scale = 10n ** BigInt(precision);
  const fractional = ((remainder * scale) / divisor)
    .toString()
    .padStart(precision, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fractional ? `.${fractional}` : ""}`;
}

function weightedTradeSummary(trades) {
  let quantity = 0n;
  let totalValue = 0n;
  for (const trade of trades) {
    quantity += BigInt(decimal(trade.quantity));
    totalValue += BigInt(decimal(
      trade.totalPrice
      ?? (BigInt(decimal(trade.unitPrice)) * BigInt(decimal(trade.quantity))),
    ));
  }
  return {
    quantity,
    totalValue,
    average: decimalRatio(totalValue, quantity),
  };
}

export function regionalMarketPriceHistoryView(observedTrades, options = {}) {
  const requestedItemId = decimal(options.itemId);
  const requestedItemType = itemType(options.itemType);
  const requestedRegion = String(options.regionId ?? "all").trim().toLowerCase() || "all";
  const allowed = new Set(regionIds(options.allowedRegionIds));
  const now = typeof options.now === "function" ? Number(options.now()) : Date.now();
  const range = ["24h", "7d", "30d", "all"].includes(String(options.range))
    ? String(options.range)
    : "all";
  const rangeMs = {
    "24h": 86_400_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
  }[range] ?? null;
  const trades = (Array.isArray(observedTrades) ? observedTrades : [])
    .map(record)
    .filter((trade) => {
      const regionId = decimal(trade.regionId);
      const occurredAtMs = Date.parse(String(trade.occurredAt ?? ""));
      return decimal(trade.itemId) === requestedItemId
        && itemType(trade.itemType) === requestedItemType
        && (!allowed.size || allowed.has(regionId))
        && (requestedRegion === "all" || requestedRegion === regionId)
        && Number.isFinite(occurredAtMs)
        && occurredAtMs <= now;
    })
    .sort((left, right) => (
      Date.parse(String(right.occurredAt)) - Date.parse(String(left.occurredAt))
      || compareText(String(right.tradeId), String(left.tradeId))
    ));
  const observedSince = trades.length
    ? String(trades.at(-1).occurredAt)
    : null;
  const selectedTrades = rangeMs == null
    ? trades
    : trades.filter((trade) => Date.parse(String(trade.occurredAt)) >= now - rangeMs);
  const buckets = new Map();
  for (const trade of selectedTrades) {
    const bucket = String(trade.occurredAt).slice(0, 10);
    const current = buckets.get(bucket) ?? [];
    current.push(trade);
    buckets.set(bucket, current);
  }
  const priceData = [...buckets.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([bucket, bucketTrades]) => {
      const summary = weightedTradeSummary(bucketTrades);
      const prices = bucketTrades.map((trade) => decimal(trade.unitPrice)).sort(compareBigInt);
      return {
        bucket,
        quantity: summary.quantity.toString(),
        tradeCount: bucketTrades.length,
        totalValue: summary.totalValue.toString(),
        vwap: summary.average,
        low: prices[0],
        high: prices.at(-1),
      };
    });
  const rollingSummary = (durationMs, offsetMs = 0) => weightedTradeSummary(
    trades.filter((trade) => {
      const occurredAtMs = Date.parse(String(trade.occurredAt));
      return occurredAtMs >= now - offsetMs - durationMs
        && occurredAtMs < now - offsetMs;
    }),
  );
  const last24h = rollingSummary(86_400_000);
  const previous24h = rollingSummary(86_400_000, 86_400_000);
  const last7d = rollingSummary(7 * 86_400_000);
  const last30d = rollingSummary(30 * 86_400_000);
  const all = weightedTradeSummary(trades);
  const prices = trades.map((trade) => decimal(trade.unitPrice)).sort(compareBigInt);
  const priceChange24h = last24h.average != null && previous24h.average != null
    ? decimalRatio(
      (
        BigInt(last24h.totalValue) * previous24h.quantity
        - BigInt(previous24h.totalValue) * last24h.quantity
      ) * 100n,
      BigInt(previous24h.totalValue) * last24h.quantity,
    )
    : null;
  return {
    coverage: trades.length ? "locally-observed" : "collecting",
    observedSince,
    itemType: requestedItemType,
    itemId: requestedItemId,
    regionId: requestedRegion,
    range,
    priceStats: {
      avg24h: last24h.average,
      avg7d: last7d.average,
      avg30d: last30d.average,
      allTimeHigh: prices.at(-1) ?? null,
      allTimeLow: prices[0] ?? null,
      totalVolume: all.quantity.toString(),
      priceChange24h,
    },
    priceData,
    recentTrades: selectedTrades.slice(0, 20).map((trade) => ({
      id: String(trade.tradeId ?? ""),
      quantity: decimal(trade.quantity),
      unitPrice: decimal(trade.unitPrice),
      totalPrice: decimal(trade.totalPrice),
      timestamp: String(trade.occurredAt),
      createdAt: String(trade.occurredAt),
      regionId: decimal(trade.regionId),
      regionName: `R${decimal(trade.regionId)}`,
      claimId: String(trade.claimEntityId ?? ""),
    })),
    warnings: observedSince
      ? [`Price history contains only sales observed locally since ${observedSince}.`]
      : ["No confirmed local sales have been observed for this selection yet."],
  };
}

function minimumDecimal(left, right) {
  return compareBigInt(left, right) <= 0 ? decimal(left) : decimal(right);
}

function marketItemForOrder(order, getEntity) {
  const type = itemType(order.itemType);
  const id = decimal(order.itemId);
  const entity = record(getEntity?.(`${type === "cargo" ? "cargo" : "items"}:${id}`));
  return {
    itemId: id,
    itemType: type,
    itemName: String(entity.name ?? `${type === "cargo" ? "Cargo" : "Item"} #${id}`),
    itemIconAssetName: entity.iconAssetName ?? null,
  };
}

function marketCoordinates(order) {
  const locationX = Number(order.locationX);
  const locationZ = Number(order.locationZ);
  const dimension = String(order.dimension ?? "").trim();
  if (
    !Number.isSafeInteger(locationX)
    || !Number.isSafeInteger(locationZ)
    || !/^\d+$/.test(dimension)
  ) return null;
  return { locationX, locationZ, dimension };
}

function sameRegionRouteDistance(source, destination) {
  if (decimal(source.regionId) !== decimal(destination.regionId)) return null;
  const sourceCoordinates = marketCoordinates(source);
  const destinationCoordinates = marketCoordinates(destination);
  if (
    !sourceCoordinates
    || !destinationCoordinates
    || sourceCoordinates.dimension !== destinationCoordinates.dimension
  ) return null;
  return Math.abs(sourceCoordinates.locationX - destinationCoordinates.locationX)
    + Math.abs(sourceCoordinates.locationZ - destinationCoordinates.locationZ);
}

export function regionalMarketDealsView(snapshot, options = {}) {
  const getEntity = typeof options.getEntity === "function" ? options.getEntity : () => null;
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 250)));
  const byItem = new Map();
  for (const order of scopedOrders(snapshot, options)) {
    const key = `${itemType(order.itemType)}:${decimal(order.itemId)}`;
    const current = byItem.get(key) ?? { sells: [], buys: [] };
    current[String(order.side).toLowerCase() === "sell" ? "sells" : "buys"].push(order);
    byItem.set(key, current);
  }
  const deals = [];
  for (const { sells, buys } of byItem.values()) {
    sells.sort((left, right) => compareBigInt(left.price, right.price));
    buys.sort((left, right) => compareBigInt(right.price, left.price));
    for (const sell of sells.slice(0, 25)) {
      for (const buy of buys.slice(0, 25)) {
        const buyPrice = BigInt(decimal(sell.price));
        const sellPrice = BigInt(decimal(buy.price));
        if (sellPrice <= buyPrice) break;
        const profit = sellPrice - buyPrice;
        const maxQuantity = minimumDecimal(sell.quantity, buy.quantity);
        const item = marketItemForOrder(sell, getEntity);
        const basisPoints = buyPrice > 0n ? (profit * 10_000n) / buyPrice : 0n;
        const buyCoordinates = marketCoordinates(sell);
        const sellCoordinates = marketCoordinates(buy);
        deals.push({
          routeKey: `${decimal(sell.entityId)}:${decimal(buy.entityId)}`,
          ...item,
          buyOrderId: decimal(sell.entityId),
          sellOrderId: decimal(buy.entityId),
          buyPrice: buyPrice.toString(),
          sellPrice: sellPrice.toString(),
          buyQuantity: decimal(sell.quantity),
          sellQuantity: decimal(buy.quantity),
          maxQuantity,
          profit: profit.toString(),
          totalPotential: (profit * BigInt(maxQuantity)).toString(),
          profitPercent: Number(basisPoints) / 100,
          buyClaimId: decimal(sell.claimEntityId),
          buyLocation: String(sell.claimName ?? ""),
          buyRegionId: decimal(sell.regionId),
          sellClaimId: decimal(buy.claimEntityId),
          sellLocation: String(buy.claimName ?? ""),
          sellRegionId: decimal(buy.regionId),
          buyCoordinates,
          sellCoordinates,
          distance: sameRegionRouteDistance(sell, buy),
        });
      }
    }
  }
  deals.sort((left, right) => (
    compareBigInt(right.profit, left.profit)
    || compareBigInt(right.totalPotential, left.totalPotential)
    || compareText(left.itemName, right.itemName)
  ));
  return {
    deals: deals.slice(0, limit),
    coverage: "current-orders",
    historyUnavailable: ["movers", "trade-volume", "completed-sales"],
  };
}

function observedMarketMoverView(options, getEntity) {
  const now = typeof options.now === "function" ? Number(options.now()) : Date.now();
  const currentStart = now - 86_400_000;
  const previousStart = currentStart - 86_400_000;
  const requestedRegion = String(options.regionId ?? "all");
  const allowed = new Set(regionIds(options.allowedRegionIds));
  const groups = new Map();
  let observedSince = null;
  let confirmedSales = 0;
  for (const value of (Array.isArray(options.observedTrades) ? options.observedTrades : [])) {
    const trade = record(value);
    const regionId = decimal(trade.regionId);
    if (allowed.size && !allowed.has(regionId)) continue;
    if (requestedRegion !== "all" && regionId !== requestedRegion) continue;
    const occurredAt = String(trade.occurredAt ?? "");
    const occurredAtMs = Date.parse(occurredAt);
    if (!Number.isFinite(occurredAtMs)) continue;
    observedSince = observedSince == null || occurredAt < observedSince
      ? occurredAt
      : observedSince;
    confirmedSales += 1;
    if (occurredAtMs < previousStart || occurredAtMs > now) continue;
    const itemId = decimal(trade.itemId);
    const type = itemType(trade.itemType);
    const quantity = BigInt(decimal(trade.quantity));
    const totalPrice = BigInt(decimal(
      trade.totalPrice ?? (BigInt(decimal(trade.unitPrice)) * quantity),
    ));
    if (quantity <= 0n) continue;
    const key = `${type}:${itemId}`;
    const group = groups.get(key) ?? {
      itemId,
      itemType: type,
      currentQuantity: 0n,
      currentValue: 0n,
      previousQuantity: 0n,
      previousValue: 0n,
      salesCount: 0,
      unitsSold: 0n,
    };
    const period = occurredAtMs >= currentStart ? "current" : "previous";
    group[`${period}Quantity`] += quantity;
    group[`${period}Value`] += totalPrice;
    group.salesCount += 1;
    group.unitsSold += quantity;
    groups.set(key, group);
  }
  const movers = [...groups.values()].flatMap((group) => {
    if (group.currentQuantity <= 0n || group.previousQuantity <= 0n) return [];
    if (group.previousValue <= 0n) return [];
    const currentAverage = decimalRatio(group.currentValue, group.currentQuantity);
    const previousAverage = decimalRatio(group.previousValue, group.previousQuantity);
    const changeBasisPoints = (
      (
        group.currentValue * group.previousQuantity
        - group.previousValue * group.currentQuantity
      ) * 10_000n
    ) / (group.previousValue * group.currentQuantity);
    const entity = record(getEntity?.(
      `${group.itemType === "cargo" ? "cargo" : "items"}:${group.itemId}`,
    ));
    return [{
      itemId: group.itemId,
      itemType: group.itemType,
      itemName: String(
        entity.name ?? `${group.itemType === "cargo" ? "Cargo" : "Item"} #${group.itemId}`,
      ),
      itemIconAssetName: entity.iconAssetName ?? null,
      previousAverage,
      currentAverage,
      changePercent: Number(changeBasisPoints) / 100,
      salesCount: group.salesCount,
      unitsSold: group.unitsSold.toString(),
    }];
  }).sort((left, right) => (
    Math.abs(right.changePercent) - Math.abs(left.changePercent)
    || compareText(left.itemName, right.itemName)
  ));
  return {
    movers: movers.slice(0, 20),
    moverBaseline: movers.length ? "locally-observed-24h" : "collecting",
    observedSince,
    confirmedSales,
  };
}

export function regionalMarketOverviewView(snapshot, options = {}) {
  const getEntity = typeof options.getEntity === "function" ? options.getEntity : () => null;
  const orders = scopedOrders(snapshot, options);
  const liquidity = new Map();
  const hubs = new Map();
  for (const order of orders) {
    const item = marketItemForOrder(order, getEntity);
    const itemKey = `${item.itemType}:${item.itemId}`;
    const currentItem = liquidity.get(itemKey) ?? {
      ...item,
      iconAssetName: item.itemIconAssetName,
      orderCount: 0,
      offeredQuantity: 0n,
      wantedQuantity: 0n,
      currentNotional: 0n,
    };
    const quantity = BigInt(decimal(order.quantity));
    const price = BigInt(decimal(order.price));
    currentItem.orderCount += 1;
    currentItem[String(order.side).toLowerCase() === "sell" ? "offeredQuantity" : "wantedQuantity"] += quantity;
    currentItem.currentNotional += price * quantity;
    liquidity.set(itemKey, currentItem);

    const claimId = decimal(order.claimEntityId);
    const currentHub = hubs.get(claimId) ?? {
      claimId,
      claimName: String(order.claimName ?? ""),
      regionId: decimal(order.regionId),
      regionName: `R${decimal(order.regionId)}`,
      orderCount: 0,
      sellers: new Set(),
      buyers: new Set(),
    };
    currentHub.orderCount += 1;
    currentHub[String(order.side).toLowerCase() === "sell" ? "sellers" : "buyers"]
      .add(decimal(order.ownerEntityId));
    hubs.set(claimId, currentHub);
  }
  const deals = regionalMarketDealsView(snapshot, {
    ...options,
    getEntity,
    limit: 50,
  });
  const observed = observedMarketMoverView(options, getEntity);
  return {
    topDeals: deals.deals,
    ...observed,
    mostLiquid: [...liquidity.values()]
      .sort((left, right) => (
        right.orderCount - left.orderCount
        || compareBigInt(right.currentNotional, left.currentNotional)
      ))
      .slice(0, 20)
      .map(({ itemIconAssetName, ...row }) => ({
        ...row,
        offeredQuantity: row.offeredQuantity.toString(),
        wantedQuantity: row.wantedQuantity.toString(),
        currentNotional: row.currentNotional.toString(),
      })),
    hubs: [...hubs.values()]
      .sort((left, right) => right.orderCount - left.orderCount || compareText(left.claimName, right.claimName))
      .slice(0, 20)
      .map(({ sellers, buyers, ...hub }) => ({
        ...hub,
        sellerCount: sellers.size,
        buyerCount: buyers.size,
      })),
    recentActivity: orders
      .map((order) => ({
        id: decimal(order.entityId),
        ...marketItemForOrder(order, getEntity),
        side: String(order.side).toLowerCase() === "sell" ? "sell" : "buy",
        quantity: decimal(order.quantity),
        unitPrice: decimal(order.price),
        claimId: decimal(order.claimEntityId),
        claimName: String(order.claimName ?? ""),
        regionId: decimal(order.regionId),
        regionName: `R${decimal(order.regionId)}`,
        ownerName: String(order.ownerUsername ?? ""),
        createdAt: String(order.timestamp ?? ""),
      }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 20),
    coverage: deals.coverage,
    historyUnavailable: deals.historyUnavailable,
  };
}
