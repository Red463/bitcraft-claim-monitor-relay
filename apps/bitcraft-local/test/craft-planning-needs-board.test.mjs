import assert from "node:assert/strict";
import test from "node:test";

import { buildNeedsBoard, filterNeedsBoard, needsBoardCompletion } from "../src/pages/craftPlanningNeedsBoard.ts";
import * as plannerTaxonomy from "../src/pages/craftPlanningTaxonomyData.mjs";

test("Needs Board covers quantities with guaranteed output only", () => {
  const board = buildNeedsBoard([{
    key: "items:1",
    name: "Plank",
    tag: "Plank",
    tier: 1,
    section: "Carpentry",
    required: 10,
    available: 2,
    inProgress: 7,
    guaranteedInProgress: 3,
    estimatedInProgress: 4,
    missing: 5,
  }], []);
  assert.equal(board[0].covered, 5);
});

test("buildNeedsBoard groups enriched API items by tag and authoritative tier", () => {
  const board = buildNeedsBoard([
    {
      key: "items:6130004",
      id: "6130004",
      kind: "items",
      name: "Peerless Berry",
      tag: "Berry",
      tier: 6,
      section: "Foraging",
      required: 50,
      available: 8,
      inProgress: 0,
      missing: 42,
    },
  ], []);

  assert.equal(board.length, 1);
  assert.equal(board[0].section, "Foraging");
  assert.equal(board[0].rows.length, 1);
  assert.equal(board[0].rows[0].name, "Berry");
  assert.equal(board[0].rows[0].cells.has("T6"), true);
  assert.equal(board[0].rows[0].cells.has("Materials"), false);
  assert.equal(board[0].rows[0].cells.get("T6")?.missing, 42);
});



test("buildNeedsBoard merges concrete item names into one row when API tags match", () => {
  const board = buildNeedsBoard([
    {
      key: "items:2120001",
      id: "2120001",
      kind: "items",
      name: "Simple Wispweave Filament",
      tag: "Wispweave Filament",
      tier: 2,
      section: "Farming",
      required: 100,
      available: 10,
      inProgress: 0,
      missing: 90,
    },
    {
      key: "items:3120001",
      id: "3120001",
      kind: "items",
      name: "Infused Wispweave Filament",
      tag: "Wispweave Filament",
      tier: 3,
      section: "Farming",
      required: 50,
      available: 5,
      inProgress: 0,
      missing: 45,
    },
    {
      key: "items:5120001",
      id: "5120001",
      kind: "items",
      name: "Exquisite Wispweave Filament",
      tag: "Wispweave Filament",
      tier: 5,
      section: "Farming",
      required: 25,
      available: 0,
      inProgress: 0,
      missing: 25,
    },
  ], []);

  assert.equal(board.length, 1);
  assert.equal(board[0].rows.length, 1);
  assert.equal(board[0].rows[0].name, "Filament");
  assert.equal(board[0].rows[0].cells.get("T2")?.name, "Simple Wispweave Filament");
  assert.equal(board[0].rows[0].cells.get("T3")?.name, "Infused Wispweave Filament");
  assert.equal(board[0].rows[0].cells.get("T5")?.name, "Exquisite Wispweave Filament");
  assert.equal(board[0].rows[0].cells.has("Materials"), false);
});

