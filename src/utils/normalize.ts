/**
 * Canonicalisers used during dedup and lookup.
 *
 * Both functions are pure and deterministic. They are NOT URL or i18n-aware
 * — they're stable equality keys, not display values. Idempotent: passing
 * the output back in yields the same result.
 */

/**
 * Lowercase a URL or domain string and strip protocol, `www.`, path, query,
 * fragment, and trailing slash. Empty input → empty output.
 *
 * Use when comparing two arbitrary URLs that should be treated as the same
 * brand (e.g., `HTTPS://www.Acme.com/about?utm=x` vs `acme.com`).
 */
export function normalizeDomain(input: string): string {
  if (!input) return "";
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0] ?? s;
  s = s.replace(/[?#].*$/, "");
  s = s.replace(/\/$/, "");
  return s;
}

/**
 * Generic brand-suffix tokens that consumers will almost always want stripped
 * before comparing two brand names for equality. Kept intentionally short —
 * project-specific suffixes (e.g. "coffee", "studio", "labs") should be passed
 * via the `extraSuffixTokens` arg of {@link normalizeBrandName}.
 */
export const BRAND_NAME_SUFFIX_TOKENS = new Set([
  "inc", "llc", "ltd", "corp", "corporation", "co", "company",
  "the", "and", "&",
]);

/**
 * Lowercase a brand name and drop punctuation, parentheses, and common
 * suffix tokens. Returns the cleaned, single-spaced result. Used as a
 * dedup key.
 *
 * Examples:
 *   "Blue Bottle Coffee, Inc." + ["coffee"] → "blue bottle"
 *   "L'OR Espresso"                          → "lor espresso"
 *
 * If filtering would zero out the name, falls back to returning the
 * tokens without suffix-filtering (so genuinely short names like "The
 * Co" don't collapse to empty).
 */
export function normalizeBrandName(input: string, extraSuffixTokens: string[] = []): string {
  if (!input) return "";
  const dropTokens = new Set([
    ...BRAND_NAME_SUFFIX_TOKENS,
    ...extraSuffixTokens.map((t) => t.toLowerCase()),
  ]);
  let s = input.toLowerCase();
  s = s.replace(/['‘’.,&]/g, "");
  const tokens = s.split(/\s+/).filter(Boolean);
  const filtered = tokens.filter((t) => !dropTokens.has(t));
  return (filtered.length > 0 ? filtered : tokens).join(" ");
}
