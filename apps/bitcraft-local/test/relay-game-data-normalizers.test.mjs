import assert from "node:assert/strict";
import test from "node:test";

const {
  normalizeClaim,
  normalizeClaimPayload,
  normalizeDeposit,
  normalizeDeposits,
  normalizeClaimCrafts,
  normalizeClaimCraftPayloads,
  normalizeClaimInventory,
  normalizeCatalogDescription,
  normalizeCatalogEntity,
  normalizeItemKind,
  normalizeMembers,
  normalizeMembersPayload,
  normalizePlayerHousing,
  normalizePlayerInventory,
  normalizeCitizensPayload,
  normalizeRegionalEquipment,
  normalizeRegionalBankInventories,
  normalizeRegionalEmpires,
  normalizeRegionalEmpireHexite,
  normalizeRegionalConstruction,
  normalizeRegionalClaims,
  normalizeRegionalPlayers,
  normalizeRegionalRecruitment,
  normalizeRegionalResearch,
  normalizeGlobalEmpireFoundries,
  normalizeGlobalRegions,
  normalizeStorageLogs,
  normalizeTimestamp,
} = await import(new URL("../src/server/game-data/normalizers.ts", import.meta.url).href);

test("regional Town Bank inventories join through the bank building and preserve personal item identities", () => {
  assert.deepEqual(normalizeRegionalBankInventories({
    claimId: "1369094286777412590",
    members: [
      { playerEntityId: "101", userName: "Ada" },
      { playerEntityId: "202", userName: "Grace" },
    ],
    bankRows: [
      { buildingEntityId: 7001n, claimEntityId: 1369094286777412590n },
      { buildingEntityId: 7999n, claimEntityId: 999n },
    ],
    inventoryRows: [{
      entityId: 8001n,
      ownerEntityId: 7001n,
      playerOwnerEntityId: 101n,
      inventoryIndex: 4,
      cargoIndex: 5,
      pockets: [
        { volume: 1, contents: null, locked: false },
        {
          volume: 10,
          contents: {
            itemId: 42,
            quantity: 7,
            itemType: { tag: "Item", value: {} },
            durability: null,
          },
          locked: false,
        },
        {
          volume: 20,
          contents: {
            itemId: 42,
            quantity: 3,
            itemType: { tag: "Cargo", value: {} },
            durability: null,
          },
          locked: true,
        },
      ],
    }, {
      entityId: 8999n,
      ownerEntityId: 7999n,
      playerOwnerEntityId: 202n,
      inventoryIndex: 1,
      cargoIndex: 2,
      pockets: [],
    }],
  }), {
    data: {
      buildings: [{
        entityId: "8001",
        buildingEntityId: "7001",
        playerOwnerEntityId: "101",
        playerOwnerName: "Ada",
        name: "Town Bank — Ada",
        nickname: "Town Bank — Ada",
        category: "town-bank",
        inventoryIndex: 4,
        cargoIndex: 5,
        items: [
          { itemId: "42", itemType: "item", quantity: "7" },
          { itemId: "42", itemType: "cargo", quantity: "3" },
        ],
        inventory: [
          {
            slot: 1,
            locked: false,
            contents: { itemId: "42", itemType: "item", quantity: "7" },
          },
          {
            slot: 2,
            locked: true,
            contents: { itemId: "42", itemType: "cargo", quantity: "3" },
          },
        ],
      }],
    },
    warnings: ["Regional bank_state omitted cross-claim bank 7999 for claim 999."],
  });
});

test("regional empires retain exact identities and join proven attacker and defender siege roles", () => {
  assert.deepEqual(normalizeRegionalEmpires({
    regionId: "19",
    worldRegionRows: [{
      id: 0,
      regionIndex: 19,
      regionMinChunkX: 240,
      regionMinChunkZ: 240,
      regionWidthChunks: 80,
      regionHeightChunks: 80,
      regionCount: 25,
      regionCountSqrt: 5,
    }],
    empireRows: [{
      entityId: 9007199254740993n,
      capitalBuildingEntityId: 1369094286778488967n,
      name: "Timbersteel Empire",
      shardTreasury: 4_294_967_295,
      nobilityThreshold: 5000,
      numClaims: 1,
      location: { x: -42, z: 77, dimension: 1n },
      empireCurrencyTreasury: 123456,
      ownerType: { tag: "Player" },
    }],
    playerRows: [{
      entityId: 1224979098736429551n,
      empireEntityId: 9007199254740993n,
      rank: 0,
      donatedShards: 987,
      donatedEmpireCurrency: 654,
    }],
    playerStateRows: [{
      entityId: 1224979098736429551n,
      signedIn: true,
      signInTimestamp: 1785430800,
      timePlayed: 86400,
    }],
    rankRows: [{
      entityId: 9007199254741000n,
      empireEntityId: 9007199254740993n,
      rank: 0,
      title: "Emperor",
      permissions: [true, false, true],
    }],
    settlementRows: [{
      buildingEntityId: 1369094286778488967n,
      claimEntityId: 1369094286777412590n,
      empireEntityId: 9007199254740993n,
      chunkIndex: 241241n,
      canHouseEmpireStorehouse: true,
      membersDonations: 1234,
      location: { x: -41, z: 76, dimension: 1n },
    }],
    nodeRows: [{
      entityId: 1369094286736703520n,
      empireEntityId: 9007199254740993n,
      chunkIndex: 242242n,
      energy: 9428,
      active: true,
      upkeep: 2,
      location: { x: 11, z: 22, dimension: 1n },
    }],
    siegeRows: [{
      entityId: 7000001n,
      buildingEntityId: 1369094286736703520n,
      empireEntityId: 8000001n,
      energy: 300,
      active: true,
      startTimestamp: { __timestamp_micros_since_unix_epoch__: 1785430800000000n },
    }],
    chunkRows: [
      { chunkIndex: 242242n, empireEntityId: 9007199254740993n, watchtowerEntityId: 1369094286736703520n },
      { chunkIndex: 243242n, empireEntityId: 9007199254740993n, watchtowerEntityId: 1369094286736703520n },
    ],
    claimRows: [{
      entityId: 1369094286777412590n,
      ownerPlayerEntityId: 1224979098736429551n,
      ownerBuildingEntityId: 1369094286778488967n,
      name: "Timbersteel Trade",
      neutral: false,
    }],
    claimMemberRows: [{
      entityId: 5000001n,
      claimEntityId: 1369094286777412590n,
      playerEntityId: 1224979098736429551n,
      userName: "Red463",
      inventoryPermission: true,
      buildPermission: true,
      officerPermission: true,
      coOwnerPermission: false,
    }],
    usernameRows: [{ entityId: 1224979098736429551n, username: "Red463" }],
    nicknameRows: [{ entityId: 1369094286736703520n, nickname: "North Watch" }],
  }), {
    data: {
      regionId: "19",
      empires: [{
        entityId: "9007199254740993",
        capitalBuildingEntityId: "1369094286778488967",
        name: "Timbersteel Empire",
        shardTreasury: "4294967295",
        nobilityThreshold: 5000,
        numClaims: 1,
        locationX: -42,
        locationZ: 77,
        locationDimension: "1",
        empireCurrencyTreasury: "123456",
        ownerType: "Player",
        memberCount: 1,
        settlementCount: 1,
        territoryChunks: 2,
      }],
      members: [{
        entityId: "1224979098736429551",
        empireEntityId: "9007199254740993",
        username: "Red463",
        rank: 0,
        rankTitle: "Emperor",
        permissions: [true, false, true],
        donatedShards: "987",
        donatedEmpireCurrency: "654",
        signedIn: true,
        lastLoginTimestamp: "2026-07-30T17:00:00.000Z",
        timePlayedSeconds: 86400,
      }],
      settlements: [{
        buildingEntityId: "1369094286778488967",
        claimEntityId: "1369094286777412590",
        empireEntityId: "9007199254740993",
        chunkIndex: "241241",
        canHouseEmpireStorehouse: true,
        membersDonations: "1234",
        locationX: -41,
        locationZ: 76,
        locationDimension: "1",
        claimName: "Timbersteel Trade",
        claimOwnerEntityId: "1224979098736429551",
        claimOwnerName: "Red463",
      }],
      claimMembers: [{
        entityId: "5000001",
        claimEntityId: "1369094286777412590",
        playerEntityId: "1224979098736429551",
        username: "Red463",
        inventoryPermission: true,
        buildPermission: true,
        officerPermission: true,
        coOwnerPermission: false,
      }],
      nodes: [{
        entityId: "1369094286736703520",
        empireEntityId: "9007199254740993",
        chunkIndex: "242242",
        energy: "9428",
        active: true,
        upkeep: "2",
        locationX: 11,
        locationZ: 22,
        locationDimension: "1",
        nickname: "North Watch",
        coveredChunks: 2,
        sieges: [{
          entityId: "7000001",
          buildingEntityId: "1369094286736703520",
          empireEntityId: "8000001",
          role: "attacker",
          defenderEmpireEntityId: "9007199254740993",
          energy: "300",
          active: true,
          startTimestamp: "2026-07-30T17:00:00.000Z",
        }],
      }],
    },
    warnings: [],
  });
});

