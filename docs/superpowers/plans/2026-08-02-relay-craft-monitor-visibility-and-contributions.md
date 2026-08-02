# Relay Craft Monitor Visibility and Contributions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Craft Monitor visibility and contribution tracking so private crafts are hidden by default, valid fractional Relay XP rates load cleanly, and contributor credit is evidence-based.

**Architecture:** Enrich settlement crafts at the provider-neutral server boundary with a three-state visibility join sourced from the committed regional public-craft generation. Introduce exact decimal helpers for Relay `F32` XP, isolate attribution in a pure module, then integrate authoritative reducer identity and a unique live-player-action fallback into the primary-region session. Persist confidence and nullable unknown contributors in SQLite and project them without converting exact amounts or U64 IDs to JavaScript numbers.

**Tech Stack:** Node.js 24+, TypeScript 5.9, SpacetimeDB TypeScript SDK 2.7.0, React, Vite, `node:sqlite`, Node test runner, pnpm via Corepack.

## Global Constraints

- Work only in `apps/bitcraft-local` plus this plan/spec documentation.
- IDs remain exact decimal strings; never coerce U64 IDs through `Number`.
- Private crafts are hidden when no valid saved preference exists.
- Existing saved private-craft preferences remain respected.
- Visibility comes only from committed `public_progressive_action_state` evidence.
- Valid finite non-negative `F32` XP rates are accepted and canonically normalized.
- Ambiguous contribution activity is retained as **Unknown contributor**, never assigned to the craft owner.
- Initial subscription rows, reconnects, and generation swaps must not create contribution events.
- Contribution history is locally observed from deployment and must expose `observedSince`.
- React consumes provider-neutral projections and must not know Relay table names.
- Do not introduce a scheduled craft crawl, current-state craft SQL mirror, or BitJita request.
- Preserve Item/Cargo identity semantics and the zero-BitJita runtime boundary.

---

## File Structure

### New files

- `apps/bitcraft-local/src/server/game-data/exactDecimal.ts`
  - Canonicalize Relay `F32` values and add/multiply exact non-negative decimal strings.
- `apps/bitcraft-local/src/server/game-data/craftContributionAttribution.ts`
  - Pure parsing and confidence selection for reducer events and player-action fallback rows.
- `apps/bitcraft-local/test/exact-decimal.test.mjs`
  - Exact XP normalization and arithmetic coverage.
- `apps/bitcraft-local/test/craft-contribution-attribution.test.mjs`
  - Authoritative, joined, ambiguous, and unattributed attribution coverage.
- `apps/bitcraft-local/test/production-page-boundary.test.mjs`
  - Source-boundary coverage for the default-hidden always-present toggle and observation copy.

### Modified files

- `apps/bitcraft-local/src/server/game-data/index.ts`
  - Export the two focused server modules.
- `apps/bitcraft-local/src/server/game-data/craftProjection.ts`
  - Add three-state visibility enrichment without coupling to Relay DTOs.
- `apps/bitcraft-local/src/server/game-data/primaryRegionPlayerSession.ts`
  - Subscribe to bounded member identity/action rows and emit evidence-scored contribution events.
- `apps/bitcraft-local/src/server/game-data/currentStateRepository.ts`
  - Persist nullable contributors, exact decimal XP, and attribution confidence idempotently.
- `apps/bitcraft-local/src/server/schemaBootstrap.mjs`
  - Define the durable contribution tables with nullable contributor IDs and confidence.
- `apps/bitcraft-local/src/server/schemaMigrations.mjs`
  - Safely migrate existing contribution tables without losing observations.
- `apps/bitcraft-local/src/server/craftContributionProjection.mjs`
  - Project decimal XP, nullable unknown contributors, confidence, and observed-since values.
- `apps/bitcraft-local/src/utils/normalize.ts`
  - Flatten the structured contribution payload while retaining its observation start.
- `apps/bitcraft-local/server.mjs`
  - Normalize target XP, supply building/recipe evidence, join committed visibility, and return contribution observation metadata.
- `apps/bitcraft-local/src/pages/ProductionPage.tsx`
  - Default to hidden, always render the toggle, render Unknown contributor, confidence, XP, and observation-window copy.
