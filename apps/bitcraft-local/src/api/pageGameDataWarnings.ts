import type { ActivePanel } from "../types/app.ts";

const DASHBOARD_OWNER_ENRICHMENT_WARNING =
  /^region-claims: Regional claims missing owner usernames: \d+\.$/;

export function pageGameDataWarnings(
  activePanel: ActivePanel,
  warnings: string[],
): string[] {
  if (activePanel !== "dashboard") return warnings;
  return warnings.filter(
    (warning) => !DASHBOARD_OWNER_ENRICHMENT_WARNING.test(warning),
  );
}
