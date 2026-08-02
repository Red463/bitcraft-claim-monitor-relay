import React from "react";
import "../styles/dashboard.css";
import { AlertTriangle, ArrowUp, CircleDollarSign, Factory, Globe2, Hammer, Package, Target, TrendingUp, Users } from "lucide-react";

import { DashboardCardHeader, DashboardMetric, DashboardTrend } from "../components/main/DashboardWidgets";
import { TierBadge, TrackedOwnerName } from "../components/main/Badges";
import { ItemIcon } from "../components/main/ItemDisplay";
import { PageHeader } from "../components/main/PageHeader";
import { Segmented } from "../components/main/Segmented";
import {
  claimSupplyRunOutAt,
  parseDateValue,
  toNumber,
  type AnyRecord,
} from "../main-app-data";
import {
  formatCompactNumber,
  formatCurrentSession,
  formatDaysAndHours,
  formatNumber,
  shortDateLabel,
} from "../utils/format";
import { normalizeData } from "../utils/normalize";
import { useManualRefresh } from "../refresh/ManualRefreshContext";
import { manualRefreshHeaders } from "../refresh/manualRefresh.mjs";
import type { ActivePanel } from "../types/app";
import { activityMetadata, signedDelta } from "./activity/activityUtils";
import { MARKET_INCOME_RANGES, buildMarketIncomeSummary, type MarketIncomeRangeDays } from "./market/marketAnalytics";
import { hasRecentCraftContribution } from "./production/productionUtils";
import { dashboardRegionWealth } from "./dashboardView";
import { researchSettlementCaps } from "./researchView";

