import assert from "node:assert/strict";
import test from "node:test";

import { selectCraftPlanningEffortView } from "../src/pages/craftPlanningEffortView.ts";

test("effort view discloses partial source coverage across Fishing routes without hiding current progress", () => {
  const selected = selectCraftPlanningEffortView({
    state: "ready", sourceCoverageIncomplete: true,
    overall: { state: "ready", baselineEffort: 100, remainingEffort: 65, completion: 35 },
    unavailableSources: [{ label: "Mosswick bank" }],
  }, "ocean");
  assert.equal(selected.sourceCoverageIncomplete, true);
  assert.equal(selected.overall.completion, 35);
  assert.equal(selected.stale, false);
  assert.equal(selected.unavailableSources[0].label, "Mosswick bank");
});

test("effort view selects matching Fishing and overall aggregates", () => {
  const selected = selectCraftPlanningEffortView({
    state: "ready",
    overall: { state: "ready", baselineEffort: 100, remainingEffort: 50, completion: 50 },
    sections: { Carpentry: { state: "ready", baselineEffort: 20, remainingEffort: 5, completion: 75 } },
    fishingVariants: { lake: {
      overall: { state: "ready", baselineEffort: 80, remainingEffort: 30.96, completion: 61.3 },
      sections: { Fishing: { state: "ready", baselineEffort: 50, remainingEffort: 21.4, completion: 57.2 } },
    } },
  }, "lake");
  assert.equal(selected.overall.completion, 61.3);
  assert.equal(selected.sections.Fishing.completion, 57.2);
  assert.equal(selected.sections.Carpentry.completion, 75);
  assert.equal(selected.route, "lake");
});

test("effort view preserves unavailable states", () => {
  const selected = selectCraftPlanningEffortView({ state: "unavailable", warnings: ["Catalog refresh required"] }, "ocean");
  assert.equal(selected.overall.completion, null);
  assert.equal(selected.state, "unavailable");
  assert.deepEqual(selected.warnings, ["Catalog refresh required"]);
});

test("effort view preserves valid empty progress as complete", () => {
  const selected = selectCraftPlanningEffortView({
    state: "empty",
    overall: { state: "empty", baselineEffort: 0, remainingEffort: 0, completion: 100 },
    sections: {},
  }, "ocean");
  assert.equal(selected.state, "empty");
  assert.equal(selected.overall.state, "empty");
  assert.equal(selected.overall.completion, 100);
});

test("effort view falls back to root progress when the selected Fishing route has no aggregate", () => {
  const selected = selectCraftPlanningEffortView({
    state: "ready",
    overall: { state: "ready", baselineEffort: 100, remainingEffort: 40, completion: 60 },
    sections: { Fishing: { state: "ready", baselineEffort: 100, remainingEffort: 40, completion: 60 } },
    fishingVariants: { ocean: {
      overall: { state: "ready", baselineEffort: 100, remainingEffort: 40, completion: 60 },
      sections: { Fishing: { state: "ready", baselineEffort: 100, remainingEffort: 40, completion: 60 } },
    } },
    warnings: ["Root warning"],
  }, "lake");
  assert.equal(selected.overall.completion, 60);
  assert.equal(selected.sections.Fishing.completion, 60);
  assert.deepEqual(selected.warnings, [
    "The selected lake Fishing route has no specialised effort estimate; showing the general Fishing estimate.",
    "Root warning",
  ]);
});

test("effort view preserves selected Fishing route and root warnings", () => {
  const selected = selectCraftPlanningEffortView({
    state: "partial",
    sections: { Fishing: { state: "unavailable", completion: null } },
    fishingVariants: { lake: {
      overall: { state: "unavailable", completion: null },
      sections: { Fishing: { state: "unavailable", completion: null } },
      warnings: ["Lake route weight is unavailable"],
    } },
    warnings: ["Root warning"],
  }, "lake");
  assert.deepEqual(selected.warnings, ["Lake route weight is unavailable", "Root warning"]);
});

test("effort view exposes confirmed, projected, stale, and baseline metadata", () => {
  const selected = selectCraftPlanningEffortView({
    state: "ready",
    confirmed: {
      state: "ready",
      overall: { state: "ready", baselineEffort: 100, remainingEffort: 30, completion: 70 },
      sections: { Scholar: { state: "ready", baselineEffort: 50, remainingEffort: 20, completion: 60 } },
    },
    projected: {
      state: "ready",
      overall: { state: "ready", baselineEffort: 100, remainingEffort: 20, completion: 80 },
      sections: { Scholar: { state: "ready", baselineEffort: 50, remainingEffort: 10, completion: 80 } },
    },
    overall: { state: "ready", baselineEffort: 100, remainingEffort: 30, completion: 70 },
    sections: { Scholar: { state: "ready", baselineEffort: 50, remainingEffort: 20, completion: 60 } },
    stale: true,
    staleSince: "2026-07-24T09:10:00.000Z",
    lastSuccessfulAt: "2026-07-24T09:00:00.000Z",
    unavailableSources: [{ sourceId: "player-1", label: "Mosswick inventory", type: "Player inventory", error: "HTTP 500" }],
    baselineRevision: "rev-b",
    baselineChange: {
      previousRevision: "rev-a",
      revision: "rev-b",
      changedAt: "2026-07-24T08:30:00.000Z",
      reasons: ["Selected routes changed"],
    },
  }, "ocean");

  assert.equal(selected.confirmed.overall.completion, 70);
  assert.equal(selected.projected.overall.completion, 80);
  assert.equal(selected.overall.completion, 70);
  assert.equal(selected.sections.Scholar.completion, 60);
  assert.equal(selected.stale, true);
  assert.equal(selected.unavailableSources[0].label, "Mosswick inventory");
  assert.equal(selected.baselineRevision, "rev-b");
  assert.deepEqual(selected.baselineChange?.reasons, ["Selected routes changed"]);
});
