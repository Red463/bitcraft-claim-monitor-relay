import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function readSource(url) {
  return existsSync(url) ? readFileSync(url, "utf8") : "";
}

const component = readSource(new URL("../src/components/main/RouteLoadingState.tsx", import.meta.url));
const shell = readFileSync(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../src/TimbersteelRoot.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("route loading uses one accessible destination-aware skeleton", () => {
  assert.match(component, /role="status"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /aria-busy="true"/);
  assert.match(component, /Loading \{displayLabel\}/);
  assert.match(component, /route-loading-summary/);
  assert.match(component, /route-loading-content/);
  assert.match(shell, /<RouteLoadingState label=\{activePageLabel\} \/>/);
  assert.match(entry, /<RouteLoadingState \/>/);
  assert.doesNotMatch(shell, />Loading page\.\.\.<\/section>/);
  assert.doesNotMatch(entry, />Loading page\.\.\.<\/section>/);
});

test("route skeleton styling is responsive and stops motion when requested", () => {
  assert.match(styles, /\.route-loading-state\s*\{/);
  assert.match(styles, /\.route-loading-summary\s*\{/);
  assert.match(styles, /\.route-loading-content\s*\{/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.route-loading-shape/);
});
