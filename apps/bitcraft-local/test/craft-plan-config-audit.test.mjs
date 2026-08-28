import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { deleteUserAccount } from "../src/server/accountDeletion.mjs";
import { createCraftPlanConfigAuditRepository } from "../src/server/craftPlanConfigAudit.mjs";
import { createCraftPlanRepository, applyCraftPlanRecordsMigration } from "../src/server/craftPlanRepository.mjs";
import { createPreparedStatements } from "../src/server/preparedStatements.mjs";
import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";
import { applyAdditiveColumnMigrations } from "../src/server/schemaMigrations.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  applyCraftPlanRecordsMigration(db, { now: () => "2026-08-28T09:00:00.000Z" });
  applyAdditiveColumnMigrations(db);
  const statements = createPreparedStatements(db);
  const configAudit = createCraftPlanConfigAuditRepository(db, { statements });
  let planSequence = 0;
  const repository = createCraftPlanRepository(db, {
    configAudit,
    randomUUID: () => `plan-created-${++planSequence}`,
    now: () => "2026-08-28T10:00:00.000Z",
  });
  return { db, statements, configAudit, repository };
}

test("legacy schema bootstrap adds lifetime config audit without changing existing plans", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE craft_plans (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL, owner_user_id INTEGER,
      is_primary INTEGER NOT NULL, revision INTEGER NOT NULL, config_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    INSERT INTO craft_plans VALUES ('kept', 'Existing', 'shared', NULL, 1, 7, '{"targets":[]}', 'old', 'new');
  `);

  applySchemaBootstrap(db);
  applySchemaBootstrap(db);

  assert.equal(db.prepare("SELECT revision FROM craft_plans WHERE id = 'kept'").get().revision, 7);
  assert.ok(db.prepare("PRAGMA table_info(craft_plan_config_audit)").all().some((row) => row.name === "changes_json"));
  assert.ok(db.prepare("PRAGMA table_info(craft_plan_progress_audit_causal_groups)").all().some((row) => row.name === "group_id"));
  db.close();
});

test("shared and personal saves append exact redacted configuration changes only after success", () => {
  const { db, configAudit, repository } = fixture();
  db.prepare("INSERT INTO user_accounts (discord_id, discord_username, character_status, settings_json, created_at) VALUES ('77', 'player', 'unlinked', '{}', 'now')").run();
  const owner = db.prepare("SELECT id FROM user_accounts WHERE discord_id = '77'").get().id;
  const sharedActor = { type: "admin", id: "5", displayName: "Operator" };
  const personalActor = { type: "user_account", id: String(owner), displayName: "Player Name" };

  const shared = repository.createShared({ name: "Shared", duplicateFromPlanId: null }, {
    admin: true,
    actor: sharedActor,
    claimId: "42",
  });
  const updated = repository.update(shared.id, {
    name: "Published Shared",
    config: {
      enabled: true,
      visibility: "public",
      targets: [{ id: "8", kind: "items", quantity: 3 }],
      sourceRules: { storageContainerIds: ["storage-1"] },
      routeOverrides: { "items:8": "recipe-2" },
      routeReviews: { "items:8": { signature: "safe" } },
      multipliers: { "items:8": { multiplier: 1.2 } },
      apiToken: "must-not-survive",
    },
  }, { expectedRevision: 1, admin: true, actor: sharedActor, claimId: "42" });

  const personal = repository.createPersonal({ ownerUserId: owner, name: "Mine" }, {
    actor: personalActor,
    claimId: "42",
    randomUUID: () => "personal-plan",
  }).plan;
  repository.update(personal.id, {
    config: { enabled: false, targets: [{ id: "8", kind: "cargo", quantity: 2 }], sourceRules: {} },
  }, { expectedRevision: 1, userId: owner, actor: personalActor, claimId: "42" });

  assert.throws(() => repository.update(shared.id, { name: "Stale" }, {
    expectedRevision: 1, admin: true, actor: sharedActor, claimId: "42",
  }), /changed since/);

  const sharedRows = configAudit.listForPlan(shared.id);
  assert.equal(sharedRows.length, 2);
  assert.deepEqual(sharedRows.map((row) => [row.action, row.previousRevision, row.newRevision]), [
    ["create", null, 1],
    ["update", 1, 2],
  ]);
  assert.deepEqual(sharedRows[1].actor, sharedActor);
  assert.equal(sharedRows[1].claimId, "42");
  assert.equal(sharedRows[1].changes.after.name, "Published Shared");
  assert.deepEqual(sharedRows[1].changes.after.config.targets, [{ id: "8", kind: "items", quantity: 3 }]);
  assert.deepEqual(sharedRows[1].changes.after.config.routeOverrides, { "items:8": "recipe-2" });
  assert.deepEqual(sharedRows[1].changes.after.config.routeReviews, { "items:8": { signature: "safe" } });
  assert.equal(sharedRows[1].changes.after.config.multipliers["items:8"].multiplier, 1.2);
  assert.doesNotMatch(JSON.stringify(sharedRows), /must-not-survive/);

  const personalRows = configAudit.listForPlan(personal.id);
  assert.equal(personalRows.length, 2);
  assert.deepEqual(personalRows[1].changes.after.config.targets, [{ id: "8", kind: "cargo", quantity: 2 }]);
  assert.equal(updated.revision, 2);
  db.close();
});

test("plan and account deletion remove owned causal evidence while preserving surviving plan history", () => {
  const { db, statements, configAudit, repository } = fixture();
  db.prepare("INSERT INTO user_accounts (discord_id, discord_username, character_status, settings_json, created_at) VALUES ('77', 'player', 'unlinked', '{}', 'now')").run();
  const owner = db.prepare("SELECT id FROM user_accounts WHERE discord_id = '77'").get().id;
  const actor = { type: "user_account", id: String(owner), displayName: "player" };
  const personal = repository.createPersonal({ ownerUserId: owner, name: "Mine" }, {
    actor,
    claimId: "42",
    randomUUID: () => "personal-plan",
  }).plan;
  const shared = repository.createShared({ name: "Shared" }, { admin: true, actor, claimId: "42" });
  const removable = repository.createShared({ name: "Remove" }, {
    admin: true,
    actor: { type: "admin", id: "3", displayName: "Admin" },
    claimId: "42",
  });

  const causalGroup = (planId) => ({
    groupId: `group-${planId}`,
    span: { from: "2026-08-28T10:00:00.000Z", to: "2026-08-28T10:05:00.000Z" },
    observedTriggers: [], derivedEffects: [], dependencyPaths: [], unresolvedRelationships: [], materialKeys: [], events: [],
  });
  for (const planId of [personal.id, shared.id, removable.id]) {
    const group = causalGroup(planId);
    statements.insertCraftPlanProgressCausalGroup.run("42", planId, group.groupId, group.span.from, group.span.to, JSON.stringify(group));
  }

  repository.remove(removable.id, { expectedRevision: 1, admin: true });
  assert.equal(configAudit.listForPlan(removable.id).length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_causal_groups WHERE plan_id = ?").get(removable.id).count, 0);

  deleteUserAccount(db, {
    userId: owner,
    discordId: "77",
    deletionKey: "deletion-key",
    now: () => new Date("2026-08-28T11:00:00.000Z"),
    randomUUID: () => "receipt",
  });

  assert.equal(configAudit.listForPlan(personal.id).length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_causal_groups WHERE plan_id = ?").get(personal.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM craft_plan_progress_audit_causal_groups WHERE plan_id = ?").get(shared.id).count, 1);
  const surviving = configAudit.listForPlan(shared.id)[0];
  assert.equal(surviving.actor.id, null);
  assert.match(surviving.actor.displayName, /^deleted:/);
  assert.doesNotMatch(JSON.stringify(surviving), /player/);
  db.close();
});

test("changing the primary shared plan records both publication-state revisions atomically", () => {
  const { db, configAudit, repository } = fixture();
  const actor = { type: "admin", id: "5", displayName: "Operator" };
  const primary = repository.primary();
  const secondary = repository.createShared({ name: "Secondary" }, { admin: true, actor, claimId: "42" });

  const promoted = repository.setPrimary(secondary.id, {
    expectedRevision: secondary.revision,
    admin: true,
    actor,
    claimId: "42",
  });

  assert.equal(promoted.primary, true);
  const promotedAudit = configAudit.listForPlan(secondary.id).at(-1);
  assert.deepEqual([promotedAudit.action, promotedAudit.previousRevision, promotedAudit.newRevision], ["primary", 1, 2]);
  assert.equal(promotedAudit.changes.before.primary, false);
  assert.equal(promotedAudit.changes.after.primary, true);
  const demotedAudit = configAudit.listForPlan(primary.id).at(-1);
  assert.deepEqual([demotedAudit.action, demotedAudit.previousRevision, demotedAudit.newRevision], ["primary", 1, 2]);
  assert.equal(demotedAudit.changes.before.primary, true);
  assert.equal(demotedAudit.changes.after.primary, false);
  db.close();
});
