import assert from "node:assert/strict";
import test from "node:test";

const warningModule = await import(
  new URL("../src/api/pageGameDataWarnings.ts", import.meta.url).href,
);
const {
  gameDataQualitySummaries,
  groupDomainWarnings,
  pageGameDataWarnings,
  publicGameDataQualitySummaries,
  relayOutageNotice,
} = warningModule;

test("Relay readiness failures produce a concise outage notice", () => {
  const stale = (warnings) => ({
    generation: 8,
    freshness: "stale",
    confidence: "authoritative",
    ageMs: 10_800_000,
    warnings,
    provenance: null,
    dependencies: {},
  });

  assert.deepEqual(relayOutageNotice("dashboard", {
    claim: stale(["Relay HTTP 404 for /claim/1369094286777412590"]),
    market: stale(["Relay HTTP 404 for /claim/1369094286777412590"]),
    research: stale([]),
    "region-claims": stale(["Relay region 19 source is not ready or has no schema fingerprint"]),
  }), {
    affectedAreas: ["Dashboard", "Local Market", "Research", "Region"],
    lastLiveUpdateAge: "3h",
  });
});

test("ordinary stale or partial data is not labeled as a Relay outage", () => {
  assert.equal(relayOutageNotice("settlement-market", {
    market: {
      generation: 8,
      freshness: "stale",
      confidence: "partial",
      ageMs: 240_000,
      warnings: ["Market listing description unavailable."],
      provenance: null,
      dependencies: {},
    },
  }), null);
});

test("mixed local generations alone do not create a public warning", () => {
  const freshStatus = {
    generation: 8,
    freshness: "fresh",
    confidence: "authoritative",
    ageMs: 1_000,
    warnings: [],
    provenance: null,
    dependencies: {},
  };

  assert.deepEqual(publicGameDataQualitySummaries("map", {
    claim: freshStatus,
    members: freshStatus,
    players: { ...freshStatus, generation: 9 },
  }, "mixed"), []);
  assert.deepEqual(publicGameDataQualitySummaries("map", {}, "unavailable"), [
    "Requested data unavailable",
  ]);
});

test("Dashboard ignores missing owner enrichment but preserves operational warnings", () => {
  const warnings = [
    "region-claims: Regional claims missing owner usernames: 999.",
    "research: data is stale.",
  ];
  assert.deepEqual(pageGameDataWarnings("dashboard", warnings), [
    "research: data is stale.",
  ]);
  assert.deepEqual(pageGameDataWarnings("region", warnings), warnings);
});

test("stale-data copy only says refresh continues while a request is active", () => {
  assert.equal(typeof warningModule.staleDataWarning, "function");
  assert.equal(
    warningModule.staleDataWarning({ stale: true, refreshActive: true, lastUpdatedLabel: "10:42:03" }),
    "Showing saved data from 10:42:03 while refresh continues.",
  );
  assert.equal(
    warningModule.staleDataWarning({ stale: true, refreshActive: false, lastUpdatedLabel: "10:42:03" }),
    "Showing saved data from 10:42:03; live refresh is unavailable.",
  );
  assert.equal(
    warningModule.staleDataWarning({ stale: false, refreshActive: false, lastUpdatedLabel: null }),
    "",
  );
});

test("domain quality summaries use affected operational panel labels", () => {
  const partial = (warnings = ["Description unavailable."]) => ({
    generation: 8,
    freshness: "fresh",
    confidence: "partial",
    ageMs: 1_000,
    warnings,
    provenance: null,
    dependencies: {},
  });
  const cases = [
    ["dashboard", "claim", "Dashboard partial (1 warning)"],
    ["skills", "skills", "Professions partial (1 warning)"],
    ["research", "research", "Research partial (1 warning)"],
    ["settlement-market", "market", "Local Market partial (1 warning)"],
    ["region", "region", "Region partial (1 warning)"],
    ["publiccrafts", "public-crafts", "Public Craft Finder partial (1 warning)"],
  ];

  for (const [panel, domain, expected] of cases) {
    assert.deepEqual(gameDataQualitySummaries(panel, { [domain]: partial() }), [expected]);
  }
});

test("domain quality summaries include stale age and grouped warning counts", () => {
  const repeatedWarnings = Array.from(
    { length: 88 },
    (_, index) => `Market listing ${index + 1} is missing a catalog label.`,
  );
  const summaries = gameDataQualitySummaries("dashboard", {
    research: {
      generation: 8,
      freshness: "stale",
      confidence: "authoritative",
      ageMs: 240_000,
      warnings: [],
      provenance: null,
      dependencies: {},
    },
    market: {
      generation: 8,
      freshness: "fresh",
      confidence: "partial",
      ageMs: 1_000,
      warnings: repeatedWarnings,
      provenance: null,
      dependencies: {},
    },
  });

  assert.deepEqual(summaries, [
    "Research stale (4m)",
    "Local Market partial (88 warnings)",
  ]);
  assert.deepEqual(groupDomainWarnings({ market: {
    generation: 8,
    freshness: "fresh",
    confidence: "partial",
    ageMs: 1_000,
    warnings: repeatedWarnings,
    provenance: null,
    dependencies: {},
  } }), {
    groups: [{
      key: "market:Market listing # is missing a catalog label.",
      domain: "market",
      message: "Market listing # is missing a catalog label.",
      count: 88,
      examples: repeatedWarnings.slice(0, 3),
    }],
    totalGroupCount: 1,
    omittedGroupCount: 0,
    omittedWarningCount: 0,
    totalWarningCount: 88,
  });
});

test("warning detail model groups embedded identifiers and hard-caps high-cardinality output", () => {
  const identifierWarnings = Array.from(
    { length: 20 },
    (_, index) => `Market order-a${index}b${index + 1} is missing a catalog label.`,
  );
  const uniqueWarnings = Array.from(
    { length: 30 },
    (_, index) => `Distinct warning ${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`,
  );
  const result = groupDomainWarnings({ market: {
    generation: 8,
    freshness: "fresh",
    confidence: "partial",
    ageMs: 1_000,
    warnings: [...identifierWarnings, ...uniqueWarnings],
    provenance: null,
    dependencies: {},
  } });

  assert.equal(result.groups.length, 12);
  assert.equal(result.groups[0].message, "Market # is missing a catalog label.");
  assert.equal(result.groups[0].count, 20);
  assert.deepEqual(result.groups[0].examples, identifierWarnings.slice(0, 3));
  assert.equal(result.totalGroupCount, 31);
  assert.equal(result.omittedGroupCount, 19);
  assert.equal(result.omittedWarningCount, 19);
  assert.equal(result.totalWarningCount, 50);
});
