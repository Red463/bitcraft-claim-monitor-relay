import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import {
  createCanonicalCutoverPrivacyPlan,
  prepareCanonicalCutoverPrivacyApply,
} from "./canonicalCutoverPrivacy.mjs";
import { projectContributionProfessionRepairRows } from "./contributionProfessionRepair.mjs";

export const CANONICAL_CLAIM_ID = "1369094286777412590";
export const CANONICAL_CUTOVER_MANIFEST_VERSION = 1;
export const DEFAULT_CANONICAL_CUTOVER_PATHS = Object.freeze({
  sourceDatabasePath: "/var/lib/bitcraft-claim-monitor/bitcraft-local.sqlite",
  targetDatabasePath: "/var/lib/bitcraft-claim-monitor-relay/bitcraft-local.sqlite",
  sourceBrandingDirectory: "/var/lib/bitcraft-claim-monitor/branding",
  targetBrandingDirectory: "/var/lib/bitcraft-claim-monitor-relay/branding",
});

export const CANONICAL_SETTING_KEYS = Object.freeze([
  "claim_id",
  "bitcraft_sync_url",
  "theme_json",
  "refresh_seconds",
  "server_refresh_seconds",
  "default_page",
  "default_region",
  "active_region_overrides",
  "excluded_member_ids_json",
  "visitor_security_json",
  "toast_json",
  "market_deal_watch_json",
  "discord_json",
  "branding_json",
  "app_popups_json",
  "access_control_json",
]);

export const REPLACED_DISCORD_TABLES = Object.freeze([
  "discord_youtube_channels",
  "discord_youtube_videos",
  "discord_craft_watches",
  "discord_mod_cases",
  "discord_warnings",
  "discord_mod_notes",
  "discord_custom_commands",
  "discord_component_votes",
  "discord_component_messages",
  "discord_temp_bans",
  "discord_craft_plan_report_occurrences",
]);

const MUTATED_TABLES = new Set([
  "user_accounts",
  "user_sessions",
  "user_legal_acceptances",
  "admin_users",
  "admin_sessions",
  "app_settings",
  "app_secrets",
  "craft_plan_settings",
  "craft_plans",
  "market_deal_watches",
  "scheduled_jobs",
  "admin_audit_log",
  ...REPLACED_DISCORD_TABLES,
]);

const PRIVACY_REPLAY_TABLES = new Set(["market_deal_alerts", "discord_delivery_log"]);

const REQUIRED_COLUMNS = Object.freeze({
  user_accounts: ["id", "discord_id", "discord_username", "discord_global_name", "discord_avatar", "character_player_id", "character_name", "character_status", "settings_json", "created_at", "last_login_at", "inactivity_warning_sent_at"],
  user_sessions: ["token_hash", "user_id", "expires_at", "created_at", "reauthenticated_at"],
  user_legal_acceptances: ["id", "user_id", "legal_version", "terms_digest", "privacy_digest", "age_confirmed", "accepted_at", "source"],
  admin_users: ["id", "username", "password_hash", "role", "created_at", "active", "last_login_at", "discord_id", "discord_username", "discord_global_name", "discord_avatar"],
  admin_sessions: ["token_hash", "user_id", "expires_at", "created_at"],
  app_settings: ["key", "value", "updated_at"],
  app_secrets: ["key", "value", "updated_at"],
  craft_plan_settings: ["plan_key", "config_json", "created_at", "updated_at"],
  market_deal_watches: ["id", "user_id", "discord_id", "claim_id", "region_id", "item_id", "item_type", "item_name", "tier", "rarity", "icon_asset_name", "threshold_percent", "enabled", "last_checked_at", "last_alert_at", "last_baseline_window_days", "last_baseline_average", "last_error", "created_at", "updated_at"],
  scheduled_jobs: ["job_key", "label", "description", "schedule", "enabled", "last_run_at", "last_success_at", "last_error", "next_run_at", "running", "metadata_json", "updated_at"],
  admin_audit_log: ["id", "user_id", "username", "action", "details_json", "occurred_at"],
  discord_youtube_channels: ["channel_id", "input", "title", "url", "discord_channel_id", "enabled", "last_checked_at", "last_success_at", "last_error", "last_video_id", "last_video_title", "last_video_published_at", "created_at", "updated_at"],
  discord_youtube_videos: ["video_id", "channel_id", "title", "url", "thumbnail_url", "published_at", "seen_at", "notified_at"],
  discord_craft_watches: ["id", "guild_id", "user_id", "profession_key", "profession_name", "mode", "updated_at"],
  discord_mod_cases: ["id", "guild_id", "case_type", "user_id", "moderator", "reason", "details_json", "occurred_at"],
  discord_warnings: ["id", "guild_id", "user_id", "moderator", "reason", "active", "created_at"],
  discord_mod_notes: ["id", "guild_id", "user_id", "moderator", "note", "created_at"],
  discord_custom_commands: ["name", "description", "response", "updated_at"],
  discord_component_votes: ["message_id", "component_key", "user_id", "kind", "updated_at"],
  discord_component_messages: ["message_id", "kind", "metadata_json", "updated_at"],
  discord_temp_bans: ["guild_id", "user_id", "unban_at", "reason", "created_at"],
  discord_craft_plan_report_occurrences: ["rule_id", "occurrence_key", "scheduled_at", "status", "discord_message_id", "last_error", "created_at", "updated_at"],
});

// Generated from the selected-table shapes at live source build 15950d6f7f34 and
// target schema 0.53.0-beta.1. Each description covers ordered columns (declared
// type, computed affinity, nullability, default, PK position), FKs, every index/unique constraint,
// normalized CHECK-bearing table SQL, and triggers. The sole source compatibility
// exception normalizes market_deal_watches.last_baseline_average REAL or TEXT.
const SUPPORTED_SELECTED_SCHEMA_FINGERPRINTS = Object.freeze({
  user_accounts: "676576d72a2ff1cc2f5c185a937f2599c53bd04f4716de222affb69bef40ea83",
  user_sessions: "438708f8b49aaff2505ba8dc9a07bcfc995ac3f261731d2cc902e2e23d337ea3",
  user_legal_acceptances: "3a2d201dbe0dd069c05a3f3bcfd339d394ed51b47784d8b4a0fb724794e08937",
  admin_users: "3368a5b9f2cf26c8bcb0db3be2baa383e65373c6d6053434f2f210c102fbeb6a",
  admin_sessions: "0381add5807bd19fe1b01992c929559eeb0a16afb5972c7bcd85564e8a088ffb",
  app_settings: "b3ede99ee79980ee201b9ad17b669dc9b83d9db963f77c96cd2db5a49f6af8f3",
  app_secrets: "9479bc0d0ba5d21d937fa0b792727f091f13d961036382a692d84e05912851c3",
  craft_plan_settings: "3d5a95b6163825213852a13a8d1f403b2abc66c80bc870a363d99969f288233e",
  market_deal_watches: "2f4e04a537e3cfbc5fc320e653e22e72a3afbfb2c98f1e05d8c1e2e05b86c46e",
  scheduled_jobs: "517f110b56b3a78e23f02db5ad389151e273003b9c62a41f5694d1544fa6bcfd",
  admin_audit_log: "bfc50b62c6a6bd4cb5c258667b025d0ac2fee57510c0678627bf466e77ff5c93",
  discord_youtube_channels: "8cd3036bbfe2e06006f9be365a21e264e379896f0872b845c1d91205bb020b8a",
  discord_youtube_videos: "32e2d64adf66308ccbfcaf871e6036abb8b298b26337e82c730fac99f0adb474",
  discord_craft_watches: "0d227d1ce8fcfedf42daf07437de2c3f03e39421dbfa7c167e54fdc4789f664d",
  discord_mod_cases: "a2cbee4a9cde658836dfb5d64d91f13cda956d337ec6470b640633ca7ab13677",
  discord_warnings: "aacbceaeca0164040a1ccefc43f253bdeefabaa84b1f44775eabbf9dcb072071",
  discord_mod_notes: "5af03017c48d34013991c053ac39d8483bc68bd779633fbfe4959c4ef458ff4a",
  discord_custom_commands: "69e497448463c970a74db519f0d2f22a3babad3e9802cf4e74bb2125fd21883d",
  discord_component_votes: "7bc875ea6c149fecf1c8c49d96a8144a4f885296706b6e48d46a45ec52dae285",
  discord_component_messages: "09981f7359857fb4ec9f5d237a71ba678aa69b3f0b2693a4551138fe954a1505",
  discord_temp_bans: "352add8e5aa6485045237bf31aad99c1f243857babb1631beb6d83595ae6cee3",
  discord_craft_plan_report_occurrences: "b8916806cd9732f82e96dcc832b686c3c87e00c818a486a798d2579edc7cc7e0",
});

const SUPPORTED_SOURCE_MARKET_WATCH_SCHEMA_FINGERPRINT = "ce59495a91bf6c7079856af0693e36347c7fc22d43524f8439bb7c77779d6b3f";
const SUPPORTED_SOURCE_SELECTED_SCHEMA_FINGERPRINTS = Object.freeze({
  user_accounts: new Set([
    SUPPORTED_SELECTED_SCHEMA_FINGERPRINTS.user_accounts,
    "cd591d6b3e2abe437a94bb467c8cb3ed5ac75346cbc0137e18c7b25ae39ecc7d",
  ]),
  admin_users: new Set([
    SUPPORTED_SELECTED_SCHEMA_FINGERPRINTS.admin_users,
    "519dab3464692744db8f5a44f4f2e88bf0a57101eaa4dbb7117c4a1516dc44c7",
  ]),
  discord_youtube_channels: new Set([
    SUPPORTED_SELECTED_SCHEMA_FINGERPRINTS.discord_youtube_channels,
    "9bcf0d5a0908c9f18a0d7d14892ce8fb198d0321e1f35a0ee28030f9725c7511",
  ]),
});

const ACCOUNT_FIELDS = REQUIRED_COLUMNS.user_accounts.filter((column) => column !== "id");
const ADMIN_FIELDS = REQUIRED_COLUMNS.admin_users.filter((column) => column !== "id");
const WATCH_FIELDS = REQUIRED_COLUMNS.market_deal_watches.filter((column) => !["id", "user_id"].includes(column));
const ADMIN_ROLES = new Set(["owner", "admin", "discord-manager", "moderator", "viewer"]);

