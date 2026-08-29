import React from "react";
import { AlertTriangle, ClipboardList, Download, History, LoaderCircle, Package, Plus, RefreshCw, Route, Save, Search, SlidersHorizontal, Target, Trash2, X, Zap } from "lucide-react";

import { ItemIcon, ItemLabel } from "../components/main/ItemDisplay";
import { Dialog } from "../components/main/Dialog";
import type { AnyRecord } from "../main-app-data";
import { dateLabel, formatNumber, timeAgo } from "../utils/format";
import { createDelayedRefreshTask } from "../refresh/pageRefresh.mjs";
import { buildCraftPlanBankGroups, finalizeLegacyBankMigrations, initiallyExpandedBankPlayerIds, mergeLegacyBankDiscovery, runBankDiscoveryQueue } from "./craftPlanBankSelection.mjs";
import { applyCraftPlanSourceSuggestion, craftPlanAuditInstant, craftPlanAuditLocalDateTime, craftPlanManagerWorkspaces, craftPlanMaterialPresentation, craftPlanRouteSelection, craftPlanSourceSuggestion, orderCraftPlanRouteReviews, rebaseCraftPlanDraft, resolveCraftPlanDraftConflict, stageCraftPlanRouteRecommendations, type CraftPlanDraftConflict, type CraftPlanManagerWorkspace } from "./craftPlanManagerModel";

const LOCAL_API = "/api/local";
const BANK_LOAD_CONCURRENCY = 3;
type ManagerOperation = "loading" | "refreshing" | "saving" | "preset" | null;
type PlayerBankLoad = { status: "loading" | "loaded" | "error"; banks: AnyRecord[]; warnings: string[]; error?: string };

type CraftPlanConfig = {
  enabled: boolean;
  name: string;
  targets: AnyRecord[];
  sourceRules: { storageContainerIds: string[]; playerIds: string[]; craftPlayerIds: string[]; bankPlayerIds: string[]; bankContainerIds: string[]; deployableContainerIds: string[] };
  routeOverrides: Record<string, string>;
  sectionOverrides: Record<string, string>;
  rowNameOverrides: Record<string, string>;
  multipliers: Record<string, { multiplier: number; note?: string }>;
  gatheredItemKeys: string[];
  buildingProgress: Record<string, { baselineEntityIds: string[]; completedEntityIds: string[] }>;
};

type RouteConfirmation = { outputKey: string; fingerprint: string; selectedRouteId: string };

class CraftPlanApiError extends Error {
  status: number;
  body: AnyRecord;

  constructor(status: number, body: AnyRecord) {
    super(String(body.error ?? `HTTP ${status}`));
    this.status = status;
    this.body = body;
  }
}

function emptyConfig(): CraftPlanConfig {
  return { enabled: true, name: "Settlement craft plan", targets: [], sourceRules: { storageContainerIds: [], playerIds: [], craftPlayerIds: [], bankPlayerIds: [], bankContainerIds: [], deployableContainerIds: [] }, routeOverrides: {}, sectionOverrides: {}, rowNameOverrides: {}, multipliers: {}, gatheredItemKeys: [], buildingProgress: {} };
}

function managerConfigFromResult(result: AnyRecord): CraftPlanConfig {
  return { ...emptyConfig(), ...(result.config ?? {}), sourceRules: { ...emptyConfig().sourceRules, ...(result.config?.sourceRules ?? {}) } };
}

function itemKind(item: AnyRecord) {
  const raw = String(item.kind ?? item.itemType ?? item.item_type ?? "items");
  return raw === "building" || raw === "2" ? "building" : raw === "cargo" || raw === "1" ? "cargo" : "items";
}

function itemKey(item: AnyRecord) {
  return `${itemKind(item)}:${item.id}`;
}

function targetFromMarketItem(item: AnyRecord): AnyRecord {
  const kind = itemKind(item);
  return {
    id: String(item.id),
    kind,
    itemType: kind === "cargo" ? 1 : 0,
    name: String(item.name ?? `Item #${item.id}`),
    quantity: Number(item.quantity ?? 1) || 1,
    tier: item.tier ?? null,
    rarityStr: item.rarityStr ?? item.rarity ?? null,
    tag: item.tag ?? null,
    iconAssetName: item.iconAssetName ?? null,
  };
}

function withQuantity(item: AnyRecord, quantity: number) {
  return { ...targetFromMarketItem(item), quantity: Math.max(1, Math.ceil(quantity || 1)) };
}

function mergeTargets(existing: AnyRecord[], incoming: AnyRecord[]) {
  const byKey = new Map(existing.map((target) => [itemKey(target), { ...target }]));
  for (const target of incoming) {
    const key = itemKey(target);
    const current = byKey.get(key);
    byKey.set(key, current ? { ...current, quantity: Math.max(1, Math.ceil(Number(current.quantity ?? 0) + Number(target.quantity ?? 0))) } : { ...target });
  }
  return [...byKey.values()];
}

function itemTypeLabel(item: AnyRecord) {
  const kind = itemKind(item);
  return kind === "building" ? "Workstation" : kind === "cargo" ? "Cargo" : "Item";
}

function itemPreview(items: AnyRecord[] = [], limit = 4) {
  const top = items.slice().sort((a, b) => Number(b.quantity ?? 0) - Number(a.quantity ?? 0)).slice(0, limit);
  return top.length ? (
    <div className="craft-plan-source-items">
      {top.map((item) => <span key={`${itemKey(item)}:${item.quantity}`}><ItemLabel item={item} meta={itemTypeLabel(item)} /><strong>{formatNumber(Number(item.quantity) || 0, 0)}</strong></span>)}
    </div>
  ) : <p className="legend">No visible item stacks.</p>;
}

function sourceCard(source: AnyRecord, checked: boolean, onChange: (checked: boolean) => void) {
  return (
    <article className={`craft-plan-source-card${checked ? " is-included" : ""}`} key={source.sourceId}>
      <header>
        <div>
          <strong>{source.label}</strong>
          <small>{source.type ? `${source.type}${source.itemCount != null ? ` - ${formatNumber(Number(source.itemCount) || 0, 0)} stacks` : ""}` : `${formatNumber(source.itemCount ?? 0)} item stacks`}</small>
        </div>
        <label className="compact-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{checked ? "Included" : "Excluded"}</span></label>
      </header>
      {itemPreview(Array.isArray(source.items) ? source.items : [])}
    </article>
  );
}


function playerSourceCard(
  source: AnyRecord,
  inventoryChecked: boolean,
  craftsChecked: boolean,
  onInventoryChange: (checked: boolean) => void,
  onCraftsChange: (checked: boolean) => void,
) {
  return (
    <article className={`craft-plan-source-card craft-plan-player-source-card${inventoryChecked || craftsChecked ? " is-included" : ""}`} key={source.playerId}>
      <header>
        <div>
          <strong>{source.label}</strong>
          <small>Player tracking</small>
        </div>
        <div className="craft-plan-player-source-toggles">
          <label className="compact-toggle"><input type="checkbox" checked={inventoryChecked} onChange={(event) => onInventoryChange(event.target.checked)} /><span>Inventory</span></label>
          <label className="compact-toggle"><input type="checkbox" checked={craftsChecked} onChange={(event) => onCraftsChange(event.target.checked)} /><span>Crafts</span></label>
        </div>
      </header>
    </article>
  );
}


function groupDeployablesByPlayer(sources: AnyRecord[]) {
  const groups = new Map<string, { playerId: string; playerName: string; sources: AnyRecord[] }>();
  for (const source of Array.isArray(sources) ? sources : []) {
    const playerId = String(source.playerId ?? source.sourceId ?? "unknown").split(":")[0] || "unknown";
    const playerName = String(source.playerName ?? source.ownerName ?? playerId);
    const group = groups.get(playerId) ?? { playerId, playerName, sources: [] };
    group.sources.push(source);
    groups.set(playerId, group);
  }
  return [...groups.values()].sort((a, b) => a.playerName.localeCompare(b.playerName));
}
function routeOptionLabel(recipe: AnyRecord, output?: AnyRecord) {
  const inputs = Array.isArray(recipe.inputs) ? recipe.inputs.map((item) => String(item.name ?? item.label ?? item.id ?? "item")).filter(Boolean) : [];
  const label = String(recipe.label ?? recipe.name ?? recipe.id ?? "Recipe");
  const station = String(recipe.buildingName ?? "").trim();
  const outputName = String(output?.name ?? output?.label ?? output?.id ?? "output");
  return inputs.length && output ? `${inputs.join(" + ")} -> ${outputName}${station ? ` - ${station}` : ""}` : `${label}${station ? ` - ${station}` : ""}`;
}