- `apps/bitcraft-local/test/craft-provider-projection.test.mjs`
  - Verify public/private/unknown craft visibility.
- `apps/bitcraft-local/test/primary-region-player-session.test.mjs`
  - Verify bounded subscriptions, reducer attribution, joined fallback, ambiguity, and reconnect safety.
- `apps/bitcraft-local/test/game-data-repository-route.test.mjs`
  - Verify decimal accumulation, nullable contributors, confidence, and deduplication.
- `apps/bitcraft-local/test/craft-contribution-projection.test.mjs`
  - Verify browser projection of fractional XP and Unknown contributor.
- `apps/bitcraft-local/test/server-schema-migrations.test.mjs`
  - Verify the non-destructive contribution schema migration.

---

### Task 1: Exact Relay XP Decimal Semantics

**Files:**
- Create: `apps/bitcraft-local/src/server/game-data/exactDecimal.ts`
- Create: `apps/bitcraft-local/test/exact-decimal.test.mjs`
- Modify: `apps/bitcraft-local/src/server/game-data/index.ts`
- Modify: `apps/bitcraft-local/server.mjs:5050-5065`
- Modify: `apps/bitcraft-local/server.mjs:5599-5630`

**Interfaces:**
- Produces:

```ts
export function canonicalF32Decimal(value: unknown, label: string): string;
export function canonicalNonNegativeDecimal(value: unknown, label: string): string;
export function addDecimal(left: string, right: string): string;
export function multiplyDecimalByInteger(decimal: string, integer: string): string;
```

- `canonicalF32Decimal` first applies `Math.fround`, keeps seven significant
  decimal digits with `toPrecision(7)`, expands exponent notation, removes
  redundant leading/trailing zeroes, and rejects negative/non-finite values.
- `addDecimal` and `multiplyDecimalByInteger` parse decimal strings to
  `{ coefficient: bigint; scale: number }`, operate with `BigInt`, align or
  combine scales, then serialize canonically.

- [ ] **Step 1: Write the failing exact-decimal tests**

```js
test("Relay F32 XP rates normalize without binary noise", () => {
  assert.equal(canonicalF32Decimal(1.7599999904632568, "xp"), "1.76");
  assert.equal(canonicalF32Decimal(1.9199999570846558, "xp"), "1.92");
});

test("exact decimal XP multiplies and accumulates without Number", () => {
  assert.equal(multiplyDecimalByInteger("1.76", "24"), "42.24");
  assert.equal(addDecimal("42.24", "9007199254740993.76"), "9007199254741036");
});

test("invalid Relay XP is rejected", () => {
  assert.throws(() => canonicalF32Decimal(-1, "xp"), /non-negative/i);
  assert.throws(() => canonicalF32Decimal(Infinity, "xp"), /finite/i);
  assert.throws(() => canonicalNonNegativeDecimal("1.2.3", "xp"), /decimal/i);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/exact-decimal.test.mjs
```

Expected: FAIL because `exactDecimal.ts` does not exist.

- [ ] **Step 3: Implement the minimal decimal module**

Use the following internal representation:

```ts
type DecimalParts = {
  coefficient: bigint;
  scale: number;
};

function serialize({ coefficient, scale }: DecimalParts): string {
  if (coefficient === 0n) return "0";
  const digits = coefficient.toString().padStart(scale + 1, "0");
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  return fraction ? `${whole}.${fraction}` : whole;
}
```

Implement exponent expansion explicitly so values such as `1e-7` serialize as
`"0.0000001"`. Export all four functions from `index.ts`.

- [ ] **Step 4: Use canonical fractional XP in contribution targets**

Update `craftExperiencePerProgress` to accept both Relay camelCase and
snake_case fields:

```js
const skillId = toNumber(
  craft.levelRequirements?.[0]?.skillId
  ?? craft.levelRequirements?.[0]?.skill_id
  ?? craft.experiencePerProgress?.[0]?.skillId
  ?? craft.experiencePerProgress?.[0]?.skill_id,
);
const match = craft.experiencePerProgress?.find?.(
  (entry) => toNumber(entry.skillId ?? entry.skill_id) === skillId,
);
return match?.quantity ?? craft.experiencePerProgress?.[0]?.quantity;
```

Replace the safe-integer guard in `relayCraftContributionTargets` with:

