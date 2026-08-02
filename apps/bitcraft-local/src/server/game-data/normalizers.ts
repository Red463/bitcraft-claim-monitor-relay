import type { ItemKind } from "./contracts.ts";

type WireRecord = Record<string, unknown>;
type TimestampUnit = "seconds" | "milliseconds" | "microseconds";
export type CatalogDescriptionKind =
  | "crafting_recipe"
  | "extraction_recipe"
  | "item_list"
  | "construction_recipe"
  | "building"
  | "building_type"
  | "skill"
  | "resource"
  | "enemy"
  | "equipment"
  | "tool"
  | "buff"
  | "claim_tech";

function record(value: unknown, label: string): WireRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as WireRecord;
}

function decimalString(value: unknown, label: string): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new TypeError(`${label} must be a non-negative decimal integer string.`);
}

function optionalDecimalString(value: unknown, label: string): string | undefined {
  return value == null ? undefined : decimalString(value, label);
}

function finiteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be finite.`);
  return parsed;
}

export function normalizeTimestamp(value: string | number | bigint, unit: TimestampUnit): string {
  let milliseconds: bigint;
  try {
    const integer = typeof value === "bigint" ? value : BigInt(value);
    milliseconds = unit === "seconds" ? integer * 1000n
      : unit === "microseconds" ? integer / 1000n
      : integer;
  } catch {
    throw new TypeError(`Invalid ${unit} timestamp.`);
  }
  const numeric = Number(milliseconds);
  if (!Number.isSafeInteger(numeric) || numeric < 946684800000 || numeric > 4102444800000) {
    throw new RangeError(`${unit} timestamp is outside the supported date range.`);
  }
  return new Date(numeric).toISOString();
}

export function normalizeItemKind(value: unknown): ItemKind {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "item") return "item";
  if (normalized === "cargo") return "cargo";
  throw new TypeError(`Unsupported item kind: ${String(value)}`);
}

function enumLabel(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const tag = String((value as WireRecord).tag ?? "").trim();
    return tag || undefined;
  }
  return undefined;
}

function integer(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${label} must be an integer.`);
  return parsed;
}

function records(value: unknown): WireRecord[] {
  return Array.isArray(value)
    ? value.map((entry, index) => record(entry, `array entry ${index}`))
    : [];
}

export function normalizeGlobalRegions(
  populationValues: unknown[],
  controlValues: unknown[],
  nameValues: unknown[],
) {
  const populations = new Map(records(populationValues).map((row) => {
    const regionId = decimalString(row.regionId ?? row.region_id, "region population id");
    return [regionId, {
      signedInPlayers: integer(
        row.signedInPlayers ?? row.signed_in_players ?? 0,
        `region ${regionId} signed-in players`,
      ),
      playersInQueue: integer(
        row.playersInQueue ?? row.players_in_queue ?? 0,
        `region ${regionId} queued players`,
      ),
    }] as const;
  }));
  const controls = new Map(records(controlValues).map((row) => {
    const regionId = decimalString(row.regionId ?? row.region_id, "region control id");
    return [regionId, {
      initialized: row.initialized === true,
      allowPlayers: row.allowPlayers === true || row.allow_players === true,
      allowPlayerSpawns: row.allowPlayerSpawns === true || row.allow_player_spawns === true,
    }] as const;
  }));
  const names = new Map(records(nameValues).map((row) => {
    const regionId = decimalString(row.id, "region name id");
    return [regionId, String(row.playerFacingName ?? row.player_facing_name ?? "").trim()] as const;
  }));
  const regionIds = [...new Set([
    ...populations.keys(),
    ...controls.keys(),
    ...names.keys(),
  ])].sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0));
  return regionIds.map((regionId) => {
    const population = populations.get(regionId);
    const control = controls.get(regionId);
    return {
      regionId,
      regionName: names.get(regionId) || `Region ${regionId}`,
      active: control ? control.initialized && control.allowPlayers : null,
      syncing: control ? !control.initialized : null,
      allowPlayerSpawns: control?.allowPlayerSpawns ?? null,
      signedInPlayers: population?.signedInPlayers ?? null,
      playersInQueue: population?.playersInQueue ?? null,
    };
  });
}

