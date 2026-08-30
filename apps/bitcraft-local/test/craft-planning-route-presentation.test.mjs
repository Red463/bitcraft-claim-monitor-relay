import assert from "node:assert/strict";
import test from "node:test";

import {
  acquisitionRouteKind,
  acquisitionRouteLabel,
  acquisitionRouteMetrics,
  formatProbabilityRate,
} from "../src/pages/craftPlanningRoutePresentation.mjs";
import * as routePresentation from "../src/pages/craftPlanningRoutePresentation.mjs";

const gypsite = { id: "3001", name: "Rough Gypsite", kind: "items" };

test("gathering labels use the source node instead of a generic recipe label", () => {
  const route = {
    id: "mud-route",
    label: "Recipe -> Rough Gypsite",
    routeType: "gathering-byproduct",
    gatheringSource: { label: "Mud Mound" },
    producer: { name: "Rough Clay Output" },
  };

  assert.equal(acquisitionRouteKind(route), "Gathering byproduct");
  assert.equal(acquisitionRouteLabel(route, gypsite), "Gather byproduct from Mud Mound while collecting Rough Clay Output");
  assert.equal(acquisitionRouteLabel({
    routeType: "gathering",
    gatheringSources: [{ label: "Mud Mound" }, { label: "Rough Sand Pile" }],
  }, gypsite), "Gather from Mud Mound or Rough Sand Pile");
});

test("craft and logistics labels expose inputs, station, and transport intent", () => {
  assert.equal(acquisitionRouteLabel({
    routeType: "craft",
    label: "Recipe -> Rough Gypsite",
    buildingName: "Masonry Station",
    inputs: [{ name: "Rough Brick" }, { name: "Water" }],
  }, gypsite), "Rough Brick + Water -> Rough Gypsite at Masonry Station");

  assert.equal(acquisitionRouteKind({ routeType: "craft", isTransportRoute: true }), "Logistics");
  assert.equal(acquisitionRouteLabel({
    routeType: "craft",
    isTransportRoute: true,
    label: "Unpack Rough Gypsite Package",
  }, gypsite), "Unpack Rough Gypsite Package");
});

test("finite gathering metrics lead with whole nodes and preserve exact work", () => {
  assert.deepEqual(acquisitionRouteMetrics({
    routeType: "gathering-byproduct",
    probabilityStatus: "expected",
    expectedPerProgress: 0.0024,
    expectedPerResource: 2.4,
    resourceHealth: 1000,
  }, { missingQuantity: 73, multiplier: 1 }), {
    status: "available",
    basis: "node",
    expectedPerUnit: 2.4,
    exactUnits: 30.416666666666668,
    plannedUnits: 31,
    totalProgress: 30417,
    progressPerExpectedItem: 416.6666666666667,
    totalActions: null,
  });
});

test("zero shortage, prospecting, crafting, and unavailable rates remain honest", () => {
  assert.equal(acquisitionRouteMetrics({
    routeType: "gathering",
    expectedPerResource: 2,
    expectedPerProgress: 0.002,
    resourceHealth: 1000,
  }, { missingQuantity: 0 }).plannedUnits, 0);

  assert.equal(acquisitionRouteMetrics({
    routeType: "gathering",
    gatheringMode: "prospecting",
    expectedPerProgress: 0.04,
  }, { missingQuantity: 8 }).basis, "progress");

  assert.deepEqual(acquisitionRouteMetrics({
    routeType: "craft",
    expectedPerCraft: 3.02,
    actionsRequired: 5,
    probabilityStatus: "expected",
  }, { missingQuantity: 10, multiplier: 1.1 }), {
    status: "available",
    basis: "craft",
    expectedPerUnit: 3.02,
    exactUnits: 3.642384105960265,
    plannedUnits: 4,
    totalProgress: null,
    progressPerExpectedItem: null,
    totalActions: 20,
  });

  assert.deepEqual(acquisitionRouteMetrics({
    routeType: "craft",
    probabilityStatus: "unavailable",
  }, { missingQuantity: 10 }), { status: "unavailable" });
});

