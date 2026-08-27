import assert from "node:assert/strict";
import test from "node:test";

import {
  adminSearchWithTab,
  botSearchWithSection,
  parseAdminLocation,
  parseBotSectionLocation,
} from "../src/components/admin/adminNavigationState.ts";

test("admin navigation preserves unrelated query values and validates sections", () => {
  assert.deepEqual(parseAdminLocation("?page=admin&admin=configuration&config=privacy"), {
    tab: "configuration",
    configurationSection: "privacy",
  });
  assert.equal(adminSearchWithTab("?page=admin&foo=1", "analytics"), "?page=admin&foo=1&admin=analytics");
  assert.deepEqual(parseAdminLocation("?page=admin&admin=unknown&config=wrong"), {
    tab: "status",
    configurationSection: "general",
  });
});

test("admin navigation removes configuration state outside Configuration", () => {
  assert.equal(
    adminSearchWithTab("?page=admin&admin=configuration&config=privacy", "audit"),
    "?page=admin&admin=audit",
  );
});

test("admin navigation rejects the retired public-service console", () => {
  assert.deepEqual(parseAdminLocation("?page=admin&admin=public-service"), {
    tab: "status",
    configurationSection: "general",
  });
});

test("bot navigation validates and serializes the selected section", () => {
  assert.equal(parseBotSectionLocation("?section=community"), "community");
  assert.equal(parseBotSectionLocation("?section=unknown"), "setup");
  assert.equal(botSearchWithSection("?foo=1", "diagnostics"), "?foo=1&section=diagnostics");
});
