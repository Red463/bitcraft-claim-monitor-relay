import assert from "node:assert/strict";
import test from "node:test";

import { mimeType, securityHeaders, staticCacheControl, routeGroup, shouldFallbackToFrontend, shouldLogVisitor } from "../src/server/httpRoutes.mjs";

test("routeGroup classifies public API, admin, auth, Discord, static, and app routes", () => {
  assert.equal(routeGroup("/api/local/admin/settings"), "admin");
  assert.equal(routeGroup("/api/local/auth/me"), "auth");
  assert.equal(routeGroup("/api/local/user/preferences"), "auth");
  assert.equal(routeGroup("/api/discord/interactions"), "discord");
  assert.equal(routeGroup("/api/bitjita/claims"), "app");
  assert.equal(routeGroup("/api/local/history"), "local-api");
  assert.equal(routeGroup("/assets/index.js"), "static");
  assert.equal(routeGroup("/favicon.svg"), "static");
  assert.equal(routeGroup("/favicon.ico"), "static");
  assert.equal(routeGroup("/terms"), "app");
});

test("shouldLogVisitor skips only static assets", () => {
  assert.equal(shouldLogVisitor("/assets/index.css"), false);
  assert.equal(shouldLogVisitor("/favicon.ico"), false);
  assert.equal(shouldLogVisitor("/api/local/health"), true);
  assert.equal(shouldLogVisitor("/"), true);
});
test("securityHeaders applies public release browser protections and preserves explicit response headers", () => {
  const headers = securityHeaders({ "content-type": "application/json", "cache-control": "no-store" });

  assert.equal(headers["content-type"], "application/json");
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["x-frame-options"], "SAMEORIGIN");
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(headers["cross-origin-opener-policy"], "same-origin");
  const contentSecurityPolicy = headers["content-security-policy"];
  const directives = new Set(contentSecurityPolicy.split("; "));
  assert.match(contentSecurityPolicy, /default-src 'self'/);
  assert.equal(directives.has("script-src 'self'"), true);
  assert.equal(directives.has("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"), true);
  assert.equal(directives.has("img-src 'self' data: https://cdn.discordapp.com"), true);
  assert.equal(directives.has("connect-src 'self'"), true);
  assert.equal(directives.has("frame-src https://bitcraftsync.app https://bccodex.com"), true);
  assert.equal(directives.has("media-src 'self'"), true);
  assert.doesNotMatch(contentSecurityPolicy, /bitjita/i);
  assert.match(contentSecurityPolicy, /frame-ancestors 'self'/);
});

test("missing game icons never fall through to the frontend HTML shell", () => {
  assert.equal(shouldFallbackToFrontend("/game-icons/GeneratedIcons/Items/Missing.webp"), false);
  assert.equal(shouldFallbackToFrontend("/research"), true);
});

test("mimeType and staticCacheControl keep frontend asset responses predictable", () => {
  assert.equal(mimeType("index.html"), "text/html; charset=utf-8");
  assert.equal(mimeType("assets/index.js"), "text/javascript; charset=utf-8");
  assert.equal(mimeType("assets/index.css"), "text/css; charset=utf-8");
  assert.equal(mimeType("branding/logo.webp"), "image/webp");
  assert.equal(mimeType("download.unknown"), "application/octet-stream");
  assert.equal(staticCacheControl("index.html"), "no-cache");
  assert.equal(staticCacheControl("assets/index.js"), "public, max-age=31536000, immutable");
});

import { adminPermissionFor } from "../src/server/adminPermissions.mjs";

test("admin popup routes use settings permissions", () => {
  assert.equal(adminPermissionFor("GET", "/api/local/admin/popups"), "settings.view");
  assert.equal(adminPermissionFor("PUT", "/api/local/admin/popups"), "settings.manage");
});