const IMAGE_TYPES = Object.freeze({
  ".png": { contentType: "image/png", magic: (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  ".jpg": { contentType: "image/jpeg", magic: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  ".webp": { contentType: "image/webp", magic: (bytes) => bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" },
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

const DEFAULT_DURABILITY_FILESYSTEM = Object.freeze({
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
});

export function createCanonicalCutoverDurability(
  filesystem = DEFAULT_DURABILITY_FILESYSTEM,
  { platform = process.platform, processId = process.pid } = {},
) {
  const syncDirectory = (directoryPath) => {
    // Windows requires a writable directory handle for FlushFileBuffers; POSIX
    // directories must be opened read-only. Both paths execute a real fsync.
    const descriptor = filesystem.openSync(directoryPath, platform === "win32" ? "r+" : "r");
    try {
      filesystem.fsyncSync(descriptor);
    } finally {
      filesystem.closeSync(descriptor);
    }
  };
  const syncParent = (entryPath) => syncDirectory(path.dirname(entryPath));
  const syncFile = (filePath) => {
    const descriptor = filesystem.openSync(filePath, platform === "win32" ? "r+" : "r");
    try {
      filesystem.fsyncSync(descriptor);
    } finally {
      filesystem.closeSync(descriptor);
    }
  };
  const removePath = (entryPath, options = {}) => {
    filesystem.rmSync(entryPath, options);
    syncParent(entryPath);
  };
  const renamePath = (fromPath, toPath) => {
    filesystem.renameSync(fromPath, toPath);
    syncParent(toPath);
    if (!comparePaths(path.dirname(fromPath), path.dirname(toPath))) syncParent(fromPath);
  };
  const writeMarker = (markerPath, payload) => {
    const temporaryPath = `${markerPath}.tmp-${processId}`;
    let renamed = false;
    try {
      const descriptor = filesystem.openSync(temporaryPath, "wx", 0o600);
      try {
        filesystem.writeFileSync(descriptor, `${JSON.stringify(payload)}\n`);
        filesystem.fsyncSync(descriptor);
      } finally {
        filesystem.closeSync(descriptor);
      }
      filesystem.renameSync(temporaryPath, markerPath);
      renamed = true;
      syncParent(markerPath);
    } catch (error) {
      if (!renamed) {
        try { removePath(temporaryPath, { force: true }); } catch {}
      }
      throw error;
    }
  };
  return Object.freeze({ removePath, renamePath, syncDirectory, syncFile, syncParent, writeMarker });
}

const DEFAULT_CUTOVER_DURABILITY = createCanonicalCutoverDurability();

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  const descriptor = openSync(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function decimal(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new TypeError(`${label} must be an exact decimal ID in canonical string form`);
  }
  return value;
}

function comparePaths(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(path.resolve(left)) === normalize(path.resolve(right));
}

function pathContains(root, candidate) {
  const normalize = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  const relative = path.relative(normalize(path.resolve(root)), normalize(path.resolve(candidate)));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function guardedExistingPath(inputPath, kind, label) {
  const resolved = path.resolve(String(inputPath ?? ""));
  if (!existsSync(resolved)) throw new Error(`${label} does not exist: ${resolved}`);
  if (lstatSync(resolved).isSymbolicLink() || !comparePaths(realpathSync.native(resolved), resolved)) {
    throw new Error(`${label} must not be or traverse a symlink`);
  }
  const stats = statSync(resolved);
  if (kind === "file" && !stats.isFile()) throw new Error(`${label} must be a regular file`);
  if (kind === "directory" && !stats.isDirectory()) throw new Error(`${label} must be a directory`);
  return resolved;
}

function databaseFilesystemIdentity(databasePath, label) {
  let stats;
  try {
    stats = statSync(databasePath, { bigint: true });
  } catch (error) {
    throw new Error(`${label} filesystem identity could not be established safely: ${error.message}`);
  }
  if (typeof stats.dev !== "bigint" || typeof stats.ino !== "bigint" || typeof stats.nlink !== "bigint"
    || stats.dev < 0n || stats.ino <= 0n || stats.nlink <= 0n) {
    throw new Error(`${label} filesystem identity metadata is unavailable or unsafe`);
  }
  return { device: stats.dev, inode: stats.ino, linkCount: stats.nlink };
}

function assertDatabaseFilesystemIdentity(sourceDatabasePath, targetDatabasePath) {
  const source = databaseFilesystemIdentity(sourceDatabasePath, "Source database");
  const target = databaseFilesystemIdentity(targetDatabasePath, "Target database");
  if (source.device === target.device && source.inode === target.inode) {
    throw new Error("Source and target databases have the same filesystem identity (hard link)");
  }
  if (target.linkCount !== 1n) {
    throw new Error(`Target database hard-link count must be exactly 1; found ${target.linkCount}`);
  }
}

function guardedPlannedFilePath(inputPath, label, { allowExisting = false } = {}) {
  const resolved = path.resolve(String(inputPath ?? ""));
  const parent = guardedExistingPath(path.dirname(resolved), "directory", `${label} parent directory`);
  const canonical = path.join(parent, path.basename(resolved));
  if (!comparePaths(canonical, resolved)) throw new Error(`${label} must not traverse a symlink`);
  if (existsSync(canonical)) {
    if (!allowExisting) throw new Error(`${label} must be a new file`);
    return guardedExistingPath(canonical, "file", label);
  }
  return canonical;
}

function guardedExistingOrPlannedDirectory(inputPath, label) {
  const resolved = path.resolve(String(inputPath ?? ""));
  if (existsSync(resolved)) return guardedExistingPath(resolved, "directory", label);
  const parent = guardedExistingPath(path.dirname(resolved), "directory", `${label} parent directory`);
  const canonical = path.join(parent, path.basename(resolved));
  if (!comparePaths(canonical, resolved)) throw new Error(`${label} must not traverse a symlink`);
  return canonical;
}

function assertCutoverPathsAreDisjoint({
  sourceDatabasePath,
  targetDatabasePath,
  sourceBrandingDirectory,
  targetBrandingDirectory,
  backupBrandingDirectory,
  manifestPath,
  markerPath,
  pendingMarkerPath,
  privacyDeletionLedger = null,
}) {
  const files = [
    ["source database", sourceDatabasePath],
    ["target database", targetDatabasePath],
    ["manifest", manifestPath],
    ["applied marker", markerPath],
    ["pending marker", pendingMarkerPath],
    ...(privacyDeletionLedger ? [
      ["source privacy key", privacyDeletionLedger.source?.key?.path],
      ["source privacy ledger", privacyDeletionLedger.source?.ledger?.path],
      ["current privacy key", privacyDeletionLedger.target?.key?.path],
      ...(privacyDeletionLedger.target?.previousKeys ?? []).map((entry, index) => [
        `previous privacy key ${index + 1}`,
        entry.path,
      ]),
      ["installed previous privacy key", privacyDeletionLedger.previousKeyConfiguration?.installedOldKeyPath],
      ["target privacy ledger", privacyDeletionLedger.target?.ledger?.path],
      ["staged privacy ledger", privacyDeletionLedger.target?.stagedLedgerPath],
      ["privacy readiness artifact", privacyDeletionLedger.readinessArtifact?.path],
    ] : []),
  ];
  const roots = [
    ["source branding root", sourceBrandingDirectory],
    ["target branding root", targetBrandingDirectory],
    ["target branding backup root", backupBrandingDirectory],
  ];
  for (let leftIndex = 0; leftIndex < files.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < files.length; rightIndex += 1) {
      if (comparePaths(files[leftIndex][1], files[rightIndex][1])) {
        throw new Error(`Canonical cutover paths must be disjoint: ${files[leftIndex][0]} overlaps ${files[rightIndex][0]}`);
      }
    }
  }
  for (let leftIndex = 0; leftIndex < roots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < roots.length; rightIndex += 1) {
      if (pathContains(roots[leftIndex][1], roots[rightIndex][1]) || pathContains(roots[rightIndex][1], roots[leftIndex][1])) {
        throw new Error(`Canonical cutover paths must be disjoint: ${roots[leftIndex][0]} overlaps ${roots[rightIndex][0]}`);
      }
    }
  }
  for (const [fileLabel, filePath] of files) {
    for (const [rootLabel, rootPath] of roots) {
      if (pathContains(rootPath, filePath)) {
        throw new Error(`Canonical cutover paths must be disjoint: ${fileLabel} is inside ${rootLabel}`);
      }
    }
    const brandingStageParent = path.dirname(targetBrandingDirectory);
    const brandingStagePrefix = ".canonical-cutover-branding-stage-";
    const brandingStageRelativePath = path.relative(brandingStageParent, filePath);
    const brandingStageNamespace = brandingStageRelativePath.split(path.sep)[0];
    if (brandingStageRelativePath !== ""
      && !brandingStageRelativePath.startsWith(`..${path.sep}`)
      && brandingStageRelativePath !== ".."
      && !path.isAbsolute(brandingStageRelativePath)
      && brandingStageNamespace.startsWith(brandingStagePrefix)) {
      throw new Error(`Canonical cutover paths must be disjoint: ${fileLabel} overlaps the branding stage destructive namespace`);
    }
  }
}

function parseJson(value, label, fallback = undefined) {
  if (value == null && fallback !== undefined) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error(`${label} must contain valid JSON`);
  }
}

function schemaDescription(db) {
  return db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all().map((row) => ({
    type: String(row.type),
    name: String(row.name),
    table: String(row.tbl_name),
    sql: String(row.sql ?? "").replace(/\s+/g, " ").trim(),
  }));
}

function tableNames(db) {
  return db.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => String(row.name));
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function normalizeSchemaSql(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sqliteAffinity(declaredType) {
  const type = String(declaredType ?? "").toUpperCase();
  if (type.includes("INT")) return "INTEGER";
  if (["CHAR", "CLOB", "TEXT"].some((token) => type.includes(token))) return "TEXT";
  if (type === "" || type.includes("BLOB")) return "BLOB";
  if (["REAL", "FLOA", "DOUB"].some((token) => type.includes(token))) return "REAL";
  return "NUMERIC";
}

function selectedTableSchemaDescription(db, table, { allowLegacyMarketAverage = false } = {}) {
  const normalizeMarketAverage = (column, value) => (
    allowLegacyMarketAverage
      && table === "market_deal_watches"
      && column === "last_baseline_average"
      && ["REAL", "TEXT"].includes(String(value).toUpperCase())
      ? "TEXT_OR_REAL"
      : value
  );
  const tableRow = db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
  if (!tableRow) throw new Error(`missing table ${table}`);
  const columns = db.prepare(`PRAGMA table_xinfo(${quoteIdentifier(table)})`).all().map((column) => {
    const name = String(column.name);
    const declaredType = String(column.type ?? "").toUpperCase();
    return {
      affinity: normalizeMarketAverage(name, sqliteAffinity(declaredType)),
      defaultValue: column.dflt_value == null ? null : normalizeSchemaSql(column.dflt_value),
      declaredType: normalizeMarketAverage(name, declaredType),
      hidden: Number(column.hidden),
      name,
      notNull: Boolean(column.notnull),
      position: Number(column.cid),
      primaryKeyPosition: Number(column.pk),
    };
  });
  const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`).all().map((foreignKey) => ({
    from: String(foreignKey.from),
    id: Number(foreignKey.id),
    match: String(foreignKey.match),
    onDelete: String(foreignKey.on_delete),
    onUpdate: String(foreignKey.on_update),
    sequence: Number(foreignKey.seq),
    table: String(foreignKey.table),
    to: String(foreignKey.to),
  }));
  const indexes = db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all()
    .map((index) => ({
      columns: db.prepare(`PRAGMA index_xinfo(${quoteIdentifier(index.name)})`).all().map((column) => ({
        collation: String(column.coll),
        descending: Boolean(column.desc),
        key: Boolean(column.key),
        name: column.name == null ? null : String(column.name),
        position: Number(column.seqno),
        tableColumn: Number(column.cid),
      })),
      name: String(index.name),
      origin: String(index.origin),
      partial: Boolean(index.partial),
      sql: normalizeSchemaSql(db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?").get(index.name)?.sql),
      unique: Boolean(index.unique),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const triggers = db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? ORDER BY name").all()
    .map((trigger) => ({ name: String(trigger.name), sql: normalizeSchemaSql(trigger.sql) }));
  let tableSql = normalizeSchemaSql(tableRow.sql);
  if (allowLegacyMarketAverage && table === "market_deal_watches") {
    tableSql = tableSql.replace(/(last_baseline_average\s+)(?:REAL|TEXT)\b/i, "$1TEXT_OR_REAL");
  }
  return { columns, foreignKeys, indexes, tableSql, triggers };
}

function tableCount(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
}

function rowsContentFingerprint(columns, rows) {
  const hash = createHash("sha256");
  for (const row of rows) {
    const normalized = {};
    for (const column of columns) {
      const value = row[column];
      normalized[column] = value instanceof Uint8Array ? { blobSha256: sha256(value), size: value.byteLength } : value;
    }
    hash.update(canonicalJson(normalized));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function orderedTableRows(db, table) {
  const columnInfo = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  const tableSql = String(db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table)?.sql ?? "");
  const primaryKey = columnInfo.filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => quoteIdentifier(column.name));
  const ordering = /\bWITHOUT\s+ROWID\b/i.test(tableSql)
    ? (primaryKey.length ? ` ORDER BY ${primaryKey.join(", ")}` : "")
    : " ORDER BY rowid";
  return {
    columns: columnInfo.map((column) => String(column.name)),
    rows: db.prepare(`SELECT * FROM ${quoteIdentifier(table)}${ordering}`).all(),
  };
}

function tableContentFingerprint(db, table, projectedRows = null) {
  const { columns, rows } = orderedTableRows(db, table);
  return rowsContentFingerprint(columns, projectedRows ?? rows);
}

function databaseLogicalFingerprint(db, projectedTables = {}) {
  return sha256(canonicalJson({
    schema: schemaDescription(db),
    tables: Object.fromEntries(tableNames(db).map((table) => [table, {
      count: projectedTables[table]?.length ?? tableCount(db, table),
      contentSha256: tableContentFingerprint(db, table, projectedTables[table] ?? null),
    }])),
  }));
}

function databaseDescription(db, databasePath, { includeProtectedContent }) {
  const schema = schemaDescription(db);
  const names = tableNames(db);
  return {
    path: databasePath,
    schemaFingerprint: sha256(canonicalJson(schema)),
    tables: Object.fromEntries(names.map((table) => [table, {
      count: tableCount(db, table),
      ...(includeProtectedContent && !MUTATED_TABLES.has(table) ? { contentSha256: tableContentFingerprint(db, table) } : {}),
    }])),
  };
}

function databaseRecoveryFingerprint(db) {
  const tables = [...new Set([...MUTATED_TABLES, ...PRIVACY_REPLAY_TABLES])].sort();
  return sha256(canonicalJson({
    schema: schemaDescription(db),
    tables: Object.fromEntries(tables.map((table) => [table, {
      count: tableCount(db, table),
      contentSha256: tableContentFingerprint(db, table),
    }])),
  }));
}

function assertCleanCheckpoint(databasePath, label) {
  for (const suffix of ["-wal", "-journal"]) {
    const sidecarPath = `${databasePath}${suffix}`;
    if (existsSync(sidecarPath) && statSync(sidecarPath).size > 0) {
      throw new Error(`${label} must be frozen and cleanly checkpointed; found non-empty ${path.basename(sidecarPath)}`);
    }
  }
}

function nextIds(db, table, count) {
  if (!count) return [];
  const maximum = Number(db.prepare(`SELECT COALESCE(MAX(id), 0) AS value FROM ${quoteIdentifier(table)}`).get().value);
  const sequenceTable = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'sqlite_sequence'").get();
  const sequence = sequenceTable
    ? Number(db.prepare("SELECT COALESCE(seq, 0) AS value FROM sqlite_sequence WHERE name = ?").get(table)?.value ?? 0)
    : 0;
  const first = Math.max(maximum, sequence) + 1;
  return Array.from({ length: count }, (_, index) => first + index);
}

function accountMappings(source, target) {
  const sourceRows = source.prepare("SELECT id, discord_id FROM user_accounts ORDER BY id").all();
  const targetRows = target.prepare("SELECT id, discord_id FROM user_accounts ORDER BY id").all();
  const validate = (rows, label) => {
    const seen = new Set();
    for (const row of rows) {
      const discordId = decimal(row.discord_id, `${label} user account Discord ID`);
      if (seen.has(discordId)) throw new Error(`${label} user accounts contain duplicate Discord ID ${discordId}`);
      seen.add(discordId);
    }
  };
  validate(sourceRows, "Source");
  validate(targetRows, "Target");
  const targetByDiscordId = new Map(targetRows.map((row) => [String(row.discord_id), Number(row.id)]));
  const inserts = sourceRows.filter((row) => !targetByDiscordId.has(String(row.discord_id)));
  const insertedIds = nextIds(target, "user_accounts", inserts.length);
  let insertedIndex = 0;
  return sourceRows.map((row) => {
    const existing = targetByDiscordId.get(String(row.discord_id));
    return {
      action: existing == null ? "insert" : "overwrite",
      sourceId: Number(row.id),
      targetId: existing ?? insertedIds[insertedIndex++],
    };
  });
}

function assertSupportedSchema(db, label) {
  for (const table of Object.keys(REQUIRED_COLUMNS)) {
    const tableExists = db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
    if (!tableExists) throw new Error(`${label} database is unsupported: missing table ${table}`);
    const allowLegacyMarketAverage = label === "Source" && table === "market_deal_watches";
    const actual = sha256(canonicalJson(selectedTableSchemaDescription(db, table, { allowLegacyMarketAverage })));
    const expected = allowLegacyMarketAverage
      ? SUPPORTED_SOURCE_MARKET_WATCH_SCHEMA_FINGERPRINT
      : SUPPORTED_SELECTED_SCHEMA_FINGERPRINTS[table];
    const sourceFingerprints = label === "Source" ? SUPPORTED_SOURCE_SELECTED_SCHEMA_FINGERPRINTS[table] : null;
    const supported = sourceFingerprints
      ? sourceFingerprints.has(actual)
      : actual === expected;
    if (!supported) {
      throw new Error(`${label} database is unsupported: ${table} schema fingerprint does not match an explicitly supported shape`);
    }
  }
}

function assertJsonObject(value, label) {
  const parsed = parseJson(value, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object`);
  return parsed;
}

function optionalDecimal(value, label) {
  if (value == null || value === "") return null;
  return decimal(value, label);
}

function validateDecimalColumns(db, label, table, columns) {
  for (const row of db.prepare(`SELECT ${columns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(table)} ORDER BY rowid`).iterate()) {
    for (const column of columns) optionalDecimal(row[column], `${label} ${table}.${column}`);
  }
}

function validateDiscordSettingsIds(value) {
  const parsed = assertJsonObject(value, "source discord_json");
  const visit = (node, parentKey = "") => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const value_ of node) visit(value_, parentKey);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (child != null && child !== "" && /^(?:application|guild|channel|role|user|message)Id$/i.test(key)) {
        decimal(child, `source discord_json ${key}`);
      }
      if (child != null && child !== "" && ["channels", "craftChannels"].includes(parentKey) && typeof child !== "object") {
        decimal(child, `source discord_json ${parentKey}.${key}`);
      }
      visit(child, key);
    }
  };
  visit(parsed);
}

function validateSelectedRows(source, target, claimId) {
  for (const [db, label] of [[source, "Source"], [target, "Target"]]) {
    assertSupportedSchema(db, label);
    for (const row of db.prepare("SELECT id, settings_json FROM user_accounts ORDER BY id").all()) {
      assertJsonObject(row.settings_json, `${label} user account ${row.id} settings_json`);
    }
    validateDecimalColumns(db, label, "user_accounts", ["discord_id", "character_player_id"]);
    validateDecimalColumns(db, label, "admin_users", ["discord_id"]);
    validateDecimalColumns(db, label, "discord_youtube_channels", ["discord_channel_id"]);
    validateDecimalColumns(db, label, "discord_craft_watches", ["guild_id", "user_id"]);
    validateDecimalColumns(db, label, "discord_mod_cases", ["guild_id", "user_id"]);
    validateDecimalColumns(db, label, "discord_warnings", ["guild_id", "user_id"]);
    validateDecimalColumns(db, label, "discord_mod_notes", ["guild_id", "user_id"]);
    validateDecimalColumns(db, label, "discord_component_votes", ["message_id", "user_id"]);
    validateDecimalColumns(db, label, "discord_component_messages", ["message_id"]);
    validateDecimalColumns(db, label, "discord_temp_bans", ["guild_id", "user_id"]);
    validateDecimalColumns(db, label, "discord_craft_plan_report_occurrences", ["discord_message_id"]);
    for (const row of db.prepare("SELECT id, claim_id, discord_id, region_id, item_id, item_type FROM market_deal_watches ORDER BY id").all()) {
      if (decimal(row.claim_id, `${label} market watch ${row.id} claim ID`) !== claimId) {
        throw new Error(`${label} market watch ${row.id} is outside the canonical claim`);
      }
      decimal(row.discord_id, `${label} market watch ${row.id} Discord ID`);
      decimal(row.region_id, `${label} market watch ${row.id} region ID`);
      decimal(row.item_id, `${label} market watch ${row.id} item ID`);
      if (!["0", "1"].includes(String(row.item_type))) throw new Error(`${label} market watch ${row.id} item type must be 0 or 1`);
    }
    for (const row of db.prepare("SELECT plan_key, config_json FROM craft_plan_settings ORDER BY plan_key").all()) {
      assertJsonObject(row.config_json, `${label} craft plan ${row.plan_key} config_json`);
    }
    for (const row of db.prepare("SELECT job_key, metadata_json FROM scheduled_jobs ORDER BY job_key").all()) {
      assertJsonObject(row.metadata_json, `${label} scheduled job ${row.job_key} metadata_json`);
    }
    for (const row of db.prepare("SELECT id, details_json FROM admin_audit_log ORDER BY id").all()) {
      assertJsonObject(row.details_json, `${label} admin audit row ${row.id} details_json`);
    }
    for (const row of db.prepare("SELECT id, details_json FROM discord_mod_cases ORDER BY id").all()) {
      assertJsonObject(row.details_json, `${label} Discord moderation case ${row.id} details_json`);
    }
    for (const row of db.prepare("SELECT message_id, metadata_json FROM discord_component_messages ORDER BY message_id, kind").all()) {
      assertJsonObject(row.metadata_json, `${label} Discord component message metadata_json`);
    }
    if (label === "Source") {
      const unmappedLegal = db.prepare(`
        SELECT acceptance.id
        FROM user_legal_acceptances AS acceptance
        LEFT JOIN user_accounts AS account ON account.id = acceptance.user_id
        WHERE account.id IS NULL
        LIMIT 1
      `).get();
      if (unmappedLegal) throw new Error(`Source legal acceptance ${unmappedLegal.id} has an unmappable account`);
      const unmappedVideo = db.prepare(`
        SELECT video.video_id
        FROM discord_youtube_videos AS video
        LEFT JOIN discord_youtube_channels AS channel ON channel.channel_id = video.channel_id
        WHERE channel.channel_id IS NULL
        LIMIT 1
      `).get();
      if (unmappedVideo) throw new Error("Source Discord YouTube video has an unmappable channel");
    }
  }

  const sourceSettings = new Map(source.prepare("SELECT key, value FROM app_settings ORDER BY key").all().map((row) => [String(row.key), String(row.value)]));
  for (const key of CANONICAL_SETTING_KEYS.filter((candidate) => candidate.endsWith("_json"))) {
    if (!sourceSettings.has(key)) continue;
    const parsed = parseJson(sourceSettings.get(key), `source app_settings ${key}`);
    if (parsed == null || typeof parsed !== "object") throw new Error(`source app_settings ${key} must contain JSON`);
  }
  if (sourceSettings.has("discord_json")) validateDiscordSettingsIds(sourceSettings.get("discord_json"));
  if (sourceSettings.has("excluded_member_ids_json")) {
    const ids = parseJson(sourceSettings.get("excluded_member_ids_json"), "source excluded_member_ids_json");
    if (!Array.isArray(ids)) throw new Error("source excluded_member_ids_json must contain an array");
    for (const id of ids) decimal(id, "source excluded member ID");
  }
  if (sourceSettings.has("access_control_json")) {
    const access = assertJsonObject(sourceSettings.get("access_control_json"), "source access_control_json");
    if (access.accounts != null) {
      if (!access.accounts || typeof access.accounts !== "object" || Array.isArray(access.accounts)) throw new Error("source access_control_json accounts must be an object");
      for (const id of Object.keys(access.accounts)) decimal(id, "source access-control account Discord ID");
    }
  }
  if (sourceSettings.has("default_region") && sourceSettings.get("default_region") !== "") {
    decimal(sourceSettings.get("default_region"), "source default region ID");
  }
  if (sourceSettings.has("active_region_overrides")) {
    for (const id of String(sourceSettings.get("active_region_overrides")).split(/[\s,]+/).filter(Boolean)) {
      decimal(id, "source active region override");
    }
  }
}

function adminMappings(source, target) {
  const sourceRows = source.prepare("SELECT * FROM admin_users ORDER BY id").all();
  const targetRows = target.prepare("SELECT * FROM admin_users ORDER BY id").all();
  const validate = (rows, label) => {
    const usernames = new Set();
    const discordIds = new Set();
    for (const row of rows) {
      const username = String(row.username ?? "").trim();
      if (!username || usernames.has(username)) throw new Error(`${label} administrators contain an invalid or duplicate username`);
      usernames.add(username);
      const discordId = optionalDecimal(row.discord_id, `${label} administrator Discord ID`);
      if (discordId && discordIds.has(discordId)) throw new Error(`${label} administrators contain duplicate Discord IDs`);
      if (discordId) discordIds.add(discordId);
      const passwordHash = String(row.password_hash ?? "");
      const supportedPasswordHash = /^scrypt:[0-9a-fA-F]+:[0-9a-fA-F]{128}$/.test(passwordHash)
        || (passwordHash === "discord-oauth-admin" && Boolean(discordId));
      if (!supportedPasswordHash) {
        throw new Error(`${label} administrator ${row.id} has an unsupported password hash`);
      }
      if (!ADMIN_ROLES.has(String(row.role))) throw new Error(`${label} administrator ${row.id} has an unsupported role`);
      if (![0, 1].includes(Number(row.active))) throw new Error(`${label} administrator ${row.id} has an invalid active flag`);
    }
  };
  validate(sourceRows, "Source");
  validate(targetRows, "Target");
  const targetByUsername = new Map(targetRows.map((row) => [String(row.username), Number(row.id)]));
  const targetByDiscordId = new Map(targetRows.filter((row) => optionalDecimal(row.discord_id, "Target administrator Discord ID"))
    .map((row) => [String(row.discord_id), Number(row.id)]));
  const mappings = [];
  const usedTargetIds = new Set();
  const pending = [];
  for (const row of sourceRows) {
    const usernameMatch = targetByUsername.get(String(row.username));
    const discordMatch = row.discord_id ? targetByDiscordId.get(String(row.discord_id)) : undefined;
    if (usernameMatch != null && discordMatch != null && usernameMatch !== discordMatch) {
      throw new Error(`Source administrator ${row.id} has ambiguous target identity matches`);
    }
    const targetId = discordMatch ?? usernameMatch;
    if (targetId == null) pending.push(row);
    else {
      if (usedTargetIds.has(targetId)) throw new Error(`Multiple source administrators map to target administrator ${targetId}`);
      usedTargetIds.add(targetId);
      mappings.push({ action: "overwrite", sourceId: Number(row.id), targetId });
    }
  }
  const ids = nextIds(target, "admin_users", pending.length);
  pending.forEach((row, index) => mappings.push({ action: "insert", sourceId: Number(row.id), targetId: ids[index] }));
  mappings.sort((left, right) => left.sourceId - right.sourceId);
  return mappings;
}

function watchMappings(source, target, mappings, claimId) {
  const accountMap = new Map(mappings.map((mapping) => [mapping.sourceId, mapping.targetId]));
  const sourceAccounts = new Map(source.prepare("SELECT id, discord_id FROM user_accounts").all().map((row) => [Number(row.id), String(row.discord_id)]));
  const targetAccounts = new Map(target.prepare("SELECT id, discord_id FROM user_accounts").all().map((row) => [Number(row.id), String(row.discord_id)]));
  const sourceRows = source.prepare("SELECT * FROM market_deal_watches ORDER BY id").all();
  const targetRows = target.prepare("SELECT * FROM market_deal_watches ORDER BY id").all();
  for (const row of sourceRows) {
    const accountDiscordId = sourceAccounts.get(Number(row.user_id));
    if (!accountDiscordId || accountDiscordId !== String(row.discord_id)) throw new Error(`Source market watch ${row.id} cannot be mapped to its account`);
  }
  for (const row of targetRows) {
    const accountDiscordId = targetAccounts.get(Number(row.user_id));
    if (!accountDiscordId || accountDiscordId !== String(row.discord_id)) throw new Error(`Target market watch ${row.id} cannot be mapped to its account`);
  }
  const key = (userId, row) => [userId, claimId, String(row.region_id), String(row.item_id), String(row.item_type)].join("\0");
  const targetByKey = new Map(targetRows.map((row) => [key(Number(row.user_id), row), Number(row.id)]));
  const pending = [];
  const result = [];
  for (const row of sourceRows) {
    const targetUserId = accountMap.get(Number(row.user_id));
    if (targetUserId == null) throw new Error(`Source market watch ${row.id} has an unmappable account`);
    const existing = targetByKey.get(key(targetUserId, row));
    if (existing == null) pending.push({ row, targetUserId });
    else result.push({ action: "update", sourceId: Number(row.id), targetId: existing, targetUserId });
  }
  const ids = nextIds(target, "market_deal_watches", pending.length);
  pending.forEach(({ row, targetUserId }, index) => result.push({ action: "insert", sourceId: Number(row.id), targetId: ids[index], targetUserId }));
  result.sort((left, right) => left.sourceId - right.sourceId);
  return result;
}

function auditMappings(source, target, adminMap) {
  const mappedIds = new Map(adminMap.map((mapping) => [mapping.sourceId, mapping.targetId]));
  const targetRows = target.prepare("SELECT * FROM admin_audit_log ORDER BY id").all();
  const identity = (row) => canonicalJson({
    userId: row.user_id == null ? null : Number(row.user_id),
    username: String(row.username),
    action: String(row.action),
    detailsJson: String(row.details_json),
    occurredAt: String(row.occurred_at),
  });
  const existing = new Map();
  for (const row of targetRows) if (!existing.has(identity(row))) existing.set(identity(row), Number(row.id));
  const sourceRows = source.prepare("SELECT * FROM admin_audit_log ORDER BY id").all();
  const pending = [];
  const pendingByIdentity = new Map();
  const pendingDuplicates = [];
  const result = [];
  for (const row of sourceRows) {
    const mappedAdminId = row.user_id == null ? null : (mappedIds.get(Number(row.user_id)) ?? null);
    const normalized = { ...row, user_id: mappedAdminId };
    const rowIdentity = identity(normalized);
    const duplicateId = existing.get(rowIdentity);
    if (duplicateId != null) {
      result.push({ action: "duplicate", mappedAdminId, sourceId: Number(row.id), targetId: duplicateId });
    } else if (pendingByIdentity.has(rowIdentity)) {
      pendingDuplicates.push({ mappedAdminId, rowIdentity, sourceId: Number(row.id) });
    } else {
      const entry = { row, mappedAdminId, rowIdentity };
      pending.push(entry);
      pendingByIdentity.set(rowIdentity, entry);
    }
  }
  const ids = nextIds(target, "admin_audit_log", pending.length);
  const insertedIds = new Map();
  pending.forEach(({ row, mappedAdminId, rowIdentity }, index) => {
    insertedIds.set(rowIdentity, ids[index]);
    result.push({ action: "append", mappedAdminId, sourceId: Number(row.id), targetId: ids[index] });
  });
  for (const duplicate of pendingDuplicates) {
    result.push({
      action: "duplicate",
      mappedAdminId: duplicate.mappedAdminId,
      sourceId: duplicate.sourceId,
      targetId: insertedIds.get(duplicate.rowIdentity),
    });
  }
  result.sort((left, right) => left.sourceId - right.sourceId);
  return result;
}

function conflictDecisions(source, target, accountMap, adminMap, watchMap, auditMap) {
  const sourceSettingKeys = new Set(source.prepare("SELECT key FROM app_settings").all().map((row) => String(row.key)));
  const targetSettingKeys = new Set(target.prepare("SELECT key FROM app_settings").all().map((row) => String(row.key)));
  const sourcePlans = source.prepare("SELECT plan_key FROM craft_plan_settings ORDER BY plan_key").all().map((row) => String(row.plan_key));
  const targetPlans = new Set(target.prepare("SELECT plan_key FROM craft_plan_settings").all().map((row) => String(row.plan_key)));
  const sourceJobs = new Set(source.prepare("SELECT job_key FROM scheduled_jobs").all().map((row) => String(row.job_key)));
  const targetJobs = target.prepare("SELECT job_key FROM scheduled_jobs ORDER BY job_key").all().map((row) => String(row.job_key));
  return {
    accounts: {
      inserted: accountMap.filter((entry) => entry.action === "insert").length,
      overwritten: accountMap.filter((entry) => entry.action === "overwrite").length,
      retainedTargetOnly: tableCount(target, "user_accounts") - accountMap.filter((entry) => entry.action === "overwrite").length,
    },
    admins: {
      inserted: adminMap.filter((entry) => entry.action === "insert").length,
      overwritten: adminMap.filter((entry) => entry.action === "overwrite").length,
      removedTargetOnly: tableCount(target, "admin_users") - adminMap.filter((entry) => entry.action === "overwrite").length,
    },
    settings: CANONICAL_SETTING_KEYS.map((key) => ({
      action: sourceSettingKeys.has(key) ? (targetSettingKeys.has(key) ? "overwrite" : "insert") : "source-missing",
      key,
    })),
    craftPlans: sourcePlans.map((key) => ({ action: targetPlans.has(key) ? "overwrite" : "insert", key })),
    marketWatches: {
      inserted: watchMap.filter((entry) => entry.action === "insert").length,
      retainedTargetOnly: tableCount(target, "market_deal_watches") - watchMap.filter((entry) => entry.action === "update").length,
      updated: watchMap.filter((entry) => entry.action === "update").length,
    },
    scheduledJobs: targetJobs.map((key) => ({ action: sourceJobs.has(key) ? "overlay-and-reset" : "retain-target", key })),
    sourceOnlyScheduledJobsIgnored: [...sourceJobs].filter((key) => !targetJobs.includes(key)).sort(),
    replacedDiscordTables: Object.fromEntries(REPLACED_DISCORD_TABLES.map((table) => [table, {
      replacement: tableCount(source, table),
      targetReplaced: tableCount(target, table),
    }])),
    adminAudit: {
      appended: auditMap.filter((entry) => entry.action === "append").length,
      duplicates: auditMap.filter((entry) => entry.action === "duplicate").length,
      retainedTarget: tableCount(target, "admin_audit_log"),
    },
  };
}

function settingValue(db, key) {
  return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value;
}

function canonicalBrandingSetting(description) {
  return Object.fromEntries(Object.entries(description.assets).map(([type, asset]) => [type, {
    fileName: asset.fileName,
    contentType: asset.contentType,
    updatedAt: asset.updatedAt,
    url: asset.url,
  }]));
}

function brandingDescription(db, directory, label) {
  const raw = settingValue(db, "branding_json");
  const branding = raw == null ? {} : parseJson(raw, `${label} branding_json`);
  if (!branding || typeof branding !== "object" || Array.isArray(branding)) {
    throw new Error(`${label} branding_json must contain an object`);
  }
  const unsupportedTypes = Object.keys(branding).filter((type) => !["logo", "favicon"].includes(type));
  if (unsupportedTypes.length) throw new Error(`${label} branding metadata is noncanonical`);
  const referenced = new Set();
  const assets = {};
  for (const type of ["logo", "favicon"]) {
    const asset = branding[type];
    if (asset == null) continue;
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) throw new Error(`${label} ${type} branding metadata is invalid`);
    const assetKeys = Object.keys(asset).sort();
    if (canonicalJson(assetKeys) !== canonicalJson(["contentType", "fileName", "updatedAt", "url"])) {
      throw new Error(`${label} ${type} branding metadata is noncanonical`);
    }
    const fileName = String(asset.fileName ?? "");
    const extension = path.extname(fileName).toLowerCase();
    const format = IMAGE_TYPES[extension];
    if (path.basename(fileName) !== fileName || !format || fileName !== `${type}${extension}`) {
      throw new Error(`${label} ${type} branding filename is unsupported`);
    }
    if (String(asset.contentType ?? "") !== format.contentType) throw new Error(`${label} ${type} branding content type is invalid`);
    const canonicalUrl = `/api/local/branding/${type}`;
    if (asset.url !== canonicalUrl) throw new Error(`${label} ${type} branding URL must be same-origin and canonical`);
    if (typeof asset.updatedAt !== "string" || !Number.isFinite(Date.parse(asset.updatedAt)) || new Date(asset.updatedAt).toISOString() !== asset.updatedAt) {
      throw new Error(`${label} ${type} branding metadata is noncanonical`);
    }
    const filePath = path.resolve(directory, fileName);
    if (!comparePaths(path.dirname(filePath), directory)) throw new Error(`${label} branding asset escapes its supplied root`);
    guardedExistingPath(filePath, "file", `${label} ${type} branding asset`);
    const bytes = readFileSync(filePath);
    if (!bytes.length || bytes.length > 1024 * 1024) throw new Error(`${label} ${type} branding asset exceeds content limits`);
    if (!format.magic(bytes)) throw new Error(`${label} ${type} branding content does not match its declared type`);
    referenced.add(fileName);
    assets[type] = {
      contentType: format.contentType,
      fileName,
      sha256: sha256(bytes),
      size: bytes.length,
      updatedAt: asset.updatedAt,
      url: canonicalUrl,
    };
  }
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`${label} branding directory must not contain symlinks`);
  }
  return {
    assets,
    path: directory,
    settingPresent: raw != null,
    unexpectedFileCount: entries.filter((entry) => !referenced.has(entry.name)).length,
  };
}

