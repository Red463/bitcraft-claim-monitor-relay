# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses pre-1.0 SemVer beta versioning. See [VERSIONING.md](VERSIONING.md) for the release policy.

Historical release headings have been migrated to `0.MINOR.PATCH-beta.N`. Existing dates and changelog content have been preserved.


## [Unreleased]

## [0.55.0-beta.8] - 2026-08-13

### Fixed

- Fixed native map generation verification so only hashed installed packs that the live web service can read and serve are accepted, with the production data directory pinned at process launch.

## [0.55.0-beta.7] - 2026-08-13

### Changed

- Improved native map resource loading so dense selections page progressively across every Relay-ready region without a global 50,000-node limit.
- Moved slow-changing terrain, water, and roads to verified pre-generated tile packs with atomic last-good installation and off-peak schedules.
- Changed application deployments to preserve the installed map packs; full-world terrain and road generators now activate replacements independently after complete validation.
- Added a protected full-world map generation workflow that runs terrain and roads sequentially under systemd memory limits, verifies both packs, and then enables their off-peak schedules.
- Added aggregate map performance and reliability diagnostics for tiles, resource partitions, queue pressure, and generation latency without exposing tracked selections or coordinates.

### Fixed

- Fixed full-world terrain and road coverage so zoomed-out maps remain detailed without generating tiles during normal web requests.
- Fixed resource generation processing to normalize each regional update once and retain usable partitions while other regions continue loading.
- Prevented invalid tile-pack pointers, failed generations, and overloaded resource subscriptions from replacing last-good map data.
- Prevented incomplete bundled maps, schema-mismatched resource regions, malformed tile manifests, and incomplete road joins from being advertised or activated.

## [0.55.0-beta.6] - 2026-08-13

### Fixed

- Made native map artifact installation part of the root-owned transactional application updater instead of an unreliable second remote deployment phase.

## [0.55.0-beta.5] - 2026-08-13

### Fixed

- Fixed live installation of the verified native map terrain, water, biome, and road bundle by transferring it directly and installing it with the required production ownership.

## [0.55.0-beta.4] - 2026-08-13

### Fixed

- Shipped the accepted pre-generated native map terrain, water, biome masks, and Region 19 roads as a verified static release artifact, avoiding memory-heavy generation on the live server.

## [0.55.0-beta.3] - 2026-08-13

### Fixed

- Installed the pre-generated world terrain, water, and Region 19 road overlays during production deployment so the native map does not fall back to an empty coordinate grid.

## [0.55.0-beta.2] - 2026-08-13

### Fixed

- Made the native map the only Map-page renderer and removed the legacy iframe, renderer setting, and selection-bearing external map URLs.

## [0.55.0-beta.1] - 2026-08-13

### Added

- Added a first-party native BitCraft map with self-hosted terrain, water, roads, biome highlighting, claim and NPC-town markers, watchtowers, waypoints, and live player tracking.
- Added multi-region resource tracking with tier-based marker colours, stable variations, viewport-efficient rendering, and Relay-backed live updates.
- Added integrated Layers, Biomes, Players, Resources, and Region controls that preserve selections and work across desktop and mobile layouts.

### Changed

- Replaced selection-bearing third-party map requests with provider-neutral, same-origin map snapshots and event streams.
- Expanded the Region selector so claim markers and selected resources load from every Relay-ready region, including an all-regions view.
- Pre-generates slow-changing world terrain and water while keeping roads, players, and resources on bounded live update paths.

### Fixed

- Fixed stale, partial, oversized, and cold resource selections so usable last-good results remain visible while updated regions load.
- Fixed regional claim filtering, native marker layering, low-zoom terrain coverage, biome decoding, and mobile map-tool layout.

## [0.54.1-beta.1] - 2026-08-11

### Fixed

- Prevented regular page refreshes from replacing unsaved changes in the open Craft Plan manager.

## [0.54.0-beta.1] - 2026-08-11

### Added

- Added individual Craft Planning bank tracking for each settlement player, including progressive discovery, search, filtering, and tracked-empty bank visibility.

### Changed

- Enlarged and rebalanced the Craft Planning manager for clearer desktop, laptop, and mobile use.

## [0.53.2-beta.3] - 2026-08-11

### Fixed

- Restored Craft Planning completion percentages and Discord progress reports after the Relay catalog migration.

## [0.53.2-beta.2] - 2026-08-10

### Changed

- Simplified Craft Monitor contributor rows to show only who contributed, progress, and XP.

## [0.53.2-beta.1] - 2026-08-10

### Fixed

- Fixed Craft Monitor contribution attribution when Relay consumes a successful craft action in the same transaction as progress.

## [0.53.1-beta.1] - 2026-08-10

### Fixed

- Restored Craft Monitor contribution recording for current Relay craft reducer events.

## [0.53.0-beta.1] - 2026-08-10

### Added

- Added the Featurebase in-app messenger with a dark, right-aligned English launcher.
- Added signed Featurebase identity for Discord users while preserving anonymous visitor support.
- Added a guarded dry-run and manifest workflow for repairing broken production branding assets without accepting unsafe paths or stale database state.

### Changed

- Made Recent Siege Outcomes collapsed by default and retained each user's preferred expanded state.
- **Operator action required:** after deploying this release, run the guarded contribution-attribution and branding-asset repair procedure in `DEPLOYMENT.md`; keep all writers and real Discord delivery stopped, retain the exact dry-run manifests beside a decrypt-verified encrypted backup, verify SQLite integrity and service-owned branding metadata, then restart in the persistent no-send maintenance mode and confirm Relay generation advancement. Leave both maintenance drop-ins installed until a separately approved live Discord restart.

### Security

- Cleared Featurebase identity and messenger state when users sign out or delete their account.

### Fixed

- Fixed a blank page caused by a circular production bundle dependency after the Featurebase integration.
- Allowed the Featurebase Messenger resources required by the production Content Security Policy.
- Fixed craft contributions being credited to the craft owner when Relay did not provide exact contributor evidence.
- Corrected regional settlement rankings by excluding neutral starter towns and deriving tiers from learned claim technology.
- Restored Dashboard online-member locations from confirmed presence regions.
- Restored Resource Finder item images and bundled logo and favicon fallbacks when configured assets are unavailable.
- Ensured root-run branding repair preserves safe service-account ownership and modes across staging, recovery, and final publication.

## [0.52.0-beta.1] - 2026-08-09

### Added

- Added canonical cutover preparation with a typed hostname confirmation, a maintenance gate, encrypted recovery artifacts, a 15-minute abort watchdog, and post-admission monitoring.

### Changed

- Prepared guarded account and configuration migration so supported accounts, character links, access settings, preferences, market watches, planning configuration, branding, legal acceptance, and Discord tools carry across while everyone must sign in again.
- Made the Relay-backed app the canonical application and redirected the Relay host while preserving path and query details.
- Limited live Discord ownership to one Relay worker gateway and delayed the custom migration notice until the canonical app passes its 30-minute intensive soak.
- Retained the stopped and masked legacy installation for a 14-day forensic window; deletion requires separate approval and a final encrypted archive.

### Security

- Added fail-closed deployment validation for preview and canonical runtime settings, including the approved OAuth callback, legal confirmation, privacy-ledger merge/replay, and previous-key rotation protection.
- Added a selective migration boundary that preserves Relay game/history data, migrates only approved identity and operational configuration, and revokes every existing session for forced re-login.
- Reduced public health output to safe deployment readiness and release metadata.

## [0.51.0-beta.9] - 2026-08-09

### Added

- Added a guarded dry-run and manifest workflow for repairing contribution professions only when exact stored craft evidence is available.
- Added compact, accessible refresh warning details beside the Last Refresh indicator.

### Changed

- Made global Market open on an alphabetical item search with live best buy and sell summaries.
- Made Profession Capability collapsible and alphabetized profession and skill columns.
- Displayed Current Gear and every saved member equipment preset without truncation.

### Fixed

- Fixed contribution professions being classified as unknown when Relay supplies camel-case skill IDs.
- Resolved Public Craft Finder names across regions and kept unchanged connected subscriptions fresh without snapshot rewrites.
- Kept Public Craft Finder disconnects stale until a replacement authoritative snapshot is applied.

## [0.51.0-beta.8] - 2026-08-09

### Fixed

- Restored reliable regional-claims refreshes by replacing excessive owner subscription fan-out with one bounded authoritative subscription.
- Kept saved-data warnings active until a replacement regional snapshot commits successfully after a disconnect.

## [0.51.0-beta.7] - 2026-08-08

### Changed

- Made Craft Monitor the only near-live page while ordinary pages refresh on their configured interval without flickering progress indicators.
- Sorted online members first by longest current session, followed by recently seen offline members and unavailable presence.
- Simplified Craft Monitor contributor and visibility copy for settlement users.

### Fixed

- Resolved the monitored settlement's player-facing region name on Dashboard instead of showing `Unknown`.
- Coordinated each page's main and auxiliary data under one refresh cycle with hidden-tab catch-up and last-good-data preservation.

## [0.51.0-beta.6] - 2026-08-08

### Fixed

- Fixed nonzero numbered Relay recipe placeholders such as `Tan {1}` appearing in Craft Monitor.

## [0.51.0-beta.5] - 2026-08-08

### Added

- Added a bounded same-origin icon fallback for verified BitJita item and cargo images when a Relay catalog asset is unavailable locally.

### Changed

- Consolidated Research into Completed Technology and Available Research while keeping locked technologies visible with prerequisite status.

### Fixed

- Fixed missing local game icons returning the frontend HTML shell instead of a 404 response.

## [0.51.0-beta.4] - 2026-08-08

### Changed

- Unified Dashboard and Craft Monitor output names, recipe labels, and icons while preserving separate item and cargo identities.
- Grouped passive crafts only when member, output, structure, and status all match.
- Limited contribution rankings to exact player attribution and exposed retained historical unknown events only as an admin diagnostic count.

### Fixed

- Replaced unresolved craft recipe placeholders with the catalog output name.
- Added exact craft-owner fallback when reducer or player-action attribution is unavailable or ambiguous.
- Safely migrated contribution confidence values and rebuilt aggregates only from stored exact evidence.

## [0.51.0-beta.3] - 2026-08-08

### Changed

- Added accurate cross-region presence details for monitored members while keeping unavailable presence explicit.
- Kept missing regional owner usernames as local Region coverage diagnostics instead of global refresh warnings.
- Clarified whether saved data is actively refreshing or live refresh is unavailable.

### Fixed

- Fixed member status timestamps preferring last login over newer Relay last-active data.
- Prevented members outside the primary region from being reported as offline or as a global data-loss warning.

## [0.51.0-beta.2] - 2026-08-08

### Added

- Added a guarded dry-run and hash-verified repair tool for removing market history proven to belong to another claim.

### Changed

- Made Relay worker reconciliation non-overlapping, time-bounded, and automatically recoverable after subscription disconnects.
- Made the claim-market subscription the sole writer of settlement market history while regional market data continues powering tools and Deal Watch.

### Fixed

- Rejected mixed or foreign-claim market snapshots before they can write history, activity, trades, or notifications.
- Preserved item and cargo identity in market history and aligned Dashboard income, Revenue by Day, and Best Sellers to the same selected-period trade semantics.

## [0.51.0-beta.1] - 2026-08-02

### Added

- Added a Craft Monitor control for showing private settlement crafts, with private crafts hidden by default.
- Added locally observed craft contribution attribution with authoritative, inferred, and unknown contributor states.

### Changed

- Displayed craft XP as whole in-game values while retaining exact Relay calculation rates internally.
- Identified contribution history by its local observation start so the UI does not imply older coverage.

### Fixed

- Fixed valid fractional Relay XP rates triggering incomplete-data warnings.
- Fixed Craft Monitor contribution progress and contributor names not appearing from live Relay activity.

## [0.50.0-beta.5] - 2026-08-02

### Fixed

- Fixed Dashboard storage capacity, production, and player-settlement regional wealth using authoritative Relay data.
- Preserved exact large regional wealth totals and uninterrupted live craft contributions during subscription scope changes.
- Kept Dashboard refresh warnings focused on data required by its visible metrics.

## [0.50.0-beta.4] - 2026-08-02

### Changed

- Updated the default app logo and browser favicon to the approved Claim Monitor branding.

## [0.50.0-beta.3] - 2026-08-02

### Changed

- Distinguished live but incomplete Relay details from stale-data refresh failures.
- Condensed repeated missing-name diagnostics so live regional responses remain compact.

### Fixed

- Kept global catalog, skill, and region data marked live while their shared subscription remains healthy.

## [0.50.0-beta.2] - 2026-08-02

### Fixed

- Kept unchanged subscription-backed data marked live while the Relay worker heartbeat remains healthy.

## [0.50.0-beta.1] - 2026-08-01

### Added

- Added live Relay-backed settlement, catalog, inventory, crafting, market, region, empire, map, and public-tool data.
- Added freshness, provenance, schema-health, and last-good outage reporting throughout the dashboard.
- Added an isolated Relay preview deployment for `relay.timbersteeltrade.com`.

### Changed

- Replaced scheduled browser data snapshots with provider generations that update open pages as Relay data changes.
- Rebuilt local history and notifications from normalized Relay observations while keeping current game state live.
- Changed preview Discord delivery to enforced record-only mode.

### Removed

- Removed runtime BitJita API routes, clients, proxying, configuration, and remote icon requests.
- Removed obsolete snapshot and collector configuration tables and legacy deployment artifacts.

## [0.49.1-beta.2] - 2026-07-29

### Fixed

- Centred the Linked Accounts “More actions” icons consistently across supported browsers and screen sizes.

## [0.49.1-beta.1] - 2026-07-29

### Fixed

- Limited Craft Planner active station output to crafts running within the monitored claim while continuing to count passive crafts.

## [0.49.0-beta.3] - 2026-07-29

### Fixed

- Fixed the User Settings character selector appearing empty when opened from pages that do not load settlement members.

## [0.49.0-beta.2] - 2026-07-28

### Fixed

- Fixed Linked Accounts row actions stretching across the screen and removed unintended extra disclosure icons from account menus.

## [0.49.0-beta.1] - 2026-07-28

### Changed

- Simplified Linked Accounts administration so each account shows only the actions relevant to its current linking state.
- Prioritised pending character-link requests and moved account deletion into an accessible overflow menu.
- Improved Linked Accounts controls for narrow screens and prevented invalid character overrides.

## [0.48.1-beta.5] - 2026-07-28

### Fixed

- Fixed Discord sign-in failing while saving legal acceptance.

## [0.48.1-beta.4] - 2026-07-28

### Fixed

- Prevented Discord sign-in callbacks from waiting indefinitely and added privacy-safe callback diagnostics.

## [0.48.1-beta.3] - 2026-07-28

### Fixed

- Fixed Discord sign-in becoming stuck when the application supports multiple installation contexts.

## [0.48.1-beta.2] - 2026-07-28

### Fixed

- Fixed regular Discord sign-in from restricted pages failing after legal acceptance.

## [0.48.1-beta.1] - 2026-07-28

### Fixed

- Fixed regular Discord sign-in failing after legal acceptance when opened from User Settings.

## [0.48.0-beta.2] - 2026-07-27

### Changed

- Navigation now labels the settlement section with the configured claim name and updates automatically when the monitored settlement changes.
- Renamed Settlement Market to Local Market, with the page heading showing the configured claim name.
- Renamed Production to Craft Monitor and moved it to the `craft-monitor` URL.
- Moved the Region page from the `empire` URL to `region`; existing Production and Region links continue to redirect to their new addresses.

## [0.48.0-beta.1] - 2026-07-27

### Added

- Added lock indicators and tailored access guidance for navigation destinations that require sign-in, character verification, administrator approval, or allow-list access.

### Changed

- Restricted non-admin pages now remain discoverable in desktop, collapsed, mobile, and Quick Navigation menus while continuing to open the protected access explanation instead of page content.
- Quick Navigation now shows the Admin destination only to authenticated administrators.

## [0.47.1-beta.2] - 2026-07-26

### Changed

- Added sortable table headers to Global Market overview deals, arbitrage results, and item order books.
- Improved market table sorting so complete filtered results are ordered before display limits and pagination are applied.

## [0.47.1-beta.1] - 2026-07-26

### Changed

- Improved the Global Market layout for faster scanning across desktop, tablet, and mobile screens.
- Clarified item metadata, deal locations, Deal Watch details, and market loading and empty states.

### Fixed

- Fixed Settlement Market showing no live listings after the global and settlement market split.
- Fixed abbreviated global market values displaying a misleading `Kg` suffix.

## [0.47.0-beta.1] - 2026-07-26

### Added

- Added a global Market hub for browsing listings, buy orders, deals, Deal Watch rules, favorites, and barter stalls across every active BitJita region.
- Added global market overview insights for arbitrage opportunities, price movers, trading activity, and market hubs.
- Added a dedicated Settlement Market page for monitored-claim listings and confirmed-sales analytics.

### Changed

- Moved settlement-specific market tools under the Settlement navigation group and kept global discovery under Economy & Region.
- Replaced the cached regional buy-order view with live item-first global order-book lookup while preserving existing cached data for rollback.

## [0.46.0-beta.1] - 2026-07-25

### Added

- Added 7-day, 30-day, and one-year ranges to the market income chart, with a visible cumulative-gold axis and clear messaging when only partial history is available.

### Changed

- New users now start with in-app notifications and notification sounds disabled, while existing saved preferences remain unchanged.
- Reduced the market income card's visible copy while retaining an accessible chart description for screen readers.

### Fixed

- Fixed compact gold values displaying as `Kg`; abbreviated values now use `K`, `M`, or `B`.

## [0.45.1-beta.1] - 2026-07-25

### Added

- Added Linked Accounts access to the dedicated Discord bot control page.

### Fixed

- Fixed the administrator character selector appearing empty after opening or refreshing the Admin or Bot Control pages directly.
- Prevented older settlement-roster requests from replacing characters loaded for a newer settlement.
- Improved roster loading, empty, and failure feedback without hiding linked-account action errors.

