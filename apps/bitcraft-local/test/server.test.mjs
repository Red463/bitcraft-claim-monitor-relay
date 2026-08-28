import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { connect } from "node:net";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { legalPolicyForEnvironment } from "../src/legal/legalPolicy.mjs";
import { createEmpireMembershipRepository } from "../src/server/empireMembership.mjs";
import { legalPolicyDigests } from "../src/server/legalPolicyDigest.mjs";
import { createTimbersteelFetch } from "./support/timbersteelFetch.mjs";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const claimId = "1369094286777412590";
const legalPolicy = legalPolicyForEnvironment({});
const legalDigests = legalPolicyDigests(legalPolicy);
const relayBindingManifest = JSON.parse(await readFile(
  path.join(appDir, "src", "server", "game-data", "bindings", "schema-manifest.json"),
  "utf8",
));
const mapResourceRegionIds = ["3", "7", "8", "9", "11", "12", "13", "14", "15", "17", "18", "19", "23"];
const { fetch, registerOrigin } = createTimbersteelFetch();

process.env.RETIRED_TABLE_GUARD_TEST = "true";

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function requestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

async function jsonWithObservedResponseSize(response) {
  const text = await response.text();
  const responseBytes = Buffer.byteLength(text);
  assert.ok(responseBytes > 0, "expected a non-empty JSON response");
  return { body: JSON.parse(text), responseBytes };
}

function gameDataProbabilityFixture(url, res) {
  if (url.pathname === "/game-data/item-lists") {
    json(res, [{ id: 55, possibilities: [
      { probability: 0.2, items: [{ item_id: 400, item_type: "Item", quantity: 1 }] },
      { probability: 0.8, items: [] },
    ] }]);
    return true;
  }
  if (url.pathname === "/game-data/resources") {
    json(res, [{ id: 1, name: "Test Resource", max_health: 1, on_destroy_yield: [] }]);
    return true;
  }
  return false;
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function availablePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function pipelinedHttpStatuses(port, paths) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = connect({ host: "127.0.0.1", port }, () => {
      socket.write(paths.map((requestPath, index) => [
        `GET ${requestPath} HTTP/1.1`,
        "Host: app.timbersteeltrade.com",
        "Accept: application/json",
        `Connection: ${index === paths.length - 1 ? "close" : "keep-alive"}`,
        "",
        "",
      ].join("\r\n")).join(""));
    });
    socket.setTimeout(5000, () => socket.destroy(new Error("Timed out waiting for pipelined HTTP responses")));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      const response = Buffer.concat(chunks).toString("utf8");
      resolve([...response.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((match) => Number(match[1])));
    });
    socket.on("error", reject);
  });
}

async function waitForHealth(origin, child) {
  registerOrigin(origin);
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`Server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/local/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for server health");
}

async function waitForCondition(description, check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function writeDatabaseWithRetry(dbPath, mutate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("PRAGMA busy_timeout = 250");
      const result = mutate(db);
      db.close();
      return result;
    } catch (error) {
      db.close();
      lastError = error;
      if (!String(error?.message ?? "").includes("database is locked")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error(`Timed out writing ${dbPath}`);
}

async function createTestAdminSession(dbPath, { username, role }) {
  const token = createHash("sha256").update(`${username}:${role}:${Date.now()}:${Math.random()}`).digest("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const csrfToken = createHash("sha256").update(`csrf:${token}`).digest("base64url");
  const user = await writeDatabaseWithRetry(dbPath, (db) => {
    const now = new Date().toISOString();
    let existing = db.prepare("SELECT id, role FROM admin_users WHERE username = ?").get(username);
    if (!existing) {
      const result = db.prepare(`
        INSERT INTO admin_users (username, password_hash, role, active, created_at)
        VALUES (?, 'discord-oauth-admin', ?, 1, ?)
      `).run(username, role, now);
      existing = { id: result.lastInsertRowid, role };
    }
    db.prepare(`
      INSERT INTO admin_sessions (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, existing.id, new Date(Date.now() + 60 * 60 * 1000).toISOString(), now);
    return existing;
  });
  return {
    cookie: `bitcraft_admin_session=${token}`,
    csrfToken,
    user: { role: user.role },
  };
}

async function stop(child) {
  if (child.exitCode != null) return;
  child.kill();
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 3000);
  });
}

