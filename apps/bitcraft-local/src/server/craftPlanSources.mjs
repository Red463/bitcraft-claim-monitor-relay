import { craftDisplayName, isCompletedProductionJob, mergeCurrentCraftRows } from "./productionActivity.mjs";
import { bankSourceBelongsToPlayer, playerIdFromBankSourceId } from "../craftPlanBankIdentity.mjs";

const DEPLOYABLE_INVENTORY_NAME = /cart|stash|cache|deploy|housing|wagon|handcart|boat|ship|sled|mount/i;
const SETTLEMENT_STORAGE_INVENTORY_NAME = /town bank|settlement storage|claim storage|community storage|bank/i;
const PLAYER_BANK_INVENTORY_NAME = /town bank|settlement bank|claim bank|community bank|\bbank\b/i;
const PERSONAL_INVENTORY_NAME = /^(?:inventory|toolbelt|wallet)$/i;

function sourceItemKind(rawType) {
  if (rawType === "cargo" || rawType === 1 || rawType === "1") return "cargo";
  if (rawType === "item" || rawType === "items" || rawType === 0 || rawType === "0") return "items";
  return null;
}

export function sourceItemFromContents(contents, lookup = new Map(), { requireKnownType = false } = {}) {
  const itemId = String(contents?.item_id ?? contents?.itemId ?? "").trim();
  if (!itemId) return null;
  const rawType = contents?.item_type ?? contents?.itemType;
  const kind = sourceItemKind(rawType) ?? (requireKnownType ? null : "items");
  if (!kind) return null;
  const item = lookup.get(`${kind}:${itemId}`) ?? lookup.get(itemId) ?? {};
  const quantity = Number(contents?.quantity ?? contents?.qty ?? contents?.count ?? 0);
  return {
    id: itemId,
    kind,
    itemType: kind === "cargo" ? 1 : 0,
    quantity,
    name: item.name ?? contents?.name ?? `${kind === "cargo" ? "Cargo" : "Item"} #${itemId}`,
    tier: item.tier ?? contents?.tier ?? null,
    rarityStr: item.rarityStr ?? item.rarity ?? contents?.rarityStr ?? null,
    tag: item.tag ?? contents?.tag ?? null,
    iconAssetName: item.iconAssetName ?? contents?.iconAssetName ?? null,
  };
}

export function sourceItemsFromSlots(slots = [], lookup = new Map(), options = {}) {
  return (Array.isArray(slots) ? slots : []).map((slot) => sourceItemFromContents(slot?.contents ?? slot, lookup, options)).filter((item) => item && item.quantity > 0);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function craftPlanCatalogLookup(payload = {}) {
  const lookup = new Map();
  const addRows = (rows, kind) => {
    for (const item of rows) {
      const id = String(item.id ?? item.itemId ?? item.targetId ?? "").trim();
      if (!id) continue;
      lookup.set(`${kind}:${id}`, item);
      if (!lookup.has(id)) lookup.set(id, item);
    }
  };
  addRows([...asArray(payload.items), ...asArray(payload.data?.items)], "items");
  addRows([...asArray(payload.cargos), ...asArray(payload.data?.cargos)], "cargo");
  for (const [key, item] of Object.entries(payload.catalog ?? payload.data?.catalog ?? {})) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const [rawKind] = String(key).split(":", 1);
    const kind = rawKind === "cargo" ? "cargo" : "items";
    addRows([item], kind);
  }
  return lookup;
}

function craftOutputKind(value) {
  return value === "cargo" || value === 1 || value === "1" ? "cargo" : "items";
}

function craftOutputKey(kind, id) {
  return `${kind}:${String(id)}`;
}

function normalizedProbability(value) {
  const raw = Math.max(0, Number(value ?? 1));
  if (!Number.isFinite(raw)) return 0;
  return Math.min(1, raw > 1 ? raw / 100 : raw);
}