## [0.45.0-beta.2] - 2026-07-25

### Changed

- Redesigned the Terms of Service and Privacy Policy as readable responsive documents with a compact section index.
- Simplified operator and controller wording, and kept personal identity details out of the legal-acceptance popup.

### Fixed

- Fixed legal-page metadata inheriting the full-height application sidebar layout.

## [0.45.0-beta.1] - 2026-07-25

### Added

- Added comprehensive versioned Terms of Service and Privacy Policy with explicit 18+ acceptance before Discord sign-in and re-acceptance after policy changes.
- Added a Privacy & Data area for exporting account data, unlinking characters, clearing saved data, withdrawing analytics consent, and deleting an account.
- Added administrator-assisted account deletion with typed confirmation, protected audit receipts, and best-effort Discord notification.
- Added signed deletion recovery records, encrypted authenticated backups, restore replay safeguards, and automatic inactive-account retention.

### Changed

- Administrator character assignment now requires a successful user notification before the assignment is committed.
- Account deletion now removes specific-user access entries while preserving separate administrator identities and Discord server membership.

### Security

- Added recent Discord reauthentication for self-service account deletion and transactional protection against stale access-control saves restoring deleted identifiers.
- Added production key requirements and recovery checks for privacy-deletion records and encrypted database backups.

### Operator action required

- Provision the documented privacy-ledger and backup-encryption key files, test encrypted restore and deletion-ledger replay, and complete the legal/release-readiness checks before deploying this release.

## [0.44.0-beta.1] - 2026-07-25

### Added

- Added direct admin assignment and approval of settlement characters for existing Discord logins, with explicit unassignment controls and Discord admin notifications.

### Changed

- Prevented a character from being approved for more than one Discord account until its existing assignment is removed.

## [0.43.0-beta.1] - 2026-07-24

### Added

- Added an administrator Empire Membership page showing current members, observed joins, confirmed departures, and rejoins.
- Added compact local membership-period tracking with a 365-day retention window and independent background collection.
- Added search and 30-day or all-retained filters for current and departed empire members.

### Changed

- Initial roster members are labelled as present when tracking began instead of being assigned an invented historical join date.
- Departures now require two consecutive successful roster omissions, reducing false departures from incomplete upstream responses.

## [0.42.1-beta.1] - 2026-07-24

### Fixed

- Ensured users are notified when a newer app build loads after automatic updates, the in-app refresh action, manual browser refreshes, or reopening the app.
- Added immediate deployment checks when a background tab becomes visible, avoiding delays caused by suspended browser timers.

## [0.42.0-beta.1] - 2026-07-24

### Added

- Added a 14-day Craft Planning progress audit that records exact stock, craft, storage, target, route, catalogue, and configuration changes for debugging.
- Added an admin audit timeline with current confirmed and projected progress, baseline revision, calculation health, change attribution, and a downloadable diagnostic archive.

### Changed

- Split Craft Planning progress into confirmed progress from current stock and guaranteed active crafts, and projected progress that also includes estimated probabilistic output.
- Stabilised progress comparisons around a canonical plan baseline while continuing to reflect stock that is consumed, moved, or sold.
- Updated Craft Planning and Discord reports to explain baseline changes, distinguish confirmed from projected progress, and warn when a calculation is using retained data after an upstream failure.

### Fixed

- Prevented partial source failures from replacing the last complete planner calculation with misleading incomplete progress.
- Prevented sensitive credentials from entering progress audit diagnostics while retaining the player, storage, item, craft, and route identities needed for investigation.

## [0.41.1-beta.4] - 2026-07-22

### Fixed

- Fixed mixed-source Craft Planning items hiding their processing routes whenever a gathering route was available.
- Fixed staged GitHub deployments returning an empty build ID, restoring active-tab update prompts and hidden-tab automatic refreshes.

## [0.41.1-beta.3] - 2026-07-22

### Fixed

- Fixed production verification on GitHub runners where Node.js is installed outside the VPS system path.

## [0.41.1-beta.2] - 2026-07-22

### Fixed

- Fixed initial validation of the database backup service when its backup helper has not yet been installed.

## [0.41.1-beta.1] - 2026-07-22

### Fixed

- Fixed first-time deployment of the database backup service by staging its executable before systemd validation and restoring the previous helper if deployment fails.

## [0.41.0-beta.2] - 2026-07-22

### Changed

- Consolidated passive-craft coverage into one Craft Planning source row per player, with craft, status, structure, expected-output, and guaranteed-output summaries.

### Fixed

- Prevented long passive-craft labels from overlapping expected and guaranteed output values in item details.

## [0.41.0-beta.1] - 2026-07-22

### Added

- Added validated daily database backups with progress reporting, automatic integrity checks, and separate retention for daily, migration, and manually requested recovery points.
- Added a guarded legacy-backup cleanup command that previews exact files and recoverable space before deleting anything.

### Changed

- Changed routine deployments to skip full database backups when the schema is unchanged, while schema changes still create a protected migration backup.
- Extended production deployment timeouts and SSH keepalives so legitimate long-running backup operations stay connected.

### Fixed

- Prevented scheduled backups, deployments, and backup cleanup from overlapping or selecting backups by revision instead of creation time.

### Operator action required

- Production must complete the one-time backup-helper bootstrap and reviewed legacy-backup cleanup in `DEPLOYMENT.md` before the first deployment of this release.

## [0.40.1-beta.5] - 2026-07-21

### Added

- Added processing and completed passive crafts from tracked players to Craft Planning material coverage, including expected and guaranteed farming outputs.
- Added passive-craft source details for the player, structure, and status, with a clear warning when BitJita does not report a location.

## [0.40.1-beta.4] - 2026-07-21

### Changed

- Improved the Craft Planning item-detail loading state while keeping saved stock, routes, and usage visible.
- Restyled the item-detail close control to match the surrounding modal.
- Replaced the generic page-loading panel with a structured skeleton that names the page being opened.
- Clarified processing-route choices with their actual source materials and removed internal recipe placeholders from player-facing labels.

### Fixed

- Prevented route and safety-buffer confirmations from appearing in a different item's detail panel.
- Fixed the Craft Planning item-detail loading indicator so it visibly rotates while routes load.

## [0.40.1-beta.3] - 2026-07-21

### Changed

- Replaced the manual "Treat cell as gathered" setting with acquisition-route selection, so the chosen gathering, crafting, byproduct, or logistics route now drives the plan automatically.
- Reworked acquisition choices into clearly named route cards that identify source nodes, recipe inputs, stations, and the route selected for the plan.
- Made probabilistic work estimates player-friendly with whole-node or recipe-completion plans, while keeping exact rates, progress, drop chances, and safety-buffer controls under an optional calculation detail.
- Renamed player-facing "full resource" estimates to "full node" in Craft Planning and the downloadable probability workbook.

## [0.40.1-beta.2] - 2026-07-21

### Fixed

- Kept known processing routes visible when validated probability values are unavailable, including Wispweave Filament from Wispweave plants and Straw from Embergrain processing.
- Prevented package and unpacking conversions from replacing normal production routes automatically, while retaining them as clearly labelled logistics alternatives.
- Fixed deployment verification incorrectly failing when two simultaneous BitJita cache requests reached the server in a different order.

## [0.40.1-beta.1] - 2026-07-21

### Changed

- Clarified prospecting yields in Craft Planning and the probability workbook as expected output per extraction progress, without estimating an unknown full-node total.

### Fixed

- Fixed catalogue refreshes for prospecting resources whose output is represented by multiple independent probability components.

## [0.40.0-beta.1] - 2026-07-21

### Added

- Added a validated probability catalogue for gathering, resource-completion, and crafting outputs, including nested item lists and item-versus-cargo identity.
- Added a public downloadable probability workbook with player-friendly formulas, route coverage, raw weights, source revisions, and data-quality warnings.

### Changed

- Updated Craft Planning to calculate probabilistic routes from expected output per craft or resource progress, show full-resource equivalents, and apply safety buffers only to expected-value routes.
- Updated effort progress to use the shared probability model and retain the last valid catalogue snapshot when a refresh fails.

## [0.39.0-beta.7] - 2026-07-20

### Fixed

- Grouped Timber, Plant Roots, Brick Slabs, Nails, Rope, and Spool of Thread into shared cross-tier Needs Board rows and clarified that the shortage summary counts different materials.

## [0.39.0-beta.6] - 2026-07-20

### Fixed

- Removed horizontal scrolling from Craft Planning item details by wrapping long descriptions while keeping quantities aligned at the top-right.

## [0.39.0-beta.5] - 2026-07-20

### Fixed

- Corrected station-based item-list recipes in Craft Planning so guaranteed outputs are shown as craft outputs and variable co-products as craft byproducts, while gathering remains limited to world resource extraction.

## [0.39.0-beta.4] - 2026-07-19

### Added

- Added clickable Watchtower siege details with attacker and defender energy, plus reusable Empire details for members, claims, towers, activity, and Hexite reserves.

### Fixed

- Kept cross-region attacker details available and contained Siege and Empire dialogs within mobile viewports.

## [0.39.0-beta.3] - 2026-07-19

### Changed

- Consolidated Empire Hexite holdings into one sortable reserve column with a compact Watchtower-energy minimum, stored HE and Capsule composition, and accessible source details.

### Fixed

- Corrected legacy Empire Hexite totals to value ready Capsules at 1,000 Watchtower energy and kept incomplete, unavailable, and stale scan states explicit.

## [0.39.0-beta.2] - 2026-07-19

### Fixed

- Changed active watchtower siege badges to show "Under Siege" instead of counting BitJita participant records as separate sieges.

## [0.39.0-beta.1] - 2026-07-19

### Added

- Added sortable Empire Hexite Energy, ready Capsule, and Watchtower Energy totals, refreshed by a resumable scheduled inventory sweep.

### Changed

- Valued deployed Hexite Capsules at 1,000 Watchtower energy while retaining their live Hexite Energy crafting cost for reference.

## [0.38.0-beta.4] - 2026-07-18

### Fixed

- Restored the Empires Overview and Watchtowers tab styling after route-based stylesheet loading.
- Restored responsive Empire summary cards and clear spacing between the Claimed watchtowers heading and its filters.

## [0.38.0-beta.3] - 2026-07-18

### Fixed

- Fixed estimated active craft output failing to reduce material shortages and unnecessarily restoring prerequisite gathering requirements.

## [0.38.0-beta.2] - 2026-07-17

### Fixed

- Fixed scheduled admin jobs using the host machine timezone instead of consistent UK local time, including daylight-saving transitions.

## [0.38.0-beta.1] - 2026-07-17

### Added

- Added a manually approved GitHub production deployment that builds immutable VPS releases before switching the live site.
- Added automatic application rollback, revision-pinned health checks, deployment locking, online pre-cutover backups, and release retention.

### Changed

- Limited normal deployment interruption to the web-process restart and added short Caddy retries with explicit maintenance responses.
- Replaced routine SSH updates with a documented staged-release workflow and supervised one-time VPS migration.

## [0.37.0-beta.1] - 2026-07-17

### Added

- Added an admin-controlled gathered-item override to Craft Planner cell details, preserving required stock and downstream uses while stopping misleading producer and package expansion.
- Added gathered-item enable and disable events to the Manage Plan audit history.
- Added a Map resource-finder link for items marked as gathered.

## [0.36.1-beta.4] - 2026-07-17

### Fixed

- Fixed Craft Planner merging Braxite into Pebbles and separated other distinct material families that share broad API tags.

## [0.36.1-beta.3] - 2026-07-17

### Changed

- Kept Craft Planner package and unpack routes selectable while preferring standard production routes unless transport is the only valid option.

### Fixed

- Fixed malformed package metadata hiding Refined Ferralith, Ferralith Ingot, molten metal, and ore requirements from Smithing craft plans.

## [0.36.1-beta.2] - 2026-07-16

### Changed

- Included the configured Craft Plan name in general and profession-specific Discord progress notification titles.

### Fixed

- Fixed Leatherworking progress incorrectly showing as 0% in Craft Planner Discord notifications.
- Fixed the Needs Board row editor showing a conflicting raw API section instead of the planner section.

## [0.36.1-beta.1] - 2026-07-16

### Fixed

- Fixed header metadata values running together when pages such as Professions, Members, Research, and Activity were opened directly.

## [0.36.0-beta.1] - 2026-07-16

### Added

- Added an Audit tab to Manage Plan showing who enabled or disabled plan visibility and tracked inventory sources.

### Fixed

- Fixed cramped and overlapping header spacing across application pages and mobile layouts.

## [0.35.1-beta.2] - 2026-07-15

### Fixed

- Fixed Unfired Brick being merged into the ordinary Brick row in Craft Planner, including independent row and section overrides for material families that share an API tag.

## [0.35.1-beta.1] - 2026-07-15

### Fixed

- Fixed collected Cervus and Scrofa carcasses not counting toward Craft Planner requirements that use their gendered animal variants.

## [0.35.0-beta.1] - 2026-07-15

### Added

- Added consistent loading, empty, error, stale, restricted, and action-progress states across operational pages.
- Added shared accessible dialogs, sortable data tables, page headers, route orientation, and keyboard-reachable horizontal data regions.

### Changed

- Improved the application shell, public routes, admin console, bot dashboard, theme system, and first-run tour for clearer hierarchy and more consistent controls.
- Improved responsive behavior across the public application, including narrow navigation, dense tables, dashboards, planning boards, and fixed overlays.
- Improved keyboard, screen-reader, forced-colour, reduced-motion, focus, contrast, and touch-target support throughout the interface.

### Removed

- Removed inaccurate inferred member labels such as “Can manage settlement” and “Standard member”.

### Fixed

- Fixed guided-tour highlighting blurring the interface being explained.
- Fixed Leaderboard cards changing size and position when switching categories.
- Fixed the Custom Theme editor being cut off before its final controls could be reached.
- Fixed route layouts and metadata overflowing under supported mobile and text-scaling conditions.

## [0.34.1-beta.2] - 2026-07-15

### Changed

- Simplified the Craft Planner progress summary by removing the lengthy effort-estimation description.

### Fixed

- Fixed profession effort percentages using different section groupings from the visible Needs Board rows.
- Fixed moved, hidden, overridden, and aliased materials affecting the wrong profession or being counted twice in Fishing progress.

## [0.34.1-beta.1] - 2026-07-14

### Fixed

- Fixed completed Craft Planner catalog scans still leaving effort progress unavailable when BitJita does not provide verified gathering yields.
- Fixed Fishing route selection hiding otherwise valid general effort progress and estimation notices.
- Fixed player inventory, craft, and bank tracking controls overflowing their cards in the Craft Planner manager.

## [0.34.0-beta.1] - 2026-07-14

### Added

- Added independent per-player Craft Planner bank tracking for all BitJita-visible settlement banks, including banks at other settlements.

### Fixed

- Fixed item and cargo metadata with the same numeric ID being mixed when reading planner stock sources.
- Prevented malformed or ambiguous player-bank inventory rows from being counted as confirmed stock.

## [0.33.0-beta.1] - 2026-07-14

### Added

- Added separate Ocean and Lake Fishing progress calculations using verified catalog data.

### Changed

- Changed Craft Planner progress to reflect the relative effort required for each material across the overall Needs Board, every profession, Fishing routes, and Discord reports.
- Changed planner coverage so only confirmed stock and guaranteed active-craft outputs count; estimated outputs remain visible but do not increase progress.

### Fixed

- Fixed completed upstream work being shown as missing after it removed downstream requirements from the live craft plan.
- Fixed unavailable or incomplete catalog data displaying a misleading percentage instead of a clear unavailable state.

## [0.32.0-beta.63] - 2026-07-14

### Changed

- Replaced settlement snapshot history with one current settlement baseline while preserving Activity history.
- On first startup after updating, the app permanently removes legacy historical snapshot rows; operators must take a pre-migration database backup and retain it until the updated app is verified.

### Removed

- Removed unused snapshot history APIs, retention controls, and Dashboard loading.

## [0.32.0-beta.62] - 2026-07-14

### Changed

- Reduced settlement snapshot storage by keeping the history summary without duplicating unused market and craft payloads.

### Fixed

- Fixed health checks repeatedly rebuilding full public settings for every collector, which caused large native-memory growth and slow VPS deployments.
- Fixed latest-snapshot reads loading an unused stored payload into memory.

## [0.32.0-beta.61] - 2026-07-14

### Changed

- Reduced retained native memory after large Craft Planner and background-worker calculations by returning unused allocator memory to Linux more aggressively.
- Staggered web and worker health-metric persistence to reduce SQLite write contention.

### Fixed

- Prevented a temporary SQLite database lock while recording health telemetry from terminating and restarting the worker service.

## [0.32.0-beta.60] - 2026-07-14

### Changed

- Reduced Server Health, Craft Planner, background polling, and monitoring-history memory overhead while preserving live multi-user updates.
- Limited worker BitJita traffic to eight concurrent requests and shared identical in-flight requests.
- Changed snapshot persistence to the configured 60-second cadence and compacted older monitoring history automatically.

### Fixed

- Fixed Server Health auto-refresh requests overlapping and making the web service or deployment health check unresponsive.
- Fixed the VPS update helper timing out too quickly while the application was still starting.

## [0.32.0-beta.59] - 2026-07-14

### Fixed

- Fixed Leaderboard playtime, session, and date columns sorting by their formatted labels instead of their underlying duration or timestamp.

## [0.32.0-beta.58] - 2026-07-13

### Added

- Added a future ideas and plans library with a reusable template and the deferred VPS efficiency plan.

## [0.32.0-beta.57] - 2026-07-13

### Changed

- Improved Discord Craft Planner reports with quantity-weighted progress, completed requirement counts, a three-column profession overview, and clearer shortage summaries.

### Fixed

- Fixed `/craft-plan` timing out during slower calculations by acknowledging the command before loading live planner data.

## [0.32.0-beta.56] - 2026-07-13

### Changed

- Changed Craft Planner coverage to count conservatively rounded estimates only from active crafts, including predictable crafting byproducts such as Straw, with estimated quantities labelled in the Needs Board, item details, and Discord reports.

