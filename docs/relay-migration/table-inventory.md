# Relay migration SQL table inventory

This is the authoritative ownership and retirement inventory required by the
[live-first data policy](./live-first-data-policy.md). It is updated as each
vertical domain moves from BitJita to Relay.

The exact runtime-retired table list is maintained in
`src/server/schemaMigrations.mjs`. Startup deletes those tables idempotently;
integration tests set `RETIRED_TABLE_GUARD_TEST=true` after startup migrations
so the SQLite authorizer rejects any later read, write, or schema access with
the retired table name in its diagnostic.

Disposition values:

- `keep-current`: materialized or derived current state needed for indexed
  local reads, process sharing, atomic generations, or last-good recovery;
- `keep-history`: locally observed event/history data Relay cannot recreate;
- `keep-user`: user-owned configuration, identity, privacy, or moderation data;
- `keep-operations`: health, delivery, security, or maintenance data;
- `retire`: legacy ingestion/cache state with a proven replacement;
- `review`: ownership changes later in the migration and deletion is not yet
  safe.

| Tables | Disposition | Owner and update trigger | Migration decision |
|---|---|---|---|
| `domain_payload_current` | keep-current | Current-state repository; atomic Relay provider generation | Canonical provider-owned last-good boundary for normalized domains. Legacy periodic collectors no longer read or write it; reconciliation may consume a validated committed domain but cannot overwrite its Relay provenance, freshness, or generation. Inventory uses this table and adds no inventory-specific cache table; Craft Planner reads the same committed member and settlement-inventory generations directly. |
| `provider_source_health`, `provider_subscription_health` | keep-operations | Relay provider/runtime health events | Required for separate worker/web visibility, schema health, lag, and reconnect diagnostics. |
| `provider_transition_outbox` | keep-operations | Atomic provider-generation commit; acknowledged after idempotent transition-history application | Minimal crash-safe edge handoff between live current-state publication and ordered history/event writers. Regional market rows contain only changed-region order and new-closure deltas, not complete current snapshots; insertion order is the replay order, and malformed rows remain visible in runtime health. It contains no queryable current game state, is replayed immediately on process start, and replaces an unsafe memory-only retry queue rather than a scheduled ingestion job. |
| `game_catalog_entities`, `game_catalog_source_state`, `game_catalog_descriptions` | keep-current | Global typed subscription generation | Durable normalized Relay catalog and exact item/cargo enrichment source. Craft Calculator and Craft Plan target search query this continuously updated local index directly. Craft Planner workstation presets join building descriptions, construction recipes, and exact item/cargo identities here without an upstream page-load request or workstation cache table. This projection is retained for measured indexed joins, worker/web process sharing, and immediate restart recovery—not to reproduce a BitJita cache. |
| `game_catalog_recipes`, `game_catalog_recipe_inputs`, `game_catalog_recipe_outputs`, `game_catalog_recipe_sources`, `game_catalog_recipe_output_components` | keep-current | Global typed subscription generation | Indexed Craft Planner and item-detail read model. Crafting and extraction rows now replace atomically in the same live generation as catalog descriptions. |
| `game_catalog_item_list_outputs`, `game_catalog_item_lists`, `game_catalog_item_list_possibilities`, `game_catalog_item_list_possibility_outputs`, `game_catalog_resources`, `game_catalog_resource_completion_outputs` | keep-current | Global typed subscription generation | Required for exact probabilistic output and gathering calculations; now replaced atomically from live item-list/resource descriptions without an external download. |
| `game_catalog_probability_snapshot`, `game_catalog_probability_sources`, `game_catalog_effort_weights` | keep-current | Global subscription generation plus immediate catalog-derived calculation | Compact planner projections with measured benefit. A full live generation currently applies in about 474 ms in disposable SQLite; no scheduled freshness owner is justified. |
| `current_claim_state` | retire | None | Removed from existing clone databases. The generic Relay-owned `claim` generation in `domain_payload_current` is the only current claim summary and last-good source. |
| `recipe_catalog_entries` | retire | None | Removed from bootstrap and existing clone databases. `/api/local/recipe-detail` now composes the provider-neutral detail response directly from the continuously projected `game_catalog_*` catalog. |
| `game_catalog_refresh_runs`, `game_catalog_refresh_targets` | retire | None | Removed with the catalog crawl job, admin route, UI controls, recovery queue, repository methods, and prepared statements. Subscription generation/source health now owns catalog ingestion and restart recovery. |
| `settlement_state_current` | keep-checkpoint | Minimal restart-safe settlement transition baseline | Retained only so committed Relay `claim`, `members`, `inventories`, `market`, and optional `construction` generations can compare against the last transactionally applied summary after a restart. It is not a page/current-data cache: Relay generations remain authoritative, updates are queued immediately after commits, exact supplies/treasury are stored as TEXT, and no polling or browser writer owns this row. Building count remains nullable only until the first complete construction generation, which then drives structure transitions without blocking the four required settlement sources. |
| `market_listings` | retire | None | Removed from bootstrap and existing clone databases. Current Local Market, Dashboard, and leaderboard listing state is projected directly from the latest complete generic `market` generation. Listing transitions are derived from consecutive Relay generations and appended independently to history; they do not justify a duplicate current-state table. |
| `market_buy_orders_current`, `market_regional_sale_averages_current` | retire | None | Removed from bootstrap and existing clone databases. Configured regional sessions merge exact buy-order generations into the generic `regional-market` last-good domain, and the local view filters, sorts, pages, and enriches that committed generation without a second SQL mirror. Confirmed-sale averages and chart buckets derive on demand from durable `market_trades` within the explicit local observation window; no current average materialization is justified. Buy Order Finder qualifies premiums only from three or more authoritative same-region confirmed sales and a strictly positive exact premium. |
| `market_events`, `market_trades` | keep-history | Immediate normalized Relay order/closed-listing transitions | Required for locally observed charts, sold-versus-returned evidence, exact deduplication, and notification history. They are not current order-book storage. New Hex Coin closed rows confirm a sale only through a unique same-region, same-market, same-owner proceeds match; returned typed stacks confirm non-sales; ambiguous closures remain unresolved. Claim and regional sessions update both tables immediately after current publication, use TEXT amount affinity, and have no scheduled acquisition owner. The compact `provider_transition_outbox` is committed atomically with a changed current generation so a failed history write survives restart and replays idempotently. Overview movers query bounded recent history; selected-region/item price history uses the `(claim_id, region_id, item_id, item_type, occurred_at)` index before its row limit and exposes the progressive observation window instead of materializing another current/analytics table. Buy Order Finder performs a bounded exact seven-day on-demand read of authoritative same-region confirmed sales from `market_trades`; it never restores a scheduled cache or makes history a current-order render prerequisite. Existing Relay trade rows receive a one-time authoritative region backfill from their source identity/evidence. |
| `global_market_price_snapshots` | retire | None | Removed with the legacy `global_market_insights` scheduled job and cached overview setting. Market Browse, Overview, and Deals compose current orders directly from the committed `regional-market` generation plus the live catalog. Truthful price history derives on demand from durable, authoritatively confirmed local trade events and exposes its progressive observation window instead of maintaining a scheduled current-price mirror. |
| `activity_events` | keep-history | Normalized domain transitions; Relay storage-log events arrive from the 15-second live loop and deduplicate by region plus upstream log ID | Required for the Activity page and notification/audit history. Relay storage logs expire upstream, so this is durable history rather than a current-data cache. |
| `operational_history_market_trade_daily`, `operational_history_market_event_daily`, `operational_history_activity_daily` | keep-derived-index | Explicit operator-invoked, deletion-disabled rollup builder over bounded UTC days | Narrow daily report projections used only where aggregate-reader parity is proven. They contain no `raw_json`. A validated watermark is required before a reader combines a rollup with uncovered raw rows; unusable state after any partial prune fails closed. Regional per-trade price charts and actor-detail activity/member reports are not proven equivalent and their source tables are not approved for pruning. |
| `operational_history_source_ingestion_ids`, `operational_history_source_mutations`, `operational_history_rollup_watermarks` | keep-operations | Additive ingestion/mutation triggers and the rollup/prune transaction | Durable membership, mutation, source-fingerprint, coverage, and partial-prune evidence. Safe-positive ingestion IDs make late/backfilled rows visible independently of event time. Missing or invalid identity is diagnosed and kept on the raw path. Mutation and membership drift block pruning; a pruned unusable watermark makes report history explicitly unavailable rather than silently partial. |
| `operational_history_retention_runs`, `operational_history_backup_verifications` | keep-operations | Report-only retention previews and separately authorized production-backup verification | Audit evidence for previews, bounded prune attempts, and backup artifact validation. Runtime deletion remains disabled, the approved prune allowlist is empty, Admin and scheduled execution are dry-run only, and no live prune HTTP route exists. These rows do not by themselves authorize production deletion; owner/legal approval, reader parity, a verified production-root backup, a production baseline, and seven consecutive dry-run days remain external gates. |
| `production_jobs`, `production_contributions` | keep-history / keep-derived-index | Committed Relay craft lifecycle and immediate regional craft-progress transactions | `production_jobs` preserves lifecycle/notification history. `production_contributions` is the indexed contributor/craft aggregate used by interactive leaderboard and production reports; it increments in the same transaction as a new durable event receipt and is never refreshed by a schedule. Current craft state remains in normalized domains. |
| `production_contribution_events` | keep-history | Positive claim-scoped regional `progressive_action_state` transaction deltas | Minimal append-only evidence and replay-deduplication ledger keyed by Relay transaction, region, and craft. Exact progress/XP values use TEXT. This table is independently required to prevent reconnect/replay double counting and to support rebuilding the contribution aggregate; it is not a current-state cache. |
| `empire_hexite_sweeps`, `empire_hexite_sweep_empires`, `empire_hexite_targets`, `empire_hexite_sources`, `empire_hexite_snapshots` | retire | None | Removed from bootstrap and existing clone databases with the six-hour acquisition job. The target rows were sweep-owned work records rather than user configuration, and the snapshot table overwrote one current row per Empire rather than preserving history. Current Hexite data must publish from the committed Empire generation and future bounded inventory joins; any future observation history must be an append-only domain-event design. |
| `empire_membership_tracking`, `empire_membership_periods` | keep-history | Normalized empire membership transitions | Required for locally observed membership periods and analytics. Complete primary-region subscription generations update these rows immediately; the scheduled Empire membership acquisition job is retired. |
| `scheduled_jobs` | keep-operations | Registered maintenance, reporting, backup, retention, and delivery work | Keep the registry, but remove all retired current-data and game-evidence ingestion keys and controls. Market sales and craft contributions are subscription-driven. Current user-facing data remains live with scheduled work disabled. |
| `server_metric_buckets`, `server_health_incidents` | keep-operations | Runtime metric/health events | Required for soak evidence, lag/budget alerts, and operational diagnosis. |
| `admin_users`, `admin_sessions`, `user_accounts`, `user_sessions`, `user_legal_acceptances` | keep-user | Authenticated local requests and privacy workflows | User-owned identity/session/legal data; independent of game-data provider. |
| `app_settings`, `app_secrets` | keep-user | Authenticated admin configuration | Application configuration and secrets; independent of game-data provider. Retired `collector_settings_json` is deleted idempotently from existing clones and is neither seeded, returned, nor accepted by the Admin configuration API. |
| `craft_plan_settings` | compatibility | Automatic first-class plan migration | Retained as the legacy singleton cutover source; runtime reads and writes use `craft_plans`. |
| `craft_plans` | keep-user | Authenticated shared and personal plan edits | First-class named plans with scope, ownership, optimistic revision, primary selection, and independent configuration. Personal rows cascade with their owning account. |
| `craft_plan_config_audit` | keep-history | Successful authenticated Craft Plan persistence transactions | Append-only, redacted configuration history retained for the plan lifetime. Plan deletion removes its history; account deletion removes owned-plan history and anonymizes the deleted actor on surviving plans. |
| `craft_plan_route_reviews` | keep-user | Successful authenticated Craft Plan saves with reviewed ambiguous routes | Explicit confirmations and non-confirmed legacy-public baselines keyed by plan and exact typed output. Alternative-signature changes selectively invalidate affected evidence; plan deletion removes it and account deletion anonymizes retained reviewer identity. |
| `craft_plan_last_good_publications` | keep-checkpoint | Successful validated Craft Plan publication | One sanitized compressed latest-complete response per claim and plan, retained for restart-safe stale fallback over the plan lifetime. It is replaced only after a valid complete publication, never used to invent current source data, and removed with the plan or owning account. |
| `craft_plan_progress_audit_snapshots`, `craft_plan_progress_audit_events`, `craft_plan_progress_audit_causal_groups`, `craft_plan_progress_audit_state` | keep-history | Normalized planner state transitions | Required for 30-day detailed progress audit, deterministic causal grouping, checkpoint comparison, and restart continuity. Current game data is never reconstructed from these rows. |
| Selected-player inventory and housing state | no table | Bounded Relay entity-detail service; request with 15-second memory last-good | Members, Craft Planner, and its admin manager share the provider-neutral player-data service. Inventory and housing load only for a selected monitored member. No SQL current/cache table or scheduled refresh job is justified. |
| Current Town Bank personal inventories | no dedicated table | Two-stage primary-region typed subscription; generic `inventory-banks` last-good generation composed into the public `inventories` response | `bank_state` is claim-filtered before bounded `inventory_state.owner_entity_id` subscriptions open. Exact player/building ownership and Item/Cargo stacks publish immediately and invalidate the public Inventory page. The 2026-08-01 live proof loaded 25 personal inventories and 863 occupied stacks with zero warnings. |
| Browser page-navigation state | no table | In-memory last-rendered snapshot plus immediate provider-neutral local re-read | Domain pages reuse visible data only to avoid a blank transition; the browser snapshot never suppresses a current-generation read. Focused-route pages make no unused central request. The legacy endpoint map and response throttle are removed and do not justify SQL persistence. |
| Legacy browser proxy and dashboard/player/passive-craft/production helper responses | retire / no table | None | `/api/bitjita/*` and the four broad helper routes are removed with their in-process response caches and dead acquisition functions. Current pages compose from committed provider domains or focused provider-neutral local routes. No replacement SQL cache exists. |
| Discord supplies, online members, and active crafts | no table | Claim-fenced committed Relay claim/member/player/craft generations plus the local catalog | Operational commands read the latest complete generation immediately and preserve exact decimal-string IDs. Unavailable or partial inputs produce an explicit error rather than a zero, offline, or empty answer. Delivery history remains in the existing outbox tables; current command data is not copied into SQL. |
| Craft Plan save-time building reconciliation | no table | Claim-filtered committed construction generation | Plan saves reconcile buildings against the latest complete Relay projection. Unavailable data leaves targets pending and never falls back to an upstream fetch or a duplicate current-state table. |
| Barter stalls and current trade orders | no dedicated table | Bounded typed regional session plus generic `regional-market` generation | The adaptive regional market connection retains the bounded marker set but stages exact joins only for currently enabled stalls into trade orders, buildings, nicknames, locations, claims, and owners. Inactive markers do not delay the base order/closed-listing generation. `/api/local/market/stalls` filters, pages, and catalog-enriches the committed generation on demand. No BitJita response cache, stall diagnostic setting, or scheduled ingestion job remains. |
| Activity member-filter roster | no table | Current Relay `members` domain passed through `AppShell` | The Activity page shares the normal live member generation and no longer performs or persists a separate roster fetch. |
| Craft Calculator and Sync opening state | no table | Their focused local/browser-owned services | Neither page consumes the central settlement payload, so opening them starts no legacy claim/member request and requires no replacement current table. |
| Public Craft Finder current jobs and monitored-settlement context | no dedicated table | Typed bounded regional sessions plus current Relay `claim` domain | The adaptive pool uses indexed joins from `public_progressive_action_state` into live craft, building, nickname, and workstation-location rows, followed by bounded exact owner/claim enrichment, and commits one generic `public-crafts` generation to `domain_payload_current`. Settlement-totem location never blocks publication; the UI falls back to the exact workstation location. Global catalog rows enrich it at read time. There is no public-craft cache, pagination, refresh-run, or scheduled-ingestion table. |
| Adaptive regional connection state | no table | In-memory `AdaptiveRegionSessionPool` leases, health, hard cap, stagger, and idle sweep | Connection orchestration is ephemeral process state. A live two-session-cap proof preserved pinned region 19, rejected a third simultaneous connection, idle-closed region 3, and then rotated to region 7 after complete generations applied. Durable normalized generations remain in `domain_payload_current`; no session, lease, queue, or pagination table is justified. |
| Active-region population/control/name state | no dedicated table | Small typed global subscription plus generic `region` generation and persisted provider topology/subscription health | `/api/local/regions/active` composes the configured monitored/default/admin scope immediately from `region_population_info`, `region_control_info`, `world_region_name_state`, and operational health. Region-only events publish only this small domain and never rewrite the catalog projection. A throttled `provider_subscription_health` heartbeat exists only for worker/web visibility and reconnect diagnosis; it is not a data cache. The independently supervised subscription allows a bounded initial-apply grace, then reconnects with bounded jitter and fresh topology discovery. Claim changes fence every old claim-owned runtime before the new provider attempt. Arbitrary browser `include` values do not widen the configured scope, and browser last-good rows are keyed to the exact claim/scope. The BitJita calls and five-minute process cache are retired; no scheduled region ingestion or feature cache table is justified. |
| Regional claim rankings and current settlement metrics | no dedicated table | Region-scoped typed subscription plus generic `region-claims` generation | The regional database bounds `claim_state`, `claim_local_state`, and `building_claim_desc`; observed owner IDs then drive indexed point subscriptions to `player_username_state` because live Relay measurements proved grouped OR predicates can remain unapplied. A complete numbered generation publishes immediately and the Region page joins it to the global `region` metadata generation. The old `/api/local/region/claims` cache, `region` collector, `regionStatus`/`tradeVolume` payloads, and unsupported trade cards are retired. `domain_payload_current` is the only durable last-good copy; no ranking table or scheduled acquisition job is justified. |
| Current empire, watchtower, siege, settlement, and claim-member state | no dedicated table | Bounded typed regional sessions, exact-Empire-ID notification subscription, and generic `empires` generation | The primary regional session owns the replicated Empire/member identity graph. Every configured session uses `world_region_state` geometry to retain only its local settlement, node, chunk, siege, and claim-member rows; secondary sessions omit duplicate identity/player subscriptions. Complete generations publish immediately, per-source errors remain attached to their region, and removed scope is pruned before reconnect. Local routes compose views on demand and never wait for the retired membership scheduler. Current siege roles join the attacker to the node-owning defender. The existing global connection subscribes to notification state only for the exact settlement-owner, node-owner, and siege-attacker Empire IDs in committed configured regions, then retains only compact exact-paired outcomes in the generic last-good generation. Unmatched groups become one bounded availability warning plus structured diagnostics; the DTO reports `removed_or_unknown` and remains partial while cancellation is unavailable. Raw notification rows never enter SQLite. No siege cache, snapshot, sweep, work table, or scheduled acquisition job exists. |
| Current Empire Hexite reserve projection | no dedicated table | Immediate projection from committed regional Empire/inventory and global Foundry generations | The Empire treasury and completed `empire_foundry_state` Capsules are aggregated by exact Empire ID. Each existing regional pool session stages local Empire/claim discovery, filtered building/player targets, and filtered `inventory_state` rows; only compact non-zero Hexite contributions and coverage metadata enter the generic `empires` last-good generation. Missing regions or claims remain partial. No raw inventory mirror, Hexite cache, work queue, scheduler, or additional WebSocket connection exists. |
| `market_deal_watches` | keep-user | Authenticated deal-watch edits | User-owned alert configuration. Every committed `regional-market` generation evaluates enabled watches immediately on a best-effort path independent of ordered market-history persistence; the scheduled job is reconciliation only. The fresh clone stores the last exact baseline as text. |
| `market_deal_alerts` | keep-history | Live regional-order evaluation | Alert deduplication, acknowledgement, Discord delivery, and the exact baseline/listing evidence shown to the user. Exact quantity, price, total, and baseline projections use text affinity and the normalized evidence remains in `raw_json`. This is durable notification history, not a current-order cache. |
| Deal Watch current listings/baselines | no table | Current `regional-market` generation evaluated in process | The current regional sell-order median is calculated directly from exact typed live orders. No price-history crawl, scheduled baseline materialization, or Deal Watch current-state SQL mirror remains. |
| `admin_audit_log`, `admin_login_events` | keep-operations | Auth/admin security events | Security and accountability history. |
| `analytics_events` | keep-operations | Consent-gated local analytics | First-party operational/product analytics with existing retention. |
| `visitor_security_events`, `geoip_ranges`, `visitor_geoip_cache` | keep-operations | Visitor security and bounded GeoIP import/cache | Security subsystem; independent of game-data provider. |
| `discord_delivery_log`, `discord_notification_outbox`, `discord_craft_plan_report_occurrences` | keep-operations | Domain events, outbox claims, and delivery results | Required for record mode, deduplication, retries, and safe live delivery. |
| `discord_youtube_channels`, `discord_youtube_videos`, `discord_craft_watches` | keep-user | Authenticated Discord configuration and monitor observations | User-owned bot configuration and deduplicated monitor state. |
| `discord_mod_cases`, `discord_warnings`, `discord_mod_notes`, `discord_custom_commands`, `discord_component_votes`, `discord_component_messages`, `discord_temp_bans` | keep-user | Authenticated Discord moderation/community actions | Independent Discord feature state; not a game-data cache. |

