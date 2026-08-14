import { TERRAIN_WATER_COLOURS } from "../../shared/terrainPaletteDefinition.mjs";
import { MAP_WORLD_BOUNDS } from "./mapCoordinates.mjs";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));
const mixChannel = (source, target, ratio) => clampChannel(source + ((target - source) * ratio));
const rgb = ([red, green, blue]) => `rgb(${red} ${green} ${blue})`;
const mixRgb = (colour, target, ratio) => colour.slice(0, 3).map((channel, index) => mixChannel(channel, target[index], ratio));

export const SYNTHETIC_OCEAN_LEAFLET_BOUNDS = Object.freeze([
  Object.freeze([MAP_WORLD_BOUNDS.minZ, MAP_WORLD_BOUNDS.minX]),
  Object.freeze([MAP_WORLD_BOUNDS.maxZ, MAP_WORLD_BOUNDS.maxX]),
]);

export function syntheticOceanColours() {
  const ocean = TERRAIN_WATER_COLOURS.ocean;
  return Object.freeze({
    base: rgb(ocean),
    light: rgb(mixRgb(ocean, [255, 255, 255], 0.2)),
    dark: rgb(mixRgb(ocean, [0, 0, 0], 0.28)),
  });
}

export function terrainStatusSupportsSyntheticOcean(status) {
  return Boolean(status?.available && status.generation);
}

export function createSyntheticOceanLayerController({ map, createLayer, onUnavailable = () => {} }) {
  let layer = null;
  const removeLayer = () => {
    if (!layer) return;
    const currentLayer = layer;
    layer = null;
    currentLayer.removeFrom(map);
  };
  return Object.freeze({
    sync(enabled) {
      removeLayer();
      if (!enabled) return null;
      try {
        layer = createLayer().addTo(map);
        return layer;
      } catch {
        onUnavailable();
        return null;
      }
    },
    dispose() {
      removeLayer();
    },
  });
}

function svgElement(documentLike, tagName, attributes) {
  const element = documentLike.createElementNS(SVG_NAMESPACE, tagName);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  return element;
}

export function createSyntheticOceanSvg(documentLike) {
  if (!documentLike || typeof documentLike.createElementNS !== "function") {
    throw new TypeError("Synthetic ocean SVG requires createElementNS");
  }
  const width = MAP_WORLD_BOUNDS.maxX - MAP_WORLD_BOUNDS.minX;
  const height = MAP_WORLD_BOUNDS.maxZ - MAP_WORLD_BOUNDS.minZ;
  const colours = syntheticOceanColours();
  const svg = svgElement(documentLike, "svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
    focusable: "false",
  });
  const definitions = svgElement(documentLike, "defs", {});
  for (const [id, colour, opacity] of [
    ["native-map-ocean-light", colours.light, "0.3"],
    ["native-map-ocean-dark", colours.dark, "0.34"],
  ]) {
    const gradient = svgElement(documentLike, "radialGradient", { id });
    gradient.appendChild(svgElement(documentLike, "stop", { offset: "0", "stop-color": colour, "stop-opacity": opacity }));
    gradient.appendChild(svgElement(documentLike, "stop", { offset: "1", "stop-color": colour, "stop-opacity": "0" }));
    definitions.appendChild(gradient);
  }
  svg.appendChild(definitions);
  svg.appendChild(svgElement(documentLike, "rect", { width, height, fill: colours.base }));
  svg.appendChild(svgElement(documentLike, "ellipse", { cx: "6912", cy: "9216", rx: "15360", ry: "11520", fill: "url(#native-map-ocean-light)" }));
  svg.appendChild(svgElement(documentLike, "ellipse", { cx: "29952", cy: "26112", rx: "14592", ry: "13056", fill: "url(#native-map-ocean-dark)" }));
  svg.appendChild(svgElement(documentLike, "ellipse", { cx: "18432", cy: "35328", rx: "9984", ry: "6912", fill: "url(#native-map-ocean-light)" }));
  return svg;
}
