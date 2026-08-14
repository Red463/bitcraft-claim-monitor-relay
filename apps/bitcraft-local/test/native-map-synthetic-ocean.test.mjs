import test from "node:test";
import assert from "node:assert/strict";

import { TERRAIN_WATER_COLOURS } from "../src/shared/terrainPaletteDefinition.mjs";
import {
  SYNTHETIC_OCEAN_LEAFLET_BOUNDS,
  createSyntheticOceanSvg,
  syntheticOceanColours,
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
  assert.doesNotMatch(JSON.stringify(svg), /https?:|animation|animate/i);
});