export function Dashboard({ data, activity, marketHistory, dashboardSummary, lastUpdated, onNavigate }: { data: ReturnType<typeof normalizeData>; activity: AnyRecord[]; marketHistory: AnyRecord | null; dashboardSummary: AnyRecord | null; lastUpdated: Date | null; onNavigate: (panel: ActivePanel, marketTab?: string) => void }) {
  const { request, trackPromise } = useManualRefresh();
  const [marketIncomeRange, setMarketIncomeRange] = React.useState<MarketIncomeRangeDays>(7);
  const { claim, members, market, construction, crafts, research } = data;
  const supplies = toNumber(claim.supplies);
  const { maxSupplies: supplyCap } = researchSettlementCaps(claim, research);
  const treasury = toNumber(claim.treasury);
  const upkeep = toNumber(claim.upkeepCost);
  const tileCost = toNumber(claim.tileCost);
  const tileCount = toNumber(claim.numTiles);
  const suppliesPerDay = (upkeep || tileCost * tileCount) * 24;
  const supplyRunOutAt = claimSupplyRunOutAt(claim);
  const runOutDate = parseDateValue(supplyRunOutAt);
  const supplyDays = runOutDate && runOutDate.getTime() > Date.now()
    ? (runOutDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    : suppliesPerDay > 0 ? supplies / suppliesPerDay : 0;
  const supplyPct = supplyCap > 0 ? Math.max(2, Math.min(100, (supplies / supplyCap) * 100)) : Math.max(4, Math.min(100, supplyDays ? (Math.min(supplyDays, 14) / 14) * 100 : 0));
  const onlinePlayers = data.players.filter((player) => player.signedIn);
  const onlineCount = onlinePlayers.length;
  const constructionProjects = Array.isArray(construction) ? construction : (construction.projects ?? []);
  const activeProjects = constructionProjects.filter((project: AnyRecord) => toNumber(project.progress) < toNumber(project.actionsRequired || 0)).length;
  const activeCrafts = crafts.filter((job) => {
    const progress = toNumber(job.progress);
    const total = toNumber(job.totalActionsRequired);
    return total > 0 && progress < total && hasRecentCraftContribution(data.contributions[String(job.entityId)] ?? []);
  }).length;
  const marketListingValue = market.reduce((total, listing) => {
    const explicitTotal = toNumber(listing.totalValue ?? listing.total_value);
    return total + (explicitTotal || toNumber(listing.price) * Math.max(1, toNumber(listing.quantity || 1)));
  }, 0);
  const {
    settlements: regionSettlements,
    settlementCount: regionSettlementCount,
    treasury: regionWealth,
  } = dashboardRegionWealth(data.region);
  const regionWealthDetail = regionSettlementCount
    ? `${formatNumber(regionSettlementCount)} player settlement${regionSettlementCount === 1 ? "" : "s"} in region`
    : "Region data loading";
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const treasuryEventsToday = activity.filter((event) => {
    if (event.event_type !== "treasury") return false;
    const occurredAt = parseDateValue(event.occurred_at);
    return !!occurredAt && occurredAt >= todayStart;
  }).map((event) => ({ event, metadata: activityMetadata(event) })).filter(({ metadata }) => metadata.before != null && metadata.after != null);
  const treasuryDeltasToday = treasuryEventsToday.map(({ metadata }) => toNumber(metadata.after) - toNumber(metadata.before));
  const fallbackTreasuryNetToday = treasuryDeltasToday.reduce((total, delta) => total + delta, 0);
  const treasuryNetToday = dashboardSummary?.treasuryNetToday == null ? fallbackTreasuryNetToday : toNumber(dashboardSummary.treasuryNetToday);
  const marketTotals = marketHistory?.totals ?? {};
  const storedMarketIncome = marketTotals.trackedValue ?? marketTotals.totalValue;
  const marketIncome = buildMarketIncomeSummary(
    Array.isArray(marketHistory?.daily) ? marketHistory.daily : [],
    lastUpdated ?? new Date(),
    marketIncomeRange,
    storedMarketIncome == null ? undefined : toNumber(storedMarketIncome),
  );
  const confirmedMarketSales = marketTotals.confirmedSales == null && marketTotals.salesCount == null
    ? marketIncome.salesCount
    : toNumber(marketTotals.confirmedSales ?? marketTotals.salesCount);
  const confirmedMarketUnits = marketTotals.confirmedUnits == null && marketTotals.unitsSold == null
    ? marketIncome.unitsSold
    : toNumber(marketTotals.confirmedUnits ?? marketTotals.unitsSold);
  const confirmedMarketIncome = storedMarketIncome == null ? marketIncome.totalValue : toNumber(storedMarketIncome);
  const marketIncomeDetail = confirmedMarketSales
    ? `${formatNumber(confirmedMarketSales, 0)} sale${confirmedMarketSales === 1 ? "" : "s"} - ${formatNumber(confirmedMarketUnits, 0)} units sold`
    : "No confirmed sales tracked yet";
  const [craftPlan, setCraftPlan] = React.useState<AnyRecord | null>(null);
  React.useEffect(() => {
    const monitoredClaimId = String(claim.entityId ?? claim.id ?? "").trim();
    if (!monitoredClaimId) return;
    let stale = false;
    const controller = new AbortController();
    const refresh = fetch(`/api/local/craft-plan?claimId=${encodeURIComponent(monitoredClaimId)}`, { headers: manualRefreshHeaders(request, "dashboard"), signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (!stale) setCraftPlan(body); });
    void trackPromise("dashboard-craft-plan", refresh).catch(() => {});
    return () => { stale = true; controller.abort(); };
  }, [claim.entityId, claim.id, request?.sequence, trackPromise]);
  const gatherNextPreview = (Array.isArray(craftPlan?.gatherNext) ? craftPlan.gatherNext : []).flatMap((group: AnyRecord) => {
    const item = Array.isArray(group.items) ? group.items[0] : null;
    return item ? [{ ...item, section: group.section ?? item.section ?? "Other" }] : [];
  }).slice(0, 5);
  const regionNameById = new Map<string, string>();
  for (const region of data.regionStatus ?? []) {
    const regionId = String(region.regionId ?? "").trim();
    const regionName = String(region.regionName ?? "").trim();
    if (regionId && regionName) regionNameById.set(regionId, regionName);
  }
  const memberByPlayerId = new Map(members.map((member) => [String(member.playerEntityId), member]));
  const dashboardMembers: AnyRecord[] = onlinePlayers.map((player: AnyRecord) => {
    const member = memberByPlayerId.get(String(player.entityId));
    const regionId = player.regionId == null ? "" : String(player.regionId).trim();
    const regionName = player.regionName ?? (regionId ? regionNameById.get(regionId) ?? `R${regionId}` : null);
    return {
      ...player,
      displayName: player.username ?? player.userName ?? member?.userName ?? "Unknown member",
      regionId: regionId || null,
      regionName,
    };
  }).slice(0, 4);
  const rawData = (data as ReturnType<typeof normalizeData> & { raw?: AnyRecord | null }).raw;
  const craftItemLookup = new Map([...(rawData?.crafts?.items ?? []), ...(rawData?.crafts?.cargos ?? [])].map((item: AnyRecord) => [String(item.id), item]));
  const currentCrafts = crafts.map((job) => {
    const item = craftItemLookup.get(String(job.craftedItem?.[0]?.item_id)) ?? {};
    const progress = toNumber(job.progress);
    const total = toNumber(job.totalActionsRequired);
    const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;
    const skillId = toNumber(job.levelRequirements?.[0]?.skill_id ?? job.experiencePerProgress?.[0]?.skill_id);
    const experiencePerEffort = toNumber(job.experiencePerProgress?.find((xp: AnyRecord) => toNumber(xp.skill_id) === skillId)?.quantity ?? job.experiencePerProgress?.[0]?.quantity ?? job.experiencePerEffort);
    const totalXp = toNumber(job.totalXp ?? job.totalXP) || total * experiencePerEffort;
    const name = String(item.name ?? job.recipeName ?? job.craftName ?? job.buildingName ?? "Craft");
    return {
      id: String(job.entityId ?? `${job.recipeName}-${job.buildingName}`),
      item: Object.keys(item).length ? item : { name },
      name,
      detail: job.buildingName ?? "Production",
      pct,
      totalXp,
    };
  }).sort((a, b) => b.pct - a.pct || b.totalXp - a.totalXp || a.name.localeCompare(b.name));
  const currentCraftsDisplay = currentCrafts.slice(0, 5);
  const totalProductionXp = currentCrafts.reduce((sum, job) => sum + job.totalXp, 0);
  const attention = [
    supplyDays > 0 && supplyDays < 7 ? { icon: <AlertTriangle />, count: "!", title: "Low Supplies", body: `${formatDaysAndHours(supplyDays)} remaining`, panel: "inventory" as ActivePanel, tone: "danger" } : null,
    activeProjects ? { icon: <Hammer />, count: activeProjects, title: "Construction Projects", body: `${activeProjects} project${activeProjects === 1 ? "" : "s"} in progress`, panel: "construction" as ActivePanel, tone: "warn" } : null,
    crafts.length ? { icon: <Factory />, count: crafts.length, title: "Production Queue", body: `${activeCrafts} active, ${crafts.length} total job${crafts.length === 1 ? "" : "s"}`, panel: "production" as ActivePanel, tone: "blue" } : null,
  ].filter(Boolean).slice(0, 4) as Array<{ icon: React.ReactNode; count: React.ReactNode; title: string; body: string; panel: ActivePanel; tone: string }>;
  return (
    <div className="dashboard-page">
      <PageHeader
        title="Dashboard"
        description={`Real-time summary of ${claim.name ?? "the monitored settlement"}`}
        meta={<div className="dashboard-top-meta">
          <div className="dashboard-meta-cluster">
            <span className="dashboard-region-line"><Globe2 size={15} /> {claim.regionName ?? "Unknown"} <span className="dashboard-region-badge">R{claim.regionId ?? "?"}</span></span>
            <span className="dashboard-refresh-line"><span className="online-dot is-online" /> Last updated {lastUpdated ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "waiting"}</span>
          </div>
          <span className="dashboard-claim-link"><TierBadge tier={claim.tier} /> {claim.name ?? "Monitored Settlement"}</span>
        </div>}
      />

      <section className="dashboard-kpis" data-tour="dashboard-summary">
        <DashboardMetric icon={<Users />} label="Members" value={members.length} detail={`${onlineCount} online now`} onClick={() => onNavigate("members")} />
        <DashboardMetric icon={<Package />} label="Supply Status" value={formatDaysAndHours(supplyDays)} detail={`${formatNumber(supplies)} stored`} progress={supplyPct} tone="green" onClick={() => onNavigate("inventory")} />
        <DashboardMetric icon={<CircleDollarSign />} label="Treasury" value={`${formatNumber(treasury)}g`} detail={`${signedDelta(treasuryNetToday, 0, "g")} net today`} tone="gold" onClick={() => onNavigate("activity")} />
        <DashboardMetric icon={<TrendingUp />} label="Market Listings" value={market.length} detail={`${formatCompactNumber(marketListingValue)} total listing value`} tone="green" onClick={() => onNavigate("market")} />
        <DashboardMetric icon={<CircleDollarSign />} label="Region Wealth" value={regionSettlementCount ? formatCompactNumber(regionWealth) : "-"} detail={regionWealthDetail} tone="gold" onClick={() => onNavigate("region")} />
      </section>

      <section className="dashboard-main-grid">
        <article className="dashboard-card dashboard-card-chart">
          <DashboardCardHeader
            title="Market Income Total Over Time"
            icon={<CircleDollarSign size={15} />}
            control={(
              <Segmented<`${MarketIncomeRangeDays}`>
                label="Market income range"
                options={MARKET_INCOME_RANGES}
                value={String(marketIncomeRange) as `${MarketIncomeRangeDays}`}
                onChange={(value) => setMarketIncomeRange(Number(value) as MarketIncomeRangeDays)}
              />
            )}
          />
          <div className="dashboard-money-row">
            <strong>{confirmedMarketIncome ? `${formatNumber(confirmedMarketIncome)}g` : "0g"}</strong>
            <span className={confirmedMarketIncome > 0 ? "positive" : ""}>{marketIncomeDetail}</span>
          </div>
          {marketIncome.partialRange && marketIncome.availableStartDay
            ? <p className="dashboard-chart-coverage">Stored sales begin {shortDateLabel(marketIncome.availableStartDay)}.</p>
            : null}
          <DashboardTrend points={marketIncome.trend} suffix="g" yAxisLabel="Cumulative gold" ariaLabel="Cumulative market income trend" emptyMessage="No confirmed market sales tracked yet." />
        </article>
        <article className="dashboard-card dashboard-card-supply">
          <DashboardCardHeader title="Supply Status" icon={<Package size={15} />} />
          <div className="dashboard-supply-lead"><strong>{formatDaysAndHours(supplyDays)}</strong><span>until full depletion</span></div>
          <div className="dashboard-supply-cap"><span>{formatNumber(supplies)}{supplyCap ? ` / ${formatNumber(supplyCap)}` : ""}</span><span>{supplyCap ? `${Math.round((supplies / supplyCap) * 100)}% capacity` : "Runway estimate"}</span></div>
          <div className="dashboard-progress"><div style={{ width: `${supplyPct}%` }} /></div>
          <div className="dashboard-supply-breakdown">
            <ul>
              <li><span className="yellow" /> Supplies per day <b>{formatNumber(suppliesPerDay, 0)}</b></li>
              <li><span className="green" /> Storage cap <b>{supplyCap ? formatNumber(supplyCap) : "Unknown"}</b></li>
              <li><span className="blue" /> Current stock <b>{formatNumber(supplies)}</b></li>
            </ul>
          </div>
        </article>

        <article className="dashboard-card dashboard-card-activity">
          <DashboardCardHeader title="Gather Next" icon={<Target size={15} />} action="Open plan" onClick={() => onNavigate("planning")} />
          <div className="dashboard-feed">
            {gatherNextPreview.length ? gatherNextPreview.map((item) => (
              (() => {
                const itemTier = item.tier ?? item.itemTier ?? item.tierLevel;
                return <button key={item.key ?? `${item.section}-${item.name}`} className="dashboard-feed-row warn" onClick={() => onNavigate("planning")}>
                  <span><ItemIcon item={item} /></span>
                  <strong>{item.section ?? "Other"}</strong>
                  <span className="dashboard-feed-item"><small>{item.name ?? "Unknown item"}</small>{itemTier ? <TierBadge tier={itemTier} /> : null}</span>
                  <time>{formatNumber(item.missing, 0)}</time>
                </button>;
              })()
            )) : <div className="dashboard-empty">No craft plan needs are configured yet.</div>}
          </div>
        </article>

        <article className="dashboard-card dashboard-card-members">
          <DashboardCardHeader title={`Online Members (${onlineCount})`} icon={<Users size={15} />} action="View all" onClick={() => onNavigate("members")} />
          <div className="dashboard-member-list">
            {dashboardMembers.length ? dashboardMembers.map((player) => (
              <button key={player.entityId} onClick={() => onNavigate("members")}>
                <span className="dashboard-avatar">{String(player.displayName ?? "?").slice(0, 1).toUpperCase()}<i className="online-dot is-online" /></span>
                <span className="dashboard-member-copy">
                  <strong><TrackedOwnerName name={player.displayName} claim={claim} members={members} /></strong>
                  <small>{player.regionName ?? "Location unknown"}</small>
                </span>
                <span className="dashboard-member-session">
                  <em>Online</em>
                  <small>{formatCurrentSession(player.sessionSeconds) ? `Playing ${formatCurrentSession(player.sessionSeconds)}` : "Playtime unavailable"}</small>
                </span>
              </button>
            )) : <div className="dashboard-empty">No members are currently online.</div>}
          </div>
        </article>

        <article className="dashboard-card dashboard-card-production">
          <DashboardCardHeader title="Current Crafts" icon={<Factory size={15} />} action="View production" onClick={() => onNavigate("craft-monitor")} />
          <div className="dashboard-production-list">
            {currentCraftsDisplay.length ? currentCraftsDisplay.map((job) => (
              <button key={job.id} onClick={() => onNavigate("craft-monitor")}>
                <span className="dashboard-item-icon"><ItemIcon item={job.item} /></span>
                <strong>{job.name}</strong>
                <b>{job.pct}%</b>
                <i><span style={{ width: `${Math.max(4, job.pct)}%` }} /></i>
              </button>
            )) : <div className="dashboard-empty">No current production jobs in the API snapshot.</div>}
          </div>
          <div className="dashboard-total-row"><span>Total Production XP</span><strong>{formatNumber(totalProductionXp)}</strong></div>
        </article>

        <article className="dashboard-card dashboard-card-attention">
          <DashboardCardHeader title="Needs Attention" icon={<AlertTriangle size={15} />} />
          <div className="dashboard-alert-list">
            {attention.length ? attention.map((item) => (
              <button key={item.title} className={item.tone} onClick={() => onNavigate(item.panel)}>
                <span>{item.count}</span>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
                <ArrowUp size={14} />
              </button>
            )) : <div className="dashboard-empty">No urgent settlement issues detected.</div>}
          </div>
        </article>
      </section>
    </div>
  );
}
