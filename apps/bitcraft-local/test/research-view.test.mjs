import assert from "node:assert/strict";
import test from "node:test";

let viewModule = null;
try {
  viewModule = await import(
    new URL("../src/pages/researchView.ts", import.meta.url).href,
  );
} catch {
  // The first TDD run proves the provider-neutral research view model is absent.
}

test("research view groups current and locked technology separately from available work", () => {
  assert.ok(viewModule, "research view module must exist");
  const rows = [
    { id: "1", state: "researched", isResearched: true, area: "1000", supplies: "12000" },
    { id: "200", state: "researched", isResearched: true, area: "2000", supplies: "30000" },
    { id: "300", state: "researching", isResearching: true },
    { id: "301", state: "available", isAvailable: true },
    { id: "400", state: "locked", missingRequirementIds: ["300"] },
  ];

  assert.deepEqual(viewModule.groupResearchTechnologies(rows), {
    researched: [rows[0], rows[1]],
    researching: [rows[2]],
    available: [rows[3]],
    locked: [rows[4]],
  });
  assert.deepEqual(viewModule.researchSettlementCaps(
    { numTiles: "1500", suppliesMax: "25000" },
    rows,
  ), {
    maxTiles: 2000,
    maxSupplies: 30000,
  });
});

test("research view keeps legacy unresearched rows visible as available", () => {
  assert.ok(viewModule, "research view module must exist");
  const legacy = [{ id: "2", isResearched: false }];
  assert.deepEqual(viewModule.groupResearchTechnologies(legacy), {
    researched: [],
    researching: [],
    available: legacy,
    locked: [],
  });
});

test("research settlement caps use the greatest learned supply capacity", () => {
  assert.deepEqual(viewModule.researchSettlementCaps(
    {},
    [
      { id: "1826500486", state: "researched", isResearched: true, supplies: "30000" },
      { id: "1157053499", state: "researched", isResearched: true, supplies: "50000" },
      { id: "688169271", state: "researched", isResearched: true, supplies: "85000" },
      { id: "733358069", state: "locked", supplies: "115000" },
    ],
  ), {
    maxTiles: 0,
    maxSupplies: 85000,
  });
});
