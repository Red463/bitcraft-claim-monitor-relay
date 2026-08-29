import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { loadGameData, pageDomains, usesProviderNeutralGameData } = await import(
  new URL("../src/api/gameData.ts", import.meta.url).href,
);
test("claim overview, Members, Professions, and Leaderboard request provider-neutral local domains", async () => {
  assert.deepEqual(pageDomains("dashboard"), [
    "claim",
    "members",
    "citizens",
    "players",
    "construction",
    "market",
    "research",
    "crafts",
    "region",
    "region-claims",
  ]);
  assert.deepEqual(pageDomains("members"), [
    "claim",
    "members",
    "citizens",
    "players",
    "equipment",
    "crafts",
    "recruitment",
  ]);
  assert.deepEqual(pageDomains("skills"), ["claim", "members", "citizens", "players", "skills"]);
  assert.deepEqual(pageDomains("leaderboard"), ["claim", "members", "citizens", "players", "skills"]);

  const requestedUrls = [];
  const result = await loadGameData(
    "1369094286777412590",
    ["claim", "members"],
    async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({
        claimId: "1369094286777412590",
        regionId: "19",
        generatedAt: "2026-07-29T12:00:00.000Z",
        domains: {
          claim: {
            data: { entityId: "1369094286777412590", name: "Timbersteel Trade", regionId: "19" },
            freshness: "fresh",
            confidence: "joined",
            ageMs: 100,
            provenance: {},
            warnings: [],
          },
          members: {
            data: [{ playerEntityId: "1", userName: "Modular" }],
            freshness: "fresh",
            confidence: "joined",
            ageMs: 100,
            provenance: {},
            warnings: [],
          },
        },
        partialErrors: [],
      }), { status: 200 });
    },
  );

  assert.deepEqual(requestedUrls, [
    "/api/local/game-data?claimId=1369094286777412590&domains=claim%2Cmembers",
  ]);
  assert.equal(result.claim.name, "Timbersteel Trade");
  assert.equal(result.members[0].userName, "Modular");
  assert.equal(result.serverFreshness.stale, false);
});

test("AppShell depends on the provider-neutral transitional loader", async () => {
  const appShell = await readFile(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.match(appShell, /import\s*\{[^}]*\buseGameData\b[^}]*\}\s*from "\.\/api\/gameDataLoader"/);
  assert.match(appShell, /const state = useGameData\(/);
  assert.doesNotMatch(appShell, /useBitjitaData|\.\/api\/bitjita/);
});

test("browser loader routes the first Milestone 3 pages through local game data", async () => {
  const source = await readFile(new URL("../src/api/gameDataLoader.ts", import.meta.url), "utf8");
  for (const panel of ["dashboard", "members", "skills", "leaderboard", "inventory", "craft-monitor"]) {
    assert.equal(usesProviderNeutralGameData(panel), true);
  }
  assert.match(source, /const domains = pageDomains\(activePanel\)/);
  assert.deepEqual(pageDomains("inventory"), ["claim", "members", "inventories"]);
});

