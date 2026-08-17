export function assignPlayerMarkerColours(playerIds?: string[]): Record<string, string>;
export function normalizePlayerMarkerColourOverrides(value: unknown): Record<string, string>;
export function playerMarkerColourInputValue(value: unknown): string;
export function accountPlayerMarkerColourOverrides(settings: unknown, localOverrides: unknown): Record<string, string>;
export function resolvePlayerMarkerColours(playerIds?: string[], overrides?: Readonly<Record<string, string>>): Record<string, string>;
export function withPlayerMarkerColourOverride(current: unknown, playerId: string, colour: string | null): Record<string, string>;
