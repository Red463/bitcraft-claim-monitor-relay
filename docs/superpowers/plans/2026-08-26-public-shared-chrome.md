# Public Shared Claim Monitor Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `claim-monitor.com` use the dedicated application's visual chrome while preserving strict profile isolation, claim-only public language, visitor-driven data loading, and every existing dedicated capability.

**Architecture:** Extract the frame, grouped sidebar, utility bar, and footer into presentation-only React components. The dedicated and public roots supply separate navigation, account, refresh, footer, and route models; public snapshot ownership moves into a focused hook so the public chrome can display selected-claim identity and freshness without importing dedicated logic.

**Tech Stack:** React 19, TypeScript 5.9, Vite, Lucide React, plain CSS, Node 24 test runner, happy-dom, pnpm via Corepack.

**Spec:** `docs/superpowers/specs/2026-08-26-public-shared-chrome-design.md`

## Global Constraints

- Existing dedicated pages, routes, settings, cookies, local-storage keys, Admin, bot, worker, history, notifications, Discord, and outbox behavior must remain unchanged.
- Public components must not import `AppShell`, `TimbersteelRoot`, dedicated bootstrap logic, `/api/local/` clients, generation watchers, Admin, bot, notification, history, or Discord-service modules.
- No public-rendered copy, document metadata, accessibility label, navigation entry, footer content, or link may contain `settlement` or `Timbersteel`.
- Canonical user-visible public claim routes use `/claims/<claimId>`; old `/settlements/...` bookmarks must canonicalize without losing the query string or fragment.
- Future public-facing pages remain visible and disabled with an accessible `Coming soon` state; Admin, Sync, Discord-management controls, and notifications remain absent.
- Public snapshot refresh stays at 60 seconds while visible, pauses while hidden, uses existing server caches/rate limits, and stops when no public page is open.
- Public layout preferences stay under `claim-monitor.public.*`; existing dedicated preference keys and existing public recent-claim data remain valid.
- Shared chrome components are presentation-only and receive all capabilities through props.
- Do not add a dependency, service, worker, database, timer, schema migration, or deployment topology change.
- Use test-first changes, run the focused test after each red/green step, and commit only the files named by that task.

---

## File Structure

### New shared chrome files

- `apps/bitcraft-local/src/components/app-chrome/types.ts` — profile-neutral brand, navigation, command, and utility-action models.
- `apps/bitcraft-local/src/components/app-chrome/AppSidebar.tsx` — brand, grouped navigation, disabled destinations, account slot, status slot, collapse behavior, and collapsed labels.
- `apps/bitcraft-local/src/components/app-chrome/AppFrame.tsx` — desktop grid, mobile bar/drawer state, utility placement, main scrolling region, footer placement, and overlay slot.
- `apps/bitcraft-local/src/components/app-chrome/AppUtilityBar.tsx` — configurable context, command, and action row.
- `apps/bitcraft-local/src/components/app-chrome/AppFooter.tsx` — common primary/secondary footer structure.
- `apps/bitcraft-local/src/components/app-chrome/index.ts` — public exports for the shared visual boundary.

### New public files

- `apps/bitcraft-local/src/public/PublicClaimFinder.tsx` — one claim-search implementation for the home panel and top-bar dialog.
- `apps/bitcraft-local/src/public/PublicClaimPages.tsx` — Dashboard, Members, Professions, Inventory, and Craft Monitor projections.
- `apps/bitcraft-local/src/public/usePublicSnapshot.ts` — selected-claim snapshot, refresh, visible cadence, warning, freshness, and recent-claim ownership.
- `apps/bitcraft-local/src/public/publicNavigation.ts` — public navigation groups and `available`, `claim-required`, or `coming-soon` availability.
- `apps/bitcraft-local/src/public/PublicChrome.tsx` — public adaptation of the shared frame, account card, on-demand status, utility actions, and footer.

### Existing files changed

- `apps/bitcraft-local/src/AppShell.tsx` — replace inline visual chrome with shared components while retaining all dedicated state and callbacks.
- `apps/bitcraft-local/src/public/PublicAppShell.tsx` — compose public pages inside `PublicChrome` and own the claim-finder dialog state.
- `apps/bitcraft-local/src/public/PublicRoot.tsx` — canonicalize old public claim paths.
- `apps/bitcraft-local/src/public/routes.mjs` and `routes.d.mts` — canonical `/claims/` URLs, Dashboard and Professions routes, and known roadmap routes.
- `apps/bitcraft-local/src/public/api.ts` — expose claim-named browser helpers while preserving existing server endpoints.
- `apps/bitcraft-local/src/public/preferences.mjs` and `preferences.d.mts` — expose claim-named helpers while preserving the existing storage key and data.
- `apps/bitcraft-local/src/public/PublicAccountSettings.tsx`, `PublicPlansPage.tsx`, and `PublicPlanAccessPage.tsx` — claim-only rendered wording.
- `apps/bitcraft-local/src/legal/legalPolicy.mjs` — claim-only public policy and a new public legal version; dedicated policy text stays unchanged.
- `apps/bitcraft-local/src/server/public/publicData.mjs` — claim-only public error and stale-warning text; API paths stay unchanged.
- `apps/bitcraft-local/src/server/public/publicPlans.mjs` — claim-only public computation labels and warnings.
- `apps/bitcraft-local/src/styles.css`, `styles/app-chrome.css`, and `styles/public-shell.css` — one chrome layout with public content-only rules.
- `apps/bitcraft-local/test/*.test.mjs` files named below — route, shared chrome, public UI, legal, copy, CSS, and regression coverage.

---

### Task 1: Canonical Claim Routes and Claim-Named Browser Helpers

**Files:**
- Modify: `apps/bitcraft-local/src/public/routes.mjs`
- Modify: `apps/bitcraft-local/src/public/routes.d.mts`
- Modify: `apps/bitcraft-local/src/public/PublicRoot.tsx`
- Modify: `apps/bitcraft-local/src/public/api.ts`
- Modify: `apps/bitcraft-local/src/public/preferences.mjs`
- Modify: `apps/bitcraft-local/src/public/preferences.d.mts`
- Modify: `apps/bitcraft-local/src/public/PublicAppShell.tsx`
- Test: `apps/bitcraft-local/test/public-shell.test.mjs`

**Interfaces:**
- Produces: `publicClaimPath(hint): string | null`.
- Produces: `resolvePublicRoute(pathname): PublicRoute`, where `PublicRoute` may contain `canonicalPath?: string`.
- Produces: public route IDs `home`, `dashboard`, `members`, `professions`, `inventory`, `crafts`, `calculator`, collaboration routes, legal routes, `coming-soon`, and `not-found`.
- Produces: `searchPublicClaims`, `readRecentClaims`, `addRecentClaim`, and `claimPreferenceKey` browser helpers.
- Preserves: `/api/public/settlements/**` server endpoints and the `claim-monitor.public.recent-settlements` storage key.

- [ ] **Step 1: Write failing canonical-route and compatibility tests**

Replace the route assertions in `public-shell.test.mjs` with exact claim-route expectations:

