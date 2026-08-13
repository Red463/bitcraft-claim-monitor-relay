import {
  DEFAULT_COLOUR_ROLES,
  DEFAULT_CRAFT_CHANNELS,
  DEFAULT_CRAFT_EMOJIS,
  DEFAULT_CRAFT_ROLES,
  DEFAULT_DISCORD_CHANNELS,
  DEFAULT_DISCORD_PRESENCE,
  DEFAULT_NOTIFICATION_CHANNELS,
  DEFAULT_ROLE_PANELS,
  DEFAULT_SETTINGS,
  DEFAULT_WELCOME_FLOW,
} from "../settingsDefaults";
import { DEFAULT_THEME } from "../theme";
import type { ActivePanel } from "../types/app";
import type { AppSettings, ColourRoleDefinition, DiscordPresence, DiscordRoleOption, DiscordRolePanel, DiscordWelcomeFlow } from "../types/settings";
import { unique } from "./array";
import { NAV } from "../navigation";
import { toNumber, type AnyRecord } from "../main-app-data";

// Settings are stored as JSON in SQLite and are also edited locally in several
// admin/browser dialogs. This module is the compatibility layer that merges
// older saved shapes with current defaults before the rest of the app consumes
// them.
export function uniqueKey(prefix = "colour"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function discordColorToHex(value: number): string {
  return `#${Math.max(0, Math.min(0xffffff, Math.round(toNumber(value)))).toString(16).padStart(6, "0")}`;
}

export function hexToDiscordColor(value: string): number {
  const cleaned = String(value ?? "").replace(/[^0-9a-f]/gi, "").slice(0, 6);
  return cleaned ? parseInt(cleaned.padEnd(6, "0"), 16) : 0xf4c430;
}

export function normalizeColourRoleDefinition(value: AnyRecord, fallback?: ColourRoleDefinition): ColourRoleDefinition {
  const label = String(value?.label ?? fallback?.label ?? "New Colour").trim() || "New Colour";
  const savedRoleName = String(value?.roleName ?? "").trim();
  return {
    key: String(value?.key ?? fallback?.key ?? uniqueKey()).trim() || uniqueKey(),
    label,
    roleName: savedRoleName || fallback?.roleName || label,
    roleId: String(value?.roleId ?? fallback?.roleId ?? "").trim(),
    color: Math.max(toNumber(value?.color ?? fallback?.color ?? 0xf4c430), 0),
  };
}

export function normalizeDiscordRoleOption(value: AnyRecord, fallback?: DiscordRoleOption): DiscordRoleOption {
  const label = String(value?.label ?? fallback?.label ?? "Role").trim() || "Role";
  return {
    key: String(value?.key ?? fallback?.key ?? uniqueKey("role")).trim() || uniqueKey("role"),
    label,
    roleId: String(value?.roleId ?? fallback?.roleId ?? "").trim(),
    emoji: String(value?.emoji ?? fallback?.emoji ?? "").trim(),
  };
}

export function normalizeDiscordRolePanel(value: AnyRecord, fallback?: DiscordRolePanel): DiscordRolePanel {
  const label = String(value?.label ?? fallback?.label ?? "Role Panel").trim() || "Role Panel";
  const options = Array.isArray(value?.options) ? value.options : fallback?.options ?? [];
  return {
    key: String(value?.key ?? fallback?.key ?? uniqueKey("panel")).trim() || uniqueKey("panel"),
    label,
    channelId: String(value?.channelId ?? fallback?.channelId ?? "").trim(),
    messageId: String(value?.messageId ?? fallback?.messageId ?? "").trim(),
    title: String(value?.title ?? fallback?.title ?? label).trim() || label,
    description: String(value?.description ?? fallback?.description ?? "").trim(),
    mode: String(value?.mode ?? fallback?.mode ?? "multi") === "single" ? "single" : "multi",
    showHelperText: value?.showHelperText ?? fallback?.showHelperText ?? true,
    options: options.map((option: AnyRecord, index: number) => normalizeDiscordRoleOption(option, fallback?.options?.[index])),
  };
}

export function normalizeDiscordWelcomeFlow(value: AnyRecord): DiscordWelcomeFlow {
  return {
    ...DEFAULT_WELCOME_FLOW,
    ...(value ?? {}),
    enabled: value?.enabled === true,
    channelId: String(value?.channelId ?? "").trim(),
    messageId: String(value?.messageId ?? "").trim(),
    title: String(value?.title ?? DEFAULT_WELCOME_FLOW.title).trim() || DEFAULT_WELCOME_FLOW.title,
    message: String(value?.message ?? DEFAULT_WELCOME_FLOW.message).trim() || DEFAULT_WELCOME_FLOW.message,
    readyRoleId: String(value?.readyRoleId ?? "").trim(),
    showNextStep: value?.showNextStep !== false,
  };
}

export function normalizeDiscordPresence(value: AnyRecord = {}): DiscordPresence {
  const status = ["online", "idle", "dnd", "invisible"].includes(String(value?.status)) ? String(value.status) as DiscordPresence["status"] : DEFAULT_DISCORD_PRESENCE.status;
  const activityType = ["playing", "watching", "listening", "competing"].includes(String(value?.activityType)) ? String(value.activityType) as DiscordPresence["activityType"] : DEFAULT_DISCORD_PRESENCE.activityType;
  return {
    ...DEFAULT_DISCORD_PRESENCE,
    ...(value ?? {}),
    enabled: value?.enabled !== false,
    status,
    activityType,
    activityText: String(value?.activityText ?? DEFAULT_DISCORD_PRESENCE.activityText).trim() || DEFAULT_DISCORD_PRESENCE.activityText,
  };
}

function normalizeCraftEmojiMap(value: AnyRecord | undefined): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, emoji]) => [String(key ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""), String(emoji ?? "").trim()])
    .filter(([key, emoji]) => key && /^<a?:[A-Za-z0-9_]{2,32}:\d{17,22}>$/.test(emoji)));
}
export function normalizeAppSettings(config: Partial<AppSettings> | AnyRecord | null | undefined): AppSettings {
  // Keep this tolerant of missing/narrow legacy shapes: self-hosted installs can
  // jump across many beta versions, and invalid settings should fall back to a
  // safe default rather than breaking the Admin page.
  const savedColourRoles = Array.isArray((config as AnyRecord)?.discord?.colourRoles) ? (config as AnyRecord).discord.colourRoles : null;
  const savedRolePanels = Array.isArray((config as AnyRecord)?.discord?.rolePanels) ? (config as AnyRecord).discord.rolePanels : null;
  const excludedMemberIds = Array.isArray((config as AnyRecord)?.excludedMemberIds)
    ? unique((config as AnyRecord).excludedMemberIds.map((value: unknown) => String(value ?? "").trim()).filter(Boolean))
    : [];
  const configuredDefaultPage = String((config as AnyRecord)?.defaultPage ?? DEFAULT_SETTINGS.defaultPage);
  const defaultPage = configuredDefaultPage === "buildings" || !NAV.some(([id]) => id === configuredDefaultPage && id !== "admin")
    ? DEFAULT_SETTINGS.defaultPage
    : configuredDefaultPage as ActivePanel;
  return {
    ...DEFAULT_SETTINGS,
    ...(config ?? {}),
    refreshSeconds: Math.min(Math.max(toNumber((config as AnyRecord)?.refreshSeconds) || DEFAULT_SETTINGS.refreshSeconds, 15), 300),
    serverRefreshSeconds: Math.min(Math.max(toNumber((config as AnyRecord)?.serverRefreshSeconds ?? (config as AnyRecord)?.refreshSeconds) || DEFAULT_SETTINGS.serverRefreshSeconds, 15), 300),
    defaultPage,
    excludedMemberIds,
    additionalActiveRegions: String((config as AnyRecord)?.additionalActiveRegions ?? ""),
    theme: { ...DEFAULT_THEME, ...((config as AnyRecord)?.theme ?? {}) },
    toastSettings: { ...DEFAULT_SETTINGS.toastSettings, ...((config as AnyRecord)?.toastSettings ?? {}) },
    marketDealWatch: {
      maxWatchesPerUser: Math.min(Math.max(toNumber((config as AnyRecord)?.marketDealWatch?.maxWatchesPerUser) || DEFAULT_SETTINGS.marketDealWatch.maxWatchesPerUser, 1), 100),
      thresholdPercent: Math.min(Math.max(toNumber((config as AnyRecord)?.marketDealWatch?.thresholdPercent) || DEFAULT_SETTINGS.marketDealWatch.thresholdPercent, 1), 95),
      minActiveListings: Math.min(Math.max(
        toNumber((config as AnyRecord)?.marketDealWatch?.minActiveListings ?? (config as AnyRecord)?.marketDealWatch?.minConfirmedSales)
          || DEFAULT_SETTINGS.marketDealWatch.minActiveListings,
        1,
      ), 100),
      discordDmEnabled: (config as AnyRecord)?.marketDealWatch?.discordDmEnabled !== false,
    },
    branding: (config as AnyRecord)?.branding ?? {},
    visitorSecurity: {
      fullIpRetentionDays: Math.min(Math.max(toNumber((config as AnyRecord)?.visitorSecurity?.fullIpRetentionDays) || DEFAULT_SETTINGS.visitorSecurity.fullIpRetentionDays, 1), 30),
      statsRetentionDays: Math.min(Math.max(toNumber((config as AnyRecord)?.visitorSecurity?.statsRetentionDays) || DEFAULT_SETTINGS.visitorSecurity.statsRetentionDays, 30), 730),
      geoipProvider: String((config as AnyRecord)?.visitorSecurity?.geoipProvider ?? "ipapi"),
      geoipCacheDays: Math.min(Math.max(toNumber((config as AnyRecord)?.visitorSecurity?.geoipCacheDays) || DEFAULT_SETTINGS.visitorSecurity.geoipCacheDays, 1), 90),
      geoipSourceUrl: String((config as AnyRecord)?.visitorSecurity?.geoipSourceUrl ?? ""),
      geoipAccountId: String((config as AnyRecord)?.visitorSecurity?.geoipAccountId ?? ""),
      geoipLicenseKey: String((config as AnyRecord)?.visitorSecurity?.geoipLicenseKey ?? ""),
      geoipLicenseKeyConfigured: Boolean((config as AnyRecord)?.visitorSecurity?.geoipLicenseKeyConfigured),
      geoipClearLicenseKey: Boolean((config as AnyRecord)?.visitorSecurity?.geoipClearLicenseKey),
    },
    discord: {
      ...DEFAULT_SETTINGS.discord,
      ...((config as AnyRecord)?.discord ?? {}),
      channels: { ...DEFAULT_DISCORD_CHANNELS, ...((config as AnyRecord)?.discord?.channels ?? {}), notifications: (config as AnyRecord)?.discord?.channelId ?? (config as AnyRecord)?.discord?.channels?.notifications ?? "" },
      notificationChannels: { ...DEFAULT_NOTIFICATION_CHANNELS, ...((config as AnyRecord)?.discord?.notificationChannels ?? {}) },
      youtube: { enabled: (config as AnyRecord)?.discord?.youtube?.enabled !== false, pollIntervalMinutes: Math.min(Math.max(toNumber((config as AnyRecord)?.discord?.youtube?.pollIntervalMinutes) || DEFAULT_SETTINGS.discord.youtube.pollIntervalMinutes, 1), 1440) },
      craftChannels: { ...DEFAULT_CRAFT_CHANNELS, ...((config as AnyRecord)?.discord?.channels ?? {}), ...((config as AnyRecord)?.discord?.craftChannels ?? {}) },
      craftRoles: { ...DEFAULT_CRAFT_ROLES, ...((config as AnyRecord)?.discord?.craftRoles ?? {}) },
      craftEmojis: { ...DEFAULT_CRAFT_EMOJIS, ...normalizeCraftEmojiMap((config as AnyRecord)?.discord?.craftEmojis) },
      colourRolesChannelId: String((config as AnyRecord)?.discord?.colourRolesChannelId ?? ""),
      colourRolesMessageId: String((config as AnyRecord)?.discord?.colourRolesMessageId ?? ""),
      colourRoles: (savedColourRoles ?? DEFAULT_COLOUR_ROLES).map((entry: AnyRecord, index: number) => normalizeColourRoleDefinition(entry, DEFAULT_COLOUR_ROLES[index])),
      rolePanels: (savedRolePanels ?? DEFAULT_ROLE_PANELS).map((entry: AnyRecord, index: number) => normalizeDiscordRolePanel(entry, DEFAULT_ROLE_PANELS[index])),
      welcomeFlow: normalizeDiscordWelcomeFlow((config as AnyRecord)?.discord?.welcomeFlow ?? {}),
      presence: normalizeDiscordPresence((config as AnyRecord)?.discord?.presence ?? {}),
      notify: { ...DEFAULT_SETTINGS.discord.notify, ...((config as AnyRecord)?.discord?.notify ?? {}) },
      productionMinAgeMinutes: toNumber((config as AnyRecord)?.discord?.productionMinAgeMinutes ?? (config as AnyRecord)?.discord?.productionMinAgeMins ?? DEFAULT_SETTINGS.discord.productionMinAgeMinutes),
    },
  } as AppSettings;
}