test("buildNeedsBoard groups approved material families across tiers by stable API tag", () => {
  const families = [
    { tag: "Timber", section: "Carpentry", row: "Timber", names: ["Exquisite Timber", "Peerless Timber"] },
    { tag: "Roots", section: "Foraging", row: "Plant Roots", names: ["Exquisite Plant Roots", "Peerless Plant Roots"] },
    { tag: "Brick Slab", section: "Masonry", row: "Brick Slab", names: ["Exquisite Brick Slab", "Peerless Brick Slab"] },
    { tag: "Nail", section: "Smithing", row: "Nails", names: ["Luminite Nails", "Rathium Nails"] },
    { tag: "Rope", section: "Tailoring", row: "Rope", names: ["Exquisite Rope", "Peerless Rope"] },
    { tag: "Thread", section: "Tailoring", row: "Spool of Thread", names: ["Exquisite Spool Of Thread", "Peerless Spool Of Thread"] },
  ];
  const materials = families.flatMap((family, familyIndex) => family.names.map((name, tierIndex) => ({
    key: `items:${familyIndex}-${tierIndex}`,
    name,
    tag: family.tag,
    tier: tierIndex + 5,
    section: "Others",
    required: 10 + tierIndex,
    missing: 10 + tierIndex,
  })));

  const board = buildNeedsBoard(materials, []);

  for (const family of families) {
    const row = board.find((group) => group.section === family.section)?.rows.find((candidate) => candidate.name === family.row);
    assert.ok(row, `${family.row} should use one canonical ${family.section} row`);
    assert.equal(row.overrideKey, `tag:${family.tag}`);
    assert.equal(row.cells.get("T5")?.name, family.names[0]);
    assert.equal(row.cells.get("T6")?.name, family.names[1]);
  }

  const exceptions = [
    [{ key: "items:36", name: "Ancient Nails", tag: "Ancient Ingredients" }, "Ancient Nails"],
    [{ key: "cargo:1244818324", name: "Exquisite Rope Package", tag: "Package" }, "Exquisite Rope Package"],
    [{ key: "cargo:1595055118", name: "Hexite Infused Timber", tag: "Profession Dungeon Loot" }, "Hexite Infused Timber"],
  ];
  for (const [item, expectedRow] of exceptions) {
    assert.equal(plannerTaxonomy.plannerTaxonomyFor(item).row, expectedRow);
    assert.equal(plannerTaxonomy.plannerOverrideKeyFor(item, item.key), `item:${item.key}`);
  }
});

test("buildNeedsBoard keeps satisfied prerequisites when an unfinished recipe still needs them", () => {
  const board = buildNeedsBoard([
    {
      key: "items:102001",
      id: "102001",
      kind: "items",
      name: "Simple Plank",
      tag: "Plank",
      tier: 1,
      section: "Carpentry",
      required: 1880,
      available: 2500,
      inProgress: 0,
      missing: 0,
      recipeUsages: [{ output: { name: "Refined Simple Plank" } }],
    },
  ], []);

  assert.equal(board.length, 1);
  const cell = board[0].rows[0].cells.get("T1");
  assert.equal(cell?.missing, 0);
  assert.equal(cell?.required, 1880);
  assert.equal(cell?.available, 2500);
});

test("buildNeedsBoard ignores fully stocked items that are not used by the current recipe chain", () => {
  const board = buildNeedsBoard([
    {
      key: "items:102001",
      id: "102001",
      kind: "items",
      name: "Simple Plank",
      tag: "Plank",
      tier: 1,
      section: "Carpentry",
      required: 10,
      available: 100,
      inProgress: 0,
      missing: 0,
      recipeUsages: [],
    },
  ], []);

  assert.deepEqual(board, []);
});
test("buildNeedsBoard splits generic trade-good tags by actual item name", () => {
  const board = buildNeedsBoard([
    {
      key: "items:1",
      id: "1",
      kind: "items",
      name: "Guild Ledger",
      tag: "Trade Good",
      section: "Carpentry",
      required: 10,
      missing: 10,
    },
    {
      key: "items:2",
      id: "2",
      kind: "items",
      name: "Merchant Contract",
      tag: "Trade Good",
      section: "Carpentry",
      required: 5,
      missing: 5,
    },
  ], []);

  assert.deepEqual(board[0].rows.map((row) => row.name).sort(), ["Guild Ledger", "Merchant Contract"]);
});