```js
const xpPerProgress = canonicalF32Decimal(
  craftExperiencePerProgress(craft),
  `Relay craft ${craftEntityId} experience per progress`,
);
```

Also add exact `buildingEntityId` and `recipeId` decimal strings to each target;
reject a target if either required identifier is absent or invalid.

- [ ] **Step 5: Run the focused tests and existing craft projection tests**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/exact-decimal.test.mjs test/craft-provider-projection.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/bitcraft-local/src/server/game-data/exactDecimal.ts apps/bitcraft-local/src/server/game-data/index.ts apps/bitcraft-local/server.mjs apps/bitcraft-local/test/exact-decimal.test.mjs
git commit -m "fix: accept fractional relay craft xp"
```

---

### Task 2: Provider-Neutral Craft Visibility

**Files:**
- Modify: `apps/bitcraft-local/src/server/game-data/craftProjection.ts`
- Modify: `apps/bitcraft-local/server.mjs:7355-7375`
- Modify: `apps/bitcraft-local/test/craft-provider-projection.test.mjs`
- Modify: `apps/bitcraft-local/src/pages/ProductionPage.tsx:55-230`
- Create: `apps/bitcraft-local/test/production-page-boundary.test.mjs`

**Interfaces:**
- Consumes committed `public-crafts` snapshot rows from the repository.
- Produces:

```ts
export type CraftVisibility = "public" | "private" | "unknown";

export type CraftVisibilityEvidence = {
  ready: boolean;
  publicCraftIds: ReadonlySet<string>;
};

export function craftVisibilityEvidence(snapshot: unknown): CraftVisibilityEvidence;

export function enrichCraftsWithCatalog(
  snapshot: unknown,
  getEntity: (catalogKey: string) => CatalogEntity | null,
  getRecipe: (recipeId: string) => CraftRecipe | null,
  visibility?: CraftVisibilityEvidence,
): EnrichedCraftSnapshot;
```

Every active craft receives:

```ts
{
  visibility: "public" | "private" | "unknown";
  isPublic: true | false | null;
}
```

- [ ] **Step 1: Add failing visibility projection tests**

```js
test("craft visibility uses exact public marker membership", () => {
  const visibility = craftVisibilityEvidence({
    craftResults: [{ entityId: "1369094287471625781" }],
  });
  const projected = enrichCraftsWithCatalog(
    { craftResults: [
      { entityId: "1369094287471625781", recipeId: "10" },
      { entityId: "1369094286813753789", recipeId: "10" },
    ] },
    () => null,
    () => ({ id: "10", isPassive: false }),
    visibility,
  );
  assert.deepEqual(
    projected.craftResults.map(({ entityId, visibility, isPublic }) => [
      entityId, visibility, isPublic,
    ]),
    [
      ["1369094287471625781", "public", true],
      ["1369094286813753789", "private", false],
    ],
  );
});

test("missing marker readiness produces unknown visibility", () => {
  const projected = enrichCraftsWithCatalog(
    { craftResults: [{ entityId: "100", recipeId: "10" }] },
    () => null,
    () => ({ id: "10", isPassive: false }),
  );
  assert.equal(projected.craftResults[0].visibility, "unknown");
  assert.equal(projected.craftResults[0].isPublic, null);
});
```

- [ ] **Step 2: Run the projection test and verify it fails**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/craft-provider-projection.test.mjs
```

Expected: FAIL because visibility enrichment is absent.

- [ ] **Step 3: Implement visibility evidence and projection**

`craftVisibilityEvidence` must:

- accept only object snapshots with a `craftResults` array;
- validate every marker entity ID as a decimal string;
- return `ready: true` for an applied empty marker snapshot; and
- throw on malformed marker rows instead of silently classifying crafts.

`enrichCraftsWithCatalog` maps exact string membership to public/private only
when `ready === true`; otherwise it emits unknown/null.

- [ ] **Step 4: Join the committed public marker generation in the local route**

Inside the `domain === "crafts"` transform:

```js
const publicCraftSnapshot = currentStateRepository.read(claimId, "public-crafts");
const visibility = publicCraftSnapshot?.data
  ? craftVisibilityEvidence(publicCraftSnapshot.data)
  : undefined;
```