### Fixed

- Stopped speculative gathering byproducts such as Gypsite and Resin from appearing as available or planned stock before they exist.

## [0.32.0-beta.55] - 2026-07-13

### Added

- Added scheduled and on-demand Discord Craft Planner reports with overview and profession views, role-controlled `/craft-plan` access, reliable delivery retries, and Bot dashboard scheduling controls.

## [0.32.0-beta.54] - 2026-07-13

### Fixed

- Fixed contribution profession mapping so live contribution records persist to the leaderboard instead of being silently discarded.

## [0.32.0-beta.53] - 2026-07-13

### Fixed

- Restored contribution leaderboard updates by persisting live craft contribution rows during background collection.

## [0.32.0-beta.52] - 2026-07-13

### Fixed

- Restored completed prerequisite quantities and blocked-recipe indicators on the Craft Planning Needs Board while retaining compact live refreshes.

## [0.32.0-beta.51] - 2026-07-13

### Changed

- Refocused Settlement Capability cards and needs on readiness for the next settlement tier, with current-tier coverage treated as baseline context.

## [0.32.0-beta.50] - 2026-07-13

### Changed

- Simplified Settlement Capability readiness to use only the live settlement tier and member profession levels, without Craft Planner estimates.

## [0.32.0-beta.49] - 2026-07-13

### Changed

- Redesigned Professions as a settlement capability dashboard using the live settlement tier, dependency risk, and active Craft Planner coverage.

## [0.32.0-beta.48] - 2026-07-12

### Added

- Added an owner-only Server Health admin page for VPS performance, service state, process activity, trends, and redacted logs.
- Added a read-only systemd host collector with seven-day history and critical incident recovery alerts by Discord DM.

## [0.32.0-beta.47] - 2026-07-12

### Fixed

- Improved Craft Planning stability by shrinking live refresh payloads, caching repeated calculations, and loading item drilldown details only when opened.

## [0.32.0-beta.46] - 2026-07-12

### Fixed

- Merged duplicate Tailor and Tailoring Needs Board sections into the canonical Tailoring section.

## [0.32.0-beta.45] - 2026-07-12

### Changed

- Condensed the Professions summary and moved detailed profession focus and coverage into an expandable insights panel.

## [0.32.0-beta.44] - 2026-07-12

### Fixed

- Fixed Gather Next item names and tier badges overlapping their icons and rows.

## [0.32.0-beta.43] - 2026-07-12

### Changed

- Condensed the Needs Board header by aligning overall progress with its heading and grouping the shortage toggle with search.

## [0.32.0-beta.42] - 2026-07-12

### Changed

- Added date and cumulative-value readouts when hovering or focusing the market income chart.
- Added known item tiers and tier colours to the dashboard Gather Next list.

## [0.32.0-beta.41] - 2026-07-12

### Added

- Added permanent workstation-target progress that credits newly built claim stations and removes their completed material requirements.

### Changed

- Improved personalized Ocean and Lake Fish details with counted stock locations and richer Fish Oil usage routes.
- Moved overall Needs Board progress beside the heading and aligned its colours with section completion states.
- Condensed tier and workstation presets into compact tier-only controls.

## [0.32.0-beta.40] - 2026-07-12

### Changed

- Improved spacing, hierarchy, source previews, and responsive buffer controls in Craft Planning acquisition details.
- Changed uncertain-drop safety buffers to increase producer actions and source-item requirements instead of inflating the desired output quantity.

### Fixed

- Fixed active-craft pulse rings rendering slightly off-centre from their status dots.

## [0.32.0-beta.39] - 2026-07-12

### Changed

- Improved the Craft Planning loading screen with a responsive preview of the plan structure.
- Added a reduced-motion-aware pulse to active craft indicators on the Needs Board.

## [0.32.0-beta.38] - 2026-07-12

### Added

- Added an overall quantity-weighted completion indicator to the Craft Planning Needs Board.

### Changed

- Simplified Needs Board shortage and blocked states to use distinct cell colours without persistent inset borders.

### Fixed

- Fixed blocked Needs Board cells changing back to the shortage colour when highlighted.
- Fixed Gypsite showing its fallback Masonry recipe instead of verified Sand and Clay gathering sources.

## [0.32.0-beta.37] - 2026-07-12

### Added

- Added admin-managed safety buffers for uncertain gathering drops, with expected-yield and gathering-action guidance.

### Changed

- Improved Craft Planning targets, item details, shortage states, and loading feedback for faster plan review and editing.
- Added player names to counted inventory and deployable stock locations.

### Fixed

- Fixed gathering byproducts being presented as ordinary crafting routes when a verified gathering source was available.
- Fixed personal fishing projections losing their counted stock-location details.
- Fixed active-craft indicators overlapping shortage borders in the Needs Board.
- Fixed safety buffers affecting deterministic materials instead of only uncertain gathering routes.

## [0.32.0-beta.36] - 2026-07-12

### Changed

- Improved the application shell with clearer active navigation, calmer sidebar styling, and more compact page spacing.
- Replaced the narrow-screen navigation strip with an accessible grouped drawer that preserves route and permission behaviour.

## [0.32.0-beta.35] - 2026-07-12

### Added

- Added a live item search to the Craft Planning Needs Board that works alongside activity and shortage filters.

### Fixed

- Restored downstream Fish Oil recipe context in the item details for personally selected Ocean and Lake fish routes.

## [0.32.0-beta.34] - 2026-07-12

### Changed

- Moved the personal Ocean or Lake fishing selector into the Fishing section of the Craft Planning Needs Board.

### Fixed

- Fixed verified probabilistic fishing routes being reported as unavailable when the catalog contained an expected yield without a guaranteed minimum.
- Fixed target items displaying duplicate images in Craft Planning and Manage Plan.

## [0.32.0-beta.33] - 2026-07-12

### Added

- Added T2-T10 workstation presets to Craft Planning, using BitJita workstation definitions and construction requirements.

### Changed

- Craft Planning now expands workstation goals into their complete material and recipe requirements while keeping each workstation editable as a plan target.

## [0.32.0-beta.32] - 2026-07-11

### Changed

- Improved Craft Planning Needs Board readability with clearer shortage highlighting, larger text, and completion-based section colours.
- Activity filters on the Needs Board now support selecting multiple sections at once.

## [0.32.0-beta.31] - 2026-07-11

### Added

- Added a browser-local Ocean or Lake fishing preference to Craft Planning so each user can view the remaining Fish Oil requirement through their preferred gathering route.

### Changed

- Craft Planning now accounts for stored Ocean Fish, Lake Fish, Fish Oil, and guaranteed tracked outputs before calculating either personal fishing route.

### Fixed

- Fixed probabilistic Fish Oil outputs being treated as guaranteed when calculating personal gathering requirements.

## [0.32.0-beta.30] - 2026-07-11

### Changed

- Moved technical Craft Planning catalog warnings into a compact admin-only diagnostics panel.

### Fixed

- Fixed incomplete byproduct candidates producing a full-page warning for every possible producer, including when a usable route was already available.

## [0.32.0-beta.29] - 2026-07-11

### Changed

- Improved planner catalog refresh monitoring with visible progress freshness and faster automatic continuation checks.

### Fixed

- Fixed stalled planner catalog refreshes remaining marked as running instead of recovering automatically.
- Fixed the Craft Planning target quantity, remove action, and manual search focus styles overlapping or rendering duplicate borders.

## [0.32.0-beta.28] - 2026-07-11

### Fixed

- Fixed the Craft Planning item-detail close button appearing below the item summary instead of in the dialog header.
- Fixed awkward spacing between manual target search, target quantities, and remove actions in Manage Craft Plan.

## [0.32.0-beta.27] - 2026-07-11

### Changed

- Improved Craft Planning catalog refreshes so normalization changes trigger one clean rebuild without breaking automatic pause and retry continuation.

### Fixed

- Fixed Ocean Fish Oil yields being calculated from only one probability outcome instead of the complete BitJita output distribution.
- Fixed tracked farming and other product crafts not expanding their expected outputs onto the Needs Board.

## [0.32.0-beta.26] - 2026-07-11

### Changed

- Improved Craft Planning so natural gathering byproducts use their verified gathering sources and expected yields.

### Fixed

- Fixed direct crafting recipes being preferred for gathering byproducts such as Gypsite, Resin, Bark, and Crushed Shells.
- Fixed gathering-byproduct item details showing misleading crafting ingredients instead of their acquisition activity.

## [0.32.0-beta.25] - 2026-07-11

### Fixed

- Fixed the Craft Planning Needs Board hiding the T9, T10, and Materials columns at normal desktop widths.

## [0.32.0-beta.24] - 2026-07-11

### Changed

- Improved Craft Planning labels so tracked outputs clearly include crafts that are in progress or ready to collect.

### Fixed

- Fixed completed player crafts waiting to be collected not reducing Craft Planning requirements.
- Fixed duplicate public and player craft records being counted with stale completion details.

## [0.32.0-beta.23] - 2026-07-11

### Changed

- Improved Craft Planning recipe choices so alternate routes describe their inputs, output, and crafting station more clearly.
- Added tracked-player crafts, including completed crafts waiting to be collected, to planner quantities and item details.

### Fixed

- Fixed low-yield probabilistic routes producing extreme Fish Oil and source-fish requirements when a more efficient route was available.
- Fixed projected byproduct surpluses appearing as enormous available quantities on the Needs Board.
- Fixed the Covered and More needed legend indicators using unavailable theme colours.

## [0.32.0-beta.22] - 2026-07-11

### Changed

- Improved Craft Planning recipe selection so one chosen route controls the required source shown on the board while alternate routes remain available in the dropdown.

### Fixed

- Fixed inflated farming and other chance-output requirements by calculating the complete expected yield across BitJita probability distributions.
- Fixed simultaneous outputs, such as filament and seeds from the same farming harvest, failing to offset later recipe requirements.
- Fixed planner item details showing every recipe alternative as though each route were selected.

## [0.32.0-beta.21] - 2026-07-11

### Changed

- Improved Craft Planning calculations so counted stock, active crafts, and planned byproducts are allocated across the complete recipe chain before unmet materials are expanded.
- Reworked the Craft Planning Needs Board into a continuous Sync-style matrix with stable activity and row ordering, section progress, activity filters, shortage filtering, and clearer material states.
- Improved planner catalog refresh recovery so temporary BitJita failures retry automatically and permanently unavailable entities no longer stop the remaining catalog refresh.

### Fixed

- Fixed planned secondary outputs being counted more than once or failing to offset demand in another target branch.
- Fixed planner resources appearing under inconsistent activity names or row positions by applying a canonical operational taxonomy while retaining admin overrides and unknown future API tags.

## [0.32.0-beta.20] - 2026-07-10

### Changed

- Improved planner catalog refreshes so discovery runs once and later detail batches continue automatically from a local database queue without repeatedly requesting the full BitJita item and cargo lists.
- Improved planner catalog diagnostics with clearer discovery, detail-loading, continuation, retry, and last-full-refresh states.

### Fixed

- Fixed the Craft Planning Needs Board's All count so it shows the total number of rows instead of the number of activity sections.

## [0.32.0-beta.19] - 2026-07-10

### Fixed

- Fixed Craft Planning catalog refreshes when BitJita reports duplicate byproduct outputs for the same producer.

## [0.32.0-beta.18] - 2026-07-10

### Added

- Added a normalized local Craft Planning catalog for BitJita items, cargo, recipes, inputs, outputs, and byproducts.
- Added weekly resumable catalog refreshes with an admin manual refresh action, progress, counts, and diagnostics.

### Changed

- Improved Craft Planning performance by calculating recipe chains from indexed local catalog tables while keeping inventories, deployables, and active crafts live.

### Fixed

- Fixed duplicate recipes returned through direct and reverse BitJita relationships and preserved existing route overrides.
- Fixed large catalog refreshes so they continue automatically in controlled batches without being reported as failures.
- Fixed existing default daily catalog schedules so they migrate to the new weekly schedule.

## [0.32.0-beta.17] - 2026-07-10

### Fixed

- Fixed Craft Planning byproduct route discovery so materials such as gypsite, bark, and resin can use BitJita producer outputs instead of expensive direct crafts.

## [0.32.0-beta.16] - 2026-07-09

### Fixed

- Fixed Craft Planning recipe discovery for BitJita byproduct outputs, such as crushed shells and farming products, by discovering producer items that expose item-list possibilities.
- Improved Craft Planning active craft counting so admins can choose which tracked players' in-progress crafts reduce needed materials.
- Fixed production Discord craft-start age gating so crafts skipped for being too new can still notify after they pass the configured age threshold.

## [0.32.0-beta.15] - 2026-07-09

### Added

- Added Craft Planning needs-board row name overrides so admins can rename rows while keeping BitJita API tags and tiers as the calculation source of truth.

## [0.32.0-beta.14] - 2026-07-09

### Changed

- Improved Craft Planning item detail popups so stock locations are grouped, recipe sources are shown, and repeated "used for" entries can be expanded only when needed.
## [0.32.0-beta.13] - 2026-07-09

### Fixed

- Fixed Craft Planning recipe expansion so BitJita cargo-derived routes, such as trunks producing wood logs, are discovered from the cargo API and counted in the needs board.
- Improved Craft Planning route selection so transport package and unpack recipes stay out of normal crafting calculations when a real production route is available.
- Improved Craft Planning modal spacing and documented the item/cargo API rules used by the planner.

## [0.32.0-beta.12] - 2026-07-09

### Added

- Added Craft Planning needs-board section overrides so admins can move rows to a different activity while keeping BitJita API data as the default source of truth.

## [0.32.0-beta.11] - 2026-07-09

### Fixed

- Improved Craft Planning item detail popups so recipe context explains what each material is used for, uses a single item icon, and shows real per-craft input quantities.
## [0.32.0-beta.10] - 2026-07-09

### Fixed

- Fixed Craft Planning needs-board grouping so materials use BitJita item tags and tiers, keeping refined materials under the relevant activity instead of Scholar.
- Improved Craft Planning route management so admins can review the recipe chain in use and change available recipe alternatives from the manager.
- Improved Craft Planning needs-board cells so fully stocked prerequisites remain visible while they are still needed for unfinished parent crafts.

## [0.32.0-beta.9] - 2026-07-08

### Fixed

- Fixed Craft Planning calculations so already-counted intermediates and active craft outputs reduce the recipe chain before gather requirements are expanded.
- Fixed Craft Planning route selection so packed transport/unpack routes are not preferred over normal crafting recipes.
- Improved Craft Planning documentation and safeguards around viewport dialogs and BitJita item/cargo metadata.

## [0.32.0-beta.8] - 2026-07-08

### Fixed

- Fixed Craft Planning deployable tracking so Cart covers carts, wagons, and handcarts with one persistent per-player toggle.
- Fixed Craft Planning player deployable item labels so BitJita item and cargo details are used instead of raw item ids.
- Improved Craft Planning deployable item rows so source cards are easier to scan.

## [0.32.0-beta.7] - 2026-07-08

### Fixed

- Fixed Craft Planning needs-board tier grouping so item tiers come from BitJita item and recipe details instead of name or id guesses.
- Fixed Craft Planning deployable discovery so player carts, caches, and stash-like storage are grouped by player while settlement storage is kept out of player deployables.
- Improved Craft Planning needs-board cells and detail popups so cells are cleaner and item details open in a proper viewport dialog.

## [0.32.0-beta.6] - 2026-07-08

### Added

- Added clickable Craft Planning needs-board cells that show stock locations, recipe details, and admin recipe route selection for alternate material paths.
## [0.32.0-beta.5] - 2026-07-07

### Changed

- Reworked the Craft Planning page into a cleaner Sync-style needs board with targets shown first and recipe-route details kept in the admin manager.

## [0.32.0-beta.4] - 2026-07-07

### Fixed

- Fixed Craft Planning recipe expansion so tier preset targets expand into their underlying recipe chain instead of stopping at the final item.
- Fixed Craft Planning Gather Next so final target items stay in the target overview instead of appearing as gather tasks.
- Fixed Craft Planning player storage parsing so BitJita-visible player deployables and wrapped inventory payloads are handled safely.
- Improved Craft Planning manager source cards and modal styling for a cleaner admin setup view.

## [0.32.0-beta.3] - 2026-07-07

### Fixed

- Fixed Craft Planning tier presets so they load claim tier and township upgrade materials directly from BitJita research data, including the correct T6 Advanced Codex total.
- Improved the Craft Planning manager layout so tier presets are prominent and the manager opens as a proper viewport dialog.


## [0.32.0-beta.2] - 2026-07-07

### Added

- Added a full-page Craft Planning manager for admins with room to manage targets, storage, player inventories, deployables, route overrides, and material buffers.
- Added tier upgrade presets that can add required research materials to the plan while still allowing manual edits and removals.

### Changed

- Moved Craft Planning setup out of the Admin panel into the Craft Planning page, leaving Admin with a direct manager link.
## [0.32.0-beta.1] - 2026-07-07

### Added

- Added an admin-controlled Craft Planning page for tracking settlement goals, recipe routes, storage sources, player inventories, deployables, and drop multipliers.
- Added a read-only Craft Planning board so users can see targets, missing materials, active craft progress, recipe routes, and what to gather next.

### Changed

- Replaced the dashboard Recent Activity card with a Gather Next overview linked to Craft Planning.

## [0.31.1-beta.46] - 2026-07-06

### Fixed

- Fixed the embedded BitCraft map so auto-online tracking updates the map when the online player list changes, while still avoiding reloads for unchanged map URLs.

## [0.31.1-beta.45] - 2026-07-06

### Fixed

- Fixed production contributor owner and co-owner icons so they stay inline beside player names.

## [0.31.1-beta.44] - 2026-07-06

### Fixed

- Fixed the embedded BitCraft map so normal app refreshes and passive online-player updates no longer reload the map iframe.

## [0.31.1-beta.41] - 2026-07-05

### Fixed

