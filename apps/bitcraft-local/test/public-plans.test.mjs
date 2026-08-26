import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";

let publicPlans = null;
try {
  publicPlans = await import("../src/server/public/publicPlans.mjs");
} catch {
  // RED: Task 6 owns this isolated public-plan boundary.
}

test("public plan documents preserve exact typed decimal targets and reject non-public source fields", () => {
  assert.ok(publicPlans, "public plan module must exist");
  const document = publicPlans.normalizePublicCraftPlanDocument({
    schemaVersion: 1,
    targets: [
      { catalogKey: "items:18446744073709551615", quantity: "9007199254740993" },
      { catalogKey: "cargo:18446744073709551615", quantity: "2" },
    ],
    routeOverrides: { "items:18446744073709551615": "recipe:7" },
    multipliers: { "items:18446744073709551615": { multiplier: 1.5, note: "Seasonal margin" } },
    sectionOverrides: { "items:18446744073709551615": "Forestry" },
    rowNameOverrides: { "items:18446744073709551615": "Ancient timber" },
  });

  assert.equal(document.targets[0].catalogKey, "items:18446744073709551615");
  assert.equal(document.targets[0].quantity, "9007199254740993");
  assert.notEqual(document.targets[0].catalogKey, document.targets[1].catalogKey);
  assert.throws(() => publicPlans.normalizePublicCraftPlanDocument({ ...document, sourceRules: { playerIds: ["7"] } }), {
    name: "PublicPlanError",
    status: 400,
  });
  assert.throws(() => publicPlans.normalizePublicCraftPlanDocument({
    ...document,
    targets: [{ catalogKey: "items:18446744073709551615", quantity: Number.MAX_SAFE_INTEGER + 1 }],
  }), { name: "PublicPlanError", status: 400 });
});

test("public plan multipliers stay within the planner's safe one-to-twenty domain", () => {
  const document = emptyDocument();
  const boundary = publicPlans.normalizePublicCraftPlanDocument({
    ...document,
    multipliers: { "items:7": { multiplier: 20, note: "Maximum public buffer" } },
  });
  assert.equal(boundary.multipliers["items:7"].multiplier, 20);
  for (const multiplier of [0.5, 20.000000000000004, Number.MAX_VALUE, Number.POSITIVE_INFINITY]) {
    assert.throws(() => publicPlans.normalizePublicCraftPlanDocument({
      ...document,
      multipliers: { "items:7": { multiplier } },
    }), { name: "PublicPlanError", status: 400 });
  }
});

test("public plan documents enforce target, byte, exact-schema, and plain-text label limits", () => {
  const empty = {
    schemaVersion: 1,
    targets: [],
    routeOverrides: {},
    multipliers: {},
    sectionOverrides: {},
    rowNameOverrides: {},
  };
  assert.throws(() => publicPlans.normalizePublicCraftPlanDocument({
    ...empty,
    targets: Array.from({ length: 101 }, (_, index) => ({ catalogKey: `items:${index + 1}`, quantity: "1" })),
  }), { name: "PublicPlanError", status: 413 });
  assert.throws(() => publicPlans.normalizePublicCraftPlanDocument({
    ...empty,
    routeOverrides: { "items:1": "r".repeat(257 * 1024) },
  }), { name: "PublicPlanError", status: 413 });
  assert.throws(() => publicPlans.normalizePublicCraftPlanDocument({
    ...empty,
    multipliers: { "items:1": { multiplier: 2, note: "ok", rawRelay: {} } },
  }), { name: "PublicPlanError", status: 400 });
  for (const invalid of [
    { ...empty, routeOverrides: { "items:1": 7 } },
    { ...empty, sectionOverrides: { "items:1": { name: "Mining" } } },
    { ...empty, multipliers: { "items:1": { multiplier: 2, note: "secret\nline" } } },
    { ...empty, sectionOverrides: { "items:1": "x".repeat(81) } },
  ]) {
    assert.throws(() => publicPlans.normalizePublicCraftPlanDocument(invalid), { name: "PublicPlanError", status: 400 });
  }
  assert.equal(publicPlans.normalizePublicPlanLabel("Ancient timber", "title"), "Ancient timber");
  for (const invalid of ["x".repeat(81), "line\nbreak", "hidden\u200btext", "   "]) {
    assert.throws(() => publicPlans.normalizePublicPlanLabel(invalid, "title"), { name: "PublicPlanError", status: 400 });
  }
});

