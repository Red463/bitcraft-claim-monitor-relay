export const DEFAULT_APP_PAGE = "dashboard";
export const VALID_APP_PAGES = [
  "dashboard",
  "leaderboard",
  "overview",
  "members",
  "skills",
  "production",
  "planning",
  "publiccrafts",
  "craftcalc",
  "inventory",
  "construction",
  "research",
  "market",
  "empire",
  "empires",
  "map",
  "sync",
  "activity",
];

export function validBitcraftSyncUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "bitcraftsync.app";
  } catch {
    return false;
  }
}

export function validAppPage(value) {
  return VALID_APP_PAGES.includes(value);
}

export function validClaimId(value) {
  return /^\d{8,}$/.test(String(value ?? "").trim());
}

export function validRefreshIntervalSeconds(value) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 15 && seconds <= 300;
}

export function validRegionId(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

export function parseRegionIds(value) {
  return String(value ?? "")
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => validRegionId(entry));
}

export function normalizeStoredExcludedMemberIds(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))]
    : [];
}

export function normalizeSubmittedExcludedMemberIds(values) {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => String(value ?? "").trim()).filter(validClaimId))]
    : [];
}

function finiteNumber(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function clampNumberSetting(value, fallback, min, max) {
  const number = finiteNumber(value) || fallback;
  return Math.min(Math.max(number, min), max);
}

export function normalizeSavedRefreshIntervalSeconds(value, fallbackSeconds) {
  return clampNumberSetting(value, fallbackSeconds, 15, 300);
}
