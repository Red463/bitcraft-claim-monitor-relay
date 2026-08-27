export function resolveCraftPlanSelection(plans = [], requestedPlanId = "", rememberedPlanId = "") {
  const visible = new Set(plans.map((plan) => String(plan.id)));
  const requested = String(requestedPlanId ?? "").trim();
  if (requested && visible.has(requested)) return { planId: requested, fellBack: false };
  const primary = plans.find((plan) => plan.primary) ?? plans[0];
  if (requested) return { planId: String(primary?.id ?? ""), fellBack: true };
  const remembered = String(rememberedPlanId ?? "").trim();
  if (remembered && visible.has(remembered)) return { planId: remembered, fellBack: false };
  return { planId: String(primary?.id ?? ""), fellBack: false };
}
