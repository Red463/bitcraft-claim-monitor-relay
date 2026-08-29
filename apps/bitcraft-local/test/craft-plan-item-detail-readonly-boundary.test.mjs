import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("item-detail recipe information is read-only and links editors to exact Recipe Review output", () => {
  const page = readFileSync(new URL("../src/pages/CraftPlanningPage.tsx", import.meta.url), "utf8");
  const detail = page.match(/const needDetailDialog[\s\S]+?React\.useEffect\(\(\) => \{/i)?.[0] ?? "";

  assert.match(detail, /Open in Recipe Review/);
  assert.match(detail, /selectedNeedReviewTargets\.map/);
  assert.match(detail, /outputKey: target\.outputKey/);
  assert.match(detail, /openRecipeReview\(target\.outputKey\)/);
  assert.doesNotMatch(detail, /outputKey: selectedNeedKey/);
  assert.match(detail, /craftPlanRecipeReviewHref/);
  assert.doesNotMatch(detail, /saveRouteOverride/);
  assert.doesNotMatch(detail, /saveMultiplier/);
  assert.doesNotMatch(detail, /CraftPlanningRouteChooser/);
  assert.doesNotMatch(detail, /<select[^>]*Recipe route/i);
  assert.doesNotMatch(detail, />Save<\/button>/);
});