## Default for remaining live domains

The remaining operational verticals begin with no dedicated current-state SQL
table. Their latest complete state belongs in the provider's in-memory
generation plus `domain_payload_current` for durable last-good recovery.

| Domain | Default SQL decision | Live update path |
|---|---|---|
| Construction | No dedicated table | Claim-filtered regional subscription; recipe/building enrichment from the continuously maintained global catalog |
| Research and recruitment | No dedicated table | Claim-filtered regional subscriptions with incremental catalog joins |
| Equipment, buffs, and player state | No dedicated table | Member-filtered regional subscriptions |
| Regional claim rankings | No dedicated table | Region-scoped claim/local/tier rows plus exact observed-owner subscriptions; generic `region-claims` last-good generation |
| Legacy claim layout payload | Retire | No replacement: static usage proof found no reader. Claim focus uses the live claim domain; Map player tracking uses live member/player IDs |
| Future in-app current locations | No dedicated table | Add bounded entity-filtered regional subscriptions only when a retained feature actually consumes coordinates |
| Current empire, watchtower, and siege state | No dedicated table | Bounded adaptive regional sessions; generic atomic `empires` last-good generation |
| Current Hexite deposit state | No dedicated table | Bounded Relay HTTP snapshot on the 15-second live loop with durable last-good recovery in `domain_payload_current` |
| Current market orders and listings | No raw mirror table by default | Order subscriptions and incremental transition handling |
| Current cross-region public crafts | No dedicated table | Bounded typed regional subscriptions through the adaptive session pool; normalized combined generation in `domain_payload_current` |