Pass `visibility` to `enrichCraftsWithCatalog`. If the marker snapshot has
`lastError`, retain its last-good data but add a visibility-specific warning and
partial confidence. If it has never loaded, return unknown visibility and an
explicit warning rather than treating absence as private.

- [ ] **Step 5: Add failing browser-boundary tests**

The new source test reads `ProductionPage.tsx` and asserts:

```js
assert.match(source, /usePersistedState\\("production\\.showPrivateCrafts", false\\)/);
assert.doesNotMatch(source, /privateCrafts\\.length\\s*\\?\\s*<label className="production-private-toggle"/);
assert.match(source, /Show private crafts/);
assert.match(source, /Hide private crafts/);
assert.match(source, /Unknown contributor/);
assert.match(source, /Observed since/);
```

- [ ] **Step 6: Implement the default-hidden always-present toggle**

Change only the relevant Production component logic:

```tsx
const [showPrivateCrafts, setShowPrivateCrafts] = usePersistedState(
  "production.showPrivateCrafts",
  false,
);
const visibilityKnownCrafts = data.crafts.filter(
  (job) => job.visibility === "public"
    || job.visibility === "private"
    || typeof job.isPublic === "boolean",
);
const privateCrafts = visibilityKnownCrafts.filter(
  (job) => job.visibility === "private" || job.isPublic === false,
);
const visibilityFilteredCrafts = showPrivateCrafts
  ? visibilityKnownCrafts
  : visibilityKnownCrafts.filter(
      (job) => job.visibility !== "private" && job.isPublic !== false,
    );
```

Always render the checkbox label. Its text is
`showPrivateCrafts ? "Hide private crafts" : "Show private crafts"` and includes
`(${privateCrafts.length})`. Keep the existing persisted-state hook key so an
existing explicit preference remains intact.

Unknown-visibility crafts are omitted in both toggle states. When they exist,
render the route's visibility warning/empty explanation; never expose them as
though they were public.

- [ ] **Step 7: Run focused tests and build**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/craft-provider-projection.test.mjs test/production-page-boundary.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/bitcraft-local/src/server/game-data/craftProjection.ts apps/bitcraft-local/server.mjs apps/bitcraft-local/src/pages/ProductionPage.tsx apps/bitcraft-local/test/craft-provider-projection.test.mjs apps/bitcraft-local/test/production-page-boundary.test.mjs
git commit -m "fix: derive relay craft visibility"
```

---

### Task 3: Pure Contribution Attribution

**Files:**
- Create: `apps/bitcraft-local/src/server/game-data/craftContributionAttribution.ts`
- Create: `apps/bitcraft-local/test/craft-contribution-attribution.test.mjs`
- Modify: `apps/bitcraft-local/src/server/game-data/index.ts`

**Interfaces:**
- Consumes:

```ts
export type ContributionTarget = {
  craftEntityId: string;
  buildingEntityId: string;
  recipeId: string;
};

export type MemberIdentity = {
  entityId: string;
  name: string;
  identityHex: string;
};
```

- Produces:

```ts
export type ContributionAttribution =
  | {
      confidence: "authoritative" | "joined";
      contributorEntityId: string;
      contributorName: string;
      evidenceKey: string;
    }
  | {
      confidence: "unknown";
      contributorEntityId: null;
      contributorName: "Unknown contributor";
      evidenceKey: string;
    };

export function resolveCraftContributionAttribution(input: {
  event: unknown;
  target: ContributionTarget;
  members: readonly MemberIdentity[];
  actionRows: readonly unknown[];
  observedAtMs: number;
  fallbackWindowMs?: number;
}): ContributionAttribution;
```

- [ ] **Step 1: Write failing authoritative attribution tests**

Use the SDK event shape:

```js
const event = {
  tag: "Reducer",
  value: {
    callerIdentity: { toHexString: () => "0xabc" },
    reducer: {
      tag: "CraftContinue",
      value: {
        request: {
          progressiveActionEntityId: 1369094287471625781n,
          timestamp: 1785675248960n,
        },
      },
    },
  },
};
```

Assert an exact identity match returns authoritative attribution and that a
different craft ID returns unknown.

- [ ] **Step 2: Write failing joined/ambiguous tests**

Rows use generated binding shapes:

```js
{
  autoId: 94295n,
  entityId: 576460752388321942n,
  startTime: 1785675248960n,
  duration: 1274n,
  target: 1369094286799419104n,
  recipeId: 307004,
  actionType: { tag: "Craft", value: undefined },
  lastActionResult: { tag: "Success", value: undefined },
  clientCancel: false,
  wasConsumed: false,
}
```

Assert:

- one member row matching building, recipe, successful Craft action, and
  `startTime <= observedAt <= startTime + duration + 5000` is joined;
- cancelled/non-Craft/failed/out-of-window rows are ignored;
- two eligible member rows are unknown; and
- no eligible row is unknown.

- [ ] **Step 3: Run the test and verify it fails**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/craft-contribution-attribution.test.mjs
```

