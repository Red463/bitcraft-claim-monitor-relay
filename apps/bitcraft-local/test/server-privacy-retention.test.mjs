import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { RETENTION, privacyRetentionPlan, runPrivacyRetention } from "../src/server/privacyRetention.mjs";
import { applySchemaBootstrap } from "../src/server/schemaBootstrap.mjs";

test("privacy retention policy preserves the approved exact periods", () => {
  assert.equal(RETENTION.userSessionsDays, 30);
  assert.equal(RETENTION.adminSessionsDays, 7);
  assert.equal(RETENTION.fullIpDays, 7);
  assert.equal(RETENTION.analyticsDays, 90);
  assert.equal(RETENTION.discordDeliveryDays, 90);
  assert.equal(RETENTION.discordDeliveryMaximumRows, 250);
  assert.equal(RETENTION.assignmentAuditDays, 365);
  assert.equal(RETENTION.inactiveAccountMonths, 24);
  assert.equal(RETENTION.inactiveWarningDays, 30);
  assert.equal(RETENTION.deletionLedgerDays, 90);
  const plan = privacyRetentionPlan(new Date("2026-07-25T12:00:00.000Z"));
  assert.equal(plan.inactiveDelete, "2024-07-25T12:00:00.000Z");
  assert.equal(plan.inactiveWarn, "2024-08-24T12:00:00.000Z");
});

test("retention dry-run is non-mutating and execution warns once then routes inactive deletion", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  const insert = db.prepare(`
    INSERT INTO user_accounts (
      discord_id, discord_username, character_status, settings_json,
      created_at, last_login_at, inactivity_warning_sent_at
    ) VALUES (?, ?, 'unlinked', '{}', ?, ?, NULL)
  `);
  const deleting = insert.run("111111111111111111", "DeleteMe", "2024-07-20T12:00:00.000Z", "2024-07-20T12:00:00.000Z");
  const warning = insert.run("222222222222222222", "WarnMe", "2024-08-10T12:00:00.000Z", "2024-08-10T12:00:00.000Z");
  db.prepare("INSERT INTO analytics_events (visitor_key, session_key, event_name, page, properties_json, occurred_at) VALUES ('v', 's', 'page_view', 'dashboard', '{}', '2026-01-01T00:00:00.000Z')").run();
  const dryRun = await runPrivacyRetention(db, { now: new Date("2026-07-25T12:00:00.000Z"), dryRun: true });
  assert.equal(dryRun.counts.analytics_events, 1);
  assert.equal(dryRun.counts.inactive_accounts, 1);
  assert.equal(dryRun.counts.inactivity_warnings, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM analytics_events").get().count, 1);

  const warnings = [];
  const deletions = [];
  const result = await runPrivacyRetention(db, {
    now: new Date("2026-07-25T12:00:00.000Z"),
    sendInactiveWarning: async (account) => warnings.push(account.id),
    deleteInactiveAccount: async (account) => deletions.push(account.id),
  });
  assert.deepEqual(warnings, [Number(warning.lastInsertRowid)]);
  assert.deepEqual(deletions, [Number(deleting.lastInsertRowid)]);
  assert.equal(result.counts.analytics_events, 1);
  assert.ok(db.prepare("SELECT inactivity_warning_sent_at FROM user_accounts WHERE id = ?").get(Number(warning.lastInsertRowid)).inactivity_warning_sent_at);
  const repeated = await runPrivacyRetention(db, {
    now: new Date("2026-07-25T12:00:00.000Z"),
    sendInactiveWarning: async (account) => warnings.push(account.id),
    deleteInactiveAccount: async () => undefined,
  });
  assert.equal(repeated.counts.inactivity_warnings, 0);
  assert.deepEqual(warnings, [Number(warning.lastInsertRowid)]);
  db.close();
});

test("privacy retention reports only dedicated account and session operations", async () => {
  const db = new DatabaseSync(":memory:");
  applySchemaBootstrap(db);
  const result = await runPrivacyRetention(db, { now: new Date("2026-08-26T12:00:00.000Z"), dryRun: true });
  assert.equal(Object.keys(result.counts).some((key) => key.startsWith("public_")), false);
  assert.equal(Object.hasOwn(result, "publicDeletions"), false);
  db.close();
});