function zipStore(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuffer, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt32LE(0, 12);
    entry.writeUInt32LE(0, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuffer.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt32LE(0, 34);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

test("server collection paginates listings and protects production mutations", async (t) => {
  const requestedPages = [];
  const seasonalClaimId = "seasonal-claim";
  const relayCraftId = (revision) => (1369094286777412600n + BigInt(revision)).toString();
  const listings = [
    { entityId: "1001", itemName: "Bronze Ingot", ownerUsername: "Tester", ownerEntityId: "player-1", itemId: 10, itemType: "item", quantity: 12, price: 4, side: "sell" },
    { entityId: "1002", itemName: "Oak Plank", ownerUsername: "Tester", ownerEntityId: "player-1", itemId: 20, itemType: "item", quantity: 8, price: 6, side: "sell" },
  ];
  const buyListings = [
    { entityId: "buy-listing-1", claimEntityId: claimId, claimName: "Timbersteel Trade", regionId: 19, regionName: "Zephra", ownerUsername: "Buyer", ownerEntityId: "buyer-1", itemId: 30, itemType: "0", itemName: "Leather", itemTier: 2, itemRarityStr: "Common", iconAssetName: "leather.png", quantity: 10, price: 12, storedCoins: 120, side: "buy", timestamp: "2026-05-20T12:00:00.000Z", inventoryPermission: true },
    { entityId: "buy-listing-2", claimEntityId: claimId, claimName: "Timbersteel Trade", regionId: 19, regionName: "Zephra", ownerUsername: "Buyer", ownerEntityId: "buyer-1", itemId: 31, itemType: "0", itemName: "Slow Gem", itemTier: 3, itemRarityStr: "Common", iconAssetName: "gem.png", quantity: 1, price: 100, storedCoins: 100, side: "buy", timestamp: "2026-05-20T12:00:00.000Z", inventoryPermission: true },
    { entityId: "buy-listing-3", claimEntityId: claimId, claimName: "Timbersteel Trade", regionId: 19, regionName: "Zephra", ownerUsername: "Buyer", ownerEntityId: "buyer-1", itemId: 32, itemType: "1", itemName: "Fine Timber Package", itemTier: 4, itemRarityStr: "Common", iconAssetName: "timber.png", quantity: 2, price: 50, storedCoins: 100, side: "buy", timestamp: "2026-05-20T12:00:00.000Z", inventoryPermission: true },
  ];
  const seasonalBuyListings = [
    { entityId: "buy-listing-r3", claimEntityId: seasonalClaimId, claimName: "Seasonal Market", regionId: 3, regionName: "Region 3", ownerUsername: "Regional Buyer", ownerEntityId: "buyer-r3", itemId: 30, itemType: "0", itemName: "Leather", itemTier: 2, itemRarityStr: "Common", iconAssetName: "leather.png", quantity: 5, price: 12, storedCoins: 60, side: "buy", timestamp: "2026-05-20T12:00:00.000Z", inventoryPermission: true },
  ];
  let currentListings = listings;
  let proxyCacheRequests = 0;
  let failCacheTest = false;
  let resourceCatalogRequests = 0;
  let creatureCatalogRequests = 0;
  let regionStatusRequests = 0;
  let regionListRequests = 0;
  let passiveCraftRequests = 0;
  let playerDetailRequests = 0;
  let playerCraftRequests = 0;
  let recipeDetailRequests = 0;
  let priceHistoryRequests = 0;
  let claimDetailRequests = 0;
  let memberListRequests = 0;
  let slowPriceHistoryResponded = false;
  let geoipDownloadRequests = 0;
  let ipapiRequests = 0;
  let craftEntityRevision = 0;
  let craftOwnerUsername = "Tester";
  let craftBuildingName = "Public Station";
  let craftProgressOverride = null;
  let failClaimRefresh = false;
  let failEmpireList = false;
  let failEmpireTowers = false;
  const discordDirectMessages = [];
  const discordChannelMessages = [];
  const failedDiscordRecipients = new Set();
  let discordAssignmentRace = null;
  const upstream = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/health") {
      const port = upstream.address()?.port;
      return json(res, {
        sources: Object.fromEntries(mapResourceRegionIds.map((regionId) => [`region:${regionId}`, {
          database: `bitcraft-live-${regionId}`,
          port,
          schema_cached: true,
          connectivity: "live",
          tables_live: 1,
          tables_total: 1,
          metrics: {
            upstream_database: `bitcraft-live-${regionId}`,
            publisher: { fingerprint: relayBindingManifest.schemas.regional.fingerprint },
          },
        }])),
      });
    }
    if (url.pathname === "/cache-health") {
      return json(res, {
        ready: true,
        regions: mapResourceRegionIds.map((region) => ({ region, ready: true })),
      });
    }
    if (url.pathname === "/discord/api/v10/users/@me/channels" && req.method === "POST") {
      const body = await requestJson(req);
      const recipientId = String(body.recipient_id ?? "");
      if (failedDiscordRecipients.has(recipientId)) return json(res, { error: "simulated DM failure" }, 500);
      return json(res, { id: `dm-${recipientId}` });
    }
    if (url.pathname.startsWith("/discord/api/v10/channels/") && url.pathname.endsWith("/messages") && req.method === "POST") {
      const channelId = decodeURIComponent(url.pathname.split("/")[5] ?? "");
      const payload = await requestJson(req);
      const recipientId = channelId.startsWith("dm-") ? channelId.slice(3) : "";
      const messageId = `message-${discordDirectMessages.length + discordChannelMessages.length + 1}`;
      if (recipientId) {
        discordDirectMessages.push({ id: messageId, recipientId, payload });
        if (discordAssignmentRace?.recipientId === recipientId) {
          const race = discordAssignmentRace;
          discordAssignmentRace = null;
          await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (raceDb) => {
            raceDb.prepare("UPDATE user_accounts SET character_player_id = ?, character_name = ?, character_status = 'approved' WHERE id = ?")
              .run(race.characterPlayerId, race.characterName, race.competingUserId);
          });
        }
      } else {
        discordChannelMessages.push({ id: messageId, channelId, payload });
      }
      return json(res, { id: messageId, channel_id: channelId });
    }
    if (url.pathname === "/api/cache-test") {
      proxyCacheRequests += 1;
      if (failCacheTest) return json(res, { error: "upstream unavailable" }, 500);
      return setTimeout(() => json(res, { ok: true, request: proxyCacheRequests }), 75);
    }
    if (url.pathname === "/geoip/GeoLite2-City-CSV.zip") {
      geoipDownloadRequests += 1;
      const expectedAuth = `Basic ${Buffer.from("maxmind-account:maxmind-license").toString("base64")}`;
      if (req.headers.authorization !== expectedAuth) return json(res, { error: "unauthorized" }, 401);
      const zip = zipStore([
        ["GeoLite2-City-CSV_20260613/GeoLite2-City-Locations-en.csv", "geoname_id,locale_code,continent_code,continent_name,country_iso_code,country_name,subdivision_1_iso_code,subdivision_1_name,city_name\n123,en,EU,Europe,GB,United Kingdom,LND,London,London\n"],
        ["GeoLite2-City-CSV_20260613/GeoLite2-City-Blocks-IPv4.csv", "network,geoname_id,registered_country_geoname_id,represented_country_geoname_id,is_anonymous_proxy,is_satellite_provider,postal_code,latitude,longitude,accuracy_radius\n203.0.113.0/24,123,123,,0,0,,51.5,-0.1,50\n"],
      ]);
      res.writeHead(200, { "content-type": "application/zip" });
      return res.end(zip);
    }
    if (url.pathname === "/ipapi/198.51.100.9/json/") {
      ipapiRequests += 1;
      return json(res, { city: "Provider City", country_name: "Providerland" });
    }
    if (url.pathname === "/api/resources") {
      resourceCatalogRequests += 1;
      return json(res, { resources: [{ id: 21, name: "Oak Tree", tier: 2 }] });
    }
    if (url.pathname === "/api/creatures") {
      creatureCatalogRequests += 1;
      return json(res, { creatures: [{ enemyType: 42, name: "Sagi Bird", huntable: true }] });
    }
    if (url.pathname === "/api/claims") {
      const regionId = url.searchParams.get("regionId");
      if (regionId === "19") return json(res, { claims: [{ entityId: claimId, name: "Timbersteel Trade", regionId: "19", tier: 5, supplies: 500, treasury: 300, numTiles: 42, locationX: 100, locationZ: 210, updatedAt: "2026-05-22T12:00:00.000Z", empireEntityId: "empire-1" }, { entityId: "neutral-claim", name: "Neutral Claim", regionId: "19", treasury: 10 }], count: 2 });
      if (regionId === "3") return json(res, { claims: [{ entityId: seasonalClaimId, name: "Seasonal Market", regionId: "3", regionName: "Region 3", treasury: 100 }], count: 1 });
      return json(res, { claims: [], count: 0 });
    }
    if (url.pathname === `/api/claims/${claimId}`) {
      claimDetailRequests += 1;
      if (failClaimRefresh) return json(res, { error: "rate limited" }, 429);
      return json(res, { claim: { entityId: claimId, name: "Timbersteel Trade", ownerName: "Tester", ownerEntityId: "player-1", tier: 5, supplies: 500, treasury: 300, numTiles: 42, locationX: 100, locationZ: 210, regionId: "19", regionName: "Zephra", empireEntityId: "empire-1" } });
    }
    if (url.pathname === `/api/claims/${claimId}/members`) {
      memberListRequests += 1;
      return json(res, { members: [{ playerEntityId: "player-1", userName: "Tester", lastLoginTimestamp: "2026-05-21T12:00:00.000Z", signedIn: false }, { playerEntityId: "citizen-1", userName: "Citizen One", coOwnerPermission: true, lastLoginTimestamp: "2026-05-20T12:00:00.000Z", signedIn: false }] });
    }
    if (url.pathname === `/api/claims/${claimId}/citizens`) return json(res, { citizens: [] });
    if (url.pathname === `/api/claims/${claimId}/buildings`) return json(res, { buildings: [] });
    if (url.pathname === `/api/claims/${claimId}/inventories`) return json(res, {
      buildings: [{
        entityId: "storage-1",
        buildingName: "Basic Storage Chest",
        buildingNickname: "Ingots",
        inventory: [{
          name: "Copper Ingot",
          tag: "Ingot",
          tier: 2,
          rarityStr: "Common",
          iconAssetName: "copper_ingot",
          contents: { item_type: "item", item_id: "ingot-1", quantity: 12 },
        }, {
          tag: "Berry",
          tier: 3,
          rarityStr: "Common",
          iconAssetName: "berry",
          contents: { item_type: "item", item_id: "berry-1", quantity: 24 },
        }],
      }],
    });
    if (url.pathname === `/api/claims/${claimId}/construction`) return json(res, { projects: [] });
    if (url.pathname === "/api/players/player-1") {
      playerDetailRequests += 1;
      return json(res, { player: { playerEntityId: "player-1", username: "Tester", signedIn: true } });
    }
    if (url.pathname === "/api/items/2020003") {
      recipeDetailRequests += 1;
      return json(res, {
        item: { id: "2020003", name: "Simple Plank", itemType: 0, tier: 2, rarityStr: "Common", tag: "Plank" },
        craftingRecipes: [],
        extractionRecipes: [],
      });
    }
    if (url.pathname === "/api/skills") return json(res, { skills: [{ id: 1, name: "Carpentry" }] });
    if (url.pathname === "/api/regions/status") {
      regionStatusRequests += 1;
      return json(res, { regions: [{ regionId: 19, regionName: "Zephra", active: true, syncing: true, signedInPlayers: 42 }, { regionId: 3, regionName: "Region 3", active: true, syncing: false }] });
    }
    if (url.pathname === "/api/regions") {
      regionListRequests += 1;
      return json(res, [{ regionId: 23, regionName: "Region 22" }, { regionId: 19, regionName: "Zephra" }]);
    }
    if (url.pathname === "/api/empires") {
      if (failEmpireList) return json(res, { error: "empire unavailable" }, 500);
      return json(res, [
      { entityId: "empire-1", name: "Test Empire", leader: "Leader One", leaderEntityId: "leader-1", memberCount: 3, territoryChunks: 12, numClaims: 4, empireCurrencyTreasury: 5000, locationX: 120, locationZ: 240, updatedAt: "2026-05-20T12:00:00.000Z" },
      { entityId: "empire-foreign", name: "Foreign Empire", leader: "Other", leaderEntityId: "leader-2", memberCount: 8, territoryChunks: 99, numClaims: 9, empireCurrencyTreasury: 9000, updatedAt: "2026-05-20T12:00:00.000Z" },
    ]);
    }
    if (url.pathname === "/api/empires/empire-1") return json(res, {
      empire: { entityId: "empire-1", name: "Test Empire", leaderEntityId: "leader-1" },
      members: [
        { entityId: "leader-1", playerName: "Leader One", rankTitle: "The Earth King", lastLoginTimestamp: "2026-05-01T12:00:00.000Z", buildPermission: true },
        { entityId: "player-1", playerName: "Tester", rankTitle: "Emperor", lastLoginTimestamp: "2026-04-01T12:00:00.000Z" },
        { entityId: "citizen-1", playerName: "Citizen One", rankTitle: "Citizen", lastLoginTimestamp: "2026-05-20T12:00:00.000Z", inventoryPermission: true },
        { entityId: "citizen-2", playerName: "Citizen Two", rankTitle: "Citizen", lastLoginTimestamp: "2026-05-21T12:00:00.000Z" },
      ],
      count: 3,
    });
    if (url.pathname === "/api/empires/empire-foreign") return json(res, {
      empire: { entityId: "empire-foreign", name: "Foreign Empire", capitalClaimId: "foreign-capital", capitalClaimName: "Foreign Capital", capitalRegionId: 9, locationX: 900, locationZ: 901, territoryChunks: 99, numClaims: 1 },
      members: [
        { entityId: "leader-2", playerName: "Other", rank: 0, rankTitle: "Emperor", lastLoginTimestamp: "2026-07-18T12:00:00.000Z" },
      ],
      count: 1,
    });
    if (url.pathname === "/api/empires/empire-1/towers") {
      if (failEmpireTowers) return json(res, { error: "tower detail unavailable" }, 503);
      return json(res, [{
        entityId: "tower-1",
        locationX: 111,
        locationZ: 222,
        locationDimension: 0,
        energy: 75,
        upkeep: 10,
        active: true,
        nickname: "North Tower",
        siege: [
          { active: true, attacker: false, empireEntityId: "empire-1", empireName: "Test Empire", energy: 281, startTimestamp: "2026-07-18T23:55:20.000Z" },
          { active: true, attacker: true, empireEntityId: "empire-2", empireName: "Verdant", energy: 6710, startTimestamp: "2026-07-18T23:55:20.000Z" },
          { active: false, attacker: true, empireEntityId: "empire-old", empireName: "Old Empire", energy: 50, startTimestamp: "2026-06-01T00:00:00.000Z" },
        ],
      }]);
    }
    if (url.pathname === "/api/empires/empire-foreign/towers") return json(res, []);
    if (url.pathname === "/api/stats/trade-volume") return json(res, { buckets: [], items: [], regions: [] });
    if (url.pathname === `/api/claims/${claimId}/market/listings`) {
      if (url.searchParams.get("side") === "buy") {
        return json(res, { listings: buyListings, totalPages: 1, page: Number(url.searchParams.get("page") || 1) });
      }
      const page = Number(url.searchParams.get("page"));
      requestedPages.push(page);
      return json(res, { listings: [currentListings[page - 1]], totalPages: 2, page });
    }
    if (url.pathname === `/api/claims/${seasonalClaimId}/market/listings`) {
      if (url.searchParams.get("side") === "buy") return json(res, { listings: seasonalBuyListings, totalPages: 1, page: Number(url.searchParams.get("page") || 1) });
      return json(res, { listings: [], totalPages: 1, page: Number(url.searchParams.get("page") || 1) });
    }
    if (url.pathname === "/api/market/items/30/price-history") {
      priceHistoryRequests += 1;
      if (url.searchParams.get("regionId") !== "19") return json(res, { buckets: [] });
      return json(res, {
        buckets: [
          { bucket: "2026-05-18", quantity: 1, totalValue: 10 },
          { bucket: "2026-05-19", quantity: 1, totalValue: 10 },
          { bucket: "2026-05-20", quantity: 1, totalValue: 10 },
        ],
      });
    }
    if (url.pathname === "/api/market/items/31/price-history") {
      priceHistoryRequests += 1;
      if (url.searchParams.get("regionId") !== "19") return json(res, { buckets: [] });
      return setTimeout(() => {
        slowPriceHistoryResponded = true;
        json(res, {
          buckets: [
            { bucket: "2026-05-18", quantity: 1, totalValue: 80 },
            { bucket: "2026-05-19", quantity: 1, totalValue: 90 },
            { bucket: "2026-05-20", quantity: 1, totalValue: 95 },
          ],
        });
      }, 1000);
    }
    if (url.pathname === "/api/market/cargo/32/price-history") {
      priceHistoryRequests += 1;
      if (url.searchParams.get("regionId") !== "19") return json(res, { buckets: [] });
      return json(res, {
        priceStats: { avg7d: 40, totalTrades: 3 },
        buckets: [
          { bucket: "2026-05-18", quantity: 1, totalValue: 30 },
          { bucket: "2026-05-19", quantity: 1, totalValue: 30 },
          { bucket: "2026-05-20", quantity: 1, totalValue: 30 },
        ],
      });
    }
    if (url.pathname === "/api/players/player-1/passive-crafts") {
      passiveCraftRequests += 1;
      return json(res, {
        items: [{ id: "passive-item-1", name: "Fine Timber", tier: 4 }],
        craftResults: [
          { recipeName: "Collect {0}", buildingName: "Forestry Camp", status: "complete", timestamp: "2026-05-20T12:10:00.000Z", craftedItem: [{ item_id: "passive-item-1", quantity: 3 }] },
          { recipeName: "Collect {0}", buildingName: "Forestry Camp", status: "complete", timestamp: "2026-05-20T12:20:00.000Z", craftedItem: [{ item_id: "passive-item-1", quantity: 2 }] },
        ],
      });
    }
    if (url.pathname === `/api/crafts`) return json(res, {
      craftResults: [
        { entityId: `public-craft-${craftEntityRevision}`, claimEntityId: claimId, buildingName: craftBuildingName, ownerUsername: craftOwnerUsername, isPublic: true, craftedItem: [{ item_id: "craft-item-1" }], totalActionsRequired: 100, progress: craftProgressOverride ?? 20 + craftEntityRevision },
      ],
      items: [{ id: "craft-item-1", name: "Public Output", tier: 2, itemType: "0", rarityStr: "Common", iconAssetName: "public_output.png" }],
      cargos: [],
    });
    if (url.pathname === "/api/players/player-1/crafts") {
      playerCraftRequests += 1;
      return json(res, {
        craftResults: [
          { entityId: `public-craft-${craftEntityRevision}`, claimEntityId: claimId, buildingName: craftBuildingName, ownerUsername: "Tester", isPublic: true, craftedItem: [{ item_id: "craft-item-1" }], totalActionsRequired: 100, progress: craftProgressOverride ?? 20 + craftEntityRevision },
          { entityId: "private-craft", claimEntityId: claimId, buildingName: "Private Scholar Station", ownerUsername: "Tester", isPublic: false, craftedItem: [{ item_id: "craft-item-2" }], totalActionsRequired: 200, progress: 10 },
          { entityId: "foreign-private-craft", claimEntityId: "other-claim", buildingName: "Other Claim Station", ownerUsername: "Tester", isPublic: false, craftedItem: [{ item_id: "craft-item-3" }], totalActionsRequired: 300, progress: 10 },
        ],
        items: [{ id: "craft-item-2", name: "Private Output", tier: 3 }],
        cargos: [],
      });
    }
    return json(res, { error: "not found" }, 404);
  });
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise((resolve) => upstream.close(resolve)));

  const appPort = await availablePort();
  const dataDir = path.join(appDir, `.test-data-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      BITCRAFT_DEPLOYMENT_MODE: "canonical",
      BITCRAFT_PROCESS_ROLE: "web",
      LEGAL_CONFIGURATION_CONFIRMED: "true",
      BITCRAFT_TEST: "true",
      ENABLE_LEGACY_ADMIN_PASSWORD_AUTH: "true",
      ENABLE_SERVER_POLLING: "false",
      ADMIN_SETUP_KEY: "test-setup-key",
      APP_HOST: "127.0.0.1",
      APP_PORT: String(appPort),
      BITCRAFT_LOCAL_DATA_DIR: dataDir,
      BITCRAFT_RELAY_ORIGIN: `http://127.0.0.1:${upstreamPort}`,
      EMPIRE_SCOUT_CACHE_TTL_MS: "100",
      IPAPI_BASE_URL: `http://127.0.0.1:${upstreamPort}/ipapi`,
      DISCORD_API_ORIGIN: `http://127.0.0.1:${upstreamPort}/discord/api/v10`,
      DISCORD_DELIVERY_MODE: "live",
      ENABLE_DISCORD_STARTUP: "true",
      DISCORD_SANDBOX_CHANNEL_ID: "666666666666666666",
      DISCORD_OAUTH_CLIENT_ID: "1511277824525471826",
      DISCORD_OAUTH_CLIENT_SECRET: "test-discord-oauth-secret",
      DISCORD_BOT_TOKEN: "test-discord-bot-token",
      BITJITA_ICON_API_ORIGIN: "https://unapproved.example",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    await stop(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const origin = `http://127.0.0.1:${appPort}`;
  await waitForHealth(origin, child);
  const seedCommittedRelayInputs = async () => {
    const receivedAt = new Date().toISOString();
    const craftId = relayCraftId(craftEntityRevision);
    await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (relayStateDb) => {
      relayStateDb.prepare(`
        INSERT OR REPLACE INTO game_catalog_descriptions (
          description_kind, description_id, data_json, updated_at
        ) VALUES ('crafting_recipe', '77', ?, ?)
      `).run(JSON.stringify({
        kind: "crafting_recipe",
        id: "77",
        name: "Public Output",
        isPassive: false,
        levelRequirements: [{ skill_id: 1 }],
        experiencePerProgress: [{ skill_id: 1, quantity: 1 }],
      }), receivedAt);
      const insert = relayStateDb.prepare(`
        INSERT OR REPLACE INTO domain_payload_current (
          claim_id, domain, data_json, collected_at, last_attempt_at, last_success_at,
          last_error, updated_at, provider, source_key, region_id, database_name,
          schema_fingerprint, source_observed_at, received_at, freshness, confidence,
          generation, warnings_json
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'relay', 'relay-cache', '19',
          'relay-region-19', 'regional-v1', NULL, ?, 'fresh', 'authoritative', ?, '[]')
      `);
      const generation = 100 + craftEntityRevision;
      const payloads = [
        ["claim", { entityId: claimId, supplies: "500" }],
        ["members", [{ claimEntityId: claimId, playerEntityId: "1369094286777412591", userName: "Tester" }]],
        ["market", { listings: currentListings }],
        ["crafts", {
          craftResults: [{
            entityId: craftId,
            claimEntityId: claimId,
            buildingName: craftBuildingName,
            ownerUsername: craftOwnerUsername,
            isPublic: true,
            recipeId: "77",
            craftedItem: [{ item_id: "2020003", item_type: 0 }],
            totalActionsRequired: 100,
            progress: craftProgressOverride ?? 20 + craftEntityRevision,
          }],
          items: [{ id: "2020003", name: "Simple Plank", tier: 2, itemType: "0", rarityStr: "Common", iconAssetName: "public_output.png" }],
          cargos: [],
        }],
      ];
      for (const [domain, data] of payloads) {
        insert.run(claimId, domain, JSON.stringify(data), receivedAt, receivedAt, receivedAt, receivedAt, receivedAt, generation);
      }
      relayStateDb.prepare(`
        INSERT OR IGNORE INTO market_trades (
          trade_id, claim_id, region_id, order_entity_id, seller_entity_id,
          seller_username, purchaser_entity_id, purchaser_username, item_id,
          item_type, item_name, quantity, unit_price, total_price, tier, rarity,
          occurred_at, imported_at, raw_json
        ) VALUES (
          'relay_closed_listing:19:historic-1', ?, '19', 'historic-order', 'player-1',
          'Tester', NULL, 'Buyer', '30', 'item', 'Leather', '5', '10', '50',
          NULL, NULL, '2026-05-20T12:00:00.000Z',
          '2026-05-20T12:00:01.000Z', '{}'
        )
      `).run(claimId);
      relayStateDb.prepare(`
        INSERT OR REPLACE INTO production_contributions (
          contribution_key, claim_id, craft_entity_id, contributor_entity_id,
          contributor_name, attribution_confidence, profession, craft_label, structure_name, item_tier,
          contributed_progress, contributed_xp, contribution_count,
          first_contributed_at, last_contributed_at, first_seen, updated_at,
          raw_json
        ) VALUES (?, ?, ?, ?, 'Tester', 'matched_action', 'Carpentry', 'Simple Plank', ?, '2',
          ?, ?, ?, '2026-05-20T12:00:00.000Z', ?, ?, ?, '{}')
      `).run(
        `${claimId}:${craftId}:1369094286777412591`,
        claimId,
        craftId,
        "1369094286777412591",
        craftBuildingName,
        String(25 + craftEntityRevision),
        String(25 + craftEntityRevision),
        String(2 + craftEntityRevision),
        receivedAt,
        receivedAt,
        receivedAt,
      );
    });
  };
  const health = await fetch(`${origin}/api/local/health`);
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(health.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(health.headers.get("content-security-policy") ?? "", /default-src 'self'/);

  const retiredProxy = await fetch(`${origin}/api/bitjita/cache-test?same=1`);
  assert.equal(retiredProxy.status, 404);
  assert.equal(proxyCacheRequests, 0);
  const unavailableGameIcon = await fetch(`${origin}/api/local/game-icon/item/42`);
  assert.equal(unavailableGameIcon.status, 404);
  assert.deepEqual(await unavailableGameIcon.json(), { error: "Game icon is unavailable." });
  const missingLocalGameIcon = await fetch(`${origin}/game-icons/GeneratedIcons/Items/Missing.webp`);
  assert.equal(missingLocalGameIcon.status, 404);
  assert.match(missingLocalGameIcon.headers.get("content-type") ?? "", /^application\/json/);
  const rateLimitedIcons = await Promise.all(Array.from({ length: 601 }, (_, index) => fetch(
    `${origin}/api/local/game-icon/item/${1000 + index}`,
  )));
  assert.equal(rateLimitedIcons.every((response) => response.status === 404 || response.status === 429), true);
  assert.equal(rateLimitedIcons.filter((response) => response.status === 429).length > 0, true);
  await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (catalogDb) => {
    const receivedAt = new Date().toISOString();
    const insert = catalogDb.prepare(`
      INSERT INTO game_catalog_descriptions (
        description_kind, description_id, data_json, updated_at
      ) VALUES (?, ?, ?, ?)
    `);
    insert.run("resource", "21", JSON.stringify({
      kind: "resource",
      id: "21",
      name: "Oak Tree",
      description: "",
      iconAssetName: "",
      maxHealth: 100,
      tier: 2,
      tag: "Tree",
      rarity: "Common",
      onDestroyYield: [],
    }), receivedAt);
    insert.run("enemy", "42", JSON.stringify({
      kind: "enemy",
      id: "42",
      enemyType: "42",
      name: "Sagi Bird",
      description: "",
      maxHealth: 50,
      minDamage: 1,
      maxDamage: 2,
      attackLevel: 1,
      defenseLevel: 1,
      iconAssetName: "",
      tier: 1,
      tag: "Animal",
      rarity: "Common",
      huntable: true,
    }), receivedAt);
    catalogDb.prepare(`
      INSERT INTO game_catalog_source_state (
        source_key, provider, database_name, schema_fingerprint,
        generation, received_at, row_count
      ) VALUES ('global', 'relay', 'relay-global', 'global-v1', 1, ?, 2)
    `).run(receivedAt);
  });
  const mapCatalogOne = await fetch(`${origin}/api/local/map/catalog`).then((response) => response.json());
  const mapCatalogTwo = await fetch(`${origin}/api/local/map/catalog`).then((response) => response.json());
  assert.deepEqual(mapCatalogOne.resources.map((row) => [row.id, row.name, row.tier]), [["21", "Oak Tree", 2]]);
  assert.deepEqual(mapCatalogTwo.creatures.map((row) => [row.enemyType, row.name, row.huntable]), [["42", "Sagi Bird", true]]);
  assert.equal(mapCatalogOne.provider, "relay");
  assert.equal(mapCatalogOne.source.generation, 1);
  assert.equal(resourceCatalogRequests, 0);
  assert.equal(creatureCatalogRequests, 0);
  const activeRegions = await fetch(`${origin}/api/local/regions/active?include=24`).then((response) => response.json());
  assert.deepEqual(activeRegions.regions.map((region) => region.regionId), ["19"]);
  assert.equal(activeRegions.regions[0].source, "default");
  assert.equal(activeRegions.regions[0].freshness, "unavailable");
  assert.equal(regionStatusRequests, 0);
  assert.equal(regionListRequests, 0);
  const mapRegionsResponse = await fetch(`${origin}/api/local/map/regions`);
  assert.equal(mapRegionsResponse.status, 200);
  const mapRegions = await mapRegionsResponse.json();
  assert.deepEqual(mapRegions.regionIds, mapResourceRegionIds);
  const mapRegion19 = mapRegions.regions.find((region) => region.regionId === "19");
  assert.equal(mapRegion19.regionName, "Region 19");
  assert.equal(mapRegion19.freshness, "live");
  const empireObservedAt = new Date().toISOString();
  const empireCurrentData = {
    primaryRegionId: "19",
    activeRegionIds: ["19", "99"],
    empires: [{
      regionId: "19",
      entityId: "10",
      capitalBuildingEntityId: "100",
      name: "Test Empire",
      shardTreasury: "0",
      nobilityThreshold: 1000,
      numClaims: 1,
      empireCurrencyTreasury: "5000",
      territoryChunks: 2,
    }, {
      regionId: "19",
      entityId: "11",
      capitalBuildingEntityId: "110",
      name: "Verdant",
      shardTreasury: "0",
      nobilityThreshold: 1000,
      numClaims: 0,
      empireCurrencyTreasury: "0",
      territoryChunks: 0,
    }, {
      regionId: "19",
      entityId: "12",
      capitalBuildingEntityId: "120",
      name: "Foreign Empire",
      shardTreasury: "0",
      nobilityThreshold: 1000,
      numClaims: 1,
      empireCurrencyTreasury: "9000",
      territoryChunks: 99,
    }],
    members: [{
      regionId: "19",
      entityId: "20",
      empireEntityId: "10",
      username: "Leader One",
      rank: 0,
      rankTitle: "The Earth King",
      permissions: [true, false, false, false, false, false, false, false, false, false],
      lastLoginTimestamp: "2026-05-01T12:00:00.000Z",
      signedIn: false,
    }, {
      regionId: "19",
      entityId: "21",
      empireEntityId: "10",
      username: "Tester",
      rank: 1,
      rankTitle: "Emperor",
      permissions: [],
      lastLoginTimestamp: "2026-05-21T12:00:00.000Z",
      signedIn: false,
    }, {
      regionId: "19",
      entityId: "22",
      empireEntityId: "10",
      username: "Citizen One",
      rank: 2,
      rankTitle: "Citizen",
      permissions: [],
      lastLoginTimestamp: "2026-05-20T12:00:00.000Z",
      signedIn: false,
    }, {
      regionId: "19",
      entityId: "23",
      empireEntityId: "10",
      username: "Citizen Two",
      rank: 3,
      rankTitle: "Citizen",
      permissions: [],
      lastLoginTimestamp: "2026-05-21T12:00:00.000Z",
      signedIn: false,
    }, {
      regionId: "19",
      entityId: "24",
      empireEntityId: "12",
      username: "Other",
      rank: 0,
      rankTitle: "Emperor",
      permissions: [],
      lastLoginTimestamp: "2026-07-18T12:00:00.000Z",
      signedIn: false,
    }],
    settlements: [{
      regionId: "19",
      buildingEntityId: "100",
      claimEntityId: claimId,
      empireEntityId: "10",
      claimName: "Timbersteel Trade",
      claimOwnerEntityId: "21",
      claimOwnerName: "Tester",
      locationX: 100,
      locationZ: 210,
      locationDimension: "1",
    }],
    claimMembers: [{
      regionId: "19",
      entityId: "501",
      claimEntityId: claimId,
      playerEntityId: "21",
      username: "Tester",
      inventoryPermission: false,
      buildPermission: true,
      officerPermission: true,
      coOwnerPermission: false,
    }, {
      regionId: "19",
      entityId: "502",
      claimEntityId: claimId,
      playerEntityId: "22",
      username: "Citizen One",
      inventoryPermission: true,
      buildPermission: false,
      officerPermission: false,
      coOwnerPermission: true,
    }],
    nodes: [{
      regionId: "19",
      entityId: "60",
      empireEntityId: "10",
      nickname: "North Tower",
      locationX: 111,
      locationZ: 222,
      locationDimension: "1",
      energy: "75",
      upkeep: "10",
      active: true,
      coveredChunks: 2,
      sieges: [{
        entityId: "601",
        buildingEntityId: "60",
        empireEntityId: "11",
        defenderEmpireEntityId: "10",
        role: "attacker",
        energy: "6710",
        active: true,
        startTimestamp: "2026-07-18T23:55:20.000Z",
      }],
    }],
    siegeOutcomes: [{
      eventKey: "outcome-1",
      occurredAt: "2026-07-18T23:59:20.000Z",
      watchtowerLabel: "North Tower",
      encodedLocation: "19:111:222",
      attackerEmpireEntityId: "11",
      defenderEmpireEntityId: "10",
      outcome: "attacker_won",
    }],
    regions: [{
      regionId: "19",
      empireCount: 1,
      memberCount: 4,
      settlementCount: 1,
      claimMemberCount: 2,
      nodeCount: 1,
      database: "relay-region-19",
      schemaFingerprint: "regional-v1",
      receivedAt: empireObservedAt,
      lastError: null,
      warnings: [],
    }],
  };
  await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (empireDb) => {
    empireDb.prepare(`
      INSERT OR REPLACE INTO domain_payload_current (
        claim_id, domain, data_json, collected_at, last_attempt_at, last_success_at,
        last_error, updated_at, provider, source_key, region_id, database_name,
        schema_fingerprint, source_observed_at, received_at, freshness, confidence,
        generation, warnings_json
      ) VALUES (?, 'empires', ?, ?, ?, ?, NULL, ?, 'relay', 'region:19', '19',
        'relay-region-19', 'regional-v1', NULL, ?, 'fresh', 'authoritative', 1, '[]')
    `).run(
      claimId,
      JSON.stringify(empireCurrentData),
      empireObservedAt,
      empireObservedAt,
      empireObservedAt,
      empireObservedAt,
      empireObservedAt,
    );
  });
  const regionalEmpires = await fetch(`${origin}/api/local/empires?regionId=19`).then((response) => response.json());
  assert.equal(regionalEmpires.summary.empires, 1);
  assert.equal(regionalEmpires.empires[0].name, "Test Empire");
  assert.equal(regionalEmpires.empires[0].regionalClaims, 1);
  assert.equal(regionalEmpires.empires[0].hexiteReserves.status, "partial");
  assert.equal(regionalEmpires.empires[0].hexiteReserves.estimatedEnergyEquivalent, "5000");
  assert.equal(regionalEmpires.empires[0].hexiteReserves.energy.total, "5000");
  assert.equal(regionalEmpires.empires[0].hexiteReserves.energy.playerInventories, null);
  assert.equal(regionalEmpires.empires[0].hexiteReserves.capsules.readyTotal, null);
  assert.equal(regionalEmpires.empires[0].hexiteReserves.capsuleWatchtowerEnergyValue, 1_000);
  assert.equal(regionalEmpires.empires[0].hexiteReserves.coverage.players.missing, 4);
  assert.equal(regionalEmpires.empires[0].hexiteReserves.coverage.claims.missing, 1);
  assert.equal(regionalEmpires.empires[0].hexiteReserves.coverage.foundry, "unavailable");
  assert.equal(regionalEmpires.empires[0].hexiteReserves.refreshing, false);
  assert.match(regionalEmpires.empires[0].hexiteReserves.errors.join("\n"), /inventory joins are not available/i);
  assert.equal(regionalEmpires.stale, false);
  assert.equal(regionalEmpires.partial, false);
  assert.equal(regionalEmpires.freshness, "live");
  assert.equal(regionalEmpires.serverFreshness.cacheState, "relay-live");
  failEmpireList = true;
  const unconfiguredRegionEmpires = await fetch(`${origin}/api/local/empires?regionId=99`);
  assert.equal(unconfiguredRegionEmpires.status, 403);
  failEmpireList = false;
  const missingEmpireDetails = await fetch(`${origin}/api/local/empires/details?regionId=19`);
  assert.equal(missingEmpireDetails.status, 400);
  failEmpireTowers = true;
  const relayBackedEmpireDetails = await fetch(`${origin}/api/local/empires/details?empireId=10&regionId=19&inactiveDays=15`).then((response) => response.json());
  assert.equal(relayBackedEmpireDetails.partial, false);
  assert.equal(relayBackedEmpireDetails.towers.length, 1);
  failEmpireTowers = false;
  const empireDetailsResponse = await fetch(`${origin}/api/local/empires/details?empireId=10&regionId=19&inactiveDays=14`);
  assert.equal(empireDetailsResponse.status, 200);
  const empireDetails = await empireDetailsResponse.json();
  assert.equal(empireDetails.empire.name, "Test Empire");
  assert.equal(empireDetails.members.length, 4);
  assert.equal(empireDetails.claims[0].name, "Timbersteel Trade");
  assert.equal(empireDetails.towers[0].underSiege, true);
  assert.equal(empireDetails.activity.onlineNow, 0);
  assert.equal(empireDetails.activity.activeToday, 0);
  assert.equal(empireDetails.activity.activeThisWeek, 0);
  assert.equal(empireDetails.partial, false);
  const crossRegionEmpireDetailsResponse = await fetch(`${origin}/api/local/empires/details?empireId=12&regionId=19`);
  assert.equal(crossRegionEmpireDetailsResponse.status, 404);
  const unknownEmpireDetails = await fetch(`${origin}/api/local/empires/details?empireId=missing&regionId=19`);
  assert.equal(unknownEmpireDetails.status, 404);
  const regionalWatchtowers = await fetch(`${origin}/api/local/empires/watchtowers?regionId=19&inactiveDays=14`).then((response) => response.json());
  assert.equal(regionalWatchtowers.summary.towerCount, 1);
  assert.equal(regionalWatchtowers.towers[0].nickname, "North Tower");
  assert.equal(regionalWatchtowers.towers[0].inactiveRisk, true);
  assert.equal(regionalWatchtowers.towers[0].locationX, 111);
  assert.equal(regionalWatchtowers.towers[0].underSiege, true);
  assert.equal(regionalWatchtowers.towers[0].siegeCount, 1);
  assert.deepEqual(
    regionalWatchtowers.towers[0].activeSiegeParticipants.map((entry) => entry.empireName),
    ["Verdant", "Test Empire"],
  );
  assert.deepEqual(
    regionalWatchtowers.towers[0].activeSiegeParticipants.map((entry) => entry.attacker),
    [true, false],
  );
  assert.equal(regionalWatchtowers.recentSiegeOutcomes[0].outcome, "attacker_won");
  assert.equal(regionalWatchtowers.recentSiegeOutcomes[0].attackerEmpireName, "Verdant");
  assert.equal(regionalWatchtowers.recentSiegeOutcomes[0].defenderEmpireName, "Test Empire");
  assert.equal(regionalWatchtowers.cancellationSemantics, "unavailable");
  assert.equal(regionalWatchtowers.unmatchedTerminalStatus, "removed_or_unknown");
  assert.equal(regionalWatchtowers.summary.underSiege, 1);
  assert.equal(regionalWatchtowers.towers[0].accessMembers, undefined);
  assert.equal(regionalWatchtowers.empires[0].accessMembers.length, 2);
  assert.equal(regionalWatchtowers.empires[0].members.length, 4);
  assert.equal(regionalWatchtowers.empires[0].members[0].username, "Citizen Two");
  assert.equal(regionalWatchtowers.empires[0].members[0].lastLoginTimestamp, "2026-05-21T12:00:00.000Z");
  assert.equal(regionalWatchtowers.empires[0].members.some((member) => member.username === "Citizen Two" && !member.hasStorage && !member.canAddHexite), true);
  assert.equal(regionalWatchtowers.empires[0].accessMembers.some((member) => member.hasStorage), true);
  assert.equal(regionalWatchtowers.empires[0].accessMembers.some((member) => member.canAddHexite), true);
  assert.equal(regionalWatchtowers.empires[0].claims.length, 1);
  assert.equal(regionalWatchtowers.empires[0].claims[0].claimId, claimId);
  assert.equal(regionalWatchtowers.empires[0].claims[0].name, "Timbersteel Trade");
  assert.equal(regionalWatchtowers.empires[0].claims[0].ownerName, "Tester");
  assert.equal(regionalWatchtowers.empires[0].claims.some((claim) => claim.name === "Neutral Claim"), false);
  assert.equal(regionalWatchtowers.unclaimedAvailable, false);
  const missingClaimMembers = await fetch(`${origin}/api/local/empires/claim-members`).then((response) => ({ status: response.status }));
  assert.equal(missingClaimMembers.status, 400);
  const claimMembers = await fetch(`${origin}/api/local/empires/claim-members?claimId=${claimId}`).then((response) => response.json());
  assert.equal(claimMembers.claim.name, "Timbersteel Trade");
  assert.equal(claimMembers.members[0].username, "Tester");
  assert.equal(claimMembers.members[0].rankTitle, null);
  assert.equal(claimMembers.members[0].empireRankTitle, "Emperor");
  assert.equal(claimMembers.members[0].claimRole, "Owner");
  assert.equal(claimMembers.members[0].isClaimOwner, true);
  assert.equal(claimMembers.members.some((member) => member.username === "Citizen One" && member.claimRole === "Co-owner"), true);
  assert.equal(claimMembers.members[0].lastLoginTimestamp, "2026-05-21T12:00:00.000Z");
  const globalSiegeWarning = "Global Siege: Unmatched siege outcome notification.";
  await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (empireDb) => {
    empireDb.prepare(`
      UPDATE domain_payload_current
      SET warnings_json = ?, confidence = 'partial'
      WHERE claim_id = ? AND domain = 'empires'
    `).run(JSON.stringify([globalSiegeWarning, globalSiegeWarning]), claimId);
  });
  for (const route of [
    "/api/local/empires?regionId=19",
    "/api/local/empires/details?empireId=10&regionId=19",
    "/api/local/empires/watchtowers?regionId=19&inactiveDays=14",
    `/api/local/empires/claim-members?claimId=${claimId}`,
  ]) {
    const warnedResponse = await fetch(`${origin}${route}`).then((response) => response.json());
    assert.equal(warnedResponse.partial, true, `${route} must surface top-level Empire warnings`);
    assert.equal(
      warnedResponse.errors.filter((error) => error === globalSiegeWarning).length,
      1,
      `${route} must deduplicate top-level Empire warnings`,
    );
  }
  await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (catalogDb) => {
    catalogDb.prepare(`
      INSERT INTO game_catalog_entities (
        catalog_key, kind, target_id, item_type, name, tag, tier, rarity,
        icon_asset_name, item_list_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      "items:2020003",
      "items",
      "2020003",
      0,
      "Simple Plank",
      "Plank",
      2,
      "Common",
      null,
      "2026-07-30T12:00:00.000Z",
    );
  });
  const recipeDetailOne = await fetch(`${origin}/api/local/recipe-detail?kind=items&id=2020003&name=Simple%20Plank`).then((response) => response.json());
  const recipeDetailTwo = await fetch(`${origin}/api/local/recipe-detail?kind=items&id=2020003&name=Simple%20Plank`).then((response) => response.json());
  const catalogSearch = await fetch(`${origin}/api/local/catalog/search?q=simple%20plank&limit=10`).then((response) => response.json());
  assert.equal(recipeDetailOne.detail.item.name, "Simple Plank");
  assert.equal(recipeDetailOne.cached, true);
  assert.equal(recipeDetailOne.provider, "relay");
  assert.equal(recipeDetailTwo.detail.item.name, "Simple Plank");
  assert.equal(recipeDetailTwo.cached, true);
  assert.equal(catalogSearch.provider, "relay");
  assert.deepEqual(catalogSearch.items.map((item) => [item.id, item.name, item.itemType]), [["2020003", "Simple Plank", 0]]);
  assert.deepEqual(catalogSearch.cargos, []);
  assert.equal(recipeDetailRequests, 0);
  for (const [route, init] of [
    ["/api/local/player-details", { method: "POST", headers: { "content-type": "application/json", origin }, body: "{}" }],
    ["/api/local/passive-crafts", { method: "POST", headers: { "content-type": "application/json", origin }, body: "{}" }],
    ["/api/local/production/crafts", { method: "POST", headers: { "content-type": "application/json", origin }, body: "{}" }],
    [`/api/local/dashboard-data?claimId=${claimId}`, undefined],
  ]) {
    const response = await fetch(`${origin}${route}`, init);
    assert.equal(response.status, 404, `${route} must remain retired`);
  }
  assert.equal(playerDetailRequests, 0);
  assert.equal(passiveCraftRequests, 0);
  assert.equal(playerCraftRequests, 0);

  const auth = await createTestAdminSession(path.join(dataDir, "bitcraft-local.sqlite"), { username: "admin", role: "owner" });
  const cookie = auth.cookie;
  assert.ok(auth.csrfToken);
  assert.equal(auth.user.role, "owner");
  const initialCollect = await fetch(`${origin}/api/local/admin/collect-now`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: "{}",
  });
  assert.equal(initialCollect.status, 200);
  const trackedMembership = await writeDatabaseWithRetry(
    path.join(dataDir, "bitcraft-local.sqlite"),
    (database) => {
      createEmpireMembershipRepository(database).syncRoster({
        empireId: "10",
        empireName: "Test Empire",
        observedAt: "2026-07-30T12:00:00.000Z",
        members: [
          { playerEntityId: "20", playerName: "Leader One" },
          { playerEntityId: "21", playerName: "Member Two" },
          { playerEntityId: "22", playerName: "Member Three" },
          { playerEntityId: "23", playerName: "Member Four" },
        ],
      });
      const tracking = database
        .prepare(
          "SELECT empire_id, empire_name, initial_roster_complete FROM empire_membership_tracking WHERE tracking_ended_at IS NULL",
        )
        .get();
      const periods = database
        .prepare(
          "SELECT COUNT(*) AS count FROM empire_membership_periods WHERE period_ended_at IS NULL",
        )
        .get();
      return tracking && Number(periods?.count) === 4
        ? {
            tracking: {
              empire_id: tracking.empire_id,
              empire_name: tracking.empire_name,
              initial_roster_complete: Number(tracking.initial_roster_complete),
            },
            count: Number(periods.count),
          }
        : null;
    },
  );
  assert.deepEqual(trackedMembership, {
    tracking: {
      empire_id: "10",
      empire_name: "Test Empire",
      initial_roster_complete: 1,
    },
    count: 4,
  });
  const anonymousMembership = await fetch(`${origin}/api/local/admin/empire-membership`, {
    headers: { origin },
  });
  assert.equal(anonymousMembership.status, 401);
  const ownerMembership = await fetch(`${origin}/api/local/admin/empire-membership`, {
    headers: {
      cookie,
      origin,
      "content-type": "application/json",
      "x-csrf-token": auth.csrfToken,
    },
  });
  assert.equal(ownerMembership.status, 200);
  const ownerMembershipBody = await ownerMembership.json();
  assert.equal(ownerMembershipBody.tracking.empireName, "Test Empire");
  assert.equal(ownerMembershipBody.summary.currentMembers, 4);
  assert.equal(
    ownerMembershipBody.currentMembers.every((member) => member.membershipStatus === "initial"),
    true,
  );
  const appDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { readOnly: true });
  assert.equal(appDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'current_claim_state'").get().count, 0);
  assert.equal(appDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'market_listings'").get().count, 0);
  assert.equal(appDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'market_buy_orders_current'").get().count, 0);
  assert.equal(appDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'market_regional_sale_averages_current'").get().count, 0);
  appDb.close();
  const legacyBuyOrderNow = new Date().toISOString();
  const regionalMarketData = {
    activeRegionIds: ["9", "19"],
    orders: [
      {
        entityId: "3001",
        claimEntityId: "4001",
        claimName: "High Market",
        regionId: "19",
        ownerEntityId: "5001",
        ownerUsername: "Buyer",
        itemId: "30",
        itemType: "item",
        price: "20",
        priceThreshold: "20",
        quantity: "10",
        storedCoins: "200",
        timestamp: legacyBuyOrderNow,
        side: "buy",
      },
      {
        entityId: "3002",
        claimEntityId: "4002",
        claimName: "Old Market",
        regionId: "9",
        ownerEntityId: "5002",
        ownerUsername: "Old Buyer",
        itemId: "999",
        itemType: "item",
        price: "1",
        priceThreshold: "1",
        quantity: "1",
        storedCoins: "1",
        timestamp: legacyBuyOrderNow,
        side: "buy",
      },
      {
        entityId: "3003",
        claimEntityId: "4001",
        claimName: "Test Market",
        regionId: "19",
        ownerEntityId: "5003",
        ownerUsername: "Seller",
        itemId: "30",
        itemType: "item",
        price: "15",
        priceThreshold: "15",
        quantity: "4",
        storedCoins: "0",
        timestamp: legacyBuyOrderNow,
        side: "sell",
      },
    ],
    stalls: [{
      entityId: "9007199254740993",
      regionId: "19",
      claimEntityId: "4001",
      claimName: "High Market",
      ownerEntityId: "5004",
      ownerName: "Stall Keeper",
      nickname: "Leather Exchange",
      locationX: -123,
      locationZ: 456,
      orders: [{
        entityId: "9007199254740995",
        remainingStock: "2147483647",
        offers: [{ itemId: "30", itemType: "item", quantity: "2" }],
        requires: [{ itemId: "30", itemType: "item", quantity: "9007199254740993" }],
      }],
    }],
    regions: [
      {
        regionId: "9",
        count: 1,
        database: "relay-region-9",
        schemaFingerprint: "regional-v1",
        receivedAt: legacyBuyOrderNow,
        warnings: [],
      },
      {
        regionId: "19",
        count: 2,
        database: "relay-region-19",
        schemaFingerprint: "regional-v1",
        receivedAt: legacyBuyOrderNow,
        warnings: [],
      },
    ],
  };
  const staleRegionalDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  staleRegionalDb.prepare(`
    INSERT OR REPLACE INTO domain_payload_current (
      claim_id, domain, data_json, collected_at, last_attempt_at, last_success_at,
      last_error, updated_at, provider, source_key, region_id, database_name,
      schema_fingerprint, source_observed_at, received_at, freshness, confidence,
      generation, warnings_json
    ) VALUES (?, 'regional-market', ?, ?, ?, ?, NULL, ?, 'relay', 'region:19', '19',
      'relay-region-19', 'regional-v1', NULL, ?, 'fresh', 'authoritative', 99, '[]')
  `).run(
    claimId,
    JSON.stringify(regionalMarketData),
    legacyBuyOrderNow,
    legacyBuyOrderNow,
    legacyBuyOrderNow,
    legacyBuyOrderNow,
    legacyBuyOrderNow,
  );
  staleRegionalDb.prepare(
    "UPDATE app_settings SET value = '19', updated_at = ? WHERE key = 'default_region'",
  ).run(legacyBuyOrderNow);
  staleRegionalDb.prepare(
    "UPDATE app_settings SET value = '', updated_at = ? WHERE key = 'active_region_overrides'",
  ).run(legacyBuyOrderNow);
  staleRegionalDb.prepare(`
    INSERT OR REPLACE INTO game_catalog_entities (
      catalog_key, kind, target_id, item_type, name, tag, tier, rarity,
      icon_asset_name, item_list_id, updated_at
    ) VALUES ('items:30', 'items', '30', 0, 'Leather', 'Leather', 1, 'Common',
      NULL, NULL, ?)
  `).run(legacyBuyOrderNow);
  staleRegionalDb.prepare(`
    INSERT OR REPLACE INTO game_catalog_source_state (
      source_key, provider, database_name, schema_fingerprint, generation, received_at, row_count
    ) VALUES ('global', 'relay', 'relay-global', 'global-v1', 1, ?, 1)
  `).run(legacyBuyOrderNow);
  staleRegionalDb.prepare(`
    INSERT OR IGNORE INTO market_trades (
      trade_id, claim_id, region_id, order_entity_id, seller_entity_id,
      seller_username, purchaser_entity_id, purchaser_username, item_id,
      item_type, item_name, quantity, unit_price, total_price, tier, rarity,
      occurred_at, imported_at, raw_json
    ) VALUES (
      'relay_closed_listing:19:historic-1', ?, '19', 'historic-order', 'player-1',
      'Tester', NULL, 'Buyer', '30', 'item', 'Leather', '5', '10', '50',
      NULL, NULL, '2026-05-20T12:00:00.000Z',
      '2026-05-20T12:00:01.000Z', '{"listing":{"claimEntityId":1369094286777412590}}'
    )
  `).run(claimId);
  staleRegionalDb.prepare(`
    WITH RECURSIVE sequence(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < 5001
    )
    INSERT INTO market_trades (
      trade_id, claim_id, region_id, order_entity_id, seller_entity_id,
      seller_username, purchaser_entity_id, purchaser_username, item_id,
      item_type, item_name, quantity, unit_price, total_price, tier, rarity,
      occurred_at, imported_at, raw_json
    )
    SELECT
      'relay_closed_listing:7:noise-' || value, ?, '7', 'noise-order-' || value,
      'noise-player', 'Noise', NULL, NULL, '30', 'item', 'Noise', '1', '1',
      '1', NULL, NULL, '2026-06-01T12:00:00.000Z',
      '2026-06-01T12:00:01.000Z', '{}'
    FROM sequence
  `).run(claimId);
  staleRegionalDb.close();
  const buyOrdersBeforeSales = await fetch(`${origin}/api/local/market/buy-orders?claimId=${claimId}&regionId=19&search=Leather&pageSize=25&sort=unitPrice&direction=desc`).then((response) => response.json());
  assert.equal(buyOrdersBeforeSales.total, 1);
  assert.equal(buyOrdersBeforeSales.rows[0].itemName, "Leather");
  assert.equal(buyOrdersBeforeSales.rows[0].unitPrice, "20");
  assert.equal(buyOrdersBeforeSales.rows[0].totalValue, "200");
  assert.equal(buyOrdersBeforeSales.freshness, "fresh");
  assert.equal(buyOrdersBeforeSales.opportunities.length, 0);
  assert.equal(priceHistoryRequests, 0);
  const marketCatalog = await fetch(`${origin}/api/local/market/catalog?claimId=${claimId}&regionId=19&q=Leather&availableOnly=true&hasSell=true&hasBuy=true&limit=12`).then((response) => response.json());
  assert.deepEqual(marketCatalog.items.map((item) => ({
    itemId: item.itemId,
    itemType: item.itemType,
    sellOrders: item.sellOrders,
    buyOrders: item.buyOrders,
  })), [{
    itemId: "30",
    itemType: "item",
    sellOrders: 1,
    buyOrders: 1,
  }]);
  assert.equal(marketCatalog.freshness, "stale");
  assert.match(marketCatalog.warnings.join(" "), /catalog subscription is disconnected/i);
  const marketOrderBookResponse = await fetch(`${origin}/api/local/market/order-book?claimId=${claimId}&regionId=19&itemType=item&itemId=30`);
  const { body: marketOrderBook, responseBytes: marketOrderBookResponseBytes } = await jsonWithObservedResponseSize(marketOrderBookResponse);
  assert.ok(Number.isSafeInteger(marketOrderBookResponseBytes));
  assert.deepEqual(marketOrderBook.sellOrders.map((order) => order.entityId), ["3003"]);
  assert.deepEqual(marketOrderBook.buyOrders.map((order) => order.entityId), ["3001"]);
  assert.equal(marketOrderBook.sellOrders[0].price, "15");
  assert.equal(marketOrderBook.item.name, "Leather");
  const favoriteQuoteResponse = await fetch(`${origin}/api/local/market/favorite-quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      regionId: "19",
      items: [
        { itemType: "item", itemId: "30" },
        { itemType: "cargo", itemId: "30" },
        { itemType: "item", itemId: "9007199254740993" },
      ],
    }),
  });
  assert.equal(favoriteQuoteResponse.status, 200, "read-only favorite quotes do not require CSRF");
  const favoriteQuotePayload = await favoriteQuoteResponse.json();
  assert.equal(favoriteQuotePayload.generation, 99);
  assert.equal(favoriteQuotePayload.freshness, "stale");
  assert.deepEqual(favoriteQuotePayload.quotes, {
    "item:30": { bestSell: "15", bestBuy: "20", sellCount: 1, buyCount: 1 },
    "cargo:30": { bestSell: null, bestBuy: null, sellCount: 0, buyCount: 0 },
    "item:9007199254740993": { bestSell: null, bestBuy: null, sellCount: 0, buyCount: 0 },
  });
  assert.deepEqual(favoriteQuotePayload.items["item:30"], {
    id: "30",
    itemId: "30",
    itemType: "item",
    name: "Leather",
    category: "Leather",
    tag: "Leather",
    tier: 1,
    rarity: "Common",
    rarityStr: "Common",
    iconAssetName: null,
  });
  const otherActiveRegionFavoriteQuote = await fetch(`${origin}/api/local/market/favorite-quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ regionId: "9", items: [{ itemType: "item", itemId: "30" }] }),
  });
  assert.equal(otherActiveRegionFavoriteQuote.status, 200);
  const favoriteQuoteRefreshes = await Promise.all(Array.from({ length: 8 }, () => fetch(
    `${origin}/api/local/market/favorite-quotes`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ regionId: "19", items: [{ itemType: "item", itemId: "30" }] }),
    },
  )));
  assert.equal(favoriteQuoteRefreshes.every((response) => response.status === 200), true);
  const duplicateFavoriteQuote = await fetch(`${origin}/api/local/market/favorite-quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ regionId: "19", items: [{ itemType: "item", itemId: "30" }, { itemType: "item", itemId: "30" }] }),
  });
  assert.equal(duplicateFavoriteQuote.status, 400);
  const tooManyFavoriteQuotes = await fetch(`${origin}/api/local/market/favorite-quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ regionId: "19", items: Array.from({ length: 21 }, (_, index) => ({ itemType: "item", itemId: String(index + 1) })) }),
  });
  assert.equal(tooManyFavoriteQuotes.status, 400);
  const invalidFavoriteQuote = await fetch(`${origin}/api/local/market/favorite-quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ regionId: "not-a-region", items: [{ itemType: "other", itemId: "30" }] }),
  });
  assert.equal(invalidFavoriteQuote.status, 400);
  const oversizedFavoriteQuote = await fetch(`${origin}/api/local/market/favorite-quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ regionId: "19", items: [], padding: "x".repeat(17 * 1024) }),
  });
  assert.equal(oversizedFavoriteQuote.status, 413);
  const reportOnlyOrderBooks = await Promise.all(Array.from({ length: 26 }, () => fetch(
    `${origin}/api/local/market/order-book?claimId=${claimId}&regionId=19&itemType=item&itemId=30`,
    { headers: { "x-manual-refresh-id": "normal-browser-refresh" } },
  )));
  assert.equal(reportOnlyOrderBooks.every((response) => response.status === 200), true);
  const marketStalls = await fetch(`${origin}/api/local/market/stalls?claimId=${claimId}&regionId=19&q=Leather&activeOnly=true&page=1`).then((response) => response.json());
  assert.equal(marketStalls.totalStalls, 1);
  assert.equal(marketStalls.totalOrders, 1);
  assert.equal(marketStalls.stalls[0].entityId, "9007199254740993");
  assert.equal(marketStalls.stalls[0].orders[0].remainingStock, "2147483647");
  assert.equal(marketStalls.stalls[0].orders[0].offers[0].itemName, "Leather");
  assert.equal(marketStalls.stalls[0].orders[0].requires[0].quantity, "9007199254740993");
  const otherActiveRegionStalls = await fetch(`${origin}/api/local/market/stalls?claimId=${claimId}&regionId=9`);
  assert.equal(otherActiveRegionStalls.status, 200);
  const foreignClaimStalls = await fetch(`${origin}/api/local/market/stalls?claimId=999999999&regionId=19`);
  assert.equal(foreignClaimStalls.status, 403);
  const marketPriceHistory = await fetch(`${origin}/api/local/market/price-history?claimId=${claimId}&regionId=19&itemType=item&itemId=30`).then((response) => response.json());
  assert.equal(marketPriceHistory.coverage, "locally-observed");
  assert.equal(marketPriceHistory.observedSince, "2026-05-20T12:00:00.000Z");
  assert.equal(marketPriceHistory.currentAsOf, legacyBuyOrderNow);
  assert.deepEqual(marketPriceHistory.priceData, [{
    bucket: "2026-05-20",
    quantity: "5",
    tradeCount: 1,
    totalValue: "50",
    vwap: "10",
    low: "10",
    high: "10",
  }]);
  assert.deepEqual(marketPriceHistory.recentTrades.map((trade) => trade.id), [
    "relay_closed_listing:19:historic-1",
  ]);
  assert.equal(marketPriceHistory.recentTrades[0].claimId, "1369094286777412590");
  assert.equal(marketPriceHistory.priceStats.totalVolume, "5");
  assert.equal(priceHistoryRequests, 0);
  await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (marketDb) => {
    marketDb.prepare(
      "DELETE FROM market_trades WHERE claim_id = ? AND item_id = '30' AND item_name = 'Noise'",
    ).run(claimId);
  });
  const marketOverview = await fetch(`${origin}/api/local/market/overview?claimId=${claimId}&regionId=19`).then((response) => response.json());
  assert.equal(marketOverview.topDeals[0].profit, "5");
  assert.equal(marketOverview.mostLiquid[0].itemName, "Leather");
  assert.equal(marketOverview.movers.length, 0);
  assert.equal(marketOverview.moverBaseline, "collecting");
  const marketRegions = await fetch(`${origin}/api/local/market/regions?claimId=${claimId}`).then((response) => response.json());
  assert.deepEqual(marketRegions.regions.map((region) => region.regionId), ["9", "19"]);
  const liveDeals = await fetch(`${origin}/api/local/market/deals?claimId=${claimId}`).then((response) => response.json());
  assert.equal(liveDeals.deals[0].buyPrice, "15");
  assert.equal(liveDeals.deals[0].sellPrice, "20");
  assert.equal(liveDeals.deals[0].profit, "5");
  assert.equal(liveDeals.coverage, "current-orders");
  const scopedLiveDeals = await fetch(`${origin}/api/local/market/deals?claimId=${claimId}&regions=19`).then((response) => response.json());
  assert.deepEqual(scopedLiveDeals.deals.map((deal) => deal.buyRegionId), ["19"]);
  const otherActiveRegionDeals = await fetch(`${origin}/api/local/market/deals?claimId=${claimId}&regions=9`);
  assert.equal(otherActiveRegionDeals.status, 200);
  const allRegionalBuyOrders = await fetch(`${origin}/api/local/market/buy-orders?claimId=${claimId}&regionId=all&pageSize=25`).then((response) => response.json());
  assert.deepEqual(allRegionalBuyOrders.rows.map((row) => row.regionId), ["19", "9"]);
  const regionalBuyOrders = await fetch(`${origin}/api/local/market/buy-orders?claimId=${claimId}&regionId=9&search=Leather&pageSize=25&sort=unitPrice&direction=desc`);
  assert.equal(regionalBuyOrders.status, 200);
  const foreignClaimBuyOrders = await fetch(`${origin}/api/local/market/buy-orders?claimId=999999999&regionId=19`);
  assert.equal(foreignClaimBuyOrders.status, 403);
  const unconfiguredRegionBuyOrders = await fetch(`${origin}/api/local/market/buy-orders?claimId=${claimId}&regionId=3`);
  assert.equal(unconfiguredRegionBuyOrders.status, 403);
  const baselineJob = await fetch(`${origin}/api/local/admin/jobs/run`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ key: "regional_buy_order_sale_baselines_refresh" }),
  });
  assert.equal(baselineJob.status, 404);
  const runningBaselineJobs = await fetch(`${origin}/api/local/admin/jobs`, {
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
  }).then((response) => response.json());
  const runningBaselineJob = runningBaselineJobs.jobs.find((job) => job.key === "regional_buy_order_sale_baselines_refresh");
  assert.equal(runningBaselineJob, undefined);
  assert.equal(priceHistoryRequests, 0);
  const buyOrdersAfterBaselineJob = await fetch(`${origin}/api/local/market/buy-orders?claimId=${claimId}&regionId=19&search=Leather&pageSize=25&sort=premium&direction=desc`).then((response) => response.json());
  assert.equal(buyOrdersAfterBaselineJob.opportunities.length, 0);
  const anonymousDealWatch = await fetch(`${origin}/api/local/market/deal-watches`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ regionId: "19", itemId: 30, itemType: 0, itemName: "Leather" }),
  });
  assert.equal(anonymousDealWatch.status, 401);
  const dealSessionToken = "deal-watch-test-session";
  const dealDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  dealDb.prepare(`
    INSERT INTO user_accounts (discord_id, discord_username, discord_global_name, discord_avatar, character_player_id, character_name, character_status, settings_json, created_at, last_login_at)
    VALUES ('222222222222222222', 'DealUser', 'Deal User', NULL, NULL, NULL, 'unlinked', '{}', ?, ?)
  `).run(new Date().toISOString(), new Date().toISOString());
  const dealUserId = dealDb.prepare("SELECT id FROM user_accounts WHERE discord_id = '222222222222222222'").get().id;
  dealDb.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(createHash("sha256").update(dealSessionToken).digest("hex"), dealUserId, new Date(Date.now() + 86400000).toISOString(), new Date().toISOString());
  dealDb.prepare(`
    INSERT INTO user_legal_acceptances (
      user_id, legal_version, terms_digest, privacy_digest,
      age_confirmed, accepted_at, source
    ) VALUES (?, ?, ?, ?, 1, ?, 'oauth')
  `).run(dealUserId, legalPolicy.version, legalDigests.termsDigest, legalDigests.privacyDigest, new Date().toISOString());
  dealDb.close();
  const dealCookie = `bitcraft_user_session=${encodeURIComponent(dealSessionToken)}`;
  const dealCsrfToken = createHash("sha256").update(`csrf:${dealSessionToken}`).digest("base64url");
  const foreignClaimDealWatch = await fetch(`${origin}/api/local/market/deal-watches?claimId=999999999`, {
    method: "POST",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ regionId: "19", itemId: 31, itemType: 0, itemName: "Slow Silk" }),
  });
  assert.equal(foreignClaimDealWatch.status, 403);
  const malformedDealWatch = await fetch(`${origin}/api/local/market/deal-watches`, {
    method: "POST",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ regionId: "19", itemId: "31x", itemType: "unknown", itemName: "Slow Silk" }),
  });
  assert.equal(malformedDealWatch.status, 400);
  const createdDealWatch = await fetch(`${origin}/api/local/market/deal-watches`, {
    method: "POST",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ regionId: "19", itemId: 31, itemType: 0, itemName: "Slow Silk", tier: 2, rarity: "Common", iconAssetName: "slow-silk.png" }),
  });
  assert.equal(createdDealWatch.status, 201);
  const createdDealWatchPayload = await createdDealWatch.json();
  const duplicateDealWatch = await fetch(`${origin}/api/local/market/deal-watches`, {
    method: "POST",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ regionId: "19", itemId: 31, itemType: 0, itemName: "Slow Silk" }),
  });
  assert.equal(duplicateDealWatch.status, 409);
  currentListings = [
    { entityId: "deal-sell-1", claimEntityId: claimId, claimName: "Timbersteel Trade", regionId: 19, regionName: "Zephra", ownerUsername: "Seller", ownerEntityId: "seller-1", itemId: 31, itemType: "0", itemName: "Slow Silk", itemTier: 2, itemRarityStr: "Common", iconAssetName: "slow-silk.png", quantity: 2, price: 57, side: "sell", timestamp: "2026-05-20T12:00:00.000Z", inventoryPermission: true },
    { entityId: "deal-sell-filler", claimEntityId: claimId, claimName: "Timbersteel Trade", regionId: 19, regionName: "Zephra", ownerUsername: "Seller", ownerEntityId: "seller-1", itemId: 20, itemType: "0", itemName: "Oak Plank", quantity: 1, price: 100, side: "sell", timestamp: "2026-05-20T12:00:00.000Z", inventoryPermission: true },
  ];
  const liveDealDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  const liveDealSnapshot = JSON.parse(liveDealDb.prepare(
    "SELECT data_json FROM domain_payload_current WHERE claim_id = ? AND domain = 'regional-market'",
  ).get(claimId).data_json);
  liveDealSnapshot.orders.push(
    { entityId: "3101", claimEntityId: "4001", claimName: "Test Market", regionId: "19", ownerEntityId: "5101", ownerUsername: "Silk Seller One", itemId: "31", itemType: "item", price: "60", priceThreshold: "60", quantity: "2", storedCoins: "0", timestamp: legacyBuyOrderNow, side: "sell" },
    { entityId: "3102", claimEntityId: "4001", claimName: "Test Market", regionId: "19", ownerEntityId: "5102", ownerUsername: "Silk Seller Two", itemId: "31", itemType: "item", price: "100", priceThreshold: "100", quantity: "3", storedCoins: "0", timestamp: legacyBuyOrderNow, side: "sell" },
    { entityId: "3103", claimEntityId: "4001", claimName: "Test Market", regionId: "19", ownerEntityId: "5103", ownerUsername: "Silk Seller Three", itemId: "31", itemType: "item", price: "140", priceThreshold: "140", quantity: "4", storedCoins: "0", timestamp: legacyBuyOrderNow, side: "sell" },
  );
  liveDealDb.prepare(
    "UPDATE domain_payload_current SET data_json = ?, received_at = ?, updated_at = ? WHERE claim_id = ? AND domain = 'regional-market'",
  ).run(JSON.stringify(liveDealSnapshot), legacyBuyOrderNow, legacyBuyOrderNow, claimId);
  liveDealDb.close();
  const immediateDealWatch = await fetch(`${origin}/api/local/market/deal-watches/${createdDealWatchPayload.watch.id}`, {
    method: "PATCH",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(immediateDealWatch.status, 200);
  await waitForCondition("immediate market deal watch alert", async () => {
    const payload = await fetch(`${origin}/api/local/market/deal-alerts`, { headers: { cookie: dealCookie, origin } }).then((response) => response.json());
    return payload.alerts?.length === 1 ? payload : null;
  });
  const dealJob = await fetch(`${origin}/api/local/admin/jobs/run`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ key: "market_deal_watch" }),
  });
  assert.equal(dealJob.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const dealAlerts = await fetch(`${origin}/api/local/market/deal-alerts`, { headers: { cookie: dealCookie, origin } }).then((response) => response.json());
  assert.equal(dealAlerts.alerts[0].baselineWindowDays, 0);
  assert.equal(dealAlerts.alerts[0].baselineKind, "current-sell-median");
  assert.equal(dealAlerts.alerts[0].sampleCount, 3);
  assert.equal(dealAlerts.alerts[0].unitPrice, "60");
  assert.equal(Math.round(dealAlerts.alerts[0].discountPercent), 40);
  assert.equal(priceHistoryRequests, 0);
  assert.equal(slowPriceHistoryResponded, false);
  const duplicateDealJob = await fetch(`${origin}/api/local/admin/jobs/run`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ key: "market_deal_watch" }),
  });
  assert.equal(duplicateDealJob.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const dedupedDealAlerts = await fetch(`${origin}/api/local/market/deal-alerts`, { headers: { cookie: dealCookie, origin } }).then((response) => response.json());
  assert.equal(dedupedDealAlerts.alerts.length, 1);
  currentListings = listings;
  const writableAppDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  writableAppDb.prepare("UPDATE scheduled_jobs SET running = 1, last_run_at = ?, updated_at = ? WHERE job_key = ?")
    .run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "geoip_database_refresh");
  writableAppDb.close();
  const recoveredJobs = await fetch(`${origin}/api/local/admin/jobs`, {
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
  }).then((response) => response.json());
  const recoveredGeoipJob = recoveredJobs.jobs.find((job) => job.key === "geoip_database_refresh");
  assert.equal(recoveredGeoipJob.running, false);
  assert.match(recoveredGeoipJob.lastError, /Recovered abandoned run/);
  failClaimRefresh = true;
  const failedCollect = await fetch(`${origin}/api/local/admin/collect-now`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: "{}",
  }).then((response) => response.json());
  assert.match(failedCollect.collectorStatus.lastError, /Relay (claim|crafts|members) input is unavailable/);
  failClaimRefresh = false;
  const initialConfig = await fetch(`${origin}/api/local/config`).then((response) => response.json());
  const bootstrapResponse = await fetch(`${origin}/api/local/bootstrap`);
  assert.equal(bootstrapResponse.status, 200);
  assert.equal(bootstrapResponse.headers.get("cache-control"), "no-store");
  const bootstrap = await bootstrapResponse.json();
  assert.deepEqual(Object.keys(bootstrap).sort(), ["auth", "build", "config", "legal"]);
  assert.equal(bootstrap.config.claimId, claimId);
  assert.equal(typeof bootstrap.config.claimName, "string");
  assert.equal(bootstrap.config.refreshSeconds, initialConfig.refreshSeconds);
  assert.equal(bootstrap.auth.authenticated, false);
  assert.deepEqual(Object.keys(bootstrap.auth).sort(), ["authenticated", "csrfToken", "discordLoginEnabled", "legal", "user"]);
  assert.equal(bootstrap.legal.acceptanceRequired, false);
  const publicHealth = await fetch(`${origin}/api/local/health`).then((response) => response.json());
  assert.equal(bootstrap.build.version, publicHealth.version);
  assert.equal(typeof bootstrap.build.buildSha, "string");
  assert.equal("visitorSecurity" in bootstrap.config, false);
  assert.equal("discord" in bootstrap.config, false);
  assert.doesNotMatch(JSON.stringify(bootstrap), /botToken|clientSecret|adminSetupKey|geoipLicenseKey/i);
  assert.equal(initialConfig.analytics, undefined);
  assert.deepEqual(initialConfig.excludedMemberIds, []);
  assert.equal(initialConfig.serverRefreshSeconds, 30);
  assert.equal(initialConfig.collectorSettings, undefined);
  const initialPublicPopups = await fetch(`${origin}/api/local/popups`).then((response) => response.json());
  assert.deepEqual(initialPublicPopups, { popups: [] });
  const anonymousAdminPopups = await fetch(`${origin}/api/local/admin/popups`);
  assert.equal(anonymousAdminPopups.status, 401);
  const savedPopupsResponse = await fetch(`${origin}/api/local/admin/popups`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      popups: [
        { id: "release-warning", title: "Release warning", message: "Read this once.", type: "warning", mode: "oneTime", enabled: true, updatedAt: "popup-version-1" },
        { id: "disabled-tip", title: "Disabled tip", message: "Hidden from users.", type: "info", mode: "repeatUntilDismissed", enabled: false, updatedAt: "popup-version-1" },
        { id: "", title: "Invalid", message: "Ignored", enabled: true },
      ],
    }),
  });
  assert.equal(savedPopupsResponse.status, 200);
  const savedPopups = await savedPopupsResponse.json();
  assert.deepEqual(savedPopups.popups.map((popup) => popup.id), ["release-warning", "disabled-tip"]);
  assert.equal(savedPopups.popups[0].type, "warning");
  assert.equal(savedPopups.popups[0].mode, "oneTime");
  const publicPopups = await fetch(`${origin}/api/local/popups`).then((response) => response.json());
  assert.deepEqual(publicPopups.popups.map((popup) => popup.id), ["release-warning"]);
  assert.equal(publicPopups.popups[0].message, "Read this once.");
  const geoipSettingsResponse = await fetch(`${origin}/api/local/admin/settings`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      ...initialConfig,
      visitorSecurity: {
        ...initialConfig.visitorSecurity,
        geoipProvider: "local",
        geoipSourceUrl: `http://127.0.0.1:${upstreamPort}/geoip/GeoLite2-City-CSV.zip`,
        geoipAccountId: "maxmind-account",
        geoipLicenseKey: "maxmind-license",
      },
    }),
  });
  assert.equal(geoipSettingsResponse.status, 200);
  const geoipSettings = await geoipSettingsResponse.json();
  assert.equal(geoipSettings.visitorSecurity.geoipAccountId, "maxmind-account");
  assert.equal(geoipSettings.visitorSecurity.geoipLicenseKeyConfigured, true);
  assert.equal(geoipSettings.visitorSecurity.geoipLicenseKey, undefined);
  const adminJobs = await fetch(`${origin}/api/local/admin/jobs`, {
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
  }).then((response) => response.json());
  assert.equal("recipeCatalogCount" in adminJobs, false);
  assert.equal(adminJobs.jobs.some((job) => job.key === "recipe_catalog_refresh"), false);
  const disabledJobs = await fetch(`${origin}/api/local/admin/jobs`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ key: "geoip_database_refresh", enabled: false }),
  }).then((response) => response.json());
  assert.equal(disabledJobs.jobs.find((job) => job.key === "geoip_database_refresh").enabled, false);
  const scheduledJobsUpdate = await fetch(`${origin}/api/local/admin/jobs`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ key: "geoip_database_refresh", enabled: true, scheduleConfig: { frequency: "weekly", dayOfWeek: 2, time: "03:30" } }),
  }).then((response) => response.json());
  const geoipScheduledJob = scheduledJobsUpdate.jobs.find((job) => job.key === "geoip_database_refresh");
  assert.equal(geoipScheduledJob.enabled, true);
  assert.deepEqual(geoipScheduledJob.scheduleConfig, { frequency: "weekly", dayOfWeek: 2, time: "03:30", dayOfMonth: 1 });
  assert.equal(geoipScheduledJob.scheduleLabel, "Weekly on Tuesday at 03:30");
  assert.match(geoipScheduledJob.nextRunAt, /^\d{4}-\d{2}-\d{2}T/);
  const geoipJobRun = await fetch(`${origin}/api/local/admin/jobs/run`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ key: "geoip_database_refresh" }),
  });
  assert.equal(geoipJobRun.status, 202);
  const geoipJobStart = await geoipJobRun.json();
  assert.equal(geoipJobStart.result.started, true);
  const completedGeoipJob = await waitForCondition("GeoIP scheduled job completion", async () => {
    const status = await fetch(`${origin}/api/local/admin/jobs`, {
      headers: { cookie, origin, "x-csrf-token": auth.csrfToken },
    }).then((response) => response.json());
    const job = status.jobs.find((entry) => entry.key === "geoip_database_refresh");
    return job && !job.running && job.lastSuccessAt ? job : null;
  });
  assert.equal(completedGeoipJob.metadata.entries, 1);
  assert.equal(geoipDownloadRequests, 1);
  const geoipMatchedRequest = await fetch(`${origin}/api/local/health`, { headers: { "x-forwarded-for": "203.0.113.8" } });
  assert.equal(geoipMatchedRequest.status, 200);
  const ipapiSettingsResponse = await fetch(`${origin}/api/local/admin/settings`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      ...initialConfig,
      visitorSecurity: {
        ...initialConfig.visitorSecurity,
        geoipProvider: "ipapi",
        geoipCacheDays: 30,
      },
    }),
  });
  assert.equal(ipapiSettingsResponse.status, 200);
  const ipapiMatchedRequest = await fetch(`${origin}/api/local/health`, { headers: { "x-forwarded-for": "198.51.100.9" } });
  assert.equal(ipapiMatchedRequest.status, 200);
  const ipapiLocation = await waitForCondition("ipapi provider location cache", async () => {
    const security = await fetch(`${origin}/api/local/admin/visitor-security?days=30`, {
      method: "GET",
      headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    }).then((response) => response.json());
    return security.locations.some((location) => location.country === "Providerland" && location.city === "Provider City") ? security : null;
  });
  assert.equal(ipapiLocation.geoip.provider, "ipapi");
  assert.equal(ipapiRequests, 1);
  const ipapiCachedRequest = await fetch(`${origin}/api/local/health`, { headers: { "x-forwarded-for": "198.51.100.9" } });
  assert.equal(ipapiCachedRequest.status, 200);
  assert.equal(ipapiRequests, 1);
  const productionNotificationSettings = await fetch(`${origin}/api/local/admin/settings`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      ...initialConfig,
      excludedMemberIds: ["1369094286756659093", "not-a-player-id"],
      discord: {
        ...initialConfig.discord,
        productionMinXp: 0,
        productionMinAgeMinutes: 0,
      },
    }),
  });
  assert.equal(productionNotificationSettings.status, 200);
  const updatedConfig = await productionNotificationSettings.json();
  assert.deepEqual(updatedConfig.excludedMemberIds, ["1369094286756659093"]);
  const secretDiscordSettings = await fetch(`${origin}/api/local/admin/settings`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      ...updatedConfig,
      discord: {
        ...updatedConfig.discord,
        enabled: true,
        applicationId: "1511277824525471826",
        publicKey: "a".repeat(64),
        channelId: "555555555555555555",
        botToken: "test-discord-bot-token",
        channels: { ...updatedConfig.discord.channels, modLog: "mod-log" },
      },
    }),
  });
  assert.equal(secretDiscordSettings.status, 200);
  const redactedDiscordSettings = await secretDiscordSettings.json();
  assert.equal(redactedDiscordSettings.discord.botToken, undefined);
  assert.equal(redactedDiscordSettings.discord.botTokenConfigured, true);
  assert.equal(JSON.stringify(redactedDiscordSettings).includes("test-discord-bot-token"), false);
  const persistedDiscordSettings = await fetch(`${origin}/api/local/admin/settings`, {
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
  }).then((response) => response.json());
  assert.equal(persistedDiscordSettings.discord.botToken, undefined);
  assert.equal(persistedDiscordSettings.discord.botTokenConfigured, true);
  assert.equal(JSON.stringify(persistedDiscordSettings).includes("test-discord-bot-token"), false);
  const anonymousDiscordSandboxTest = await fetch(`${origin}/api/local/admin/discord/test`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ kind: "basic" }),
  });
  assert.equal(anonymousDiscordSandboxTest.status, 401);
  const isMismatchedSandboxMessage = (message) => (
    message.channelId === "555555555555555555"
    && message.payload?.content === "Discord integration test from Timbersteel Trade."
  );
  const mismatchedChannelMessagesBefore = discordChannelMessages
    .filter(isMismatchedSandboxMessage)
    .length;
  const mismatchedDiscordSandboxTest = await fetch(`${origin}/api/local/admin/discord/test`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ kind: "basic", channelId: "555555555555555555" }),
  });
  assert.equal(mismatchedDiscordSandboxTest.status, 400);
  assert.equal(
    discordChannelMessages.filter(isMismatchedSandboxMessage).length,
    mismatchedChannelMessagesBefore,
  );
  const basicDiscordSandboxTest = await fetch(`${origin}/api/local/admin/discord/test`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ kind: "basic" }),
  });
  assert.equal(basicDiscordSandboxTest.status, 200);
  const basicDiscordSandboxResult = (await basicDiscordSandboxTest.json()).result;
  const basicDiscordSandboxMessage = discordChannelMessages.find((message) => message.id === basicDiscordSandboxResult.id);
  assert.equal(basicDiscordSandboxResult.channel_id, "666666666666666666");
  assert.equal(basicDiscordSandboxMessage?.channelId, "666666666666666666");
  assert.deepEqual(basicDiscordSandboxMessage?.payload.allowed_mentions, { parse: [] });
  const directMessagesBeforeSaleSandboxTest = discordDirectMessages.length;
  const saleDiscordSandboxTest = await fetch(`${origin}/api/local/admin/discord/test`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ kind: "sale" }),
  });
  assert.equal(saleDiscordSandboxTest.status, 200);
  const saleDiscordSandboxResult = (await saleDiscordSandboxTest.json()).result;
  const saleDiscordSandboxMessage = discordChannelMessages.find((message) => message.id === saleDiscordSandboxResult.id);
  assert.equal(discordDirectMessages.length, directMessagesBeforeSaleSandboxTest);
  assert.equal(saleDiscordSandboxResult.channel_id, "666666666666666666");
  assert.equal(saleDiscordSandboxMessage?.channelId, "666666666666666666");
  assert.deepEqual(saleDiscordSandboxMessage?.payload.allowed_mentions, { parse: [] });
  const craftPlanDiscordSandboxTest = await fetch(`${origin}/api/local/admin/discord/craft-plan-report/test`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ reportType: "overview" }),
  });
  assert.equal(craftPlanDiscordSandboxTest.status, 200);
  const craftPlanDiscordSandboxResult = (await craftPlanDiscordSandboxTest.json()).result.response;
  const craftPlanDiscordSandboxMessage = discordChannelMessages.find((message) => message.id === craftPlanDiscordSandboxResult.id);
  assert.equal(craftPlanDiscordSandboxResult.channel_id, "666666666666666666");
  assert.equal(craftPlanDiscordSandboxMessage?.channelId, "666666666666666666");
  assert.deepEqual(craftPlanDiscordSandboxMessage?.payload.allowed_mentions, { parse: [] });
  const sandboxDeliveryDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { readOnly: true });
  const sandboxDeliveries = sandboxDeliveryDb.prepare(`
    SELECT channel_id, metadata_json
    FROM discord_delivery_log
    WHERE channel_key = 'manualSandbox'
    ORDER BY id DESC
    LIMIT 3
  `).all();
  sandboxDeliveryDb.close();
  assert.equal(sandboxDeliveries.length, 3);
  assert.equal(sandboxDeliveries.every((row) => row.channel_id === "666666666666666666"), true);
  assert.equal(sandboxDeliveries.every((row) => JSON.parse(row.metadata_json).manualSandboxTest === true), true);
  const authStatus = await fetch(`${origin}/api/local/auth/me`).then((response) => response.json());
  assert.equal(authStatus.discordLoginEnabled, true);
  assert.equal(authStatus.user, null);
  assert.equal(authStatus.csrfToken, null);
  assert.equal(authStatus.legal.requiresAcceptance, false);
  const publicLegal = await fetch(`${origin}/api/local/legal`).then((response) => response.json());
  assert.equal(publicLegal.version, legalPolicy.version);
  assert.equal(publicLegal.termsDigest, legalDigests.termsDigest);
  assert.equal(publicLegal.privacyDigest, legalDigests.privacyDigest);
  const legacyOauthStart = await fetch(`${origin}/api/local/auth/discord/start?returnTo=%2F%3Fpage%3Dmembers`, { redirect: "manual" });
  assert.equal(legacyOauthStart.status, 302);
  assert.match(legacyOauthStart.headers.get("location"), /^\/\?legal=required/);
  const rejectedOauthStart = await fetch(`${origin}/api/local/auth/discord/start`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ returnTo: "/?page=members", acceptedTerms: true, ageConfirmed: false }),
  });
  assert.equal(rejectedOauthStart.status, 400);
  const oauthStart = await fetch(`${origin}/api/local/auth/discord/start`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ returnTo: "/?page=members", acceptedTerms: true, ageConfirmed: true }),
  });
  assert.equal(oauthStart.status, 200);
  const oauthStartBody = await oauthStart.json();
  const oauthLocation = oauthStartBody.authorizeUrl;
  const oauthCookie = oauthStart.headers.get("set-cookie");
  assert.match(oauthLocation, /^https:\/\/discord\.com\/oauth2\/authorize/);
  assert.match(oauthCookie, /bitcraft_discord_oauth_state=/);
  const signedStateCookie = oauthCookie.match(/bitcraft_discord_oauth_state=([^;]+)/)?.[1] ?? "";
  assert.match(decodeURIComponent(signedStateCookie), /^[^.]+\.[^.]+$/);
  const oauthState = new URL(oauthLocation).searchParams.get("state");
  const signedStateValue = decodeURIComponent(signedStateCookie);
  const tamperedValue = `${signedStateValue.slice(0, -1)}${signedStateValue.endsWith("x") ? "y" : "x"}`;
  const tamperedCallback = await fetch(`${origin}/api/local/auth/discord/callback?code=fake-code&state=${oauthState}`, {
    headers: { cookie: `bitcraft_discord_oauth_state=${encodeURIComponent(tamperedValue)}` },
    redirect: "manual",
  });
  assert.equal(tamperedCallback.status, 302);
  assert.match(tamperedCallback.headers.get("location"), /auth=discord-error/);
  const anonymousCharacterLink = await fetch(`${origin}/api/local/auth/character`, {
    method: "PUT",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ characterPlayerId: "player-1", characterName: "Tester" }),
  });
  assert.equal(anonymousCharacterLink.status, 401);
  const staleSessionToken = "stale-legal-test-session";
  const staleDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  staleDb.prepare(`
    INSERT INTO user_accounts (discord_id, discord_username, character_status, settings_json, created_at, last_login_at)
    VALUES ('stale-legal-user', 'StaleLegal', 'unlinked', '{}', ?, ?)
  `).run(new Date().toISOString(), new Date().toISOString());
  const staleUserId = Number(staleDb.prepare("SELECT id FROM user_accounts WHERE discord_id = 'stale-legal-user'").get().id);
  staleDb.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(createHash("sha256").update(staleSessionToken).digest("hex"), staleUserId, new Date(Date.now() + 86400000).toISOString(), new Date().toISOString());
  staleDb.close();
  const staleCookie = `bitcraft_user_session=${encodeURIComponent(staleSessionToken)}`;
  const staleAuth = await fetch(`${origin}/api/local/auth/me`, { headers: { cookie: staleCookie, origin } }).then((response) => response.json());
  assert.equal(staleAuth.legal.requiresAcceptance, true);
  assert.ok(staleAuth.csrfToken);
  const staleSettings = await fetch(`${origin}/api/local/auth/settings`, {
    method: "PUT",
    headers: { cookie: staleCookie, origin, "content-type": "application/json", "x-csrf-token": staleAuth.csrfToken },
    body: JSON.stringify({ settings: { density: "compact" } }),
  });
  assert.equal(staleSettings.status, 428);
  assert.equal((await staleSettings.json()).code, "legal_acceptance_required");
  const staleExport = await fetch(`${origin}/api/local/auth/privacy/export`, { headers: { cookie: staleCookie, origin } });
  assert.equal(staleExport.status, 200);
  assert.match(staleExport.headers.get("content-disposition"), /timbersteel-claim-monitor-data-/);
  assert.doesNotMatch(await staleExport.text(), /stale-legal-test-session/);
  const wrongDeleteConfirmation = await fetch(`${origin}/api/local/auth/privacy/account`, {
    method: "DELETE",
    headers: { cookie: staleCookie, origin, "content-type": "application/json", "x-csrf-token": staleAuth.csrfToken },
    body: JSON.stringify({ confirmation: "delete" }),
  });
  assert.equal(wrongDeleteConfirmation.status, 400);
  const missingDeleteReauth = await fetch(`${origin}/api/local/auth/privacy/account`, {
    method: "DELETE",
    headers: { cookie: staleCookie, origin, "content-type": "application/json", "x-csrf-token": staleAuth.csrfToken },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  assert.equal(missingDeleteReauth.status, 403);
  assert.equal((await missingDeleteReauth.json()).code, "recent_discord_reauthentication_required");
  const deletionReauthStart = await fetch(`${origin}/api/local/auth/privacy/reauth/start`, {
    method: "POST",
    headers: { cookie: staleCookie, origin, "content-type": "application/json", "x-csrf-token": staleAuth.csrfToken },
    body: "{}",
  });
  assert.equal(deletionReauthStart.status, 200);
  assert.match((await deletionReauthStart.json()).authorizeUrl, /^https:\/\/discord\.com\/oauth2\/authorize/);
  assert.match(deletionReauthStart.headers.get("set-cookie"), /bitcraft_discord_oauth_state=/);
  const rejectedLegalAcceptance = await fetch(`${origin}/api/local/auth/legal/accept`, {
    method: "POST",
    headers: { cookie: staleCookie, origin, "content-type": "application/json", "x-csrf-token": staleAuth.csrfToken },
    body: JSON.stringify({ acceptedTerms: true, ageConfirmed: false }),
  });
  assert.equal(rejectedLegalAcceptance.status, 400);
  const acceptedLegal = await fetch(`${origin}/api/local/auth/legal/accept`, {
    method: "POST",
    headers: { cookie: staleCookie, origin, "content-type": "application/json", "x-csrf-token": staleAuth.csrfToken },
    body: JSON.stringify({ acceptedTerms: true, ageConfirmed: true }),
  });
  assert.equal(acceptedLegal.status, 200);
  assert.equal((await acceptedLegal.json()).legal.requiresAcceptance, false);
  const deletionReadyDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  deletionReadyDb.prepare("UPDATE user_sessions SET reauthenticated_at = ? WHERE token_hash = ?")
    .run(new Date().toISOString(), createHash("sha256").update(staleSessionToken).digest("hex"));
  deletionReadyDb.close();
  const deletedAccount = await fetch(`${origin}/api/local/auth/privacy/account`, {
    method: "DELETE",
    headers: { cookie: staleCookie, origin, "content-type": "application/json", "x-csrf-token": staleAuth.csrfToken },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  assert.equal(deletedAccount.status, 200);
  const deletionReceipt = await deletedAccount.json();
  assert.equal(deletionReceipt.receipt.deleted.user_accounts, 1);
  assert.equal(deletionReceipt.notification.ok, false);
  assert.match(deletedAccount.headers.get("set-cookie"), /bitcraft_user_session=;/);
  const deletedAuth = await fetch(`${origin}/api/local/auth/me`, { headers: { cookie: staleCookie, origin } }).then((response) => response.json());
  assert.equal(deletedAuth.user, null);
  const savedAccountSettings = await fetch(`${origin}/api/local/auth/settings`, {
    method: "PUT",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ settings: { density: "compact", selectedMemberId: "player-42", toastSettings: { marketListings: false, marketSales: true, production: false } } }),
  });
  assert.equal(savedAccountSettings.status, 200);
  assert.equal((await savedAccountSettings.json()).user.settings.density, "compact");
  const reloadedAccountSettings = await fetch(`${origin}/api/local/auth/me`, { headers: { cookie: dealCookie, origin } }).then((response) => response.json());
  assert.equal(reloadedAccountSettings.user.discordId, "222222222222222222");
  assert.equal(reloadedAccountSettings.user.settings.selectedMemberId, "player-42");
  assert.equal(reloadedAccountSettings.user.settings.toastSettings.marketListings, false);
  const approvedLinkDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  approvedLinkDb.prepare("UPDATE user_accounts SET character_player_id = ?, character_name = ?, character_status = 'approved' WHERE discord_id = ?")
    .run("12345678", "Approved Character", "222222222222222222");
  approvedLinkDb.close();
  const blockedRelink = await fetch(`${origin}/api/local/auth/character`, {
    method: "PUT",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ characterPlayerId: "87654321", characterName: "Different Character" }),
  });
  assert.equal(blockedRelink.status, 409);
  assert.match((await blockedRelink.json()).error, /unlink/i);
  const unlinkApprovedCharacter = await fetch(`${origin}/api/local/auth/character`, {
    method: "PUT",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ characterPlayerId: "", characterName: "" }),
  });
  assert.equal(unlinkApprovedCharacter.status, 200);
  const relinkAfterUnlink = await fetch(`${origin}/api/local/auth/character`, {
    method: "PUT",
    headers: { cookie: dealCookie, origin, "content-type": "application/json", "x-csrf-token": dealCsrfToken },
    body: JSON.stringify({ characterPlayerId: "87654321", characterName: "Different Character" }),
  });
  assert.equal(relinkAfterUnlink.status, 200);
  assert.equal((await relinkAfterUnlink.json()).user.characterStatus, "pending");
  const linkedAccounts = await fetch(`${origin}/api/local/admin/user-accounts`, {
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
  }).then((response) => response.json());
  assert.equal(linkedAccounts.accounts.some((account) => account.discordId === "222222222222222222"), true);
  const characterAssignmentDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  characterAssignmentDb.prepare(`
    INSERT INTO user_accounts (
      discord_id, discord_username, discord_global_name, discord_avatar,
      character_player_id, character_name, character_status, settings_json,
      created_at, last_login_at
    ) VALUES (?, ?, ?, NULL, NULL, NULL, 'unlinked', '{}', ?, ?)
  `).run("333333333333333333", "SecondUser", "Second User", new Date().toISOString(), new Date().toISOString());
  const secondUserId = Number(characterAssignmentDb.prepare("SELECT id FROM user_accounts WHERE discord_id = ?").get("333333333333333333").id);
  characterAssignmentDb.close();

  const directMessagesBeforeStaleTarget = discordDirectMessages.length;
  const staleTargetAssignment = await fetch(`${origin}/api/local/admin/user-accounts/character`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: secondUserId, characterPlayerId: "55555555", characterName: "No Consent Character" }),
  });
  assert.equal(staleTargetAssignment.status, 409);
  assert.match((await staleTargetAssignment.json()).error, /terms|privacy|accept/i);
  assert.equal(discordDirectMessages.length, directMessagesBeforeStaleTarget);

  const secondAcceptanceDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  secondAcceptanceDb.prepare(`
    INSERT INTO user_legal_acceptances (
      user_id, legal_version, terms_digest, privacy_digest, age_confirmed, accepted_at, source
    ) VALUES (?, ?, ?, ?, 1, ?, 'existing-session')
  `).run(secondUserId, legalPolicy.version, legalDigests.termsDigest, legalDigests.privacyDigest, new Date().toISOString());
  const auditCountBeforeFailedDm = Number(secondAcceptanceDb.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'linked_account.character_assigned'").get().count);
  secondAcceptanceDb.close();
  failedDiscordRecipients.add("333333333333333333");
  const failedDmAssignment = await fetch(`${origin}/api/local/admin/user-accounts/character`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: secondUserId, characterPlayerId: "55555555", characterName: "DM Failure Character" }),
  });
  assert.equal(failedDmAssignment.status, 502);
  failedDiscordRecipients.delete("333333333333333333");
  const failedAssignmentDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { readOnly: true });
  const unchangedAfterFailedDm = failedAssignmentDb.prepare("SELECT character_player_id, character_status FROM user_accounts WHERE id = ?").get(secondUserId);
  const auditCountAfterFailedDm = Number(failedAssignmentDb.prepare("SELECT COUNT(*) AS count FROM admin_audit_log WHERE action = 'linked_account.character_assigned'").get().count);
  failedAssignmentDb.close();
  assert.equal(String(unchangedAfterFailedDm.character_player_id ?? ""), "");
  assert.equal(unchangedAfterFailedDm.character_status, "unlinked");
  assert.equal(auditCountAfterFailedDm, auditCountBeforeFailedDm);

  const directMessagesBeforeAssignment = discordDirectMessages.length;
  const channelMessagesBeforeAssignment = discordChannelMessages.length;
  const assignCharacter = await fetch(`${origin}/api/local/admin/user-accounts/character`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: dealUserId, characterPlayerId: "87654321", characterName: "Assigned Character" }),
  });
  assert.equal(assignCharacter.status, 200);
  assert.equal(discordDirectMessages.length, directMessagesBeforeAssignment + 1);
  assert.equal(discordDirectMessages.at(-1)?.recipientId, "222222222222222222");
  assert.equal(discordChannelMessages.length, channelMessagesBeforeAssignment + 1);
  const assignedAccounts = (await assignCharacter.json()).accounts;
  assert.deepEqual(
    assignedAccounts.find((account) => account.id === dealUserId),
    {
      ...assignedAccounts.find((account) => account.id === dealUserId),
      characterPlayerId: "87654321",
      characterName: "Assigned Character",
      characterStatus: "approved",
    },
  );

  const directMessagesBeforeDuplicate = discordDirectMessages.length;
  const duplicateAssignment = await fetch(`${origin}/api/local/admin/user-accounts/character`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: secondUserId, characterPlayerId: "87654321", characterName: "Assigned Character" }),
  });
  assert.equal(duplicateAssignment.status, 409);
  assert.match((await duplicateAssignment.json()).error, /unassign/i);
  assert.equal(discordDirectMessages.length, directMessagesBeforeDuplicate);

  const pendingDuplicateDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  pendingDuplicateDb.prepare("UPDATE user_accounts SET character_player_id = ?, character_name = ?, character_status = 'pending' WHERE id = ?")
    .run("87654321", "Assigned Character", secondUserId);
  pendingDuplicateDb.close();
  const duplicateApproval = await fetch(`${origin}/api/local/admin/user-accounts/approval`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: secondUserId, status: "approved" }),
  });
  assert.equal(duplicateApproval.status, 409);

  failedDiscordRecipients.add("222222222222222222");
  const unassignCharacter = await fetch(`${origin}/api/local/admin/user-accounts/character`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: dealUserId, characterPlayerId: "", characterName: "" }),
  });
  assert.equal(unassignCharacter.status, 200);
  const unassignBody = await unassignCharacter.json();
  assert.equal(unassignBody.notification.user.ok, false);
  failedDiscordRecipients.delete("222222222222222222");
  const unassignedAccount = unassignBody.accounts.find((account) => account.id === dealUserId);
  assert.equal(unassignedAccount.characterPlayerId, "");
  assert.equal(unassignedAccount.characterName, "");
  assert.equal(unassignedAccount.characterStatus, "unlinked");

  const raceDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  raceDb.prepare(`
    INSERT INTO user_accounts (
      discord_id, discord_username, discord_global_name, discord_avatar,
      character_player_id, character_name, character_status, settings_json,
      created_at, last_login_at
    ) VALUES (?, ?, ?, NULL, NULL, NULL, 'unlinked', '{}', ?, ?)
  `).run("444444444444444444", "RaceUser", "Race User", new Date().toISOString(), new Date().toISOString());
  const raceUserId = Number(raceDb.prepare("SELECT id FROM user_accounts WHERE discord_id = ?").get("444444444444444444").id);
  raceDb.close();
  const directMessagesBeforeRace = discordDirectMessages.length;
  discordAssignmentRace = {
    recipientId: "333333333333333333",
    characterPlayerId: "99999999",
    characterName: "Raced Character",
    competingUserId: raceUserId,
  };
  const racedAssignment = await fetch(`${origin}/api/local/admin/user-accounts/character`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: secondUserId, characterPlayerId: "99999999", characterName: "Raced Character" }),
  });
  assert.equal(racedAssignment.status, 409);
  assert.equal(discordDirectMessages.length, directMessagesBeforeRace + 2);
  assert.match(JSON.stringify(discordDirectMessages.at(-1)?.payload), /did not complete/i);
  const racedAssignmentDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { readOnly: true });
  const raceTarget = racedAssignmentDb.prepare("SELECT character_player_id, character_status FROM user_accounts WHERE id = ?").get(secondUserId);
  racedAssignmentDb.close();
  assert.notEqual(String(raceTarget.character_player_id ?? ""), "99999999");
  assert.notEqual(raceTarget.character_status, "approved");

  const reassignCharacter = await fetch(`${origin}/api/local/admin/user-accounts/character`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: secondUserId, characterPlayerId: "87654321", characterName: "Assigned Character" }),
  });
  assert.equal(reassignCharacter.status, 200);
  assert.equal((await reassignCharacter.json()).accounts.find((account) => account.id === secondUserId).characterStatus, "approved");

  const assignmentEvidenceDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { readOnly: true });
  const assignmentAuditActions = assignmentEvidenceDb.prepare(`
    SELECT action FROM admin_audit_log
    WHERE action IN ('linked_account.character_assigned', 'linked_account.character_unassigned')
    ORDER BY id
  `).all().map((row) => row.action);
  const assignmentDeliveryEvents = assignmentEvidenceDb.prepare(`
    SELECT event_type FROM discord_delivery_log
    WHERE event_type IN ('character_link_assigned', 'character_link_unassigned')
    ORDER BY id
  `).all().map((row) => row.event_type);
  const failedUnassignmentNotice = assignmentEvidenceDb.prepare(`
    SELECT status FROM discord_delivery_log
    WHERE event_type = 'character_link_unassignment_notice'
      AND json_extract(metadata_json, '$.discordId') = '222222222222222222'
    ORDER BY id DESC
    LIMIT 1
  `).get();
  assignmentEvidenceDb.close();
  assert.deepEqual(assignmentAuditActions.slice(-3), [
    "linked_account.character_assigned",
    "linked_account.character_unassigned",
    "linked_account.character_assigned",
  ]);
  assert.deepEqual(assignmentDeliveryEvents.slice(-3), [
    "character_link_assigned",
    "character_link_unassigned",
    "character_link_assigned",
  ]);
  assert.equal(failedUnassignmentNotice.status, "failed");

  const wrongAdminDeletionConfirmation = await fetch(`${origin}/api/local/admin/user-accounts/privacy`, {
    method: "DELETE",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: secondUserId, confirmation: "delete" }),
  });
  assert.equal(wrongAdminDeletionConfirmation.status, 400);

  const adminDeletionEvidenceDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { readOnly: true });
  const adminIdentitiesBeforeDeletion = Number(adminDeletionEvidenceDb.prepare("SELECT COUNT(*) AS count FROM admin_users").get().count);
  adminDeletionEvidenceDb.close();
  failedDiscordRecipients.add("333333333333333333");
  const administratorAssistedDeletion = await fetch(`${origin}/api/local/admin/user-accounts/privacy`, {
    method: "DELETE",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ userId: secondUserId, confirmation: "DELETE" }),
  });
  failedDiscordRecipients.delete("333333333333333333");
  assert.equal(administratorAssistedDeletion.status, 200);
  const administratorAssistedDeletionBody = await administratorAssistedDeletion.json();
  assert.equal(administratorAssistedDeletionBody.receipt.deleted.user_accounts, 1);
  assert.equal(administratorAssistedDeletionBody.notification.ok, false);

  const removedAccountDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { readOnly: true });
  assert.equal(removedAccountDb.prepare("SELECT id FROM user_accounts WHERE id = ?").get(secondUserId), undefined);
  assert.equal(Number(removedAccountDb.prepare("SELECT COUNT(*) AS count FROM admin_users").get().count), adminIdentitiesBeforeDeletion);
  const adminDeletionAudit = removedAccountDb.prepare(`
    SELECT details_json FROM admin_audit_log
    WHERE action = 'privacy.account_admin_removed'
    ORDER BY id DESC LIMIT 1
  `).get();
  removedAccountDb.close();
  assert.ok(adminDeletionAudit);
  assert.equal(adminDeletionAudit.details_json.includes("333333333333333333"), false);
  assert.equal(adminDeletionAudit.details_json.includes("SecondUser"), false);
  assert.equal(JSON.parse(adminDeletionAudit.details_json).receiptId, administratorAssistedDeletionBody.receipt.receiptId);

  const saveAccessControl = await fetch(`${origin}/api/local/admin/access-control`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ rules: {
      "page:market": { mode: "specificUsers", allowedDiscordIds: ["222222222222222222", "333333333333333333", "invalid"] },
      "page:map": { mode: "verified" },
      "tab:market:live": { mode: "discord" },
    } }),
  });
  assert.equal(saveAccessControl.status, 200);
  const savedAccessControl = await saveAccessControl.json();
  assert.deepEqual(savedAccessControl.config.rules["page:market"].allowedDiscordIds, ["222222222222222222"]);
  const anonymousEffectiveAccess = await fetch(`${origin}/api/local/access-control/effective`, { headers: { origin } }).then((response) => response.json());
  assert.equal(anonymousEffectiveAccess.targets["page:market"].allowed, false);
  assert.equal(Object.prototype.hasOwnProperty.call(anonymousEffectiveAccess.targets["page:market"], "allowedDiscordIds"), false);
  const signedEffectiveAccess = await fetch(`${origin}/api/local/access-control/effective`, { headers: { cookie: dealCookie, origin } }).then((response) => response.json());
  assert.equal(signedEffectiveAccess.targets["page:map"].allowed, false);
  const refusedAnalytics = await fetch(`${origin}/api/local/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ sessionId: "session-identifier-0001", eventName: "page_view", page: "production" }),
  });
  assert.equal(refusedAnalytics.status, 403);
  const analyticsCookie = "claim_monitor_analytics_consent=accepted; claim_monitor_analytics_visitor=visitor-identifier-0001";
  const analyticsView = await fetch(`${origin}/api/local/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: analyticsCookie },
    body: JSON.stringify({ sessionId: "session-identifier-0001", eventName: "page_view", page: "production" }),
  });
  assert.equal(analyticsView.status, 201);
  const analyticsUse = await fetch(`${origin}/api/local/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: analyticsCookie },
    body: JSON.stringify({ sessionId: "session-identifier-0001", eventName: "production_eligibility_filter_used", page: "production", properties: { scope: "member" } }),
  });
  assert.equal(analyticsUse.status, 201);
  const analyticsDuration = await fetch(`${origin}/api/local/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: analyticsCookie },
    body: JSON.stringify({ sessionId: "session-identifier-0001", eventName: "page_duration", page: "production", durationSeconds: 90 }),
  });
  assert.equal(analyticsDuration.status, 201);
  const oversizedAnalytics = await fetch(`${origin}/api/local/analytics/event`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, cookie: analyticsCookie },
    body: JSON.stringify({ sessionId: "session-identifier-0001", eventName: "page_view", page: "production", filler: "x".repeat(9000) }),
  });
  assert.equal(oversizedAnalytics.status, 413);
  const analyticsDashboard = await fetch(`${origin}/api/local/admin/analytics?days=30`, {
    method: "GET",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
  }).then((response) => response.json());
  assert.equal(analyticsDashboard.totals.visitors, 1);
  assert.equal(analyticsDashboard.totals.pageViews, 1);
  assert.equal(analyticsDashboard.totals.interactions, 1);
  assert.equal(analyticsDashboard.totals.durationSeconds, 90);
  const visitorSecurity = await fetch(`${origin}/api/local/admin/visitor-security?days=30`, {
    method: "GET",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
  }).then((response) => response.json());
  assert.equal(visitorSecurity.retention.fullIpDays, 7);
  assert.equal(visitorSecurity.geoip.configured, true);
  assert.equal(visitorSecurity.geoip.entries, 1);
  assert.equal(visitorSecurity.totals.requests > 0, true);
  assert.equal(visitorSecurity.totals.uniqueVisitors > 0, true);
  assert.equal(visitorSecurity.locations.some((location) => location.country === "United Kingdom" && location.city === "London"), true);
  assert.equal(visitorSecurity.locations.some((location) => location.country === "Unknown"), true);
  assert.equal(visitorSecurity.recent.page, 1);
  assert.equal(visitorSecurity.recent.pageSize, 50);
  assert.equal(visitorSecurity.recent.total >= visitorSecurity.recent.rows.length, true);
  assert.equal(visitorSecurity.recent.rows.some((event) => String(event.ipAnonymized ?? "").startsWith("127.0.0.0")), true);
  assert.equal(visitorSecurity.recent.rows.some((event) => event.ipAddress === "127.0.0.1"), true);
  const searchedSecurityEvents = await fetch(`${origin}/api/local/admin/visitor-security?days=30&eventSearch=Provider%20City&eventPageSize=10`, {
    method: "GET",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
  }).then((response) => response.json());
  assert.equal(searchedSecurityEvents.recent.page, 1);
  assert.equal(searchedSecurityEvents.recent.pageSize, 10);
  assert.equal(searchedSecurityEvents.recent.rows.length <= 10, true);
  assert.equal(searchedSecurityEvents.recent.total >= searchedSecurityEvents.recent.rows.length, true);
  assert.equal(searchedSecurityEvents.recent.rows.every((event) => event.city === "Provider City"), true);
  const createViewer = await fetch(`${origin}/api/local/admin/users`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ username: "viewer", password: "viewer password ok", role: "viewer" }),
  });
  assert.equal(createViewer.status, 201);
  const viewerAuth = await createTestAdminSession(path.join(dataDir, "bitcraft-local.sqlite"), { username: "viewer", role: "viewer" });
  const viewerCookie = viewerAuth.cookie;
  assert.equal(viewerAuth.user.role, "viewer");
  const viewerStatus = await fetch(`${origin}/api/local/admin/status`, { headers: { cookie: viewerCookie, origin } });
  assert.equal(viewerStatus.status, 200);
  const viewerMembership = await fetch(`${origin}/api/local/admin/empire-membership`, {
    headers: { cookie: viewerCookie, origin },
  });
  assert.equal(viewerMembership.status, 200);
  const viewerMembershipBody = await viewerMembership.json();
  assert.equal(viewerMembershipBody.tracking.empireId, "10");
  assert.equal(Object.hasOwn(viewerMembershipBody, "adminUsers"), false);
  assert.equal(Object.hasOwn(viewerMembershipBody, "settings"), false);
  const viewerSettingsMutation = await fetch(`${origin}/api/local/admin/settings`, {
    method: "PUT",
    headers: { cookie: viewerCookie, origin, "content-type": "application/json", "x-csrf-token": viewerAuth.csrfToken },
    body: JSON.stringify({}),
  });
  assert.equal(viewerSettingsMutation.status, 403);
  const viewerAccessControlMutation = await fetch(`${origin}/api/local/admin/access-control`, {
    method: "PUT",
    headers: { cookie: viewerCookie, origin, "content-type": "application/json", "x-csrf-token": viewerAuth.csrfToken },
    body: JSON.stringify({ rules: {} }),
  });
  assert.equal(viewerAccessControlMutation.status, 403);  const viewerUserList = await fetch(`${origin}/api/local/admin/users`, { headers: { cookie: viewerCookie, origin } });
  assert.equal(viewerUserList.status, 403);
  const createAdmin = await fetch(`${origin}/api/local/admin/users`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({ username: "manager", password: "manager password ok", role: "admin" }),
  });
  assert.equal(createAdmin.status, 201);
  const adminAuth = await createTestAdminSession(path.join(dataDir, "bitcraft-local.sqlite"), { username: "manager", role: "admin" });
  const adminCookie = adminAuth.cookie;
  assert.equal(adminAuth.user.role, "admin");
  const adminUserList = await fetch(`${origin}/api/local/admin/users`, { headers: { cookie: adminCookie, origin } });
  assert.equal(adminUserList.status, 200);

  // Current contribution attribution is subscription-driven, so a forced poll
  // exposes no game-data acquisition reconciler.
  await seedCommittedRelayInputs();

  const reportOnlyGameData = await Promise.all(Array.from({ length: 13 }, () => fetch(
    `${origin}/api/local/game-data?claimId=${claimId}&domains=claim`,
    { headers: { "x-client-refresh-mode": "normal" } },
  )));
  assert.equal(reportOnlyGameData.every((response) => response.status === 200), true);
  const routeHealthResponse = await fetch(`${origin}/api/local/admin/server-health`, { headers: { cookie, origin } });
  assert.equal(routeHealthResponse.status, 200);
  const routeHealth = await routeHealthResponse.json();
  const routePerformance = routeHealth.application.routePerformance;
  const catalogPerformance = routePerformance.routes.find((route) => route.path === "/api/local/market/catalog");
  const orderBookPerformance = routePerformance.routes.find((route) => route.path === "/api/local/market/order-book");
  const priceHistoryPerformance = routePerformance.routes.find((route) => route.path === "/api/local/market/price-history");
  const favoriteQuotesPerformance = routePerformance.routes.find((route) => route.path === "/api/local/market/favorite-quotes");
  const gameDataPerformance = routePerformance.routes.find((route) => route.path === "/api/local/game-data");
  assert.ok(catalogPerformance.sampleCount >= 1);
  assert.ok(catalogPerformance.responseBytes.p99 > 0);
  assert.ok(catalogPerformance.projectionMs.p99 >= 0);
  assert.ok(orderBookPerformance.sampleCount >= 26);
  assert.ok(orderBookPerformance.responseBytes.p99 > 0);
  assert.equal(orderBookPerformance.status429, 0);
  assert.ok(priceHistoryPerformance.sampleCount >= 1);
  assert.ok(priceHistoryPerformance.responseBytes.p99 > 0);
  assert.ok(priceHistoryPerformance.projectionMs.p99 >= 0);
  assert.ok(favoriteQuotesPerformance.sampleCount >= 13);
  assert.ok(favoriteQuotesPerformance.responseBytes.p99 > 0);
  assert.ok(favoriteQuotesPerformance.projectionMs.p99 >= 0);
  assert.equal(favoriteQuotesPerformance.status429, 0);
  assert.ok(gameDataPerformance.sampleCount >= 13);
  assert.ok(gameDataPerformance.responseBytes.p99 > 0);
  assert.equal(gameDataPerformance.status429, 0);
  assert.deepEqual(routePerformance.rateLimits.orderBookRead, { reportOnly: true, wouldLimit: 2 });
  assert.deepEqual(routePerformance.rateLimits.favoriteQuotesRead, { reportOnly: true, wouldLimit: 6 });
  assert.deepEqual(routePerformance.rateLimits.gameDataRead, { reportOnly: true, wouldLimit: 1 });
  assert.deepEqual(routePerformance.gates.gameData, { active: 0, queued: 0, rejected: 0, maxConcurrent: 8, maxQueued: 16 });
  assert.deepEqual(routePerformance.gates.market, { active: 0, queued: 0, rejected: 0, maxConcurrent: 8, maxQueued: 16 });

  const validCatalogPath = `/api/local/market/catalog?claimId=${claimId}&regionId=19&q=Leather&limit=12`;
  const saturatedMarketStatuses = await pipelinedHttpStatuses(appPort, [
    ...Array(24).fill(validCatalogPath),
    validCatalogPath,
    `/api/local/market/catalog?claimId=${claimId}&regionId=7&q=Leather&limit=12`,
    `/api/local/market/order-book?claimId=${claimId}&regionId=7&itemType=item&itemId=30`,
    `/api/local/market/price-history?claimId=${claimId}&regionId=7&itemType=item&itemId=30&range=30d`,
  ]);
  assert.equal(saturatedMarketStatuses.length, 28);
  assert.deepEqual(saturatedMarketStatuses.slice(0, 24), Array(24).fill(200));
  assert.equal(saturatedMarketStatuses[24], 503, "a valid overflow request proves the market projection gate is saturated");
  assert.deepEqual(saturatedMarketStatuses.slice(25), [403, 403, 403], "out-of-scope market reads must be rejected before capacity admission");
  const saturatedRouteHealth = await fetch(`${origin}/api/local/admin/server-health`, { headers: { cookie, origin } }).then((response) => response.json());
  assert.equal(saturatedRouteHealth.application.routePerformance.gates.market.rejected, 1, "only the valid overflow request reaches the saturated gate");

  assert.ok(routePerformance.marketOrderIndexCache.builds >= 1);
  assert.ok(routePerformance.marketOrderIndexCache.hits >= 1);
  assert.ok(routePerformance.marketOrderIndexCache.entries <= 2);
  assert.doesNotMatch(JSON.stringify(routePerformance), new RegExp(`${claimId}|itemId|claimId|normal-browser-refresh`));

  const poll = await fetch(`${origin}/api/local/admin/poll`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: "{}",
  });
  assert.equal(poll.status, 200);
  const pollJson = await poll.json();
  const reconcilers = pollJson.collectorStatus.collectors;
  assert.equal(reconcilers.production.source, "relay-commits");
  assert.equal(reconcilers.settlementTransitions.source, "relay-commits");
  assert.equal(reconcilers.empireMembership.source, "relay-subscription");
  const baselineHistory = await fetch(`${origin}/api/local/market/history?claimId=${claimId}&owner=Tester`).then((response) => response.json());
  assert.ok(baselineHistory.totals, JSON.stringify(baselineHistory));
  assert.equal(baselineHistory.totals.confirmedSales, 1);
  assert.equal(baselineHistory.totals.confirmedUnits, 5);
  assert.equal(baselineHistory.totals.trackedValue, 50);
  assert.equal(baselineHistory.sales[0].purchaserEntityId, null);
  assert.equal(baselineHistory.sales[0].purchaserUsername, "Buyer");
  await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (db) => {
    db.prepare(`
      INSERT INTO activity_events (
        claim_id, event_type, summary, occurred_at, metadata_json, source_key
      ) VALUES (?, 'storage', ?, ?, ?, ?)
    `).run(
      claimId,
      "Tester deposited 12 Bronze Ingot to Ingots",
      "2026-05-20T12:05:00.000Z",
      JSON.stringify({
        action: "deposit",
        actorEntityId: "player-1",
        actorName: "Tester",
        buildingId: "building-1",
        containerName: "Ingots",
        itemId: "item-1",
        itemName: "Bronze Ingot",
        itemType: "item",
        quantity: "12",
        regionId: "19",
        relayLogId: "log-1",
      }),
      "relay-storage:19:log-1",
    );
  });
  const baselineActivity = await fetch(`${origin}/api/local/activity?claimId=${claimId}&limit=20`).then((response) => response.json());
  const storageEvent = baselineActivity.events.find((event) => event.event_type === "storage");
  assert.equal(storageEvent.summary, "Tester deposited 12 Bronze Ingot to Ingots");
  assert.equal(JSON.parse(storageEvent.metadata_json).containerName, "Ingots");
  assert.equal(baselineActivity.total >= baselineActivity.events.length, true);
  assert.equal(baselineActivity.events.filter((event) => event.event_type === "market_new_listing").length, 0);
  const notificationSecretDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  notificationSecretDb.prepare(`
    INSERT INTO activity_events (claim_id, event_type, summary, occurred_at, metadata_json, source_key)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    claimId,
    "market_new_listing",
    "New market listing: Secret sentinel",
    "2099-01-01T00:00:00.000Z",
    JSON.stringify({
      itemName: "Secret Sentinel",
      itemId: 9001,
      tier: 1,
      discordBotToken: "test-discord-bot-token",
      adminSetupKey: "test-setup-key",
      nested: { client_secret: "test-discord-oauth-secret" },
    }),
    "release-secret-sentinel",
  );
  notificationSecretDb.close();
  const notificationActivity = await fetch(`${origin}/api/local/notification-activity?claimId=${claimId}&limit=20`).then((response) => response.json());
  assert.equal(notificationActivity.events.length >= 1, true);
  assert.equal(notificationActivity.events.every((event) => ["market_new_listing", "market_sale", "market_sale_confirmed", "production_started", "production_completed"].includes(event.event_type)), true);
  assert.equal(notificationActivity.events.some((event) => event.event_type === "production_started"), false);
  assert.equal(notificationActivity.events.filter((event) => event.event_type === "market_new_listing").length, 1);
  assert.equal(notificationActivity.events.some((event) => event.event_type === "storage"), false);
  const secretNotification = notificationActivity.events.find((event) => event.source_key === "release-secret-sentinel");
  assert.ok(secretNotification);
  assert.deepEqual(JSON.parse(secretNotification.metadata_json), {
    itemName: "Secret Sentinel",
    itemId: 9001,
    tier: 1,
    nested: {},
  });
  assert.equal(JSON.stringify(notificationActivity).includes("test-discord-bot-token"), false);
  assert.equal(JSON.stringify(notificationActivity).includes("test-setup-key"), false);
  assert.equal(JSON.stringify(notificationActivity).includes("test-discord-oauth-secret"), false);
  const repeatPoll = await fetch(`${origin}/api/local/admin/poll`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: "{}",
  });
  assert.equal(repeatPoll.status, 200);
  const repeatActivity = await fetch(`${origin}/api/local/activity?claimId=${claimId}&q=${encodeURIComponent("New market listing")}&limit=20`).then((response) => response.json());
  assert.equal(repeatActivity.events.filter((event) => event.event_type === "market_new_listing").length, 1);
  const activitySearch = await fetch(`${origin}/api/local/activity?claimId=${claimId}&q=${encodeURIComponent("Bronze Ingot")}&limit=5`).then((response) => response.json());
  assert.equal(activitySearch.searchedAllHistory, true);
  assert.equal(activitySearch.total >= 1, true);
  assert.equal(activitySearch.events.some((event) => event.summary.includes("Bronze Ingot")), true);
  const aggregateHistory = await fetch(`${origin}/api/local/history?claimId=${claimId}`).then((response) => response.json());
  assert.equal(aggregateHistory.market.totals.confirmedSales, 1);
  assert.equal(aggregateHistory.activity.total >= aggregateHistory.activity.events.length, true);
  assert.equal("snapshots" in aggregateHistory, false);
  const dashboardHistory = await fetch(`${origin}/api/local/history?claimId=${claimId}&include=activity,dashboard&activityLimit=1`).then((response) => response.json());
  assert.equal(dashboardHistory.activity.events.length, 1);
  assert.equal(typeof dashboardHistory.dashboard.treasuryNetToday, "number");
  assert.equal(Array.isArray(dashboardHistory.dashboard.recentActivity), true);
  assert.equal("market" in dashboardHistory, false);
  assert.equal("snapshots" in dashboardHistory, false);
  const clampedHistory = await fetch(`${origin}/api/local/history?claimId=${claimId}&include=activity&activityLimit=-50`).then((response) => response.json());
  assert.equal(clampedHistory.activity.events.length, 1);
  const activityOnlyHistory = await fetch(`${origin}/api/local/history?claimId=${claimId}&include=activity`).then((response) => response.json());
  assert.equal("activity" in activityOnlyHistory, true);
  assert.equal("market" in activityOnlyHistory, false);
  assert.equal("snapshots" in activityOnlyHistory, false);
  assert.equal(activityOnlyHistory.activity.total >= activityOnlyHistory.activity.events.length, true);
  const marketHistory = await fetch(`${origin}/api/local/history?claimId=${claimId}&include=market,snapshots`).then((response) => response.json());
  assert.equal(marketHistory.market.totals.confirmedSales, 1);
  assert.equal("snapshots" in marketHistory, false);
  assert.equal("activity" in marketHistory, false);

  currentListings = [{ ...listings[0], quantity: 9 }, listings[1]];
  craftEntityRevision = 1;
  await seedCommittedRelayInputs();
  const secondPoll = await fetch(`${origin}/api/local/admin/poll`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: "{}",
  });
  assert.equal(secondPoll.status, 200);

  const history = await fetch(`${origin}/api/local/market/history?claimId=${claimId}&owner=Tester`).then((response) => response.json());
  const pageOneRequests = requestedPages.filter((page) => page === 1).length;
  const pageTwoRequests = requestedPages.filter((page) => page === 2).length;
  assert.equal(pageOneRequests, pageTwoRequests);
  assert.equal(history.liveListings.length, 2);
  assert.equal(history.totals.newListings ?? 0, 0);
  assert.equal(history.totals.confirmedSales, 1);
  assert.equal(history.totals.confirmedUnits, 5);
  assert.equal(history.totals.trackedValue, 50);
  assert.equal(history.sales.length, 1);
  assert.equal(history.topItems.some((item) => item.itemName === "Leather" && item.unitsSold === 5), true);
  assert.equal(history.events.some((event) => event.event_type === "partial_sale"), false);
  const secondActivity = await fetch(`${origin}/api/local/activity?claimId=${claimId}&limit=20`).then((response) => response.json());
  assert.equal(secondActivity.events.filter((event) => event.event_type === "storage").length, 1);
  assert.equal(secondActivity.events.filter((event) => event.event_type === "production_started").length, 0);

  currentListings = [{ ...listings[0], quantity: 8 }, listings[1]];
  craftEntityRevision = 2;
  craftOwnerUsername = "OtherTester";
  await seedCommittedRelayInputs();
  const thirdPoll = await fetch(`${origin}/api/local/admin/poll`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: "{}",
  });
  assert.equal(thirdPoll.status, 200);
  const afterOldFills = await fetch(`${origin}/api/local/market/history?claimId=${claimId}&owner=Tester`).then((response) => response.json());
  assert.equal(afterOldFills.totals.confirmedSales, 1);
  assert.equal(afterOldFills.totals.confirmedUnits, 5);
  assert.equal(afterOldFills.events.some((event) => event.event_type === "partial_quantity_drop"), false);
  const thirdActivity = await fetch(`${origin}/api/local/activity?claimId=${claimId}&limit=20`).then((response) => response.json());
  assert.equal(thirdActivity.events.filter((event) => event.event_type === "production_started").length, 0);
  assert.equal(thirdActivity.events.filter((event) => event.event_type === "production_started" && event.summary.includes("Public Output")).length, 0);

  const contributionLeaderboard = await fetch(`${origin}/api/local/leaderboard?claimId=${claimId}`).then((response) => response.json());
  assert.equal(contributionLeaderboard.summary.contributorCount, 1);
  assert.equal(contributionLeaderboard.summary.recordedCrafts, 3);
  assert.equal(contributionLeaderboard.summary.totalProgress, "78");
  assert.equal(contributionLeaderboard.contributors[0].name, "Tester");
  assert.equal(contributionLeaderboard.contributors[0].totalProgress, "78");
  assert.equal(contributionLeaderboard.contribution.summary.contributorCount, 1);
  assert.equal(contributionLeaderboard.contribution.contributors[0].totalProgress, "78");
  assert.equal(contributionLeaderboard.market.summary.activeListings, 2);
  assert.equal(contributionLeaderboard.market.summary.confirmedSales, 1);
  assert.equal(contributionLeaderboard.market.summary.confirmedSaleValue, 50);
  assert.equal(contributionLeaderboard.market.members[0].name, "Tester");
  assert.equal(contributionLeaderboard.market.members[0].activeListings, 2);
  assert.equal(contributionLeaderboard.market.members[0].confirmedSales, 1);
  assert.equal(contributionLeaderboard.activity.members.some((member) => member.name === "Tester" && member.storageEvents === 1), true);
  assert.equal(contributionLeaderboard.activity.members.some((member) => member.name === "Tester" && member.totalEvents > 0), true);
  assert.equal(contributionLeaderboard.activity.summary.ignoredRows > 0, true);
  const discordProductionAgeGateSettings = await fetch(`${origin}/api/local/admin/settings`, {
    method: "PUT",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({
      ...updatedConfig,
      discord: {
        ...updatedConfig.discord,
        productionMinXp: 0,
        productionMinAgeMinutes: 60,
      },
    }),
  });
  assert.equal(discordProductionAgeGateSettings.status, 200);
  currentListings = [{ ...listings[0], quantity: 8 }, listings[1]];
  craftEntityRevision = 3;
  craftOwnerUsername = "Tester";
  craftBuildingName = "Age Gate Station";
  await seedCommittedRelayInputs();
  const ageGatedPoll = await fetch(`${origin}/api/local/admin/poll`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: "{}",
  });
  assert.equal(ageGatedPoll.status, 200);
  const ageGatedActivity = await fetch(`${origin}/api/local/notification-activity?claimId=${claimId}&limit=20`).then((response) => response.json());
  assert.equal(ageGatedActivity.events.filter((event) => event.event_type === "production_started").length, 0);
  assert.equal(ageGatedActivity.events.some((event) => event.event_type === "production_started" && JSON.parse(event.metadata_json).raw?.entityId === "public-craft-3"), false);

  craftEntityRevision = 4;
  craftOwnerUsername = "Tester";
  craftBuildingName = "Collected Station";
  craftProgressOverride = 100;
  await seedCommittedRelayInputs();
  const completedOnArrivalPoll = await fetch(`${origin}/api/local/admin/poll`, {
    method: "POST",
    headers: { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: "{}",
  });
  assert.equal(completedOnArrivalPoll.status, 200);
  const completedOnArrivalActivity = await fetch(`${origin}/api/local/notification-activity?claimId=${claimId}&limit=30`).then((response) => response.json());
  assert.equal(completedOnArrivalActivity.events.filter((event) => event.event_type === "production_started").length, 0);
  assert.equal(completedOnArrivalActivity.events.some((event) => event.event_type === "production_started" && event.summary.includes("Collected Station")), false);
  craftProgressOverride = null;
  const confirmedSaleOccurredAt = new Date(Date.now() - 60_000).toISOString();
  await writeDatabaseWithRetry(path.join(dataDir, "bitcraft-local.sqlite"), (marketDb) => {
    const snapshot = JSON.parse(marketDb.prepare(
      "SELECT data_json FROM domain_payload_current WHERE claim_id = ? AND domain = 'regional-market'",
    ).get(claimId).data_json);
    snapshot.orders.push({
      entityId: "buy-cargo-43",
      claimEntityId: "4003",
      claimName: "Cargo Market",
      regionId: "19",
      regionName: "Zephra",
      ownerEntityId: "5006",
      ownerUsername: "Cargo Buyer",
      itemId: "43",
      itemType: 1,
      price: "25",
      priceThreshold: "25",
      quantity: "8",
      storedCoins: "200",
      timestamp: confirmedSaleOccurredAt,
      side: "buy",
    });
    marketDb.prepare(
      "UPDATE domain_payload_current SET data_json = ? WHERE claim_id = ? AND domain = 'regional-market'",
    ).run(JSON.stringify(snapshot), claimId);
    marketDb.prepare(`
      INSERT OR REPLACE INTO game_catalog_entities (
        catalog_key, kind, target_id, item_type, name, tag, tier, rarity,
        icon_asset_name, item_list_id, updated_at
      ) VALUES ('cargo:43', 'cargo', '43', 1, 'Leather', 'Leather Cargo', 2, 'Common',
        NULL, NULL, ?)
    `).run(confirmedSaleOccurredAt);
    const insertConfirmedSale = marketDb.prepare(`
      INSERT OR REPLACE INTO market_trades (
        trade_id, claim_id, region_id, order_entity_id, seller_entity_id,
        seller_username, purchaser_entity_id, purchaser_username, item_id,
        item_type, item_name, quantity, unit_price, total_price, tier, rarity,
        occurred_at, imported_at, raw_json
      ) VALUES (?, ?, ?, ?, 'seller-43', 'Cargo Seller', NULL, 'Cargo Buyer', '43',
        'cargo', 'Leather', '1', ?, ?, 2, 'Common', ?, ?, '{}')
    `);
    for (let sale = 1; sale <= 3; sale += 1) {
      insertConfirmedSale.run(
        `relay_closed_listing:19:cargo-43-sale-${sale}`,
        claimId,
        "19",
        `cargo-43-order-${sale}`,
        "20",
        "20",
        confirmedSaleOccurredAt,
        confirmedSaleOccurredAt,
      );
    }
    insertConfirmedSale.run(
      "relay_closed_listing:9:cargo-43-sale-noise",
      claimId,
      "9",
      "cargo-43-order-noise",
      "999",
      "999",
      confirmedSaleOccurredAt,
      confirmedSaleOccurredAt,
    );
  });
  const buyOrdersAfterSales = await fetch(`${origin}/api/local/market/buy-orders?claimId=${claimId}&regionId=19&search=Leather&pageSize=25&sort=premium&direction=desc`).then((response) => response.json());
  assert.equal(buyOrdersAfterSales.rows[0].salesCount, 3);
  assert.equal(buyOrdersAfterSales.rows[0].itemType, "cargo");
  assert.equal(buyOrdersAfterSales.rows[0].averageUnitPrice, "20");
  assert.equal(buyOrdersAfterSales.rows[0].premiumPercent, "25");
  assert.equal(buyOrdersAfterSales.rows[0].opportunityEligible, true);
  assert.deepEqual(
    buyOrdersAfterSales.opportunities.map((row) => row.orderKey),
    [buyOrdersAfterSales.rows[0].orderKey],
  );
  assert.equal(buyOrdersAfterSales.baselineWindowDays, 7);
  assert.equal(buyOrdersAfterSales.minimumSales, 3);
  const paddedRegionBuyOrders = await fetch(
    `${origin}/api/local/market/buy-orders?claimId=${claimId}&regionId=%2019%20&search=Leather&pageSize=25&sort=premium&direction=desc`,
  ).then((response) => response.json());
  assert.equal(paddedRegionBuyOrders.rows[0].salesCount, 3);
  assert.equal(paddedRegionBuyOrders.rows[0].averageUnitPrice, "20");
  assert.equal(paddedRegionBuyOrders.rows[0].premiumPercent, "25");
  assert.equal(paddedRegionBuyOrders.rows[0].opportunityEligible, true);

  await writeDatabaseWithRetry(
    path.join(dataDir, "bitcraft-local.sqlite"),
    (marketDb) => marketDb.exec(
      "ALTER TABLE market_trades RENAME TO market_trades_unavailable_for_test",
    ),
  );
  try {
    const buyOrdersWithoutHistory = await fetch(
      `${origin}/api/local/market/buy-orders?claimId=${claimId}&regionId=19&search=Leather&pageSize=25`,
    ).then((response) => response.json());
    const cargoOrderWithoutHistory = buyOrdersWithoutHistory.rows.find(
      (row) => row.orderKey === "buy-cargo-43",
    );
    assert.equal(cargoOrderWithoutHistory?.unitPrice, "25");
    assert.equal(buyOrdersWithoutHistory.freshness, buyOrdersAfterSales.freshness);
    assert.match(
      buyOrdersWithoutHistory.warnings.join(" "),
      /confirmed-sale history is temporarily unavailable/i,
    );
    assert.equal(
      new Set(buyOrdersWithoutHistory.warnings).size,
      buyOrdersWithoutHistory.warnings.length,
    );
  } finally {
    await writeDatabaseWithRetry(
      path.join(dataDir, "bitcraft-local.sqlite"),
      (marketDb) => marketDb.exec(
        "ALTER TABLE market_trades_unavailable_for_test RENAME TO market_trades",
      ),
    );
  }

  const browserSnapshot = await fetch(`${origin}/api/local/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ claimId, claim: {}, market: { listings: [] } }),
  });
  assert.equal(browserSnapshot.status, 404);

  const forgedSettings = await fetch(`${origin}/api/local/admin/settings`, {
    method: "PUT",
    headers: { cookie, origin: "https://attacker.example", "content-type": "application/json", "x-csrf-token": auth.csrfToken },
    body: JSON.stringify({}),
  });
  assert.equal(forgedSettings.status, 403);

  let rateLimited = null;
  for (let index = 0; index < 35; index += 1) {
    const response = await fetch(`${origin}/api/local/auth/discord/start?returnTo=%2F`, { redirect: "manual" });
    if (response.status === 429) {
      rateLimited = response;
      break;
    }
  }
  assert.equal(rateLimited?.status, 429);
  assert.ok(Number(rateLimited.headers.get("retry-after")) > 0);
});

