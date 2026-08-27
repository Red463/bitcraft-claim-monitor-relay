export type CraftPlanSummary = { id: string; name?: string; scope?: "shared" | "personal"; primary?: boolean; revision?: number; ownerUserId?: number | null };
export function resolveCraftPlanSelection(plans: CraftPlanSummary[], requestedPlanId?: string, rememberedPlanId?: string): { planId: string; fellBack: boolean };