- Fixed dashboard online members so the location line only shows a player's current region when BitJita provides one, instead of falling back to the monitored settlement region.

## [0.31.1-beta.40] - 2026-07-05

### Changed

- Updated in-app craft start and completion notifications to include the craft quantity when available.

## [0.31.1-beta.39] - 2026-07-04

### Fixed

- Fixed duplicate craft notifications after returning to an inactive browser tab by aligning fallback and activity-feed craft notification keys.

## [0.31.1-beta.38] - 2026-07-04

### Changed

- Tightened the sidebar layout and renamed the Command navigation group to Overview.

## [0.31.1-beta.37] - 2026-07-04

### Added

- Added a persistent sidebar account card so users can clearly see Discord sign-in and character verification status.


## [0.31.1-beta.36] - 2026-07-04

### Fixed

- Fixed ghost craft completion notifications caused by the browser fallback treating temporary live craft payload gaps as completed crafts.

## [0.31.1-beta.35] - 2026-07-04

### Added

- Added admin-managed access controls for public app pages and first-level tabs, with options for public access, Discord sign-in, verified characters, or selected Discord users.

### Fixed

- Fixed duplicate in-app craft notifications by using stable production craft source keys for activity-event dedupe.

## [0.31.1-beta.34] - 2026-07-04

### Fixed

- Fixed the dashboard Recent Activity card so treasury and supply updates remain visible while craft start and completion updates stay hidden.
- Fixed profession heatmap headers so long profession names such as Leatherworking stay on one line.

## [0.31.1-beta.33] - 2026-07-03

### Fixed

- Fixed the dashboard Recent Activity card so it previews the same recent events as the Activity page while still hiding craft start and completion noise.

## [0.31.1-beta.32] - 2026-07-03

### Changed

- Updated the dashboard Recent Activity card so craft start and completion updates no longer crowd out broader settlement activity.

## [0.31.1-beta.31] - 2026-07-03

### Added

- Added a first-time app tour with a welcome prompt, page highlights, navigation through key tools, and a Help menu replay action.
- Added live update detection so open browsers can see when a new VPS deployment is available and hidden tabs refresh automatically.

### Fixed

- Fixed the first-time tour so cookie consent remains on top and the welcome prompt does not reappear while the tour is running.
- Fixed the user settings preferences panel so notification sound options are no longer clipped at the bottom.
## [0.31.1-beta.30] - 2026-07-03

### Added

- Added imported MP3 and WAV notification sound options, including coin clinks, UI pops, notification bells, and cash-register style alerts.

### Changed

- Updated browser notification sound playback so settings can use either generated tones or bundled audio files.

## [0.31.1-beta.29] - 2026-07-03

### Added

- Added per-notification browser sound choices for market listings, market sales, deal alerts, craft starts, and craft completions.
- Added a fuller Coin jingle sound option for market-style alerts.

### Changed

- Improved notification sound settings so the global sound remains the default while individual notification types can override it.

## [0.31.1-beta.28] - 2026-07-03

### Changed

- Improved production notifications in the drawer so they use the same crafter and event-time styling as toast popups.
- Reduced duplicate toast popups and sounds across multiple open app tabs by letting only the active visible tab deliver each source-keyed notification.

## [0.31.1-beta.27] - 2026-07-03

### Added

- Added a scalable Player Tracking manager on the Map page so large settlements can search, filter, and bulk-manage tracked players without crowding the header.
- Added the running app version and commit ID to the footer for quick live-version checks.

### Changed

- Changed map player tracking defaults to follow online members only, with quick actions for auto, all, none, and manual management.
- Improved production toast metadata so the crafter name appears beside the muted event time.

## [0.31.1-beta.26] - 2026-07-03

### Changed

- Changed generated BitCraft Map links so the watchtower layer is requested by default when users open the app map.
- Improved production toast layout so the event time is shown as a smaller muted time-only line instead of repeating the started or completed status.

## [0.31.1-beta.25] - 2026-07-03

### Fixed

- Improved production in-app notifications so craft start and completion toasts show the crafter, station, event time, and keep crafted item images when available.

## [0.31.1-beta.24] - 2026-07-02

### Fixed

- Fixed watchtower aligned-claim owner names so the popup can use claim detail data when regional claim rows omit the owner.

## [0.31.1-beta.23] - 2026-07-02

### Fixed

- Fixed watchtower empire member rank filters so they use empire ranks instead of settlement claim roles.

## [0.31.1-beta.22] - 2026-07-02

### Changed

- Improved aligned-claim member drilldowns so settlement roles and empire ranks are shown separately, including owner and co-owner labels where available.

## [0.31.1-beta.21] - 2026-07-02

### Added

- Added aligned-claim details to watchtower popups, including distance from the selected tower and lazy claim-member drilldowns with last login details.

## [0.31.1-beta.20] - 2026-07-02

### Added

- Added clickable current-crafter pills on the Production page so users can filter active crafts by player and click again to return to all members.

## [0.31.1-beta.19] - 2026-07-02

### Added

- Added Discord profession emoji support for craft notifications, including synced emoji discovery, automatic profession matching, and admin overrides.

### Changed

- Improved the VPS update helper so normal updates print compact progress, service readiness, health checks, and a final summary while writing full details to a timestamped log.

## [0.31.1-beta.18] - 2026-07-02

### Fixed

- Fixed new market listing in-app notifications so live worker sync checks fresh BitJita listings and recent listing activity can toast after a browser refresh.

## [0.31.1-beta.17] - 2026-07-02

### Fixed

- Fixed production start notifications so crafts that are first seen already complete or ready to collect do not appear as newly started.
- Fixed production notification item metadata so craft toasts can show the crafted item icon when BitJita provides one.

## [0.31.1-beta.16] - 2026-07-02

### Added

- Added a tracked VPS update helper that repairs build output ownership, reports Git revision changes, waits for services, and prints health-check output during deployments.

### Changed

- Updated deployment documentation to install and use the tracked update helper for normal VPS updates.

## [0.31.1-beta.15] - 2026-07-02

### Added

- Added a dedicated Deal Watchlist market tab so users can add, edit, enable, disable, and remove deal watches without first running a Price Finder search.

### Changed

- Kept Price Finder focused on item pricing while retaining the selected-item Watch for deals action.

## [0.31.1-beta.14] - 2026-07-02

### Added

- Added admin controls for global in-app notification defaults.

### Changed

- User notification settings now show when a notification type is disabled by admin while preserving the user's saved preference.

## [0.31.1-beta.13] - 2026-07-02

### Fixed

- Fixed live production start and completion notifications so in-app activity rows are recorded on the production refresh cadence instead of waiting for the slower contribution sync.

## [0.31.1-beta.12] - 2026-07-02

### Fixed

- Fixed fresh production notifications so recently recorded worker events can toast on the first browser notification refresh.

## [0.31.1-beta.11] - 2026-07-02

### Fixed

- Fixed production in-app notifications so Discord-only minimum age filters no longer suppress app toasts.

## [0.31.1-beta.10] - 2026-07-02

### Fixed

- Fixed in-app production start and completion notifications so worker-recorded production activity rows trigger browser toasts on live deployments.

## [0.31.1-beta.9] - 2026-07-02

### Fixed

- Fixed production craft notifications so worker-recorded craft start and completion events appear in the app notification feed.

## [0.31.1-beta.8] - 2026-07-02

### Added

- Added a hideable floating tools rail so users can collapse the shortcuts off-screen with only an arrow handle visible.

## [0.31.1-beta.7] - 2026-07-02

### Added

- Added page targeting and optional expiry dates for admin-configured app popups.

## [0.31.1-beta.6] - 2026-07-02

### Fixed

- Fixed craft notifications so browsing pages without production craft data no longer clears the craft notification snapshot.

## [0.31.1-beta.5] - 2026-07-01

### Changed

- Changed regional ranking scores to exclude supplies, making tier the main factor while treasury and tiles act as tie breakers.

## [0.31.1-beta.4] - 2026-07-01

### Fixed

- Fixed shared panel headers so titles and count text keep visible spacing across the app.

## [0.31.1-beta.3] - 2026-07-01

### Changed

- Simplified the claimed watchtowers table by replacing coordinate text with Open on map actions.
- Improved the watchtower inactivity threshold control and removed extra explanatory note cards from the Watchtowers view.

### Added

- Added an At risk only filter for claimed watchtowers with active siege or risky leader activity.

## [0.31.1-beta.2] - 2026-07-01

### Added

- Added empire filter chips to the claimed watchtowers table so towers can be viewed by empire.

### Changed

- Renamed claimed watchtower coordinates to map coordinates and added explanatory copy to avoid implying they are exact in-game coordinates.
- Replaced repeated generic watchtower names with stable per-empire labels such as Watchtower #1.

### Fixed

- Fixed the admin app popup editor so it opens in the current viewport instead of following the page scroll position.

## [0.31.1-beta.1] - 2026-07-01

### Fixed

- Fixed the admin app popup list so enabled switches no longer overlap popup titles.
- Fixed market analytics date sorting so recent confirmed sales order by the actual date and time.
- Fixed market analytics stat values so gold suffixes with descenders are not clipped.

## [0.31.0-beta.1] - 2026-07-01

### Changed

- Changed beta release versioning to `0.MINOR.PATCH-beta.N` and migrated existing changelog headings to the new standard.
- Updated Codex release instructions so future changes choose versions from the new release policy.

## [0.30.0-beta.8] - 2026-07-01

### Fixed

- Fixed the admin popup list status toggle so it no longer overlaps popup titles.


## [0.30.0-beta.7] - 2026-07-01

### Fixed

- Improved the admin popup and navigation layouts so they fit cleanly without unwanted scrollbars.


## [0.30.0-beta.6] - 2026-07-01

### Changed

- Improved the admin console navigation, spacing, diagnostics, audit trail, and popup management experience.
- Replaced inline app popup editing with a compact popup list and modal editor.
- Reworked collection status into a clearer health summary for live API and background collection state.


## [0.30.0-beta.5] - 2026-07-01

### Changed

- Changed signed-in Discord user preferences to sync automatically to the user's Discord account.
- Removed the manual save and load account settings buttons from user settings.

### Fixed

- Prevented approved Discord character links from being changed until the existing character is unlinked.


## [0.30.0-beta.4] - 2026-07-01

### Changed

- Improved the admin popup editor layout so saved popup messages and actions are easier to read and edit.


## [0.30.0-beta.3] - 2026-07-01

### Added

- Added admin-managed in-app popups with informational, success, warning, and danger message types.
- Added one-time and repeat-until-dismissed popup modes for user-facing app messages.

### Fixed

- Fixed the local smoke server launcher so restart checks return quickly and smoke runs do not start background scheduled jobs.


## [0.30.0-beta.2] - 2026-07-01

### Fixed

- Fixed recent confirmed market sales so they still notify when a seller's trade-history backfill marker is missing or recovered.


## [0.30.0-beta.1] - 2026-07-01

### Fixed

- Fixed confirmed market sales imported from BitJita sell history so they create in-app and Discord market sale notifications after the initial quiet backfill.
- Improved confirmed market sale freshness by bypassing cached BitJita sell-history and trade responses for the notification-driving importer.


## [0.29.0-beta.18] - 2026-06-30

### Added

- Added a user-controlled opt-out for Discord direct messages about confirmed market sales.

### Fixed

- Fixed app update Discord announcements so rebuilding the same beta version does not repost the same update.

## [0.29.0-beta.17] - 2026-06-30

### Changed

- Removed Discord market new-listing alerts so the bot only handles confirmed market sales.
- Added a confirmed-sale delivery mode so market sale alerts can be sent to a Discord channel or directly to verified linked sellers without channel fallback.


## [0.29.0-beta.16] - 2026-06-30

### Fixed

- Fixed the production background worker so a brief SQLite startup lock is retried instead of leaving Discord notifications and collectors stopped.
- Fixed fatal worker startup crashes so systemd treats them as failures and restarts the worker instead of leaving it inactive.


## [0.29.0-beta.15] - 2026-06-30

### Changed

- Improved Discord notifications so worker-collected events are queued, retried, and delivered quickly by the background worker instead of depending on long request paths.
- Improved Discord notification routing so raw Discord channel IDs and named channel selections work consistently across craft, market, YouTube, supply, and app update notifications.

### Fixed

- Fixed Discord notification tests in the admin console so they use the same sender path as real notifications and show the actual sent, skipped, or failed result.


## [0.29.0-beta.14] - 2026-06-30

### Changed

- Improved YouTube Monitor announcements so each monitored channel can use its own Discord destination while falling back to the default announcements channel.
- Clarified that existing YouTube videos are seeded as already seen when a channel is added, so only future uploads are announced.

### Fixed

- Fixed legacy YouTube announcement channel selections showing as a broken dropdown option.


## [0.29.0-beta.13] - 2026-06-30

### Fixed

- Fixed YouTube Monitor channel selection so any synced Discord channel can be used for video announcements.
- Fixed Discord app update announcements so worker-side scheduled checks recover missed release notifications after deploys.


## [0.29.0-beta.12] - 2026-06-30

### Added

- Added a Discord bot YouTube Monitor for announcing new videos from configured YouTube channels without requiring a YouTube API key.


## [0.29.0-beta.11] - 2026-06-30

### Changed

- Improved watchtower details so the popup opens in the visible browser area and member lists can be filtered by empire rank.


## [0.29.0-beta.10] - 2026-06-30

### Changed

- Added weighted regional settlement scores to the Region rankings, prioritising tier, supplies, treasury, and tiles with hover details explaining the formula.
- Improved watchtower details so the popup stays in the visible viewport and shows all empire members with their latest login status.


## [0.29.0-beta.9] - 2026-06-30

### Changed

- Added more browser notification sound choices and fixed the volume slider so 100% fills the full track.
- Improved admin diagnostics and background collection settings so long logs and collector controls stay inside their cards.
- Improved production contributor names so settlement-owner crowns stay aligned with the player name.


## [0.29.0-beta.8] - 2026-06-30

### Changed

- Changed the dashboard market income chart to show cumulative tracked sales over time, including flat days without sales.
- Improved admin tab navigation spacing so the grouped controls stay compact.
- Improved production contributor lists so all contributors wrap into compact rows instead of stretching cards vertically.


## [0.29.0-beta.7] - 2026-06-30

### Changed

- Improved the admin console layout with grouped navigation, clearer tab descriptions, safer action tooltips, and empty states for admin lists, audit history, and backups.


## [0.29.0-beta.6] - 2026-06-30

### Fixed

- Fixed dashboard refresh failures so recent collector data is shown as stale fallback data when BitJita cannot be reached after a server restart.


## [0.29.0-beta.5] - 2026-06-30

### Fixed

- Fixed the dashboard market income chart so it loads the monitored-market sales history already shown on the Market analytics page.

## [0.29.0-beta.4] - 2026-06-30

### Changed

- Updated the dashboard summary cards to show current treasury and confirmed monitored-market income history instead of construction and treasury trend cards.

## [0.29.0-beta.3] - 2026-06-30

### Changed

- Moved market-listing sync and production contribution sync out of snapshot-history recording into separate worker collector phases with their own schedules and status tracking.


## [0.29.0-beta.2] - 2026-06-30

### Changed

- Split snapshot recording into a short settlement snapshot write followed by separate market-listing and production sync phases, reducing how long worker transactions hold the SQLite writer lock.


## [0.29.0-beta.1] - 2026-06-30

### Changed

- Added resumable worker budgets for storage activity and member market-trade imports so expensive collector work continues across runs instead of scanning every building or member in one pass.
- Added worker budget environment controls for storage activity and market trade import batch sizes and runtimes.


## [0.28.0-beta.13] - 2026-06-29

### Added

- Added a separate production worker service for polling, history imports, scheduled jobs, and Discord background work.

### Changed

- Changed production startup so the public web service serves requests without running expensive background collectors in the same process.
- Increased the default snapshot-history collector interval and added SQLite snapshot indexes to reduce repeated API and database load.
- Added SQLite busy-timeout startup pragmas so concurrent web and worker database access waits briefly instead of failing immediately.


## [0.28.0-beta.12] - 2026-06-29

### Changed

- Improved release-readiness structure by moving more SQLite schema, default settings, owner bootstrap, release metadata, and scheduled-job logic into focused tested server helpers.
- Improved browser notification reliability by scoping signed-in deal-alert deduplication per user and documenting the remaining live-source verification checks.
- Improved public-release CSS and UX safeguards for shared sort controls, app chrome controls, and Public Craft Finder actions.
- Updated README, developer, notification, and release-readiness documentation with current verification evidence and remaining live-source blockers.


## [0.28.0-beta.11] - 2026-06-29

### Changed

- Improved release-readiness structure by moving Discord OAuth flow decisions into a focused tested server helper.
- Updated developer and release-readiness documentation with the latest OAuth helper boundary and verification evidence.


## [0.28.0-beta.10] - 2026-06-29

### Changed

- Improved release-readiness structure by moving DB-backed session lookup, Discord OAuth config, and OAuth state secret handling into focused tested server helpers.
- Documented the `/bot` notification exception as an accepted release decision and updated release-readiness verification evidence.


## [0.28.0-beta.9] - 2026-06-29

### Changed

- Improved release-readiness structure by moving legacy password hashing and admin sign-in throttling into focused tested server helpers.
- Updated developer and release-readiness documentation with the latest password-auth and login-attempt helper boundaries.


## [0.28.0-beta.8] - 2026-06-29

### Changed

- Improved release-readiness structure by moving admin/app session policy and Discord OAuth state handling into focused tested server helpers.
- Updated developer and release-readiness documentation with the latest auth helper boundaries and verification evidence.


## [0.28.0-beta.7] - 2026-06-29

### Changed

- Improved BitJita proxy reliability with tested cache TTLs, request deduplication, timeout handling, and stale-if-error fallback.
- Improved release-readiness structure by moving admin permissions, public user payloads, admin mutation guards, and auth identity helpers out of the production server into focused tested modules.
- Updated developer and release-readiness documentation with the latest server helper boundaries and verification evidence.


## [0.28.0-beta.6] - 2026-06-29

