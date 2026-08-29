import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/styles/craft-planning.css", import.meta.url), "utf8");

test("four-workspace manager keeps source suggestions and route cards dense and keyboard-visible", () => {
  assert.match(css, /\.craft-plan-source-suggestion\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.craft-plan-review-list\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.craft-plan-review-route:has\(input:focus-visible\)\s*\{[^}]*outline:/s);
  assert.match(css, /\.craft-plan-review-route\.is-selected\s*\{/);
  assert.match(css, /\.craft-plan-material-impact\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.craft-plan-cell-plan-total,/);
  assert.match(css, /\.craft-plan-cell-stock\s*\{/);
});

test("four-workspace manager remains viewport-fixed and stacks cards on narrow screens", () => {
  assert.match(css, /\.craft-plan-manager-backdrop \{ position: fixed; inset: 0;/);
  assert.match(css, /\.craft-plan-manager\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\)/s);
  assert.match(css, /\.craft-plan-manager-body\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.craft-plan-review-footer\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.craft-plan-audit-filters\s*\{[^}]*grid-template-columns:\s*1fr/s);
});
