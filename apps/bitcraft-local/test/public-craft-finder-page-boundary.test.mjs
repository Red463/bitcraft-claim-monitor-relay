import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("Public Craft Finder page lives outside the legacy MainPages bundle", () => {
  const mainPagesUrl = new URL("../src/pages/MainPages.tsx", import.meta.url);
  const mainPages = existsSync(mainPagesUrl) ? readFileSync(mainPagesUrl, "utf8") : "";
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const publicCraftFinderPageUrl = new URL("../src/pages/PublicCraftFinderPage.tsx", import.meta.url);

  assert.equal(existsSync(publicCraftFinderPageUrl), true);
  assert.doesNotMatch(mainPages, new RegExp("export function PublicCraftFinder\\b"));
  assert.match(appShell, /lazyRoute\(\(\) => import\("\.\/pages\/PublicCraftFinderPage"\)/);
});

test("Public Craft Finder summary reflows while its results table remains scrollable", () => {
  const css = readFileSync(new URL("../src/styles/public-craft.css", import.meta.url), "utf8");

  assert.match(css, /@media \(max-width:\s*1250px\)[\s\S]*\.public-craft-summary\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.public-craft-summary\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.public-craft-finder \.table-wrap\s*\{[^}]*overflow-x:\s*auto/s);
});

test("Members profile uses only provider-neutral player data and live regional tasks", () => {
  const source = readFileSync(new URL("../src/pages/MembersPage.tsx", import.meta.url), "utf8");
  assert.match(source, /domains:\s*"inventory,housing"/);
  assert.match(source, /selectedMember\?\.player\?\.tasks/);
  assert.doesNotMatch(source, /\/api\/bitjita|LEGACY_API|market-collections|traveler-tasks/i);
});