Expected: FAIL because the attribution module does not exist.

- [ ] **Step 4: Implement strict reducer parsing and fallback matching**

Normalize enum tags only by removing underscores/hyphens and lowercasing.
Accept only `craftcontinue` and `craftcontinuestart`. Read the craft ID only
from:

```ts
event.value.reducer.value.request.progressiveActionEntityId
```

Read caller identity through a deterministic `identityHex` helper that accepts
the generated identity object's `toHexString()` result or its canonical
`__identity__` field. Never stringify arbitrary objects to `"[object Object]"`.

For generic `Transaction`, filter player action rows using all locked fallback
conditions. The fallback evidence key is:

```txt
action:${autoId}:craft:${craftEntityId}:progress:${previousProgress}:${currentProgress}
```

The session supplies the progress tuple when it builds the final source key.
This pure helper supplies ``action:${autoId}`` or one of the explicit evidence
values `unknown:no-match`, `unknown:ambiguous`, or
`unknown:unresolved-identity`.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/craft-contribution-attribution.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/bitcraft-local/src/server/game-data/craftContributionAttribution.ts apps/bitcraft-local/src/server/game-data/index.ts apps/bitcraft-local/test/craft-contribution-attribution.test.mjs
git commit -m "feat: score relay craft contributor evidence"
```

---

### Task 4: Live Session Integration and Idempotent Persistence

**Files:**
- Modify: `apps/bitcraft-local/src/server/game-data/primaryRegionPlayerSession.ts`
- Modify: `apps/bitcraft-local/test/primary-region-player-session.test.mjs`
- Modify: `apps/bitcraft-local/src/server/game-data/currentStateRepository.ts`
- Modify: `apps/bitcraft-local/src/server/schemaBootstrap.mjs`
- Modify: `apps/bitcraft-local/src/server/schemaMigrations.mjs`
- Modify: `apps/bitcraft-local/test/game-data-repository-route.test.mjs`
- Modify: `apps/bitcraft-local/test/server-schema-migrations.test.mjs`

**Interfaces:**
- Extends `CraftContributionTarget`:

```ts
type CraftContributionTarget = {
  craftEntityId: string;
  buildingEntityId: string;
  recipeId: string;
  profession: string | null;
  craftLabel: string;
  structureName: string;
  itemTier: string | null;
  xpPerProgress: string;
};
```

- Durable event additions:

```ts
{
  contributorEntityId: string | null;
  contributorName: string;
  attributionConfidence: "authoritative" | "joined" | "unknown";
  observedSince: string;
}
```

- [ ] **Step 1: Extend fake bindings and write failing bounded-query tests**

Add fake cached tables for `userState` and `playerActionState`. Assert the base
subscription contains:

```txt
SELECT * FROM user_state WHERE entity_id = 576460752388321942 OR entity_id = 504403158356601680
SELECT * FROM player_action_state WHERE entity_id = 576460752388321942 OR entity_id = 504403158356601680
```

Also assert listeners are removed during `stop()`.

- [ ] **Step 2: Replace the owner-attribution session test**

Delete the old expectation that a generic transaction credits
`current.ownerEntityId`.

Add:

- reducer event + matching `userState` identity -> authoritative named event;
- generic transaction + one matching `playerActionState` row -> joined named
  event;
- generic transaction + two matching rows -> unknown contributor event;
- `SubscribeApplied`, zero delta, negative/reset delta -> no event;
- repeated evidence creates the same `sourceKey`; and
- fractional `"1.76"` multiplied by progress `"24"` -> `"42.24"`.

Assert `session.health()` exposes:

```ts
{
  lastContributionAt: string | null;
  authoritativeContributions: number;
  joinedContributions: number;
  unattributedContributions: number;
  ambiguousContributionMatches: number;
  deduplicatedContributions: number;
}
```

Expected source-key structure:

```txt
relay-craft-contribution:${regionId}:${confidence}:${evidenceKey}:${craftEntityId}:${previousProgress}:${currentProgress}
```

- [ ] **Step 3: Run the session tests and verify they fail**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/primary-region-player-session.test.mjs
```

