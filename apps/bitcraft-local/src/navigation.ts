import {
  Activity,
  Calculator,
  CircleDollarSign,
  Factory,
  ClipboardList,
  FlaskConical,
  Globe2,
  GraduationCap,
  Hammer,
  Home,
  KeyRound,
  Landmark,
  Map as MapIcon,
  Package,
  Search,
  Share2,
  Trophy,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ActivePanel } from "./types/app";
import { canonicalPageId, writeQueryLocation, type NavigationMode } from "./navigation/routeState.ts";
export { dedicatedMapHref, isDedicatedMapView } from "./navigation/routeState.ts";

/*
 * Main app navigation model.
 *
 * The sidebar, command palette, URL validation, and default-page handling derive
 * from these groups. Keep href generation intact so middle-click and
 * open-in-new-tab continue to work like normal links.
 */

export type NavItem = readonly [ActivePanel, string, LucideIcon];
export type NavGroup = { id: string; label: string; items: readonly NavItem[] };

export const NAV_GROUPS = [
  { id: "command", label: "Overview", items: [
    ["dashboard", "Dashboard", Home],
    ["leaderboard", "Leaderboard", Trophy],
  ] },
  { id: "settlement", label: "Settlement", items: [
    ["members", "Members", Users],
    ["skills", "Professions", GraduationCap],
    ["craft-monitor", "Craft Monitor", Factory],
    ["planning", "Craft Planning", ClipboardList],
    ["inventory", "Inventory", Package],
    ["construction", "Construction", Hammer],
    ["research", "Research", FlaskConical],
    ["settlement-market", "Local Market", CircleDollarSign],
  ] },
  { id: "economy", label: "Economy & Region", items: [
    ["market", "Market", CircleDollarSign],
    ["region", "Region", Globe2],
    ["empires", "Empires", Landmark],
    ["map", "Map", MapIcon],
    ["activity", "Activity", Activity],
  ] },
  { id: "tools", label: "Tools", items: [
    ["publiccrafts", "Public Craft Finder", Search],
    ["craftcalc", "Craft Calculator", Calculator],
    ["sync", "Sync", Share2],
  ] },
] as const satisfies readonly NavGroup[];

export const ADMIN_NAV_ITEM = ["admin", "Admin", KeyRound] as const satisfies NavItem;

export const NAV: readonly NavItem[] = NAV_GROUPS.reduce<NavItem[]>((items, group) => {
  items.push(...group.items);
  return items;
}, [ADMIN_NAV_ITEM]);

export const DEFAULT_SIDEBAR_GROUPS = Object.fromEntries(NAV_GROUPS.map((group) => [group.id, true])) as Record<string, boolean>;

export function canonicalPanel(panel: string | null): ActivePanel | null {
  const candidate = canonicalPageId(panel);
  return NAV.some(([id]) => id === candidate) ? candidate as ActivePanel : null;
}

export function urlPanel(): ActivePanel | null {
  return canonicalPanel(new URLSearchParams(window.location.search).get("page"));
}

export function updateQueryState(values: Record<string, string | null>, mode: NavigationMode = "replace") {
  writeQueryLocation(values, mode);
}

export function panelHref(panel: ActivePanel): string {
  const defaultTab = panel === "market" ? "&tab=browse" : panel === "settlement-market" ? "&tab=live" : "";
  return `/?page=${encodeURIComponent(panel)}${defaultTab}`;
}
