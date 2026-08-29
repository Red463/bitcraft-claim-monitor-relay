import React from "react";
import "../styles/craft-planning.css";
import { AlertTriangle, ChevronDown, ClipboardList, Download, EqualApproximately, Factory, LoaderCircle, Package, Route, Search, Target, X } from "lucide-react";

import { TierBadge } from "../components/main/Badges";
import { Dialog } from "../components/main/Dialog";
import { ItemIcon } from "../components/main/ItemDisplay";
import { usePersistedState } from "../hooks/usePersistedState";
import type { AnyRecord } from "../main-app-data";
import { useManualRefresh } from "../refresh/ManualRefreshContext";
import { manualRefreshHeaders } from "../refresh/manualRefresh.mjs";
import { formatNumber, timeAgo } from "../utils/format";
import { CraftPlanManagerDialog } from "./CraftPlanManagerDialog";
import { CraftPlansDialog } from "./CraftPlansDialog";
import { resolveCraftPlanSelection } from "./craftPlanSelection.mjs";
import type { UserAuthState } from "../types/settings";
import { canEditCraftPlan, craftPlanRecipeReviewHref, craftPlanMaterialPresentation } from "./craftPlanManagerModel";
import { applyPersonalFishingView, normalizeFishingRoutePreference, type FishingRoutePreference } from "./craftPlanningFishingView";
import { selectCraftPlanningEffortView } from "./craftPlanningEffortView";
import { buildNeedsBoard, filterNeedsBoard, itemKey, itemName, NEED_COLUMNS, NEED_SECTIONS, type NeedCell, type NeedRow } from "./craftPlanningNeedsBoard";
import { groupNeedCellActiveCrafts, groupNeedCellRecipeUsages, groupNeedCellSources, groupNeedCellSourceRoutes } from "./craftPlanningNeedDetails";
import { acquisitionRouteLabel, acquisitionRouteMetrics, formatProbabilityRate } from "./craftPlanningRoutePresentation.mjs";

const LOCAL_API = "/api/local";

function itemNode(item: AnyRecord) {
  return (
    <span className="craft-plan-item-label">
      <ItemIcon item={item} />
      <span><strong>{itemName(item)}</strong>{item.tier ? <TierBadge tier={item.tier} /> : null}</span>
    </span>
  );
}

function quantity(value: unknown) {
  return formatNumber(Number(value) || 0, 0);
}

function passiveCraftStatusSummary(craft: AnyRecord) {
  const craftCount = Math.max(1, Number(craft.craftCount) || 1);
  const readyCount = Math.max(0, Number(craft.readyCount) || 0);
  const processingCount = Math.max(0, Number(craft.processingCount) || 0);
  return [
    `${quantity(craftCount)} passive craft${craftCount === 1 ? "" : "s"}`,
    readyCount > 0 ? `${quantity(readyCount)} ready` : "",
    processingCount > 0 ? `${quantity(processingCount)} processing` : "",
  ].filter(Boolean).join(" · ");
}

function passiveCraftStructureSummary(craft: AnyRecord) {
  const structures = Array.isArray(craft.structures) ? craft.structures : [];
  if (!structures.length) return String(craft.buildingName ?? "Unknown structure");
  return structures.map((structure: AnyRecord) => {
    const count = Math.max(1, Number(structure.count) || 1);
    return `${String(structure.name ?? "Unknown structure")}${count > 1 ? ` ×${quantity(count)}` : ""}`;
  }).join(" · ");
}

function completionTone(value: number) {
  if (value >= 100) return "is-complete";
  if (value >= 75) return "is-high";
  if (value >= 50) return "is-mid";
  if (value >= 25) return "is-low";
  return "is-critical";
}

function needCellNode(cell: NeedCell | undefined, onSelect: (cell: NeedCell) => void) {
  if (!cell) return <span className="craft-plan-need-empty">-</span>;
  const satisfied = cell.missing <= 0;
  const hasGuaranteedActive = cell.guaranteedInProgress > 0;
  const hasEstimatedActive = cell.estimatedInProgress > 0;
  const hasApproximateRequirement = cell.items.some((item) => item.estimatedRequirement === true);
  const hasIndicators = hasGuaranteedActive || hasEstimatedActive || hasApproximateRequirement;
  const planningSupplied = cell.available + cell.guaranteedInProgress + cell.estimatedInProgress;
  const blocked = !satisfied && cell.items.some((item) => item.hasSourceRoutes || (Array.isArray(item.sourceRoutes) && item.sourceRoutes.length > 0)) && planningSupplied <= 0;
  return (
    <button className={`craft-plan-need-cell${satisfied ? " is-satisfied" : " is-shortage"}${hasGuaranteedActive ? " has-active" : ""}${hasIndicators ? " has-indicators" : ""}${blocked ? " is-blocked" : ""}`} type="button" aria-label={`${cell.name}: Needed now ${quantity(cell.missing)}; Plan total ${quantity(cell.required)}; Stock ${quantity(cell.available)}; Guaranteed craft output ${quantity(cell.guaranteedInProgress)}; Estimated craft output ${quantity(cell.estimatedInProgress)}`} title={`${cell.name}: Needed now ${quantity(cell.missing)}, Plan total ${quantity(cell.required)}, Stock ${quantity(cell.available)}, Guaranteed craft output ${quantity(cell.guaranteedInProgress)}, Estimated craft output ${quantity(cell.estimatedInProgress)}${hasApproximateRequirement ? "; requirement estimated from expected processing yield" : ""}`} onClick={() => onSelect(cell)}>
      <strong>{quantity(cell.missing)}<span className="dialog-sr-only"> Needed now</span></strong>
      <small>Plan total {quantity(cell.required)}</small>
      <span className="craft-plan-cell-coverage" aria-hidden="true">Stock {quantity(cell.available)} · Guaranteed {quantity(cell.guaranteedInProgress)} · Estimated {quantity(cell.estimatedInProgress)}</span>
      {hasIndicators ? <span className="craft-plan-cell-indicators">
        {hasGuaranteedActive ? <Factory className="is-guaranteed" size={11} role="img" aria-label="Actively being crafted" /> : null}
        {hasEstimatedActive ? <Factory className="is-estimated" size={11} role="img" aria-label="Estimated craft output; counted for material planning" /> : null}
        {hasApproximateRequirement ? <EqualApproximately className="is-approximate" size={12} role="img" aria-label="Approximate requirement" /> : null}
      </span> : null}
    </button>
  );
}


function summaryStat(icon: React.ReactNode, label: string, value: unknown, detail: string, tone?: string) {
  return (
    <article className={`craft-plan-summary-stat${tone ? ` ${tone}` : ""}`}>
      <span className="metric-icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{quantity(value)}</strong>
        <em>{detail}</em>
      </span>
    </article>
  );
}