```js
test("public routes use claim URLs and canonicalize legacy bookmarks", () => {
  assert.deepEqual(resolvePublicRoute("/"), { id: "home", params: {} });
  assert.deepEqual(resolvePublicRoute("/claims/42"), { id: "dashboard", params: { claimId: "42" } });
  assert.deepEqual(resolvePublicRoute("/claims/42/professions"), { id: "professions", params: { claimId: "42" } });
  assert.deepEqual(resolvePublicRoute("/settlements/42/members"), {
    id: "members",
    params: { claimId: "42" },
    canonicalPath: "/claims/42/members",
  });
  assert.deepEqual(resolvePublicRoute("/claims/42/map"), {
    id: "coming-soon",
    params: { claimId: "42", feature: "map" },
  });
  assert.deepEqual(resolvePublicRoute("/admin"), { id: "not-found", params: {} });
});

test("publicClaimPath preserves canonical unsigned 64-bit claim IDs", () => {
  assert.equal(publicClaimPath({ claimId: "42" }), "/claims/42");
  assert.equal(publicClaimPath({ claimId: "18446744073709551615" }), "/claims/18446744073709551615");
  assert.equal(publicClaimPath({ claimId: "18446744073709551616" }), null);
});

test("claim-named preferences retain existing recent-claim storage", () => {
  addRecentClaim(localStorage, { claimId: "42", name: "Northwatch", regionId: "7" });
  assert.deepEqual(readRecentClaims(localStorage), [{ claimId: "42", name: "Northwatch", regionId: "7" }]);
  assert.ok(localStorage.getItem("claim-monitor.public.recent-settlements"));
  assert.equal(claimPreferenceKey("42", "inventory-filter"), "claim-monitor.public.settlement.42.inventory-filter");
});
```

- [ ] **Step 2: Run the focused route test and verify red state**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-shell.test.mjs
```

Expected: FAIL because `publicClaimPath`, `dashboard`, `professions`, and `canonicalPath` do not exist.

- [ ] **Step 3: Implement canonical routes and compatibility aliases**

Implement the route shape in `routes.mjs`:

```js
const CLAIM_PAGES = new Set(["members", "professions", "inventory", "crafts"]);
const ROADMAP_PAGES = new Set(["leaderboard", "construction", "research", "local-market", "market", "region", "empires", "map", "activity", "public-craft-finder"]);

export function publicClaimPath(hint) {
  const claimId = String(hint?.claimId ?? "");
  return isCanonicalClaimId(claimId) ? `/claims/${claimId}` : null;
}

export function publicSettlementPath(hint) {
  return publicClaimPath(hint);
}

function claimRoute(segments, legacy = false) {
  if (segments.length < 2 || !isCanonicalClaimId(segments[1])) return NOT_FOUND;
  const claimId = segments[1];
  const suffix = segments[2] ?? "";
  const canonicalPath = `/claims/${claimId}${suffix ? `/${suffix}` : ""}`;
  const canonical = legacy ? { canonicalPath } : {};
  if (segments.length === 2) return route("dashboard", { claimId }, canonical);
  if (segments.length === 3 && CLAIM_PAGES.has(suffix)) return route(suffix, { claimId }, canonical);
  if (segments.length === 3 && ROADMAP_PAGES.has(suffix)) return route("coming-soon", { claimId, feature: suffix }, canonical);
  return NOT_FOUND;
}
```

Change `route` to merge optional metadata:

```js
function route(id, params = {}, metadata = {}) {
  return { id, params, ...metadata };
}
```

Map `/claims/` through `claimRoute(segments, false)`, `/settlements/` through `claimRoute(segments, true)`, and `/` to `home`. Update declarations with `canonicalPath?: string`, `publicClaimPath`, and the new IDs.

Expose claim-named helper names without changing persisted keys:

```js
export const readRecentClaims = readRecentSettlements;
export const addRecentClaim = addRecentSettlement;
export const claimPreferenceKey = settlementPreferenceKey;
```

In `api.ts`, export `searchPublicClaims` as the browser-facing function while retaining the same endpoint:

```ts
export function searchPublicClaims(query: string, signal?: AbortSignal) {
  return publicJson<PublicSearchResponse>(
    `/api/public/settlements/search?q=${encodeURIComponent(query)}`,
    signal,
  );
}
```

Update `PublicAppShell.tsx` minimally so `home` replaces `overview`, `dashboard` replaces `settlement`, and `professions` reaches the current roster view until Task 4 separates the projection.

Remove the local `{ id: string; params: Record<string, string> }` route type from public components and import `PublicRoute` from `routes.mjs`, so later tasks consume the declaration defined here.

- [ ] **Step 4: Canonicalize old paths in `PublicRoot`**

Add an effect that preserves the query and fragment and then replaces the route model:

```tsx
React.useEffect(() => {
  if (!route.canonicalPath) return;
  const canonicalUrl = `${route.canonicalPath}${window.location.search}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", canonicalUrl);
  setRoute(resolvePublicRoute(route.canonicalPath));
}, [route.canonicalPath]);
```

- [ ] **Step 5: Run focused tests and build**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-shell.test.mjs test/public-profile-gate-ui.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: both test files PASS and the production build succeeds.

- [ ] **Step 6: Commit the route foundation**

```text
git add apps/bitcraft-local/src/public/routes.mjs apps/bitcraft-local/src/public/routes.d.mts apps/bitcraft-local/src/public/PublicRoot.tsx apps/bitcraft-local/src/public/api.ts apps/bitcraft-local/src/public/preferences.mjs apps/bitcraft-local/src/public/preferences.d.mts apps/bitcraft-local/src/public/PublicAppShell.tsx apps/bitcraft-local/test/public-shell.test.mjs apps/bitcraft-local/test/public-profile-gate-ui.test.mjs
git commit -m "feat(public): use canonical claim routes"
```

---

### Task 2: Profile-Neutral Shared Chrome Components

**Files:**
- Create: `apps/bitcraft-local/src/components/app-chrome/types.ts`
- Create: `apps/bitcraft-local/src/components/app-chrome/AppSidebar.tsx`
- Create: `apps/bitcraft-local/src/components/app-chrome/AppFrame.tsx`
- Create: `apps/bitcraft-local/src/components/app-chrome/AppUtilityBar.tsx`
- Create: `apps/bitcraft-local/src/components/app-chrome/AppFooter.tsx`
- Create: `apps/bitcraft-local/src/components/app-chrome/index.ts`
- Test: `apps/bitcraft-local/test/shared-app-chrome.test.mjs`

**Interfaces:**
- Produces: `AppBrand`, `AppNavigationItem`, `AppNavigationGroup`, `AppUtilityCommand`, and `AppUtilityAction` types.
- Produces: `AppFrame`, `AppSidebar`, `AppUtilityBar`, and `AppFooter` presentation components.
- Consumes no profile-specific API, state, or route module.

- [ ] **Step 1: Write the failing shared-component rendering test**

Create `shared-app-chrome.test.mjs` using the existing Vite/happy-dom harness:

```js
test("shared chrome renders grouped navigation, disabled destinations, utility actions, and footer slots", async () => {
  const dom = installDom("http://localhost/");
  const vite = await createViteServer({ root: appRoot, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
  let view;
  try {
    const chrome = await vite.ssrLoadModule("/src/components/app-chrome/index.ts");
    const { Home, Map: MapIcon, Search, CircleHelp } = await import("lucide-react");
    const sidebar = ({ mobileOpen, onRequestClose }) => React.createElement(chrome.AppSidebar, {
      brand: { logoUrl: "/claim-monitor-logo.png", title: "Claim Monitor", subtitle: "Public claim data" },
      collapsed: false,
      onCollapsedChange() {},
      groups: [{ id: "overview", label: "Overview", expanded: true, onExpandedChange() {}, items: [
        { id: "dashboard", label: "Dashboard", href: "/", icon: Home, active: true },
        { id: "map", label: "Map", icon: MapIcon, disabled: true, disabledReason: "Coming soon" },
      ] }],
      account: React.createElement("span", null, "Account state"),
      status: React.createElement("span", null, "On-demand data"),
      mobileOpen,
      onRequestClose,
    });
    const utility = React.createElement(chrome.AppUtilityBar, {
      contextLabel: "Claim Monitor",
      pageLabel: "Dashboard",
      command: { label: "Find a claim", ariaLabel: "Find a claim", shortcut: "Ctrl K", icon: Search, onActivate() {} },
      actions: [{ id: "help", label: "Help", icon: CircleHelp, onActivate() {} }],
    });
    view = await mount(React.createElement(chrome.AppFrame, {
      pageLabel: "Dashboard", routeKey: "dashboard", sidebar, utilityBar: utility,
      footer: React.createElement(chrome.AppFooter, { primary: React.createElement("span", null, "Primary"), secondary: React.createElement("span", null, "Secondary") }),
    }, React.createElement("section", null, "Page body")));

    assert.ok(document.querySelector(".app-shell"));
    assert.ok(document.querySelector(".app-sidebar"));
    assert.equal(document.querySelector('[aria-disabled="true"]')?.textContent.replace(/\s+/g, " ").trim(), "Map Coming soon");
    assert.equal(document.querySelector(".app-utility-command")?.textContent.replace(/\s+/g, " ").trim(), "Find a claimCtrl K");
    assert.equal(document.querySelector(".footer-primary")?.textContent, "Primary");
    assert.equal(document.querySelector(".footer-secondary")?.textContent, "Secondary");
  } finally {
    if (view) await view.unmount();
    await vite.close();
    dom.restore();
  }
});
```

Add a source-boundary test in the same file:

```js
test("shared chrome stays profile-neutral", () => {
  const joined = ["types.ts", "AppSidebar.tsx", "AppFrame.tsx", "AppUtilityBar.tsx", "AppFooter.tsx"]
    .map((name) => readFileSync(new URL(`../src/components/app-chrome/${name}`, import.meta.url), "utf8"))
    .join("\n");
  assert.doesNotMatch(joined, /AppShell|TimbersteelRoot|api\/local|api\/public|Admin|Discord|notification|history/i);
});
```

- [ ] **Step 2: Run the shared-component test and verify red state**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/shared-app-chrome.test.mjs
```

Expected: FAIL because the shared chrome module does not exist.

- [ ] **Step 3: Define the shared types**

Implement `types.ts` with these exact contracts:

```ts
import type React from "react";
import type { LucideIcon } from "lucide-react";

export type AppBrand = {
  logoUrl: string;
  fallbackLogoUrl?: string;
  title: string;
  subtitle: string;
  titleAttribute?: string;
};

export type AppNavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  active?: boolean;
  restricted?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onActivate?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
};

export type AppNavigationGroup = {
  id: string;
  label: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  items: AppNavigationItem[];
};

export type AppUtilityCommand = {
  label: string;
  ariaLabel: string;
  shortcut?: string;
  icon: LucideIcon;
  onActivate: () => void;
};

export type AppUtilityAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  badge?: number;
  content?: string;
  onActivate?: (event: React.MouseEvent<HTMLElement>) => void;
};

