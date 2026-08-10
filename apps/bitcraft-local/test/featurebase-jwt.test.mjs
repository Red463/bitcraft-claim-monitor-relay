import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

const featurebaseJwtModule = await import("../src/server/featurebaseJwt.mjs").catch(() => ({}));

test("exposes the Featurebase JWT signer", () => {
  assert.equal(typeof featurebaseJwtModule.createFeaturebaseJwt, "function");
});

test("signs the current app user for Featurebase with HS256", () => {
  const token = featurebaseJwtModule.createFeaturebaseJwt({
    secret: "test-featurebase-secret",
    user: {
      id: 42,
      username: "timbersteel",
      globalName: "Timbersteel Member",
      avatarUrl: "https://cdn.example/avatar.png",
    },
  });

  assert.equal(typeof token, "string");
  assert.equal(jwt.decode(token, { complete: true }).header.alg, "HS256");
  const payload = jwt.verify(token, "test-featurebase-secret", { algorithms: ["HS256"] });
  assert.equal(payload.userId, "42");
  assert.equal(payload.name, "Timbersteel Member");
  assert.equal(payload.profilePicture, "https://cdn.example/avatar.png");
  assert.equal(payload.email, undefined);
});

test("keeps visitors anonymous when the signing secret or user is absent", () => {
  assert.equal(featurebaseJwtModule.createFeaturebaseJwt({ secret: "", user: { id: 42 } }), undefined);
  assert.equal(featurebaseJwtModule.createFeaturebaseJwt({ secret: "test-featurebase-secret", user: null }), undefined);
});
