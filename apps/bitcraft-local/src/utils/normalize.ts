import { toNumber, unwrap, type AnyRecord } from "../main-app-data.ts";

/*
 * Normalizers convert mixed provider/local helper payloads into the stable shape
 * expected by page components. Keep these defensive: missing optional fields
 * should result in null/empty values rather than blanking a page.
 */

/**
 * Normalise player detail fields used for online/session displays.
 *
 * Upstream payloads have exposed playtime and sign-in data under several field names over
 * time, so this function preserves all known aliases and returns explicit nulls
 * when the API has not provided a usable value.
 */
export function normalizePlayer(player: AnyRecord): AnyRecord {
  const signInValue = player.signInTimestamp ??
    player.sign_in_timestamp ??
    player.signedInTimestamp ??
    player.sessionStartTimestamp ??
    player.session_start_timestamp;
  const numericSignIn = toNumber(signInValue);
  const signInTs = numericSignIn > 0
    ? Math.floor(numericSignIn > 10_000_000_000 ? numericSignIn / 1000 : numericSignIn)
    : typeof signInValue === "string" && Number.isFinite(Date.parse(signInValue))
      ? Math.floor(Date.parse(signInValue) / 1000)
      : 0;
  const now = Math.floor(Date.now() / 1000);
  const signedIn = Boolean(player.signedIn ?? player.online ?? player.isOnline ?? (signInTs > 0));
  const existingSessionSeconds = toNumber(player.sessionSeconds ?? player.session_seconds ?? player.currentSessionSeconds);
  const timePlayedSeconds = toNumber(
    player.timePlayed ??
    player.totalTimePlayed ??
    player.totalPlayed ??
    player.totalPlayedSeconds ??
    player.timePlayedSeconds ??
    player.time_played ??
    player.total_time_played,
  );
  const timeSignedInSeconds = toNumber(
    player.timeSignedIn ??
    player.totalTimeSignedIn ??
    player.totalSignedIn ??
    player.totalSignedInSeconds ??
    player.timeSignedInSeconds ??
    player.time_signed_in ??
    player.total_time_signed_in,
  );
  const regionId = String(
    player.regionId ??
    player.currentRegionId ??
    player.current_region_id ??
    player.location?.regionId ??
    "",
  ).trim();
  const regionName = String(
    player.regionName ??
    player.currentRegionName ??
    player.current_region_name ??
    player.region?.name ??
    player.currentRegion?.name ??
    "",
  ).trim();
  return {
    ...player,
    entityId: String(player.entityId ?? player.playerEntityId ?? player.playerId ?? ""),
    username: player.username ?? player.userName,
    regionId: regionId || null,
    regionName: regionName || null,
    signedIn,
    sessionSeconds: signInTs > 0 ? Math.max(0, now - signInTs) : existingSessionSeconds > 0 ? existingSessionSeconds : null,
    timePlayedSeconds: timePlayedSeconds > 0 ? timePlayedSeconds : null,
    timeSignedInSeconds: timeSignedInSeconds > 0 ? timeSignedInSeconds : null,
  };
}

export function normalizeData(raw: AnyRecord | null) {
  // Most provider endpoints return named wrappers, but local helper endpoints may
  // already return plain arrays/objects. unwrap keeps page components independent
  // from those transport details.
  const claim = raw?.claim?.claim ?? raw?.claim ?? {};
  const members = unwrap<AnyRecord[]>(raw?.members, "members", []);
  const citizens = unwrap<AnyRecord[]>(raw?.citizens, "citizens", []);
  const buildings = unwrap<AnyRecord[]>(raw?.buildings, "buildings", []);
  const inventories = raw?.inventories ?? {};
  const construction = raw?.construction ?? {};
  const research = unwrap<AnyRecord[]>(raw?.research, "technologies", []);
  const recruitment = unwrap<AnyRecord[]>(raw?.recruitment, "recruitment", []);
  const market = unwrap<AnyRecord[]>(raw?.market, "listings", []);
  const crafts = unwrap<AnyRecord[]>(raw?.crafts, "craftResults", []);
  const players = unwrap<AnyRecord[]>(raw?.players, "players", []).map(normalizePlayer);
  const region = unwrap<AnyRecord[]>(raw?.["region-claims"], "claims", unwrap<AnyRecord[]>(raw?.region, "claims", []));
  const skills = raw?.skills ?? {};
  const contributionPayload = raw?.contributions ?? {};
  const contributions = contributionPayload.byCraft ?? contributionPayload;
  const contributionObservedSince = contributionPayload.observedSince ?? null;
  const marketApi = raw?.marketApi ?? { histories: [], trades: [] };
  const regionStatus = unwrap<AnyRecord[]>(raw?.region, "regions", unwrap<AnyRecord[]>(raw?.regionStatus, "regions", []));
  return { claim, members, citizens, buildings, inventories, construction, research, recruitment, market, crafts, players, region, skills, contributions, contributionObservedSince, marketApi, regionStatus };
}

