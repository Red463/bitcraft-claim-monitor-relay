import { BOT_SECTION_IDS, type BotSection } from "../bot/botSectionState.ts";

export const ADMIN_TAB_IDS = [
  "status",
  "server-health",
  "analytics",
  "empire-membership",
  "configuration",
  "diagnostics",
  "discord",
  "database",
  "users",
  "accounts",
  "audit",
  "backups",
] as const;

export type AdminTab = (typeof ADMIN_TAB_IDS)[number];

export const CONFIGURATION_SECTION_IDS = [
  "general",
  "privacy",
  "notifications",
  "integrations",
  "branding",
] as const;

export type ConfigurationSection = (typeof CONFIGURATION_SECTION_IDS)[number];

function allowedValue<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

export function parseAdminLocation(search: string): {
  tab: AdminTab;
  configurationSection: ConfigurationSection;
} {
  const params = new URLSearchParams(search);
  return {
    tab: allowedValue(params.get("admin"), ADMIN_TAB_IDS, "status"),
    configurationSection: allowedValue(params.get("config"), CONFIGURATION_SECTION_IDS, "general"),
  };
}

export function adminSearchWithTab(
  search: string,
  tab: AdminTab,
  configurationSection?: ConfigurationSection,
): string {
  const params = new URLSearchParams(search);
  params.set("admin", tab);
  if (tab === "configuration") {
    params.set("config", configurationSection ?? parseAdminLocation(search).configurationSection);
  } else {
    params.delete("config");
  }
  return `?${params.toString()}`;
}

export function parseBotSectionLocation(search: string): BotSection {
  return allowedValue(new URLSearchParams(search).get("section"), BOT_SECTION_IDS, "setup");
}

export function botSearchWithSection(search: string, section: BotSection): string {
  const params = new URLSearchParams(search);
  params.set("section", section);
  return `?${params.toString()}`;
}