test("regional empires scope settlement and watchtower rows with authoritative region geometry", () => {
  const normalized = normalizeRegionalEmpires({
    regionId: "19",
    worldRegionRows: [{
      id: 0,
      regionIndex: 19,
      regionMinChunkX: 240,
      regionMinChunkZ: 240,
      regionWidthChunks: 80,
      regionHeightChunks: 80,
      regionCount: 25,
      regionCountSqrt: 5,
    }],
    empireRows: [{
      entityId: 10n,
      capitalBuildingEntityId: 100n,
      name: "Local Empire",
      shardTreasury: 0,
      nobilityThreshold: 0,
      numClaims: 2,
      location: { x: 0, z: 0, dimension: 1n },
      empireCurrencyTreasury: 0,
      ownerType: { tag: "Player" },
    }],
    playerRows: [],
    playerStateRows: [],
    rankRows: [],
    settlementRows: [{
      buildingEntityId: 100n,
      claimEntityId: 101n,
      empireEntityId: 10n,
      chunkIndex: 241241n,
      canHouseEmpireStorehouse: false,
      membersDonations: 0,
      location: { x: 23136, z: 23136, dimension: 1n },
    }, {
      buildingEntityId: 200n,
      claimEntityId: 201n,
      empireEntityId: 10n,
      chunkIndex: 113241n,
      canHouseEmpireStorehouse: false,
      membersDonations: 0,
      location: { x: 23136, z: 10848, dimension: 1n },
    }],
    nodeRows: [{
      entityId: 300n,
      empireEntityId: 10n,
      chunkIndex: 242242n,
      energy: 10,
      active: true,
      upkeep: 1,
      location: { x: 23232, z: 23232, dimension: 1n },
    }, {
      entityId: 400n,
      empireEntityId: 10n,
      chunkIndex: 112242n,
      energy: 20,
      active: true,
      upkeep: 1,
      location: { x: 23232, z: 10752, dimension: 1n },
    }],
    siegeRows: [{
      entityId: 500n,
      buildingEntityId: 300n,
      empireEntityId: 11n,
      energy: 1,
      active: true,
    }, {
      entityId: 600n,
      buildingEntityId: 400n,
      empireEntityId: 12n,
      energy: 1,
      active: true,
    }],
    chunkRows: [{
      chunkIndex: 243242n,
      empireEntityId: 10n,
      watchtowerEntityId: 300n,
    }, {
      chunkIndex: 113242n,
      empireEntityId: 10n,
      watchtowerEntityId: 400n,
    }],
    claimRows: [{
      entityId: 101n,
      ownerPlayerEntityId: 1n,
      ownerBuildingEntityId: 100n,
      name: "Local Claim",
      neutral: false,
    }],
    claimMemberRows: [{
      entityId: 700n,
      claimEntityId: 101n,
      playerEntityId: 1n,
      userName: "Local Owner",
      inventoryPermission: true,
      buildPermission: true,
      officerPermission: true,
      coOwnerPermission: false,
    }],
    usernameRows: [],
    nicknameRows: [],
  });

  assert.deepEqual(normalized.data.settlements.map((row) => row.buildingEntityId), ["100"]);
  assert.equal(normalized.data.settlements[0].claimOwnerName, "Local Owner");
  assert.deepEqual(normalized.data.nodes.map((row) => row.entityId), ["300"]);
  assert.equal(normalized.data.nodes[0].coveredChunks, 1);
  assert.deepEqual(normalized.data.nodes[0].sieges.map((row) => row.entityId), ["500"]);
  assert.equal(normalized.data.empires[0].settlementCount, 1);
  assert.equal(normalized.data.empires[0].territoryChunks, 1);
});

