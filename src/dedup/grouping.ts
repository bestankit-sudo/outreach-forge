/**
 * Group records by a key. Records whose key is null or empty string
 * are skipped (they can't dedupe against anything).
 */
export function groupByKey<T>(
  records: T[],
  keyFn: (record: T) => string | null,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = keyFn(record);
    if (key === null || key === "") continue;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Normalize a LinkedIn URL for use as a dedup key. Lowercases, strips
 * protocol, www, query/fragment, trailing slashes. Returns null for
 * empty input or the literal string "not found".
 */
export function linkedinUrlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.toLowerCase() === "not found") return null;
  return trimmed
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}