export function normalizeGlobalEmpireFoundries(values: unknown[]) {
  const data = [];
  const warnings: string[] = [];
  for (const [index, value] of values.entries()) {
    try {
      const row = record(value, `global Empire Foundry ${index}`);
      const hexiteCapsules = integer(
        row.hexiteCapsules ?? row.hexite_capsules,
        `global Empire Foundry ${index} completed Capsules`,
      );
      const queued = integer(
        row.queued,
        `global Empire Foundry ${index} queued Capsules`,
      );
      if (hexiteCapsules < 0) {
        throw new TypeError(
          `global Empire Foundry ${index} completed Capsules must be non-negative.`,
        );
      }
      if (queued < 0) {
        throw new TypeError(
          `global Empire Foundry ${index} queued Capsules must be non-negative.`,
        );
      }
      const timestamp = record(row.started, `global Empire Foundry ${index} started timestamp`);
      const startedMicros = decimalString(
        timestamp.__timestamp_micros_since_unix_epoch__
          ?? timestamp.microsSinceUnixEpoch
          ?? timestamp.micros_since_unix_epoch,
        `global Empire Foundry ${index} started timestamp`,
      );
      const startedAt = BigInt(startedMicros) === 0n
        ? null
        : normalizeTimestamp(startedMicros, "microseconds");
      data.push({
        entityId: decimalString(
          row.entityId ?? row.entity_id,
          `global Empire Foundry ${index} entity id`,
        ),
        empireEntityId: decimalString(
          row.empireEntityId ?? row.empire_entity_id,
          `global Empire Foundry ${index} Empire id`,
        ),
        hexiteCapsules: String(hexiteCapsules),
        queued: String(queued),
        startedAt,
      });
    } catch (error) {
      warnings.push(
        `Global empire_foundry_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { data, warnings };
}

const HEXITE_ENERGY_ITEM_ID = "828972621";
const HEXITE_CAPSULE_CARGO_ID = "2000000";
const HEXITE_RESERVE_BUILDING_DESCRIPTION_ID = 90001;

export function normalizeRegionalEmpireHexite(options: {
  regionId: string;
  playerRows: unknown[];
  settlements: unknown[];
  buildingRows: unknown[];
  inventoryRows: unknown[];
}) {
  const regionId = decimalString(options.regionId, "regional Empire Hexite region id");
  const warnings: string[] = [];
  const claimEmpire = new Map<string, string>();
  for (const [index, value] of options.settlements.entries()) {
    const settlement = record(value, `regional Empire Hexite settlement ${index}`);
    claimEmpire.set(
      decimalString(
        settlement.claimEntityId ?? settlement.claim_entity_id,
        `regional Empire Hexite settlement ${index} claim id`,
      ),
      decimalString(
        settlement.empireEntityId ?? settlement.empire_entity_id,
        `regional Empire Hexite settlement ${index} Empire id`,
      ),
    );
  }
  const localEmpireIds = new Set(claimEmpire.values());
  const playerEmpire = new Map<string, string>();
  for (const [index, value] of options.playerRows.entries()) {
    const player = record(value, `regional Empire Hexite player ${index}`);
    const empireEntityId = decimalString(
      player.empireEntityId ?? player.empire_entity_id,
      `regional Empire Hexite player ${index} Empire id`,
    );
    if (!localEmpireIds.has(empireEntityId)) continue;
    playerEmpire.set(
      decimalString(
        player.entityId ?? player.entity_id,
        `regional Empire Hexite player ${index} entity id`,
      ),
      empireEntityId,
    );
  }
  const buildingClaim = new Map<string, string>();
  const reserveBuildingIds = new Set<string>();
  for (const [index, value] of options.buildingRows.entries()) {
    const building = record(value, `regional Empire Hexite building ${index}`);
    const claimEntityId = decimalString(
      building.claimEntityId ?? building.claim_entity_id,
      `regional Empire Hexite building ${index} claim id`,
    );
    if (!claimEmpire.has(claimEntityId)) continue;
    const entityId = decimalString(
      building.entityId ?? building.entity_id,
      `regional Empire Hexite building ${index} entity id`,
    );
    buildingClaim.set(entityId, claimEntityId);
    const buildingDescriptionId = integer(
      building.buildingDescriptionId ?? building.building_description_id,
      `regional Empire Hexite building ${index} description id`,
    );
    if (buildingDescriptionId === HEXITE_RESERVE_BUILDING_DESCRIPTION_ID) {
      reserveBuildingIds.add(entityId);
    }
  }
  const inventories = [];
  const seenInventoryIds = new Set<string>();
  for (const [index, value] of options.inventoryRows.entries()) {
    try {
      const inventory = record(value, `regional Empire Hexite inventory ${index}`);
      const entityId = decimalString(
        inventory.entityId ?? inventory.entity_id,
        `regional Empire Hexite inventory ${index} entity id`,
      );
      if (seenInventoryIds.has(entityId)) continue;
      const ownerEntityId = decimalString(
        inventory.ownerEntityId ?? inventory.owner_entity_id,
        `regional Empire Hexite inventory ${index} owner id`,
      );
      const playerOwnerEntityId = decimalString(
        inventory.playerOwnerEntityId ?? inventory.player_owner_entity_id,
        `regional Empire Hexite inventory ${index} player owner id`,
      );
      const playerEmpireEntityId = playerEmpire.get(playerOwnerEntityId);
      const ownerClaimEntityId = buildingClaim.get(ownerEntityId);
      const claimEmpireEntityId = ownerClaimEntityId == null
        ? undefined
        : claimEmpire.get(ownerClaimEntityId);
      const empireEntityId = playerEmpireEntityId ?? claimEmpireEntityId;
      if (!empireEntityId) continue;
      let energy = 0n;
      let capsules = 0n;
      for (const [pocketIndex, pocketValue] of records(inventory.pockets).entries()) {
        if (pocketValue.contents == null) continue;
        const contents = record(
          pocketValue.contents,
          `regional Empire Hexite inventory ${index} pocket ${pocketIndex} contents`,
        );
        const quantity = integer(
          contents.quantity,
          `regional Empire Hexite inventory ${index} pocket ${pocketIndex} quantity`,
        );
        if (quantity < 0) {
          throw new TypeError(
            `regional Empire Hexite inventory ${index} pocket ${pocketIndex} quantity must be non-negative.`,
          );
        }
        const itemId = decimalString(
          contents.itemId ?? contents.item_id,
          `regional Empire Hexite inventory ${index} pocket ${pocketIndex} item id`,
        );
        const kind = normalizeItemKind(enumLabel(contents.itemType ?? contents.item_type));
        if (kind === "item" && itemId === HEXITE_ENERGY_ITEM_ID) {
          energy += BigInt(quantity);
        }
        if (kind === "cargo" && itemId === HEXITE_CAPSULE_CARGO_ID) {
          capsules += BigInt(quantity);
        }
      }
      seenInventoryIds.add(entityId);
      if (energy === 0n && capsules === 0n) continue;
      inventories.push({
        entityId,
        empireEntityId,
        regionId,
        sourceType: playerEmpireEntityId ? "player" as const : "claim" as const,
        energy: energy.toString(),
        capsules: capsules.toString(),
        reserveBuilding: reserveBuildingIds.has(ownerEntityId),
      });
    } catch (error) {
      warnings.push(
        `Regional Empire Hexite omitted inventory ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const coverage = [...localEmpireIds].map((empireEntityId) => ({
    empireEntityId,
    regionId,
    playerCount: [...playerEmpire.values()]
      .filter((candidate) => candidate === empireEntityId)
      .length,
    claimCount: [...claimEmpire.values()]
      .filter((candidate) => candidate === empireEntityId)
      .length,
  }));
  const order = (left: string, right: string) => (
    BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0
  );
  inventories.sort((left, right) => (
    order(left.empireEntityId, right.empireEntityId)
    || order(left.entityId, right.entityId)
  ));
  coverage.sort((left, right) => order(left.empireEntityId, right.empireEntityId));
  return { data: { inventories, coverage }, warnings };
}

export function normalizeRegionalClaims(options: {
  regionId: string;
  claimRows: unknown[];
  localRows: unknown[];
  claimTypeRows: unknown[];
  usernameRows: unknown[];
}) {
  const regionId = decimalString(options.regionId, "regional claims region id");
  const warnings: string[] = [];
  const localById = new Map<string, WireRecord>();
  const tierByBuildingId = new Map<string, number>();
  const usernameById = new Map<string, string>();

  for (const [index, value] of options.localRows.entries()) {
    try {
      const row = record(value, `Regional claim_local_state row ${index}`);
      localById.set(
        decimalString(row.entityId ?? row.entity_id, `Regional claim_local_state row ${index} entity id`),
        row,
      );
    } catch (error) {
      throw error;
    }
  }
  for (const [index, value] of options.claimTypeRows.entries()) {
    try {
      const row = record(value, `Regional building_claim_desc row ${index}`);
      const buildingId = decimalString(
        row.buildingId ?? row.building_id,
        `Regional building_claim_desc row ${index} building id`,
      );
      tierByBuildingId.set(buildingId, integer(row.tier, `Regional building_claim_desc ${buildingId} tier`));
    } catch (error) {
      throw error;
    }
  }
  for (const [index, value] of options.usernameRows.entries()) {
    try {
      const row = record(value, `Regional player_username_state row ${index}`);
      usernameById.set(
        decimalString(row.entityId ?? row.entity_id, `Regional player_username_state row ${index} entity id`),
        String(row.username ?? "").trim(),
      );
    } catch (error) {
      warnings.push(`Regional player_username_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const claims: Array<Record<string, unknown>> = [];
  let missingOwnerUsernameCount = 0;
  for (const [index, value] of options.claimRows.entries()) {
    try {
      const row = record(value, `Regional claim_state row ${index}`);
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `Regional claim_state row ${index} entity id`,
      );
      const ownerPlayerEntityId = decimalString(
        row.ownerPlayerEntityId ?? row.owner_player_entity_id,
        `Regional claim ${entityId} owner id`,
      );
      const ownerBuildingEntityId = decimalString(
        row.ownerBuildingEntityId ?? row.owner_building_entity_id,
        `Regional claim ${entityId} owner building id`,
      );
      const local = localById.get(entityId);
      if (!local) warnings.push(`Regional claim ${entityId} has no claim_local_state row.`);
      const ownerPlayerUsername = usernameById.get(ownerPlayerEntityId) || null;
      if (!ownerPlayerUsername) {
        missingOwnerUsernameCount += 1;
      }
      const buildingDescriptionId = local
        ? decimalString(
            local.buildingDescriptionId ?? local.building_description_id,
            `Regional claim ${entityId} building description id`,
          )
        : null;
      const location = local?.location == null
        ? null
        : record(local.location, `Regional claim ${entityId} location`);
      claims.push({
        entityId,
        ownerPlayerEntityId,
        ownerBuildingEntityId,
        ownerPlayerUsername,
        name: String(row.name ?? "").trim(),
        neutral: row.neutral === true,
        supplies: local ? integer(local.supplies, `Regional claim ${entityId} supplies`) : null,
        treasury: local
          ? decimalString(local.treasury, `Regional claim ${entityId} treasury`)
          : null,
        numTiles: local
          ? integer(local.numTiles ?? local.num_tiles, `Regional claim ${entityId} tile count`)
          : null,
        tier: buildingDescriptionId ? tierByBuildingId.get(buildingDescriptionId) ?? null : null,
        locationX: location ? integer(location.x, `Regional claim ${entityId} location x`) : null,
        locationZ: location ? integer(location.z, `Regional claim ${entityId} location z`) : null,
        locationDimension: location
          ? decimalString(location.dimension, `Regional claim ${entityId} location dimension`)
          : null,
      });
    } catch (error) {
      throw error;
    }
  }
  if (missingOwnerUsernameCount > 0) {
    warnings.push(`Regional claims missing owner usernames: ${missingOwnerUsernameCount}.`);
  }
  claims.sort((left, right) => (
    BigInt(String(left.entityId)) < BigInt(String(right.entityId)) ? -1 : 1
  ));
  return { data: { regionId, claims }, warnings };
}

function regionalEmpireSpatialRows(options: {
  regionId: string;
  worldRegionRows: unknown[];
  settlementRows: unknown[];
  nodeRows: unknown[];
}) {
  const regionId = decimalString(options.regionId, "regional empires region id");
  if (options.worldRegionRows.length !== 1) {
    throw new TypeError(
      `Regional empires require exactly one world_region_state row; received ${options.worldRegionRows.length}`,
    );
  }
  const worldRegion = record(options.worldRegionRows[0], "Regional world_region_state");
  const regionIndex = integer(
    worldRegion.regionIndex ?? worldRegion.region_index,
    "Regional world_region_state region index",
  );
  if (String(regionIndex) !== regionId) {
    throw new TypeError(
      `Regional world_region_state index ${regionIndex} does not match configured region ${regionId}`,
    );
  }
  const regionMinChunkX = integer(
    worldRegion.regionMinChunkX ?? worldRegion.region_min_chunk_x,
    "Regional world_region_state minimum chunk x",
  );
  const regionMinChunkZ = integer(
    worldRegion.regionMinChunkZ ?? worldRegion.region_min_chunk_z,
    "Regional world_region_state minimum chunk z",
  );
  const regionWidthChunks = integer(
    worldRegion.regionWidthChunks ?? worldRegion.region_width_chunks,
    "Regional world_region_state width",
  );
  const regionHeightChunks = integer(
    worldRegion.regionHeightChunks ?? worldRegion.region_height_chunks,
    "Regional world_region_state height",
  );
  if (
    regionMinChunkX < 0
    || regionMinChunkZ < 0
    || regionWidthChunks <= 0
    || regionHeightChunks <= 0
  ) {
    throw new TypeError("Regional world_region_state bounds must be non-negative and non-empty");
  }
  const chunkInRegion = (value: unknown, label: string) => {
    const chunkIndex = BigInt(decimalString(value, label));
    const chunkX = Number(chunkIndex % 1_000n);
    const chunkZ = Number(chunkIndex / 1_000n);
    return (
      chunkX >= regionMinChunkX
      && chunkX < regionMinChunkX + regionWidthChunks
      && chunkZ >= regionMinChunkZ
      && chunkZ < regionMinChunkZ + regionHeightChunks
    );
  };
  const localSettlementRows = options.settlementRows.filter((value, index) => {
    const row = record(value, `Regional empire_settlement_state row ${index}`);
    return chunkInRegion(
      row.chunkIndex ?? row.chunk_index,
      `Regional empire settlement row ${index} chunk index`,
    );
  });
  const localNodeRows = options.nodeRows.filter((value, index) => {
    const row = record(value, `Regional empire_node_state row ${index}`);
    return chunkInRegion(
      row.chunkIndex ?? row.chunk_index,
      `Regional empire node row ${index} chunk index`,
    );
  });
  return { regionId, chunkInRegion, localSettlementRows, localNodeRows };
}

export function regionalEmpireDetailIds(options: {
  regionId: string;
  worldRegionRows: unknown[];
  settlementRows: unknown[];
  nodeRows: unknown[];
}) {
  const { localSettlementRows, localNodeRows } = regionalEmpireSpatialRows(options);
  const claimIds = localSettlementRows.map((value, index) => {
    const row = record(value, `Regional local empire_settlement_state row ${index}`);
    return decimalString(
      row.claimEntityId ?? row.claim_entity_id,
      `Regional local empire settlement row ${index} claim id`,
    );
  });
  const buildingIds = [
    ...localSettlementRows.map((value, index) => {
      const row = record(value, `Regional local empire_settlement_state row ${index}`);
      return decimalString(
        row.buildingEntityId ?? row.building_entity_id,
        `Regional local empire settlement row ${index} building id`,
      );
    }),
    ...localNodeRows.map((value, index) => {
      const row = record(value, `Regional local empire_node_state row ${index}`);
      return decimalString(
        row.entityId ?? row.entity_id,
        `Regional local empire node row ${index} entity id`,
      );
    }),
  ];
  return {
    claimIds: [...new Set(claimIds)],
    buildingIds: [...new Set(buildingIds)],
  };
}

export function normalizeRegionalEmpires(options: {
  regionId: string;
  worldRegionRows: unknown[];
  empireRows: unknown[];
  playerRows: unknown[];
  playerStateRows: unknown[];
  rankRows: unknown[];
  settlementRows: unknown[];
  nodeRows: unknown[];
  siegeRows: unknown[];
  chunkRows: unknown[];
  claimRows: unknown[];
  claimMemberRows: unknown[];
  usernameRows: unknown[];
  nicknameRows: unknown[];
}) {
  const {
    regionId,
    chunkInRegion,
    localSettlementRows,
    localNodeRows,
  } = regionalEmpireSpatialRows(options);
  const warnings: string[] = [];
  const localNodeIds = new Set(localNodeRows.map((value, index) => {
    const row = record(value, `Regional local empire_node_state row ${index}`);
    return decimalString(
      row.entityId ?? row.entity_id,
      `Regional local empire node row ${index} entity id`,
    );
  }));
  const localClaimIds = new Set(localSettlementRows.map((value, index) => {
    const row = record(value, `Regional local empire_settlement_state row ${index}`);
    return decimalString(
      row.claimEntityId ?? row.claim_entity_id,
      `Regional local empire settlement row ${index} claim id`,
    );
  }));
  const localSiegeRows = options.siegeRows.filter((value, index) => {
    const row = record(value, `Regional empire_node_siege_state row ${index}`);
    return localNodeIds.has(decimalString(
      row.buildingEntityId ?? row.building_entity_id,
      `Regional empire siege row ${index} building id`,
    ));
  });
  const localChunkRows = options.chunkRows.filter((value, index) => {
    const row = record(value, `Regional empire_chunk_state row ${index}`);
    return (
      chunkInRegion(
        row.chunkIndex ?? row.chunk_index,
        `Regional empire chunk row ${index} chunk index`,
      )
      && localNodeIds.has(decimalString(
        row.watchtowerEntityId ?? row.watchtower_entity_id,
        `Regional empire chunk row ${index} watchtower id`,
      ))
    );
  });
  const localClaimMemberRows = options.claimMemberRows.filter((value, index) => {
    const row = record(value, `Regional claim_member_state row ${index}`);
    return localClaimIds.has(decimalString(
      row.claimEntityId ?? row.claim_entity_id,
      `Regional claim member row ${index} claim id`,
    ));
  });
  const claimMemberNames = new Map<string, string>();
  for (const [index, value] of localClaimMemberRows.entries()) {
    const row = record(value, `Regional local claim_member_state row ${index}`);
    const playerEntityId = decimalString(
      row.playerEntityId ?? row.player_entity_id,
      `Regional local claim member row ${index} player id`,
    );
    const username = String(row.userName ?? row.user_name ?? "").trim();
    if (username && !claimMemberNames.has(playerEntityId)) {
      claimMemberNames.set(playerEntityId, username);
    }
  }
  const byId = (values: unknown[], label: string) => {
    const result = new Map<string, WireRecord>();
    for (const [index, value] of values.entries()) {
      const row = record(value, `${label} row ${index}`);
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `${label} row ${index} entity id`,
      );
      result.set(entityId, row);
    }
    return result;
  };
  const locationFields = (value: unknown, label: string) => {
    const location = record(value, `${label} location`);
    return {
      locationX: integer(location.x, `${label} location x`),
      locationZ: integer(location.z, `${label} location z`),
      locationDimension: decimalString(
        location.dimension,
        `${label} location dimension`,
      ),
    };
  };
  const usernames = new Map(
    [...byId(options.usernameRows, "Regional player_username_state")].map(
      ([entityId, row]) => [entityId, String(row.username ?? "").trim()],
    ),
  );
  const nicknames = new Map(
    [...byId(options.nicknameRows, "Regional building_nickname_state")].map(
      ([entityId, row]) => [entityId, String(row.nickname ?? "").trim()],
    ),
  );
  const claims = byId(options.claimRows, "Regional claim_state");
  const playerStates = byId(options.playerStateRows, "Regional player_state");
  const ranks = new Map<string, WireRecord>();
  for (const [index, value] of options.rankRows.entries()) {
    const row = record(value, `Regional empire_rank_state row ${index}`);
    const empireEntityId = decimalString(
      row.empireEntityId ?? row.empire_entity_id,
      `Regional empire_rank_state row ${index} empire id`,
    );
    const rank = integer(row.rank, `Regional empire_rank_state row ${index} rank`);
    ranks.set(`${empireEntityId}:${rank}`, row);
  }

  const members = options.playerRows.map((value, index) => {
    const row = record(value, `Regional empire_player_data_state row ${index}`);
    const entityId = decimalString(
      row.entityId ?? row.entity_id,
      `Regional empire player row ${index} entity id`,
    );
    const empireEntityId = decimalString(
      row.empireEntityId ?? row.empire_entity_id,
      `Regional empire player ${entityId} empire id`,
    );
    const rank = integer(row.rank, `Regional empire player ${entityId} rank`);
    const rankRow = ranks.get(`${empireEntityId}:${rank}`);
    const playerState = playerStates.get(entityId);
    const signInTimestamp = playerState
      ? integer(
          playerState.signInTimestamp ?? playerState.sign_in_timestamp ?? 0,
          `Regional empire player ${entityId} sign-in timestamp`,
        )
      : 0;
    return {
      entityId,
      empireEntityId,
      username: usernames.get(entityId) || null,
      rank,
      rankTitle: rankRow ? String(rankRow.title ?? "").trim() || null : null,
      permissions: rankRow && Array.isArray(rankRow.permissions)
        ? rankRow.permissions.map(Boolean)
        : [],
      donatedShards: decimalString(
        row.donatedShards ?? row.donated_shards ?? 0,
        `Regional empire player ${entityId} donated shards`,
      ),
      donatedEmpireCurrency: decimalString(
        row.donatedEmpireCurrency ?? row.donated_empire_currency ?? 0,
        `Regional empire player ${entityId} donated empire currency`,
      ),
      signedIn: playerState?.signedIn === true || playerState?.signed_in === true,
      lastLoginTimestamp: signInTimestamp > 0
        ? normalizeTimestamp(signInTimestamp, "seconds")
        : null,
      timePlayedSeconds: playerState
        ? integer(
            playerState.timePlayed ?? playerState.time_played ?? 0,
            `Regional empire player ${entityId} time played`,
          )
        : null,
    };
  });
  members.sort((left, right) => (
    BigInt(left.entityId) < BigInt(right.entityId) ? -1 : 1
  ));

  const settlements = localSettlementRows.map((value, index) => {
    const row = record(value, `Regional empire_settlement_state row ${index}`);
    const buildingEntityId = decimalString(
      row.buildingEntityId ?? row.building_entity_id,
      `Regional empire settlement row ${index} building id`,
    );
    const claimEntityId = decimalString(
      row.claimEntityId ?? row.claim_entity_id,
      `Regional empire settlement ${buildingEntityId} claim id`,
    );
    const empireEntityId = decimalString(
      row.empireEntityId ?? row.empire_entity_id,
      `Regional empire settlement ${buildingEntityId} empire id`,
    );
    const claim = claims.get(claimEntityId);
    const claimOwnerEntityId = claim
      ? decimalString(
          claim.ownerPlayerEntityId ?? claim.owner_player_entity_id,
          `Regional empire settlement ${buildingEntityId} claim owner id`,
        )
      : null;
    if (!claim) {
      warnings.push(
        `Regional empire settlement ${buildingEntityId} has no claim_state row for ${claimEntityId}.`,
      );
    }
    return {
      buildingEntityId,
      claimEntityId,
      empireEntityId,
      chunkIndex: decimalString(
        row.chunkIndex ?? row.chunk_index,
        `Regional empire settlement ${buildingEntityId} chunk index`,
      ),
      canHouseEmpireStorehouse: row.canHouseEmpireStorehouse === true
        || row.can_house_empire_storehouse === true,
      membersDonations: decimalString(
        row.membersDonations ?? row.members_donations ?? 0,
        `Regional empire settlement ${buildingEntityId} member donations`,
      ),
      ...locationFields(row.location, `Regional empire settlement ${buildingEntityId}`),
      claimName: claim ? String(claim.name ?? "").trim() : null,
      claimOwnerEntityId,
      claimOwnerName: claimOwnerEntityId
        ? usernames.get(claimOwnerEntityId) || claimMemberNames.get(claimOwnerEntityId) || null
        : null,
    };
  });
  settlements.sort((left, right) => (
    BigInt(left.buildingEntityId) < BigInt(right.buildingEntityId) ? -1 : 1
  ));
  const claimMembers = localClaimMemberRows.map((value, index) => {
    const row = record(value, `Regional claim_member_state row ${index}`);
    const entityId = decimalString(
      row.entityId ?? row.entity_id,
      `Regional claim member row ${index} entity id`,
    );
    return {
      entityId,
      claimEntityId: decimalString(
        row.claimEntityId ?? row.claim_entity_id,
        `Regional claim member ${entityId} claim id`,
      ),
      playerEntityId: decimalString(
        row.playerEntityId ?? row.player_entity_id,
        `Regional claim member ${entityId} player id`,
      ),
      username: String(row.userName ?? row.user_name ?? "").trim(),
      inventoryPermission: row.inventoryPermission === true || row.inventory_permission === true,
      buildPermission: row.buildPermission === true || row.build_permission === true,
      officerPermission: row.officerPermission === true || row.officer_permission === true,
      coOwnerPermission: row.coOwnerPermission === true || row.co_owner_permission === true,
    };
  });
  claimMembers.sort((left, right) => (
    BigInt(left.entityId) < BigInt(right.entityId) ? -1 : 1
  ));

  const chunkCountByNode = new Map<string, number>();
  const chunkCountByEmpire = new Map<string, number>();
  for (const [index, value] of localChunkRows.entries()) {
    const row = record(value, `Regional empire_chunk_state row ${index}`);
    const watchtowerEntityId = decimalString(
      row.watchtowerEntityId ?? row.watchtower_entity_id,
      `Regional empire chunk row ${index} watchtower id`,
    );
    const empireEntityId = decimalString(
      row.empireEntityId ?? row.empire_entity_id,
      `Regional empire chunk row ${index} empire id`,
    );
    chunkCountByNode.set(watchtowerEntityId, (chunkCountByNode.get(watchtowerEntityId) ?? 0) + 1);
    chunkCountByEmpire.set(empireEntityId, (chunkCountByEmpire.get(empireEntityId) ?? 0) + 1);
  }

  const nodeOwnerByBuilding = new Map<string, string>();
  for (const [index, value] of localNodeRows.entries()) {
    const row = record(value, `Regional local empire_node_state row ${index}`);
    const buildingEntityId = decimalString(
      row.entityId ?? row.entity_id,
      `Regional local empire node row ${index} entity id`,
    );
    nodeOwnerByBuilding.set(
      buildingEntityId,
      decimalString(
        row.empireEntityId ?? row.empire_entity_id,
        `Regional empire node ${buildingEntityId} empire id`,
      ),
    );
  }

  const siegesByBuilding = new Map<string, Array<Record<string, unknown>>>();
  for (const [index, value] of localSiegeRows.entries()) {
    const row = record(value, `Regional empire_node_siege_state row ${index}`);
    const entityId = decimalString(
      row.entityId ?? row.entity_id,
      `Regional empire siege row ${index} entity id`,
    );
    const buildingEntityId = decimalString(
      row.buildingEntityId ?? row.building_entity_id,
      `Regional empire siege ${entityId} building id`,
    );
    const defenderEmpireEntityId = nodeOwnerByBuilding.get(buildingEntityId);
    if (!defenderEmpireEntityId) {
      warnings.push(
        `Regional siege ${entityId} has no node owner for building ${buildingEntityId}; the siege was rejected.`,
      );
      continue;
    }
    const startTimestamp = row.startTimestamp ?? row.start_timestamp;
    const normalizedStartTimestamp = startTimestamp == null
      ? undefined
      : normalizeTimestamp(
          decimalString(
            record(startTimestamp, `Regional empire siege ${entityId} start timestamp`)
              .__timestamp_micros_since_unix_epoch__,
            `Regional empire siege ${entityId} start timestamp micros`,
          ),
          "microseconds",
        );
    const siege = {
      entityId,
      buildingEntityId,
      empireEntityId: decimalString(
        row.empireEntityId ?? row.empire_entity_id,
        `Regional empire siege ${entityId} empire id`,
      ),
      role: "attacker",
      defenderEmpireEntityId,
      energy: decimalString(row.energy ?? 0, `Regional empire siege ${entityId} energy`),
      active: row.active === true,
      ...(normalizedStartTimestamp ? { startTimestamp: normalizedStartTimestamp } : {}),
    };
    const existing = siegesByBuilding.get(buildingEntityId) ?? [];
    existing.push(siege);
    siegesByBuilding.set(buildingEntityId, existing);
  }

  const nodes = localNodeRows.map((value, index) => {
    const row = record(value, `Regional empire_node_state row ${index}`);
    const entityId = decimalString(
      row.entityId ?? row.entity_id,
      `Regional empire node row ${index} entity id`,
    );
    return {
      entityId,
      empireEntityId: decimalString(
        row.empireEntityId ?? row.empire_entity_id,
        `Regional empire node ${entityId} empire id`,
      ),
      chunkIndex: decimalString(
        row.chunkIndex ?? row.chunk_index,
        `Regional empire node ${entityId} chunk index`,
      ),
      energy: decimalString(row.energy, `Regional empire node ${entityId} energy`),
      active: row.active === true,
      upkeep: decimalString(row.upkeep, `Regional empire node ${entityId} upkeep`),
      ...locationFields(row.location, `Regional empire node ${entityId}`),
      nickname: nicknames.get(entityId) || null,
      coveredChunks: chunkCountByNode.get(entityId) ?? 0,
      sieges: siegesByBuilding.get(entityId) ?? [],
    };
  });
  nodes.sort((left, right) => (
    BigInt(left.entityId) < BigInt(right.entityId) ? -1 : 1
  ));

  const memberCountByEmpire = new Map<string, number>();
  const settlementCountByEmpire = new Map<string, number>();
  for (const member of members) {
    memberCountByEmpire.set(member.empireEntityId, (memberCountByEmpire.get(member.empireEntityId) ?? 0) + 1);
  }
  for (const settlement of settlements) {
    settlementCountByEmpire.set(
      settlement.empireEntityId,
      (settlementCountByEmpire.get(settlement.empireEntityId) ?? 0) + 1,
    );
  }
  const empires = options.empireRows.map((value, index) => {
    const row = record(value, `Regional empire_state row ${index}`);
    const entityId = decimalString(
      row.entityId ?? row.entity_id,
      `Regional empire row ${index} entity id`,
    );
    return {
      entityId,
      capitalBuildingEntityId: decimalString(
        row.capitalBuildingEntityId ?? row.capital_building_entity_id,
        `Regional empire ${entityId} capital building id`,
      ),
      name: String(row.name ?? "").trim(),
      shardTreasury: decimalString(
        row.shardTreasury ?? row.shard_treasury ?? 0,
        `Regional empire ${entityId} shard treasury`,
      ),
      nobilityThreshold: integer(
        row.nobilityThreshold ?? row.nobility_threshold,
        `Regional empire ${entityId} nobility threshold`,
      ),
      numClaims: integer(
        row.numClaims ?? row.num_claims,
        `Regional empire ${entityId} claim count`,
      ),
      ...locationFields(row.location, `Regional empire ${entityId}`),
      empireCurrencyTreasury: decimalString(
        row.empireCurrencyTreasury ?? row.empire_currency_treasury ?? 0,
        `Regional empire ${entityId} currency treasury`,
      ),
      ownerType: enumLabel(row.ownerType ?? row.owner_type) ?? null,
      memberCount: memberCountByEmpire.get(entityId) ?? 0,
      settlementCount: settlementCountByEmpire.get(entityId) ?? 0,
      territoryChunks: chunkCountByEmpire.get(entityId) ?? 0,
    };
  });
  empires.sort((left, right) => (
    BigInt(left.entityId) < BigInt(right.entityId) ? -1 : 1
  ));
  return {
    data: { regionId, empires, members, settlements, claimMembers, nodes },
    warnings,
  };
}

function normalizeDescriptionStack(value: unknown) {
  const stack = record(value, "catalog item stack");
  return {
    kind: enumLabel(stack.itemType ?? stack.item_type)?.toLowerCase() === "cargo" ? "cargo" : "item",
    id: decimalString(stack.itemId ?? stack.item_id, "catalog stack item id"),
    quantity: decimalString(stack.quantity, "catalog stack quantity"),
    ...(stack.consumptionChance == null ? {} : {
      consumptionChance: finiteNumber(stack.consumptionChance, "catalog stack consumption chance"),
    }),
  };
}

function normalizeLevelRequirement(value: unknown) {
  const requirement = record(value, "catalog level requirement");
  return {
    skillId: decimalString(requirement.skillId ?? requirement.skill_id, "level requirement skill id"),
    level: integer(requirement.level, "level requirement level"),
  };
}

function normalizeToolRequirement(value: unknown) {
  const requirement = record(value, "catalog tool requirement");
  return {
    toolType: integer(requirement.toolType ?? requirement.tool_type, "tool requirement type"),
    level: integer(requirement.level, "tool requirement level"),
    power: integer(requirement.power, "tool requirement power"),
  };
}

function normalizeExperienceStack(value: unknown) {
  const stack = record(value, "catalog experience stack");
  return {
    skillId: decimalString(stack.skillId ?? stack.skill_id, "experience skill id"),
    quantity: finiteNumber(stack.quantity, "experience quantity"),
  };
}

function normalizeStats(value: unknown) {
  return records(value).map((stat) => ({
    stat: enumLabel(stat.id) ?? "Unknown",
    value: finiteNumber(stat.value, "catalog stat value"),
    isPercent: stat.isPct === true,
  }));
}

export function normalizeCatalogDescription(value: unknown, kind: CatalogDescriptionKind) {
  const row = record(value, `Relay ${kind} description`);
  const idValue = kind === "equipment"
    ? row.itemId ?? row.item_id
    : kind === "enemy"
      ? row.enemyType ?? row.enemy_type
    : row.id;
  const id = decimalString(idValue, `${kind}.id`);
  const base = { kind, id };

  if (kind === "item_list") {
    return {
      ...base,
      name: String(row.name ?? "").trim(),
      possibilities: records(row.possibilities).map((possibility) => ({
        probability: finiteNumber(possibility.probability, "item-list possibility probability"),
        items: records(possibility.items).map(normalizeDescriptionStack),
      })),
    };
  }
  if (kind === "extraction_recipe") {
    const resourceId = decimalString(row.resourceId ?? row.resource_id ?? 0, "extraction recipe resource id");
    const cargoId = decimalString(row.cargoId ?? row.cargo_id ?? 0, "extraction recipe cargo id");
    const outputs = records(row.extractedItemStacks ?? row.extracted_item_stacks).flatMap((entry) => {
      const itemStack = entry.itemStack ?? entry.item_stack;
      if (itemStack == null) return [];
      return [{
        ...normalizeDescriptionStack(itemStack),
        probability: finiteNumber(entry.probability, "extraction recipe output probability"),
      }];
    });
    return {
      ...base,
      resourceId: resourceId === "0" ? null : resourceId,
      cargoId: cargoId === "0" ? null : cargoId,
      name: String(row.verbPhrase ?? row.verb_phrase ?? "").trim(),
      timeRequirement: finiteNumber(row.timeRequirement ?? row.time_requirement ?? 0, "extraction recipe time"),
      staminaRequirement: finiteNumber(
        row.staminaRequirement ?? row.stamina_requirement ?? 0,
        "extraction recipe stamina",
      ),
      allowUseHands: row.allowUseHands === true || row.allow_use_hands === true,
      levelRequirements: records(row.levelRequirements).map(normalizeLevelRequirement),
      toolRequirements: records(row.toolRequirements).map(normalizeToolRequirement),
      experiencePerProgress: records(row.experiencePerProgress).map(normalizeExperienceStack),
      inputs: records(row.consumedItemStacks).map(normalizeDescriptionStack),
      outputs,
    };
  }
  if (kind === "crafting_recipe") {
    const building = row.buildingRequirement == null
      ? null
      : record(row.buildingRequirement, "crafting recipe building requirement");
    return {
      ...base,
      name: String(row.name ?? "").trim(),
      actionsRequired: integer(row.actionsRequired ?? 0, "crafting recipe actions"),
      isPassive: row.isPassive === true,
      buildingRequirement: building ? {
        buildingType: decimalString(building.buildingType, "building requirement type"),
        tier: integer(building.tier, "building requirement tier"),
      } : null,
      levelRequirements: records(row.levelRequirements).map(normalizeLevelRequirement),
      toolRequirements: records(row.toolRequirements).map(normalizeToolRequirement),
      experiencePerProgress: records(row.experiencePerProgress).map(normalizeExperienceStack),
      inputs: records(row.consumedItemStacks).map(normalizeDescriptionStack),
      outputs: records(row.craftedItemStacks).map(normalizeDescriptionStack),
    };
  }
  if (kind === "construction_recipe") {
    return {
      ...base,
      name: String(row.name ?? "").trim(),
      actionsRequired: integer(row.actionsRequired ?? 0, "construction recipe actions"),
      buildingDescriptionId: decimalString(
        row.buildingDescriptionId ?? row.building_description_id,
        "construction recipe building id",
      ),
      levelRequirements: records(row.levelRequirements).map(normalizeLevelRequirement),
      inputs: [
        ...records(row.consumedItemStacks).map(normalizeDescriptionStack),
        ...records(row.consumedCargoStacks).map(normalizeDescriptionStack),
      ],
    };
  }
  if (kind === "building") {
    return {
      ...base,
      name: String(row.name ?? "").trim(),
      description: String(row.description ?? ""),
      iconAssetName: String(row.iconAssetName ?? row.icon_asset_name ?? ""),
      showInCompendium: row.showInCompendium ?? row.show_in_compendium ?? false,
      maxHealth: integer(row.maxHealth ?? 0, "building max health"),
      functions: records(row.functions).map((entry) => ({
        functionType: integer(entry.functionType ?? 0, "building function type"),
        level: integer(entry.level ?? 0, "building function level"),
        craftingSlots: integer(entry.craftingSlots ?? 0, "building crafting slots"),
        storageSlots: integer(entry.storageSlots ?? 0, "building storage slots"),
        refiningSlots: integer(entry.refiningSlots ?? 0, "building refining slots"),
      })),
    };
  }
  if (kind === "building_type") {
    return {
      ...base,
      name: String(row.name ?? "").trim(),
      category: enumLabel(row.category) ?? "Unknown",
      actions: (Array.isArray(row.actions) ? row.actions : []).map((entry) => String(entry)),
    };
  }
  if (kind === "skill") {
    return {
      ...base,
      skillType: decimalString(row.skillType ?? row.skill_type, "skill type"),
      name: String(row.name ?? "").trim(),
      description: String(row.description ?? ""),
      iconAssetName: String(row.iconAssetName ?? row.icon_asset_name ?? ""),
      title: String(row.title ?? ""),
      category: enumLabel(row.skillCategory ?? row.skill_category) ?? "Unknown",
      maxLevel: integer(row.maxLevel ?? 0, "skill max level"),
    };
  }
  if (kind === "resource") {
    return {
      ...base,
      name: String(row.name ?? "").trim(),
      description: String(row.description ?? ""),
      iconAssetName: String(row.iconAssetName ?? row.icon_asset_name ?? ""),
      maxHealth: integer(row.maxHealth ?? 0, "resource max health"),
      tier: integer(row.tier ?? 0, "resource tier"),
      tag: String(row.tag ?? ""),
      rarity: enumLabel(row.rarity) ?? "Unknown",
      onDestroyYield: records(row.onDestroyYield).map(normalizeDescriptionStack),
    };
  }
  if (kind === "enemy") {
    return {
      ...base,
      enemyType: id,
      name: String(row.name ?? "").trim(),
      description: String(row.description ?? ""),
      maxHealth: integer(row.maxHealth ?? row.max_health ?? 0, "enemy max health"),
      minDamage: integer(row.minDamage ?? row.min_damage ?? 0, "enemy minimum damage"),
      maxDamage: integer(row.maxDamage ?? row.max_damage ?? 0, "enemy maximum damage"),
      attackLevel: integer(row.attackLevel ?? row.attack_level ?? 0, "enemy attack level"),
      defenseLevel: integer(row.defenseLevel ?? row.defense_level ?? 0, "enemy defense level"),
      iconAssetName: String(row.iconAddress ?? row.icon_address ?? ""),
      tier: integer(row.tier ?? 0, "enemy tier"),
      tag: String(row.tag ?? ""),
      rarity: enumLabel(row.rarity) ?? "Unknown",
      huntable: row.huntable === true,
    };
  }
  if (kind === "equipment") {
    const levelRequirement = row.levelRequirement == null
      ? null
      : normalizeLevelRequirement(row.levelRequirement);
    return {
      ...base,
      slots: (Array.isArray(row.slots) ? row.slots : []).map((slot) => enumLabel(slot) ?? "Unknown"),
      levelRequirement,
      stats: normalizeStats(row.stats),
      requiredAchievements: (Array.isArray(row.requiredAchievements) ? row.requiredAchievements : [])
        .map((entry) => decimalString(entry, "equipment achievement id")),
      requiredKnowledges: (Array.isArray(row.requiredKnowledges) ? row.requiredKnowledges : [])
        .map((entry) => decimalString(entry, "equipment knowledge id")),
    };
  }
  if (kind === "tool") {
    return {
      ...base,
      itemId: decimalString(row.itemId ?? row.item_id, "tool item id"),
      toolType: integer(row.toolType ?? row.tool_type, "tool type"),
      level: integer(row.level, "tool level"),
      power: integer(row.power, "tool power"),
    };
  }
  if (kind === "buff") {
    return {
      ...base,
      buffTypeId: decimalString(row.buffTypeId ?? row.buff_type_id, "buff type id"),
      description: String(row.description ?? ""),
      duration: integer(row.duration ?? 0, "buff duration"),
      beneficial: row.beneficial === true,
      iconAssetName: String(row.iconAssetName ?? row.icon_asset_name ?? ""),
      stats: normalizeStats(row.stats),
    };
  }
  const unlocksTechs = row.unlocksTechs ?? row.unlocks_techs;
  return {
    ...base,
    name: String(row.name ?? "").trim(),
    description: String(row.description ?? ""),
    tier: integer(row.tier ?? 0, "claim technology tier"),
    techType: enumLabel(row.techType ?? row.tech_type) ?? "Unknown",
    suppliesCost: decimalString(row.suppliesCost ?? row.supplies_cost ?? 0, "claim technology supplies cost"),
    researchTime: decimalString(row.researchTime ?? row.research_time ?? 0, "claim technology research time"),
    requirements: (Array.isArray(row.requirements) ? row.requirements : [])
      .map((entry) => decimalString(entry, "claim technology requirement id")),
    inputs: records(row.input).map(normalizeDescriptionStack),
    members: decimalString(row.members ?? 0, "claim technology member cap"),
    area: decimalString(row.area ?? 0, "claim technology area cap"),
    supplies: decimalString(row.supplies ?? 0, "claim technology supply cap"),
    xpToMintHexCoin: decimalString(
      row.xpToMintHexCoin ?? row.xp_to_mint_hex_coin ?? 0,
      "claim technology Hex Coin XP",
    ),
    unlocksTechs: (Array.isArray(unlocksTechs) ? unlocksTechs : [])
      .map((entry) => decimalString(entry, "claim technology unlocked id")),
  };
}

export function normalizeCatalogEntity(value: unknown, kindValue: ItemKind) {
  const row = record(value, `Relay ${kindValue} description`);
  const kind = normalizeItemKind(kindValue);
  const id = decimalString(row.id, `${kind}.id`);
  const name = String(row.name ?? "").trim();
  if (!name) throw new TypeError(`${kind}.name is required.`);
  const wireTier = finiteNumber(row.tier ?? 0, `${kind}.tier`);
  if (!Number.isSafeInteger(wireTier)) {
    throw new TypeError(
      `${kind}.tier must be an integer (received ${String(row.tier)}`
      + ` for ${id} ${name}).`,
    );
  }
  // Live Relay rows use negative sentinel values for catalog entries that are
  // not tiered (both -1 and -2 have been observed).
  const tier = wireTier < 0 ? null : wireTier;
  const itemListId = row.itemListId ?? row.item_list_id;
  return {
    kind,
    id,
    name,
    tag: String(row.tag ?? ""),
    tier,
    ...(enumLabel(row.rarity) ? { rarity: enumLabel(row.rarity) } : {}),
    ...(String(row.iconAssetName ?? row.icon_asset_name ?? "").trim() ? {
      iconAssetName: String(row.iconAssetName ?? row.icon_asset_name).trim(),
    } : {}),
    ...(itemListId == null || decimalString(itemListId, `${kind}.item_list_id`) === "0" ? {} : {
      itemListId: decimalString(itemListId, `${kind}.item_list_id`),
    }),
  };
}

export function normalizeClaim(value: unknown) {
  return normalizeClaimPayload(value).data;
}

export function normalizeClaimPayload(value: unknown) {
  const row = record(value, "Relay claim");
  const data: WireRecord = {
    entityId: decimalString(row.entity_id, "claim.entity_id"),
    name: String(row.name ?? ""),
    regionId: decimalString(row.region, "claim.region"),
  };
  const warnings: string[] = [];
  const optionalFields: Array<[string, string, (field: unknown) => unknown]> = [
    ["owner_player_entity_id", "ownerPlayerEntityId", (field) => decimalString(field, "claim.owner_player_entity_id")],
    ["supplies", "supplies", (field) => decimalString(field, "claim.supplies")],
    ["treasury", "treasury", (field) => decimalString(field, "claim.treasury")],
    ["tier", "tier", (field) => finiteNumber(field, "claim.tier")],
    ["num_tiles", "numTiles", (field) => finiteNumber(field, "claim.num_tiles")],
    ["tile_cost", "tileCost", (field) => finiteNumber(field, "claim.tile_cost")],
    ["upkeep_cost", "upkeepCost", (field) => finiteNumber(field, "claim.upkeep_cost")],
    ["supplies_run_out", "suppliesRunOut", (field) => normalizeTimestamp(decimalString(field, "claim.supplies_run_out"), "milliseconds")],
  ];
  for (const [wireName, domainName, normalize] of optionalFields) {
    if (row[wireName] == null) {
      warnings.push(`Relay claim omitted ${wireName}.`);
    } else {
      data[domainName] = normalize(row[wireName]);
    }
  }
  return { data, warnings };
}

export function normalizeMembers(value: unknown) {
  return normalizeMembersPayload(value).data;
}

export function normalizeMembersPayload(value: unknown) {
  const payload = record(value, "Relay members payload");
  const members = Array.isArray(payload.members) ? payload.members : [];
  const skillNames = record(payload.skill_names ?? {}, "Relay skill names") as Record<string, string>;
  const warnings: string[] = [];
  const data = members.flatMap((value, index) => {
    try {
      const row = record(value, `Relay member ${index}`);
      return [{
        entityId: decimalString(row.entity_id, `members[${index}].entity_id`),
        claimEntityId: decimalString(row.claim_entity_id, `members[${index}].claim_entity_id`),
        playerEntityId: decimalString(row.player_entity_id, `members[${index}].player_entity_id`),
        userName: String(row.user_name ?? ""),
        hexcoins: decimalString(row.hexcoins ?? 0, `members[${index}].hexcoins`),
        buildPermission: Boolean(row.build_permission),
        inventoryPermission: Boolean(row.inventory_permission),
        officerPermission: Boolean(row.officer_permission),
        coOwnerPermission: Boolean(row.co_owner_permission),
        ...(row.last_active_timestamp == null ? {} : {
          lastActiveTimestamp: normalizeTimestamp(decimalString(row.last_active_timestamp, `members[${index}].last_active_timestamp`), "seconds"),
        }),
        ...(row.last_login_timestamp == null ? {} : {
          lastLoginTimestamp: normalizeTimestamp(decimalString(row.last_login_timestamp, `members[${index}].last_login_timestamp`), "seconds"),
        }),
        skills: record(row.skills ?? {}, `members[${index}].skills`) as Record<string, number>,
        skillNames,
      }];
    } catch (error) {
      warnings.push(`members[${index}] ignored: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  });
  return { data, warnings };
}

export function normalizeCitizensPayload(value: unknown) {
  const members = normalizeMembersPayload(value);
  return {
    data: members.data.map((member) => {
      const skills = Object.fromEntries(Object.entries(member.skills).map(([skillId, level]) => {
        const normalizedLevel = integer(level, `citizen ${member.playerEntityId} skill ${skillId}`);
        if (normalizedLevel < 0) throw new TypeError(`citizen skill ${skillId} cannot be negative`);
        return [skillId, normalizedLevel];
      }));
      const totalLevel = Object.values(skills).reduce((total, level) => total + level, 0);
      return {
        entityId: member.entityId,
        playerEntityId: member.playerEntityId,
        userName: member.userName,
        skills,
        skillNames: member.skillNames,
        totalLevel,
        totalSkillLevel: totalLevel,
      };
    }),
    warnings: [...members.warnings],
  };
}

export function normalizeRegionalPlayers(options: {
  members: unknown[];
  playerRows: unknown[];
  taskRows?: unknown[];
  taskDescriptionRows?: unknown[];
  observedAt: string;
}) {
  const observedAtMs = Date.parse(options.observedAt);
  if (!Number.isFinite(observedAtMs)) throw new TypeError("regional player observedAt is invalid");
  const includeTasks = options.taskRows !== undefined || options.taskDescriptionRows !== undefined;
  const warnings: string[] = [];
  const rows = new Map(options.playerRows.map((value) => {
    const row = record(value, "regional player_state row");
    return [decimalString(row.entityId ?? row.entity_id, "regional player entity id"), row] as const;
  }));
  const taskDescriptions = new Map((options.taskDescriptionRows ?? []).map((value) => {
    const row = record(value, "regional traveler_task_desc row");
    return [decimalString(row.id, "regional traveler task description id"), row] as const;
  }));
  const tasksByPlayer = new Map<string, Array<{
    entityId: string;
    travelerId: string;
    taskId: string;
    description: string;
    completed: boolean;
  }>>();
  for (const [index, value] of (options.taskRows ?? []).entries()) {
    try {
      const row = record(value, `regional traveler_task_state row ${index}`);
      const playerEntityId = decimalString(
        row.playerEntityId ?? row.player_entity_id,
        `regional traveler task ${index} player id`,
      );
      const taskId = decimalString(row.taskId ?? row.task_id, `regional traveler task ${index} task id`);
      const description = taskDescriptions.get(taskId);
      if (!description) warnings.push(`Regional traveler_task_desc omitted task ${taskId}.`);
      const tasks = tasksByPlayer.get(playerEntityId) ?? [];
      tasks.push({
        entityId: decimalString(row.entityId ?? row.entity_id, `regional traveler task ${index} entity id`),
        travelerId: decimalString(row.travelerId ?? row.traveler_id, `regional traveler task ${index} traveler id`),
        taskId,
        description: String(description?.description ?? `Task ${taskId}`),
        completed: row.completed === true,
      });
      tasksByPlayer.set(playerEntityId, tasks);
    } catch (error) {
      warnings.push(`Regional traveler task ${index} ignored: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const data = options.members.map((value, index) => {
    const member = record(value, `regional player member ${index}`);
    const playerEntityId = decimalString(
      member.playerEntityId ?? member.player_entity_id,
      `regional player member ${index} id`,
    );
    const row = rows.get(playerEntityId);
    const tasks = {
      tasks: (tasksByPlayer.get(playerEntityId) ?? []).sort((left, right) => (
        Number(left.completed) - Number(right.completed)
        || left.description.localeCompare(right.description)
        || left.entityId.localeCompare(right.entityId)
      )),
    };
    if (!row) {
      warnings.push(`Regional player_state omitted member ${playerEntityId}.`);
      return {
        entityId: playerEntityId,
        playerEntityId,
        username: String(member.userName ?? member.user_name ?? ""),
        signedIn: false,
        sessionSeconds: null,
        timePlayedSeconds: null,
        timeSignedInSeconds: null,
        ...(includeTasks ? { tasks } : {}),
        ...(member.lastActiveTimestamp == null ? {} : {
          lastActiveTimestamp: String(member.lastActiveTimestamp),
        }),
        ...(member.lastLoginTimestamp == null ? {} : {
          lastLoginTimestamp: String(member.lastLoginTimestamp),
        }),
      };
    }
    const signedIn = row.signedIn === true || row.signed_in === true;
    const signInValue = row.signInTimestamp ?? row.sign_in_timestamp;
    const signInTimestamp = signedIn && integer(signInValue ?? 0, "regional player sign-in timestamp") > 0
      ? normalizeTimestamp(integer(signInValue, "regional player sign-in timestamp"), "seconds")
      : null;
    const sessionSeconds = signInTimestamp
      ? Math.max(0, Math.floor((observedAtMs - Date.parse(signInTimestamp)) / 1000))
      : null;
    return {
      entityId: playerEntityId,
      playerEntityId,
      username: String(member.userName ?? member.user_name ?? ""),
      signedIn,
      sessionSeconds,
      timePlayedSeconds: Math.max(0, integer(row.timePlayed ?? row.time_played ?? 0, "regional player time played")),
      timeSignedInSeconds: Math.max(0, integer(row.timeSignedIn ?? row.time_signed_in ?? 0, "regional player time signed in")),
      ...(includeTasks ? { tasks } : {}),
      ...(signInTimestamp ? { signInTimestamp } : {}),
      ...(member.lastActiveTimestamp == null ? {} : {
        lastActiveTimestamp: String(member.lastActiveTimestamp),
      }),
      ...(member.lastLoginTimestamp == null ? {} : {
        lastLoginTimestamp: String(member.lastLoginTimestamp),
      }),
    };
  });
  return { data, warnings };
}

function snakeCaseEnum(value: unknown, fallback: string): string {
  const label = enumLabel(value) ?? fallback;
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function normalizeEquippedItem(value: unknown) {
  if (value == null) return null;
  const item = record(value, "regional equipped item");
  const itemId = decimalString(item.itemId ?? item.item_id, "regional equipped item id");
  return {
    id: itemId,
    itemId,
    itemType: normalizeItemKind(enumLabel(item.itemType ?? item.item_type)),
    quantity: decimalString(item.quantity, "regional equipped item quantity"),
    ...(item.durability == null ? {} : {
      durability: decimalString(item.durability, "regional equipped item durability"),
    }),
  };
}

function normalizeRegionalProjectStack(
  value: unknown,
  expectedKind: ItemKind,
  label: string,
) {
  const stack = record(value, label);
  const itemType = normalizeItemKind(enumLabel(stack.itemType ?? stack.item_type));
  if (itemType !== expectedKind) {
    throw new TypeError(`${label} must contain ${expectedKind} identity.`);
  }
  return {
    itemId: decimalString(stack.itemId ?? stack.item_id, `${label} item id`),
    itemType,
    quantity: decimalString(stack.quantity, `${label} quantity`),
  };
}

export function normalizeRegionalResearch(options: {
  claimId: string;
  stateRows: unknown[];
}) {
  const claimId = decimalString(options.claimId, "regional research claim id");
  const warnings: string[] = [];
  let matched: Record<string, unknown> | null = null;
  for (const [index, value] of options.stateRows.entries()) {
    try {
      const row = record(value, `regional claim_tech_state row ${index}`);
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `regional claim_tech_state row ${index} entity id`,
      );
      if (entityId !== claimId) {
        warnings.push(`Regional claim_tech_state omitted cross-claim row ${entityId}.`);
        continue;
      }
      if (matched) {
        warnings.push(`Regional claim_tech_state omitted duplicate row for configured claim ${claimId}.`);
        continue;
      }
      matched = row;
    } catch (error) {
      warnings.push(
        `Regional claim_tech_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!matched) {
    warnings.push(`Regional claim_tech_state has no row for configured claim ${claimId}.`);
    return {
      data: {
        claimId,
        learnedTechIds: [],
        researchingTechId: null,
        researchStartedAt: null,
        scheduledId: null,
      },
      warnings,
    };
  }
  const researchingValue = integer(
    matched.researching ?? 0,
    "regional claim_tech_state researching technology id",
  );
  const researchingTechId = researchingValue === 0 ? null : String(researchingValue);
  const startTimestamp = matched.startTimestamp ?? matched.start_timestamp;
  const researchStartedAt = researchingTechId == null
    ? null
    : normalizeTimestamp(
        decimalString(
          record(startTimestamp, "regional claim_tech_state start timestamp")
            .__timestamp_micros_since_unix_epoch__
            ?? record(startTimestamp, "regional claim_tech_state start timestamp").microsSinceUnixEpoch
            ?? record(startTimestamp, "regional claim_tech_state start timestamp").micros_since_unix_epoch,
          "regional claim_tech_state start timestamp",
        ),
        "microseconds",
      );
  const scheduledId = matched.scheduledId ?? matched.scheduled_id;
  return {
    data: {
      claimId,
      learnedTechIds: (Array.isArray(matched.learned) ? matched.learned : [])
        .map((id) => decimalString(id, "regional claim_tech_state learned technology id")),
      researchingTechId,
      researchStartedAt,
      scheduledId: scheduledId == null
        ? null
        : decimalString(scheduledId, "regional claim_tech_state scheduled id"),
    },
    warnings,
  };
}

export function normalizeRegionalRecruitment(options: {
  claimId: string;
  stateRows: unknown[];
}) {
  const claimId = decimalString(options.claimId, "regional recruitment claim id");
  const warnings: string[] = [];
  const recruitment: Array<{
    entityId: string;
    claimEntityId: string;
    remainingStock: string;
    requiredSkillId: string;
    requiredSkillLevel: string;
    requiredApproval: boolean;
    isRecruiting: boolean;
  }> = [];
  const seen = new Set<string>();
  for (const [index, value] of options.stateRows.entries()) {
    try {
      const row = record(value, `regional claim_recruitment_state row ${index}`);
      const claimEntityId = decimalString(
        row.claimEntityId ?? row.claim_entity_id,
        `regional claim_recruitment_state row ${index} claim id`,
      );
      if (claimEntityId !== claimId) {
        warnings.push(`Regional claim_recruitment_state omitted cross-claim row ${claimEntityId}.`);
        continue;
      }
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `regional claim_recruitment_state row ${index} entity id`,
      );
      if (seen.has(entityId)) {
        warnings.push(`Regional claim_recruitment_state omitted duplicate row ${entityId}.`);
        continue;
      }
      const remainingStock = decimalString(
        row.remainingStock ?? row.remaining_stock,
        `regional claim_recruitment_state row ${index} remaining stock`,
      );
      const requiredSkillId = decimalString(
        row.requiredSkillId ?? row.required_skill_id,
        `regional claim_recruitment_state row ${index} required skill id`,
      );
      const requiredSkillLevel = decimalString(
        row.requiredSkillLevel ?? row.required_skill_level,
        `regional claim_recruitment_state row ${index} required skill level`,
      );
      const requiredApproval = row.requiredApproval ?? row.required_approval;
      if (typeof requiredApproval !== "boolean") {
        throw new TypeError(
          `regional claim_recruitment_state row ${index} required approval must be boolean`,
        );
      }
      seen.add(entityId);
      recruitment.push({
        entityId,
        claimEntityId,
        remainingStock,
        requiredSkillId,
        requiredSkillLevel,
        requiredApproval,
        isRecruiting: BigInt(remainingStock) > 0n,
      });
    } catch (error) {
      warnings.push(
        `Regional claim_recruitment_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    data: {
      claimId,
      isRecruiting: recruitment.some((posting) => posting.isRecruiting),
      recruitment,
    },
    warnings,
  };
}

export function normalizeRegionalConstruction(options: {
  claimId: string;
  projectRows: unknown[];
  buildingRows?: unknown[];
}) {
  const claimId = decimalString(options.claimId, "regional construction claim id");
  const projects = [];
  const buildings = [];
  const warnings: string[] = [];
  for (const [index, value] of options.projectRows.entries()) {
    try {
      const row = record(value, `regional project_site_state row ${index}`);
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `regional project_site_state row ${index} entity id`,
      );
      const ownerId = decimalString(
        row.ownerId ?? row.owner_id,
        `regional project_site_state row ${index} owner id`,
      );
      if (ownerId !== claimId) {
        warnings.push(
          `Regional project_site_state omitted cross-claim project ${entityId} owned by ${ownerId}.`,
        );
        continue;
      }
      const timestamp = record(
        row.lastHitTimestamp ?? row.last_hit_timestamp,
        `regional project_site_state row ${index} last hit timestamp`,
      );
      const timestampMicros = decimalString(
        timestamp.__timestamp_micros_since_unix_epoch__
          ?? timestamp.microsSinceUnixEpoch
          ?? timestamp.micros_since_unix_epoch,
        `regional project_site_state row ${index} last hit timestamp`,
      );
      projects.push({
        entityId,
        constructionRecipeId: decimalString(
          row.constructionRecipeId ?? row.construction_recipe_id,
          `regional project_site_state row ${index} construction recipe id`,
        ),
        resourcePlacementRecipeId: decimalString(
          row.resourcePlacementRecipeId ?? row.resource_placement_recipe_id,
          `regional project_site_state row ${index} resource placement recipe id`,
        ),
        ownerId,
        items: records(row.items).map((stack, stackIndex) => (
          normalizeRegionalProjectStack(
            stack,
            "item",
            `regional project_site_state row ${index} item ${stackIndex}`,
          )
        )),
        cargos: records(row.cargos).map((stack, stackIndex) => (
          normalizeRegionalProjectStack(
            stack,
            "cargo",
            `regional project_site_state row ${index} cargo ${stackIndex}`,
          )
        )),
        progress: decimalString(
          row.progress,
          `regional project_site_state row ${index} progress`,
        ),
        lastCritOutcome: integer(
          row.lastCritOutcome ?? row.last_crit_outcome,
          `regional project_site_state row ${index} last crit outcome`,
        ),
        direction: integer(
          row.direction,
          `regional project_site_state row ${index} direction`,
        ),
        lastHitAt: normalizeTimestamp(timestampMicros, "microseconds"),
      });
    } catch (error) {
      warnings.push(
        `Regional project_site_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const [index, value] of (options.buildingRows ?? []).entries()) {
    try {
      const row = record(value, `regional building_state row ${index}`);
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `regional building_state row ${index} entity id`,
      );
      const claimEntityId = decimalString(
        row.claimEntityId ?? row.claim_entity_id,
        `regional building_state row ${index} claim id`,
      );
      if (claimEntityId !== claimId) {
        warnings.push(
          `Regional building_state omitted cross-claim building ${entityId} owned by ${claimEntityId}.`,
        );
        continue;
      }
      buildings.push({
        entityId,
        claimEntityId,
        directionIndex: integer(
          row.directionIndex ?? row.direction_index,
          `regional building_state row ${index} direction index`,
        ),
        buildingDescriptionId: decimalString(
          row.buildingDescriptionId ?? row.building_description_id,
          `regional building_state row ${index} building description id`,
        ),
        constructedByPlayerEntityId: decimalString(
          row.constructedByPlayerEntityId ?? row.constructed_by_player_entity_id,
          `regional building_state row ${index} constructor id`,
        ),
      });
    } catch (error) {
      warnings.push(
        `Regional building_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return {
    data: { projects, buildings },
    warnings,
  };
}

function normalizeEquipmentSlot(value: unknown) {
  const slot = record(value, "regional equipment slot");
  return {
    primary: snakeCaseEnum(slot.primary, "none"),
    item: normalizeEquippedItem(slot.item),
  };
}

export function normalizeRegionalEquipment(options: {
  members: unknown[];
  equipmentRows: unknown[];
  presetRows: unknown[];
  buffRows: unknown[];
}) {
  const equipmentByPlayer = new Map(options.equipmentRows.map((value) => {
    const row = record(value, "regional equipment_state row");
    return [decimalString(row.entityId ?? row.entity_id, "regional equipment player id"), row] as const;
  }));
  const presetsByPlayer = new Map<string, WireRecord[]>();
  for (const value of options.presetRows) {
    const row = record(value, "regional equipment_preset_state row");
    const playerId = decimalString(
      row.playerEntityId ?? row.player_entity_id,
      "regional equipment preset player id",
    );
    const rows = presetsByPlayer.get(playerId) ?? [];
    rows.push(row);
    presetsByPlayer.set(playerId, rows);
  }
  const buffsByPlayer = new Map(options.buffRows.map((value) => {
    const row = record(value, "regional active_buff_state row");
    return [decimalString(row.entityId ?? row.entity_id, "regional buff player id"), row] as const;
  }));

  return {
    data: {
      members: options.members.map((value, index) => {
        const member = record(value, `regional equipment member ${index}`);
        const playerEntityId = decimalString(
          member.playerEntityId ?? member.player_entity_id,
          `regional equipment member ${index} id`,
        );
        const equipment = equipmentByPlayer.get(playerEntityId);
        const buffState = buffsByPlayer.get(playerEntityId);
        const presets = (presetsByPlayer.get(playerEntityId) ?? [])
          .sort((left, right) => integer(left.index, "equipment preset index") - integer(right.index, "equipment preset index"))
          .map((row) => ({
            entityId: decimalString(row.entityId ?? row.entity_id, "equipment preset entity id"),
            index: integer(row.index, "equipment preset index"),
            active: row.active === true,
            equipmentSlots: records(row.equipmentSlots ?? row.equipment_slots).map(normalizeEquipmentSlot),
          }));
        const buffs = records(buffState?.activeBuffs ?? buffState?.active_buffs).flatMap((row) => {
          const start = record(
            row.buffStartTimestamp ?? row.buff_start_timestamp,
            "active buff start timestamp",
          );
          const startTimestampSeconds = integer(
            start.value,
            "active buff start timestamp",
          );
          const durationSeconds = Math.max(
            0,
            integer(row.buffDuration ?? row.buff_duration ?? 0, "active buff duration"),
          );
          if (startTimestampSeconds <= 0 || durationSeconds <= 0) return [];
          return [{
            buffId: decimalString(row.buffId ?? row.buff_id, "active buff id"),
            startTimestampSeconds: String(startTimestampSeconds),
            startedAt: null,
            durationSeconds,
            values: (Array.isArray(row.values) ? row.values : [])
              .map((entry) => finiteNumber(entry, "active buff value")),
          }];
        });
        return {
          playerEntityId,
          username: String(member.userName ?? member.user_name ?? ""),
          equipment: {
            equipmentSlots: records(equipment?.equipmentSlots ?? equipment?.equipment_slots)
              .map(normalizeEquipmentSlot),
          },
          equipmentPresets: { presets },
          buffs: { buffs },
        };
      }),
    },
    warnings: [],
  };
}

export function normalizeDeposit(value: unknown) {
  const row = record(value, "Relay deposit");
  const explicit = String(row.status ?? "").trim().toLowerCase();
  const status = explicit === "active" ? "active"
    : explicit === "respawning" || row.respawn_at != null ? "respawning"
    : "unknown";
  return {
    entityId: decimalString(row.entity_id, "deposit.entity_id"),
    regionId: decimalString(row.region, "deposit.region"),
    status,
    ...(row.name == null ? {} : { name: String(row.name) }),
    ...(row.north == null ? {} : { north: finiteNumber(row.north, "deposit.north") }),
    ...(row.east == null ? {} : { east: finiteNumber(row.east, "deposit.east") }),
    ...(row.respawn_at == null ? {} : { respawnAt: new Date(String(row.respawn_at)).toISOString() }),
  };
}

export function normalizeDeposits(value: unknown) {
  const payload = record(value, "Relay deposits payload");
  const deposits = Array.isArray(payload.deposits) ? payload.deposits : [];
  return deposits.map(normalizeDeposit);
}

function normalizeStack(value: unknown, label: string) {
  const row = record(value, label);
  return {
    itemId: decimalString(row.item_id, `${label}.item_id`),
    itemType: normalizeItemKind(row.item_type),
    quantity: decimalString(row.quantity, `${label}.quantity`),
  };
}

export function normalizeRegionalBankInventories(options: {
  claimId: string;
  members: unknown[];
  bankRows: unknown[];
  inventoryRows: unknown[];
}) {
  const claimId = decimalString(options.claimId, "regional Town Bank claim id");
  const warnings: string[] = [];
  const bankBuildingIds = new Set<string>();
  for (const [index, value] of records(options.bankRows).entries()) {
    try {
      const buildingId = decimalString(
        value.buildingEntityId ?? value.building_entity_id,
        `regional bank row ${index} building id`,
      );
      const rowClaimId = decimalString(
        value.claimEntityId ?? value.claim_entity_id,
        `regional bank row ${index} claim id`,
      );
      if (rowClaimId !== claimId) {
        warnings.push(
          `Regional bank_state omitted cross-claim bank ${buildingId} for claim ${rowClaimId}.`,
        );
        continue;
      }
      bankBuildingIds.add(buildingId);
    } catch (error) {
      warnings.push(
        `Regional bank_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const memberNames = new Map(records(options.members).flatMap((member, index) => {
    try {
      const playerId = decimalString(
        member.playerEntityId ?? member.player_entity_id,
        `regional bank member ${index} player id`,
      );
      const name = String(member.userName ?? member.user_name ?? "").trim();
      return [[playerId, name]];
    } catch {
      return [];
    }
  }));
  const buildings = [];
  for (const [inventoryIndex, value] of records(options.inventoryRows).entries()) {
    try {
      const ownerEntityId = decimalString(
        value.ownerEntityId ?? value.owner_entity_id,
        `regional bank inventory ${inventoryIndex} owner id`,
      );
      if (!bankBuildingIds.has(ownerEntityId)) continue;
      const entityId = decimalString(
        value.entityId ?? value.entity_id,
        `regional bank inventory ${inventoryIndex} entity id`,
      );
      const playerOwnerEntityId = decimalString(
        value.playerOwnerEntityId ?? value.player_owner_entity_id,
        `regional bank inventory ${inventoryIndex} player owner id`,
      );
      const playerOwnerName = memberNames.get(playerOwnerEntityId)
        || `Player #${playerOwnerEntityId}`;
      const inventory = records(value.pockets).flatMap((pocket, pocketIndex) => {
        if (pocket.contents == null) return [];
        const contents = record(
          pocket.contents,
          `regional bank inventory ${entityId} pocket ${pocketIndex} contents`,
        );
        const stack = {
          itemId: decimalString(
            contents.itemId ?? contents.item_id,
            `regional bank inventory ${entityId} pocket ${pocketIndex} item id`,
          ),
          itemType: normalizeItemKind(enumLabel(contents.itemType ?? contents.item_type)),
          quantity: decimalString(
            contents.quantity,
            `regional bank inventory ${entityId} pocket ${pocketIndex} quantity`,
          ),
        };
        return [{
          slot: pocketIndex,
          locked: pocket.locked === true,
          contents: stack,
        }];
      });
      const label = `Town Bank — ${playerOwnerName}`;
      buildings.push({
        entityId,
        buildingEntityId: ownerEntityId,
        playerOwnerEntityId,
        playerOwnerName,
        name: label,
        nickname: label,
        category: "town-bank",
        inventoryIndex: integer(
          value.inventoryIndex ?? value.inventory_index,
          `regional bank inventory ${entityId} inventory index`,
        ),
        cargoIndex: integer(
          value.cargoIndex ?? value.cargo_index,
          `regional bank inventory ${entityId} cargo index`,
        ),
        items: inventory.map((slot) => slot.contents),
        inventory,
      });
    } catch (error) {
      warnings.push(
        `Regional bank inventory omitted row ${inventoryIndex}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { data: { buildings }, warnings };
}

export function normalizeClaimInventory(value: unknown) {
  const payload = record(value, "Relay claim inventory payload");
  const claim = record(payload.claim, "Relay claim inventory claim");
  const dimensions = (Array.isArray(payload.dimensions) ? payload.dimensions : []).map((value, dimensionIndex) => {
    const dimension = record(value, `Relay inventory dimension ${dimensionIndex}`);
    const dimensionId = decimalString(dimension.dimension_id, `dimensions[${dimensionIndex}].dimension_id`);
    const buildings = (Array.isArray(dimension.buildings) ? dimension.buildings : []).map((value, buildingIndex) => {
      const building = record(value, `Relay inventory building ${buildingIndex}`);
      const stacks = (Array.isArray(building.items) ? building.items : []).map((value, stackIndex) => (
        normalizeStack(value, `dimensions[${dimensionIndex}].buildings[${buildingIndex}].items[${stackIndex}]`)
      ));
      return {
        entityId: decimalString(building.entity_id, `buildings[${buildingIndex}].entity_id`),
        name: String(building.name ?? ""),
        nickname: String(building.nickname ?? ""),
        dimensionId,
        dimensionKind: String(dimension.kind ?? ""),
        items: stacks,
        inventory: stacks.map((contents) => ({ contents })),
      };
    });
    return {
      dimensionId,
      kind: String(dimension.kind ?? ""),
      entrance: dimension.entrance ?? null,
      buildings,
    };
  });
  return {
    claim: {
      entityId: decimalString(claim.entity_id, "inventory.claim.entity_id"),
      name: String(claim.name ?? ""),
      regionId: decimalString(claim.region, "inventory.claim.region"),
    },
    dimensions,
    buildings: dimensions.flatMap((dimension) => dimension.buildings),
  };
}

export function normalizeStorageLogs(value: unknown, options: {
  claimId: string;
  regionId: string;
}) {
  const payload = record(value, "Relay storage-log payload");
  const claimId = decimalString(options.claimId, "storage-log configured claim id");
  const regionId = decimalString(options.regionId, "storage-log configured region id");
  const warnings: string[] = [];
  const data = [];
  const seen = new Set<string>();
  for (const [index, value] of records(payload.logs).entries()) {
    try {
      const row = record(value, `Relay storage-log row ${index}`);
      const id = decimalString(row.id, `storage-log row ${index} id`);
      const rowClaimId = decimalString(
        row.claim_entity_id ?? row.claimEntityId,
        `storage-log row ${index} claim id`,
      );
      if (rowClaimId !== claimId) {
        warnings.push(`Relay storage-log omitted cross-claim row ${id} for claim ${rowClaimId}.`);
        continue;
      }
      const rowRegionId = decimalString(row.region, `storage-log row ${index} region`);
      if (rowRegionId !== regionId) {
        warnings.push(`Relay storage-log omitted cross-region row ${id} for region ${rowRegionId}.`);
        continue;
      }
      if (seen.has(id)) {
        warnings.push(`Relay storage-log omitted duplicate row ${id}.`);
        continue;
      }
      const action = String(row.action ?? "").trim().toLowerCase();
      if (action !== "deposit" && action !== "withdraw") {
        throw new TypeError(`storage-log row ${index} action must be deposit or withdraw`);
      }
      const building = record(row.building, `storage-log row ${index} building`);
      const occurredAtValue = String(row.timestamp ?? "").trim();
      const occurredAtDate = new Date(occurredAtValue);
      if (!occurredAtValue || Number.isNaN(occurredAtDate.getTime())) {
        throw new TypeError(`storage-log row ${index} timestamp must be an ISO date`);
      }
      seen.add(id);
      data.push({
        id,
        claimId: rowClaimId,
        claimName: String(row.claim_name ?? row.claimName ?? ""),
        regionId: rowRegionId,
        buildingId: decimalString(
          building.entity_id ?? building.entityId,
          `storage-log row ${index} building id`,
        ),
        buildingName: String(building.name ?? ""),
        buildingNickname: String(building.nickname ?? ""),
        playerId: decimalString(
          row.player_entity_id ?? row.playerEntityId,
          `storage-log row ${index} player id`,
        ),
        playerName: String(row.player_username ?? row.playerUsername ?? ""),
        action,
        itemId: decimalString(row.item_id ?? row.itemId, `storage-log row ${index} item id`),
        itemType: normalizeItemKind(row.item_type ?? row.itemType),
        quantity: decimalString(row.quantity, `storage-log row ${index} quantity`),
        occurredAt: occurredAtDate.toISOString(),
      });
    } catch (error) {
      warnings.push(
        `Relay storage-log omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { data, warnings };
}

export function normalizePlayerInventory(value: unknown) {
  const payload = record(value, "Relay player inventory payload");
  const player = record(payload.player, "Relay player inventory player");
  const normalizePlayerTimestamp = (field: unknown, label: string) => (
    field == null ? {} : { [label]: normalizeTimestamp(decimalString(field, label), "seconds") }
  );
  const inventories = (Array.isArray(payload.inventories) ? payload.inventories : []).map((value, inventoryIndex) => {
    const inventory = record(value, `Relay player inventory ${inventoryIndex}`);
    const items = (Array.isArray(inventory.items) ? inventory.items : []).map((value, stackIndex) => (
      normalizeStack(value, `inventories[${inventoryIndex}].items[${stackIndex}]`)
    ));
    const name = String(inventory.name ?? "");
    return {
      entityId: decimalString(inventory.entity_id, `inventories[${inventoryIndex}].entity_id`),
      inventoryName: name,
      name,
      nickname: String(inventory.nickname ?? ""),
      category: String(inventory.category ?? "").trim().toLowerCase(),
      ...(inventory.claim_entity_id == null ? {} : {
        claimEntityId: decimalString(
          inventory.claim_entity_id,
          `inventories[${inventoryIndex}].claim_entity_id`,
        ),
      }),
      ...(inventory.claim_name == null ? {} : { claimName: String(inventory.claim_name) }),
      items,
      pockets: items.map((contents) => ({ contents })),
    };
  });
  return {
    player: {
      entityId: decimalString(player.entity_id, "player.entity_id"),
      username: String(player.username ?? ""),
      regionId: decimalString(player.region, "player.region"),
      signedIn: player.signed_in === true,
      ...normalizePlayerTimestamp(player.last_active_timestamp, "lastActiveTimestamp"),
      ...normalizePlayerTimestamp(player.last_login_timestamp, "lastLoginTimestamp"),
    },
    inventories,
  };
}

export function normalizePlayerHousing(value: unknown) {
  const payload = record(value, "Relay player housing payload");
  const player = record(payload.player, "Relay player housing player");
  const house = payload.house == null ? null : record(payload.house, "Relay player house");
  return {
    player: {
      entityId: decimalString(player.entity_id, "housing player.entity_id"),
      username: String(player.username ?? ""),
      regionId: decimalString(player.region, "housing player.region"),
      signedIn: player.signed_in === true,
    },
    house: house ? {
      entityId: decimalString(house.entity_id, "house.entity_id"),
      name: String(house.name ?? ""),
      regionId: decimalString(house.region, "house.region"),
    } : null,
    buildings: (Array.isArray(payload.buildings) ? payload.buildings : []).map((value, buildingIndex) => {
      const building = record(value, `Relay player housing building ${buildingIndex}`);
      return {
        entityId: decimalString(building.entity_id, `housing buildings[${buildingIndex}].entity_id`),
        name: String(building.name ?? ""),
        nickname: building.nickname == null ? null : String(building.nickname),
        items: (Array.isArray(building.items) ? building.items : []).map((stack, stackIndex) => (
          normalizeStack(stack, `housing buildings[${buildingIndex}].items[${stackIndex}]`)
        )),
      };
    }),
  };
}

export function normalizeRegionalPublicCrafts(options: {
  regionId: string;
  publicRows: unknown[];
  craftRows: unknown[];
  buildingRows: unknown[];
  buildingNicknameRows: unknown[];
  claimRows: unknown[];
  usernameRows: unknown[];
  locationRows: unknown[];
}) {
  const regionId = decimalString(options.regionId, "regional public craft region id");
  const warnings: string[] = [];
  let complete = true;

  function rowsByEntityId(values: unknown[], label: string): Map<string, WireRecord> {
    const indexed = new Map<string, WireRecord>();
    for (const [index, value] of values.entries()) {
      try {
        const row = record(value, `${label} row ${index}`);
        const entityId = decimalString(
          row.entityId ?? row.entity_id,
          `${label} row ${index} entity id`,
        );
        if (!indexed.has(entityId)) indexed.set(entityId, row);
      } catch (error) {
        warnings.push(`${label} omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return indexed;
  }

  const crafts = rowsByEntityId(options.craftRows, "Regional progressive_action_state");
  const buildings = rowsByEntityId(options.buildingRows, "Regional building_state");
  const buildingNicknames = rowsByEntityId(
    options.buildingNicknameRows,
    "Regional building_nickname_state",
  );
  const claims = rowsByEntityId(options.claimRows, "Regional claim_state");
  const usernames = rowsByEntityId(options.usernameRows, "Regional player_username_state");
  const locations = rowsByEntityId(options.locationRows, "Regional location_state");
  const seen = new Set<string>();
  const craftResults: Array<Record<string, unknown>> = [];
  let missingCrafterUsernameCount = 0;

  for (const [index, value] of options.publicRows.entries()) {
    try {
      const marker = record(value, `Regional public_progressive_action_state row ${index}`);
      const entityId = decimalString(
        marker.entityId ?? marker.entity_id,
        `Regional public_progressive_action_state row ${index} entity id`,
      );
      if (seen.has(entityId)) continue;
      seen.add(entityId);
      const buildingEntityId = decimalString(
        marker.buildingEntityId ?? marker.building_entity_id,
        `Regional public craft ${entityId} building id`,
      );
      const ownerEntityId = decimalString(
        marker.ownerEntityId ?? marker.owner_entity_id,
        `Regional public craft ${entityId} owner id`,
      );
      const craft = crafts.get(entityId);
      if (!craft) {
        warnings.push(`Regional public craft marker ${entityId} has no progressive_action_state row.`);
        complete = false;
        continue;
      }
      const craftBuildingEntityId = decimalString(
        craft.buildingEntityId ?? craft.building_entity_id,
        `Regional public craft ${entityId} detail building id`,
      );
      if (craftBuildingEntityId !== buildingEntityId) {
        warnings.push(
          `Regional public craft ${entityId} marker/detail building ids do not match (${buildingEntityId}/${craftBuildingEntityId}).`,
        );
        complete = false;
        continue;
      }
      const craftOwnerEntityId = decimalString(
        craft.ownerEntityId ?? craft.owner_entity_id,
        `Regional public craft ${entityId} detail owner id`,
      );
      if (craftOwnerEntityId !== ownerEntityId) {
        warnings.push(
          `Regional public craft ${entityId} marker/detail owner ids do not match (${ownerEntityId}/${craftOwnerEntityId}).`,
        );
        complete = false;
        continue;
      }
      const building = buildings.get(buildingEntityId);
      if (!building) {
        warnings.push(`Regional public craft ${entityId} has no building_state row for ${buildingEntityId}.`);
      }
      const claimEntityId = building
        ? decimalString(
            building.claimEntityId ?? building.claim_entity_id,
            `Regional public craft ${entityId} claim id`,
          )
        : null;
      const claim = claimEntityId ? claims.get(claimEntityId) : undefined;
      if (claimEntityId && !claim) {
        warnings.push(`Regional public craft ${entityId} has no claim_state row for ${claimEntityId}.`);
      }
      const username = usernames.get(ownerEntityId);
      if (!username) {
        missingCrafterUsernameCount += 1;
      }
      const buildingLocation = locations.get(buildingEntityId);
      const claimOwnerBuildingId = claim
        ? decimalString(
            claim.ownerBuildingEntityId ?? claim.owner_building_entity_id,
            `Regional public craft ${entityId} claim owner building id`,
          )
        : null;
      const claimLocation = claimOwnerBuildingId ? locations.get(claimOwnerBuildingId) : undefined;
      const nickname = buildingNicknames.get(buildingEntityId);

      craftResults.push({
        entityId,
        buildingEntityId,
        buildingDescriptionId: building
          ? decimalString(
              building.buildingDescriptionId ?? building.building_description_id,
              `Regional public craft ${entityId} building description id`,
            )
          : null,
        buildingNickname: nickname ? String(nickname.nickname ?? "") : null,
        buildingLocationX: buildingLocation
          ? integer(buildingLocation.x, `Regional public craft ${entityId} building location x`)
          : null,
        buildingLocationZ: buildingLocation
          ? integer(buildingLocation.z, `Regional public craft ${entityId} building location z`)
          : null,
        claimEntityId,
        claimName: claim ? String(claim.name ?? "") : "",
        claimLocationX: claimLocation
          ? integer(claimLocation.x, `Regional public craft ${entityId} claim location x`)
          : null,
        claimLocationZ: claimLocation
          ? integer(claimLocation.z, `Regional public craft ${entityId} claim location z`)
          : null,
        claimDimension: claimLocation
          ? decimalString(
              claimLocation.dimension,
              `Regional public craft ${entityId} claim location dimension`,
            )
          : null,
        ownerEntityId,
        ownerUsername: username ? String(username.username ?? "") : "",
        recipeId: decimalString(
          craft.recipeId ?? craft.recipe_id,
          `Regional public craft ${entityId} recipe id`,
        ),
        progress: decimalString(
          craft.progress ?? 0,
          `Regional public craft ${entityId} progress`,
        ),
        craftCount: decimalString(
          craft.craftCount ?? craft.craft_count ?? 0,
          `Regional public craft ${entityId} craft count`,
        ),
        preparation: craft.preparation === true,
        completed: false,
        isPublic: true,
        regionId,
      });
    } catch (error) {
      complete = false;
      warnings.push(
        `Regional public_progressive_action_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (missingCrafterUsernameCount > 0) {
    warnings.push(`Regional public crafts missing crafter usernames: ${missingCrafterUsernameCount}.`);
  }
  craftResults.sort((left, right) => String(left.entityId).localeCompare(String(right.entityId)));
  return { data: { craftResults }, complete, warnings };
}

export function normalizeRegionalMarket(options: {
  claimId: string;
  regionId: string;
  sellRows: unknown[];
  buyRows: unknown[];
  closedRows?: unknown[];
  usernameRows: unknown[];
  marketplaceRows: unknown[];
}) {
  const claimId = decimalString(options.claimId, "regional market claim id");
  const regionId = decimalString(options.regionId, "regional market region id");
  const warnings: string[] = [];
  const usernames = new Map<string, WireRecord>();
  for (const [index, value] of options.usernameRows.entries()) {
    try {
      const row = record(value, `Regional player_username_state row ${index}`);
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `Regional player_username_state row ${index} entity id`,
      );
      if (!usernames.has(entityId)) usernames.set(entityId, row);
    } catch (error) {
      warnings.push(
        `Regional player_username_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const marketplaces: Array<Record<string, unknown>> = [];
  for (const [index, value] of options.marketplaceRows.entries()) {
    try {
      const row = record(value, `Regional marketplace_state row ${index}`);
      const rowClaimId = decimalString(
        row.claimEntityId ?? row.claim_entity_id,
        `Regional marketplace_state row ${index} claim id`,
      );
      if (rowClaimId !== claimId) {
        warnings.push(
          `Regional marketplace_state omitted cross-claim row for claim ${rowClaimId}.`,
        );
        continue;
      }
      const coordinates = record(
        row.coordinates,
        `Regional marketplace_state row ${index} coordinates`,
      );
      marketplaces.push({
        buildingEntityId: decimalString(
          row.buildingEntityId ?? row.building_entity_id,
          `Regional marketplace_state row ${index} building id`,
        ),
        claimEntityId: rowClaimId,
        locationX: integer(coordinates.x, `Regional marketplace_state row ${index} x`),
        locationZ: integer(coordinates.z, `Regional marketplace_state row ${index} z`),
        dimension: decimalString(
          coordinates.dimension,
          `Regional marketplace_state row ${index} dimension`,
        ),
      });
    } catch (error) {
      warnings.push(
        `Regional marketplace_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  marketplaces.sort((left, right) => (
    String(left.buildingEntityId).localeCompare(String(right.buildingEntityId))
  ));
  const location = marketplaces[0] ?? null;

  function marketTimestamp(row: WireRecord, label: string): string {
    const value = record(row.timestamp, `${label} timestamp`);
    return normalizeTimestamp(
      decimalString(
        value.__timestamp_micros_since_unix_epoch__
          ?? value.microsSinceUnixEpoch
          ?? value.micros_since_unix_epoch,
        `${label} timestamp micros`,
      ),
      "microseconds",
    );
  }

  const listings: Array<Record<string, unknown>> = [];
  function appendOrders(values: unknown[], side: "sell" | "buy") {
    for (const [index, value] of values.entries()) {
      try {
        const row = record(value, `Regional ${side}_order_state row ${index}`);
        const entityId = decimalString(
          row.entityId ?? row.entity_id,
          `Regional ${side}_order_state row ${index} entity id`,
        );
        const rowClaimId = decimalString(
          row.claimEntityId ?? row.claim_entity_id,
          `Regional market order ${entityId} claim id`,
        );
        if (rowClaimId !== claimId) {
          warnings.push(
            `Regional ${side}_order_state omitted cross-claim order ${entityId} for claim ${rowClaimId}.`,
          );
          continue;
        }
        const ownerEntityId = decimalString(
          row.ownerEntityId ?? row.owner_entity_id,
          `Regional market order ${entityId} owner id`,
        );
        const username = usernames.get(ownerEntityId);
        if (!username) {
          warnings.push(
            `Regional market order ${entityId} has no player_username_state row for ${ownerEntityId}.`,
          );
        }
        const itemTypeValue = integer(
          row.itemType ?? row.item_type,
          `Regional market order ${entityId} item type`,
        );
        if (itemTypeValue !== 0 && itemTypeValue !== 1) {
          throw new TypeError(
            `Regional market order ${entityId} item type must be 0 or 1.`,
          );
        }
        const price = decimalString(
          row.priceThreshold ?? row.price_threshold,
          `Regional market order ${entityId} price`,
        );
        listings.push({
          entityId,
          claimEntityId: rowClaimId,
          regionId,
          ownerEntityId,
          ownerUsername: username ? String(username.username ?? "") : "",
          itemId: decimalString(
            row.itemId ?? row.item_id,
            `Regional market order ${entityId} item id`,
          ),
          itemType: itemTypeValue === 1 ? "cargo" : "item",
          price,
          priceThreshold: price,
          quantity: decimalString(
            row.quantity,
            `Regional market order ${entityId} quantity`,
          ),
          storedCoins: decimalString(
            row.storedCoins ?? row.stored_coins ?? 0,
            `Regional market order ${entityId} stored coins`,
          ),
          side,
          timestamp: marketTimestamp(row, `Regional market order ${entityId}`),
          locationX: location?.locationX ?? null,
          locationZ: location?.locationZ ?? null,
        });
      } catch (error) {
        warnings.push(
          `Regional ${side}_order_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  appendOrders(options.sellRows, "sell");
  appendOrders(options.buyRows, "buy");

  const closedListings: Array<Record<string, unknown>> = [];
  for (const [index, value] of (options.closedRows ?? []).entries()) {
    try {
      const row = record(value, `Regional closed_listing_state row ${index}`);
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `Regional closed_listing_state row ${index} entity id`,
      );
      const rowClaimId = decimalString(
        row.claimEntityId ?? row.claim_entity_id,
        `Regional closed listing ${entityId} claim id`,
      );
      if (rowClaimId !== claimId) {
        warnings.push(
          `Regional closed_listing_state omitted cross-claim row ${entityId} for claim ${rowClaimId}.`,
        );
        continue;
      }
      const ownerEntityId = decimalString(
        row.ownerEntityId ?? row.owner_entity_id,
        `Regional closed listing ${entityId} owner id`,
      );
      const username = usernames.get(ownerEntityId);
      const stack = record(
        row.itemStack ?? row.item_stack,
        `Regional closed listing ${entityId} item stack`,
      );
      const itemId = decimalString(
        stack.itemId ?? stack.item_id,
        `Regional closed listing ${entityId} item id`,
      );
      const itemType = normalizeItemKind(enumLabel(stack.itemType ?? stack.item_type));
      closedListings.push({
        entityId,
        claimEntityId: rowClaimId,
        regionId,
        ownerEntityId,
        ownerUsername: username ? String(username.username ?? "") : "",
        itemId,
        itemType,
        quantity: decimalString(
          stack.quantity,
          `Regional closed listing ${entityId} quantity`,
        ),
        closureKind: itemType === "item" && itemId === "1"
          ? "sale_proceeds"
          : "returned_item",
        timestamp: marketTimestamp(row, `Regional closed listing ${entityId}`),
      });
    } catch (error) {
      warnings.push(
        `Regional closed_listing_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  closedListings.sort((left, right) => (
    String(left.entityId).localeCompare(String(right.entityId))
  ));
  if (!marketplaces.length) {
    warnings.push(`Regional market has no marketplace_state row for claim ${claimId}.`);
  }

  return {
    data: { claimId, regionId, marketplaces, listings, closedListings },
    warnings,
  };
}

export function normalizeRegionalOrders(options: {
  regionId: string;
  sellRows: unknown[];
  buyRows: unknown[];
  claimRows: unknown[];
  usernameRows: unknown[];
  marketplaceRows?: unknown[];
  warnOnMissingJoins?: boolean;
  warnOnMissingUsernames?: boolean;
}) {
  const regionId = decimalString(options.regionId, "regional buy-order region id");
  const warnings: string[] = [];

  function indexRows(values: unknown[], label: string): Map<string, WireRecord> {
    const indexed = new Map<string, WireRecord>();
    for (const [index, value] of values.entries()) {
      try {
        const row = record(value, `${label} row ${index}`);
        const entityId = decimalString(
          row.entityId ?? row.entity_id,
          `${label} row ${index} entity id`,
        );
        if (!indexed.has(entityId)) indexed.set(entityId, row);
      } catch (error) {
        warnings.push(
          `${label} omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return indexed;
  }

  const claims = indexRows(options.claimRows, "Regional claim_state");
  const usernames = indexRows(options.usernameRows, "Regional player_username_state");
  const marketplaces = new Map<string, {
    locationX: number;
    locationZ: number;
    dimension: string;
  }>();
  for (const [index, value] of (options.marketplaceRows ?? []).entries()) {
    try {
      const row = record(value, `Regional marketplace_state row ${index}`);
      const claimEntityId = decimalString(
        row.claimEntityId ?? row.claim_entity_id,
        `Regional marketplace_state row ${index} claim id`,
      );
      const coordinates = record(
        row.coordinates,
        `Regional marketplace_state row ${index} coordinates`,
      );
      if (!marketplaces.has(claimEntityId)) {
        marketplaces.set(claimEntityId, {
          locationX: integer(
            coordinates.x,
            `Regional marketplace_state row ${index} coordinate x`,
          ),
          locationZ: integer(
            coordinates.z,
            `Regional marketplace_state row ${index} coordinate z`,
          ),
          dimension: decimalString(
            coordinates.dimension,
            `Regional marketplace_state row ${index} dimension`,
          ),
        });
      }
    } catch (error) {
      warnings.push(
        `Regional marketplace_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const orders: Array<Record<string, unknown>> = [];
  function appendOrders(values: unknown[], side: "sell" | "buy") {
    for (const [index, value] of values.entries()) {
      try {
        const row = record(value, `Regional ${side}_order_state row ${index}`);
        const entityId = decimalString(
          row.entityId ?? row.entity_id,
          `Regional ${side}_order_state row ${index} entity id`,
        );
        const claimEntityId = decimalString(
          row.claimEntityId ?? row.claim_entity_id,
          `Regional ${side} order ${entityId} claim id`,
        );
        const ownerEntityId = decimalString(
          row.ownerEntityId ?? row.owner_entity_id,
          `Regional ${side} order ${entityId} owner id`,
        );
        const itemTypeValue = integer(
          row.itemType ?? row.item_type,
          `Regional ${side} order ${entityId} item type`,
        );
        if (itemTypeValue !== 0 && itemTypeValue !== 1) {
          throw new TypeError(
            `Regional ${side} order ${entityId} item type must be 0 or 1.`,
          );
        }
        const timestamp = record(
          row.timestamp,
          `Regional ${side} order ${entityId} timestamp`,
        );
        const claim = claims.get(claimEntityId);
        const username = usernames.get(ownerEntityId);
        const marketplace = marketplaces.get(claimEntityId);
        if (!claim && options.warnOnMissingJoins !== false) {
          warnings.push(
            `Regional ${side} order ${entityId} has no claim_state row for ${claimEntityId}.`,
          );
        }
        if (
          !username
          && options.warnOnMissingJoins !== false
          && options.warnOnMissingUsernames !== false
        ) {
          warnings.push(
            `Regional ${side} order ${entityId} has no player_username_state row for ${ownerEntityId}.`,
          );
        }
        const price = decimalString(
          row.priceThreshold ?? row.price_threshold,
          `Regional ${side} order ${entityId} price`,
        );
        orders.push({
          entityId,
          claimEntityId,
          claimName: claim ? String(claim.name ?? "") : "",
          regionId,
          ownerEntityId,
          ownerUsername: username ? String(username.username ?? "") : "",
          locationX: marketplace?.locationX ?? null,
          locationZ: marketplace?.locationZ ?? null,
          dimension: marketplace?.dimension ?? null,
          itemId: decimalString(
            row.itemId ?? row.item_id,
            `Regional ${side} order ${entityId} item id`,
          ),
          itemType: itemTypeValue === 1 ? "cargo" : "item",
          price,
          priceThreshold: price,
          quantity: decimalString(
            row.quantity,
            `Regional ${side} order ${entityId} quantity`,
          ),
          storedCoins: decimalString(
            row.storedCoins ?? row.stored_coins ?? 0,
            `Regional ${side} order ${entityId} stored coins`,
          ),
          timestamp: normalizeTimestamp(
            decimalString(
              timestamp.__timestamp_micros_since_unix_epoch__
                ?? timestamp.microsSinceUnixEpoch
                ?? timestamp.micros_since_unix_epoch,
              `Regional ${side} order ${entityId} timestamp micros`,
            ),
            "microseconds",
          ),
          side,
        });
      } catch (error) {
        warnings.push(
          `Regional ${side}_order_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  appendOrders(options.sellRows, "sell");
  appendOrders(options.buyRows, "buy");
  orders.sort((left, right) => {
    const leftId = BigInt(String(left.entityId));
    const rightId = BigInt(String(right.entityId));
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return { data: { orders }, warnings };
}

export function normalizeRegionalClosedListings(options: {
  regionId: string;
  closedRows: unknown[];
  claimRows: unknown[];
  usernameRows: unknown[];
  warnOnMissingJoins?: boolean;
  warnOnMissingUsernames?: boolean;
}) {
  const regionId = decimalString(options.regionId, "regional closed-listing region id");
  const warnings: string[] = [];

  function indexRows(values: unknown[], label: string): Map<string, WireRecord> {
    const indexed = new Map<string, WireRecord>();
    for (const [index, value] of values.entries()) {
      try {
        const row = record(value, `${label} row ${index}`);
        const entityId = decimalString(
          row.entityId ?? row.entity_id,
          `${label} row ${index} entity id`,
        );
        if (!indexed.has(entityId)) indexed.set(entityId, row);
      } catch (error) {
        warnings.push(
          `${label} omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return indexed;
  }

  const claims = indexRows(options.claimRows, "Regional closed-listing claim_state");
  const usernames = indexRows(
    options.usernameRows,
    "Regional closed-listing player_username_state",
  );
  const closedListings: Array<Record<string, unknown>> = [];
  for (const [index, value] of options.closedRows.entries()) {
    try {
      const row = record(value, `Regional closed_listing_state row ${index}`);
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `Regional closed_listing_state row ${index} entity id`,
      );
      const claimEntityId = decimalString(
        row.claimEntityId ?? row.claim_entity_id,
        `Regional closed listing ${entityId} claim id`,
      );
      const ownerEntityId = decimalString(
        row.ownerEntityId ?? row.owner_entity_id,
        `Regional closed listing ${entityId} owner id`,
      );
      const stack = record(
        row.itemStack ?? row.item_stack,
        `Regional closed listing ${entityId} item stack`,
      );
      const itemId = decimalString(
        stack.itemId ?? stack.item_id,
        `Regional closed listing ${entityId} item id`,
      );
      const itemType = normalizeItemKind(enumLabel(stack.itemType ?? stack.item_type));
      const timestamp = record(
        row.timestamp,
        `Regional closed listing ${entityId} timestamp`,
      );
      const claim = claims.get(claimEntityId);
      const username = usernames.get(ownerEntityId);
      if (!claim && options.warnOnMissingJoins !== false) {
        warnings.push(
          `Regional closed listing ${entityId} has no claim_state row for ${claimEntityId}.`,
        );
      }
      if (
        !username
        && options.warnOnMissingJoins !== false
        && options.warnOnMissingUsernames !== false
      ) {
        warnings.push(
          `Regional closed listing ${entityId} has no player_username_state row for ${ownerEntityId}.`,
        );
      }
      closedListings.push({
        entityId,
        claimEntityId,
        claimName: claim ? String(claim.name ?? "") : "",
        regionId,
        ownerEntityId,
        ownerUsername: username ? String(username.username ?? "") : "",
        itemId,
        itemType,
        quantity: decimalString(
          stack.quantity,
          `Regional closed listing ${entityId} quantity`,
        ),
        closureKind: itemType === "item" && itemId === "1"
          ? "sale_proceeds"
          : "returned_item",
        timestamp: normalizeTimestamp(
          decimalString(
            timestamp.__timestamp_micros_since_unix_epoch__
              ?? timestamp.microsSinceUnixEpoch
              ?? timestamp.micros_since_unix_epoch,
            `Regional closed listing ${entityId} timestamp micros`,
          ),
          "microseconds",
        ),
      });
    } catch (error) {
      warnings.push(
        `Regional closed_listing_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  closedListings.sort((left, right) => {
    const leftId = BigInt(String(left.entityId));
    const rightId = BigInt(String(right.entityId));
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
  return { data: { closedListings }, warnings };
}

export function normalizeRegionalStalls(options: {
  regionId: string;
  stallRows: unknown[];
  tradeOrderRows: unknown[];
  buildingRows: unknown[];
  buildingNicknameRows: unknown[];
  claimRows: unknown[];
  usernameRows: unknown[];
  locationRows: unknown[];
}) {
  const regionId = decimalString(options.regionId, "regional stall region id");
  const warnings: string[] = [];

  function indexRows(values: unknown[], label: string): Map<string, WireRecord> {
    const indexed = new Map<string, WireRecord>();
    for (const [index, value] of values.entries()) {
      try {
        const row = record(value, `${label} row ${index}`);
        const entityId = decimalString(
          row.entityId ?? row.entity_id,
          `${label} row ${index} entity id`,
        );
        if (!indexed.has(entityId)) indexed.set(entityId, row);
      } catch (error) {
        warnings.push(
          `${label} omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return indexed;
  }

  function normalizeStacks(
    values: unknown,
    cargoIds: unknown,
    label: string,
  ): Array<{ itemId: string; itemType: ItemKind; quantity: string }> {
    const totals = new Map<string, { itemId: string; itemType: ItemKind; quantity: bigint }>();
    const add = (itemId: string, itemType: ItemKind, quantity: string) => {
      const key = `${itemType}:${itemId}`;
      const current = totals.get(key);
      if (current) current.quantity += BigInt(quantity);
      else totals.set(key, { itemId, itemType, quantity: BigInt(quantity) });
    };
    for (const [index, value] of (Array.isArray(values) ? values : []).entries()) {
      const stack = record(value, `${label} item ${index}`);
      add(
        decimalString(stack.itemId ?? stack.item_id, `${label} item ${index} id`),
        normalizeItemKind(enumLabel(stack.itemType ?? stack.item_type)),
        decimalString(stack.quantity, `${label} item ${index} quantity`),
      );
    }
    for (const [index, value] of (Array.isArray(cargoIds) ? cargoIds : []).entries()) {
      add(decimalString(value, `${label} cargo ${index} id`), "cargo", "1");
    }
    return [...totals.values()].map((entry) => ({
      itemId: entry.itemId,
      itemType: entry.itemType,
      quantity: entry.quantity.toString(),
    }));
  }

  const stallsById = indexRows(options.stallRows, "Regional barter_stall_state");
  const buildings = indexRows(options.buildingRows, "Regional building_state");
  const nicknames = indexRows(
    options.buildingNicknameRows,
    "Regional building_nickname_state",
  );
  const claims = indexRows(options.claimRows, "Regional claim_state");
  const usernames = indexRows(options.usernameRows, "Regional player_username_state");
  const locations = indexRows(options.locationRows, "Regional location_state");
  const ordersByStall = new Map<string, Array<Record<string, unknown>>>();

  for (const [index, value] of options.tradeOrderRows.entries()) {
    try {
      const row = record(value, `Regional trade_order_state row ${index}`);
      const travelerOrderId = row.travelerTradeOrderId ?? row.traveler_trade_order_id;
      if (travelerOrderId != null) continue;
      const shopEntityId = decimalString(
        row.shopEntityId ?? row.shop_entity_id,
        `Regional trade order ${index} shop id`,
      );
      if (!stallsById.has(shopEntityId)) continue;
      const entityId = decimalString(
        row.entityId ?? row.entity_id,
        `Regional trade order ${index} entity id`,
      );
      const orders = ordersByStall.get(shopEntityId) ?? [];
      orders.push({
        entityId,
        remainingStock: decimalString(
          row.remainingStock ?? row.remaining_stock,
          `Regional trade order ${entityId} remaining stock`,
        ),
        offers: normalizeStacks(
          row.offerItems ?? row.offer_items,
          row.offerCargoId ?? row.offer_cargo_id,
          `Regional trade order ${entityId} offers`,
        ),
        requires: normalizeStacks(
          row.requiredItems ?? row.required_items,
          row.requiredCargoId ?? row.required_cargo_id,
          `Regional trade order ${entityId} requirements`,
        ),
      });
      ordersByStall.set(shopEntityId, orders);
    } catch (error) {
      warnings.push(
        `Regional trade_order_state omitted row ${index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const stalls = [...stallsById.entries()].map(([entityId, stall]) => {
    const building = buildings.get(entityId);
    const claimEntityId = building
      ? decimalString(
          building.claimEntityId ?? building.claim_entity_id,
          `Regional stall ${entityId} claim id`,
        )
      : null;
    const ownerEntityId = building
      ? decimalString(
          building.constructedByPlayerEntityId ?? building.constructed_by_player_entity_id,
          `Regional stall ${entityId} owner id`,
        )
      : null;
    const claim = claimEntityId ? claims.get(claimEntityId) : null;
    const username = ownerEntityId ? usernames.get(ownerEntityId) : null;
    const nickname = nicknames.get(entityId);
    const location = locations.get(entityId);
    const orders = ordersByStall.get(entityId) ?? [];
    orders.sort((left, right) => (
      BigInt(String(left.entityId)) < BigInt(String(right.entityId)) ? -1 : 1
    ));
    return {
      entityId,
      regionId,
      claimEntityId,
      claimName: claim ? String(claim.name ?? "") : "",
      ownerEntityId,
      ownerName: username ? String(username.username ?? "") : "",
      nickname: nickname ? String(nickname.nickname ?? "") : "",
      marketModeEnabled: stall.marketModeEnabled === true || stall.market_mode_enabled === true,
      locationX: location ? integer(location.x, `Regional stall ${entityId} location x`) : null,
      locationZ: location ? integer(location.z, `Regional stall ${entityId} location z`) : null,
      locationDimension: location
        ? decimalString(location.dimension, `Regional stall ${entityId} location dimension`)
        : null,
      orders,
    };
  });
  stalls.sort((left, right) => (
    BigInt(left.entityId) < BigInt(right.entityId) ? -1 : 1
  ));
  return { data: { stalls }, warnings };
}

export function normalizeRegionalBuyOrders(options: {
  regionId: string;
  buyRows: unknown[];
  claimRows: unknown[];
  usernameRows: unknown[];
}) {
  return normalizeRegionalOrders({ ...options, sellRows: [] });
}

export function normalizeClaimCrafts(value: unknown) {
  const payload = record(value, "Relay claim crafts payload");
  const crafts = Array.isArray(payload.crafts) ? payload.crafts : [];
  return {
    craftResults: crafts.map((value, craftIndex) => {
      const row = record(value, `Relay craft ${craftIndex}`);
      return {
        entityId: decimalString(row.entity_id, `crafts[${craftIndex}].entity_id`),
        buildingEntityId: decimalString(row.building_entity_id, `crafts[${craftIndex}].building_entity_id`),
        claimEntityId: decimalString(row.claim_entity_id, `crafts[${craftIndex}].claim_entity_id`),
        ownerEntityId: decimalString(row.owner_entity_id, `crafts[${craftIndex}].owner_entity_id`),
        ownerUsername: String(row.owner_username ?? ""),
        buildingName: String(row.building_name ?? ""),
        completed: row.completed === true,
        craftCount: decimalString(row.craft_count ?? 0, `crafts[${craftIndex}].craft_count`),
        progress: decimalString(row.progress ?? 0, `crafts[${craftIndex}].progress`),
        recipeId: decimalString(row.recipe_id, `crafts[${craftIndex}].recipe_id`),
        totalActionsRequired: decimalString(row.total_actions_required ?? 0, `crafts[${craftIndex}].total_actions_required`),
        craftedItem: (Array.isArray(row.crafted_item) ? row.crafted_item : []).map((value, stackIndex) => (
          normalizeStack(value, `crafts[${craftIndex}].crafted_item[${stackIndex}]`)
        )),
      };
    }),
    items: [],
    cargos: [],
  };
}

export function normalizeClaimCraftPayloads(values: unknown[]) {
  const craftResults = new Map<string, ReturnType<typeof normalizeClaimCrafts>["craftResults"][number]>();
  for (const value of values) {
    for (const craft of normalizeClaimCrafts(value).craftResults) {
      craftResults.set(craft.entityId, craft);
    }
  }
  return {
    craftResults: [...craftResults.values()],
    items: [],
    cargos: [],
  };
}

export function normalizeClaimRegion(value: unknown): string {
  return decimalString(record(value, "Relay claim").region, "claim.region");
}

export { decimalString as normalizeDecimalInteger, optionalDecimalString };