test("technical probability rates never round a non-zero value to zero", () => {
  assert.equal(formatProbabilityRate(0.002), "0.002");
  assert.equal(formatProbabilityRate(0.0000000123), "1.23e-8");
  assert.equal(formatProbabilityRate(0), "0");
});

test("recipe review presents a craft route with named materials and practical output", () => {
  const presentation = routePresentation.acquisitionRouteReviewPresentation({
    routeType: "craft",
    probabilityStatus: "guaranteed",
    buildingName: "Bloomery",
    inputs: [{ key: "items:2", name: "Iron Ore" }],
    expectedPerCraft: 5,
  }, { key: "items:7", name: "Iron Ingot" });

  assert.deepEqual(presentation, {
    label: "Iron Ore → Iron Ingot at Bloomery",
    yield: "Produces 5 Iron Ingot per craft",
    probability: "guaranteed",
  });
});

test("recipe review turns a 0.01 gathering rate into reciprocal work", () => {
  const presentation = routePresentation.acquisitionRouteReviewPresentation({
    routeType: "gathering",
    probabilityStatus: "expected",
    gatheringSource: { label: "Iron Vein" },
    expectedPerProgress: 0.01,
  }, { key: "items:2", name: "Iron Ore" });

  assert.deepEqual(presentation, {
    label: "Gather Iron Ore from Iron Vein",
    yield: "About 1 Iron Ore per 100 node progress",
    probability: "expected",
  });
});

test("recipe review keeps technical identities out of human-facing names", () => {
  assert.equal(typeof routePresentation.acquisitionRouteReviewItemName, "function");
  assert.equal(routePresentation.acquisitionRouteReviewItemName({
    key: "cargo:2002",
    name: "cargo:2002",
    label: "Packed Iron Ore",
  }), "Packed Iron Ore");

  const technicalRoute = routePresentation.acquisitionRouteReviewPresentation({
    id: "route:8842",
    label: "route:8842",
    routeType: "craft",
    probabilityStatus: "guaranteed",
    expectedPerCraft: 1,
  }, { key: "cargo:2002", name: "cargo:2002" });
  assert.deepEqual(technicalRoute, {
    label: "Produce Unknown cargo",
    yield: "Produces 1 Unknown cargo per craft",
    probability: "guaranteed",
  });
  assert.doesNotMatch(`${technicalRoute.label} ${technicalRoute.yield}`, /route:8842|cargo:2002/);

  assert.equal(routePresentation.acquisitionRouteReviewPresentation({
    routeType: "gathering",
    probabilityStatus: "expected",
    gatheringSource: { tag: "Iron Vein", skill: "Mining" },
    expectedPerProgress: 0.01,
  }, { key: "items:2", name: "Iron Ore" }).label, "Gather Iron Ore from Iron Vein");
});

test("recipe review does not invent output work when probability data is unavailable", () => {
  const presentation = routePresentation.acquisitionRouteReviewPresentation({
    routeType: "craft",
    probabilityStatus: "unavailable",
    inputs: [{ key: "items:2", name: "Iron Ore" }],
  }, { key: "items:7", name: "Iron Ingot" });

  assert.deepEqual(presentation, {
    label: "Iron Ore → Iron Ingot",
    yield: "Probability data unavailable",
    probability: "unavailable",
  });
});

