import assert from "node:assert/strict";
import test from "node:test";

import * as normalizers from "../src/server/game-data/normalizers.ts";

test("regional public craft normalization follows only public markers through exact joins", () => {
  assert.equal(
    typeof normalizers.normalizeRegionalPublicCrafts,
    "function",
    "regional public craft normalizer must exist",
  );

  const result = normalizers.normalizeRegionalPublicCrafts({
    regionId: "19",
    publicRows: [{
      entityId: 1369094286770519904n,
      buildingEntityId: 1369094286757292238n,
      ownerEntityId: 1369094286737074304n,
    }],
    craftRows: [
      {
        entityId: 1369094286770519904n,
        buildingEntityId: 1369094286757292238n,
        functionType: 2,
        progress: 171600,
        recipeId: 405009,
        craftCount: 780,
        lastCritOutcome: 1,
        ownerEntityId: 1369094286737074304n,
        preparation: false,
      },
      {
        entityId: 999n,
        buildingEntityId: 998n,
        progress: 1,
        recipeId: 1,
        craftCount: 1,
        ownerEntityId: 997n,
        preparation: false,
      },
    ],
    buildingRows: [{
      entityId: 1369094286757292238n,
      claimEntityId: 1369094286739211015n,
      directionIndex: 2,
      buildingDescriptionId: 4026,
      constructedByPlayerEntityId: 100n,
    }],
    buildingNicknameRows: [{
      entityId: 1369094286757292238n,
      nickname: "Community Smithy",
    }],
    claimRows: [{
      entityId: 1369094286739211015n,
      ownerPlayerEntityId: 1369094286737074304n,
      ownerBuildingEntityId: 1369094286739222222n,
      name: "Vandaine Cozy Core",
      neutral: false,
    }],
    usernameRows: [{
      entityId: 1369094286737074304n,
      username: "Bitoy",
    }],
    locationRows: [
      {
        entityId: 1369094286757292238n,
        chunkIndex: 1n,
        x: 26904,
        z: 24468,
        dimension: 1,
      },
      {
        entityId: 1369094286739222222n,
        chunkIndex: 1n,
        x: 26866,
        z: 24476,
        dimension: 1,
      },
      {
        entityId: 1369094286739211015n,
        chunkIndex: 1n,
        x: 1,
        z: 2,
        dimension: 1,
      },
    ],
  });

  assert.deepEqual(result, {
    data: {
      craftResults: [{
        entityId: "1369094286770519904",
        buildingEntityId: "1369094286757292238",
        buildingDescriptionId: "4026",
        buildingNickname: "Community Smithy",
        buildingLocationX: 26904,
        buildingLocationZ: 24468,
        claimEntityId: "1369094286739211015",
        claimName: "Vandaine Cozy Core",
        claimLocationX: 26866,
        claimLocationZ: 24476,
        claimDimension: "1",
        ownerEntityId: "1369094286737074304",
        ownerUsername: "Bitoy",
        recipeId: "405009",
        progress: "171600",
        craftCount: "780",
        preparation: false,
        completed: false,
        isPublic: true,
        regionId: "19",
      }],
    },
    complete: true,
    warnings: [],
  });
});

test("regional public craft normalization preserves usable rows and reports missing optional joins", () => {
  const result = normalizers.normalizeRegionalPublicCrafts({
    regionId: "19",
    publicRows: [{
      entityId: 500n,
      buildingEntityId: 600n,
      ownerEntityId: 700n,
    }],
    craftRows: [{
      entityId: 500n,
      buildingEntityId: 600n,
      progress: 10,
      recipeId: 800,
      craftCount: 2,
      ownerEntityId: 700n,
      preparation: true,
    }],
    buildingRows: [],
    buildingNicknameRows: [],
    claimRows: [],
    usernameRows: [],
    locationRows: [],
  });

  assert.equal(result.data.craftResults.length, 1);
  assert.equal(result.data.craftResults[0].claimEntityId, null);
  assert.equal(result.data.craftResults[0].ownerUsername, "");
  assert.deepEqual(result.warnings, [
    "Regional public craft 500 has no building_state row for 600.",
    "Regional public crafts missing crafter usernames: 1.",
  ]);
  assert.equal(result.complete, true);
});

test("regional public craft normalization omits markers without a progressive craft row", () => {
  const result = normalizers.normalizeRegionalPublicCrafts({
    regionId: "19",
    publicRows: [{
      entityId: 500n,
      buildingEntityId: 600n,
      ownerEntityId: 700n,
    }],
    craftRows: [],
    buildingRows: [],
    buildingNicknameRows: [],
    claimRows: [],
    usernameRows: [],
    locationRows: [],
  });

  assert.deepEqual(result.data.craftResults, []);
  assert.deepEqual(result.warnings, [
    "Regional public craft marker 500 has no progressive_action_state row.",
  ]);
  assert.equal(result.complete, false);
});

test("regional public craft normalization rejects a mixed marker and detail generation", () => {
  const result = normalizers.normalizeRegionalPublicCrafts({
    regionId: "19",
    publicRows: [{
      entityId: 500n,
      buildingEntityId: 600n,
      ownerEntityId: 700n,
    }],
    craftRows: [{
      entityId: 500n,
      buildingEntityId: 601n,
      progress: 10,
      recipeId: 800,
      craftCount: 2,
      ownerEntityId: 700n,
      preparation: false,
    }],
    buildingRows: [],
    buildingNicknameRows: [],
    claimRows: [],
    usernameRows: [],
    locationRows: [],
  });

  assert.deepEqual(result.data.craftResults, []);
  assert.equal(result.complete, false);
  assert.deepEqual(result.warnings, [
    "Regional public craft 500 marker/detail building ids do not match (600/601).",
  ]);
});