test("regional empires fail closed when a current siege node has no owner identity", () => {
  assert.throws(() => normalizeRegionalEmpires({
    regionId: "19",
    worldRegionRows: [{
      id: 0,
      regionIndex: 19,
      regionMinChunkX: 240,
      regionMinChunkZ: 240,
      regionWidthChunks: 80,
      regionHeightChunks: 80,
    }],
    empireRows: [],
    playerRows: [],
    playerStateRows: [],
    rankRows: [],
    settlementRows: [],
    nodeRows: [{
      entityId: 300n,
      chunkIndex: 242242n,
      energy: 10,
      active: true,
      upkeep: 1,
      location: { x: 23232, z: 23232, dimension: 1n },
    }],
    siegeRows: [{
      entityId: 500n,
      buildingEntityId: 300n,
      empireEntityId: 11n,
      energy: 1,
      active: true,
    }],
    chunkRows: [],
    claimRows: [],
    claimMemberRows: [],
    usernameRows: [],
    nicknameRows: [],
  }), /Regional empire node 300 empire id must be a non-negative decimal integer string/);
});

test("regional claims join live claim state, local metrics, tier, owner, and coordinates exactly", () => {
  assert.deepEqual(normalizeRegionalClaims({
    regionId: "19",
    claimRows: [{
      entityId: 1369094286777412590n,
      ownerPlayerEntityId: 1224979098736429551n,
      ownerBuildingEntityId: 1369094286778488967n,
      name: "Timbersteel Trade",
      neutral: false,
    }, {
      entityId: 1369094286777412591n,
      ownerPlayerEntityId: 1224979098736429552n,
      ownerBuildingEntityId: 1369094286778488968n,
      name: "Neighbour",
      neutral: false,
    }],
    localRows: [{
      entityId: 1369094286777412590n,
      supplies: 12345,
      numTiles: 49,
      treasury: 987654,
      buildingDescriptionId: 6020,
      location: { x: -42, z: 77, dimension: 0n },
    }],
    claimTypeRows: [{ buildingId: 6020, tier: 6, radius: 7, claimType: { tag: "Settlement" } }],
    usernameRows: [{
      entityId: 1224979098736429551n,
      username: "Red463",
    }],
  }), {
    data: {
      regionId: "19",
      claims: [{
        entityId: "1369094286777412590",
        ownerPlayerEntityId: "1224979098736429551",
        ownerBuildingEntityId: "1369094286778488967",
        ownerPlayerUsername: "Red463",
        name: "Timbersteel Trade",
        neutral: false,
        supplies: 12345,
        treasury: "987654",
        numTiles: 49,
        tier: 6,
        locationX: -42,
        locationZ: 77,
        locationDimension: "0",
      }, {
        entityId: "1369094286777412591",
        ownerPlayerEntityId: "1224979098736429552",
        ownerBuildingEntityId: "1369094286778488968",
        ownerPlayerUsername: null,
        name: "Neighbour",
        neutral: false,
        supplies: null,
        treasury: null,
        numTiles: null,
        tier: null,
        locationX: null,
        locationZ: null,
        locationDimension: null,
      }],
    },
    warnings: [
      "Regional claim 1369094286777412591 has no claim_local_state row.",
      "Regional claims missing owner usernames: 1.",
    ],
  });
});

test("regional claims reject malformed required rows instead of replacing last-good data", () => {
  assert.throws(() => normalizeRegionalClaims({
    regionId: "19",
    claimRows: [{ entityId: "not-an-id" }],
    localRows: [],
    claimTypeRows: [],
    usernameRows: [],
  }), /claim_state row 0 entity id must be a non-negative decimal integer string/);

  assert.throws(() => normalizeRegionalClaims({
    regionId: "19",
    claimRows: [],
    localRows: [{ entityId: "not-an-id" }],
    claimTypeRows: [],
    usernameRows: [],
  }), /claim_local_state row 0 entity id must be a non-negative decimal integer string/);
});

test("normalizes Relay player housing without merging Item and Cargo identities", () => {
  assert.deepEqual(normalizePlayerHousing({
    player: { entity_id: "101", username: "Ada", region: 19, signed_in: true },
    house: { entity_id: "9001", name: "Ada's House", region: 19 },
    buildings: [{
      entity_id: "8001",
      name: "Wicker Storage",
      nickname: "Supplies",
      items: [
        { item_id: 42, item_type: "Item", quantity: 3 },
        { item_id: 42, item_type: "Cargo", quantity: 4 },
      ],
    }],
  }), {
    player: { entityId: "101", username: "Ada", regionId: "19", signedIn: true },
    house: { entityId: "9001", name: "Ada's House", regionId: "19" },
    buildings: [{
      entityId: "8001",
      name: "Wicker Storage",
      nickname: "Supplies",
      items: [
        { itemId: "42", itemType: "item", quantity: "3" },
        { itemId: "42", itemType: "cargo", quantity: "4" },
      ],
    }],
  });
});

test("regional recruitment preserves exact claim ownership and posting requirements", () => {
  assert.deepEqual(normalizeRegionalRecruitment({
    claimId: "1369094286777412590",
    stateRows: [{
      entityId: 1369094286821318198n,
      claimEntityId: 1369094286777412590n,
      remainingStock: 19,
      requiredSkillId: 1,
      requiredSkillLevel: 1,
      requiredApproval: false,
    }, {
      entityId: 9007199254740993n,
      claimEntityId: 999n,
      remainingStock: 4,
      requiredSkillId: 2,
      requiredSkillLevel: 10,
      requiredApproval: true,
    }],
  }), {
    data: {
      claimId: "1369094286777412590",
      isRecruiting: true,
      recruitment: [{
        entityId: "1369094286821318198",
        claimEntityId: "1369094286777412590",
        remainingStock: "19",
        requiredSkillId: "1",
        requiredSkillLevel: "1",
        requiredApproval: false,
        isRecruiting: true,
      }],
    },
    warnings: [
      "Regional claim_recruitment_state omitted cross-claim row 999.",
    ],
  });
});

test("regional recruitment treats no configured-claim row as authoritatively closed", () => {
  assert.deepEqual(normalizeRegionalRecruitment({
    claimId: "42",
    stateRows: [],
  }), {
    data: {
      claimId: "42",
      isRecruiting: false,
      recruitment: [],
    },
    warnings: [],
  });
});

test("regional research state preserves exact claim ownership and learned technology IDs", () => {
  const result = normalizeRegionalResearch({
    claimId: "1369094286777412590",
    stateRows: [{
      entityId: 1369094286777412590n,
      learned: [1, 200, 748616905],
      researching: 300,
      startTimestamp: {
        __timestamp_micros_since_unix_epoch__: 1785448800123456n,
      },
      scheduledId: 18446744073709551615n,
    }, {
      entityId: 999n,
      learned: [1],
      researching: 0,
      startTimestamp: {
        __timestamp_micros_since_unix_epoch__: 0n,
      },
      scheduledId: null,
    }],
  });

  assert.deepEqual(result, {
    data: {
      claimId: "1369094286777412590",
      learnedTechIds: ["1", "200", "748616905"],
      researchingTechId: "300",
      researchStartedAt: "2026-07-30T22:00:00.123Z",
      scheduledId: "18446744073709551615",
    },
    warnings: [
      "Regional claim_tech_state omitted cross-claim row 999.",
    ],
  });
});