### Changed

- Improved release-readiness stylesheet ownership by moving Production and Public Craft Finder selectors into page-owned CSS modules.
- Renamed reused command/filter styling primitives to neutral `command-filter-*` classes and added guard coverage to prevent page-specific names returning.
- Updated release-readiness and developer documentation with the latest CSS ownership boundaries.


## [0.28.0-beta.5] - 2026-06-29

### Added

- Added live-source notification verification guidance for production queue changes and signed-in market deal alerts.

### Changed

- Improved browser notification reliability by keeping market activity, deal-alert, and production queue sources in a tested app-level source queue.
- Updated release-readiness documentation with the current live-source notification blockers.


## [0.28.0-beta.4] - 2026-06-29

### Changed

- Improved release-readiness structure by moving the admin console and user settings dialog out of the app shell.
- Added focused admin display helpers and boundary tests so release-critical shell responsibilities stay easier to review.
- Expanded notification verification coverage for every routed page and supported browser notification type.


## [0.28.0-beta.3] - 2026-06-29

### Changed

- Improved release-readiness structure by removing the legacy main page bundle after moving Production and Market into dedicated page modules.
- Split Market price finder and buy-order finder tools into focused market-owned components.
- Updated developer and release-readiness documentation with the latest page and market tool boundaries.


## [0.28.0-beta.2] - 2026-06-29

### Changed

- Improved release-readiness structure by moving Inventory, Map, and Public Craft Finder pages out of the legacy main page bundle.
- Moved shared active-region loading and labels into a tested hook so page components no longer own duplicate region helper logic.
- Updated developer and release-readiness documentation with the latest page boundaries.


## [0.28.0-beta.1] - 2026-06-29

### Changed

- Improved release-readiness structure by moving routed Leaderboard and Production page styles into focused page-owned stylesheets.
- Reduced duplicated browser helper code in the main page bundle by reusing shared analytics and URL query helpers.
- Updated developer and release-readiness documentation with the latest page-helper and stylesheet boundaries.


## [0.27.0-beta.9] - 2026-06-28

### Changed

- Improved release-readiness structure by moving scheduled job, market activity, production activity, and recipe catalog helpers out of the production server into focused tested modules.
- Updated developer and release-readiness documentation with the latest server helper boundaries.


## [0.27.0-beta.8] - 2026-06-28

### Added

- Added a tested release notification matrix covering routed pages, supported browser notification types, and the intentional bot-dashboard exception.

### Changed

- Improved release-readiness structure by moving request-body parsing, rate limiting, visitor IP privacy helpers, and Empires page styles into focused modules with tests where applicable.
- Updated developer and release-readiness documentation with the latest server, notification, and stylesheet boundaries.


## [0.27.0-beta.7] - 2026-06-28

### Changed

- Improved release-readiness structure by moving HTTP response, cookie, request-origin, and CSRF helpers out of the production server into focused tested modules.
- Updated developer and release-readiness documentation with the latest server helper boundaries.

### Fixed

- Confirmed admin settings responses keep submitted Discord bot tokens redacted while preserving configured-token status.

## [0.27.0-beta.6] - 2026-06-28

### Changed

- Improved release-readiness structure by moving market listing, best-seller sorting, production craft, and activity-log helpers into focused page utility modules.
- Updated developer and release-readiness documentation with the latest page-helper extraction boundaries.


## [0.27.0-beta.5] - 2026-06-28

### Added

- Added focused server route-group tests and helper coverage for visitor logging route classification.

### Changed

- Improved release-readiness structure by moving shared app chrome styles and route classification helpers into focused modules.
- Documented the remaining public-release browser notification and server architecture verification gaps.

### Fixed

- Fixed notification toasts appearing behind the floating help control and added browser sound helper coverage.


## [0.27.0-beta.4] - 2026-06-28

### Changed

- Improved browser notification settings reliability by normalizing saved toast and sound preferences before account sync, UI rendering, and sound playback.
- Moved browser user-settings styles into a focused stylesheet so settings, account-linking, and theme-editor rules are easier to maintain.

### Fixed

- Fixed corrupted or outdated browser notification settings from disabling important notification gates or selecting invalid sound/volume values.

## [0.27.0-beta.3] - 2026-06-28

### Changed

- Improved notification reliability by centralising market, deal alert, production craft, toast stack, and notification log handling in tested helpers.
- Moved notification-specific UI rules into a focused stylesheet and documented the styling boundary for future release work.

### Fixed

- Fixed duplicate persisted notifications replacing newer entries by ensuring the newest matching notice wins before the notification log is capped.


## [0.27.0-beta.2] - 2026-06-28

### Added

- Added maintainer documentation covering the current app structure, data flow, notifications, styling conventions, and release-readiness blockers.
- Added focused tests for extracted notification, activity, map, market analytics, and member identity helpers.

### Changed

- Improved release-readiness structure by moving notification, activity, map, market analytics, and member identity logic into clearer focused modules.
- Expanded the example environment file with the app's local, production, BitJita, Discord, background task, and GeoIP settings.
- Documented browser notification smoke coverage for market listing and sale alerts across the main app pages.

### Fixed

- Fixed admin-role access to user-management routes while keeping viewer-level users blocked.


## [0.27.0-beta.1] - 2026-06-28

### Changed

- Improved large-page performance by caching heavy player, passive craft, and production craft helper responses with background refresh and stale-data indicators.

### Fixed

- Reduced duplicate BitJita and local helper work during overlapping refreshes to avoid 502s on API-heavy pages while preserving last known good data.

## [0.26.0-beta.3] - 2026-06-27

### Fixed

- Improved live stability during BitJita outages by serving recent cached data where possible, deduplicating heavy empire scans, and logging slow or failed requests with more detail.

## [0.26.0-beta.2] - 2026-06-27

### Added

- Added clickable watchtower coordinates and watchtower access details on the Empires page.

### Fixed

- Fixed Empires watchtower scans timing out by returning partial or cached data when BitJita is slow.


## [0.26.0-beta.1] - 2026-06-27

### Added

- Added an Empires page with regional empire overview and claimed watchtower scouting tools.

## [0.25.0-beta.2] - 2026-06-26

### Added

- Added optional notification sounds with selectable tones, preview, and volume controls in user settings.

### Changed

- Enabled the Alert Pop notification sound by default for new browser settings.
- Reworked the local smoke server health check so the launcher returns reliably during frontend testing.


## [0.25.0-beta.1] - 2026-06-26

### Changed

- Redesigned the Market Analytics best sellers section as a visual leaderboard with ranking controls.
- Hardened the local smoke server workflow so frontend testing can reuse the running server without unreliable restarts.


## [0.24.0-beta.4] - 2026-06-23

### Fixed

- Fixed live server restarts caused by transient BitJita network timeouts in background tasks.
- Improved BitJita timeout logging and preferred IPv4 upstream connections on the VPS.


## [0.24.0-beta.3] - 2026-06-23

### Changed

- Improved page switching performance by aborting stale page refreshes and avoiding unnecessary production data requests on non-production pages.

## [0.24.0-beta.2] - 2026-06-23

### Changed

- Added per-item deal watch thresholds so users can choose how far below average a watched market item must be before alerting.

## [0.24.0-beta.1] - 2026-06-23

### Added

- Added Discord-linked Market Deal Watchlists so users can watch Price Finder items for below-average regional sell listings.
- Added scheduled deal scanning, in-app deal alerts, and best-effort Discord direct messages for watched market items.

### Changed

- Added admin controls for deal watch limits, alert thresholds, minimum confirmed sale baselines, and Discord direct message alerts.

## [0.23.0-beta.1] - 2026-06-21

### Fixed

- Fixed corrupted footer punctuation in the main app footer.


## [0.22.0-beta.1] - 2026-06-20

### Changed

- Improved the admin background collection settings with clearer wording and a less crowded layout.


## [0.21.0-beta.7] - 2026-06-19

### Changed

- Slowed the top refresh progress animation so refresh cycles feel less distracting.


## [0.21.0-beta.6] - 2026-06-19

### Fixed

- Fixed the top refresh progress line causing a brief horizontal scrollbar during refresh cycles.


## [0.21.0-beta.5] - 2026-06-19

### Changed

- Added a subtle top-edge refresh progress line while keeping the sidebar as the main refresh status indicator.


## [0.21.0-beta.4] - 2026-06-19

### Changed

- Improved page switching performance by briefly reusing recently loaded page data while live refreshes continue normally.
- Removed the floating page refresh notice so refresh state is shown only in the sidebar.


## [0.21.0-beta.3] - 2026-06-19

### Changed

- Improved the profession focus card with tier-coloured level pills, rank markers, and a compact tier distribution view.


## [0.21.0-beta.2] - 2026-06-19

### Fixed

- Added BitJita request timeouts so slow production refreshes fail gracefully instead of leaving the page stuck refreshing.


## [0.21.0-beta.1] - 2026-06-19

### Changed

- Updated the professions page so adventure skills use the same sortable table layout as professions while remaining in a separate section.


## [0.20.0-beta.4] - 2026-06-18

### Removed

- Removed the public `/wiki` knowledge base, related API endpoints, generated wiki data setup, route handling, page component, and styles after the feature caused app instability.


## [0.20.0-beta.3] - 2026-06-18

### Changed

- Redesigned the public wiki into a player-facing game wiki with guide cards, searchable item, cargo, recipe, profession, and output-reference entries.
- Improved wiki generation so it built friendly pages from the newest available local game data tables instead of exposing raw cached recipe JSON.


## [0.20.0-beta.2] - 2026-06-18

### Added

- Added a public BitCraft server mechanics guide with source-backed notes on claim treasury, crafting XP, gathering, loot, research, market state, and unconfirmed mechanics.
- Added a public `/wiki` knowledge base with admin-editable guide pages and generated recipe/output reference entries from local discovery data.


## [0.20.0-beta.1] - 2026-06-18

### Changed

- Updated project documentation to reflect current BitJita API reliability notes, Discord-backed admin login, deployment guidance, and the live BitJita proxy data model.
- Refactored the frontend app shell so the entrypoint, navigation, theme, settings defaults, analytics, and helper logic are split into focused modules for easier maintenance.

### Fixed

- Fixed the BitJita refresh issue banner so it renders as an opaque overlay above page content.


## [0.19.0-beta.1] - 2026-06-17

### Changed

- Restored main app pages to refresh live BitJita data through the local proxy instead of using SQLite current-state tables for page display.
- Clarified Admin collector wording so background collectors are described as history and notification support rather than the source of live page data.


## [0.18.0-beta.1] - 2026-06-16

### Fixed

- Fixed in-app notifications so market listing and sale toasts are detected from a dedicated background feed instead of only firing after opening the Activity page.


## [0.17.0-beta.11] - 2026-06-15

### Fixed

- Fixed inventory rows that only expose a BitJita tag, such as berries and meat, so the tag is shown as the item name instead of `Unknown item`.


## [0.17.0-beta.10] - 2026-06-15

### Fixed

- Fixed inventory item names so BitJita display metadata on inventory slots is preserved in the local inventory table.


## [0.17.0-beta.9] - 2026-06-15

### Fixed

- Fixed Regional Buy Order sale baselines so stale empty bucket rows are cleaned up instead of staying in the database.
- Improved Regional Buy Order sale baselines to store compact price-stat metadata instead of raw empty bucket dumps.


## [0.17.0-beta.8] - 2026-06-15

### Fixed

- Fixed Regional Buy Order opportunity baselines so cargo buy orders use the same BitJita price-history endpoint as Price Finder.
- Improved Regional Buy Order opportunity baselines to use BitJita's 7-day average sale price when available.


## [0.17.0-beta.7] - 2026-06-15

### Fixed

- Fixed Regional Buy Order sales baselines so stale buy orders from old region scans no longer create zero-value sale averages for unrelated regions.
- Fixed Regional Buy Order sales baselines so empty BitJita sale-history responses are not saved as confirmed sale averages.


## [0.17.0-beta.6] - 2026-06-15

### Changed

- Improved Regional Buy Order sale baseline scheduled-job progress so Admin shows checked, saved, failed, and current-item details while the job runs.

### Fixed

- Fixed slow BitJita sale-history requests blocking the whole Regional Buy Order sale baseline job by timing out individual item lookups and continuing with the remaining items.
- Fixed BitJita refresh issue banners so they overlay the page instead of shifting dashboard content down.


## [0.17.0-beta.5] - 2026-06-15

### Fixed

- Fixed Regional Buy Order sale baselines so completed item baselines appear while the scheduled job is still running.
- Fixed the page refresh indicator so it no longer shifts page content down during background updates.


## [0.17.0-beta.4] - 2026-06-15

### Changed

- Reduced Regional Buy Order collector load by scanning only the monitored settlement region every 30 minutes.
- Moved Regional Buy Order sales baseline refreshes into a separate daily scheduled job.


## [0.17.0-beta.3] - 2026-06-15

### Changed

- Added clearer page refresh indicators so users can see when data is updating in the background.
- Improved Admin refresh, collection, endpoint check, and scheduled-job buttons with visible busy states during slow actions.


## [0.17.0-beta.2] - 2026-06-15

### Changed

- Added live collector progress details to the sidebar Last Refresh hover panel and Admin collection status while refreshes are running.
- Reduced repeated regional buy-order sales baseline lookups by reusing cached 7-day sale averages for longer between collector runs.
- Normalised compact money summary cards to show `K`, `M`, and `B` without an extra gold suffix.


## [0.17.0-beta.1] - 2026-06-15

### Changed

- Improved the Admin loading screen animation and reduced visual clutter while administrator access is being verified.
- Fixed sidebar Last Refresh spacing so the label and timestamp no longer run together.


## [0.16.0-beta.8] - 2026-06-14

### Changed

- Changed the Map resource category filter to use BitJita resource tags directly instead of broad grouped categories.


## [0.16.0-beta.7] - 2026-06-14

### Fixed

- Fixed the Region page missing live region details when BitJita returns a settlement region name without a numeric region id.
- Fixed the Map resource category filter only showing exact-match categories such as Stone by grouping BitJita resource tags into the app's broader resource categories.


## [0.16.0-beta.6] - 2026-06-14

### Changed

- Split major main-app pages and shared interface pieces into focused frontend modules to make future page work safer to maintain.
- Improved page data resilience so local page views keep the latest successful data when one refresh domain temporarily fails.


## [0.16.0-beta.5] - 2026-06-14

### Fixed

- Fixed duplicate market notifications and stale notification timestamps when listing events were reprocessed.


## [0.16.0-beta.4] - 2026-06-14

### Fixed

- Fixed the Admin database browser hiding columns after the first ten fields.


## [0.16.0-beta.3] - 2026-06-14

### Added

- Added search, row count controls, and pagination to Admin recent security events.


## [0.16.0-beta.2] - 2026-06-14

### Fixed

- Fixed existing SQLite databases not receiving newer current-state table columns during startup migration.


## [0.16.0-beta.1] - 2026-06-14

### Fixed

- Fixed the research current table staying empty by storing BitJita research responses that use the `technologies` field.


## [0.15.0-beta.22] - 2026-06-13

### Fixed

- Fixed page data being cleared when a partial BitJita refresh failed, so pages keep showing the latest successful local data during API blips.


## [0.15.0-beta.21] - 2026-06-13

### Added

- Added ipapi.co as a cached server-side GeoIP provider so visitor location statistics no longer require large local GeoIP imports.
- Added Admin controls for choosing ipapi.co, local GeoIP database mode or disabled GeoIP lookup, plus configurable provider cache retention.

### Changed

- Changed the GeoIP refresh job to skip local downloads when ipapi.co provider mode is active.


## [0.15.0-beta.20] - 2026-06-13

### Fixed

- Fixed oversized legacy GeoIP JSON fallback files being loaded into memory during normal app startup and visitor lookup.


## [0.15.0-beta.19] - 2026-06-13

### Fixed

- Fixed MaxMind GeoLite2 City imports exhausting Node memory by storing imported IP ranges in SQLite instead of a large JSON lookup file.


## [0.15.0-beta.18] - 2026-06-13

### Changed

- Improved MaxMind GeoLite2 City imports so GeoIP refreshes process only the required CSV files and show clearer progress while running.


## [0.15.0-beta.17] - 2026-06-13

### Changed

- Changed manual scheduled-job runs to start in the background so long GeoIP refreshes no longer leave the Admin page waiting for the request to finish.

### Fixed

- Added visible GeoIP refresh progress details while scheduled jobs are running.


## [0.15.0-beta.16] - 2026-06-13

### Fixed

- Fixed scheduled jobs staying stuck as running after a server crash or timeout.


## [0.15.0-beta.15] - 2026-06-13

### Fixed

- Fixed background polling and GeoIP download failures being able to take the local server offline.


## [0.15.0-beta.14] - 2026-06-13

### Changed

- Changed the Admin session-loading animation to remain visible briefly before entering the console.


## [0.15.0-beta.13] - 2026-06-13

### Added

- Added MaxMind GeoLite2 City CSV ZIP support for scheduled local GeoIP refreshes using separate account ID and license key fields.
- Added an animated Admin session-loading screen.

### Changed

- Improved Admin GeoIP configuration wording and masked saved MaxMind license keys in settings/database views.


## [0.15.0-beta.12] - 2026-06-13

### Added

- Added server-side visitor security logging with short-term full IP retention, anonymised IP/hash storage and Admin reporting.
- Added optional local GeoIP lookup support and a scheduled GeoIP database refresh job for approximate visitor location statistics.

### Changed

- Documented visitor security logging separately from optional analytics cookies.


## [0.15.0-beta.11] - 2026-06-13

### Changed

- Changed normal page data loading to prefer dedicated SQLite current tables instead of the raw domain payload cache.
- Improved current-table population for members, player details, inventory, construction, production, research, region and market data.

### Fixed

- Fixed member permission columns in the database browser showing zeroes when BitJita reports permissions using non-boolean field shapes.
- Fixed construction current data so material requirements, added materials and storage coverage follow the same logic as the construction page.


## [0.15.0-beta.10] - 2026-06-13