function secretDescription(source) {
  const row = source.prepare("SELECT value FROM app_secrets WHERE key = 'discord_bot_token'").get();
  const present = row != null && String(row.value).trim().length > 0;
  return {
    canonicalPreflightRequiresEnvironmentToken: !present,
    discordBotToken: {
      fingerprint: present ? sha256(`discord_bot_token\0${String(row.value)}`) : null,
      present,
    },
  };
}

function collectTableCounts(sourceDescription, targetDescription, source, target, mappings) {
  const names = [...new Set([
    ...Object.keys(sourceDescription.tables),
    ...Object.keys(targetDescription.tables),
  ])].sort();
  const counts = Object.fromEntries(names.map((table) => {
    const targetCount = targetDescription.tables[table]?.count ?? 0;
    const excluded = !MUTATED_TABLES.has(table);
    return [table, {
      conflicting: 0,
      excluded,
      operation: excluded ? "protected" : "approved",
      replaced: 0,
      retained: targetCount,
      selected: 0,
      source: sourceDescription.tables[table]?.count ?? 0,
      target: targetCount,
    }];
  }));
  const set = (table, values) => Object.assign(counts[table], values);
  const accountConflicts = mappings.accounts.filter((entry) => entry.action === "overwrite").length;
  set("user_accounts", {
    conflicting: accountConflicts,
    retained: counts.user_accounts.target - accountConflicts,
    selected: mappings.accounts.length,
  });
  set("user_sessions", { replaced: counts.user_sessions.target, retained: 0, selected: counts.user_sessions.target });
  const accountMap = new Map(mappings.accounts.map((entry) => [entry.sourceId, entry.targetId]));
  let legalConflicts = 0;
  for (const row of source.prepare("SELECT * FROM user_legal_acceptances").iterate()) {
    const targetUserId = accountMap.get(Number(row.user_id));
    if (target.prepare("SELECT 1 FROM user_legal_acceptances WHERE user_id = ? AND legal_version = ? AND terms_digest = ? AND privacy_digest = ?")
      .get(targetUserId, row.legal_version, row.terms_digest, row.privacy_digest)) legalConflicts += 1;
  }
  set("user_legal_acceptances", { conflicting: legalConflicts, selected: counts.user_legal_acceptances.source });
  const adminConflicts = mappings.admins.filter((entry) => entry.action === "overwrite").length;
  set("admin_users", {
    conflicting: adminConflicts,
    replaced: counts.admin_users.target - adminConflicts,
    retained: 0,
    selected: mappings.admins.length,
  });
  set("admin_sessions", { replaced: counts.admin_sessions.target, retained: 0, selected: counts.admin_sessions.target });
  const sourceSettings = new Set(source.prepare("SELECT key FROM app_settings").all().map((row) => String(row.key)));
  const targetSettings = new Set(target.prepare("SELECT key FROM app_settings").all().map((row) => String(row.key)));
  const selectedSettings = CANONICAL_SETTING_KEYS.filter((key) => sourceSettings.has(key));
  const conflictingSettings = selectedSettings.filter((key) => targetSettings.has(key)).length;
  set("app_settings", { conflicting: conflictingSettings, replaced: conflictingSettings, retained: counts.app_settings.target - conflictingSettings, selected: selectedSettings.length });
  const sourceToken = source.prepare("SELECT 1 FROM app_secrets WHERE key = 'discord_bot_token'").get() ? 1 : 0;
  const targetToken = target.prepare("SELECT 1 FROM app_secrets WHERE key = 'discord_bot_token'").get() ? 1 : 0;
  set("app_secrets", { conflicting: sourceToken && targetToken ? 1 : 0, replaced: sourceToken && targetToken ? 1 : 0, retained: counts.app_secrets.target - (sourceToken && targetToken ? 1 : 0), selected: sourceToken });
  const targetPlans = new Set(target.prepare("SELECT plan_key FROM craft_plan_settings").all().map((row) => String(row.plan_key)));
  const sourcePlans = source.prepare("SELECT plan_key FROM craft_plan_settings").all().map((row) => String(row.plan_key));
  const planConflicts = sourcePlans.filter((key) => targetPlans.has(key)).length;
  set("craft_plan_settings", { conflicting: planConflicts, replaced: planConflicts, retained: counts.craft_plan_settings.target - planConflicts, selected: sourcePlans.length });
  const sourceHasPlanRecords = source.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'craft_plans'").get();
  const sourcePlanRecords = sourceHasPlanRecords ? source.prepare("SELECT id, scope, owner_user_id FROM craft_plans").all() : [];
  const importedPlanIds = sourcePlanRecords.length
    ? sourcePlanRecords.filter((row) => row.scope === "shared" || accountMap.has(Number(row.owner_user_id))).map((row) => String(row.id))
    : ["legacy-primary"];
  const targetPlanIds = new Set(target.prepare("SELECT id FROM craft_plans").all().map((row) => String(row.id)));
  const planRecordConflicts = importedPlanIds.filter((id) => targetPlanIds.has(id)).length;
  set("craft_plans", { conflicting: planRecordConflicts, replaced: planRecordConflicts, retained: counts.craft_plans.target - planRecordConflicts, selected: importedPlanIds.length });
  const watchConflicts = mappings.watches.filter((entry) => entry.action === "update").length;
  set("market_deal_watches", { conflicting: watchConflicts, replaced: watchConflicts, retained: counts.market_deal_watches.target - watchConflicts, selected: mappings.watches.length });
  const sourceJobs = new Set(source.prepare("SELECT job_key FROM scheduled_jobs").all().map((row) => String(row.job_key)));
  const matchedJobs = target.prepare("SELECT job_key FROM scheduled_jobs").all().filter((row) => sourceJobs.has(String(row.job_key))).length;
  set("scheduled_jobs", { conflicting: matchedJobs, replaced: matchedJobs, retained: counts.scheduled_jobs.target - matchedJobs, selected: matchedJobs });
  for (const table of REPLACED_DISCORD_TABLES) set(table, { replaced: counts[table].target, retained: 0, selected: counts[table].source });
  const appendedAudit = mappings.audits.filter((entry) => entry.action === "append").length;
  const duplicateAudit = mappings.audits.filter((entry) => entry.action === "duplicate").length;
  set("admin_audit_log", { conflicting: duplicateAudit, selected: appendedAudit + duplicateAudit });
  return counts;
}