export type AppSidebarProps = {
  brand: AppBrand;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  groups: AppNavigationGroup[];
  account?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  status?: React.ReactNode;
  mobileOpen: boolean;
  onRequestClose: () => void;
};

export type AppFrameProps = {
  shellClassName?: string;
  pageLabel: string;
  routeKey: string;
  sidebar: ((mobile: { mobileOpen: boolean; onRequestClose: () => void }) => React.ReactNode) | null;
  utilityBar?: React.ReactNode;
  footer?: React.ReactNode;
  refreshLineVisible?: boolean | null;
  mainRef?: React.Ref<HTMLElement>;
  overlays?: React.ReactNode;
  children: React.ReactNode;
};

export type AppUtilityBarProps = {
  contextLabel: string;
  pageLabel: string;
  command: AppUtilityCommand;
  actions: AppUtilityAction[];
};
```

- [ ] **Step 4: Implement the shared components**

Implement `AppSidebar` so available items are anchors and disabled items are non-interactive link semantics:

```tsx
{item.disabled ? (
  <span className="nav-destination is-disabled" role="link" aria-disabled="true" title={`${item.label} — ${item.disabledReason}`}>
    <item.icon size={16} />
    <span className="nav-label">{item.label}</span>
    <small className="nav-status">{item.disabledReason}</small>
    <span className="collapsed-nav-label" aria-hidden="true">{item.label} — {item.disabledReason}</span>
  </span>
) : (
  <a className={["nav-destination", item.active ? "active" : "", item.restricted ? "is-restricted" : ""].filter(Boolean).join(" ")}
    href={item.href} aria-current={item.active ? "page" : undefined} onClick={item.onActivate}>
    <item.icon size={16} /><span className="nav-label">{item.label}</span>
    <span className="collapsed-nav-label" aria-hidden="true">{item.label}</span>
  </a>
)}
```

`AppSidebar` owns only the collapsed-label tooltip. `AppFrame` owns `mobileOpen`, invokes the `sidebar` render function with `mobileOpen` and `onRequestClose`, returns focus to the menu trigger after close, closes on `routeKey` changes, and renders this stable order:

```tsx
const resolvedShellClassName = shellClassName ?? "app-shell";

<div className={resolvedShellClassName}>
  {sidebar ? <><MobileShellBar /><MobileBackdrop />{sidebar({ mobileOpen, onRequestClose })}</> : null}
  <main ref={mainRef} tabIndex={-1}>
    {utilityBar}
    {refreshLineVisible == null ? null : <div className={`page-refresh-line ${refreshLineVisible ? "is-visible" : ""}`} aria-hidden="true" />}
    {children}
    {footer}
  </main>
  {overlays}
