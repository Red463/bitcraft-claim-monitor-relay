# Verified Character Marker Halo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the visible `ME` badge and reduce the approved linked-character marker to a compact 28px halo treatment.

**Architecture:** Keep the existing current-user identity resolution, marker class, colour, tooltip, and accessibility data flow unchanged. Make a focused renderer/CSS presentation adjustment, protected by the existing map boundary test.

**Tech Stack:** React, TypeScript, Leaflet, plain CSS, Node test runner, pnpm.

## Global Constraints

- Do not display visible `ME` text anywhere on the map marker.
- Keep the `Your character, …` tooltip, title, and accessible label.
- Keep the current-user double halo, colour glow, and reduced-motion treatment.
- Use a 28px current-user marker container/content and a 10px centre dot.
- Do not change tracking, authentication, colour preferences, persistence, APIs, routing, or dedicated-map behavior.

---

### Task 1: Replace the badge with a compact halo-only marker

**Files:**
- Modify: `apps/bitcraft-local/test/map-page-boundary.test.mjs:235-251`
- Modify: `apps/bitcraft-local/src/pages/map/NativeMap.tsx:216-249`
- Modify: `apps/bitcraft-local/src/styles/map.css:235-241`

**Interfaces:**
- Consumes: existing `markerIcon(kind, presentation, color, currentUser)` ownership flag and `native-map-marker--current-user` class.
- Produces: unchanged marker API and accessible ownership wording; presentation changes only.

- [ ] **Step 1: Write the failing boundary assertions**

Replace the existing current-user marker boundary test expectations with:

```js
test("Native map marks only the approved linked player with a compact halo-only treatment", () => {
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const mapPage = readFileSync(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");
  const nativeMap = readFileSync(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/styles/map.css", import.meta.url), "utf8");

  assert.match(appShell, /verifiedCharacterPlayerId=/);
  assert.match(mapPage, /verifiedCharacterPlayerId/);
  assert.match(nativeMap, /isCurrentUserPlayerMarker/);
  assert.match(nativeMap, /native-map-marker--current-user/);
  assert.match(nativeMap, /Your character, /);
  assert.doesNotMatch(nativeMap, /native-map-player-me-label|textContent = "ME"/);
  assert.match(css, /native-map-marker--current-user[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
  assert.match(css, /native-map-marker--current-user \.native-map-marker-content[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
  assert.match(css, /native-map-marker--current-user \.native-map-player-dot[^}]*width:\s*10px;[^}]*height:\s*10px;/s);
  assert.doesNotMatch(css, /native-map-player-me-label/);
  assert.match(css, /prefers-reduced-motion:\s*reduce[\s\S]*native-map-marker--current-user/s);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/map-page-boundary.test.mjs
```

Expected: FAIL because `NativeMap.tsx` still creates `native-map-player-me-label`, and CSS still specifies 34px/12px dimensions.

- [ ] **Step 3: Remove visible badge markup and reduce the Leaflet icon box**

In `markerIcon` inside `NativeMap.tsx`, delete the complete `if (currentUser)` block that creates and appends the `ME` span. Keep the `currentUser` argument because it still selects the ownership class and size. Change the size expression to:

```ts
const size = currentUser ? 28 : kind === "player" || variant === "watchtower" ? 24 : variant === "claim-tier" || variant === "claim-npc" ? 32 : 30;
```

Do not alter `accessibleLabel`, `isCurrentUserPlayerMarker`, marker colour resolution, or the `native-map-marker--current-user` class.

- [ ] **Step 4: Reduce the CSS marker while retaining the halo**

Replace the current-user size rules in `map.css` with:

```css
.native-map-marker--current-user { width: 28px; height: 28px; }
.native-map-marker--current-user .native-map-marker-content { width: 28px; height: 28px; }
.native-map-marker--current-user .native-map-marker-content::before { content: ""; position: absolute; inset: 3px; border: 3px solid var(--player-marker-color, #38bdf8); border-radius: 50%; box-shadow: 0 0 0 3px rgba(255,255,255,.9), 0 0 14px var(--player-marker-color, #38bdf8); pointer-events: none; }
.native-map-marker--current-user .native-map-player-dot { width: 10px; height: 10px; border-width: 2px; }
```

Delete the complete `.native-map-player-me-label` rule. Keep the reduced-motion current-user pulse rule unchanged.

- [ ] **Step 5: Run focused verification and verify GREEN**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local exec node --experimental-strip-types --test test/map-page-boundary.test.mjs test/map-player-marker-identity.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Run release-proportionate verification**

Run:

```powershell
corepack pnpm --filter @workspace/bitcraft-local test
corepack pnpm --filter @workspace/bitcraft-local run build
```

Expected: both commands exit successfully. If the Windows test runner repeats known process-start concurrency failures, rerun the complete suite with `--test-concurrency=4` and isolate every reported test file before concluding.

- [ ] **Step 7: Browser-smoke the marker presentation**

Build and start the stable smoke server, open `/?page=map`, and verify:

- no visible `ME` text or `.native-map-player-me-label` exists;
- the approved linked-character marker retains `.native-map-marker--current-user` and the double halo;
- its Leaflet icon box is 28px square and its centre dot is 10px square;
- its accessible label still begins `Your character, `;
- normal and dedicated views have no new console errors.

- [ ] **Step 8: Commit the implementation**

```powershell
git add apps/bitcraft-local/test/map-page-boundary.test.mjs apps/bitcraft-local/src/pages/map/NativeMap.tsx apps/bitcraft-local/src/styles/map.css
git commit -m "fix(map): simplify verified character marker"
```
