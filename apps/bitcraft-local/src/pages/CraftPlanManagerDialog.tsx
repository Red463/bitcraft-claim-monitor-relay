import React from "react";
import { CheckCircle2, ClipboardList, Download, History, LoaderCircle, MinusCircle, Package, Plus, RefreshCw, Route, Save, Search, SlidersHorizontal, Target, Trash2, X, Zap } from "lucide-react";

import { ItemIcon, ItemLabel } from "../components/main/ItemDisplay";
import { Dialog } from "../components/main/Dialog";
import type { AnyRecord } from "../main-app-data";
import { dateLabel, formatNumber, timeAgo } from "../utils/format";
import { createDelayedRefreshTask } from "../refresh/pageRefresh.mjs";
import { buildCraftPlanBankGroups, finalizeLegacyBankMigrations, initiallyExpandedBankPlayerIds, mergeLegacyBankDiscovery, runBankDiscoveryQueue } from "./craftPlanBankSelection.mjs";

const LOCAL_API = "/api/local";
const BANK_LOAD_CONCURRENCY = 3;
const TABS = ["targets", "sources", "players", "banks", "routes", "buffers", "audit"] as const;
type ManagerTab = typeof TABS[number];
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

function routeOutputKey(step: AnyRecord) {
  return itemKey(step.output ?? step);
}

const CRAFT_PLAN_AUDIT_CATEGORY_LABELS: Record<string, string> = {
  public_board: "Visibility",
  storage: "Settlement storage",
  player_inventory: "Player inventory",
  player_crafts: "Player crafts",
  player_bank: "Player bank",
  deployable: "Deployable",
  gathered_item: "Gathered item",
};

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

