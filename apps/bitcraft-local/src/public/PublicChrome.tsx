import React from "react";
import { CircleHelp, Clock3, RefreshCw, Search, Settings, UserRound } from "lucide-react";
import packageJson from "../../package.json";

import type { FrontendProfile } from "../api/profile";
import {
  AppFooter,
  AppFrame,
  AppSidebar,
  AppUtilityBar,
  type AppUtilityAction,
} from "../components/app-chrome";
import { BuyMeCoffeeButton } from "../components/main/SupportLinks";
import { loadPublicSession, type PublicSession } from "./accountApi";
import { publicStorageKey } from "./routes.mjs";
import type { PublicRoute } from "./routes.mjs";
import type { PublicSnapshotController } from "./usePublicSnapshot";
import { buildPublicNavigation } from "./publicNavigation";

const APP_VERSION = packageJson.version;
const GITHUB_REPOSITORY = "https://github.com/Red463/bitcraft-claim-monitor-relay";
const CURRENT_DATA_ROUTES = new Set(["dashboard", "members", "professions", "inventory", "crafts"]);
const ROADMAP_LABELS: Record<string, string> = {
  leaderboard: "Leaderboard",
  construction: "Construction",
  research: "Research",
  "local-market": "Local Market",
  market: "Market",
  region: "Region",
  empires: "Empires",
  map: "Map",
  activity: "Activity",
  "public-craft-finder": "Public Craft Finder",
};
const PAGE_LABELS: Partial<Record<PublicRoute["id"], string>> = {
  home: "Find a claim",
  dashboard: "Dashboard",
  members: "Members",
  professions: "Professions",
  inventory: "Inventory",
  crafts: "Craft Monitor",
  calculator: "Craft Calculator",
  plans: "Plans",
  "plan-new": "New plan",
  plan: "Craft plan",
  "shared-plan": "Shared plan",
  invite: "Plan invitation",
  account: "Account",
  settings: "Account settings",
  help: "Help",
  terms: "Terms",
  privacy: "Privacy",
};

function pageLabel(route: PublicRoute): string {
  if (route.id === "coming-soon") return ROADMAP_LABELS[route.params.feature] ?? "Coming soon";
  return PAGE_LABELS[route.id] ?? "Claim Monitor";
}