test("planner taxonomy gives shared-tag material families independent identities", () => {
  const ordinaryBrick = { key: "items:3030002", name: "Sturdy Brick", tag: "Brick" };
  const unfiredBrick = { key: "items:812749346", name: "Unfired Sturdy Brick", tag: "Brick" };

  assert.equal(plannerTaxonomy.plannerTaxonomyFor(ordinaryBrick).row, "Brick");
  assert.equal(plannerTaxonomy.plannerTaxonomyFor(unfiredBrick).row, "Unfired Brick");
  assert.equal(typeof plannerTaxonomy.plannerOverrideKeyFor, "function");
  assert.equal(plannerTaxonomy.plannerOverrideKeyFor(ordinaryBrick, "items:3030002"), "tag:Brick");
  assert.equal(plannerTaxonomy.plannerOverrideKeyFor(unfiredBrick, "items:812749346"), "row:Unfired Brick");
});

test("shared-tag family taxonomy separates every audited operational family", () => {
  const samples = [
    [{ key: "items:1", name: "Rough Pebbles", tag: "Pebbles" }, "Pebbles", "tag:Pebbles"],
    [{ key: "items:2", name: "Rough Braxite", tag: "Pebbles" }, "Braxite", "row:Braxite"],
    [{ key: "items:3", name: "Simple Glass", tag: "Glass" }, "Glass", "tag:Glass"],
    [{ key: "items:4", name: "Sea Glass", tag: "Glass" }, "Sea Glass", "row:Sea Glass"],
    [{ key: "items:5", name: "Basic Raw Meat", tag: "Raw Meat" }, "Raw Meat", "tag:Raw Meat"],
    [{ key: "items:6", name: "Oyster Meat", tag: "Raw Meat" }, "Oyster Meat", "row:Oyster Meat"],
    [{ key: "items:7", name: "Raw Skitch Meat", tag: "Raw Meat" }, "Raw Skitch Meat", "row:Raw Skitch Meat"],
    [{ key: "items:8", name: "Raw Crab Meat", tag: "Raw Meat" }, "Raw Crab Meat", "row:Raw Crab Meat"],
    [{ key: "items:9", name: "Beginner's Hieroglyphs", tag: "Ancient Hieroglyphs" }, "Ancient Hieroglyphs", "tag:Ancient Hieroglyphs"],
    [{ key: "items:10", name: "Beginner's Stone Carvings", tag: "Ancient Hieroglyphs" }, "Stone Carvings", "row:Stone Carvings"],
    [{ key: "items:11", name: "Beginner's Stone Diagrams", tag: "Ancient Hieroglyphs" }, "Stone Diagrams", "row:Stone Diagrams"],
    [{ key: "items:12", name: "Nubi Goat Food", tag: "Animal Food" }, "Nubi Goat Food", "row:Nubi Goat Food"],
    [{ key: "items:13", name: "Nubi Goat Vitamins", tag: "Animal Food" }, "Nubi Goat Vitamins", "row:Nubi Goat Vitamins"],
    [{ key: "items:14", name: "Sagi Bird Food", tag: "Animal Food" }, "Sagi Bird Food", "row:Sagi Bird Food"],
    [{ key: "items:15", name: "Sagi Bird Vitamins", tag: "Animal Food" }, "Sagi Bird Vitamins", "row:Sagi Bird Vitamins"],
    [{ key: "items:16", name: "Auric Sagi Bird Egg", tag: "Domesticated Animal Materials" }, "Auric Sagi Bird Egg", "row:Auric Sagi Bird Egg"],
    [{ key: "items:17", name: "Fertilized Sagi Bird Egg", tag: "Domesticated Animal Materials" }, "Fertilized Sagi Bird Egg", "row:Fertilized Sagi Bird Egg"],
    [{ key: "items:18", name: "Nubi Goat Fur", tag: "Domesticated Animal Materials" }, "Nubi Goat Fur", "row:Nubi Goat Fur"],
    [{ key: "items:19", name: "Nubi Milk", tag: "Domesticated Animal Materials" }, "Nubi Milk", "row:Nubi Milk"],
    [{ key: "items:20", name: "Sagi Bird Down Feather", tag: "Domesticated Animal Materials" }, "Sagi Bird Down Feather", "row:Sagi Bird Down Feather"],
    [{ key: "items:21", name: "Sagi Bird Egg", tag: "Domesticated Animal Materials" }, "Sagi Bird Egg", "row:Sagi Bird Egg"],
    [{ key: "items:22", name: "Captured Nubi Goat", tag: "Tamed Animal" }, "Captured Nubi Goat", "row:Captured Nubi Goat"],
    [{ key: "items:23", name: "Captured Sagi Bird", tag: "Tamed Animal" }, "Captured Sagi Bird", "row:Captured Sagi Bird"],
    [{ key: "items:24", name: "Domesticated Nubi Goat", tag: "Tamed Animal" }, "Domesticated Nubi Goat", "row:Domesticated Nubi Goat"],
    [{ key: "items:25", name: "Domesticated Sagi Bird", tag: "Tamed Animal" }, "Domesticated Sagi Bird", "row:Domesticated Sagi Bird"],
    [{ key: "items:26", name: "Domesticated Nubi Goat Breeding", tag: "Tamed Animal" }, "Domesticated Nubi Goat Breeding", "row:Domesticated Nubi Goat Breeding"],
    [{ key: "items:27", name: "Domesticated Sagi Bird Breeding", tag: "Tamed Animal" }, "Domesticated Sagi Bird Breeding", "row:Domesticated Sagi Bird Breeding"],
  ];

  for (const [item, expectedRow, expectedKey] of samples) {
    assert.equal(plannerTaxonomy.plannerTaxonomyFor(item).row, expectedRow, item.name);
    assert.equal(plannerTaxonomy.plannerOverrideKeyFor(item, item.key), expectedKey, item.name);
  }

  const unmatchedSharedTag = { key: "items:98", name: "Volcanic Pebbles", tag: "Pebbles" };
  assert.equal(plannerTaxonomy.plannerTaxonomyFor(unmatchedSharedTag).row, "Volcanic Pebbles");
  assert.equal(plannerTaxonomy.plannerOverrideKeyFor(unmatchedSharedTag, unmatchedSharedTag.key), "item:items:98");

  const namelessSharedTag = { key: "items:97", name: "", tag: "Pebbles" };
  assert.equal(plannerTaxonomy.plannerOverrideKeyFor(namelessSharedTag, namelessSharedTag.key), "item:items:97");

  const unknownTag = { key: "items:99", name: "Guild Sword", tag: "Weapon" };
  assert.equal(plannerTaxonomy.plannerTaxonomyFor(unknownTag).row, "Guild Sword");
  assert.equal(plannerTaxonomy.plannerOverrideKeyFor(unknownTag, unknownTag.key), "item:items:99");
});