An implementation may retain or add a compact derived-current index only after
recording measured query cost, row count, indexes, restart cost, all readers
and writers, and the user-visible latency improvement. Its update trigger must
be a committed domain event, not a scheduled ingestion sweep.

For every remaining vertical, the implementation review starts by asking
whether each legacy table can be deleted while still meeting the local API,
restart, and outage budgets. If the answer is yes, the table and its schema,
prepared statements, job controls, diagnostics, and tests are removed in that
vertical. If the answer is no, the inventory must record the representative
benchmark and the event-driven writer that keeps the projection current.
“Waiting for the next scheduled run” is never an accepted reader or writer
path for current user-facing data.

## Inventory vertical evidence

- Browser source: `InventoryPage.tsx` contacts only provider-neutral local
  routes.
- Current state: `domain_payload_current` owns the Relay inventory generation.
- Enrichment: only stack keys present in the requested snapshot are resolved
  from `game_catalog_entities`.
- Item and cargo identities are separate (`items:<id>` and `cargo:<id>`).
- Quantities remain decimal strings and are summed/formatted with `BigInt`.
- Item detail is composed locally from `game_catalog_descriptions`; it does not
  fetch a BitJita detail route.
- No SQL table was added for the Inventory cutover.
- Town Bank ownership follows the proven
  `bank_state.building_entity_id -> inventory_state.owner_entity_id` edge in a
  two-stage primary-region subscription. The resulting generic
  `inventory-banks` generation is composed into the public Inventory response
  without changing settlement-stock or Craft Planner source semantics.
