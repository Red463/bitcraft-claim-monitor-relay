const MAP_TOOL_IDS = new Set(["layers", "biomes", "players", "resources"]);

function mapToolId(value) {
  if (!MAP_TOOL_IDS.has(value)) throw new TypeError(`Unknown map tool: ${String(value)}`);
  return value;
}

export function nextMapTool(active, requested) {
  const next = mapToolId(requested);
  if (active != null) mapToolId(active);
  return active === next ? null : next;
}

export function mapToolNeedsInitialFocus(previousActive, active) {
  if (previousActive != null) mapToolId(previousActive);
  if (active != null) mapToolId(active);
  return active != null && active !== previousActive;
}