test("regional research state treats zero as no current research and reports a missing claim row", () => {
  assert.deepEqual(normalizeRegionalResearch({
    claimId: "42",
    stateRows: [{
      entityId: 42n,
      learned: [],
      researching: 0,
      startTimestamp: {
        __timestamp_micros_since_unix_epoch__: 0n,
      },
      scheduledId: null,
    }],
  }), {
    data: {
      claimId: "42",
      learnedTechIds: [],
      researchingTechId: null,
      researchStartedAt: null,
      scheduledId: null,
    },
    warnings: [],
  });

  assert.deepEqual(normalizeRegionalResearch({
    claimId: "42",
    stateRows: [],
  }), {
    data: {
      claimId: "42",
      learnedTechIds: [],
      researchingTechId: null,
      researchStartedAt: null,
      scheduledId: null,
    },
    warnings: ["Regional claim_tech_state has no row for configured claim 42."],
  });
});

test("regional construction rows preserve exact claim ownership and contributed stacks", () => {
  const result = normalizeRegionalConstruction({
    claimId: "1369094286777412590",
    projectRows: [{
      entityId: 1369094286998704975n,
      constructionRecipeId: 442905423,
      resourcePlacementRecipeId: 0,
      items: [{
        itemId: 3090004,
        quantity: 5,
        itemType: { tag: "Item", value: {} },
      }],
      cargos: [{
        itemId: 1202,
        quantity: 4,
        itemType: { tag: "Cargo", value: {} },
      }],
      progress: 157,
      lastCritOutcome: 1,
      ownerId: 1369094286777412590n,
      direction: 2,
      lastHitTimestamp: {
        __timestamp_micros_since_unix_epoch__: 1785096910248578n,
      },
    }, {
      entityId: 999n,
      constructionRecipeId: 1,
      resourcePlacementRecipeId: 0,
      items: [],
      cargos: [],
      progress: 0,
      lastCritOutcome: 0,
      ownerId: 888n,
      direction: 0,
      lastHitTimestamp: {
        __timestamp_micros_since_unix_epoch__: 1785096910248578n,
      },
    }],
    buildingRows: [{
      entityId: 7001n,
      claimEntityId: 1369094286777412590n,
      directionIndex: 2,
      buildingDescriptionId: 6020,
      constructedByPlayerEntityId: 101n,
    }, {
      entityId: 7002n,
      claimEntityId: 888n,
      directionIndex: 0,
      buildingDescriptionId: 6022,
      constructedByPlayerEntityId: 202n,
    }],
  });

  assert.deepEqual(result, {
    data: {
      projects: [{
        entityId: "1369094286998704975",
        constructionRecipeId: "442905423",
        resourcePlacementRecipeId: "0",
        ownerId: "1369094286777412590",
        items: [{ itemId: "3090004", itemType: "item", quantity: "5" }],
        cargos: [{ itemId: "1202", itemType: "cargo", quantity: "4" }],
        progress: "157",
        lastCritOutcome: 1,
        direction: 2,
        lastHitAt: "2026-07-26T20:15:10.248Z",
      }],
      buildings: [{
        entityId: "7001",
        claimEntityId: "1369094286777412590",
        directionIndex: 2,
        buildingDescriptionId: "6020",
        constructedByPlayerEntityId: "101",
      }],
    },
    warnings: [
      "Regional project_site_state omitted cross-claim project 999 owned by 888.",
      "Regional building_state omitted cross-claim building 7002 owned by 888.",
    ],
  });
});

test("regional equipment and buff rows are decoded into member-scoped provider data", () => {
  const result = normalizeRegionalEquipment({
    members: [{ playerEntityId: "101", userName: "Ada" }],
    equipmentRows: [{
      entityId: 101n,
      equipmentSlots: [{
        primary: { tag: "HeadClothing" },
        item: { itemId: 42, itemType: { tag: "Item" }, quantity: 1, durability: 9007199254740993n },
      }],
    }],
    presetRows: [{
      entityId: 501n,
      playerEntityId: 101n,
      index: 1,
      active: true,
      equipmentSlots: [],
    }],
    buffRows: [{
      entityId: 101n,
      activeBuffs: [{
        buffId: 77,
        buffStartTimestamp: { value: 1785352200 },
        buffDuration: 3600,
        values: [1.5, 2],
      }],
    }],
  });

  assert.deepEqual(result, {
    data: {
      members: [{
        playerEntityId: "101",
        username: "Ada",
        equipment: {
          equipmentSlots: [{
            primary: "head_clothing",
            item: {
              id: "42",
              itemId: "42",
              itemType: "item",
              quantity: "1",
              durability: "9007199254740993",
            },
          }],
        },
        equipmentPresets: {
          presets: [{
            entityId: "501",
            index: 1,
            active: true,
            equipmentSlots: [],
          }],
        },
        buffs: {
          buffs: [{
            buffId: "77",
            startTimestampSeconds: "1785352200",
            startedAt: null,
            durationSeconds: 3600,
            values: [1.5, 2],
          }],
        },
      }],
    },
    warnings: [],
  });
});

test("regional buffs omit zero-valued inactive slots instead of inventing an epoch date", () => {
  const result = normalizeRegionalEquipment({
    members: [{ playerEntityId: "101", userName: "Ada" }],
    equipmentRows: [],
    presetRows: [],
    buffRows: [{
      entityId: 101n,
      activeBuffs: [{
        buffId: 77,
        buffStartTimestamp: { value: 0 },
        buffDuration: 30,
        values: [],
      }],
    }],
  });

  assert.deepEqual(result.data.members[0].buffs.buffs, []);
});

test("Relay claim normalization preserves 64-bit IDs as decimal strings", () => {
  assert.deepEqual(normalizeClaim({
    entity_id: "1369094286777412590",
    name: "Timbersteel Trade",
    region: 19,
    owner_player_entity_id: "1369094286756659093",
    supplies: 55837,
    treasury: 2703,
    tier: 5,
    num_tiles: 1806,
    tile_cost: 0.0125,
    upkeep_cost: 22.575,
    supplies_run_out: 1794254519732,
  }), {
    entityId: "1369094286777412590",
    name: "Timbersteel Trade",
    regionId: "19",
    ownerPlayerEntityId: "1369094286756659093",
    supplies: "55837",
    treasury: "2703",
    tier: 5,
    numTiles: 1806,
    tileCost: 0.0125,
    upkeepCost: 22.575,
    suppliesRunOut: "2026-11-09T20:01:59.732Z",
  });
});

