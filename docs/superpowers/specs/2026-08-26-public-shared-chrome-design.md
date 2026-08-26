# Public Shared Claim Monitor Chrome Design

Date: 2026-08-26

## Summary

The public Claim Monitor must feel like the same product as the dedicated application while remaining a separately authorized product profile. Both frontend roots will use the same profile-neutral application chrome: frame, grouped sidebar, mobile navigation, top utility bar, account area, status area, and footer. Each root will continue to own its routes, data, identity, permissions, refresh behavior, and feature availability.

The public profile will use generic Claim Monitor branding and claim-only language. No rendered public copy, document metadata, accessibility label, navigation entry, footer content, or link will identify or refer to Timbersteel.

## Goals

- Make the public profile visually and behaviorally consistent with the dedicated application.
- Preserve all dedicated-application functionality and browser preferences.
- Keep public and dedicated data, sessions, authorization, routing, and feature code isolated.
- Present future public features in their intended navigation positions as disabled, accessible "Coming soon" destinations.
- Use "claim" instead of "settlement" everywhere visible in the public profile.
- Preserve visitor-driven public data loading and the existing public cost controls.

## Non-goals

- Enabling future public data pages as part of this work.
- Adding Admin, Sync, Discord management, notifications, or dedicated operational controls to the public profile.
- Sharing API clients, authentication state, game-data loaders, workers, or route ownership between profiles.
- Changing public Relay caching, rate limiting, visible refresh cadence, database schema, OAuth behavior, or feature flags.
- Redesigning dedicated application pages or the first-visit welcome content.

## Architecture

### Shared profile-neutral chrome

Create focused visual components under `apps/bitcraft-local/src/components/app-chrome/` for:

- the desktop frame and mobile shell bar;
- the collapsible sidebar and grouped navigation;
- the brand block;
- the account card slot;
- the status slot;
- the top utility bar; and
- the flat two-part footer.

The components accept display models, links, capability flags, optional slots, and callbacks through props. They may depend on React, Lucide icons, common display types, and shared CSS. They must not import either profile's API client, authentication repository, route controller, game-data loader, notifications, Admin, bot, Discord, worker, or feature-specific module.

The components do not determine whether a capability is authorized. A root omits a control or supplies a disabled display model based on server-provided profile capabilities and its own state.

### Dedicated application integration

`AppShell.tsx` remains the owner of all existing dedicated behavior, including:

- current route and navigation state;
- configured claim and branding;
- sidebar preferences and group state;
- account and Admin state;
- command search;
- refresh coordination and worker status;
- notifications, settings, help, legal dialogs, and release state; and
- footer build information and actions.

It will supply its current values and callbacks to the shared chrome. The initial extraction must preserve the existing rendered structure, CSS class contract, cookie behavior, local-storage keys, interactions, and route behavior. This work must not rename or migrate existing dedicated preferences.

### Public application integration

`PublicAppShell.tsx` remains the owner of public routing, public identity, claim search, on-demand snapshots, public plans, and public legal pages. It will supply a public-specific chrome model containing:

- generic Claim Monitor branding;
- the selected claim name when known;
- public navigation groups and availability;
- public account presentation and actions;
- claim-search behavior;
- page-specific manual refresh behavior;
- on-demand freshness presentation; and
- generic footer copy and public legal routes.

The public root may import the profile-neutral chrome components. It must remain prohibited from importing `AppShell`, `TimbersteelRoot`, dedicated bootstrap logic, `/api/local/` clients, generation watchers, Admin, bot, notification, history, or Discord-service modules.

## Public Visual Chrome

### Sidebar and brand

The public sidebar uses the same width, spacing, collapse control, group headers, navigation row styling, active indicator, icon sizing, tooltips, focus behavior, and mobile drawer pattern as the dedicated application.

Brand presentation is:

- before claim selection: `Claim Monitor` with subtitle `Public claim data`;
- after claim selection: the selected claim name with subtitle `Claim Monitor`.

The standard bundled Claim Monitor logo is used. Claim names are display snapshots; claim ID remains routing authority.

Public sidebar collapsed state and group state are stored only under `claim-monitor.public.*`. Existing dedicated storage keys remain unchanged.

### Navigation model

The public navigation mirrors the dedicated group structure where the feature belongs in the public roadmap:

| Group | Destination | State in this change |
|---|---|---|
| Overview | Dashboard | Available after selecting a claim; home/claim finder before selection |
| Overview | Leaderboard | Coming soon |
| Claim | Members | Available |
| Claim | Professions | Available |
| Claim | Craft Monitor | Available |
| Claim | Craft Planning | Available only when public collaboration is enabled; otherwise Coming soon |
| Claim | Inventory | Available |
| Claim | Construction | Coming soon |
| Claim | Research | Coming soon |
| Claim | Local Market | Coming soon |
| Economy & Region | Market | Coming soon |
| Economy & Region | Region | Coming soon |
| Economy & Region | Empires | Coming soon |
| Economy & Region | Map | Coming soon |
| Economy & Region | Activity | Coming soon |
| Tools | Public Craft Finder | Coming soon |
| Tools | Craft Calculator | Available |

Admin, Sync, Discord-management controls, and notifications are absent. They are not displayed as future public features.

Coming-soon destinations are non-clickable navigation rows with `aria-disabled="true"`, visible text or a compact status indicator, and a collapsed-sidebar tooltip that includes "Coming soon." Keyboard focus behavior must not suggest that the destination can be activated. Direct navigation to a recognized roadmap URL renders a generic public coming-soon page. Unknown and operational-only paths render the existing public not-found state.

### Account area

The public account card occupies the same sidebar position and visual footprint as the dedicated account card.

- When public identity is enabled, it shows public account state, public sign-in, and plan/settings access.
- Before public identity is enabled, it displays a neutral account-features-coming-soon state.
- It does not claim to grant Discord services, dedicated access, or continuous monitoring.

### Status area

The public status area uses the same visual hierarchy as the dedicated refresh status but has a public-specific model:

- no selected claim: `Select a claim`;
- selected claim before data arrives: `Loading on demand`;
- fresh data: `On-demand data` and the last refresh time;
- stale or partial data: the age and warning affordance;
- refresh in progress: the existing refresh animation treatment.

It must never describe public claims as continuously monitored or display dedicated worker/collector status.

### Mobile navigation

At the existing narrow breakpoint, the public profile uses the same fixed mobile top bar, menu trigger, backdrop, slide-in drawer, close control, focus behavior, and navigation-group presentation as the dedicated application. The mobile bar displays `Claim Monitor` and the current public page label.

## Top Utility Bar

The public profile uses the same utility-bar container, alignment, sizing, responsive behavior, and action styling.

Public controls are:

- current page context;
- a central `Find a claim` command;
- manual refresh on current-data pages;
- public settings when public identity/settings are enabled; and
- Help.

Admin and notification controls are omitted.

`Find a claim` opens a compact command-style overlay from any public page. The overlay reuses the home claim-search component and search state model. It enforces the existing three-character-or-exact-ID input rule, uses the existing public search API, and shows errors and results inside the overlay. Selecting a result navigates to the canonical claim Dashboard, records the claim in `Recent claims`, updates the sidebar brand, and closes the overlay.

Manual refresh is active only on a selected claim's current-data page. It uses the existing public snapshot cache and rate limits and does not bypass a snapshot younger than the server cache floor. It remains disabled or omitted where no claim snapshot can be refreshed.

## Footer

The public footer uses the same flat, two-part layout and responsive wrapping as the dedicated footer. It includes:

- generic `Claim Monitor - unofficial fan-made tool` copyright copy;
- application version and build provenance;
- BitCraft Relay data attribution;
- the generic project repository and feature-request links;
- the existing support link;
- public Privacy; and
- public Terms.

Public Privacy and Terms open public-profile routes and content. Footer labels, destinations, metadata, and accessible names must not identify or link to Timbersteel.

## Public Routes and Terminology

Canonical claim routes become:

```text
/claims/<claimId>
/claims/<claimId>/members
/claims/<claimId>/professions
/claims/<claimId>/inventory
/claims/<claimId>/crafts
```

Existing `/settlements/...` public bookmarks redirect to the corresponding `/claims/...` route so links remain functional while the browser address becomes claim-based. Internal server module, API, and normalized-domain identifiers may retain existing names when they are not rendered or exposed as product wording.

Members and Professions become separate page projections backed by the same roster snapshot:

- Members shows the current claim roster.
- Professions shows profession and skill information.