test("background polling failures keep the server online", async (t) => {
  const upstream = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === `/api/claims/${claimId}`) return json(res, { error: "upstream unavailable" }, 500);
    return json(res, { claims: [], members: [], citizens: [], buildings: [], projects: [], research: [], listings: [] });
  });
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise((resolve) => upstream.close(resolve)));

  const appPort = await availablePort();
  const dataDir = path.join(appDir, `.test-data-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LEGAL_CONFIGURATION_CONFIRMED: "true",
      BITCRAFT_TEST: "true",
      ENABLE_LEGACY_ADMIN_PASSWORD_AUTH: "true",
      ENABLE_SERVER_POLLING: "true",
      BITCRAFT_PROCESS_ROLE: "all",
      ENABLE_SCHEDULED_JOBS: "false",
      ADMIN_SETUP_KEY: "test-setup-key",
      APP_HOST: "127.0.0.1",
      APP_PORT: String(appPort),
      BITCRAFT_LOCAL_DATA_DIR: dataDir,
      EMPIRE_SCOUT_CACHE_TTL_MS: "100",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    await stop(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const origin = `http://127.0.0.1:${appPort}`;
  await waitForHealth(origin, child);
  const unavailableGameData = await fetch(`${origin}/api/local/game-data?claimId=${claimId}&domains=claim,members`);
  assert.equal(unavailableGameData.status, 503);
  const fallbackDb = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { timeout: 5000 });
  const fallbackCollectedAt = "2026-06-30T09:00:00.000Z";
  const fallbackPayload = fallbackDb.prepare(`
    INSERT INTO domain_payload_current (
      claim_id, domain, data_json, collected_at, last_attempt_at, last_success_at,
      last_error, updated_at, provider, source_key, region_id, database_name,
      schema_fingerprint, source_observed_at, received_at, freshness, confidence,
      generation, warnings_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'relay', 'relay-cache', '19', NULL, NULL, ?, ?, 'stale', 'joined', 1, '[]')
  `);
  const insertFallbackPayload = (domain, payload) => fallbackPayload.run(
    claimId,
    domain,
    JSON.stringify(payload),
    fallbackCollectedAt,
    fallbackCollectedAt,
    fallbackCollectedAt,
    null,
    fallbackCollectedAt,
    fallbackCollectedAt,
    fallbackCollectedAt,
  );
  insertFallbackPayload("claim", { entityId: claimId, supplies: 111, treasury: 222, regionName: "Cached Region" });
  insertFallbackPayload("members", [{ playerEntityId: "player-1", userName: "Cached Tester" }]);
  insertFallbackPayload("construction", { buildings: [{ entityId: "building-1" }] });
  insertFallbackPayload("inventories", {
    claim: { entityId: claimId, regionId: "19" },
    dimensions: [],
    buildings: [{ entityId: "100", name: "Shared Chest", inventory: [] }],
  });
  insertFallbackPayload("inventory-banks", {
    buildings: [{ entityId: "8001", name: "Town Bank — Cached Tester", inventory: [] }],
  });
  fallbackDb.close();
  const lastGoodGameDataResponse = await fetch(`${origin}/api/local/game-data?claimId=${claimId}&domains=claim,members`);
  assert.equal(lastGoodGameDataResponse.status, 200);
  const lastGoodGameData = await lastGoodGameDataResponse.json();
  assert.equal(lastGoodGameData.domains.claim.freshness, "stale");
  assert.equal(lastGoodGameData.domains.members.data[0].userName, "Cached Tester");
  const lastGoodInventoryResponse = await fetch(`${origin}/api/local/game-data?claimId=${claimId}&domains=inventories`);
  assert.equal(lastGoodInventoryResponse.status, 200);
  const lastGoodInventory = await lastGoodInventoryResponse.json();
  assert.deepEqual(
    lastGoodInventory.domains.inventories.data.buildings.map(({ name }) => name),
    ["Shared Chest", "Town Bank — Cached Tester"],
  );
  assert.equal((await fetch(`${origin}/api/local/game-data?claimId=99999999&domains=claim`)).status, 403);
  const fallbackDashboardResponse = await fetch(`${origin}/api/local/dashboard-data?claimId=${claimId}`);
  assert.equal(fallbackDashboardResponse.status, 404);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(child.exitCode, null);
  const health = await fetch(`${origin}/api/local/collector-status`).then((response) => response.json());
  assert.equal(health.enabled, true);
  assert.match(String(health.lastError ?? ""), /Relay (claim|crafts|members) input is unavailable/);
});