test("Relay member normalization maps snake case without converting identifiers to numbers", () => {
  const members = normalizeMembers({
    count: 1,
    members: [{
      entity_id: "1369094286777413408",
      claim_entity_id: "1369094286777412590",
      player_entity_id: "1369094286756659093",
      user_name: "Modular",
      hexcoins: 100638,
      build_permission: true,
      inventory_permission: true,
      officer_permission: true,
      co_owner_permission: true,
      last_active_timestamp: 1785350252,
      last_login_timestamp: 1785330174,
      skills: { "2": 67 },
    }],
    skill_names: { "2": "Forestry" },
  });

  assert.deepEqual(members, [{
    entityId: "1369094286777413408",
    claimEntityId: "1369094286777412590",
    playerEntityId: "1369094286756659093",
    userName: "Modular",
    hexcoins: "100638",
    buildPermission: true,
    inventoryPermission: true,
    officerPermission: true,
    coOwnerPermission: true,
    lastActiveTimestamp: "2026-07-29T18:37:32.000Z",
    lastLoginTimestamp: "2026-07-29T13:02:54.000Z",
    skills: { "2": 67 },
    skillNames: { "2": "Forestry" },
  }]);
});

test("Relay member skills become citizen levels with exact player identity", () => {
  assert.deepEqual(normalizeCitizensPayload({
    skill_names: { 2: "Forestry", 15: "Construction" },
    members: [{
      entity_id: "1369094286777413408",
      claim_entity_id: "1369094286777412590",
      player_entity_id: "1369094286756659093",
      user_name: "Modular",
      hexcoins: 98736,
      skills: { 2: 67, 15: 39 },
    }],
  }).data, [{
    entityId: "1369094286777413408",
    playerEntityId: "1369094286756659093",
    userName: "Modular",
    skills: { 2: 67, 15: 39 },
    skillNames: { 2: "Forestry", 15: "Construction" },
    totalLevel: 106,
    totalSkillLevel: 106,
  }]);
});

test("regional player rows preserve exact IDs and derive bounded session activity", () => {
  assert.deepEqual(normalizeRegionalPlayers({
    members: [{
      playerEntityId: "1369094286756659093",
      userName: "Modular",
      lastActiveTimestamp: "2026-07-29T19:00:00.000Z",
    }, {
      playerEntityId: "1224979098736429551",
      userName: "Texian1836",
      lastLoginTimestamp: "2026-07-29T18:50:00.000Z",
    }],
    playerRows: [{
      entityId: 1369094286756659093n,
      timePlayed: 100000,
      sessionStartTimestamp: 1785352200,
      timeSignedIn: 80000,
      signInTimestamp: 1785352200,
      signedIn: true,
      travelerTasksExpiration: 0,
    }],
    observedAt: "2026-07-29T19:15:00.000Z",
  }), {
    data: [{
      entityId: "1369094286756659093",
      playerEntityId: "1369094286756659093",
      username: "Modular",
      signedIn: true,
      sessionSeconds: 300,
      timePlayedSeconds: 100000,
      timeSignedInSeconds: 80000,
      signInTimestamp: "2026-07-29T19:10:00.000Z",
      lastActiveTimestamp: "2026-07-29T19:00:00.000Z",
    }, {
      entityId: "1224979098736429551",
      playerEntityId: "1224979098736429551",
      username: "Texian1836",
      signedIn: false,
      sessionSeconds: null,
      timePlayedSeconds: null,
      timeSignedInSeconds: null,
      lastLoginTimestamp: "2026-07-29T18:50:00.000Z",
    }],
    warnings: ["Regional player_state omitted member 1224979098736429551."],
  });
});

test("timestamp normalization requires an explicit unit", () => {
  assert.equal(normalizeTimestamp(1785350252, "seconds"), "2026-07-29T18:37:32.000Z");
  assert.equal(normalizeTimestamp(1794254519732, "milliseconds"), "2026-11-09T20:01:59.732Z");
  assert.equal(normalizeTimestamp(1785350252000000n, "microseconds"), "2026-07-29T18:37:32.000Z");
  assert.throws(() => normalizeTimestamp(1785350252, "milliseconds"), /outside the supported date range/i);
});

test("item and cargo identities remain disjoint", () => {
  assert.equal(normalizeItemKind("Item"), "item");
  assert.equal(normalizeItemKind("Cargo"), "cargo");
  assert.throws(() => normalizeItemKind("Unknown"), /unsupported item kind/i);
});

test("typed global item and cargo rows normalize into provider-neutral catalog entities", () => {
  assert.deepEqual(normalizeCatalogEntity({
    id: 42,
    name: "Timber",
    tag: "Wood",
    tier: 2,
    rarity: { tag: "Common" },
    iconAssetName: "Items/Timber",
    itemListId: 17,
  }, "item"), {
    kind: "item",
    id: "42",
    name: "Timber",
    tag: "Wood",
    tier: 2,
    rarity: "Common",
    iconAssetName: "Items/Timber",
    itemListId: "17",
  });
  assert.deepEqual(normalizeCatalogEntity({
    id: 42,
    name: "Timber Crate",
    tag: "Packaged",
    tier: 2,
    rarity: { tag: "Common" },
    iconAssetName: "GeneratedIcons/Cargo/Timber Crate",
  }, "cargo"), {
    kind: "cargo",
    id: "42",
    name: "Timber Crate",
    tag: "Packaged",
    tier: 2,
    rarity: "Common",
    iconAssetName: "GeneratedIcons/Cargo/Timber Crate",
  });
  assert.deepEqual(normalizeCatalogEntity({
    id: 853965214,
    name: "Deed: Pet Buttons",
    tag: "Deed",
    tier: -1,
    rarity: { tag: "Common" },
    iconAssetName: "Items/Deed Pet Buttons",
    itemListId: 0,
  }, "item"), {
    kind: "item",
    id: "853965214",
    name: "Deed: Pet Buttons",
    tag: "Deed",
    tier: null,
    rarity: "Common",
    iconAssetName: "Items/Deed Pet Buttons",
  });
  assert.equal(normalizeCatalogEntity({
    id: 1541856987,
    name: "Nubi Berry Mash Knowledge",
    tag: "Knowledge",
    tier: -2,
  }, "item").tier, null);
  assert.throws(
    () => normalizeCatalogEntity({ id: 1.5, name: "Invalid" }, "item"),
    /decimal integer/i,
  );
});