Expected: FAIL because identity/action tables and scored attribution are absent.

- [ ] **Step 4: Integrate identity/action tables and attribution**

Extend `BindingConnection.db`, `playerStateQueries`, `#tables`, and listener
cleanup for `userState` and `playerActionState`.

In `#handleContributionUpdate`:

1. validate exact craft/progress IDs;
2. ignore non-positive deltas;
3. resolve attribution with `resolveCraftContributionAttribution`;
4. calculate XP with `multiplyDecimalByInteger`;
5. build the stable source key from confidence, evidence, craft, previous, and
   current progress;
6. emit null contributor ID for unknown evidence; and
7. include confidence and observation metadata in `data`.

Do not require `event.id`; the official `Transaction` variant has no ID.
Increment the health counters when an event is emitted or an ambiguous fallback
is detected. Track previously emitted source keys in a bounded in-memory LRU
set of 2,048 keys so immediate duplicate callbacks increment
`deduplicatedContributions` and do not queue redundant repository work. Durable
SQLite uniqueness remains the restart-safe final deduplication boundary.

- [ ] **Step 5: Add failing repository and migration tests**

Repository coverage must assert:

```js
assert.equal(contribution.contributed_xp, "84.48"); // two distinct 42.24 events
assert.equal(contribution.contributor_entity_id, null);
assert.equal(contribution.contributor_name, "Unknown contributor");
assert.equal(contribution.attribution_confidence, "unknown");
```

Migration coverage starts from the existing NOT NULL schema, inserts a legacy
named row, runs migrations, and confirms:

- the legacy row is retained;
- `contributor_entity_id` is nullable;
- `attribution_confidence` exists and defaults legacy rows to `"unknown"`; and
- exact TEXT amount types remain TEXT.

- [ ] **Step 6: Implement schema and repository changes**

Bootstrap table changes:

```sql
contributor_entity_id TEXT,
attribution_confidence TEXT NOT NULL DEFAULT 'unknown'
  CHECK (attribution_confidence IN ('authoritative', 'joined', 'unknown'))
```

Apply both columns to `production_contributions` and
`production_contribution_events`.

Because SQLite cannot remove a NOT NULL constraint in place, add an idempotent
copy migration:

1. inspect `PRAGMA table_info`;
2. begin an immediate transaction;
3. rename the old table;
4. create the new schema;
5. copy all rows, preserving source keys and amount text;
6. use `"unknown"` for missing legacy confidence;
7. drop the legacy table; and
8. commit or roll back atomically.

For aggregation, use:

```ts
const totalXp = addDecimal(
  String(previous?.contributed_xp ?? "0"),
  canonicalNonNegativeDecimal(payload.contributedXp, "contributed XP"),
);
```

The unknown contribution key is
`${claimId}:${craftId}:unknown`; a named key retains the exact contributor ID.

