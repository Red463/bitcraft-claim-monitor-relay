import assert from "node:assert/strict";
import test from "node:test";

import { resolveCraftPlanSelection } from "../src/pages/craftPlanSelection.mjs";

const plans = [
  { id: "primary", primary: true },
  { id: "mine", primary: false },
];

test("URL selection wins over a remembered plan", () => {
  assert.deepEqual(resolveCraftPlanSelection(plans, "mine", "primary"), { planId: "mine", fellBack: false });
});

test("an inaccessible URL plan falls back to primary without revealing it", () => {
  assert.deepEqual(resolveCraftPlanSelection(plans, "private-other", "mine"), { planId: "primary", fellBack: true });
});

test("the primary shared plan is the final fallback", () => {
  assert.deepEqual(resolveCraftPlanSelection(plans, "", "deleted"), { planId: "primary", fellBack: false });
});
