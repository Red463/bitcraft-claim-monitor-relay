import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public pages use shared shell selectors instead of a separate layout", () => {
  const publicCss = readFileSync(new URL("../src/styles/public-shell.css", import.meta.url), "utf8");
  const rootCss = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const chromeCss = readFileSync(new URL("../src/styles/app-chrome.css", import.meta.url), "utf8");
  assert.doesNotMatch(publicCss, /\.public-app-shell|\.public-sidebar/);
  assert.match(rootCss, /\.app-shell\s*\{[^}]*grid-template-columns:\s*238px minmax\(0, 1fr\)/s);
  assert.match(rootCss, /\.app-shell\.sidebar-collapsed\s*\{[^}]*grid-template-columns:\s*72px minmax\(0, 1fr\)/s);
  assert.match(rootCss, /@media \(max-width:\s*760px\)[\s\S]*\.app-shell[\s\S]*\.app-sidebar\.mobile-open/s);
  assert.match(chromeCss, /\.app-utility-bar/);
  assert.match(rootCss, /\.app-footer/);
});

test("public page content keeps dashboard gutters without overriding shared main scrolling", () => {
  const publicCss = readFileSync(new URL("../src/styles/public-shell.css", import.meta.url), "utf8");
  assert.match(publicCss, /\.public-page-view\s*\{[^}]*padding:\s*var\(--shell-page-gutter\)/s);
  assert.doesNotMatch(publicCss, /\.public-profile-shell\s+main\s*\{[^}]*overflow/s);
});
