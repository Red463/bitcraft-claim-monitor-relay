import assert from "node:assert/strict";
import test from "node:test";

import {
  projectCraftContributionEnvelope,
  projectCraftContributions,
} from "../src/server/craftContributionProjection.mjs";
import { formatDecimalQuantity } from "../src/server/game-data/inventoryProjection.ts";

test("durable contribution history projects whole XP and contributor attribution", () => {
  const projected = projectCraftContributions([{
    craft_entity_id: "1369094287428103662",
    contributor_entity_id: "576460752388321942",
    contributor_name: "Mosswick",
    contributed_progress: "9007199254740993",
    contributed_xp: "42.24",
    contribution_count: "12",
    attribution_confidence: "authoritative",
    first_contributed_at: "2026-08-01T08:00:00.000Z",
    last_contributed_at: "2026-08-01T09:00:00.000Z",
  }, {
    craft_entity_id: "1369094287428103662",
    contributor_entity_id: "576460752388321943",
    contributor_name: "Fenn",
    contributed_progress: "4",
    contributed_xp: "3.52",
    contribution_count: "1",
    attribution_confidence: "joined",
    first_contributed_at: "2026-08-01T07:00:00.000Z",
    last_contributed_at: "2026-08-01T10:00:00.000Z",
  }, {
    craft_entity_id: "1369094287428103662",
    contributor_entity_id: null,
    contributor_name: "Unknown contributor",
    contributed_progress: "1",
    contributed_xp: "0.25",
    contribution_count: "1",
    attribution_confidence: "unknown",
    first_contributed_at: "2026-08-01T06:00:00.000Z",
    last_contributed_at: "2026-08-01T11:00:00.000Z",
  }]);
  assert.deepEqual(projected, {
    "1369094287428103662": [{
      contributorEntityId: null,
      contributorUsername: "Unknown contributor",
      totalProgressContributed: "1",
      totalXpContributed: "0",
      contributionCount: "1",
      attributionConfidence: "unknown",
      firstContributedAt: "2026-08-01T06:00:00.000Z",
      lastContributedAt: "2026-08-01T11:00:00.000Z",
    }, {
      contributorEntityId: "576460752388321943",
      contributorUsername: "Fenn",
      totalProgressContributed: "4",
      totalXpContributed: "4",
      contributionCount: "1",
      attributionConfidence: "joined",
      firstContributedAt: "2026-08-01T07:00:00.000Z",
      lastContributedAt: "2026-08-01T10:00:00.000Z",
    }, {
      contributorEntityId: "576460752388321942",
      contributorUsername: "Mosswick",
      totalProgressContributed: "9007199254740993",
      totalXpContributed: "42",
      contributionCount: "12",
      attributionConfidence: "authoritative",
      firstContributedAt: "2026-08-01T08:00:00.000Z",
      lastContributedAt: "2026-08-01T09:00:00.000Z",
    }],
  });
  assert.equal(
    formatDecimalQuantity(projected["1369094287428103662"][2].totalXpContributed),
    "42",
  );
});

test("malformed durable contribution rows fail instead of inventing identifiers or amounts", () => {
  assert.throws(() => projectCraftContributions([{
    craft_entity_id: "craft",
    contributor_entity_id: "1",
    contributed_progress: "2",
    contributed_xp: "3",
    contribution_count: "1",
  }]), /craft entity id/i);
  assert.throws(() => projectCraftContributions([{
    craft_entity_id: "1",
    contributor_entity_id: "2",
    contributed_progress: "2",
    contributed_xp: "3",
    contribution_count: "1",
    attribution_confidence: "guessed",
  }]), /attribution confidence/i);
});

test("integral legacy REAL totals normalize to whole browser semantics", () => {
  const projected = projectCraftContributions([{
    craft_entity_id: "1369094287428103662",
    contributor_entity_id: "576460752388321942",
    contributor_name: "Mosswick",
    contributed_progress: "24.0",
    contributed_xp: "48.000",
    contribution_count: "1.0",
    attribution_confidence: "authoritative",
  }]);

  assert.equal(projected["1369094287428103662"][0].totalProgressContributed, "24");
  assert.equal(projected["1369094287428103662"][0].totalXpContributed, "48");
  assert.equal(projected["1369094287428103662"][0].contributionCount, "1");
  assert.throws(() => projectCraftContributions([{
    craft_entity_id: "1",
    contributor_entity_id: "2",
    contributed_progress: "24.5",
    contributed_xp: "48",
    contribution_count: "1",
  }]), /contributed progress/i);
});

test("non-integral legacy totals become explicit partial evidence", () => {
  const envelope = projectCraftContributionEnvelope([{
    craft_entity_id: "1",
    contributor_entity_id: "2",
    contributed_progress: "24.5",
    contributed_xp: "48",
    contribution_count: "1",
  }]);

  assert.deepEqual(envelope.data, { byCraft: {}, observedSince: null });
  assert.equal(envelope.warnings.length, 1);
  assert.match(envelope.warnings[0], /row 0 is unavailable.*contributed progress/i);
});

test("envelope returns structured craft contributions with the earliest observed time", () => {
  const envelope = projectCraftContributionEnvelope([{
    craft_entity_id: "1",
    contributor_entity_id: "2",
    contributor_name: "Mosswick",
    contributed_progress: "2",
    contributed_xp: "1.5",
    contribution_count: "1",
    attribution_confidence: "authoritative",
    first_contributed_at: "2026-08-01T09:00:00.000Z",
  }, {
    craft_entity_id: "1",
    contributor_entity_id: "3",
    contributor_name: "Fenn",
    contributed_progress: "1",
    contributed_xp: "invalid",
    contribution_count: "1",
    attribution_confidence: "joined",
    first_contributed_at: "2026-08-01T05:00:00.000Z",
  }, {
    craft_entity_id: "4",
    contributor_entity_id: null,
    contributor_name: "Unknown contributor",
    contributed_progress: "1",
    contributed_xp: "0.25",
    contribution_count: "1",
    attribution_confidence: "unknown",
    first_contributed_at: "2026-08-01T07:00:00.000Z",
  }]);

  assert.equal(envelope.data.observedSince, "2026-08-01T05:00:00.000Z");
  assert.equal(envelope.data.byCraft["1"][0].totalXpContributed, "2");
  assert.equal(envelope.data.byCraft["4"][0].contributorEntityId, null);
  assert.equal(envelope.warnings.length, 1);
  assert.match(envelope.warnings[0], /row 1 is unavailable.*contributed xp/i);
});
