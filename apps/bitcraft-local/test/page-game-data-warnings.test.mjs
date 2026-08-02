import assert from "node:assert/strict";
import test from "node:test";

const { pageGameDataWarnings } = await import(
  new URL("../src/api/pageGameDataWarnings.ts", import.meta.url).href,
);

test("Dashboard ignores missing owner enrichment but preserves operational warnings", () => {
  const warnings = [
    "region-claims: Regional claims missing owner usernames: 999.",
    "research: data is stale.",
  ];
  assert.deepEqual(pageGameDataWarnings("dashboard", warnings), [
    "research: data is stale.",
  ]);
  assert.deepEqual(pageGameDataWarnings("region", warnings), warnings);
});
