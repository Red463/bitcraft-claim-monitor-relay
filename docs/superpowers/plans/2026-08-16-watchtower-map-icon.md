# Watchtower Map Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the live map's watchtower marker artwork with the supplied transparent PNG without changing marker behavior or rendered size.

**Architecture:** Keep the existing `/map-icons/claims/watchtower.png` public contract and replace only its binary contents. Preserve the current marker presentation and CSS, then publish the asset as release `0.57.0-beta.4` through the existing PR and deployment workflow.

**Tech Stack:** Static PNG asset, React/Vite production build, pnpm, GitHub Actions.

## Global Constraints

- The supplied source is `C:\Users\Tom\Pictures\Bitcraft Calim Monitor\map icons\claim\watchtower.png`.
- The repository destination is `apps/bitcraft-local/public/map-icons/claims/watchtower.png`.
- Preserve PNG format, transparency, and 450×450 source dimensions.
- Preserve the existing 24×24 rendered marker size and public URL.
- Do not change watchtower data, interaction, labels, CSS, React code, or the Empires page.
- Leave unrelated untracked research documents untouched.

---

### Task 1: Replace the watchtower map asset

**Files:**
- Modify: `apps/bitcraft-local/public/map-icons/claims/watchtower.png`

**Interfaces:**
- Consumes: the supplied 450×450 transparent PNG at the exact source path above.
- Produces: the same public asset URL with SHA-256 `7DBF43DCEBD8C53BFBFB8E5391FAC6A5BD11B9B512EA4542E130252E1F725C31`.

- [ ] **Step 1: Verify the asset contract fails before replacement**

Run a PowerShell check that reads both PNGs, asserts both are 450×450 `Format32bppArgb`, and confirms the repository SHA-256 is not the supplied SHA-256.

Expected: dimensions and format match; repository SHA is `28276753522F0F268B1390C17834C321C30426DA5E4C988741BE2B1939A891D2`, so the equality assertion is false.

- [ ] **Step 2: Replace the repository asset**

Copy the supplied PNG byte-for-byte to `apps/bitcraft-local/public/map-icons/claims/watchtower.png` with PowerShell `Copy-Item -LiteralPath`.

- [ ] **Step 3: Verify the replacement passes**

Run the same image-contract check and compare SHA-256 values.

Expected: the repository image remains 450×450 `Format32bppArgb`, and its SHA-256 equals `7DBF43DCEBD8C53BFBFB8E5391FAC6A5BD11B9B512EA4542E130252E1F725C31`.

- [ ] **Step 4: Build the application**

Run: `corepack pnpm --filter @workspace/bitcraft-local run build`

Expected: Vite production build and runtime-boundary validation pass.

### Task 2: Prepare release metadata

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `apps/bitcraft-local/package.json`

**Interfaces:**
- Consumes: the verified watchtower asset replacement from Task 1.
- Produces: release version `0.57.0-beta.4` with a user-facing changelog entry.

- [ ] **Step 1: Update package version**

Change `apps/bitcraft-local/package.json` from `0.57.0-beta.3` to `0.57.0-beta.4`.

- [ ] **Step 2: Add the changelog section**

Add this section at the top of `CHANGELOG.md`:

```markdown
## [0.57.0-beta.4] - 2026-08-16

### Changed

- Updated the map watchtower marker artwork.
```

- [ ] **Step 3: Run the full release suite**

Run: `corepack pnpm --filter @workspace/bitcraft-local test`

Expected: all runnable tests pass, with only documented environment skips.

### Task 3: Review, publish, and deploy

**Files:**
- Review and commit only the design, plan, asset, changelog, and package-version files.

**Interfaces:**
- Consumes: verified release `0.57.0-beta.4`.
- Produces: a merged PR and a healthy production deployment serving the supplied icon.

- [ ] **Step 1: Inspect the exact release diff**

Run `git diff --check`, `git status --short`, and `git diff --stat`. Confirm the two pre-existing untracked research documents remain unstaged.

- [ ] **Step 2: Run the required code review**

Use the repository code-review workflow against `origin/main`. Resolve any actionable Standards or Spec finding, then rerun affected verification.

- [ ] **Step 3: Commit the implementation**

Stage only `CHANGELOG.md`, `apps/bitcraft-local/package.json`, and `apps/bitcraft-local/public/map-icons/claims/watchtower.png`.

Commit message: `chore(map): update watchtower marker icon`

- [ ] **Step 4: Push and open the pull request**

Push `codex/watchtower-map-icon`, open a draft PR against `main`, mark it ready, and wait for all required GitHub checks to pass.

- [ ] **Step 5: Merge and deploy**

Squash-merge the passing PR, ensure no deployment is already active, dispatch `deploy-relay-preview.yml` from `main`, and watch it to successful completion.

- [ ] **Step 6: Verify production**

Confirm `https://app.timbersteeltrade.com/api/local/health` reports `0.57.0-beta.4` and the merge build SHA. Download `https://app.timbersteeltrade.com/map-icons/claims/watchtower.png` and confirm its SHA-256 equals `7DBF43DCEBD8C53BFBFB8E5391FAC6A5BD11B9B512EA4542E130252E1F725C31`.
