export const SYNTHETIC_OCEAN_LEAFLET_BOUNDS: readonly [readonly [number, number], readonly [number, number]];
export function syntheticOceanColours(): Readonly<{ base: string; light: string; dark: string }>;
export function createSyntheticOceanSvg(documentLike: Pick<Document, "createElementNS">): SVGSVGElement;
