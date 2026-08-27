import React from "react";
import "./styles/app-chrome.css";
import "./styles/user-settings.css";
import "./styles/notifications.css";
import "./styles/app-popups.css";
import "./styles/first-run-tour.css";
import {
  ArrowDown,
  Bell,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
  Shield,
  X,
} from "lucide-react";
import packageJson from "../package.json";
import { useFeaturebase } from "featurebase-js/react";
import type { BootstrapPayload } from "./api/bootstrap";
import { loadAdminConsoleSession } from "./api/adminSession";
import { clearPreviousClaimGameData, gameDataScopeKey, useGameData } from "./api/gameDataLoader";
import { useDealAlerts, useLocalHistory, useNotificationActivity } from "./api/localHistory";
import {
  groupDomainWarnings,
  pageGameDataWarnings,
  publicGameDataQualitySummaries,
  staleDataWarning,
} from "./api/pageGameDataWarnings";
import { ApiErrorState, AppSkeleton, RefreshStatus, type ApiStatusDiagnostics } from "./components/main/AppChrome";
import { RouteLoadingState } from "./components/main/RouteLoadingState";
import { CommandPalette } from "./components/main/CommandPalette";
import { NotificationDrawer, ToastStack } from "./components/main/Notifications";
import { AppPopupManager } from "./components/main/AppPopupManager";
import { UserSettingsDialog } from "./components/main/UserSettingsDialog";
import { BuyMeCoffeeButton, DiscordIcon } from "./components/main/SupportLinks";
import { CookieBanner, DedicatedLegalPage, DiscordSignInPrompt, HelpCenter, PrivacyDialog, TermsDialog } from "./components/main/LegalDialogs";
import { LegalAcceptanceDialog, type PublicLegalPolicy } from "./components/main/LegalAcceptanceDialog";
import { AccountDeletionDialog } from "./components/main/AccountDeletionDialog";
import { FirstRunTourManager } from "./components/main/FirstRunTourManager";
import { useBrowserNotificationSmoke } from "./notifications/useBrowserNotificationSmoke";
import { useBrowserNotificationSources } from "./notifications/useBrowserNotificationSources";
import { useToastNotifications } from "./notifications/useToastNotifications";
import { normalizeUserToastSettings } from "./notifications/userToastSettings";
import { clearBrowserLocalSettings, hasPersistedState, usePersistedState } from "./hooks/usePersistedState";
import { toNumber, type AnyRecord } from "./main-app-data";
import { DEFAULT_SETTINGS, DEFAULT_SYNC_URL, DEFAULT_USER_TOAST_SETTINGS } from "./settingsDefaults";
import { canonicalPanel, DEFAULT_SIDEBAR_GROUPS, isDedicatedMapView, NAV, NAV_GROUPS, panelHref, updateQueryState, urlPanel } from "./navigation";
import { settlementNavigationLabel } from "./navigation/navigationLabels";
import { readAnalyticsConsent, setAnalyticsPreference, syncAnalyticsConsent, trackAnalyticsEvent, withdrawAnalyticsConsent, type AnalyticsConsent } from "./utils/analytics";
import {
  normalizeReleaseBuildId,
  observeReleaseBuild,
} from "./utils/releaseUpdate";
import { normalizeAppSettings } from "./utils/appSettings";
import { applyMemberTrackingFilter } from "./utils/memberTracking";
import { getTrackedOwnerName } from "./utils/ownership";
import { normalizeData } from "./utils/normalize";
import { urlMapFocus } from "./utils/mapFocus";
import type { ActivePanel, LoadState } from "./types/app";
import type { DomainKey, DomainStatus, GameDataResponseMeta } from "./server/game-data/contracts";
import type { AppSettings, AppUser, UserAuthState, UserToastSettings } from "./types/settings";
import type { MapFocus } from "./pages/map/mapUtils";
import { accountPlayerMarkerColourOverrides, normalizePlayerMarkerColourOverrides, withPlayerMarkerColourOverride } from "./map/playerMarkerColours.mjs";
import { verifiedCharacterPlayerId } from "./map/playerMarkerIdentity.mjs";
import { applyTheme, DEFAULT_THEME, normalizeThemeCandidate, type ThemeSettings } from "./theme";
import { ACCESS_CONTROL_TARGETS, effectiveTargetAllowed, targetIdForPage, type EffectiveAccess } from "./access/accessControl.mjs";
import { restrictedAccessGuidance } from "./access/restrictedAccess";
import { PageRefreshProvider } from "./refresh/ManualRefreshContext";
import { cooldownRemainingMs } from "./refresh/manualRefresh.mjs";
import { createPageGameDataGenerationWatcher } from "./refresh/generationWatcher.mjs";
import {
  createPageRefreshController,
  createPageRefreshTaskCoordinator,
  type PageRefreshController,
  type PageRefreshCycle,
  type PageRefreshTaskCoordinator,
  type PageRefreshTaskState,
} from "./refresh/pageRefresh.mjs";

/*
 * Top-level browser application shell.
 *
 * This module coordinates the public claim monitor, the admin console, and the
 * dedicated /bot dashboard route. Page-level rendering has mostly been moved to
 * focused modules, but cross-cutting state remains here because routing,
 * persisted browser settings, auth, analytics consent, notifications, and the
 * current normalized game-data payload all need to meet in one place.
 */

const LOCAL_API = "/api/local";
const GITHUB_REPOSITORY = "https://github.com/Red463/bitcraft-claim-monitor-relay";
const CHANGELOG_URL = `${GITHUB_REPOSITORY}/blob/main/CHANGELOG.md`;
const DISCORD_URL = "https://discord.gg/ET4bteqbG5";
const APP_VERSION = packageJson.version;
const DEFAULT_APP_LOGO_URL = "/claim-monitor-logo.png";
const DEFAULT_FAVICON_URL = "/favicon.ico";
const RELEASE_UPDATED_NOTICE_MS = 8_000;
const VISUALLY_HIDDEN_STYLE: React.CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap", border: 0 };

const Dashboard = React.lazy(() => import("./pages/DashboardPage").then(({ Dashboard }) => ({ default: Dashboard })));
const Leaderboard = React.lazy(() => import("./pages/LeaderboardPage").then(({ Leaderboard }) => ({ default: Leaderboard })));
const Members = React.lazy(() => import("./pages/MembersPage").then(({ Members }) => ({ default: Members })));
const Skills = React.lazy(() => import("./pages/SkillsPage").then(({ Skills }) => ({ default: Skills })));
const Production = React.lazy(() => import("./pages/ProductionPage").then(({ Production }) => ({ default: Production })));
const CraftPlanningPage = React.lazy(() => import("./pages/CraftPlanningPage").then(({ CraftPlanningPage }) => ({ default: CraftPlanningPage })));
const Inventory = React.lazy(() => import("./pages/InventoryPage").then(({ Inventory }) => ({ default: Inventory })));
const Construction = React.lazy(() => import("./pages/ConstructionPage").then(({ Construction }) => ({ default: Construction })));
const Research = React.lazy(() => import("./pages/ResearchPage").then(({ Research }) => ({ default: Research })));
const Market = React.lazy(() => import("./pages/MarketPage").then(({ Market }) => ({ default: Market })));
const SettlementMarket = React.lazy(() => import("./pages/SettlementMarketPage").then(({ SettlementMarket }) => ({ default: SettlementMarket })));
const Region = React.lazy(() => import("./pages/RegionPage").then(({ Region }) => ({ default: Region })));
const Empires = React.lazy(() => import("./pages/EmpiresPage").then(({ Empires }) => ({ default: Empires })));
const ActivityPanel = React.lazy(() => import("./pages/ActivityPage").then(({ ActivityPanel }) => ({ default: ActivityPanel })));
const PublicCraftFinder = React.lazy(() => import("./pages/PublicCraftFinderPage").then(({ PublicCraftFinder }) => ({ default: PublicCraftFinder })));
const CraftCalculatorPage = React.lazy(() => import("./pages/CraftCalculatorPage").then(({ CraftCalculatorPage }) => ({ default: CraftCalculatorPage })));
const MapPanel = React.lazy(() => import("./pages/MapPage").then(({ MapPanel }) => ({ default: MapPanel })));
const SyncPanel = React.lazy(() => import("./pages/SyncPage").then(({ SyncPanel }) => ({ default: SyncPanel })));
const AdminPanel = React.lazy(() => import("./components/admin/AdminPanel").then(({ AdminPanel }) => ({ default: AdminPanel })));

function PageRefreshCycleSeal({ cycle, coordinator }: { cycle: PageRefreshCycle | null; coordinator: PageRefreshTaskCoordinator }) {
  React.useEffect(() => {
    if (!cycle) return;
    const timer = window.setTimeout(() => coordinator.seal(cycle.id), 0);
    return () => window.clearTimeout(timer);
  }, [coordinator, cycle]);
  return null;
}

class RouteErrorBoundary extends React.Component<{ routeKey: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previousProps: { routeKey: string }) {
    if (this.state.failed && previousProps.routeKey !== this.props.routeKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="empty-state route-error-state" role="alert">
        <strong>This page could not be loaded.</strong>
        <span>Check your connection, then try again.</span>
        <button className="toolbar-button primary" onClick={() => window.location.reload()}>Try again</button>
      </section>
    );
  }
}

function hasProductionPayload(raw: AnyRecord | null): boolean {
  return Boolean(raw && Object.prototype.hasOwnProperty.call(raw, "crafts"));
}