- The 2026-08-01 live verifier loaded 25 personal Town Bank inventories and
  863 occupied stacks with zero warnings. Selected-player claim-bank
  categories remain available through the bounded player-data service.
- No Town Bank, player-bank, crawl, refresh-ledger, or scheduled-ingestion SQL
  table was added.

## Settlement market current-state evidence

- A claim-scoped typed regional session continuously subscribes to
  `sell_order_state`, `buy_order_state`, and `marketplace_state`.
- Owner names are loaded in a second staged subscription containing equality
  filters only for owner IDs present in the current order generation.
- The live 2026-07-30 verifier returned 33 sell orders, zero buy orders, one
  marketplace, and zero warnings for Timbersteel Trade.
- Every row is checked against the configured claim and derived region before
  the generic `market` generation commits.
- Item and Cargo identities remain distinct and catalog enrichment happens
  locally.
- Local Market and Dashboard read this generic generation immediately; no
  market-specific current-state table or scheduled acquisition job was added.
- `market_listings` has been removed from schema bootstrap, prepared
  statements, admin inspection, scheduled collectors, runtime readers, and
  runtime writers.
- Consecutive Relay generations produce idempotent `new_listing`,
  `partial_quantity_drop`, and `removed_or_cancelled` events. The first
  generation is a baseline and does not emit notification spam.