- [ ] **Step 7: Run focused backend tests**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/primary-region-player-session.test.mjs test/game-data-repository-route.test.mjs test/server-schema-migrations.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add apps/bitcraft-local/src/server/game-data/primaryRegionPlayerSession.ts apps/bitcraft-local/src/server/game-data/currentStateRepository.ts apps/bitcraft-local/src/server/schemaBootstrap.mjs apps/bitcraft-local/src/server/schemaMigrations.mjs apps/bitcraft-local/test/primary-region-player-session.test.mjs apps/bitcraft-local/test/game-data-repository-route.test.mjs apps/bitcraft-local/test/server-schema-migrations.test.mjs
git commit -m "fix: persist relay craft contributors safely"
```

---

### Task 5: Contribution Projection and Craft Monitor Presentation

**Files:**
- Modify: `apps/bitcraft-local/src/server/craftContributionProjection.mjs`
- Modify: `apps/bitcraft-local/test/craft-contribution-projection.test.mjs`
- Modify: `apps/bitcraft-local/server.mjs:6138-6258`
- Modify: `apps/bitcraft-local/src/utils/normalize.ts:77-100`
- Modify: `apps/bitcraft-local/src/pages/ProductionPage.tsx:220-330`
- Modify: `apps/bitcraft-local/test/production-page-boundary.test.mjs`

**Interfaces:**
- Produces per-craft contributor rows:

```ts
type CraftContributorRow = {
  contributorEntityId: string | null;
  contributorUsername: string;
  totalProgressContributed: string;
  totalXpContributed: string;
  contributionCount: string;
  attributionConfidence: "authoritative" | "joined" | "unknown";
  firstContributedAt: string | null;
  lastContributedAt: string | null;
};
```

- Produces a structured contribution domain:

```ts
{
  data: {
    byCraft: Record<string, CraftContributorRow[]>;
    observedSince: string | null;
  };
  warnings: string[];
}
```

- [ ] **Step 1: Write failing projection tests**

Add rows containing:

- named authoritative XP `"42.24"`;
- named joined XP `"3.52"`;
- null contributor ID, `"Unknown contributor"`, and unknown confidence;
- a malformed decimal XP row that becomes a partial warning; and
- distinct first-observed times, where `observedSince` is the earliest valid
  `first_contributed_at`.

Assert U64 contributor IDs remain exact strings and null remains null.

- [ ] **Step 2: Run the projection test and verify it fails**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/craft-contribution-projection.test.mjs
```

Expected: FAIL because XP and contributor IDs are integer-only.

- [ ] **Step 3: Implement projection and route metadata**

Import `canonicalNonNegativeDecimal` from the compiled provider module.
Keep progress/count integer validation, but validate XP as a canonical decimal.
Validate confidence against the locked three values.

Update `currentCraftContributions` and leaderboard reads to include
`attribution_confidence`. Leaderboard numeric summaries may format decimals for
display, but the per-craft browser domain must preserve exact strings.

Do not count the unknown bucket as a named contributor. Keep its progress/XP in
overall activity totals and expose it in the per-craft list.

Update `normalizeData` without changing its existing `contributions` map
contract:

```ts
const contributionPayload = raw?.contributions ?? {};
const contributions = contributionPayload.byCraft ?? contributionPayload;
const contributionObservedSince = contributionPayload.observedSince ?? null;
```

Return `contributionObservedSince` beside `contributions`. This preserves
Dashboard and Production map lookups while making the observation start
available to Craft Monitor.

- [ ] **Step 4: Implement Craft Monitor contribution copy**

For each contributor:

```tsx
const unknownContributor = person.contributorEntityId == null
  || person.attributionConfidence === "unknown";
const contributorName = unknownContributor
  ? "Unknown contributor"
  : person.contributorUsername;
```

Render exact progress plus XP with `formatDecimalQuantity`, and add an
`Inferred` detail label only for `joined` confidence. Use a stable key:

```tsx
key={person.contributorEntityId ?? `unknown:${job.entityId}`}
```

Replace the unconditional empty copy with:

```txt
No contributor activity has been observed since 2 Aug 2026, 14:05.
```

If `observedSince` is unavailable:

```txt
No contributor activity has been observed since tracking became available.
```

Add one compact page-level observation note; do not repeat a large banner on
every card.

- [ ] **Step 5: Run focused tests and build**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/craft-contribution-projection.test.mjs test/production-page-boundary.test.mjs test/main-app-data.test.mjs
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/bitcraft-local/src/server/craftContributionProjection.mjs apps/bitcraft-local/server.mjs apps/bitcraft-local/src/utils/normalize.ts apps/bitcraft-local/src/pages/ProductionPage.tsx apps/bitcraft-local/test/craft-contribution-projection.test.mjs apps/bitcraft-local/test/production-page-boundary.test.mjs apps/bitcraft-local/test/main-app-data.test.mjs
git commit -m "fix: show observed relay craft contributors"
```

---

### Task 6: Full Verification and Browser Smoke Test

**Files:**
- Modify only if a verification failure proves a task-scoped defect.

**Interfaces:**
- Consumes the completed backend/browser implementation.
- Produces a verified candidate ready for review and deployment preparation.

- [ ] **Step 1: Run the complete application test suite**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local test
```