function detailPayload(detail) {
  return detail?.detail && typeof detail.detail === "object" ? detail.detail : detail;
}

function expectedPossibilityOutputs(detail, directOutputQuantity) {
  const grouped = new Map();
  for (const possibility of asArray(detailPayload(detail)?.itemListPossibilities)) {
    const display = possibility?.targetItem ?? {};
    const id = String(possibility?.targetId ?? display.id ?? possibility?.itemId ?? "").trim();
    if (!id) continue;
    const kind = craftOutputKind(possibility?.isCargo === true ? "cargo" : possibility?.itemType ?? possibility?.item_type);
    const quantity = Math.max(0, Number(possibility?.quantity ?? 0));
    const chance = normalizedProbability(possibility?.chance);
    const expectedQuantity = directOutputQuantity * quantity * chance;
    if (!Number.isFinite(expectedQuantity) || expectedQuantity <= 0) continue;
    const key = craftOutputKey(kind, id);
    const current = grouped.get(key) ?? {
      itemId: id,
      kind,
      name: display.name ?? possibility?.name ?? `${kind === "cargo" ? "Cargo" : "Item"} #${id}`,
      tier: display.tier ?? possibility?.tier ?? null,
      tag: display.tag ?? possibility?.tag ?? null,
      iconAssetName: display.iconAssetName ?? possibility?.iconAssetName ?? null,
      quantity: 0,
      explicitGuaranteedQuantity: 0,
      hasExplicitGuarantee: true,
      minimumQuantity: Number.POSITIVE_INFINITY,
      totalChance: 0,
    };
    current.quantity += expectedQuantity;
    const explicitGuarantee = possibility?.guaranteedQuantity ?? possibility?.guaranteed_quantity;
    current.hasExplicitGuarantee = current.hasExplicitGuarantee && explicitGuarantee != null && Number.isFinite(Number(explicitGuarantee));
    current.explicitGuaranteedQuantity += Math.max(0, Number(explicitGuarantee) || 0) * directOutputQuantity;
    current.minimumQuantity = Math.min(current.minimumQuantity, quantity);
    current.totalChance += chance;
    grouped.set(key, current);
  }
  return [...grouped.values()].map(({ explicitGuaranteedQuantity, hasExplicitGuarantee, minimumQuantity, totalChance, ...output }) => ({
    ...output,
    quantity: Math.round(output.quantity * 1_000_000) / 1_000_000,
    guaranteedQuantity: hasExplicitGuarantee
      ? explicitGuaranteedQuantity
      : totalChance >= 1 - 1e-9 && Number.isFinite(minimumQuantity) ? minimumQuantity * directOutputQuantity : 0,
  }));
}