- Event/history/outbox persistence is queued after the current generation
  commits. A persistence failure is reported through provider health but does
  not hold back or roll back live page data.
- Configured regional market sessions subscribe to `buy_order_state`,
  `sell_order_state`, and the naturally bounded `marketplace_state`, derive
  bounded claim and owner equality joins, and merge independently complete
  regions into the generic `regional-market` generation. Marketplace
  coordinates stay in that current generation rather than a duplicate SQL
  table.
- The regional buy-order view and Market Browse order books perform
  exact-decimal filtering, sorting, paging, and catalog enrichment directly
  over that generation. Market catalog search uses the continuously maintained
  `game_catalog_entities` index and joins current order counts in memory. No
  measured query cost justified another SQL current-state projection.
- `/api/local/market/catalog` and `/api/local/market/order-book` enforce the
  configured claim and active-region scope and return per-region
  freshness/last-good state combined with global catalog health. Catalog
  candidates are filtered by live order availability before the response
  limit is applied. `/api/local/market/price-history` reads only confirmed
  `market_trades` events, filters configured region and Item/Cargo identity,
  and derives progressive daily VWAP, volume, rolling statistics, and recent
  sales in memory. It reports `collecting` until an applicable sale is
  observed and always exposes `observedSince`; disappearing orders are never
  labelled as completed sales.