export function readPublicGroupState(storage: Storage): Record<string, boolean> {
  try {
    const parsed = JSON.parse(storage.getItem(publicStorageKey("layout.sidebar-groups")) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return {};
  }
}

function PublicAccountCard({ enabled }: { enabled: boolean }) {
  const [session, setSession] = React.useState<PublicSession | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadPublicSession().then((next) => {
      if (!cancelled) setSession(next);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [enabled]);

  if (!enabled) {
    return <section className="sidebar-account-card signed-out" aria-label="Account"><div className="sidebar-account-main"><span className="sidebar-account-avatar"><UserRound size={16} /></span><span className="sidebar-account-copy"><strong>Accounts</strong><small>Accounts and shared plans are coming soon.</small></span></div></section>;
  }
  if (!session && !failed) {
    return <section className="sidebar-account-card signed-out" aria-label="Account"><div className="sidebar-account-main"><span className="sidebar-account-avatar"><Clock3 size={16} /></span><span className="sidebar-account-copy"><strong>Account</strong><small>Loading account state…</small></span></div></section>;
  }
  if (session?.user) {
    const displayName = session.user.globalName || session.user.username;
    return <section className="sidebar-account-card signed-in" aria-label="Account"><a className="sidebar-account-main" href="/settings" title="Open account settings"><span className="sidebar-account-avatar">{session.user.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : displayName.slice(0, 1).toUpperCase()}</span><span className="sidebar-account-copy"><strong>{displayName}</strong><small>Plans and account settings</small></span></a></section>;
  }
  return <section className="sidebar-account-card signed-out" aria-label="Account"><div className="sidebar-account-main"><span className="sidebar-account-avatar"><UserRound size={16} /></span><span className="sidebar-account-copy"><strong>Not signed in</strong><small>{failed ? "Account status is temporarily unavailable." : "Sign in to create and share plans."}</small></span></div><a className="sidebar-account-action" href="/settings">Account settings</a></section>;
}

export function PublicChrome({
  route,
  features,
  controller,
  onOpenClaimFinder,
  children,
}: {
  route: PublicRoute;
  features: FrontendProfile["features"];
  controller: PublicSnapshotController;
  onOpenClaimFinder: () => void;
  children: React.ReactNode;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    try { return window.localStorage.getItem(publicStorageKey("layout.sidebar-collapsed")) === "true"; } catch { return false; }
  });
  const [sidebarGroups, setSidebarGroups] = React.useState<Record<string, boolean>>(() => readPublicGroupState(window.localStorage));

  React.useEffect(() => {
    try { window.localStorage.setItem(publicStorageKey("layout.sidebar-collapsed"), String(sidebarCollapsed)); } catch { /* browser storage is optional */ }
  }, [sidebarCollapsed]);
  React.useEffect(() => {
    try { window.localStorage.setItem(publicStorageKey("layout.sidebar-groups"), JSON.stringify(sidebarGroups)); } catch { /* browser storage is optional */ }
  }, [sidebarGroups]);

  const claimName = String(controller.claim.name ?? "").trim();
  const groups = buildPublicNavigation({
    route,
    claimId: controller.claimId,
    claimName,
    collaborationEnabled: features.publicCollaborationEnabled,
    groupState: sidebarGroups,
    onGroupExpandedChange: (groupId, expanded) => setSidebarGroups((current) => ({ ...current, [groupId]: expanded })),
  });
  const brand = controller.claimId
    ? { logoUrl: "/claim-monitor-logo.png", title: claimName || `Claim #${controller.claimId}`, subtitle: "Claim Monitor" }
    : { logoUrl: "/claim-monitor-logo.png", title: "Claim Monitor", subtitle: "Public claim data" };
  const statusLabel = !controller.claimId ? "Select a claim"
    : controller.loading && !controller.snapshot ? "Loading on demand"
      : "On-demand data";
  const statusNode = (
    <div className="refresh-status" aria-label={statusLabel} tabIndex={0}>
      <span className={`refresh-dot ${controller.refreshing ? "refreshing" : ""}`} />
      <span className="refresh-copy"><small>{statusLabel}</small><time>{controller.lastUpdated ? controller.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Waiting..."}</time></span>
      {controller.warnings.length > 0 ? <span className="public-status-warning" title={controller.warnings.join(" ")}>{controller.warnings.length}</span> : null}
    </div>
  );
  const currentDataRoute = CURRENT_DATA_ROUTES.has(route.id);
  const utilityActions: AppUtilityAction[] = [
    ...(controller.claimId && currentDataRoute ? [{ id: "refresh", label: controller.refreshing ? "Refreshing claim data" : "Refresh claim data", icon: RefreshCw, className: `app-utility-refresh ${controller.refreshing ? "is-refreshing" : ""}`, busy: controller.refreshing, disabled: controller.refreshing, onActivate: () => void controller.refresh() }] : []),
    ...(features.publicCollaborationEnabled ? [{ id: "settings", label: "Account settings", icon: Settings, href: "/settings" }] : []),
    { id: "help", label: "Help and application information", icon: CircleHelp, href: "/help" },
  ];
  const footerPrimary = <><span className="footer-copy">&copy; {new Date().getFullYear()} Claim Monitor - unofficial fan-made tool.</span><span className="footer-build" title={`Version ${APP_VERSION}`}>v{APP_VERSION}</span><a href="https://relay.bitcraftsync.app/" target="_blank" rel="noreferrer">Data: BitCraft Relay</a></>;
  const footerSecondary = <><a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer">GitHub</a><a href={`${GITHUB_REPOSITORY}/issues`} target="_blank" rel="noreferrer">Feature Requests</a><BuyMeCoffeeButton /><a href="/privacy">Privacy</a><a href="/terms">Terms</a></>;
  const shellClassName = `app-shell public-profile-shell density-normal surface-mode-public ${sidebarCollapsed ? "sidebar-collapsed" : ""}`;

  return (
    <AppFrame
      shellClassName={shellClassName}
      pageLabel={pageLabel(route)}
      routeKey={`${route.id}:${route.params.claimId ?? ""}:${route.params.feature ?? ""}`}
      sidebar={({ mobileOpen, onRequestClose }) => <AppSidebar brand={brand} collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} groups={groups} account={<PublicAccountCard enabled={features.publicCollaborationEnabled} />} status={statusNode} mobileOpen={mobileOpen} onRequestClose={onRequestClose} />}
      utilityBar={<AppUtilityBar contextLabel="Claim Monitor" pageLabel={pageLabel(route)} command={{ label: "Find a claim", ariaLabel: "Find a claim", shortcut: "Ctrl K", icon: Search, onActivate: onOpenClaimFinder }} actions={utilityActions} />}
      footer={<AppFooter primary={footerPrimary} secondary={footerSecondary} />}
      refreshLineVisible={currentDataRoute ? controller.refreshing : null}
    >
      {children}
    </AppFrame>
  );
}
