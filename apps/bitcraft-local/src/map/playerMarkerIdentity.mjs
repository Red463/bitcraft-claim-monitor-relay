export function canonicalPlayerId(value) {
  const id = String(value ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  try {
    const parsed = BigInt(id);
    if (parsed > 0xffffffffffffffffn) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function verifiedCharacterPlayerId(characterStatus, characterPlayerId) {
  return characterStatus === "approved" ? canonicalPlayerId(characterPlayerId) : null;
}

export function isCurrentUserPlayerMarker(playerId, verifiedPlayerId) {
  if (verifiedPlayerId == null) return false;
  const player = canonicalPlayerId(playerId);
  const verified = canonicalPlayerId(verifiedPlayerId);
  return player != null && verified != null && player === verified;
}