function trackedCraftPlanOutputsFromPayloads(craftPayloads = [], detailsByKey = new Map()) {
  const payloads = Array.isArray(craftPayloads) ? craftPayloads : [craftPayloads];
  const craftsPayload = {
    items: payloads.flatMap((payload) => asArray(payload?.items)),
    cargos: payloads.flatMap((payload) => asArray(payload?.cargos)),
  };
  const catalog = new Map();
  for (const payload of payloads) {
    for (const [key, item] of craftPlanCatalogLookup(payload)) {
      if (String(key).includes(":")) catalog.set(key, item);
    }
  }
  const publicCrafts = asArray(payloads[0]?.craftResults);
  const playerCrafts = payloads.slice(1).flatMap((payload) => asArray(payload?.craftResults));
  const crafts = mergeCurrentCraftRows(publicCrafts, playerCrafts);

  return crafts.flatMap((craft) => {
    const playerId = String(craft.playerEntityId ?? craft.crafterEntityId ?? craft.crafterId ?? craft.ownerEntityId ?? craft.ownerId ?? craft.characterEntityId ?? "").trim();
    const playerName = String(craft.crafterName ?? craft.crafterUsername ?? craft.ownerUsername ?? craft.playerName ?? craft.userName ?? "").trim();
    const buildingName = String(craft.buildingName ?? craft.stationName ?? craft.craftingStationName ?? "").trim();
    const completed = craft.completed === true || isCompletedProductionJob(craft);
    const craftId = String(craft.entityId ?? craft.id ?? craft.craftEntityId ?? "").trim();
    return asArray(craft.craftedItem ?? craft.craftedItems).flatMap((output, index) => {
      const itemId = String(output.item_id ?? output.itemId ?? output.id ?? "").trim();
      if (!itemId) return [];
      const kind = craftOutputKind(output.item_type ?? output.itemType);
      const item = catalog.get(craftOutputKey(kind, itemId)) ?? {};
      const outputPerCraft = Number(output.quantity ?? output.qty ?? 1) || 1;
      const craftCount = Number(craft.craftCount ?? 0);
      const directQuantity = craftCount > 0 ? craftCount * outputPerCraft : outputPerCraft;
      const base = {
        id: craftId || `${itemId}:${index}`,
        craftId: craftId || `${itemId}:${index}`,
        playerId,
        playerName,
        buildingName,
        status: completed ? "Ready to collect" : "In progress",
        completed,
      };
      const directOutput = {
        ...base,
        itemId,
        kind,
        quantity: directQuantity,
        guaranteedQuantity: directQuantity,
        name: item.name ?? craftDisplayName(craft, craftsPayload),
        iconAssetName: item.iconAssetName ?? null,
        tier: item.tier ?? null,
        tag: item.tag ?? null,
      };
      const possibilities = expectedPossibilityOutputs(detailsByKey.get(craftOutputKey(kind, itemId)), directQuantity)
        .map((possibility) => ({ ...base, ...possibility }));
      return [directOutput, ...possibilities];
    });
  }).filter((item) => item.itemId && item.quantity > 0);
}

function craftClaimId(craft) {
  return String(
    craft?.claimEntityId
      ?? craft?.claim_entity_id
      ?? craft?.claim?.entityId
      ?? craft?.claim?.id
      ?? craft?.claimId
      ?? "",
  ).trim();
}

export function trackedCraftPlanOutputs(craftPayloads = [], detailsByKey = new Map(), monitoredClaimId = "") {
  const expectedClaimId = String(monitoredClaimId).trim();
  if (!expectedClaimId) return [];
  const payloads = Array.isArray(craftPayloads) ? craftPayloads : [craftPayloads];
  const scopedPayloads = payloads.map((payload) => ({
    ...payload,
    craftResults: asArray(payload?.craftResults)
      .filter((craft) => craftClaimId(craft) === expectedClaimId),
  }));
  return trackedCraftPlanOutputsFromPayloads(scopedPayloads, detailsByKey);
}

function craftOwnerId(craft) {
  return String(
    craft?.ownerEntityId
      ?? craft?.playerEntityId
      ?? craft?.crafterEntityId
      ?? craft?.ownerId
      ?? "",
  ).trim();
}

function craftCompleted(craft) {
  return craft?.completed === true || isCompletedProductionJob(craft);
}

export function trackedRelayCraftPlanOutputs(
  craftPayload = {},
  detailsByKey = new Map(),
  monitoredClaimId = "",
  trackedPlayerIds = [],
) {
  const expectedClaimId = String(monitoredClaimId).trim();
  if (!expectedClaimId) return [];
  const trackedPlayers = new Set(asArray(trackedPlayerIds).map(String));
  const claimCrafts = asArray(craftPayload?.craftResults)
    .filter((craft) => craftClaimId(craft) === expectedClaimId);
  const ordinaryCrafts = claimCrafts.filter((craft) => (
    craft?.isPassive === false
    && (!craftCompleted(craft) || trackedPlayers.has(craftOwnerId(craft)))
  ));
  const passiveCrafts = claimCrafts.filter((craft) => (
    craft?.isPassive === true
    && trackedPlayers.has(craftOwnerId(craft))
  ));
  const ordinaryOutputs = trackedCraftPlanOutputsFromPayloads([{
    ...craftPayload,
    craftResults: ordinaryCrafts,
  }], detailsByKey);
  const passiveOutputs = trackedCraftPlanOutputsFromPayloads([
    { craftResults: [] },
    { ...craftPayload, craftResults: passiveCrafts },
  ], detailsByKey).map((output) => ({
    ...output,
    passive: true,
    sourceType: "Passive craft",
    locationUnknown: !String(output.buildingName ?? "").trim(),
    status: output.completed ? "Passive craft ready to collect" : "Passive craft in progress",
  }));
  return [...ordinaryOutputs, ...passiveOutputs];
}

