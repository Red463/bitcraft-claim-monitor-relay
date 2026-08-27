import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const scannedRoots = [
  "apps/bitcraft-local/src",
  "apps/bitcraft-local/server.mjs",
  "deploy",
  ".github/workflows",
  "README.md",
  "DEPLOYMENT.md",
  "docs/privacy-operations-runbook.md",
  "docs/relay-migration/table-inventory.md",
];
const retiredPatterns = [
  /\/api\/public\//,
  /claim-monitor\.com/,
  /PUBLIC_(?:PROFILE_ENABLED|COLLABORATION_ENABLED|LEGAL_CONFIGURATION_CONFIRMED|ORIGIN|DISCORD_OAUTH_CLIENT_ID|DISCORD_OAUTH_CLIENT_SECRET|PLAN_TOKEN_HMAC_KEY)/,
  /src\/public\//,
  /public_user_/,
  /public_craft_plan/,
  /public-service/,
  /\bPublicRoot\b/,
  /\bPublicAppShell\b/,
];

function filesUnder(relative) {
  const absolute = path.join(repositoryRoot, relative);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [relative.replaceAll("\\", "/")];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child.replaceAll("\\", "/")];
  });
}

test("retired public product identifiers cannot return to runtime or active operations", () => {
  const violations = [];
  for (const file of scannedRoots.flatMap(filesUnder)) {
    const source = readFileSync(path.join(repositoryRoot, file), "utf8").replaceAll("\\", "/");
    for (const pattern of retiredPatterns) {
      if (pattern.test(source)) violations.push(`${file}: ${pattern}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("dedicated Public Craft Finder remains part of Timbersteel", () => {
  for (const relative of [
    "apps/bitcraft-local/src/pages/PublicCraftFinderPage.tsx",
    "apps/bitcraft-local/src/pages/publicCraftMath.ts",
    "apps/bitcraft-local/src/styles/public-craft.css",
    "apps/bitcraft-local/src/server/game-data/publicCraftRuntime.ts",
  ]) assert.equal(existsSync(path.join(repositoryRoot, relative)), true, `${relative} should remain`);
});