function routeOptionDetails(alternative: AnyRecord) {
  const details: string[] = [];
  const addNumber = (label: string, value: unknown) => {
    if (value != null && Number.isFinite(Number(value))) details.push(`${label} ${formatNumber(Number(value), 2)}`);
  };
  addNumber("Expected yield", alternative.expectedYield);
  addNumber("Per craft", alternative.expectedPerCraft);
  addNumber("Per progress", alternative.expectedPerProgress);
  addNumber("Per resource", alternative.expectedPerResource);
  if (alternative.dropChance != null) details.push(`Drop ${formatNumber(Number(alternative.dropChance) * 100, 2)}%${alternative.dropQuantity != null ? ` · quantity ${formatNumber(Number(alternative.dropQuantity), 2)}` : ""}`);
  addNumber("Actions", alternative.actionsRequired);
  addNumber("Resource health", alternative.resourceHealth);
  if (alternative.gatheringMode) details.push(`Gathering mode ${alternative.gatheringMode}`);
  const source = alternative.gatheringSource;
  const sourceLabel = typeof source === "string" ? source : firstText(source?.label, source?.tag, source?.skill);
  if (sourceLabel) details.push(`Source ${sourceLabel}`);
  const producer = alternative.producer;
  const producerLabel = typeof producer === "string" ? producer : firstText(producer?.name, producer?.label, producer?.key, producer?.id);
  if (producerLabel) details.push(`Producer ${producerLabel}`);
  const producerRecipe = alternative.producerRecipe;
  const recipeLabel = typeof producerRecipe === "string" ? producerRecipe : firstText(producerRecipe?.name, producerRecipe?.label, producerRecipe?.id);
  if (recipeLabel) details.push(`Producer recipe ${recipeLabel}`);
  if (producerRecipe?.buildingName || alternative.buildingName) details.push(`Station ${producerRecipe?.buildingName ?? alternative.buildingName}`);
  if (producerRecipe?.skillName || alternative.gatheringSkill) details.push(`Skill ${producerRecipe?.skillName ?? alternative.gatheringSkill}`);
  return details;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function progressEventLabel(value: unknown) {
  return firstText(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Planner change";
}

function unresolvedRelationshipText(entry: AnyRecord) {
  const dependencyIdentity = firstText(entry.relationship, entry.dependencyIdentity, entry.dependencyKey, entry.dependencyId, entry.dependencyMaterialKey);
  return [
    firstText(entry.reason) || "Unresolved relationship",
    entry.triggerType ? `Trigger ${progressEventLabel(entry.triggerType)}` : "",
    entry.effectType ? `Effect ${progressEventLabel(entry.effectType)}` : "",
    entry.materialKey ? `Material ${String(entry.materialKey)}` : "",
    dependencyIdentity ? `Dependency ${dependencyIdentity}` : "",
  ].filter(Boolean).join(" · ");
}

function exactAuditValue(value: unknown) {
  return JSON.stringify(value) ?? "null";
}

function formatStoredBytes(value: unknown) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${formatNumber(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

export function CraftPlanManagerDialog({
  open,
  onClose,
  csrfToken,
  onSaved,
  planId = "legacy-primary",
  personal = false,
  ownerManaged = personal,
  permissions = [],
  canEdit = true,
  initialWorkspace = "goals",
  initialOutputKey = "",
}: {
  open: boolean;
  onClose: () => void;
  csrfToken: string;
  onSaved: () => void;
  planId?: string;
  personal?: boolean;
  ownerManaged?: boolean;
  permissions?: string[];
  canEdit?: boolean;
  initialWorkspace?: CraftPlanManagerWorkspace;
  initialOutputKey?: string;
}) {
  const [state, setState] = React.useState<AnyRecord | null>(null);
  const [config, setConfig] = React.useState<CraftPlanConfig>(emptyConfig());
  const resolvedInitialWorkspace: CraftPlanManagerWorkspace = canEdit ? initialWorkspace : "audit";
  const [activeTab, setActiveTab] = React.useState<CraftPlanManagerWorkspace>(resolvedInitialWorkspace);
  const [query, setQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<AnyRecord[]>([]);
  const [activeSearchResultIndex, setActiveSearchResultIndex] = React.useState(-1);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [operation, setOperation] = React.useState<ManagerOperation>(null);
  const [auditRows, setAuditRows] = React.useState<AnyRecord[]>([]);
  const [auditLoaded, setAuditLoaded] = React.useState(false);
  const [auditLoading, setAuditLoading] = React.useState(false);
  const [auditError, setAuditError] = React.useState<string | null>(null);
  const [progressAudit, setProgressAudit] = React.useState<AnyRecord | null>(null);
  const [progressAuditError, setProgressAuditError] = React.useState<string | null>(null);
  const [auditDownloadRange, setAuditDownloadRange] = React.useState<string | null>(null);
  const [auditDownloadError, setAuditDownloadError] = React.useState<string | null>(null);
  const [bankLoads, setBankLoads] = React.useState<Record<string, PlayerBankLoad>>({});
  const [bankDiscoveryStarted, setBankDiscoveryStarted] = React.useState(false);
  const [legacyBankMigrations, setLegacyBankMigrations] = React.useState<string[]>([]);
  const [expandedBankPlayers, setExpandedBankPlayers] = React.useState<string[]>([]);
  const [trackedBanksOnly, setTrackedBanksOnly] = React.useState(false);
  const [savedConfigSignature, setSavedConfigSignature] = React.useState("");
  const [refreshConfirmationOpen, setRefreshConfirmationOpen] = React.useState(false);
  const [sourceQuery, setSourceQuery] = React.useState("");
  const [suggestionConfirmationOpen, setSuggestionConfirmationOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<AnyRecord | null>(null);
  const [previewSignature, setPreviewSignature] = React.useState("");
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [routeConfirmations, setRouteConfirmations] = React.useState<Record<string, RouteConfirmation>>({});
  const [publicRouteGate, setPublicRouteGate] = React.useState<AnyRecord[] | null>(null);
  const [revisionConflict, setRevisionConflict] = React.useState<AnyRecord | null>(null);
  const [conflictDraft, setConflictDraft] = React.useState<CraftPlanConfig | null>(null);
  const [baseConfig, setBaseConfig] = React.useState<CraftPlanConfig>(emptyConfig);
  const [draftConflicts, setDraftConflicts] = React.useState<CraftPlanDraftConflict[]>([]);
  const [auditFilters, setAuditFilters] = React.useState({ range: "3d", since: "", until: "", triggerCategory: "", effectCategory: "", materialKey: "", unresolvedOnly: false, page: 1 });
  const [comparisonFrom, setComparisonFrom] = React.useState("");
  const [comparisonTo, setComparisonTo] = React.useState("");
  const [comparison, setComparison] = React.useState<AnyRecord | null>(null);
  const [comparisonError, setComparisonError] = React.useState<string | null>(null);
  const loadRequestId = React.useRef(0);
  const previewRequestId = React.useRef(0);
  const previewAttemptSignature = React.useRef("");
  const configSignatureRef = React.useRef(JSON.stringify(config));
  const suppressedRouteRecommendations = React.useRef(new Set<string>());
  configSignatureRef.current = JSON.stringify(config);
  const auditRequestId = React.useRef(0);
  const comparisonRequestId = React.useRef(0);
  function updateConfig(update: React.SetStateAction<CraftPlanConfig>) {
    setPreview(null);
    setPreviewSignature("");
    setConfig((current) => {
      const next = typeof update === "function" ? update(current) : update;
      configSignatureRef.current = JSON.stringify(next);
      return next;
    });
  }
  const configSignature = JSON.stringify(config);
  const currentPreview = previewSignature === configSignature ? preview : null;
  const draftDirty = Boolean(savedConfigSignature) && configSignature !== savedConfigSignature;
  const canViewAudit = permissions.includes("*") || permissions.includes("audit.view");
  const canExportAudit = canViewAudit && (permissions.includes("*") || permissions.includes("data.export"));
  const workspaces = craftPlanManagerWorkspaces({ canViewAudit, canEdit });
  const adminApi = React.useCallback(async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    if (options.method && options.method !== "GET") headers.set("x-csrf-token", csrfToken);
    const response = await fetch(`${LOCAL_API}${path}`, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new CraftPlanApiError(response.status, body);
    return body;
  }, [csrfToken]);

  const load = React.useCallback(async (mode: "loading" | "refreshing" = "loading") => {
    const requestId = ++loadRequestId.current;
    previewRequestId.current += 1;
    previewAttemptSignature.current = "";
    suppressedRouteRecommendations.current.clear();
    comparisonRequestId.current += 1;
    setBusy(true);
    setOperation(mode);
    setError(null);
    setPreview(null);
    setPreviewSignature("");
    setPreviewLoading(false);
    setPreviewError(null);
    setComparison(null);
    setComparisonError(null);
    try {
      const result = await adminApi(ownerManaged
        ? `/user/craft-plans/${encodeURIComponent(planId)}`
        : planId === "legacy-primary"
          ? "/admin/craft-plan"
          : `/admin/craft-plan?planId=${encodeURIComponent(planId)}`);
      if (requestId !== loadRequestId.current) return;
      const loadedConfig = managerConfigFromResult(result);
      setState(result);
      updateConfig(loadedConfig);
      setBaseConfig(loadedConfig);
      setSavedConfigSignature(JSON.stringify(loadedConfig));
      setRefreshConfirmationOpen(false);
      setBankLoads({});
      setBankDiscoveryStarted(false);
      setLegacyBankMigrations([]);
      setExpandedBankPlayers([]);
      setPreview(null);
      setPreviewError(null);
      setRouteConfirmations({});
      setPublicRouteGate(null);
      setRevisionConflict(null);
      setConflictDraft(null);
      setDraftConflicts([]);
    } catch (err) {
      if (requestId === loadRequestId.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestId === loadRequestId.current) {
        setBusy(false);
        setOperation(null);
      }
    }
  }, [adminApi, ownerManaged, planId]);

  const loadAudit = React.useCallback(async () => {
    const requestId = ++auditRequestId.current;
    setAuditLoading(true);
    setAuditLoaded(false);
    setAuditError(null);
    setProgressAuditError(null);
    const [settingsResult, progressResult] = await Promise.allSettled([
      adminApi(`/admin/craft-plan/audit?limit=100&planId=${encodeURIComponent(planId)}`),
      adminApi(`/admin/craft-plan/progress-audit?planId=${encodeURIComponent(planId)}&range=${encodeURIComponent(auditFilters.range)}&since=${encodeURIComponent(craftPlanAuditInstant(auditFilters.since))}&until=${encodeURIComponent(craftPlanAuditInstant(auditFilters.until))}&page=${auditFilters.page}&pageSize=25&triggerCategory=${encodeURIComponent(auditFilters.triggerCategory)}&effectCategory=${encodeURIComponent(auditFilters.effectCategory)}&materialKey=${encodeURIComponent(auditFilters.materialKey)}&unresolvedOnly=${auditFilters.unresolvedOnly}`),
    ]);
    if (requestId !== auditRequestId.current) return;
    if (settingsResult.status === "fulfilled") {
      setAuditRows(Array.isArray(settingsResult.value.configHistory) ? settingsResult.value.configHistory : []);
    } else {
      setAuditError(settingsResult.reason instanceof Error ? settingsResult.reason.message : String(settingsResult.reason));
    }
    if (progressResult.status === "fulfilled") {
      setProgressAudit(progressResult.value);
    } else {
      setProgressAuditError(progressResult.reason instanceof Error ? progressResult.reason.message : String(progressResult.reason));
    }
    if (requestId === auditRequestId.current) {
      setAuditLoading(false);
      setAuditLoaded(true);
    }
  }, [adminApi, auditFilters, planId]);

  const loadPreview = React.useCallback(async (draft: CraftPlanConfig = config) => {
    const requestId = ++previewRequestId.current;
    const draftSignature = JSON.stringify(draft);
    previewAttemptSignature.current = draftSignature;
    setPreview(null);
    setPreviewSignature("");
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const path = ownerManaged
        ? `/user/craft-plans/${encodeURIComponent(planId)}/preview`
        : `/admin/craft-plans/${encodeURIComponent(planId)}/preview`;
      const result = await adminApi(path, { method: "POST", body: JSON.stringify({ config: draft }) });
      if (requestId !== previewRequestId.current || draftSignature !== configSignatureRef.current) return null;
      const recommendedDraft = stageCraftPlanRouteRecommendations(draft, result.routeReviews, suppressedRouteRecommendations.current);
      if (JSON.stringify(recommendedDraft) !== draftSignature) {
        updateConfig(recommendedDraft);
        return result;
      }
      setPreview(result);
      setPreviewSignature(draftSignature);
      return result;
    } catch (err) {
      if (requestId === previewRequestId.current && draftSignature === configSignatureRef.current) setPreviewError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      if (requestId === previewRequestId.current) setPreviewLoading(false);
    }
  }, [adminApi, config, ownerManaged, planId]);

  async function compareCheckpoints() {
    if (!comparisonFrom || !comparisonTo) return;
    const requestId = ++comparisonRequestId.current;
    const from = comparisonFrom;
    const to = comparisonTo;
    setComparison(null);
    setComparisonError(null);
    try {
      const result = await adminApi(`/admin/craft-plan/progress-audit/compare?planId=${encodeURIComponent(planId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (requestId === comparisonRequestId.current) setComparison(result);
    } catch (err) {
      if (requestId === comparisonRequestId.current) {
        setComparison(null);
        setComparisonError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  function updateComparisonInput(kind: "from" | "to", value: string) {
    comparisonRequestId.current += 1;
    setComparison(null);
    setComparisonError(null);
    if (kind === "from") setComparisonFrom(value);
    else setComparisonTo(value);
  }

  async function downloadProgressAudit(range: string) {
    setAuditDownloadRange(range);
    setAuditDownloadError(null);
    try {
      const response = await fetch(`${LOCAL_API}/admin/craft-plan/progress-audit/export?range=${range}&planId=${encodeURIComponent(planId)}`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `craft-plan-progress-audit-${range}.json.gz`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setAuditDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setAuditDownloadRange(null);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    setActiveTab(resolvedInitialWorkspace);
    void load();
  }, [open, resolvedInitialWorkspace, load]);

  React.useEffect(() => {
    if (open) return;
    loadRequestId.current += 1;
    previewRequestId.current += 1;
    previewAttemptSignature.current = "";
    auditRequestId.current += 1;
    comparisonRequestId.current += 1;
    setState(null);
    updateConfig(emptyConfig());
    setBusy(false);
    setOperation(null);
    setStatus(null);
    setError(null);
    setActiveTab(resolvedInitialWorkspace);
    setQuery("");
    setSearchResults([]);
    setActiveSearchResultIndex(-1);
    setAuditRows([]);
    setAuditLoaded(false);
    setAuditLoading(false);
    setAuditError(null);
    setProgressAudit(null);
    setProgressAuditError(null);
    setAuditDownloadRange(null);
    setAuditDownloadError(null);
    setBankLoads({});
    setBankDiscoveryStarted(false);
    setLegacyBankMigrations([]);
    setExpandedBankPlayers([]);
    setTrackedBanksOnly(false);
    setSavedConfigSignature("");
    setRefreshConfirmationOpen(false);
    setSourceQuery("");
    setSuggestionConfirmationOpen(false);
    setPreview(null);
    setPreviewSignature("");
    setPreviewLoading(false);
    setPreviewError(null);
    setRouteConfirmations({});
    setPublicRouteGate(null);
    setRevisionConflict(null);
    setConflictDraft(null);
    setBaseConfig(emptyConfig());
    setDraftConflicts([]);
    setAuditFilters({ range: "3d", since: "", until: "", triggerCategory: "", effectCategory: "", materialKey: "", unresolvedOnly: false, page: 1 });
    setComparisonFrom("");
    setComparisonTo("");
    setComparison(null);
    setComparisonError(null);
  }, [open, resolvedInitialWorkspace]);

  React.useEffect(() => {
    if (!open || activeTab !== "audit" || !canViewAudit || auditLoaded) return;
    void loadAudit();
  }, [open, activeTab, canViewAudit, auditLoaded, loadAudit]);

  React.useEffect(() => {
    const signature = JSON.stringify(config);
    if (!open || activeTab !== "recipes" || !state || previewLoading || currentPreview || (previewError && previewAttemptSignature.current === signature)) return;
    void loadPreview(config);
  }, [open, activeTab, config, currentPreview, loadPreview, previewError, previewLoading, state]);

  React.useEffect(() => {
    if (!open || activeTab !== "recipes" || !initialOutputKey || !currentPreview || typeof document === "undefined") return;
    document.getElementById(`craft-plan-review-${encodeURIComponent(initialOutputKey)}`)?.focus();
  }, [open, activeTab, initialOutputKey, currentPreview]);

  async function loadPlayerBanks(player: AnyRecord) {
    const playerId = String(player.playerId ?? "");
    if (!playerId) return;
    const initiallyExpanded = initiallyExpandedBankPlayerIds(config.sourceRules).includes(playerId);
    const wasLegacyTracked = config.sourceRules.bankPlayerIds.includes(playerId);
    setBankLoads((current) => ({ ...current, [playerId]: { status: "loading", banks: current[playerId]?.banks ?? [], warnings: [] } }));
    try {
      const result = await adminApi(ownerManaged ? `/user/craft-plans/${encodeURIComponent(planId)}/player-banks?playerId=${encodeURIComponent(playerId)}` : `/admin/craft-plan/player-banks?playerId=${encodeURIComponent(playerId)}`);
      const banks = Array.isArray(result.banks) ? result.banks : [];
      setBankLoads((current) => ({ ...current, [playerId]: { status: "loaded", banks, warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [] } }));
      updateConfig((current) => {
        const sourceRules = mergeLegacyBankDiscovery(current.sourceRules, playerId, banks);
        return sourceRules === current.sourceRules ? current : { ...current, sourceRules };
      });
      if (wasLegacyTracked) setLegacyBankMigrations((current) => current.includes(playerId) ? current : [...current, playerId]);
      if (initiallyExpanded) setExpandedBankPlayers((current) => current.includes(playerId) ? current : [...current, playerId]);
    } catch (err) {
      setBankLoads((current) => ({ ...current, [playerId]: { status: "error", banks: current[playerId]?.banks ?? [], warnings: [], error: err instanceof Error ? err.message : String(err) } }));
    }
  }

  React.useEffect(() => {
    if (open && activeTab === "sources") setBankDiscoveryStarted(true);
  }, [open, activeTab]);

  React.useEffect(() => {
    if (!open || !bankDiscoveryStarted) return;
    const players = Array.isArray(state?.sources?.players) ? state.sources.players : [];
    if (!players.length) return;
    let cancelled = false;
    void runBankDiscoveryQueue(players, async (player: AnyRecord) => {
      if (!cancelled) await loadPlayerBanks(player);
    }, BANK_LOAD_CONCURRENCY);
    return () => { cancelled = true; };
  }, [open, bankDiscoveryStarted, state?.sources?.players]);

  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setSearchResults([]); return; }
    const controller = new AbortController();
    const refresh = createDelayedRefreshTask(() => fetch(`${LOCAL_API}/catalog/search?q=${encodeURIComponent(trimmed)}&limit=16`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`catalog search HTTP ${response.status}`))), 200);
    void refresh.promise
      .then((body) => {
        setSearchResults([...(body.items ?? []), ...(body.cargos ?? [])].slice(0, 16));
        setActiveSearchResultIndex(-1);
      })
      .catch(() => setSearchResults([]));
    return () => { refresh.cancel(); controller.abort(); };
  }, [query]);

  function selectSearchResult(item: AnyRecord) {
    addTargets([withQuantity(item, 1)], `Added ${item.name ?? item.id}.`);
    setQuery("");
    setSearchResults([]);
    setActiveSearchResultIndex(-1);
  }

  function handleSearchResultKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSearchResults([]);
      setActiveSearchResultIndex(-1);
      return;
    }
    if (!searchResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchResultIndex((current) => current >= searchResults.length - 1 ? 0 : current + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchResultIndex((current) => current <= 0 ? searchResults.length - 1 : current - 1);
    } else if (event.key === "Enter" && activeSearchResultIndex >= 0) {
      event.preventDefault();
      selectSearchResult(searchResults[activeSearchResultIndex]);
    }
  }

  function patchConfig(patch: Partial<CraftPlanConfig>) {
    updateConfig((current) => ({ ...current, ...patch }));
  }

  function requestRefresh() {
    if (draftDirty) {
      setRefreshConfirmationOpen(true);
      return;
    }
    void load("refreshing");
  }

  function updateSource(kind: "storageContainerIds" | "playerIds" | "craftPlayerIds" | "bankPlayerIds" | "bankContainerIds" | "deployableContainerIds", id: string, checked: boolean) {
    updateConfig((current) => {
      const currentValues = current.sourceRules[kind] ?? [];
      const nextValues = checked ? [...new Set([...currentValues, id])] : currentValues.filter((value) => value !== id);
      return { ...current, sourceRules: { ...current.sourceRules, [kind]: nextValues } };
    });
  }

  function addTargets(items: AnyRecord[], message: string) {
    updateConfig((current) => ({ ...current, targets: mergeTargets(current.targets, items) }));
    setStatus(message);
  }

  function applySuggestedSources() {
    const suggestion = craftPlanSourceSuggestion({ personal, sources: state?.sources ?? {} });
    updateConfig((current) => applyCraftPlanSourceSuggestion(current, suggestion));
    setSuggestionConfirmationOpen(false);
    setStatus("Suggested sources added to the draft. Save Plan to persist them.");
  }

  function selectRoute(review: AnyRecord, routeId: string) {
    updateConfig((current) => ({ ...current, routeOverrides: { ...current.routeOverrides, [String(review.outputKey)]: routeId } }));
    setRouteConfirmations((current) => {
      const next = { ...current };
      delete next[String(review.outputKey)];
      return next;
    });
    setPublicRouteGate(null);
  }

  function resetRoute(outputKey: string) {
    suppressedRouteRecommendations.current.add(outputKey);
    updateConfig((current) => {
      const routeOverrides = { ...current.routeOverrides };
      delete routeOverrides[outputKey];
      return { ...current, routeOverrides };
    });
    setRouteConfirmations((current) => {
      const next = { ...current };
      delete next[outputKey];
      return next;
    });
    setPublicRouteGate(null);
  }

  function updateMaterialBuffer(outputKey: string, rawPercent: string) {
    const percent = Math.max(0, Math.min(1900, Number(rawPercent) || 0));
    updateConfig((current) => {
      const multipliers = { ...current.multipliers };
      if (percent > 0) multipliers[outputKey] = { multiplier: 1 + percent / 100, note: `${percent}% gathering safety buffer` };
      else delete multipliers[outputKey];
      return { ...current, multipliers };
    });
    setPublicRouteGate(null);
  }

  function confirmRouteReview(review: AnyRecord) {
    const outputKey = String(review.outputKey);
    const selectedRouteId = craftPlanRouteSelection(review, config.routeOverrides[outputKey]);
    if (!selectedRouteId) return;
    setRouteConfirmations((current) => ({
      ...current,
      [outputKey]: { outputKey, fingerprint: String(review.fingerprint), selectedRouteId },
    }));
    setStatus(`${outputKey} review confirmed in the draft.`);
  }

  function rebaseConflictDraft() {
    if (!revisionConflict) return;
    const authoritativeConfig = managerConfigFromResult({
      config: { ...(revisionConflict.config ?? {}), name: revisionConflict.plan?.name ?? revisionConflict.config?.name },
    });
    const draft = conflictDraft ?? config;
    const rebased = rebaseCraftPlanDraft({ base: baseConfig, local: draft, server: authoritativeConfig });
    setState((current) => ({
      ...(current ?? {}),
      planRecord: {
        ...(current?.planRecord ?? {}),
        ...(revisionConflict.plan ?? {}),
        revision: Number(revisionConflict.currentRevision ?? current?.planRecord?.revision ?? 0),
      },
      config: authoritativeConfig,
    }));
    updateConfig(rebased.config);
    setBaseConfig(authoritativeConfig);
    setDraftConflicts(rebased.conflicts);
    setSavedConfigSignature(JSON.stringify(authoritativeConfig));
    previewRequestId.current += 1;
    previewAttemptSignature.current = "";
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    setRouteConfirmations({});
    setPublicRouteGate(null);
    setRevisionConflict(null);
    setConflictDraft(null);
    setStatus(rebased.conflicts.length
      ? "Latest revision loaded. Resolve the overlapping changes before saving."
      : "Latest revision loaded; server changes and your non-overlapping draft changes were preserved.");
  }

  function resolveDraftConflict(conflict: CraftPlanDraftConflict, choice: "local" | "server") {
    updateConfig((current) => resolveCraftPlanDraftConflict(current, conflict, choice));
    setDraftConflicts((current) => current.filter((entry) => entry.path !== conflict.path));
  }

  async function addWorkstationPreset(preset: AnyRecord) {
    setBusy(true);
    setOperation("preset");
    setError(null);
    setStatus(null);
    try {
      const result = await adminApi(ownerManaged ? `/user/craft-plans/${encodeURIComponent(planId)}/workstation-preset?tier=${encodeURIComponent(String(preset.tier))}` : `/admin/craft-plan/workstation-preset?tier=${encodeURIComponent(String(preset.tier))}`);
      const incoming = Array.isArray(result.workstations) ? result.workstations : [];
      const known = new Set(config.targets.map(itemKey));
      const additions = incoming.filter((target: AnyRecord) => {
        if (known.has(itemKey(target))) return false;
        known.add(itemKey(target));
        return true;
      });
      const added = additions.length;
      const existing = incoming.length - additions.length;
      updateConfig((current) => ({ ...current, targets: [...current.targets, ...additions] }));
      setStatus(`Added ${added} T${preset.tier} workstations${existing ? `; ${existing} already tracked` : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setOperation(null);
    }
  }

  async function save(confirmPublicRoutes = false) {
    if (draftConflicts.length) return;
    setBusy(true);
    setOperation("saving");
    setError(null);
    setStatus(null);
    setRevisionConflict(null);
    let submittedConfig = {
      ...config,
      sourceRules: finalizeLegacyBankMigrations(config.sourceRules, legacyBankMigrations),
    };
    try {
      const revision = Number(state?.planRecord?.revision ?? 0);
      const path = ownerManaged ? `/user/craft-plans/${encodeURIComponent(planId)}` : `/admin/craft-plans/${encodeURIComponent(planId)}`;
      let confirmations = Object.values(routeConfirmations);
      if (confirmPublicRoutes) {
        submittedConfig = stageCraftPlanRouteRecommendations(submittedConfig, publicRouteGate ?? [], suppressedRouteRecommendations.current);
        updateConfig(submittedConfig);
        const latestPreview = await loadPreview(submittedConfig);
        const gatedKeys = new Set((publicRouteGate ?? []).map((entry) => String(entry.outputKey)));
        confirmations = orderCraftPlanRouteReviews(Array.isArray(latestPreview?.routeReviews) ? latestPreview.routeReviews : [])
          .map((entry: AnyRecord) => ({ entry, selectedRouteId: craftPlanRouteSelection(entry, submittedConfig.routeOverrides[String(entry.outputKey)]) }))
          .filter(({ entry, selectedRouteId }) => gatedKeys.has(String(entry.outputKey)) && selectedRouteId)
          .map(({ entry, selectedRouteId }) => ({ outputKey: String(entry.outputKey), fingerprint: String(entry.fingerprint), selectedRouteId }));
      }
      await adminApi(path, { method: "PUT", body: JSON.stringify({ name: submittedConfig.name, config: submittedConfig, expectedRevision: revision, routeReviewConfirmations: confirmations }) });
      await load("refreshing");
      setRefreshConfirmationOpen(false);
      setStatus("Craft plan saved.");
      setAuditLoaded(false);
      onSaved();
    } catch (err) {
      if (err instanceof CraftPlanApiError && err.body.code === "craft_plan_route_review_required") {
        setPublicRouteGate(Array.isArray(err.body.unconfirmedRoutes) ? err.body.unconfirmedRoutes : []);
        setError(null);
      } else if (err instanceof CraftPlanApiError && err.status === 409 && err.body.code === "craft_plan_revision_conflict") {
        setRevisionConflict(err.body.conflict ?? {});
        setConflictDraft(submittedConfig);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
      setOperation(null);
    }
  }

  if (!open) return null;

  const storageSources = state?.sources?.storage ?? [];
  const playerSources = state?.sources?.players ?? [];
  const deployableSources = state?.sources?.deployables ?? [];
  const normalizedSourceQuery = sourceQuery.trim().toLocaleLowerCase();
  const sourceMatches = (source: AnyRecord) => !normalizedSourceQuery || [source.label, source.playerName, source.ownerName, source.sourceId, source.playerId, source.type, source.containerKind].some((value) => String(value ?? "").toLocaleLowerCase().includes(normalizedSourceQuery));
  const visibleStorageSources = storageSources.filter(sourceMatches);
  const visiblePlayerSources = playerSources.filter(sourceMatches);
  const visibleDeployableSources = deployableSources.filter(sourceMatches);
  const deployableGroups = groupDeployablesByPlayer(visibleDeployableSources);
  const tierPresets = state?.sources?.tierPresets ?? [];
  const workstationPresets = state?.sources?.workstationPresets ?? [];
  const routeReviews = orderCraftPlanRouteReviews(Array.isArray(currentPreview?.routeReviews) ? currentPreview.routeReviews : []);
  const reviewedOutputKeys = new Set(routeReviews.map((review: AnyRecord) => String(review.outputKey)));
  const orphanMultipliers = Object.entries(config.multipliers).filter(([outputKey]) => !reviewedOutputKeys.has(outputKey));
  const previewMaterials = new Map((Array.isArray(currentPreview?.materials) ? currentPreview.materials : []).map((material: AnyRecord) => [String(material.key), craftPlanMaterialPresentation(material)]));
  const sourceSuggestion = craftPlanSourceSuggestion({ personal, sources: state?.sources ?? {} });
  const hasConfiguredSources = Object.values(config.sourceRules).some((values) => Array.isArray(values) && values.length > 0);
  const trackedBankIds = new Set(config.sourceRules.bankContainerIds.map(String));
  const bankGroups = buildCraftPlanBankGroups({ players: playerSources, bankLoads, trackedBankIds: config.sourceRules.bankContainerIds, search: sourceQuery, trackedOnly: trackedBanksOnly });
  const loadedBankPlayers = Object.values(bankLoads).filter((entry) => entry.status === "loaded" || entry.status === "error").length;
  const trackedBankCount = config.sourceRules.bankContainerIds.length;
  const pendingLabel = operation === "loading" ? "Loading plan data…" : operation === "refreshing" ? "Refreshing plan data…" : operation === "saving" ? "Saving plan…" : operation === "preset" ? "Loading workstation preset…" : null;

  return (
    <Dialog open title="Craft plan manager" closeOnBackdrop={false} onClose={onClose} className="modal craft-plan-manager" backdropClassName="modal-backdrop craft-plan-manager-backdrop">
        <header className="modal-header">
          <div>
            <h2><ClipboardList size={22} /> Manage {personal ? "Personal " : ""}Craft Plan</h2>
            <p>Set goals, choose counted inventories, apply tier presets, and tune routes for this plan.</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close craft plan manager"><X size={18} /></button>
        </header>
        <fieldset className="craft-plan-manager-session" disabled={operation === "refreshing"} aria-busy={operation === "refreshing"}>
        <div className="craft-plan-manager-actions">
          <span className="legend">{canEdit ? "All edits remain staged until Save Plan." : "Audit is read-only."}</span>
          <div className="craft-plan-manager-buttons">
            <button className="toolbar-button" type="button" onClick={requestRefresh} disabled={busy}>{operation === "refreshing" ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCw size={14} />} {operation === "refreshing" ? "Refreshing…" : "Refresh"}</button>
            {canEdit ? <button className="toolbar-button primary" type="button" onClick={() => void save(Boolean(publicRouteGate))} disabled={busy || draftConflicts.length > 0}>{operation === "saving" ? <LoaderCircle className="is-spinning" size={14} /> : <Save size={14} />} {operation === "saving" ? "Saving…" : publicRouteGate ? "Confirm routes and Save Plan" : "Save Plan"}</button> : null}
          </div>
        </div>
        {refreshConfirmationOpen ? <div className="alert warning craft-plan-refresh-confirmation" role="group" aria-labelledby="craft-plan-refresh-confirmation-title"><div><strong id="craft-plan-refresh-confirmation-title">Discard unsaved changes?</strong><span>Refreshing reloads the last saved plan and replaces your current edits.</span></div><div><button className="toolbar-button" type="button" onClick={() => setRefreshConfirmationOpen(false)}>Keep editing</button><button className="toolbar-button danger" type="button" onClick={() => { setRefreshConfirmationOpen(false); void load("refreshing"); }}>Discard and refresh</button></div></div> : null}
        {pendingLabel ? <div className="craft-plan-manager-pending" role="status" aria-live="polite"><LoaderCircle className="is-spinning" size={16} /><span>{pendingLabel}</span></div> : null}
        {error ? <div className="alert error">{error}</div> : null}
        {status ? <div className="alert success">{status}</div> : null}
        {publicRouteGate ? <div className="alert warning craft-plan-public-gate" role="alert"><div><strong>Public route review required</strong><span>New ambiguous routes must be explicitly confirmed before this public plan can be updated. Your draft is unchanged; use the Save action above to confirm and publish it.</span></div></div> : null}
        {revisionConflict ? <div className="alert warning craft-plan-conflict" role="alert"><div><strong>Plan changed elsewhere</strong><span>The server is now at revision {String(revisionConflict.currentRevision ?? "unknown")}. Your unsaved edits are still here.</span></div><div><button className="toolbar-button" type="button" onClick={() => { setRevisionConflict(null); setConflictDraft(null); }}>Keep draft</button><button className="toolbar-button danger" type="button" onClick={rebaseConflictDraft}>Reload latest</button></div></div> : null}
        {draftConflicts.length ? <div className="alert warning craft-plan-conflict" role="alert"><div><strong>Conflicting changes need resolution</strong><span>The same plan fields changed here and on the server. Saving is disabled until you choose each value.</span></div>{draftConflicts.map((conflict) => <div key={conflict.path}><code>{conflict.path}</code><span>Server: {JSON.stringify(conflict.server)} · Yours: {JSON.stringify(conflict.local)}</span><div><button className="toolbar-button" type="button" onClick={() => resolveDraftConflict(conflict, "server")}>Keep server value</button><button className="toolbar-button" type="button" onClick={() => resolveDraftConflict(conflict, "local")}>Use my value</button></div></div>)}</div> : null}
        <nav className="craft-plan-manager-tabs" aria-label="Craft plan workspaces">
          {workspaces.map(({ id, label }) => <button key={id} type="button" aria-current={activeTab === id ? "page" : undefined} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>{id === "goals" ? <Target size={15} /> : id === "sources" ? <Package size={15} /> : id === "recipes" ? <Route size={15} /> : <History size={15} />}{label}</button>)}
        </nav>
        <div className="craft-plan-manager-body" aria-busy={busy}>
          {operation === "loading" && !state ? <div className="craft-plan-manager-loading"><LoaderCircle className="is-spinning" size={28} /><strong>Loading craft plan</strong><span>Fetching targets, inventories, players, deployables, routes, and presets.</span></div> : null}
          {activeTab === "goals" ? <section className="craft-plan-manager-panel">
            <div className="craft-plan-goal-settings">
              <label className="field craft-plan-name-field"><span>Plan name</span><input value={config.name} onChange={(event) => patchConfig({ name: event.target.value })} /></label>
              <label className="craft-plan-public-toggle"><input type="checkbox" checked={config.enabled !== false} onChange={(event) => patchConfig({ enabled: event.target.checked })} /><span><strong>{personal ? "Personal visibility" : "Public board"}</strong><small>{config.enabled !== false ? "Visible to permitted users" : "Hidden/private draft"}</small></span></label>
            </div>
            <div className="split-header"><div><h3>Target items</h3><p className="legend">Preset buttons add normal target rows. You can change quantities or remove them at any time.</p></div></div>
            <section className="craft-plan-tier-presets" aria-label="Tier upgrade presets">
              <div className="craft-plan-tier-presets-header">
                <div><h4><Zap size={16} /> Tier upgrade presets</h4><p>Loaded from live settlement research. Click a tier to add its upgrade materials to the plan.</p></div>
                <small>{tierPresets.length ? `${tierPresets.length} presets loaded` : "No presets loaded"}</small>
              </div>
              {tierPresets.length ? <div className="craft-plan-preset-grid">
                {tierPresets.map((preset: AnyRecord) => <button className="craft-plan-preset-tier" type="button" aria-label={`Add upgrade materials for ${preset.label}`} key={preset.key} onClick={() => addTargets((preset.items ?? []).map((item: AnyRecord) => withQuantity(item, Number(item.quantity) || 1)), `Added ${preset.label} requirements.`)}>{preset.label}</button>)}
              </div> : <div className="craft-plan-preset-empty"><strong>No tier presets loaded</strong><span>Live settlement research has no tier upgrade materials available yet.</span></div>}
            </section>
            <section className="craft-plan-tier-presets craft-plan-workstation-presets" aria-label="Workstation tier presets">
              <div className="craft-plan-tier-presets-header">
                <div><h4><Package size={16} /> Workstation presets</h4><p>Add one of every standard workstation at the selected tier. Construction requirements come from the live Relay catalog.</p></div>
                <small>{workstationPresets.length ? `${workstationPresets.length} tiers loaded` : "No presets loaded"}</small>
              </div>
              {workstationPresets.length ? <div className="craft-plan-preset-grid">
                {workstationPresets.map((preset: AnyRecord) => <button className="craft-plan-preset-tier" type="button" aria-label={`Add workstation targets for ${preset.label}`} disabled={busy} key={preset.key} onClick={() => void addWorkstationPreset(preset)}>{preset.label}</button>)}
              </div> : <div className="craft-plan-preset-empty"><strong>No workstation presets loaded</strong><span>The live Relay catalog has no compatible workstation definitions yet.</span></div>}
            </section>
            <label className="field craft-plan-target-search"><span>Add target manually</span><div className="search"><Search size={16} /><input value={query} role="combobox" aria-autocomplete="list" aria-expanded={searchResults.length > 0} aria-controls="craft-plan-target-suggestions" aria-activedescendant={activeSearchResultIndex >= 0 ? `craft-plan-target-suggestion-${activeSearchResultIndex}` : undefined} autoComplete="off" onKeyDown={handleSearchResultKeyDown} onChange={(event) => { setQuery(event.target.value); setActiveSearchResultIndex(-1); }} placeholder="Search live catalog items" /></div><small role="status" aria-live="polite">{query.trim().length < 2 ? "Type at least two characters to search." : `${searchResults.length} results available.`}</small></label>
            {searchResults.length ? <div className="craft-plan-search-results" id="craft-plan-target-suggestions" role="listbox">{searchResults.map((item, index) => <button id={`craft-plan-target-suggestion-${index}`} role="option" aria-selected={activeSearchResultIndex === index} tabIndex={-1} className="toolbar-button" type="button" key={`${itemKind(item)}:${item.id}`} onMouseEnter={() => setActiveSearchResultIndex(index)} onClick={() => selectSearchResult(item)}><ItemIcon item={item} /> {item.name ?? item.id}</button>)}</div> : null}
            <div className="craft-plan-target-editor-list">
              {config.targets.length ? config.targets.map((target, index) => <div className="craft-plan-target-editor-row" key={itemKey(target)}>
                <ItemLabel item={target} />
                <div className="craft-plan-target-editor-actions">
                  <label className="field compact-field"><span>Quantity</span><input type="number" min={1} value={target.quantity ?? 1} onChange={(event) => updateConfig((current) => ({ ...current, targets: current.targets.map((row, i) => i === index ? { ...row, quantity: Math.max(1, Math.ceil(Number(event.target.value) || 1)) } : row) }))} /></label>
                  <button className="toolbar-button danger" type="button" onClick={() => updateConfig((current) => {
                    const targets = current.targets.filter((_, i) => i !== index);
                    if (itemKind(target) !== "building") return { ...current, targets };
                    const nextProgress = { ...current.buildingProgress };
                    delete nextProgress[itemKey(target)];
                    return { ...current, targets, buildingProgress: nextProgress };
                  })}><Trash2 size={14} /> Remove</button>
                </div>
              </div>) : <p className="legend">No targets configured yet.</p>}
            </div>
          </section> : null}

          {activeTab === "sources" ? <section className="craft-plan-manager-panel craft-plan-counted-sources">
            <div className="split-header"><div><h3>Counted Sources</h3><p className="legend">Search and stage settlement storage, player inventory, active crafts, deployables, and individual banks in one workspace.</p></div></div>
            <p className="legend">Crafts, banks, and deployables stay opt-in unless you select them below.</p>
            <label className="search craft-plan-source-search"><Search size={16} /><input type="search" aria-label="Search counted sources" value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Search storage, players, deployables, or banks" /></label>
            {!hasConfiguredSources && (sourceSuggestion.sourceRules.storageContainerIds.length || sourceSuggestion.sourceRules.playerIds.length) ? <aside className="craft-plan-source-suggestion" aria-label="Unselected counted-source suggestion"><div><strong>{personal ? "Owner inventory suggestion" : "Settlement storage suggestion"}</strong><span>{personal ? "Preview: only the owner’s inventory. Crafts, banks, and deployables stay opt-in." : "Preview: settlement storage only. Crafts, banks, and deployables stay opt-in."}</span><small>{personal ? visiblePlayerSources.slice(0, 1).map((source: AnyRecord) => source.label).join(", ") : visibleStorageSources.map((source: AnyRecord) => source.label).join(", ")}</small></div><button className="toolbar-button" type="button" onClick={() => setSuggestionConfirmationOpen(true)}>Review suggestion</button></aside> : null}
            {suggestionConfirmationOpen ? <div className="alert warning craft-plan-source-suggestion-confirm" role="group" aria-labelledby="craft-plan-source-suggestion-title"><div><strong id="craft-plan-source-suggestion-title">Apply suggested counted sources?</strong><span>This only changes the draft. Crafts, banks, and deployables remain opt-in.</span></div><div><button className="toolbar-button" type="button" onClick={() => setSuggestionConfirmationOpen(false)}>Cancel</button><button className="toolbar-button primary" type="button" onClick={applySuggestedSources}>Apply suggestion</button></div></div> : null}
            <h4>Settlement storage</h4><p className="legend">Inventory cards show the largest visible item stacks from each live Relay storage container.</p><div className="craft-plan-source-grid">{visibleStorageSources.length ? visibleStorageSources.map((source: AnyRecord) => sourceCard(source, config.sourceRules.storageContainerIds.includes(String(source.sourceId)), (checked) => updateSource("storageContainerIds", String(source.sourceId), checked))) : <p className="legend">No settlement storage sources match.</p>}</div>
            <h4>Player inventory and crafts</h4><div className="craft-plan-source-grid compact">{visiblePlayerSources.length ? visiblePlayerSources.map((source: AnyRecord) => playerSourceCard(source, config.sourceRules.playerIds.includes(String(source.playerId)), config.sourceRules.craftPlayerIds.includes(String(source.playerId)), (checked) => updateSource("playerIds", String(source.playerId), checked), (checked) => updateSource("craftPlayerIds", String(source.playerId), checked))) : <p className="legend">No players match.</p>}</div>
            <h4>Deployables</h4>{deployableGroups.length ? <div className="craft-plan-deployable-groups">{deployableGroups.map((group) => <section className="craft-plan-deployable-group" key={group.playerId}><header><strong>{group.playerName}</strong><small>{formatNumber(group.sources.length, 0)} deployables</small></header><div className="craft-plan-source-grid compact">{group.sources.map((source: AnyRecord) => sourceCard({ ...source, label: String(source.label ?? source.containerKind ?? "Deployable storage") }, config.sourceRules.deployableContainerIds.includes(String(source.sourceId)), (checked) => updateSource("deployableContainerIds", String(source.sourceId), checked)))}</div></section>)}</div> : <p className="legend">No deployables match.</p>}
          </section> : null}

          {activeTab === "sources" ? <section className="craft-plan-manager-panel craft-plan-bank-panel">
            <div className="split-header"><div><h3>Player banks</h3><p className="legend">Track only the individual banks whose stock should count toward this plan. Empty untracked banks are hidden.</p></div><small>{formatNumber(trackedBankCount, 0)} tracked</small></div>
            <div className="craft-plan-bank-toolbar">
              <label className="craft-plan-bank-filter"><input type="checkbox" checked={trackedBanksOnly} onChange={(event) => setTrackedBanksOnly(event.target.checked)} /><span>Tracked only</span></label>
              <span className="craft-plan-bank-progress" role="status" aria-live="polite">{loadedBankPlayers < playerSources.length ? <><LoaderCircle className="is-spinning" size={14} /> Discovering banks {loadedBankPlayers}/{playerSources.length}</> : `${loadedBankPlayers} players checked`}</span>
            </div>
            {bankGroups.length ? <div className="craft-plan-bank-groups">{bankGroups.map((group: AnyRecord) => {
              const expanded = Boolean(sourceQuery.trim()) || expandedBankPlayers.includes(group.playerId);
              return <section className={`craft-plan-bank-group${group.trackedCount ? " has-tracked" : ""}`} key={group.playerId}>
                <button className="craft-plan-bank-group-toggle" type="button" aria-expanded={expanded} onClick={() => setExpandedBankPlayers((current) => current.includes(group.playerId) ? current.filter((id) => id !== group.playerId) : [...current, group.playerId])}>
                  <span><strong>{group.playerName}</strong><small>{group.loadState?.status === "loaded" ? `${formatNumber(group.nonEmptyCount, 0)} non-empty banks · ${formatNumber(group.trackedCount, 0)} tracked` : group.loadState?.status === "error" ? "Bank discovery failed" : "Discovering banks…"}</small></span>
                  <span>{expanded ? "Hide" : "Show"}</span>
                </button>
                {expanded ? <div className="craft-plan-bank-group-body">
                  {group.loadState?.status === "loading" || !group.loadState ? <div className="craft-plan-bank-state"><LoaderCircle className="is-spinning" size={18} /><span>Loading {group.playerName}’s banks…</span></div> : null}
                  {group.loadState?.status === "error" ? <div className="craft-plan-bank-state is-error"><span>{group.loadState.error}</span><button className="toolbar-button" type="button" onClick={() => void loadPlayerBanks({ playerId: group.playerId, label: group.playerName })}><RefreshCw size={14} /> Retry</button></div> : null}
                  {group.loadState?.warnings?.length ? <div className="alert warning">{group.loadState.warnings.join(" ")}</div> : null}
                  {group.loadState?.status === "loaded" && group.visibleBanks.length ? <div className="craft-plan-bank-grid">{group.visibleBanks.map((bank: AnyRecord) => {
                    const sourceId = String(bank.sourceId);
                    const tracked = trackedBankIds.has(sourceId);
                    const items = Array.isArray(bank.items) ? bank.items : [];
                    const itemCount = Number(bank.itemCount ?? items.length ?? 0);
                    const unavailable = bank.unavailable === true;
                    return <article className={`craft-plan-bank-card${tracked ? " is-included" : ""}`} key={sourceId}>
                      <header><div><strong>{bank.label ?? sourceId}</strong><small>{unavailable ? "Unavailable — tracked" : itemCount > 0 ? `${formatNumber(itemCount, 0)} visible stacks` : "Empty — tracked"}</small></div><label className="compact-toggle"><input type="checkbox" checked={tracked} onChange={(event) => updateSource("bankContainerIds", sourceId, event.target.checked)} /><span>{tracked ? "Tracked" : "Track"}</span></label></header>
                      {unavailable ? <div className="alert warning">This tracked bank is not present in the latest Relay data.</div> : itemCount > 0 ? itemPreview(items, 4) : <p className="legend">This tracked bank currently has no visible items.</p>}
                      {items.length > 4 ? <details className="craft-plan-bank-items"><summary>Show all {formatNumber(items.length, 0)} stacks</summary>{itemPreview(items, items.length)}</details> : null}
                    </article>;
                  })}</div> : null}
                  {group.loadState?.status === "loaded" && !group.visibleBanks.length ? <p className="legend">No banks match the current filters.</p> : null}
                </div> : null}
              </section>;
            })}</div> : loadedBankPlayers >= playerSources.length ? <div className="craft-plan-audit-state compact"><Package size={22} /><strong>No banks to show</strong><span>No non-empty or tracked banks match the current filters.</span></div> : null}
          </section> : null}

          {activeTab === "recipes" ? <section className="craft-plan-manager-panel craft-plan-recipe-review" aria-labelledby="craft-plan-recipe-review-heading">
            <div className="split-header"><div><h3 id="craft-plan-recipe-review-heading">Recipe Review</h3><p className="legend">Ambiguous typed outputs appear first. Choose comparison cards, confirm the review in this draft, then use the single Save Plan action.</p></div><button className="toolbar-button" type="button" onClick={() => void loadPreview(config)} disabled={previewLoading}>{previewLoading ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCw size={14} />} Refresh preview</button></div>
            {previewLoading && !currentPreview ? <div className="craft-plan-audit-state" role="status" aria-live="polite"><LoaderCircle className="is-spinning" size={22} /><strong>Loading recipe preview</strong><span>Calculating route choices and material impact without saving.</span></div> : null}
            {previewError ? <div className="alert error" role="alert">Recipe preview could not be loaded: {previewError}</div> : null}
            {!previewLoading && !previewError && !routeReviews.length ? <div className="craft-plan-audit-state compact"><Route size={22} /><strong>No recipe routes to review</strong><span>Add goals, then refresh the preview. Nothing is saved until Save Plan.</span></div> : null}
            {routeReviews.length ? <div className="craft-plan-review-list">{routeReviews.map((review: AnyRecord) => {
              const selectedRouteId = craftPlanRouteSelection(review, config.routeOverrides[review.outputKey]);
              const material = previewMaterials.get(String(review.outputKey));
              const confirmation = routeConfirmations[String(review.outputKey)];
              const bufferPercent = Math.max(0, (Number(config.multipliers[String(review.outputKey)]?.multiplier ?? 1) - 1) * 100);
              return <article id={`craft-plan-review-${encodeURIComponent(String(review.outputKey))}`} tabIndex={initialOutputKey === review.outputKey ? 0 : -1} className={`craft-plan-review-entry${review.ambiguous ? " is-ambiguous" : ""}`} key={review.outputKey}>
                <header><div><span className="craft-plan-route-kind is-craft">{review.ambiguous ? "Ambiguous route" : "Single route"}</span><strong>{review.outputKey}</strong><small>{review.confirmed ? "Previously confirmed" : confirmation ? "Confirmed in draft" : "Needs review"}</small></div>{review.preselectedRouteId ? <span className="legend">Safest server recommendation: {review.preselectedRouteId}</span> : null}</header>
                <fieldset className="craft-plan-review-options"><legend>Production route for {review.outputKey}</legend>{(review.alternatives ?? []).map((alternative: AnyRecord) => {
                  const selected = selectedRouteId === String(alternative.id);
                  const risky = alternative.probabilityStatus !== "guaranteed" || alternative.isProbabilistic === true;
                  return <label className={`craft-plan-review-route${selected ? " is-selected" : ""}`} key={alternative.id}><input type="radio" name={`route-${review.outputKey}`} value={alternative.id} checked={selected} aria-label={`${routeOptionLabel(alternative)}; ${risky ? "estimated output risk" : "guaranteed output"}`} onChange={() => selectRoute(review, String(alternative.id))} /><span><strong>{routeOptionLabel(alternative)}</strong><small>{risky ? "Estimated/probabilistic output" : "Guaranteed output"}{alternative.buildingName ? ` · ${alternative.buildingName}` : ""}</small><span className="craft-plan-route-metrics">{routeOptionDetails(alternative).map((detail) => <small key={detail}>{detail}</small>)}</span>{Array.isArray(alternative.inputs) && alternative.inputs.length ? <em>Inputs: {alternative.inputs.map((input: AnyRecord) => `${input.key} ×${formatNumber(input.quantity, 2)}`).join(", ")}</em> : <em>No material inputs</em>}</span></label>;
                })}</fieldset>
                <div className="craft-plan-review-footer">
                  <label className="field compact-field"><span>Material buffer (% extra)</span><input type="number" min="0" max="1900" step="5" aria-label={`Material buffer for ${review.outputKey}`} value={formatNumber(bufferPercent, 1)} onChange={(event) => updateMaterialBuffer(String(review.outputKey), event.target.value)} /></label>
                  <div className="craft-plan-material-impact" aria-label={`Material impact for ${review.outputKey}`}>{material ? <><span><strong>Needed now {formatNumber(material.neededNow, 0)}</strong><small>from missingNow</small></span><span><strong>Plan total {formatNumber(material.planTotal, 0)}</strong><small>from planRequired</small></span></> : <span className="legend">No material row for this typed output.</span>}</div>
                  {review.ambiguous ? <button className="toolbar-button primary" type="button" onClick={() => confirmRouteReview({ ...review, selectedRouteId })} disabled={!selectedRouteId}>{confirmation ? "Review confirmed" : "Confirm review"}</button> : <span className="legend">No confirmation required</span>}
                </div>
                {Object.hasOwn(config.routeOverrides, String(review.outputKey)) ? <button className="toolbar-button" type="button" onClick={() => resetRoute(String(review.outputKey))}>Use calculated route</button> : null}
              </article>;
            })}</div> : null}
            {orphanMultipliers.length ? <section className="craft-plan-orphan-buffers"><h4>Saved buffers outside this preview</h4><p className="legend">These staged settings remain saved even when the current preview has no matching output.</p>{orphanMultipliers.map(([outputKey, value]) => <div key={outputKey}><span><strong>{outputKey}</strong><small>{formatNumber(Math.max(0, (Number(value.multiplier) - 1) * 100), 1)}% buffer</small></span><button className="toolbar-button danger" type="button" onClick={() => updateMaterialBuffer(outputKey, "0")}>Remove saved buffer</button></div>)}</section> : null}
          </section> : null}
          {activeTab === "audit" ? <section className="craft-plan-manager-panel craft-plan-audit-panel">
            <div className="split-header"><div><h3>Audit history</h3><p className="legend">Progress calculations, source changes, and saved configuration changes, newest first.</p></div>{auditError || progressAuditError ? <button className="toolbar-button" type="button" onClick={() => void loadAudit()} disabled={auditLoading}><RefreshCw size={14} /> Retry audit</button> : null}</div>
            {auditLoading ? <div className="craft-plan-audit-state" role="status"><LoaderCircle className="is-spinning" size={22} /><strong>Loading audit history</strong></div> : null}
            {!auditLoading ? <section className="craft-plan-progress-diagnostics">
              <div className="split-header">
                <div><h4>Causal timeline</h4><p className="legend">Server-derived observed triggers, derived effects, dependency paths, and unresolved relationships from the retained 30-day evidence window.</p></div>
                {canExportAudit ? <div className="craft-plan-progress-downloads" aria-label="Download progress diagnostics">
                  {["24h", "3d", "7d", "all"].map((range) => <button className="toolbar-button" type="button" onClick={() => void downloadProgressAudit(range)} disabled={auditDownloadRange != null} key={range}>{auditDownloadRange === range ? <LoaderCircle className="is-spinning" size={14} /> : <Download size={14} />} Download diagnostics ({range})</button>)}
                </div> : null}
              </div>
              {progressAuditError ? <div className="alert error">Progress diagnostics could not be loaded: {progressAuditError}</div> : null}
              {auditDownloadError ? <div className="alert error">Diagnostics download failed: {auditDownloadError}</div> : null}
              {!progressAuditError && progressAudit ? <>
                <div className="craft-plan-audit-filters" aria-label="Filter causal timeline">
                  <label className="field compact-field"><span>Time range</span><select aria-label="Audit time range" value={auditFilters.range} onChange={(event) => { setAuditFilters((current) => ({ ...current, range: event.target.value, since: "", until: "", page: 1 })); setAuditLoaded(false); }}><option value="3d">3 days</option><option value="7d">7 days</option><option value="14d">14 days</option><option value="30d">30 days</option></select></label>
                  <label className="field compact-field"><span>Exact since</span><input aria-label="Audit since" type="datetime-local" min={craftPlanAuditLocalDateTime(Date.now() - 30 * 24 * 60 * 60 * 1000)} max={craftPlanAuditLocalDateTime(Date.now())} value={auditFilters.since} onChange={(event) => { setAuditFilters((current) => ({ ...current, since: event.target.value, page: 1 })); setAuditLoaded(false); }} /></label>
                  <label className="field compact-field"><span>Exact until</span><input aria-label="Audit until" type="datetime-local" min={craftPlanAuditLocalDateTime(Date.now() - 30 * 24 * 60 * 60 * 1000)} max={craftPlanAuditLocalDateTime(Date.now())} value={auditFilters.until} onChange={(event) => { setAuditFilters((current) => ({ ...current, until: event.target.value, page: 1 })); setAuditLoaded(false); }} /></label>
                  <label className="field compact-field"><span>Observed trigger</span><input value={auditFilters.triggerCategory} onChange={(event) => { setAuditFilters((current) => ({ ...current, triggerCategory: event.target.value, page: 1 })); setAuditLoaded(false); }} placeholder="e.g. stock_movement" /></label>
                  <label className="field compact-field"><span>Derived effect</span><input value={auditFilters.effectCategory} onChange={(event) => { setAuditFilters((current) => ({ ...current, effectCategory: event.target.value, page: 1 })); setAuditLoaded(false); }} placeholder="e.g. demand_change" /></label>
                  <label className="field compact-field"><span>Typed material</span><input value={auditFilters.materialKey} onChange={(event) => { setAuditFilters((current) => ({ ...current, materialKey: event.target.value, page: 1 })); setAuditLoaded(false); }} placeholder="items:123 or cargo:123" /></label>
                  <label className="craft-plan-bank-filter"><input type="checkbox" checked={auditFilters.unresolvedOnly} onChange={(event) => { setAuditFilters((current) => ({ ...current, unresolvedOnly: event.target.checked, page: 1 })); setAuditLoaded(false); }} /><span>Unresolved only</span></label>
                </div>
                <div className="craft-plan-progress-audit-summary craft-plan-progress-audit-stats">
                  <article><small>Confirmed progress</small><strong>{progressAudit.status?.confirmedCompletion == null ? "—" : `${formatNumber(progressAudit.status.confirmedCompletion, 1)}%`}</strong><span>Stock and guaranteed active output</span></article>
                  <article><small>Projected progress</small><strong>{progressAudit.status?.projectedCompletion == null ? "—" : `${formatNumber(progressAudit.status.projectedCompletion, 1)}%`}</strong><span>Includes expected active-craft output</span></article>
                  <article><small>Last successful calculation</small><strong>{progressAudit.status?.lastSuccessfulAt ? timeAgo(progressAudit.status.lastSuccessfulAt) : "Not recorded"}</strong><span>{progressAudit.status?.lastSuccessfulAt ? dateLabel(progressAudit.status.lastSuccessfulAt) : "Waiting for a complete source refresh"}</span></article>
                  <article><small>Baseline revision</small><strong>{progressAudit.status?.baselineRevision ? String(progressAudit.status.baselineRevision).slice(0, 12) : "Not recorded"}</strong><span>Changes when plan math inputs change</span></article>
                  <article><small>Full checkpoints</small><strong>{formatNumber(progressAudit.status?.snapshotCount ?? 0, 0)}</strong><span>At least every 6 hours or after a baseline change</span></article>
                  <article><small>Audit storage</small><strong>{formatStoredBytes(progressAudit.status?.storedBytes)}</strong><span>{formatNumber(progressAudit.status?.eventCount ?? 0, 0)} events · {formatNumber(progressAudit.status?.retentionDays ?? 30, 0)}-day retention</span></article>
                </div>
                {progressAudit.status?.lastError ? <div className="alert warning">Latest calculation used the last complete result: {progressAudit.status.lastError}</div> : null}
                {progressAudit.status?.writeWarning ? <div className="alert warning">Audit recording warning: {progressAudit.status.writeWarning}</div> : null}
                <div className="craft-plan-progress-event-header"><h4>Recent progress events</h4><small>{Array.isArray(progressAudit.events) ? `${progressAudit.events.length} shown` : "None recorded"}</small></div>
                {Array.isArray(progressAudit.events) && progressAudit.events.length ? <div className="craft-plan-progress-event-list">
                  {progressAudit.events.map((event: AnyRecord) => <article className={`craft-plan-progress-event is-${String(event.eventType ?? "change").replaceAll("_", "-")}`} key={event.id}>
                    <span className="craft-plan-progress-event-mark" aria-hidden="true" />
                    <div>
                      <header><strong>{progressEventLabel(event.eventType)}</strong><time dateTime={event.capturedAt} title={dateLabel(event.capturedAt)}>{timeAgo(event.capturedAt)}</time></header>
                      <p>{event.summary || "Planner inputs changed."}</p>
                      {Array.isArray(event.contributors) && event.contributors.length ? <small>Largest effects: {event.contributors.slice(0, 3).map((contributor: AnyRecord) => contributor.name || contributor.itemKey).join(", ")}</small> : null}
                      {Array.isArray(event.reasons) && event.reasons.length ? <small>{event.reasons.join("; ")}</small> : null}
                      {event.inference?.cause ? <small>Likely {event.inference.cause} ({event.inference.confidence ?? "estimated"} confidence)</small> : null}
                    </div>
                  </article>)}
                </div> : <div className="craft-plan-audit-state compact"><History size={20} /><strong>No progress changes recorded yet.</strong><span>The first complete planner calculation creates the initial checkpoint.</span></div>}
                <div className="craft-plan-progress-event-header"><h4>Causal groups</h4><small>{formatNumber(progressAudit.pagination?.total ?? 0, 0)} matching</small></div>
                {Array.isArray(progressAudit.causalGroups) && progressAudit.causalGroups.length ? <div className="craft-plan-causal-list">{progressAudit.causalGroups.map((group: AnyRecord) => <article className="craft-plan-causal-entry" key={group.groupId}>
                  <header><strong><time dateTime={group.span?.from}>{dateLabel(group.span?.from)}</time> → <time dateTime={group.span?.to}>{dateLabel(group.span?.to)}</time></strong>{Array.isArray(group.unresolvedRelationships) && group.unresolvedRelationships.length ? <span className="craft-plan-causal-unresolved"><AlertTriangle size={13} /> {group.unresolvedRelationships.length} unresolved</span> : <span>Evidence linked</span>}</header>
                  <div><h5>Observed</h5>{(group.observedTriggers ?? []).map((entry: AnyRecord, index: number) => <span key={`observed-${index}`}>{progressEventLabel(entry.category)} · {progressEventLabel(entry.type)}{entry.materialKey ? ` · ${entry.materialKey}` : ""}</span>)}</div>
                  <div><h5>Derived</h5>{(group.derivedEffects ?? []).map((entry: AnyRecord, index: number) => <span key={`derived-${index}`}>{progressEventLabel(entry.category)} · {progressEventLabel(entry.type)}{entry.materialKey ? ` · ${entry.materialKey}` : ""}{entry.before !== undefined ? ` · Before ${String(entry.before)}` : ""}{entry.after !== undefined ? ` · After ${String(entry.after)}` : ""}{entry.delta !== undefined ? ` · Delta ${String(entry.delta)}` : ""}</span>)}</div>
                  {Array.isArray(group.dependencyPaths) && group.dependencyPaths.length ? <details><summary>Dependency paths</summary>{group.dependencyPaths.map((entry: AnyRecord) => <p className="legend" key={entry.materialKey}>{entry.materialKey}: {(entry.paths ?? []).map((path: unknown[]) => path.join(" → ")).join("; ")}</p>)}</details> : null}
                  {Array.isArray(group.unresolvedRelationships) && group.unresolvedRelationships.length ? <details><summary>Unresolved details</summary>{group.unresolvedRelationships.map((entry: AnyRecord, index: number) => <p className="legend" key={index}>{unresolvedRelationshipText(entry)}</p>)}</details> : null}
                </article>)}</div> : <div className="craft-plan-audit-state compact"><History size={20} /><strong>No causal groups match</strong><span>Change filters or wait for a completed planner checkpoint.</span></div>}
                <div className="craft-plan-audit-pagination" aria-label="Causal timeline pages"><button className="toolbar-button" type="button" disabled={!progressAudit.pagination?.hasPrevious} onClick={() => { setAuditFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) })); setAuditLoaded(false); }}>Previous</button><span>Page {progressAudit.pagination?.page ?? 1} of {progressAudit.pagination?.totalPages ?? 1}</span><button className="toolbar-button" type="button" disabled={!progressAudit.pagination?.hasNext} onClick={() => { setAuditFilters((current) => ({ ...current, page: current.page + 1 })); setAuditLoaded(false); }}>Next</button></div>
                <section className="craft-plan-checkpoint-comparison"><h4>Checkpoint comparison</h4><p className="legend">Enter two exact retained checkpoint timestamps. Differences and compatibility limits come from the server.</p><div><label className="field compact-field"><span>From</span><input aria-label="Comparison from checkpoint" value={comparisonFrom} onChange={(event) => updateComparisonInput("from", event.target.value)} placeholder="2026-08-28T10:00:00.000Z" /></label><label className="field compact-field"><span>To</span><input aria-label="Comparison to checkpoint" value={comparisonTo} onChange={(event) => updateComparisonInput("to", event.target.value)} placeholder="2026-08-28T12:00:00.000Z" /></label><button className="toolbar-button" type="button" disabled={!comparisonFrom || !comparisonTo} onClick={() => void compareCheckpoints()}>Compare checkpoints</button></div>{comparisonError ? <div className="alert error">Comparison failed: {comparisonError}</div> : null}{comparison?.ok ? <div className="craft-plan-comparison-results">{Object.entries(comparison.differences ?? {}).map(([category, result]) => <span key={category}><strong>{progressEventLabel(category)}</strong>{(result as AnyRecord).changed ? "Changed" : "Unchanged"}</span>)}</div> : null}{comparison?.compatibility?.limitations?.length ? <div className="alert warning">{comparison.compatibility.limitations.join(" ")}</div> : null}</section>
              </> : null}
            </section> : null}
            <div className="craft-plan-progress-event-header"><h4>Saved plan changes</h4><small>Lifetime configuration history for this plan</small></div>
            {!auditLoading && auditError ? <div className="alert error">Audit history could not be loaded: {auditError}</div> : null}
            {!auditLoading && !auditError && !auditRows.length ? <div className="craft-plan-audit-state"><History size={24} /><strong>No craft plan changes have been recorded yet.</strong><span>New saves will appear here when visibility or counted sources change.</span></div> : null}
            {!auditLoading && !auditError && auditRows.length ? <div className="craft-plan-audit-list">
              {auditRows.map((row) => <article className="craft-plan-audit-entry" key={row.id}>
                <div className="craft-plan-audit-meta"><strong>{row.actor?.displayName || "system"}</strong><span>{progressEventLabel(row.actor?.type ?? "system")}</span><time dateTime={row.occurredAt} title={dateLabel(row.occurredAt)}>{timeAgo(row.occurredAt)}</time></div>
                <div className="craft-plan-audit-changes">
                  <div className="craft-plan-audit-other"><SlidersHorizontal size={16} /><span><strong>{progressEventLabel(row.action)}</strong>Revision {row.previousRevision == null ? "created" : row.previousRevision} → {row.newRevision}</span></div>
                  {Array.isArray(row.changes?.patch) && row.changes.patch.length ? row.changes.patch.map((change: AnyRecord, index: number) => <div className="craft-plan-audit-change is-enabled" key={`${change.path}:${index}`}><SlidersHorizontal size={16} /><span><strong>{String(change.path)}</strong><code>{exactAuditValue(change.before)} → {exactAuditValue(change.after)}</code></span></div>) : <p className="legend">No configuration values changed in this revision.</p>}
                </div>
              </article>)}
            </div> : null}
          </section> : null}
        </div>
        </fieldset>
    </Dialog>
  );
}