test("retired recipe catalog refresh route, scheduler key, and tables are absent", async (t) => {
  const appPort = await availablePort();
  const dataDir = path.join(appDir, `.test-data-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      LEGAL_CONFIGURATION_CONFIRMED: "true",
      BITCRAFT_TEST: "true",
      ENABLE_LEGACY_ADMIN_PASSWORD_AUTH: "true",
      ENABLE_SERVER_POLLING: "false",
      ENABLE_SCHEDULED_JOBS: "false",
      BITCRAFT_PROCESS_ROLE: "all",
      ADMIN_SETUP_KEY: "test-setup-key",
      APP_HOST: "127.0.0.1",
      APP_PORT: String(appPort),
      BITCRAFT_LOCAL_DATA_DIR: dataDir,
    },
    stdio: "ignore",
  });
  t.after(async () => {
    await stop(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  const origin = `http://127.0.0.1:${appPort}`;
  await waitForHealth(origin, child);
  const auth = await createTestAdminSession(path.join(dataDir, "bitcraft-local.sqlite"), { username: "admin", role: "owner" });
  const cookie = auth.cookie;
  const headers = { cookie, origin, "content-type": "application/json", "x-csrf-token": auth.csrfToken };

  assert.equal((await fetch(`${origin}/api/local/admin/craft-plan/catalog-refresh`, { headers })).status, 404);
  assert.equal((await fetch(`${origin}/api/local/admin/craft-plan/catalog-refresh`, { method: "POST", headers, body: "{}" })).status, 404);
  const jobs = await fetch(`${origin}/api/local/admin/jobs`, { headers }).then((response) => response.json());
  assert.equal(jobs.jobs.some((job) => job.key === "recipe_catalog_refresh"), false);

  const database = new DatabaseSync(path.join(dataDir, "bitcraft-local.sqlite"), { readOnly: true });
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  database.close();
  assert.equal(tables.has("recipe_catalog_entries"), false);
  assert.equal(tables.has("game_catalog_refresh_runs"), false);
  assert.equal(tables.has("game_catalog_refresh_targets"), false);
});

test("regional market retirement cleanup runs after the older collector marker", async (t) => {
  const dataDir = path.join(appDir, `.test-data-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  let child = null;
  const start = async () => {
    const appPort = await availablePort();
    child = spawn(process.execPath, ["server.mjs"], {
      cwd: appDir,
      env: {
        ...process.env,
        NODE_ENV: "production",
        LEGAL_CONFIGURATION_CONFIRMED: "true",
        BITCRAFT_TEST: "true",
        ENABLE_SERVER_POLLING: "false",
        ENABLE_SCHEDULED_JOBS: "false",
        BITCRAFT_PROCESS_ROLE: "all",
        APP_HOST: "127.0.0.1",
        APP_PORT: String(appPort),
        BITCRAFT_LOCAL_DATA_DIR: dataDir,
      },
      stdio: "ignore",
    });
    await waitForHealth(`http://127.0.0.1:${appPort}`, child);
  };
  t.after(async () => {
    if (child) await stop(child);
    await rm(dataDir, { recursive: true, force: true });
  });

  await start();
  await stop(child);
  child = null;
  const databasePath = path.join(dataDir, "bitcraft-local.sqlite");
  const oldDatabase = new DatabaseSync(databasePath);
  const now = new Date().toISOString();
  oldDatabase.prepare(`
    INSERT OR REPLACE INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(
    "collector_settings_json",
    JSON.stringify({
      market: { enabled: true, intervalSeconds: 60 },
      buyOrders: { enabled: false, intervalSeconds: 3600 },
    }),
    now,
  );
  oldDatabase.prepare(`
    INSERT OR REPLACE INTO app_settings (key, value, updated_at)
    VALUES ('regional_buy_order_collector_retired_at', ?, ?)
  `).run(now, now);
  oldDatabase.close();

  await start();
  const migratedDatabase = new DatabaseSync(databasePath, { readOnly: true });
  const collectorSettingsCount = migratedDatabase.prepare(
    "SELECT COUNT(*) AS count FROM app_settings WHERE key = 'collector_settings_json'",
  ).get().count;
  const markerCount = migratedDatabase.prepare(`
    SELECT COUNT(*) AS count
    FROM app_settings
    WHERE key IN ('regional_buy_order_collector_retired_at', 'regional_buy_order_state_retired_at')
  `).get().count;
  migratedDatabase.close();
  assert.equal(collectorSettingsCount, 0);
  assert.equal(markerCount, 0);
});