test("typed recipe and skill descriptions are projected without wire DTOs", () => {
  assert.deepEqual(normalizeCatalogDescription({
    id: 77,
    name: "Saw Timber",
    actionsRequired: 12,
    isPassive: false,
    buildingRequirement: { buildingType: 9, tier: 2 },
    levelRequirements: [{ skillId: 5, level: 20 }],
    toolRequirements: [{ toolType: 4, level: 3, power: 25 }],
    experiencePerProgress: [{ skillId: 5, quantity: 2.5 }],
    consumedItemStacks: [{
      itemId: 42,
      quantity: 3,
      itemType: { tag: "Item" },
      consumptionChance: 1,
    }],
    craftedItemStacks: [{
      itemId: 43,
      quantity: 1,
      itemType: { tag: "Cargo" },
    }],
  }, "crafting_recipe"), {
    kind: "crafting_recipe",
    id: "77",
    name: "Saw Timber",
    actionsRequired: 12,
    isPassive: false,
    buildingRequirement: { buildingType: "9", tier: 2 },
    levelRequirements: [{ skillId: "5", level: 20 }],
    toolRequirements: [{ toolType: 4, level: 3, power: 25 }],
    experiencePerProgress: [{ skillId: "5", quantity: 2.5 }],
    inputs: [{ kind: "item", id: "42", quantity: "3", consumptionChance: 1 }],
    outputs: [{ kind: "cargo", id: "43", quantity: "1" }],
  });
  assert.deepEqual(normalizeCatalogDescription({
    id: 5,
    skillType: 10,
    name: "Forestry",
    description: "Work with trees",
    iconAssetName: "Skills/Forestry",
    title: "Forester",
    skillCategory: { tag: "Profession" },
    maxLevel: 100,
  }, "skill"), {
    kind: "skill",
    id: "5",
    skillType: "10",
    name: "Forestry",
    description: "Work with trees",
    iconAssetName: "Skills/Forestry",
    title: "Forester",
    category: "Profession",
    maxLevel: 100,
  });
});

test("typed building descriptions retain Relay compendium visibility and workstation slots", () => {
  assert.deepEqual(normalizeCatalogDescription({
    id: 6020,
    name: "Peerless Carpentry Station",
    description: "A station",
    iconAssetName: "Buildings/Carpentry",
    showInCompendium: true,
    maxHealth: 5000,
    functions: [{
      functionType: 3,
      level: 6,
      craftingSlots: 12,
      storageSlots: 4,
    }],
  }, "building"), {
    kind: "building",
    id: "6020",
    name: "Peerless Carpentry Station",
    description: "A station",
    iconAssetName: "Buildings/Carpentry",
    showInCompendium: true,
    maxHealth: 5000,
    functions: [{
      functionType: 3,
      level: 6,
      craftingSlots: 12,
      storageSlots: 4,
      refiningSlots: 0,
    }],
  });
});

test("typed enemy descriptions retain map finder identity and huntable metadata", () => {
  assert.deepEqual(normalizeCatalogDescription({
    enemyType: 42,
    name: "Sagi Bird",
    description: "A huntable bird.",
    maxHealth: 250,
    minDamage: 3,
    maxDamage: 7,
    attackLevel: 2,
    defenseLevel: 1,
    iconAddress: "Enemies/SagiBird",
    tier: 2,
    tag: "Animal",
    rarity: { tag: "Common" },
    huntable: true,
  }, "enemy"), {
    kind: "enemy",
    id: "42",
    enemyType: "42",
    name: "Sagi Bird",
    description: "A huntable bird.",
    maxHealth: 250,
    minDamage: 3,
    maxDamage: 7,
    attackLevel: 2,
    defenseLevel: 1,
    iconAssetName: "Enemies/SagiBird",
    tier: 2,
    tag: "Animal",
    rarity: "Common",
    huntable: true,
  });
});

test("global region rows join population, control, and player-facing names", () => {
  assert.deepEqual(normalizeGlobalRegions(
    [{
      regionId: 19,
      signedInPlayers: 42,
      playersInQueue: 3,
    }],
    [{
      regionId: 19,
      initialized: true,
      allowPlayers: true,
      allowPlayerSpawns: false,
    }],
    [{
      id: 19,
      playerFacingName: "Zephra",
      moduleNamePrefix: "bitcraft-live-",
    }],
  ), [{
    regionId: "19",
    regionName: "Zephra",
    active: true,
    syncing: false,
    allowPlayerSpawns: false,
    signedInPlayers: 42,
    playersInQueue: 3,
  }]);
});

test("global Empire Foundry rows preserve exact identity and completed capsule counts", () => {
  assert.deepEqual(normalizeGlobalEmpireFoundries([
    {
      entityId: 1008806316623100408n,
      empireEntityId: 4085486n,
      hexiteCapsules: 125,
      queued: 3,
      started: { microsSinceUnixEpoch: 1780595757807377n },
    },
    {
      entity_id: "2",
      empire_entity_id: "9",
      hexite_capsules: -1,
      queued: 0,
      started: { __timestamp_micros_since_unix_epoch__: "1780595757807377" },
    },
    {
      entityId: 3n,
      empireEntityId: 9n,
      hexiteCapsules: 0,
      queued: 0,
      started: { microsSinceUnixEpoch: 0n },
    },
  ]), {
    data: [
      {
        entityId: "1008806316623100408",
        empireEntityId: "4085486",
        hexiteCapsules: "125",
        queued: "3",
        startedAt: "2026-06-04T17:55:57.807Z",
      },
      {
        entityId: "3",
        empireEntityId: "9",
        hexiteCapsules: "0",
        queued: "0",
        startedAt: null,
      },
    ],
    warnings: [
      "Global empire_foundry_state omitted row 1: global Empire Foundry 1 completed Capsules must be non-negative.",
    ],
  });
});