- `/api/local/market/overview` and `/api/local/market/deals` derive current
  liquidity, active-order hubs, open-order activity, and arbitrage directly
  from the same committed generation. Their browser views invalidate on
  `regional-market` and `catalogs` generation commits and preserve exact
  decimal strings through sorting and display. Deal-region selection is
  enforced before the bounded server projection, stale last-good responses
  retain their age/cause, and summary potential reports the best individual
  route rather than adding overlapping order capacity.
- Movers, price history, completed volume, and recent trades use only uniquely
  confirmed local sale events and explicitly expose their progressive
  observation window. Order-book map actions use live marketplace coordinates;
  Deals calculate same-region/same-dimension Manhattan distance and leave
  cross-region distance unknown. Current order state is not relabelled as
  historical activity, and no scheduled analytics table is introduced.
- The provider-neutral generation event stream invalidates an open Market
  Browse view immediately after commit, with a 750-millisecond local poll only
  as its fallback. Live order reads and optional history reads are independent,
  so history cannot delay or discard the current order book.
- The monitored region stays pinned. Additional configured regions rotate
  within the explicit connection cap on a provider-owned 15-second loop; this
  loop remains active when scheduled ingestion and reconciliation jobs are
  disabled. Each non-primary session remains in the pool until its first
  complete generation applies or a 30-second apply timeout expires.
