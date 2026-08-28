import type { AnyRecord } from "../main-app-data";
import type { ThemeSettings } from "../theme";
import type { ActivePanel } from "./app";

// Shared settings types mirror the JSON saved by the local server. Optional
// token/secret fields are write-only in practice: public config responses should
// expose "configured" flags rather than returning sensitive values.
export type BrandingAsset = { fileName: string; contentType: string; updatedAt: string; url: string };
export type NotificationSoundId = "soft-chime" | "clear-ping" | "deep-bell" | "alert-pop" | "bright-ping" | "double-ping" | "coin-ding" | "coin-jingle" | "success-chime" | "warning-blip" | "soft-bell" | "urgent-pulse" | "crystal-tap" | "low-thud" | "arcade-beep" | "reverse-chime" | "ui-pop" | "ui-pack-pop" | "coin-clink-4" | "coin-clink-8" | "coin-clink-9" | "ui-blip" | "new-notification-1" | "notification-bell" | "confirm-tap" | "happy-pop" | "drop-coin" | "simple-ping" | "cash-register" | "plopp" | "interface-click" | "bubble-pop-soft" | "bubble-pop" | "notification-010" | "notification-035" | "notification-040" | "notification-047" | "notification-062" | "notification-beep";
export type NotificationSoundType = "marketListings" | "marketSales" | "dealAlerts" | "productionStarted" | "productionCompleted";
export type UserToastSettings = { marketListings: boolean; marketSales: boolean; production: boolean; soundEnabled: boolean; soundId: NotificationSoundId; soundVolume: number; soundByType: Partial<Record<NotificationSoundType, NotificationSoundId>> };
export type ActiveRegion = { regionId: string; regionName?: string; active?: boolean; syncing?: boolean; signedInPlayers?: number; playersInQueue?: number; updatedAt?: string | null; source?: string };
export type AppUser = {
  id: number;
  discordId: string;
  username: string;
  globalName: string;
  avatarUrl: string | null;
  characterPlayerId: string;
  characterName: string;
  characterStatus: "unlinked" | "pending" | "approved" | "rejected" | string;
  settings: AnyRecord;
  createdAt?: string;
  lastLoginAt?: string;
};
export type UserLegalStatus = {
  version: string;
  termsDigest: string;
  privacyDigest: string;
  acceptedAt: string | null;
  requiresAcceptance: boolean;
};
export type UserAuthState = {
  user: AppUser | null;
  csrfToken: string | null;
  discordLoginEnabled: boolean;
  legal: UserLegalStatus;
};
export type MarketDealWatchSettings = {
  maxWatchesPerUser: number;
  thresholdPercent: number;
  minActiveListings: number;
  discordDmEnabled: boolean;
};
export type ColourRoleDefinition = { key: string; label: string; roleName: string; roleId: string; color: number };
export type DiscordRoleOption = { key: string; label: string; roleId: string; emoji: string };
export type DiscordRolePanel = { key: string; label: string; channelId: string; messageId: string; title: string; description: string; mode: "single" | "multi"; showHelperText: boolean; options: DiscordRoleOption[] };
export type DiscordWelcomeFlow = { enabled: boolean; channelId: string; messageId: string; title: string; message: string; readyRoleId: string; showNextStep: boolean };
export type DiscordPresence = { enabled: boolean; status: "online" | "idle" | "dnd" | "invisible"; activityType: "playing" | "watching" | "listening" | "competing"; activityText: string };
export type DiscordYouTubeSettings = { enabled: boolean; pollIntervalMinutes: number };
export type DiscordSettings = {
  enabled: boolean;
  applicationId: string;
  publicKey: string;
  guildId: string;
  channelId: string;
  minSaleValue: number;
  supplyRunwayDaysThreshold: number;
  productionMinXp: number;
  productionMinAgeMinutes: number;
  productionUsers: string;
  supplyReportIntervalDays: number;
  channels: Record<string, string>;
  notificationChannels: Record<string, string>;
  craftChannels: Record<string, string>;
  craftRoles: Record<string, string>;
  craftEmojis: Record<string, string>;
  colourRolesChannelId: string;
  colourRolesMessageId: string;
  colourRoles: ColourRoleDefinition[];
  rolePanels: DiscordRolePanel[];
  welcomeFlow: DiscordWelcomeFlow;
  presence: DiscordPresence;
  youtube: DiscordYouTubeSettings;
  notify: { marketListings: boolean; marketSales: boolean; production: boolean; productionStarted: boolean; productionCompleted: boolean; lowSupplies: boolean; appUpdates: boolean; supplyReports: boolean; youtubeVideos: boolean };
  botToken?: string;
  clearBotToken?: boolean;
  botTokenConfigured?: boolean;
  botTokenSource?: string | null;
  interactionUrl?: string;
};
export type AppSettings = {
  claimId: string;
  syncUrl: string;
  excludedMemberIds: string[];
  theme: ThemeSettings;
  refreshSeconds: number;
  serverRefreshSeconds: number;
  defaultPage: ActivePanel;
  defaultRegion: string;
  additionalActiveRegions: string;
  toastSettings: { marketListings: boolean; marketSales: boolean; production: boolean };
  marketDealWatch: MarketDealWatchSettings;
  branding: { logo?: BrandingAsset; favicon?: BrandingAsset };
  visitorSecurity: { fullIpRetentionDays: number; statsRetentionDays: number; geoipProvider: string; geoipCacheDays: number; geoipSourceUrl: string; geoipAccountId: string; geoipLicenseKey?: string; geoipLicenseKeyConfigured?: boolean; geoipClearLicenseKey?: boolean };
  discord: DiscordSettings;
};