test("Craft Monitor uses the provider-neutral craft snapshot and local catalog projection", async () => {
  const source = await readFile(new URL("../src/pages/ProductionPage.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.deepEqual(pageDomains("craft-monitor"), ["claim", "members", "citizens", "players", "crafts", "contributions"]);
  assert.doesNotMatch(source, /\/api\/bitjita/);
  assert.doesNotMatch(source, /\/api\/local\/passive-crafts/);
  assert.match(source, /data\.raw\?\.crafts\?\.passiveCraftResults/);
  assert.match(source, /\/api\/local\/player-data/);
  assert.match(source, /playerToolbeltTools/);
  assert.doesNotMatch(source, /players\/\$\{memberId\}\/inventories/);
  assert.match(server, /enrichCraftsDomain/);
  assert.match(server, /providerCatalogRepository\.getDescription\("crafting_recipe", recipeId\)/);
});

test("Construction uses the provider-neutral live regional snapshot and local catalog projection", async () => {
  const source = await readFile(new URL("../src/pages/ConstructionPage.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.equal(usesProviderNeutralGameData("construction"), true);
  assert.deepEqual(pageDomains("construction"), [
    "claim",
    "members",
    "inventories",
    "construction",
  ]);
  assert.doesNotMatch(source, /\/api\/bitjita/);
  assert.match(server, /enrichConstructionWithCatalog/);
  assert.match(server, /providerCatalogRepository\.getDescription\(kind, id\)/);
  assert.match(server, /if \(domain === "construction"\)[\s\S]*enrichConstructionWithCatalog\(/);
});

test("Research uses the provider-neutral live regional state and global technology catalog", () => {
  assert.equal(usesProviderNeutralGameData("research"), true);
  assert.deepEqual(pageDomains("research"), [
    "claim",
    "members",
    "research",
  ]);
});

test("Hexite Deposits enters Empires through provider-neutral game data without starting the legacy overview request", async () => {
  const source = await readFile(new URL("../src/pages/EmpiresPage.tsx", import.meta.url), "utf8");
  assert.equal(usesProviderNeutralGameData("empires"), true);
  assert.deepEqual(pageDomains("empires"), [
    "claim",
    "members",
    "deposits",
  ]);
  assert.match(source, /React\.useEffect\(\(\) => \{\s*if \(currentTab !== "overview"\) return;\s*const controller = new AbortController\(\);\s*setOverview/);
});

test("Members uses Relay equipment, passive crafts, and bounded player inventory", async () => {
  const source = await readFile(new URL("../src/pages/MembersPage.tsx", import.meta.url), "utf8");
  assert.match(source, /data\.raw\?\.equipment\?\.members/);
  assert.match(source, /data\.raw\?\.crafts\?\.passiveCraftResults/);
  assert.match(source, /\/api\/local\/player-data/);
  assert.doesNotMatch(source, /players\/\$\{selectedId\}\/(?:buffs|equipment|equipment\/presets|inventories|passive-crafts)/);
  assert.doesNotMatch(source, /BitJita has not reported gear/);
  assert.match(source, /recruitmentSummary\(data\.raw\?\.recruitment\)/);
});

test("Inventory uses only provider-neutral local routes", async () => {
  const source = await readFile(new URL("../src/pages/InventoryPage.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\/api\/bitjita/);
  assert.match(source, /const LOCAL_API = "\/api\/local"/);
  assert.match(source, /LOCAL_API}\/catalog\/item-detail/);
  assert.match(server, /\/api\/local\/catalog\/item-detail/);
  assert.match(server, /mergeClaimInventoryWithBanks\(\s*mergeClaimInventoryWithLiveStorages\(data,\s*storage\.data\),\s*bankSnapshot\?\.data,?\s*\)/);
  assert.match(server, /inventoryStorageFreshness: storage\.freshness/);
  assert.match(server, /providerCatalogRepository\.listDescriptions\("crafting_recipe"\)/);
});

test("Activity member filters use the current Relay member domain", async () => {
  const activityPage = await readFile(new URL("../src/pages/ActivityPage.tsx", import.meta.url), "utf8");
  const appShell = await readFile(new URL("../src/AppShell.tsx", import.meta.url), "utf8");

  assert.equal(usesProviderNeutralGameData("activity"), true);
  assert.deepEqual(pageDomains("activity"), ["claim", "members"]);
  assert.match(appShell, /<ActivityPanel[^>]*members=\{data\.members\}/);
  assert.doesNotMatch(activityPage, /\/api\/bitjita|fetch\([^)]*members/);
});

test("Map uses live Relay identity and catalog inputs without the unused legacy layout payload", async () => {
  const mapPage = await readFile(new URL("../src/pages/MapPage.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const normalizer = await readFile(new URL("../src/utils/normalize.ts", import.meta.url), "utf8");

  assert.equal(usesProviderNeutralGameData("map"), true);
  assert.deepEqual(pageDomains("map"), ["claim", "members", "players"]);
  assert.doesNotMatch(mapPage, /data\.layout/);
  assert.doesNotMatch(server, /fetchBitjita\(`\/claims\/\$\{id\}\/layout`/);
  assert.doesNotMatch(server, /payload\("layout"/);
  assert.doesNotMatch(normalizer, /raw\?\.layout|\blayout,/);
});

test("native terrain browser code is same-origin and contains no third-party tile dependency", async () => {
  const nativeMap = await readFile(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const terrainStatus = await readFile(new URL("../src/pages/map/terrainTileStatus.mjs", import.meta.url), "utf8");
  const browserTerrain = `${nativeMap}\n${terrainStatus}`;
  assert.match(browserTerrain, /\/api\/local\/map\/tiles\/status/);
  assert.match(browserTerrain, /mapTileUrl\("terrain"/);
  assert.match(browserTerrain, /mapTileUrl\("water"/);
  assert.match(browserTerrain, /biomeTileUrl\(/);
  assert.doesNotMatch(browserTerrain, /https?:\/\/|prism\.brico|bitcraftmap\.com|BitJita|SpacetimeDB|sharp/i);
});

test("native resource browser code uses only provider-neutral binary partitions", async () => {
  const nativeMap = await readFile(new URL("../src/pages/map/NativeMap.tsx", import.meta.url), "utf8");
  const request = await readFile(new URL("../src/pages/map/nativeMapRequest.mjs", import.meta.url), "utf8");
  const loader = await readFile(new URL("../src/pages/map/mapResourceBinaryLoader.mjs", import.meta.url), "utf8");
  const state = await readFile(new URL("../src/pages/map/mapResourceBinaryState.mjs", import.meta.url), "utf8");
  const packedLayer = await readFile(new URL("../src/pages/map/PackedResourceCanvasLayer.ts", import.meta.url), "utf8");
  const browserResources = `${request}\n${loader}\n${state}\n${packedLayer}`;

  assert.match(nativeMap, /response\.arrayBuffer\(\)/);
  assert.match(request, /\/api\/local\/map\/resource-events/);
  assert.match(loader, /\/api\/local\/map\/resource-partition/);
  assert.doesNotMatch(nativeMap, /mapResourcePartitionLoader|mapResourceSnapshotState|resourceRowsFromPartitions/);
  assert.doesNotMatch(browserResources, /relay\.bitjita|BitJita|SpacetimeDB|resource_state|location_state|entityId|https?:\/\//i);
  assert.doesNotMatch(`${nativeMap}\n${request}`, /\/api\/local\/map\/resources\?/);
});

test("Region composes live regional claims and global status without legacy page requests", async () => {
  const { normalizeData } = await import(new URL("../src/utils/normalize.ts", import.meta.url).href);
  assert.equal(usesProviderNeutralGameData("region"), true);
  assert.deepEqual(pageDomains("region"), [
    "claim",
    "members",
    "players",
    "region",
    "region-claims",
  ]);
  const normalized = normalizeData({
    region: { regions: [{ regionId: "19", signedInPlayers: 12 }] },
    "region-claims": { claims: [{ entityId: "42", name: "Settlement" }] },
  });
  assert.equal(normalized.region[0].name, "Settlement");
  assert.equal(normalized.regionStatus[0].signedInPlayers, 12);
});

test("Public Craft Finder uses the live cross-region Relay projection without browser upstream calls", async () => {
  assert.equal(usesProviderNeutralGameData("publiccrafts"), true);
  assert.deepEqual(pageDomains("publiccrafts"), ["claim", "public-crafts"]);
  const page = await readFile(new URL("../src/pages/PublicCraftFinderPage.tsx", import.meta.url), "utf8");
  const appShell = await readFile(new URL("../src/AppShell.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(page, /\/api\/bitjita|fetch\(/);
  assert.match(appShell, /providerData=\{data\.raw\?\.\["public-crafts"\]\}/);
  assert.match(server, /RelayPublicCraftRuntime/);
  assert.match(server, /domain === "public-crafts"/);
  assert.match(server, /enrichPublicCraftsWithCatalog/);
});

test("Local Market uses the live claim-scoped Relay order generation", async () => {
  assert.equal(usesProviderNeutralGameData("settlement-market"), true);
  assert.deepEqual(pageDomains("settlement-market"), ["claim", "members", "market"]);
  const page = await readFile(new URL("../src/pages/SettlementMarketPage.tsx", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const componentStart = page.indexOf("export function SettlementMarket");
  const componentEnd = page.indexOf("\nexport function ", componentStart + 10);
  const component = page.slice(componentStart, componentEnd === -1 ? page.length : componentEnd);
  assert.doesNotMatch(component, /\/api\/bitjita|fetch\(`\$\{API\}/);
  assert.match(component, /fetch\(`\$\{LOCAL_API\}\/market\/history/);
  assert.match(server, /RelayClaimMarketRuntime/);
  assert.match(server, /domain === "market"/);
  assert.match(server, /enrichMarketWithCatalog/);
  const reconcileStart = server.indexOf("const reconcilePrimaryRegion = async (claimId) =>");
  const reconcileEnd = server.indexOf("const refreshRelay = async", reconcileStart);
  const reconcile = server.slice(reconcileStart, reconcileEnd);
  assert.ok(
    reconcile.indexOf("relayClaimMarketRuntime.start") < reconcile.indexOf("members.length === 0"),
    "claim-market subscriptions must not wait for settlement member data",
  );
});

test("server background ingestion keeps citizens, primary-region state, and public crafts current", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(source, /RelayPrimaryRegionRuntime/);
  assert.match(source, /RelayPublicCraftRuntime/);
  assert.match(source, /domains:\s*\[[^\]]*"claim"[^\]]*"members"[^\]]*"citizens"/);
  assert.match(source, /relayPrimaryRegionRuntime\.(?:start|reconcile)/);
  assert.match(source, /relayPublicCraftRuntime\.start/);
  assert.match(source, /relayPublicCraftRuntime\.warmActiveRegions/);
  assert.match(source, /primaryRegion\s*=\s*runtimeHealthWithPersistedSnapshot\(/);
  assert.match(source, /publicCrafts\s*=\s*runtimeHealthWithPersistedSnapshot\(/);
  const reconcileStart = source.indexOf("const reconcilePrimaryRegion = async (claimId) =>");
  const reconcileEnd = source.indexOf("const refreshRelay = async", reconcileStart);
  const reconcile = source.slice(reconcileStart, reconcileEnd);
  assert.ok(
    reconcile.indexOf("relayPublicCraftRuntime.start") < reconcile.indexOf("members.length === 0"),
    "public crafts must start once the region is known and must not wait for member data",
  );
  const refreshStart = source.indexOf("const refreshRelay = async");
  const refreshEnd = source.indexOf("requestRelayRuntimeRefresh =", refreshStart);
  assert.match(
    source.slice(refreshStart, refreshEnd),
    /relayClaimScopeFence\.run\(claimId,[\s\S]*await reconcilePrimaryRegion\(claimId\);[\s\S]*relayPublicCraftRuntime\.warmActiveRegions\(\)/,
    "every live refresh must keep configured public-craft regions warm",
  );
});

test("Relay HTTP current domains refresh on their own live loop instead of the legacy collector schedule", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /RELAY_HTTP_REFRESH_MS \?\? 15000/);
  assert.match(server, /createScheduledRelayReconciler\(\{[\s\S]*reconcile: refreshRelay/);
  assert.match(
    server,
    /setInterval\([\s\S]*relayRuntimeReconciler\.request\("scheduled"\)[\s\S]*relayHttpRefreshMs/,
  );
  assert.doesNotMatch(server, /setInterval\(\(\) => void refreshRelay\(\), serverRefreshIntervalMs\(\)\)/);
});

test("bounded member inventory and housing are exposed through a provider-neutral guarded local route", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const routeIndex = server.indexOf('url.pathname === "/api/local/player-data"');
  assert.notEqual(routeIndex, -1);
  const boundary = server.indexOf("\n    if (req.method", routeIndex + 10);
  const handler = server.slice(routeIndex, boundary === -1 ? routeIndex + 2200 : boundary);
  assert.match(handler, /manualRefreshAccess\(req, res\)/);
  assert.match(handler, /relayPlayerDataService\.inventory/);
  assert.match(handler, /relayPlayerDataService\.housing/);
  assert.match(handler, /inventory/);
  assert.match(handler, /housing/);
  assert.doesNotMatch(handler, /bitjita/i);
});

test("browser loader keeps usable stale envelopes and rejects an all-unavailable response", async () => {
  const stale = await loadGameData("1369094286777412590", ["claim"], async () => new Response(JSON.stringify({
    claimId: "1369094286777412590",
    regionId: "19",
    generatedAt: "2026-07-29T12:00:00.000Z",
    domains: {
      claim: {
        data: { entityId: "1369094286777412590", name: "Timbersteel Trade", regionId: "19" },
        freshness: "stale",
        confidence: "joined",
        ageMs: 120000,
        provenance: { receivedAt: "2026-07-29T11:58:00.000Z" },
        warnings: [],
      },
    },
    partialErrors: ["claim: Relay unavailable"],
  }), { status: 200 }));
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.partialErrors, ["claim: Relay unavailable"]);

  await assert.rejects(
    loadGameData("1369094286777412590", ["claim"], async () => new Response("unavailable", { status: 503 })),
    /game data.*HTTP 503/i,
  );
});