test("recipe review technical facts explain the unit behind each raw rate", () => {
  assert.deepEqual(routePresentation.acquisitionRouteReviewTechnicalDetails({
    routeType: "craft-byproduct",
    probabilityStatus: "expected",
    expectedPerCraft: 0.25,
    guaranteedYield: 0,
    actionsRequired: 4,
    dropChance: 0.25,
    dropQuantity: 2,
    expectedPerProgress: 99,
    resourceHealth: 500,
  }, { name: "Iron Ingot" }), [
    { label: "Average output per craft", value: "0.25" },
    { label: "Guaranteed output per craft", value: "None" },
    { label: "Actions per craft", value: "4" },
    { label: "Chance per producer run", value: "25%" },
    { label: "Average on a successful drop", value: "2 Iron Ingot" },
  ]);

  assert.deepEqual(routePresentation.acquisitionRouteReviewTechnicalDetails({
    routeType: "gathering-byproduct",
    probabilityStatus: "expected",
    expectedPerProgress: 0.01,
    expectedPerResource: 10,
    resourceHealth: 1000,
  }, { name: "Iron Ore" }), [
    { label: "Average output per node progress", value: "0.01" },
    { label: "Average output per fully gathered node", value: "10" },
    { label: "Node progress to exhaustion", value: "1,000" },
  ]);

  assert.deepEqual(routePresentation.acquisitionRouteReviewTechnicalDetails({
    routeType: "craft",
    probabilityStatus: "expected",
    expectedPerCraft: null,
    actionsRequired: null,
    dropChance: null,
    dropQuantity: null,
  }, { name: "Iron Ingot" }), []);

  const guaranteedDetails = routePresentation.acquisitionRouteReviewTechnicalDetails({
    routeType: "craft",
    probabilityStatus: "guaranteed",
    isProbabilistic: false,
    expectedPerCraft: 5,
    guaranteedYield: 5,
  }, { name: "Iron Ingot" });
  assert.equal(
    guaranteedDetails.filter(({ label }) => label === "Guaranteed output per craft").length,
    1,
    "a deterministic route must not repeat the same guaranteed output fact",
  );
});

test("recipe review technical facts keep route evidence in the presentation module", () => {
  assert.equal(typeof routePresentation.acquisitionRouteReviewTechnicalFacts, "function");
  const facts = routePresentation.acquisitionRouteReviewTechnicalFacts({
    id: "route:8842",
    routeType: "gathering",
    probabilityStatus: "expected",
    expectedPerProgress: 0.01,
    gatheringSource: { label: "Iron Vein", tag: "Ore", skill: "Mining" },
    producer: "items:20",
    producerRecipe: { id: "recipe:99", name: "Mine ore", buildingName: "Mine", skillName: "Mining" },
    inputs: [{ key: "items:2", quantity: 3 }],
  }, { name: "Iron Ore" });

  assert.deepEqual(facts.find(({ label }) => label === "Route identity"), { label: "Route identity", value: "route:8842", code: true });
  assert.deepEqual(facts.find(({ label }) => label === "Producer identity"), { label: "Producer identity", value: "items:20", code: true });
  assert.deepEqual(facts.find(({ label }) => label === "Source"), { label: "Source", value: "Iron Vein" });
  assert.deepEqual(facts.find(({ label }) => label === "Average output per node progress"), { label: "Average output per node progress", value: "0.01" });
});

test("placeholder processing recipes are named by their actual inputs", () => {
  const route = {
    routeType: "craft-byproduct",
    recipeName: "Harvest {0}",
    buildingName: "Fine Hunting Station",
    inputs: [{ name: "Fine Wolf Carcass" }],
  };

  assert.equal(
    acquisitionRouteLabel(route, { name: "Fine Animal Hair" }),
    "Process Fine Wolf Carcass -> Fine Animal Hair at Fine Hunting Station",
  );
  assert.doesNotMatch(acquisitionRouteLabel(route, { name: "Fine Animal Hair" }), /\{\d+\}/);
  assert.equal(
    acquisitionRouteLabel({ ...route, inputs: [{ name: "Fine Bear Carcass" }] }, { name: "Fine Animal Hair" }),
    "Process Fine Bear Carcass -> Fine Animal Hair at Fine Hunting Station",
  );
});

test("placeholder recipes without inputs use a clean output fallback", () => {
  assert.equal(acquisitionRouteLabel({
    routeType: "craft",
    recipeName: "Harvest {1}",
    buildingName: "Fine Hunting Station",
    inputs: [],
  }, { name: "Fine Animal Hair" }), "Produce Fine Animal Hair at Fine Hunting Station");
});
