import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_ROLE_LABELS,
  adminHasPermission,
  adminPermissionFor,
  adminPermissions,
  normalizeAdminRole,
} from "../src/server/adminPermissions.mjs";

test("admin role helpers preserve labels and safe role fallback", () => {
  assert.deepEqual(ADMIN_ROLE_LABELS, {
    owner: "Owner",
    admin: "Administrator",
    "discord-manager": "Discord Manager",
    moderator: "Moderator",
    viewer: "Viewer",
  });
  assert.equal(normalizeAdminRole(" OWNER "), "owner");
  assert.equal(normalizeAdminRole("discord-manager"), "discord-manager");
  assert.equal(normalizeAdminRole("unknown"), "viewer");
  assert.equal(normalizeAdminRole(null), "viewer");
});

test("admin permission helpers keep owner wildcard and scoped roles", () => {
  assert.deepEqual(adminPermissions("viewer"), ["status.view", "settings.view", "data.view", "analytics.view", "audit.view", "discord.view"]);
  assert.equal(adminHasPermission({ role: "owner" }, "settings.manage"), true);
  assert.equal(adminHasPermission({ role: "admin" }, "discord.manage"), true);
  assert.equal(adminHasPermission({ role: "discord-manager" }, "discord.manage"), true);
  assert.equal(adminHasPermission({ role: "discord-manager" }, "users.manage"), false);
  assert.equal(adminHasPermission({ role: "moderator" }, "discord.moderate"), true);
  assert.equal(adminHasPermission({ role: "viewer" }, "data.manage"), false);
  assert.equal(adminHasPermission(null, "status.view"), true);
});

test("adminPermissionFor maps admin routes to the existing least-privilege permissions", () => {
  assert.equal(adminPermissionFor("GET", "/api/local/admin/me"), "status.view");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/empire-membership"), "status.view");
  assert.equal(adminPermissionFor("POST", "/api/local/admin/settings"), "settings.manage");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/settings"), "settings.view");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/craft-plan/audit"), "audit.view");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/craft-plan/progress-audit"), "audit.view");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/craft-plan/progress-audit/export"), "data.export");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/craft-plan/player-banks"), "settings.view");
  assert.equal(adminPermissionFor("POST", "/api/local/admin/jobs/run"), "data.manage");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/jobs"), "status.view");
  assert.equal(adminPermissionFor("POST", "/api/local/admin/users"), "users.manage");
  assert.equal(adminPermissionFor("POST", "/api/local/admin/user-accounts/approval"), "accounts.manage");
  assert.equal(adminPermissionFor("PUT", "/api/local/admin/user-accounts/character"), "accounts.manage");
  assert.equal(adminPermissionFor("DELETE", "/api/local/admin/user-accounts/privacy"), "accounts.manage");
  assert.equal(adminPermissionFor("DELETE", "/api/local/admin/analytics"), "analytics.manage");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/analytics"), "analytics.view");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/tables"), "data.view");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/export"), "data.export");
  assert.equal(adminPermissionFor("POST", "/api/local/admin/backups"), "data.manage");
  assert.equal(adminPermissionFor("POST", "/api/local/admin/maintenance/prune"), "status.view");
  assert.equal(adminPermissionFor("POST", "/api/local/admin/discord/moderation/timeout"), "discord.moderate");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/discord/status"), "discord.view");
  assert.equal(adminPermissionFor("POST", "/api/local/admin/discord/setup"), "discord.manage");
  assert.equal(adminPermissionFor("GET", "/api/local/admin/unknown"), "status.view");
});

test("server monitoring requires the owner-only wildcard permission", () => {
  assert.equal(adminPermissionFor("GET", "/api/local/admin/server-health"), "server.monitor.view");
  assert.equal(adminHasPermission({ role: "owner" }, "server.monitor.view"), true);
  assert.equal(adminHasPermission({ role: "admin" }, "server.monitor.view"), false);
  assert.equal(adminHasPermission({ role: "viewer" }, "server.monitor.view"), false);
});

test("retired public-service permissions and route mappings are absent", () => {
  const retiredPermissions = ["public.health", "public.lookup", "public.moderate", "public.restore", "public.privacy"];
  for (const role of Object.keys(ADMIN_ROLE_LABELS)) {
    assert.equal(adminPermissions(role).some((permission) => retiredPermissions.includes(permission)), false);
  }
  assert.equal(adminPermissionFor("GET", "/api/local/admin/public-service/health"), "status.view");
});
