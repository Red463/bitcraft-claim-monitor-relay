import assert from "node:assert/strict";
import test from "node:test";

const { resolveCraftContributionAttribution } = await import(
  new URL("../src/server/game-data/craftContributionAttribution.ts", import.meta.url).href,
);

const target = {
  craftEntityId: "1369094287471625781",
  buildingEntityId: "1369094286799419104",
  recipeId: "307004",
};

const members = [{
  entityId: "576460752388321942",
  name: "Ada",
  identityHex: "0xabc",
}];

function craftContinueEvent(craftEntityId = 1369094287471625781n) {
  return {
    tag: "Reducer",
    value: {
      callerIdentity: { toHexString: () => "0xabc" },
      reducer: {
        tag: "CraftContinue",
        value: {
          request: {
            progressiveActionEntityId: craftEntityId,
            timestamp: 1785675248960n,
          },
        },
      },
    },
  };
}

function eligibleActionRow(overrides = {}) {
  return {
    autoId: 94295n,
    entityId: 576460752388321942n,
    startTime: 1785675248960n,
    duration: 1274n,
    target: 1369094286799419104n,
    recipeId: 307004,
    actionType: { tag: "Craft", value: undefined },
    lastActionResult: { tag: "Success", value: undefined },
    clientCancel: false,
    wasConsumed: false,
    ...overrides,
  };
}

test("attributes a matching craft continue reducer caller authoritatively", () => {
  const attribution = resolveCraftContributionAttribution({
    event: craftContinueEvent(),
    target,
    members,
    actionRows: [],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "authoritative",
    contributorEntityId: "576460752388321942",
    contributorName: "Ada",
    evidenceKey: "reducer:0xabc",
  });
});

test("attributes CraftContinueStart through the canonical identity field", () => {
  const event = craftContinueEvent();
  event.value.callerIdentity = { __identity__: "0xabc" };
  event.value.reducer.tag = "CraftContinueStart";

  const attribution = resolveCraftContributionAttribution({
    event,
    target,
    members,
    actionRows: [],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "authoritative",
    contributorEntityId: "576460752388321942",
    contributorName: "Ada",
    evidenceKey: "reducer:0xabc",
  });
});

test("falls back to canonical identity when toHexString throws", () => {
  const event = craftContinueEvent();
  event.value.callerIdentity = {
    toHexString: () => { throw new Error("SDK identity formatting failed"); },
    __identity__: "0xabc",
  };

  const attribution = resolveCraftContributionAttribution({
    event,
    target,
    members,
    actionRows: [],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "authoritative",
    contributorEntityId: "576460752388321942",
    contributorName: "Ada",
    evidenceKey: "reducer:0xabc",
  });
});

test("rejects a reducer event for a different craft", () => {
  const attribution = resolveCraftContributionAttribution({
    event: craftContinueEvent(1369094287471625782n),
    target,
    members,
    actionRows: [],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "unknown",
    contributorEntityId: null,
    contributorName: "Unknown contributor",
    evidenceKey: "unknown:no-match",
  });
});

test("joins the one eligible configured member action for a transaction", () => {
  const attribution = resolveCraftContributionAttribution({
    event: { tag: "Transaction" },
    target,
    members,
    actionRows: [eligibleActionRow()],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "joined",
    contributorEntityId: "576460752388321942",
    contributorName: "Ada",
    evidenceKey: "action:94295",
  });
});

test("ignores action rows that are cancelled, not craft, unsuccessful, or outside the window", () => {
  const attribution = resolveCraftContributionAttribution({
    event: { tag: "Transaction" },
    target,
    members,
    actionRows: [
      eligibleActionRow({ clientCancel: true }),
      eligibleActionRow({ actionType: { tag: "Travel", value: undefined } }),
      eligibleActionRow({ lastActionResult: { tag: "Failed", value: undefined } }),
      eligibleActionRow({ startTime: 1785670000000n }),
    ],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "unknown",
    contributorEntityId: null,
    contributorName: "Unknown contributor",
    evidenceKey: "unknown:no-match",
  });
});

test("returns unknown rather than guessing when two member actions are eligible", () => {
  const attribution = resolveCraftContributionAttribution({
    event: { tag: "Transaction" },
    target,
    members: [
      ...members,
      { entityId: "576460752388321943", name: "Grace", identityHex: "0xdef" },
    ],
    actionRows: [
      eligibleActionRow(),
      eligibleActionRow({ autoId: 94296n, entityId: 576460752388321943n }),
    ],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "unknown",
    contributorEntityId: null,
    contributorName: "Unknown contributor",
    evidenceKey: "unknown:ambiguous",
  });
});

test("returns unknown when no configured member action is eligible", () => {
  const attribution = resolveCraftContributionAttribution({
    event: { tag: "Transaction" },
    target,
    members,
    actionRows: [eligibleActionRow({ entityId: 576460752388321999n })],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "unknown",
    contributorEntityId: null,
    contributorName: "Unknown contributor",
    evidenceKey: "unknown:no-match",
  });
});

test("does not coerce an unresolved reducer identity into a contributor", () => {
  const attribution = resolveCraftContributionAttribution({
    event: {
      tag: "Reducer",
      value: {
        callerIdentity: { unknown: "object" },
        reducer: craftContinueEvent().value.reducer,
      },
    },
    target,
    members,
    actionRows: [],
    observedAtMs: 1785675249000,
  });

  assert.deepEqual(attribution, {
    confidence: "unknown",
    contributorEntityId: null,
    contributorName: "Unknown contributor",
    evidenceKey: "unknown:unresolved-identity",
  });
});

test("rejects an unsafe numeric target identifier", () => {
  assert.throws(() => resolveCraftContributionAttribution({
    event: { tag: "Transaction" },
    target: { ...target, buildingEntityId: 1369094286799419104 },
    members,
    actionRows: [],
    observedAtMs: 1785675249000,
  }), /decimal string/i);
});