- Disconnected sessions reconnect with 1/2/4/8/16/30-second jittered backoff.
  Failed claim/owner detail subscriptions clear their in-progress state and
  retry without replacing the last-good generation.
- Each committed region retains its own receive time. API freshness is derived
  from the selected region's age and live connection health, so a newer
  generation from another region cannot make old data appear fresh.
- Claim, primary-region, and configured active-region changes reconcile the
  runtime without requiring a process restart.
- `market_buy_orders_current` and `market_regional_sale_averages_current` have
  been removed from bootstrap, migrations, collectors, runtime reads/writes,
  and integration fixtures.
- `global_market_price_snapshots`, the `global_market_insights` scheduler key,
  and `global_market_overview_json` cache setting have been removed from fresh
  schema/runtime ownership and are deleted idempotently from existing clone
  databases.
- Opportunity scoring remains empty until an authoritative same-region sale
  signal is proven. Locally observed but region-ambiguous trades are not used
  to label a removed order as sold.

## Active/passive craft vertical evidence

- `domain_payload_current` owns the exact Relay craft snapshot; no craft-page
  cache table was added.
- The provider reads the claim-scoped incomplete and completed Relay filters in
  one refresh generation and deduplicates exact craft IDs.
- `game_catalog_descriptions` supplies passive classification, requirements,
  experience, and recipe/output metadata from the typed global subscription.
  The page projection performs indexed lookups only for recipe IDs present in
  the current snapshot; it does not scan or copy the full recipe catalog.
- The Production page no longer calls `/api/bitjita`,
  `/api/local/production/crafts`, or `/api/local/passive-crafts`.
- Craft Planner reads the same committed claim craft generation. It performs
  passive classification and configured tracked-player selection locally, so
  it makes no claim/member craft request fan-out and adds no planner craft
  cache table. Its process-memory calculation cache is generation-keyed and
  falls back to a five-second TTL, so a committed source change is visible on
  the next planner read without a scheduled rebuild.
- Craft Calculator and Craft Plan target search read the live-maintained
  `game_catalog_entities` index. Recipe trees compose direct and probabilistic
  item-list producer routes from the current normalized generation on demand;
  there is no search cache, recipe-detail cache, or scheduled rebuild.
- `production_jobs`, `production_contribution_events`, and the event-driven
  `production_contributions` report index retain lifecycle, replay protection,
  and locally observed contributor history; they are not the current page's
  source of truth.
- Craft contributor parity is supplied by positive regional progressive-action
  transaction deltas. Member Toolbelt eligibility remains explicitly
  unavailable until its regional subscription mapping is delivered.

## Member equipment and buff subscription evidence

- Professions and Leaderboard read the committed citizen/player generation
  directly through provider-neutral skill projections; no leaderboard or
  profession cache table exists.
- Current equipment, preset, and active-buff rows share
  `domain_payload_current` with the other provider domains.
- No equipment, preset, buff, or page cache table was added.
- Member-filtered player, equipment, preset, buff, and traveler-task
  subscriptions push changes immediately and swap `players` plus `equipment`
  in one repository generation. Traveler task descriptions are joined in that
  live regional session.
- Global equipment/buff descriptions remain in the existing indexed catalog
  read model. Toolbelt inventory and housing use one guarded provider-neutral
  selected-member request with separate 15-second memory last-good entries.
- The unused Market Collections request and the legacy Housing and Traveler
  Tasks browser calls are retired. No member-detail SQL table or scheduled
  refresh job was added.