test("buildNeedsBoard keeps audited shared-tag families separate across tiers and sections", () => {
  const material = (key, name, tag, tier, section, required) => ({ key, name, tag, tier, section, required, missing: required });
  const braxiteQualities = ["Rough", "Simple", "Sturdy", "Fine", "Exquisite", "Peerless", "Ornate", "Pristine", "Magnificent", "Flawless"];
  const board = buildNeedsBoard([
    ...braxiteQualities.map((quality, index) => material(`items:braxite-${index + 1}`, `${quality} Braxite`, "Pebbles", index + 1, "Mining", index + 2)),
    material("items:3", "Rough Pebbles", "Pebbles", 1, "Mining", 11),
    material("items:4", "Simple Pebbles", "Pebbles", 2, "Mining", 13),
    material("items:5", "Sea Glass", "Glass", 2, "Masonry", 3),
    material("items:6", "Simple Glass", "Glass", 2, "Masonry", 4),
    material("items:7", "Raw Skitch Meat", "Raw Meat", null, "Hunting", 2),
    material("items:8", "Raw Crab Meat", "Raw Meat", null, "Hunting", 6),
    material("items:9", "Beginner's Stone Carvings", "Ancient Hieroglyphs", 1, "Scholar", 8),
    material("items:10", "Beginner's Stone Diagrams", "Ancient Hieroglyphs", 1, "Scholar", 9),
    material("items:11", "Nubi Goat Food", "Animal Food", null, "Taming", 10),
    material("items:12", "Sagi Bird Food", "Animal Food", null, "Taming", 12),
  ], []);

  const mining = board.find((group) => group.section === "Mining");
  assert.deepEqual(mining?.rows.map((row) => row.name), ["Braxite", "Pebbles"]);
  assert.deepEqual([...mining.rows[0].cells].map(([tier, cell]) => [tier, cell.name, cell.required]), braxiteQualities.map((quality, index) => [
    `T${index + 1}`,
    `${quality} Braxite`,
    index + 2,
  ]));
  assert.deepEqual([...mining.rows[1].cells].map(([tier, cell]) => [tier, cell.name, cell.required]), [
    ["T1", "Rough Pebbles", 11],
    ["T2", "Simple Pebbles", 13],
  ]);

  assert.deepEqual(board.find((group) => group.section === "Masonry")?.rows.map((row) => row.name).sort(), ["Glass", "Sea Glass"]);
  assert.deepEqual(board.find((group) => group.section === "Hunting")?.rows.map((row) => row.name).sort(), ["Raw Crab Meat", "Raw Skitch Meat"]);
  assert.deepEqual(board.find((group) => group.section === "Scholar")?.rows.map((row) => row.name).sort(), ["Stone Carvings", "Stone Diagrams"]);
  assert.deepEqual(board.find((group) => group.section === "Taming")?.rows.map((row) => row.name).sort(), ["Nubi Goat Food", "Sagi Bird Food"]);
});

