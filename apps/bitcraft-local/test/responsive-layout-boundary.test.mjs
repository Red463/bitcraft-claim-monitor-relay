import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appFrame = readFileSync(new URL("../src/components/app-chrome/AppFrame.tsx", import.meta.url), "utf8");
const appSidebar = readFileSync(new URL("../src/components/app-chrome/AppSidebar.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const chromeCss = readFileSync(new URL("../src/styles/app-chrome.css", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../src/styles/dashboard.css", import.meta.url), "utf8");
const constructionCss = readFileSync(new URL("../src/styles/construction.css", import.meta.url), "utf8");
const craftcalcCss = readFileSync(new URL("../src/styles/craftcalc.css", import.meta.url), "utf8");
const researchCss = readFileSync(new URL("../src/styles/research.css", import.meta.url), "utf8");
const botCss = readFileSync(new URL("../src/styles/bot-dashboard.css", import.meta.url), "utf8");

test("narrow shell separates brand from route and compacts the anchored utility bar", () => {
  assert.match(appFrame, /className="mobile-shell-brand"/);
  assert.match(appFrame, /className="mobile-shell-route"/);
  assert.match(shellCss, /\.mobile-shell-bar\s*>\s*span\s*\{[^}]*display:\s*grid[^}]*margin-right:\s*44px/s);
  assert.match(shellCss, /\.mobile-shell-route\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(shellCss, /@media \(max-width:\s*760px\)[\s\S]*\.app-sidebar\.mobile-open/s);
  assert.match(appSidebar, /matchMedia\("\(max-width: 760px\)"\)/);
  assert.match(chromeCss, /@media \(max-width:\s*760px\)[\s\S]*\.app-utility-bar\s*\{[^}]*min-height:\s*42px/s);
  assert.match(chromeCss, /@media \(max-width:\s*760px\)[\s\S]*\.app-utility-context\s*\{[^}]*display:\s*none/s);
  assert.match(chromeCss, /@media \(max-width:\s*540px\)[\s\S]*\.app-utility-command span,\s*\.app-utility-command kbd\s*\{[^}]*display:\s*none/s);
});

test("Dashboard reduces five KPI columns before the expanded sidebar causes collisions", () => {
  assert.match(dashboardCss, /\.dashboard-page\s*\{[^}]*container-type:\s*inline-size/s);
  assert.match(dashboardCss, /\.dashboard-kpis\s*\{[^}]*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(dashboardCss, /@container \(max-width:\s*1250px\)\s*\{\s*\.dashboard-kpis\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(dashboardCss, /@container \(max-width:\s*900px\)\s*\{\s*\.dashboard-kpis\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(dashboardCss, /@media \(max-width:\s*900px\)[\s\S]*\.dashboard-kpis,\s*\.dashboard-main-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("remaining operational summaries and lookup controls own their phone layouts", () => {
  assert.match(constructionCss, /@media \(max-width:\s*1250px\)[\s\S]*\.construction-summary,\s*\.construction-page \.gather-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(constructionCss, /@media \(max-width:\s*560px\)[\s\S]*\.construction-summary,\s*\.construction-page \.gather-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(researchCss, /@media \(max-width:\s*1250px\)[\s\S]*\.research-summary\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(researchCss, /@media \(max-width:\s*560px\)[\s\S]*\.research-summary\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(researchCss, /@media \(max-width:\s*700px\)[\s\S]*\.research-panel \.dashboard-top-meta\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(craftcalcCss, /@media \(max-width:\s*700px\)[\s\S]*\.craftcalc-control-grid[\s\S]*grid-template-columns:\s*1fr/s);
  assert.match(craftcalcCss, /@media \(max-width:\s*700px\)[\s\S]*\.craftcalc-summary\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test("Discord admin uses a compact mobile picker and horizontal summary rails", () => {
  assert.match(botCss, /\.bot-mobile-section-nav\s*\{[^}]*display:\s*none/s);
  assert.match(botCss, /@media \(max-width:\s*720px\)[\s\S]*\.bot-desktop-section-nav\s*\{[^}]*display:\s*none/s);
  assert.match(botCss, /@media \(max-width:\s*720px\)[\s\S]*\.bot-mobile-section-nav\s*\{[^}]*display:\s*grid/s);
  assert.match(botCss, /@media \(max-width:\s*720px\)[\s\S]*\.bot-overview\s*\{[^}]*overflow-x:\s*auto[^}]*grid-auto-flow:\s*column/s);
  assert.match(botCss, /@media \(max-width:\s*720px\)[\s\S]*\.bot-workflow-card\s*\{[^}]*overflow-x:\s*auto[^}]*grid-auto-flow:\s*column/s);
});
