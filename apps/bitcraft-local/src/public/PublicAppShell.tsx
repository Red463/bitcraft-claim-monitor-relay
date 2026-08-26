import React from "react";
import { Hammer } from "lucide-react";
import type { FrontendProfile } from "../api/profile";
import { searchPublicCatalog } from "./api";
import { PublicAccountSettings } from "./PublicAccountSettings";
import { PublicClaimFinder } from "./PublicClaimFinder";
import { PublicClaimPages } from "./PublicClaimPages";
import { PublicChrome } from "./PublicChrome";
import { PublicLegalPage } from "./PublicLegalPage";
import { PublicPlanAccessPage } from "./PublicPlanAccessPage";
import { PublicPlansPage } from "./PublicPlansPage";
import { readRecentClaims } from "./preferences.mjs";
import type { PublicRoute } from "./routes.mjs";
import { usePublicSnapshot } from "./usePublicSnapshot";

type PublicFeatures = FrontendProfile["features"];
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const PUBLIC_TITLES: Partial<Record<PublicRoute["id"], string>> = { dashboard: "Overview", members: "Members", professions: "Professions", inventory: "Shared inventory", crafts: "Craft monitor", calculator: "Craft calculator" };
const title = (route: PublicRoute) => PUBLIC_TITLES[route.id] ?? "Claim Monitor";

function WelcomePanel() {
  return <section className="public-panel public-welcome"><header><p className="public-eyebrow">Public BitCraft claim data</p><h1>Welcome to Claim Monitor</h1><p>Claim Monitor provides current, read-only data for BitCraft claims, including the overview, members and professions, shared inventory, and crafts.</p></header><ol><li><strong>Find your claim</strong><span>Enter at least three characters from its name, or paste the exact claim ID.</span></li><li><strong>Select the correct claim</strong><span>Check the claim name, claim ID, and region before opening it.</span></li><li><strong>Explore current data</strong><span>Use the claim navigation to open Overview, Members, Inventory, and Craft monitor.</span></li></ol><p className="public-welcome-note">Claim data is loaded on demand and refreshes while the page is open. Claim Monitor does not continuously monitor public claims or provide public history, notifications, or Discord services.</p></section>;
}

function HomeExperience() {
  const [showWelcome] = React.useState(() => readRecentClaims(window.localStorage).length === 0);
  return <>{showWelcome ? <WelcomePanel /> : null}<PublicClaimFinder mode="home" idPrefix="home-claim-finder" /></>;
}