test("buildNeedsBoard keeps distinct material families separate when an API tag is shared", () => {
  const board = buildNeedsBoard([
    { key: "items:3030002", name: "Sturdy Brick", tag: "Brick", tier: 3, section: "Masonry", sectionOverrideKey: "tag:Brick", required: 500, available: 67, missing: 433 },
    { key: "items:812749346", name: "Unfired Sturdy Brick", tag: "Brick", tier: 3, section: "Masonry", sectionOverrideKey: "tag:Brick", required: 433, available: 16, missing: 417 },
    { key: "items:4030002", name: "Fine Brick", tag: "Brick", tier: 4, section: "Masonry", sectionOverrideKey: "tag:Brick", required: 250, available: 114, missing: 136 },
    { key: "items:656215507", name: "Unfired Fine Brick", tag: "Brick", tier: 4, section: "Masonry", sectionOverrideKey: "tag:Brick", required: 136, available: 0, missing: 136 },
  ], []);

  const masonry = board.find((group) => group.section === "Masonry");
  assert.deepEqual(masonry?.rows.map((row) => row.name), ["Unfired Brick", "Brick"]);

  const unfired = masonry?.rows.find((row) => row.name === "Unfired Brick");
  assert.deepEqual(
    [unfired?.cells.get("T3")?.available, unfired?.cells.get("T3")?.required, unfired?.cells.get("T4")?.available, unfired?.cells.get("T4")?.required],
    [16, 433, 0, 136],
  );

  const brick = masonry?.rows.find((row) => row.name === "Brick");
  assert.deepEqual(
    [brick?.cells.get("T3")?.available, brick?.cells.get("T3")?.required, brick?.cells.get("T4")?.available, brick?.cells.get("T4")?.required],
    [67, 500, 114, 250],
  );

});
test("buildNeedsBoard exposes stable section override row metadata", () => {
  const board = buildNeedsBoard([
    {
      key: "items:305",
      id: "305",
      kind: "items",
      name: "Refined Simple Plank",
      tag: "Refined Plank",
      tier: 2,
      section: "Carpentry",
      apiSection: "Scholar",
      sectionOverrideKey: "tag:Refined Plank",
      sectionOverride: "Carpentry",
      required: 10,
      missing: 10,
    },
  ], []);

  assert.equal(board[0].rows[0].overrideKey, "tag:Refined Plank");
  assert.equal(board[0].rows[0].apiSection, "Scholar");
  assert.equal(board[0].rows[0].sectionOverride, "Carpentry");
});