test("regional Empire Hexite joins stay exact, deduplicate inventories, and prefer player ownership", () => {
  assert.deepEqual(normalizeRegionalEmpireHexite({
    regionId: "19",
    playerRows: [
      { entityId: 101n, empireEntityId: 10n },
      { entityId: 102n, empireEntityId: 10n },
      { entityId: 201n, empireEntityId: 20n },
    ],
    settlements: [
      { claimEntityId: "1001", empireEntityId: "10" },
      { claimEntityId: "2001", empireEntityId: "20" },
    ],
    buildingRows: [
      { entityId: 5001n, claimEntityId: 1001n, buildingDescriptionId: 90001 },
      { entityId: 5002n, claimEntityId: 2001n, buildingDescriptionId: 12 },
    ],
    inventoryRows: [
      {
        entityId: 7001n,
        ownerEntityId: 5001n,
        playerOwnerEntityId: 101n,
        pockets: [
          { contents: { itemId: 828972621, itemType: { tag: "Item" }, quantity: 12 } },
          { contents: { itemId: 2000000, itemType: { tag: "Cargo" }, quantity: 3 } },
        ],
      },
      {
        entityId: 7002n,
        ownerEntityId: 5002n,
        playerOwnerEntityId: 999n,
        pockets: [
          { contents: { itemId: 828972621, itemType: { tag: "Item" }, quantity: 5 } },
          { contents: { itemId: 2000000, itemType: { tag: "Cargo" }, quantity: 7 } },
        ],
      },
      {
        entityId: 7003n,
        ownerEntityId: 5001n,
        playerOwnerEntityId: 102n,
        pockets: [{ contents: { itemId: 1, itemType: { tag: "Item" }, quantity: 99 } }],
      },
      {
        entityId: 7004n,
        ownerEntityId: 9999n,
        playerOwnerEntityId: 999n,
        pockets: [{ contents: { itemId: 828972621, itemType: { tag: "Item" }, quantity: 99 } }],
      },
      {
        entityId: 7005n,
        ownerEntityId: 5001n,
        playerOwnerEntityId: 101n,
        pockets: [{ contents: { itemId: 2000000, itemType: { tag: "Cargo" }, quantity: -1 } }],
      },
    ],
  }), {
    data: {
      inventories: [
        {
          entityId: "7001",
          empireEntityId: "10",
          regionId: "19",
          sourceType: "player",
          energy: "12",
          capsules: "3",
          reserveBuilding: true,
        },
        {
          entityId: "7002",
          empireEntityId: "20",
          regionId: "19",
          sourceType: "claim",
          energy: "5",
          capsules: "7",
          reserveBuilding: false,
        },
      ],
      coverage: [
        {
          empireEntityId: "10",
          regionId: "19",
          playerCount: 2,
          claimCount: 1,
        },
        {
          empireEntityId: "20",
          regionId: "19",
          playerCount: 1,
          claimCount: 1,
        },
      ],
    },
    warnings: [
      "Regional Empire Hexite omitted inventory 4: regional Empire Hexite inventory 4 pocket 0 quantity must be non-negative.",
    ],
  });
});

test("claim technology descriptions retain progression caps and automatic unlocks", () => {
  assert.deepEqual(normalizeCatalogDescription({
    id: 1826500486,
    name: "Unlock 30000 Max Supplies",
    description: "Increases the settlement supply cap.",
    tier: 2,
    techType: { tag: "MaxSupplies", value: {} },
    suppliesCost: 4000,
    researchTime: 0,
    requirements: [200],
    input: [],
    members: 75,
    area: 2000,
    supplies: 30000,
    xpToMintHexCoin: 500,
    unlocksTechs: [479987213, 1926459936],
  }, "claim_tech"), {
    kind: "claim_tech",
    id: "1826500486",
    name: "Unlock 30000 Max Supplies",
    description: "Increases the settlement supply cap.",
    tier: 2,
    techType: "MaxSupplies",
    suppliesCost: "4000",
    researchTime: "0",
    requirements: ["200"],
    inputs: [],
    members: "75",
    area: "2000",
    supplies: "30000",
    xpToMintHexCoin: "500",
    unlocksTechs: ["479987213", "1926459936"],
  });
});

test("typed tool descriptions preserve row and item identity for live Toolbelt enrichment", () => {
  assert.deepEqual(normalizeCatalogDescription({
    id: 9,
    itemId: 42,
    toolType: 4,
    level: 3,
    power: 25,
  }, "tool"), {
    kind: "tool",
    id: "9",
    itemId: "42",
    toolType: 4,
    level: 3,
    power: 25,
  });
});

test("deposit status is unknown unless Relay explicitly proves active or respawning", () => {
  assert.equal(normalizeDeposit({ entity_id: "1", region: 19 }).status, "unknown");
  assert.equal(normalizeDeposit({ entity_id: "2", region: 19, status: "unknown" }).status, "unknown");
  assert.equal(normalizeDeposit({ entity_id: "3", region: 19, status: "active" }).status, "active");
  assert.equal(normalizeDeposit({ entity_id: "4", region: 19, respawn_at: "2026-08-04T23:48:26.148Z" }).status, "respawning");
});

test("partial Relay payloads preserve valid rows and report missing or malformed fields", () => {
  const claim = normalizeClaimPayload({
    entity_id: "1369094286777412590",
    name: "Timbersteel Trade",
    region: 19,
  });
  assert.deepEqual(claim.data, {
    entityId: "1369094286777412590",
    name: "Timbersteel Trade",
    regionId: "19",
  });
  assert.ok(claim.warnings.some((warning) => warning.includes("supplies")));

  const members = normalizeMembersPayload({
    members: [
      {
        entity_id: "1",
        claim_entity_id: "1369094286777412590",
        player_entity_id: "2",
        user_name: "Valid partial member",
      },
      {
        entity_id: "not-an-id",
        claim_entity_id: "1369094286777412590",
        player_entity_id: "3",
      },
    ],
  });
  assert.equal(members.data.length, 1);
  assert.equal(members.data[0].userName, "Valid partial member");
  assert.ok(members.warnings.some((warning) => warning.includes("members[1]")));
});

test("claim inventory normalization preserves item/cargo collisions and exact quantities", () => {
  const inventory = normalizeClaimInventory({
    claim: { entity_id: "1369094286777412590", name: "Timbersteel Trade", region: 19 },
    dimensions: [{
      dimension_id: "77",
      kind: "Claim",
      buildings: [{
        entity_id: "1369094286778488967",
        name: "Simple Chest",
        nickname: "Materials",
        items: [
          { item_id: 42, item_type: "Item", quantity: "9007199254740993" },
          { item_id: 42, item_type: "Cargo", quantity: 2 },
        ],
      }],
    }],
  });

  assert.deepEqual(inventory.buildings[0].inventory.map((slot) => slot.contents), [
    { itemId: "42", itemType: "item", quantity: "9007199254740993" },
    { itemId: "42", itemType: "cargo", quantity: "2" },
  ]);
  assert.equal(inventory.buildings[0].entityId, "1369094286778488967");
});

