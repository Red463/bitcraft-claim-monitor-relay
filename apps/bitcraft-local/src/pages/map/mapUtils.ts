import type { AnyRecord } from "../../main-app-data.ts";

export type MapFocus = { name: string; locationX: number; locationZ: number; regionId?: string } | null;

export function mapResourceToken(entry: AnyRecord): string {
  const kind = String(entry.mapKind ?? "resource");
  return kind === "enemy" ? `enemy:${entry.mapId ?? entry.enemyType ?? entry.id}` : `resource:${entry.mapId ?? entry.id}`;
}

export function normalizeMapResourceToken(token: string): string {
  const value = String(token ?? "").trim();
  if (!value) return "";
  return value.includes(":") ? value : `resource:${value}`;
}

export function mapResourceCategory(resource: AnyRecord): string {
  return String(resource.tag ?? resource.category ?? resource.resourceType ?? resource.type ?? "").trim();
}