test("buildNeedsBoard uses row name overrides without changing the stable row key", () => {
  const board = buildNeedsBoard([
    {
      key: "items:305",
      id: "305",
      kind: "items",
      name: "Refined Simple Plank",
      tag: "Refined Plank",
      tier: 2,
      section: "Scholar",
      apiSection: "Scholar",
      sectionOverrideKey: "tag:Refined Plank",
      rowNameOverride: "Finished Planks",
      required: 10,
      missing: 10,
    },
  ], []);

  assert.equal(board[0].rows[0].name, "Finished Planks");
  assert.equal(board[0].rows[0].apiName, "Refined Plank");
  assert.equal(board[0].rows[0].overrideKey, "tag:Refined Plank");
  assert.equal(board[0].rows[0].cells.get("T2")?.name, "Refined Simple Plank");
});

test("buildNeedsBoard keeps satisfied prerequisites represented by a compact usage flag", () => {
  const board = buildNeedsBoard([{
    key: "items:102001",
    id: "102001",
    kind: "items",
    name: "Simple Plank",
    tag: "Plank",
    tier: 1,
    section: "Carpentry",
    required: 1880,
    available: 2500,
    inProgress: 0,
    missing: 0,
    hasRecipeUsages: true,
  }], []);

  assert.equal(board.length, 1);
  assert.equal(board[0].rows[0].cells.get("T1")?.available, 2500);
});

test("buildNeedsBoard applies canonical operational rows and hides internal cycle intermediates", () => {
  const board = buildNeedsBoard([
    { key: "items:1", name: "Basic Wispweave Filament", tag: "Wispweave Filament", tier: 1, section: "Farming", required: 20, missing: 10 },
    { key: "items:2", name: "Simple Wispweave Seeds", tag: "Filament Seeds", tier: 2, section: "Farming", required: 30, missing: 30 },
    { key: "items:3", name: "Simple Lake Fish Filet", tag: "Lake Fish Filet", tier: 2, section: "Fishing", required: 12, missing: 12 },
    { key: "items:4", name: "Simple Lake Fish", tag: "Lake Fish", tier: 2, section: "Fishing", required: 12, missing: 12 },
    { key: "items:5", name: "Food Waste", tag: "Food Waste", tier: 1, section: "Farming", required: 8, missing: 8 },
  ], []);

  assert.deepEqual(board.map((group) => [group.section, group.rows.map((row) => row.name)]), [
    ["Farming", ["Filament"]],
    ["Fishing", ["Lake Fish"]],
  ]);
});

test("buildNeedsBoard follows stable workflow order and appends unknown API tags", () => {
  const board = buildNeedsBoard([
    { key: "items:1", name: "Rough Sandpaper", tag: "Woodworking Sandpaper", tier: null, section: "Carpentry", required: 1, missing: 1 },
    { key: "items:2", name: "Rough Plank", tag: "Plank", tier: 1, section: "Carpentry", required: 1000, missing: 900 },
    { key: "items:3", name: "Rough Stripped Wood", tag: "Stripped Wood", tier: 1, section: "Carpentry", required: 2, missing: 2 },
    { key: "items:4", name: "Unknown Future Part", tag: "Unknown Future Part", tier: 1, section: "Carpentry", required: 5000, missing: 5000 },
    { key: "items:5", name: "Water", tag: "Water", tier: null, section: "Carpentry", required: 20, missing: 20 },
    { key: "items:6", name: "Refined Rough Plank", tag: "Refined Plank", tier: 1, section: "Carpentry", required: 5, missing: 5 },
  ], []);

  assert.deepEqual(board[0].rows.map((row) => row.name), [
    "Stripped Wood",
    "Plank",
    "Water",
    "Refined Plank",
    "Woodworking Sandpaper",
    "Unknown Future Part",
  ]);
});