test("storage-log normalization preserves exact identities and rejects cross-scope rows", () => {
  const result = normalizeStorageLogs({
    count: 4,
    logs: [{
      action: "withdraw",
      building: {
        entity_id: "1369094286778488967",
        name: "Simple Large Chest",
        nickname: "Needs Processing",
      },
      claim_entity_id: "1369094286777412590",
      claim_name: "Timbersteel Trade",
      id: "4070526",
      item_id: 3110017,
      item_type: "Item",
      player_entity_id: "1369094286756659093",
      player_username: "Modular",
      quantity: "9007199254740993",
      region: 19,
      timestamp: "2026-07-29T22:34:48.266Z",
    }, {
      action: "deposit",
      building: { entity_id: "2", name: "Foreign chest" },
      claim_entity_id: "999",
      id: "2",
      item_id: 42,
      item_type: "Cargo",
      player_entity_id: "3",
      quantity: 1,
      region: 19,
      timestamp: "2026-07-29T22:34:48.266Z",
    }, {
      action: "deposit",
      building: { entity_id: "3", name: "Other region chest" },
      claim_entity_id: "1369094286777412590",
      id: "3",
      item_id: 42,
      item_type: "Cargo",
      player_entity_id: "4",
      quantity: 1,
      region: 20,
      timestamp: "2026-07-29T22:34:48.266Z",
    }, {
      action: "move",
      building: { entity_id: "4", name: "Malformed" },
      claim_entity_id: "1369094286777412590",
      id: "4",
      item_id: 42,
      item_type: "Cargo",
      player_entity_id: "5",
      quantity: 1,
      region: 19,
      timestamp: "not-a-date",
    }],
  }, {
    claimId: "1369094286777412590",
    regionId: "19",
  });

  assert.deepEqual(result.data, [{
    id: "4070526",
    claimId: "1369094286777412590",
    claimName: "Timbersteel Trade",
    regionId: "19",
    buildingId: "1369094286778488967",
    buildingName: "Simple Large Chest",
    buildingNickname: "Needs Processing",
    playerId: "1369094286756659093",
    playerName: "Modular",
    action: "withdraw",
    itemId: "3110017",
    itemType: "item",
    quantity: "9007199254740993",
    occurredAt: "2026-07-29T22:34:48.266Z",
  }]);
  assert.equal(result.warnings.length, 3);
  assert.match(result.warnings[0], /cross-claim row 2/i);
  assert.match(result.warnings[1], /cross-region row 3/i);
  assert.match(result.warnings[2], /omitted row 3/i);
});

test("player inventory normalization preserves bounded categories and exact item identities", () => {
  const payload = normalizePlayerInventory({
    player: {
      entity_id: "90071992547409931",
      username: "Ada",
      region: "19",
      signed_in: true,
      last_active_timestamp: "1785409200",
      last_login_timestamp: "1785409100",
    },
    inventories: [
      {
        entity_id: "7001",
        name: "Toolbelt",
        nickname: null,
        category: "toolbelt",
        claim_entity_id: "1369094286777412590",
        claim_name: "Timbersteel Trade",
        items: [
          { item_id: "42", item_type: "Item", quantity: "1" },
          { item_id: "42", item_type: "Cargo", quantity: "18446744073709551615" },
        ],
      },
    ],
  });

  assert.deepEqual(payload.player, {
    entityId: "90071992547409931",
    username: "Ada",
    regionId: "19",
    signedIn: true,
    lastActiveTimestamp: "2026-07-30T11:00:00.000Z",
    lastLoginTimestamp: "2026-07-30T10:58:20.000Z",
  });
  assert.deepEqual(payload.inventories[0], {
    entityId: "7001",
    inventoryName: "Toolbelt",
    name: "Toolbelt",
    nickname: "",
    category: "toolbelt",
    claimEntityId: "1369094286777412590",
    claimName: "Timbersteel Trade",
    items: [
      { itemId: "42", itemType: "item", quantity: "1" },
      { itemId: "42", itemType: "cargo", quantity: "18446744073709551615" },
    ],
    pockets: [
      { contents: { itemId: "42", itemType: "item", quantity: "1" } },
      { contents: { itemId: "42", itemType: "cargo", quantity: "18446744073709551615" } },
    ],
  });
});

test("claim craft and deposit payloads normalize into provider domain shapes", () => {
  const crafts = normalizeClaimCrafts({
    crafts: [{
      entity_id: "1369094286813753789",
      building_entity_id: "1369094286799387835",
      claim_entity_id: "1369094286777412590",
      owner_entity_id: "864691128504576674",
      completed: false,
      craft_count: 125,
      progress: 2580,
      recipe_id: 209007,
      total_actions_required: 8125,
      crafted_item: [{ item_id: 2090008, item_type: "Item", quantity: 1 }],
    }],
  });
  assert.equal(crafts.craftResults[0].entityId, "1369094286813753789");
  assert.deepEqual(crafts.craftResults[0].craftedItem[0], {
    itemId: "2090008",
    itemType: "item",
    quantity: "1",
  });

  const deposits = normalizeDeposits({
    deposits: [
      { entity_id: "1", region: 19, status: "unknown" },
      { entity_id: "2", region: 19, respawn_at: "2026-08-04T23:48:26.148Z" },
    ],
  });
  assert.deepEqual(deposits.map((deposit) => deposit.status), ["unknown", "respawning"]);
});

test("claim craft payloads merge incomplete and completed rows without losing exact identities", () => {
  const crafts = normalizeClaimCraftPayloads([
    {
      crafts: [{
        entity_id: "1369094286813753789",
        building_entity_id: "1369094286799387835",
        claim_entity_id: "1369094286777412590",
        owner_entity_id: "864691128504576674",
        completed: false,
        craft_count: "9007199254740993",
        progress: 2,
        recipe_id: 209007,
        total_actions_required: 8125,
        crafted_item: [{ item_id: 42, item_type: "Cargo", quantity: 1 }],
      }],
    },
    {
      crafts: [{
        entity_id: "1369094287235049109",
        building_entity_id: "1369094286803079588",
        claim_entity_id: "1369094286777412590",
        owner_entity_id: "1224979098736429551",
        completed: true,
        craft_count: 1,
        progress: 1,
        recipe_id: 210017,
        total_actions_required: 1,
        crafted_item: [{ item_id: 42, item_type: "Item", quantity: 100 }],
      }],
    },
  ]);

  assert.equal(crafts.craftResults.length, 2);
  assert.equal(crafts.craftResults[0].craftCount, "9007199254740993");
  assert.equal(crafts.craftResults[0].craftedItem[0].itemType, "cargo");
  assert.equal(crafts.craftResults[1].completed, true);
});
