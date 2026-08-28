import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Inventory page lives outside the legacy MainPages bundle", () => {
  const mainPagesUrl = new URL("../src/pages/MainPages.tsx", import.meta.url);
  const mainPages = existsSync(mainPagesUrl) ? readFileSync(mainPagesUrl, "utf8") : "";
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const inventoryPageUrl = new URL("../src/pages/InventoryPage.tsx", import.meta.url);

  assert.equal(existsSync(inventoryPageUrl), true);
  assert.doesNotMatch(mainPages, new RegExp("export function Inventory\\b"));
  assert.match(appShell, /lazyRoute\(\(\) => import\("\.\/pages\/InventoryPage"\)/);
});

test("Inventory summary and filters reflow without clipping", () => {
  const css = readFileSync(new URL("../src/styles/inventory.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width:\s*1250px\)[\s\S]*\.inventory-summary,\s*\.inventory-filter-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.inventory-summary,\s*\.inventory-filter-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.inventory-command-header\s*\{[^}]*align-items:\s*stretch[^}]*flex-direction:\s*column/s);
});
