import type { DomainKey } from "../server/game-data/contracts.ts";
import type { ActivePanel } from "../types/app.ts";

const PROVIDER_NEUTRAL_PANELS = new Set<ActivePanel>([
  "dashboard",
  "members",
  "skills",
  "leaderboard",
  "inventory",
  "craft-monitor",
  "construction",
  "research",
  "settlement-market",
  "empires",
  "activity",
  "publiccrafts",
  "map",
  "region",
]);

export function usesProviderNeutralGameData(activePanel: ActivePanel): boolean {
  return PROVIDER_NEUTRAL_PANELS.has(activePanel);
}

export function pageDomains(activePanel: ActivePanel): DomainKey[] {
  switch (activePanel) {
    case "dashboard":
      return [
        "claim",
        "members",
        "citizens",
        "players",
        "construction",
        "market",
        "research",
        "crafts",
        "region-claims",
      ];
    case "members":
      return ["claim", "members", "citizens", "players", "equipment", "crafts", "recruitment"];
    case "skills":
    case "leaderboard":
      return ["claim", "members", "citizens", "players", "skills"];
    case "craft-monitor":
      return ["claim", "members", "citizens", "players", "crafts", "contributions"];
    case "inventory":
      return ["claim", "members", "inventories"];
    case "construction":
      return ["claim", "members", "inventories", "construction"];
    case "research":
      return ["claim", "members", "research"];
    case "settlement-market":
      return ["claim", "members", "market"];
    case "map":
      return ["claim", "members", "players"];
    case "region":
      return ["claim", "members", "players", "region", "region-claims"];
    case "empires":
      return ["claim", "members", "deposits"];
    case "activity":
      return ["claim", "members"];
    case "publiccrafts":
      return ["claim", "public-crafts"];
    default:
      return [];
  }
}
