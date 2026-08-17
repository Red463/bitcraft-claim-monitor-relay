import { canonicalPlayerId } from "./playerMarkerIdentity.mjs";

function decimalId(value) {
  const canonical = canonicalPlayerId(value);
  if (canonical == null) throw new TypeError("Player marker identity must be a decimal unsigned 64-bit integer");
  return canonical;
}

const MAX_PLAYER_MARKER_COLOUR_OVERRIDES = 256;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

function hexColour(value) {
  const colour = String(value ?? "").trim();
  if (!HEX_COLOUR.test(colour)) throw new TypeError("Player marker colour must be a six-digit hex colour");
  return colour.toLowerCase();
}

function compareDecimalStrings(left, right) {
  return left.length - right.length || left.localeCompare(right);
}

function mixPlayerId(id) {
  const mask = 0xffffffffffffffffn;
  let mixed = (BigInt(id) + 0x9e3779b97f4a7c15n) & mask;
  mixed = ((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & mask;
  return mixed ^ (mixed >> 31n);
}

export function assignPlayerMarkerColours(playerIds = []) {
  const ids = [...new Set(playerIds.map(decimalId))].sort(compareDecimalStrings);
  const result = {};
  for (const id of ids) {
    const mixed = mixPlayerId(id);
    const hue = (Number(mixed & 0xffffffn) * 360 / 0x1000000).toFixed(6);
    const saturation = (70 + Number((mixed >> 24n) & 0xfffffn) * 14 / 0xfffff).toFixed(6);
    const lightness = (56 + Number((mixed >> 44n) & 0xfffffn) * 12 / 0xfffff).toFixed(6);
    result[id] = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }
  return result;
}

export function normalizePlayerMarkerColourOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawId, rawColour] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_PLAYER_MARKER_COLOUR_OVERRIDES) break;
    try {
      result[decimalId(rawId)] = hexColour(rawColour);
    } catch {
      // One malformed preference must not invalidate the remaining saved colours.
    }
  }
  return result;
}

export function playerMarkerColourInputValue(value) {
  const colour = String(value ?? "").trim();
  if (HEX_COLOUR.test(colour)) return colour.toLowerCase();
  const match = /^hsl\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))%\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))%\s*\)$/i.exec(colour);
  if (!match) return "#38bdf8";
  const hue = ((Number(match[1]) % 360) + 360) % 360;
  const saturation = Math.min(1, Math.max(0, Number(match[2]) / 100));
  const lightness = Math.min(1, Math.max(0, Number(match[3]) / 100));
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset) => {
    const k = (offset + hue / 30) % 12;
    return Math.round(255 * (lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[channel(0), channel(8), channel(4)].map((component) => component.toString(16).padStart(2, "0")).join("")}`;
}

export function accountPlayerMarkerColourOverrides(settings, localOverrides) {
  const saved = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  return Object.hasOwn(saved, "mapPlayerColours")
    ? normalizePlayerMarkerColourOverrides(saved.mapPlayerColours)
    : normalizePlayerMarkerColourOverrides(localOverrides);
}

export function resolvePlayerMarkerColours(playerIds = [], overrides = {}) {
  const result = assignPlayerMarkerColours(playerIds);
  const normalizedOverrides = normalizePlayerMarkerColourOverrides(overrides);
  for (const id of Object.keys(result)) {
    if (normalizedOverrides[id]) result[id] = normalizedOverrides[id];
  }
  return result;
}

export function withPlayerMarkerColourOverride(current, playerId, colour) {
  const normalized = normalizePlayerMarkerColourOverrides(current);
  const id = decimalId(playerId);
  if (colour == null) {
    delete normalized[id];
    return normalized;
  }
  const nextColour = hexColour(colour);
  if (!Object.hasOwn(normalized, id) && Object.keys(normalized).length >= MAX_PLAYER_MARKER_COLOUR_OVERRIDES) return normalized;
  return { ...normalized, [id]: nextColour };
}