function GameDataQualityNotice({
  activePanel,
  domainStatus,
  responseMeta,
}: {
  activePanel: ActivePanel;
  domainStatus: Partial<Record<DomainKey, DomainStatus>>;
  responseMeta: GameDataResponseMeta | null;
}) {
  const summaries = publicGameDataQualitySummaries(
    activePanel,
    domainStatus,
    responseMeta?.coherence ?? null,
  );
  const warningDetails = groupDomainWarnings(domainStatus);
  if (!summaries.length) return null;
  return (
    <section className="game-data-quality" aria-label="Game data quality">
      <strong role="status">{summaries.join("; ")}</strong>
      <details>
        <summary>Warning and provenance details</summary>
        <p>
          Local coherence: <strong>{responseMeta?.coherence ?? "unknown"}</strong>
          {responseMeta?.availableGenerations?.length
            ? ` (generations ${responseMeta.availableGenerations.join(", ")})`
            : ""}. Coherence compares local application generations and declared enrichment dependencies only; source receive times remain authoritative.
        </p>
        <div className="game-data-provenance-list">
          {(Object.entries(domainStatus) as Array<[DomainKey, DomainStatus]>).map(([domain, status]) => (
            <div key={domain}>
              <strong>{domain}</strong>
              <span>{status.freshness} · generation {status.generation ?? "unavailable"}</span>
              <small>{status.provenance
                ? `${status.provenance.sourceKey} received ${status.provenance.receivedAt}`
                : "No source provenance available"}</small>
              {Object.keys(status.dependencies).length ? <small>Dependencies: {Object.entries(status.dependencies).map(([name, dependency]) => (
                `${name} generation ${dependency?.generation ?? "unavailable"}${dependency?.sourceGeneration == null ? "" : `, source generation ${dependency.sourceGeneration}`} (${dependency?.sourceKey ?? "unknown"}, ${dependency?.receivedAt ?? "unknown"})`
              )).join("; ")}</small> : null}
            </div>
          ))}
        </div>
        {warningDetails.groups.length ? <div className="game-data-warning-groups">
          <strong>Grouped warnings</strong>
          {warningDetails.groups.map((group) => <div key={group.key}>
            <span>{group.domain}: {group.message} <b>×{group.count}</b></span>
            {group.examples.length ? <ul>{group.examples.map((example) => <li key={example}>{example}</li>)}</ul> : null}
          </div>)}
          {warningDetails.omittedGroupCount ? <small>
            {warningDetails.omittedGroupCount} additional warning group{warningDetails.omittedGroupCount === 1 ? "" : "s"} omitted ({warningDetails.omittedWarningCount} warning{warningDetails.omittedWarningCount === 1 ? "" : "s"}).
          </small> : null}
        </div> : null}
      </details>
    </section>
  );
}

function useScopedGameData(
  claimId: string,
  activePanel: ActivePanel,
  pageRefreshCycle: PageRefreshCycle | null,
  trackPageRefreshPromise: <T>(taskKey: string, promise: Promise<T>) => Promise<T>,
): LoadState<AnyRecord> {
  const state = useGameData(claimId, activePanel, pageRefreshCycle, trackPageRefreshPromise);
  const requestedGameDataScopeKey = gameDataScopeKey(claimId, activePanel);
  return state.scopeKey === requestedGameDataScopeKey
    ? state
    : { data: null, error: null, loading: true, scopeKey: requestedGameDataScopeKey };
}

function RestrictedAccessState({
  title,
  decision,
  user,
  discordLoginEnabled,
  onDiscordLogin,
  onOpenUserSettings,
}: {
  title: string;
  decision: { mode?: string; reason?: string } | undefined;
  user: AppUser | null;
  discordLoginEnabled: boolean;
  onDiscordLogin: () => void;
  onOpenUserSettings: () => void;
}) {
  const guidance = restrictedAccessGuidance(decision, user, discordLoginEnabled);
  return (
    <div className="panel restricted-access-panel">
      <section className="empty-state restricted-access-state">
        <Shield size={34} />
        <strong>{title} is restricted</strong>
        <span>{decision?.reason || "You do not have access to this area."}</span>
        <small>{guidance.message}</small>
        {guidance.action === "discord-login" ? <button className="toolbar-button primary" onClick={() => onDiscordLogin()}><MessageCircle size={15} /> Sign in with Discord</button> : null}
        {guidance.action === "user-settings" ? <button className="toolbar-button primary" onClick={onOpenUserSettings}><Settings size={15} /> Open User Settings</button> : null}
      </section>
    </div>
  );
}

function accountCharacterStatusLabel(user: UserAuthState["user"]): string {
  if (!user) return "Not signed in";
  if (user.characterStatus === "approved" && user.characterPlayerId) return "Character verified";
  if (user.characterStatus === "pending") return "Pending approval";
  if (user.characterStatus === "rejected") return "Link rejected";
  return "Not linked";
}

function accountDisplayName(user: UserAuthState["user"]): string {
  return user?.globalName || user?.username || "Discord user";
}
/**
 * Main public application route.
 *
 * This component owns public navigation, live game-data refreshes, browser-local
 * preferences, user Discord auth state, notifications, and page composition.
 */