</div>
```

`AppUtilityBar` renders the command from its model and maps actions to anchors or buttons. Preserve the existing `app-utility-*`, refresh busy/cooldown content, notification badge, and focus class names through `className` and `content` props.

`AppFooter` is intentionally small:

```tsx
export function AppFooter({ primary, secondary }: { primary: React.ReactNode; secondary: React.ReactNode }) {
  return <footer className="app-footer"><div className="footer-links"><div className="footer-primary">{primary}</div><div className="footer-secondary">{secondary}</div></div></footer>;
}
```

- [ ] **Step 5: Run the focused test and build**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/shared-app-chrome.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: test PASS and build succeeds.

- [ ] **Step 6: Commit the shared visual boundary**

```text
git add apps/bitcraft-local/src/components/app-chrome apps/bitcraft-local/test/shared-app-chrome.test.mjs
git commit -m "feat(ui): add profile-neutral app chrome"
```

---

### Task 3: Move the Dedicated Root onto Shared Chrome Without Behavior Changes

**Files:**
- Modify: `apps/bitcraft-local/src/AppShell.tsx`
- Delete: `apps/bitcraft-local/src/components/main/AppUtilityBar.tsx`
- Modify: `apps/bitcraft-local/test/appshell-chrome-boundary.test.mjs`
- Modify: `apps/bitcraft-local/test/appshell-navigation-boundary.test.mjs`
- Modify: `apps/bitcraft-local/test/appshell-import-boundary.test.mjs`
- Test: `apps/bitcraft-local/test/shared-app-chrome.test.mjs`

**Interfaces:**
- Consumes: all shared chrome contracts from Task 2.
- Preserves: dedicated `navigate`, `panelHref`, `NAV_GROUPS`, access control, sidebar preferences, account card, Discord link, `RefreshStatus`, command palette, refresh lifecycle, settings, notifications, Help, Admin, footer actions, overlays, and dedicated-map behavior.

- [ ] **Step 1: Tighten dedicated regression tests before extraction**

Update the boundary tests so they assert shared composition and current capabilities:

```js
test("dedicated AppShell supplies every existing chrome capability to shared components", () => {
  const shell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /from "\.\/components\/app-chrome"/);
  assert.match(shell, /<AppFrame/);
  assert.match(shell, /<AppSidebar/);
  assert.match(shell, /<AppUtilityBar/);
  assert.match(shell, /<AppFooter/);
  for (const capability of ["Sign in with Discord", "Join Discord Server", "Search commands", "Admin console", "Browser settings", "Updates", "Help and application information", "Privacy & Analytics", "Terms & Bot Use"]) {
    assert.match(shell, new RegExp(capability.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
```

Keep the existing route, footer, map-mode, refresh, owner-access, and sidebar-preference assertions. Change tests that read the deleted utility file to read `components/app-chrome/AppUtilityBar.tsx`.

- [ ] **Step 2: Run the dedicated boundary files and verify red state**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/appshell-chrome-boundary.test.mjs test/appshell-navigation-boundary.test.mjs test/appshell-import-boundary.test.mjs test/shared-app-chrome.test.mjs
```

Expected: FAIL because `AppShell` still renders inline frame/sidebar/footer markup.

- [ ] **Step 3: Build the dedicated navigation and utility models**

Inside `AppShell`, derive groups without moving dedicated state ownership:

```tsx
const chromeNavigationGroups: AppNavigationGroup[] = NAV_GROUPS.map((group) => {
  const hasActivePage = group.items.some(([id]) => active === id);
  const expanded = (sidebarGroups[group.id] ?? true) || hasActivePage;
  return {
    id: group.id,
    label: group.id === "settlement" ? settlementNavigationLabel(settlementName) : group.label,
    expanded,
    onExpandedChange: (next) => setSidebarGroups((current) => ({ ...current, [group.id]: next })),
    items: group.items.map(([id, label, Icon]) => ({
      id,
      label,
      icon: Icon,
      href: panelHref(id),
      active: active === id,
      restricted: !isPageAllowed(id),
      onActivate: (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(id);
      },
    })),
  };
});
```

Build `AppUtilityAction[]` with the existing icons and callbacks. Preserve `refreshDisabled`, `refreshing`, cooldown text, notification badge, Admin link behavior, and accessible labels exactly. Set the command model to `Search commands` with `Ctrl K`.

- [ ] **Step 4: Replace only the inline visual wrappers**

Render `AppFrame` with:

```tsx
<AppFrame
  shellClassName={`app-shell density-${density} surface-mode-${surfaceMode} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${dedicatedMapView ? "map-dedicated-shell" : ""} ${active === "admin" ? "admin-focused-shell" : ""}`}
  pageLabel={activePageLabel}
  routeKey={active}
  mainRef={mainRef}
  sidebar={dedicatedMapView ? null : ({ mobileOpen, onRequestClose }) => <AppSidebar brand={brandModel} collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} groups={chromeNavigationGroups} account={accountNode} secondaryAction={discordNode} status={refreshStatusNode} mobileOpen={mobileOpen} onRequestClose={onRequestClose} />}
  utilityBar={dedicatedMapView ? null : <AppUtilityBar contextLabel="Workspace" pageLabel={activePageLabel} command={commandModel} actions={utilityActions} />}
  footer={!dedicatedMapView && active !== "admin" ? <AppFooter primary={footerPrimary} secondary={footerSecondary} /> : null}
  refreshLineVisible={dedicatedMapView ? null : visibleRefreshProgress}
  overlays={dedicatedMapView ? null : overlayNodes}
>
  {statusAnnouncements}
  {qualityNotice}
  {pageContent}
</AppFrame>
```

Keep all state hooks at their current top level. Remove only mobile-drawer and collapsed-tooltip state now owned by shared components. Keep account, refresh, footer, dialogs, update banner, toast, and route content construction in `AppShell`.

- [ ] **Step 5: Run dedicated boundary tests, build, and full test suite**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/appshell-chrome-boundary.test.mjs test/appshell-navigation-boundary.test.mjs test/appshell-import-boundary.test.mjs test/shared-app-chrome.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
```

Expected: focused tests PASS, build succeeds, and the full test suite passes before public integration begins.

- [ ] **Step 6: Commit the dedicated migration**

```text
git add apps/bitcraft-local/src/AppShell.tsx apps/bitcraft-local/src/components/main/AppUtilityBar.tsx apps/bitcraft-local/src/components/app-chrome apps/bitcraft-local/test/appshell-chrome-boundary.test.mjs apps/bitcraft-local/test/appshell-navigation-boundary.test.mjs apps/bitcraft-local/test/appshell-import-boundary.test.mjs apps/bitcraft-local/test/shared-app-chrome.test.mjs
git commit -m "refactor(ui): share dedicated application chrome"
```

---

### Task 4: Centralize Public Snapshot State and Split Members from Professions

**Files:**
- Create: `apps/bitcraft-local/src/public/usePublicSnapshot.ts`
- Create: `apps/bitcraft-local/src/public/PublicClaimPages.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicAppShell.tsx`
- Test: `apps/bitcraft-local/test/public-claim-pages-ui.test.mjs`
- Modify: `apps/bitcraft-local/test/public-shell.test.mjs`

**Interfaces:**
- Produces: `PublicSnapshotController` and `usePublicSnapshot(route)`.
- Produces: `PublicClaimPages({ route, controller })`.
- Produces: `publicDomainsForRoute(routeId)` returning only supported public domains.
- Preserves: current cache use, 60-second visible cadence, hidden-tab suspension, last-good snapshot, warnings, and recent-claim update after successful load.

- [ ] **Step 1: Write failing hook/domain and page-projection tests**

Add source-independent domain assertions:

```js
test("public claim pages request the smallest supported domain set", async () => {
  const module = await vite.ssrLoadModule("/src/public/PublicClaimPages.tsx");
  assert.deepEqual(module.publicDomainsForRoute("dashboard"), ["claim"]);
  assert.deepEqual(module.publicDomainsForRoute("members"), ["claim", "members", "citizens"]);
  assert.deepEqual(module.publicDomainsForRoute("professions"), ["claim", "members", "citizens"]);
  assert.deepEqual(module.publicDomainsForRoute("inventory"), ["claim", "inventories"]);
  assert.deepEqual(module.publicDomainsForRoute("crafts"), ["claim", "crafts"]);
});
```

Render Members and Professions with one fixture:

```js
test("members and professions are separate projections of one roster snapshot", async () => {
  const controller = fixtureController({
    claim: { data: { name: "Northwatch", tier: "5" } },
    members: { data: [{ entityId: "1", playerEntityId: "9", userName: "Moss" }] },
    citizens: { data: [{ playerEntityId: "9", skills: { "3": 62 }, skillNames: { "3": "Carpentry" } }] },
  });
  const members = await mount(React.createElement(PublicClaimPages, { route: { id: "members", params: { claimId: "42" } }, controller }));
  assert.match(document.body.textContent, /Current claim roster/);
  assert.match(document.body.textContent, /Moss/);
  assert.doesNotMatch(document.body.textContent, /Carpentry 62/);
  await members.unmount();
  const professions = await mount(React.createElement(PublicClaimPages, { route: { id: "professions", params: { claimId: "42" } }, controller }));
  assert.match(document.body.textContent, /Claim professions/);
  assert.match(document.body.textContent, /Carpentry/);
  assert.match(document.body.textContent, /Moss/);
  assert.match(document.body.textContent, /62/);
  await professions.unmount();
});
```

- [ ] **Step 2: Run the focused test and verify red state**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-claim-pages-ui.test.mjs
```

Expected: FAIL because `PublicClaimPages.tsx` and `usePublicSnapshot.ts` do not exist.

- [ ] **Step 3: Extract the snapshot hook**

Implement this stable controller contract:

```ts
export type PublicSnapshotController = {
  claimId: string | null;
  snapshot: PublicSnapshot | null;
  claim: Record<string, unknown>;
  loading: boolean;
  refreshing: boolean;
  error: string;
  warnings: string[];
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
};
```

`usePublicSnapshot` calls `loadPublicSnapshot` only for `dashboard`, `members`, `professions`, `inventory`, or `crafts` with a canonical `claimId`. Keep `createVisibleRefreshController` in one top-level effect. After a successful response with a non-empty claim name, call `addRecentClaim` and set `lastUpdated` from the response arrival time. If a later refresh fails, retain `snapshot` and set `error`.

- [ ] **Step 4: Extract public claim page projections**

Move Dashboard, Inventory, and Crafts rendering from `PublicAppShell`. Members renders usernames and member status only. Professions joins `citizens.playerEntityId` to `members.playerEntityId`, flattens `skills`, resolves `skillNames`, and sorts by profession name, descending level, then username:

```ts
const professionRows = citizens.flatMap((citizen) => {
  const member = members.find((entry) => String(entry.playerEntityId) === String(citizen.playerEntityId));
  const skills = row(citizen.skills);
  const names = row(citizen.skillNames);
  return Object.entries(skills).map(([skillId, value]) => ({
    skillId,
    profession: String(names[skillId] ?? `Profession ${skillId}`),
    level: Number.isFinite(Number(value)) ? Number(value) : 0,
    member: String(member?.userName ?? "Unknown member"),
  }));
}).sort((left, right) => left.profession.localeCompare(right.profession) || right.level - left.level || left.member.localeCompare(right.member));
```

The shared page heading receives freshness and refresh from the controller; no page creates a second refresh timer.

- [ ] **Step 5: Compose the hook in `PublicAppShell` and run checks**

Call `usePublicSnapshot(route)` unconditionally at the top of `PublicAppShell`, then render `PublicClaimPages` only for its supported route IDs.

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-claim-pages-ui.test.mjs test/public-shell.test.mjs test/public-profile-gate-ui.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: all focused tests PASS and build succeeds.

- [ ] **Step 6: Commit public snapshot ownership and page split**

```text
git add apps/bitcraft-local/src/public/usePublicSnapshot.ts apps/bitcraft-local/src/public/PublicClaimPages.tsx apps/bitcraft-local/src/public/PublicAppShell.tsx apps/bitcraft-local/test/public-claim-pages-ui.test.mjs apps/bitcraft-local/test/public-shell.test.mjs
git commit -m "feat(public): split claim members and professions"
```

---

### Task 5: Adopt the Shared Sidebar, Mobile Frame, Account Area, and On-Demand Status Publicly

**Files:**
- Create: `apps/bitcraft-local/src/public/publicNavigation.ts`
- Create: `apps/bitcraft-local/src/public/PublicChrome.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicAppShell.tsx`
- Modify: `apps/bitcraft-local/src/styles/public-shell.css`
- Modify: `apps/bitcraft-local/src/styles.css`
- Test: `apps/bitcraft-local/test/public-chrome-ui.test.mjs`
- Modify: `apps/bitcraft-local/test/public-shell.test.mjs`

**Interfaces:**
- Consumes: `AppFrame`, `AppSidebar`, `AppUtilityBar`, `AppFooter`, `PublicSnapshotController`, `PublicRoute`, and public feature flags.
- Produces: `buildPublicNavigation(input): AppNavigationGroup[]`.
- Produces: `PublicChrome` with `onOpenClaimFinder`, `children`, and public capability props.

- [ ] **Step 1: Write failing public chrome and navigation tests**

Create exact navigation-model assertions:

```js
test("public navigation mirrors product groups and separates claim-required from coming-soon", async () => {
  const { buildPublicNavigation } = await vite.ssrLoadModule("/src/public/publicNavigation.ts");
  const groups = buildPublicNavigation({ route: { id: "home", params: {} }, claimId: null, claimName: "", collaborationEnabled: false });
  assert.deepEqual(groups.map((group) => group.label), ["Overview", "Claim", "Economy & Region", "Tools"]);
  const items = new Map(groups.flatMap((group) => group.items.map((item) => [item.label, item])));
  assert.equal(items.get("Dashboard").disabledReason, "Select a claim");
  assert.equal(items.get("Members").disabledReason, "Select a claim");
  assert.equal(items.get("Leaderboard").disabledReason, "Coming soon");
  assert.equal(items.get("Map").disabledReason, "Coming soon");
  assert.equal(items.get("Craft Planning").disabledReason, "Coming soon");
  assert.equal(items.has("Admin"), false);
  assert.equal(items.has("Sync"), false);
});
```

Render the public shell with a selected claim controller and assert shared structure:

```js
assert.ok(document.querySelector(".app-shell.public-profile-shell"));
assert.ok(document.querySelector(".app-sidebar"));
assert.equal(document.querySelector(".brand h1")?.textContent, "Northwatch");
assert.equal(document.querySelector(".brand span")?.textContent, "Claim Monitor");
assert.match(document.querySelector(".refresh-status")?.textContent, /On-demand data/);
assert.ok(document.querySelector(".mobile-shell-bar"));
assert.equal(document.querySelectorAll('[aria-disabled="true"]').length > 0, true);
assert.doesNotMatch(document.body.textContent, /Admin|Sync|Updates|Join Discord Server/);
```

- [ ] **Step 2: Run the focused test and verify red state**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-chrome-ui.test.mjs
```

Expected: FAIL because the public chrome adapter and navigation model do not exist.

- [ ] **Step 3: Implement the public navigation model**

Represent availability explicitly:

```ts
type PublicDestination = {
  id: string;
  label: string;
  icon: LucideIcon;
  path?: (claimId: string) => string;
  availability: "available" | "claim-required" | "coming-soon" | "collaboration";
};
```

Build the four approved groups. Map `claim-required` without a claim to `disabledReason: "Select a claim"`. Map `coming-soon` to `disabledReason: "Coming soon"`. Map `collaboration` to `/plans` only when enabled; otherwise `Coming soon`. Use the selected claim name as the Claim group label after it is known.

- [ ] **Step 4: Implement public chrome state and slots**

`PublicChrome` stores only public layout preferences:

```tsx
const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => window.localStorage.getItem(publicStorageKey("layout.sidebar-collapsed")) === "true");
const [sidebarGroups, setSidebarGroups] = React.useState<Record<string, boolean>>(() => readPublicGroupState(window.localStorage));
```

Persist changes to `claim-monitor.public.layout.sidebar-collapsed` and `claim-monitor.public.layout.sidebar-groups`. Storage failures do not block rendering.

Set the shared frame class from public-only state, without defining a separate grid:

```ts
const shellClassName = `app-shell public-profile-shell density-normal surface-mode-public ${sidebarCollapsed ? "sidebar-collapsed" : ""}`;
```

Brand selection is exact:

```ts
const brand = controller.claimId
  ? { logoUrl: "/claim-monitor-logo.png", title: String(controller.claim.name || `Claim #${controller.claimId}`), subtitle: "Claim Monitor" }
  : { logoUrl: "/claim-monitor-logo.png", title: "Claim Monitor", subtitle: "Public claim data" };
```

Render a neutral account card while collaboration is disabled. When enabled, load `loadPublicSession()` once in a focused `PublicAccountCard` child and show avatar/name or `Not signed in` with a `/settings` action. Its copy describes accounts and plans only.

Render status text from the controller:

```ts
const statusLabel = !controller.claimId ? "Select a claim"
  : controller.loading && !controller.snapshot ? "Loading on demand"
  : "On-demand data";
```

Use the shared `refresh-status`, `refresh-dot`, and `refresh-copy` classes. Show the last updated time and warning count without collector details.

Build the public utility actions from capabilities:

```tsx
const utilityActions: AppUtilityAction[] = [
  ...(controller.claimId && currentDataRoute ? [{ id: "refresh", label: controller.refreshing ? "Refreshing claim data" : "Refresh claim data", icon: RefreshCw, busy: controller.refreshing, disabled: controller.refreshing, onActivate: () => void controller.refresh() }] : []),
  ...(features.publicCollaborationEnabled ? [{ id: "settings", label: "Account settings", icon: Settings, href: "/settings" }] : []),
  { id: "help", label: "Help and application information", icon: CircleHelp, href: "/help" },
];
```

The context label is `Claim Monitor`; the page label comes from the public route. Do not include Admin or notification actions.

Render `AppFooter` with package version and generic links:

```tsx
const footerPrimary = <>
  <span className="footer-copy">&copy; {new Date().getFullYear()} Claim Monitor - unofficial fan-made tool.</span>
  <span className="footer-build" title={`Version ${APP_VERSION}`}>v{APP_VERSION}</span>
  <a href="https://relay.bitcraftsync.app/" target="_blank" rel="noreferrer">Data: BitCraft Relay</a>
</>;
const footerSecondary = <>
  <a href={GITHUB_REPOSITORY} target="_blank" rel="noreferrer">GitHub</a>
  <a href={`${GITHUB_REPOSITORY}/issues`} target="_blank" rel="noreferrer">Feature Requests</a>
  <BuyMeCoffeeButton />
  <a href="/privacy">Privacy</a>
  <a href="/terms">Terms</a>
</>;
```

Use `https://github.com/Red463/bitcraft-claim-monitor-relay` for `GITHUB_REPOSITORY` and `packageJson.version` for `APP_VERSION`.

- [ ] **Step 5: Replace the public-only frame and CSS overrides**

Wrap public page content in:

```tsx
<PublicChrome route={route} features={features} controller={snapshotController} onOpenClaimFinder={() => setClaimFinderOpen(true)}>
  <div className="page-view public-page-view">{pageContent}</div>
</PublicChrome>
```

Delete the `Navigation` function and `.public-app-shell`/`.public-sidebar` layout rules. Keep public CSS for page panels, claim finder, tables, plans, account, legal content, and responsive page grids. Use shared `.app-shell`, `.app-sidebar`, `.brand`, `.sidebar-section`, `.mobile-shell-bar`, `.app-utility-bar`, `.page-view`, and `.app-footer` rules.

When `route.id === "coming-soon"`, render a generic public panel whose heading comes from the known roadmap feature map and whose body is `This claim feature is coming soon.` Operational-only and unknown routes continue through `PublicRoot`'s public not-found state.

- [ ] **Step 6: Run public chrome tests, dedicated chrome tests, and build**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-chrome-ui.test.mjs test/public-shell.test.mjs test/appshell-chrome-boundary.test.mjs test/shared-app-chrome.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: all focused tests PASS and build succeeds.

- [ ] **Step 7: Commit public shared-frame adoption**

```text
git add apps/bitcraft-local/src/public/publicNavigation.ts apps/bitcraft-local/src/public/PublicChrome.tsx apps/bitcraft-local/src/public/PublicAppShell.tsx apps/bitcraft-local/src/styles/public-shell.css apps/bitcraft-local/src/styles.css apps/bitcraft-local/test/public-chrome-ui.test.mjs apps/bitcraft-local/test/public-shell.test.mjs
git commit -m "feat(public): adopt shared application frame"
```

---

### Task 6: Reuse One Claim Finder on Home and in the Top Utility Bar

**Files:**
- Create: `apps/bitcraft-local/src/public/PublicClaimFinder.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicAppShell.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicChrome.tsx`
- Modify: `apps/bitcraft-local/src/styles/public-shell.css`
- Modify: `apps/bitcraft-local/src/styles/app-chrome.css`
- Test: `apps/bitcraft-local/test/public-claim-finder-ui.test.mjs`
- Modify: `apps/bitcraft-local/test/public-profile-gate-ui.test.mjs`

**Interfaces:**
- Produces: `PublicClaimFinder({ mode, idPrefix, autoFocus, onSelect })`.
- Consumes: `searchPublicClaims`, `readRecentClaims`, and `publicClaimPath`.
- Public utility command label and accessible name: `Find a claim`; shortcut: `Ctrl K`.

- [ ] **Step 1: Write failing home/dialog parity tests**

Create a test that mocks `/api/public/settlements/search` and mounts both modes:

```js
test("home and utility dialog use the same claim finder contract", async () => {
  const { PublicClaimFinder } = await vite.ssrLoadModule("/src/public/PublicClaimFinder.tsx");
  view = await mount(React.createElement(PublicClaimFinder, { mode: "home", idPrefix: "home-claim-finder" }));
  assert.equal(document.querySelector('label[for="home-claim-finder-input"]')?.textContent, "FIND A BITCRAFT CLAIM");
  assert.equal(document.querySelector("#home-claim-finder-input")?.getAttribute("placeholder"), "Claim name or exact claim ID");
  assert.match(document.body.textContent, /Enter at least 3 characters from the claim name, or paste the exact claim ID\./);
  await view.unmount();

  view = await mount(React.createElement(PublicClaimFinder, { mode: "dialog", idPrefix: "dialog-claim-finder", autoFocus: true }));
  assert.equal(document.querySelector("#dialog-claim-finder-input"), document.activeElement);
  assert.ok(document.querySelector('[role="dialog"][aria-label="Find a claim"]'));
});
```

Add a shell interaction test:

```js
document.querySelector('.app-utility-command').click();
assert.ok(document.querySelector('[role="dialog"][aria-label="Find a claim"]'));
document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
assert.equal(document.querySelector('[role="dialog"][aria-label="Find a claim"]'), null);
document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
assert.ok(document.querySelector('[role="dialog"][aria-label="Find a claim"]'));
```

- [ ] **Step 2: Run the focused finder test and verify red state**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-claim-finder-ui.test.mjs
```

Expected: FAIL because `PublicClaimFinder` does not exist and the public utility command is not wired.

- [ ] **Step 3: Extract one claim finder implementation**

Move query, result, message, and recent-claim rendering from `PublicAppShell` into `PublicClaimFinder`. Use unique IDs derived from `idPrefix`. The form uses exact copy:

```tsx
<label htmlFor={`${idPrefix}-input`}>FIND A BITCRAFT CLAIM</label>
<p id={`${idPrefix}-help`}>Enter at least 3 characters from the claim name, or paste the exact claim ID.</p>
<input id={`${idPrefix}-input`} aria-describedby={`${idPrefix}-help`} placeholder="Claim name or exact claim ID" />
```

Result anchors use `publicClaimPath`, and the fallback heading is `Recent claims`. Do not add recents on click; `usePublicSnapshot` records them only after a successful claim load.

For `mode: "dialog"`, render a viewport-fixed backdrop and dialog, close on Escape/backdrop, and call `onSelect` immediately before normal same-origin navigation.

- [ ] **Step 4: Wire utility activation and keyboard behavior**

Keep `claimFinderOpen` in `PublicAppShell`. Pass `onOpenClaimFinder` into `PublicChrome`. Add one top-level effect:

```tsx
React.useEffect(() => {
  const open = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
    event.preventDefault();
    setClaimFinderOpen(true);
  };
  document.addEventListener("keydown", open);
  return () => document.removeEventListener("keydown", open);
}, []);
```

The utility command model is:

```ts
{ label: "Find a claim", ariaLabel: "Find a claim", shortcut: "Ctrl K", icon: Search, onActivate: onOpenClaimFinder }
```

- [ ] **Step 5: Run finder, public profile, and build checks**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-claim-finder-ui.test.mjs test/public-profile-gate-ui.test.mjs test/public-chrome-ui.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: all focused tests PASS and build succeeds.

- [ ] **Step 6: Commit the shared claim finder**

```text
git add apps/bitcraft-local/src/public/PublicClaimFinder.tsx apps/bitcraft-local/src/public/PublicAppShell.tsx apps/bitcraft-local/src/public/PublicChrome.tsx apps/bitcraft-local/src/styles/public-shell.css apps/bitcraft-local/src/styles/app-chrome.css apps/bitcraft-local/test/public-claim-finder-ui.test.mjs apps/bitcraft-local/test/public-profile-gate-ui.test.mjs
git commit -m "feat(public): add global claim finder"
```

---

### Task 7: Complete Claim-Only Public Copy and Legal Isolation

**Files:**
- Modify: `apps/bitcraft-local/src/public/PublicAppShell.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicClaimFinder.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicClaimPages.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicChrome.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicAccountSettings.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicPlansPage.tsx`
- Modify: `apps/bitcraft-local/src/public/PublicPlanAccessPage.tsx`
- Modify: `apps/bitcraft-local/src/legal/legalPolicy.mjs`
- Modify: `apps/bitcraft-local/src/server/public/publicData.mjs`
- Modify: `apps/bitcraft-local/src/server/public/publicPlans.mjs`
- Create: `apps/bitcraft-local/test/public-copy-boundary.test.mjs`
- Modify: `apps/bitcraft-local/test/claim-monitor-legal-policy.test.mjs`
- Modify: `apps/bitcraft-local/test/public-data.test.mjs`
- Modify: `apps/bitcraft-local/test/public-plans.test.mjs`
- Modify: `apps/bitcraft-local/test/public-account-ui-boundary.test.mjs`
- Modify: `apps/bitcraft-local/test/public-plan-workspace-ui.test.mjs`
- Modify: `apps/bitcraft-local/test/public-plan-access-ui.test.mjs`

**Interfaces:**
- Public legal version and effective date become `2026-08-26`.
- Dedicated legal policy constants and text remain unchanged.
- Server endpoint names and normalized field names remain unchanged.

- [ ] **Step 1: Write failing rendered-copy and policy tests**

Create a strict component-source boundary for files that contain rendered public copy:

```js
test("rendered public component sources use claim-only generic branding", () => {
  const files = [
    "PublicAppShell.tsx", "PublicClaimFinder.tsx", "PublicClaimPages.tsx", "PublicChrome.tsx",
    "PublicAccountSettings.tsx", "PublicPlansPage.tsx", "PublicPlanAccessPage.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(new URL(`../src/public/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /settlement|timbersteel/i, `${file} contains prohibited public product wording`);
  }
});
```

Strengthen `claim-monitor-legal-policy.test.mjs`:

```js
assert.equal(policy.version, "2026-08-26");
assert.equal(policy.effectiveDate, "2026-08-26");
assert.doesNotMatch(JSON.stringify(policy), /settlement|timbersteel/i);
```

Add exact public service-message assertions:

```js
assert.throws(
  () => publicData.normalizePublicSearchQuery("ab"),
  { name: "PublicDataError", status: 400, message: "Claim search requires 3-64 visible Unicode characters." },
);
assert.equal(stale.warnings[0].message, "Claim search results are stale while Relay recovers.");
assert.match(unavailable.warnings[0].message, /current claim and catalog data/);
```

- [ ] **Step 2: Run copy, legal, data, plan, and UI tests and verify red state**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-copy-boundary.test.mjs test/claim-monitor-legal-policy.test.mjs test/public-data.test.mjs test/public-plans.test.mjs test/public-account-ui-boundary.test.mjs test/public-plan-workspace-ui.test.mjs test/public-plan-access-ui.test.mjs
```

Expected: FAIL on existing public `settlement` and `Timbersteel` copy and the old legal version.

- [ ] **Step 3: Replace public component copy**

Use these exact public terms:

- `Public BitCraft claim data`
- `Find your claim`
- `Select the correct claim`
- `Use the claim navigation`
- `Recent claims`
- `Loading current claim state…`
- `Claim #<id>`
- `Claim craft`
- `Claim data is loaded on demand`
- `This tool does not use claim-specific data`
- `Claim claim ID` is prohibited; plan forms use `Claim ID`
- plan summaries use `Claim #<id>`
- deletion computation warnings use `Current claim data could not be loaded.`

Update Help, first-visit welcome, account deletion plan labels, My Plans, plan creation, plan headers, shared plan views, and unavailable collaboration copy.

- [ ] **Step 4: Replace public server response and computation labels**

In `publicData.mjs`, change only user-visible errors and warnings:

```js
relay_search_stale: "Claim search results are stale while Relay recovers.",
relay_snapshot_stale: "Claim snapshot data is stale while Relay recovers.",
```

Use `Claim search requires 3-64 visible Unicode characters.` and `Claim was not found.` for public errors. Keep function names, upstream error codes, and `/api/public/settlements/**` paths unchanged.

In `publicPlans.mjs`, change public output labels to `Claim storage`, `Completed claim craft`, `Current claim craft`, and `current claim and catalog data`. Internal source ID values may remain unchanged because they are not product copy.

- [ ] **Step 5: Update only the public legal policy and version**

Set:

```js
export const CLAIM_MONITOR_LEGAL_VERSION = "2026-08-26";
export const CLAIM_MONITOR_LEGAL_EFFECTIVE_DATE = "2026-08-26";
```

Change public provider, terms, and privacy wording to `claim`. Replace the deletion paragraph with generic isolation wording:

```text
Deletion removes the public Claim Monitor account and associated live public-profile data according to the chosen plan dispositions. It does not delete Discord membership, create or remove an administrator in another service, alter an account in another service, or delete data held independently by providers. Restricted backup copies expire under the backup rotation, and pseudonymous restore receipts prevent deleted public data from silently returning.
```

Do not change `LEGAL_VERSION`, the dedicated operator project name, the dedicated privacy email, or dedicated terms/privacy sections.

- [ ] **Step 6: Run focused tests, build, and full suite**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-copy-boundary.test.mjs test/claim-monitor-legal-policy.test.mjs test/public-data.test.mjs test/public-plans.test.mjs test/public-account-ui-boundary.test.mjs test/public-plan-workspace-ui.test.mjs test/public-plan-access-ui.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
```

Expected: focused tests PASS, build succeeds, and full suite passes.

- [ ] **Step 7: Commit claim-only public wording**

```text
git add apps/bitcraft-local/src/public apps/bitcraft-local/src/legal/legalPolicy.mjs apps/bitcraft-local/src/server/public/publicData.mjs apps/bitcraft-local/src/server/public/publicPlans.mjs apps/bitcraft-local/test/public-copy-boundary.test.mjs apps/bitcraft-local/test/claim-monitor-legal-policy.test.mjs apps/bitcraft-local/test/public-data.test.mjs apps/bitcraft-local/test/public-plans.test.mjs apps/bitcraft-local/test/public-account-ui-boundary.test.mjs apps/bitcraft-local/test/public-plan-workspace-ui.test.mjs apps/bitcraft-local/test/public-plan-access-ui.test.mjs
git commit -m "fix(public): use claim-only product language"
```

---

### Task 8: Lock Responsive Parity and Run Release-Scale Verification

**Files:**
- Create: `apps/bitcraft-local/test/public-chrome-css-boundary.test.mjs`
- Modify: `apps/bitcraft-local/test/public-shell.test.mjs`
- Modify: `apps/bitcraft-local/test/appshell-chrome-boundary.test.mjs`
- Modify: `apps/bitcraft-local/test/responsive-layout-boundary.test.mjs`
- Modify if required by the exact assertions below: `apps/bitcraft-local/src/styles.css`
- Modify if required by the exact assertions below: `apps/bitcraft-local/src/styles/app-chrome.css`
- Modify if required by the exact assertions below: `apps/bitcraft-local/src/styles/public-shell.css`

**Interfaces:**
- Consumes the completed shared chrome and both profile adapters.
- Produces regression gates that prevent the public profile from recreating a separate shell.

- [ ] **Step 1: Write failing CSS ownership and parity tests**

Create `public-chrome-css-boundary.test.mjs`:

```js
test("public pages use shared shell selectors instead of a separate layout", () => {
  const publicCss = readFileSync(new URL("../src/styles/public-shell.css", import.meta.url), "utf8");
  const rootCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const chromeCss = readFileSync(new URL("../src/styles/app-chrome.css", import.meta.url), "utf8");
  assert.doesNotMatch(publicCss, /\.public-app-shell|\.public-sidebar/);
  assert.match(rootCss, /\.app-shell\s*\{[^}]*grid-template-columns:\s*238px minmax\(0, 1fr\)/s);
  assert.match(rootCss, /\.app-shell\.sidebar-collapsed\s*\{[^}]*grid-template-columns:\s*72px minmax\(0, 1fr\)/s);
  assert.match(rootCss, /@media \(max-width:\s*760px\)[\s\S]*\.app-shell[\s\S]*\.app-sidebar\.mobile-open/s);
  assert.match(chromeCss, /\.app-utility-bar/);
  assert.match(rootCss, /\.app-footer/);
});

test("public page content keeps dashboard gutters without overriding shared main scrolling", () => {
  const publicCss = readFileSync(new URL("../src/styles/public-shell.css", import.meta.url), "utf8");
  assert.match(publicCss, /\.public-page-view\s*\{[^}]*padding:\s*var\(--shell-page-gutter\)/s);
  assert.doesNotMatch(publicCss, /\.public-profile-shell\s+main\s*\{[^}]*overflow/s);
});
```

- [ ] **Step 2: Run CSS and responsive tests and verify red state**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/public-chrome-css-boundary.test.mjs test/responsive-layout-boundary.test.mjs test/appshell-chrome-boundary.test.mjs test/public-shell.test.mjs
```

Expected: FAIL if any old public shell selector or mismatched breakpoint remains.

- [ ] **Step 3: Apply the exact CSS ownership result**

Remove `.public-app-shell` and `.public-sidebar` selectors. Set page spacing only on the public content wrapper:

```css
.public-page-view {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: var(--shell-page-gutter);
}
```

Keep the shared desktop grid at 238px, collapsed grid at 72px, mobile shell bar at 52px, and mobile drawer breakpoint at 760px. Add disabled navigation styling to shared chrome:

```css
.nav-destination.is-disabled { color: #7f8997; cursor: not-allowed; opacity: .78; }
.nav-destination.is-disabled:hover { border-color: transparent; background: transparent; }
.nav-status { margin-left: auto; color: #9b8750; font-size: 9px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.sidebar-collapsed .nav-status { display: none; }
```

At the mobile breakpoint, keep disabled labels visible and allow the public page grids to collapse without changing drawer behavior.

- [ ] **Step 4: Run all automated verification**

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
```

Expected: build succeeds and the full test suite passes with zero failures.

- [ ] **Step 5: Run local browser verification for both profiles**

Start the built smoke server:

```text
node scripts/start-bitcraft-local-smoke.mjs --restart
curl.exe -s http://127.0.0.1:18449/api/local/health
```

Verify the dedicated profile at `http://127.0.0.1:18449/`:

- sidebar expanded and collapsed;
- mobile drawer at 760px and below;
- account card and Discord link;
- grouped navigation and current route;
- command search, Admin when authorized, refresh, settings, updates, and Help;
- on-sidebar refresh status;
- footer links and legal dialogs;
- Dashboard, Craft Planning, Inventory, Map, Admin, and `/bot` smoke routes.

Verify the public profile at `http://public.localhost:18449/`:

- first-visit welcome and returning Recent claims state;
- generic pre-selection brand and selected-claim brand;
- grouped available, claim-required, and Coming soon navigation states;
- no Admin, Sync, Discord management, notifications, or dedicated product references;
- utility claim finder by click and Ctrl K;
- Dashboard, Members, Professions, Inventory, Craft Monitor, Calculator, plans feature gate, Help, Terms, and Privacy;
- manual refresh, freshness age, stale/partial warning, and hidden-tab pause;
- footer layout and links;
- `/settlements/42` canonicalization to `/claims/42` without query/fragment loss;
- desktop, collapsed-sidebar, mobile-drawer, and footer wrapping behavior.

- [ ] **Step 6: Commit the final regression gates**

```text
git add apps/bitcraft-local/test/public-chrome-css-boundary.test.mjs apps/bitcraft-local/test/public-shell.test.mjs apps/bitcraft-local/test/appshell-chrome-boundary.test.mjs apps/bitcraft-local/test/responsive-layout-boundary.test.mjs apps/bitcraft-local/src/styles.css apps/bitcraft-local/src/styles/app-chrome.css apps/bitcraft-local/src/styles/public-shell.css
git commit -m "test(public): lock shared chrome parity"
```

---

## Final Acceptance Gate

Before requesting merge or deployment, record all of the following:

- `corepack pnpm --filter @workspace/bitcraft-local run build` succeeded.
- `corepack pnpm --filter @workspace/bitcraft-local test` succeeded.
- Dedicated desktop/mobile smoke checks found no functional or visual regression.
- Public desktop/mobile smoke checks show the same chrome structure.
- Public rendered content, metadata, accessibility labels, legal policy, errors, and computation labels contain neither `settlement` nor `Timbersteel`.
- Existing public links canonicalize to `/claims/` and existing recent-claim browser data remains available.
- Public feature flags still fail closed.
- Public snapshot activity remains visitor-driven and the dedicated worker remains unchanged.
- `git status --short` contains no unrelated or generated files.

Do not change `CHANGELOG.md` or `apps/bitcraft-local/package.json` until the user explicitly requests push, deploy, publish, or release preparation.