### Changed

- Changed the first-visit analytics consent prompt into a blocking modal with clearer anonymous usage-tracking wording.
- Rotated the analytics consent storage key so users are prompted again after the wording change.

### Fixed

- Fixed the Admin database browser showing stale rows when switching tables quickly.


## [0.15.0-beta.9] - 2026-06-13

### Changed

- Improved the Admin database browser with table stats, clearer search, and export actions.
- Improved Admin configuration timing controls so interval units are explicit.
- Improved BitJita endpoint check results with summary stats and a readable sortable table.

### Fixed

- Fixed sidebar last-refresh spacing so the label and timestamp no longer overlap.
- Fixed Admin being interrupted by the full administrator-session loading screen during normal display refreshes.


## [0.15.0-beta.8] - 2026-06-13

### Added

- Added SQLite-backed domain current tables for claim, members, players, professions, production, inventory, construction, research and region data.
- Added page-ready local endpoints under `/api/local/pages/:page` so normal app pages read the latest server-collected data locally.
- Added configurable per-domain collector settings in Admin, including enabled state and collection interval.
- Added domain change event storage for meaningful server-detected changes such as member and production state changes.

### Changed

- Changed automatic page refreshes to read server-held SQLite domain data instead of rebuilding pages from a single cached settlement-state blob.
- Changed server collection to refresh due domains independently and reuse recent local domain data for domains that are not due yet.
- Updated project documentation to describe the server-owned domain-table refresh architecture.

### Removed

- Removed the legacy `current_claim_state` all-in-one cache table and its fallback usage.


## [0.15.0-beta.7] - 2026-06-13

### Added

- Added a sidebar refresh hover panel showing when each server collector last updated.

### Fixed

- Fixed online members showing "Playing 0m" when BitJita reports them online without a usable session timestamp.


## [0.15.0-beta.6] - 2026-06-13

### Added

- Added server-owned settlement refresh caching so browsers read the latest server-held BitJita data instead of each tab refreshing BitJita independently.
- Added collector status metadata and Admin controls for separate display refresh and server collection intervals.

### Changed

- Improved the BitJita refresh issue banner so it stays compact and preserves page spacing.
- Changed main app pages to use local server-held app data for automatic refreshes, reducing browser-driven BitJita request fan-out.
- Changed server collection to preserve the latest successful settlement data when BitJita refreshes fail.

### Fixed

- Fixed server collection using short-lived production cache during manual polls, so changed craft data is not masked by cached production responses.


## [0.15.0-beta.5] - 2026-06-13

### Added

- Added sortable column headers to shared app data tables.

### Changed

- Changed offline Leaderboard current-session values to show a dash instead of "Unavailable".


## [0.15.0-beta.4] - 2026-06-13

### Fixed

- Fixed the Leaderboard Online/Sessions tab showing members as offline because it was not loading player-detail status data.


## [0.15.0-beta.3] - 2026-06-13

### Added

- Added Leaderboard tabs for Contribution, Professions, Activity, Market, and Online/Sessions settlement comparisons.
- Added BitJita total played and total signed-in values to the Leaderboard Online/Sessions tab when player detail data provides them.


## [0.15.0-beta.2] - 2026-06-13

### Changed

- Improved Craft Calculator recipe route selection with clearer route cards and route-type labels.
- Changed Craft Calculator defaults to prefer normal processing recipes over unpack/package routes when multiple recipe routes are available.


## [0.15.0-beta.1] - 2026-06-13

### Changed

- Moved Map URL diagnostics out of the public Map page into a new Admin Diagnostics tab for future troubleshooting tools.
- Changed the Dashboard online member card fallback from "Session active" to a clearer playtime unavailable label.
- Removed the Craft Calculator calculation notes panel to reduce clutter when multiple recipe options exist.


## [0.14.0-beta.10] - 2026-06-12

### Changed

- Improved Map player tracking diagnostics and prevented temporary player-detail failures from emptying the member roster used by the map.


## [0.14.0-beta.9] - 2026-06-12

### Added

- Added editable schedules for Admin scheduled jobs, including daily, weekly and monthly run options.
- Added Admin member tracking controls so specific claim members can be hidden from member-derived app pages while remaining visible for re-enabling in Admin.
- Added Activity search across the full stored settlement history instead of only the recent loaded event window.

### Changed

- Improved BitJita refresh issue banners with expanded diagnostics, loaded data counts, page context and copyable troubleshooting logs.

### Fixed

- Fixed the Admin database browser returning to the Status tab after refreshes by persisting the selected Admin tab.


## [0.14.0-beta.8] - 2026-06-12

### Added

- Added direct recipe materials to Craft Calculator so users can compare immediate recipe inputs with fully expanded source materials.
- Added a technical application overview covering current architecture, pages, data flow, integrations, security, and risk areas.


## [0.14.0-beta.7] - 2026-06-12

### Added

- Added a reusable scheduled-jobs system with an Admin status panel for viewing, enabling, disabling and manually running background jobs.
- Added a local recipe catalog cache used by Craft Calculator, with a daily midnight job to refresh known recipe records from BitJita.

### Changed

- Changed Craft Calculator recipe expansion to use locally cached recipe details where possible instead of repeatedly fetching each recipe directly from BitJita.

### Fixed

- Made Craft Calculator ingredient lookups more resilient to BitJita rate limits by caching recipe details, reducing lookup bursts, and treating failed child ingredients as source materials instead of failing the whole plan.


## [0.14.0-beta.6] - 2026-06-12

### Changed

- Changed local BitJita proxy rate limiting so cached and deduplicated responses do not count as new upstream request pressure.

### Fixed

- Fixed Admin and Activity no-poll pages clearing the last good BitJita data snapshot during navigation.


## [0.14.0-beta.5] - 2026-06-12

### Changed

- Reduced avoidable BitJita polling while viewing Admin and increased the local BitJita proxy rate-limit ceiling for normal dashboard refresh workloads.

### Fixed

- Improved HTTP 429 refresh warnings so local rate limiting is easier to distinguish from upstream BitJita issues.


## [0.14.0-beta.4] - 2026-06-12

### Added

- Added Discord-backed administrator access with `red463` seeded as the default owner admin by Discord ID.

### Changed

- Replaced the Admin sign-in and administrator management UI with Discord account approval instead of separate app passwords.


## [0.14.0-beta.3] - 2026-06-12

### Changed

- Removed the visible "not syncing" suffix from active-region dropdown labels.
- Updated Production's active/paused state to recognize craft progress that moves during refreshes, while keeping contribution recording limited to BitJita contribution data.


## [0.14.0-beta.2] - 2026-06-12

### Added

- Added a shared active-region source backed by BitJita region status data, including admin fallback IDs for temporary seasonal regions.

### Changed

- Updated Map, Market tools and Public Craft Finder region selectors to use the shared active-region list instead of stale hardcoded region IDs.


## [0.14.0-beta.1] - 2026-06-12

### Changed

- Reworked the floating utility buttons into a compact footer-aware dock with clearer icon contrast and tidier notification badges.
- Reworked the Construction page into a clearer gather-first view with compact material rows, project filters and a consolidated missing-materials list.
- Moved Admin out of the main sidebar into the floating utility dock and User Settings to keep normal navigation focused on player-facing pages.
- Hid Admin shortcuts from the floating dock and User Settings unless an administrator session is active.
- Removed the listed-time helper notice from Market listings to reduce visual clutter.

### Removed

- Removed inactive pin/watchlist controls from Production, Market pricing and Browser Settings until a visible pinned-items surface is rebuilt.


## [0.13.0-beta.3] - 2026-06-11

### Changed

- Updated toast notifications to use the current dashboard-style colours and show item thumbnails with tier-coloured borders when item data is available.
- Changed Construction progress bars to show material contribution completion instead of build effort progress.
- Reworked the main sidebar into grouped collapsible sections to reduce navigation clutter.
- Added a sidebar Discord sign-in link and changed the first-visit sign-in prompt to use the same direct OAuth link as User Settings.
- Removed the visible Quick Find button from the sidebar while keeping keyboard command search available through Ctrl+K.
- Added an in-app BitJita data warning banner when refreshes fail or production craft details only partially update.
- Improved BitJita HTTP error messages so temporary API failures are shown as readable app alerts instead of raw endpoint errors.


## [0.13.0-beta.2] - 2026-06-11

### Fixed

- Updated Leaderboard cards and filter controls to match the current dashboard-style card surfaces and metric styling.
- Renamed the Leaderboard summary metric from Recorded Progress to Recorded Contribution.


## [0.13.0-beta.1] - 2026-06-11

### Added

- Added a Contribution Leaderboard page that records observed settlement craft contributions by member and profession.
- Added a first-visit Discord sign-in prompt so users can link their character and save server-side preferences when Discord login is enabled.

### Changed

- Grouped utility pages under a Tools flyout in the sidebar.
- Reworked Browser Settings into focused sections for account, theme, preferences, and local data.
- Added endpoint-specific BitJita proxy cache policies so stable catalog data is cached longer while live settlement data stays short-lived.
- Added a server-side Dashboard data aggregate so the Dashboard loads its live BitJita bundle through one local endpoint instead of many browser proxy requests.
- Moved dashboard/member/map player detail loading behind one cached local endpoint to reduce browser request fan-out.
- Consolidated local history polling onto the main app refresh cycle to avoid duplicate background timers per page.
- Added an Admin setup checklist and a clearer Discord bot workflow summary to make setup gaps easier to find.
- Improved admin success/error feedback and changed destructive admin/bot actions to require typed confirmation.
- Added a focused Phase 6 stylesheet module for setup, workflow and mobile shell polish.
- Updated local development and agent documentation for the current maintained app and smoke-server workflow.

### Fixed

- Fixed duplicate Discord craft-start notifications when BitJita reports the same active craft with a different current crafter.
- Fixed the sidebar Tools menu visibility, changed it to an overlay so it no longer compresses the sidebar, and moved Browser Settings navigation to top tabs so the dialog no longer stays oversized on short sections.

### Removed

- Removed historical Replit export artifacts from the active workspace.


## [0.12.0-beta.1] - 2026-06-10

### Fixed

- Fixed duplicate Discord craft-start notifications when BitJita changes a craft entity ID, Discord delivery is skipped or fails, or a craft briefly disappears from polling.


## [0.11.0-beta.2] - 2026-06-09

### Changed

- Improved the main app footer spacing, support button styling, and sidebar collapse animation.


## [0.11.0-beta.1] - 2026-06-09

### Added

- Added a Market Buy Order Finder tab for finding active regional buy orders by item, with best price, total demand, total value, and order details.
- Added a Craft Calculator page that uses BitJita recipe data to calculate source materials and step-by-step crafting chains.
- Added recipe route selectors to the Craft Calculator when BitJita exposes multiple valid recipes for an output or intermediate material.

### Fixed

- Fixed the Buy Order Finder region filter so returned buy orders are locally filtered to the selected region even if the API returns a broader result set.
- Fixed Craft Calculator source-material chains for items whose production recipe is exposed through BitJita output-helper items, such as wood logs from trunks.


## [0.10.0-beta.3] - 2026-06-08

### Fixed

- Fixed the footer support button so it renders reliably without depending on the third-party Buy Me a Coffee embed script.


## [0.10.0-beta.2] - 2026-06-08

### Changed

- Switched the repository license from PolyForm Noncommercial to AGPL-3.0-only and added explicit notice/trademark guidance for attribution and branding.
- Added a Buy Me a Coffee support link to the main app footer.
- Replaced the plain footer support link with the embedded Buy Me a Coffee button configuration.


## [0.10.0-beta.1] - 2026-06-08

### Changed

- Updated Market live listings to label the per-item amount as Unit Price and show a separate Total Price column for the full listing value.


## [0.9.0-beta.6] - 2026-06-07

### Added

- Added Void, Ocean, and Crimson browser theme presets.

### Changed

- Updated the Violet browser theme description to avoid research-specific wording.


## [0.9.0-beta.5] - 2026-06-07

### Changed

- Continued Phase 4 frontend modularization by moving shared formatting, item/equipment normalization, owner labels, browser persistence hooks, badges, item displays, metric components, API polling hooks, and app data normalization into focused modules.
- Moved the Members, Professions, Construction, Research, Region, and Sync views into dedicated page modules and removed the dead legacy Overview implementation from the main app shell.


## [0.9.0-beta.4] - 2026-06-07

### Added

- Added private settlement crafts to the Production page when BitJita returns them through member craft data, with private craft badges and a browser setting to hide them.

### Fixed

- Fixed Production current-crafter chips so member names and counts render as one clean pill.


## [0.9.0-beta.3] - 2026-06-07

### Changed

- Improved BitJita proxy performance by sharing duplicate in-flight API requests and using a bounded short-lived cache for repeated frontend refreshes.
- Reduced local history polling from three separate browser requests to one combined endpoint for market, activity, and snapshot history.
- Reduced BitJita player-detail fan-out by only loading per-member online/session details on Dashboard, Members, and Map pages where that data is displayed.
- Reduced local history polling payloads by loading market history only on the Market page and trend snapshots only on the Dashboard while keeping activity notifications available everywhere.
- Reduced main BitJita refresh fan-out by loading heavier settlement endpoints only on the pages that display them, while keeping shared claim, member, and craft data available for app-wide shell features and production notifications.
- Limited browser snapshot writes to the Dashboard page so snapshots are recorded only when the full snapshot inputs are loaded.
- Capped paginated BitJita listing and region fetches to avoid large bursts of simultaneous requests while preserving complete results.
- Capped Production passive-craft member lookups to avoid refreshing every member request at once while preserving the same passive craft results.
- Moved Dashboard activity summaries and treasury net calculations server-side so non-Activity pages can refresh with smaller local history payloads.
- Split Discord bot dashboard sections into lazy-loaded chunks so ordinary app pages download less admin-only UI code up front.
- Reduced background local-history polling on non-Activity pages while keeping Activity and Market refreshes more responsive.
- Capped player-detail and craft-contribution refreshes to avoid large simultaneous BitJita request bursts while preserving per-item fallback behavior.
- Capped market sale/cancellation reconciliation checks during polling so closed or changed listings no longer trigger unbounded BitJita trade-history lookups.
- Reduced non-Activity local-history payload sizes while keeping the full retained history available on the Activity page.
- Split production frontend bundles into dedicated vendor chunks for React, icons, and other dependencies so repeat visits can reuse cached framework code.
- Capped combined local-history activity limits server-side so oversized history requests cannot create unnecessarily large database reads.
- Added a cached local Map catalog endpoint so resources and creatures load through one reusable server-side aggregation instead of separate browser BitJita requests.
- Capped pinned market watch price-history refreshes so watchlist items no longer request every tracked market price at once.
- Moved settlement member passive-craft summaries behind one cached local endpoint so the Production page no longer makes a separate browser BitJita request for every member.


## [0.9.0-beta.2] - 2026-06-07

### Security

- Added administrator roles and route-level permission checks for settings, data export, backups, analytics, linked accounts, Discord management, Discord moderation, and administrator account management.
- Preserved existing administrator access by migrating current admin users to the Owner role.

### Changed

- Added role selection and role editing to the Admin Console administrator management screen.


## [0.9.0-beta.1] - 2026-06-07

### Security

- Added baseline browser security headers for API, static frontend, file download, branding, and BitJita proxy responses.
- Added route-specific request body limits so oversized public and admin requests are rejected predictably.
- Added route-class rate limiting for auth, Discord OAuth, analytics, Discord interactions, BitJita proxying, region lookups, and local snapshot collection.
- Hardened Discord OAuth state cookies with a server-side HMAC signature to reject tampered callback state.

### Fixed

- Improved oversized request handling so rejected bodies return `413` instead of a generic server error.


## [0.8.0-beta.8] - 2026-06-06

### Changed

- Improved Production controls spacing so member, sorting, and crafter filters align cleanly.
- Redesigned Construction project cards to make required materials, storage, and missing quantities easier to scan.
- Standardised Market tools layout so Live Listings, Analytics, and Price Finder keep a consistent height.
- Improved Admin status card spacing to better match the updated dashboard styling.

### Added

- Added crown styling beside the monitored settlement owner's member name where that user appears in the app.

### Fixed

- Prevented crown styling from being applied to owners of other settlements in regional views.


## [0.8.0-beta.7] - 2026-06-06

### Fixed

- Fixed Discord character-link selection so member names are shown and submitted instead of raw player IDs.


## [0.8.0-beta.6] - 2026-06-06

### Added

- Added optional Discord sign-in for app users.
- Added Discord-to-character link requests with admin approval from the Admin page.
- Added Discord mod-log notifications when users request a character link review.
- Added signed-in account settings save/load so users can keep browser preferences on the server.

### Security

- Kept Discord OAuth client secrets server-side through environment or app secret storage instead of exposing them to the browser.


## [0.8.0-beta.5] - 2026-06-06

### Added

- Added Custom theme controls for page-gradient stop positions and gradient height.

### Changed

- Expanded Custom theme import, export, and saving so all preset-controlled theme settings are preserved, including gradient shape values.


## [0.8.0-beta.4] - 2026-06-06

### Added

- Added browser-local theme import and export controls so users can copy, download, share, and restore theme JSON.
- Added a saved Custom theme preset so users can switch between built-in presets and their own saved theme.

### Changed

- Improved the browser-local theme editor with clearer labels, a collapsible advanced editor, a closer app preview, and dedicated page-gradient controls.
- Expanded the browser-local theme editor with card surface, card heading, metric value, icon background, active highlight, active border, and hover border controls.
- Changed the theme editor entry point so the Custom preset opens the advanced theme controls instead of using a separate Edit Theme button.

### Fixed

- Fixed theme controls so the sidebar colour and advanced colour inputs update the actual rendered app surfaces.
- Fixed Dashboard and shared KPI cards so theme changes affect card gradients, card titles, metric values, icons, active states, and hover borders.
- Fixed browser-local themes so shared main-app cards, filters, tables, controls, and page panels outside Dashboard also consume the selected theme colours.


## [0.8.0-beta.3] - 2026-06-06

