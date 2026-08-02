import assert from "node:assert/strict";
import test from "node:test";

const { dashboardRegionWealth, formatExactCompactInteger } = await import(
  new URL("../src/pages/dashboardView.ts", import.meta.url).href,
);

test("Dashboard Region Wealth includes only player-run settlements", () => {
  const result = dashboardRegionWealth([
    { entityId: "1", name: "Timbersteel Trade", neutral: false, treasury: "9007199254740993" },
    { entityId: "2", name: "Player Town", neutral: false, treasury: "9007199254740994" },
    { entityId: "3", name: "Sunken Ruin", neutral: true, treasury: "999999" },
  ]);

  assert.equal(result.settlementCount, 2);
  assert.equal(result.treasury, "18014398509481987");
  assert.deepEqual(result.settlements.map((row) => row.entityId), ["1", "2"]);
  assert.equal(formatExactCompactInteger(result.treasury), "18,014,398.5B");
});
