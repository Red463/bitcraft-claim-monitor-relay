import assert from "node:assert/strict";
import test from "node:test";

const { dashboardRegionWealth } = await import(
  new URL("../src/pages/dashboardView.ts", import.meta.url).href,
);

test("Dashboard Region Wealth includes only player-run settlements", () => {
  const result = dashboardRegionWealth([
    { entityId: "1", name: "Timbersteel Trade", neutral: false, treasury: "2789" },
    { entityId: "2", name: "Player Town", neutral: false, treasury: "10000" },
    { entityId: "3", name: "Sunken Ruin", neutral: true, treasury: "999999" },
  ]);

  assert.equal(result.settlementCount, 2);
  assert.equal(result.treasury, 12789);
  assert.deepEqual(result.settlements.map((row) => row.entityId), ["1", "2"]);
});
