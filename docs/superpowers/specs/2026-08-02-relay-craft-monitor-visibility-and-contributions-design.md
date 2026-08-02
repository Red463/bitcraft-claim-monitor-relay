# Relay Craft Monitor Visibility and Contributions Design

## Status

The design direction was approved on 2026-08-02. This written specification is
awaiting the required user review before implementation planning begins.

## Objective

Repair the Relay-backed Craft Monitor so that it:

- loads without contribution warnings caused by valid fractional XP rates;
- hides private crafts by default while retaining an explicit visibility
  control;
- identifies public crafts from the authoritative regional marker table;
- records contributor activity as soon as Relay supplies enough evidence; and
- never assigns contribution credit from an ambiguous observation.

The change remains provider-neutral at the browser boundary and does not
restore BitJita requests, scheduled craft crawls, or current-state SQL mirrors.

## Verified Relay evidence

The relevant schemas and live rows were inspected through the Relay Explorer
on 2026-08-02.

### Active and public crafts

Region 19 exposes:

```txt
progressive_action_state
  entity_id U64 primary key
  building_entity_id U64
  progress I32
  recipe_id I32
  craft_count I32
  owner_entity_id U64
  ...

public_progressive_action_state
  entity_id U64 primary key
  building_entity_id U64
  owner_entity_id U64
```

All three active Timbersteel Trade craft IDs were present in
`progressive_action_state`. Only craft `1369094287471625781` was present in
`public_progressive_action_state`; the other two active crafts were therefore
private.

The Explorer currently renders returned U64 cell values through JavaScript
numbers and visibly rounds them. Exact decimal-string IDs in the SQL `WHERE`
clauses nevertheless selected the intended rows. Application code must not
copy the Explorer's display behavior: entity IDs remain decimal strings
throughout the provider, repository, route, and browser contracts.

### Recipe XP

The global `crafting_recipe_desc` schema defines
`experience_per_progress` as an array of product values containing an XP
`F32`. The three live recipes had rates of `1.76`, `1.76`, and `1.92`.

Fractional XP is valid source data. The current integer-only validation is the
cause of the page warnings and prevents contribution target subscriptions from
starting.

### Contributor evidence

`contribution_state` is not a craft-contribution table. Its columns are
`entity_id`, `player_entity_id`, `enemy_entity_id`, and `contribution`; exact
queries for the three active craft IDs returned no rows. It must not be used
for Craft Monitor attribution.

Region 19 also exposes:

```txt
user_state
  identity Product
  entity_id U64 primary key
  can_sign_in Bool

player_action_state
  auto_id U64 primary key
  entity_id U64
  start_time U64
  duration U64
  target Sum
  recipe_id Sum
  action_type Sum
  last_action_result Sum
  client_cancel Bool
  was_consumed Bool
  ...
```

A bounded live query confirmed that `user_state` can map a SpacetimeDB caller
identity to a player entity ID. A bounded member query against
`player_action_state` returned a live crafting action whose player, target
building, and recipe matched one of the monitored active crafts.

The generated regional bindings expose the craft continuation reducers. Under
the official TypeScript SDK contract, a known reducer event contains
`callerIdentity`; a generic `Transaction` event does not. Attribution logic
must follow that distinction.

## Locked product behavior

### Private craft visibility

Private crafts are hidden on first use and whenever no saved user preference
exists.

The Craft Monitor always renders a visibility toggle, even when the current
snapshot contains no private crafts. The control shows the current private
count and switches between:

- **Show private crafts**; and
- **Hide private crafts**.

The user's explicit choice remains locally persisted. Changing the default
does not forcibly overwrite an existing saved preference.

Visibility is determined only by exact craft-ID membership in
`public_progressive_action_state`:

- marker present: public;
- marker absent after the marker subscription is successfully applied:
  private; and
- marker source unavailable or not yet applied: visibility unknown.

Unknown visibility must not be silently treated as public. Until the
authoritative marker generation is available, the page preserves the last-good
visibility-enriched snapshot; if none exists, it explains that craft
visibility is unavailable.