function Calculator() {
  const [query, setQuery] = React.useState(""); const [results, setResults] = React.useState<Row[]>([]); const [message, setMessage] = React.useState("");
  async function search(event: React.FormEvent) { event.preventDefault(); try { const payload = await searchPublicCatalog(query); setResults([...rows(payload.items), ...rows(payload.cargos)]); setMessage(""); } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Catalog search is unavailable."); } }
  return <section className="public-panel"><h1>Craft calculator</h1><p>Search the shared global catalog. This tool does not use claim-specific data.</p><form className="public-catalog-search" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search catalog" /><button className="toolbar-button primary">Search</button></form>{message && <p role="alert">{message}</p>}<div className="public-table">{results.map((item) => <article key={`${String(item.itemType)}:${String(item.id)}`}><strong>{String(item.name ?? "Catalog entry")}</strong><span>{item.itemType === 1 || item.kind === "cargo" ? "Cargo" : "Item"} · #{String(item.id ?? "—")}</span></article>)}</div></section>;
}

function Help() { return <section className="public-panel public-help"><h1>Help</h1><section><h2>Finding a claim</h2><p>Enter at least three characters from a BitCraft claim name, or paste its exact claim ID. Select the correct claim by checking its name, claim ID, and region.</p></section><section><h2>Viewing current data</h2><p>Use the claim navigation to view its Overview, Members and professions, Shared inventory, and Craft monitor pages.</p></section><section><h2>How public data works</h2><p>Claim data is loaded on demand and refreshes while the page is visible. Public claims have no public history, alerts, notifications, or Discord services.</p></section></section>; }
function Placeholder({ route }: { route: PublicRoute }) { return <section className="public-panel public-placeholder"><h1>{title(route)}</h1><p>That public page is not available.</p></section>; }
const ROADMAP_TITLES: Record<string, string> = { leaderboard: "Leaderboard", construction: "Construction", research: "Research", "local-market": "Local Market", market: "Market", region: "Region", empires: "Empires", map: "Map", activity: "Activity", "public-craft-finder": "Public Craft Finder" };
const defaultFeatures: PublicFeatures = { publicProfileEnabled: false, publicCollaborationEnabled: false, publicLegalConfigurationConfirmed: false };
export function PublicAppShell({ route, features = defaultFeatures }: { route: PublicRoute; features?: PublicFeatures }) {
  const snapshotRoute = features.publicProfileEnabled ? route : { id: "not-found", params: {} } as PublicRoute;
  const snapshotController = usePublicSnapshot(snapshotRoute);
  const [claimFinderOpen, setClaimFinderOpen] = React.useState(false);
  React.useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if (!features.publicProfileEnabled || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setClaimFinderOpen(true);
    };
    document.addEventListener("keydown", open);
    return () => document.removeEventListener("keydown", open);
  }, [features.publicProfileEnabled]);
  const openClaimFinder = () => { if (features.publicProfileEnabled) setClaimFinderOpen(true); };
  if (!features.publicProfileEnabled) return <PublicChrome route={route} features={features} controller={snapshotController} onOpenClaimFinder={openClaimFinder}><div className="page-view public-page-view"><section className="public-panel public-placeholder"><h1>Claim Monitor</h1><p>The public claim service is not enabled yet.</p></section></div></PublicChrome>;
  const claimPage = ["dashboard", "members", "professions", "inventory", "crafts"].includes(route.id); const identity = route.id === "account" || route.id === "settings"; const legal = route.id === "terms" || route.id === "privacy"; const planAccess = route.id === "shared-plan" || route.id === "invite"; const planWorkspace = ["plans", "plan-new", "plan"].includes(route.id); const collaborationRoute = identity || planAccess || planWorkspace;
  const pageContent = collaborationRoute && !features.publicCollaborationEnabled
    ? <section className="public-panel public-placeholder"><h1>Collaboration is not enabled yet</h1><p>Public claim search and current-state pages remain available.</p></section>
    : claimPage ? <PublicClaimPages route={route} controller={snapshotController} />
      : route.id === "calculator" ? <Calculator />
        : route.id === "home" ? null
          : route.id === "help" ? <Help />
            : identity ? <PublicAccountSettings page={route.id as "account" | "settings"} />
              : legal ? <PublicLegalPage type={route.id as "terms" | "privacy"} />
                : planAccess ? <PublicPlanAccessPage route={route as { id: "shared-plan" | "invite"; params: Record<string, string> }} />
                  : planWorkspace ? <PublicPlansPage route={route as { id: "plans" | "plan-new" | "plan"; params: Record<string, string> }} />
                    : route.id === "coming-soon" ? <section className="public-panel public-placeholder"><h1>{ROADMAP_TITLES[route.params.feature] ?? "Claim feature"}</h1><p>This claim feature is coming soon.</p></section>
                      : <Placeholder route={route} />;
  return <><PublicChrome route={route} features={features} controller={snapshotController} onOpenClaimFinder={openClaimFinder}><div className="page-view public-page-view">{route.id === "home" ? <HomeExperience /> : null}{pageContent}</div></PublicChrome>{claimFinderOpen ? <PublicClaimFinder mode="dialog" idPrefix="dialog-claim-finder" autoFocus onSelect={() => setClaimFinderOpen(false)} onClose={() => setClaimFinderOpen(false)} /> : null}</>;
}
