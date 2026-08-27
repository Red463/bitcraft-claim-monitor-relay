import type { ActivePanel } from "../types/app.ts";
import type { DomainKey, DomainStatus } from "../server/game-data/contracts.ts";

type DomainStatusMap = Partial<Record<DomainKey, DomainStatus>>;

const PANEL_LABELS: Partial<Record<DomainKey, string>> = {
  skills: "Professions",
  research: "Research",
  market: "Local Market",
  region: "Region",
  "region-claims": "Region",
  "public-crafts": "Public Craft Finder",
};

const ACTIVE_PANEL_LABELS: Partial<Record<ActivePanel, string>> = {
  dashboard: "Dashboard",
  skills: "Professions",
  leaderboard: "Professions",
  research: "Research",
  "settlement-market": "Local Market",
  region: "Region",
  publiccrafts: "Public Craft Finder",
};

function affectedPanelLabel(activePanel: ActivePanel, domain: DomainKey): string {
  return PANEL_LABELS[domain] ?? ACTIVE_PANEL_LABELS[activePanel] ?? domain;
}

function ageLabel(ageMs: number | null): string {
  if (ageMs == null) return "unknown age";
  if (ageMs < 60_000) return `${Math.max(1, Math.round(ageMs / 1_000))}s`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m`;
  return `${Math.round(ageMs / 3_600_000)}h`;
}

export function gameDataQualitySummaries(
  activePanel: ActivePanel,
  domainStatus: DomainStatusMap,
): string[] {
  const affected = new Map<string, {
    state: "partial" | "stale" | "unavailable";
    ageMs: number | null;
    warningCount: number;
  }>();
  const priority = { partial: 1, stale: 2, unavailable: 3 } as const;
  for (const [domain, status] of Object.entries(domainStatus) as Array<[DomainKey, DomainStatus]>) {
    const state = status.freshness === "unavailable"
      ? "unavailable"
      : status.freshness === "stale"
        ? "stale"
        : status.confidence === "partial" || status.warnings.length
          ? "partial"
          : null;
    if (!state) continue;
    const label = affectedPanelLabel(activePanel, domain);
    const current = affected.get(label);
    if (!current) {
      affected.set(label, { state, ageMs: status.ageMs, warningCount: status.warnings.length });
      continue;
    }
    current.warningCount += status.warnings.length;
    if (priority[state] > priority[current.state]) {
      current.state = state;
      current.ageMs = status.ageMs;
    } else if (state === "stale" && current.state === "stale") {
      current.ageMs = Math.max(current.ageMs ?? 0, status.ageMs ?? 0);
    }
  }
  return [...affected.entries()].map(([label, issue]) => {
    if (issue.state === "stale") return `${label} stale (${ageLabel(issue.ageMs)})`;
    if (issue.state === "unavailable") return `${label} unavailable`;
    const warnings = `${issue.warningCount} warning${issue.warningCount === 1 ? "" : "s"}`;
    return `${label} partial (${warnings})`;
  });
}

export function publicGameDataQualitySummaries(
  activePanel: ActivePanel,
  domainStatus: DomainStatusMap,
  coherence: "coherent" | "mixed" | "unavailable" | null,
): string[] {
  const summaries = gameDataQualitySummaries(activePanel, domainStatus);
  if (coherence === "unavailable" && summaries.length === 0) {
    return ["Requested data unavailable"];
  }
  return summaries;
}

const RELAY_OUTAGE_WARNING = /^(?:Relay HTTP cache is not ready\.|Relay HTTP circuit is open\b|Relay (?:global|region \d+) source is not ready\b|Relay region \d+ is not ready\.)/;

export function relayOutageNotice(
  activePanel: ActivePanel,
  domainStatus: DomainStatusMap,
): { affectedAreas: string[]; lastLiveUpdateAge: string | null } | null {
  const statuses = Object.entries(domainStatus) as Array<[DomainKey, DomainStatus]>;
  if (!statuses.some(([, status]) => status.warnings.some((warning) => RELAY_OUTAGE_WARNING.test(String(warning))))) {
    return null;
  }

  const affectedAreas = new Set<string>();
  let oldestAgeMs: number | null = null;
  for (const [domain, status] of statuses) {
    if (status.freshness === "fresh" && status.confidence === "authoritative" && !status.warnings.length) continue;
    affectedAreas.add(affectedPanelLabel(activePanel, domain));
    if (status.ageMs != null) oldestAgeMs = Math.max(oldestAgeMs ?? 0, status.ageMs);
  }

  return {
    affectedAreas: [...affectedAreas],
    lastLiveUpdateAge: oldestAgeMs == null ? null : ageLabel(oldestAgeMs),
  };
}

function stableWarningMessage(message: string): string {
  return message
    .replace(/\b(?=[A-Za-z0-9_-]*[A-Za-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/g, "#")
    .replace(/\b\d+\b/g, "#");
}

type WarningGroup = {
  key: string;
  domain: DomainKey;
  message: string;
  count: number;
  examples: string[];
};

const MAX_WARNING_GROUPS = 12;

export function groupDomainWarnings(domainStatus: DomainStatusMap): {
  groups: WarningGroup[];
  totalGroupCount: number;
  omittedGroupCount: number;
  omittedWarningCount: number;
  totalWarningCount: number;
} {
  const groups = new Map<string, WarningGroup>();
  for (const [domain, status] of Object.entries(domainStatus) as Array<[DomainKey, DomainStatus]>) {
    for (const warning of status.warnings) {
      const message = stableWarningMessage(String(warning));
      const key = `${domain}:${message}`;
      const group = groups.get(key) ?? { key, domain, message, count: 0, examples: [] };
      group.count += 1;
      if (group.examples.length < 3 && !group.examples.includes(warning)) group.examples.push(warning);
      groups.set(key, group);
    }
  }
  const allGroups = [...groups.values()];
  const visibleGroups = allGroups.slice(0, MAX_WARNING_GROUPS);
  const omittedGroups = allGroups.slice(MAX_WARNING_GROUPS);
  return {
    groups: visibleGroups,
    totalGroupCount: allGroups.length,
    omittedGroupCount: omittedGroups.length,
    omittedWarningCount: omittedGroups.reduce((total, group) => total + group.count, 0),
    totalWarningCount: allGroups.reduce((total, group) => total + group.count, 0),
  };
}

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

export function staleDataWarning(options: {
  stale: boolean;
  refreshActive: boolean;
  lastUpdatedLabel: string | null;
}): string {
  if (!options.stale) return "";
  const savedAt = options.lastUpdatedLabel ? ` from ${options.lastUpdatedLabel}` : "";
  return options.refreshActive
    ? `Showing saved data${savedAt} while refresh continues.`
    : `Showing saved data${savedAt}; live refresh is unavailable.`;
}
