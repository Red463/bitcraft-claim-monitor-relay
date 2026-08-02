import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("Production page lives outside the legacy MainPages bundle", () => {
  const mainPagesUrl = new URL("../src/pages/MainPages.tsx", import.meta.url);
  const mainPages = existsSync(mainPagesUrl) ? readFileSync(mainPagesUrl, "utf8") : "";
  const productionPage = readFileSync(new URL("../src/pages/ProductionPage.tsx", import.meta.url), "utf8");
  const appShell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(mainPages, /export function Production\b/);
  assert.doesNotMatch(mainPages, /export function MemberPassiveCrafts\b/);
  assert.match(productionPage, /export function Production\b/);
  assert.match(productionPage, /export function MemberPassiveCrafts\b/);
  assert.match(appShell, /React\.lazy\(\(\) => import\("\.\/pages\/ProductionPage"\)\.then/);
  assert.doesNotMatch(appShell, /import \{ Market, Production \} from "\.\/pages\/MainPages"/);
});
test("Production contributors render as a wrapping grid", () => {
  const productionPage = readFileSync(new URL("../src/pages/ProductionPage.tsx", import.meta.url), "utf8");
  const productionCss = readFileSync(new URL("../src/styles/production.css", import.meta.url), "utf8");

  assert.doesNotMatch(productionPage, /contributors\.slice\(0,\s*3\)/);
  assert.match(productionPage, /contributors\.map\(\(person\) =>/);
  assert.match(productionCss, /\.production-page \.contributors \{/);
  assert.match(productionCss, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(productionCss, /\.production-page \.contributors span strong \.tracked-owner-name \{/);
  assert.match(productionCss, /\.production-page \.contributors span strong \.tracked-owner-name svg \{/);
  assert.match(productionCss, /@media \(max-width: 1250px\)[\s\S]*\.production-page \.contributors \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});
test("Production current crafter pills filter by that member", () => {
  const productionPage = readFileSync(new URL("../src/pages/ProductionPage.tsx", import.meta.url), "utf8");
  const productionCss = readFileSync(new URL("../src/styles/production.css", import.meta.url), "utf8");

  assert.match(productionPage, /<button[\s\S]*className=\{`crafter-pill/);
  assert.match(productionPage, /aria-pressed=\{selectedMemberName === name\}/);
  assert.match(productionPage, /onClick=\{\(\) => selectCrafterPill\(name\)\}/);
  assert.match(productionPage, /const selectCrafterPill = \(name: string\) => \{/);
  assert.match(productionPage, /onSelectMember\(selectedMemberName === name \? "All" : crafterMemberIdByName\[name\]/);
  assert.match(productionCss, /\.production-page \.crafter-pills > \.crafter-pill/);
  assert.match(productionCss, /\.production-page \.crafter-pills > \.crafter-pill\.active/);
});

test("Production summary values wrap instead of truncating on phones", () => {
  const css = readFileSync(new URL("../src/styles/production.css", import.meta.url), "utf8");
  const valueRule = css.match(/\.production-page \.mini-stat strong\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? "";

  assert.match(valueRule, /overflow:\s*visible/);
  assert.match(valueRule, /text-overflow:\s*clip/);
  assert.match(valueRule, /white-space:\s*normal/);
  assert.match(valueRule, /overflow-wrap:\s*anywhere/);
  assert.match(css, /@media \(max-width:\s*560px\)[\s\S]*\.production-page \.production-summary\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("Production cards collapse to one contained column below the tablet breakpoint", () => {
  const css = readFileSync(new URL("../src/styles/production.css", import.meta.url), "utf8");

  assert.match(
    css,
    /@media \(max-width:\s*900px\)[\s\S]*\.production-page \.production-grid\s*\{[^}]*grid-template-columns:\s*1fr/s,
  );
});

test("Production crafter filters wrap within phone-width control panels", () => {
  const css = readFileSync(new URL("../src/styles/production.css", import.meta.url), "utf8");

  assert.match(
    css,
    /@media \(max-width:\s*560px\)[\s\S]*\.production-crafter-line\s*\{[^}]*flex-wrap:\s*wrap/s,
  );
});

test("production page defaults private crafts to hidden while explaining unknown visibility", () => {
  const source = readFileSync(new URL("../src/pages/ProductionPage.tsx", import.meta.url), "utf8");

  assert.match(source, /usePersistedState\("production\.showPrivateCrafts", false\)/);
  assert.doesNotMatch(source, /privateCrafts\.length\s*\?\s*<label className="production-private-toggle"/);
  assert.match(source, /Show private crafts/);
  assert.match(source, /Hide private crafts/);
  assert.match(source, /Unknown contributor/);
  assert.match(source, /Observed since/);
});