### Added

- Added a browser-local theme editor to User Settings with presets, grouped colour controls, live preview, and reset-to-default.

### Removed

- Removed the Admin Theme tab so theme changes are user-specific rather than server-wide.


## [0.8.0-beta.2] - 2026-06-06

### Changed

- Restyled the main app sidebar to match the new Dashboard visual language.
- Standardised main app page backgrounds on the new black-to-charcoal gradient.
- Adjusted sidebar brand sizing so the current settlement name fits without removing truncation for longer names.
- Made the main app background gradient consistent across short and long pages by fixing the lighter section to the top of the viewport.

### Fixed

- Fixed the Dashboard treasury chart so it uses daily snapshots and no longer draws vertical spike charts from clustered refresh samples.


## [0.8.0-beta.1] - 2026-06-06

### Changed

- Restyled the Inventory page with the new Dashboard visual language, including a Dashboard-style topbar, summary cards, compact filters, polished core material cards, and cleaner container panels.
- Improved the Inventory filter panel so dropdowns have clear labels, search fields use a cleaner single-surface style, and the non-empty toggle no longer dominates the filter area.
- Restyled the Public Craft Finder page with the new Dashboard/Production visual language, including summary cards, a compact filter panel, and a cleaner results table.
- Restyled the Construction page with the new Dashboard visual language, including summary cards, a cleaner gather-next panel, and elevated project cards.
- Restyled the Research page with the new Dashboard visual language, including summary cards, labelled filters, and cleaner completed/available research lanes.
- Restyled the Market page with the new Dashboard visual language, including a trade-focused topbar, summary cards, cleaner filters, richer analytics panels, and a polished Price Finder.
- Restyled the Region page with the new Dashboard visual language, including a compact topbar, elevated rank cards, equal-height regional context panels, and a cleaner rankings table.
- Restyled the Map page topbar, player filters, resource finder, and map frame colours to match the new Dashboard visual language.
- Restyled the Sync page shell with the new Dashboard-style topbar and background while preserving the embedded board.
- Restyled the Activity page with the new Dashboard visual language, including summary cards, clearer filters, and a more polished timeline feed.
- Restyled the Admin page and its tabs with the new Dashboard visual language, including the console shell, tab bar, cards, forms, metric cards, tables, and list rows.
- Restyled the floating Settings, Updates, and Help controls and their popups to match the new Dashboard visual language.
- Filtered treasury and supply-only entries out of the Dashboard recent activity card so it stays focused on other settlement activity.

### Fixed

- Fixed Market Price Finder layout stretching so switching tabs no longer enlarges the header, KPI cards, or tool panel.


## [0.7.0-beta.6] - 2026-06-05

### Changed

- Refined the Production page command controls into a compact panel and updated active craft card headings to match the Dashboard heading style.


## [0.7.0-beta.5] - 2026-06-05

### Changed

- Updated Dashboard, Professions, and Production card headings to use the same compact Dashboard heading style while retaining section icons.


## [0.7.0-beta.4] - 2026-06-05

### Fixed

- Fixed top-right metadata spacing on the Production and Professions pages so tier badges no longer crowd their labels.
- Cleaned up the Production passive craft table row background so it no longer shows an unintended gradient band.


## [0.7.0-beta.3] - 2026-06-05

### Changed

- Restyled the Production page around the new Dashboard visual language with elevated KPI cards, cleaner production controls, richer craft cards, and a polished passive craft section.


## [0.7.0-beta.2] - 2026-06-05

### Changed

- Restyled the Professions page to match the new Dashboard and Members visual language while preserving tier colours in the professions table.


## [0.7.0-beta.1] - 2026-06-05

### Fixed

- Shortened Dashboard region wealth values to compact million notation.
- Fixed the Dashboard treasury trend axis so it shows a seven-day timeline instead of repeating the same date label.

### Changed

- Restyled the Members page around the new Dashboard visual language with elevated summary cards, cleaner roster rows, and a darker command-centre surface.


## [0.6.0-beta.4] - 2026-06-04

### Changed

- Removed the old Overview page from main navigation so Dashboard is the single home page.
- Redirected old Overview and Buildings page URLs to Dashboard to avoid stale or broken entry points.


## [0.6.0-beta.3] - 2026-06-04

### Added

- Added a new Dashboard page as the default home page, styled separately from the existing Overview page to more closely match the supplied command-centre mockup.

### Changed

- Updated the main navigation and default page setting so new sessions open on Dashboard while the existing Overview page remains available.


## [0.6.0-beta.2] - 2026-06-04

### Changed

- Redesigned the main app Overview page into a denser settlement command-centre dashboard with KPI cards, supply, treasury, activity, online member, production, attention and settlement detail sections.
- Restyled Overview around a sharper blue-black dashboard palette inspired by the new mockup direction.
- Renamed the unclear market presence KPI to Trade Listings and kept the metric limited to current settlement listing counts.
- Added a real treasury trend chart powered by locally recorded settlement snapshots, with an honest empty state until enough snapshots exist.


## [0.6.0-beta.1] - 2026-06-04

### Changed

- Refactored main-app API parsing for supply runway and Construction project materials into tested shared helpers.

### Fixed

- Fixed Overview supply runway parsing so it accepts both documented and currently observed BitJita run-out field names.
- Added regression coverage for BitJita construction requirements, project contributions, stored inventory quantities, timestamp parsing and wrapped/direct API arrays.


## [0.5.0-beta.11] - 2026-06-03

### Added

- Added a stable local smoke-server launcher and agent instructions for browser testing on `http://127.0.0.1:18449/`.

### Fixed

- Matched the floating help button styling to the Settings and Updates action buttons.
- Fixed Construction project materials by reading BitJita's full consumed item/cargo requirement stacks instead of only already-added project materials.
- Fixed Construction material labels so project contributions and storage quantities are shown separately.
- Widened Overview hero metric sizing so the Online, Construction and Market labels no longer crowd or overlap.


## [0.5.0-beta.10] - 2026-06-03

### Changed

- Removed the Members table View column so member details open only by clicking a member row.
- Replaced the Professions sword icon with a graduation-cap icon in navigation and profession summary cards.
- Moved Browser Settings and Updates out of the sidebar into floating app action buttons.
- Added a collapsible Resource Finder panel on the Map page to free more space for the map.
- Reset the Resource Finder collapse preference so the Map page opens expanded by default after this update.

### Fixed

- Tightened Overview hero metric sizing to prevent the top-right metric labels from overflowing.
- Matched paired card heights on the Professions and Region pages for a cleaner layout.


## [0.5.0-beta.9] - 2026-06-03

### Removed

- Removed the main app Structures page, sidebar entry, default-page option, and related page-specific styling.

### Changed

- Redirected old Structures page links and saved browser/default-page settings back to Overview so existing users do not land on a blank removed page.
- Replaced the Overview Structures shortcut with a Construction shortcut.


## [0.5.0-beta.8] - 2026-06-03

### Changed

- Renamed Discord craft notification buttons from `Watch <profession>` to `Toggle <profession> Notifications` so the action is clearer after notifications are already enabled.

### Fixed

- Made Discord craft notification toggle buttons check the member's current server roles before adding or removing notification roles.


## [0.5.0-beta.7] - 2026-06-03

### Fixed

- Standardised Discord bot dashboard tab alignment so capped-width sections start from the same left edge instead of some tabs appearing centred and others left-aligned.


## [0.5.0-beta.6] - 2026-06-03

### Fixed

- Fixed Discord app-update notifications so they read the current Keep a Changelog version section and include actual release notes instead of a vague fallback message.
- Reduced long app-update note lists before sending to Discord, with a pointer to the full changelog when extra notes are omitted.


## [0.5.0-beta.5] - 2026-06-03

### Added

- Added Discord role-panel controls to hide the helper `Selection` / `Selections` embed section from self-assign role messages.
- Added a Discord welcome-flow control to hide the `Next step` embed section from welcome messages.


## [0.5.0-beta.4] - 2026-06-03

### Fixed

- Fixed Discord self-assign single-role panels so clicking an active option actually removes that role instead of only reporting it as removed.
- Made Discord self-assign role buttons check the member's current server roles before adding or removing roles, reducing stale interaction state issues.


## [0.5.0-beta.3] - 2026-06-03

### Changed

- Reworked the Discord bot Channels and Craft Watch pages into cleaner centred routing panels that match the Colour Roles layout.
- Tightened Discord bot moderation and role-manager card sizing for a more consistent 1080p desktop layout.

### Fixed

- Fixed the Discord notification settings footer so endpoint, slash command, token and delivery text no longer runs together.


## [0.5.0-beta.2] - 2026-06-03

### Changed

- Polished the Discord bot dashboard layout with clearer status cards, compact colour-role rows and theme-matched toggle controls.
- Collapsed Discord role-panel editors into readable expandable sections so the Role Panels page is easier to navigate.
- Improved bot dashboard mobile behaviour to avoid clipped setup controls on narrow screens.

### Fixed

- Fixed Discord bot setup status fields visually running together.
- Fixed broken emoji preset display in the Discord role-panel editor.


## [0.5.0-beta.1] - 2026-06-03

### Changed

- Refined the app-wide CSS tokens for more consistent card, input, focus, disabled and compact-control styling.
- Improved responsive behaviour for the main sidebar, bot dashboard navigation and map layout on desktop, tablet and mobile screens.
- Reduced visible refresh jitter by disabling row re-entry animations during background data updates.

### Fixed

- Fixed small-label readability, long-name wrapping and touch-target sizing across dense dashboard controls.
- Added stronger keyboard focus states and clearer scroll cues for wide tables and map resource lists.


## [0.4.0-beta.30] - 2026-06-02

### Fixed

- Fixed the Discord bot page rendering blank by removing hook-order-sensitive diagnostics calculations from the admin render path.
- Hardened Discord diagnostics log handling when the status payload is missing or not yet loaded.


## [0.4.0-beta.29] - 2026-06-02

### Fixed

- Fixed Discord app-update notifications by reading the server version from package metadata instead of a stale hardcoded value.
- Added release-key tracking for app-update announcements using version plus git revision when available, so deploys are not silently skipped after code-only changes.
- Tightened app-update delivery bookkeeping so a release is only marked announced after the Discord send succeeds.
- Audited Discord notification routing and filters for market, craft, supplies, scheduled reports, app updates and test notifications.
- Limited low-supply Discord alerts to one successful post per 24 hours while supplies remain below the configured runway threshold.
- Reworked the Discord diagnostics panel into readable cards with delivery counts and event-type filtering.


## [0.4.0-beta.28] - 2026-06-02

### Fixed

- Fixed Discord poll and RSVP button clicks failing with `formatNumber is not defined`.
- Scoped Discord bot action/report output to each dashboard tab so results no longer appear under unrelated sections.
- Reworked the Custom Commands tab so commands are always listed there and existing commands can be selected for editing.


## [0.4.0-beta.27] - 2026-06-02

### Fixed

- Fixed the Discord bot Posts & Events form so Poll, RSVP and Embed title fields no longer mirror each other while typing.
- Fixed Discord poll and RSVP button responses to show readable option names and live vote counts instead of internal option keys.
- Updated Discord poll and RSVP messages after button votes so the visible message counts stay current.
- Made Discord warnings send a member DM and staff mod-log message while recording delivery diagnostics for failed sends.
- Updated Discord AutoMod rule creation to send mod-notes alerts and clarified that Discord exempts Administrator and Manage Server users.
- Added a configurable Discord mod-log channel and routed moderation warning logs and AutoMod alerts through it.


## [0.4.0-beta.26] - 2026-06-02

### Added

- Expanded the Discord bot dashboard with Safety Rules, Member Records, Posts & Events, and Custom Commands sections.
- Added Discord moderation records for warnings, mod notes, case logs, member profile lookups and temporary bans.
- Added Discord-native safety tools for keyword auto-moderation rules, slowmode, channel lockdown and nickname format reports.
- Added Discord-only community tools for polls, event RSVPs, clean embed posting and custom slash command responses.


## [0.4.0-beta.25] - 2026-06-02

### Added

- Added a Discord bot moderation section with member timeouts, timeout removal, kicks, bans, unbans, channel message purges and ban-list lookup.
- Added clearer Discord moderation result cards and audit-log reasons so actions are easier to verify.
- Made Discord bot post/update controls more visually obvious across the bot dashboard.


## [0.4.0-beta.24] - 2026-06-02

### Added

- Added a persisted collapsible sidebar mode that switches the main navigation to an icon-only rail for more page space.
- Updated the sidebar brand to use the monitored settlement name and refreshed the Discord CTA icon/text.


## [0.4.0-beta.23] - 2026-06-02

### Changed

- Updated the Overview treasury card to show today's recorded treasury income, spending and net movement instead of an unsupported treasury runway.
- Colour-coded the Overview supply run-out date by runway health and tightened Overview production wording.
- Matched the Overview attention card height to the adjacent settlement details card.


## [0.4.0-beta.22] - 2026-06-02

### Changed

- Reworked Discord role cleanup, channel checks and inactive member reports into readable dashboard views instead of raw JSON.
- Reworked the Discord bot Tools tab with clearer report cards, posting tools and readable report output.
- Reworked the Discord audit log tool result into a readable activity list instead of raw JSON.


## [0.4.0-beta.21] - 2026-06-02

### Added

- Added Discord Gateway presence support so the Timbersteel Trade bot can appear online with configurable status text.
- Added the `/help` Discord slash command with app and feature-request links.
- Added Discord role-panel management for citizen/member, profession, event and timezone self-assign roles with reusable post/update controls.
- Added Discord welcome-flow controls for welcome messages, rules acknowledgement and starter-role assignment.
- Added Discord bot tools for audit logs, inactive member checks, role cleanup, channel permission checks, announcements, pinned info updates and scheduled events.
- Reworked the Discord bot dashboard navigation into a grouped sidebar so future bot features remain easier to find.
- Split Discord role tools into a dedicated Roles category and added a Role Manager tab for creating Discord roles from the app.
- Added emoji presets to Discord role-panel options so profession buttons can be configured without manually typing emoji.
- Reworked Discord role-panel options into cleaner cards with a Discord-style preview and expandable edit controls.
- Fixed Discord role member counts so failed member-list syncs are shown as unavailable instead of misleadingly reporting zero members.
- Cleaned up Discord notification setting fields so dropdowns and numeric inputs have consistent full-width sizing.


## [0.4.0-beta.20] - 2026-06-02

### Changed

- General bug fixes.


## [0.4.0-beta.19] - 2026-06-02

### Changed

- General bug fixes.


## [0.4.0-beta.18] - 2026-06-02

### Changed

- Added huntable animals to the map resource finder and aligned map resource categories with the BC Codex category set.
- Compactly redesigned the Discord colour-role editor and made colour selector buttons use consistent neutral Discord styling with emoji colour markers.


## [0.4.0-beta.17] - 2026-06-02

### Added

- Added Discord colour-role management with a dedicated bot dashboard tab, editable bot-created colour roles, selector-channel configuration and a button message that enforces one colour role per user.


## [0.4.0-beta.16] - 2026-06-02

### Changed

- Cleaned up the dedicated Discord bot dashboard with tighter overview cards, compact section navigation, balanced setup/status panels, denser channel/role grids, a clearer notification-test page, a rebalanced notification rules page and a more deliberate diagnostics layout.
- Improved Discord role manageability labels so roles explain whether the bot can manage them, whether they are integration-managed, or whether the bot role needs moving higher in Discord.
- Fixed Discord discovery so the app fetches the bot's guild member record by bot user ID, allowing role hierarchy checks to detect the bot's highest role correctly.


## [0.4.0-beta.15] - 2026-06-02

### Added

- Added a BitJita-powered resource finder sidebar to the Map page, with resource search, tier/category filters, region selection and resource tracking through BitCraft Map `resourceId` URLs while retaining default online-player tracking.
- Changed the Map page region selector back to a compact dropdown and expanded the map workspace so more of the viewport is used for the map and resource finder.


## [0.4.0-beta.14] - 2026-06-02

### Changed

- Reworked the Discord bot dashboard for 1080p desktop displays with a horizontal category bar and cleaner notification rule groups, while keeping the compact narrow-screen layout readable.


## [0.4.0-beta.13] - 2026-06-02

### Added

- Added Discord server discovery from the configured bot token, including channels, roles, members, role counts and bot role manageability checks.
- Bot dashboard channel and craft-watch role settings now use discovered Discord dropdowns instead of manual ID entry.
- Added a discovered role directory showing role colours, member counts and whether the bot can manage each role.


## [0.4.0-beta.12] - 2026-06-02

### Changed

- Reworked the Discord Bot Control dashboard into sectioned categories for setup, notifications, channels, roles, tests and diagnostics.
- Removed the duplicate save button from the bot setup card so bot settings rely on the floating unsaved-changes save bar.


## [0.4.0-beta.11] - 2026-06-02

### Added

- Added a dedicated Discord Bot Control dashboard available from `/bot` and `bot.*` hostnames for bot setup, notification rules, channel routing, role watches, test messages and diagnostics.

### Changed

- Moved Discord bot settings out of the main Admin Console tab list and linked Admin to the dedicated bot dashboard.


## [0.4.0-beta.10] - 2026-06-02

### Changed

- Discord craft notifications now include the craft tier and use the tier colour as the embed accent when available.


## [0.4.0-beta.9] - 2026-06-02

### Changed

- Craft Watch Discord button replies now clarify that alerts always ping the configured role and the button only toggles whether the user has that role.


## [0.4.0-beta.8] - 2026-06-02

### Changed

- Craft Watch Discord button replies now explain that clicking Watch again removes the notification role.


## [0.4.0-beta.7] - 2026-06-02

### Changed

- Craft Watch Discord button failures now return a private diagnostic message instead of Discord's generic interaction failure.
- Craft Watch role add/remove attempts are now recorded in the Discord diagnostics log.


## [0.4.0-beta.6] - 2026-06-02

### Changed