function approvedContributionRepairDescription(target, repairManifest) {
  const projectedTables = projectContributionProfessionRepairRows(target, repairManifest);
  const tableDescription = (table, rows = null) => ({
    count: rows?.length ?? tableCount(target, table),
    contentSha256: tableContentFingerprint(target, table, rows),
  });
  const selectedIds = {
    aggregates: repairManifest.selection.aggregates.map((row) => String(row.id)),
    events: repairManifest.selection.events.map((row) => String(row.id)),
  };
  return {
    formatVersion: 1,
    manifestSha256: sha256(canonicalJson(repairManifest)),
    selectionHash: repairManifest.selectionHash,
    selectedCount: selectedIds.aggregates.length + selectedIds.events.length,
    selectedIds,
    counts: repairManifest.counts,
    expectedPreRepair: {
      databaseLogicalSha256: databaseLogicalFingerprint(target),
      tables: {
        production_contributions: tableDescription("production_contributions"),
        production_contribution_events: tableDescription("production_contribution_events"),
      },
    },
    expectedPostRepair: {
      databaseLogicalSha256: databaseLogicalFingerprint(target, projectedTables),
      tables: {
        production_contributions: tableDescription("production_contributions", projectedTables.production_contributions),
        production_contribution_events: tableDescription("production_contribution_events", projectedTables.production_contribution_events),
      },
    },
  };
}

