import test from "node:test";
import assert from "node:assert/strict";

import { TERRAIN_WATER_COLOURS } from "../src/shared/terrainPaletteDefinition.mjs";
import {
  SYNTHETIC_OCEAN_LEAFLET_BOUNDS,
  createSyntheticOceanLayerController,
  createSyntheticOceanSvg,
  syntheticOceanColours,
  terrainStatusSupportsSyntheticOcean,
} from "../src/pages/map/syntheticOceanUnderlay.mjs";

class FakeSvgElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

const fakeDocument = {
  createElementNS(_namespace, tagName) {
    return new FakeSvgElement(tagName);
  },
};

function svgAttributeText(element) {
  const ownAttributes = [...element.attributes].flat();
  return [...ownAttributes, ...element.children.flatMap(svgAttributeText)].join(" ");
}

test("synthetic ocean spans the full world in Leaflet z-x order", () => {
  assert.deepEqual(SYNTHETIC_OCEAN_LEAFLET_BOUNDS, [[0, 0], [38_400, 38_400]]);
});

test("synthetic ocean colours derive from the canonical ocean palette", () => {
  const [red, green, blue] = TERRAIN_WATER_COLOURS.ocean;
  const colours = syntheticOceanColours();
  assert.equal(colours.base, `rgb(${red} ${green} ${blue})`);
  assert.notEqual(colours.light, colours.base);
  assert.notEqual(colours.dark, colours.base);
});

test("synthetic ocean SVG is static, decorative, and world-sized", () => {
  const svg = createSyntheticOceanSvg(fakeDocument);
  assert.equal(svg.tagName, "svg");
  assert.equal(svg.attributes.get("viewBox"), "0 0 38400 38400");
  assert.equal(svg.attributes.get("preserveAspectRatio"), "none");
  assert.equal(svg.attributes.get("aria-hidden"), "true");
  assert.equal(svg.attributes.get("focusable"), "false");
  assert.deepEqual(svg.children.map(({ tagName }) => tagName), ["defs", "rect", "ellipse", "ellipse", "ellipse"]);
  assert.equal(svg.children[1].attributes.get("fill"), syntheticOceanColours().base);
  assert.doesNotMatch(svgAttributeText(svg), /https?:|animation|animate/i);
});

test("synthetic ocean accepts stale last-good terrain and rejects unusable statuses", () => {
  const usableTerrain = { available: true, generation: "1786671012150", freshness: "stale" };
  assert.equal(terrainStatusSupportsSyntheticOcean(usableTerrain), true);
  assert.equal(terrainStatusSupportsSyntheticOcean({ available: false, generation: null }), false);
  assert.equal(terrainStatusSupportsSyntheticOcean({ available: true, generation: null }), false);
  assert.equal(terrainStatusSupportsSyntheticOcean(null), false);
});

test("synthetic ocean controller replaces, disables, and disposes its real layer", () => {
  const events = [];
  const map = { id: "map" };
  let sequence = 0;
  const controller = createSyntheticOceanLayerController({
    map,
    createLayer() {
      const id = ++sequence;
      events.push(`create:${id}`);
      return {
        addTo(target) { assert.equal(target, map); events.push(`add:${id}`); return this; },
        removeFrom(target) { assert.equal(target, map); events.push(`remove:${id}`); return this; },
      };
    },
  });

  controller.sync(true);
  controller.sync(true);
  controller.sync(false);
  controller.sync(true);
  controller.dispose();

  assert.deepEqual(events, [
    "create:1", "add:1",
    "remove:1", "create:2", "add:2",
    "remove:2",
    "create:3", "add:3", "remove:3",
  ]);
});

test("synthetic ocean controller contains layer creation failures", () => {
  const map = { id: "map" };
  let unavailableCount = 0;
  const controller = createSyntheticOceanLayerController({
    map,
    createLayer() { throw new Error("svg unavailable"); },
    onUnavailable() { unavailableCount += 1; },
  });

  assert.equal(controller.sync(true), null);
  assert.equal(unavailableCount, 1);
  controller.dispose();
});
