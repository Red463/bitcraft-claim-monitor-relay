import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  committedDeletionSubjects,
  coordinatePrivacyDeletion,
  deletionLedgerSubject,
  readDeletionLedger,
  replayPrivacyDeletions,
} from "../src/server/privacyDeletionLedger.mjs";
import * as deletionLedger from "../src/server/privacyDeletionLedger.mjs";
import * as legalPolicy from "../src/legal/legalPolicy.mjs";

test("signed deletion ledger coordinates commits without storing raw identifiers", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "privacy-ledger-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const key = Buffer.alloc(32, 7).toString("base64url");
  const discordId = "111111111111111111";
  const result = coordinatePrivacyDeletion({
    ledgerPath,
    key,
    discordId,
    deleteAccount: (operationId) => ({ receiptId: operationId }),
    now: () => new Date("2026-07-25T12:00:00.000Z"),
    randomUUID: () => "operation-one",
  });
  const text = readFileSync(ledgerPath, "utf8");
  const records = readDeletionLedger(ledgerPath, [key]);

  assert.equal(result.receiptId, "operation-one");
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.state), ["pending", "committed"]);
  assert.equal(records[0].subject, deletionLedgerSubject(discordId, key));
  assert.doesNotMatch(text, new RegExp(discordId));
  assert.doesNotMatch(text, /username|character/i);
  assert.deepEqual([...committedDeletionSubjects(records, new Date("2026-07-26T00:00:00.000Z"))], [records[0].subject]);
});

test("ledger rejects tampering, ignores pending records, and replays committed deletions idempotently", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "privacy-ledger-"));
  const ledgerPath = path.join(directory, "ledger.jsonl");
  const key = Buffer.alloc(32, 9).toString("base64url");
  coordinatePrivacyDeletion({
    ledgerPath,
    key,
    discordId: "111111111111111111",
    deleteAccount: () => ({ ok: true }),
    now: () => new Date("2026-07-25T12:00:00.000Z"),
    randomUUID: () => "operation-one",
  });
  const records = readDeletionLedger(ledgerPath, [key]);
  const deleted = new Set();
  const replay = () => replayPrivacyDeletions({
    records,
    accounts: [
      { id: 1, discordId: "111111111111111111" },
      { id: 2, discordId: "222222222222222222" },
    ].filter((account) => !deleted.has(account.id)),
    key,
    deleteAccount: (account) => deleted.add(account.id),
    now: new Date("2026-07-26T00:00:00.000Z"),
  });

  assert.deepEqual(replay(), { deleted: 1 });
  assert.deepEqual(replay(), { deleted: 0 });
  assert.deepEqual([...deleted], [1]);

  const tamperedPath = path.join(directory, "tampered.jsonl");
  const tampered = readFileSync(ledgerPath, "utf8").replace('"state":"committed"', '"state":"aborted"');
  writeFileSync(tamperedPath, tampered);
  assert.throws(() => readDeletionLedger(tamperedPath, [key]), /verification failed/);
});

test("retired public legal and privacy deletion exports are absent", () => {
  assert.equal("publicDeletionLedgerSubject" in deletionLedger, false);
  assert.equal("coordinatePublicPrivacyDeletion" in deletionLedger, false);
  assert.equal("replayPublicPrivacyDeletions" in deletionLedger, false);
  assert.equal("claimMonitorLegalPolicyForEnvironment" in legalPolicy, false);
});
