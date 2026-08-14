export const SYNTHETIC_OCEAN_LEAFLET_BOUNDS: readonly [readonly [number, number], readonly [number, number]];
export function syntheticOceanColours(): Readonly<{ base: string; light: string; dark: string }>;
export function terrainStatusSupportsSyntheticOcean(status: { available?: boolean; generation?: string | null } | null | undefined): boolean;
export type SyntheticOceanLayer<TMap, TLayer> = {
  addTo(map: TMap): TLayer;
  removeFrom(map: TMap): unknown;
};
export type SyntheticOceanLayerController<TLayer> = Readonly<{
  sync(enabled: boolean): TLayer | null;
  dispose(): void;
}>;
export function createSyntheticOceanLayerController<TMap, TLayer extends SyntheticOceanLayer<TMap, TLayer>>(options: {
  map: TMap;
  createLayer: () => TLayer;
  onUnavailable?: () => void;
}): SyntheticOceanLayerController<TLayer>;
export function createSyntheticOceanSvg(documentLike: Pick<Document, "createElementNS">): SVGSVGElement;
