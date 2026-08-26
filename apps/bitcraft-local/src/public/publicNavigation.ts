import {
  Activity,
  Boxes,
  Calculator,
  CircleDollarSign,
  ClipboardList,
  Factory,
  FlaskConical,
  Globe2,
  GraduationCap,
  Hammer,
  Landmark,
  LayoutDashboard,
  Map as MapIcon,
  Search,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { AppNavigationGroup, AppNavigationItem } from "../components/app-chrome";
import type { PublicRoute } from "./routes.mjs";

type PublicDestination = {
  id: string;
  label: string;
  icon: LucideIcon;
  routeId?: string;
  feature?: string;
  href?: string;
  path?: (claimId: string) => string;
  availability: "available" | "claim-required" | "coming-soon" | "collaboration";
};

type PublicDestinationGroup = { id: string; label: string; items: PublicDestination[] };

const PUBLIC_DESTINATIONS: PublicDestinationGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, routeId: "dashboard", path: (claimId) => `/claims/${claimId}`, availability: "claim-required" },
      { id: "leaderboard", label: "Leaderboard", icon: Trophy, feature: "leaderboard", availability: "coming-soon" },
    ],
  },
  {
    id: "claim",
    label: "Claim",
    items: [
      { id: "members", label: "Members", icon: Users, routeId: "members", path: (claimId) => `/claims/${claimId}/members`, availability: "claim-required" },
      { id: "professions", label: "Professions", icon: GraduationCap, routeId: "professions", path: (claimId) => `/claims/${claimId}/professions`, availability: "claim-required" },
      { id: "crafts", label: "Craft Monitor", icon: Factory, routeId: "crafts", path: (claimId) => `/claims/${claimId}/crafts`, availability: "claim-required" },
      { id: "planning", label: "Craft Planning", icon: ClipboardList, routeId: "plans", href: "/plans", availability: "collaboration" },
      { id: "inventory", label: "Inventory", icon: Boxes, routeId: "inventory", path: (claimId) => `/claims/${claimId}/inventory`, availability: "claim-required" },
      { id: "construction", label: "Construction", icon: Hammer, feature: "construction", availability: "coming-soon" },
      { id: "research", label: "Research", icon: FlaskConical, feature: "research", availability: "coming-soon" },
      { id: "local-market", label: "Local Market", icon: CircleDollarSign, feature: "local-market", availability: "coming-soon" },
    ],
  },
  {
    id: "economy",
    label: "Economy & Region",
    items: [
      { id: "market", label: "Market", icon: CircleDollarSign, feature: "market", availability: "coming-soon" },
      { id: "region", label: "Region", icon: Globe2, feature: "region", availability: "coming-soon" },
      { id: "empires", label: "Empires", icon: Landmark, feature: "empires", availability: "coming-soon" },
      { id: "map", label: "Map", icon: MapIcon, feature: "map", availability: "coming-soon" },
      { id: "activity", label: "Activity", icon: Activity, feature: "activity", availability: "coming-soon" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    items: [
      { id: "public-craft-finder", label: "Public Craft Finder", icon: Search, feature: "public-craft-finder", availability: "coming-soon" },
      { id: "calculator", label: "Craft Calculator", icon: Calculator, routeId: "calculator", href: "/calculator", availability: "available" },
    ],
  },
];

type BuildPublicNavigationInput = {
  route: PublicRoute;
  claimId: string | null;
  claimName: string;
  collaborationEnabled: boolean;
  groupState?: Record<string, boolean>;
  onGroupExpandedChange?: (groupId: string, expanded: boolean) => void;
};

export function buildPublicNavigation({
  route,
  claimId,
  claimName,
  collaborationEnabled,
  groupState = {},
  onGroupExpandedChange = () => {},
}: BuildPublicNavigationInput): AppNavigationGroup[] {
  return PUBLIC_DESTINATIONS.map((group) => ({
    id: group.id,
    label: group.id === "claim" && claimName.trim() ? claimName.trim() : group.label,
    expanded: groupState[group.id] ?? true,
    onExpandedChange: (expanded) => onGroupExpandedChange(group.id, expanded),
    items: group.items.map((destination): AppNavigationItem => {
      const active = route.id === destination.routeId
        || (route.id === "coming-soon" && route.params.feature === destination.feature)
        || (destination.id === "planning" && ["plans", "plan-new", "plan"].includes(route.id));
      if (destination.availability === "coming-soon") return { id: destination.id, label: destination.label, icon: destination.icon, active, disabled: true, disabledReason: "Coming soon" };
      if (destination.availability === "collaboration" && !collaborationEnabled) return { id: destination.id, label: destination.label, icon: destination.icon, active, disabled: true, disabledReason: "Coming soon" };
      if (destination.availability === "claim-required" && !claimId) return { id: destination.id, label: destination.label, icon: destination.icon, active, disabled: true, disabledReason: "Select a claim" };
      return { id: destination.id, label: destination.label, icon: destination.icon, active, href: destination.href ?? (claimId && destination.path ? destination.path(claimId) : undefined) };
    }),
  }));
}
