export const defaultClaimId = "1369094286777412590";
export const defaultRegionId = "19";
export const defaultSyncUrl = "https://bitcraftsync.app/s/MUFJw3#claims=1369094286777412590&players=1369094286756659093%2C576460752388321942%2C864691128512324120&shopping=i.2036617800%3A20&p.exc=1369094286756659093%3A1369094286764705296%2C1369094286756792917%3B864691128512324120%3A1369094286778153104%2C1369094286772328807%2C1369094286761962469%3B576460752388321942%3A1369094286783870822&crafts=1&crafts.pf=includedPlayers";

export const defaultTheme = {
  bg: "#0c0d10",
  sidebar: "#06070a",
  panel: "#181b21",
  panel2: "#11141a",
  border: "#353b46",
  muted: "#a8adba",
  text: "#f6f3ea",
  gold: "#f0c64f",
  good: "#4ee28a",
  danger: "#ef6461",
};

export const obsoleteAppSettingKeys = ["analytics_json", "collector_settings_json", "map_renderer_mode"];

export function defaultAppSettingRows({ serverRefreshSeconds, updatedAt }) {
  return [
    settingRow("claim_id", defaultClaimId, updatedAt),
    settingRow("bitcraft_sync_url", defaultSyncUrl, updatedAt),
    settingRow("excluded_member_ids_json", JSON.stringify([]), updatedAt),
    settingRow("theme_json", JSON.stringify(defaultTheme), updatedAt),
    settingRow("refresh_seconds", "30", updatedAt),
    settingRow("server_refresh_seconds", String(serverRefreshSeconds), updatedAt),
    settingRow("default_page", "dashboard", updatedAt),
    settingRow("default_region", defaultRegionId, updatedAt),
    settingRow("toast_json", JSON.stringify({ marketListings: true, marketSales: true, production: true }), updatedAt),
    settingRow("market_deal_watch_json", JSON.stringify({ maxWatchesPerUser: 10, thresholdPercent: 30, minActiveListings: 3, discordDmEnabled: true }), updatedAt),
    settingRow("branding_json", JSON.stringify({}), updatedAt),
    settingRow("app_popups_json", JSON.stringify({ popups: [] }), updatedAt),
    settingRow("visitor_security_json", JSON.stringify({ fullIpRetentionDays: 7, statsRetentionDays: 180, geoipProvider: "ipapi", geoipCacheDays: 30, geoipSourceUrl: "", geoipAccountId: "", geoipLicenseKey: "" }), updatedAt),
    settingRow("discord_json", JSON.stringify({ enabled: false, applicationId: "", publicKey: "", guildId: "", channelId: "", minSaleValue: 0, supplyRunwayDaysThreshold: 7, productionMinXp: 40000, productionMinAgeMinutes: 5, productionUsers: "", craftChannels: { forestry: "1509932116077711411", carpentry: "1509932154442875201", masonry: "1509932188446101585", mining: "1509932207060291797", smithing: "1509932228090658936", scholar: "1509932259262595245", hunting: "1510275986766434325", leatherworking: "1509932280829710547", tailoring: "1509932306486398976", farming: "1509932539626786926", fishing: "1509932564641747074", cooking: "1509932588180181033", foraging: "1509932609378058412" }, notify: { marketListings: true, marketSales: true, production: true, productionStarted: true, productionCompleted: true, lowSupplies: false, appUpdates: true } }), updatedAt),
    settingRow("discord_last_announced_version", "", updatedAt),
    settingRow("discord_last_supply_report_at", "", updatedAt),
    settingRow("discord_last_low_supplies_at", "", updatedAt),
    settingRow("discord_last_delivery_json", JSON.stringify({ status: "none" }), updatedAt),
  ];
}

function settingRow(key, value, updatedAt) {
  return { key, value, updatedAt };
}

export function applyDefaultAppSettings(db, {
  serverRefreshSeconds,
  updatedAt,
  rows = defaultAppSettingRows({ serverRefreshSeconds, updatedAt }),
  obsoleteKeys = obsoleteAppSettingKeys,
}) {
  const insertDefaultAppSetting = db.prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)");
  for (const row of rows) insertDefaultAppSetting.run(row.key, row.value, row.updatedAt);
  const deleteAppSetting = db.prepare("DELETE FROM app_settings WHERE key = ?");
  for (const key of obsoleteKeys) deleteAppSetting.run(key);
}
