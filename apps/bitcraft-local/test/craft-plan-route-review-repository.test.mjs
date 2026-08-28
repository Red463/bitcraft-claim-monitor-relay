import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import { applyCraftPlanRecordsMigration, createCraftPlanRepository } from "../src/server/craftPlanRepository.mjs";
import { createCraftPlanConfigAuditRepository } from "../src/server/craftPlanConfigAudit.mjs";
import { createCraftPlanRouteReviewRepository } from "../src/server/craftPlanRouteReview.mjs";

const now = () => "2026-08-28T12:00:00.000Z";
const actor = { type: "admin_user", id: "4", displayName: "Reviewer" };

function review(outputKey, fingerprint, { ambiguous = true, selectedRouteId = "safe" } = {}) {
  return {
    outputKey,
    fingerprint,
    ambiguous,
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
      reviewer_type, reviewer_id, reviewer_display_name, reviewed_at, configuration_revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(plan_id, output_key) DO UPDATE SET
      signature_fingerprint = excluded.signature_fingerprint,
      selected_route_id = excluded.selected_route_id,
      confirmed_fingerprint = excluded.confirmed_fingerprint,
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
  const { db, plans, configAudit } = fixture();
  const plan = plans.primary();
  const unchanged = review("items:7", "legacy-fingerprint");
  const saved = plans.update(plan.id, { config: { enabled: true, multipliers: { "items:7": 2 } } }, {
    expectedRevision: 1,
    admin: true,
    actor,
    routeReviewState: { routeReviews: [unchanged], previousRouteReviews: [unchanged], confirmations: [], reviewer: actor },
  });
  assert.equal(saved.revision, 2);
  assert.throws(() => plans.update(plan.id, { config: { enabled: true, multipliers: { "items:7": 3 } } }, {
    expectedRevision: 2,
    admin: true,
    actor,
    routeReviewState: {
      routeReviews: [review("items:7", "changed-fingerprint")],
      previousRouteReviews: [unchanged],
      confirmations: [],
      reviewer: actor,
    },
  }), (error) => error.code === "craft_plan_route_review_required");
  assert.equal(plans.getAdmin(plan.id).revision, 2);
  assert.equal(configAudit.listForPlan(plan.id).length, 1);
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