### Contribution display

Contribution totals are locally observed from the moment the corrected
listener is deployed. The UI does not imply that it contains contribution
history from before observation began.

Named contribution credit is applied in this confidence order:

1. **Authoritative** — a successful known craft continuation reducer event
   identifies the target craft and supplies a caller identity that resolves
   through `user_state`.
2. **Joined** — a generic transaction changes one monitored craft and exactly
   one eligible `player_action_state` row matches the member, target building,
   recipe, and bounded event time.
3. **Unattributed** — progress is observed but the evidence is absent,
   conflicting, or matches more than one player.

An unattributed delta is retained under **Unknown contributor**. It is never
assigned to the craft owner merely because the owner field is available.

The page may label joined attribution as inferred when showing detailed
diagnostics. Normal totals combine authoritative and unambiguous joined
observations, while diagnostics and persisted event metadata retain the
confidence level.

## Provider and repository design

### Visibility enrichment

The Relay provider owns the regional visibility join. React must not fetch the
region-wide `public-crafts` payload and perform the join itself.

The primary-region session maintains exact public-marker state for the
monitored claim's active progressive craft IDs. Marker changes produce a new
validated craft generation. Each normalized active craft receives:

```ts
type CraftVisibility = "public" | "private" | "unknown";

type NormalizedCraft = {
  // existing fields
  visibility: CraftVisibility;
  isPublic: boolean | null;
};
```

`isPublic` remains as a compatibility projection while the UI and new tests
use `visibility` for the three-state semantics.

### Fractional XP normalization

Recipe `F32` values are normalized at the Relay boundary to canonical decimal
strings. The normalizer rejects non-finite, negative, or structurally invalid
rates, but does not require an integer.

Canonicalization removes binary floating-point noise while retaining the
source's meaningful decimal value. For current catalog data this yields
`"1.76"` and `"1.92"`, not strings such as
`"1.7599999904632568"`.

Contribution multiplication and addition use exact decimal arithmetic. Craft
progress remains a decimal integer string; XP totals remain canonical decimal
strings. No XP calculation passes through `BigInt` until its decimal scale has
been made explicit.

The existing SQLite TEXT columns can retain decimal totals, but repository
validation and aggregation must be updated to understand canonical
non-negative decimal strings. A schema migration is required only if the
implementation discovers an integer constraint rather than a TEXT contract.

### Event capture and deduplication

Each observed contribution event records enough evidence to be idempotent and
auditable:

- source database and region;
- craft entity ID;
- contributor entity ID or null;
- progress delta;
- canonical XP delta;
- source timestamp;
- attribution confidence;
- relevant reducer/action identity when available; and
- a stable deduplication key derived from authoritative source identifiers,
  or from the narrowest stable event tuple available for joined observations.

Initial subscription inserts do not create contribution events. Reconnects,
resubscriptions, and generation swaps compare against the committed last-good
craft baseline and must not replay historical deltas.

Progress decreases, craft replacement, recipe changes, completion, and
deletion are lifecycle transitions rather than negative contributions.

### Generic transaction fallback

`player_action_state` is a fallback, not an unrestricted heuristic.

A joined match is valid only when:

- the action belongs to a configured settlement member;
- its target resolves to the craft's building;
- its recipe equals the craft recipe;
- its time overlaps the bounded contribution observation window;
- it represents a successful, non-cancelled crafting continuation; and
- exactly one eligible player action remains after filtering.

Zero or multiple matches produce an unattributed contribution. The fallback
must not guess among candidates or divide one delta across them.

## Browser design

`ProductionPage` continues to consume provider-neutral Craft Monitor rows.
It does not import Relay DTOs or know Relay table names.

The private-craft preference initializes to `false` when no valid saved value
exists. Filtering uses the normalized three-state visibility:

- public crafts always render;
- private crafts render only when the toggle is enabled; and
- unknown crafts follow the last-good snapshot behavior described above rather
  than being exposed as public.

