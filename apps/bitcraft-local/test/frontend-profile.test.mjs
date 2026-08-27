import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mainSource = readFileSync(path.join(appRoot, "src/main.tsx"), "utf8");

test("frontend startup mounts only the dedicated application root", () => {
  assert.match(mainSource, /import TimbersteelRoot from "\.\/TimbersteelRoot"/);
  assert.match(mainSource, /render\(<TimbersteelRoot \/>\)/);
  assert.doesNotMatch(mainSource, /loadHostProfile|rootForProfile|PublicRoot|\.\/public\//);
  assert.doesNotMatch(mainSource, /capturePublicPlanFragmentSecret/);
});

test("dedicated startup keeps both global and shared chrome styles at the entry boundary", () => {
  assert.match(mainSource, /import "\.\/styles\.css"/);
  assert.match(mainSource, /import "\.\/styles\/app-chrome\.css"/);
  assert.equal(existsSync(path.join(appRoot, "src/styles/app-chrome.css")), true);
});

test("public browser entry modules are absent", () => {
  assert.equal(existsSync(path.join(appRoot, "src/api/profile.ts")), false);
  const publicDirectory = path.join(appRoot, "src/public");
  assert.deepEqual(existsSync(publicDirectory) ? readdirSync(publicDirectory) : [], []);
  assert.equal(existsSync(path.join(appRoot, "src/styles/public-shell.css")), false);
});