function manifestWithoutHash(options, source, target) {
  validateSelectedRows(source, target, options.claimId);
  const sourceDatabase = databaseDescription(source, options.sourceDatabasePath, { includeProtectedContent: false });
  const targetDatabase = databaseDescription(target, options.targetDatabasePath, { includeProtectedContent: true });
  const accounts = accountMappings(source, target);
  const admins = adminMappings(source, target);
  const watches = watchMappings(source, target, accounts, options.claimId);
  const audits = auditMappings(source, target, admins);
  const manifest = {
    formatVersion: CANONICAL_CUTOVER_MANIFEST_VERSION,
    claimId: options.claimId,
    source: { database: sourceDatabase },
    target: { database: targetDatabase },
    tableCounts: collectTableCounts(sourceDatabase, targetDatabase, source, target, {
      accounts,
      admins,
      audits,
      watches,
    }),
    accountMappings: accounts,
    adminMappings: admins,
    watchMappings: watches,
    adminAuditMappings: audits,
    conflictDecisions: conflictDecisions(source, target, accounts, admins, watches, audits),
    branding: {
      source: brandingDescription(source, options.sourceBrandingDirectory, "Source"),
      target: brandingDescription(target, options.targetBrandingDirectory, "Target"),
    },
    secret: secretDescription(source),
    privacyLedgerKeyIds: options.privacyDeletionLedger
      ? {
          source: options.privacyDeletionLedger.source.key.keyId,
          target: options.privacyDeletionLedger.target.key.keyId,
        }
      : { source: null, target: null },
  };
  if (options.contributionRepairManifest) {
    manifest.approvedPreMigrationRepair = approvedContributionRepairDescription(target, options.contributionRepairManifest);
  }
  if (options.privacyDeletionLedger) manifest.privacyDeletionLedger = options.privacyDeletionLedger;
  return manifest;
}

function openReadOnly(databasePath) {
  return new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
}

function openWritableTarget(databasePath) {
  return new DatabaseSync(databasePath, { timeout: 5_000 });
}

