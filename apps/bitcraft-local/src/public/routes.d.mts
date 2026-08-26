export type PublicRouteId =
  | "home"
  | "dashboard"
  | "members"
  | "professions"
  | "inventory"
  | "crafts"
  | "calculator"
  | "account"
  | "settings"
  | "help"
  | "terms"
  | "privacy"
  | "plans"
  | "plan-new"
  | "plan"
  | "shared-plan"
  | "invite"
  | "coming-soon"
  | "not-found";

export type PublicRoute = {
  id: PublicRouteId;
  params: Record<string, string>;
  canonicalPath?: string;
};

export function resolvePublicRoute(pathname: string): PublicRoute;
export function publicClaimPath(hint: { claimId?: unknown } | null | undefined): string | null;
export function publicSettlementPath(hint: { claimId?: unknown } | null | undefined): string | null;
export function publicStorageKey(suffix: string): string;