## Construction vertical evidence

- `project_site_state.owner_id` was proven live to be the claim entity ID; the
  subscription is filtered to the configured monitored claim.
- Regional project stacks are normalized as exact contributed quantities and
  joined to authoritative global construction-recipe requirements.
- The Construction page is provider-neutral and combines the committed project
  generation with the existing live inventory generation.
- Global recipe, building, item, and cargo rows are resolved only for the
  projects/materials in the response.
- Claim-owned `building_state` rows publish in the same regional generation
  and drive Craft Planner workstation progress without another table or
  page-load fetch.
- `domain_payload_current` is the durable last-good boundary. No Relay
  construction table, refresh ledger, pagination state, or scheduled ingestion
  job was added.
- The legacy construction collector setting and BitJita writer were removed.
  Server fallback/background compositions now read the same normalized Relay
  projection. No independent construction notification/history rows existed
  to retain or migrate.
- Craft Planner no longer owns a legacy claim-buildings fetch. Any later
  retained feature that needs building coordinates may enrich these same
  filtered rows with bounded location data; it must not add duplicate
  current-state ownership.

## Research vertical evidence

- `claim_tech_state.entity_id` was proven live to be the claim entity ID; the
  regional subscription is filtered to the configured monitored claim.
- Learned, current, available, and locked states are derived immediately from
  the claim state and global `claim_tech_desc.requirements`.
- The browser Research page reads only `/api/local/game-data`; the route joins
  the live regional generation to the continuously maintained global catalog.
- `domain_payload_current` remains the durable last-good boundary. No Relay
  research table, refresh ledger, or scheduled research ingestion job was
  added.
- The legacy scheduled Research collector was removed so it cannot overwrite a
  newer Relay generation. Dashboard aggregates and Craft Planner tier presets
  now compose from the same committed Relay state and local global catalog.

## Recruitment vertical evidence

- `claim_recruitment_state.claim_entity_id` was proven live to be the owning
  claim ID; the regional subscription is filtered to the configured claim.
- Posting, claim, stock, skill, and level identities remain decimal strings.
  Skill display identity is joined from the live global catalog.
- Members requests the provider-neutral Recruitment domain and displays the
  current stock, skill gate, and approval mode.
- The legacy BitJita endpoint and inventory-collector ownership were removed.
- `domain_payload_current` remains the durable last-good boundary. No
  Recruitment table, refresh ledger, or scheduled ingestion job was added.

## Live price lookup vertical evidence

- Market Browse is the browser price-search and order-book surface; the
  unreferenced legacy Price Finder component has been removed.
- Discord `/price` and autocomplete read `domain_payload_current`'s committed
  `regional-market` generation and the existing `game_catalog_entities`
  index.
- Price statistics are derived on request with exact `BigInt` arithmetic.
  Item and Cargo identities remain distinct, including when their numeric IDs
  collide.
- The command reports current orders and explicit freshness only. It does not
  call a completed-sale history endpoint or infer a sale from an order
  disappearing.
- No price-lookup table, cache, refresh ledger, or scheduled acquisition job
  was added. Current freshness remains owned by the adaptive regional session
  pool.

## Map resource catalog vertical evidence

- The typed global subscription includes `resource_desc` and `enemy_desc`.
  Enemy identity remains the exact decimal `enemy_type`, with huntable, tier,
  tag, rarity, and icon metadata normalized before persistence.
- `/api/local/map/catalog` reads the existing
  `game_catalog_descriptions` projection and reports global-catalog freshness.
  It does not contact Relay or another upstream service on a browser request.
- Open Map pages re-read the local catalog when the `catalogs` generation
  changes and preserve the last rendered rows when a local read fails.
- The BitJita-era ten-minute in-process map catalog cache is removed. No
  dedicated resource, creature, map-catalog, refresh-ledger, or scheduled-job
  table was added.
- Active-region discovery is a separate live global-domain input and is not
  inferred from catalog rows.

## Map input retirement evidence

- Static usage proof found no `data.layout` reader in the application. The
  legacy `/claims/{id}/layout` response was fetched, copied into
  `domain_payload_current`, normalized, and requested by Map without affecting
  rendering or behavior.
- Map now requests only the live `claim`, `members`, and `players` domains.
  Claim coordinates provide settlement focus, and live player identities and
  sign-in state drive the existing player-tracking map integration.
- The legacy endpoint, collector fetch, payload key, provider domain key,
  normalizer field, proxy-cache pattern, and stale persisted `layout` rows are
  removed together.
- No typed location subscription or SQL projection replaces unused data.
  Bounded `location_state` joins remain the rule if a future retained feature
  requires in-app coordinates.
