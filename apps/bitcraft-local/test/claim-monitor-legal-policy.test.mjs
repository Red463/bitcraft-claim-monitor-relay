import assert from "node:assert/strict";
import test from "node:test";

import { claimMonitorLegalPolicyForEnvironment } from "../src/legal/legalPolicy.mjs";
import { legalPolicyDigests } from "../src/server/legalPolicyDigest.mjs";

test("Claim Monitor publishes a distinct accurate policy under the same controller", () => {
  const policy = claimMonitorLegalPolicyForEnvironment({
    LEGAL_CONTROLLER_NAME: "Thomas Bush",
    LEGAL_CONTROLLER_COUNTRY: "United Kingdom",
  });
  const text = JSON.stringify(policy);

  assert.equal(policy.version, "2026-08-26");
  assert.equal(policy.effectiveDate, "2026-08-26");
  assert.equal(policy.operator.controllerName, "Thomas Bush");
  assert.equal(policy.operator.projectName, "BitCraft Claim Monitor");
  assert.equal(policy.operator.privacyEmail, "privacy@claim-monitor.com");
  for (const phrase of ["Discord OAuth", "plans", "bearer links", "BitCraft Relay", "security logs", "export", "deletion"]) {
    assert.match(text, new RegExp(phrase, "i"));
  }
  assert.doesNotMatch(text, /settlement|timbersteel/i);
  assert.doesNotMatch(text, /continuous monitoring|Discord bot|Discord services|Featurebase|analytics events/i);
  const inactivity = policy.retention.find((rule) => rule.key === "inactive-account");
  assert.match(inactivity.rule, /24 months/i);
  assert.match(inactivity.rule, /owned plan/i);
  assert.match(inactivity.rule, /accepted editor/i);
  assert.match(inactivity.rule, /viewer-only/i);
});

test("Claim Monitor document digests are distinct from Timbersteel documents", async () => {
  const module = await import("../src/legal/legalPolicy.mjs");
  const publicDigests = legalPolicyDigests(module.claimMonitorLegalPolicyForEnvironment({}));
  const timbersteelDigests = legalPolicyDigests(module.legalPolicyForEnvironment({}));
  assert.notEqual(publicDigests.termsDigest, timbersteelDigests.termsDigest);
  assert.notEqual(publicDigests.privacyDigest, timbersteelDigests.privacyDigest);
});
