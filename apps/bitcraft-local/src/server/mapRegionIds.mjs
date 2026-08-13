export function compareMapRegionIds(left, right) {
  return left.length - right.length || left.localeCompare(right);
}

export function canonicalMapRegionIds(values) {
  const normalized = (values ?? []).map((value) => {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) throw new TypeError("Map region identities must be decimal region IDs");
    return BigInt(text).toString();
  });
  return [...new Set(normalized)].sort(compareMapRegionIds);
}
