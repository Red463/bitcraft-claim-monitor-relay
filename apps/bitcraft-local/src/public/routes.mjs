const NOT_FOUND = Object.freeze({ id: "not-found", params: {} });

function route(id, params = {}, metadata = {}) {
  return { id, params, ...metadata };
}

function pathSegments(pathname) {
  try {
    return new URL(String(pathname ?? "/"), "https://claim-monitor.com").pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function isCanonicalClaimId(value) {
  return /^(0|[1-9]\d*)$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n;
}

export function publicClaimPath(hint) {
  const claimId = String(hint?.claimId ?? "");
  return isCanonicalClaimId(claimId) ? `/claims/${claimId}` : null;
}

export function publicSettlementPath(hint) {
  return publicClaimPath(hint);
}

const CLAIM_PAGES = new Set(["members", "professions", "inventory", "crafts"]);
const ROADMAP_PAGES = new Set([
  "leaderboard",
  "construction",
  "research",
  "local-market",
  "market",
  "region",
  "empires",
  "map",
  "activity",
  "public-craft-finder",
]);

function claimRoute(segments, legacy = false) {
  if (segments.length < 2 || !isCanonicalClaimId(segments[1])) return NOT_FOUND;
  const claimId = segments[1];
  const suffix = segments[2] ?? "";
  const canonicalPath = `/claims/${claimId}${suffix ? `/${suffix}` : ""}`;
  const metadata = legacy ? { canonicalPath } : {};
  if (segments.length === 2) return route("dashboard", { claimId }, metadata);
  if (segments.length === 3 && CLAIM_PAGES.has(suffix)) return route(suffix, { claimId }, metadata);
  if (segments.length === 3 && ROADMAP_PAGES.has(suffix)) return route("coming-soon", { claimId, feature: suffix }, metadata);
  return NOT_FOUND;
}

export function resolvePublicRoute(pathname) {
  const segments = pathSegments(pathname);
  if (!segments) return NOT_FOUND;
  if (segments.length === 0) return route("home");
  if (segments.some((segment) => segment.includes("/"))) return NOT_FOUND;
  if (segments[0] === "claims") return claimRoute(segments);
  if (segments[0] === "settlements") return claimRoute(segments, true);
  if (segments.length === 1 && segments[0] === "calculator") return route("calculator");
  if (segments.length === 1 && ["account", "settings", "help", "terms", "privacy"].includes(segments[0])) return route(segments[0]);
  if (segments.length === 1 && segments[0] === "plans") return route("plans");
  if (segments.length === 2 && segments[0] === "plans" && segments[1] === "new") return route("plan-new");
  if (segments.length === 2 && segments[0] === "plans" && segments[1]) return route("plan", { id: segments[1] });
  if (segments.length === 2 && segments[0] === "shared-plans" && segments[1]) return route("shared-plan", { id: segments[1] });
  if (segments.length === 2 && segments[0] === "invites" && segments[1]) return route("invite", { id: segments[1] });
  return NOT_FOUND;
}

export function publicStorageKey(suffix) {
  const value = String(suffix ?? "").trim();
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(value) || value.startsWith("timbersteel.")) {
    throw new Error("Public preference suffix must be a public key segment");
  }
  return `claim-monitor.public.${value}`;
}