The current page-level incomplete-data banner must disappear when its only
cause was the valid fractional XP rate. Genuine malformed recipe data,
visibility unavailability, attribution ambiguity, and stale provider data
remain visible through focused warnings.

Craft cards show:

- observed contribution progress and XP;
- named contributor totals when attribution is authoritative or joined;
- an Unknown contributor row when unattributed progress exists; and
- an **Observed since** timestamp for the local contribution window.

An absence of contribution events is worded as no activity observed since the
displayed timestamp, not as proof that nobody contributed.

## Error handling

- Fractional finite XP: accepted and normalized.
- Missing or malformed XP structure: affected craft remains visible, while
  contribution XP is unavailable and a focused warning is emitted.
- Public-marker outage with last-good data: preserve stale visibility and
  display freshness.
- Public-marker source never loaded: do not expose unknown crafts as public.
- Unresolved reducer identity: retain the delta as unattributed.
- Ambiguous action fallback: retain the delta as unattributed and increment a
  health diagnostic.
- Contribution persistence failure: keep live craft state visible and surface
  a contribution-only warning.

Provider health records malformed rates, unmatched events, ambiguous matches,
deduplication drops, reconnects, and the last successful contribution event
time without exposing raw identities publicly.

## Testing

### Relay normalization and visibility

- live `experience_per_progress` fixtures normalize `1.76` and `1.92`;
- binary floating-point noise is removed deterministically;
- invalid, negative, and non-finite XP values are rejected;
- exact U64 craft IDs survive round trips without JavaScript-number coercion;
- public marker presence produces public visibility;
- applied marker absence produces private visibility;
- unapplied/unavailable marker state produces unknown visibility; and
- marker insert/delete causes an atomic craft-generation update.

### Contribution capture

- initial subscription rows create no contribution event;
- a successful known craft reducer resolves caller identity through
  `user_state` and records authoritative credit;
- generic transactions with one exact eligible action record joined credit;
- zero or multiple action matches record Unknown contributor;
- craft owner is never used as an attribution fallback;
- fractional XP multiplication and aggregation are exact;
- reconnect and generation swap do not duplicate contributions;
- repeated event evidence is deduplicated;
- progress reset/completion/deletion does not create a negative contribution;
  and
- repository restart restores exact decimal totals.

### Browser behavior

- no saved preference hides private crafts by default;
- existing saved preferences remain respected;
- the toggle always renders and shows the correct private count;
- enabling the toggle reveals only private crafts;
- unknown visibility is never rendered as public;
- valid fractional XP produces no incomplete-data warning;
- named, joined, and Unknown contributor states render correctly; and
- observed-since copy prevents the local history from appearing complete.

### Regression coverage

- Craft Monitor browser requests remain provider-neutral;
- no `/api/bitjita/*` route or BitJita source returns;
- no current craft SQL mirror or scheduled crawl is introduced;
- zero-BitJita source, bundle, CSP, route, asset, and fetch checks remain
  green; and
- production build and complete application tests pass.

## Acceptance criteria

The repair is complete when:

1. the Craft Monitor loads without warnings for valid `F32` XP rates;
2. private crafts are hidden by default and can be explicitly shown;
3. visibility comes from exact regional public-marker membership;
4. contribution progress and XP are stored without floating-point loss;
5. named credit is authoritative or uniquely joined, never guessed;
6. ambiguous progress remains visible as Unknown contributor;
7. reconnects do not duplicate contribution history;
8. the page states the local observation window;
9. no browser Relay coupling, BitJita request, scheduled craft crawl, or
   current-state SQL mirror is introduced; and
10. build, tests, provider-health checks, and browser verification pass.

## Non-goals

- Reconstructing contribution history from before the corrected listener is
  deployed.
- Crediting a craft owner without contributor evidence.
- Using combat `contribution_state` for crafting.
- Restoring BitJita contribution endpoints.
- Changing passive craft behavior or Craft Planning.
- Expanding contribution tracking outside the configured settlement and
  primary region.
