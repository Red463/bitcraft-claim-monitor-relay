import React from "react";
import "../styles/production.css";
import { Activity, AlertTriangle, CheckCircle2, Factory, Lock, Star, TrendingUp, User, Wrench } from "lucide-react";

import { TierBadge, TrackedOwnerName } from "../components/main/Badges";
import { DataTable } from "../components/main/DataTable";
import { ItemIcon } from "../components/main/ItemDisplay";
import { PageHeader } from "../components/main/PageHeader";
import { Segmented } from "../components/main/Segmented";
import { MiniStat } from "../components/main/Stats";
import { toNumber, type AnyRecord } from "../main-app-data";
import { formatEquipmentSlot, formatNumber, timeAgo } from "../utils/format";
import { usePersistedState } from "../hooks/usePersistedState";
import { playerToolbeltTools } from "../utils/items";
import { normalizeData } from "../utils/normalize";
import { SKILL_NAMES, TOOL_TAG_BY_TYPE } from "../utils/professions";
import { trackAnalyticsEvent } from "../utils/analytics";
import { formatDecimalQuantity } from "../server/game-data/inventoryProjection";
import { useManualRefresh } from "../refresh/ManualRefreshContext";
import { manualRefreshHeaders } from "../refresh/manualRefresh.mjs";
import { craftProgressKey, hasRecentCraftContribution, productionMetrics } from "./production/productionUtils";
import { evaluateCraftEligibility } from "./production/toolEligibility";

export function MemberPassiveCrafts({ rows }: { rows: AnyRecord[] }) {
  return (
    <section className="settlement-passive-crafts">
      <div className="split-header">
        <div className="dashboard-section-heading">
          <h3><Factory size={15} /> Member Passive Crafts</h3>
          <p>Current settlement passive output joined to its member and structure by the Relay.</p>
        </div>
      </div>
      {rows.length === 0 ? <div className="empty-state"><Factory />No current passive crafts reported for this settlement.</div> : null}
      {rows.length ? <DataTable rows={rows} scrollLabel="Production jobs table" emptyState="No production jobs match the current filters." columns={[
        ["Output", (row) => <strong>{row.recipe}</strong>],
        ["Tier", (row) => row.tier ? <TierBadge tier={row.tier} /> : "-"],
        ["Member", (row) => row.memberName],
        ["Structure", (row) => row.structure],
        ["Status", (row) => <span className={`status-pill ${row.status === "complete" ? "complete" : ""}`}>{formatEquipmentSlot(row.status)}</span>],
        ["Quantity", (row) => formatDecimalQuantity(row.quantity)],
        ["Latest", (row) => row.timestamp ? timeAgo(row.timestamp) : "Current Relay snapshot"],
      ]} /> : null}
    </section>
  );
}

