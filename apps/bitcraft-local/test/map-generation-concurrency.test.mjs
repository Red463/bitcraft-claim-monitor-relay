import assert from "node:assert/strict";
import test from "node:test";

import { configureMapGenerationConcurrency } from "../src/server/mapGenerationConcurrency.mjs";

test("map generation defaults to one image thread and clamps configured concurrency", () => {
  const applied = [];
  const sharp = { concurrency(value) { applied.push(value); return value; } };

  assert.equal(configureMapGenerationConcurrency(sharp, {}), 1);
  assert.equal(configureMapGenerationConcurrency(sharp, { BITCRAFT_MAP_IMAGE_CONCURRENCY: "2" }), 2);
  assert.equal(configureMapGenerationConcurrency(sharp, { BITCRAFT_MAP_IMAGE_CONCURRENCY: "0" }), 1);
  assert.equal(configureMapGenerationConcurrency(sharp, { BITCRAFT_MAP_IMAGE_CONCURRENCY: "99" }), 2);
  assert.deepEqual(applied, [1, 2, 1, 2]);
});

