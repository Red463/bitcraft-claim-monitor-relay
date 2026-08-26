import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicComponents = [
  "PublicAppShell.tsx",
  "PublicClaimFinder.tsx",
  "PublicClaimPages.tsx",
  "PublicChrome.tsx",
  "PublicAccountSettings.tsx",
  "PublicPlansPage.tsx",
  "PublicPlanAccessPage.tsx",
];

test("rendered public component sources use claim-only generic branding", () => {
  for (const file of publicComponents) {
    const source = readFileSync(new URL(`../src/public/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /settlement|timbersteel/i, `${file} must use claim-only generic language`);
  }
});