function passiveCraftStatus(craft) {
  return String(craft?.status ?? craft?.state ?? "").trim().toLowerCase();
}

export function trackedPassiveCraftPlanOutputs(passiveSources = [], detailsByKey = new Map()) {
  const payloads = asArray(passiveSources).map((source) => ({
    ...(source?.payload ?? {}),
    craftResults: asArray(source?.payload?.craftResults).flatMap((craft, index) => {
      const status = passiveCraftStatus(craft);
      if (status !== "processing" && status !== "complete") return [];
      const rawId = String(craft?.entityId ?? craft?.id ?? `${status}:${index}`).trim();
      return [{
        ...craft,
        entityId: `passive:${String(source?.playerId ?? "unknown")}:${rawId}`,
        ownerEntityId: craft?.ownerEntityId ?? source?.playerId,
        ownerUsername: craft?.ownerUsername ?? source?.playerName,
        completed: status === "complete",
        status,
      }];
    }),
  }));

  return trackedCraftPlanOutputsFromPayloads([{ craftResults: [] }, ...payloads], detailsByKey).map((output) => ({
    ...output,
    passive: true,
    sourceType: "Passive craft",
    locationUnknown: true,
    status: output.completed ? "Passive craft ready to collect" : "Passive craft in progress",
  }));
}

export function settlementStorageSourcesFromInventories(inventories = {}, allowedIds = []) {
  const allowed = new Set(allowedIds.map(String));
  const lookup = craftPlanCatalogLookup(inventories);
  const directBuildings = asArray(inventories.buildings);
  const buildings = directBuildings.length ? directBuildings : asArray(inventories.data?.buildings);
  return buildings.map((building) => {
    const sourceId = String(building.entityId ?? building.id ?? building.buildingName ?? "").trim();
    return {
      sourceId,
      label: [building.buildingNickname, building.nickname, building.buildingName, building.name]
        .map((value) => String(value ?? "").trim())
        .find(Boolean) ?? (sourceId || "Settlement storage"),
      type: "Settlement storage",
      items: sourceItemsFromSlots(building.inventory, lookup),
    };
  }).filter((source) => source.sourceId && (!allowed.size || allowed.has(source.sourceId)));
}

export function playerInventoryRows(payload = {}) {
  if (Array.isArray(payload.inventories)) return payload.inventories;
  if (Array.isArray(payload.data?.inventories)) return payload.data.inventories;
  if (Array.isArray(payload.inventory)) return payload.inventory;
  if (Array.isArray(payload.data?.inventory)) return payload.data.inventory;
  return [];
}

export function selectedPlayerInventoryIds(sourceRules = {}) {
  return [...new Set([
    ...(Array.isArray(sourceRules.playerIds) ? sourceRules.playerIds : []),
    ...(Array.isArray(sourceRules.bankPlayerIds) ? sourceRules.bankPlayerIds : []),
    ...(Array.isArray(sourceRules.bankContainerIds) ? sourceRules.bankContainerIds : [])
      .map(playerIdFromBankSourceId),
    ...(Array.isArray(sourceRules.deployableContainerIds) ? sourceRules.deployableContainerIds : [])
      .map((sourceId) => String(sourceId).split(":", 1)[0]),
  ].map(String).map((value) => value.trim()).filter(Boolean))];
}

