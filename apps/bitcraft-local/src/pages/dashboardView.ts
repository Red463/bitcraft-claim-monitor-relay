import type { AnyRecord } from "../main-app-data.ts";

function exactInteger(value: unknown): bigint {
  const normalized = typeof value === "bigint"
    ? value.toString()
    : String(value ?? "0").replaceAll(",", "").trim();
  return /^\d+$/.test(normalized) ? BigInt(normalized) : 0n;
}

export function dashboardRegionWealth(rows: AnyRecord[]) {
  const settlements = rows.filter((row) => row.neutral !== true);
  return {
    settlements,
    settlementCount: settlements.length,
    treasury: settlements.reduce(
      (total, row) => total + exactInteger(row.treasury),
      0n,
    ).toString(),
  };
}

export function formatExactCompactInteger(value: unknown): string {
  const integer = exactInteger(value);
  const scales = [
    { divisor: 1_000_000_000n, suffix: "B" },
    { divisor: 1_000_000n, suffix: "M" },
    { divisor: 1_000n, suffix: "K" },
  ];
  for (const { divisor, suffix } of scales) {
    if (integer < divisor) continue;
    const roundedTenths = ((integer * 10n) + (divisor / 2n)) / divisor;
    const whole = roundedTenths / 10n;
    const fraction = roundedTenths % 10n;
    return `${whole.toLocaleString()}.${fraction}${suffix}`;
  }
  return integer.toLocaleString();
}