The cached roster is reused, so navigating between these pages does not require another upstream read while the cache is fresh.

All public-visible uses of `settlement` change to `claim`, including headings, helper text, placeholders, recent-item labels, loading states, errors, empty states, Help, account/plan context, share views, legal content, metadata, and accessibility text. In particular, the home search becomes `FIND A BITCRAFT CLAIM`, with placeholder `Claim name or exact claim ID` and helper `Enter at least 3 characters from the claim name, or paste the exact claim ID.`

## Data and Error Flow

The page route continues to determine the public snapshot domains requested. The shared chrome receives only display-safe page context, freshness, and action callbacks; it never fetches data itself.

Existing public behavior remains:

- snapshots refresh every 60 seconds only while the page is visible;
- hidden tabs stop polling and perform one catch-up refresh when visible;
- search and snapshot caches, concurrency gates, and rate limits remain authoritative;
- stale data reports its age;
- partial-domain failures preserve available data and show explicit warnings;
- a refresh failure retains the last received snapshot; and
- no public request creates durable game-data history, notifications, Discord work, or worker activity.

The home finder and top-bar finder share one search implementation to prevent behavioral drift. Claim selection always uses the server-provided claim ID and updates the public recent-claim preference only after a claim opens successfully.

## Security and Isolation

- The server-owned host profile remains the authorization boundary.
- Shared visual components contain no authentication or routing authority.
- Public routes remain limited to `/api/public/**`; shared chrome does not alter server routing.
- Public identity, sessions, legal acceptance, and plans remain isolated from dedicated tables and cookies.
- Public disabled navigation does not make a server route available.
- Public UI must not expose dedicated configuration, claim settings, active plans, Relay URLs, Discord configuration, Admin identity, or worker health.
- Dedicated CSS and component extraction must not cause the public bundle to import dedicated feature modules.

## Testing

Implementation follows test-driven development. Focused tests cover:

### Shared chrome contracts

- both roots render the same frame, sidebar, mobile bar, utility bar, and footer components;
- profile-specific slots and capabilities render only when supplied;
- collapsed and mobile navigation behavior remains accessible;
- disabled navigation announces "Coming soon" and cannot activate;
- footer structure and build provenance remain intact.

### Dedicated regression

- existing navigation groups, route callbacks, account card, Discord link, command search, Admin control, refresh control, settings, notifications, Help, refresh status, and footer actions remain unchanged;
- existing dedicated storage keys and branding remain unchanged;
- existing browser, worker, history, notifications, Discord, Admin, bot, and outbox tests continue to pass.

### Public behavior

- generic brand is shown before claim selection and selected claim name afterward;
- public navigation groups, available pages, and coming-soon states match this specification;
- Admin, Sync, Discord-management controls, and notifications are absent;
- top-bar claim search opens from any public page and selects authoritative claim IDs;
- Members and Professions render separate projections from the roster snapshot;
- public account, status, utility bar, footer, and mobile drawer use shared chrome;
- `/claims/...` routes resolve and old `/settlements/...` routes redirect;
- public page refresh retains existing visibility and cache behavior;
- rendered public content and metadata contain neither `settlement` nor `Timbersteel`;
- public source continues to satisfy the existing forbidden-import boundary.

### Verification

Run:

```text
corepack pnpm --filter @workspace/bitcraft-local run build
corepack pnpm --filter @workspace/bitcraft-local test
```

Browser-check both profiles at desktop and mobile widths. Compare sidebar expanded/collapsed states, mobile navigation, top bar, account area, status, content gutter, footer, first-visit home, returning home, selected claim pages, stale/partial data, and disabled roadmap pages.

## Acceptance Criteria

- The dedicated application has no removed, degraded, or visually regressed chrome behavior.
- The public profile uses the same structural chrome and styling, with only profile-inappropriate controls omitted.
- Public branding changes to the selected claim name after a claim opens.
- No public-visible surface uses `settlement` or refers or links to Timbersteel.
- Future public-facing pages appear in the correct groups as disabled "Coming soon" destinations.
- Admin, Sync, Discord management, and notifications remain absent publicly.
- Claim search is available from the public top bar and home.
- Canonical public routes use `/claims/`, with safe redirects from old public links.
- Public refresh remains on demand and stops when no public page is open.
- Public and dedicated authorization, sessions, data, and feature imports remain isolated.