export function CraftPlanningPage({ claimId, refreshToken, auth, locationSearch, onQueryStateChange }: { claimId: string; refreshToken: number; auth: UserAuthState; locationSearch: string; onQueryStateChange: () => void }) {
  const { request, trackPromise } = useManualRefresh();
  const [plan, setPlan] = React.useState<AnyRecord | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [adminAuth, setAdminAuth] = React.useState<AnyRecord | null>(null);
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [managerOutputKey, setManagerOutputKey] = React.useState("");
  const [plansOpen, setPlansOpen] = React.useState(false);
  const [plans, setPlans] = React.useState<AnyRecord[]>([]);
  const [selectedPlanId, setSelectedPlanId] = React.useState("");
  const [selectionNotice, setSelectionNotice] = React.useState("");
  const [managerRefreshToken, setManagerRefreshToken] = React.useState(0);
  const [selectedSections, setSelectedSections] = React.useState<string[]>([]);
  const [shortagesOnly, setShortagesOnly] = React.useState(false);
  const [needsSearch, setNeedsSearch] = React.useState("");
  const [fishingRoute, setFishingRoute] = usePersistedState<FishingRoutePreference>("planning.fishingRoute", "ocean");
  const [targetsCollapsed, setTargetsCollapsed] = usePersistedState<boolean>("planning.targetsCollapsed", true);
  const targetsAreCollapsed = targetsCollapsed !== false;
  const [selectedNeed, setSelectedNeed] = React.useState<NeedCell | null>(null);
  const selectedNeedRef = React.useRef<NeedCell | null>(null);
  const [detailSteps, setDetailSteps] = React.useState<AnyRecord[]>([]);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const detailRequestRef = React.useRef(0);
  const detailAbortControllerRef = React.useRef<AbortController | null>(null);
  const [rowOverrideError, setRowOverrideError] = React.useState<string | null>(null);
  const [selectedSectionOverride, setSelectedSectionOverride] = React.useState<{ row: NeedRow; section: string; name: string } | null>(null);

  React.useEffect(() => {
    selectedNeedRef.current = selectedNeed;
  }, [selectedNeed]);

  React.useEffect(() => {
    detailAbortControllerRef.current?.abort();
    detailAbortControllerRef.current = null;
    detailRequestRef.current += 1;
    return () => {
      detailAbortControllerRef.current?.abort();
      detailAbortControllerRef.current = null;
      detailRequestRef.current += 1;
    };
  }, [claimId, request?.sequence]);

  React.useEffect(() => {
    fetch(`${LOCAL_API}/admin/me`)
      .then((response) => response.ok ? response.json() : { authenticated: false })
      .then(setAdminAuth)
      .catch(() => setAdminAuth({ authenticated: false }));
  }, []);

  const refreshPlans = React.useCallback(async (preferredPlanId?: string) => {
    const response = await fetch(`${LOCAL_API}/craft-plans`, { credentials: "same-origin" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    const visiblePlans = Array.isArray(body.plans) ? body.plans : [];
    const requested = preferredPlanId ?? new URLSearchParams(locationSearch).get("plan") ?? "";
    const rememberKey = `planning.selectedPlan.${auth.user?.id ?? "guest"}`;
    const resolved = resolveCraftPlanSelection(visiblePlans, requested, localStorage.getItem(rememberKey) ?? "");
    setPlans(visiblePlans);
    setSelectedPlanId(resolved.planId);
    setSelectionNotice(resolved.fellBack ? "That plan is unavailable. The primary shared plan is shown instead." : "");
    if (resolved.planId) localStorage.setItem(rememberKey, resolved.planId);
    if (resolved.fellBack && requested && resolved.planId) {
      const params = new URLSearchParams(window.location.search);
      params.set("page", "planning");
      params.set("plan", resolved.planId);
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
      onQueryStateChange();
    }
    return resolved.planId;
  }, [auth.user?.id, locationSearch, onQueryStateChange]);

  React.useEffect(() => { void refreshPlans().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, [refreshPlans, refreshToken]);

  function selectPlan(planId: string) {
    const params = new URLSearchParams(window.location.search);
    params.set("page", "planning");
    params.set("plan", planId);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    localStorage.setItem(`planning.selectedPlan.${auth.user?.id ?? "guest"}`, planId);
    setSelectedPlanId(planId);
    setSelectionNotice("");
    setPlansOpen(false);
    onQueryStateChange();
  }

  React.useEffect(() => {
    closeNeedDetail();
    setManagerOpen(false);
    setSelectedSectionOverride(null);
    setRowOverrideError(null);
    setManagerOutputKey("");
    setSelectedSections([]);
    setShortagesOnly(false);
    setNeedsSearch("");
  }, [selectedPlanId]);

  React.useEffect(() => {
    let stale = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    if (!selectedPlanId) { setLoading(false); return () => controller.abort(); }
    const refresh = fetch(`${LOCAL_API}/craft-plans/${encodeURIComponent(selectedPlanId)}?claimId=${encodeURIComponent(claimId)}`, { headers: manualRefreshHeaders(request, "planning"), signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
        if (stale) return;
        setPlan(body);
        if (request && selectedNeedRef.current) await openNeedDetail(selectedNeedRef.current, true);
      });
    void trackPromise("craft-plan", refresh)
      .catch((err) => {
        if (!stale && err.name !== "AbortError") setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
      controller.abort();
    };
  }, [claimId, managerRefreshToken, refreshToken, request?.sequence, selectedPlanId, trackPromise]);

  async function openNeedDetail(cell: NeedCell, propagateError = false) {
    detailAbortControllerRef.current?.abort();
    const controller = new AbortController();
    detailAbortControllerRef.current = controller;
    const requestId = ++detailRequestRef.current;
    const nextItemKey = cell.items?.[0]?.key ?? itemKey(cell.item);
    setSelectedNeed(cell);
    setDetailSteps([]);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const keys = [...new Set(cell.items.map(itemKey).filter(Boolean))];
      const detail = fetch(`${LOCAL_API}/craft-plans/${encodeURIComponent(selectedPlanId)}/detail?claimId=${encodeURIComponent(claimId)}&keys=${encodeURIComponent(keys.join(","))}`, { headers: manualRefreshHeaders(request, "planning"), signal: controller.signal })
        .then(async (response) => {
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
          return body;
        });
      const body = await trackPromise("craft-plan-detail", detail);
      if (requestId !== detailRequestRef.current) return;
      const detailedItems = new Map((Array.isArray(body.materials) ? body.materials : []).map((item: AnyRecord) => [itemKey(item), item]));
      const items = cell.items.map((item) => detailedItems.get(itemKey(item)) ?? item);
      setSelectedNeed({ ...cell, item: items[0] ?? cell.item, items });
      setDetailSteps(Array.isArray(body.steps) ? body.steps : []);
    } catch (detailFetchError) {
      const wasAborted = detailFetchError instanceof Error && detailFetchError.name === "AbortError";
      if (!wasAborted && requestId === detailRequestRef.current) setDetailError(detailFetchError instanceof Error ? detailFetchError.message : String(detailFetchError));
      if (propagateError) throw detailFetchError;
    } finally {
      if (detailAbortControllerRef.current === controller) detailAbortControllerRef.current = null;
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }

  function closeNeedDetail() {
    detailAbortControllerRef.current?.abort();
    detailAbortControllerRef.current = null;
    detailRequestRef.current += 1;
    setSelectedNeed(null);
    setDetailSteps([]);
    setDetailError(null);
    setDetailLoading(false);
  }

  const config = plan?.config ?? {};
  const totals = plan?.totals ?? {};
  const targets = Array.isArray(plan?.targets) ? plan.targets : [];
  const materials = Array.isArray(plan?.materials) ? plan.materials : [];
  const warnings = Array.isArray(plan?.warnings) ? plan.warnings : [];
  const unavailableSources = Array.isArray(plan?.unavailableSources) ? plan.unavailableSources : [];
  const needsBoard = React.useMemo(() => buildNeedsBoard(materials, targets), [materials, targets]);
  const normalizedFishingRoute = normalizeFishingRoutePreference(fishingRoute);
  const personalBoard = React.useMemo(
    () => applyPersonalFishingView(needsBoard, plan?.personalViews?.fishing, normalizedFishingRoute),
    [needsBoard, plan?.personalViews?.fishing, normalizedFishingRoute],
  );
  const needsBoardRowCount = React.useMemo(() => personalBoard.board.reduce((total, group) => total + group.rows.length, 0), [personalBoard.board]);
  const needsBoardSections = React.useMemo(() => personalBoard.board.map((group) => group.section), [personalBoard.board]);
  const effortView = React.useMemo(
    () => selectCraftPlanningEffortView(plan?.effortProgress, normalizedFishingRoute),
    [plan?.effortProgress, normalizedFishingRoute],
  );
  const confirmedCompletion = effortView.confirmed.overall.completion;
  const projectedCompletion = effortView.projected.overall.completion;
  const showProjectedCompletion = confirmedCompletion != null
    && projectedCompletion != null
    && projectedCompletion > confirmedCompletion;
  const filteredNeedsBoard = React.useMemo(
    () => filterNeedsBoard(personalBoard.board, selectedSections, shortagesOnly, needsSearch),
    [personalBoard.board, selectedSections, shortagesOnly, needsSearch],
  );
  const computedPlanRecord = plan?.plan;
  const selectedPlan = String(computedPlanRecord?.id ?? "") === selectedPlanId
    ? computedPlanRecord
    : plans.find((entry) => String(entry.id) === selectedPlanId) ?? null;
  const ownsSelectedPlan = Boolean(auth.user && selectedPlan?.scope === "personal" && Number(selectedPlan?.ownerUserId) === Number(auth.user.id));
  const canEditSelectedPlan = canEditCraftPlan(adminAuth, ownsSelectedPlan);
  const currentSectionOverrides = config.sectionOverrides ?? {};
  const currentRowNameOverrides = config.rowNameOverrides ?? {};
  const selectedNeedSources = selectedNeed ? groupNeedCellSources(selectedNeed) : [];
  const selectedNeedCrafts = selectedNeed ? groupNeedCellActiveCrafts(selectedNeed) : [];
  const selectedNeedSourceRoutes = selectedNeed ? groupNeedCellSourceRoutes(selectedNeed, detailSteps) : [];
  const selectedNeedUsages = selectedNeed ? groupNeedCellRecipeUsages(selectedNeed) : [];
  const selectedNeedKey = selectedNeed?.items?.[0]?.key ?? (selectedNeed ? itemKey(selectedNeed.item) : "");
  const selectedMultiplier = Number(config.multipliers?.[selectedNeedKey]?.multiplier) || 1;
  const selectedMaterialPresentation = selectedNeed ? craftPlanMaterialPresentation(selectedNeed.item ?? selectedNeed) : null;
  React.useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    const outputKey = params.get("output") ?? "";
    if (!canEditSelectedPlan || params.get("manager") !== "recipe-review" || !outputKey) return;
    setManagerOutputKey(outputKey);
    setManagerOpen(true);
  }, [canEditSelectedPlan, locationSearch]);

  function openRecipeReview(outputKey: string) {
    const href = craftPlanRecipeReviewHref({ planId: selectedPlanId, outputKey });
    window.history.replaceState({}, "", href);
    setManagerOutputKey(outputKey);
    setManagerOpen(true);
    closeNeedDetail();
    onQueryStateChange();
  }

  function closeManager() {
    const params = new URLSearchParams(window.location.search);
    params.delete("manager");
    params.delete("output");
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    setManagerOpen(false);
    setManagerOutputKey("");
    onQueryStateChange();
  }
  const sectionOverrideDialog = selectedSectionOverride ? (
    <Dialog open title="Override needs board row" closeOnBackdrop={false} onClose={() => { setSelectedSectionOverride(null); setRowOverrideError(null); }} className="modal craft-plan-section-override" backdropClassName="modal-backdrop craft-plan-section-override-backdrop">
        <header className="modal-header">
          <div>
            <h2>Edit {selectedSectionOverride.row.name}</h2>
            <p>Planner default: {selectedSectionOverride.row.apiName} in {selectedSectionOverride.row.plannerSection}. Overrides apply to the same row across craft goals.</p>
          </div>
          <button className="icon-button" type="button" onClick={() => { setSelectedSectionOverride(null); setRowOverrideError(null); }} aria-label="Close row override"><X size={18} /></button>
        </header>
        <div className="craft-plan-section-override-body">
          <label className="field">
            <span>Row display name</span>
            <input value={selectedSectionOverride.name} placeholder={selectedSectionOverride.row.apiName} onChange={(event) => setSelectedSectionOverride((current) => current ? { ...current, name: event.target.value } : current)} />
          </label>
          <label className="field">
            <span>Needs board section</span>
            <select value={selectedSectionOverride.section} onChange={(event) => setSelectedSectionOverride((current) => current ? { ...current, section: event.target.value } : current)}>
              {NEED_SECTIONS.map((section) => <option value={section} key={section}>{section}</option>)}
            </select>
          </label>
          <div className="modal-actions">
            <button className="toolbar-button" type="button" onClick={() => void saveRowOverride(selectedSectionOverride.row, null, null)}>Use planner defaults</button>
            <button className="toolbar-button primary" type="button" onClick={() => void saveRowOverride(selectedSectionOverride.row, selectedSectionOverride.section, selectedSectionOverride.name)}>Save row</button>
          </div>
          {rowOverrideError ? <p className="alert error" role="alert">{rowOverrideError}</p> : null}
        </div>
    </Dialog>
  ) : null;

  const needDetailDialog = selectedNeed ? (
    <Dialog open title="Craft plan item details" onClose={closeNeedDetail} className="modal craft-plan-need-detail" backdropClassName="modal-backdrop craft-plan-need-detail-backdrop">
        <header className="modal-header">
          <div>
            <h2>{itemNode(selectedNeed.item)}</h2>
            <p>Needed now {quantity(selectedMaterialPresentation?.neededNow)} · Plan total {quantity(selectedMaterialPresentation?.planTotal)} · Stock {quantity(selectedMaterialPresentation?.stock)} · Guaranteed craft output {quantity(selectedMaterialPresentation?.guaranteedCraftOutput)} · Estimated craft output {quantity(selectedMaterialPresentation?.estimatedCraftOutput)}{Number(selectedMaterialPresentation?.buildingCompletion) > 0 ? ` · Building completion ${quantity(selectedMaterialPresentation?.buildingCompletion)}%` : ""}.</p>
          </div>
          <button className="icon-button" type="button" onClick={closeNeedDetail} aria-label="Close item details"><X size={18} /></button>
        </header>
        {detailLoading ? (
          <div className="craft-plan-detail-loading" role="status">
            <span className="craft-plan-detail-loading-icon" aria-hidden="true">
              <LoaderCircle size={17} className="is-spinning" />
            </span>
            <span>
              <strong>Updating item details</strong>
              <small>Showing saved planner data while current routes load.</small>
            </span>
          </div>
        ) : null}
        {detailError ? <p className="alert error" role="alert">Item details could not be loaded: {detailError}</p> : null}
        <div className="craft-plan-need-detail-grid">
          <section className="form-card nested-card craft-plan-stock-card">
            <h3><Package size={16} /> Stock locations</h3>
            {selectedNeedSources.length ? selectedNeedSources.map((source) => (
              <details className="craft-plan-detail-group" key={source.key} open={source.entries.length === 1 ? undefined : false}>
                <summary className="craft-plan-detail-row">
                  <span>{source.label}</span>
                  <strong>{quantity(source.quantity)}</strong>
                </summary>
                {source.entries.length > 1 ? (
                  <div className="craft-plan-detail-breakdown">
                    {source.entries.map((entry: AnyRecord, index: number) => (
                      <div className="craft-plan-detail-row subtle" key={String(entry.sourceId ?? entry.label ?? index) + "-" + index}>
                        <span>{[entry.playerName, entry.type ?? "Source stack"].filter(Boolean).join(" — ")}</span>
                        <strong>{quantity(entry.quantity)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
            )) : <p className="legend">{Number(selectedNeed.available) > 0 ? "Counted stock exists, but source details are unavailable." : "No counted stock found for this item."}</p>}
            {selectedNeedCrafts.length ? <div className="craft-plan-tracked-crafts">
              <h3><Factory size={16} /> Tracked crafts</h3>
              {selectedNeedCrafts.map((craft, index) => <div className="craft-plan-detail-row craft-plan-tracked-craft-row" key={String(craft.craftId ?? index)}>
                <span className="craft-plan-tracked-craft-copy">
                  {craft.passiveGroup ? <>
                    <strong>{craft.playerName ?? "Unknown player"}</strong>
                    <small>{passiveCraftStatusSummary(craft)}</small>
                    <small>{passiveCraftStructureSummary(craft)}</small>
                  </> : <>
                    <strong>{craft.passive ? `Passive craft · ${craft.buildingName ?? "Unknown structure"}` : craft.buildingName ?? "Crafting station"}</strong>
                    <small>{craft.playerName ?? "Unknown player"} - {craft.status ?? (craft.completed ? "Ready to collect" : "In progress")}</small>
                  </>}
                  {craft.locationUnknown ? <small>Location not reported by Relay</small> : null}
                </span>
                <span className="craft-plan-tracked-craft-totals"><strong>{quantity(craft.expectedQuantity ?? craft.quantity)} expected</strong><small>{quantity(craft.guaranteedQuantity)} guaranteed</small></span>
              </div>)}
            </div> : null}
          </section>
          <div className="craft-plan-need-detail-side">
            <section className="form-card nested-card">
              <div className="split-header"><h3><Factory size={16} /> How to get this</h3>{canEditSelectedPlan ? <a className="toolbar-button" href={craftPlanRecipeReviewHref({ planId: selectedPlanId, outputKey: selectedNeedKey })} onClick={(event) => { event.preventDefault(); openRecipeReview(selectedNeedKey); }}>Open in Recipe Review</a> : null}</div>
              {selectedNeedSourceRoutes.length ? selectedNeedSourceRoutes.map((route, index) => {
                const alternatives = Array.isArray(route.alternatives) ? route.alternatives : [];
                const routeType = String(route.routeType ?? "craft");
                const gatheringRoute = routeType.startsWith("gathering");
                const byproductRoute = routeType.endsWith("-byproduct");
                const prospectingRoute = gatheringRoute && route.gatheringMode === "prospecting";
                const routeKindLabel = gatheringRoute
                  ? prospectingRoute ? byproductRoute ? "Prospecting byproduct" : "Prospecting output" : byproductRoute ? "Gathering byproduct" : "Gathering output"
                  : byproductRoute ? "Craft byproduct" : "Craft output";
                const yieldUnit = gatheringRoute ? prospectingRoute ? "per extraction progress" : "per node progress" : "per craft";
                const routeMultiplier = Number(route.multiplier) || selectedMultiplier;
                const routeMetrics = acquisitionRouteMetrics(route, {
                  missingQuantity: Number(selectedNeed.missing) || 0,
                  multiplier: routeMultiplier,
                });
                const probabilityUnavailable = route.probabilityStatus === "unavailable" || routeMetrics.status === "unavailable";
                const itemListRoute = route.expectedYield != null || routeMetrics.status === "available" || probabilityUnavailable;
                const expectedYield = Number(route.expectedYield) || 0;
                const guaranteedYield = Number(route.guaranteedYield) || 0;
                const guaranteedOutput = !byproductRoute && guaranteedYield > 0 && guaranteedYield + 1e-9 >= expectedYield;
                const producerInputs = Array.isArray(route.inputs) ? route.inputs.filter((input: AnyRecord) => Number(input.quantity) > 0) : [];
                const displayedRecipeName = acquisitionRouteLabel(route, route.output ?? selectedNeed.item);
                const outputLabel = itemName(route.output ?? selectedNeed.item);
                const expectedPerProgress = Number(route.expectedPerProgress ?? (gatheringRoute ? route.expectedYield : 0)) || 0;
                const expectedPerCraft = Number(route.expectedPerCraft ?? route.expectedYield ?? route.guaranteedYield) || 0;
                return (
                  <React.Fragment key={String(route.selectedRecipeId ?? route.id ?? route.key ?? index) + "-" + index}>
                    {alternatives.length > 1 ? <div className="craft-plan-route-readonly" aria-label={`${alternatives.length} available routes; selected route ${displayedRecipeName}`}><strong>{alternatives.length} routes available</strong><span>Route selection is read-only here. Authorized editors can compare and stage changes in Recipe Review.</span></div> : null}
                    <div className={`craft-plan-route-detail is-${gatheringRoute ? "gathering" : "craft"}`}>
                    <div className="craft-plan-route-heading">
                      <span className={`craft-plan-route-kind is-${gatheringRoute ? "gathering" : "craft"}`}>{routeKindLabel}</span>
                      <strong>{displayedRecipeName}</strong>
                      <p className="legend">{gatheringRoute
                        ? [route.gatheringSkill, byproductRoute && route.producer?.name ? `received with ${route.producer.name}` : null].filter(Boolean).join(" - ")
                        : route.buildingName ? "At " + route.buildingName : "Selected plan route"}</p>
                    </div>
                    {probabilityUnavailable ? (
                      <div className="craft-plan-chance-summary" role="status">
                        <p className="craft-plan-byproduct-note"><strong>Validated output rate unavailable.</strong></p>
                        <p className="legend">This production route is known, but required completions and inputs cannot be calculated until a validated probability snapshot is available.</p>
                        {producerInputs.length ? <div className="craft-plan-producer-requirements"><small>Producer recipe inputs</small>{producerInputs.map((input: AnyRecord, inputIndex: number) => <span key={itemKey(input) + "-producer-" + inputIndex}>{itemNode(input)}<strong>x{quantity(input.quantityPerCraft ?? input.quantity)}</strong></span>)}</div> : null}
                      </div>
                    ) : itemListRoute ? (
                      <>
                        {gatheringRoute && Array.isArray(route.gatheringSources) && route.gatheringSources.length > 1 ? <div className="craft-plan-gathering-sources">{route.gatheringSources.map((source: AnyRecord) => {
                          const sourceExpected = Number(source.expectedYield) || 0;
                          return <span key={String(source.tag ?? source.label)}><strong>{source.label}</strong><small>{sourceExpected > 0 ? `About 1 ${outputLabel} per ${formatNumber(1 / sourceExpected)} ${prospectingRoute ? "extraction progress" : "node progress"}` : "Validated yield unavailable"}</small></span>;
                        })}</div> : null}
                        <div className="craft-plan-chance-summary">
                          <div className="craft-plan-primary-work">
                            {routeMetrics.basis === "node" ? <>
                              <strong>{routeMetrics.plannedUnits === 0 ? "No additional nodes needed" : `Plan for ${quantity(routeMetrics.plannedUnits)} full nodes`}</strong>
                              <span>About {formatNumber(Number(routeMetrics.expectedPerUnit), Number(routeMetrics.expectedPerUnit) < 1 ? 3 : 1)} {outputLabel} per full node</span>
                              <small>{formatNumber(Number(routeMetrics.exactUnits), 2)} expected node equivalents{routeMultiplier > 1 ? `, including ${formatNumber((routeMultiplier - 1) * 100, 1)}% safety buffer` : ""}</small>
                            </> : routeMetrics.basis === "progress" ? <>
                              <strong>{routeMetrics.plannedUnits === 0 ? "No additional progress needed" : `Plan for ${quantity(routeMetrics.plannedUnits)} ${prospectingRoute ? "extraction progress" : "node progress"}`}</strong>
                              <span>{Number(routeMetrics.progressPerExpectedItem) > 0 ? `About 1 ${outputLabel} per ${formatNumber(Number(routeMetrics.progressPerExpectedItem))} ${prospectingRoute ? "extraction progress" : "node progress"}` : "Expected output rate unavailable"}</span>
                              {prospectingRoute ? <small>Full-node estimates are unavailable for prospecting because node exhaustion is unknown.</small> : null}
                            </> : <>
                              <strong>{routeMetrics.plannedUnits === 0 ? "No additional crafts needed" : `Plan for ${quantity(routeMetrics.plannedUnits)} recipe completions`}</strong>
                              <span>{guaranteedOutput ? "Guaranteed" : "About"} {formatNumber(Number(routeMetrics.expectedPerUnit), Number(routeMetrics.expectedPerUnit) < 1 ? 3 : 1)} {outputLabel} per craft</span>
                              {Number(routeMetrics.totalActions) !== Number(routeMetrics.plannedUnits) ? <small>{quantity(routeMetrics.totalActions)} total station actions</small> : null}
                            </>}
                          </div>
                          {producerInputs.length ? <div className="craft-plan-producer-requirements"><small>{gatheringRoute ? "Gather/process" : "Craft inputs"}</small>{producerInputs.map((input: AnyRecord, inputIndex: number) => <span key={itemKey(input) + "-producer-" + inputIndex}>{itemNode(input)}<strong>{quantity(input.quantity)}</strong></span>)}</div> : null}
                          <details className="craft-plan-calculation">
                            <summary>Show calculation</summary>
                            <div className="craft-plan-calculation-body">
                              <span>Expected yield <strong>{formatProbabilityRate(gatheringRoute ? expectedPerProgress : expectedPerCraft)} {outputLabel} {yieldUnit}</strong></span>
                              {gatheringRoute && Number(route.expectedPerResource) > 0 ? <span>Expected per full node <strong>{formatProbabilityRate(route.expectedPerResource)} {outputLabel}</strong></span> : null}
                              {gatheringRoute && Number(route.resourceHealth) > 0 && !prospectingRoute ? <span>Node health <strong>{quantity(route.resourceHealth)} progress</strong></span> : null}
                              {routeMetrics.basis === "node" ? <><span>Exact node equivalents <strong>{formatNumber(Number(routeMetrics.exactUnits), 4)}</strong></span><span>Planned node progress <strong>{quantity(routeMetrics.totalProgress)}</strong></span></> : null}
                              {routeMetrics.basis === "progress" ? <span>Required progress <strong>{quantity(routeMetrics.totalProgress)}</strong></span> : null}
                              {routeMetrics.basis === "craft" ? <><span>Recipe completions <strong>{quantity(routeMetrics.plannedUnits)}</strong></span><span>Total station actions <strong>{quantity(routeMetrics.totalActions)}</strong></span></> : null}
                              {guaranteedYield > 0 ? <span>Guaranteed output <strong>{formatProbabilityRate(guaranteedYield)} {outputLabel} {yieldUnit}</strong></span> : null}
                              {route.dropChance != null ? <span>Drop chance <strong>{formatNumber(Number(route.dropChance) * 100, 3)}% for {formatNumber(Number(route.dropQuantity) || 0, 2)}</strong></span> : null}
                              {prospectingRoute ? <p>Full-node estimates are unavailable for prospecting because node exhaustion is unknown; displayed health is not treated as finite progress.</p> : null}
                              {route.isProbabilistic ? <div className="craft-plan-buffer-settings"><strong>Saved material buffer</strong><span>{formatNumber((selectedMultiplier - 1) * 100, 1)}% extra</span><small>Buffer changes are staged in Recipe Review and persist only through Save Plan.</small></div> : null}
                            </div>
                          </details>
                        </div>
                      </>
                    ) : Array.isArray(route.inputs) && route.inputs.length ? (
                      <div className="craft-plan-route-inputs">
                        {route.inputs.map((input: AnyRecord, inputIndex: number) => (
                          <span key={itemKey(input) + "-" + inputIndex}>{itemNode(input)} <strong>x{quantity(input.quantity)}</strong></span>
                        ))}
                      </div>
                    ) : null}
                    </div>
                  </React.Fragment>
                );
              }) : <p className="legend">The current plan does not need to craft this item. Stock locations show where it is counted from, or the item is treated as a raw gathered/vendor input.</p>}
            </section>
            <section className="form-card nested-card">
              <h3><Route size={16} /> Used for</h3>
              {selectedNeedUsages.length ? selectedNeedUsages.map((usage) => {
                const alternatives = Array.isArray(usage.alternatives) ? usage.alternatives : [];
                const selectedRecipe = alternatives.find((recipe: AnyRecord) => String(recipe.id) === String(usage.selectedRecipeId));
                return (
                  <div className="craft-plan-route-detail" key={usage.key}>
                    <div className="split-header">
                      <div>
                        <strong>Needed for {quantity(usage.output?.quantity)} {usage.output?.name ?? "planned output"}</strong>
                        <p className="legend">Uses {quantity(usage.requiredQuantity)} total from this cell</p>
                      </div>
                    </div>
                    {selectedRecipe && Array.isArray(selectedRecipe.inputs) && selectedRecipe.inputs.length ? (
                      <div className="craft-plan-route-inputs">
                        {selectedRecipe.inputs.map((input: AnyRecord, inputIndex: number) => (
                          <span key={itemKey(input) + "-" + inputIndex}>{itemNode(input)} <strong>x{quantity(input.quantityPerCraft ?? input.quantity)}</strong></span>
                        ))}
                      </div>
                    ) : null}
                    {usage.entries.length > 1 ? (
                      <details className="craft-plan-usage-breakdown">
                        <summary>Show {usage.entries.length} recipe demands</summary>
                        <div className="craft-plan-detail-breakdown">
                          {usage.entries.map((entry: AnyRecord, entryIndex: number) => (
                            <div className="craft-plan-detail-row subtle" key={String(entry.outputKey ?? entryIndex) + "-" + entryIndex}>
                              <span>{quantity(entry.output?.quantity)} via {entry.recipeName ?? "selected recipe"}{entry.buildingName ? " - " + entry.buildingName : ""}</span>
                              <strong>{quantity(entry.requiredQuantity)}</strong>
                            </div>
                          ))}
                        </div>
                      </details>
                    ) : null}
                    {alternatives.length > 1 ? <p className="legend">{alternatives.length} routes available. Selected: {selectedRecipe ? acquisitionRouteLabel(selectedRecipe, usage.output) : String(usage.selectedRecipeId ?? "saved route")}.</p> : null}
                  </div>
                );
              }) : <p className="legend">No downstream recipe context was found. This is likely a final target, base gathered item, or vendor material.</p>}
            </section>
          </div>
        </div>
    </Dialog>
  ) : null;

  React.useEffect(() => {
    setSelectedSections((current) => {
      const available = current.filter((section) => needsBoardSections.includes(section));
      return available.length === current.length ? current : available;
    });
  }, [needsBoardSections]);

  function toggleSection(section: string) {
    setSelectedSections((current) => current.includes(section)
      ? current.filter((selected) => selected !== section)
      : [...current, section]);
  }


  async function saveRowOverride(row: NeedRow, section: string | null, name: string | null) {
    if (!canEditSelectedPlan || !row.overrideKey) return;
    setRowOverrideError(null);
    try {
      const nextSectionOverrides = { ...currentSectionOverrides };
      if (!section || section === row.apiSection) delete nextSectionOverrides[row.overrideKey];
      else nextSectionOverrides[row.overrideKey] = section;
      const nextRowNameOverrides = { ...currentRowNameOverrides };
      const cleanName = String(name ?? "").trim();
      if (!cleanName || cleanName === row.apiName) delete nextRowNameOverrides[row.overrideKey];
      else nextRowNameOverrides[row.overrideKey] = cleanName;
      const nextConfig = {
        ...config,
        sectionOverrides: nextSectionOverrides,
        rowNameOverrides: nextRowNameOverrides,
      };
      await saveSelectedConfig(nextConfig);
      setSelectedSectionOverride(null);
      setManagerRefreshToken((value) => value + 1);
    } catch (err) {
      setRowOverrideError(err instanceof Error ? err.message : String(err));
    }
  }
  async function saveSelectedConfig(nextConfig: AnyRecord) {
    const csrfToken = ownsSelectedPlan ? auth.csrfToken : adminAuth?.csrfToken;
    if (!csrfToken || !selectedPlanId) throw new Error("You no longer have permission to edit this plan.");
    const endpoint = ownsSelectedPlan
      ? `${LOCAL_API}/user/craft-plans/${encodeURIComponent(selectedPlanId)}`
      : `${LOCAL_API}/admin/craft-plans/${encodeURIComponent(selectedPlanId)}`;
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": String(csrfToken) },
      body: JSON.stringify({ config: nextConfig, expectedRevision: Number(selectedPlan?.revision) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 409
      ? "This plan changed elsewhere. Reopen it to keep your draft and review the latest version."
      : body.error ?? "HTTP " + response.status);
    if (body.planRecord) setPlan((current) => current ? { ...current, plan: body.planRecord } : current);
  }

  if (loading && !plan) {
    return <div className="panel craft-planning-page" aria-busy="true"><section className="craft-plan-loading" role="status" aria-live="polite">
      <header><span className="craft-plan-loading-icon"><ClipboardList size={24} /><LoaderCircle className="is-spinning" size={15} /></span><span><strong>Loading craft plan</strong><small>Checking targets, stock sources, active crafts, and materials.</small></span></header>
      <div className="craft-plan-loading-skeleton" aria-hidden="true">
        <div className="craft-plan-loading-stats">{Array.from({ length: 4 }, (_, index) => <span key={index}><i /><b /><em /></span>)}</div>
        <div className="craft-plan-loading-strip"><i /><span /></div>
        <div className="craft-plan-loading-board"><i />{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>
      </div>
    </section></div>;
  }

  if (error) {
    return <div className="panel craft-planning-page"><div className="empty-state"><AlertTriangle size={36} /><strong>Craft plan unavailable</strong><span>{error}</span></div></div>;
  }

  const hasPlan = Boolean(plan?.enabled && targets.length);

  return (
    <div className="panel craft-planning-page">
      <header className="page-header split-header craft-plan-page-header">
        <div>
          <h2><ClipboardList size={24} /> Craft Planning</h2>
          <p>{selectedPlan?.name ?? (hasPlan ? String(config.name ?? "Settlement craft plan") : "Procurement board for settlement crafting goals.")}</p>
        </div>
        <div className="dashboard-top-meta">
          <label className="craft-plan-header-selector"><span className="dialog-sr-only">Current plan</span><select value={selectedPlanId} onChange={(event) => selectPlan(event.target.value)}>{plans.some((entry) => entry.scope === "shared") ? <optgroup label="Shared plans">{plans.filter((entry) => entry.scope === "shared").map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · Shared{entry.primary ? " · Primary" : ""}</option>)}</optgroup> : null}{plans.some((entry) => entry.scope === "personal") ? <optgroup label="My plans">{plans.filter((entry) => entry.scope === "personal").map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · Personal</option>)}</optgroup> : null}{selectedPlan && !plans.some((entry) => String(entry.id) === String(selectedPlan.id)) ? <optgroup label="Admin inspection"><option value={selectedPlan.id}>{selectedPlan.name} · Personal</option></optgroup> : null}</select></label>
          <button className="toolbar-button" type="button" onClick={() => setPlansOpen(true)}>Plans</button>
          <a className="toolbar-button" href={`${LOCAL_API}/catalog/probabilities.xlsx`}><Download size={15} aria-hidden="true" /> Download probabilities</a>
          {canEditSelectedPlan ? <button className="toolbar-button primary" type="button" onClick={() => { setManagerOutputKey(""); setManagerOpen(true); }}>Manage Plan</button> : null}
          <span>{quantity(totals.missingItems)} materials still short</span>
          <span>{quantity(totals.activeCraftQuantity)} in tracked crafts</span>
        </div>
      </header>
      {selectionNotice ? <div className="alert warning craft-plan-selection-notice" role="status">{selectionNotice}</div> : null}
      {selectedPlan ? <div className="craft-plan-active-strip" aria-label="Current craft plan"><strong>{selectedPlan.name}</strong><span>{selectedPlan.scope === "personal" ? "Personal" : "Shared"}{selectedPlan.primary ? " · Primary" : ""}</span></div> : null}

      {!hasPlan ? (
        <div className="empty-state">
          <Target size={36} />
          <strong>No craft plan configured</strong>
          <span>{canEditSelectedPlan ? "Use Manage Plan to add targets, inventory sources, route overrides, and uncertain-drop multipliers." : "An admin can add targets, inventory sources, route overrides, and uncertain-drop multipliers."}</span>
        </div>
      ) : (
        <>
          <section className="craft-plan-summary-band" aria-label="Craft plan summary">
            {summaryStat(<Target />, "Active targets", totals.targets, `${quantity(totals.missingQuantity)} total still needed`)}
            {summaryStat(<Package />, "Materials still short", totals.missingItems, "different materials after stock and tracked crafts", "gold")}
            {summaryStat(<Factory />, "Craft outputs counted", totals.activeCraftQuantity, "in progress or ready to collect", "green")}
            {summaryStat(<AlertTriangle />, "Unavailable sources", unavailableSources.length, "excluded from stock totals", unavailableSources.length ? "warn" : "green")}
          </section>

          <section className="form-card craft-plan-section craft-plan-targets-strip">
            <div className="split-header craft-plan-targets-header">
              <h3>
                <button
                  className="craft-plan-targets-toggle"
                  type="button"
                  aria-expanded={!targetsAreCollapsed}
                  aria-controls="craft-plan-target-list"
                  onClick={() => setTargetsCollapsed((current) => current === false)}
                >
                  <Target size={17} />
                  <span>Targets</span>
                  <ChevronDown className="craft-plan-targets-chevron" size={16} aria-hidden="true" />
                </button>
              </h3>
              <p className="legend">Configured goals and current progress against counted sources.</p>
            </div>
            <div id="craft-plan-target-list" className="craft-plan-target-list" hidden={targetsAreCollapsed}>
              {targets.map((target: AnyRecord) => {
                const buildingTarget = String(target.kind) === "building";
                const covered = Math.max(0, Number(target.quantity) - Number(target.missing));
                const estimatedActive = Math.max(0, Number(target.estimatedInProgress) || 0);
                return (
                <article className={`craft-plan-target${Number(target.missing) <= 0 ? " is-complete" : ""}`} key={target.key ?? `${target.kind}:${target.id}`}>
                  {itemNode(target)}
                  <div className="craft-plan-target-progress"><span><i style={{ width: `${Math.min(100, Math.max(0, (covered / Math.max(1, Number(target.quantity))) * 100))}%` }} /></span><small>{quantity(covered)} / {quantity(target.quantity)} {buildingTarget ? "newly built" : "covered"}</small><em>{buildingTarget ? target.progressInitialized ? `${quantity(target.available)} completed stations detected` : "Tracking pending until claim buildings are available" : `${quantity(target.available)} available${Number(target.inProgress) > 0 ? ` · ${quantity(target.inProgress)} active output${estimatedActive > 0 ? ` (${quantity(estimatedActive)} estimated)` : ""}` : ""}`}</em></div>
                  <div className="craft-plan-target-status"><strong>{quantity(target.missing)}</strong><span>{Number(target.missing) <= 0 ? "Complete" : "Still needed"}</span></div>
                </article>
              );
              })}
            </div>
          </section>

          <section className="form-card craft-plan-section craft-plan-needs-board" data-tour="craft-planning-gather-next">
            <div className="craft-plan-needs-header">
              <div className="craft-plan-needs-heading-content">
                <div>
                  <h3><Target size={17} /> Needs Board</h3>
                  <p className="legend">Missing items grouped by activity. Crafted intermediates stay under their profession; gathered inputs stay under their source activity.</p>
                </div>
                <div className={`craft-plan-overall-progress ${confirmedCompletion == null ? "is-unavailable" : completionTone(confirmedCompletion)}`}>
                  <span className="craft-plan-progress-confirmed" title="Confirmed progress uses tracked stock and guaranteed active or ready-to-collect output.">
                    <strong>{confirmedCompletion == null ? "—" : `${confirmedCompletion}%`}</strong>
                    <small>{confirmedCompletion == null ? "Effort progress unavailable" : "Confirmed progress"}</small>
                  </span>
                  {showProjectedCompletion ? (
                    <span className="craft-plan-progress-projected" title="Projected progress also includes probabilistic expected output from tracked active crafts.">
                      <strong>{projectedCompletion}%</strong>
                      <small>Projected after active crafts</small>
                    </span>
                  ) : null}
                  <div className="craft-plan-progress-track"><i style={{ width: `${confirmedCompletion ?? 0}%` }} /></div>
                  <em className="craft-plan-effort-note">Confirmed stock and guaranteed active crafts.</em>
                  {effortView.stale ? (
                    <div className="craft-plan-progress-stale" role="status">
                      <AlertTriangle size={14} />
                      <span>
                        <strong>{effortView.lastSuccessfulAt ? `Last confirmed ${timeAgo(effortView.lastSuccessfulAt)}` : "Confirmed progress temporarily unavailable"}</strong>
                        <small>{effortView.unavailableSources.length
                          ? `Waiting for ${effortView.unavailableSources.map((source) => source.label).join(", ")}`
                          : "Waiting for counted planner sources"}</small>
                      </span>
                    </div>
                  ) : null}
                  {effortView.baselineChange ? (
                    <div className="craft-plan-baseline-change" role="status">
                      <AlertTriangle size={14} />
                      <span><strong>Plan baseline changed</strong><small>{effortView.baselineChange.reasons.join("; ") || "Configured plan inputs changed."}</small></span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            {personalBoard.board.length ? <div className="craft-plan-section-filters" aria-label="Filter needs board by activity">
              <label className="craft-plan-needs-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search Needs Board items" value={needsSearch} onChange={(event) => setNeedsSearch(event.target.value)} placeholder="Search items" /></label>
              <label className="craft-plan-list-only"><input type="checkbox" checked={shortagesOnly} onChange={(event) => setShortagesOnly(event.target.checked)} /> Shortages only</label>
              <button className={selectedSections.length === 0 ? "active" : ""} type="button" aria-pressed={selectedSections.length === 0} onClick={() => setSelectedSections([])}>All <span>{needsBoardRowCount}</span></button>
              {personalBoard.board.map((group) => {
                const selected = selectedSections.includes(group.section);
                return <button className={selected ? "active" : ""} type="button" aria-pressed={selected} key={group.section} onClick={() => toggleSection(group.section)}>{group.section} <span>{group.rows.length}</span></button>;
              })}
            </div> : null}
            <div className="craft-plan-needs-legend" aria-label="Needs board legend"><span className="covered">Covered for material planning</span><span className="short">More needed</span><span className="active icon-state"><Factory size={11} aria-hidden="true" />Guaranteed craft counted</span><span className="approximate icon-state"><EqualApproximately size={12} aria-hidden="true" />Approximate requirement</span><span className="estimated-output icon-state"><Factory size={11} aria-hidden="true" />Estimated craft output; counted for material planning</span><span className="blocked">Recipe cannot start from counted stock</span></div>
            {filteredNeedsBoard.length ? <div className="craft-plan-needs-scroll" tabIndex={0} aria-label="Craft plan needs board">
              <div className="craft-plan-needs-table-wrap craft-plan-needs-matrix">
                <table className="craft-plan-needs-table">
                  <colgroup>
                    <col className="craft-plan-needs-row-column" />
                    {NEED_COLUMNS.map((column) => <col className="craft-plan-needs-data-column" key={column} />)}
                  </colgroup>
                  {filteredNeedsBoard.map((group) => {
                    const sectionCompletion = effortView.confirmed.sections[group.section]?.completion ?? null;
                    const projectedSectionCompletion = effortView.projected.sections[group.section]?.completion ?? null;
                    const showProjectedSection = sectionCompletion != null
                      && projectedSectionCompletion != null
                      && projectedSectionCompletion > sectionCompletion;
                    return (
                    <tbody key={group.section}>
                      <tr className="craft-plan-needs-section-row"><th><div className="craft-plan-needs-section-heading"><span className="craft-plan-needs-section-label">{group.section} <span className={sectionCompletion == null ? "is-unavailable" : completionTone(sectionCompletion)}>{sectionCompletion == null ? "Effort unavailable" : `${sectionCompletion}% confirmed`}</span>{showProjectedSection ? <span className="is-projected">{projectedSectionCompletion}% projected</span> : null}</span>{group.section === "Fishing" ? <div className="craft-plan-fishing-route" role="group" aria-label="Preferred fishing route">
                        <button type="button" className={normalizedFishingRoute === "ocean" ? "active" : ""} aria-pressed={normalizedFishingRoute === "ocean"} onClick={() => setFishingRoute("ocean")}>Ocean</button>
                        <button type="button" className={normalizedFishingRoute === "lake" ? "active" : ""} aria-pressed={normalizedFishingRoute === "lake"} onClick={() => setFishingRoute("lake")}>Lake</button>
                        {!personalBoard.available && personalBoard.reason ? <small role="status" aria-live="polite">{personalBoard.reason}</small> : null}
                      </div> : null}</div></th>{NEED_COLUMNS.map((column) => <th key={column}>{column}</th>)}</tr>
                        {group.rows.map((row) => (
                          <tr key={row.name}>
                            <th>{canEditSelectedPlan ? <button className="craft-plan-row-section-button" type="button" title={`Edit ${row.name} row display`} onClick={() => { setRowOverrideError(null); setSelectedSectionOverride({ row, section: row.sectionOverride ?? row.plannerSection, name: row.rowNameOverride ?? row.apiName }); }}>{row.name}</button> : row.name}</th>
                            {NEED_COLUMNS.map((column) => <td key={column}>{needCellNode(row.cells.get(column), (cell) => void openNeedDetail(cell))}</td>)}
                          </tr>
                        ))}
                    </tbody>
                    );
                  })}
                </table>
              </div>
            </div> : <p className="legend">{needsSearch.trim() ? "No matching items in the selected Needs Board filters." : "All planned materials are covered by confirmed stock and guaranteed active crafts."}</p>}
          </section>

          {canEditSelectedPlan && warnings.length ? (
            <details className="form-card craft-plan-section warning-card craft-plan-catalog-diagnostics">
              <summary><span><AlertTriangle size={17} /> Catalog diagnostics</span><small>{warnings.length} item{warnings.length === 1 ? "" : "s"} need review</small></summary>
              <div className="craft-plan-catalog-diagnostic-list">
                {warnings.map((warning: string) => <p className="legend" key={warning}>{warning}</p>)}
              </div>
            </details>
          ) : null}
          {unavailableSources.length ? (
            <section className="form-card craft-plan-section warning-card">
              <h3><AlertTriangle size={17} /> Unavailable stock sources</h3>
              {unavailableSources.map((source: AnyRecord) => <p className="legend" key={`${source.type}-${source.sourceId}`}>{source.label}: {source.error}</p>)}
            </section>
          ) : null}
        </>
      )}
      {needDetailDialog}
      {sectionOverrideDialog}
      {canEditSelectedPlan ? <CraftPlanManagerDialog open={managerOpen} onClose={closeManager} csrfToken={String(ownsSelectedPlan ? auth.csrfToken : adminAuth?.csrfToken)} planId={selectedPlanId} personal={selectedPlan?.scope === "personal"} ownerManaged={ownsSelectedPlan} permissions={Array.isArray(adminAuth?.user?.permissions) ? adminAuth.user.permissions : []} initialWorkspace={managerOutputKey ? "recipes" : "goals"} initialOutputKey={managerOutputKey} onSaved={() => { setManagerRefreshToken((value) => value + 1); void refreshPlans(selectedPlanId); }} /> : null}
      <CraftPlansDialog open={plansOpen} plans={plans} selectedPlanId={selectedPlanId} userCsrfToken={auth.csrfToken} adminCsrfToken={adminAuth?.csrfToken} currentUserId={auth.user?.id} onClose={() => setPlansOpen(false)} onSelect={selectPlan} onChanged={(planId) => void refreshPlans(planId).then((resolved) => { if (resolved) selectPlan(resolved); })} />
    </div>
  );
}