test("buildNeedsBoard follows Sync ordering for operational rows and sections", () => {
  const board = buildNeedsBoard([
    { key: "items:1", name: "Basic Citric Berry", tag: "Citric Berry", tier: 1, section: "Foraging", required: 1, missing: 1 },
    { key: "items:2", name: "Basic Berry", tag: "Berry", tier: 1, section: "Foraging", required: 1, missing: 1 },
    { key: "items:3", name: "Basic Leather", tag: "Leather", tier: 1, section: "Leatherworking", required: 1, missing: 1 },
    { key: "items:4", name: "Basic Cloth", tag: "Cloth", tier: 1, section: "Tailoring", required: 1, missing: 1 },
    { key: "items:5", name: "Basic Animal Food", tag: "Animal Food", tier: 1, section: "Taming", required: 1, missing: 1 },
  ], []);

  assert.deepEqual(board.map((group) => [group.section, group.rows.map((row) => row.name)]), [
    ["Foraging", ["Berry", "Citric Berry"]],
    ["Leatherworking", ["Leather"]],
    ["Tailoring", ["Cloth"]],
    ["Taming", ["Animal Food"]],
  ]);
});

test("buildNeedsBoard keeps planner and raw API sections distinct", () => {
  const board = buildNeedsBoard([{
    key: "items:3",
    name: "Basic Leather",
    tag: "Leather",
    tier: 1,
    section: "Carpentry",
    apiSection: "Carpentry",
    required: 10,
    missing: 5,
  }], []);

  assert.equal(board[0].section, "Leatherworking");
  assert.equal(board[0].rows[0].plannerSection, "Leatherworking");
  assert.equal(board[0].rows[0].apiSection, "Carpentry");
});

test("buildNeedsBoard merges known cloth and thread rows into one Tailoring section", () => {
  const board = buildNeedsBoard([
    { key: "items:1", name: "Peerless Cloth", tag: "Cloth", tier: 5, section: "Tailoring", required: 125, missing: 125 },
    { key: "items:2", name: "Peerless Spool Of Thread", tag: "Thread", tier: 5, section: "Tailoring", required: 150, available: 177, missing: 0, recipeUsages: [{}] },
  ], []);

  assert.equal(board.filter((group) => group.section === "Tailoring").length, 1);
  assert.deepEqual(board.map((group) => group.section), ["Tailoring"]);
  assert.deepEqual(board[0].rows.map((row) => row.name), ["Spool of Thread", "Cloth"]);
});

test("buildNeedsBoard calculates section completion from required and covered quantities", () => {
  const board = buildNeedsBoard([
    { key: "items:1", name: "Rough Plank", tag: "Plank", tier: 1, section: "Carpentry", required: 100, available: 75, inProgress: 5, guaranteedInProgress: 2, estimatedInProgress: 3, missing: 20 },
    { key: "items:2", name: "Simple Plank", tag: "Plank", tier: 2, section: "Carpentry", required: 100, available: 100, inProgress: 0, missing: 0, recipeUsages: [{}] },
  ], []);

  assert.equal(board[0].required, 200);
  assert.equal(board[0].covered, 177);
  assert.equal(board[0].completion, 88.5);
  assert.equal(board[0].rows[0].cells.get("T1")?.guaranteedInProgress, 2);
  assert.equal(board[0].rows[0].cells.get("T1")?.estimatedInProgress, 3);
  assert.equal(board[0].rows[0].cells.get("T2")?.guaranteedInProgress, 0);
  assert.equal(board[0].rows[0].cells.get("T2")?.estimatedInProgress, 0);
});

test("Needs Board uses missingNow and planRequired before compatibility aliases", () => {
  const board = buildNeedsBoard([{
    key: "items:task-1",
    name: "Task 1 Plank",
    tag: "Plank",
    tier: 1,
    section: "Carpentry",
    missingNow: 4,
    planRequired: 12,
    missing: 99,
    required: 88,
    available: 3,
    guaranteedInProgress: 2,
    estimatedInProgress: 1,
  }], []);
  const cell = board[0].rows[0].cells.get("T1");

  assert.equal(cell?.missing, 4);
  assert.equal(cell?.required, 12);
  assert.equal(cell?.available, 3);
  assert.equal(cell?.guaranteedInProgress, 2);
  assert.equal(cell?.estimatedInProgress, 1);
});