export function filterSelectedPlayerBankSources(sourceRules = {}, sources = []) {
  const exactIds = new Set((Array.isArray(sourceRules.bankContainerIds) ? sourceRules.bankContainerIds : []).map(String));
  const exactPlayerIds = new Set([...exactIds].map(playerIdFromBankSourceId));
  const legacyPlayerIds = new Set((Array.isArray(sourceRules.bankPlayerIds) ? sourceRules.bankPlayerIds : []).map(String));
  return (Array.isArray(sources) ? sources : []).filter((source) => {
    const sourceId = String(source?.sourceId ?? "");
    const playerId = String(source?.playerId ?? "");
    return exactIds.has(sourceId) || (!exactPlayerIds.has(playerId) && legacyPlayerIds.has(playerId));
  });
}

export function isSettlementStorageInventory(inventory = {}, inventoryName = "") {
  const name = String(inventoryName || inventory.inventoryName || inventory.name || inventory.type || "Inventory").trim();
  return SETTLEMENT_STORAGE_INVENTORY_NAME.test(name);
}

export function isPlayerBankInventory(inventory = {}, inventoryName = "") {
  const name = String(inventoryName || inventory.inventoryName || inventory.name || inventory.type || "").trim();
  return PLAYER_BANK_INVENTORY_NAME.test(name);
}

export function isPlayerDeployableInventory(inventory = {}, inventoryName = "") {
  const name = String(inventoryName || inventory.inventoryName || inventory.name || inventory.type || "Inventory").trim();
  if (PERSONAL_INVENTORY_NAME.test(name)) return false;
  if (isSettlementStorageInventory(inventory, name)) return false;
  if (DEPLOYABLE_INVENTORY_NAME.test(name)) return true;
  if (inventory.deployable) return true;
  return false;
}

function deployableKind(inventoryName) {
  const name = String(inventoryName ?? "").trim();
  if (/personal\s+(cache|stash)|cache|stash/i.test(name)) return "Personal Cache";
  if (/wagon/i.test(name)) return "Wagon";
  if (/handcart/i.test(name)) return "Handcart";
  if (/\bcart\b/i.test(name)) return "Cart";
  if (/boat|ship/i.test(name)) return "Boat";
  if (/sled/i.test(name)) return "Sled";
  if (/mount/i.test(name)) return "Mount";
  if (/housing/i.test(name)) return "Housing Storage";
  if (/deploy/i.test(name)) return "Deployable Storage";
  return name || "Deployable Storage";
}

function isCartLikeDeployableKind(kind) {
  return kind === "Cart" || kind === "Wagon" || kind === "Handcart";
}

function deployableSourceId(playerId, rawId, kind) {
  return isCartLikeDeployableKind(kind) ? `${playerId}:cart` : `${playerId}:${rawId}`;
}

function deployableLabel(inventoryName, claimName) {
  const kind = deployableKind(inventoryName);
  if (isCartLikeDeployableKind(kind)) return "Cart";
  const roman = String(inventoryName ?? "").match(/\(([^)]+)\)/)?.[1];
  const suffix = roman && !kind.includes(roman) ? ` (${roman})` : "";
  const claim = String(claimName ?? "").trim();
  return `${kind}${suffix}${claim ? ` - ${claim}` : ""}`;
}

function playerBankLabel(inventoryName, claimName) {
  const bank = String(inventoryName ?? "Town Bank").trim() || "Town Bank";
  const claim = String(claimName ?? "").trim();
  return claim ? `${bank} — ${claim}` : bank;
}

function emptyCartDeployableSource(playerId, label) {
  return {
    sourceId: `${playerId}:cart`,
    legacySourceIds: [],
    label: "Cart",
    type: "Player deployable",
    playerId: String(playerId),
    playerName: String(label),
    containerName: "Cart",
    containerKind: "Cart",
    claimName: null,
    items: [],
  };
}

