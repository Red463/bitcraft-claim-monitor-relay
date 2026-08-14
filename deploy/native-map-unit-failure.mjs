export function classifyNativeMapUnitFailure(journal) {
  const text = String(journal ?? "");
  if (!text.trim()) return { category: "unavailable" };
  if (/returned no verified paving points/i.test(text)) return { category: "empty-region" };
  if (/missing location data/i.test(text)) return { category: "join-mismatch" };
  if (/timed out/i.test(text)) return { category: "timeout" };
  if (/schema fingerprint|schema-compatible|schema mismatch/i.test(text)) return { category: "schema" };
  if (/impossible coordinates|unexpected dimension/i.test(text)) return { category: "invalid-coordinate" };
  return { category: "other" };
}
