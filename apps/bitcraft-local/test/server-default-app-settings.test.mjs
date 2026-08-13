import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDefaultAppSettings,
  defaultAppSettingRows,
  defaultClaimId,
  defaultRegionId,
  defaultSyncUrl,
  defaultTheme,
  obsoleteAppSettingKeys,
} from "../src/server/defaultAppSettings.mjs";

test("defaultAppSettingRows preserves bootstrap app settings and timestamps", () => {
  const rows = defaultAppSettingRows({
    serverRefreshSeconds: 45,
    updatedAt: "2026-06-29T12:00:00.000Z",
  });

  assert.equal(rows.length, 18);
  assert.deepEqual(rows.map((row) => row.key), [
    "claim_id",
    "bitcraft_sync_url",
    "excluded_member_ids_json",
    "theme_json",
    "refresh_seconds",
    "server_refresh_seconds",
    "default_page",
    "default_region",
    "toast_json",
    "market_deal_watch_json",
    "branding_json",
    "app_popups_json",
    "visitor_security_json",
    "discord_json",
    "discord_last_announced_version",
    "discord_last_supply_report_at",
    "discord_last_low_supplies_at",
    "discord_last_delivery_json",
  ]);
  assert.equal(rows.every((row) => row.updatedAt === "2026-06-29T12:00:00.000Z"), true);
  assert.equal(rows.find((row) => row.key === "claim_id")?.value, defaultClaimId);
  assert.equal(rows.find((row) => row.key === "bitcraft_sync_url")?.value, defaultSyncUrl);
  assert.equal(rows.find((row) => row.key === "theme_json")?.value, JSON.stringify(defaultTheme));
  assert.equal(rows.find((row) => row.key === "server_refresh_seconds")?.value, "45");
  assert.equal(rows.find((row) => row.key === "default_page")?.value, "dashboard");
  assert.equal(rows.find((row) => row.key === "default_region")?.value, defaultRegionId);
});

test("defaultAppSettingRows preserves JSON defaults used by admin and notification flows", () => {
  const rows = Object.fromEntries(defaultAppSettingRows({ serverRefreshSeconds: 30, updatedAt: "now" }).map((row) => [row.key, row.value]));

  assert.deepEqual(JSON.parse(rows.excluded_member_ids_json), []);
  assert.deepEqual(JSON.parse(rows.toast_json), { marketListings: true, marketSales: true, production: true });
  assert.deepEqual(JSON.parse(rows.market_deal_watch_json), {
    maxWatchesPerUser: 10,
    thresholdPercent: 30,
    minActiveListings: 3,
    discordDmEnabled: true,
  });
  assert.deepEqual(JSON.parse(rows.app_popups_json), { popups: [] });
  assert.deepEqual(JSON.parse(rows.visitor_security_json), {
    fullIpRetentionDays: 7,
    statsRetentionDays: 180,
    geoipProvider: "ipapi",
    geoipCacheDays: 30,
    geoipSourceUrl: "",
    geoipAccountId: "",
    geoipLicenseKey: "",
  });
  const discord = JSON.parse(rows.discord_json);
  assert.equal(discord.enabled, false);
  assert.equal(discord.notify.marketListings, true);
  assert.equal(discord.notify.productionStarted, true);
  assert.equal(discord.craftChannels.forestry, "1509932116077711411");
  assert.deepEqual(JSON.parse(rows.discord_last_delivery_json), { status: "none" });
});

test("obsoleteAppSettingKeys removes retired configuration from existing databases", () => {
  assert.deepEqual(obsoleteAppSettingKeys, ["analytics_json", "collector_settings_json", "map_renderer_mode"]);
});
test("applyDefaultAppSettings inserts defaults and removes obsolete settings", () => {
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(["prepare", sql]);
      return { run: (...args) => calls.push(["run", ...args]) };
    },
  };

  applyDefaultAppSettings(db, {
    serverRefreshSeconds: 90,
    updatedAt: "2026-06-29T12:30:00.000Z",
    rows: [
      { key: "claim_id", value: "claim-1", updatedAt: "2026-06-29T12:30:00.000Z" },
      { key: "default_page", value: "dashboard", updatedAt: "2026-06-29T12:30:00.000Z" },
    ],
    obsoleteKeys: ["old_key"],
  });

  assert.deepEqual(calls, [
    ["prepare", "INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)"],
    ["run", "claim_id", "claim-1", "2026-06-29T12:30:00.000Z"],
    ["run", "default_page", "dashboard", "2026-06-29T12:30:00.000Z"],
    ["prepare", "DELETE FROM app_settings WHERE key = ?"],
    ["run", "old_key"],
  ]);
});

test("applyDefaultAppSettings derives default rows when rows are not supplied", () => {
  const inserted = [];
  const deleted = [];
  const db = {
    prepare(sql) {
      if (sql.startsWith("INSERT")) return { run: (...args) => inserted.push(args) };
      if (sql.startsWith("DELETE")) return { run: (...args) => deleted.push(args) };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  applyDefaultAppSettings(db, {
    serverRefreshSeconds: 75,
    updatedAt: "2026-06-29T12:45:00.000Z",
  });

  assert.equal(inserted.length, 18);
  assert.deepEqual(inserted.find(([key]) => key === "server_refresh_seconds"), ["server_refresh_seconds", "75", "2026-06-29T12:45:00.000Z"]);
  assert.deepEqual(deleted, [["analytics_json"], ["collector_settings_json"], ["map_renderer_mode"]]);
});
