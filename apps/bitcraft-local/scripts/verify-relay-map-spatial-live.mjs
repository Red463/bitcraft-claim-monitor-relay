import { readFile } from "node:fs/promises";

import {
  discoverRelayTopology,
  relayWebSocketUri,
} from "../dist-server/game-data/index.js";
import { summarizeMapPlayerEvidence } from "./map-player-live-evidence.mjs";
import { collectMapLiveEvidence } from "./map-spatial-live-evidence.mjs";

const relayBaseUrl = String(process.env.BITCRAFT_RELAY_ORIGIN ?? "https://relay.bitcraftsync.app").replace(/\/+$/, "");
const claimId = String(process.env.BITCRAFT_CLAIM_ID ?? "1369094286777412590");
const regionId = String(process.env.BITCRAFT_REGION_ID ?? "19");
const playerIds = String(process.env.BITCRAFT_MAP_PLAYER_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const resourceIds = String(process.env.BITCRAFT_MAP_RESOURCE_IDS ?? "54").split(",").map((value) => value.trim()).filter(Boolean);
const enemyTypes = String(process.env.BITCRAFT_MAP_ENEMY_TYPES ?? "").split(",").map((value) => value.trim()).filter(Boolean);
const timeoutMs = Math.max(5_000, Number(process.env.RELAY_MAP_VERIFY_TIMEOUT_MS ?? 60_000));
const manifest = JSON.parse(await readFile(new URL("../src/server/game-data/bindings/schema-manifest.json", import.meta.url), "utf8"));
const topology = await discoverRelayTopology(relayBaseUrl);
const source = topology.regions.get(regionId);
if (!source?.ready || !source.schemaFingerprint) throw new Error(`Relay region ${regionId} source is not ready`);

function coordinateBounds(rows, xKey = "locationX", zKey = "locationZ") {
  if (!rows.length) return null;
  const x = rows.map((row) => row[xKey]);
  const z = rows.map((row) => row[zKey]);
  return { minX: Math.min(...x), minZ: Math.min(...z), maxX: Math.max(...x), maxZ: Math.max(...z) };
}

const startedAt = Date.now();
const snapshot = await collectMapLiveEvidence({
  uri: relayWebSocketUri(relayBaseUrl, source.port),
  database: source.database,
  schemaFingerprint: source.schemaFingerprint,
  manifest,
  generation: 1,
  scope: { claimId, regionId, playerIds, resourceIds, enemyTypes },
}, { timeoutMs });
const normalizedBytes = Buffer.byteLength(JSON.stringify(snapshot.data));
const resourceFixtures = snapshot.data.resources
  .toSorted((left, right) => left.entityId.length - right.entityId.length || left.entityId.localeCompare(right.entityId))
  .slice(0, 3)
  .map(({ entityId, resourceId, locationX, locationZ, dimension }) => ({ entityId, resourceId, locationX, locationZ, dimension }));
const playerEvidence = summarizeMapPlayerEvidence({ requestedPlayerIds: playerIds, players: snapshot.data.players });
console.log(JSON.stringify({
  ok: true,
  claimId,
  regionId,
  schemaFingerprint: source.schemaFingerprint,
  elapsedMs: Date.now() - startedAt,
  normalizedBytes,
  counts: Object.fromEntries(Object.entries(snapshot.data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])),
  resourceBounds: coordinateBounds(snapshot.data.resources),
  resourceFixtures,
  playerEvidence,
  warnings: snapshot.warnings,
}, null, 2));