export function Production({ data, refreshToken, selectedMemberId, onSelectMember }: { data: ReturnType<typeof normalizeData> & { raw?: AnyRecord | null }; refreshToken: number; selectedMemberId: string; onSelectMember: (id: string) => void }) {
  const { request, trackPromise } = useManualRefresh();
  type ProductionSortKey = "tier" | "totalXp" | "remainingXp" | "remainingEffort" | "completion" | "name";
  const [sortKey, setSortKey] = usePersistedState<ProductionSortKey>("production.sort", "tier");
  const [sortDir, setSortDir] = usePersistedState<"asc" | "desc">("production.direction", "desc");
  const [showPrivateCrafts, setShowPrivateCrafts] = usePersistedState("production.showPrivateCrafts", false);
  const [toolbeltTools, setToolbeltTools] = React.useState<AnyRecord[] | null>(null);
  const [toolbeltError, setToolbeltError] = React.useState(false);
  const toolsForMemberRef = React.useRef<string | null>(null);
  const observedCraftProgressRef = React.useRef<Map<string, number>>(new Map());
  const [observedMovingCrafts, setObservedMovingCrafts] = React.useState<Set<string>>(() => new Set());
  const itemLookup = new Map<string, AnyRecord>(
    Object.entries(data.raw?.crafts?.catalog ?? {}).map(([key, value]) => [key, (value ?? {}) as AnyRecord]),
  );
  const passiveCrafts = Array.isArray(data.raw?.crafts?.passiveCraftResults)
    ? data.raw.crafts.passiveCraftResults as AnyRecord[]
    : [];
  const selectedMember = selectedMemberId === "All" ? null : data.members.find((member: AnyRecord) => String(member.playerEntityId) === selectedMemberId) ?? null;
  const selectedMemberName = selectedMember ? String(selectedMember.userName ?? selectedMember.username ?? "") : "";
  const selectedCitizen = selectedMember ? data.citizens.find((citizen: AnyRecord) => String(citizen.userName ?? citizen.username) === selectedMemberName) ?? null : null;
  const crafterMemberIdByName = data.members.reduce<Record<string, string>>((acc, member: AnyRecord) => {
    const name = String(member.userName ?? member.username ?? "");
    if (name && member.playerEntityId) acc[name] = String(member.playerEntityId);
    return acc;
  }, {});
  const craftProgressSignature = React.useMemo(() => data.crafts.map((job: AnyRecord) => [
    craftProgressKey(job),
    toNumber(job.progress),
    toNumber(job.totalActionsRequired),
  ].join(":")).join("|"), [data.crafts]);
  React.useEffect(() => {
    const previous = observedCraftProgressRef.current;
    const next = new Map<string, number>();
    const moving = new Set<string>();
    for (const job of data.crafts) {
      const key = craftProgressKey(job);
      const progress = toNumber(job.progress);
      const total = toNumber(job.totalActionsRequired);
      const previousProgress = previous.get(key);
      if (previousProgress != null && progress > previousProgress && (!total || progress < total)) moving.add(key);
      next.set(key, progress);
    }
    observedCraftProgressRef.current = next;
    setObservedMovingCrafts(moving);
  }, [craftProgressSignature]);
  const isCraftObservedMoving = React.useCallback((job: AnyRecord) => observedMovingCrafts.has(craftProgressKey(job)), [observedMovingCrafts]);
  const isCraftWorking = React.useCallback((job: AnyRecord, contributors: AnyRecord[]) => {
    return hasRecentCraftContribution(contributors) || isCraftObservedMoving(job);
  }, [isCraftObservedMoving]);
  React.useEffect(() => {
    if (!selectedMember?.playerEntityId) {
      setToolbeltTools(null);
      setToolbeltError(false);
      toolsForMemberRef.current = null;
      return;
    }
    const controller = new AbortController();
    const memberId = String(selectedMember.playerEntityId);
    if (toolsForMemberRef.current !== memberId) {
      toolsForMemberRef.current = memberId;
      setToolbeltTools(null);
    }
    setToolbeltError(false);
    const claimId = String(data.claim.entityId ?? data.raw?.claimId ?? "");
    const query = new URLSearchParams({ claimId, playerId: memberId, domains: "inventory" });
    const refresh = fetch(`/api/local/player-data?${query.toString()}`, {
      headers: manualRefreshHeaders(request, "craft-monitor"),
      signal: controller.signal,
    })
      .then((response) => (
        response.ok
          ? response.json()
          : Promise.reject(new Error(`Relay player inventory HTTP ${response.status}`))
      ))
      .then((payload) => {
        const inventory = payload?.domains?.inventory?.data ?? null;
        setToolbeltTools(playerToolbeltTools(inventory));
      });
    void trackPromise("production-toolbelt", refresh)
      .catch(() => {
        if (!controller.signal.aborted) setToolbeltError(true);
      });
    return () => controller.abort();
  }, [
    selectedMember?.playerEntityId,
    data.claim.entityId,
    data.raw?.claimId,
    refreshToken,
    request?.sequence,
    trackPromise,
  ]);
  const selectCrafterPill = (name: string) => {
    if (!crafterMemberIdByName[name]) return;
    onSelectMember(selectedMemberName === name ? "All" : crafterMemberIdByName[name]);
    trackAnalyticsEvent("production_crafter_pill_filter_used", { scope: selectedMemberName === name ? "all_members" : "member" });
  };
  function eligibility(job: AnyRecord) {
    if (!selectedMember) return null;
    const requirement = job.levelRequirements?.[0] ?? {};
    const requiredLevel = toNumber(requirement.level);
    const skillId = toNumber(requirement.skillId ?? requirement.skill_id);
    const skillName = SKILL_NAMES[skillId] ?? "Required skill";
    const memberLevel = toNumber(selectedCitizen?.skills?.[String(skillId)]);
    const toolRequirement = job.toolRequirements?.[0];
    const toolType = toNumber(toolRequirement?.toolType ?? toolRequirement?.tool_type);
    return evaluateCraftEligibility({
      skillName,
      requiredLevel,
      memberLevel,
      toolRequirement,
      expectedTool: toolRequirement ? TOOL_TAG_BY_TYPE[toolType] : null,
      tools: toolbeltTools,
      toolbeltUnavailable: toolbeltError && toolbeltTools == null,
    });
  }
  const visibilityKnownCrafts = data.crafts.filter(
    (job) => job.visibility === "public"
      || job.visibility === "private"
      || typeof job.isPublic === "boolean",
  );
  const privateCrafts = visibilityKnownCrafts.filter(
    (job) => job.visibility === "private" || job.isPublic === false,
  );
  const visibilityFilteredCrafts = showPrivateCrafts
    ? visibilityKnownCrafts
    : visibilityKnownCrafts.filter(
        (job) => job.visibility !== "private" && job.isPublic !== false,
      );
  const unknownVisibilityCrafts = data.crafts.length - visibilityKnownCrafts.length;
  const visibleCrafts = selectedMemberName
    ? visibilityFilteredCrafts.filter((job) => String(job.ownerUsername ?? "Unknown") === selectedMemberName)
    : visibilityFilteredCrafts;
  const jobs = [...visibleCrafts].sort((a, b) => {
    const aMetrics = productionMetrics(a, itemLookup);
    const bMetrics = productionMetrics(b, itemLookup);
    const aValue = sortKey === "remainingEffort" ? aMetrics.remaining : aMetrics[sortKey];
    const bValue = sortKey === "remainingEffort" ? bMetrics.remaining : bMetrics[sortKey];
    const comparison = sortKey === "name"
      ? String(aValue).localeCompare(String(bValue))
      : toNumber(aValue) - toNumber(bValue);
    if (comparison !== 0) return sortDir === "asc" ? comparison : -comparison;
    const aActive = isCraftWorking(a, data.contributions[String(a.entityId)] ?? []) ? 1 : 0;
    const bActive = isCraftWorking(b, data.contributions[String(b.entityId)] ?? []) ? 1 : 0;
    return bActive - aActive || bMetrics.completion - aMetrics.completion;
  });
  const crafterCounts = visibilityFilteredCrafts.reduce<Record<string, number>>((acc, job) => {
    const name = String(job.ownerUsername ?? "Unknown");
    acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});
  const visibleCrafterCounts = visibleCrafts.reduce<Record<string, number>>((acc, job) => {
    const name = String(job.ownerUsername ?? "Unknown");
    acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});
  const activeJobs = jobs.filter((job) => {
    const total = toNumber(job.totalActionsRequired);
    return total > toNumber(job.progress) && isCraftWorking(job, data.contributions[String(job.entityId)] ?? []);
  }).length;
  const totalProductionXp = jobs.reduce((sum, job) => sum + productionMetrics(job, itemLookup).totalXp, 0);
  const remainingProductionXp = jobs.reduce((sum, job) => sum + productionMetrics(job, itemLookup).remainingXp, 0);
  const highestTier = Math.max(...jobs.map((job) => productionMetrics(job, itemLookup).tier), 0);

  return (
    <div className="panel production-page">
      <PageHeader
        title="Craft Monitor"
        description={visibleCrafts.length === 0 ? "No active crafting jobs" : `${activeJobs} active now - ${visibleCrafts.length} jobs across ${Object.keys(visibleCrafterCounts).length} crafters`}
        meta={<div className="dashboard-top-meta">
          <div className="dashboard-meta-cluster">
            <span><Factory size={14} /> {formatNumber(visibleCrafts.length)} shown</span>
            {privateCrafts.length ? <span><Lock size={14} /> {formatNumber(privateCrafts.length)} private</span> : null}
            <span>{formatNumber(Object.keys(visibleCrafterCounts).length)} crafters</span>
          </div>
          <div className="dashboard-settlement-pill">
            {highestTier ? <TierBadge tier={highestTier} /> : <span className="status-pill">No tier</span>}
            <span>Highest craft tier</span>
          </div>
        </div>}
      />
      <div className="summary-grid production-summary">
        <MiniStat icon={<Factory />} label="Total Jobs" value={formatNumber(visibleCrafts.length)} />
        <MiniStat icon={<Activity />} label="Active Now" value={formatNumber(activeJobs)} />
        <MiniStat icon={<TrendingUp />} label="Total XP" value={formatNumber(totalProductionXp)} />
        <MiniStat icon={<Star />} label="XP Remaining" value={formatNumber(remainingProductionXp)} />
      </div>
      <div className="command-filter-panel" data-tour="production-controls">
        <div className="command-filter-main">
          <span className="command-filter-title"><Wrench size={15} /> Production controls</span>
          <label className="inline-field"><span>Member</span>
            <select className="select-control" value={selectedMemberId} onChange={(event) => { onSelectMember(event.target.value); trackAnalyticsEvent("production_eligibility_filter_used", { scope: event.target.value === "All" ? "all_members" : "member" }); }}>
              <option value="All">All members</option>
              {data.members.map((member: AnyRecord) => <option key={member.playerEntityId} value={String(member.playerEntityId)}>{member.userName ?? member.username}</option>)}
            </select>
          </label>
          <label className="inline-field"><span>Sort by</span>
            <select className="select-control" value={sortKey} onChange={(event) => setSortKey(event.target.value as ProductionSortKey)}>
              <option value="tier">Tier</option>
              <option value="totalXp">Total XP</option>
              <option value="remainingXp">XP Remaining</option>
              <option value="remainingEffort">Effort Remaining</option>
              <option value="completion">Completion</option>
              <option value="name">Item Name</option>
            </select>
          </label>
          <Segmented options={[{ id: "Descending", label: "Descending" }, { id: "Ascending", label: "Ascending" }]} value={sortDir === "desc" ? "Descending" : "Ascending"} onChange={(direction) => setSortDir(direction === "Descending" ? "desc" : "asc")} label="Direction" />
          <label className="production-private-toggle"><span><Lock size={13} /> {showPrivateCrafts ? "Hide private crafts" : "Show private crafts"} ({privateCrafts.length})</span><input type="checkbox" checked={showPrivateCrafts} onChange={(event) => setShowPrivateCrafts(event.target.checked)} /></label>
        </div>
        {Object.keys(crafterCounts).length ? (
          <div className="production-crafter-line">
            <span>Current crafters</span>
            <div className="crafter-pills">
              {Object.entries(crafterCounts).map(([name, count]) => (
                <button
                  type="button"
                  key={name}
                  className={`crafter-pill ${selectedMemberName === name ? "active" : ""}`}
                  aria-pressed={selectedMemberName === name}
                  onClick={() => selectCrafterPill(name)}
                  title={selectedMemberName === name ? "Show all crafters" : `Show only ${name}`}
                  disabled={!crafterMemberIdByName[name]}
                >
                  <User size={12} />
                  <strong><TrackedOwnerName name={name} claim={data.claim} members={data.members} /></strong>
                  <small>{count}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {selectedMember ? <div className="production-member-banner"><User size={15} /><span>Checking jobs for</span><strong><TrackedOwnerName name={selectedMember.userName ?? selectedMember.username} claim={data.claim} members={data.members} /></strong><small>Requires skill level and a suitable Toolbelt tool. A tool can craft one tier above its own tier; power controls effort per action.</small></div> : null}
      {data.crafts.length === 0 ? <div className="empty-state"><Factory />No crafting jobs are currently active.</div> : null}
      {unknownVisibilityCrafts > 0 ? <div className="empty-state"><AlertTriangle />Craft visibility is unavailable for {unknownVisibilityCrafts} job{unknownVisibilityCrafts === 1 ? "" : "s"}; unknown jobs stay hidden until the public-crafts marker is ready.</div> : null}
      {data.crafts.length > 0 && visibleCrafts.length === 0 && unknownVisibilityCrafts === 0 ? <div className="empty-state"><Lock />Private crafts are hidden by your Production controls.</div> : null}
      <div className="production-grid">
        {jobs.map((job, index) => {
          const first = job.craftedItem?.[0] ?? {};
          const { item, skillId, experiencePerEffort, total, progress, remaining, totalXp, remainingXp, tier } = productionMetrics(job, itemLookup);
          const skillName = SKILL_NAMES[skillId] ?? job.levelRequirements?.[0]?.skillName ?? (skillId ? `Skill ${skillId}` : null);
          const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;
          const contributors: AnyRecord[] = data.contributions[String(job.entityId)] ?? [];
          const isWorking = total > progress && isCraftWorking(job, contributors);
          const isDone = total > 0 && progress >= total;
          const status = isWorking ? "Active now" : isDone ? "Ready" : progress > 0 ? "Paused" : "Queued";
          const eligibilityStatus = eligibility(job);
          return (
            <article className={`production-card ${isWorking ? "active-work" : ""} ${eligibilityStatus?.ok ? "can-craft" : ""}`} key={job.entityId ?? index}>
              <header>
                <div><Factory size={15} /><strong>{job.buildingName ?? "Unknown Structure"}{job.isPublic === false ? <span className="private-craft-pill" title="Private craft returned by the provider's member-scoped craft data."><Lock size={11} /> Private</span> : null}</strong><span><TrackedOwnerName name={job.ownerUsername ?? "Unknown"} claim={data.claim} members={data.members} /></span></div>
                <p><span className={`status-pill ${isWorking ? "working" : ""}`}>{status}</span>{skillName ? <small>{skillName} Lv {job.levelRequirements?.[0]?.level ?? 1}+</small> : null}</p>
              </header>
              <section>
                <div className={`craft-title ${item?.iconAssetName ? "has-icon" : ""}`}>{item?.iconAssetName ? <ItemIcon item={item} /> : null}<h3>{item?.name ?? job.recipeName ?? (skillName ? `${skillName} craft` : `${String(first.itemType ?? first.item_type).toLowerCase() === "cargo" ? "Cargo" : "Item"} #${first.itemId ?? first.item_id ?? "?"}`)}</h3>{tier ? <TierBadge tier={tier} /> : null}</div>
                {!item.name && job.recipeId ? <small>recipe #{job.recipeId}</small> : null}
                <div className="work-chips">
                  <span>{formatDecimalQuantity(job.craftCount)} craft{String(job.craftCount) === "1" ? "" : "s"}</span>
                  <span>{formatNumber(remaining)} effort to craft</span>
                  {experiencePerEffort ? <span>{formatNumber(totalXp)} total XP</span> : null}
                </div>
                <div className="progress-meta"><span>Effort applied</span><span>{formatNumber(progress)} / {formatNumber(total)}</span></div>
                <div className={`progress ${isWorking ? "is-moving" : ""}`}><div style={{ width: `${pct}%` }} /></div>
                <div className="progress-meta"><strong>{pct}%</strong><span>{experiencePerEffort ? `${formatNumber(remainingXp)} XP remaining` : "XP not provided"}</span></div>
                {eligibilityStatus ? <div className={`eligibility-pill ${eligibilityStatus.ok ? "eligible" : eligibilityStatus.pending ? "pending" : "blocked"}`}>{eligibilityStatus.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{eligibilityStatus.text}</div> : null}
                {contributors.length ? (
                  <div className="contributors">
                    <small>Contributors</small>
                    {contributors.map((person) => (
                      <span key={person.contributorEntityId}><strong><TrackedOwnerName name={person.contributorUsername ?? "Unknown contributor"} claim={data.claim} members={data.members} /></strong> {formatNumber(person.totalProgressContributed)} progress - Observed since {timeAgo(person.lastContributedAt)}</span>
                    ))}
                  </div>
                ) : <small>No contributor activity has been observed for this craft.</small>}
              </section>
            </article>
          );
        })}
      </div>
      <MemberPassiveCrafts rows={passiveCrafts} />
    </div>
  );
}
