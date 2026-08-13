import { DEFAULT_THEME } from "./theme";
import type { AppSettings, DiscordPresence, DiscordRolePanel, DiscordWelcomeFlow } from "./types/settings";
export { DEFAULT_USER_TOAST_SETTINGS } from "./notifications/userToastSettings";

/*
 * Installation defaults shared by the browser and admin UI.
 *
 * These values seed server settings and provide frontend fallbacks before the
 * admin configuration is loaded. Keep secrets out of this file; Discord tokens,
 * OAuth secrets, and credentials belong in server-side settings only.
 */

export const DEFAULT_CLAIM_ID = "1369094286777412590";
export const DEFAULT_SYNC_URL = "https://bitcraftsync.app/s/MUFJw3#claims=1369094286777412590&players=1369094286756659093%2C576460752388321942%2C864691128512324120&shopping=i.2036617800%3A20&p.exc=1369094286756659093%3A1369094286764705296%2C1369094286756792917%3B864691128512324120%3A1369094286778153104%2C1369094286772328807%2C1369094286761962469%3B576460752388321942%3A1369094286783870822&crafts=1&crafts.pf=includedPlayers";

export const DEFAULT_CRAFT_CHANNELS: Record<string, string> = {
  forestry: "1509932116077711411",
  carpentry: "1509932154442875201",
  masonry: "1509932188446101585",
  mining: "1509932207060291797",
  smithing: "1509932228090658936",
  scholar: "1509932259262595245",
  hunting: "1510275986766434325",
  leatherworking: "1509932280829710547",
  tailoring: "1509932306486398976",
  farming: "1509932539626786926",
  fishing: "1509932564641747074",
  cooking: "1509932588180181033",
  foraging: "1509932609378058412",
};

export const DEFAULT_DISCORD_CHANNELS: Record<string, string> = {
  notifications: "",
  announcements: "",
  modNotes: "1509972023927902218",
  modLog: "",
  ...DEFAULT_CRAFT_CHANNELS,
};

export const DEFAULT_CRAFT_ROLES: Record<string, string> = {
  forestry: "1511297282769944596",
  carpentry: "1511297283386249358",
  masonry: "1511297283931639808",
  mining: "1511297284724494399",
  smithing: "1511297285772804206",
  scholar: "1511297286469324890",
  leatherworking: "1511297288511815751",
  tailoring: "1511297287157055632",
  farming: "1511297288176144425",
  fishing: "1511297635665969222",
  cooking: "1511297639269011486",
  foraging: "1511297639868665966",
  hunting: "1511297640866906153",
};

export const DEFAULT_CRAFT_EMOJIS: Record<string, string> = {};

export const DEFAULT_NOTIFICATION_CHANNELS: Record<string, string> = {
  // "profession" is a routing sentinel handled by the server: craft
  // notifications are posted to the configured channel for that profession.
  marketListings: "notifications",
  marketSales: "notifications",
  lowSupplies: "notifications",
  appUpdates: "notifications",
  youtubeVideos: "announcements",
  supplyReport: "modNotes",
  productionStarted: "profession",
  productionCompleted: "profession",
};

export const DEFAULT_COLOUR_ROLES = [
  { key: "green1", label: "Green 1", roleName: "Green 1", roleId: "", color: 0x2be56f },
  { key: "green2", label: "Green 2", roleName: "Green 2", roleId: "", color: 0x1fb72e },
  { key: "blue1", label: "Blue 1", roleName: "Blue 1", roleId: "", color: 0x5fa8ff },
  { key: "blue2", label: "Blue 2", roleName: "Blue 2", roleId: "", color: 0x244cff },
  { key: "purple", label: "Purple", roleName: "Purple", roleId: "", color: 0x9b4acb },
  { key: "pink", label: "Pink", roleName: "Pink", roleId: "", color: 0xff4f88 },
  { key: "red", label: "Red", roleName: "Red", roleId: "", color: 0xff2028 },
  { key: "yellow", label: "Yellow", roleName: "Yellow", roleId: "", color: 0xf4c430 },
  { key: "orange", label: "Orange", roleName: "Orange", roleId: "", color: 0xff9f1c },
  { key: "black", label: "Black", roleName: "Black", roleId: "", color: 0x111111 },
  { key: "white", label: "White", roleName: "White", roleId: "", color: 0xf4f4f4 },
];

