# Native Map Final Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed Map page unconditionally use the first-party native renderer and remove the external iframe rollout path.

**Architecture:** Keep the existing `NativeMap` data/rendering module unchanged and simplify its owner, `MapPanel`, to one renderer path. Retire renderer configuration at the server, shared settings, and admin UI boundaries; then remove external URL/iframe and CSP seams so persisted settings cannot re-enable them.

**Tech Stack:** React, TypeScript, Node HTTP server, SQLite settings, plain CSS, Node test runner.

## Global Constraints

- Native rendering is unconditional; external and native-beta renderer modes are unsupported.
- Browser code must not construct selection-bearing BitCraftMap URLs or embed BitCraftMap.
- Existing native selections, regional scope, resource/player tracking, and freshness behavior remain unchanged.
- Release version is `0.55.0-beta.2`.

---

### Task 1: Lock the native-only renderer boundary

**Files:**
- Modify: `apps/bitcraft-local/test/map-page-boundary.test.mjs`
- Modify: `apps/bitcraft-local/test/map-renderer-settings.test.mjs`
- Modify: `apps/bitcraft-local/test/server-route-groups.test.mjs`

**Interfaces:**
- Consumes: `MapPanel`, app settings, and CSP source text.
- Produces: regression assertions that forbid renderer props, map iframes, external URL construction, renderer selectors, and BitCraftMap frame permission.

- [ ] Write failing boundary assertions for one `NativeMap`, no iframe path, no renderer setting, and no BitCraftMap CSP source.
- [ ] Run the focused tests and confirm failures identify the retained rollout seams.

### Task 2: Remove renderer configuration and iframe code

**Files:**
- Modify: `apps/bitcraft-local/src/pages/MapPage.tsx`
- Modify: `apps/bitcraft-local/src/AppShell.tsx`
- Modify: `apps/bitcraft-local/src/components/admin/AdminPanel.tsx`
- Modify: `apps/bitcraft-local/src/settingsDefaults.ts`
- Modify: `apps/bitcraft-local/src/types/settings.ts`
- Modify: `apps/bitcraft-local/src/utils/appSettings.ts`
- Modify: `apps/bitcraft-local/server.mjs`
- Modify: `apps/bitcraft-local/src/server/defaultAppSettings.mjs`
- Modify: `apps/bitcraft-local/src/server/httpRoutes.mjs`
- Modify: `apps/bitcraft-local/src/styles/map.css`

**Interfaces:**
- Consumes: existing `NativeMap` props and settings persistence.
- Produces: `MapPanel` without a renderer argument; settings without `mapRendererMode`; CSP without `bitcraftmap.com`.

- [ ] Remove iframe URL/state/retry/render branches and render `NativeMap` directly.
- [ ] Remove renderer setting defaults, normalization, admin field, server reads/writes, and audit metadata.
- [ ] Remove obsolete iframe CSS and BitCraftMap `frame-src` permission.
- [ ] Run focused map/settings/CSP tests and confirm they pass.

### Task 3: Release and production verification

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `apps/bitcraft-local/package.json`

**Interfaces:**
- Produces: release `0.55.0-beta.2` and production evidence.

- [ ] Run `corepack pnpm --filter @workspace/bitcraft-local test` and require zero failures.
- [ ] Run `corepack pnpm --filter @workspace/bitcraft-local run build` and require exit code 0.
- [ ] Commit, push, open and merge a focused PR, then dispatch the routine Relay deployment workflow from `main`.
- [ ] Verify production health reports `0.55.0-beta.2`, the Map page contains `.native-map`, and no `.map-frame` or `bitcraftmap.com` iframe exists.