function formatStoredBytes(value: unknown) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${formatNumber(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

export function CraftPlanManagerDialog({ open, onClose, csrfToken, onSaved, planId = "legacy-primary", personal = false, ownerManaged = personal }: { open: boolean; onClose: () => void; csrfToken: string; onSaved: () => void; planId?: string; personal?: boolean; ownerManaged?: boolean }) {
  const [state, setState] = React.useState<AnyRecord | null>(null);
  const [config, setConfig] = React.useState<CraftPlanConfig>(emptyConfig());
  const [activeTab, setActiveTab] = React.useState<ManagerTab>("targets");
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
  const [bankSearch, setBankSearch] = React.useState("");
  const [trackedBanksOnly, setTrackedBanksOnly] = React.useState(false);
  const [savedConfigSignature, setSavedConfigSignature] = React.useState("");
  const [refreshConfirmationOpen, setRefreshConfirmationOpen] = React.useState(false);
  const loadRequestId = React.useRef(0);
  const draftDirty = Boolean(savedConfigSignature) && JSON.stringify(config) !== savedConfigSignature;
  const adminApi = React.useCallback(async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    if (options.method && options.method !== "GET") headers.set("x-csrf-token", csrfToken);
    const response = await fetch(`${LOCAL_API}${path}`, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }, [csrfToken]);

  const load = React.useCallback(async (mode: "loading" | "refreshing" = "loading") => {
    const requestId = ++loadRequestId.current;
    setBusy(true);
    setOperation(mode);
    setError(null);
    try {
      const result = await adminApi(ownerManaged
        ? `/user/craft-plans/${encodeURIComponent(planId)}`
        : planId === "legacy-primary"
          ? "/admin/craft-plan"
          : `/admin/craft-plan?planId=${encodeURIComponent(planId)}`);
      if (requestId !== loadRequestId.current) return;
      const loadedConfig = managerConfigFromResult(result);
      setState(result);
      setConfig(loadedConfig);
      setSavedConfigSignature(JSON.stringify(loadedConfig));
      setRefreshConfirmationOpen(false);
      setBankLoads({});
      setBankDiscoveryStarted(false);
      setLegacyBankMigrations([]);
      setExpandedBankPlayers([]);
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
    setAuditLoading(true);
    setAuditError(null);
    setProgressAuditError(null);
    const [settingsResult, progressResult] = await Promise.allSettled([
      adminApi(`/admin/craft-plan/audit?limit=100&planId=${encodeURIComponent(planId)}`),
      adminApi(`/admin/craft-plan/progress-audit?planId=${encodeURIComponent(planId)}`),
    ]);
    if (settingsResult.status === "fulfilled") {
      setAuditRows(Array.isArray(settingsResult.value.auditLog) ? settingsResult.value.auditLog : []);
    } else {
      setAuditError(settingsResult.reason instanceof Error ? settingsResult.reason.message : String(settingsResult.reason));
    }
    if (progressResult.status === "fulfilled") {
      setProgressAudit(progressResult.value);
    } else {
      setProgressAuditError(progressResult.reason instanceof Error ? progressResult.reason.message : String(progressResult.reason));
    }
    setAuditLoading(false);
    setAuditLoaded(true);
  }, [adminApi, planId]);

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
    void load();
  }, [open, load]);

  React.useEffect(() => {
    if (open) return;
    loadRequestId.current += 1;
    setState(null);
    setConfig(emptyConfig());
    setBusy(false);
    setOperation(null);
    setStatus(null);
    setError(null);
    setActiveTab("targets");
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
    setBankSearch("");
    setTrackedBanksOnly(false);
    setSavedConfigSignature("");
    setRefreshConfirmationOpen(false);
  }, [open]);

  React.useEffect(() => {
    if (!open || activeTab !== "audit" || auditLoaded || auditLoading) return;
    void loadAudit();
  }, [open, activeTab, auditLoaded, auditLoading, loadAudit]);

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
      setConfig((current) => {
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
    if (open && activeTab === "banks") setBankDiscoveryStarted(true);
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
    setConfig((current) => ({ ...current, ...patch }));
  }

  function requestRefresh() {
    if (draftDirty) {
      setRefreshConfirmationOpen(true);
      return;
    }
    void load("refreshing");
  }

  function updateSource(kind: "storageContainerIds" | "playerIds" | "craftPlayerIds" | "bankPlayerIds" | "bankContainerIds" | "deployableContainerIds", id: string, checked: boolean) {
    setConfig((current) => {
      const currentValues = current.sourceRules[kind] ?? [];
      const nextValues = checked ? [...new Set([...currentValues, id])] : currentValues.filter((value) => value !== id);
      return { ...current, sourceRules: { ...current.sourceRules, [kind]: nextValues } };
    });
  }

  function addTargets(items: AnyRecord[], message: string) {
    setConfig((current) => ({ ...current, targets: mergeTargets(current.targets, items) }));
    setStatus(message);
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
      setConfig((current) => ({ ...current, targets: [...current.targets, ...additions] }));
      setStatus(`Added ${added} T${preset.tier} workstations${existing ? `; ${existing} already tracked` : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setOperation(null);
    }
  }

  async function save() {
    setBusy(true);
    setOperation("saving");
    setError(null);
    setStatus(null);
    try {
      const submittedConfig = {
        ...config,
        sourceRules: finalizeLegacyBankMigrations(config.sourceRules, legacyBankMigrations),
      };
      const revision = Number(state?.planRecord?.revision ?? 0);
      const path = ownerManaged ? `/user/craft-plans/${encodeURIComponent(planId)}` : `/admin/craft-plans/${encodeURIComponent(planId)}`;
      await adminApi(path, { method: "PUT", body: JSON.stringify({ name: submittedConfig.name, config: submittedConfig, expectedRevision: revision }) });
      await load("refreshing");
      setRefreshConfirmationOpen(false);
      setStatus("Craft plan saved.");
      setAuditLoaded(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setOperation(null);
    }
  }

  if (!open) return null;

  const storageSources = state?.sources?.storage ?? [];
  const playerSources = state?.sources?.players ?? [];
  const deployableSources = state?.sources?.deployables ?? [];
  const deployableGroups = groupDeployablesByPlayer(deployableSources);
  const tierPresets = state?.sources?.tierPresets ?? [];
  const workstationPresets = state?.sources?.workstationPresets ?? [];
  const routeSteps = Array.isArray(state?.plan?.steps) ? state.plan.steps : [];
  const trackedBankIds = new Set(config.sourceRules.bankContainerIds.map(String));
  const bankGroups = buildCraftPlanBankGroups({ players: playerSources, bankLoads, trackedBankIds: config.sourceRules.bankContainerIds, search: bankSearch, trackedOnly: trackedBanksOnly });
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
          <label className="field craft-plan-name-field"><span>Plan name</span><input value={config.name} onChange={(event) => patchConfig({ name: event.target.value })} /></label>
          <label className="craft-plan-public-toggle"><input type="checkbox" checked={config.enabled !== false} onChange={(event) => patchConfig({ enabled: event.target.checked })} /><span><strong>Public board</strong><small>{config.enabled !== false ? "Visible to users" : "Hidden from users"}</small></span></label>
          <div className="craft-plan-manager-buttons">
            <button className="toolbar-button" type="button" onClick={requestRefresh} disabled={busy}>{operation === "refreshing" ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCw size={14} />} {operation === "refreshing" ? "Refreshing…" : "Refresh"}</button>
            <button className="toolbar-button primary" type="button" onClick={save} disabled={busy}>{operation === "saving" ? <LoaderCircle className="is-spinning" size={14} /> : <Save size={14} />} {operation === "saving" ? "Saving…" : "Save Plan"}</button>
          </div>
        </div>
        {refreshConfirmationOpen ? <div className="alert warning craft-plan-refresh-confirmation" role="group" aria-labelledby="craft-plan-refresh-confirmation-title"><div><strong id="craft-plan-refresh-confirmation-title">Discard unsaved changes?</strong><span>Refreshing reloads the last saved plan and replaces your current edits.</span></div><div><button className="toolbar-button" type="button" onClick={() => setRefreshConfirmationOpen(false)}>Keep editing</button><button className="toolbar-button danger" type="button" onClick={() => { setRefreshConfirmationOpen(false); void load("refreshing"); }}>Discard and refresh</button></div></div> : null}
        {pendingLabel ? <div className="craft-plan-manager-pending" role="status" aria-live="polite"><LoaderCircle className="is-spinning" size={16} /><span>{pendingLabel}</span></div> : null}
        {error ? <div className="alert error">{error}</div> : null}
        {status ? <div className="alert success">{status}</div> : null}
        <nav className="craft-plan-manager-tabs" aria-label="Craft plan editor sections">
          {[
            ["targets", <Target size={15} />, "Targets"],
            ["sources", <Package size={15} />, "Storage"],
            ["players", <Package size={15} />, "Players & Deployables"],
            ["banks", <Package size={15} />, "Banks"],
            ["routes", <Route size={15} />, "Routes"],
            ["buffers", <SlidersHorizontal size={15} />, "Buffers"],
            ...(personal ? [] : [["audit", <History size={15} />, "Audit"]]),
          ].map(([id, icon, label]) => <button key={String(id)} type="button" className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id as ManagerTab)}>{icon}{label}</button>)}
        </nav>
        <div className="craft-plan-manager-body" aria-busy={busy}>
          {operation === "loading" && !state ? <div className="craft-plan-manager-loading"><LoaderCircle className="is-spinning" size={28} /><strong>Loading craft plan</strong><span>Fetching targets, inventories, players, deployables, routes, and presets.</span></div> : null}
          {activeTab === "targets" ? <section className="craft-plan-manager-panel">
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
                  <label className="field compact-field"><span>Quantity</span><input type="number" min={1} value={target.quantity ?? 1} onChange={(event) => setConfig((current) => ({ ...current, targets: current.targets.map((row, i) => i === index ? { ...row, quantity: Math.max(1, Math.ceil(Number(event.target.value) || 1)) } : row) }))} /></label>
                  <button className="toolbar-button danger" type="button" onClick={() => setConfig((current) => {
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

          {activeTab === "sources" ? <section className="craft-plan-manager-panel"><h3>Settlement storage</h3><p className="legend">Inventory cards show the largest visible item stacks from each live Relay storage container.</p><div className="craft-plan-source-grid">{storageSources.length ? storageSources.map((source: AnyRecord) => sourceCard(source, config.sourceRules.storageContainerIds.includes(String(source.sourceId)), (checked) => updateSource("storageContainerIds", String(source.sourceId), checked))) : <p className="legend">No settlement storage sources found.</p>}</div></section> : null}

          {activeTab === "players" ? <section className="craft-plan-manager-panel"><h3>Players & deployables</h3><p className="legend">Choose which player inventories and active crafts count toward the plan. Individual bank tracking is managed from the Banks tab.</p><div className="craft-plan-source-grid compact">{playerSources.length ? playerSources.map((source: AnyRecord) => playerSourceCard(source, config.sourceRules.playerIds.includes(String(source.playerId)), config.sourceRules.craftPlayerIds.includes(String(source.playerId)), (checked) => updateSource("playerIds", String(source.playerId), checked), (checked) => updateSource("craftPlayerIds", String(source.playerId), checked))) : <p className="legend">No settlement players found.</p>}</div><h4>Deployables</h4>{deployableGroups.length ? <div className="craft-plan-deployable-groups">{deployableGroups.map((group) => <section className="craft-plan-deployable-group" key={group.playerId}><header><strong>{group.playerName}</strong><small>{formatNumber(group.sources.length, 0)} deployables</small></header><div className="craft-plan-source-grid compact">{group.sources.map((source: AnyRecord) => sourceCard({ ...source, label: String(source.label ?? source.containerKind ?? "Deployable storage") }, config.sourceRules.deployableContainerIds.includes(String(source.sourceId)), (checked) => updateSource("deployableContainerIds", String(source.sourceId), checked)))}</div></section>)}</div> : <p className="legend">No deployables discovered for the selected players yet.</p>}</section> : null}

          {activeTab === "banks" ? <section className="craft-plan-manager-panel craft-plan-bank-panel">
            <div className="split-header"><div><h3>Player banks</h3><p className="legend">Track only the individual banks whose stock should count toward this plan. Empty untracked banks are hidden.</p></div><small>{formatNumber(trackedBankCount, 0)} tracked</small></div>
            <div className="craft-plan-bank-toolbar">
              <label className="search"><Search size={16} /><input value={bankSearch} onChange={(event) => setBankSearch(event.target.value)} placeholder="Search players, banks, or settlements" aria-label="Search player banks" /></label>
              <label className="craft-plan-bank-filter"><input type="checkbox" checked={trackedBanksOnly} onChange={(event) => setTrackedBanksOnly(event.target.checked)} /><span>Tracked only</span></label>
              <span className="craft-plan-bank-progress" role="status" aria-live="polite">{loadedBankPlayers < playerSources.length ? <><LoaderCircle className="is-spinning" size={14} /> Discovering banks {loadedBankPlayers}/{playerSources.length}</> : `${loadedBankPlayers} players checked`}</span>
            </div>
            {bankGroups.length ? <div className="craft-plan-bank-groups">{bankGroups.map((group: AnyRecord) => {
              const expanded = Boolean(bankSearch.trim()) || expandedBankPlayers.includes(group.playerId);
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

          {activeTab === "routes" ? <section className="craft-plan-manager-panel"><div className="split-header"><div><h3>Recipe routes in use</h3><p className="legend">These are the recipes currently pulled into the plan from your targets. Change a dropdown, then save the plan to recalculate needed materials.</p></div><small>{routeSteps.length ? `${routeSteps.length} recipe steps` : "No recipe steps"}</small></div>{routeSteps.length ? <div className="craft-plan-route-overview-list">{routeSteps.map((step: AnyRecord, index: number) => { const outputKey = routeOutputKey(step); const alternatives = Array.isArray(step.alternatives) ? step.alternatives : []; const selectedRecipeId = String(config.routeOverrides[outputKey] ?? step.selectedRecipeId ?? ""); return <article className="craft-plan-route-overview-card" key={`${outputKey}:${step.id ?? index}`}><div><strong><ItemLabel item={step.output ?? step} /></strong><small>{step.recipeName ?? "Selected recipe"}{step.buildingName ? ` - ${step.buildingName}` : ""}</small></div><label className="field compact-field"><span>Recipe</span><select value={selectedRecipeId} disabled={alternatives.length <= 1} onChange={(event) => setConfig((current) => ({ ...current, routeOverrides: { ...current.routeOverrides, [outputKey]: event.target.value } }))}>{alternatives.length ? alternatives.map((recipe: AnyRecord) => <option value={recipe.id} key={recipe.id}>{routeOptionLabel(recipe)}</option>) : <option value={selectedRecipeId}>{step.recipeName ?? "Default recipe"}</option>}</select></label>{config.routeOverrides[outputKey] ? <button className="toolbar-button danger" type="button" onClick={() => setConfig((current) => { const next = { ...current.routeOverrides }; delete next[outputKey]; return { ...current, routeOverrides: next }; })}><Trash2 size={14} /> Reset</button> : <span className="legend">Default</span>}</article>; })}</div> : <p className="legend">Add targets and save the plan to see the recipe chain used for the current goals.</p>}</section> : null}

          {activeTab === "buffers" ? <section className="craft-plan-manager-panel"><h3>Chance-drop safety buffers</h3><p className="legend">Add or edit a buffer from an item’s “How to get this” panel. Buffers increase planned gathering only; they do not change API drop rates or counted stock.</p>{Object.entries(config.multipliers).length ? Object.entries(config.multipliers).map(([key, value]) => { const item = [...config.targets, ...(Array.isArray(state?.plan?.materials) ? state.plan.materials : [])].find((candidate) => itemKey(candidate) === key); return <div className="admin-craft-plan-row" key={key}><strong>{item?.name ?? key}</strong><span>{formatNumber((value.multiplier - 1) * 100, 1)}% extra{value.note ? ` - ${value.note}` : ""}</span><button className="toolbar-button danger" type="button" onClick={() => setConfig((current) => { const next = { ...current.multipliers }; delete next[key]; return { ...current, multipliers: next }; })}><Trash2 size={14} /> Remove</button></div>; }) : <p className="legend">No chance-drop safety buffers are configured.</p>}</section> : null}
          {activeTab === "audit" ? <section className="craft-plan-manager-panel craft-plan-audit-panel">
            <div className="split-header"><div><h3>Audit history</h3><p className="legend">Progress calculations, source changes, and saved configuration changes, newest first.</p></div>{auditError || progressAuditError ? <button className="toolbar-button" type="button" onClick={() => void loadAudit()} disabled={auditLoading}><RefreshCw size={14} /> Retry audit</button> : null}</div>
            {auditLoading ? <div className="craft-plan-audit-state" role="status"><LoaderCircle className="is-spinning" size={22} /><strong>Loading audit history</strong></div> : null}
            {!auditLoading ? <section className="craft-plan-progress-diagnostics">
              <div className="split-header">
                <div><h4>Progress diagnostics</h4><p className="legend">A 14-day record of the inputs and changes behind the planner percentage.</p></div>
                <div className="craft-plan-progress-downloads" aria-label="Download progress diagnostics">
                  {["24h", "3d", "7d", "all"].map((range) => <button className="toolbar-button" type="button" onClick={() => void downloadProgressAudit(range)} disabled={auditDownloadRange != null} key={range}>{auditDownloadRange === range ? <LoaderCircle className="is-spinning" size={14} /> : <Download size={14} />} Download diagnostics ({range})</button>)}
                </div>
              </div>
              {progressAuditError ? <div className="alert error">Progress diagnostics could not be loaded: {progressAuditError}</div> : null}
              {auditDownloadError ? <div className="alert error">Diagnostics download failed: {auditDownloadError}</div> : null}
              {!progressAuditError && progressAudit ? <>
                <div className="craft-plan-progress-audit-summary craft-plan-progress-audit-stats">
                  <article><small>Confirmed progress</small><strong>{progressAudit.status?.confirmedCompletion == null ? "—" : `${formatNumber(progressAudit.status.confirmedCompletion, 1)}%`}</strong><span>Stock and guaranteed active output</span></article>
                  <article><small>Projected progress</small><strong>{progressAudit.status?.projectedCompletion == null ? "—" : `${formatNumber(progressAudit.status.projectedCompletion, 1)}%`}</strong><span>Includes expected active-craft output</span></article>
                  <article><small>Last successful calculation</small><strong>{progressAudit.status?.lastSuccessfulAt ? timeAgo(progressAudit.status.lastSuccessfulAt) : "Not recorded"}</strong><span>{progressAudit.status?.lastSuccessfulAt ? dateLabel(progressAudit.status.lastSuccessfulAt) : "Waiting for a complete source refresh"}</span></article>
                  <article><small>Baseline revision</small><strong>{progressAudit.status?.baselineRevision ? String(progressAudit.status.baselineRevision).slice(0, 12) : "Not recorded"}</strong><span>Changes when plan math inputs change</span></article>
                  <article><small>Full checkpoints</small><strong>{formatNumber(progressAudit.status?.snapshotCount ?? 0, 0)}</strong><span>At least every 6 hours or after a baseline change</span></article>
                  <article><small>Audit storage</small><strong>{formatStoredBytes(progressAudit.status?.storedBytes)}</strong><span>{formatNumber(progressAudit.status?.eventCount ?? 0, 0)} events · {formatNumber(progressAudit.status?.retentionDays ?? 14, 0)}-day retention</span></article>
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
              </> : null}
            </section> : null}
            <div className="craft-plan-progress-event-header"><h4>Saved plan changes</h4><small>Visibility and counted source configuration</small></div>
            {!auditLoading && auditError ? <div className="alert error">Audit history could not be loaded: {auditError}</div> : null}
            {!auditLoading && !auditError && !auditRows.length ? <div className="craft-plan-audit-state"><History size={24} /><strong>No craft plan changes have been recorded yet.</strong><span>New saves will appear here when visibility or counted sources change.</span></div> : null}
            {!auditLoading && !auditError && auditRows.length ? <div className="craft-plan-audit-list">
              {auditRows.map((row) => <article className="craft-plan-audit-entry" key={row.id}>
                <div className="craft-plan-audit-meta"><strong>{row.username || "system"}</strong><time dateTime={row.occurredAt} title={dateLabel(row.occurredAt)}>{timeAgo(row.occurredAt)}</time></div>
                <div className="craft-plan-audit-changes">
                  {Array.isArray(row.changes) && row.changes.length ? row.changes.map((change: AnyRecord, index: number) => <div className={`craft-plan-audit-change ${change.enabled ? "is-enabled" : "is-disabled"}`} key={`${change.category}:${change.entityId}:${index}`}>{change.enabled ? <CheckCircle2 size={16} /> : <MinusCircle size={16} />}<span><strong>{CRAFT_PLAN_AUDIT_CATEGORY_LABELS[String(change.category)] ?? "Tracked source"}</strong>{change.label}</span><em>{change.enabled ? "enabled" : "disabled"}</em></div>) : null}
                  {row.otherSettingsChanged ? <div className="craft-plan-audit-other"><SlidersHorizontal size={16} /><span><strong>Other plan settings changed</strong>Targets, routes, names, sections, or buffers were updated.</span></div> : null}
                  {(!Array.isArray(row.changes) || !row.changes.length) && !row.otherSettingsChanged ? <p className="legend">Legacy plan save; detailed changes were not recorded.</p> : null}
                </div>
              </article>)}
            </div> : null}
          </section> : null}
        </div>
        </fieldset>
    </Dialog>
  );
}
