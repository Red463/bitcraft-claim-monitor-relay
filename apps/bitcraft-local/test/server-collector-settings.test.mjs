import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("construction current state has one Relay owner and no scheduled BitJita writer", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const adminDisplay = readFileSync(
    new URL("../src/components/admin/adminDisplay.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /function currentConstructionProjection\(claimId\)/);
  assert.match(source, /currentStateRepository\.read\(String\(claimId\), "construction"\)/);
  assert.match(source, /enrichConstructionWithCatalog/);
  assert.doesNotMatch(source, /fetchBitjita\(`\/claims\/\$\{id\}\/construction`/);
  assert.doesNotMatch(source, /collectorDue\(id, "construction"/);
  assert.doesNotMatch(source, /timedCollectorFetch\(metrics, "construction"/);
  assert.doesNotMatch(adminDisplay, /construction:\s*"Records construction/);
});

test("storage activity runs on the Relay live loop rather than a scheduled collector", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

  assert.match(source, /relayStorageActivityService\.sync\(\{/);
  assert.doesNotMatch(source, /collectStorageActivity/);
  assert.doesNotMatch(source, /storageActivityJobBudget/);
  assert.doesNotMatch(source, /collector(?:Attempt|Success|Failure)\("storageActivity"/);
  assert.doesNotMatch(source, /\/logs\/storage/);
  assert.match(source, /relayHttp\.storageLogs\(\{/);
});

test("regional rankings run on a live typed session rather than BitJita pagination or a scheduled collector", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

  assert.match(source, /RelayRegionClaimsRuntime/);
  assert.doesNotMatch(source, /function fetchCachedRegionClaims/);
  assert.doesNotMatch(source, /function fetchAllRegionClaims/);
  assert.doesNotMatch(source, /fetchBitjita\("\/regions\/status"/);
  assert.doesNotMatch(source, /fetchBitjita\(`\/stats\/trade-volume/);
  assert.doesNotMatch(source, /url\.pathname === "\/api\/local\/region\/claims"/);
});

test("global catalog supervisor reconciles healthy topology on the runtime cadence", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function superviseRelayGlobalCatalog");
  const end = source.indexOf("function startBackgroundTasks", start);
  const supervisor = source.slice(start, end);

  assert.ok(start > -1 && end > start);
  assert.match(
    supervisor,
    /if \(healthy\) \{[\s\S]*?relayGlobalCatalogRuntime\.reconcile\(\{[\s\S]*?relayBaseUrl,[\s\S]*?claimId: currentClaimId\(\)/,
  );
});

test("Empire current state runs on the adaptive regional Relay runtime", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

  assert.match(source, /RelayEmpireRuntime/);
  assert.match(source, /relayEmpireRuntime\.reconcile/);
  assert.match(source, /relayEmpireRuntime\.warmActiveRegions/);
  assert.match(source, /currentStateRepository\.read\(currentClaimId\(\), "empires"\)/);
  assert.match(source, /domains\.includes\("empires"\)/);
  assert.doesNotMatch(source, /function regionalEmpire(?:Overview|Details|ClaimMembers|Watchtowers)/);
  assert.doesNotMatch(source, /empireScout(?:Cache|Inflight)/);
});

test("Relay terrain builds run only through the background runtime while HTTP reads installed bundles", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /const relayTerrainRuntime = new RelayTerrainRuntime/);
  assert.match(source, /if \(!relayTerrainStarted\) \{[\s\S]*?relayTerrainRuntime\.start/);
  assert.match(source, /relayTerrainRuntime\.reconcile/);
  assert.match(source, /serveLocalMapTile\(url\.pathname, res, terrainTileStore, undefined, relayTerrainRuntime\.health\(\), roadTileStore\)/);
  assert.match(source, /if \(processRoleConfig\.runBackgroundJobs\) startBackgroundTasks\(\)/);
  assert.doesNotMatch(source, /renderTerrainTile\([^\n]*url\.pathname/);
});

test("empire membership history is subscription-driven without a scheduled collector", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /onSnapshotCommitted:\s*syncEmpireMembershipFromRelaySnapshot/);
  assert.match(source, /source:\s*"relay-subscription"/);
  assert.doesNotMatch(source, /runEmpireMembershipCollector/);
  assert.doesNotMatch(source, /fetchBitjita\([^\n]*\/empires/);
});

test("periodic reconciliation has no legacy current-domain writer", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const prepared = readFileSync(new URL("../src/server/preparedStatements.mjs", import.meta.url), "utf8");
  const pollStart = source.indexOf("async function collectServerSnapshot");
  const pollEnd = source.indexOf("function marketHistory", pollStart);
  const polling = source.slice(pollStart, pollEnd);

  assert.ok(pollStart > -1);
  assert.ok(pollEnd > pollStart);
  assert.doesNotMatch(source, /function (?:buildCurrentClaimData|refreshCurrentClaimState|persistDomainPayloads|readDomainPayloadMap|domainRowsToAppData)\b/);
  assert.doesNotMatch(prepared, /\b(?:domainPayloadsByClaim|domainPayload|upsertDomainPayload|updateDomainPayloadError)\b/);
  assert.doesNotMatch(polling, /(?:fetchBitjita|fetchAllClaimListings|settlementProductionCrafts|playerDetailSummaries|upsertDomainPayload)/);
});

test("completed sales are Relay-native and have no BitJita reconciler or schedule", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const session = readFileSync(
    new URL("../src/server/game-data/claimMarketRegionSession.ts", import.meta.url),
    "utf8",
  );
  const regionalSession = readFileSync(
    new URL("../src/server/game-data/regionalMarketRegionSession.ts", import.meta.url),
    "utf8",
  );

  assert.match(session, /closed_listing_state/);
  assert.match(regionalSession, /closed_listing_state/);
  assert.match(regionalSession, /this\.#applySnapshot\(connection, true\)/);
  const claimRuntimeStart = source.indexOf("const relayClaimMarketRuntime = new RelayClaimMarketRuntime");
  const regionalRuntimeStart = source.indexOf("const relayRegionalMarketRuntime = new RelayRegionalMarketRuntime");
  const nextRuntimeStart = source.indexOf("const relayEmpireRuntime", regionalRuntimeStart);
  const claimRuntime = source.slice(claimRuntimeStart, regionalRuntimeStart);
  const regionalRuntime = source.slice(regionalRuntimeStart, nextRuntimeStart);

  assert.ok(claimRuntimeStart > -1);
  assert.ok(regionalRuntimeStart > claimRuntimeStart);
  assert.match(claimRuntime, /onSnapshotCommitted:[\s\S]*relayMarketTransitionWriter\.apply/);
  assert.match(regionalRuntime, /onCurrentPublished:[\s\S]*queueMarketDealWatchEvaluation/);
  assert.doesNotMatch(regionalRuntime, /onSnapshotCommitted/);
  assert.doesNotMatch(source, /regionalMarketTransitionSnapshot/);
  assert.doesNotMatch(source, /\/market\/player\//);
  assert.doesNotMatch(source, /\b(?:runMarketTradeCollector|importMemberSellTrades|marketTradeBackfillKey)\b/);
  assert.doesNotMatch(source, /\bmarketTrades\b/);
});

test("production lifecycle and contributions follow committed Relay state without a scheduled acquisition job", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const session = readFileSync(
    new URL("../src/server/game-data/primaryRegionPlayerSession.ts", import.meta.url),
    "utf8",
  );
  const activityStart = source.indexOf("async function runProductionActivityCollector");
  const snapshotStart = source.indexOf("async function collectServerSnapshot");
  const activityFunction = source.slice(activityStart, snapshotStart);

  assert.ok(activityStart > -1);
  assert.ok(snapshotStart > activityStart);
  assert.match(source, /productionRelayLifecycleCoordinator\?\.onCommit\(event\)/);
  assert.match(source, /settlementRelayTransitionCoordinator\?\.onCommit\(event\)/);
  assert.doesNotMatch(source.slice(snapshotStart), /await runProductionActivityCollector\(claimId, currentData\);/);
  assert.doesNotMatch(source.slice(snapshotStart), /recordSettlementState\(/);
  assert.doesNotMatch(source, /url\.pathname === "\/api\/local\/snapshot"/);
  assert.doesNotMatch(source, /sideEffectCollectorDue\("snapshotHistory"/);
  assert.doesNotMatch(source, /collector(?:Attempt|Success|Failure)\("snapshotHistory"/);
  assert.match(activityFunction, /syncProductionJobActivityForSnapshot/);
  assert.doesNotMatch(source, /runProductionContributionCollector|fetchCraftContributionEvidence|syncProductionContributionsForSnapshot/);
  assert.match(session, /progressive_action_state/);
  assert.match(session, /event\.tag !== "Transaction"/);
  assert.match(session, /progressDelta <= 0n/);
  assert.match(session, /domain:\s*"contributions"/);
  assert.match(source, /relayCraftContributionTargets/);
  assert.match(source, /import \{[^}]*productionMetrics[^}]*\} from "\.\/src\/server\/productionActivity\.mjs"/);
  assert.match(source, /function craftPrimarySkill\(craft\) \{\s*return productionMetrics\(craft\)\.skillName;/);
  assert.doesNotMatch(source, /return skillId \? skillNames\[skillId\]/);
  assert.doesNotMatch(source, /catch \{\s*return \[\];\s*\}/);
});

test("market listing activity is subscription-driven rather than scheduled", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /runMarketListingsCollector/);
  assert.doesNotMatch(source, /syncMarketListingsForSnapshot/);
  assert.match(source, /createRelayMarketTransitionWriter/);
  assert.match(source, /onSnapshotCommitted/);
});

test("regional buy orders are subscription-driven with no SQL current cache", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /RelayRegionalMarketRuntime/);
  assert.match(source, /currentStateRepository\.read\([^,]+,\s*"regional-market"\)/);
  assert.match(source, /relayRegionalMarketRuntime\.reconcile/);
  assert.doesNotMatch(source, /relayRegionalMarketRuntime\.warmActiveRegions/);
  assert.doesNotMatch(source, /\bcurrent\.buyOrders\b/);
  assert.doesNotMatch(source, /const markerKey = "regional_buy_order_(?:collector|state)_retired_at"/);
  assert.doesNotMatch(source, /fetchRegionalBuyOrders/);
  assert.doesNotMatch(source, /fetchRegionalBuyOrderSaleAverages/);
  assert.doesNotMatch(source, /persistRegionalBuyOrdersCurrent/);
  assert.doesNotMatch(source, /persistRegionalSaleAverages/);
  assert.doesNotMatch(source, /market_buy_orders_current/);
  assert.doesNotMatch(source, /market_regional_sale_averages_current/);
  assert.doesNotMatch(source, /existingBuyOrders|buyOrders:\s*\{/);
});

test("collector status reports side-effect attempts without reading current-domain payload rows", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function collectorStatusPayload");
  const end = source.indexOf("async function syncEmpireMembershipFromRelaySnapshot", start);
  const implementation = source.slice(start, end);

  assert.ok(start > -1);
  assert.ok(end > start);
  assert.doesNotMatch(implementation, /currentClaimId\(\)|domainPayload|lastRunMetrics/);
  assert.match(implementation, /collectors: pollStatus\.collectors/);
});

test("settlement collection operator copy no longer describes snapshot history", () => {
  const source = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");

  for (const legacy of [
    "BitCraft snapshot poll failed",
    "Server snapshot polling failed",
    "Server snapshot polling enabled",
  ]) assert.doesNotMatch(source, new RegExp(legacy));
});