export function createCanonicalCutoverManifest(input, { allowExistingManifest = false, now = () => new Date() } = {}) {
  const claimId = decimal(input.claimId, "claim ID");
  if (claimId !== CANONICAL_CLAIM_ID) throw new Error(`claim ID must be exactly ${CANONICAL_CLAIM_ID}`);
  const manifestPath = guardedPlannedFilePath(input.manifestPath, "Manifest", { allowExisting: allowExistingManifest });
  const markerPath = guardedPlannedFilePath(`${manifestPath}.applied`, "Applied marker");
  const pendingMarkerPath = guardedPlannedFilePath(`${manifestPath}.applying`, "Pending marker");
  const privacy = input.privacy
    ? { ...input.privacy, manifestCreatedAt: now().toISOString() }
    : null;
  const options = {
    claimId,
    sourceDatabasePath: guardedExistingPath(input.sourceDatabasePath, "file", "Source database"),
    targetDatabasePath: guardedExistingPath(input.targetDatabasePath, "file", "Target database"),
    sourceBrandingDirectory: guardedExistingPath(input.sourceBrandingDirectory, "directory", "Source branding directory"),
    targetBrandingDirectory: guardedExistingPath(input.targetBrandingDirectory, "directory", "Target branding directory"),
    privacyDeletionLedger: input.privacyPlan ?? (privacy ? createCanonicalCutoverPrivacyPlan(privacy) : null),
    contributionRepairManifest: input.contributionRepairManifest ?? null,
  };
  const backupBrandingDirectory = guardedExistingOrPlannedDirectory(`${options.targetBrandingDirectory}.canonical-cutover-backup`, "Target branding backup directory");
  if (existsSync(backupBrandingDirectory)) throw new Error("Target branding backup directory must not exist before dry-run");
  assertCutoverPathsAreDisjoint({
    ...options,
    backupBrandingDirectory,
    manifestPath,
    markerPath,
    pendingMarkerPath,
    privacyDeletionLedger: options.privacyDeletionLedger,
  });
  assertDatabaseFilesystemIdentity(options.sourceDatabasePath, options.targetDatabasePath);
  assertCleanCheckpoint(options.sourceDatabasePath, "Source database");
  assertCleanCheckpoint(options.targetDatabasePath, "Target database");
  const source = openReadOnly(options.sourceDatabasePath);
  const target = openReadOnly(options.targetDatabasePath);
  try {
    const sourceClaimId = decimal(settingValue(source, "claim_id"), "source app_settings claim_id");
    const targetClaimId = decimal(settingValue(target, "claim_id"), "target app_settings claim_id");
    if (sourceClaimId !== claimId || targetClaimId !== claimId) throw new Error("Source and target claim settings must match the exact canonical claim ID");
    const manifest = manifestWithoutHash(options, source, target);
    source.close();
    target.close();
    manifest.source.database.fileSha256 = sha256File(options.sourceDatabasePath);
    manifest.target.database.fileSha256 = sha256File(options.targetDatabasePath);
    return { ...manifest, selectionHash: sha256(canonicalJson(manifest)) };
  } finally {
    try { source.close(); } catch {}
    try { target.close(); } catch {}
  }
}

function rowMap(db, schema, table, key = "id") {
  return new Map(db.prepare(`SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(key)}`)
    .all().map((row) => [Number(row[key]), row]));
}

function insertRow(db, table, row, columns) {
  const names = columns ?? Object.keys(row);
  const placeholders = names.map(() => "?").join(", ");
  db.prepare(`INSERT INTO ${quoteIdentifier(table)} (${names.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})`)
    .run(...names.map((column) => row[column]));
}

function updateRow(db, table, keyColumn, keyValue, row, columns) {
  db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${columns.map((column) => `${quoteIdentifier(column)} = ?`).join(", ")} WHERE ${quoteIdentifier(keyColumn)} = ?`)
    .run(...columns.map((column) => row[column]), keyValue);
}

function applyAccounts(db, manifest) {
  const sourceRows = rowMap(db, "source", "user_accounts");
  for (const mapping of manifest.accountMappings) {
    const row = sourceRows.get(mapping.sourceId);
    if (!row) throw new Error(`Source account mapping ${mapping.sourceId} disappeared`);
    if (mapping.action === "overwrite") updateRow(db, "user_accounts", "id", mapping.targetId, row, ACCOUNT_FIELDS);
    else insertRow(db, "user_accounts", { ...row, id: mapping.targetId }, REQUIRED_COLUMNS.user_accounts);
  }
  const accountMap = new Map(manifest.accountMappings.map((mapping) => [mapping.sourceId, mapping.targetId]));
  for (const row of db.prepare("SELECT * FROM source.user_legal_acceptances ORDER BY id").iterate()) {
    const targetUserId = accountMap.get(Number(row.user_id));
    if (targetUserId == null) throw new Error(`Source legal acceptance ${row.id} has an unmappable account`);
    const exists = db.prepare(`
      SELECT 1 FROM user_legal_acceptances
      WHERE user_id = ? AND legal_version = ? AND terms_digest = ? AND privacy_digest = ?
    `).get(targetUserId, row.legal_version, row.terms_digest, row.privacy_digest);
    if (!exists) insertRow(db, "user_legal_acceptances", { ...row, user_id: targetUserId }, REQUIRED_COLUMNS.user_legal_acceptances.filter((column) => column !== "id"));
  }
}

function applyAdmins(db, manifest) {
  const sourceRows = rowMap(db, "source", "admin_users");
  const retainedTargetIds = new Set(manifest.adminMappings.filter((mapping) => mapping.action === "overwrite").map((mapping) => mapping.targetId));
  for (const row of db.prepare("SELECT id FROM admin_users ORDER BY id").all()) {
    if (!retainedTargetIds.has(Number(row.id))) db.prepare("DELETE FROM admin_users WHERE id = ?").run(row.id);
  }
  for (const mapping of manifest.adminMappings) {
    const row = sourceRows.get(mapping.sourceId);
    if (!row) throw new Error(`Source administrator mapping ${mapping.sourceId} disappeared`);
    if (mapping.action === "overwrite") updateRow(db, "admin_users", "id", mapping.targetId, row, ADMIN_FIELDS);
    else insertRow(db, "admin_users", { ...row, id: mapping.targetId }, REQUIRED_COLUMNS.admin_users);
  }
}

function applySettingsAndSecrets(db, manifest) {
  const upsertSetting = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  for (const row of db.prepare("SELECT key, value, updated_at FROM source.app_settings ORDER BY key").iterate()) {
    if (CANONICAL_SETTING_KEYS.includes(String(row.key)) && row.key !== "branding_json") {
      upsertSetting.run(row.key, row.value, row.updated_at);
    }
  }
  if (manifest.branding.source.settingPresent) {
    const row = db.prepare("SELECT updated_at FROM source.app_settings WHERE key = 'branding_json'").get();
    upsertSetting.run("branding_json", JSON.stringify(canonicalBrandingSetting(manifest.branding.source)), row.updated_at);
  }
  const token = db.prepare("SELECT key, value, updated_at FROM source.app_secrets WHERE key = 'discord_bot_token'").get();
  if (token && String(token.value).trim()) {
    db.prepare(`
      INSERT INTO app_secrets (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(token.key, token.value, token.updated_at);
  }
}