export function playerInventoryContainerSources(playerId, label, payload = {}, allowedDeployableIds = []) {
  const allowedDeployables = new Set(allowedDeployableIds.map(String));
  const lookup = craftPlanCatalogLookup(payload);
  const personalItems = [];
  const banksById = new Map();
  const deployables = [];
  for (const inventory of playerInventoryRows(payload)) {
    const inventoryName = String(inventory.inventoryName ?? inventory.name ?? inventory.type ?? "Inventory").trim() || "Inventory";
    const explicitId = String(inventory.entityId ?? inventory.inventoryId ?? inventory.id ?? "").trim();
    const rawId = explicitId || inventoryName;
    const rawSourceId = `${playerId}:${rawId}`;
    if (isPlayerBankInventory(inventory, inventoryName)) {
      if (!explicitId) continue;
      const items = sourceItemsFromSlots([...asArray(inventory.pockets), ...asArray(inventory.inventory)], lookup, { requireKnownType: true });
      if (!banksById.has(rawSourceId)) {
        const claimName = String(inventory.claimName ?? inventory.claim?.name ?? "").trim();
        banksById.set(rawSourceId, {
          sourceId: rawSourceId,
          label: playerBankLabel(inventoryName, claimName),
          type: "Player bank",
          playerId: String(playerId),
          playerName: String(label),
          containerName: inventoryName,
          claimName: claimName || null,
          items,
        });
      }
      continue;
    }
    const items = sourceItemsFromSlots([...asArray(inventory.pockets), ...asArray(inventory.inventory)], lookup);
    if (isSettlementStorageInventory(inventory, inventoryName)) continue;
    if (isPlayerDeployableInventory(inventory, inventoryName)) {
      const claimName = String(inventory.claimName ?? "").trim();
      const containerKind = deployableKind(inventoryName);
      const sourceId = deployableSourceId(playerId, rawId, containerKind);
      deployables.push({
        sourceId,
        legacySourceIds: sourceId === rawSourceId ? [] : [rawSourceId],
        label: deployableLabel(inventoryName, claimName),
        type: "Player deployable",
        playerId: String(playerId),
        playerName: String(label),
        containerName: inventoryName,
        containerKind,
        claimName: claimName || null,
        items,
      });
    } else {
      personalItems.push(...items);
    }
  }
  if (!deployables.some((source) => source.sourceId === `${playerId}:cart`)) {
    deployables.unshift(emptyCartDeployableSource(playerId, label));
  }
  return {
    inventory: { sourceId: playerId, label: `${label} inventory`, type: "Player inventory", playerId: String(playerId), playerName: String(label), items: personalItems },
    banks: [...banksById.values()],
    deployables: deployables.filter((source) => !allowedDeployables.size || allowedDeployables.has(source.sourceId) || source.legacySourceIds?.some((id) => allowedDeployables.has(id))),
    deployableOptions: deployables.map((source) => ({ ...source, itemCount: source.items.length, items: source.items.slice(0, 12) })),
  };
}

export function playerBankOptions(playerId, label, payload = {}, trackedSourceIds = []) {
  const banks = playerInventoryContainerSources(playerId, label, payload).banks.map((source) => ({
    ...source,
    itemCount: source.items.length,
  }));
  const knownIds = new Set(banks.map((source) => source.sourceId));
  for (const sourceId of trackedSourceIds.map(String).filter((id) => bankSourceBelongsToPlayer(id, playerId))) {
    if (knownIds.has(sourceId)) continue;
    banks.push({
      sourceId,
      label: sourceId,
      type: "Player bank",
      playerId: String(playerId),
      playerName: String(label),
      containerName: "Tracked bank",
      claimName: null,
      unavailable: true,
      items: [],
      itemCount: 0,
    });
  }
  return banks;
}
