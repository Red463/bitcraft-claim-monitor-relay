# Craft Planner Accuracy, Audit, and Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Use superpowers:test-driven-development for every behavior change and superpowers:verification-before-completion before claiming completion.

**Goal:** Make Craft Planning accurate, fully explainable to administrators, and simpler to configure for settlement and personal plans.

**Architecture:** Extend the existing canonical/live planner split. Join canonical zero-stock material requirements into live material rows, validate completed calculations before publication, enrich the existing durable audit with causal groups and comparison, and consolidate the manager into four staged-save workspaces.

**Tech Stack:** Node.js 24+, React, TypeScript, plain CSS, Node built-in SQLite, pnpm.

**Spec:** The user-approved plan in the implementing conversation is authoritative; this file records its execution tasks.

## Global Constraints

- Preserve typed item/cargo identity, route IDs, existing compatibility fields, and provider-neutral Relay boundaries.
- Use additive SQLite migrations and preserve existing plans and audit records.
- Complete audit history and diagnostic identities remain administrator-only.
- Detailed calculation evidence is retained for 30 days; configuration history is retained for the plan lifetime.
- Settlement plans suggest storage only; personal plans suggest the owner's inventory only; suggestions require confirmation.
- No new framework, external service, changelog entry, or version bump during local implementation.

---

### Task 1: Stable material totals and calculation validation

- Add `planRequired`, `requiredNow`, and `missingNow` to planner materials while retaining `required` and `missing` aliases.
- Join the existing canonical zero-stock baseline materials into the live response by typed material key.
- Validate identities, finite non-negative quantities, selected routes, source completeness, baseline stability, and progress ordering before publishing.
- Retain last-good planner state and emit an administrator diagnostic when validation fails.
- Cover stable totals, live stock/craft changes, identity separation, validation failure, and last-good behavior with focused failing tests first.

### Task 2: Lifetime configuration history and causal progress audit

- Add an append-only per-plan configuration audit table with actor, timestamp, revisions, and structured before/after changes.
- Record both settlement and personal plan saves; anonymize actors on account deletion and delete rows with their plan.
- Increase detailed audit retention to 30 days.
- Add deterministic causal groups that distinguish observed triggers, derived effects, dependency paths, and unresolved relationships.
- Add paginated/filterable groups, checkpoint comparison, and export schema version 2 while preserving legacy evidence honestly.
- Cover migrations, retention, exact configuration changes, causal replay, comparison reconstruction, corrupt evidence, permissions, and export compatibility.

### Task 3: Preview, route review, and optimistic concurrency

- Add authenticated non-persisting preview routes for settlement and personal plans.
- Return material impact, route ambiguity, validation results, baseline revision, and a preview fingerprint.
- Persist route-review metadata keyed by typed output and route signature; invalidate only materially changed alternatives.
- Permit hidden drafts with unreviewed routes and require confirmation before publishing newly ambiguous public routes.
- Add configuration revision checks and return `409` for stale saves without discarding the client draft.
- Cover permissions, CSRF, rate limiting, no-persistence, review invalidation, publishing gates, and stale saves.

### Task 4: Four-workspace manager and read-only item route details

- Consolidate the manager into Goals, Counted Sources, Recipe Review, and administrator-only Audit.
- Group all source types in one searchable workspace and provide confirmable storage-only/inventory-only suggestions by plan type.
- Replace route dropdowns with staged comparison cards, ambiguous-first filters, impact previews, colocated buffers, and one Save action.
- Remove immediate route saving from item details and deep-link editors to the focused Recipe Review entry.
- Add timeline filters, causal detail, and checkpoint comparison to Audit.
- Preserve viewport-fixed modal behavior, dirty-refresh protection, dense styling, accessibility, and responsive layout.
- Cover workspace behavior, suggestions, route staging, publish confirmation, deep links, keyboard semantics, and narrow layouts.

### Task 5: Integrated verification and release readiness

- Run focused tests after each task, then the complete application test suite and production build.
- Start the stable smoke server and browser-check the Needs Board, all four manager workspaces, route preview, audit comparison, and narrow modal layout.
- Run a whole-branch code review and resolve all important findings.
- Commit the completed implementation to the feature branch without pushing or deploying.

