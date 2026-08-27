import React from "react";
import "../../styles/setup-workflow.css";
import "../../styles/admin.css";
import "../../styles/server-health.css";
import "../../styles/discord-admin.css";
import "../../styles/bot-dashboard.css";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bell,
  Box,
  Building2,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  CircleHelp,
  Clock,
  Command,
  Crown,
  Database,
  FileText,
  KeyRound,
  Lock,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings,
  Shield,
  Star,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { BotSection } from "../bot/BotSectionNav";
import {
  BotSectionNav,
  DiscordChannelsSection,
  DiscordColourRolesSection,
  DiscordCraftWatchRolesSection,
  DiscordDiagnosticsPanel,
  DiscordMemberRecordsSection,
  DiscordModerationSection,
  DiscordNotificationsSection,
  DiscordRoleManagerSection,
  DiscordRolePanelsSection,
  DiscordSafetySection,
  DiscordSetupSection,
  DiscordTestsPanel,
  DiscordYouTubeMonitorSection,
} from "../bot/lazySections";
import { TablePanel, ToolbarButton } from "../main/AppChrome";
import { BotMobileSectionNav } from "../bot/BotMobileSectionNav";
import { BotHealthSummary } from "../bot/BotHealthSummary";
import { deriveBotHealth } from "../bot/botHealth";
import { AdminPopupsSection } from "./AdminPopupsSection";
import { AdminConfigurationNav } from "./AdminConfigurationNav";
import { AdminAccessSection } from "./AdminAccessSection";
import { loadAdminSettlementMembers } from "./adminSettlementMembers";
import { AdminAnalyticsSection } from "./AdminAnalyticsSection";
import { AdminCraftPlanSection } from "./AdminCraftPlanSection";
import { AdminDataSection } from "./AdminDataSection";
import { AdminEmpireMembershipSection } from "./AdminEmpireMembershipSection";
import type { EmpireMembershipAdminView } from "./AdminEmpireMembershipSection";
import { ServerHealthSection } from "./ServerHealthSection";
import { RarityBadge, TierBadge, TrackedOwnerName } from "../main/Badges";
import { DashboardMetric } from "../main/DashboardWidgets";
import { DataTable } from "../main/DataTable";
import { ItemIcon, ItemLabel, TierMaterialIcon } from "../main/ItemDisplay";
import { SearchBox } from "../main/SearchBox";
import { Info, MiniStat, Stat } from "../main/Stats";
import {
  DEFAULT_COLOUR_ROLES,
  DEFAULT_CRAFT_CHANNELS,
  DEFAULT_CRAFT_ROLES,
  DEFAULT_DISCORD_CHANNELS,
  DEFAULT_DISCORD_PRESENCE,
  DEFAULT_NOTIFICATION_CHANNELS,
  DEFAULT_ROLE_PANELS,
  DEFAULT_SETTINGS,
  DEFAULT_WELCOME_FLOW,
  DISCORD_CHANNEL_FIELDS,
} from "../../settingsDefaults";
import { usePersistedState } from "../../hooks/usePersistedState";
import { BOT_SECTION_STORAGE_KEY, restoreBotSection } from "../bot/botSectionState";
import {
  adminSearchWithTab,
  botSearchWithSection,
  parseAdminLocation,
  parseBotSectionLocation,
  type AdminTab,
  type ConfigurationSection,
} from "./adminNavigationState";
import { shouldConfirmConfigurationNavigation } from "./adminConfigurationState";
import { applyBrandingSettingsResult, applyConfirmedSettingsSave, syncDraftFromPersistedSettings } from "./adminSettingsSave";
import { AdminShellHeader } from "./AdminShellHeader";
import { AdminSectionNavigation } from "./AdminSectionNavigation";
import { AdminStatusOverview } from "./AdminStatusOverview";
import { scheduledJobTimingLabel } from "./adminStatusPresentation";
import { ConfirmAdminActionDialog } from "./ConfirmAdminActionDialog";
import type { AdminActionConfirmation } from "./adminActionConfirmation";
import { adminLoadingStage } from "./adminLoadingState";
import {
  buildConstructionProjects,
  toNumber,
  type AnyRecord,
} from "../../main-app-data";
import { dateLabel, formatCompactNumber, formatDuration, formatNumber, shortDateLabel, timeAgo, timestampMs } from "../../utils/format";
import { mapWithBrowserConcurrency } from "../../utils/concurrency";
import { getTrackedOwnerName } from "../../utils/ownership";
import { isMarketableItem, playerToolbeltTools } from "../../utils/items";
import { buyOrderAgeDays, normalizeBuyOrder, sortBuyOrdersByBestPrice } from "../../utils/marketOrders";
import { unique } from "../../utils/array";
import { applyMemberTrackingFilter, memberDisplayName, memberTrackingId } from "../../utils/memberTracking";
import { discordColorToHex, hexToDiscordColor, normalizeAppSettings, uniqueKey } from "../../utils/appSettings";
import { listingTrackingKey } from "../../utils/displayHelpers";
import { NAV } from "../../navigation";
import { ACCESS_RULE_MODES, normalizeAccessControlConfig, pageAccessTargets, tabAccessTargets, type AccessControlConfig, type AccessRuleMode } from "../../access/accessControl.mjs";
import { PROFESSION_IDS, skillNameFromRows, skillTier, SKILL_IDS, SKILL_NAMES, TOOL_TAG_BY_TYPE } from "../../utils/professions";
import type {
  ActiveRegion,
  AppSettings,
  AppUser,
  ColourRoleDefinition,
  DiscordPresence,
  DiscordRoleOption,
  DiscordRolePanel,
  DiscordSettings,
  DiscordWelcomeFlow,
} from "../../types/settings";
import type { ActivePanel } from "../../types/app";
import { bytesLabel, collectorStatusValue, discordAuditActionLabel, discordAuditUserLabel, discordChangeLabel, discordSnowflakeDate, scheduledJobProgressText } from "./adminDisplay";
import { claimPendingAction, releasePendingAction } from "../../utils/pendingActions";

const LOCAL_API = "/api/local";

class FallbackMemberLoadError extends Error {}

type AdminTabMeta = {
  key: AdminTab;
  label: string;
  description: string;
};

type AdminTabGroup = {
  label: string;
  tabs: AdminTabMeta[];
};

function normalizeDiscordEmojiName(value: string) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function autoMatchCraftEmojis(craftRoleKeys: readonly string[], discoveredEmojis: AnyRecord[] = []): Record<string, string> {
  return Object.fromEntries(craftRoleKeys.map((key) => {
    const match = discoveredEmojis.find((emoji) => normalizeDiscordEmojiName(String(emoji.name ?? "")) === key && String(emoji.mention ?? "").trim());
    return match ? [key, String(match.mention).trim()] : null;
  }).filter(Boolean) as [string, string][]);
}


const ADMIN_TAB_GROUPS: AdminTabGroup[] = [
  {
    label: "Operations",
    tabs: [
      { key: "status", label: "Status", description: "Health, reconciliation, jobs, and endpoint checks" },
      { key: "server-health", label: "Server Health", description: "Owner-only VPS performance, services, trends, and logs" },
      { key: "configuration", label: "Configuration", description: "Settlement defaults, privacy, reconciliation, and branding" },
      { key: "diagnostics", label: "Diagnostics", description: "Browser and map troubleshooting data" },
    ],
  },
  {
    label: "Insights",
    tabs: [
      { key: "analytics", label: "Analytics", description: "Usage, security, location, and request logs" },
      { key: "empire-membership", label: "Empire Membership", description: "Observed joins, confirmed departures, and current empire members" },
      { key: "database", label: "Database", description: "SQLite inspection and exports" },
    ],
  },
  {
    label: "Access",
    tabs: [
      { key: "users", label: "Administrators", description: "Admin roles, status, and sessions" },
      { key: "accounts", label: "Linked Accounts", description: "Discord sign-ins and character link approvals" },
      { key: "audit", label: "Audit", description: "Admin action and sign-in history" },
    ],
  },
  {
    label: "Maintenance",
    tabs: [
      { key: "backups", label: "Backups", description: "Database backups and retention maintenance" },
    ],
  },
];

const BOT_CONSOLE_TAB_GROUPS: AdminTabGroup[] = [
  {
    label: "Bot Console",
    tabs: [
      { key: "discord", label: "Discord Bot Control", description: "Manage bot setup, notifications, roles, tools, and diagnostics" },
      { key: "accounts", label: "Linked Accounts", description: "Approve Discord-linked BitCraft characters" },
    ],
  },
];

/**
 * Admin console for installation-wide settings and diagnostics.
 *
 * Admin-only mutations, scheduled job controls, database inspection, analytics,
 * and Discord/bot configuration all enter through this component. The server
 * still enforces permissions; this component is only the management UI.
 */
export type AdminPanelProps = {
  settings: AppSettings;
  members?: AnyRecord[];
  onSettingsSaved: (settings: AppSettings) => void;
  onClaimSettingsSaved?: (previousClaimId: string, settings: AppSettings) => void;
  botOnly?: boolean;
  headingLevel?: 1 | 2;
  onAuthChanged?: (auth: AnyRecord) => void;
  publicAccount?: AnyRecord | null;
  resolvedAuth?: AnyRecord;
};