Expected: PASS with no contribution, schema, provider-boundary, or
zero-BitJita regressions.

- [ ] **Step 2: Run the production build**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: PASS, including TypeScript, generated server output, assets, Vite,
and Relay boundary verification.

- [ ] **Step 3: Start the stable local smoke server**

Run:

```powershell
node scripts/start-bitcraft-local-smoke.mjs --force-restart
curl.exe -s http://127.0.0.1:18449/api/local/health
```

Expected: launcher returns promptly and health returns an HTTP-success JSON
payload.

- [ ] **Step 4: Browser-check Craft Monitor**

Open:

```txt
http://127.0.0.1:18449/?page=craft-monitor
```

Verify:

- no warning for valid `1.76`/`1.92` XP;
- two private crafts are hidden on a clean browser preference;
- the toggle is present and reports two private crafts;
- enabling it reveals exactly those two private crafts;
- the public craft remains visible in both states;
- contributor rows show names only when evidence is authoritative/joined;
- ambiguous progress appears as Unknown contributor;
- the observation-window copy is visible; and
- browser console contains no React hook, fetch, or rendering error.

- [ ] **Step 5: Confirm zero BitJita traffic**

In addition to the build boundary script, inspect the browser network log while
loading and toggling Craft Monitor. Expected: requests remain under
`/api/local/*`; no BitJita host or `/api/bitjita/*` route appears.

- [ ] **Step 6: Inspect final diff and working tree**

Run:

```powershell
git diff --check
git status --short
git log --oneline -7
```

Expected: no whitespace errors; only intentional task files are changed; each
completed task has a focused commit.

- [ ] **Step 7: Record verification commit only if fixes were required**

If Step 1-5 required a task-scoped correction:

```powershell
git add apps/bitcraft-local/server.mjs apps/bitcraft-local/src/server/game-data/exactDecimal.ts apps/bitcraft-local/src/server/game-data/craftContributionAttribution.ts apps/bitcraft-local/src/server/game-data/index.ts apps/bitcraft-local/src/server/game-data/craftProjection.ts apps/bitcraft-local/src/server/game-data/primaryRegionPlayerSession.ts apps/bitcraft-local/src/server/game-data/currentStateRepository.ts apps/bitcraft-local/src/server/craftContributionProjection.mjs apps/bitcraft-local/src/server/schemaBootstrap.mjs apps/bitcraft-local/src/server/schemaMigrations.mjs apps/bitcraft-local/src/utils/normalize.ts apps/bitcraft-local/src/pages/ProductionPage.tsx apps/bitcraft-local/test/exact-decimal.test.mjs apps/bitcraft-local/test/craft-contribution-attribution.test.mjs apps/bitcraft-local/test/craft-provider-projection.test.mjs apps/bitcraft-local/test/primary-region-player-session.test.mjs apps/bitcraft-local/test/game-data-repository-route.test.mjs apps/bitcraft-local/test/server-schema-migrations.test.mjs apps/bitcraft-local/test/craft-contribution-projection.test.mjs apps/bitcraft-local/test/production-page-boundary.test.mjs apps/bitcraft-local/test/main-app-data.test.mjs
git commit -m "test: verify relay craft monitor repair"
```

If no correction was required, do not create an empty commit.

---

## Execution Notes

- The Relay Explorer evidence is recorded in
  `docs/superpowers/specs/2026-08-02-relay-craft-monitor-visibility-and-contributions-design.md`.
- Do not use `contribution_state`; it is combat contribution data.
- Do not depend on Explorer-rendered U64 cell text because the Explorer display
  rounds large values. Use the exact values from provider rows and fixtures.
- A generic SpacetimeDB `Transaction` event has no caller identity or stable
  transaction ID. Never reinstate `event.id` or owner attribution.
- If live Relay never exposes a known reducer event, the joined/unknown paths
  remain correct; authoritative credit simply remains unused.
- Production deployment, release versioning, changelog, GitHub push, and VPS
  service restart are deliberately outside this implementation plan and
  require the existing release/deployment workflow after verification.
