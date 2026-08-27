import assert from "node:assert/strict";
import test from "node:test";

import * as httpRequests from "../src/server/httpRequests.mjs";

const { originFromRequest, safeReturnPath, sameOriginRequest } = httpRequests;

test("originFromRequest uses forwarded proto and host before local defaults", () => {
  assert.equal(originFromRequest({ headers: { host: "127.0.0.1:18430" } }, { isProduction: false }), "http://127.0.0.1:18430");
  assert.equal(originFromRequest({ headers: { host: "app.example", "x-forwarded-proto": "https,http", "x-forwarded-host": "claim.example,proxy" } }, { isProduction: true }), "https://claim.example");
  assert.equal(originFromRequest({ headers: { host: "claim.example" } }, { isProduction: true }), "https://claim.example");
});

test("sameOriginRequest allows same host and local dev loopback origins only", () => {
  assert.equal(sameOriginRequest({ headers: {} }, { isProduction: true }), true);
  assert.equal(sameOriginRequest({ headers: { origin: "https://claim.example", host: "claim.example" } }, { isProduction: true }), true);
  assert.equal(sameOriginRequest({ headers: { origin: "http://localhost:18428", host: "127.0.0.1:18430" } }, { isProduction: false }), true);
  assert.equal(sameOriginRequest({ headers: { origin: "http://localhost:18428", host: "127.0.0.1:18430" } }, { isProduction: true }), false);
  assert.equal(sameOriginRequest({ headers: { origin: "not-a-url", host: "claim.example" } }, { isProduction: false }), false);
});

test("safeReturnPath keeps local paths and rejects external or malformed redirects", () => {
  assert.equal(safeReturnPath(null), "/?page=dashboard");
  assert.equal(safeReturnPath("  /?page=members  "), "/?page=members");
  assert.equal(safeReturnPath("https://evil.example"), "/?page=dashboard");
  assert.equal(safeReturnPath("//evil.example"), "/?page=dashboard");
  assert.equal(safeReturnPath("/bad\\path"), "/?page=dashboard");
  assert.equal(safeReturnPath("/?page=market\r\nset-cookie: stolen=1"), "/?page=dashboard");
  assert.equal(safeReturnPath("\r\n/?page=market"), "/?page=dashboard");
  assert.equal(safeReturnPath("/?page=market\u0000hidden"), "/?page=dashboard");
  assert.equal(safeReturnPath(`/${"a".repeat(600)}`).length, 500);
});

test("requestLogPolicy suppresses generic callback details for slow, closed, and exceptional requests", () => {
  assert.equal(typeof httpRequests.requestLogPolicy, "function");
  const callbacks = [
    "/api/local/auth/discord/callback?code=secret-code&state=secret-state",
  ];

  for (const callback of callbacks) {
    assert.deepEqual(httpRequests.requestLogPolicy(callback, "slow"), {
      logGeneric: false,
      discordDiagnostic: null,
    });
    assert.deepEqual(httpRequests.requestLogPolicy(callback, "closed"), {
      logGeneric: false,
      discordDiagnostic: null,
    });
    assert.deepEqual(httpRequests.requestLogPolicy(callback, "exception"), {
      logGeneric: false,
      discordDiagnostic: {
        stage: "callback",
        event: "failure",
        reason: "local",
      },
    });
    assert.doesNotMatch(
      JSON.stringify(httpRequests.requestLogPolicy(callback, "exception")),
      /secret-code|secret-state|callback\?/,
    );
  }

  assert.deepEqual(httpRequests.requestLogPolicy("/api/local/health?probe=1", "slow"), {
    logGeneric: true,
    discordDiagnostic: null,
  });
});
