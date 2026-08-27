import assert from "node:assert/strict";
import test from "node:test";

let boundary = null;
try {
  boundary = await import("../src/server/dedicatedHostBoundary.mjs");
} catch {
  // RED: the dedicated-only boundary has not replaced host profiles yet.
}

const production = { isProduction: true, allowDevelopmentHosts: false };
const development = { isProduction: false, allowDevelopmentHosts: true };

test("dedicated host boundary accepts only the exact production hostname", () => {
  assert.ok(boundary, "dedicated host boundary must exist");
  assert.equal(boundary.isDedicatedRequestHost({ host: "app.timbersteeltrade.com" }, production), true);
  assert.equal(boundary.isDedicatedRequestHost({ host: "app.timbersteeltrade.com:443" }, production), true);
  assert.equal(boundary.isDedicatedRequestHost({ host: "claim-monitor.com" }, production), false);
  assert.equal(boundary.isDedicatedRequestHost({ host: "www.claim-monitor.com" }, production), false);
  assert.equal(boundary.isDedicatedRequestHost({ host: "app.timbersteeltrade.com.evil.example" }, production), false);
  assert.equal(boundary.isDedicatedRequestHost({ host: "public.localhost" }, production), false);
});

test("forwarded hosts are trusted only from loopback Caddy", () => {
  assert.equal(boundary.isDedicatedRequestHost({
    host: "app.timbersteeltrade.com",
    forwardedHost: "claim-monitor.com",
    remoteAddress: "203.0.113.9",
  }, production), true);
  assert.equal(boundary.isDedicatedRequestHost({
    host: "app.timbersteeltrade.com",
    forwardedHost: "claim-monitor.com",
    remoteAddress: "127.0.0.1",
  }, production), false);
  assert.equal(boundary.isDedicatedRequestHost({
    host: "claim-monitor.com",
    forwardedHost: "app.timbersteeltrade.com",
    remoteAddress: "127.0.0.1",
  }, production), true);
});

test("development admits localhost but never the retired public localhost alias", () => {
  assert.equal(boundary.isDedicatedRequestHost({ host: "localhost" }, development), true);
  assert.equal(boundary.isDedicatedRequestHost({ host: "127.0.0.1:19430" }, development), true);
  assert.equal(boundary.isDedicatedRequestHost({ host: "public.localhost" }, development), false);
});

test("production direct loopback is limited to the explicit health exception", () => {
  const request = { host: "127.0.0.1:19430", remoteAddress: "127.0.0.1" };
  assert.equal(boundary.isDedicatedRequestHost(request, {
    ...production,
    allowDirectLoopbackHealthHost: true,
  }), true);
  assert.equal(boundary.isDedicatedRequestHost(request, production), false);
  assert.equal(boundary.isDedicatedRequestHost({
    ...request,
    forwardedHost: "unknown.example",
  }, { ...production, allowDirectLoopbackHealthHost: true }), false);
});