function DashboardApp({ initialBootstrap }: { initialBootstrap: BootstrapPayload }) {
  const { shutdown: shutdownFeaturebase } = useFeaturebase();
  const [active, setActive] = usePersistedState<ActivePanel>("navigation.page", "dashboard");
  const [routeSearch, setRouteSearch] = React.useState(() => window.location.search);
  const mainRef = React.useRef<HTMLElement | null>(null);
  const navigationRef = React.useRef<HTMLElement | null>(null);
  const mobileNavigationTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const mobileNavigationWasOpenRef = React.useRef(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = React.useState(false);
  const [mobileFloatingActionsOpen, setMobileFloatingActionsOpen] = React.useState(false);
  const [routeStatus, setRouteStatus] = React.useState("");
  const [isNarrowViewport, setIsNarrowViewport] = React.useState(() => window.matchMedia("(max-width: 920px)").matches);
  const [collapsedNavTooltip, setCollapsedNavTooltip] = React.useState<{ label: string; left: number; top: number } | null>(null);
  React.useEffect(() => {
    const narrowViewport = window.matchMedia("(max-width: 920px)");
    const updateNarrowViewport = () => {
      setIsNarrowViewport(narrowViewport.matches);
      if (narrowViewport.matches) setMobileFloatingActionsOpen(false);
    };
    narrowViewport.addEventListener("change", updateNarrowViewport);
    return () => narrowViewport.removeEventListener("change", updateNarrowViewport);
  }, []);
  const defaultPageAppliedRef = React.useRef(false);
  const savedPageRef = React.useRef(hasPersistedState("navigation.page") || Boolean(urlPanel()));
  const [appSettings, setAppSettings] = React.useState<AppSettings>(() => normalizeAppSettings(initialBootstrap.config));
  const [appBuildId, setAppBuildId] = React.useState("");
  const appBuildIdRef = React.useRef("");
  const releaseUpdateBuildIdRef = React.useRef("");
  const [releaseUpdateBuildId, setReleaseUpdateBuildId] = React.useState("");
  const [releaseUpdatedNotice, setReleaseUpdatedNotice] = React.useState(false);
  const [userAuth, setUserAuth] = React.useState<UserAuthState>(() => ({
    ...initialBootstrap.auth,
    featurebaseJwt: initialBootstrap.auth.featurebaseJwt ?? undefined,
  }));
  const [publicLegalPolicy] = React.useState<PublicLegalPolicy>(() => initialBootstrap.legal);
  const [legalAcceptanceOpen, setLegalAcceptanceOpen] = React.useState(false);
  const [legalLoginReturnTo, setLegalLoginReturnTo] = React.useState("");
  const [effectiveAccess, setEffectiveAccess] = React.useState<EffectiveAccess | null>(null);
  const [adminAuth, setAdminAuth] = React.useState<AnyRecord>({ authenticated: false });
  const [claimId, setClaimId] = React.useState(initialBootstrap.config.claimId);
  const claimIdRef = React.useRef(claimId);
  const [syncUrl, setSyncUrl] = React.useState(() => normalizeAppSettings(initialBootstrap.config).syncUrl ?? DEFAULT_SYNC_URL);
  const [browserTheme, setBrowserTheme] = usePersistedState<ThemeSettings>("theme.local", DEFAULT_THEME);
  const [notificationRefreshToken, setNotificationRefreshToken] = React.useState(0);
  const [dealRefreshToken, setDealRefreshToken] = React.useState(0);
  const [pageRefreshCycle, setPageRefreshCycle] = React.useState<PageRefreshCycle | null>(null);
  const [pageRefreshState, setPageRefreshState] = React.useState<PageRefreshTaskState>({
    cycleId: "",
    status: "idle",
    pendingTasks: [],
    errors: [],
    lastSuccessfulAt: null,
    visibleProgress: false,
  });
  const [manualRefreshClock, setManualRefreshClock] = React.useState(() => Date.now());
  const [lastManualRefreshAt, setLastManualRefreshAt] = React.useState<number | null>(null);
  const manualRefreshCompletionRef = React.useRef("");
  const pageRefreshControllerRef = React.useRef<PageRefreshController | null>(null);
  const pageRefreshCoordinator = React.useMemo(() => createPageRefreshTaskCoordinator({
    onStateChange: setPageRefreshState,
    onComplete: (cycle, succeeded) => pageRefreshControllerRef.current?.complete(cycle.id, succeeded),
  }), []);
  const pageRefreshController = React.useMemo(() => {
    const controller = createPageRefreshController({
      page: active,
      intervalMs: DEFAULT_SETTINGS.refreshSeconds * 1000,
      visible: document.visibilityState !== "hidden",
      onCycle: (cycle) => {
        pageRefreshCoordinator.beginCycle(cycle);
        setPageRefreshCycle(cycle);
      },
    });
    pageRefreshControllerRef.current = controller;
    return controller;
  }, [pageRefreshCoordinator]);
  const pageRefreshScopeRef = React.useRef(`${active}|${claimId}`);
  const lastUpdated = pageRefreshState.lastSuccessfulAt == null ? null : new Date(pageRefreshState.lastSuccessfulAt);
  const [mapFocus, setMapFocus] = usePersistedState<MapFocus>("map.focus", urlMapFocus());
  const [mapPlayerColours, setMapPlayerColours] = usePersistedState<Record<string, string>>("map.player-colours", {});
  const normalizedMapPlayerColours = React.useMemo(() => normalizePlayerMarkerColourOverrides(mapPlayerColours), [mapPlayerColours]);
  const [selectedMemberId, setSelectedMemberId] = usePersistedState("production.member", "All");
  const [userToastSettings, setUserToastSettings] = usePersistedState<UserToastSettings>("user.notifications", DEFAULT_USER_TOAST_SETTINGS);
  const normalizedUserToastSettings = React.useMemo(() => normalizeUserToastSettings(userToastSettings), [userToastSettings]);
  const { toasts, notificationLog, dismissToast, pushToast, markNotificationLogRead } = useToastNotifications({ soundSettings: normalizedUserToastSettings });
  const appBuildLabel = React.useMemo(() => {
    const shortBuildId = appBuildId.trim().slice(0, 7);
    return shortBuildId ? `v${APP_VERSION} - ${shortBuildId}` : `v${APP_VERSION}`;
  }, [appBuildId]);
  const [density, setDensity] = usePersistedState<"comfortable" | "compact">("layout.density", "comfortable");
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState("layout.sidebarCollapsed", false);
  const [sidebarGroups, setSidebarGroups] = usePersistedState<Record<string, boolean>>("layout.sidebarGroups", DEFAULT_SIDEBAR_GROUPS);
  const [floatingActionsCollapsed, setFloatingActionsCollapsed] = usePersistedState("layout.floatingActionsCollapsed", false);
  const [discordPromptDismissed, setDiscordPromptDismissed] = usePersistedState("auth.discordPromptDismissed", false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [tourVisible, setTourVisible] = React.useState(false);
  const [tourReplayToken, setTourReplayToken] = React.useState(0);
  const [userSettingsOpen, setUserSettingsOpen] = React.useState(false);
  const [privacyOpen, setPrivacyOpen] = React.useState(false);
  const [accountDeletionOpen, setAccountDeletionOpen] = React.useState(() => new URLSearchParams(window.location.search).get("privacy") === "delete-ready");
  const [termsOpen, setTermsOpen] = React.useState(false);
  const [consent, setConsent] = React.useState<AnalyticsConsent>(() => readAnalyticsConsent());
  const [noticeOpen, setNoticeOpen] = React.useState(false);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [accountSettingsHydratedFor, setAccountSettingsHydratedFor] = React.useState("");
  const accountSettingsSyncPause = React.useRef<{ target: string; settled: boolean } | null>(null);
  const showCollapsedNavTooltip = React.useCallback((anchor: HTMLAnchorElement, label: string) => {
    if (!sidebarCollapsed || mobileNavigationOpen) return;
    const rect = anchor.getBoundingClientRect();
    setCollapsedNavTooltip({ label, left: rect.right + 10, top: rect.top + rect.height / 2 });
  }, [mobileNavigationOpen, sidebarCollapsed]);
  React.useEffect(() => {
    setCollapsedNavTooltip(null);
  }, [active, mobileNavigationOpen, sidebarCollapsed]);
  React.useEffect(() => {
    if (!collapsedNavTooltip) return;
    const navigation = navigationRef.current;
    const clearCollapsedNavTooltip = () => setCollapsedNavTooltip(null);
    window.addEventListener("resize", clearCollapsedNavTooltip);
    navigation?.addEventListener("scroll", clearCollapsedNavTooltip);
    return () => {
      window.removeEventListener("resize", clearCollapsedNavTooltip);
      navigation?.removeEventListener("scroll", clearCollapsedNavTooltip);
    };
  }, [collapsedNavTooltip]);
  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = mobileNavigationOpen ? "hidden" : previousOverflow;
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileNavigationOpen]);
  React.useEffect(() => {
    if (!mobileNavigationOpen && mobileNavigationWasOpenRef.current) mobileNavigationTriggerRef.current?.focus();
    mobileNavigationWasOpenRef.current = mobileNavigationOpen;
  }, [mobileNavigationOpen]);
  React.useEffect(() => {
    if (!mobileNavigationOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavigationOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavigationOpen]);
  const trackPageRefreshPromise = React.useCallback(<T,>(taskKey: string, promise: Promise<T>): Promise<T> => {
    const activeCycle = pageRefreshCycle?.page === active ? pageRefreshCycle : null;
    if (!activeCycle) return promise;
    return pageRefreshCoordinator.trackPromise(activeCycle.id, taskKey, promise);
  }, [active, pageRefreshCoordinator, pageRefreshCycle]);
  const state = useScopedGameData(claimId, active, pageRefreshCycle, trackPageRefreshPromise);
  const excludedMemberIds = appSettings.excludedMemberIds;
  const data = React.useMemo(() => {
    // Provider payloads vary by domain during migration. Normalize them once, then apply
    // the admin-controlled member visibility filter before any page receives
    // app data.
    const normalized = normalizeData(state.data);
    return applyMemberTrackingFilter({ ...normalized, raw: state.data }, excludedMemberIds);
  }, [state.data, excludedMemberIds]);
  const localHistory = useLocalHistory(claimId, active, pageRefreshCycle, trackPageRefreshPromise);
  const notificationActivity = useNotificationActivity(notificationRefreshToken, claimId);
  const dealAlerts = useDealAlerts(dealRefreshToken);
  const dealAlertSource = React.useMemo(
    () => ({ ...dealAlerts, userKey: userAuth.user?.discordId ?? "" }),
    [dealAlerts, userAuth.user?.discordId],
  );
  const selectedProductionMember = selectedMemberId === "All" ? null : data.members.find((member: AnyRecord) => String(member.playerEntityId) === selectedMemberId) ?? null;
  syncAnalyticsConsent(consent);
  const refreshEffectiveAccess = React.useCallback(async () => {
    try {
      const response = await fetch(`${LOCAL_API}/access-control/effective`);
      if (response.ok) setEffectiveAccess(await response.json());
    } catch {
      setEffectiveAccess(null);
    }
  }, []);
  const refreshAdminAuth = React.useCallback(async () => {
    try {
      const { auth, settings } = await loadAdminConsoleSession(fetch);
      if (settings) {
        clearPreviousClaimGameData(claimIdRef.current, settings.claimId);
        setAppSettings(settings);
        setClaimId(settings.claimId);
        setSyncUrl(settings.syncUrl);
      }
      setAdminAuth(auth);
    } catch {
      setAdminAuth({ authenticated: false });
    }
  }, []);
  React.useEffect(() => {
    refreshEffectiveAccess().catch(() => undefined);
  }, [refreshEffectiveAccess, userAuth.user?.discordId, userAuth.user?.characterStatus]);
  const discordLogin = React.useCallback((returnTo = `${window.location.pathname}${window.location.search}`) => {
    setDiscordPromptDismissed(true);
    setLegalLoginReturnTo(returnTo);
    setLegalAcceptanceOpen(true);
  }, [setDiscordPromptDismissed]);
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("legal") !== "required") return;
    discordLogin(params.get("returnTo") || "/?page=dashboard");
    params.delete("legal");
    params.delete("returnTo");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [discordLogin]);
  const startDiscordLogin = React.useCallback(async ({ acceptedTerms, ageConfirmed }: { acceptedTerms: true; ageConfirmed: true }) => {
    const response = await fetch(`${LOCAL_API}/auth/discord/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ returnTo: legalLoginReturnTo, acceptedTerms, ageConfirmed }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to prepare Discord sign-in");
    if (typeof body.authorizeUrl !== "string" || !body.authorizeUrl.startsWith("https://discord.com/")) {
      throw new Error("The server returned an invalid Discord sign-in address");
    }
    window.location.assign(body.authorizeUrl);
  }, [legalLoginReturnTo]);
  const acceptCurrentLegalPolicy = React.useCallback(async ({ acceptedTerms, ageConfirmed }: { acceptedTerms: true; ageConfirmed: true }) => {
    const response = await fetch(`${LOCAL_API}/auth/legal/accept`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": String(userAuth.csrfToken ?? "") },
      body: JSON.stringify({ acceptedTerms, ageConfirmed }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to record legal acceptance");
    setUserAuth(body);
    setLegalAcceptanceOpen(false);
  }, [userAuth.csrfToken]);
  const discordLogout = React.useCallback(async () => {
    const response = await fetch(`${LOCAL_API}/auth/logout`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to sign out");
    shutdownFeaturebase();
    setUserAuth(body);
  }, [shutdownFeaturebase]);
  const invalidateUserAuth = React.useCallback(() => {
    shutdownFeaturebase();
    setUserAuth((current) => ({ ...current, user: null, csrfToken: null, featurebaseJwt: undefined }));
  }, [shutdownFeaturebase]);
  const linkDiscordCharacter = React.useCallback(async (member: AnyRecord | null) => {
    const payload = member ? { characterPlayerId: String(member.playerEntityId ?? ""), characterName: String(member.userName ?? member.username ?? member.playerUsername ?? member.name ?? "") } : {};
    const response = await fetch(`${LOCAL_API}/auth/character`, { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": String(userAuth.csrfToken ?? "") }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to save character link request");
    setUserAuth((current) => ({ ...current, user: body.user }));
  }, [userAuth.csrfToken]);
  const accountSettingsFingerprint = React.useMemo(() => JSON.stringify(userAuth.user?.settings ?? {}), [userAuth.user?.settings]);
  const applyAccountSettings = React.useCallback((saved: AnyRecord) => {
    if (saved.density === "comfortable" || saved.density === "compact") setDensity(saved.density);
    if (saved.toastSettings && typeof saved.toastSettings === "object") setUserToastSettings(normalizeUserToastSettings(saved.toastSettings));
    const savedTheme = normalizeThemeCandidate(saved.theme)?.theme;
    if (savedTheme) setBrowserTheme(savedTheme);
    if (typeof saved.sidebarCollapsed === "boolean") setSidebarCollapsed(saved.sidebarCollapsed);
    if (saved.sidebarGroups && typeof saved.sidebarGroups === "object" && !Array.isArray(saved.sidebarGroups)) setSidebarGroups({ ...DEFAULT_SIDEBAR_GROUPS, ...saved.sidebarGroups });
    if (typeof saved.selectedMemberId === "string") setSelectedMemberId(saved.selectedMemberId);
    setMapPlayerColours((current) => {
      const next = accountPlayerMarkerColourOverrides(saved, current);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [setBrowserTheme, setDensity, setMapPlayerColours, setSelectedMemberId, setSidebarCollapsed, setSidebarGroups, setUserToastSettings]);
  React.useEffect(() => {
    const discordId = userAuth.user?.discordId ?? "";
    if (!discordId) {
      setAccountSettingsHydratedFor("");
      return;
    }
    applyAccountSettings(userAuth.user?.settings ?? {});
    setAccountSettingsHydratedFor(`${discordId}:${accountSettingsFingerprint}`);
  }, [accountSettingsFingerprint, applyAccountSettings, userAuth.user?.discordId, userAuth.user?.settings]);
  const syncAccountSettings = React.useCallback(async (settings: AnyRecord) => {
    const response = await fetch(`${LOCAL_API}/auth/settings`, { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": String(userAuth.csrfToken ?? "") }, body: JSON.stringify({ settings }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to sync account settings");
    setUserAuth((current) => ({ ...current, user: body.user }));
  }, [userAuth.csrfToken]);
  React.useEffect(() => {
    const discordId = userAuth.user?.discordId ?? "";
    if (!discordId || accountSettingsHydratedFor !== `${discordId}:${accountSettingsFingerprint}`) return;
    const settings = { ...(userAuth.user?.settings ?? {}), density, toastSettings: normalizedUserToastSettings, theme: browserTheme, sidebarCollapsed, sidebarGroups, selectedMemberId, mapPlayerColours: normalizedMapPlayerColours };
    const settingsFingerprint = JSON.stringify(settings);
    const pausedSync = accountSettingsSyncPause.current;
    if (pausedSync) {
      if (settingsFingerprint === pausedSync.target) {
        pausedSync.settled = true;
        return;
      }
      else if (pausedSync.settled) accountSettingsSyncPause.current = null;
      else return;
    }
    if (settingsFingerprint === accountSettingsFingerprint) return;
    const timeout = window.setTimeout(() => {
      void syncAccountSettings(settings).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [accountSettingsFingerprint, accountSettingsHydratedFor, browserTheme, density, normalizedMapPlayerColours, normalizedUserToastSettings, selectedMemberId, sidebarCollapsed, sidebarGroups, syncAccountSettings, userAuth.user?.discordId, userAuth.user?.settings]);
  const setDiscordMarketSaleDm = React.useCallback(async (enabled: boolean) => {
    const settings = { ...(userAuth.user?.settings ?? {}), discordMarketSaleDm: enabled };
    const response = await fetch(`${LOCAL_API}/auth/settings`, { method: "PUT", headers: { "content-type": "application/json", "x-csrf-token": String(userAuth.csrfToken ?? "") }, body: JSON.stringify({ settings }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Unable to save Discord notification preference");
    setUserAuth((current) => ({ ...current, user: body.user }));
  }, [userAuth.csrfToken, userAuth.user?.settings]);
  const handlePrivacyUserChanged = React.useCallback((user: AppUser, reason: "character" | "settings") => {
    if (reason === "settings") {
      const defaults = {
        density: "comfortable" as const,
        toastSettings: normalizeUserToastSettings(DEFAULT_USER_TOAST_SETTINGS),
        theme: DEFAULT_THEME,
        sidebarCollapsed: false,
        sidebarGroups: DEFAULT_SIDEBAR_GROUPS,
        selectedMemberId: "All",
        mapPlayerColours: {},
      };
      accountSettingsSyncPause.current = { target: JSON.stringify(defaults), settled: false };
      setDensity(defaults.density);
      setUserToastSettings(defaults.toastSettings);
      setBrowserTheme(defaults.theme);
      setSidebarCollapsed(defaults.sidebarCollapsed);
      setSidebarGroups(defaults.sidebarGroups);
      setSelectedMemberId(defaults.selectedMemberId);
      setMapPlayerColours(defaults.mapPlayerColours);
    }
    setUserAuth((current) => ({ ...current, user }));
  }, [setBrowserTheme, setDensity, setMapPlayerColours, setSelectedMemberId, setSidebarCollapsed, setSidebarGroups, setUserToastSettings]);
  const handleAnalyticsCleared = React.useCallback(() => {
    withdrawAnalyticsConsent();
    setConsent(null);
  }, []);
  const handleAccountDeleted = React.useCallback(() => {
    shutdownFeaturebase();
    withdrawAnalyticsConsent();
    setConsent(null);
    setUserSettingsOpen(false);
    setUserAuth((current) => ({
      ...current,
      user: null,
      csrfToken: null,
      legal: { ...current.legal, acceptedAt: null, requiresAcceptance: false },
    }));
  }, [shutdownFeaturebase]);
  const accessTargetMeta = React.useMemo(() => new Map(ACCESS_CONTROL_TARGETS.map((target) => [target.id, target])), []);
  const accessDecisionFor = React.useCallback((targetId: string) => effectiveAccess?.targets?.[targetId], [effectiveAccess]);
  const isPageAllowed = React.useCallback((panel: ActivePanel | string) => panel === "admin" || effectiveTargetAllowed(effectiveAccess, targetIdForPage(panel)), [effectiveAccess]);
  const syncRouteSearch = React.useCallback(() => setRouteSearch(window.location.search), []);
  const navigate = React.useCallback((panel: ActivePanel, marketTab?: string, nextMapFocus?: MapFocus) => {
    setActive(panel);
    const activeMapFocus = panel === "map" ? nextMapFocus ?? mapFocus : null;
    updateQueryState({
      page: panel,
      tab: panel === "market" || panel === "settlement-market" ? marketTab ?? null : null,
      item: panel === "market" ? new URLSearchParams(window.location.search).get("item") : null,
      itemName: panel === "market" ? new URLSearchParams(window.location.search).get("itemName") : null,
      itemType: panel === "market" ? new URLSearchParams(window.location.search).get("itemType") : null,
      region: panel === "market" ? new URLSearchParams(window.location.search).get("region") : null,
      buyItem: panel === "market" ? new URLSearchParams(window.location.search).get("buyItem") : null,
      buyItemName: panel === "market" ? new URLSearchParams(window.location.search).get("buyItemName") : null,
      buyItemType: panel === "market" ? new URLSearchParams(window.location.search).get("buyItemType") : null,
      buyRegion: panel === "market" ? new URLSearchParams(window.location.search).get("buyRegion") : null,
      label: activeMapFocus?.name ?? null,
      x: activeMapFocus ? String(activeMapFocus.locationX) : null,
      z: activeMapFocus ? String(activeMapFocus.locationZ) : null,
      mapName: null,
      mapX: null,
      mapZ: null,
      regionId: panel === "map" ? activeMapFocus?.regionId ?? null : null,
    }, "push");
    setRouteSearch(window.location.search);
    const label = NAV.find(([id]) => id === panel)?.[1] ?? "Dashboard";
    setRouteStatus("");
    window.requestAnimationFrame(() => {
      if (mainRef.current) mainRef.current.scrollTop = 0;
      window.scrollTo(0, 0);
      mainRef.current?.focus();
      setRouteStatus(`${label} page loaded`);
    });
  }, [mapFocus, setActive]);
  useBrowserNotificationSmoke({ active, pushToast });


  React.useEffect(() => {
    const canonicalActive = canonicalPanel(String(active));
    if (canonicalActive && canonicalActive !== active) {
      setActive(canonicalActive);
      updateQueryState({ page: canonicalActive });
    }
  }, [active, setActive]);
  React.useEffect(() => {
    const rawPanel = new URLSearchParams(window.location.search).get("page");
    const requested = urlPanel();
    if (requested && rawPanel !== requested) updateQueryState({ page: requested });
    const requestedMapFocus = urlMapFocus();
    if (requestedMapFocus) setMapFocus(requestedMapFocus);
    if (requested) setActive(requested);
    else if (rawPanel) {
      setActive("dashboard");
      updateQueryState({ page: "dashboard" });
    }
    function restoreFromHistory() {
      setRouteStatus("");
      setRouteSearch(window.location.search);
      const rawHistoryPanel = new URLSearchParams(window.location.search).get("page");
      const panel = urlPanel();
      if (panel && rawHistoryPanel !== panel) updateQueryState({ page: panel });
      const historyMapFocus = urlMapFocus();
      if (historyMapFocus) setMapFocus(historyMapFocus);
      if (panel) setActive(panel);
    }
    window.addEventListener("popstate", restoreFromHistory);
    return () => window.removeEventListener("popstate", restoreFromHistory);
  }, [setActive, setMapFocus]);
  React.useEffect(() => {
    function openCommands(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      } else if (event.key === "/" && !isEditing) {
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", openCommands);
    return () => window.removeEventListener("keydown", openCommands);
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    function reloadForReleaseUpdate() {
      window.location.reload();
    }
    function rememberBuildId(buildId: string) {
      appBuildIdRef.current = buildId;
      if (!cancelled) setAppBuildId(buildId);
    }
    function showReleaseUpdate(buildId: string) {
      releaseUpdateBuildIdRef.current = buildId;
      if (!cancelled) setReleaseUpdateBuildId(buildId);
    }
    async function checkReleaseBuild() {
      try {
        const response = await fetch(`${LOCAL_API}/health`, { cache: "no-store" });
        const nextBuildId = normalizeReleaseBuildId(response.ok ? await response.json() : null);
        const observation = observeReleaseBuild({
          currentBuildId: appBuildIdRef.current,
          nextBuildId,
          documentHidden: document.hidden,
          storage: window.localStorage,
        });
        const { decision } = observation;
        if (decision === "remember") {
          rememberBuildId(nextBuildId);
        }
        if (decision === "updated") {
          rememberBuildId(nextBuildId);
          if (!cancelled && observation.showUpdatedNotice) setReleaseUpdatedNotice(true);
        }
        if (decision === "prompt") showReleaseUpdate(nextBuildId);
        if (decision === "reload") reloadForReleaseUpdate();
      } catch {
        // A failed release check should not interrupt the dashboard.
      }
    }
    function handleReleaseVisibility() {
      if (document.hidden && releaseUpdateBuildIdRef.current) {
        reloadForReleaseUpdate();
        return;
      }
      void checkReleaseBuild();
    }
    void checkReleaseBuild();
    const timer = window.setInterval(checkReleaseBuild, 60_000);
    document.addEventListener("visibilitychange", handleReleaseVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleReleaseVisibility);
    };
  }, []);
  React.useEffect(() => {
    if (!releaseUpdatedNotice) return undefined;
    const timer = window.setTimeout(() => setReleaseUpdatedNotice(false), RELEASE_UPDATED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [releaseUpdatedNotice]);
  React.useEffect(() => {
    claimIdRef.current = claimId;
  }, [claimId]);
  React.useEffect(() => {
    if (defaultPageAppliedRef.current || savedPageRef.current || appSettings.defaultPage === "admin") return;
    defaultPageAppliedRef.current = true;
    setActive(appSettings.defaultPage);
    updateQueryState({ page: appSettings.defaultPage });
  }, [appSettings.defaultPage, setActive]);
  React.useEffect(() => {
    refreshAdminAuth().catch(() => undefined);
  }, [refreshAdminAuth]);
  React.useEffect(() => {
    applyTheme(browserTheme);
  }, [browserTheme]);
  React.useEffect(() => {
    if (consent !== "accepted") return;
    // Analytics are first-party and consent-gated. Duration is sent on page exit
    // so feature usage can be measured without tracking identifiable users.
    trackAnalyticsEvent("page_view", undefined, undefined, active);
    const enteredAt = Date.now();
    let recorded = false;
    const recordDuration = () => {
      if (recorded) return;
      recorded = true;
      const durationSeconds = Math.round((Date.now() - enteredAt) / 1000);
      if (durationSeconds > 0) trackAnalyticsEvent("page_duration", undefined, durationSeconds, active);
    };
    window.addEventListener("pagehide", recordDuration);
    return () => {
      window.removeEventListener("pagehide", recordDuration);
      recordDuration();
    };
  }, [active, consent]);
  React.useEffect(() => {
    const label = NAV.find(([id]) => id === active)?.[1] ?? "Dashboard";
    document.title = `${label} — BitCraft Claim Monitor`;
  }, [active]);
  React.useEffect(() => {
    pageRefreshController.start();
    return () => pageRefreshController.stop();
  }, [pageRefreshController]);
  React.useEffect(() => {
    const nextScope = `${active}|${claimId}`;
    if (pageRefreshScopeRef.current === nextScope) return;
    const [previousPage] = pageRefreshScopeRef.current.split("|");
    pageRefreshScopeRef.current = nextScope;
    if (previousPage !== active) pageRefreshController.setPage(active);
    else pageRefreshController.restart();
  }, [active, claimId, pageRefreshController]);
  React.useEffect(() => {
    pageRefreshController.setIntervalMs(appSettings.refreshSeconds * 1000);
  }, [appSettings.refreshSeconds, pageRefreshController]);
  React.useEffect(() => {
    const onVisibilityChange = () => pageRefreshController.setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pageRefreshController]);
  React.useEffect(() => {
    const watcher = createPageGameDataGenerationWatcher({
      activePanel: active,
      claimId,
      isVisible: () => document.visibilityState !== "hidden",
      onGeneration: () => pageRefreshController.invalidateGeneration(),
    });
    return () => watcher?.stop();
  }, [active, claimId, pageRefreshController]);
  React.useEffect(() => {
    const intervalMs = appSettings.refreshSeconds * 1000;
    const visibleBump = (setter: React.Dispatch<React.SetStateAction<number>>) => {
      if (document.visibilityState !== "hidden") setter((x) => x + 1);
    };
    const timers: number[] = [];
    const schedule = (setter: React.Dispatch<React.SetStateAction<number>>, delayMs: number) => {
      const start = window.setTimeout(() => {
        visibleBump(setter);
        timers.push(window.setInterval(() => visibleBump(setter), intervalMs));
      }, delayMs);
      timers.push(start);
    };
    schedule(setNotificationRefreshToken, Math.min(10000, Math.floor(intervalMs * 0.5)));
    schedule(setDealRefreshToken, Math.min(15000, Math.floor(intervalMs * 0.75)));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [appSettings.refreshSeconds]);
  React.useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) return;
    const favicon = appSettings.branding.favicon;
    if (!favicon) {
      link.href = DEFAULT_FAVICON_URL;
      link.type = "image/x-icon";
      return;
    }
    const faviconUrl = `${favicon.url}?v=${encodeURIComponent(favicon.updatedAt)}`;
    let disposed = false;
    const probe = new Image();
    probe.onload = () => {
      if (disposed) return;
      link.href = faviconUrl;
      link.type = favicon.contentType;
    };
    probe.onerror = () => {
      if (disposed) return;
      link.href = DEFAULT_FAVICON_URL;
      link.type = "image/x-icon";
    };
    probe.src = faviconUrl;
    return () => {
      disposed = true;
      probe.onload = null;
      probe.onerror = null;
    };
  }, [appSettings.branding.favicon]);
  React.useEffect(() => {
    if (selectedMemberId !== "All" && state.data && !selectedProductionMember) setSelectedMemberId("All");
  }, [selectedMemberId, selectedProductionMember, state.data]);
  useBrowserNotificationSources({
    claimId,
    appToastSettings: appSettings.toastSettings,
    userToastSettings: normalizedUserToastSettings,
    notificationActivity,
    dealAlerts: dealAlertSource,
    productionCrafts: data.crafts,
    productionCraftCatalog: data.raw?.crafts ?? state.data?.crafts,
    hasProductionData: hasProductionPayload(state.data),
    pushToast,
  });
  const activeRegionScopeKey = `${appSettings.defaultRegion}|${appSettings.additionalActiveRegions}`;
  const dedicatedMapView = isDedicatedMapView(routeSearch);
  const panels: Record<string, React.ReactNode> = {
    dashboard: <Dashboard data={data} activity={localHistory.activity} marketHistory={localHistory.market} dashboardSummary={localHistory.dashboard} lastUpdated={lastUpdated} onNavigate={navigate} />,
    leaderboard: <Leaderboard claimId={claimId} refreshToken={pageRefreshCycle?.sequence ?? 0} excludedMemberIds={appSettings.excludedMemberIds} data={data} access={effectiveAccess} />,
    members: <Members data={data} selectedMemberId={selectedMemberId} onSelectMember={setSelectedMemberId} onMemberDetailsOpened={() => trackAnalyticsEvent("member_details_opened")} />,
    skills: <Skills data={data} />,
    "craft-monitor": <Production data={data} refreshToken={pageRefreshCycle?.sequence ?? 0} selectedMemberId={selectedMemberId} onSelectMember={setSelectedMemberId} />,
    planning: <CraftPlanningPage claimId={claimId} refreshToken={pageRefreshCycle?.sequence ?? 0} auth={userAuth} locationSearch={routeSearch} onQueryStateChange={syncRouteSearch} />,
    publiccrafts: <div className="panel public-craft-page"><PublicCraftFinder providerData={data.raw?.["public-crafts"]} providerLoading={state.loading} providerError={state.error} monitoredClaimId={claimId} monitoredRegionId={String(data.claim.regionId ?? "")} monitoredOwnerName={getTrackedOwnerName(data.claim)} defaultRegionId={appSettings.defaultRegion} activeRegionScopeKey={activeRegionScopeKey} onShowMap={(focus) => { setMapFocus(focus); navigate("map", undefined, focus); }} /></div>,
    craftcalc: <CraftCalculatorPage />,
    inventory: <Inventory data={data} />,
    construction: <Construction data={data} />,
    research: <Research data={data} />,
    market: <Market claimId={claimId} access={effectiveAccess} locationSearch={routeSearch} fallbackRegionId={String(data.claim.regionId ?? "")} activeRegionScopeKey={activeRegionScopeKey} auth={userAuth} onAuthInvalidated={invalidateUserAuth} onQueryStateChange={syncRouteSearch} onNavigate={navigate} onShowMap={(focus, regionId) => { const target = { ...focus, regionId }; setMapFocus(target); navigate("map", undefined, target); }} onDiscordLogin={discordLogin} />,
    "settlement-market": <SettlementMarket data={data} history={localHistory.market} claimId={claimId} access={effectiveAccess} locationSearch={routeSearch} listingsLoading={state.loading} listingError={state.error} onQueryStateChange={syncRouteSearch} />,
    region: <Region data={data} />,
    empires: <Empires monitoredClaimId={claimId} monitoredRegionId={String(data.claim.regionId ?? "")} activeRegionScopeKey={activeRegionScopeKey} providerData={data.raw} providerLoading={state.loading} providerError={state.error} access={effectiveAccess} />,
    map: <MapPanel data={data} focus={mapFocus} activeRegionScopeKey={activeRegionScopeKey} dedicated={dedicatedMapView} verifiedCharacterPlayerId={verifiedCharacterPlayerId(userAuth.user?.characterStatus, userAuth.user?.characterPlayerId)} playerColourOverrides={normalizedMapPlayerColours} onPlayerColourChange={(playerId, colour) => setMapPlayerColours((current) => withPlayerMarkerColourOverride(current, playerId, colour))} onClearFocus={() => { setMapFocus(null); updateQueryState({ label: null, x: null, z: null, regionId: null, mapName: null, mapX: null, mapZ: null }); }} />,
    sync: <SyncPanel syncUrl={syncUrl} />,
    activity: <ActivityPanel activity={localHistory.activity} activityTotal={localHistory.activityTotal} claimId={claimId} error={localHistory.error} members={data.members} access={effectiveAccess} />,
    admin: <AdminPanel settings={appSettings} members={normalizeData(state.data).members} publicAccount={userAuth.user} resolvedAuth={adminAuth} onAuthChanged={setAdminAuth} onSettingsSaved={(settings) => { setAppSettings(settings); setClaimId(settings.claimId); setSyncUrl(settings.syncUrl ?? DEFAULT_SYNC_URL); }} onClaimSettingsSaved={(previousClaimId, settings) => clearPreviousClaimGameData(previousClaimId, settings.claimId)} />,
  };
  const activePageTargetId = targetIdForPage(active);
  const activePageDecision = accessDecisionFor(activePageTargetId);
  const activePageLabel = accessTargetMeta.get(activePageTargetId)?.label ?? NAV.find(([id]) => id === active)?.[1] ?? "This page";
  const activePanel = isPageAllowed(active)
    ? panels[active] ?? panels.dashboard
    : <RestrictedAccessState title={activePageLabel} decision={activePageDecision} user={userAuth.user} discordLoginEnabled={userAuth.discordLoginEnabled} onDiscordLogin={discordLogin} onOpenUserSettings={() => setUserSettingsOpen(true)} />;
  const pageRefreshInFlight = pageRefreshState.status === "refreshing";
  const manualRefreshIsRefreshing = pageRefreshInFlight && pageRefreshCycle?.reason === "manual";
  const visibleRefreshProgress = pageRefreshState.visibleProgress;
  const manualRefreshCooldownMs = cooldownRemainingMs(lastManualRefreshAt, manualRefreshClock);
  const manualRefreshCooldownSeconds = Math.ceil(manualRefreshCooldownMs / 1000);
  const manualRefreshIsCoolingDown = !manualRefreshIsRefreshing && manualRefreshCooldownMs > 0;
  const manualRefreshIssueCount = pageRefreshState.errors.length + (state.stale ? 1 : 0);
  const manualRefreshHasErrors = pageRefreshState.status === "complete" && pageRefreshCycle?.reason === "manual" && manualRefreshIssueCount > 0;
  const manualRefreshButtonDisabled = pageRefreshInFlight || manualRefreshCooldownMs > 0;
  const manualRefreshButtonLabel = manualRefreshIsRefreshing
    ? `Refreshing ${activePageLabel} data`
    : manualRefreshCooldownMs > 0
      ? `${manualRefreshHasErrors ? "Refresh finished with issues. " : "Data refreshed. "}Refresh available in ${manualRefreshCooldownSeconds} seconds`
      : "Refresh data now";
  const manualRefreshStatusText = manualRefreshIsRefreshing
    ? `${manualRefreshButtonLabel}. Current data remains visible.`
    : pageRefreshState.status === "complete" && pageRefreshCycle?.reason === "manual"
      ? manualRefreshHasErrors
        ? `Refresh finished with ${manualRefreshIssueCount} ${manualRefreshIssueCount === 1 ? "issue" : "issues"}. Current data remains visible.`
        : "Data refreshed."
      : "";
  const requestManualRefresh = React.useCallback(() => {
    const now = Date.now();
    if (pageRefreshInFlight || cooldownRemainingMs(lastManualRefreshAt, now) > 0) return;
    const cycle = pageRefreshController.requestManual();
    if (!cycle) return;
    setManualRefreshClock(now);
    setLastManualRefreshAt(now);
    setNotificationRefreshToken((current) => current + 1);
    setDealRefreshToken((current) => current + 1);
  }, [lastManualRefreshAt, pageRefreshController, pageRefreshInFlight]);
  React.useEffect(() => {
    if (lastManualRefreshAt == null || manualRefreshCooldownMs <= 0) return undefined;
    const timer = window.setInterval(() => setManualRefreshClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [lastManualRefreshAt, manualRefreshCooldownMs > 0]);
  React.useEffect(() => {
    if (pageRefreshState.status !== "complete" || pageRefreshCycle?.reason !== "manual" || !pageRefreshState.cycleId || manualRefreshCompletionRef.current === pageRefreshState.cycleId) return;
    manualRefreshCompletionRef.current = pageRefreshState.cycleId;
    setRouteStatus(manualRefreshHasErrors ? "Refresh finished with issues. Current data remains visible." : "Data refreshed.");
  }, [manualRefreshHasErrors, pageRefreshCycle?.reason, pageRefreshState.cycleId, pageRefreshState.status]);
  const apiWarnings = React.useMemo(() => {
    const partialErrors = Array.isArray(data.raw?.partialErrors) ? data.raw.partialErrors.map((error) => String(error)) : [];
    const relevantPartialErrors = pageGameDataWarnings(active, partialErrors);
    const staleWarning = staleDataWarning({
      stale: state.stale === true,
      refreshActive: state.loading === true || manualRefreshIsRefreshing,
      lastUpdatedLabel: lastUpdated
        ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : null,
    });
    return [
      ...(state.error ? [`Main data refresh failed: ${state.error}`] : []),
      ...(staleWarning ? [staleWarning] : []),
      ...relevantPartialErrors,
    ];
  }, [active, data.raw?.partialErrors, lastUpdated, manualRefreshIsRefreshing, state.error, state.loading, state.stale]);
  const apiDiagnostics = React.useMemo<ApiStatusDiagnostics>(() => ({
    appVersion: APP_VERSION,
    page: active,
    claimId,
    url: window.location.href,
    loading: state.loading,
    lastSuccessfulRefresh: lastUpdated?.toISOString() ?? null,
    warningCount: apiWarnings.length,
    dataCounts: {
      members: data.members.length,
      citizens: data.citizens.length,
      crafts: data.crafts.length,
      constructionProjects: Array.isArray(data.construction) ? data.construction.length : toNumber(data.construction?.projects?.length),
      marketListings: data.market.length,
      inventories: Array.isArray(data.inventories?.buildings)
        ? data.inventories.buildings.length
        : Array.isArray(data.inventories?.inventories) ? data.inventories.inventories.length : 0,
      regionClaims: data.region.length,
    },
    warnings: apiWarnings,
  }), [active, apiWarnings, claimId, data.citizens.length, data.construction, data.crafts.length, data.inventories, data.market.length, data.members.length, data.region.length, lastUpdated, state.loading]);

  const sidebarAccountName = accountDisplayName(userAuth.user);
  const sidebarAccountStatus = accountCharacterStatusLabel(userAuth.user);
  const sidebarAccountInitial = sidebarAccountName.slice(0, 1).toUpperCase();
  const mobileNavigationUnavailable = isNarrowViewport && !mobileNavigationOpen;
  const narrowAwareFloatingActionsCollapsed = isNarrowViewport ? !mobileFloatingActionsOpen : floatingActionsCollapsed;
  return (
    <div className={`app-shell density-${density} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${dedicatedMapView ? "map-dedicated-shell" : ""} ${active === "admin" ? "admin-focused-shell" : ""}`}>
      {!dedicatedMapView ? (<>
        <header className="mobile-shell-bar">
        <span><strong className="mobile-shell-brand">Claim Monitor</strong><small className="mobile-shell-route">{activePageLabel}</small></span>
        <button ref={mobileNavigationTriggerRef} type="button" aria-label="Open navigation" aria-controls="mobile-navigation" aria-expanded={mobileNavigationOpen} onClick={() => setMobileNavigationOpen(true)}>
          <Menu size={18} />
        </button>
      </header>
      {mobileNavigationOpen ? <button type="button" className="mobile-navigation-backdrop" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)} /> : null}
      <aside id="mobile-navigation" aria-label="Mobile navigation" aria-hidden={mobileNavigationUnavailable ? true : undefined} inert={mobileNavigationUnavailable ? true : undefined} className={`app-sidebar ${mobileNavigationOpen ? "mobile-open" : ""}`}>
        <button type="button" className="mobile-navigation-close" aria-label="Close navigation" onClick={() => setMobileNavigationOpen(false)}><X size={18} /></button>
        <div className="brand">
          {appSettings.branding.logo
            ? <img src={`${appSettings.branding.logo.url}?v=${encodeURIComponent(appSettings.branding.logo.updatedAt)}`} alt="" onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = DEFAULT_APP_LOGO_URL;
            }} />
            : <img src={DEFAULT_APP_LOGO_URL} alt="" />}
          <div title={data.claim.name ?? "Settlement"}><h1>{data.claim.name ?? "Settlement"}</h1><span>Claim Monitor</span></div>
          <button className="sidebar-toggle" type="button" onClick={() => setSidebarCollapsed((current) => !current)} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <div className="sidebar-top-stack">
          <section className={`sidebar-account-card ${userAuth.user ? "signed-in" : "signed-out"}`} aria-label="Account">
            {userAuth.user ? (
              <button type="button" className="sidebar-account-main" onClick={() => setUserSettingsOpen(true)} title="Open account settings">
                <span className="sidebar-account-avatar">{userAuth.user.avatarUrl ? <img src={userAuth.user.avatarUrl} alt="" /> : sidebarAccountInitial}</span>
                <span className="sidebar-account-copy"><strong>{sidebarAccountName}</strong><small>{sidebarAccountStatus}</small></span>
              </button>
            ) : (
              <>
                <div className="sidebar-account-main">
                  <span className="sidebar-account-avatar"><MessageCircle size={16} /></span>
                  <span className="sidebar-account-copy"><strong>Not signed in</strong><small>Sign in to save settings and verify your character.</small></span>
                </div>
                {userAuth.discordLoginEnabled ? <button className="sidebar-account-action" onClick={() => discordLogin()}><MessageCircle size={14} /> Sign in with Discord</button> : <span className="sidebar-account-disabled">Discord login unavailable</span>}
              </>
            )}
          </section>
          <a className="discord-cta" href={DISCORD_URL} target="_blank" rel="noreferrer"><DiscordIcon size={18} /><span>Join Discord Server</span><ExternalLink size={13} /></a>
        </div>
        <nav ref={navigationRef} aria-label="Main navigation" data-tour="sidebar-navigation">
          {NAV_GROUPS.map((group) => {
            const hasActivePage = group.items.some(([id]) => active === id);
            const isOpen = sidebarGroups[group.id] ?? true;
            const showItems = isOpen || hasActivePage;
            return (
              <section className={`sidebar-section ${showItems ? "" : "is-collapsed"} ${hasActivePage ? "has-active" : ""}`} key={group.id}>
                <button
                  className="sidebar-section-title"
                  type="button"
                  aria-expanded={showItems}
                  onClick={() => setSidebarGroups((current) => ({ ...current, [group.id]: !(current[group.id] ?? true) }))}
                >
                  <span>{group.id === "settlement" ? settlementNavigationLabel(data.claim.name) : group.label}</span>
                  <ArrowDown size={12} aria-hidden="true" />
                </button>
                <div className="sidebar-section-items">
                  {group.items.map(([id, label, Icon]) => {
                    const restricted = !isPageAllowed(id);
                    const accessibleLabel = restricted ? `${label} — restricted` : label;
                    return (
                      <a
                        key={id}
                        className={[`nav-destination`, active === id ? "active" : "", restricted ? "is-restricted" : ""].filter(Boolean).join(" ")}
                        href={panelHref(id)}
                        aria-current={active === id ? "page" : undefined}
                        aria-label={restricted ? `${label} — restricted` : label}
                        data-restricted={restricted || undefined}
                        title={accessibleLabel}
                        onMouseEnter={(event) => showCollapsedNavTooltip(event.currentTarget, accessibleLabel)}
                        onMouseLeave={() => setCollapsedNavTooltip(null)}
                        onFocus={(event) => showCollapsedNavTooltip(event.currentTarget, accessibleLabel)}
                        onBlur={() => setCollapsedNavTooltip(null)}
                        onClick={(event) => {
                          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                          event.preventDefault();
                          navigate(id);
                          setMobileNavigationOpen(false);
                        }}
                      >
                        <Icon size={16} /><span className="nav-label">{label}</span>
                        <span className="collapsed-nav-label" aria-hidden="true">{label}</span>
                        {restricted ? <LockKeyhole className="nav-access-lock" size={13} aria-hidden="true" /> : null}
                      </a>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>
        <RefreshStatus
          loading={visibleRefreshProgress && state.loading && Boolean(state.data)}
          lastUpdated={lastUpdated}
          collectorStatus={data.raw?.collectorStatus}
          intervalSeconds={appSettings.refreshSeconds}
          warnings={apiWarnings}
          diagnostics={apiDiagnostics}
        />
      </aside>
        {collapsedNavTooltip ? <span className="collapsed-nav-tooltip" aria-hidden="true" style={{ left: collapsedNavTooltip.left, top: collapsedNavTooltip.top }}>{collapsedNavTooltip.label}</span> : null}
      </>) : null}
      <main ref={mainRef} tabIndex={-1}>
        <p role="status" aria-live="polite" aria-atomic="true" style={VISUALLY_HIDDEN_STYLE}>{routeStatus}</p>
        <p role="status" aria-live="polite" aria-atomic="true" style={VISUALLY_HIDDEN_STYLE}>{manualRefreshStatusText}</p>
        <div className={`page-refresh-line ${visibleRefreshProgress ? "is-visible" : ""}`} aria-hidden="true" />
        <GameDataQualityNotice
          activePanel={active}
          domainStatus={state.domainStatus ?? {}}
          responseMeta={state.responseMeta ?? null}
        />
        {state.loading && !state.data ? <AppSkeleton /> : state.error && !state.data ? (
          <>
            <ApiErrorState message={state.error} />
            <PageRefreshCycleSeal cycle={pageRefreshCycle} coordinator={pageRefreshCoordinator} />
          </>
        ) : (
          <>
            <div className="page-view" key={active}>
              <RouteErrorBoundary routeKey={active}>
                <React.Suspense fallback={<RouteLoadingState label={activePageLabel} />}>
                  <PageRefreshProvider page={active} cycle={pageRefreshCycle} coordinator={pageRefreshCoordinator}>
                    {activePanel}
                    <PageRefreshCycleSeal cycle={pageRefreshCycle} coordinator={pageRefreshCoordinator} />
                  </PageRefreshProvider>
                </React.Suspense>
              </RouteErrorBoundary>
            </div>
          </>
        )}
      {!dedicatedMapView && active !== "admin" ? <footer className="app-footer">
          <div className="footer-links">
            <span className="footer-copy">
              &copy; {new Date().getFullYear()} Timbersteel Claim Monitor - unofficial fan-made tool.
            </span>
            <span className="footer-build" title={appBuildId ? `Version ${APP_VERSION}, commit ${appBuildId}` : `Version ${APP_VERSION}`}>
              {appBuildLabel}
            </span>
            <a href="https://relay.bitcraftsync.app/" target="_blank" rel="noreferrer">Data: BitCraft Relay</a>
            <a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer"><ExternalLink size={13} /> GitHub</a>
            <a href={`${GITHUB_REPOSITORY}/issues`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Feature Requests</a>
            <BuyMeCoffeeButton />
            <button className="footer-link" onClick={() => setPrivacyOpen(true)}><Shield size={13} /> Privacy & Analytics</button>
            <button className="footer-link" onClick={() => setTermsOpen(true)}><FileText size={13} /> Terms & Bot Use</button>
          </div>
        </footer> : null}
      </main>
      {!dedicatedMapView ? (<>
        {releaseUpdateBuildId ? (
        <div className="release-update-banner" role="status" aria-live="polite">
          <div>
            <strong>Update available</strong>
            <span>A newer version is ready. Refresh to use the latest app.</span>
          </div>
          <button className="toolbar-button primary" onClick={() => window.location.reload()}>
            <RefreshCw size={14} /> Refresh now
          </button>
        </div>
      ) : releaseUpdatedNotice ? (
        <div className="release-update-banner is-updated" role="status" aria-live="polite">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <strong>App updated</strong>
            <span>
              You're now using the latest version.{" "}
              <a href={CHANGELOG_URL} target="_blank" rel="noreferrer">View changelog</a>
            </span>
          </div>
        </div>
      ) : null}
      <div className={`floating-actions ${narrowAwareFloatingActionsCollapsed ? "floating-actions-collapsed" : ""}`} aria-label="Application tools" data-tour="floating-actions">
        <button
          className="floating-actions-toggle"
          onClick={() => isNarrowViewport ? setMobileFloatingActionsOpen((current) => !current) : setFloatingActionsCollapsed((current) => !current)}
          aria-expanded={!narrowAwareFloatingActionsCollapsed}
          aria-label={narrowAwareFloatingActionsCollapsed ? "Show tools" : "Hide tools"}
          title={narrowAwareFloatingActionsCollapsed ? "Show tools" : "Hide tools"}
        >
          {narrowAwareFloatingActionsCollapsed ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
        </button>
        {adminAuth.authenticated ? <a
          className={`floating-action-item ${active === "admin" ? "active" : ""}`}
          href={panelHref("admin")}
          aria-label="Admin console"
          title="Admin console"
          onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            navigate("admin");
          }}
        >
          <KeyRound size={18} />
        </a> : null}
        <button
          className={`floating-action-item ${
            manualRefreshIsRefreshing ? "is-refreshing" : manualRefreshIsCoolingDown ? "is-cooldown" : ""
          }`}
          onClick={requestManualRefresh}
          aria-label={manualRefreshButtonLabel}
          title={manualRefreshButtonLabel}
          aria-busy={manualRefreshIsRefreshing}
          aria-disabled={manualRefreshButtonDisabled}
          disabled={manualRefreshButtonDisabled}
        >
          {manualRefreshIsCoolingDown ? (
            <span className="refresh-cooldown-countdown" aria-hidden="true">
              {manualRefreshCooldownSeconds}s
            </span>
          ) : (
            <RefreshCw size={18} />
          )}
        </button>
        <button className="floating-action-item" onClick={() => setUserSettingsOpen(true)} aria-label="Browser settings" title="Browser settings"><Settings size={18} /></button>
        <button className="floating-action-item notification-button" onClick={() => { setNoticeOpen(true); markNotificationLogRead(); }} aria-label="Updates" title="Updates"><Bell size={18} />{notificationLog.some((notice) => !notice.read) ? <b>{notificationLog.filter((notice) => !notice.read).length}</b> : null}</button>
        <button className="floating-action-item floating-help" onClick={() => setHelpOpen(true)} aria-label="Help and application information" title="Help and application information">?</button>
      </div>
      {!tourVisible ? <ToastStack notices={toasts} onDismiss={dismissToast} /> : null}
      {noticeOpen ? <NotificationDrawer notices={notificationLog} onClose={() => setNoticeOpen(false)} onOpenNotice={(notice) => { setNoticeOpen(false); navigate(notice.destination ?? "activity"); }} /> : null}
      {commandOpen ? <CommandPalette adminAuthenticated={Boolean(adminAuth.authenticated)} access={effectiveAccess} members={data.members} onClose={() => setCommandOpen(false)} onNavigate={(panel, tab) => navigate(panel, tab)} onSelectMember={setSelectedMemberId} /> : null}
        {active !== "admin" && consent != null && !discordPromptDismissed && userAuth.discordLoginEnabled && !userAuth.user ? <DiscordSignInPrompt onDiscordLogin={() => discordLogin()} onClose={() => setDiscordPromptDismissed(true)} onSettings={() => { setDiscordPromptDismissed(true); setUserSettingsOpen(true); }} /> : null}
      </>) : null}
      {userSettingsOpen ? <UserSettingsDialog density={density} onDensityChange={setDensity} toastSettings={normalizedUserToastSettings} appToastSettings={appSettings.toastSettings} onToastSettingsChange={(settings) => setUserToastSettings(normalizeUserToastSettings(settings))} theme={{ ...DEFAULT_THEME, ...browserTheme }} onThemeChange={setBrowserTheme} auth={userAuth} claimId={claimId} members={data.members} onDiscordLogin={() => discordLogin()} onDiscordLogout={discordLogout} onLinkCharacter={linkDiscordCharacter} onDiscordMarketSaleDmChange={setDiscordMarketSaleDm} showAdminTools={Boolean(adminAuth.authenticated)} onOpenAdmin={() => { setUserSettingsOpen(false); navigate("admin"); }} onPrivacyUserChanged={handlePrivacyUserChanged} onAnalyticsCleared={handleAnalyticsCleared} onDeleteAccount={() => setAccountDeletionOpen(true)} onResetSettings={() => { clearBrowserLocalSettings(); window.location.reload(); }} modal onClose={() => setUserSettingsOpen(false)} /> : null}
      {!dedicatedMapView ? (<>
        {helpOpen ? <HelpCenter activePage={active} version={APP_VERSION} onClose={() => setHelpOpen(false)} onPrivacy={() => setPrivacyOpen(true)} onTerms={() => setTermsOpen(true)} onStartTour={() => { setHelpOpen(false); setTourReplayToken((current) => current + 1); }} /> : null}
        {active !== "admin" && consent == null && !privacyOpen ? <CookieBanner onConsent={(choice) => { setAnalyticsPreference(choice); setConsent(choice); }} onPrivacy={() => setPrivacyOpen(true)} /> : null}
        {privacyOpen ? <PrivacyDialog consent={consent} onConsent={(choice) => { setAnalyticsPreference(choice); setConsent(choice); setPrivacyOpen(false); }} onClose={() => setPrivacyOpen(false)} /> : null}
        {termsOpen ? <TermsDialog onClose={() => setTermsOpen(false)} onPrivacy={() => setPrivacyOpen(true)} /> : null}
      </>) : null}
      {publicLegalPolicy && !accountDeletionOpen && (legalAcceptanceOpen || Boolean(userAuth.user && userAuth.legal.requiresAcceptance)) ? (
        <LegalAcceptanceDialog
          mode={userAuth.user && userAuth.legal.requiresAcceptance ? "existing-session" : "login"}
          policy={publicLegalPolicy}
          onContinue={userAuth.user && userAuth.legal.requiresAcceptance ? acceptCurrentLegalPolicy : startDiscordLogin}
          onClose={() => setLegalAcceptanceOpen(false)}
          onLogout={userAuth.user && userAuth.legal.requiresAcceptance ? discordLogout : undefined}
          onDeleteAccount={userAuth.user && userAuth.legal.requiresAcceptance ? () => setAccountDeletionOpen(true) : undefined}
        />
      ) : null}
      {accountDeletionOpen ? <AccountDeletionDialog auth={userAuth} onDeleted={handleAccountDeleted} onClose={() => setAccountDeletionOpen(false)} /> : null}
      {!dedicatedMapView ? (<>
        <FirstRunTourManager activePage={active} enabled={active !== "admin" && consent != null && !userSettingsOpen && !helpOpen && !privacyOpen && !termsOpen && !commandOpen && !noticeOpen && !(!discordPromptDismissed && userAuth.discordLoginEnabled && !userAuth.user)} showAccountStep={userAuth.discordLoginEnabled} replayToken={tourReplayToken} onNavigate={(panel) => navigate(panel)} onVisibilityChange={setTourVisible} />
        <AppPopupManager activePage={active} enabled={active !== "admin" && !tourVisible && !userSettingsOpen && !helpOpen && !privacyOpen && !termsOpen && !commandOpen && !noticeOpen} />
      </>) : null}
    </div>
  );
}

function DedicatedLegalApp({ type }: { type: "terms" | "privacy" }) {
  React.useEffect(() => {
    document.title = `${type === "terms" ? "Terms & Discord Bot Use" : "Privacy Policy"} — BitCraft Claim Monitor`;
  }, [type]);
  return <DedicatedLegalPage type={type} />;
}

/**
 * Dedicated bot dashboard route.
 *
 * This keeps bot administration separate from the public app while still using
 * the same AdminPanel implementation and server-side admin permissions.
 */
type BotControlConsoleProps = {
  settings: AppSettings;
  resolvedAuth: AnyRecord;
  onAuthChanged: (auth: AnyRecord) => void;
  onSettingsSaved: (settings: AppSettings) => void;
};

export function BotControlApp({
  initialConfig,
  renderConsole,
}: {
  initialConfig?: BootstrapPayload["config"];
  renderConsole?: (props: BotControlConsoleProps) => React.ReactNode;
}) {
  const initialPublicSettings = React.useMemo(() => normalizeAppSettings(initialConfig ?? DEFAULT_SETTINGS), [initialConfig]);
  const [state, setState] = React.useState<{
    status: "loading" | "ready" | "signed-out" | "error";
    publicSettings: AppSettings;
    settings: AppSettings | null;
    auth: AnyRecord | null;
    error: string;
  }>(() => ({ status: "loading", publicSettings: initialPublicSettings, settings: null, auth: null, error: "" }));
  const [reloadSequence, setReloadSequence] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    document.title = "Discord Bot Control — BitCraft Claim Monitor";
    async function load() {
      setState((current) => ({ ...current, status: "loading", settings: null, auth: null, error: "" }));
      try {
        let publicSettings = initialPublicSettings;
        if (!initialConfig) {
          const response = await fetch(`${LOCAL_API}/config`);
          if (!response.ok) throw new Error(`Public configuration failed with HTTP ${response.status}.`);
          publicSettings = normalizeAppSettings(await response.json());
        }
        applyTheme(publicSettings.theme);
        const { auth, settings } = await loadAdminConsoleSession(fetch);
        if (cancelled) return;
        if (!auth.authenticated) {
          setState({ status: "signed-out", publicSettings, settings: null, auth, error: "" });
          return;
        }
        if (!settings) throw new Error("Protected administrator settings were unavailable.");
        applyTheme(settings.theme);
        setState({ status: "ready", publicSettings, settings, auth, error: "" });
      } catch (error) {
        if (!cancelled) setState((current) => ({ ...current, status: "error", settings: null, auth: null, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [initialConfig, initialPublicSettings, reloadSequence]);
  if (state.status === "loading") return <main><AppSkeleton /></main>;
  if (state.status === "error") return (
    <main className="bot-control-page route-entry-state">
      <section className="empty-state panel" role="alert">
        <strong>Discord Bot Control could not be loaded safely.</strong>
        <span>{state.error}</span>
        <button className="toolbar-button primary" onClick={() => setReloadSequence((value) => value + 1)}>Try again</button>
      </section>
    </main>
  );
  const settings = state.settings ?? state.publicSettings;
  const consoleProps: BotControlConsoleProps = {
    settings,
    resolvedAuth: state.auth ?? { authenticated: false },
    onAuthChanged: (auth) => {
      if (auth.authenticated) setReloadSequence((value) => value + 1);
      else setState((current) => ({ ...current, status: "signed-out", settings: null, auth }));
    },
    onSettingsSaved: (next) => {
      setState((current) => ({ ...current, settings: next }));
      applyTheme(next.theme);
    },
  };
  return (
    <main className="bot-control-page">
      {renderConsole
        ? renderConsole(consoleProps)
        : <AdminPanel key={state.status} {...consoleProps} botOnly headingLevel={1} />}
    </main>
  );
}

export default function App({ initialBootstrap }: { initialBootstrap: BootstrapPayload }) {
  const dedicatedLegalPath = window.location.pathname === "/terms" ? "terms" : window.location.pathname === "/privacy" ? "privacy" : null;
  const dedicatedBotPath = window.location.pathname === "/bot" || window.location.hostname.toLowerCase().startsWith("bot.");
  // Route-level branching happens before mounting DashboardApp so legal pages
  // and the bot console do not initialise public page data unnecessarily.
  if (dedicatedLegalPath) return <DedicatedLegalApp type={dedicatedLegalPath} />;
  if (dedicatedBotPath) return <BotControlApp initialConfig={initialBootstrap.config} />;
  return <DashboardApp initialBootstrap={initialBootstrap} />;
}