function applyCraftPlans(db) {
  const statement = db.prepare(`
    INSERT INTO craft_plan_settings (plan_key, config_json, created_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(plan_key) DO UPDATE SET
      config_json = excluded.config_json,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);
  for (const row of db.prepare("SELECT * FROM source.craft_plan_settings ORDER BY plan_key").iterate()) {
    statement.run(row.plan_key, row.config_json, row.created_at, row.updated_at);
  }
  const hasPlanRecords = db.prepare("SELECT 1 FROM source.sqlite_schema WHERE type = 'table' AND name = 'craft_plans'").get();
  const sourcePlanCount = hasPlanRecords ? Number(db.prepare("SELECT COUNT(*) AS count FROM source.craft_plans").get().count) : 0;
  if (!sourcePlanCount) {
    const legacy = db.prepare("SELECT * FROM source.craft_plan_settings ORDER BY updated_at DESC LIMIT 1").get();
    if (!legacy) return;
    const config = JSON.parse(legacy.config_json);
    const planName = String(config.name ?? "Settlement craft plan").trim().slice(0, 80) || "Settlement craft plan";
    delete config.name;
    db.prepare("UPDATE craft_plans SET is_primary = 0 WHERE is_primary = 1").run();
    db.prepare(`
      INSERT INTO craft_plans (id, name, scope, owner_user_id, is_primary, revision, config_json, created_at, updated_at)
      VALUES ('legacy-primary', ?, 'shared', NULL, 1, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, scope = 'shared', owner_user_id = NULL,
        is_primary = 1, revision = craft_plans.revision + 1, config_json = excluded.config_json,
        created_at = excluded.created_at, updated_at = excluded.updated_at
    `).run(planName, JSON.stringify(config), legacy.created_at, legacy.updated_at);
    return;
  }
  const sourcePrimaryCount = Number(db.prepare("SELECT COUNT(*) AS count FROM source.craft_plans WHERE scope = 'shared' AND is_primary = 1").get().count);
  if (sourcePlanCount > 0 && sourcePrimaryCount !== 1) throw new Error("Source craft plans must contain exactly one primary shared plan");
  if (sourcePlanCount > 0) db.prepare("UPDATE craft_plans SET is_primary = 0 WHERE is_primary = 1").run();
  const upsertPlan = db.prepare(`
    INSERT INTO craft_plans (id, name, scope, owner_user_id, is_primary, revision, config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, scope = excluded.scope,
      owner_user_id = excluded.owner_user_id, is_primary = excluded.is_primary,
      revision = excluded.revision, config_json = excluded.config_json,
      created_at = excluded.created_at, updated_at = excluded.updated_at
  `);
  for (const row of db.prepare(`
    SELECT plans.*, target_accounts.id AS target_owner_user_id
    FROM source.craft_plans AS plans
    LEFT JOIN source.user_accounts AS source_accounts ON source_accounts.id = plans.owner_user_id
    LEFT JOIN user_accounts AS target_accounts ON target_accounts.discord_id = source_accounts.discord_id
    ORDER BY plans.created_at, plans.id
  `).iterate()) {
    if (row.scope === "personal" && row.target_owner_user_id == null) continue;
    upsertPlan.run(row.id, row.name, row.scope, row.target_owner_user_id ?? null, row.is_primary, row.revision, row.config_json, row.created_at, row.updated_at);
  }
}

function applyMarketWatches(db, manifest) {
  const sourceRows = rowMap(db, "source", "market_deal_watches");
  for (const mapping of manifest.watchMappings) {
    const row = sourceRows.get(mapping.sourceId);
    if (!row) throw new Error(`Source market watch mapping ${mapping.sourceId} disappeared`);
    const mapped = { ...row, id: mapping.targetId, user_id: mapping.targetUserId };
    if (mapping.action === "update") updateRow(db, "market_deal_watches", "id", mapping.targetId, mapped, ["user_id", ...WATCH_FIELDS]);
    else insertRow(db, "market_deal_watches", mapped, REQUIRED_COLUMNS.market_deal_watches);
  }
}

function applyScheduledJobs(db) {
  db.exec(`
    UPDATE scheduled_jobs
    SET
      schedule = (SELECT source.schedule FROM source.scheduled_jobs AS source WHERE source.job_key = scheduled_jobs.job_key),
      enabled = (SELECT source.enabled FROM source.scheduled_jobs AS source WHERE source.job_key = scheduled_jobs.job_key),
      metadata_json = (SELECT source.metadata_json FROM source.scheduled_jobs AS source WHERE source.job_key = scheduled_jobs.job_key),
      updated_at = (SELECT source.updated_at FROM source.scheduled_jobs AS source WHERE source.job_key = scheduled_jobs.job_key),
      last_run_at = NULL,
      last_success_at = NULL,
      last_error = NULL,
      next_run_at = NULL,
      running = 0
    WHERE job_key IN (SELECT job_key FROM source.scheduled_jobs)
  `);
}

function replaceDiscordState(db) {
  db.exec("DELETE FROM discord_youtube_videos");
  db.exec("DELETE FROM discord_youtube_channels");
  for (const table of REPLACED_DISCORD_TABLES.filter((table) => !["discord_youtube_videos", "discord_youtube_channels"].includes(table))) {
    db.exec(`DELETE FROM ${quoteIdentifier(table)}`);
  }
  for (const table of REPLACED_DISCORD_TABLES) {
    for (const row of db.prepare(`SELECT * FROM source.${quoteIdentifier(table)} ORDER BY rowid`).iterate()) {
      insertRow(db, table, row, REQUIRED_COLUMNS[table]);
    }
  }
}

function applyAdminAudit(db, manifest) {
  const sourceRows = rowMap(db, "source", "admin_audit_log");
  for (const mapping of manifest.adminAuditMappings.filter((entry) => entry.action === "append")) {
    const row = sourceRows.get(mapping.sourceId);
    if (!row) throw new Error(`Source admin audit mapping ${mapping.sourceId} disappeared`);
    insertRow(db, "admin_audit_log", {
      ...row,
      id: mapping.targetId,
      user_id: mapping.mappedAdminId,
    }, REQUIRED_COLUMNS.admin_audit_log);
  }
}

function stageBranding(manifest, durability) {
  if (!manifest.branding.source.settingPresent) return null;
  const sourceDirectory = guardedExistingPath(manifest.branding.source.path, "directory", "Manifest source branding directory");
  const targetDirectory = guardedExistingPath(manifest.branding.target.path, "directory", "Manifest target branding directory");
  const targetParent = path.dirname(targetDirectory);
  const stageDirectory = mkdtempSync(path.join(targetParent, ".canonical-cutover-branding-stage-"));
  chmodSync(stageDirectory, statSync(targetDirectory).mode);
  try {
    for (const asset of Object.values(manifest.branding.source.assets)) {
      const sourcePath = guardedExistingPath(path.join(sourceDirectory, asset.fileName), "file", "Manifest source branding asset");
      const stagePath = path.join(stageDirectory, asset.fileName);
      copyFileSync(sourcePath, stagePath);
      const bytes = readFileSync(stagePath);
      if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) throw new Error("Branding source changed while staging");
      durability.syncFile(stagePath);
    }
    durability.syncDirectory(stageDirectory);
    return { stageDirectory, targetDirectory };
  } catch (error) {
    rmSync(stageDirectory, { recursive: true, force: true });
    throw error;
  }
}

function brandingBackupPath(manifest) {
  return `${manifest.branding.target.path}.canonical-cutover-backup`;
}

function installStagedBranding({ stageDirectory, targetDirectory }, manifest, durability) {
  const backupDirectory = brandingBackupPath(manifest);
  if (existsSync(backupDirectory)) throw new Error("A canonical cutover branding backup already exists");
  durability.renamePath(targetDirectory, backupDirectory);
  try {
    durability.renamePath(stageDirectory, targetDirectory);
    return backupDirectory;
  } catch (error) {
    if (!existsSync(targetDirectory) && existsSync(backupDirectory)) durability.renamePath(backupDirectory, targetDirectory);
    throw error;
  }
}

function assertManifestIntegrity(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Manifest must contain a JSON object");
  if (manifest.formatVersion !== CANONICAL_CUTOVER_MANIFEST_VERSION) throw new Error("Unsupported canonical cutover manifest format");
  const { selectionHash, ...unsigned } = manifest;
  if (!/^[a-f0-9]{64}$/.test(String(selectionHash ?? "")) || sha256(canonicalJson(unsigned)) !== selectionHash) {
    throw new Error("Manifest selection hash is invalid");
  }
}

function assertCleanIntegrity(db) {
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length) throw new Error(`SQLite foreign_key_check failed with ${foreignKeys.length} row(s)`);
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error(`SQLite integrity_check failed with ${integrity.length} result row(s)`);
  }
}

const CONTRIBUTION_REPAIR_TABLES = new Set([
  "production_contributions",
  "production_contribution_events",
]);

function approvedRepairExpectedTable(manifest, table) {
  if (!CONTRIBUTION_REPAIR_TABLES.has(table)) return null;
  return manifest.approvedPreMigrationRepair?.expectedPostRepair?.tables?.[table] ?? null;
}

function assertApprovedContributionRepairTransition(db, manifest) {
  const approved = manifest.approvedPreMigrationRepair;
  if (!approved) return;
  if (approved.formatVersion !== 1
    || !/^[a-f0-9]{64}$/.test(String(approved.manifestSha256 ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(approved.selectionHash ?? ""))
    || !Number.isSafeInteger(approved.selectedCount)
    || approved.selectedCount < 0) {
    throw new Error("Approved contribution repair transition is invalid");
  }
  const selectedCount = (approved.selectedIds?.aggregates?.length ?? -1)
    + (approved.selectedIds?.events?.length ?? -1);
  if (selectedCount !== approved.selectedCount) throw new Error("Approved contribution repair transition selected IDs are invalid");
  const expected = String(approved.expectedPostRepair?.databaseLogicalSha256 ?? "");
  if (!/^[a-f0-9]{64}$/.test(expected) || databaseLogicalFingerprint(db) !== expected) {
    throw new Error("Target database does not match the approved contribution repair transition");
  }
  for (const table of CONTRIBUTION_REPAIR_TABLES) {
    const expectedTable = approvedRepairExpectedTable(manifest, table);
    if (!expectedTable
      || tableCount(db, table) !== expectedTable.count
      || tableContentFingerprint(db, table) !== expectedTable.contentSha256) {
      throw new Error(`Protected table ${table} does not match the approved contribution repair transition`);
    }
  }
}

function normalizeManifestForApprovedRepairComparison(value) {
  const normalized = JSON.parse(canonicalJson(value));
  delete normalized.selectionHash;
  delete normalized.approvedPreMigrationRepair;
  if (normalized.target?.database) {
    normalized.target.database.fileSha256 = "<approved-contribution-repair-transition>";
    for (const table of CONTRIBUTION_REPAIR_TABLES) {
      if (normalized.target.database.tables?.[table]) {
        normalized.target.database.tables[table].contentSha256 = "<approved-contribution-repair-transition>";
      }
    }
  }
  return normalized;
}

function assertProtectedTablesUnchanged(db, manifest, { allowPrivacyReplay = false } = {}) {
  for (const [table, counts] of Object.entries(manifest.tableCounts)) {
    if (!counts.excluded || !manifest.target.database.tables[table]) continue;
    if (allowPrivacyReplay && manifest.privacyDeletionLedger && PRIVACY_REPLAY_TABLES.has(table)) continue;
    const expected = approvedRepairExpectedTable(manifest, table) ?? manifest.target.database.tables[table];
    const actualCount = tableCount(db, table);
    const actualHash = tableContentFingerprint(db, table);
    if (actualCount !== expected.count || actualHash !== expected.contentSha256) {
      throw new Error(`Protected table ${table} changed during canonical cutover apply`);
    }
  }
}

function markerPayload(manifest, state, recovery) {
  return {
    applied: state === "applied",
    formatVersion: manifest.formatVersion,
    preDatabaseStateFingerprint: recovery.preDatabaseStateFingerprint,
    postDatabaseStateFingerprint: recovery.postDatabaseStateFingerprint,
    selectionHash: manifest.selectionHash,
    state,
  };
}

function readRecoveryMarker(markerPath, manifest) {
  const parsed = parseJson(readFileSync(guardedExistingPath(markerPath, "file", "Pending marker"), "utf8"), "Pending marker");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || parsed.state !== "pending" || parsed.applied !== false
    || parsed.formatVersion !== manifest.formatVersion || parsed.selectionHash !== manifest.selectionHash
    || !/^[a-f0-9]{64}$/.test(String(parsed.preDatabaseStateFingerprint ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(parsed.postDatabaseStateFingerprint ?? ""))) {
    throw new Error("Pending canonical cutover marker is invalid");
  }
  return parsed;
}

function readAppliedMarker(markerPath, manifest) {
  const parsed = parseJson(readFileSync(guardedExistingPath(markerPath, "file", "Applied marker"), "utf8"), "Applied marker");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || parsed.state !== "applied" || parsed.applied !== true
    || parsed.formatVersion !== manifest.formatVersion || parsed.selectionHash !== manifest.selectionHash
    || !/^[a-f0-9]{64}$/.test(String(parsed.preDatabaseStateFingerprint ?? ""))
    || !/^[a-f0-9]{64}$/.test(String(parsed.postDatabaseStateFingerprint ?? ""))) {
    throw new Error("Applied canonical cutover marker is invalid");
  }
  return parsed;
}

function brandingFilesMatchManifest(manifest) {
  const targetDirectory = manifest.branding.target.path;
  if (!existsSync(targetDirectory)) return false;
  try {
    guardedExistingPath(targetDirectory, "directory", "Manifest target branding directory");
    const expected = Object.values(manifest.branding.source.assets).sort((left, right) => left.fileName.localeCompare(right.fileName));
    const entries = readdirSync(targetDirectory, { withFileTypes: true });
    if (entries.length !== expected.length || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) return false;
    for (const asset of expected) {
      const assetPath = guardedExistingPath(path.join(targetDirectory, asset.fileName), "file", "Recovered target branding asset");
      const bytes = readFileSync(assetPath);
      if (bytes.length !== asset.size || sha256(bytes) !== asset.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function readCanonicalCutoverManifest(manifestPath) {
  const resolved = guardedExistingPath(manifestPath, "file", "Manifest");
  const parsed = parseJson(readFileSync(resolved, "utf8"), "Manifest");
  assertManifestIntegrity(parsed);
  return { manifest: parsed, manifestPath: resolved };
}

// Task 4 needs a read-only admission check against Task 2's durable applied
// marker. Re-running apply is intentionally not a verifier: an already-applied
// manifest must be rejected by the mutation entry point. This narrow seam
// exposes the same exact recovery fingerprint and protected-table checks used
// by Task 2 without opening a writable transaction or changing recovery state.
export function verifyAppliedCanonicalCutoverManifest({ manifest, manifestPath }) {
  assertManifestIntegrity(manifest);
  const resolvedManifestPath = guardedExistingPath(manifestPath, "file", "Manifest");
  const markerPath = guardedExistingPath(`${resolvedManifestPath}.applied`, "file", "Applied marker");
  const targetPath = guardedExistingPath(manifest.target?.database?.path, "file", "Manifest target database");
  const applied = readAppliedMarker(markerPath, manifest);
  const db = openReadOnly(targetPath);
  let tableCounts;
  try {
    assertSupportedSchema(db, "Target");
    assertProtectedTablesUnchanged(db, manifest, { allowPrivacyReplay: true });
    assertCleanIntegrity(db);
    if (databaseRecoveryFingerprint(db) !== applied.postDatabaseStateFingerprint) {
      throw new Error("Applied canonical cutover marker does not match the target database state");
    }
    if (!manifest.branding.source.settingPresent) {
      const retainedBranding = brandingDescription(db, manifest.branding.target.path, "Verified applied target");
      if (canonicalJson(retainedBranding) !== canonicalJson(manifest.branding.target)) {
        throw new Error("Retained target branding changed after the applied marker was written");
      }
    }
    tableCounts = Object.fromEntries(tableNames(db).map((table) => [table, tableCount(db, table)]));
  } finally {
    db.close();
  }
  if (manifest.branding.source.settingPresent && !brandingFilesMatchManifest(manifest)) {
    throw new Error("Applied canonical cutover marker exists but target branding is incomplete");
  }
  return {
    integrity: "ok",
    postDatabaseStateFingerprint: applied.postDatabaseStateFingerprint,
    selectionHash: manifest.selectionHash,
    tableCounts,
  };
}

function applyResult(manifest, recovered = false) {
  return {
    claimId: manifest.claimId,
    integrity: "ok",
    recovered,
    selectionHash: manifest.selectionHash,
  };
}

function recoverAppliedFinalization(manifest, paths, durability, beforeFinalize = () => {}) {
  const applied = readAppliedMarker(paths.markerPath, manifest);
  if (existsSync(paths.pendingMarkerPath)) {
    const pending = readRecoveryMarker(paths.pendingMarkerPath, manifest);
    if (pending.preDatabaseStateFingerprint !== applied.preDatabaseStateFingerprint
      || pending.postDatabaseStateFingerprint !== applied.postDatabaseStateFingerprint) {
      throw new Error("Applied and pending canonical cutover recovery markers disagree");
    }
  }
  const db = openReadOnly(paths.targetPath);
  try {
    assertSupportedSchema(db, "Target");
    assertProtectedTablesUnchanged(db, manifest, { allowPrivacyReplay: true });
    assertCleanIntegrity(db);
    if (databaseRecoveryFingerprint(db) !== applied.postDatabaseStateFingerprint) {
      throw new Error("Applied canonical cutover marker does not match the target database state");
    }
    if (!manifest.branding.source.settingPresent) {
      const retainedBranding = brandingDescription(db, manifest.branding.target.path, "Recovered applied target");
      if (canonicalJson(retainedBranding) !== canonicalJson(manifest.branding.target)) {
        throw new Error("Retained target branding changed after the applied marker was written");
      }
    }
  } finally {
    db.close();
  }
  beforeFinalize();
  if (manifest.branding.source.settingPresent && !brandingFilesMatchManifest(manifest)) {
    throw new Error("Applied canonical cutover marker exists but target branding is incomplete");
  }
  // Re-sync the marker's rename before deleting either recovery resource. This
  // makes a previous post-rename directory-fsync failure safely retryable.
  durability.syncParent(paths.markerPath);
  if (existsSync(paths.pendingMarkerPath)) durability.removePath(paths.pendingMarkerPath, { force: true });
  if (existsSync(paths.backupBrandingDirectory)) {
    durability.removePath(paths.backupBrandingDirectory, { recursive: true, force: true });
  }
  return applyResult(manifest, true);
}

function completePostCommit(
  manifest,
  markerPath,
  pendingMarkerPath,
  recovery,
  durability,
  stagedBranding = null,
  recovered = true,
) {
  let backupDirectory = null;
  try {
    if (manifest.branding.source.settingPresent) {
      const expectedBackup = brandingBackupPath(manifest);
      if (!brandingFilesMatchManifest(manifest)) {
        if (!existsSync(manifest.branding.target.path) && existsSync(expectedBackup)) {
          durability.renamePath(expectedBackup, manifest.branding.target.path);
        }
        if (existsSync(expectedBackup)) throw new Error("Branding recovery found an ambiguous existing backup");
        stagedBranding ??= stageBranding(manifest, durability);
        backupDirectory = installStagedBranding(stagedBranding, manifest, durability);
      } else if (stagedBranding?.stageDirectory && existsSync(stagedBranding.stageDirectory)) {
        durability.removePath(stagedBranding.stageDirectory, { recursive: true, force: true });
      }
    }
    durability.writeMarker(markerPath, markerPayload(manifest, "applied", recovery));
    durability.removePath(pendingMarkerPath, { force: true });
    if (manifest.branding.source.settingPresent) {
      const cleanupBackup = backupDirectory ?? brandingBackupPath(manifest);
      if (existsSync(cleanupBackup)) {
        durability.removePath(cleanupBackup, { recursive: true, force: true });
      }
    }
    return applyResult(manifest, recovered);
  } catch (error) {
    if (stagedBranding?.stageDirectory && existsSync(stagedBranding.stageDirectory)) {
      try { durability.removePath(stagedBranding.stageDirectory, { recursive: true, force: true }); } catch {}
    }
    throw new Error(`Canonical cutover database is committed; retry the same manifest to finish branding/marker recovery: ${error.message}`);
  }
}

function recoverPendingApply(manifest, paths, durability, beforeFinalize = () => {}) {
  const recovery = readRecoveryMarker(paths.pendingMarkerPath, manifest);
  if (sha256File(paths.sourcePath) !== manifest.source.database.fileSha256) {
    throw new Error("Canonical cutover source changed during pending recovery");
  }
  const db = openReadOnly(paths.targetPath);
  let currentFingerprint;
  try {
    assertSupportedSchema(db, "Target");
    assertCleanIntegrity(db);
    if (!manifest.branding.source.settingPresent) {
      const retainedBranding = brandingDescription(db, manifest.branding.target.path, "Recovery target");
      if (canonicalJson(retainedBranding) !== canonicalJson(manifest.branding.target)) {
        throw new Error("Retained target branding changed during pending recovery");
      }
    }
    currentFingerprint = databaseRecoveryFingerprint(db);
    if (currentFingerprint === recovery.preDatabaseStateFingerprint) {
      assertProtectedTablesUnchanged(db, manifest);
    } else if (currentFingerprint === recovery.postDatabaseStateFingerprint) {
      assertProtectedTablesUnchanged(db, manifest, { allowPrivacyReplay: true });
    }
  } finally {
    db.close();
  }
  if (currentFingerprint === recovery.preDatabaseStateFingerprint) {
    durability.removePath(paths.pendingMarkerPath, { force: true });
    return null;
  }
  if (currentFingerprint !== recovery.postDatabaseStateFingerprint) {
    throw new Error("Pending canonical cutover database state matches neither the pre-apply nor committed fingerprint");
  }
  beforeFinalize();
  return completePostCommit(manifest, paths.markerPath, paths.pendingMarkerPath, recovery, durability);
}

export function applyCanonicalCutoverManifest(
  { manifest, manifestPath },
  {
    durability = DEFAULT_CUTOVER_DURABILITY,
    openTargetDatabase = openWritableTarget,
    privacyApplyContext = null,
    privacyReadinessArtifactPath = null,
  } = {},
) {
  assertManifestIntegrity(manifest);
  const activePrivacyApplyContext = manifest.privacyDeletionLedger
    ? (privacyApplyContext ?? prepareCanonicalCutoverPrivacyApply(manifest.privacyDeletionLedger))
    : null;
  if (manifest.privacyDeletionLedger
    && canonicalJson(activePrivacyApplyContext.plan) !== canonicalJson(manifest.privacyDeletionLedger)) {
    throw new Error("Canonical cutover privacy apply context is missing or does not match the manifest");
  }
  const privacyReadiness = {
    readinessArtifactPath: privacyReadinessArtifactPath ?? undefined,
    selectionHash: manifest.selectionHash,
  };
  activePrivacyApplyContext?.assertReadiness(privacyReadiness);
  const resolvedManifestPath = guardedExistingPath(manifestPath, "file", "Manifest");
  const markerPath = guardedPlannedFilePath(`${resolvedManifestPath}.applied`, "Applied marker", { allowExisting: true });
  const pendingMarkerPath = guardedPlannedFilePath(`${resolvedManifestPath}.applying`, "Pending marker", { allowExisting: true });
  const targetPath = guardedExistingPath(manifest.target?.database?.path, "file", "Manifest target database");
  const sourcePath = guardedExistingPath(manifest.source?.database?.path, "file", "Manifest source database");
  const sourceBrandingDirectory = guardedExistingPath(manifest.branding?.source?.path, "directory", "Manifest source branding directory");
  const targetBrandingDirectory = guardedExistingOrPlannedDirectory(manifest.branding?.target?.path, "Manifest target branding directory");
  const backupBrandingDirectory = guardedExistingOrPlannedDirectory(brandingBackupPath(manifest), "Manifest target branding backup directory");
  assertCutoverPathsAreDisjoint({
    sourceDatabasePath: sourcePath,
    targetDatabasePath: targetPath,
    sourceBrandingDirectory,
    targetBrandingDirectory,
    backupBrandingDirectory,
    manifestPath: resolvedManifestPath,
    markerPath,
    pendingMarkerPath,
    privacyDeletionLedger: manifest.privacyDeletionLedger,
  });
  assertDatabaseFilesystemIdentity(sourcePath, targetPath);
  if (existsSync(markerPath)) {
    if (existsSync(pendingMarkerPath) || existsSync(backupBrandingDirectory)) {
      return recoverAppliedFinalization(manifest, {
        backupBrandingDirectory,
        markerPath,
        pendingMarkerPath,
        targetPath,
      }, durability, () => activePrivacyApplyContext?.assertLedgerInstalled());
    }
    throw new Error("Canonical cutover manifest was already applied");
  }
  if (existsSync(backupBrandingDirectory) && !existsSync(pendingMarkerPath)) {
    throw new Error("Target branding backup directory exists without a pending recovery marker");
  }
  if (existsSync(pendingMarkerPath)) {
    const recovered = recoverPendingApply(
      manifest,
      { markerPath, pendingMarkerPath, sourcePath, targetPath },
      durability,
      () => activePrivacyApplyContext?.installLedger(null, privacyReadiness),
    );
    if (recovered) return recovered;
  }
  let stagedBranding = null;
  let stagedPrivacyLedger = null;
  let recovery = null;
  const db = openTargetDatabase(targetPath);
  let transactionOpen = false;
  try {
    db.exec("PRAGMA foreign_keys = ON");
    if (Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys) !== 1) throw new Error("SQLite foreign keys could not be enabled");
    const sourceUri = `${pathToFileURL(sourcePath).href}?mode=ro`;
    db.prepare("ATTACH DATABASE ? AS source").run(sourceUri);
    db.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    assertApprovedContributionRepairTransition(db, manifest);
    const recomputed = createCanonicalCutoverManifest({
      claimId: manifest.claimId,
      sourceDatabasePath: sourcePath,
      targetDatabasePath: targetPath,
      sourceBrandingDirectory: manifest.branding?.source?.path,
      targetBrandingDirectory: manifest.branding?.target?.path,
      manifestPath: resolvedManifestPath,
      privacyPlan: manifest.privacyDeletionLedger ?? undefined,
    }, { allowExistingManifest: true });
    const frozenComparison = manifest.approvedPreMigrationRepair
      ? normalizeManifestForApprovedRepairComparison(manifest)
      : manifest;
    const recomputedComparison = manifest.approvedPreMigrationRepair
      ? normalizeManifestForApprovedRepairComparison(recomputed)
      : recomputed;
    if (canonicalJson(recomputedComparison) !== canonicalJson(frozenComparison)) {
      throw new Error("Canonical cutover inputs changed since dry-run; refusing apply");
    }
    stagedPrivacyLedger = activePrivacyApplyContext?.stageLedger() ?? null;
    const preDatabaseStateFingerprint = databaseRecoveryFingerprint(db);
    stagedBranding = stageBranding(manifest, durability);
    db.exec("DELETE FROM user_sessions; DELETE FROM admin_sessions;");
    applyAccounts(db, manifest);
    applyAdmins(db, manifest);
    applySettingsAndSecrets(db, manifest);
    applyCraftPlans(db);
    applyMarketWatches(db, manifest);
    applyScheduledJobs(db);
    replaceDiscordState(db);
    applyAdminAudit(db, manifest);
    assertProtectedTablesUnchanged(db, manifest);
    activePrivacyApplyContext?.replay(db);
    assertCleanIntegrity(db);
    recovery = {
      preDatabaseStateFingerprint,
      postDatabaseStateFingerprint: databaseRecoveryFingerprint(db),
    };
    durability.writeMarker(pendingMarkerPath, markerPayload(manifest, "pending", recovery));
    db.exec("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { db.exec("ROLLBACK"); } catch {}
    }
    if (stagedBranding?.stageDirectory) {
      try { durability.removePath(stagedBranding.stageDirectory, { recursive: true, force: true }); } catch {}
    }
    try { activePrivacyApplyContext?.discardLedgerStage(stagedPrivacyLedger); } catch {}
    // Once `.applying` may have been durably renamed, never delete it on an
    // exception: COMMIT errors can be ambiguous and retry validates pre/post state.
    throw error;
  } finally {
    db.close();
  }
  try {
    activePrivacyApplyContext?.installLedger(stagedPrivacyLedger, privacyReadiness);
  } catch (error) {
    try { activePrivacyApplyContext?.discardLedgerStage(stagedPrivacyLedger); } catch {}
    throw new Error(`Canonical cutover database is committed; retry the same manifest after restoring privacy readiness: ${error.message}`);
  }
  return completePostCommit(manifest, markerPath, pendingMarkerPath, recovery, durability, stagedBranding, false);
}

// Narrowly exported for repair tools that must share the canonical cutover's
// security-sensitive validation semantics instead of maintaining copies.
export {
  IMAGE_TYPES as CANONICAL_CUTOVER_IMAGE_TYPES,
  assertCleanIntegrity as assertCanonicalCutoverSqliteIntegrity,
  databaseLogicalFingerprint as canonicalCutoverDatabaseLogicalFingerprint,
  comparePaths as canonicalCutoverComparePaths,
  guardedExistingOrPlannedDirectory as canonicalCutoverGuardedExistingOrPlannedDirectory,
  guardedExistingPath as canonicalCutoverGuardedExistingPath,
  guardedPlannedFilePath as canonicalCutoverGuardedPlannedFilePath,
  pathContains as canonicalCutoverPathContains,
  sha256 as canonicalCutoverSha256,
  sha256File as canonicalCutoverSha256File,
};
