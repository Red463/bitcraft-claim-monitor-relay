export type MapToolId = "layers" | "biomes" | "players" | "resources";

export function nextMapTool(
  active: MapToolId | null,
  requested: MapToolId,
): MapToolId | null;

export function mapToolNeedsInitialFocus(
  previousActive: MapToolId | null,
  active: MapToolId | null,
): boolean;
