import { toNumber, type AnyRecord } from "../main-app-data.ts";

export function dashboardRegionWealth(rows: AnyRecord[]) {
  const settlements = rows.filter((row) => row.neutral !== true);
  return {
    settlements,
    settlementCount: settlements.length,
    treasury: settlements.reduce(
      (total, row) => total + toNumber(row.treasury),
      0,
    ),
  };
}