export function AdminPanel({
  settings,
  members = [],
  onSettingsSaved,
  onClaimSettingsSaved,
  botOnly = false,
  headingLevel = 2,
  onAuthChanged,
  publicAccount,
  resolvedAuth,
}: AdminPanelProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const [auth, setAuth] = React.useState<AnyRecord | null>(() => resolvedAuth ?? null);
  const [authLoading, setAuthLoading] = React.useState(resolvedAuth === undefined);
  const [authLoaderDelayElapsed, setAuthLoaderDelayElapsed] = React.useState(false);
  const initialAdminLocation = React.useMemo(() => parseAdminLocation(window.location.search), []);
  const hasExplicitInitialAdminTab = React.useMemo(() => new URLSearchParams(window.location.search).has("admin"), []);
  const initialAdminTab = botOnly && !["discord", "accounts"].includes(initialAdminLocation.tab) ? "discord" : initialAdminLocation.tab;
  const [tab, setStoredTab] = usePersistedState<AdminTab>(
    botOnly ? "bot.adminTab" : "admin.tab",
    initialAdminTab,
    { preferInitialValue: hasExplicitInitialAdminTab },
  );
  const [configurationSection, setStoredConfigurationSection] = React.useState<ConfigurationSection>(initialAdminLocation.configurationSection);
  const [storedBotSection, setBotSection] = usePersistedState<BotSection>(BOT_SECTION_STORAGE_KEY, parseBotSectionLocation(window.location.search));
  const botSection = restoreBotSection(storedBotSection);
  const [message, setMessage] = React.useState<string | null>(null);
  const [messageKind, setMessageKind] = React.useState<"success" | "error" | "info">("info");
  const [actionConfirmation, setActionConfirmation] = React.useState<AdminActionConfirmation | null>(null);
  const pendingActionsRef = React.useRef(new Set<string>());
  const [pendingActions, setPendingActions] = React.useState<Set<string>>(() => new Set());
  const [draft, setDraft] = React.useState<AppSettings>(settings);
  const persistedSettingsRef = React.useRef(settings);
  const hasUnsavedSettings = React.useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);
  const requestDiscardSettings = React.useCallback((onDiscard: () => void) => {
    if (!hasUnsavedSettings) {
      onDiscard();
      return;
    }
    setActionConfirmation({
      title: "Discard unsaved configuration changes?",
      target: "Current configuration draft",
      impact: "Changes made since the last save will be lost before navigation continues.",
      reversible: false,
      confirmLabel: "Discard changes",
      tone: "warning",
      onConfirm: () => { setDraft(settings); onDiscard(); },
    });
  }, [hasUnsavedSettings, settings]);
  const setTab = React.useCallback((next: AdminTab | ((current: AdminTab) => AdminTab)) => {
    const resolved = typeof next === "function" ? next(tab) : next;
    if (tab === "configuration" && resolved !== tab) {
      requestDiscardSettings(() => setStoredTab(resolved));
      return;
    }
    setStoredTab(resolved);
  }, [requestDiscardSettings, setStoredTab, tab]);
  const selectConfigurationSection = React.useCallback((next: ConfigurationSection) => {
    if (shouldConfirmConfigurationNavigation({ dirty: hasUnsavedSettings, current: configurationSection, next })) {
      requestDiscardSettings(() => setStoredConfigurationSection(next));
      return;
    }
    setStoredConfigurationSection(next);
  }, [configurationSection, hasUnsavedSettings, requestDiscardSettings]);
  const [status, setStatus] = React.useState<AnyRecord | null>(null);
  const [scheduledJobs, setScheduledJobs] = React.useState<AnyRecord | null>(null);
  const [expandedScheduledJobKey, setExpandedScheduledJobKey] = React.useState<string | null>(null);
  const [scheduledJobDrafts, setScheduledJobDrafts] = React.useState<Record<string, AnyRecord>>({});
  const [diagnostics, setDiagnostics] = React.useState<AnyRecord[]>([]);
  const [mapUrlLog, setMapUrlLog] = usePersistedState<AnyRecord[]>("diagnostics.mapUrlLog", []);
  const [tables, setTables] = React.useState<AnyRecord[]>([]);
  const [selectedTable, setSelectedTable] = usePersistedState("admin.database.selectedTable", "");
  const [tableResult, setTableResult] = React.useState<AnyRecord>({ table: "", rows: [], columns: [], total: 0, offset: 0, limit: 50 });
  const [tableSearch, setTableSearch] = React.useState("");
  const [tableOffset, setTableOffset] = React.useState(0);
  const [users, setUsers] = React.useState<AnyRecord[]>([]);
  const [linkedAccounts, setLinkedAccounts] = React.useState<AppUser[]>([]);
  const [fallbackMembers, setFallbackMembers] = React.useState<AnyRecord[]>([]);
  const [membersLoading, setMembersLoading] = React.useState(false);
  const [membersError, setMembersError] = React.useState<string | null>(null);
  const fallbackMembersRequest = React.useRef(0);
  const [accessControlState, setAccessControlState] = React.useState<{ config: AccessControlConfig; accounts: AppUser[] } | null>(null);
  const [newUser, setNewUser] = React.useState({ discordId: "", displayName: "", role: "admin" });
  const [auditData, setAuditData] = React.useState<AnyRecord>({ auditLog: [], logins: [] });
  const [auditFilter, setAuditFilter] = React.useState("");
  const [auditVisibleCount, setAuditVisibleCount] = React.useState(30);
  const [popupDiagnostics, setPopupDiagnostics] = React.useState<AnyRecord | null>(null);
  const [backups, setBackups] = React.useState<AnyRecord[]>([]);
  const [analyticsDays, setAnalyticsDays] = React.useState("30");
  const [analyticsData, setAnalyticsData] = React.useState<AnyRecord | null>(null);
  const [empireMembershipData, setEmpireMembershipData] = React.useState<EmpireMembershipAdminView | null>(null);
  const [visitorSecurityData, setVisitorSecurityData] = React.useState<AnyRecord | null>(null);
  const [securityEventSearch, setSecurityEventSearch] = React.useState("");
  const [securityEventPage, setSecurityEventPage] = React.useState(1);
  const [securityEventPageSize, setSecurityEventPageSize] = React.useState(50);
  const [discordDiscovery, setDiscordDiscovery] = React.useState<AnyRecord | null>(null);
  const [discordToolResults, setDiscordToolResults] = React.useState<Record<string, AnyRecord | null>>({});
  const [expandedRoleOption, setExpandedRoleOption] = React.useState<string | null>(null);
  const [roleDraft, setRoleDraft] = React.useState({ name: "", color: "#5865f2", hoist: false, mentionable: false });
  const [announcementDraft, setAnnouncementDraft] = React.useState({ channelId: "", title: "", message: "" });
  const [pinnedDraft, setPinnedDraft] = React.useState({ channelId: "", messageId: "", title: "", message: "" });
  const [eventDraft, setEventDraft] = React.useState({ name: "", description: "", location: "Discord", startTime: "", endTime: "" });
  const [moderationDraft, setModerationDraft] = React.useState({ userId: "", reason: "", timeoutMinutes: "60", deleteMessageSeconds: "0", channelId: "", purgeLimit: "25", unbanUserId: "" });
  const [safetyDraft, setSafetyDraft] = React.useState({ blockedWords: "", ruleName: "Timbersteel keyword filter", slowmodeSeconds: "10", lockdownChannelId: "", nicknamePattern: "^[A-Za-z0-9 _.-]{2,32}$" });
  const [recordsDraft, setRecordsDraft] = React.useState({ userId: "", reason: "", note: "" });
  const [pollDraft, setPollDraft] = React.useState({ channelId: "", title: "", options: "" });
  const [rsvpDraft, setRsvpDraft] = React.useState({ channelId: "", title: "", description: "" });
  const [embedDraft, setEmbedDraft] = React.useState({ channelId: "", title: "", description: "", color: "#f0c64f" });
  const [commandDraft, setCommandDraft] = React.useState({ name: "", description: "", response: "" });
  const [customCommands, setCustomCommands] = React.useState<AnyRecord[]>([]);
  const [discordDiagnosticsFilter, setDiscordDiagnosticsFilter] = React.useState("all");
  const discordToolResult = discordToolResults[botSection] ?? null;
  const adminRoles: Record<string, string> = auth?.roles ?? { owner: "Owner", admin: "Administrator", "discord-manager": "Discord Manager", moderator: "Moderator", viewer: "Viewer" };
  const canManageAdmins = Boolean(auth?.user?.permissions?.includes("*") || auth?.user?.permissions?.includes("users.manage"));
  const setAdminAuthState = React.useCallback((next: AnyRecord) => {
    setAuth(next);
    onAuthChanged?.(next);
  }, [onAuthChanged]);
  const setDiscordToolResult = React.useCallback((result: AnyRecord | null) => {
    setDiscordToolResults((current) => ({ ...current, [botSection]: result }));
  }, [botSection]);

  // Centralise admin API calls so CSRF headers, JSON parsing, and readable error
  // handling stay consistent across a large number of admin tabs.
  async function api(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers);
    headers.set("content-type", "application/json");
    if (options.method && options.method !== "GET" && auth?.csrfToken) headers.set("x-csrf-token", String(auth.csrfToken));
    const response = await fetch(`${LOCAL_API}${path}`, {
      ...options,
      headers,
    });
    const text = await response.text();
    let body: AnyRecord = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`Admin request returned an unreadable response (HTTP ${response.status}).`);
      }
    }
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }

  const isBusyAction = React.useCallback((key: string) => pendingActions.has(key), [pendingActions]);
  const busyButtonClass = React.useCallback((key: string, className = "toolbar-button") => `${className}${pendingActions.has(key) ? " is-loading" : ""}`, [pendingActions]);

  async function run(task: () => Promise<unknown>, success: string | undefined, busyKey: string) {
    if (!claimPendingAction(pendingActionsRef.current, busyKey)) return;
    setPendingActions(new Set(pendingActionsRef.current));
    setMessage(null);
    setMessageKind("info");
    try {
      await task();
      if (success) {
        setMessageKind("success");
        setMessage(success);
      }
    } catch (error) {
      if (error instanceof FallbackMemberLoadError) return;
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      releasePendingAction(pendingActionsRef.current, busyKey);
      setPendingActions(new Set(pendingActionsRef.current));
    }
  }

  async function refreshStatus() {
    setStatus(await api("/admin/status"));
  }

  async function collectNowWithLiveStatus() {
    // Manual reconciliation can run for long enough that a static button looks
    // broken. Polling status while it runs gives admins live feedback without
    // delaying committed Relay generations.
    let timer: number | null = window.setInterval(() => {
      void refreshStatus().catch(() => undefined);
    }, 1000);
    try {
      await api("/admin/poll", { method: "POST", body: "{}" });
    } finally {
      if (timer != null) window.clearInterval(timer);
      timer = null;
      await refreshStatus();
    }
  }


  async function refreshScheduledJobs() {
    setScheduledJobs(await api("/admin/jobs"));
  }


  function scheduledJobConfig(job: AnyRecord) {
    return scheduledJobDrafts[String(job.key)] ?? job.scheduleConfig ?? { frequency: "daily", time: "00:00", dayOfWeek: 1, dayOfMonth: 1 };
  }

  function updateScheduledJobDraft(job: AnyRecord, patch: AnyRecord) {
    const key = String(job.key);
    setScheduledJobDrafts((current) => ({ ...current, [key]: { ...scheduledJobConfig(job), ...patch } }));
  }

  async function refreshTables() {
    const result = await api("/admin/tables");
    setTables(result.tables ?? []);
    setSelectedTable((current) => current || result.tables?.[0]?.name || "");
  }

  async function refreshUsers() {
    setUsers((await api("/admin/users")).users ?? []);
  }

  async function refreshLinkedAccounts() {
    setLinkedAccounts((await api("/admin/user-accounts")).accounts ?? []);
  }

  async function refreshFallbackMembers() {
    const requestGeneration = ++fallbackMembersRequest.current;
    if (members.length) {
      setFallbackMembers([]);
      setMembersError(null);
      setMembersLoading(false);
      return;
    }

    setMembersLoading(true);
    setMembersError(null);
    try {
      const loadedMembers = await loadAdminSettlementMembers(settings.claimId);
      if (requestGeneration !== fallbackMembersRequest.current) return;
      setFallbackMembers(loadedMembers);
    } catch (error) {
      if (requestGeneration !== fallbackMembersRequest.current) return;
      setFallbackMembers([]);
      const detail = error instanceof Error ? error.message : String(error);
      setMembersError(detail);
      throw new FallbackMemberLoadError(detail);
    } finally {
      if (requestGeneration === fallbackMembersRequest.current) setMembersLoading(false);
    }
  }

  async function refreshLinkedAccountsAndFallbackMembers() {
    const [linkedAccountsResult, fallbackMembersResult] = await Promise.allSettled([refreshLinkedAccounts(), refreshFallbackMembers()]);
    if (linkedAccountsResult.status === "rejected") throw linkedAccountsResult.reason;
    if (fallbackMembersResult.status === "rejected") throw fallbackMembersResult.reason;
  }

  async function refreshAccessControl() {
    const result = await api("/admin/access-control");
    setAccessControlState({
      config: normalizeAccessControlConfig(result.config),
      accounts: result.accounts ?? [],
    });
  }

  function accessRule(targetId: string) {
    return accessControlState?.config.rules[targetId] ?? { mode: "public" as AccessRuleMode, allowedDiscordIds: [] };
  }

  function updateAccessRule(targetId: string, patch: { mode?: AccessRuleMode; allowedDiscordIds?: string[] }) {
    setAccessControlState((current) => {
      const base = current ?? { config: { rules: {} }, accounts: linkedAccounts };
      const existing = base.config.rules[targetId] ?? { mode: "public" as AccessRuleMode, allowedDiscordIds: [] };
      const nextRule = {
        mode: patch.mode ?? existing.mode,
        allowedDiscordIds: patch.allowedDiscordIds ?? existing.allowedDiscordIds ?? [],
      };
      const rules = { ...base.config.rules, [targetId]: nextRule };
      if (nextRule.mode !== "specificUsers") rules[targetId] = { mode: nextRule.mode, allowedDiscordIds: [] };
      if (nextRule.mode === "public") delete rules[targetId];
      return { ...base, config: normalizeAccessControlConfig({ rules }) };
    });
  }

  async function saveAccessControl() {
    await run(async () => {
      const result = await api("/admin/access-control", { method: "PUT", body: JSON.stringify(accessControlState?.config ?? { rules: {} }) });
      setAccessControlState({ config: normalizeAccessControlConfig(result.config), accounts: result.accounts ?? [] });
    }, "Access control saved.", "access-control-save");
  }

  async function refreshAudit() {
    setAuditData(await api("/admin/audit?limit=100"));
    setAuditVisibleCount(30);
  }

  async function refreshPopupDiagnostics() {
    setPopupDiagnostics(await api("/admin/popups"));
  }

  async function refreshBackups() {
    setBackups((await api("/admin/backups")).backups ?? []);
  }

  async function refreshAnalytics() {
    setAnalyticsData(await api(`/admin/analytics?days=${encodeURIComponent(analyticsDays)}`));
    const securityParams = new URLSearchParams({
      days: analyticsDays,
      eventSearch: securityEventSearch,
      eventPage: String(securityEventPage),
      eventPageSize: String(securityEventPageSize),
    });
    setVisitorSecurityData(await api(`/admin/visitor-security?${securityParams.toString()}`));
  }

  async function refreshEmpireMembership() {
    setEmpireMembershipData(await api("/admin/empire-membership") as EmpireMembershipAdminView);
  }

  async function refreshDiscordDiscovery() {
    const discovery = await api("/admin/discord/discovery");
    setDiscordDiscovery(discovery);
    const matchedCraftEmojis = autoMatchCraftEmojis(Object.keys(DEFAULT_CRAFT_ROLES), discovery.emojis ?? []);
    if (Object.keys(matchedCraftEmojis).length) {
      setDraft((current) => ({
        ...current,
        discord: {
          ...current.discord,
          craftEmojis: { ...matchedCraftEmojis, ...(current.discord.craftEmojis ?? {}) },
        },
      }));
    }
  }

  async function refreshCustomCommands() {
    setCustomCommands((await api("/admin/discord/custom-commands")).commands ?? []);
  }

  React.useEffect(() => {
    if (!authLoading) {
      setAuthLoaderDelayElapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setAuthLoaderDelayElapsed(true), 250);
    return () => window.clearTimeout(timer);
  }, [authLoading]);
  React.useEffect(() => {
    if (resolvedAuth === undefined) return;
    setAuth(resolvedAuth);
    setAuthLoading(false);
  }, [resolvedAuth]);
  React.useEffect(() => {
    if (resolvedAuth !== undefined) return;
    api("/admin/me").then(setAdminAuthState).catch((error) => {
      setAdminAuthState({ authenticated: false, setupRequired: false, error: error instanceof Error ? error.message : String(error) });
      setMessageKind("error");
      setMessage(error.message);
    }).finally(() => setAuthLoading(false));
  }, [resolvedAuth]);
  React.useEffect(() => {
    const previousSettings = persistedSettingsRef.current;
    setDraft((current) => syncDraftFromPersistedSettings(previousSettings, settings, current));
    persistedSettingsRef.current = settings;
  }, [settings]);
  React.useEffect(() => {
    const applyLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const location = parseAdminLocation(window.location.search);
      if (params.has("admin")) setTab(botOnly && !["discord", "accounts"].includes(location.tab) ? "discord" : location.tab);
      if (params.has("config")) setStoredConfigurationSection(location.configurationSection);
      if (botOnly && params.has("section")) setBotSection(parseBotSectionLocation(window.location.search));
    };
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [botOnly, setBotSection, setTab]);
  React.useEffect(() => {
    let nextSearch = adminSearchWithTab(window.location.search, tab, tab === "configuration" ? configurationSection : undefined);
    if (botOnly && tab === "discord") nextSearch = botSearchWithSection(nextSearch, botSection);
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
  }, [botOnly, botSection, configurationSection, tab]);
  React.useEffect(() => {
    if (!hasUnsavedSettings) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedSettings]);
  const effectiveMembers = members.length ? members : fallbackMembers;
  const adminMemberRows = React.useMemo(() => [...effectiveMembers].sort((a, b) => memberDisplayName(a).localeCompare(memberDisplayName(b))), [effectiveMembers]);
  React.useEffect(() => {
    if (!auth?.authenticated) return;
    run(async () => {
      if (tab === "status" || tab === "discord") await refreshStatus();
      if (tab === "status") await refreshScheduledJobs();
      if (botOnly && tab === "discord") await refreshDiscordDiscovery();
      if (botOnly && tab === "discord" && botSection === "commands") await refreshCustomCommands();
      if (tab === "analytics") await refreshAnalytics();
      if (tab === "empire-membership") await refreshEmpireMembership();
      if (tab === "database") await Promise.all([refreshTables(), refreshStatus()]);
      if (tab === "users") await refreshUsers();
      if (tab === "accounts") await refreshLinkedAccountsAndFallbackMembers();
      if (tab === "configuration") await refreshAccessControl();
      if (tab === "audit") await refreshAudit();
      if (tab === "diagnostics") { await refreshStatus(); await refreshPopupDiagnostics(); }
      if (tab === "backups") await Promise.all([refreshBackups(), refreshStatus()]);
    }, undefined, `tab-load:${tab}:${botSection}:${analyticsDays}:${securityEventSearch}:${securityEventPage}:${securityEventPageSize}:${settings.claimId}:${members.length}`);
  }, [auth?.authenticated, tab, analyticsDays, botSection, securityEventSearch, securityEventPage, securityEventPageSize, settings.claimId, members.length]);
  const scheduledJobsRunning = Boolean((scheduledJobs?.jobs ?? []).some((job: AnyRecord) => job.running));
  React.useEffect(() => {
    if (!auth?.authenticated || tab !== "status" || !scheduledJobsRunning) return;
    const timer = window.setInterval(() => {
      void refreshScheduledJobs().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [auth?.authenticated, tab, scheduledJobsRunning]);
  React.useEffect(() => {
    if (!auth?.authenticated || tab !== "database" || !selectedTable) return;
    let stale = false;
    const timer = window.setTimeout(() => {
      const requestedTable = selectedTable;
      run(async () => {
        const result = await api(`/admin/table?name=${encodeURIComponent(requestedTable)}&limit=50&offset=${tableOffset}&search=${encodeURIComponent(tableSearch)}`);
        if (!stale) setTableResult({ ...result, table: requestedTable });
      }, undefined, `table-load:${requestedTable}:${tableOffset}:${tableSearch}`);
    }, 150);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [auth?.authenticated, selectedTable, tableOffset, tableSearch, tab]);

  async function saveSettings() {
    await run(async () => {
      const result = await api("/admin/settings", { method: "PUT", body: JSON.stringify(draft) });
      const next = normalizeAppSettings(result);
      setDraft(next);
      applyConfirmedSettingsSave({
        previousSettings: settings,
        persistedSettings: next,
        onSettingsSaved,
        onClaimSettingsSaved,
      });
    }, "Settings saved and applied.", "settings-save");
  }

  function revertSettings() {
    setDraft(settings);
    setMessageKind("info");
    setMessage("Unsaved changes reverted.");
  }

  function updateDraft<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateToastSetting(key: keyof AppSettings["toastSettings"], value: boolean) {
    setDraft((current) => ({
      ...current,
      toastSettings: { ...current.toastSettings, [key]: value },
    }));
  }

  function updateVisitorSecuritySetting(patch: Partial<AppSettings["visitorSecurity"]>) {
    setDraft((current) => ({
      ...current,
      visitorSecurity: { ...current.visitorSecurity, ...patch },
    }));
  }

  function updateMarketDealWatchSetting(patch: Partial<AppSettings["marketDealWatch"]>) {
    setDraft((current) => ({
      ...current,
      marketDealWatch: { ...current.marketDealWatch, ...patch },
    }));
  }


  function setMemberTracking(member: AnyRecord, tracked: boolean) {
    const id = memberTrackingId(member);
    if (!id) return;
    setDraft((current) => {
      const currentIds = current.excludedMemberIds ?? [];
      const nextIds = tracked
        ? currentIds.filter((value) => String(value) !== id)
        : unique([...currentIds, id]);
      return { ...current, excludedMemberIds: nextIds };
    });
  }

  function updateDiscord(value: Partial<DiscordSettings>) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, ...value } }));
  }

  function updateDiscordNotify(key: keyof DiscordSettings["notify"], value: boolean) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, notify: { ...current.discord.notify, [key]: value } } }));
  }

  function updateDiscordPresence(value: Partial<DiscordPresence>) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, presence: { ...current.discord.presence, ...value } } }));
  }

  function updateDiscordChannel(key: string, value: string) {
    setDraft((current) => ({
      ...current,
      discord: {
        ...current.discord,
        channels: { ...current.discord.channels, [key]: value },
        craftChannels: key in DEFAULT_CRAFT_CHANNELS ? { ...current.discord.craftChannels, [key]: value } : current.discord.craftChannels,
        ...(key === "notifications" ? { channelId: value } : {}),
      },
    }));
  }

  function updateDiscordRole(key: string, value: string) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, craftRoles: { ...current.discord.craftRoles, [key]: value } } }));
  }

  function updateDiscordCraftEmoji(key: string, value: string) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, craftEmojis: { ...(current.discord.craftEmojis ?? {}), [key]: value } } }));
  }
  function updateDiscordColourRole(key: string, patch: Partial<ColourRoleDefinition>) {
    setDraft((current) => ({
      ...current,
      discord: {
        ...current.discord,
        colourRoles: current.discord.colourRoles.map((entry) => entry.key === key ? { ...entry, ...patch } : entry),
      },
    }));
  }

  function addDiscordColourRole() {
    const label = `Colour ${draft.discord.colourRoles.length + 1}`;
    setDraft((current) => ({
      ...current,
      discord: {
        ...current.discord,
        colourRoles: [...current.discord.colourRoles, { key: uniqueKey(), label, roleName: label, roleId: "", color: 0xf4c430 }],
      },
    }));
  }

  function removeDiscordColourRole(key: string) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, colourRoles: current.discord.colourRoles.filter((entry) => entry.key !== key) } }));
  }

  function updateDiscordRolePanel(panelKey: string, patch: Partial<DiscordRolePanel>) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, rolePanels: current.discord.rolePanels.map((panel) => panel.key === panelKey ? { ...panel, ...patch } : panel) } }));
  }

  function updateDiscordRolePanelOption(panelKey: string, optionKey: string, patch: Partial<DiscordRoleOption>) {
    setDraft((current) => ({
      ...current,
      discord: {
        ...current.discord,
        rolePanels: current.discord.rolePanels.map((panel) => panel.key === panelKey ? { ...panel, options: panel.options.map((option) => option.key === optionKey ? { ...option, ...patch } : option) } : panel),
      },
    }));
  }

  function addDiscordRolePanelOption(panelKey: string) {
    const label = "New Role";
    const key = uniqueKey("role");
    setDraft((current) => ({
      ...current,
      discord: {
        ...current.discord,
        rolePanels: current.discord.rolePanels.map((panel) => panel.key === panelKey ? { ...panel, options: [...panel.options, { key, label, roleId: "", emoji: "" }] } : panel),
      },
    }));
    setExpandedRoleOption(`${panelKey}:${key}`);
  }

  function removeDiscordRolePanelOption(panelKey: string, optionKey: string) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, rolePanels: current.discord.rolePanels.map((panel) => panel.key === panelKey ? { ...panel, options: panel.options.filter((option) => option.key !== optionKey) } : panel) } }));
    setExpandedRoleOption((current) => current === `${panelKey}:${optionKey}` ? null : current);
  }

  function updateWelcomeFlow(patch: Partial<DiscordWelcomeFlow>) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, welcomeFlow: { ...current.discord.welcomeFlow, ...patch } } }));
  }

  async function syncDiscordColourRoles() {
    const result = await api("/admin/discord/colour-roles/manage", { method: "POST", body: JSON.stringify({ colourRoles: draft.discord.colourRoles, colourRolesChannelId: draft.discord.colourRolesChannelId }) });
    const next = normalizeAppSettings(result.settings);
    setDraft(next);
    onSettingsSaved(next);
    await refreshDiscordDiscovery();
  }

  async function createDiscordRoleFromDashboard() {
    const result = await api("/admin/discord/roles/create", { method: "POST", body: JSON.stringify(roleDraft) });
    setRoleDraft((current) => ({ ...current, name: "" }));
    await refreshDiscordDiscovery();
    setDiscordToolResult({ createdRole: result.role });
  }

  async function postRolePanel(panelKey: string) {
    const result = await api("/admin/discord/role-panel/post", { method: "POST", body: JSON.stringify({ panelKey }) });
    const next = normalizeAppSettings(result.settings);
    setDraft(next);
    onSettingsSaved(next);
  }

  async function postWelcomeFlow() {
    const result = await api("/admin/discord/welcome/post", { method: "POST", body: "{}" });
    const next = normalizeAppSettings(result.settings);
    setDraft(next);
    onSettingsSaved(next);
  }

  async function runModerationAction(action: "timeout" | "kick" | "ban" | "unban" | "purge") {
    const payload = action === "purge"
      ? { channelId: moderationDraft.channelId, limit: Number(moderationDraft.purgeLimit), reason: moderationDraft.reason }
      : action === "unban"
        ? { userId: moderationDraft.unbanUserId || moderationDraft.userId, reason: moderationDraft.reason }
        : {
          userId: moderationDraft.userId,
          reason: moderationDraft.reason,
          minutes: action === "timeout" ? Number(moderationDraft.timeoutMinutes) : undefined,
          deleteMessageSeconds: action === "ban" ? Number(moderationDraft.deleteMessageSeconds) : undefined,
        };
    const result = await api(`/admin/discord/moderation/${action}`, { method: "POST", body: JSON.stringify(payload) });
    setDiscordToolResult({ ...result, __type: "moderationAction" });
  }

  function confirmModeration(message: string, onConfirm: () => void) {
    setActionConfirmation({
      title: "Confirm Discord action",
      target: moderationDraft.userId || moderationDraft.channelId || "Discord server",
      impact: message,
      reversible: message.startsWith("Unlock") || message.startsWith("Remove this Discord server ban"),
      confirmLabel: "Confirm action",
      tone: "danger",
      onConfirm,
    });
  }

  async function runBotEndpoint(path: string, payload: AnyRecord, type: string) {
    const result = await api(path, { method: "POST", body: JSON.stringify(payload) });
    setDiscordToolResult({ ...result, __type: type });
    return result;
  }

  function updateNotificationChannel(key: string, value: string) {
    setDraft((current) => ({ ...current, discord: { ...current.discord, notificationChannels: { ...current.discord.notificationChannels, [key]: value } } }));
  }

  async function uploadBrand(type: "logo" | "favicon", file?: File) {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setMessageKind("error");
      return setMessage("Image must be smaller than 1 MB.");
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Unable to read image"));
      reader.readAsDataURL(file);
    });
    await run(async () => {
      const result = await api("/admin/branding", { method: "POST", body: JSON.stringify({ type, dataUrl }) });
      const next = applyBrandingSettingsResult(settings, draft, result.branding);
      setDraft(next.nextDraft);
      onSettingsSaved(next.savedSettings);
    }, `${type === "logo" ? "Logo" : "Favicon"} uploaded.`, `branding-upload:${type}`);
  }

  async function removeBrand(type: "logo" | "favicon") {
    await run(async () => {
      const result = await api(`/admin/branding?type=${type}`, { method: "DELETE" });
      const next = applyBrandingSettingsResult(settings, draft, result.branding);
      setDraft(next.nextDraft);
      onSettingsSaved(next.savedSettings);
    }, `${type === "logo" ? "Logo" : "Favicon"} removed.`, `branding-remove:${type}`);
  }

  const canViewServerHealth = Boolean(auth?.user?.permissions?.includes("*"));
  const visibleTabGroups = React.useMemo(() => (botOnly ? BOT_CONSOLE_TAB_GROUPS : ADMIN_TAB_GROUPS).map((group) => ({ ...group, tabs: group.tabs.filter((item) => item.key !== "server-health" || canViewServerHealth) })).filter((group) => group.tabs.length), [botOnly, canViewServerHealth]);
  const tabs = React.useMemo<AdminTabMeta[]>(() => visibleTabGroups.flatMap((group) => group.tabs), [visibleTabGroups]);
  const activeTabMeta = tabs.find((item) => item.key === tab);
  const extractedTabOwnsMessage = tab === "analytics" || tab === "empire-membership" || tab === "database" || tab === "users" || tab === "accounts" || tab === "audit" || tab === "backups";
  const tabLoadPending = [...pendingActions].some((key) => key.startsWith(`tab-load:${tab}:`));
  React.useEffect(() => { if (tab === "server-health" && !canViewServerHealth) setTab("status"); }, [tab, canViewServerHealth, setTab]);
  const auditRows: AnyRecord[] = Array.isArray(auditData.auditLog) ? auditData.auditLog : [];
  const loginRows: AnyRecord[] = Array.isArray(auditData.logins) ? auditData.logins : [];
  React.useEffect(() => {
    if (!tabs.some((item) => item.key === tab)) setTab(botOnly ? "discord" : "status");
  }, [botOnly, setTab, tab, tabs]);
  const discordTestButtons = [
    ["basic", "Basic"],
    ["listing", "Listing"],
    ["sale", "Sale"],
    ["craftStarted", "Craft Started"],
    ["craftCompleted", "Craft Completed"],
    ["supplies", "Supplies"],
    ["appUpdate", "App Update"],
  ] as const;
  const authLoadingPresentation = adminLoadingStage({ authLoading, delayElapsed: authLoaderDelayElapsed });
  if (authLoadingPresentation === "pending-hidden") return (
    <div className="panel admin-login admin-loading-delay" aria-busy="true" aria-label="Checking administrator session" />
  );
  if (authLoadingPresentation === "pending-visible") return (
    <div className="panel admin-login admin-loading-panel">
      <section className="admin-session-loader" role="status" aria-live="polite" aria-label="Checking administrator session">
        <div className="admin-loader-orb" aria-hidden="true">
          <span className="admin-loader-ring" />
          <span className="admin-loader-ring delay" />
          <span className="admin-loader-core" />
          <KeyRound size={30} />
        </div>
        <div className="admin-loader-copy">
          <span className="eyebrow">Admin Console</span>
          <Heading>{botOnly ? "Discord Bot Control" : "Verifying Access"}</Heading>
          <p>Checking your session, permissions, and console modules.</p>
        </div>
        <div className="admin-loader-track" aria-hidden="true">
          <span />
        </div>
        <div className="admin-loader-steps" aria-hidden="true">
          <span><Shield size={14} /> Session</span>
          <span><Database size={14} /> Roles</span>
          <span><CheckCircle2 size={14} /> Console</span>
        </div>
      </section>
    </div>
  );
  if (!auth?.authenticated) {
    const adminDiscordLogin = String(auth?.discordLoginUrl ?? `${LOCAL_API}/auth/discord/start?returnTo=${encodeURIComponent("/?page=admin")}`);
    return (
      <div className="panel admin-login">
        <header className="members-topbar admin-topbar">
          <div>
            <Heading>{botOnly ? "Discord Bot Control" : "Admin"}</Heading>
            <p>Sign in with an approved Discord administrator account to manage this installation.</p>
          </div>
        </header>
        <section className="form-card">
          <h3><MessageCircle size={17} /> Discord Administrator Sign-In</h3>
          <p className="legend">Discord proves identity; administrator access is controlled by the owner-managed admin list.</p>
          {auth?.discordLoginEnabled ? <a className="toolbar-button primary" href={adminDiscordLogin}><MessageCircle size={15} /> Sign in with Discord</a> : <p className="error">Discord login is not configured on this server.</p>}
          {message ? <p className="legend" role={messageKind === "error" ? "alert" : "status"} aria-live={messageKind === "error" ? "assertive" : "polite"}>{message}</p> : null}
        </section>
      </div>
    );
  }

  const endpointChecks = [...diagnostics].sort((a, b) => {
    if (Boolean(a.ok) !== Boolean(b.ok)) return a.ok ? 1 : -1;
    return toNumber(b.durationMs) - toNumber(a.durationMs);
  });
  const endpointFailures = endpointChecks.filter((check) => !check.ok);
  const endpointSuccesses = endpointChecks.filter((check) => check.ok);
  const slowestEndpoint = endpointSuccesses[0];
  const fastestEndpoint = endpointSuccesses.reduce<AnyRecord | null>((fastest, check) => {
    if (!fastest || toNumber(check.durationMs) < toNumber(fastest.durationMs)) return check;
    return fastest;
  }, null);
  const publicPopupCount = (popupDiagnostics?.popups ?? []).filter((popup: AnyRecord) => popup.enabled).length;
  const supportSnapshot = {
    generatedAt: new Date().toISOString(),
    runtime: { environment: status?.environment ?? "unknown", storage: status?.storageLabel ?? "unknown", databaseSize: status?.databaseSize ?? null },
    localApiHealth: status ? "loaded" : "not loaded",
    polling: { enabled: Boolean(status?.polling?.enabled), lastSuccessAt: status?.polling?.lastSuccessAt ?? null, lastError: status?.polling?.lastError ?? null },
    counts: status?.counts ?? {},
    diagnostics: { endpointChecks: endpointChecks.length, endpointFailures: endpointFailures.length, mapUrlLogEntries: mapUrlLog.length, publicPopupCount },
    audit: { actionsLoaded: auditRows.length, signInsLoaded: loginRows.length },
  };
  const copySupportSnapshot = async () => {
    await navigator.clipboard.writeText(JSON.stringify(supportSnapshot, null, 2));
    setMessageKind("success");
    setMessage("Support snapshot copied to clipboard.");
  };
  const discordChannelLabel = (key: string) => {
    if (key === "notifications") return "Default notifications";
    if (key === "announcements") return "Announcements";
    if (key === "modNotes") return "Mod notes";
    if (key === "modLog") return "Mod log";
    return key[0].toUpperCase() + key.slice(1);
  };
  const channelOptions = Object.entries(draft.discord.channels ?? {}).map(([key, id]) => ({ key, label: discordChannelLabel(key), id })).filter((entry) => entry.id || entry.key === "notifications" || entry.key === "announcements");
  const channelSelect = (key: string, value: string, allowProfession = false) => (
    <select value={value} onChange={(event) => updateNotificationChannel(key, event.target.value)}>
      {allowProfession ? <option value="profession">Profession channel</option> : null}
      {channelOptions.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
    </select>
  );
  const discoveredChannels: AnyRecord[] = discordDiscovery?.channels ?? [];
  const discoveredRoles: AnyRecord[] = discordDiscovery?.roles ?? [];
  const discoveredEmojis: AnyRecord[] = discordDiscovery?.emojis ?? [];
  const discoveredMembers: AnyRecord[] = discordDiscovery?.members ?? [];
  const roleById = (id: string) => discoveredRoles.find((role) => String(role.id) === String(id));
  const roleMemberCountText = (role: AnyRecord | undefined | null) => role?.memberCountAvailable === false ? "Member count unavailable" : `${formatNumber(role?.memberCount)} members`;
  const roleStatusText = (role: AnyRecord | undefined | null) => role ? `${roleMemberCountText(role)} | ${role.manageabilityReason ?? (role.botCanManage ? "Bot can manage" : "Not manageable")}` : "";
  const memberCountWarning = discordDiscovery?.memberCountAvailable === false ? (
    <div className="error">Discord member counts are unavailable. Enable the bot's Server Members Intent in the Discord Developer Portal, then sync the server again. {discordDiscovery.memberCountError ? `Discord returned: ${discordDiscovery.memberCountError}` : ""}</div>
  ) : null;
  const channelIdSelect = (value: string, onChange: (value: string) => void) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select a channel</option>
      {value && !discoveredChannels.some((channel) => String(channel.id) === String(value)) ? <option value={value}>Unknown channel ({value})</option> : null}
      {discoveredChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.label ?? `#${channel.name}`} ({channel.id})</option>)}
    </select>
  );
  const resolvedNotificationChannelValue = (value: string) => {
    const selected = String(value ?? "").trim();
    return draft.discord.channels?.[selected] || (/^\d{15,25}$/.test(selected) ? selected : "");
  };
  const notificationChannelIdSelect = (key: string, value: string) => channelIdSelect(resolvedNotificationChannelValue(value), (nextValue) => updateNotificationChannel(key, nextValue));
  const optionalChannelIdSelect = (value: string, onChange: (value: string) => void, defaultLabel = "Use default channel", disabled = false) => (
    <select value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">{defaultLabel}</option>
      {value && !discoveredChannels.some((channel) => String(channel.id) === String(value)) ? <option value={value}>Unknown channel ({value})</option> : null}
      {discoveredChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.label ?? `#${channel.name}`} ({channel.id})</option>)}
    </select>
  );
  const memberIdSelect = (value: string, onChange: (value: string) => void) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select a member</option>
      {value && !discoveredMembers.some((member) => String(member.id) === String(value)) ? <option value={value}>Unknown member ({value})</option> : null}
      {discoveredMembers.map((member) => <option key={member.id} value={member.id}>{member.username ?? member.id} ({member.id})</option>)}
    </select>
  );
  const roleIdSelect = (value: string, onChange: (value: string) => void) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Select a role</option>
      {value && !discoveredRoles.some((role) => String(role.id) === String(value)) ? <option value={value}>Unknown role ({value})</option> : null}
      {discoveredRoles.map((role) => <option key={role.id} value={role.id}>{role.name}{role.botCanManage ? "" : ` - ${role.manageabilityReason ?? "not manageable"}`}</option>)}
    </select>
  );
  const emojiSelect = (value: string, onChange: (value: string) => void) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">No emoji</option>
      {value && !discoveredEmojis.some((emoji) => String(emoji.mention) === String(value)) ? <option value={value}>Unknown emoji ({value})</option> : null}
      {discoveredEmojis.map((emoji) => <option key={emoji.id} value={emoji.mention}>{emoji.mention} {emoji.name}</option>)}
    </select>
  );
  const discordDelivery = status?.discord?.lastDelivery ?? {};
  const discordLog: AnyRecord[] = Array.isArray(status?.discord?.deliveryLog) ? status.discord.deliveryLog : [];
  const discordDeliveryLabel = discordDelivery.status === "failed"
    ? `Failed ${dateLabel(discordDelivery.at)}: ${discordDelivery.error ?? "Unknown Discord error"}`
    : discordDelivery.status === "sent"
      ? `Sent ${dateLabel(discordDelivery.at)}: ${discordDelivery.eventType ?? "notification"}${discordDelivery.channelId ? ` to ${discordDelivery.channelId}` : ""}`
      : discordDelivery.status === "skipped"
        ? `Skipped ${dateLabel(discordDelivery.at)}: ${discordDelivery.reason ?? "Not enabled"}`
        : "No Discord deliveries recorded";
  const adminSetupItems = [
    { label: "Discord administrator", done: Boolean(auth?.user), detail: auth?.user?.username ? `Signed in as ${auth.user.username}` : "Sign in with an approved Discord admin account." },
    { label: "Settlement defaults", done: Boolean(draft.claimId), detail: draft.claimId ? `Settlement ${draft.claimId}` : "Add the monitored settlement ID." },
    { label: "Live Relay provider", done: Boolean(status?.gameDataProvider?.running && status?.gameDataProvider?.cacheReady), detail: status?.gameDataProvider?.running ? "Committed Relay generations update current pages immediately." : "Start the Relay provider to load current settlement data." },
    { label: "Database history", done: toNumber(status?.counts?.activity_events) > 0 || toNumber(status?.counts?.market_trades) > 0, detail: `${formatNumber(status?.counts?.activity_events)} activity events, ${formatNumber(status?.counts?.market_trades)} trades` },
    { label: "Branding", done: Boolean(draft.branding?.logo || draft.branding?.favicon), detail: draft.branding?.logo || draft.branding?.favicon ? "Custom brand assets configured." : "Optional logo and favicon can be added." },
    { label: "Discord bot", done: Boolean(draft.discord?.botTokenConfigured && draft.discord?.enabled), detail: draft.discord?.botTokenConfigured ? (draft.discord.enabled ? "Enabled and token configured." : "Token configured, bot disabled.") : "Optional bot token not configured." },
  ];
  const completedSetupItems = adminSetupItems.filter((item) => item.done).length;
  const botWorkflowItems = [
    { label: "Connect bot", done: Boolean(draft.discord?.botTokenConfigured), detail: draft.discord?.botTokenConfigured ? `Token configured via ${draft.discord.botTokenSource ?? "server"}.` : "Add the bot token in Setup." },
    { label: "Sync Discord server", done: Boolean(discoveredChannels.length || discoveredRoles.length || discoveredMembers.length), detail: `${formatNumber(discoveredChannels.length)} channels, ${formatNumber(discoveredRoles.length)} roles, ${formatNumber(discoveredMembers.length)} members cached.` },
    { label: "Choose notification channels", done: Boolean(Object.values(draft.discord?.notificationChannels ?? {}).some(Boolean)), detail: "Route app, supply, craft and moderation messages." },
    { label: "Register slash commands", done: Boolean(status?.discord?.registeredCommandsAt), detail: status?.discord?.registeredCommandsAt ? `Last registered ${dateLabel(status.discord.registeredCommandsAt)}.` : "Use Tests & Commands after settings are saved." },
  ];
  const botHealth = deriveBotHealth({
    enabled: Boolean(draft.discord.enabled),
    tokenConfigured: Boolean(draft.discord.botTokenConfigured),
    gatewayConnected: Boolean(status?.discord?.gateway?.connected),
    gatewayError: status?.discord?.gateway?.lastError ? String(status.discord.gateway.lastError) : null,
    rulesEnabled: Object.values(draft.discord.notify).filter(Boolean).length,
    lastDeliveryStatus: discordDelivery.status ? String(discordDelivery.status) : null,
    lastDeliveryLabel: discordDeliveryLabel,
    setupSteps: botWorkflowItems.map((item) => ({
      ...item,
      section: item.label === "Choose notification channels" ? "notifications" as const : item.label === "Register slash commands" ? "tests" as const : "setup" as const,
    })),
  });


  function renderDiscordToolResult(result: AnyRecord) {
    const resultType = String(result.__type ?? "");
    if (Array.isArray(result.entries) && Array.isArray(result.users)) {
      return <div className="discord-audit-report">
        <div className="split-header">
          <div>
            <h4>Audit Log</h4>
            <p className="legend">Latest Discord server actions returned by the bot.</p>
          </div>
          <span className="role-option-status ok">{formatNumber(result.entries.length)} entries</span>
        </div>
        {!result.entries.length ? <div className="empty-state"><FileText />No audit entries returned.</div> : null}
        <div className="discord-audit-list">{result.entries.map((entry: AnyRecord) => {
          const occurredAt = discordSnowflakeDate(entry.id);
          const changes = Array.isArray(entry.changes) ? entry.changes : [];
          return <article className="discord-audit-entry" key={entry.id}>
            <div className="discord-audit-icon"><FileText size={16} /></div>
            <div>
              <strong>{discordAuditActionLabel(entry.actionType)}</strong>
              <span>{discordAuditUserLabel(result.users, entry.userId)}{entry.targetId ? ` -> ${entry.targetId}` : ""}</span>
              {entry.reason ? <p>Reason: {entry.reason}</p> : null}
              {changes.length ? <ul>{changes.slice(0, 5).map((change: AnyRecord, index: number) => <li key={`${entry.id}-${index}`}>{discordChangeLabel(change)}</li>)}</ul> : null}
            </div>
            <time>{occurredAt ? dateLabel(occurredAt.toISOString()) : entry.id}</time>
          </article>;
        })}</div>
      </div>;
    }
    if (resultType === "roleCleanup" || (Array.isArray(result.unusedRoles) && Array.isArray(result.duplicateColours))) {
      const unusedRoles = result.unusedRoles ?? [];
      const duplicateColours = result.duplicateColours ?? [];
      const missingConfiguredRoles = result.missingConfiguredRoles ?? [];
      const notManageableConfiguredRoles = result.notManageableConfiguredRoles ?? [];
      return <div className="discord-report">
        <div className="split-header">
          <div><h4>Role Cleanup</h4><p className="legend">Potential Discord role issues found from the latest server sync.</p></div>
          <span className="role-option-status warn">{formatNumber(unusedRoles.length + duplicateColours.length + missingConfiguredRoles.length + notManageableConfiguredRoles.length)} findings</span>
        </div>
        <div className="discord-report-metrics">
          <Info label="Unused roles" value={formatNumber(unusedRoles.length)} />
          <Info label="Duplicate colours" value={formatNumber(duplicateColours.length)} />
          <Info label="Missing configured" value={formatNumber(missingConfiguredRoles.length)} />
          <Info label="Not manageable" value={formatNumber(notManageableConfiguredRoles.length)} />
        </div>
        <div className="discord-report-grid">
          <section><h5>Unused Roles</h5>{unusedRoles.length ? unusedRoles.map((role: AnyRecord) => <div className="discord-report-row" key={role.id}><span className="role-swatch" style={{ backgroundColor: role.color ? `#${Number(role.color).toString(16).padStart(6, "0")}` : "transparent" }} /><strong>{role.name}</strong><small>{roleMemberCountText(role)} | {role.manageabilityReason ?? "Role can be reviewed"}</small></div>) : <p className="legend">No unused roles found.</p>}</section>
          <section><h5>Duplicate Colours</h5>{duplicateColours.length ? duplicateColours.map((group: AnyRecord) => <div className="discord-report-row" key={group.color}><span className="role-swatch" style={{ backgroundColor: group.color ? `#${Number(group.color).toString(16).padStart(6, "0")}` : "transparent" }} /><strong>#{Number(group.color ?? 0).toString(16).padStart(6, "0")}</strong><small>{(group.roles ?? []).map((role: AnyRecord) => role.name).join(", ")}</small></div>) : <p className="legend">No duplicate role colours found.</p>}</section>
          <section><h5>Missing Configured Roles</h5>{missingConfiguredRoles.length ? missingConfiguredRoles.map((roleId: string) => <div className="discord-report-row" key={roleId}><AlertTriangle size={15} /><strong>Missing role</strong><small>{roleId}</small></div>) : <p className="legend">All configured roles exist.</p>}</section>
          <section><h5>Not Manageable</h5>{notManageableConfiguredRoles.length ? notManageableConfiguredRoles.map((role: AnyRecord) => <div className="discord-report-row" key={role.id}><Lock size={15} /><strong>{role.name}</strong><small>{role.manageabilityReason ?? "Bot cannot manage this role"}</small></div>) : <p className="legend">Configured roles are manageable.</p>}</section>
        </div>
      </div>;
    }
    if (resultType === "channelPermissions" || Array.isArray(result.channels)) {
      const channels = result.channels ?? [];
      const missing = channels.filter((channel: AnyRecord) => !channel.found);
      const denied = channels.filter((channel: AnyRecord) => (channel.deniedConfiguredRoles ?? []).length);
      return <div className="discord-report">
        <div className="split-header">
          <div><h4>Channel Checks</h4><p className="legend">Configured channels and role permission overwrite warnings.</p></div>
          <span className={`role-option-status ${missing.length || denied.length ? "warn" : "ok"}`}>{missing.length || denied.length ? `${missing.length + denied.length} warnings` : "Looks good"}</span>
        </div>
        <div className="discord-report-metrics">
          <Info label="Configured channels" value={formatNumber(channels.length)} />
          <Info label="Missing channels" value={formatNumber(missing.length)} />
          <Info label="Denied role overwrites" value={formatNumber(denied.length)} />
        </div>
        <div className="discord-report-list">{channels.map((channel: AnyRecord) => <article className="discord-report-item" key={`${channel.key}-${channel.id}`}>
          <div className={`discord-report-dot ${channel.found ? "ok" : "warn"}`} />
          <div><strong>{channel.name}</strong><span>{channel.key} | {channel.id}</span></div>
          <span className={`role-option-status ${channel.found && !(channel.deniedConfiguredRoles ?? []).length ? "ok" : "warn"}`}>{!channel.found ? "Missing" : (channel.deniedConfiguredRoles ?? []).length ? "Denied role overwrite" : "Found"}</span>
        </article>)}</div>
      </div>;
    }
    if (resultType === "inactiveReport" || Array.isArray(result.inactive)) {
      const inactive = result.inactive ?? [];
      return <div className="discord-report">
        <div className="split-header">
          <div><h4>Inactive Members</h4><p className="legend">Members with no recent messages or sampled reactions in the checked channels.</p></div>
          <span className="role-option-status warn">{formatNumber(inactive.length)} inactive</span>
        </div>
        <div className="discord-report-metrics">
          <Info label="Period" value={`${formatNumber(result.days)} days`} />
          <Info label="Members scanned" value={result.totalMembers === null ? "Unavailable" : formatNumber(result.totalMembers)} />
          <Info label="Active found" value={formatNumber(result.activeCount)} />
          <Info label="Channels checked" value={formatNumber(result.scannedChannels)} />
          <Info label="Reaction checks" value={formatNumber(result.reactionChecks)} />
        </div>
        <div className="discord-report-list">{inactive.length ? inactive.map((member: AnyRecord) => <article className="discord-report-item" key={member.id}>
          <div className="discord-report-dot warn" />
          <div><strong>{member.username}</strong><span>{member.id}</span></div>
          <span className="role-option-status warn">Inactive</span>
        </article>) : <p className="legend">No inactive members found in this scan.</p>}</div>
      </div>;
    }
    if (resultType === "moderationBans" || Array.isArray(result.bans)) {
      const bans = result.bans ?? [];
      return <div className="discord-report">
        <div className="split-header">
          <div><h4>Ban List</h4><p className="legend">Current Discord server bans returned by the bot.</p></div>
          <span className="role-option-status warn">{formatNumber(bans.length)} banned</span>
        </div>
        <div className="discord-report-list">{bans.length ? bans.map((entry: AnyRecord) => <article className="discord-report-item" key={entry.user?.id ?? entry.id}>
          <div className="discord-report-dot warn" />
          <div><strong>{entry.user?.username ?? "Unknown user"}</strong><span>{entry.user?.id ?? "-"}{entry.reason ? ` | ${entry.reason}` : ""}</span></div>
          <span className="role-option-status warn">Banned</span>
        </article>) : <p className="legend">No banned users returned by Discord.</p>}</div>
      </div>;
    }
    if (resultType === "moderationAction") {
      const labels: Record<string, string> = {
        timeout: "Timeout Applied",
        timeout_removed: "Timeout Removed",
        kick: "Member Kicked",
        ban: "Member Banned",
        unban: "Member Unbanned",
        purge: "Messages Purged",
      };
      return <div className="discord-report">
        <div className="split-header">
          <div><h4>{labels[result.action] ?? "Moderation Action"}</h4><p className="legend">Discord accepted the moderation request.</p></div>
          <span className="role-option-status ok">Success</span>
        </div>
        <div className="discord-report-metrics">
          <Info label="Action" value={labels[result.action] ?? result.action ?? "Moderation"} />
          {result.userId ? <Info label="User ID" value={result.userId} /> : null}
          {result.channelId ? <Info label="Channel ID" value={result.channelId} /> : null}
          {result.minutes != null ? <Info label="Timeout" value={result.minutes ? `${formatNumber(result.minutes)} minutes` : "Removed"} /> : null}
          {result.deleted != null ? <Info label="Deleted" value={`${formatNumber(result.deleted)} messages`} /> : null}
        </div>
      </div>;
    }
    if (resultType === "botAction") {
      const response = result.response ?? result.rule ?? result.command ?? {};
      return <div className="discord-report">
        <div className="split-header"><div><h4>Action Complete</h4><p className="legend">The bot action completed successfully.</p></div><span className="role-option-status ok">Success</span></div>
        <div className="discord-report-metrics">
          <Info label="Result" value={result.action ?? response.name ?? response.title ?? response.id ?? "Completed"} />
          {result.response?.id ? <Info label="Message ID" value={result.response.id} /> : null}
          {result.rule?.id ? <Info label="Rule ID" value={result.rule.id} /> : null}
          {result.caseId ? <Info label="Case ID" value={`#${result.caseId}`} /> : null}
          {result.unbanAt ? <Info label="Unban At" value={dateLabel(result.unbanAt)} /> : null}
        </div>
      </div>;
    }
    if (resultType === "botReport") {
      const rows = result.cases ?? result.warnings ?? result.notes ?? result.mismatches ?? result.commands ?? result.rules ?? [];
      const title = result.cases ? "Case Log" : result.warnings ? "Warnings" : result.notes ? "Mod Notes" : result.mismatches ? "Nickname Report" : result.commands ? "Custom Commands" : result.rules ? "Auto-Moderation Rules" : "Report";
      return <div className="discord-report">
        <div className="split-header"><div><h4>{title}</h4><p className="legend">Latest bot report output.</p></div><span className="role-option-status">{formatNumber(Array.isArray(rows) ? rows.length : 0)} rows</span></div>
        <div className="discord-report-list">{Array.isArray(rows) && rows.length ? rows.slice(0, 100).map((row: AnyRecord, index: number) => <article className="discord-report-item" key={row.id ?? row.name ?? index}>
          <div className="discord-report-dot ok" />
          <div><strong>{row.name ?? row.username ?? row.case_type ?? row.reason ?? row.note ?? row.user?.username ?? `Record ${index + 1}`}</strong><span>{row.description ?? row.response ?? row.user_id ?? row.user?.id ?? row.created_at ?? row.occurred_at ?? JSON.stringify(row).slice(0, 180)}</span></div>
          <span className="role-option-status">{row.active === 0 ? "Cleared" : row.enabled === false ? "Off" : "Active"}</span>
        </article>) : <p className="legend">No records returned.</p>}</div>
      </div>;
    }
    return <pre className="discord-tool-result">{JSON.stringify(result, null, 2)}</pre>;
  }
  return (
    <div className={`panel admin-console ${botOnly ? "bot-console" : "admin-page"}`}>
      <AdminShellHeader
        heading={botOnly ? "Discord Bot Control" : "Admin Console"}
        description={botOnly ? "Manage bot setup, notifications, self-assign roles, tools and diagnostics" : "Configuration and operational controls for this installation"}
        admin={auth.user}
        publicAccount={publicAccount}
        environment={status?.environment}
        reconciliationEnabled={Boolean(status?.polling?.enabled)}
        botOnly={botOnly}
        logoutPending={isBusyAction("logout")}
        onLogout={() => run(async () => { await api("/admin/logout", { method: "POST", body: "{}" }); setAdminAuthState({ authenticated: false, setupRequired: false }); }, undefined, "logout")}
      />
      {tabs.length && activeTabMeta ? (
        <AdminSectionNavigation groups={visibleTabGroups} active={tab} onSelect={setTab} />
      ) : null}
      {message && !extractedTabOwnsMessage ? <div className={`admin-message ${messageKind}`} role={messageKind === "error" ? "alert" : "status"} aria-live={messageKind === "error" ? "assertive" : "polite"}>{message}</div> : null}

      {botOnly && tab === "discord" && discordDiscovery?.available === false ? (
        <div className="admin-message info discord-availability-notice" role="status">
          <strong>Discord connection unavailable.</strong> {discordDiscovery.message}
        </div>
      ) : null}

      {tab === "server-health" && canViewServerHealth ? <ServerHealthSection /> : null}

      {tab === "status" ? (
        <div className="admin-section">
          <section className="form-card setup-checklist-card">
            <div className="split-header">
              <div>
                <h3><CheckCircle2 size={17} /> Setup Checklist</h3>
                <p className="legend">A quick operational checklist for this installation. Optional items are marked when configured, but do not block local use.</p>
              </div>
              <span className="setup-progress-pill">{completedSetupItems}/{adminSetupItems.length} complete</span>
            </div>
            <div className="setup-checklist">
              {adminSetupItems.map((item) => (
                <div className={item.done ? "done" : ""} key={item.label}>
                  <span>{item.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}</span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
          </section>
          <AdminStatusOverview conditions={[
            { label: "Relay provider", detail: status?.gameDataProvider?.running ? "Current provider generation is available." : "The Relay provider is not running in this process.", configured: true, ok: Boolean(status?.gameDataProvider?.running), critical: true },
            { label: "Relay cache", detail: status?.gameDataProvider?.cacheReady ? "Last-good data is ready to serve." : "Cache is unavailable or still starting.", configured: true, ok: Boolean(status?.gameDataProvider?.cacheReady), critical: true },
            { label: "Discord delivery", detail: draft.discord.botTokenConfigured ? discordDeliveryLabel : "Optional: add a bot token in Discord Setup.", configured: Boolean(draft.discord.botTokenConfigured), ok: status?.discord?.mode === "live", optional: !draft.discord.botTokenConfigured },
            { label: "Reconciliation", detail: status?.polling?.enabled ? "Scheduled reconciliation is enabled." : status?.environment === "production" ? "Reconciliation is disabled." : "Unavailable in this local development process.", configured: Boolean(status?.polling?.enabled), ok: Boolean(status?.polling?.enabled), optional: status?.environment !== "production", localDevelopment: status?.environment !== "production" },
          ]} />
          <div className="metric-grid admin-metrics">
            <Stat icon={<Server />} label="Environment" value={status?.environment ?? "-"} />
            <Stat icon={<Database />} label="Database" value={bytesLabel(status?.databaseSize)} />
            <Stat icon={<CircleDollarSign />} label="Confirmed Trades" value={formatNumber(status?.counts?.market_trades)} />
            <Stat icon={<Activity />} label="Activity Events" value={formatNumber(status?.counts?.activity_events)} />
          </div>
          <section className="form-card">
            <div className="split-header"><div><h3><Server size={17} /> Health Summary</h3><p className="legend">Committed Relay generations serve current data immediately, with last-good snapshots retained during an outage.</p></div><div className="toolbar"><button className={busyButtonClass("status-refresh")} disabled={isBusyAction("status-refresh")} onClick={() => run(refreshStatus, undefined, "status-refresh")}><RefreshCw size={15} /> {isBusyAction("status-refresh") ? "Refreshing..." : "Refresh"}</button><button className={busyButtonClass("collect-now", "toolbar-button primary")} disabled={isBusyAction("collect-now")} onClick={() => run(collectNowWithLiveStatus, "Reconciliation run completed.", "collect-now")}><RefreshCw size={15} /> {isBusyAction("collect-now") ? "Reconciling..." : "Run Reconciliation"}</button></div></div>
            <details className="admin-operational-details">
              <summary>Provider, scheduler, and storage details</summary>
            <div className="status-detail">
              <Info label="Game data provider" value={status?.gameDataProvider?.running ? `Relay generation ${formatNumber(status.gameDataProvider.generation)}` : "Relay provider not running in this process"} />
              <Info label="Relay cache" value={status?.gameDataProvider?.cacheReady ? "Ready" : "Unavailable or starting"} />
              <Info label="Relay last refresh" value={dateLabel(status?.gameDataProvider?.lastRefreshAt)} />
              <Info label="Relay last error" value={status?.gameDataProvider?.lastError ?? "None"} />
              <Info label="Global catalog subscription" value={status?.gameDataProvider?.globalCatalog?.subscription?.connected
                ? `Live (${formatNumber(status.gameDataProvider.globalCatalog.sourceState?.rowCount ?? 0)} rows)`
                : status?.gameDataProvider?.globalCatalog?.subscription?.applied
                  ? `Last applied by worker (${formatNumber(status.gameDataProvider.globalCatalog.sourceState?.rowCount ?? 0)} rows)`
                  : "Unavailable or starting"} />
              <Info label="Global catalog last apply" value={dateLabel(status?.gameDataProvider?.globalCatalog?.subscription?.lastAppliedAt)} />
              <Info label="Global catalog last error" value={status?.gameDataProvider?.globalCatalog?.lastError
                ?? status?.gameDataProvider?.globalCatalog?.subscription?.lastError
                ?? "None"} />
              <Info label="Primary-region player subscription" value={status?.gameDataProvider?.primaryRegion?.subscription?.connected
                ? `Live (${status.gameDataProvider.primaryRegion.source?.sourceKey ?? "regional source"})`
                : status?.gameDataProvider?.primaryRegion?.subscription?.applied
                  ? `Last applied by worker (${status.gameDataProvider.primaryRegion.source?.sourceKey ?? "regional source"})`
                  : "Unavailable or starting"} />
              <Info label="Primary-region last apply" value={dateLabel(status?.gameDataProvider?.primaryRegion?.subscription?.lastAppliedAt)} />
              <Info label="Primary-region last error" value={status?.gameDataProvider?.primaryRegion?.lastError
                ?? status?.gameDataProvider?.primaryRegion?.subscription?.lastError
                ?? "None"} />
              <Info label="Discord delivery" value={status?.discord?.mode === "live" ? "Live delivery enabled" : "Automatic delivery recorded (manual sandbox tests only)"} />
              <Info label="Reconciliation cadence" value={status?.polling?.enabled ? `Enabled, every ${Math.round(status.polling.intervalMs / 1000)} seconds` : "Disabled; Relay provider health is shown above"} />
              <Info label="Last successful reconciliation" value={dateLabel(status?.polling?.lastSuccessAt)} />
              <Info label="Next reconciliation run" value={dateLabel(status?.polling?.nextRunAt)} />
              <Info label="Last error" value={status?.polling?.lastError ?? "None"} />
              <Info label="Discord delivery" value={discordDeliveryLabel} />
              <Info label="Storage" value={status?.storageLabel ?? "-"} />
            </div>
            <div className="status-detail collector-status-grid">
              {Object.entries(status?.polling?.collectors ?? {}).map(([key, collector]: [string, AnyRecord]) => (
                <Info
                  key={key}
                  label={collector.label ?? key}
                  value={collectorStatusValue(collector)}
                />
              ))}
            </div>
            </details>
          </section>
          <section className="form-card scheduled-jobs-card">
            <div className="split-header">
              <div>
                <h3><Clock size={17} /> Scheduled Jobs</h3>
                <p className="legend">Background jobs run on the local server. Click a job to edit when and how often it runs.</p>
              </div>
              <button className={busyButtonClass("jobs-refresh")} disabled={isBusyAction("jobs-refresh")} onClick={() => run(refreshScheduledJobs, undefined, "jobs-refresh")}><RefreshCw size={15} /> {isBusyAction("jobs-refresh") ? "Refreshing..." : "Refresh"}</button>
            </div>
            <div className="status-detail">
              <Info label="Scheduler" value={scheduledJobs?.enabled ? "Enabled" : "Disabled"} />
              <Info label="Server time" value={dateLabel(scheduledJobs?.serverTime)} />
            </div>
            <div className="scheduled-job-list">
              {(scheduledJobs?.jobs ?? []).map((job: AnyRecord) => {
                const expanded = expandedScheduledJobKey === job.key;
                const config = scheduledJobConfig(job);
                return (
                  <article
                    className={`scheduled-job-row ${expanded ? "is-expanded" : ""}`}
                    key={job.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedScheduledJobKey((current) => current === job.key ? null : String(job.key))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedScheduledJobKey((current) => current === job.key ? null : String(job.key));
                      }
                    }}
                  >
                    <div>
                      <strong>{job.label}</strong>
                      <span>{job.description}</span>
                      <small>
                        Schedule {job.scheduleLabel ?? job.schedule}
                        {" | "}
                        Last success {dateLabel(job.lastSuccessAt)}
                        {" | "}
                        Next run {scheduledJobTimingLabel(job, Boolean(scheduledJobs?.enabled))}
                      </small>
                      {job.running && job.metadata?.stage ? (
                        <small>
                          Current step: {scheduledJobProgressText(job.metadata)}
                        </small>
                      ) : null}
                      {job.lastError ? <small className="error">Last error: {job.lastError}</small> : null}
                    </div>
                    <div className="scheduled-job-actions" onClick={(event) => event.stopPropagation()}>
                      <span className={`role-option-status ${job.running ? "warn" : job.enabled ? "ok" : ""}`}>{job.running ? "Running" : job.enabled ? "Enabled" : "Disabled"}</span>
                      <label className="toggle-line compact-toggle">
                        <span>{job.enabled ? "Enabled" : "Disabled"}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(job.enabled)}
                          disabled={isBusyAction(`job-toggle:${job.key}`)}
                          onChange={(event) => run(async () => {
                            setScheduledJobs(await api("/admin/jobs", { method: "PUT", body: JSON.stringify({ key: job.key, enabled: event.target.checked }) }));
                          }, `Scheduled job ${event.target.checked ? "enabled" : "disabled"}.`, `job-toggle:${job.key}`)}
                        />
                      </label>
                      <button
                        className={busyButtonClass(`job-run:${job.key}`)}
                        title="Start this background job now without changing its saved schedule."
                        disabled={Boolean(job.running) || isBusyAction(`job-run:${job.key}`)}
                        onClick={() => run(async () => {
                          const result = await api("/admin/jobs/run", { method: "POST", body: JSON.stringify({ key: job.key }) });
                          setScheduledJobs(result);
                        }, "Scheduled job started.", `job-run:${job.key}`)}
                      >
                        <RefreshCw size={15} /> {isBusyAction(`job-run:${job.key}`) ? "Starting..." : "Run Now"}
                      </button>
                    </div>
                    {expanded ? (
                      <div className="scheduled-job-editor" onClick={(event) => event.stopPropagation()}>
                        <label className="inline-field">
                          <span>Frequency</span>
                          <select className="select-control" value={config.frequency ?? "daily"} onChange={(event) => updateScheduledJobDraft(job, { frequency: event.target.value })}>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </label>
                        {config.frequency === "weekly" ? (
                          <label className="inline-field">
                            <span>Day</span>
                            <select className="select-control" value={String(config.dayOfWeek ?? 1)} onChange={(event) => updateScheduledJobDraft(job, { dayOfWeek: Number(event.target.value) })}>
                              <option value="0">Sunday</option>
                              <option value="1">Monday</option>
                              <option value="2">Tuesday</option>
                              <option value="3">Wednesday</option>
                              <option value="4">Thursday</option>
                              <option value="5">Friday</option>
                              <option value="6">Saturday</option>
                            </select>
                          </label>
                        ) : null}
                        {config.frequency === "monthly" ? (
                          <label className="inline-field">
                            <span>Day of month</span>
                            <input className="select-control" type="number" min={1} max={28} value={String(config.dayOfMonth ?? 1)} onChange={(event) => updateScheduledJobDraft(job, { dayOfMonth: Math.min(28, Math.max(1, Math.floor(toNumber(event.target.value) || 1))) })} />
                          </label>
                        ) : null}
                        <label className="inline-field">
                          <span>Run time</span>
                          <input className="select-control" type="time" value={String(config.time ?? "00:00")} onChange={(event) => updateScheduledJobDraft(job, { time: event.target.value || "00:00" })} />
                        </label>
                        <div className="scheduled-job-editor-actions">
                          <button
                            className="toolbar-button"
                            title="Discard unsaved schedule edits for this job."
                            onClick={() => setScheduledJobDrafts((current) => {
                              const next = { ...current };
                              delete next[String(job.key)];
                              return next;
                            })}
                          >
                            Reset
                          </button>
                          <button
                            className="toolbar-button primary"
                            title="Save this job schedule. It does not run the job immediately."
                            disabled={isBusyAction(`job-save:${job.key}`)}
                            onClick={() => run(async () => {
                              const result = await api("/admin/jobs", { method: "PUT", body: JSON.stringify({ key: job.key, enabled: Boolean(job.enabled), scheduleConfig: scheduledJobConfig(job) }) });
                              setScheduledJobs(result);
                              setScheduledJobDrafts((current) => {
                                const next = { ...current };
                                delete next[String(job.key)];
                                return next;
                              });
                            }, "Scheduled job settings saved.", `job-save:${job.key}`)}
                          >
                            <Save size={14} /> Save Schedule
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
              {scheduledJobs && !(scheduledJobs.jobs ?? []).length ? <p className="legend">No scheduled jobs are registered.</p> : null}
              {!scheduledJobs ? <p className="legend">Loading scheduled jobs...</p> : null}
            </div>
          </section>
          <section className="form-card">
            <div className="split-header">
              <div>
                <h3><Activity size={17} /> Relay Endpoint Check</h3>
                <p className="legend">Runs live timing checks for public data sources and settlement storage containers.</p>
              </div>
              <button className={busyButtonClass("endpoint-checks")} title="Run bounded live timing checks against Relay endpoints and settlement storage containers." disabled={isBusyAction("endpoint-checks")} onClick={() => run(async () => setDiagnostics((await api("/admin/diagnostics", { method: "POST", body: "{}" })).checks ?? []), "Endpoint check completed.", "endpoint-checks")}><RefreshCw size={15} /> {isBusyAction("endpoint-checks") ? "Checking..." : "Run Checks"}</button>
            </div>
            {diagnostics.length ? (
              <div className="endpoint-check-panel">
                <div className="endpoint-summary-grid">
                  <Info label="Checks run" value={formatNumber(endpointChecks.length)} />
                  <Info label="Failures" value={formatNumber(endpointFailures.length)} />
                  <Info label="Slowest successful" value={slowestEndpoint ? `${slowestEndpoint.label} · ${formatNumber(slowestEndpoint.durationMs)} ms` : "-"} />
                  <Info label="Fastest successful" value={fastestEndpoint ? `${fastestEndpoint.label} · ${formatNumber(fastestEndpoint.durationMs)} ms` : "-"} />
                </div>
                <DataTable
                  scrollLabel="Endpoint diagnostics table"
                  emptyState="No analytics summary records were returned."
                  rows={endpointChecks}
                  columns={[
                    ["Endpoint", (check) => <span className="endpoint-name">{check.label}</span>],
                    ["Status", (check) => <span className={`endpoint-status ${check.ok ? "ok" : "fail"}`}>{check.ok ? "Healthy" : "Failed"}</span>],
                    ["Duration", (check) => check.ok ? `${formatNumber(check.durationMs)} ms` : "-"],
                    ["Detail", (check) => check.ok ? "Request completed successfully" : String(check.error ?? "Request failed")],
                  ]}
                />
              </div>
            ) : <p className="legend">Run checks to time public data sources, including each settlement storage container used for Activity history.</p>}
          </section>
        </div>
      ) : null}

      {tab === "analytics" ? (
        <div className="admin-section analytics-admin">
          <AdminAnalyticsSection
            tab="analytics"
            data={{ analyticsDays, analyticsData, visitorSecurityData, securityEventSearch, securityEventPage, securityEventPageSize, auditData, auditFilter, auditVisibleCount }}
            pending={isBusyAction}
            error={messageKind === "error" ? message : null}
            result={message && messageKind !== "error" ? { message, kind: messageKind } : null}
            onAnalyticsDaysChange={(days) => { setAnalyticsDays(days); setSecurityEventPage(1); }}
            onClearAnalytics={() => setActionConfirmation({ title: "Clear usage analytics", target: "All opt-in usage analytics", impact: "Deletes all collected usage analytics records. Security request logs are not affected.", reversible: false, confirmLabel: "Clear analytics", tone: "danger", onConfirm: () => run(async () => { await api("/admin/analytics", { method: "DELETE", body: "{}" }); await refreshAnalytics(); }, "Usage analytics deleted.", "analytics-clear") })}
            onSecurityEventSearchChange={(search) => { setSecurityEventSearch(search); setSecurityEventPage(1); }}
            onSecurityEventPageChange={setSecurityEventPage}
            onSecurityEventPageSizeChange={(pageSize) => { setSecurityEventPageSize(pageSize); setSecurityEventPage(1); }}
            onAuditFilterChange={(filter) => { setAuditFilter(filter); setAuditVisibleCount(30); }}
            onLoadMoreAudit={() => setAuditVisibleCount((count) => count + 30)}
            onRefreshAudit={() => run(refreshAudit, undefined, "audit-refresh")}
          />
        </div>
      ) : null}

      {tab === "empire-membership" ? (
        <div className="admin-section empire-membership-admin">
          <AdminEmpireMembershipSection
            data={empireMembershipData}
            pending={tabLoadPending || isBusyAction("empire-membership-refresh")}
            error={messageKind === "error" ? message : null}
            onRefresh={() => run(refreshEmpireMembership, undefined, "empire-membership-refresh")}
          />
        </div>
      ) : null}

      {tab === "diagnostics" ? (
        <div className="admin-section diagnostics-admin">
          <section className="form-card diagnostics-support-card">
            <div className="split-header">
              <div>
                <h3><Activity size={17} /> Support snapshot</h3>
                <p className="legend">Quick, redacted state for debugging the local app without exposing tokens or secrets.</p>
              </div>
              <div className="toolbar">
                <button className={busyButtonClass("diagnostics-refresh")} disabled={isBusyAction("diagnostics-refresh")} onClick={() => run(async () => { await refreshStatus(); await refreshPopupDiagnostics(); }, "Diagnostics refreshed.", "diagnostics-refresh")}><RefreshCw size={15} /> Refresh</button>
                <button className="toolbar-button" disabled={isBusyAction("copy-support-snapshot")} onClick={() => run(copySupportSnapshot, undefined, "copy-support-snapshot")}><Save size={15} /> Copy Support Snapshot</button>
              </div>
            </div>
            <div className="status-detail diagnostics-health-grid">
              <Info label="Runtime" value={status?.environment ?? "Not loaded"} />
              <Info label="Local API health" value={status ? "Responding" : "Not checked"} />
              <Info label="Storage" value={status?.storageLabel ?? "-"} />
              <Info label="Database size" value={bytesLabel(status?.databaseSize)} />
              <Info label="Endpoint checks" value={diagnostics.length ? `${formatNumber(endpointFailures.length)} failing, ${formatNumber(endpointSuccesses.length)} passing` : "Not run"} />
              <Info label="Public popup count" value={popupDiagnostics ? formatNumber(publicPopupCount) : "Not loaded"} />
              <Info label="Audit rows loaded" value={`${formatNumber(auditRows.length)} actions, ${formatNumber(loginRows.length)} sign-ins`} />
              <Info label="Map URL log entries" value={formatNumber(mapUrlLog.length)} />
            </div>
            <code className="support-snapshot-code">{JSON.stringify(supportSnapshot, null, 2)}</code>
          </section>
          <section className="form-card map-url-diagnostics">
            <div className="split-header">
              <div>
                <h3><MapIcon size={17} /> Map URL Diagnostics</h3>
                <p className="legend">Records generated BitCraft map URLs so you can confirm player, resource, region, and focus parameters.</p>
              </div>
              <button className="toolbar-button" title="Delete saved map diagnostic entries from this browser." disabled={!mapUrlLog.length} onClick={() => setMapUrlLog([])}><X size={14} /> Clear Log</button>
            </div>
            {mapUrlLog.length ? (
              <>
                <div className="map-url-diagnostic-grid">
                  <Info label="Latest map log" value={mapUrlLog[0]?.at ? dateLabel(mapUrlLog[0].at) : "Not recorded"} />
                  <Info label="Roster source" value={String(mapUrlLog[0].rosterSource ?? "-")} />
                  <Info label="Settlement members" value={formatNumber(mapUrlLog[0].memberCount)} />
                  <Info label="Roster players" value={formatNumber(mapUrlLog[0].rosterCount)} />
                  <Info label="Detail failures" value={formatNumber(mapUrlLog[0].playerDetailFailed)} />
                  <Info label="Tracked players" value={formatNumber(mapUrlLog[0].selectedPlayerIds?.length)} />
                </div>
                <details className="diagnostics-raw-details">
                  <summary>Latest raw map entry</summary>
                  <code>{JSON.stringify(mapUrlLog[0], null, 2)}</code>
                </details>
                <div className="map-url-log-list">
                  {mapUrlLog.slice(0, 30).map((entry) => (
                    <article key={`${entry.at}-${entry.url}`}>
                      <time>{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                      <span>{entry.rosterSource ?? "unknown"} roster, {formatNumber(entry.selectedPlayerIds?.length)} players, R {entry.regionIdParam || "-"}</span>
                      <small>{entry.playerIdParam || "no playerId"}</small>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <MapIcon size={32} />
                <strong>No map diagnostics yet</strong>
                <span>Open the Map page and change tracked players, resources or regions to record generated URL entries here.</span>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "configuration" ? (
        <>
        <AdminConfigurationNav active={configurationSection} onSelect={selectConfigurationSection} />
        <div className={`admin-grid configuration-category configuration-category-${configurationSection}`}>
          <section className="form-card">
            {configurationSection === "general" ? <>
            <h3><Shield size={17} /> Settlement Defaults</h3>
            <label className="field"><span>Settlement ID</span><input value={draft.claimId} onChange={(event) => updateDraft("claimId", event.target.value)} /></label>
            <label className="field"><span>BitCraft Sync URL</span><input value={draft.syncUrl} onChange={(event) => updateDraft("syncUrl", event.target.value)} /></label>
            <label className="field"><span>Default opening page</span><select value={draft.defaultPage} onChange={(event) => updateDraft("defaultPage", event.target.value as ActivePanel)}>{NAV.filter(([id]) => id !== "admin").map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="field"><span>Public Crafts default region ID</span><input value={draft.defaultRegion} onChange={(event) => updateDraft("defaultRegion", event.target.value)} placeholder="Use settlement region" /></label>
            <label className="field"><span>Additional active region IDs</span><input value={draft.additionalActiveRegions} onChange={(event) => updateDraft("additionalActiveRegions", event.target.value)} placeholder="Optional, e.g. 22,24" /></label>
            <div className="configuration-timing-grid">
              <label className="field unit-field">
                <span>Display refresh interval</span>
                <div className="unit-input"><input type="number" min={15} max={300} value={draft.refreshSeconds} onChange={(event) => updateDraft("refreshSeconds", Number(event.target.value))} /><em>seconds</em></div>
                <small>How often browser tabs refresh live page data through the local proxy.</small>
              </label>
              <label className="field unit-field">
                <span>Reconciliation cadence</span>
                <div className="unit-input"><input type="number" min={15} max={300} value={draft.serverRefreshSeconds} onChange={(event) => updateDraft("serverRefreshSeconds", Number(event.target.value))} /><em>seconds</em></div>
                <small>Cadence only for the two blocked evidence imports and independent maintenance; it never refreshes current page data.</small>
              </label>
            </div>
            </> : null}
            {configurationSection === "privacy" ? <>
            <h3><Lock size={17} /> Access & Privacy</h3>
            <div className="configuration-timing-grid">
              <label className="field unit-field">
                <span>Full IP retention</span>
                <div className="unit-input"><input type="number" min={1} max={30} value={draft.visitorSecurity.fullIpRetentionDays} onChange={(event) => updateVisitorSecuritySetting({ fullIpRetentionDays: Number(event.target.value) })} /><em>days</em></div>
                <small>Full visitor IPs are cleared after this window; anonymised stats remain.</small>
              </label>
              <label className="field unit-field">
                <span>Visitor stats retention</span>
                <div className="unit-input"><input type="number" min={30} max={730} value={draft.visitorSecurity.statsRetentionDays} onChange={(event) => updateVisitorSecuritySetting({ statsRetentionDays: Number(event.target.value) })} /><em>days</em></div>
                <small>How long anonymised security/location statistics are kept.</small>
              </label>
              <label className="field unit-field">
                <span>GeoIP cache</span>
                <div className="unit-input"><input type="number" min={1} max={90} value={draft.visitorSecurity.geoipCacheDays} onChange={(event) => updateVisitorSecuritySetting({ geoipCacheDays: Number(event.target.value) })} /><em>days</em></div>
                <small>How long third-party IP location lookups are cached locally.</small>
              </label>
            </div>
            </> : null}
            {configurationSection === "notifications" ? (
            <div className="form-card nested-card">
              <h3><Bell size={17} /> In-app notification defaults</h3>
              <p className="legend">Global switches for browser toast notifications. Users keep their own preferences, but disabled types are blocked until re-enabled here.</p>
              <div className="notification-default-list">
                {([
                  ["marketListings", "New market listings", "Show toasts for newly tracked market listings."],
                  ["marketSales", "Confirmed market sales", "Show toasts for confirmed market sale activity."],
                  ["production", "Production starts and completions", "Show toasts for craft start and completion activity."],
                ] as const).map(([key, label, detail]) => (
                  <label className="toggle-line" key={key}>
                    <input type="checkbox" checked={draft.toastSettings[key] !== false} onChange={(event) => updateToastSetting(key, event.target.checked)} />
                    <span><strong>{label}</strong><small>{detail}</small></span>
                  </label>
                ))}
              </div>
            </div>
            ) : null}
            {configurationSection === "privacy" ? (
            <div className="form-card nested-card access-control-card">
              <div className="split-header">
                <div>
                  <h3><Lock size={17} /> Access Control</h3>
                  <p className="legend">Restrict public app pages and first-level tabs by Discord sign-in, character verification, or selected Discord users. Admin pages stay separate.</p>
                </div>
                <div className="toolbar-row">
                  <button className="toolbar-button" type="button" disabled={isBusyAction("access-control-refresh")} onClick={() => run(refreshAccessControl, undefined, "access-control-refresh")}><RefreshCw size={14} /> Refresh</button>
                  <button className="toolbar-button primary" type="button" disabled={!accessControlState || isBusyAction("access-control-save")} onClick={saveAccessControl}><Save size={14} /> Save Access</button>
                </div>
              </div>
              {!accessControlState ? <p className="legend">Loading access control settings...</p> : (
                <div className="access-control-list">
                  {pageAccessTargets().map((pageTarget) => {
                    const pageRule = accessRule(pageTarget.id);
                    const pageTabs = tabAccessTargets(pageTarget.page);
                    const accounts = accessControlState.accounts ?? [];
                    const renderSpecificUsers = (targetId: string, selectedIds: string[]) => (
                      <label className="field access-user-select">
                        <span>Allowed Discord users</span>
                        <select multiple value={selectedIds} onChange={(event) => updateAccessRule(targetId, { allowedDiscordIds: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })}>
                          {accounts.map((account) => {
                            const label = account.characterName || account.globalName || account.username || account.discordId || `User ${account.id}`;
                            return <option key={account.discordId || account.id} value={String(account.discordId ?? "")}>{label} - {account.username || account.discordId} {account.characterStatus ? `(${account.characterStatus})` : ""}</option>;
                          })}
                        </select>
                      </label>
                    );
                    return (
                      <article className="access-control-group" key={pageTarget.id}>
                        <div className="access-control-row">
                          <strong>{pageTarget.label}</strong>
                          <label className="field compact-field">
                            <span>Restriction</span>
                            <select value={pageRule.mode} onChange={(event) => updateAccessRule(pageTarget.id, { mode: event.target.value as AccessRuleMode })}>
                              {ACCESS_RULE_MODES.map((mode) => <option key={mode.mode} value={mode.mode}>{mode.label}</option>)}
                            </select>
                          </label>
                        </div>
                        {pageRule.mode === "specificUsers" ? renderSpecificUsers(pageTarget.id, pageRule.allowedDiscordIds ?? []) : null}
                        {pageTabs.length ? (
                          <div className="access-control-tabs">
                            {pageTabs.map((tabTarget) => {
                              const tabRule = accessRule(tabTarget.id);
                              return (
                                <div className="access-control-tab-row" key={tabTarget.id}>
                                  <span>{tabTarget.label}</span>
                                  <label className="field compact-field">
                                    <span>Restriction</span>
                                    <select value={tabRule.mode} onChange={(event) => updateAccessRule(tabTarget.id, { mode: event.target.value as AccessRuleMode })}>
                                      {ACCESS_RULE_MODES.map((mode) => <option key={mode.mode} value={mode.mode}>{mode.label}</option>)}
                                    </select>
                                  </label>
                                  {tabRule.mode === "specificUsers" ? renderSpecificUsers(tabTarget.id, tabRule.allowedDiscordIds ?? []) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
            ) : null}
            {configurationSection === "integrations" ? <AdminCraftPlanSection /> : null}
            {configurationSection === "privacy" ? (
            <div className="form-card nested-card">
              <h3><MapPin size={17} /> GeoIP Location Source</h3>
              <p className="legend">Choose how visitor IPs are converted into approximate country/city statistics. ipapi.co is queried server-side only when a cached location is missing.</p>
              <label className="field">
                <span>Provider</span>
                <select value={draft.visitorSecurity.geoipProvider} onChange={(event) => updateVisitorSecuritySetting({ geoipProvider: event.target.value })}>
                  <option value="ipapi">ipapi.co cached lookup</option>
                  <option value="local">Local GeoIP database</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              {draft.visitorSecurity.geoipProvider === "ipapi" ? (
                <p className="legend">Provider mode avoids large local imports. Locations are approximate, cached for {draft.visitorSecurity.geoipCacheDays} days, and fall back to Unknown if the provider is unavailable.</p>
              ) : null}
              {draft.visitorSecurity.geoipProvider === "local" ? (
                <>
                  <p className="legend">Local database mode uses a MaxMind GeoLite2 City CSV ZIP. This avoids third-party lookups but can be heavy on small VPS plans.</p>
                  <label className="field">
                    <span>GeoIP source URL</span>
                    <input value={draft.visitorSecurity.geoipSourceUrl} onChange={(event) => updateVisitorSecuritySetting({ geoipSourceUrl: event.target.value })} placeholder="https://download.maxmind.com/geoip/databases/GeoLite2-City-CSV/download?suffix=zip" />
                  </label>
                  <div className="form-grid two">
                    <label className="field">
                      <span>MaxMind account ID</span>
                      <input value={draft.visitorSecurity.geoipAccountId} onChange={(event) => updateVisitorSecuritySetting({ geoipAccountId: event.target.value })} placeholder="Account ID" />
                    </label>
                    <label className="field">
                      <span>MaxMind license key</span>
                      <input type="password" value={draft.visitorSecurity.geoipLicenseKey ?? ""} onChange={(event) => updateVisitorSecuritySetting({ geoipLicenseKey: event.target.value, geoipClearLicenseKey: false })} placeholder={draft.visitorSecurity.geoipLicenseKeyConfigured ? "Configured - enter a new key to replace" : "License key"} />
                    </label>
                  </div>
                  <div className="toolbar-row">
                    <span className={draft.visitorSecurity.geoipLicenseKeyConfigured ? "status-pill ok" : "status-pill"}>{draft.visitorSecurity.geoipLicenseKeyConfigured ? "License key configured" : "No license key saved"}</span>
                    {draft.visitorSecurity.geoipLicenseKeyConfigured ? <button className="toolbar-button" type="button" title="Mark the saved MaxMind key for removal when configuration is saved." onClick={() => updateVisitorSecuritySetting({ geoipLicenseKey: "", geoipLicenseKeyConfigured: false, geoipClearLicenseKey: true })}>Clear saved key</button> : null}
                  </div>
                </>
              ) : null}
              {draft.visitorSecurity.geoipProvider === "disabled" ? <p className="legend">Location statistics will show Unknown while request logging and abuse-prevention records continue.</p> : null}
            </div>
            ) : null}
            {configurationSection === "notifications" ? (
            <div className="form-card nested-card">
              <h3><ShoppingCart size={17} /> Market Deal Watch</h3>
              <p className="legend">Discord-signed-in users can watch live regional sell orders. Every committed Relay generation is checked immediately; the scheduled job is reconciliation only.</p>
              <div className="configuration-timing-grid compact-grid">
                <label className="field unit-field">
                  <span>Max watches per user</span>
                  <div className="unit-input"><input type="number" min={1} max={100} value={draft.marketDealWatch.maxWatchesPerUser} onChange={(event) => updateMarketDealWatchSetting({ maxWatchesPerUser: Number(event.target.value) })} /><em>items</em></div>
                </label>
                <label className="field unit-field">
                  <span>Default deal threshold</span>
                  <div className="unit-input"><input type="number" min={1} max={95} value={draft.marketDealWatch.thresholdPercent} onChange={(event) => updateMarketDealWatchSetting({ thresholdPercent: Number(event.target.value) })} /><em>% below median</em></div>
                </label>
                <label className="field unit-field">
                  <span>Minimum active sell listings</span>
                  <div className="unit-input"><input type="number" min={1} max={100} value={draft.marketDealWatch.minActiveListings} onChange={(event) => updateMarketDealWatchSetting({ minActiveListings: Number(event.target.value) })} /><em>listings</em></div>
                </label>
              </div>
              <label className="toggle-line">
                <input type="checkbox" checked={draft.marketDealWatch.discordDmEnabled !== false} onChange={(event) => updateMarketDealWatchSetting({ discordDmEnabled: event.target.checked })} />
                <span><strong>Send Discord DMs when possible</strong><small>In-app alerts are still recorded if a DM cannot be delivered.</small></span>
              </label>
            </div>
            ) : null}
          </section>
          {configurationSection === "notifications" ? <AdminPopupsSection api={api} /> : null}
          {configurationSection === "integrations" || configurationSection === "branding" ? (
          <div className="admin-section">
            {configurationSection === "integrations" ? (
            <section className="form-card member-tracking-card">
              <div className="split-header">
                <div>
                  <h3><Users size={17} /> Member Tracking</h3>
                  <p className="legend">Members are visible by default. Disable tracking for players who joined the claim but should be hidden from member-derived pages and filters.</p>
                </div>
                <span className="role-option-status">{formatNumber(draft.excludedMemberIds.length)} hidden</span>
              </div>
              <div className="member-tracking-list">
                {adminMemberRows.length ? adminMemberRows.map((member) => {
                  const id = memberTrackingId(member);
                  const tracked = id ? !draft.excludedMemberIds.includes(id) : true;
                  return (
                    <label className={`toggle-line member-tracking-row ${tracked ? "" : "is-hidden"}`} key={id || memberDisplayName(member)}>
                      <span>
                        <strong>{memberDisplayName(member)}</strong>
                        <small>{id || "No stable player ID returned by Relay"}</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={tracked}
                        disabled={!id}
                        onChange={(event) => setMemberTracking(member, event.target.checked)}
                      />
                    </label>
                  );
                }) : <p className="legend">Member data has not loaded yet. Wait for the Relay member generation, then return here to configure per-player tracking.</p>}
              </div>
            </section>
            ) : null}
            {configurationSection === "branding" ? (
            <section className="form-card">
              <h3><Upload size={17} /> Branding</h3>
              {(["logo", "favicon"] as const).map((type) => {
                const asset = draft.branding?.[type];
                return <div className="brand-upload" key={type}><div>{asset ? <img src={`${asset.url}?v=${encodeURIComponent(asset.updatedAt)}`} alt="" /> : <Shield size={25} />}<strong>{type === "logo" ? "App Logo" : "Browser Favicon"}</strong></div><label className="toolbar-button"><Upload size={14} /> Upload<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadBrand(type, event.target.files?.[0])} /></label>{asset ? <button className="toolbar-button" onClick={() => removeBrand(type)}><X size={14} /> Remove</button> : null}</div>;
              })}
              <p className="legend">PNG, JPG or WebP up to 1 MB. The logo is shown in the app chrome and the favicon is used by the browser tab.</p>
            </section>
            ) : null}
          </div>
          ) : null}
          {hasUnsavedSettings ? (
            <div className="configuration-save-bar" role="status" aria-live="polite">
              <span><strong>Unsaved changes</strong> in {configurationSection === "privacy" ? "Access & Privacy" : configurationSection[0].toUpperCase() + configurationSection.slice(1)}.</span>
              <div className="toolbar-row">
                <button className="toolbar-button" type="button" onClick={revertSettings}>Discard</button>
                <button className="toolbar-button primary" type="button" disabled={isBusyAction("settings-save")} onClick={saveSettings}><Save size={15} /> Save changes</button>
              </div>
            </div>
          ) : null}
        </div>
        </>
      ) : null}

      {tab === "discord" ? (
        <div className="admin-section bot-dashboard bot-console-workspace">
          {botOnly ? (
            <>
              <BotHealthSummary health={botHealth} onSelectSection={setBotSection} />
            </>
          ) : null}
          <div className={botOnly ? "bot-layout bot-console-layout" : ""}>
          <React.Suspense fallback={<div className="loading">Loading Discord controls...</div>}>
          {botOnly ? (
            <>
              <div className="bot-desktop-section-nav bot-console-nav">
                <BotSectionNav active={botSection} onSelect={setBotSection} />
              </div>
              <BotMobileSectionNav active={botSection} onSelect={setBotSection} />
            </>
          ) : null}
        <div className={`admin-grid discord-admin${botOnly ? ` bot-admin-section bot-section-${botSection}` : ""}`}>
          {(!botOnly || botSection === "setup") ? (
            <DiscordSetupSection
              discord={draft.discord}
              discordDiscovery={discordDiscovery}
              discoveredChannelCount={discoveredChannels.length}
              discoveredRoleCount={discoveredRoles.length}
              formatNumber={formatNumber}
              onSync={() => run(refreshDiscordDiscovery, "Discord server data synced.", "discord-setup-sync")}
              status={status}
              updateDiscord={updateDiscord}
              updateDiscordPresence={updateDiscordPresence}
            />
          ) : null}
          {(!botOnly || botSection === "channels") ? (
            <DiscordChannelsSection
              botOnly={botOnly}
              channelFields={DISCORD_CHANNEL_FIELDS}
              channelIdSelect={channelIdSelect}
              discordChannelLabel={discordChannelLabel}
              discordChannels={draft.discord.channels}
              discoveredChannelCount={discoveredChannels.length}
              updateDiscordChannel={updateDiscordChannel}
            />
          ) : null}
          {(!botOnly || botSection === "roleManager") ? (
            <DiscordRoleManagerSection
              discoveredRoles={discoveredRoles}
              formatNumber={formatNumber}
              memberCountWarning={memberCountWarning}
              isPending={isBusyAction}
              onCreateRole={() => run(createDiscordRoleFromDashboard, "Discord role created.", "discord-role-create")}
              onSyncRoles={() => run(refreshDiscordDiscovery, "Discord roles synced.", "discord-role-sync")}
              roleDraft={roleDraft}
              roleStatusText={roleStatusText}
              setRoleDraft={setRoleDraft}
            />
          ) : null}
          {(!botOnly || botSection === "roles") ? (
            <DiscordCraftWatchRolesSection
              botOnly={botOnly}
              craftRoleKeys={Object.keys(DEFAULT_CRAFT_ROLES)}
              craftRoles={draft.discord.craftRoles}
              craftEmojis={draft.discord.craftEmojis}
              discoveredRoles={discoveredRoles}
              discoveredEmojis={discoveredEmojis}
              emojiSelect={emojiSelect}
              memberCountWarning={memberCountWarning}
              roleIdSelect={roleIdSelect}
              roleStatusText={roleStatusText}
              updateDiscordCraftEmoji={updateDiscordCraftEmoji}
              updateDiscordRole={updateDiscordRole}
            />
          ) : null}
          {(!botOnly || botSection === "colours") ? (
            <DiscordColourRolesSection
              addDiscordColourRole={addDiscordColourRole}
              channelIdSelect={channelIdSelect}
              colourRoles={draft.discord.colourRoles}
              colourRolesChannelId={draft.discord.colourRolesChannelId}
              discoveredRoles={discoveredRoles}
              discordColorToHex={discordColorToHex}
              hexToDiscordColor={hexToDiscordColor}
              memberCountWarning={memberCountWarning}
              isPending={isBusyAction}
              onPostSelector={() => run(async () => { await api("/admin/discord/colour-roles/post", { method: "POST", body: "{}" }); }, "Colour role selector posted.", "discord-colours-post")}
              onSyncRoles={() => run(syncDiscordColourRoles, "Colour roles created and synced.", "discord-colours-sync")}
              removeDiscordColourRole={removeDiscordColourRole}
              roleStatusText={roleStatusText}
              updateDiscord={updateDiscord}
              updateDiscordColourRole={updateDiscordColourRole}
            />
          ) : null}
          {(!botOnly || botSection === "community") ? <DiscordRolePanelsSection
            expandedRoleOption={expandedRoleOption}
            roleById={roleById}
            roleIdSelect={roleIdSelect}
            rolePanels={draft.discord.rolePanels}
            channelIdSelect={channelIdSelect}
            onAddOption={addDiscordRolePanelOption}
            isPending={isBusyAction}
            onPostPanel={(panelKey, panelLabel) => run(async () => postRolePanel(panelKey), `${panelLabel} posted or updated.`, `discord-role-panel:${panelKey}`)}
            onPostWelcome={() => run(postWelcomeFlow, "Welcome message posted or updated.", "discord-welcome-post")}
            onRemoveOption={removeDiscordRolePanelOption}
            onSetExpandedRoleOption={setExpandedRoleOption}
            onUpdateOption={updateDiscordRolePanelOption}
            onUpdatePanel={updateDiscordRolePanel}
            onUpdateWelcomeFlow={updateWelcomeFlow}
            roleStatusText={roleStatusText}
            welcomeFlow={draft.discord.welcomeFlow}
          /> : null}
          {(!botOnly || botSection === "moderation") ? (
            <DiscordModerationSection
              channelIdSelect={channelIdSelect}
              confirmModeration={confirmModeration}
              discordToolResult={discordToolResult}
              discoveredMemberCount={discoveredMembers.length}
              memberIdSelect={memberIdSelect}
              moderationDraft={moderationDraft}
              isPending={isBusyAction}
              onBan={() => run(async () => runModerationAction("ban"), "Ban sent to Discord.", "discord-moderation-ban")}
              onKick={() => run(async () => runModerationAction("kick"), "Kick sent to Discord.", "discord-moderation-kick")}
              onLoadBans={() => run(async () => setDiscordToolResult({ ...await api("/admin/discord/moderation/bans"), __type: "moderationBans" }), "Ban list loaded.", "discord-moderation-bans-load")}
              onPurge={() => run(async () => runModerationAction("purge"), "Channel cleanup sent to Discord.", "discord-moderation-purge")}
              onRemoveTimeout={() => run(async () => { setModerationDraft((current) => ({ ...current, timeoutMinutes: "0" })); const result = await api("/admin/discord/moderation/timeout", { method: "POST", body: JSON.stringify({ userId: moderationDraft.userId, minutes: 0, reason: moderationDraft.reason }) }); setDiscordToolResult({ ...result, __type: "moderationAction" }); }, "Timeout removed.", "discord-moderation-timeout-remove")}
              onSync={() => run(refreshDiscordDiscovery, "Discord members, channels and roles synced.", "discord-moderation-sync")}
              onTempBan={() => run(async () => runBotEndpoint("/admin/discord/moderation/temp-ban", { userId: moderationDraft.userId, hours: Number(moderationDraft.timeoutMinutes), reason: moderationDraft.reason, deleteMessageSeconds: Number(moderationDraft.deleteMessageSeconds) }, "moderationAction"), "Temporary ban recorded.", "discord-moderation-temp-ban")}
              onTimeout={() => run(async () => runModerationAction("timeout"), "Timeout action sent to Discord.", "discord-moderation-timeout")}
              onUnban={() => run(async () => runModerationAction("unban"), "Unban sent to Discord.", "discord-moderation-unban")}
              renderDiscordToolResult={renderDiscordToolResult}
              setModerationDraft={setModerationDraft}
            />
          ) : null}
          {(!botOnly || botSection === "safety") ? (
            <DiscordSafetySection
              channelIdSelect={channelIdSelect}
              confirmModeration={confirmModeration}
              discordToolResult={discordToolResult}
              isPending={isBusyAction}
              onApplySlowmode={() => run(async () => runBotEndpoint("/admin/discord/moderation/slowmode", { channelId: safetyDraft.lockdownChannelId, seconds: Number(safetyDraft.slowmodeSeconds) }, "botAction"), "Slowmode updated.", "discord-slowmode")}
              onCreateAutomodRule={() => run(async () => runBotEndpoint("/admin/discord/moderation/automod", { name: safetyDraft.ruleName, blockedWords: safetyDraft.blockedWords }, "botAction"), "Auto-moderation rule created.", "discord-automod-create")}
              onLoadAutomodRules={() => run(async () => setDiscordToolResult({ ...await api("/admin/discord/moderation/automod"), __type: "botReport" }), "Auto-moderation rules loaded.", "discord-automod-load")}
              onLockChannel={() => run(async () => runBotEndpoint("/admin/discord/moderation/lockdown", { channelId: safetyDraft.lockdownChannelId, locked: true }, "botAction"), "Channel locked.", "discord-channel-lock")}
              onNicknameReport={() => run(async () => runBotEndpoint("/admin/discord/moderation/nickname-report", { pattern: safetyDraft.nicknamePattern }, "botReport"), "Nickname report loaded.", "discord-nickname-report")}
              onSync={() => run(refreshDiscordDiscovery, "Discord server data synced.", "discord-safety-sync")}
              onUnlockChannel={() => run(async () => runBotEndpoint("/admin/discord/moderation/lockdown", { channelId: safetyDraft.lockdownChannelId, locked: false }, "botAction"), "Channel unlocked.", "discord-channel-unlock")}
              renderDiscordToolResult={renderDiscordToolResult}
              safetyDraft={safetyDraft}
              setSafetyDraft={setSafetyDraft}
            />
          ) : null}
          {(!botOnly || botSection === "records") ? (
            <DiscordMemberRecordsSection
              confirmModeration={confirmModeration}
              discordToolResult={discordToolResult}
              memberIdSelect={memberIdSelect}
              onAddNote={() => run(async () => runBotEndpoint("/admin/discord/moderation/notes", recordsDraft, "botAction"), "Mod note saved.", "discord-record-note")}
              onAddWarning={() => run(async () => runBotEndpoint("/admin/discord/moderation/warnings", recordsDraft, "botAction"), "Warning recorded.", "discord-record-warning")}
              onClearWarnings={() => run(async () => runBotEndpoint("/admin/discord/moderation/warnings/clear", recordsDraft, "botAction"), "Warnings cleared.", "discord-record-warnings-clear")}
              onLoadCaseLog={() => run(async () => setDiscordToolResult({ ...await api("/admin/discord/moderation/cases"), __type: "botReport" }), "Case log loaded.", "discord-record-cases")}
              onLoadNotes={() => run(async () => runBotEndpoint("/admin/discord/moderation/notes/list", recordsDraft, "botReport"), "Mod notes loaded.", "discord-record-notes")}
              onLoadProfile={() => run(async () => runBotEndpoint("/admin/discord/moderation/profile", recordsDraft, "botReport"), "Member profile loaded.", "discord-record-profile")}
              onLoadWarnings={() => run(async () => runBotEndpoint("/admin/discord/moderation/warnings/list", recordsDraft, "botReport"), "Warnings loaded.", "discord-record-warnings")}
              onSync={() => run(refreshDiscordDiscovery, "Discord members synced.", "discord-records-sync")}
              recordsDraft={recordsDraft}
              renderDiscordToolResult={renderDiscordToolResult}
              setRecordsDraft={setRecordsDraft}
            />
          ) : null}
          {(!botOnly || botSection === "content") ? <section className="form-card discord-channel-card bot-tools-card">
            <div className="split-header"><div><h3><MessageCircle size={17} /> Posts & Events</h3><p className="legend">Create polls, RSVP posts and clean embeds for Discord-only community management.</p></div></div>
            <div className="discord-tool-forms">
              <div className="discord-tool-form-card"><h4><CircleHelp size={15} /> Poll</h4><label className="field"><span>Channel</span>{channelIdSelect(pollDraft.channelId, (value) => setPollDraft((current) => ({ ...current, channelId: value })))}</label><label className="field"><span>Title</span><input value={pollDraft.title} onChange={(event) => setPollDraft((current) => ({ ...current, title: event.target.value }))} /></label><label className="field"><span>Options</span><textarea value={pollDraft.options} onChange={(event) => setPollDraft((current) => ({ ...current, options: event.target.value }))} placeholder="One option per line" /></label><button className="toolbar-button primary bot-post-button" disabled={isBusyAction("discord-poll-post")} onClick={() => run(async () => runBotEndpoint("/admin/discord/poll", pollDraft, "botAction"), "Poll posted.", "discord-poll-post")}><MessageCircle size={14} /> Post Poll</button></div>
              <div className="discord-tool-form-card"><h4><Bell size={15} /> Event RSVP</h4><label className="field"><span>Channel</span>{channelIdSelect(rsvpDraft.channelId, (value) => setRsvpDraft((current) => ({ ...current, channelId: value })))}</label><label className="field"><span>Title</span><input value={rsvpDraft.title} onChange={(event) => setRsvpDraft((current) => ({ ...current, title: event.target.value }))} /></label><label className="field"><span>Description</span><textarea value={rsvpDraft.description} onChange={(event) => setRsvpDraft((current) => ({ ...current, description: event.target.value }))} /></label><button className="toolbar-button primary bot-post-button" disabled={isBusyAction("discord-rsvp-post")} onClick={() => run(async () => runBotEndpoint("/admin/discord/rsvp", rsvpDraft, "botAction"), "RSVP posted.", "discord-rsvp-post")}><Bell size={14} /> Post RSVP</button></div>
              <div className="discord-tool-form-card"><h4><Star size={15} /> Clean Embed Builder</h4><label className="field"><span>Channel</span>{channelIdSelect(embedDraft.channelId, (value) => setEmbedDraft((current) => ({ ...current, channelId: value })))}</label><label className="field"><span>Title</span><input value={embedDraft.title} onChange={(event) => setEmbedDraft((current) => ({ ...current, title: event.target.value }))} /></label><label className="field"><span>Message</span><textarea value={embedDraft.description} onChange={(event) => setEmbedDraft((current) => ({ ...current, description: event.target.value }))} /></label><label className="colour-picker-field"><input type="color" value={embedDraft.color} onChange={(event) => setEmbedDraft((current) => ({ ...current, color: event.target.value }))} /><code>{embedDraft.color}</code></label><button className="toolbar-button primary bot-post-button" disabled={isBusyAction("discord-embed-post")} onClick={() => run(async () => runBotEndpoint("/admin/discord/embed", embedDraft, "botAction"), "Embed posted.", "discord-embed-post")}><Star size={14} /> Post Embed</button></div>
            </div>
            {discordToolResult ? <div className="discord-tool-output">{renderDiscordToolResult(discordToolResult)}</div> : null}
          </section> : null}
          {(!botOnly || botSection === "commands") ? <section className="form-card discord-channel-card bot-tools-card">
            <div className="split-header"><div><h3><Command size={17} /> Custom Commands</h3><p className="legend">Create Discord slash commands that respond with static server information. Select an existing command to edit it, then re-register slash commands after saving.</p></div><button className={busyButtonClass("commands-refresh")} disabled={isBusyAction("commands-refresh")} onClick={() => run(refreshCustomCommands, "Custom commands loaded.", "commands-refresh")}><RefreshCw size={15} /> {isBusyAction("commands-refresh") ? "Refreshing..." : "Refresh"}</button></div>
            <div className="discord-tool-forms">
              <div className="discord-tool-form-card">
                <h4><Save size={15} /> Command Editor</h4>
                <label className="field"><span>Command name</span><input value={commandDraft.name} onChange={(event) => setCommandDraft((current) => ({ ...current, name: event.target.value }))} placeholder="rules" /></label>
                <label className="field"><span>Description</span><input value={commandDraft.description} onChange={(event) => setCommandDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                <label className="field"><span>Response</span><textarea value={commandDraft.response} onChange={(event) => setCommandDraft((current) => ({ ...current, response: event.target.value }))} /></label>
                <div className="toolbar">
                  <button className="toolbar-button primary" disabled={!commandDraft.name.trim() || !commandDraft.response.trim() || isBusyAction("discord-command-save")} onClick={() => run(async () => { await api("/admin/discord/custom-commands", { method: "PUT", body: JSON.stringify(commandDraft) }); await refreshCustomCommands(); }, "Custom command saved. Re-register slash commands to publish it.", "discord-command-save")}><Save size={14} /> Save Command</button>
                  <button className="toolbar-button" onClick={() => setCommandDraft({ name: "", description: "", response: "" })}><Plus size={14} /> New</button>
                  <button className="toolbar-button danger" disabled={!commandDraft.name.trim() || isBusyAction("discord-command-delete")} onClick={() => confirmModeration("Delete this custom command?", () => run(async () => { await api(`/admin/discord/custom-commands?name=${encodeURIComponent(commandDraft.name)}`, { method: "DELETE" }); setCommandDraft({ name: "", description: "", response: "" }); await refreshCustomCommands(); }, "Custom command deleted.", "discord-command-delete"))}><X size={14} /> Delete</button>
                  <button className="toolbar-button bot-post-button" disabled={isBusyAction("discord-commands-register")} onClick={() => run(async () => { const commands = await api("/admin/discord/register-commands", { method: "POST", body: "{}" }); setDiscordToolResult({ ...commands, __type: "botReport" }); }, "Slash commands registered.", "discord-commands-register")}><Command size={14} /> Register Slash Commands</button>
                </div>
              </div>
              <div className="discord-tool-form-card">
                <h4><Command size={15} /> Existing Commands</h4>
                <div className="discord-report-list command-list">{customCommands.length ? customCommands.map((command) => (
                  <button type="button" className={`discord-report-item command-list-item ${commandDraft.name === command.name ? "active" : ""}`} key={command.name} onClick={() => setCommandDraft({ name: String(command.name ?? ""), description: String(command.description ?? ""), response: String(command.response ?? "") })}>
                    <div className="discord-report-dot ok" />
                    <div><strong>/{command.name}</strong><span>{command.description || command.response}</span></div>
                    <span className="role-option-status">Edit</span>
                  </button>
                )) : <p className="legend">No custom commands yet.</p>}</div>
              </div>
            </div>
            {discordToolResult ? <div className="discord-tool-output">{renderDiscordToolResult(discordToolResult)}</div> : null}
          </section> : null}
          {(!botOnly || botSection === "tools") ? <section className="form-card discord-channel-card bot-tools-card">
            <div className="split-header">
              <div>
                <h3><Wrench size={17} /> Server Management Tools</h3>
                <p className="legend">Run Discord health reports, post managed announcements, maintain pinned information and schedule events from one place.</p>
              </div>
            </div>
            <div className="discord-tool-actions">
              <button className="discord-tool-action" disabled={isBusyAction("discord-audit-report")} onClick={() => run(async () => setDiscordToolResult({ ...await api("/admin/discord/audit-log"), __type: "auditLog" }), "Audit log loaded.", "discord-audit-report")}>
                <span className="discord-tool-action-icon"><FileText size={18} /></span>
                <span><strong>Audit Log</strong><small>Review recent bot and Discord management actions in a readable timeline.</small><em>Run report</em></span>
              </button>
              <button className="discord-tool-action" disabled={isBusyAction("discord-role-cleanup")} onClick={() => run(async () => setDiscordToolResult({ ...await api("/admin/discord/role-cleanup"), __type: "roleCleanup" }), "Role cleanup report loaded.", "discord-role-cleanup")}>
                <span className="discord-tool-action-icon"><Users size={18} /></span>
                <span><strong>Role Cleanup</strong><small>Find unused roles, duplicate colours and role manageability problems.</small><em>Run report</em></span>
              </button>
              <button className="discord-tool-action" disabled={isBusyAction("discord-channel-report")} onClick={() => run(async () => setDiscordToolResult({ ...await api("/admin/discord/channel-permissions"), __type: "channelPermissions" }), "Channel permission report loaded.", "discord-channel-report")}>
                <span className="discord-tool-action-icon"><Lock size={18} /></span>
                <span><strong>Channel Checks</strong><small>Check whether key roles can read and post in important channels.</small><em>Run report</em></span>
              </button>
              <button className="discord-tool-action" disabled={isBusyAction("discord-inactive-report")} onClick={() => run(async () => setDiscordToolResult({ ...await api("/admin/discord/inactive-report", { method: "POST", body: JSON.stringify({ days: 30 }) }), __type: "inactiveReport" }), "Inactive member report loaded.", "discord-inactive-report")}>
                <span className="discord-tool-action-icon"><Activity size={18} /></span>
                <span><strong>Inactive Members</strong><small>List synced Discord members with no recent observed activity.</small><em>Run 30 day report</em></span>
              </button>
            </div>
            <div className="discord-tool-section-header">
              <div>
                <h4>Post & Maintain Content</h4>
                <p className="legend">Use these for clean server messages without manually formatting Discord embeds.</p>
              </div>
            </div>
            <div className="discord-tool-forms">
              <div className="discord-tool-form-card">
                <h4><MessageCircle size={15} /> Announcement Builder</h4>
                <p className="legend">Post a formatted announcement to any configured channel.</p>
                <label className="field"><span>Channel</span>{channelIdSelect(announcementDraft.channelId, (value) => setAnnouncementDraft((current) => ({ ...current, channelId: value })))}</label>
                <label className="field"><span>Title</span><input value={announcementDraft.title} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                <label className="field"><span>Message</span><textarea value={announcementDraft.message} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, message: event.target.value }))} /></label>
                <button className="toolbar-button primary bot-post-button" disabled={isBusyAction("discord-announcement-post")} onClick={() => run(async () => { await api("/admin/discord/announcement", { method: "POST", body: JSON.stringify(announcementDraft) }); }, "Announcement posted.", "discord-announcement-post")}><MessageCircle size={14} /> Post Announcement</button>
              </div>
              <div className="discord-tool-form-card">
                <h4><Pin size={15} /> Pinned Info Updater</h4>
                <p className="legend">Create or update one maintained information post for a channel.</p>
                <label className="field"><span>Channel</span>{channelIdSelect(pinnedDraft.channelId, (value) => setPinnedDraft((current) => ({ ...current, channelId: value })))}</label>
                <label className="field"><span>Existing message ID</span><input value={pinnedDraft.messageId} onChange={(event) => setPinnedDraft((current) => ({ ...current, messageId: event.target.value }))} placeholder="Blank posts a new pinned message" /></label>
                <label className="field"><span>Title</span><input value={pinnedDraft.title} onChange={(event) => setPinnedDraft((current) => ({ ...current, title: event.target.value }))} /></label>
                <label className="field"><span>Message</span><textarea value={pinnedDraft.message} onChange={(event) => setPinnedDraft((current) => ({ ...current, message: event.target.value }))} /></label>
                <button className="toolbar-button bot-post-button" disabled={isBusyAction("discord-pin-post")} onClick={() => run(async () => { const result = await api("/admin/discord/pinned-info", { method: "POST", body: JSON.stringify(pinnedDraft) }); setPinnedDraft((current) => ({ ...current, messageId: String(result.response?.id ?? current.messageId) })); }, "Pinned info posted or updated.", "discord-pin-post")}><Pin size={14} /> Post/Update Pin</button>
              </div>
              <div className="discord-tool-form-card">
                <h4><Bell size={15} /> Event Scheduler</h4>
                <p className="legend">Create a Discord event for planned gathering or crafting sessions.</p>
                <label className="field"><span>Name</span><input value={eventDraft.name} onChange={(event) => setEventDraft((current) => ({ ...current, name: event.target.value }))} /></label>
                <label className="field"><span>Location</span><input value={eventDraft.location} onChange={(event) => setEventDraft((current) => ({ ...current, location: event.target.value }))} /></label>
                <label className="field"><span>Start</span><input type="datetime-local" value={eventDraft.startTime} onChange={(event) => setEventDraft((current) => ({ ...current, startTime: event.target.value }))} /></label>
                <label className="field"><span>End</span><input type="datetime-local" value={eventDraft.endTime} onChange={(event) => setEventDraft((current) => ({ ...current, endTime: event.target.value }))} /></label>
                <label className="field"><span>Description</span><textarea value={eventDraft.description} onChange={(event) => setEventDraft((current) => ({ ...current, description: event.target.value }))} /></label>
                <button className="toolbar-button" disabled={isBusyAction("discord-event-create")} onClick={() => run(async () => { await api("/admin/discord/scheduled-event", { method: "POST", body: JSON.stringify(eventDraft) }); }, "Discord event created.", "discord-event-create")}><Bell size={14} /> Create Event</button>
              </div>
            </div>
            {discordToolResult ? <div className="discord-tool-output">{renderDiscordToolResult(discordToolResult)}</div> : null}
          </section> : null}
          {(!botOnly || botSection === "youtube") ? (
            <DiscordYouTubeMonitorSection
              api={api}
              channelIdSelect={notificationChannelIdSelect}
              optionalChannelIdSelect={optionalChannelIdSelect}
              discord={draft.discord}
              isPending={isBusyAction}
              run={run}
              updateDiscord={updateDiscord}
              updateDiscordNotify={updateDiscordNotify}
            />
          ) : null}
          {(!botOnly || botSection === "notifications") ? (
            <DiscordNotificationsSection
              channelSelect={channelSelect}
              channelIdSelect={channelIdSelect}
              discord={draft.discord}
              discordDeliveryLabel={discordDeliveryLabel}
              isPending={isBusyAction}
              roleIdSelect={roleIdSelect}
              onTestCraftPlanReport={(rule) => run(async () => {
                await api("/admin/discord/craft-plan-report/test", {
                  method: "POST",
                  body: JSON.stringify({ reportType: rule.reportType, profession: rule.profession }),
                });
              }, "Craft Planner report sent to the sandbox Discord channel.", `discord-craft-report-test:${rule.id}`)}
              updateDiscord={updateDiscord}
              updateDiscordNotify={updateDiscordNotify}
            />
          ) : null}
          {(!botOnly || botSection === "tests") ? (
            <DiscordTestsPanel
              botOnly={botOnly}
              discordTestButtons={discordTestButtons}
              isPending={isBusyAction}
              onRegisterCommands={() =>
                run(async () => {
                  const result = await api("/admin/discord/register-commands", { method: "POST", body: "{}" });
                  setMessageKind("success");
                  setMessage(`Registered ${formatNumber(result.commands?.length)} Discord slash commands.`);
                }, undefined, "discord-commands-register")
              }
              onSendTest={(kind, label) =>
                run(async () => {
                  const result = await api("/admin/discord/test", { method: "POST", body: JSON.stringify({ kind }) });
                  setDiscordToolResults((current) => ({ ...current, tests: { ...result, __type: "botAction" } }));
                }, `${label} Discord test sent to the sandbox Discord channel.`, `discord-test:${kind}`)
              }
            />
          ) : null}
          {(!botOnly || botSection === "diagnostics") ? <DiscordDiagnosticsPanel filter={discordDiagnosticsFilter} log={discordLog} onFilterChange={setDiscordDiagnosticsFilter} pending={isBusyAction("discord-diagnostics-refresh")} onRefresh={() => run(refreshStatus, undefined, "discord-diagnostics-refresh")} /> : null}
        </div>
        </React.Suspense>
        </div>
        </div>
      ) : null}

      {tab === "database" ? (
        <AdminDataSection
          tab="database"
          data={{ tables, selectedTable, tableResult, tableSearch, tableOffset, backups, operationalHistory: status?.operationalHistory }}
          pending={isBusyAction}
          error={messageKind === "error" ? message : null}
          result={message && messageKind !== "error" ? { message, kind: messageKind } : null}
          onSelectTable={(value) => { setSelectedTable(value); setTableOffset(0); }}
          onTableSearchChange={(value) => { setTableSearch(value); setTableOffset(0); }}
          onPreviousTablePage={() => setTableOffset(Math.max(0, tableOffset - 50))}
          onNextTablePage={() => setTableOffset(tableOffset + 50)}
          onCreateBackup={() => undefined}
          onRunRetentionDryRun={() => run(async () => { await api("/admin/operational-history-retention/dry-run", { method: "POST", body: "{}" }); await refreshStatus(); }, "Retention dry-run completed without deleting rows.", "retention-dry-run")}
          tableExportHref={(format) => `${LOCAL_API}/admin/export?name=${encodeURIComponent(selectedTable)}&format=${format}&search=${encodeURIComponent(tableSearch)}`}
          backupDownloadHref={(name) => `${LOCAL_API}/admin/backup?name=${encodeURIComponent(name)}`}
        />
      ) : null}

      {tab === "users" || tab === "accounts" ? (
        <AdminAccessSection
          tab={tab}
          data={{ users, linkedAccounts, members: adminMemberRows, newUser, adminRoles, canManageAdmins, currentUserId: auth.user?.id }}
          pending={isBusyAction}
          error={messageKind === "error" ? message : null}
          membersLoading={membersLoading}
          membersError={membersError}
          result={message && messageKind !== "error" ? { message, kind: messageKind } : null}
          onNewUserChange={setNewUser}
          onAddUser={() => run(async () => { await api("/admin/users", { method: "POST", body: JSON.stringify(newUser) }); setNewUser({ discordId: "", displayName: "", role: "admin" }); await refreshUsers(); }, "Discord administrator added.", "admin-user-add")}
          onRoleChange={(entry, role) => run(async () => { const result = await api("/admin/user/role", { method: "PUT", body: JSON.stringify({ userId: entry.id, role }) }); if (result.signedOut) setAdminAuthState({ authenticated: false, setupRequired: false }); else await refreshUsers(); }, "Administrator role updated and sessions cleared.", `admin-user-role:${entry.id}`)}
          onClearSessions={(entry) => setActionConfirmation({ title: "Clear administrator sessions", target: entry.username || `Administrator ${entry.id}`, impact: "Signs this administrator out of every active admin session.", reversible: true, confirmLabel: "Clear sessions", tone: "warning", onConfirm: () => run(async () => { await api("/admin/sessions/clear", { method: "POST", body: JSON.stringify({ userId: entry.id }) }); await refreshUsers(); }, "Sessions cleared.", `admin-user-sessions:${entry.id}`) })}
          onToggleStatus={(entry) => entry.active ? setActionConfirmation({ title: "Disable administrator", target: entry.username || `Administrator ${entry.id}`, impact: "Prevents future administrator sign-in and ends the account's active access.", reversible: true, confirmLabel: "Disable administrator", tone: "danger", onConfirm: () => run(async () => { await api("/admin/user/status", { method: "PUT", body: JSON.stringify({ userId: entry.id, active: false }) }); await refreshUsers(); }, "Account status updated.", `admin-user-status:${entry.id}`) }) : run(async () => { await api("/admin/user/status", { method: "PUT", body: JSON.stringify({ userId: entry.id, active: true }) }); await refreshUsers(); }, "Account status updated.", `admin-user-status:${entry.id}`)}
          onRefreshLinkedAccounts={() => run(refreshLinkedAccountsAndFallbackMembers, undefined, "linked-accounts-refresh")}
          onAccountApproval={(account, status) => run(async () => { const result = await api("/admin/user-accounts/approval", { method: "PUT", body: JSON.stringify({ userId: account.id, status }) }); setLinkedAccounts(result.accounts ?? []); }, `Account marked ${status}.`, `account-approval:${account.id}`)}
          onCharacterAssignment={(account, member) => run(async () => {
            const result = await api("/admin/user-accounts/character", {
              method: "PUT",
              body: JSON.stringify({
                userId: account.id,
                characterPlayerId: member ? memberTrackingId(member) : "",
                characterName: member ? memberDisplayName(member) : "",
              }),
            });
            setLinkedAccounts(result.accounts ?? []);
          }, member ? "Character assigned and approved." : "Character unassigned.", `account-character:${account.id}`)}
          onAccountPrivacyDeletion={async (account) => {
            let deleted = false;
            await run(async () => {
              const result = await api("/admin/user-accounts/privacy", {
                method: "DELETE",
                body: JSON.stringify({ userId: account.id, confirmation: "DELETE" }),
              });
              setLinkedAccounts((current) => current.filter((entry) => entry.id !== account.id));
              setAccessControlState((current) => {
                if (!current) return current;
                const rules = Object.fromEntries(Object.entries(current.config.rules).map(([targetId, rule]) => [
                  targetId,
                  { ...rule, allowedDiscordIds: rule.allowedDiscordIds.filter((discordId) => discordId !== account.discordId) },
                ]));
                return {
                  config: normalizeAccessControlConfig({ rules }),
                  accounts: current.accounts.filter((entry) => entry.id !== account.id),
                };
              });
              setMessageKind(result.notification?.ok ? "success" : "info");
              setMessage(result.notification?.ok
                ? "Account data removed and the user was notified by Discord DM."
                : "Account data removed. The Discord DM could not be delivered.");
              deleted = true;
            }, undefined, `account-privacy-delete:${account.id}`);
            return deleted;
          }}
        />
      ) : null}

      {tab === "audit" ? (
        <div className="admin-section audit-section">
          <AdminAnalyticsSection
            tab="audit"
            data={{ analyticsDays, analyticsData, visitorSecurityData, securityEventSearch, securityEventPage, securityEventPageSize, auditData, auditFilter, auditVisibleCount }}
            pending={isBusyAction}
            error={messageKind === "error" ? message : null}
            result={message && messageKind !== "error" ? { message, kind: messageKind } : null}
            onAnalyticsDaysChange={(days) => { setAnalyticsDays(days); setSecurityEventPage(1); }}
            onClearAnalytics={() => undefined}
            onSecurityEventSearchChange={(search) => { setSecurityEventSearch(search); setSecurityEventPage(1); }}
            onSecurityEventPageChange={setSecurityEventPage}
            onSecurityEventPageSizeChange={(pageSize) => { setSecurityEventPageSize(pageSize); setSecurityEventPage(1); }}
            onAuditFilterChange={(filter) => { setAuditFilter(filter); setAuditVisibleCount(30); }}
            onLoadMoreAudit={() => setAuditVisibleCount((count) => count + 30)}
            onRefreshAudit={() => run(refreshAudit, undefined, "audit-refresh")}
          />
        </div>
      ) : null}

      {tab === "backups" ? (
        <AdminDataSection
          tab="backups"
          data={{ tables, selectedTable, tableResult, tableSearch, tableOffset, backups, operationalHistory: status?.operationalHistory }}
          pending={isBusyAction}
          error={messageKind === "error" ? message : null}
          result={message && messageKind !== "error" ? { message, kind: messageKind } : null}
          onSelectTable={(value) => { setSelectedTable(value); setTableOffset(0); }}
          onTableSearchChange={(value) => { setTableSearch(value); setTableOffset(0); }}
          onPreviousTablePage={() => setTableOffset(Math.max(0, tableOffset - 50))}
          onNextTablePage={() => setTableOffset(tableOffset + 50)}
          onCreateBackup={() => run(async () => { await api("/admin/backups", { method: "POST", body: "{}" }); await Promise.all([refreshBackups(), refreshStatus()]); }, "Backup created and verified.", "backup-create")}
          onRunRetentionDryRun={() => run(async () => { await api("/admin/operational-history-retention/dry-run", { method: "POST", body: "{}" }); await refreshStatus(); }, "Retention dry-run completed without deleting rows.", "retention-dry-run")}
          tableExportHref={(format) => `${LOCAL_API}/admin/export?name=${encodeURIComponent(selectedTable)}&format=${format}&search=${encodeURIComponent(tableSearch)}`}
          backupDownloadHref={(name) => `${LOCAL_API}/admin/backup?name=${encodeURIComponent(name)}`}
        />
      ) : null}
      {hasUnsavedSettings ? (
        <div className="floating-save">
          <div><strong>Unsaved changes</strong><span>Save to apply these settings.</span></div>
          <button className="toolbar-button" onClick={revertSettings}><RefreshCw size={14} /> Revert</button>
          <button className="toolbar-button primary" disabled={isBusyAction("settings-save")} onClick={saveSettings}><Save size={14} /> Save Changes</button>
        </div>
      ) : null}
      <ConfirmAdminActionDialog confirmation={actionConfirmation} onClose={() => setActionConfirmation(null)} />
    </div>
  );
}

