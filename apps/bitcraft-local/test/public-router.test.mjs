import assert from "node:assert/strict";
import test from "node:test";

let publicRoutes = null;
try {
  publicRoutes = await import("../src/public/routes.mjs");
} catch {
  // RED: the isolated public route and preference boundary does not exist yet.
}

test("public router accepts only the supported canonical paths", () => {
  assert.ok(publicRoutes, "public route boundary must exist");

  assert.deepEqual(publicRoutes.resolvePublicRoute("/"), { id: "home", params: {} });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/claims/18446744073709551615"), {
    id: "dashboard",
    params: { claimId: "18446744073709551615" },
  });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/settlements/18446744073709551615"), {
    id: "dashboard",
    params: { claimId: "18446744073709551615" },
    canonicalPath: "/claims/18446744073709551615",
  });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/plans"), { id: "plans", params: {} });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/plans/new"), { id: "plan-new", params: {} });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/plans/plan-7"), { id: "plan", params: { id: "plan-7" } });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/shared-plans/share-7"), { id: "shared-plan", params: { id: "share-7" } });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/invites/invite-7"), { id: "invite", params: { id: "invite-7" } });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/api/local/health"), { id: "not-found", params: {} });
  assert.deepEqual(publicRoutes.resolvePublicRoute("/plans/plan-7/extra"), { id: "not-found", params: {} });
});

test("public browser preferences are isolated under the claim-monitor prefix", () => {
  assert.equal(publicRoutes.publicStorageKey("recent-settlements"), "claim-monitor.public.recent-settlements");
  assert.throws(() => publicRoutes.publicStorageKey(""), /suffix/i);
  assert.throws(() => publicRoutes.publicStorageKey("timbersteel.theme"), /suffix/i);
});
