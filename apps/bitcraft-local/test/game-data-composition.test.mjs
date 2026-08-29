import assert from "node:assert/strict";
import test from "node:test";

const { createGameDataCompositionDependencies } = await import(
  new URL("../src/server/game-data/gameDataComposition.ts", import.meta.url).href,
);
const { gameDataResponse } = await import(
  new URL("../src/server/game-data/gameDataRoute.ts", import.meta.url).href,
);

function snapshot(generation, sourceKey = "relay-cache") {
  return {
    generation,
    provenance: {
      sourceKey,
      receivedAt: "2026-08-22T09:00:00.000Z",
    },
  };
}

test("production composition seam captures catalog publication lazily and covers only enriched domains", () => {
  let catalogPublication = snapshot(73, "global");
  const reads = [];
  const revisionInputs = [];
  const composition = createGameDataCompositionDependencies({
    claimId: "1369094286777412590",
    repository: {
      read(claimId, domain) {
        reads.push([claimId, domain]);
        return domain === "catalogs" ? catalogPublication : null;
      },
    },
    catalogRepository: {
      getRevision(publication) {
        revisionInputs.push(publication);
        return {
          generation: publication?.generation ?? null,
          sourceGeneration: 902,
          sourceKey: "global",
          receivedAt: "2026-08-22T09:00:00.000Z",
        };
      },
    },
  });

  assert.deepEqual(composition.forDomain("claim"), {});
  assert.deepEqual(reads, []);
  assert.deepEqual(revisionInputs, []);

  // The queued request passed its gate before this newer publication became visible.
  catalogPublication = snapshot(74, "global");
  assert.deepEqual(composition.forDomain("market"), {
    catalog: {
      generation: 74,
      sourceGeneration: 902,
      sourceKey: "global",
      receivedAt: "2026-08-22T09:00:00.000Z",
    },
  });
  assert.equal(revisionInputs[0], catalogPublication);
  assert.deepEqual(reads, [["1369094286777412590", "catalogs"]]);

  const catalogEnrichedDomains = [
    "inventories",
    "crafts",
    "public-crafts",
    "market",
    "equipment",
    "construction",
    "research",
    "recruitment",
  ];
  for (const domain of catalogEnrichedDomains) {
    assert.ok(composition.forDomain(domain).catalog, `${domain} must declare its catalog dependency`);
  }
  for (const domain of ["claim", "members", "skills", "buildings", "contributions", "region"]) {
    assert.equal(composition.forDomain(domain).catalog, undefined, `${domain} must not declare catalog enrichment`);
  }
  assert.equal(revisionInputs.length, 1);
});

test("production composition seam conditionally declares composed snapshot dependencies", () => {
  const composition = createGameDataCompositionDependencies({
    claimId: "1369094286777412590",
    repository: { read: () => snapshot(81, "global") },
    catalogRepository: {
      getRevision: () => ({
        generation: 81,
        sourceGeneration: 911,
        sourceKey: "global",
        receivedAt: "2026-08-22T09:00:00.000Z",
      }),
    },
  });
  const inventoryBankSnapshot = snapshot(81, "region:19");
  const inventoryStorageSnapshot = snapshot(82, "region:19");
  const publicCraftSnapshot = snapshot(81, "region:19");

  assert.equal(composition.forDomain("inventories")["inventory-banks"], undefined);
  assert.deepEqual(
    composition.forDomain("inventories", { inventoryBankSnapshot, inventoryStorageSnapshot })["inventory-banks"],
    {
      generation: 81,
      sourceKey: "region:19",
      receivedAt: "2026-08-22T09:00:00.000Z",
    },
  );
  assert.deepEqual(
    composition.forDomain("inventories", { inventoryBankSnapshot, inventoryStorageSnapshot })["inventory-storages"],
    {
      generation: 82,
      sourceKey: "region:19",
      receivedAt: "2026-08-22T09:00:00.000Z",
    },
  );
  assert.equal(
    composition.forDomain("inventories", { inventoryStorageSnapshot, inventoryStorageFreshness: "live" })["inventory-storages"]?.freshness,
    "live",
  );
  assert.equal(composition.forDomain("crafts")["public-crafts"], undefined);
  assert.deepEqual(
    composition.forDomain("crafts", { publicCraftSnapshot })["public-crafts"],
    {
      generation: 81,
      sourceKey: "region:19",
      receivedAt: "2026-08-22T09:00:00.000Z",
    },
  );
});

test("absent catalog state is an explicit unknown dependency for enriched domains only", () => {
  const marketSnapshot = {
    data: { marketplaces: [], listings: [] },
    generation: 51,
    confidence: "authoritative",
    lastError: null,
    warnings: [],
    provenance: {
      provider: "relay",
      sourceKey: "region:19",
      regionId: "19",
      database: "relay-region",
      schemaFingerprint: "regional-v1",
      sourceObservedAt: null,
      receivedAt: "2026-08-22T09:00:00.000Z",
    },
  };
  const repository = {
    read(_claimId, domain) {
      if (domain === "market") return marketSnapshot;
      if (domain === "claim") return { ...marketSnapshot, data: { entityId: "1369094286777412590", regionId: "19" } };
      return null;
    },
  };
  const composition = createGameDataCompositionDependencies({
    claimId: "1369094286777412590",
    repository,
    catalogRepository: { getRevision: () => null },
  });

  assert.deepEqual(composition.forDomain("claim"), {});
  assert.deepEqual(composition.forDomain("market"), {
    catalog: {
      generation: null,
      sourceGeneration: null,
      sourceKey: "global",
      receivedAt: null,
    },
  });
  const result = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["market"],
    repository,
    transformDomain: (domain, data) => ({
      data,
      dependencies: composition.forDomain(domain),
    }),
    now: new Date("2026-08-22T09:00:01.000Z"),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.meta.coherence, "mixed");
  assert.deepEqual(result.body.meta.availableGenerations, [51]);

  const nonEnrichedResult = gameDataResponse({
    configuredClaimId: "1369094286777412590",
    claimId: "1369094286777412590",
    domains: ["claim"],
    repository,
    transformDomain: (domain, data) => ({
      data,
      dependencies: composition.forDomain(domain),
    }),
    now: new Date("2026-08-22T09:00:01.000Z"),
  });
  assert.equal(nonEnrichedResult.body.meta.coherence, "coherent");
});