test("public plan schema is additive and represents exactly one owner outside collaborator roles", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  const names = db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name LIKE 'public_craft_plan%'
    ORDER BY name
  `).all().map((row) => row.name);
  assert.deepEqual(names, [
    "public_craft_plan_events",
    "public_craft_plan_invites",
    "public_craft_plan_members",
    "public_craft_plan_share_links",
    "public_craft_plans",
  ]);

  const ownerId = Number(db.prepare(`
    INSERT INTO public_user_accounts (discord_id, settings_json, created_at)
    VALUES ('owner', '{}', '2026-08-25T00:00:00.000Z') RETURNING id
  `).get().id);
  db.prepare(`
    INSERT INTO public_craft_plans (
      id, owner_user_id, claim_id, title, document_json, status,
      document_revision, access_revision, created_at, updated_at
    ) VALUES ('plan-1', ?, '42', 'Plan', ?, 'active', 1, 1, ?, ?)
  `).run(ownerId, JSON.stringify({ schemaVersion: 1, targets: [], routeOverrides: {}, multipliers: {}, sectionOverrides: {}, rowNameOverrides: {} }), "2026-08-25T00:00:00.000Z", "2026-08-25T00:00:00.000Z");
  assert.throws(() => db.prepare(`
    INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at)
    VALUES ('plan-1', ?, 'owner', '2026-08-25T00:00:00.000Z')
  `).run(ownerId), /CHECK constraint failed/);

  db.prepare(`INSERT INTO craft_plan_settings (plan_key, config_json, created_at, updated_at) VALUES ('active', '{}', ?, ?)`)
    .run("2026-08-25T00:00:00.000Z", "2026-08-25T00:00:00.000Z");
  applySchemaBootstrap(db);
  assert.deepEqual({ ...db.prepare("SELECT plan_key, config_json FROM craft_plan_settings WHERE plan_key = 'active'").get() }, { plan_key: "active", config_json: "{}" });
  db.close();
});

function publicPlanDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  applySchemaBootstrap(db);
  return db;
}

function addPublicUser(db, discordId) {
  return Number(db.prepare(`
    INSERT INTO public_user_accounts (discord_id, discord_username, settings_json, created_at)
    VALUES (?, ?, '{}', '2026-08-25T00:00:00.000Z') RETURNING id
  `).get(discordId, `User ${discordId}`).id);
}

function emptyDocument(targets = []) {
  return { schemaVersion: 1, targets, routeOverrides: {}, multipliers: {}, sectionOverrides: {}, rowNameOverrides: {} };
}

test("public plan repository creates atomically, projects ACL roles, and enforces owner quotas", () => {
  const db = publicPlanDatabase();
  const ownerId = addPublicUser(db, "owner-quota");
  const editorId = addPublicUser(db, "editor-quota");
  let sequence = 0;
  const repository = publicPlans.createPublicPlanRepository(db, {
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    randomBytes: () => Buffer.from(`plan-${++sequence}`),
    tokenHmacKey: "test-public-plan-token-key",
  });

  const created = repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "First plan", document: emptyDocument() });
  assert.equal(created.role, "owner");
  assert.deepEqual(created.revisions, { document: 1, access: 1 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM public_craft_plan_events WHERE plan_id = ?").get(created.id).count, 1);
  db.prepare(`
    INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at)
    VALUES (?, ?, 'editor', ?, ?)
  `).run(created.id, editorId, "2026-08-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z");
  assert.equal(repository.planForUser(created.id, editorId).role, "editor");
  assert.equal(repository.listPlans(editorId)[0].id, created.id);

  for (let index = 1; index < 20; index += 1) {
    repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: `Active ${index}`, document: emptyDocument() });
  }
  assert.throws(
    () => repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "Active 21", document: emptyDocument() }),
    { name: "PublicPlanError", status: 409, code: "active_plan_quota" },
  );

  db.prepare("UPDATE public_craft_plans SET status = 'archived' WHERE owner_user_id = ?").run(ownerId);
  for (let index = 20; index < 100; index += 1) {
    repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: `Total ${index}`, document: emptyDocument() });
    db.prepare("UPDATE public_craft_plans SET status = 'archived' WHERE owner_user_id = ? AND status = 'active'").run(ownerId);
  }
  assert.throws(
    () => repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "Total 101", document: emptyDocument() }),
    { name: "PublicPlanError", status: 409, code: "total_plan_quota" },
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM public_craft_plans WHERE owner_user_id = ?").get(ownerId).count, 100);
  db.close();
});

test("public plan invitations store only HMACs and reject rotation, expiry, revocation, and replay", () => {
  const db = publicPlanDatabase();
  const ownerId = addPublicUser(db, "invite-owner");
  const editorId = addPublicUser(db, "invite-editor");
  let now = new Date("2026-08-25T10:00:00.000Z");
  let randomValue = 1;
  const options = {
    now: () => now,
    randomBytes: (size) => Buffer.alloc(size, randomValue++),
    tokenHmacKey: "invite-hmac-key-a",
  };
  const repository = publicPlans.createPublicPlanRepository(db, options);
  const plan = repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "Invite plan", document: emptyDocument() });

  const invite = repository.createInvite({ planId: plan.id, actorUserId: ownerId, role: "editor", expectedAccessRevision: 1 });
  assert.equal(Buffer.from(invite.token, "base64url").length, 32);
  assert.equal(invite.revisions.access, 2);
  const stored = db.prepare("SELECT token_hash FROM public_craft_plan_invites WHERE id = ?").get(invite.id);
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.token_hash, invite.token);
  assert.doesNotMatch(db.prepare("SELECT payload_json FROM public_craft_plan_events WHERE event_type = 'invite.created'").get().payload_json, new RegExp(invite.token));

  const rotated = publicPlans.createPublicPlanRepository(db, { ...options, tokenHmacKey: "invite-hmac-key-b" });
  assert.throws(
    () => rotated.acceptInvite({ inviteId: invite.id, userId: editorId, token: invite.token, expectedAccessRevision: 2 }),
    { name: "PublicPlanError", status: 404 },
  );
  const accepted = repository.acceptInvite({ inviteId: invite.id, userId: editorId, token: invite.token, expectedAccessRevision: 2 });
  assert.equal(accepted.role, "editor");
  assert.deepEqual(accepted.revisions, { document: 1, access: 3 });
  assert.throws(
    () => repository.acceptInvite({ inviteId: invite.id, userId: editorId, token: invite.token, expectedAccessRevision: 3 }),
    { name: "PublicPlanError", status: 404 },
  );

  const expired = repository.createInvite({ planId: plan.id, actorUserId: ownerId, role: "viewer", expectedAccessRevision: 3 });
  now = new Date("2026-09-01T10:00:00.001Z");
  assert.throws(
    () => repository.acceptInvite({ inviteId: expired.id, userId: addPublicUser(db, "expired-user"), token: expired.token, expectedAccessRevision: 4 }),
    { name: "PublicPlanError", status: 410, code: "invite_expired" },
  );

  now = new Date("2026-08-25T11:00:00.000Z");
  const revoked = repository.createInvite({ planId: plan.id, actorUserId: ownerId, role: "viewer", expectedAccessRevision: 4 });
  const revisionAfterRevoke = repository.revokeInvite({ planId: plan.id, inviteId: revoked.id, actorUserId: ownerId, expectedAccessRevision: 5 });
  assert.equal(revisionAfterRevoke.revisions.access, 6);
  assert.throws(
    () => repository.acceptInvite({ inviteId: revoked.id, userId: editorId, token: revoked.token, expectedAccessRevision: 6 }),
    { name: "PublicPlanError", status: 404 },
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM public_craft_plan_members WHERE plan_id = ? AND role = 'editor'").get(plan.id).count, 1);
  db.close();
});

test("public plan share links are HMAC-only bearer views with five-link quota and revocation", () => {
  const db = publicPlanDatabase();
  const ownerId = addPublicUser(db, "share-owner");
  let randomValue = 31;
  const options = {
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, randomValue++),
    tokenHmacKey: "share-hmac-key-a",
  };
  const repository = publicPlans.createPublicPlanRepository(db, options);
  const plan = repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "Share plan", document: emptyDocument() });
  const links = [];
  let accessRevision = 1;
  for (let index = 1; index <= 5; index += 1) {
    const link = repository.createShareLink({
      planId: plan.id,
      actorUserId: ownerId,
      label: `Raid group ${index}`,
      expectedAccessRevision: accessRevision,
    });
    accessRevision = link.revisions.access;
    links.push(link);
  }
  assert.equal(accessRevision, 6);
  assert.equal(Buffer.from(links[0].token, "base64url").length, 32);
  assert.throws(() => repository.createShareLink({ planId: plan.id, actorUserId: ownerId, label: "Too many", expectedAccessRevision: 6 }), {
    name: "PublicPlanError",
    status: 409,
    code: "share_link_quota",
  });
  assert.equal(repository.planForShare(plan.id, links[0].token).role, "bearer");
  const rotated = publicPlans.createPublicPlanRepository(db, { ...options, tokenHmacKey: "share-hmac-key-b" });
  assert.throws(() => rotated.planForShare(plan.id, links[0].token), { name: "PublicPlanError", status: 404 });

  const revoked = repository.revokeShareLink({
    planId: plan.id,
    shareId: links[0].id,
    actorUserId: ownerId,
    expectedAccessRevision: 6,
  });
  assert.equal(revoked.revisions.access, 7);
  assert.throws(() => repository.planForShare(plan.id, links[0].token), { name: "PublicPlanError", status: 404 });
  const stored = db.prepare("SELECT token_hash FROM public_craft_plan_share_links WHERE id = ?").get(links[1].id);
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.token_hash, links[1].token);
  const persistedText = [
    ...db.prepare("SELECT payload_json AS value FROM public_craft_plan_events").all(),
    ...db.prepare("SELECT token_hash AS value FROM public_craft_plan_share_links").all(),
  ].map((row) => row.value).join("\n");
  for (const link of links) assert.doesNotMatch(persistedText, new RegExp(link.token));
  db.close();
});

test("public plan invitation and accepted collaborator quotas are transaction-safe", () => {
  const db = publicPlanDatabase();
  const ownerId = addPublicUser(db, "collab-owner");
  let randomValue = 71;
  const repository = publicPlans.createPublicPlanRepository(db, {
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, randomValue++),
    tokenHmacKey: "collab-hmac-key",
  });
  const plan = repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "Quota plan", document: emptyDocument() });
  const invites = [];
  let accessRevision = 1;
  for (let index = 0; index < 10; index += 1) {
    const invite = repository.createInvite({ planId: plan.id, actorUserId: ownerId, role: "viewer", expectedAccessRevision: accessRevision });
    accessRevision = invite.revisions.access;
    invites.push(invite);
  }
  assert.equal(accessRevision, 11);
  assert.throws(() => repository.createInvite({ planId: plan.id, actorUserId: ownerId, role: "viewer", expectedAccessRevision: 11 }), {
    name: "PublicPlanError",
    status: 409,
    code: "invite_quota",
  });
  assert.equal(repository.planForUser(plan.id, ownerId).revisions.access, 11);

  for (let index = 0; index < invites.length; index += 1) {
    const userId = addPublicUser(db, `collaborator-${index}`);
    const accepted = repository.acceptInvite({ inviteId: invites[index].id, userId, token: invites[index].token, expectedAccessRevision: accessRevision });
    accessRevision = accepted.revisions.access;
  }
  assert.equal(accessRevision, 21);
  const overflow = repository.createInvite({ planId: plan.id, actorUserId: ownerId, role: "editor", expectedAccessRevision: 21 });
  const overflowUserId = addPublicUser(db, "collaborator-overflow");
  assert.throws(() => repository.acceptInvite({ inviteId: overflow.id, userId: overflowUserId, token: overflow.token, expectedAccessRevision: 22 }), {
    name: "PublicPlanError",
    status: 409,
    code: "collaborator_quota",
  });
  assert.equal(repository.planForUser(plan.id, ownerId).revisions.access, 22);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM public_craft_plan_members WHERE plan_id = ?").get(plan.id).count, 10);
  db.close();
});

test("public plan revisions and lifecycle enforce ACL, archive, suspension, transfer, clone, and delete", () => {
  const db = publicPlanDatabase();
  const ownerId = addPublicUser(db, "lifecycle-owner");
  const editorId = addPublicUser(db, "lifecycle-editor");
  const viewerId = addPublicUser(db, "lifecycle-viewer");
  let randomValue = 111;
  const repository = publicPlans.createPublicPlanRepository(db, {
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, randomValue++),
    tokenHmacKey: "lifecycle-hmac-key",
  });
  const plan = repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "Lifecycle plan", document: emptyDocument() });
  db.prepare(`INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'editor', ?, ?)`)
    .run(plan.id, editorId, "2026-08-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z");
  db.prepare(`INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'viewer', ?, ?)`)
    .run(plan.id, viewerId, "2026-08-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z");

  assert.throws(() => repository.updateDocument({
    planId: plan.id,
    actorUserId: editorId,
    document: emptyDocument([{ catalogKey: "items:7", quantity: "3" }]),
    expectedDocumentRevision: 9,
  }), (error) => error.status === 409 && error.currentRevisions.document === 1 && error.currentRevisions.access === 1);
  const updated = repository.updateDocument({
    planId: plan.id,
    actorUserId: editorId,
    document: emptyDocument([{ catalogKey: "items:7", quantity: "3" }]),
    expectedDocumentRevision: 1,
  });
  assert.deepEqual(updated.revisions, { document: 2, access: 1 });
  assert.throws(() => repository.updateDocument({ planId: plan.id, actorUserId: viewerId, document: emptyDocument(), expectedDocumentRevision: 2 }), {
    name: "PublicPlanError",
    status: 403,
  });

  const archived = repository.updateStatus({ planId: plan.id, actorUserId: ownerId, status: "archived", expectedAccessRevision: 1 });
  assert.deepEqual(archived.revisions, { document: 2, access: 2 });
  assert.throws(() => repository.updateDocument({ planId: plan.id, actorUserId: editorId, document: emptyDocument(), expectedDocumentRevision: 2 }), {
    name: "PublicPlanError",
    status: 423,
    code: "plan_archived",
  });
  assert.throws(() => repository.createInvite({ planId: plan.id, actorUserId: ownerId, role: "viewer", expectedAccessRevision: 2 }), {
    name: "PublicPlanError",
    status: 423,
    code: "plan_archived",
  });
  repository.updateStatus({ planId: plan.id, actorUserId: ownerId, status: "active", expectedAccessRevision: 2 });
  db.prepare("UPDATE public_craft_plans SET status = 'suspended', moderation_previous_status = 'active', access_revision = 4 WHERE id = ?").run(plan.id);
  assert.throws(() => repository.planForUser(plan.id, editorId), { name: "PublicPlanError", status: 423, code: "plan_suspended" });
  assert.deepEqual(repository.listPlans(ownerId), [], "owners must not recover suspended documents from the collection route");
  assert.deepEqual(repository.listPlans(editorId), [], "editors must not recover suspended documents from the collection route");
  assert.deepEqual(repository.listPlans(viewerId), [], "viewers must not recover suspended documents from the collection route");

  const share = db.prepare(`
    INSERT INTO public_craft_plan_share_links (id, plan_id, created_by_user_id, label, token_hash, created_at)
    VALUES ('share-lifecycle', ?, ?, 'Existing', ?, ?) RETURNING id
  `).get(plan.id, ownerId, publicPlans.publicPlanTokenHash("share-token", "lifecycle-hmac-key"), "2026-08-25T10:00:00.000Z");
  assert.equal(share.id, "share-lifecycle");
  assert.throws(() => repository.planForShare(plan.id, "share-token"), { name: "PublicPlanError", status: 404 });
  db.prepare("UPDATE public_craft_plans SET status = 'active', moderation_previous_status = NULL, access_revision = 5 WHERE id = ?").run(plan.id);

  const promoted = repository.updateMember({ planId: plan.id, actorUserId: ownerId, userId: viewerId, role: "editor", expectedAccessRevision: 5 });
  assert.equal(promoted.revisions.access, 6);
  assert.throws(() => repository.transferPlan({ planId: plan.id, actorUserId: ownerId, userId: 99999, expectedAccessRevision: 6 }), {
    name: "PublicPlanError",
    status: 409,
    code: "transfer_requires_editor",
  });
  const transferred = repository.transferPlan({ planId: plan.id, actorUserId: ownerId, userId: viewerId, expectedAccessRevision: 6 });
  assert.equal(transferred.role, "owner");
  assert.equal(transferred.revisions.access, 7);
  assert.equal(repository.planForUser(plan.id, ownerId).role, "editor");

  const cloned = repository.clonePlan({ planId: plan.id, actorUserId: ownerId, title: "Lifecycle clone", expectedAccessRevision: 7 });
  assert.equal(cloned.role, "owner");
  assert.equal(cloned.claimId, "42");
  assert.deepEqual(cloned.document.targets, [{ catalogKey: "items:7", quantity: "3" }]);
  assert.deepEqual(cloned.revisions, { document: 1, access: 1 });

  const removed = repository.removeMember({ planId: plan.id, actorUserId: viewerId, userId: editorId, expectedAccessRevision: 7 });
  assert.equal(removed.revisions.access, 8);
  const deleted = repository.deletePlan({ planId: plan.id, actorUserId: viewerId, expectedAccessRevision: 8 });
  assert.deepEqual(deleted, { ok: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM public_craft_plans WHERE id = ?").get(plan.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM public_craft_plan_events WHERE plan_id = ?").get(plan.id).count, 0);
  db.close();
});

test("public plan owners cannot enter or escape the Admin-owned suspended state", () => {
  const db = publicPlanDatabase();
  const ownerId = addPublicUser(db, "moderation-boundary-owner");
  const repository = publicPlans.createPublicPlanRepository(db, {
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, 211),
    tokenHmacKey: "moderation-boundary-key",
  });
  const plan = repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "Boundary plan", document: emptyDocument() });

  assert.throws(
    () => repository.updateStatus({ planId: plan.id, actorUserId: ownerId, status: "suspended", expectedAccessRevision: 1 }),
    { name: "PublicPlanError", status: 403, code: "moderation_required" },
  );
  assert.equal(db.prepare("SELECT status, access_revision FROM public_craft_plans WHERE id = ?").get(plan.id).status, "active");

  db.prepare("UPDATE public_craft_plans SET status = 'suspended', moderation_previous_status = 'active', access_revision = 2 WHERE id = ?").run(plan.id);
  assert.throws(
    () => repository.updateStatus({ planId: plan.id, actorUserId: ownerId, status: "active", expectedAccessRevision: 2 }),
    { name: "PublicPlanError", status: 423, code: "plan_suspended" },
  );
  assert.deepEqual({ ...db.prepare("SELECT status, access_revision FROM public_craft_plans WHERE id = ?").get(plan.id) }, { status: "suspended", access_revision: 2 });
  db.close();
});

test("public plan read and event projections redact collaboration metadata by role", () => {
  const db = publicPlanDatabase();
  const ownerId = addPublicUser(db, "projection-owner");
  const editorId = addPublicUser(db, "projection-editor");
  const viewerId = addPublicUser(db, "projection-viewer");
  let randomValue = 151;
  const repository = publicPlans.createPublicPlanRepository(db, {
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, randomValue++),
    tokenHmacKey: "projection-hmac-key",
  });
  const plan = repository.createPlan({ ownerUserId: ownerId, claimId: "42", title: "Projection plan", document: emptyDocument() });
  db.prepare(`INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'editor', ?, ?)`)
    .run(plan.id, editorId, "2026-08-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z");
  db.prepare(`INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'viewer', ?, ?)`)
    .run(plan.id, viewerId, "2026-08-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z");
  const invite = repository.createInvite({ planId: plan.id, actorUserId: ownerId, role: "viewer", expectedAccessRevision: 1 });
  const share = repository.createShareLink({ planId: plan.id, actorUserId: ownerId, label: "Public board", expectedAccessRevision: 2 });

  const owner = repository.planDetailsForUser(plan.id, ownerId);
  assert.equal(owner.access.members.length, 2);
  assert.equal(owner.access.invites.length, 1);
  assert.equal(owner.access.shareLinks.length, 1);
  assert.doesNotMatch(JSON.stringify(owner), new RegExp(`${invite.token}|${share.token}|token_hash`));

  const editor = repository.planDetailsForUser(plan.id, editorId);
  assert.equal(editor.access.members.length, 2);
  assert.equal("invites" in editor.access, false);
  assert.equal("shareLinks" in editor.access, false);

  const viewer = repository.planDetailsForUser(plan.id, viewerId);
  assert.equal("access" in viewer, false);
  const bearer = repository.planForShare(plan.id, share.token);
  assert.equal("access" in bearer, false);

  const editorEvents = repository.eventsForUser(plan.id, editorId);
  assert.ok(editorEvents.some((event) => event.actor?.username === "User projection-owner"));
  assert.ok(editorEvents.some((event) => event.payload.inviteId === invite.id));
  const viewerEvents = repository.eventsForUser(plan.id, viewerId);
  assert.ok(viewerEvents.length > 0);
  assert.ok(viewerEvents.every((event) => !("actor" in event) && !("payload" in event)));
  db.close();
});

test("public plan computation uses only public settlement sources and isolates plan, claim, revision, and view caches", async () => {
  const snapshots = new Map([
    ["42", {
      claimId: "42",
      regionId: "19",
      sourceRevision: "snapshot-42-a",
      receivedAt: "2026-08-25T10:00:00.000Z",
      domains: {
        inventories: { data: { buildings: [{ entityId: "420", name: "Shared chest", items: [{ itemId: "7", itemType: "item", quantity: "2", catalogKey: "items:7" }] }] }, warnings: [] },
        crafts: { data: { craftResults: [{ entityId: "421", ownerEntityId: "900", ownerUsername: "Crafter", buildingName: "Workshop", completed: false, craftedItem: [{ itemId: "7", itemType: "item", quantity: "3", catalogKey: "items:7" }] }] }, warnings: [] },
      },
      warnings: [],
    }],
    ["43", {
      claimId: "43",
      regionId: "20",
      sourceRevision: "snapshot-43-a",
      receivedAt: "2026-08-25T10:00:00.000Z",
      domains: {
        inventories: { data: { buildings: [{ entityId: "430", name: "Other chest", items: [{ itemId: "7", itemType: "item", quantity: "9", catalogKey: "items:7" }] }] }, warnings: [] },
        crafts: { data: { craftResults: [] }, warnings: [] },
      },
      warnings: [],
    }],
  ]);
  const dataCalls = [];
  const data = {
    snapshot: async (claimId, domains) => {
      dataCalls.push([claimId, domains]);
      return structuredClone(snapshots.get(claimId));
    },
  };
  const catalogCalls = [];
  const catalog = {
    recipe: async (kind, id) => {
      catalogCalls.push([kind, id]);
      return { detail: { item: { id, itemType: 0, name: `Item ${id}` }, craftingRecipes: [], extractionRecipes: [] }, provider: "relay" };
    },
  };
  const computation = publicPlans.createPublicPlanComputationService({ data, catalog });
  const plan42 = { id: "plan-42", claimId: "42", title: "Forty two", document: emptyDocument([{ catalogKey: "items:7", quantity: "10" }]), revisions: { document: 1, access: 1 }, role: "editor" };
  const plan43 = { ...plan42, id: "plan-43", claimId: "43", title: "Forty three" };

  const detailed42 = await computation.compute(plan42);
  assert.equal(detailed42.available, true);
  assert.equal(detailed42.plan.targets[0].available, 2);
  assert.equal(detailed42.plan.targets[0].inProgress, 3);
  assert.equal(detailed42.plan.targets[0].missing, 5);
  assert.equal(detailed42.plan.materials[0].sources[0].sourceId, "420");
  assert.equal(detailed42.plan.materials[0].activeCraftSources[0].craftId, "421");
  assert.deepEqual(detailed42.plan.config.sourceRules.craftPlayerIds, ["900"]);

  const cached42 = await computation.compute(plan42);
  assert.strictEqual(cached42, detailed42);
  const redacted42 = await computation.compute({ ...plan42, role: "viewer" });
  assert.equal(redacted42.available, true);
  assert.equal("sources" in redacted42.plan.materials[0], false);
  assert.equal("activeCraftSources" in redacted42.plan.materials[0], false);
  assert.equal("sourceRules" in redacted42.plan.config, false);
  assert.doesNotMatch(JSON.stringify(redacted42.plan), /"(?:source|player|crafter|container|entity|craft|owner|building|storage|bank|deployable)Ids?"/i);
  assert.notStrictEqual(redacted42, detailed42);

  const detailed43 = await computation.compute(plan43);
  assert.equal(detailed43.plan.targets[0].available, 9);
  assert.equal(detailed43.plan.targets[0].missing, 1);
  assert.notStrictEqual(detailed43, detailed42);
  assert.ok(dataCalls.every(([, domains]) => domains === "inventories,crafts"));
  assert.deepEqual([...new Set(catalogCalls.map((call) => call.join(":")))], ["item:7"]);

  snapshots.get("42").sourceRevision = "snapshot-42-b";
  snapshots.get("42").domains.inventories.data.buildings[0].items[0].quantity = "4";
  const refreshed42 = await computation.compute(plan42);
  assert.notStrictEqual(refreshed42, detailed42);
  assert.equal(refreshed42.plan.targets[0].available, 4);

  const unsafe = await computation.compute({ ...plan42, id: "unsafe", document: emptyDocument([{ catalogKey: "items:7", quantity: "9007199254740993" }]) });
  assert.equal(unsafe.available, false);
  assert.deepEqual(unsafe.document, plan42.document.targets[0].quantity === "10" ? emptyDocument([{ catalogKey: "items:7", quantity: "9007199254740993" }]) : null);
  assert.equal(unsafe.warnings[0].code, "public_plan_computation_unavailable");

  snapshots.get("43").domains.crafts = { data: null, warnings: [{ code: "relay_crafts_unavailable", message: "Craft data unavailable" }] };
  snapshots.get("43").sourceRevision = "snapshot-43-b";
  const unavailable = await computation.compute(plan43);
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.document, plan43.document);
  assert.equal(unavailable.warnings[0].code, "public_plan_computation_unavailable");
  assert.match(unavailable.warnings[0].message, /current claim and catalog data/);
});

test("public plan computation fails closed when any required catalog node is unavailable", async () => {
  const document = emptyDocument([{ catalogKey: "items:7", quantity: "1" }]);
  const computation = publicPlans.createPublicPlanComputationService({
    data: {
      snapshot: async () => ({
        claimId: "42",
        sourceRevision: "catalog-missing-a",
        receivedAt: "2026-08-25T10:00:00.000Z",
        domains: {
          inventories: { data: { buildings: [] }, warnings: [] },
          crafts: { data: { craftResults: [] }, warnings: [] },
        },
        warnings: [],
      }),
    },
    catalog: {
      recipe: async () => {
        throw Object.assign(new Error("missing"), { status: 404 });
      },
    },
  });

  const result = await computation.compute({
    id: "catalog-missing",
    claimId: "42",
    title: "Missing catalog",
    document,
    revisions: { document: 1, access: 1 },
    role: "viewer",
  });

  assert.equal(result.available, false);
  assert.deepEqual(result.document, document);
  assert.equal(result.warnings[0].code, "public_plan_computation_unavailable");
});

test("public plan computation fails closed before returning an unsafe aggregate quantity", async () => {
  const document = emptyDocument([{ catalogKey: "items:7", quantity: "1" }]);
  const unsafeQuantity = String(Number.MAX_SAFE_INTEGER);
  const computation = publicPlans.createPublicPlanComputationService({
    data: {
      snapshot: async () => ({
        claimId: "42",
        sourceRevision: "unsafe-aggregate-a",
        receivedAt: "2026-08-25T10:00:00.000Z",
        domains: {
          inventories: {
            data: {
              buildings: ["420", "421"].map((entityId) => ({
                entityId,
                name: `Shared chest ${entityId}`,
                items: [{ itemId: "7", itemType: "item", quantity: unsafeQuantity, catalogKey: "items:7" }],
              })),
            },
            warnings: [],
          },
          crafts: { data: { craftResults: [] }, warnings: [] },
        },
        warnings: [],
      }),
    },
    catalog: {
      recipe: async () => ({ detail: { item: { id: "7", itemType: 0, name: "Item 7" }, craftingRecipes: [], extractionRecipes: [] }, provider: "relay" }),
    },
  });

  const result = await computation.compute({
    id: "unsafe-aggregate",
    claimId: "42",
    title: "Unsafe aggregate",
    document,
    revisions: { document: 1, access: 1 },
    role: "owner",
  });

  assert.equal(result.available, false);
  assert.deepEqual(result.document, document);
  assert.equal(result.warnings[0].code, "public_plan_computation_unavailable");
});

test("public plan computation retains all one hundred validated targets without changing Timbersteel limits", async () => {
  const targets = Array.from({ length: 100 }, (_, index) => ({ catalogKey: `items:${index + 1}`, quantity: "1" }));
  const computation = publicPlans.createPublicPlanComputationService({
    data: {
      snapshot: async () => ({
        claimId: "42",
        regionId: "19",
        sourceRevision: "hundred-a",
        receivedAt: "2026-08-25T10:00:00.000Z",
        domains: {
          inventories: { data: { buildings: [] }, warnings: [] },
          crafts: { data: { craftResults: [] }, warnings: [] },
        },
        warnings: [],
      }),
    },
    catalog: {
      recipe: async (_kind, id) => ({ detail: { item: { id, itemType: 0, name: `Item ${id}` }, craftingRecipes: [], extractionRecipes: [] } }),
    },
  });
  const result = await computation.compute({
    id: "hundred-plan",
    claimId: "42",
    title: "Hundred targets",
    document: emptyDocument(targets),
    revisions: { document: 1, access: 1 },
    role: "owner",
  });

  assert.equal(result.available, true);
  assert.equal(result.plan.targets.length, 100);
  assert.equal(result.plan.materials.length, 100);
});

test("public viewer computation projection removes every source and crafter identity while detailed views remain intact", () => {
  const detailed = {
    config: {
      targets: [{ id: "7", kind: "items" }],
      sourceRules: {
        storageContainerIds: ["container-1"],
        playerIds: [],
        craftPlayerIds: ["crafter-900"],
        bankPlayerIds: [],
        bankContainerIds: [],
        deployableContainerIds: [],
      },
    },
    materials: [{ key: "items:7", id: "7", sources: [{ sourceId: "chest-1", entityId: "building-420" }], activeCraftSources: [{ craftId: "craft-421", playerId: "crafter-900" }] }],
    personalViews: { fishing: { tiers: [{ routes: { ocean: { playerEntityId: "crafter-900", sources: [{ sourceId: "chest-2" }], activeCraftSources: [{ craftId: "craft-2" }] } } }] } },
    source: { revision: "snapshot-a" },
  };
  const redacted = publicPlans.redactPublicPlanComputation(detailed);
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /sourceRules|activeCraftSources|"sources"|sourceId|craftId|playerId|entityId|chest-|container-|crafter-|building-|craft-/i);
  assert.match(serialized, /"id":"7"/, "typed item identity must remain available in the aggregate projection");
  assert.deepEqual(redacted.source, { revision: "snapshot-a" });
  assert.equal(detailed.materials[0].sources[0].sourceId, "chest-1");
  assert.deepEqual(detailed.config.sourceRules.craftPlayerIds, ["crafter-900"], "owner/editor detail must remain intact");
});

test("public plan ownership transfer enforces the recipient active and total owner quotas atomically", () => {
  const db = publicPlanDatabase();
  const sourceOwnerId = addPublicUser(db, "transfer-source-owner");
  const recipientId = addPublicUser(db, "transfer-recipient");
  let randomValue = 191;
  const repository = publicPlans.createPublicPlanRepository(db, {
    now: () => new Date("2026-08-25T10:00:00.000Z"),
    randomBytes: (size) => Buffer.alloc(size, randomValue++),
    tokenHmacKey: "transfer-quota-hmac-key",
  });
  const source = repository.createPlan({ ownerUserId: sourceOwnerId, claimId: "42", title: "Transfer source", document: emptyDocument() });
  db.prepare(`INSERT INTO public_craft_plan_members (plan_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'editor', ?, ?)`)
    .run(source.id, recipientId, "2026-08-25T10:00:00.000Z", "2026-08-25T10:00:00.000Z");
  for (let index = 0; index < 20; index += 1) {
    repository.createPlan({ ownerUserId: recipientId, claimId: "43", title: `Recipient active ${index}`, document: emptyDocument() });
  }
  assert.throws(() => repository.transferPlan({ planId: source.id, actorUserId: sourceOwnerId, userId: recipientId, expectedAccessRevision: 1 }), {
    name: "PublicPlanError",
    status: 409,
    code: "active_plan_quota",
  });
  assert.equal(repository.planForUser(source.id, sourceOwnerId).role, "owner");

  db.prepare("UPDATE public_craft_plans SET status = 'archived' WHERE owner_user_id = ?").run(recipientId);
  for (let index = 20; index < 100; index += 1) {
    repository.createPlan({ ownerUserId: recipientId, claimId: "43", title: `Recipient total ${index}`, document: emptyDocument() });
    db.prepare("UPDATE public_craft_plans SET status = 'archived' WHERE owner_user_id = ? AND status = 'active'").run(recipientId);
  }
  assert.throws(() => repository.transferPlan({ planId: source.id, actorUserId: sourceOwnerId, userId: recipientId, expectedAccessRevision: 1 }), {
    name: "PublicPlanError",
    status: 409,
    code: "total_plan_quota",
  });
  assert.equal(repository.planForUser(source.id, sourceOwnerId).revisions.access, 1);
  db.close();
});
