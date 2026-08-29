import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import { applyCraftPlanRecordsMigration, createCraftPlanRepository } from "../src/server/craftPlanRepository.mjs";
import { createCraftPlanConfigAuditRepository } from "../src/server/craftPlanConfigAudit.mjs";
import { computeCraftPlan, normalizeCraftPlanConfig } from "../src/server/craftPlanning.mjs";
import { buildCraftPlanPreview, createCraftPlanRouteReviewRepository } from "../src/server/craftPlanRouteReview.mjs";

const now = () => "2026-08-28T12:00:00.000Z";
const actor = { type: "admin_user", id: "4", displayName: "Reviewer" };

function review(outputKey, fingerprint, { ambiguous = true, selectedRouteId = "safe" } = {}) {
  return {
    outputKey,
    fingerprint,
    ambiguous,
    selectedRouteId,
    preselectedRouteId: selectedRouteId,
    alternatives: [{ id: "safe" }, { id: "other" }],
  };
}

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  applyCraftPlanRecordsMigration(db, { now });
  const statements = {
    insertCraftPlanConfigAudit: db.prepare(`INSERT INTO craft_plan_config_audit (
      plan_id, claim_id, actor_type, actor_id, actor_display_name, occurred_at,
      previous_revision, new_revision, action, changes_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    listCraftPlanConfigAudit: db.prepare("SELECT * FROM craft_plan_config_audit WHERE plan_id = ? ORDER BY occurred_at, id"),
    deleteCraftPlanConfigAudit: db.prepare("DELETE FROM craft_plan_config_audit WHERE plan_id = ?"),
    anonymizeCraftPlanConfigAuditActor: db.prepare("UPDATE craft_plan_config_audit SET actor_id = NULL, actor_display_name = ? WHERE actor_id = ?"),
    listCraftPlanRouteReviews: db.prepare("SELECT * FROM craft_plan_route_reviews WHERE plan_id = ? ORDER BY output_key"),
    deleteCraftPlanRouteReview: db.prepare("DELETE FROM craft_plan_route_reviews WHERE plan_id = ? AND output_key = ?"),
    upsertCraftPlanRouteReview: db.prepare(`INSERT INTO craft_plan_route_reviews (
      plan_id, output_key, signature_fingerprint, selected_route_id, confirmed_fingerprint,
      review_status, reviewer_type, reviewer_id, reviewer_display_name, reviewed_at, configuration_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_id, output_key) DO UPDATE SET
      signature_fingerprint = excluded.signature_fingerprint,
      selected_route_id = excluded.selected_route_id,
      confirmed_fingerprint = excluded.confirmed_fingerprint,
      review_status = excluded.review_status,
      reviewer_type = excluded.reviewer_type,
      reviewer_id = excluded.reviewer_id,
      reviewer_display_name = excluded.reviewer_display_name,
      reviewed_at = excluded.reviewed_at,
      configuration_revision = excluded.configuration_revision`),
  };
  const configAudit = createCraftPlanConfigAuditRepository(db, { statements });
  const routeReviews = createCraftPlanRouteReviewRepository(db, { statements, now });
  const plans = createCraftPlanRepository(db, { configAudit, routeReviews, now });
  return { db, configAudit, routeReviews, plans };
}

test("route-review schema stores exact typed keys and current confirmation metadata", () => {
  const { db, plans, routeReviews } = fixture();
  const plan = plans.primary();
  const routes = [review("items:7", "item-fingerprint"), review("cargo:7", "cargo-fingerprint")];

  routeReviews.reconcile({
    planId: plan.id,
    configurationRevision: plan.revision,
    routeReviews: routes,
    confirmations: routes.map((entry) => ({ outputKey: entry.outputKey, fingerprint: entry.fingerprint, selectedRouteId: "safe" })),
    reviewer: actor,
  });

  assert.deepEqual(routeReviews.listForPlan(plan.id).map((entry) => ({
    outputKey: entry.outputKey,
    fingerprint: entry.fingerprint,
    selectedRouteId: entry.selectedRouteId,
    configurationRevision: entry.configurationRevision,
    reviewer: entry.reviewer,
  })), [
    { outputKey: "cargo:7", fingerprint: "cargo-fingerprint", selectedRouteId: "safe", configurationRevision: 1, reviewer: actor },
    { outputKey: "items:7", fingerprint: "item-fingerprint", selectedRouteId: "safe", configurationRevision: 1, reviewer: actor },
  ]);
  db.close();
});

test("review-only saves append exact route-review state to lifetime configuration history", () => {
  const { db, plans, routeReviews, configAudit } = fixture();
  const plan = plans.primary();
  const current = review("items:7", "fingerprint-a");

  const updated = plans.update(plan.id, { config: plan.config }, {
    expectedRevision: plan.revision,
    admin: true,
    actor,
    claimId: "claim-1",
    routeReviewState: {
      routeReviews: [current],
      previousRouteReviews: [current],
      confirmations: [{ outputKey: "items:7", fingerprint: "fingerprint-a", selectedRouteId: "safe" }],
      reviewer: actor,
    },
  });

  const [history] = configAudit.listForPlan(plan.id);
  assert.equal(updated.revision, 2);
  assert.deepEqual({ actor: history.actor, previousRevision: history.previousRevision, newRevision: history.newRevision, action: history.action }, {
    actor,
    previousRevision: 1,
    newRevision: 2,
    action: "update",
  });
  assert.deepEqual(history.changes.before.routeReviews, []);
  assert.deepEqual(history.changes.after.routeReviews, [{
    outputKey: "items:7",
    fingerprint: "fingerprint-a",
    selectedRouteId: "safe",
    confirmedFingerprint: "fingerprint-a",
    status: "confirmed",
    configurationRevision: 2,
  }]);
  assert.ok(history.changes.patch.some((change) => change.path === "/routeReviews"));
  assert.equal(JSON.stringify(history.changes).includes("Reviewer"), false, "mutable review display labels are represented by the audit actor only");
  db.close();
});

test("route-review reconciliation rolls back when the lifetime audit write fails", () => {
  const { db, routeReviews } = fixture();
  const plans = createCraftPlanRepository(db, {
    routeReviews,
    now,
    configAudit: { record() { throw new Error("audit unavailable"); } },
  });
  const plan = plans.primary();
  const current = review("items:7", "fingerprint-a");

  assert.throws(() => plans.update(plan.id, { config: plan.config }, {
    expectedRevision: plan.revision,
    admin: true,
    actor,
    routeReviewState: {
      routeReviews: [current],
      previousRouteReviews: [current],
      confirmations: [{ outputKey: "items:7", fingerprint: "fingerprint-a", selectedRouteId: "safe" }],
      reviewer: actor,
    },
  }), /audit unavailable/);
  assert.equal(plans.primary().revision, 1);
  assert.deepEqual(routeReviews.listForPlan(plan.id), []);
  db.close();
});

test("submitted and stored confirmations bind to the calculated selected route", () => {
  const { db, plans, routeReviews } = fixture();
  const plan = plans.primary();
  const selectedSafe = review("items:7", "fingerprint-a", { selectedRouteId: "safe" });
  const wrongSubmission = { outputKey: "items:7", fingerprint: "fingerprint-a", selectedRouteId: "other" };

  assert.deepEqual(routeReviews.previewState(plan.id, [selectedSafe], [wrongSubmission]).unconfirmed.map(({ outputKey }) => outputKey), ["items:7"]);
  routeReviews.reconcile({
    planId: plan.id,
    configurationRevision: 1,
    routeReviews: [selectedSafe],
    confirmations: [wrongSubmission],
    reviewer: actor,
  });
  assert.equal(routeReviews.listForPlan(plan.id).length, 0);

  routeReviews.reconcile({
    planId: plan.id,
    configurationRevision: 1,
    routeReviews: [selectedSafe],
    confirmations: [{ ...wrongSubmission, selectedRouteId: "safe" }],
    reviewer: actor,
  });
  const selectedOther = review("items:7", "fingerprint-a", { selectedRouteId: "other" });
  assert.deepEqual(routeReviews.previewState(plan.id, [selectedOther], []).unconfirmed.map(({ outputKey }) => outputKey), ["items:7"]);
  assert.equal(routeReviews.listForPlan(plan.id)[0].selectedRouteId, "safe");
  db.close();
});

test("route reviews are stable, selectively invalidate changed alternatives, and ignore legacy fingerprints", () => {
  const { db, plans, routeReviews } = fixture();
  const plan = plans.primary();
  routeReviews.reconcile({
    planId: plan.id,
    configurationRevision: 1,
    routeReviews: [review("items:7", "old-item"), review("cargo:7", "same-cargo")],
    confirmations: [
      { outputKey: "items:7", fingerprint: "old-item", selectedRouteId: "safe" },
      { outputKey: "cargo:7", fingerprint: "same-cargo", selectedRouteId: "safe" },
    ],
    reviewer: actor,
  });
  db.prepare("UPDATE craft_plan_route_reviews SET confirmed_fingerprint = NULL WHERE output_key = 'items:7'").run();

  const state = routeReviews.previewState(plan.id, [review("items:7", "new-item"), review("cargo:7", "same-cargo")], []);

  assert.deepEqual(state.confirmed.map(({ outputKey }) => outputKey), ["cargo:7"]);
  assert.deepEqual(state.unconfirmed.map(({ outputKey }) => outputKey), ["items:7"]);
  routeReviews.reconcile({ planId: plan.id, configurationRevision: 2, routeReviews: state.routeReviews, confirmations: [], reviewer: actor });
  assert.deepEqual(routeReviews.listForPlan(plan.id).map(({ outputKey }) => outputKey), ["cargo:7"]);
  db.close();
});

test("hidden drafts save unreviewed, public saves require only current ambiguous confirmations", () => {
  const { db, plans, routeReviews, configAudit } = fixture();
  const plan = plans.primary();
  const routeReviewState = {
    routeReviews: [review("items:7", "fingerprint-a")],
    confirmations: [],
    reviewer: actor,
  };

  const hidden = plans.update(plan.id, { name: plan.name, config: { enabled: false } }, {
    expectedRevision: 1, admin: true, actor, routeReviewState,
  });
  assert.equal(hidden.revision, 2);
  assert.throws(() => plans.update(plan.id, { name: plan.name, config: { enabled: true } }, {
    expectedRevision: 2, admin: true, actor, routeReviewState,
  }), (error) => error.code === "craft_plan_route_review_required" && error.unconfirmedRoutes[0].outputKey === "items:7");
  assert.equal(plans.getAdmin(plan.id).revision, 2);
  assert.equal(configAudit.listForPlan(plan.id).length, 1);
  assert.equal(routeReviews.listForPlan(plan.id).length, 0);

  const published = plans.update(plan.id, { name: plan.name, config: { enabled: true } }, {
    expectedRevision: 2,
    admin: true,
    actor,
    routeReviewState: {
      ...routeReviewState,
      confirmations: [{ outputKey: "items:7", fingerprint: "fingerprint-a", selectedRouteId: "safe" }],
    },
  });
  assert.equal(published.revision, 3);
  assert.equal(routeReviews.listForPlan(plan.id)[0].configurationRevision, 3);
  assert.equal(configAudit.listForPlan(plan.id).length, 2);
  db.close();
});

test("legacy public ambiguity is grandfathered until its alternative fingerprint changes", () => {
  const { db, plans, routeReviews, configAudit } = fixture();
  const plan = plans.primary();
  const unchanged = review("items:7", "legacy-fingerprint");
  const saved = plans.update(plan.id, { config: { enabled: true, multipliers: { "items:7": 2 } } }, {
    expectedRevision: 1,
    admin: true,
    actor,
    routeReviewState: { routeReviews: [unchanged], previousRouteReviews: [unchanged], confirmations: [], reviewer: actor },
  });
  assert.equal(saved.revision, 2);
  assert.deepEqual(routeReviews.listForPlan(plan.id).map(({ outputKey, fingerprint, selectedRouteId, confirmedFingerprint, status, configurationRevision }) => ({
    outputKey, fingerprint, selectedRouteId, confirmedFingerprint, status, configurationRevision,
  })), [{
    outputKey: "items:7",
    fingerprint: "legacy-fingerprint",
    selectedRouteId: "safe",
    confirmedFingerprint: null,
    status: "grandfathered",
    configurationRevision: 2,
  }]);
  const continued = plans.update(plan.id, { config: { enabled: true, multipliers: { "items:7": 3 } } }, {
    expectedRevision: 2,
    admin: true,
    actor,
    routeReviewState: { routeReviews: [unchanged], previousRouteReviews: [unchanged], confirmations: [], reviewer: actor },
  });
  assert.equal(continued.revision, 3);
  assert.throws(() => plans.update(plan.id, { config: { enabled: true, multipliers: { "items:7": 3 } } }, {
    expectedRevision: 3,
    admin: true,
    actor,
    routeReviewState: {
      routeReviews: [review("items:7", "changed-fingerprint")],
      previousRouteReviews: [review("items:7", "changed-fingerprint")],
      confirmations: [],
      reviewer: actor,
    },
  }), (error) => error.code === "craft_plan_route_review_required");
  assert.equal(plans.getAdmin(plan.id).revision, 3);
  assert.equal(configAudit.listForPlan(plan.id).length, 2);
  assert.equal(routeReviews.listForPlan(plan.id)[0].fingerprint, "legacy-fingerprint");
  db.close();
});

test("legacy grandfathering binds the selected route as well as the fingerprint", () => {
  const { db, plans, routeReviews, configAudit } = fixture();
  const plan = plans.primary();
  const selectedA = review("items:7", "same-fingerprint", { selectedRouteId: "safe" });
  const selectedB = review("items:7", "same-fingerprint", { selectedRouteId: "other" });

  assert.throws(() => plans.update(plan.id, { config: { enabled: true } }, {
    expectedRevision: 1,
    admin: true,
    actor,
    routeReviewState: { routeReviews: [selectedB], previousRouteReviews: [selectedA], confirmations: [], reviewer: actor },
  }), (error) => error.code === "craft_plan_route_review_required");
  assert.equal(plans.getAdmin(plan.id).revision, 1);
  assert.equal(routeReviews.listForPlan(plan.id).length, 0);
  assert.equal(configAudit.listForPlan(plan.id).length, 0);

  const baseline = plans.update(plan.id, { config: { enabled: true } }, {
    expectedRevision: 1,
    admin: true,
    actor,
    routeReviewState: { routeReviews: [selectedA], previousRouteReviews: [selectedA], confirmations: [], reviewer: actor },
  });
  assert.equal(baseline.revision, 2);
  const continued = plans.update(plan.id, { config: { enabled: true } }, {
    expectedRevision: 2,
    admin: true,
    actor,
    routeReviewState: { routeReviews: [selectedA], previousRouteReviews: [selectedA], confirmations: [], reviewer: actor },
  });
  assert.equal(continued.revision, 3);
  assert.throws(() => plans.update(plan.id, { config: { enabled: true } }, {
    expectedRevision: 3,
    admin: true,
    actor,
    routeReviewState: { routeReviews: [selectedB], previousRouteReviews: [selectedA], confirmations: [], reviewer: actor },
  }), (error) => error.code === "craft_plan_route_review_required");

  const confirmed = plans.update(plan.id, { config: { enabled: true } }, {
    expectedRevision: 3,
    admin: true,
    actor,
    routeReviewState: {
      routeReviews: [selectedB],
      previousRouteReviews: [selectedA],
      confirmations: [{ outputKey: selectedB.outputKey, fingerprint: selectedB.fingerprint, selectedRouteId: selectedB.selectedRouteId }],
      reviewer: actor,
    },
  });
  assert.equal(confirmed.revision, 4);
  assert.deepEqual(routeReviews.listForPlan(plan.id).map(({ selectedRouteId, status }) => ({ selectedRouteId, status })), [
    { selectedRouteId: "other", status: "confirmed" },
  ]);
  db.close();
});

test("existing route-review tables migrate confirmed rows to explicit evidence status", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = OFF");
  applySchemaBootstrap(db);
  db.exec(`
    DROP TABLE craft_plan_route_reviews;
    CREATE TABLE craft_plan_route_reviews (
      plan_id TEXT NOT NULL,
      output_key TEXT NOT NULL,
      signature_fingerprint TEXT NOT NULL,
      selected_route_id TEXT NOT NULL,
      confirmed_fingerprint TEXT,
      reviewer_type TEXT NOT NULL,
      reviewer_id TEXT,
      reviewer_display_name TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      configuration_revision INTEGER NOT NULL,
      PRIMARY KEY (plan_id, output_key)
    );
    INSERT INTO craft_plans (id, name, scope, owner_user_id, is_primary, revision, config_json, created_at, updated_at)
    VALUES ('existing', 'Existing', 'shared', NULL, 1, 1, '{}', 'now', 'now');
    INSERT INTO craft_plan_route_reviews (
      plan_id, output_key, signature_fingerprint, selected_route_id, confirmed_fingerprint,
      reviewer_type, reviewer_id, reviewer_display_name, reviewed_at, configuration_revision
    ) VALUES ('existing', 'items:7', 'fingerprint', 'safe', 'fingerprint', 'admin', '1', 'Admin', 'now', 1);
  `);

  applyCraftPlanRecordsMigration(db, { now });

  assert.equal(db.prepare("SELECT review_status FROM craft_plan_route_reviews WHERE plan_id = 'existing'").get().review_status, "confirmed");
  db.close();
});

test("public saves gate stale persisted evidence even when previous and candidate previews agree", () => {
  const { db, plans, routeReviews, configAudit } = fixture();
  const plan = plans.primary();
  const oldRoute = review("items:7", "catalog-old");
  routeReviews.reconcile({
    planId: plan.id,
    configurationRevision: 1,
    routeReviews: [oldRoute],
    confirmations: [{ outputKey: oldRoute.outputKey, fingerprint: oldRoute.fingerprint, selectedRouteId: oldRoute.selectedRouteId }],
    reviewer: actor,
  });
  const currentRoute = review("items:7", "catalog-current");

  assert.throws(() => plans.update(plan.id, { config: { enabled: true, multipliers: { "items:7": 2 } } }, {
    expectedRevision: 1,
    admin: true,
    actor,
    routeReviewState: {
      routeReviews: [currentRoute],
      previousRouteReviews: [currentRoute],
      confirmations: [],
      reviewer: actor,
    },
  }), (error) => error.code === "craft_plan_route_review_required");
  assert.equal(plans.getAdmin(plan.id).revision, 1);
  assert.equal(configAudit.listForPlan(plan.id).length, 0);
  assert.equal(routeReviews.listForPlan(plan.id)[0].fingerprint, "catalog-old");
  db.close();
});

test("legacy public ambiguity is grandfathered only when no prior review evidence exists", () => {
  const { db, plans, routeReviews } = fixture();
  const plan = plans.primary();
  const currentRoute = review("items:7", "legacy-null");
  routeReviews.reconcile({
    planId: plan.id,
    configurationRevision: 1,
    routeReviews: [currentRoute],
    confirmations: [{ outputKey: currentRoute.outputKey, fingerprint: currentRoute.fingerprint, selectedRouteId: currentRoute.selectedRouteId }],
    reviewer: actor,
  });
  db.prepare("UPDATE craft_plan_route_reviews SET confirmed_fingerprint = NULL WHERE plan_id = ?").run(plan.id);

  assert.throws(() => plans.update(plan.id, { config: { enabled: true } }, {
    expectedRevision: 1,
    admin: true,
    actor,
    routeReviewState: {
      routeReviews: [currentRoute],
      previousRouteReviews: [currentRoute],
      confirmations: [],
      reviewer: actor,
    },
  }), (error) => error.code === "craft_plan_route_review_required");
  assert.equal(plans.getAdmin(plan.id).revision, 1);
  db.close();
});

test("real calculated ambiguous routes require confirmation of the calculated selection on public creation", () => {
  const { db, plans, routeReviews } = fixture();
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "70", kind: "items", name: "Alloy", quantity: 4 }],
  });
  const detailsByKey = new Map([["items:70", {
    item: { id: "70", kind: "items", name: "Alloy" },
    craftingRecipes: [
      {
        id: "calculated-safe",
        name: "Safe alloy",
        craftedItemStacks: [{ item_id: "70", item_type: "item", quantity: 1 }],
        consumedItemStacks: [{ item_id: "71", item_type: "item", quantity: 2 }],
      },
      {
        id: "calculated-other",
        name: "Other alloy",
        craftedItemStacks: [{ item_id: "70", item_type: "item", quantity: 1 }],
        consumedItemStacks: [{ item_id: "72", item_type: "item", quantity: 3 }],
      },
    ],
  }]]);
  const calculated = computeCraftPlan({ config, detailsByKey });
  const preview = buildCraftPlanPreview({
    plan: calculated,
    scope: "shared",
    configurationRevision: 1,
    baselineRevision: "calculated-baseline",
    validation: { valid: true, errors: [] },
  });
  const routeState = preview.routeReviews.find(({ outputKey }) => outputKey === "items:70");
  assert.equal(routeState.ambiguous, true);
  assert.equal(routeState.selectedRouteId, "calculated-safe");

  assert.throws(() => plans.createShared({ name: "Wrong route", duplicateFromPlanId: plans.primary().id }, {
    admin: true,
    actor,
    routeReviewState: {
      routeReviews: [routeState],
      confirmations: [{ outputKey: routeState.outputKey, fingerprint: routeState.fingerprint, selectedRouteId: "calculated-other" }],
      reviewer: actor,
    },
  }), (error) => error.code === "craft_plan_route_confirmation_mismatch");

  const created = plans.createShared({ name: "Calculated route", duplicateFromPlanId: plans.primary().id }, {
    admin: true,
    actor,
    routeReviewState: {
      routeReviews: [routeState],
      confirmations: [{ outputKey: routeState.outputKey, fingerprint: routeState.fingerprint, selectedRouteId: routeState.selectedRouteId }],
      reviewer: actor,
    },
  });
  assert.equal(routeReviews.listForPlan(created.id)[0].selectedRouteId, "calculated-safe");
  db.close();
});

test("real calculated cyclic alternatives are non-selectable and do not create ambiguity", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "80", kind: "items", name: "Plate", quantity: 2 }],
  });
  const calculated = computeCraftPlan({
    config,
    detailsByKey: new Map([["items:80", {
      item: { id: "80", kind: "items", name: "Plate" },
      craftingRecipes: [
        {
          id: "valid-route",
          name: "Valid plate",
          craftedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
          consumedItemStacks: [{ item_id: "81", item_type: "item", quantity: 2 }],
        },
        {
          id: "cyclic-route",
          name: "Cyclic plate",
          craftedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
          consumedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
        },
      ],
    }]]),
  });
  const preview = buildCraftPlanPreview({
    plan: calculated,
    scope: "shared",
    configurationRevision: 1,
    baselineRevision: "cycle-baseline",
    validation: { valid: true, errors: [] },
  });
  const routeState = preview.routeReviews.find(({ outputKey }) => outputKey === "items:80");

  assert.equal(calculated.steps[0].alternatives.find(({ id }) => id === "cyclic-route").isSelectable, false);
  assert.deepEqual(routeState.alternatives.map(({ id }) => id), ["valid-route"]);
  assert.equal(routeState.ambiguous, false);
  assert.equal(routeState.selectedRouteId, "valid-route");
  assert.equal(routeState.preselectedRouteId, "valid-route");
});

test("indirectly cyclic alternatives are non-selectable and do not create ambiguity", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "80", kind: "items", name: "Plate", quantity: 2 }],
  });
  const calculated = computeCraftPlan({
    config,
    detailsByKey: new Map([
      ["items:80", {
        item: { id: "80", kind: "items", name: "Plate" },
        craftingRecipes: [
          {
            id: "valid-route",
            name: "Valid plate",
            craftedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
            consumedItemStacks: [{ item_id: "82", item_type: "item", quantity: 2 }],
          },
          {
            id: "indirect-cycle",
            name: "Indirect cycle",
            craftedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
            consumedItemStacks: [{ item_id: "81", item_type: "item", quantity: 1 }],
          },
        ],
      }],
      ["items:81", {
        item: { id: "81", kind: "items", name: "Loop" },
        craftingRecipes: [{
          id: "cycle-back",
          name: "Cycle back",
          craftedItemStacks: [{ item_id: "81", item_type: "item", quantity: 1 }],
          consumedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
        }],
      }],
    ]),
  });
  const preview = buildCraftPlanPreview({
    plan: calculated,
    scope: "shared",
    configurationRevision: 1,
    baselineRevision: "indirect-cycle-baseline",
    validation: { valid: true, errors: [] },
  });
  const routeState = preview.routeReviews.find(({ outputKey }) => outputKey === "items:80");

  assert.equal(calculated.steps[0].alternatives.find(({ id }) => id === "indirect-cycle").isSelectable, false);
  assert.deepEqual(routeState.alternatives.map(({ id }) => id), ["valid-route"]);
  assert.equal(routeState.ambiguous, false);
  assert.equal(routeState.selectedRouteId, "valid-route");
});

test("route viability tries a safe child recipe after a cyclic child recipe", () => {
  const config = normalizeCraftPlanConfig({
    enabled: true,
    targets: [{ id: "80", kind: "items", name: "Plate", quantity: 2 }],
  });
  const calculated = computeCraftPlan({
    config,
    detailsByKey: new Map([
      ["items:80", {
        item: { id: "80", kind: "items", name: "Plate" },
        craftingRecipes: [
          {
            id: "plate-via-component",
            name: "Plate via component",
            craftedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
            consumedItemStacks: [{ item_id: "81", item_type: "item", quantity: 1 }],
          },
          {
            id: "plate-direct",
            name: "Plate direct",
            craftedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
            consumedItemStacks: [{ item_id: "85", item_type: "item", quantity: 1 }],
          },
        ],
      }],
      ["items:81", {
        item: { id: "81", kind: "items", name: "Component" },
        craftingRecipes: [
          {
            id: "component-cycle-first",
            name: "Component cycle first",
            craftedItemStacks: [{ item_id: "81", item_type: "item", quantity: 1 }],
            consumedItemStacks: [{ item_id: "82", item_type: "item", quantity: 1 }],
          },
          {
            id: "component-safe-second",
            name: "Component safe second",
            craftedItemStacks: [{ item_id: "81", item_type: "item", quantity: 1 }],
            consumedItemStacks: [{ item_id: "84", item_type: "item", quantity: 1 }],
          },
        ],
      }],
      ["items:82", {
        item: { id: "82", kind: "items", name: "Loop" },
        craftingRecipes: [{
          id: "loop-back-to-plate",
          name: "Loop back to plate",
          craftedItemStacks: [{ item_id: "82", item_type: "item", quantity: 1 }],
          consumedItemStacks: [{ item_id: "80", item_type: "item", quantity: 1 }],
        }],
      }],
    ]),
  });
  const preview = buildCraftPlanPreview({
    plan: calculated,
    scope: "shared",
    configurationRevision: 1,
    baselineRevision: "safe-child-baseline",
    validation: { valid: true, errors: [] },
  });
  const routeState = preview.routeReviews.find(({ outputKey }) => outputKey === "items:80");
  const plateStep = calculated.steps.find((step) => step.output?.kind === "items" && step.output?.id === "80");

  assert.equal(plateStep.alternatives.find(({ id }) => id === "plate-via-component").isSelectable, true);
  assert.deepEqual(routeState.alternatives.map(({ id }) => id), ["plate-direct", "plate-via-component"]);
  assert.equal(routeState.ambiguous, true);
  assert.equal(routeState.selectedRouteId, "plate-via-component");

  const { db, plans } = fixture();
  const plan = plans.primary();
  assert.throws(() => plans.update(plan.id, { config }, {
    expectedRevision: plan.revision,
    admin: true,
    actor,
    routeReviewState: { routeReviews: preview.routeReviews, confirmations: [], reviewer: actor },
  }), (error) => error.code === "craft_plan_route_review_required");
  assert.equal(plans.primary().revision, plan.revision);
  db.close();
});

test("new shared plans require ambiguity confirmation and save reviews atomically with creation", () => {
  const { db, plans, routeReviews, configAudit } = fixture();
  const source = plans.primary();
  const routeReviewState = {
    routeReviews: [review("items:7", "new-plan-fingerprint")],
    confirmations: [],
    reviewer: actor,
  };

  assert.throws(() => plans.createShared({ name: "Ambiguous", duplicateFromPlanId: source.id }, {
    admin: true,
    actor,
    routeReviewState,
  }), (error) => error.code === "craft_plan_route_review_required");
  assert.equal(plans.listAdmin({ scope: "shared" }).length, 1);

  const created = plans.createShared({ name: "Reviewed", duplicateFromPlanId: source.id }, {
    admin: true,
    actor,
    routeReviewState: {
      ...routeReviewState,
      confirmations: [{ outputKey: "items:7", fingerprint: "new-plan-fingerprint", selectedRouteId: "safe" }],
    },
  });
  assert.equal(created.revision, 1);
  assert.equal(routeReviews.listForPlan(created.id)[0].configurationRevision, 1);
  assert.equal(configAudit.listForPlan(created.id).length, 1);
  db.close();
});

test("stale and failed saves keep plan, review, and configuration audit state atomic", () => {
  const { db, plans, routeReviews, configAudit } = fixture();
  const plan = plans.primary();
  const routeReviewState = {
    routeReviews: [review("items:7", "fingerprint-a", { ambiguous: false })],
    confirmations: [{ outputKey: "items:7", fingerprint: "fingerprint-a", selectedRouteId: "safe" }],
    reviewer: actor,
  };
  const saved = plans.update(plan.id, { config: { enabled: false, multipliers: { "items:7": 2 } } }, {
    expectedRevision: 1, admin: true, actor, routeReviewState,
  });
  assert.equal(saved.revision, 2);
  assert.throws(() => plans.update(plan.id, { config: { enabled: false, multipliers: { "items:7": 3 } } }, {
    expectedRevision: 1, admin: true, actor, routeReviewState,
  }), (error) => error.statusCode === 409 && error.conflict.currentRevision === 2);
  assert.equal(plans.getAdmin(plan.id).config.multipliers["items:7"], 2);
  assert.equal(configAudit.listForPlan(plan.id).length, 1);
  assert.equal(routeReviews.listForPlan(plan.id).length, 1);

  const rejectingAudit = { record() { throw new Error("audit unavailable"); }, deleteForPlan() {} };
  const failingPlans = createCraftPlanRepository(db, { configAudit: rejectingAudit, routeReviews, now });
  assert.throws(() => failingPlans.update(plan.id, { config: { enabled: false, multipliers: { "items:7": 4 } } }, {
    expectedRevision: 2, admin: true, actor,
    routeReviewState: { ...routeReviewState, routeReviews: [review("items:7", "fingerprint-b", { ambiguous: false })], confirmations: [] },
  }), /audit unavailable/);
  assert.equal(plans.getAdmin(plan.id).revision, 2);
  assert.equal(routeReviews.listForPlan(plan.id)[0].fingerprint, "fingerprint-a");
  db.close();
});

test("staged shared and personal preview configurations reuse ownership and source authorization without persistence", () => {
  const { db, plans, routeReviews, configAudit } = fixture();
  db.prepare("INSERT INTO user_accounts (discord_id, character_player_id, character_status, settings_json, created_at) VALUES ('owner', '42', 'approved', '{}', 'now')").run();
  db.prepare("INSERT INTO user_accounts (discord_id, character_status, settings_json, created_at) VALUES ('other', 'unlinked', '{}', 'now')").run();
  const owner = Number(db.prepare("SELECT id FROM user_accounts WHERE discord_id = 'owner'").get().id);
  const other = Number(db.prepare("SELECT id FROM user_accounts WHERE discord_id = 'other'").get().id);
  const personal = plans.createPersonal({ ownerUserId: owner, name: "Private" }, { randomUUID: () => "personal-plan" }).plan;
  const auditBefore = configAudit.listForPlan(personal.id).length;

  const sharedStage = plans.stage(plans.primary().id, { enabled: false, targets: [] }, { admin: true });
  const personalStage = plans.stage(personal.id, {
    enabled: true,
    sourceRules: { playerIds: ["42"], craftPlayerIds: ["42"] },
  }, { userId: owner });

  assert.equal(sharedStage.plan.scope, "shared");
  assert.equal(personalStage.plan.scope, "personal");
  assert.deepEqual(personalStage.config.sourceRules.playerIds, ["42"]);
  assert.throws(() => plans.stage(personal.id, {}, { userId: other }), /not found/i);
  assert.throws(() => plans.stage(personal.id, { sourceRules: { playerIds: ["99"] } }, { userId: owner }), /verified character sources/i);
  assert.throws(() => plans.stage(personal.id, personalStage.config, { userId: owner, expectedRevision: 0 }),
    (error) => error.statusCode === 409 && error.conflict.currentRevision === 1);
  assert.equal(plans.getAdmin(personal.id).revision, 1);
  assert.equal(configAudit.listForPlan(personal.id).length, auditBefore);
  assert.equal(routeReviews.listForPlan(personal.id).length, 0);
  db.close();
});