test("buildNeedsBoard treats legacy in-progress coverage as guaranteed", () => {
  const board = buildNeedsBoard([{
    key: "items:legacy",
    name: "Legacy Plank",
    tag: "Plank",
    tier: 1,
    section: "Carpentry",
    required: 10,
    available: 0,
    inProgress: 5,
    missing: 5,
    recipeUsages: [{}],
  }], []);
  const cell = board[0].rows[0].cells.get("T1");

  assert.equal(cell?.guaranteedInProgress, 5);
  assert.equal(cell?.estimatedInProgress, 0);
});

test("buildNeedsBoard ignores legacy forecast output when calculating coverage", () => {
  const board = buildNeedsBoard([{
    key: "items:gypsite",
    name: "Sturdy Gypsite",
    tag: "Gypsite",
    tier: 3,
    section: "Foraging",
    required: 78,
    available: 0,
    inProgress: 0,
    plannedOutput: 25.52,
    missing: 78,
    recipeUsages: [{}],
  }], []);
  const cell = board[0].rows[0].cells.get("T3");

  assert.equal(cell?.available, 0);
  assert.equal(cell?.inProgress, 0);
  assert.equal("plannedOutput" in cell, false);
  assert.deepEqual(needsBoardCompletion(board), { required: 78, covered: 0, completion: 0 });
});

test("needsBoardCompletion weights the full board by required quantities", () => {
  const board = [{ section: "A", rows: [], required: 100, covered: 50, completion: 50 }, { section: "B", rows: [], required: 300, covered: 300, completion: 100 }];
  assert.deepEqual(needsBoardCompletion(board), { required: 400, covered: 350, completion: 87.5 });
  assert.deepEqual(needsBoardCompletion([]), { required: 0, covered: 0, completion: 100 });
  assert.equal(needsBoardCompletion(board).completion, needsBoardCompletion(board).completion);
});

test("filterNeedsBoard searches row names while preserving matching section headings", () => {
  const board = buildNeedsBoard([
    { key: "items:1", name: "Rough Plank", tag: "Plank", tier: 1, section: "Carpentry", required: 100, missing: 20 },
    { key: "items:2", name: "Rough Stripped Wood", tag: "Stripped Wood", tier: 1, section: "Carpentry", required: 50, missing: 10 },
    { key: "items:3", name: "Rough Brick", tag: "Brick", tier: 1, section: "Masonry", required: 25, missing: 5 },
  ], []);

  const filtered = filterNeedsBoard(board, [], false, " plank ");

  assert.deepEqual(filtered.map((group) => [group.section, group.rows.map((row) => row.name)]), [["Carpentry", ["Plank"]]]);
  assert.equal(filtered[0].completion, board[0].completion);
});

test("filterNeedsBoard matches API names and composes with activity and shortage filters", () => {
  const board = buildNeedsBoard([
    { key: "items:1", name: "Rough Plank", tag: "Plank", rowNameOverride: "Boards", tier: 1, section: "Carpentry", required: 100, missing: 0, recipeUsages: [{}] },
    { key: "items:2", name: "Simple Plank", tag: "Plank", rowNameOverride: "Boards", tier: 2, section: "Carpentry", required: 100, missing: 10 },
    { key: "items:3", name: "Basic Ink", tag: "Ink", tier: 1, section: "Scholar", required: 25, missing: 5 },
  ], []);

  assert.deepEqual(filterNeedsBoard(board, ["Carpentry"], true, "plank").map((group) => group.rows.map((row) => row.name)), [["Boards"]]);
  assert.deepEqual(filterNeedsBoard(board, ["Scholar"], true, "plank"), []);
});