- Craft notification Watch buttons now toggle configurable Discord profession roles instead of storing local watch/mute settings.
- Craft notifications now ping the configured profession role when a matching alert fires.
- Added configurable craft notification role IDs to the Discord admin settings.


## [0.4.0-beta.5] - 2026-06-02

### Changed

- Simplified the Structures page into a basic overview of structures, categories and tiers, removing slot summaries and API detail controls.
- Sidebar navigation items now use real page links so they can be opened in new tabs with middle-click or Ctrl-click.


## [0.4.0-beta.4] - 2026-06-02

### Changed

- Discord craft-start notifications now use a configurable minimum time-present delay instead of a progress percentage threshold, defaulting to five minutes.


## [0.4.0-beta.3] - 2026-06-02

### Added

- Added Discord craft-watch buttons to craft notifications so users can watch or mute profession alerts.
- Added `/craftwatch list` and `/craftwatch clear` slash commands for personal craft watch management.


## [0.4.0-beta.2] - 2026-06-02

### Added

- Added dedicated `/terms` and `/privacy` pages for Discord application submission, linked from the in-app Legal & Bot Terms and Privacy popups.


## [0.4.0-beta.1] - 2026-06-02

### Added

- Added in-app Legal & Bot Terms covering the optional Discord bot, community-app status, data source disclaimer, and bot usage expectations.
- Added Discord bot data processing notes to the Privacy & Analytics dialog and README.


## [0.3.0-beta.23] - 2026-06-01

### Fixed

- The embedded map URL is now persisted per browser and only changed by explicit map actions, preventing normal app refreshes from reloading the map and wiping map-side filters.


## [0.3.0-beta.22] - 2026-06-01

### Fixed

- Map focus from Public Craft Finder is now stored per browser and reflected in the page URL, so refreshing the Map page keeps the selected settlement/location.


## [0.3.0-beta.21] - 2026-06-01

### Changed

- App update Discord notifications now include the current release notes from the changelog directly in the embed.


## [0.3.0-beta.20] - 2026-06-01

### Fixed

- Discord craft notification filters now calculate production XP from the same BitJita fields as the Production page, including `totalActionsRequired` and `progress`.


## [0.3.0-beta.19] - 2026-06-01

### Fixed

- Reused production fallback keys now reset craft-start notification state when a completed craft becomes active again.

### Changed

- Discord diagnostics now include production poll rows showing active crafts returned by BitJita, baseline state and known craft counts.
- Scheduled supply reports no longer flood diagnostics with routine "not due yet" skips every polling cycle.


## [0.3.0-beta.18] - 2026-06-01

### Added

- Added an Admin > Discord diagnostics console that records sent, skipped and failed Discord notification attempts with routing, thresholds, allowed crafters, payload context and Discord response details.
- Discord test messages, app update checks and scheduled supply reports now write diagnostic records as well as live notifications.


## [0.3.0-beta.17] - 2026-06-01

### Fixed

- Craft Discord notifications no longer require the default notifications channel when routing to profession channels.
- Craft-start notifications are no longer marked as delivered when Discord sending is skipped.
- App update Discord notifications are now included in the generic notification enablement checks.
- Craft notification skips now record a visible Admin reason, including allowed-crafter mismatches or missing crafter names.

### Changed

- Craft notification defaults are now 40,000 total XP and 1% start progress.


## [0.3.0-beta.16] - 2026-06-01

### Fixed

- App update Discord notifications now use the configured Updates channel instead of always posting to the default notifications channel.


## [0.3.0-beta.15] - 2026-06-01

### Changed

- Craft-start Discord notifications are now only marked as delivered after Discord accepts the message, so permission failures can be retried.
- Admin now shows the latest Discord notification delivery status, including channel errors such as missing access.


## [0.3.0-beta.14] - 2026-06-01

### Added

- Added a floating Admin save prompt that appears when settings have unsaved changes, with Save and Revert actions.


## [0.3.0-beta.13] - 2026-06-01

### Changed

- Simplified Admin > Discord so the channel list is the single place to configure Discord channel IDs, including profession craft channels.
- Reworked Discord notification settings into grouped cards to reduce clutter.
- Replaced checkbox styling across the app with theme-matched toggle switches.


## [0.3.0-beta.12] - 2026-06-01

### Added

- Added a scheduled Discord supplies report, defaulting to every three days in the configured mod-notes channel.
- Added a named Discord channel list and dropdown-based routing for market, supply, app update, and craft notifications.

### Changed

- Admin > Discord is grouped around bot credentials, channel configuration, notification routing, craft channels, and test previews.


## [0.3.0-beta.11] - 2026-06-01

### Added

- Discord craft notifications now have separate start and completion toggles.
- Added configurable Discord craft notification filters for minimum total XP, minimum start progress, and allowed crafter usernames.
- Added configurable per-profession Discord channel routing for craft notifications, with Timbersteel's current craft channel IDs as defaults.


## [0.3.0-beta.10] - 2026-06-01

### Changed

- Low-supplies Discord notifications now use configurable supply runway days, defaulting to alerts below seven days of supplies.
- Supply-change activity metadata now includes calculated runway, daily upkeep, and run-out time for more accurate Discord alerts.


## [0.3.0-beta.9] - 2026-06-01

### Added

- Optional Discord bot integration with admin-managed settings, protected bot-token storage, test-message sending, and slash command registration.
- Discord slash commands for settlement supplies, online members, active crafts, and item price checks.
- Discord notifications for new listings, confirmed sales, craft starts, craft completions, and optional low-supplies changes.
- Server-side production job tracking so craft start/completion events can be recorded consistently.


## [0.3.0-beta.8] - 2026-06-01

### Changed

- Member Toolbelt cards now use the shared colour-coded rarity badge.


## [0.3.0-beta.7] - 2026-06-01

### Changed

- Price Finder suggestions now mirror BitJita's available-item market filtering by hiding output/input pseudo-items and items with no buy or sell orders.
- Item rarity is now displayed as a consistent colour-coded badge across market, inventory, price finder and member equipment views.


## [0.3.0-beta.6] - 2026-06-01

### Changed

- Gear preset slot labels now match in-game terminology: Heart, Jewellery, Head, Hands, Torso, Belt, Legs and Feet.


## [0.3.0-beta.5] - 2026-06-01

### Changed

- Gear presets now render a curated set of visible in-game equipment slots, including empty placeholders, while still hiding unused/internal server slots.


## [0.3.0-beta.4] - 2026-06-01

### Changed

- Gear preset cards now show only equipped items instead of rendering BitJita's empty placeholder slots as visible equipment slots.


## [0.3.0-beta.3] - 2026-06-01

### Changed

- Replaced the manual local settings profile dropdown with automatic browser-specific settings.
- Pinned overview items, filters, density and notification preferences now persist in local browser storage without requiring analytics cookie consent.
- Added a browser settings reset action for clearing local app preferences without touching admin settings or settlement data.


## [0.3.0-beta.2] - 2026-06-01

### Changed

- Production activity now uses BitJita craft contribution timestamps and only marks a craft active when it was worked in the last 30 seconds.
- Overview production counts now use the same 30-second active-craft rule.
- Market listing tracking now preserves BitJita's original listing timestamp when available.
- Storage activity summaries now include the container name directly in deposit/withdrawal text.
- Research now surfaces settlement tier, supply cap, tile cap, and researched workstation tier unlocks from claim technology data.
- Region now shows live region status alongside online player and trade-volume data.
- Professions now prefer BitJita skill metadata when available instead of relying only on local static skill groupings.
- Price Finder now shows a simple confidence label based on available completed-trade count.


## [0.3.0-beta.1] - 2026-06-01

### Added

- Added browser-local User Settings for display density, notification preferences, selected profile, and profile-specific pinned overview items.
- Added a clear-filters action to the Map page and persisted player map selections.

### Changed

- Overview supply runway now uses the settlement's max-supplies research cap for the progress bar while keeping the days/hours runway text.
- Construction now separates item and cargo requirements, labels required materials versus settlement storage availability, and avoids item/cargo ID collisions.
- Activity now sorts by parsed event timestamps and keeps timeline markers vertically centered.
- Member gear presets now show empty reported slots instead of hiding them.
- Inventory search placeholders now clearly identify item and container search.

### Fixed

- Price Finder suggestions now hide BitJita output/input pseudo-items that are not valid market items.
- Member table rows are vertically centered for cleaner roster readability.


## [0.2.0-beta.6] - 2026-05-27

### Added

- Member details now load BitJita equipment presets and show each available gear preset rather than only the currently equipped set.
- Added BitJita item thumbnails for member toolbelt tools, gear presets, inventory rows, production craft titles and price-finder suggestions, with text fallbacks when an icon is missing.
- Added a footer disclaimer for Clockwork Labs affiliation/trademark status and BitJita API data attribution.
- Member details now always show both gear preset slots, including an explicit not-reported state when BitJita does not return gear for a slot.
- Corrected gear preset mapping so the current equipment appears as Preset 1 and BitJita's saved alternate preset appears as Preset 2.
- Gear preset detection now compares actual equipped item slots instead of trusting BitJita's active flag, so members with differently flagged alternate presets still show Preset 2.
- The member gear "Current" marker now follows BitJita's active preset flag when the saved alternate preset is the selected one.


## [0.2.0-beta.5] - 2026-05-27

### Changed

- Replaced the external Plausible integration with opt-in first-party usage analytics stored in the application's SQLite database.
- Added a cookie notice requesting development-supporting analytics consent, with equally accessible decline and persistent preference controls.
- Added an Admin Analytics dashboard for visitor, session, page-view, engagement-time and feature-usage aggregates.


## [0.2.0-beta.4] - 2026-05-27

### Added

- Optional cookieless Plausible analytics configured from Admin, disabled until an administrator enables it with a Plausible per-site script URL.
- Manual, sanitized section page views and anonymous high-level feature events for Market, Price Finder, Production filtering, member details, Public Craft Finder and Activity controls.
- A Privacy & Analytics dialog accessible from the footer and help panel that discloses tracking state and excluded data.


## [0.2.0-beta.3] - 2026-05-27

### Changed

- Renamed the Production passive-craft history panel to Member Passive Crafts and clarified that the API identifies the member, but not the settlement location where the craft occurred.


## [0.2.0-beta.2] - 2026-05-27

### Changed

- Storage movements are now collected by the background server poller and persisted in Activity history rather than fetched from every browser viewing Activity.
- Activity loads its locally stored feed every 10 seconds; its member selector roster updates separately without blocking timeline display.
- Admin endpoint diagnostics now identify response times for each settlement storage container, with storage sync status visible in Collection Status.


## [0.2.0-beta.1] - 2026-05-27

### Changed

- Redesigned Activity as a summary and timeline view with event counts, clearer filters and category styling.
- Storage deposit and withdrawal entries now show the settlement container nickname when one is configured, falling back to its structure name.
- Added an Activity member selector for filtering attributed storage and market events by settlement member.


## [0.1.0-beta.8] - 2026-05-26

### Fixed

- Activity storage movements are now loaded from the monitored settlement's known storage structures rather than each member's global storage history.
- Storage activity excludes deployable containers such as carts, wagons, boats, ships and goats.


## [0.1.0-beta.7] - 2026-05-26

### Fixed

- Price Finder recent trades now display buyers returned by BitJita's live price-history payload under `buyerUsername`, while retaining support for `purchaserUsername`.


## [0.1.0-beta.6] - 2026-05-26

### Added

- Overview watchlist for core materials, Price Finder items, and production crafts.
- Notification inbox retaining recent market and production alerts, with links back to the relevant page.
- Keyboard quick navigation (`Ctrl+K` or `/`) for pages, Price Finder, and settlement members.
- Compact/comfortable data density control for repeat monitoring work.
- Shareable URL state for current pages, Market context and Public Craft Finder filters.

### Changed

- Background refreshes now show a discreet refresh state and highlight changed dashboard values without replacing loaded views.
- Initial loading uses dashboard-shaped skeletons, with short page/modal transitions and more responsive table/row hover states.
- Active production jobs now have animated effort progress cues and can be pinned to Overview.
- Table controls and headers remain accessible while reviewing longer data sets.


## [0.1.0-beta.5] - 2026-05-26

### Added

- Market `Price Finder` tab with smart item search against the BitJita catalogue.
- Region-selectable pricing analysis, defaulting to the monitored settlement region with options for all regions or a specific region.
- Completed-trade price summaries for the last 24 hours, 7 days, and 30 days, plus recent trade evidence and total volume.
- Suggested whole-gold listing price based on the most recent available BitJita completed-trade average.

### Changed

- Price Finder now provides a populated region dropdown rather than requiring users to enter region IDs.
- The last visited page and Market tab are restored after refreshing the app.


## [0.1.0-beta.4] - 2026-05-26

### Added

- Historical confirmed-sale importing for current members' completed orders at the monitored settlement market, using BitJita order claim identity and completed trade fills.
- Dedicated `market_trades` persistence keyed by BitJita trade ID, so imported history is retained without duplication across polling runs.

### Changed

- Market Analytics now uses authoritative completed trade records for orders proven to belong to the monitored settlement market rather than importing unrelated member sales.
- On first successful collection for a member, completed sell orders belonging to this market are backfilled; later verified tracked sales are retained in the same trade history.
- Admin status now reports retained confirmed trades separately from listing lifecycle events.


## [0.1.0-beta.3] - 2026-05-26

### Fixed

- Market collection now retrieves every listing page before reconciling closures, preventing listings beyond the first API page from being incorrectly marked removed.
- Market analytics now aggregate confirmed sales from retained database history, including when filtering by settlement member.
- Sale confirmation handles split fills of a listing instead of requiring one trade to cover the complete removed quantity, and does not reuse earlier fills for later drops.
- Snapshot writes are serialized and keep BitJita network requests outside the SQLite transaction.
- Region ranking collection now uses paginated, cached server-side enrichment with bounded detail lookups rather than repeated browser fan-out.

### Security

- Administrator-changing requests now require a same-origin session request token, and production rejects browser-submitted snapshots.
- Password hashing no longer blocks the Node event loop, and session lookup uses SHA-256 token hashes. Existing signed-in sessions expire after this update and administrators must sign in again.
- Admin status no longer exposes the host filesystem path of persistent storage.

### Changed

- Removed the obsolete legacy admin panel implementation.
- Added regression tests for market pagination, production snapshot protection, and administrator cross-origin request rejection.
- Added baseline security response headers to the Caddy deployment example.


## [0.1.0-beta.2] - 2026-05-26

### Added

- Operational admin console with status, endpoint diagnostics, configuration, theme, database, user, audit and backup tabs.
- Validated logo and favicon uploads stored in the persistent data directory; the logo appears in the dashboard identity and Overview, and the favicon updates the browser tab.
- Multiple administrator accounts, account activation controls, password resets and session invalidation tools.
- Audit records for administrative actions and recorded sign-in attempts.
- Filtered SQLite table browsing, CSV/JSON exports, server-side backup creation/download and snapshot retention cleanup.
- Configuration controls for default page, Public Craft Finder region, browser refresh interval, snapshot retention and toast notification categories.

### Security

- Added per-address and username login throttling after repeated failed sign-in attempts.
- Branding uploads are limited to authenticated administrators, supported image types and a 1 MB size cap.


## [0.1.0-beta.1] - 2026-05-26

### Added

- Tier badges across settlement views using the in-game tier colour palette, with translucent presentation in badges and the Professions heatmap.
- Production sorting by tier, XP, remaining effort, completion, and item name, with ascending and descending options.
- Member-based Production eligibility filtering from the Production page.
- Member profile sections for public Toolbelt profession tools and equipped gear.
- Tool power display for public Toolbelt tools and eligible Production jobs.
- Browser persistence for key filter and sort selections across refreshes.
- In-app toast notifications for new market listings, confirmed market sales, and settlement craft queue starts/completions.
- Sortable Public Crafts columns for craft, tier, settlement, requirement, effort, XP, and owner.
- Settlement-wide passive craft output history beneath active Production, aggregated from public member records.
- Floating help access on every page, including the current app version and direct documentation, changelog, bug-report, and feature-request links.
- Beta/work-in-progress notice in the global help panel.

### Changed

- Production eligibility now checks the selected member's public skill level and matching Toolbelt tool type.
- Production tool eligibility follows the one-tier allowance: a T1 tool can perform T2 crafts, T2 can perform T3 crafts, and so on; tool power determines effort contributed per action.
- Public Crafts defaults to all skills while retaining the monitored settlement region as the initial region filter.
- The Production member selector now lives on the Production page instead of the sidebar.
- Public Crafts has been moved from the Production page into its own `Public Craft Finder` navigation page.
- Supply runway on Overview now uses the API run-out timestamp and displays days and hours.
- Overview treasury information now presents the treasury balance and supply upkeep without treating supply upkeep as currency expenditure.
- Overview, Structures, Research, and Region have revised operational layouts with clearer summary hierarchy.
- Member details can be opened by clicking anywhere on the member row.
- Member passive crafts now resolve recipe placeholders to item names and present grouped recent output summaries; traveler tasks are labelled Quests without the redundant level column.
- Inventory core material cards now count finished stock only and filter the visible container contents when selected.
- The former Skills page is now Professions: its primary summaries and heatmap use API-classified professions, with Adventure skills displayed separately.
- Profession heatmap headings now use full horizontal labels with wider sortable columns for readability.
- Profession summary columns have dedicated header sizing to prevent sort controls overlapping their labels.
- The Professions heatmap no longer creates an unnecessary vertical scrollbar; it scrolls horizontally only when required by the wider columns.
- Profession table columns were compacted to fit standard 1080p desktop widths without a horizontal scrollbar.
- Region now explains that the Close Settlements panel lists settlements nearest to the monitored settlement.
- Research no longer presents an active/in-progress technology because settlement technology unlocks are instant.

### Fixed

- Profession tools were incorrectly read from equipped hand slots; they are now sourced from the public Toolbelt inventory returned by the BitJita API.
- Selected-member Production cards no longer flash into a pending Toolbelt-check state during each background refresh.
- Passive craft recipe templates now resolve numbered placeholders such as tanning recipes returned as `Tan {1}`.