export const DEFAULT_ROLE_PANELS: DiscordRolePanel[] = [
  {
    key: "access",
    label: "Access Roles",
    channelId: "",
    messageId: "",
    title: "Welcome to Timbersteel Trade!",
    description: "Choose your access role below.",
    mode: "single",
    showHelperText: true,
    options: [
      { key: "citizen", label: "Citizen", roleId: "", emoji: "1" },
      { key: "visitor", label: "Visitor", roleId: "", emoji: "2" },
    ],
  },
  {
    key: "professions",
    label: "Profession Roles",
    channelId: "",
    messageId: "",
    title: "Choose Your Professions",
    description: "Select as many profession interests as you like.",
    mode: "multi",
    showHelperText: true,
    options: Object.keys(DEFAULT_CRAFT_ROLES).map((key) => ({
      key,
      label: key === "leatherworking" ? "Leatherworking" : key[0].toUpperCase() + key.slice(1),
      roleId: DEFAULT_CRAFT_ROLES[key],
      emoji: "",
    })),
  },
  { key: "events", label: "Event Roles", channelId: "", messageId: "", title: "Event Roles", description: "Choose event pings you want.", mode: "multi", showHelperText: true, options: [] },
  { key: "timezones", label: "Timezone Roles", channelId: "", messageId: "", title: "Timezone Roles", description: "Choose your timezone group.", mode: "single", showHelperText: true, options: [] },
];

export const DEFAULT_WELCOME_FLOW: DiscordWelcomeFlow = {
  enabled: false,
  channelId: "",
  messageId: "",
  title: "Welcome to Timbersteel Trade",
  message: "Read the welcome steps, choose your roles, then click Ready.",
  readyRoleId: "",
  showNextStep: true,
};

export const DEFAULT_DISCORD_PRESENCE: DiscordPresence = {
  enabled: true,
  status: "online",
  activityType: "watching",
  activityText: "app.timbersteeltrade.com",
};

export const DISCORD_CHANNEL_FIELDS = Object.keys(DEFAULT_DISCORD_CHANNELS);

export const DEFAULT_SETTINGS: AppSettings = {
  claimId: DEFAULT_CLAIM_ID,
  syncUrl: DEFAULT_SYNC_URL,
  excludedMemberIds: [],
  theme: DEFAULT_THEME,
  refreshSeconds: 30,
  serverRefreshSeconds: 30,
  defaultPage: "dashboard",
  defaultRegion: "19",
  additionalActiveRegions: "",
  toastSettings: { marketListings: true, marketSales: true, production: true },
  marketDealWatch: { maxWatchesPerUser: 10, thresholdPercent: 30, minActiveListings: 3, discordDmEnabled: true },
  branding: {},
  visitorSecurity: { fullIpRetentionDays: 7, statsRetentionDays: 180, geoipProvider: "ipapi", geoipCacheDays: 30, geoipSourceUrl: "", geoipAccountId: "", geoipLicenseKey: "", geoipLicenseKeyConfigured: false },
  discord: {
    enabled: false,
    applicationId: "",
    publicKey: "",
    guildId: "",
    channelId: "",
    minSaleValue: 0,
    supplyRunwayDaysThreshold: 7,
    productionMinXp: 40000,
    productionMinAgeMinutes: 5,
    productionUsers: "",
    supplyReportIntervalDays: 3,
    channels: DEFAULT_DISCORD_CHANNELS,
    notificationChannels: DEFAULT_NOTIFICATION_CHANNELS,
    craftChannels: DEFAULT_CRAFT_CHANNELS,
    craftRoles: DEFAULT_CRAFT_ROLES,
    craftEmojis: DEFAULT_CRAFT_EMOJIS,
    colourRolesChannelId: "",
    colourRolesMessageId: "",
    colourRoles: DEFAULT_COLOUR_ROLES,
    rolePanels: DEFAULT_ROLE_PANELS,
    welcomeFlow: DEFAULT_WELCOME_FLOW,
    presence: DEFAULT_DISCORD_PRESENCE,
    youtube: { enabled: true, pollIntervalMinutes: 10 },
    notify: { marketListings: true, marketSales: true, production: true, productionStarted: true, productionCompleted: true, lowSupplies: false, appUpdates: true, supplyReports: true, youtubeVideos: true },
    botTokenConfigured: false,
    botTokenSource: null,
    interactionUrl: "/api/discord/interactions",
  },
};
