# Improvement Backlog — from podsque-enrichment

> Generated 2026-04-28 from the first real consumer of `outreach-forge` (the [podsque-enrichment](../podsque-enrichment) project). Every item below is a friction point we hit while shipping a 2k+ company discovery pipeline. Each is a PR-sized chunk; tags indicate priority, breaking status, and whether the change is implementation-ready or needs a design pass first.
>
> **For the Claude session that picks this up:** read the relevant PR section in full before editing. Items are independent unless `Depends on` is listed. Land P0s first, then P1s; P2s are nice-to-have. Breaking changes (`Breaking: yes`) all belong in a single v0.2 release together — don't ship them piecemeal.
>
> Source learnings (with concrete examples) live at [`../podsque-enrichment/README.md#outreach-forge-improvement-log`](../podsque-enrichment/README.md).

---

## Quick status board

| #   | Title                                                       | Priority | Breaking | Status        |
| --- | ----------------------------------------------------------- | -------- | -------- | ------------- |
| 1   | Retailer/marketplace blocklist additions                    | P0       | no       | ready         |
| 2   | `emailProp` truncates/drops values > 100 chars              | P0       | no       | ready         |
| 3   | Per-row write isolation helper                              | P0       | no       | ready         |
| 4   | `NotionService` retries on `request_timeout` + 502/504      | P0       | no       | ready         |
| 5   | `findLinkedInProfiles` — optional `founders` + apostrophe normalization | P1 | no   | ready         |
| 6   | `ValidationResult.confidence` derived from `entityMatch`    | P1       | no\*     | ready         |
| 7   | `scoreSearchCandidates` surfaces `parseFailed`              | P1       | no\*     | ready         |
| 8   | Export `normalizeDomain(url)` + `normalizeBrandName(name)`  | P1       | no       | ready         |
| 9   | Apollo `searchOrganisationsList` (mixed_companies/search)   | P1       | no       | ready         |
| 10  | Apollo industry filter — accept names, translate or reject  | P1       | no       | ready         |
| 11  | `scoreBrandFit(llm, candidate, role)` AI gate               | P1       | no       | ready         |
| 12  | Parameterised fit-score property + Enrichment Confidence rename | P0   | **YES**  | ready (v0.2)  |
| 13  | `runEnrichment` — `dedupKey` + `lookupExisting` hooks       | P1       | no       | ready         |
| 14  | Brave / Firecrawl scrape provider abstraction               | P1       | no       | needs design  |
| 15  | `enrichCompanyWithSocials` (Apollo + scrape merged)         | P1       | no       | ready         |
| 16  | LLM-based homepage extractor (`extractCompanyContext`)      | P2       | no       | needs design  |
| 17  | Two-way Notion relation helper (`linkDatabases`)            | P2       | no       | ready         |
| 18  | Idempotent setup variant                                    | P2       | no       | ready         |
| 19  | `runDiscovery` orchestrator                                 | P2       | no       | needs design  |
| 20  | `runEnrichmentFromNotion` (status-driven HITL loop)         | P2       | no       | ready         |
| 21  | Documentation expansions (workspace page, secrets.env, scrape failure modes) | P2 | no | ready |

\* "no\*" means non-breaking but adds a field to a returned type — TypeScript consumers should not see breakage; runtime consumers reading the result by key see new optional fields only.

---

## PR 1 — Retailer/marketplace blocklist additions

**Priority:** P0 · **Breaking:** no · **Status:** ready

**File:** `src/apollo/client.ts`

**Change:** extend the existing `BLOCKED_DOMAINS` set with retailer/grocery domains. Today it lists social/crowdfunding only — passing a retailer domain to `enrichOrganisation` would silently match the retailer instead of the brand.

**Add to `BLOCKED_DOMAINS`:**

```
target.com, walmart.com, amazon.com, amazon.co.uk, amazon.de,
costco.com, kroger.com, instacart.com, ebay.com, etsy.com,
thrivemarket.com, iherb.com, tesco.com, sainsburys.co.uk, asda.com,
morrisons.com, ocado.com, waitrose.com, wholefoodsmarket.com, wholefoods.com
```

**Why:** podsque-enrichment caught a real silent bug — the Coffee Product Catalog v2 had Blue Bottle's URL pointing at `target.com`. Without this guard, Apollo would have happily returned "Target Corporation".

**Test impact:** add a test asserting `isBlockedDomain("target.com")` returns true.

**Bonus (optional):** export `BLOCKED_DOMAINS` so consumers can extend it without forking. And export a `deriveBrandDomain(websiteUrl, brandName)` helper that combines the blocklist with a brand-token-in-domain heuristic (consumers often want both).

---

## PR 2 — `emailProp` truncates/drops values > 100 chars

**Priority:** P0 · **Breaking:** no · **Status:** ready

**File:** `src/notion/property.ts`

**Change:** Notion's `email` field caps at 100 chars; passing 101+ throws `body failed validation: ... .email.length should be ≤ 100`. The current `emailProp` doesn't guard.

**Sketch:**

```ts
export const emailProp = (value: string | null | undefined): { email: string | null } => ({
  email: value && value.length <= 100 ? value : null,
});
```

**Why:** podsque-enrichment hit a real-world catch-all email at 102 chars during a 2099-row backfill. The whole batch crashed because the lib propagated the validation error; we lost the rest of the run.

**Test impact:** add a test asserting `emailProp("a".repeat(101) + "@x.com")` returns `{ email: null }`.

**Related:** see PR 3 — even with this guard, callers should still wrap `updatePage` in per-row error isolation since other validation modes exist (rich_text > 2000 is already handled by `truncateForNotion`, but other property types may have surprises).

---

## PR 3 — Per-row write isolation helper

**Priority:** P0 · **Breaking:** no · **Status:** ready

**File:** `src/notion/client.ts` (or a new `src/notion/batch.ts`)

**Change:** ship a tiny helper that wraps `createPage`/`updatePage` calls in try/catch so a single bad row doesn't kill an N-row batch.

**Sketch:**

```ts
// src/notion/batch.ts
export async function withRowErrorIsolation<T, R>(
  rows: T[],
  fn: (row: T, idx: number) => Promise<R>,
  opts?: { onError?: (row: T, err: Error, idx: number) => void },
): Promise<{ ok: R[]; failed: Array<{ row: T; error: Error }> }> {
  const ok: R[] = [];
  const failed: Array<{ row: T; error: Error }> = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      ok.push(await fn(rows[i] as T, i));
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      failed.push({ row: rows[i] as T, error: e });
      opts?.onError?.(rows[i] as T, e, i);
    }
  }
  return { ok, failed };
}
```

**Why:** podsque-enrichment lost a 2-hour run on row 600 of 2099 because of a single bad email. A consumer should never have to relearn this — it's a foundational pattern for any bulk Notion job. Document the helper prominently in the README.

**Test impact:** add a test where `fn` throws on row index 5 of 10 and assert `ok.length === 9`, `failed.length === 1`.

---

## PR 4 — `NotionService` retries on `request_timeout` + 502/504

**Priority:** P0 · **Breaking:** no · **Status:** ready

**File:** `src/notion/client.ts`

**Change:** wrap `runNotionCall` (already exists for rate-limiting) with `withExponentialBackoff` recognising `notionhq_client_request_timeout`, `502`, `504`, and `429`. Today only the `RequestQueue` paces calls but transient failures bubble up.

**Sketch:**

```ts
private async runNotionCall<T>(fn: () => Promise<T>): Promise<T> {
  return withExponentialBackoff(
    () => this.queue.add(() => fn()),
    {
      retries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10_000,
      shouldRetry: (err) => {
        const code = (err as { code?: string }).code;
        const status = (err as { status?: number }).status;
        return code === "notionhq_client_request_timeout"
          || status === 502 || status === 504 || status === 429;
      },
    },
  );
}
```

**Why:** podsque-enrichment's first discovery run died at 1971/2075 due to a single timeout near the end. Wasted ~10 min of writes. With retries, late-run timeout deaths disappear.

**Test impact:** mock the SDK to throw `notionhq_client_request_timeout` once then succeed; assert call returns successfully.

---

## PR 5 — `findLinkedInProfiles` — optional `founders` + apostrophe normalization

**Priority:** P1 · **Breaking:** no · **Status:** ready

**File:** `src/brave/search.ts`

**Change:** two improvements:

1. Make `founders: FounderName[]` optional, defaulting to `[]`. Many callers don't have founder names and pass `[]` explicitly today.
2. In `simplifyCompanyName`, also strip/normalize curly apostrophes (`'` → `'`). Brave returns 0 hits for queries with curly apostrophes that the same normalised query handles fine.

**Sketch:**

```ts
function simplifyCompanyName(name: string): string {
  return name
    .replace(/[‘’]/g, "'")               // curly → straight apostrophes
    .replace(/\s*\(.*?\)\s*/g, " ")
    .replace(/\b(Inc\.?|LLC|Ltd\.?|Co\.?|Corp\.?|Pty|GmbH|S\.?A\.?|formerly)\b/gi, "")
    .replace(/[,;]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function findLinkedInProfiles(
  apiKey: string,
  companyName: string,
  founders: FounderName[] = [],
): Promise<SerpCandidate[]> {
  // ...
}
```

**Why:** podsque-enrichment got 0 Brave hits for `L'OR Espresso` because of the curly apostrophe. Apollo+name search worked; Brave's specific query handling didn't.

**Test impact:** assert `simplifyCompanyName("L’OR Espresso")` strips/normalizes correctly. Add a default-arg test for `findLinkedInProfiles`.

---

## PR 6 — `ValidationResult.confidence` derived from `entityMatch`

**Priority:** P1 · **Breaking:** no\* · **Status:** ready

**Files:** `src/ai/types.ts`, `src/ai/gates.ts`

**Change:** today `ValidationResult` is `{ valid, reason, entityMatch }`. Every consumer derives `Confidence` from `entityMatch` themselves: `exact → high`, `subsidiary | parent → medium`, `unrelated → low`. Move the derivation into the lib and add `confidence` to the result.

**Sketch (in `gates.ts`):**

```ts
function confidenceFromEntityMatch(m: EntityMatch): Confidence {
  return m === "exact" ? "high" : m === "unrelated" ? "low" : "medium";
}

// at the bottom of validatePersonAtCompany, before returning:
return {
  valid: parsed.valid,
  reason: parsed.reason,
  entityMatch: parsed.entityMatch,
  confidence: confidenceFromEntityMatch(parsed.entityMatch),
};
```

**Update the type:**

```ts
export type ValidationResult = {
  valid: boolean;
  reason: string;
  entityMatch: EntityMatch;
  confidence: Confidence;
};
```

**Why:** podsque-enrichment had this exact mapping copied into `enrich.ts`. Every future consumer would too.

**Test impact:** existing tests for `validatePersonAtCompany` should now assert `confidence` is set. Any consumer that accessed `.confidence` from older versions wouldn't have anything; new field is purely additive.

---

## PR 7 — `scoreSearchCandidates` surfaces `parseFailed`

**Priority:** P1 · **Breaking:** no\* · **Status:** ready

**Files:** `src/ai/types.ts`, `src/ai/gates.ts`

**Change:** today when the LLM doesn't return a valid JSON array, `scoreSearchCandidates` logs a warning and returns `[]`. Caller can't tell "all candidates rejected" from "parser failed". Surface the distinction.

**Sketch:**

```ts
export type ScoreCandidatesResult = {
  scores: PreliminaryScore[];
  parseFailed: boolean;
};

export async function scoreSearchCandidates(
  llm: LLMClient,
  candidates: ApolloSearchResult[],
  options: { targetCompanyName: string; role: RoleContext; maxReveals?: number },
): Promise<ScoreCandidatesResult> {
  // ... existing code, but at the catch site:
  return { scores: [], parseFailed: true };
  // ... and at success site:
  return { scores, parseFailed: false };
}
```

**Why:** podsque-enrichment hit this for La Colombe — gate silently returned `[]`, caller's "if 0 candidates, fall back to Brave" logic incorrectly fired. We only caught it because we eyeballed the logs.

**Migration note:** existing consumers who do `const scored = await scoreSearchCandidates(...)` and expect `PreliminaryScore[]` will need to read `.scores`. Mark in CHANGELOG. Could ship under a new export name to avoid breakage and deprecate the old shape.

**Test impact:** mock the LLM to return malformed JSON and assert `parseFailed === true`.

---

## PR 8 — Export `normalizeDomain(url)` + `normalizeBrandName(name)`

**Priority:** P1 · **Breaking:** no · **Status:** ready

**File:** new `src/utils/normalize.ts` + `src/utils/index.ts` re-export

**Change:** ship the two normalisers podsque-enrichment had to write for dedup.

**Sketch:**

```ts
// src/utils/normalize.ts

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

const SUFFIX_TOKENS = new Set([
  "coffee", "roasters", "roaster", "roasting", "roastery", "co", "company",
  "inc", "llc", "ltd", "corp", "corporation", "the", "and", "&",
]);

export function normalizeBrandName(input: string, extraSuffixTokens: string[] = []): string {
  if (!input) return "";
  const dropTokens = new Set([...SUFFIX_TOKENS, ...extraSuffixTokens.map((t) => t.toLowerCase())]);
  let s = input.toLowerCase();
  s = s.replace(/['‘’.,&]/g, "");
  const tokens = s.split(/\s+/).filter(Boolean);
  const filtered = tokens.filter((t) => !dropTokens.has(t));
  return filtered.length > 0 ? filtered.join(" ") : tokens.join(" ");
}
```

**Note:** `SUFFIX_TOKENS` is coffee-flavoured because that's what podsque used. Library version should accept `extraSuffixTokens` so callers can add domain-specific tokens (e.g., `["studio"]` for design agencies). Keep core list to truly generic suffixes (`inc`, `llc`, `ltd`, `corp`, `corporation`, `the`, `and`, `&`).

**Test impact:** snapshot tests on representative inputs.

---

## PR 9 — Apollo `searchOrganisationsList` (mixed_companies/search)

**Priority:** P1 · **Breaking:** no · **Status:** ready

**Files:** `src/apollo/client.ts` (new function), `src/pipeline/wrapped-apollo.ts` (new wrapper method)

**Change:** add list-search via Apollo's `POST /api/v1/mixed_companies/search`. Today the lib has `searchOrganisation` (single-match) and `enrichOrganisation` (single-match enrich) only — both hit `/organizations/enrich`. Discovery flows need the multi-result endpoint.

**Apollo response shape — important to document on the type:** the search endpoint returns a *thin* profile per org. It does **NOT** include `industry`, `employees`, `city/state/country`, `short_description`, or `keywords` — those require the (paid) `enrichOrganisation` call. The search endpoint *does* return: `id, name, website_url, primary_domain, founded_year, linkedin_url, twitter_url, facebook_url, phone, primary_phone, alexa_ranking, sic_codes, naics_codes, organization_revenue_printed, organization_revenue, organization_headcount_*_growth, owned_by_organization_id, logo_url, crunchbase_url`. **Document this clearly.**

**Sketch (signatures only — full impl below):**

```ts
export type ApolloOrgListResult = {
  id: string;
  name: string;
  website_url: string;
  primary_domain: string;
  founded_year: number | null;
  linkedin_url: string;
  twitter_url: string;
  facebook_url: string;
  phone: string;
  // intentionally omitted: industry, employees, city, country, short_description, keywords
  // — those are not in the search response; consumers must call enrichOrganisation per match.
};

export type SearchOrganisationsListParams = {
  keyword: string;
  countries: string[];
  foundedYearMin?: number;
  perPage?: number;        // default 100
  maxPages?: number;       // default 5 (Apollo deep-paging cap)
};

export async function searchOrganisationsList(
  apiKey: string,
  params: SearchOrganisationsListParams,
): Promise<ApolloOrgListResult[]>;
```

**Implementation reference:** `podsque-enrichment/src/discovery/apollo-list-search.ts` — paginated, retries on 429/5xx, gentle pacing between pages. Promote that file into the lib with minimal changes.

**Why `industries` is intentionally absent from params:** Apollo's `organization_industries` filter requires internal tag UUIDs, not human-readable names. Passing strings silently zeroes the result. See PR 10 for the fix.

**Wrapped client:** add `WrappedApolloListSearch` to `pipeline/wrapped-apollo.ts` mirroring the pattern of the existing wrappers (auto-log to extractions, no credit cost since list-search is free).

**Test impact:** mock axios to return a page, assert pagination + result mapping.

---

## PR 10 — Apollo industry filter — accept names, translate or reject

**Priority:** P1 · **Breaking:** no · **Status:** ready

**File:** `src/apollo/client.ts` (extends PR 9 — same file, can ship together)

**Change:** Apollo's `organization_industries` request param requires Apollo's internal industry tag UUIDs. Passing string names silently zeroes the result set with HTTP 200 (no error). This is a high-likelihood footgun.

**Two acceptable fixes:**

1. **Strict-only:** the param accepts only known UUIDs. Reject anything that doesn't look like one with a typed error before the request is made.
2. **Translate names → UUIDs:** maintain a hard-coded map of common industry names to their Apollo UUIDs, e.g.:

   ```ts
   const APOLLO_INDUSTRY_TAG_IDS: Record<string, string> = {
     "Food & Beverages": "5567cdb_____...",  // populate via Apollo support / API
     "Specialty Foods":  "5567cdb_____...",
     "Consumer Goods":   "5567cdb_____...",
     // ...
   };
   ```

   Lib accepts strings, translates, fails fast on unknown names. Easier for consumers; small ongoing maintenance burden.

3. **Post-fetch substring match:** caller-side filter — what podsque-enrichment fell back to. **Do not ship this as the lib's solution** — it can't filter on fields the search endpoint doesn't return (which is exactly the problem; see PR 9).

**Recommended:** ship (1) plus a documented escape hatch via raw param overrides. Document the UUID requirement in JSDoc.

**Test impact:** assert that passing string names throws a typed `ApolloFilterError`.

---

## PR 11 — `scoreBrandFit(llm, candidate, role)` AI gate

**Priority:** P1 · **Breaking:** no · **Status:** ready

**Files:** `src/ai/gates.ts` (new function), `src/ai/types.ts` (new types)

**Change:** new gate alongside the existing 8. Scores whether an org-level candidate is worth pursuing for outreach. Used during discovery, before any paid Apollo people work.

**Sketch:**

```ts
export type FitGateInput = {
  brand: string;
  domain: string;
  // Optional org context — populate whatever's available:
  industry?: string;
  shortDescription?: string;
  employees?: number | null;
  foundedYear?: number | null;
  city?: string;
  country?: string;
  // Optional discovery-source context:
  matchedKeyword?: string;       // e.g. the Apollo keyword that surfaced this org
  serpResultTitle?: string;      // for Brave-discovered candidates
  serpQuery?: string;
  source: "apollo" | "brave" | "both";
};

export type FitScore = "high" | "medium" | "low";

export type FitGateResult = {
  score: FitScore;
  reason: string;          // ≤ ~25 words
  parseFailed: boolean;    // see PR 7 pattern
};

export async function scoreBrandFit(
  llm: LLMClient,
  input: FitGateInput,
  role: RoleContext,
): Promise<FitGateResult>;
```

**Implementation reference:** `podsque-enrichment/src/discovery/fit-gate.ts` — uses `chatJson` for reliable parsing, falls back to `low` on parse failure. ~70 LOC.

**Test impact:** mock LLM to return high/medium/low/malformed; assert correct mapping in each case.

---

## PR 12 — Parameterised fit-score property + `Enrichment Confidence` rename (v0.2)

**Priority:** P0 · **Breaking:** **YES** · **Status:** ready (BUNDLE INTO v0.2)

**Files:** `src/notion/standard-schema.ts`, `src/notion/setup.ts`

**Why bundled:** both touch the canonical schema and break on-disk Notion DBs of existing consumers. Land them as a single v0.2 release with a clear migration script.

**Two changes:**

### 12a. Rename `Match Confidence` → `Enrichment Confidence`

Field exists on both Companies + People schemas. The current name conflates two distinct concepts (entity-match for People, data-quality for Companies). Rename clarifies intent: *"is this row's data correct?"*.

Update:

```ts
// src/notion/standard-schema.ts
export const COMPANY_BASE_SCHEMA: SchemaDef = {
  // ...
  "Enrichment Confidence": { type: "select", options: [...CONFIDENCE_OPTIONS] },
  // (was: "Match Confidence")
};

export const PERSON_BASE_SCHEMA: SchemaDef = {
  // ...
  "Enrichment Confidence": { type: "select", options: [...CONFIDENCE_OPTIONS] },
  // (was: "Match Confidence")
};
```

**Add tiny derivation helpers** so consumers don't reinvent the rule:

```ts
// src/notion/enrichment-confidence.ts (new)

import type { ApolloOrgFromReveal } from "../apollo/client.js";
import type { Confidence, EntityMatch } from "../ai/types.js";

export function personEnrichmentConfidence(verdict: { entityMatch: EntityMatch }): Confidence {
  return verdict.entityMatch === "exact" ? "high"
    : verdict.entityMatch === "unrelated" ? "low"
    : "medium";
}

export function companyEnrichmentConfidence(args: {
  apolloOrg: ApolloOrgFromReveal | null;
  requestedDomain?: string;
  requestedName?: string;
}): Confidence {
  const { apolloOrg, requestedDomain, requestedName } = args;
  if (!apolloOrg) return "low";
  // exact: domain matches the requested domain
  if (requestedDomain && apolloOrg.primary_domain === normalizeDomain(requestedDomain)) return "high";
  // medium: name matches but domain doesn't (subsidiary / parent / rebrand)
  if (requestedName && apolloOrg.name.toLowerCase().includes(requestedName.toLowerCase())) return "medium";
  return "medium";
}
```

### 12b. Parameterised fit-score property

The fit-score is project-specific (Podsque scores brands for *Podsque* fit; magnacarta scores for its product). Hard-coding `Discovery Score` couples the lib to one consumer.

Update `setupEnrichmentDatabases`:

```ts
export type SetupOptions = {
  notion: NotionService;
  parentPageId: string;
  /**
   * Used as a prefix in DB titles AND as the field name for the fit-gate score.
   * E.g. productName="Podsque" creates "Podsque — Companies Enriched" + a
   * "Podsque Score" property (select: high/medium/low) on the Companies DB.
   */
  productName: string;
  // (was: optional `projectName`. Make `productName` required and use it for both.)
  companyExtensions?: SchemaDef;
  peopleExtensions?: SchemaDef;
};

// Then in setup.ts, when building the Companies schema:
const companyProperties = buildNotionPropertiesDict({
  ...COMPANY_BASE_SCHEMA,
  [`${options.productName} Score`]: {
    type: "select",
    options: [
      { name: "high", color: "green" },
      { name: "medium", color: "yellow" },
      { name: "low", color: "red" },
    ],
  },
  "Discovery Reason": { type: "rich_text" },
  "Discovery Source": {
    type: "select",
    options: [
      { name: "apollo", color: "blue" },
      { name: "brave", color: "orange" },
      { name: "both", color: "purple" },
      { name: "catalog", color: "gray" },
    ],
  },
  ...(options.companyExtensions ?? {}),
});
```

The `Discovery Reason` and `Discovery Source` properties stay generic (they describe *how* the row was discovered, not *what* product it's scored against). Only the score field is parameterised.

### Migration script

Ship a `migrate-v0_2.ts` script in the lib that:
1. Reads the consumer's existing Companies + People DBs.
2. Renames `Match Confidence` → `Enrichment Confidence` on both via `databases.update` with `{ "Match Confidence": { name: "Enrichment Confidence" } }` (in-place rename preserves all values).
3. (Optional, prompt user) renames the consumer's existing fit-score property to `${productName} Score`.

**Reference:** podsque-enrichment did exactly this rename — see `src/rename-properties.ts` in that repo.

**CHANGELOG entry:**

```
## v0.2.0 — BREAKING

- Renamed `Match Confidence` → `Enrichment Confidence` on Companies + People schemas.
- `setupEnrichmentDatabases` now requires `productName: string` (was: optional `projectName`).
- Companies DB now includes `${productName} Score`, `Discovery Reason`, `Discovery Source` by default.
- Migration: run `npx outreach-forge migrate-v0_2 --product-name="..."` after upgrading.
- New helpers: `personEnrichmentConfidence`, `companyEnrichmentConfidence` (drop-in replacements for the per-consumer mappings).
```

---

## PR 13 — `runEnrichment` — `dedupKey` + `lookupExisting` hooks

**Priority:** P1 · **Breaking:** no · **Status:** ready

**File:** `src/pipeline/runner.ts`

**Change:** today `runEnrichment` always calls `process(item, ctx)` and the consumer is responsible for finding-or-creating Company pages inside `process`. Most consumers want upsert semantics (skip-create if a row already exists by name/domain). Add hooks:

```ts
export type RunOptions<T> = {
  items: T[];
  process: (item: T, ctx: RunContext, existingCompanyPageId: string | null) => Promise<void>;
  identify?: (item: T) => string;
  apolloApiKey?: string;
  braveApiKey?: string;
  extractionsDb?: ExtractionsDb;
  dryRun?: boolean;
  maxApolloCredits?: number;
  // NEW: 
  dedupKey?: (item: T) => string;
  lookupExisting?: (key: string) => Promise<string | null>;  // returns Notion page ID or null
};
```

When both `dedupKey` and `lookupExisting` are provided, the runner calls `lookupExisting(dedupKey(item))` once per item before invoking `process` and passes the result as the third argument. `process` reuses the page if non-null, creates a new one otherwise.

**Why:** podsque-enrichment had `findExistingCompanyPage(notion, dbId, brand)` inlined in `enrich.ts`. Generic enough to hoist.

**Test impact:** assert that `lookupExisting` is called exactly once per item before `process`.

---

## PR 14 — Brave / Firecrawl scrape provider abstraction

**Priority:** P1 · **Breaking:** no · **Status:** needs design

**Files:** `src/scraper/website.ts`, new `src/scraper/providers/{axios,firecrawl,playwright}.ts`

**Change:** today `scrapeWebsite` is axios-only. Cloudflare-protected sites return 403 (real measured rate in podsque: ~13% of all sites). Need a provider system.

**Sketch:**

```ts
export type ScrapeProvider = {
  name: string;
  fetch(url: string, opts?: { stealth?: boolean }): Promise<{ html: string; status: number }>;
};

export type ScrapeOptions = {
  fallback?: ScrapeProvider;     // try when primary returns 403/SSL/etc
  primary?: ScrapeProvider;      // default: axios
  // existing options...
};

export async function scrapeWebsite(url: string, opts: ScrapeOptions = {}): Promise<WebsiteScrapeResult> {
  const primary = opts.primary ?? axiosProvider;
  let fetched = await tryProvider(primary, url);
  if (!fetched && opts.fallback) {
    fetched = await tryProvider(opts.fallback, url, { stealth: true });
  }
  if (!fetched) return failedResult(url);
  return parseHtml(fetched.html, url);
}
```

**Provider implementations:**
- `axiosProvider` — current behaviour, no changes.
- `firecrawlProvider` — `POST https://api.firecrawl.dev/v1/scrape` with `{ formats: ["rawHtml"], waitFor: 4000, proxy: "stealth" }`. Reference: `podsque-enrichment/src/firecrawl-fallback.ts`. **Important:** make Firecrawl a peer dep, not a hard dep, so consumers without a Firecrawl key don't pay a bundle/install cost.
- `playwrightProvider` — for JS-only renders. Even more peer-dep-style.

**Why "needs design":** the failure-mode taxonomy needs a typed shape so the fallback chain can be smart (e.g., don't waste a Firecrawl call on `getaddrinfo ENOTFOUND` — DNS-not-found is permanent). Also, billing/usage tracking for Firecrawl should slot into `CostTracker`.

**Test impact:** mock both providers and assert fallback fires only on the right error classes.

---

## PR 15 — `enrichCompanyWithSocials(apollo, scraper, params)`

**Priority:** P1 · **Breaking:** no · **Status:** ready

**File:** new `src/pipeline/enrich-company-with-socials.ts`

**Change:** higher-level helper that does the obvious-but-easy-to-miss thing: call Apollo `enrichOrganisation`, scrape the resolved homepage, merge into one combined `CompanyEnrichment`-shaped object with socials + email + contact-form-URL filled.

```ts
export type CompanyEnrichmentWithSocials = ApolloOrgFromReveal & {
  socials: { linkedin: string | null; x: string | null; instagram: string | null; facebook: string | null; youtube: string | null; tiktok: string | null };
  businessEmail: string | null;
  contactFormUrl: string | null;
  scrapeFailed: boolean;
  scrapeFailureReason?: string;
};

export async function enrichCompanyWithSocials(
  apollo: WrappedApollo,
  scraper: WrappedScraper,
  params: { domain?: string; name?: string },
): Promise<CompanyEnrichmentWithSocials | null>;
```

**Why:** podsque-enrichment's `enrich.ts` originally called `ctx.scrape(...)` and threw the result away (silent bug). 13/15 Companies were missing socials until we wrote a separate `backfill-socials` script. This helper makes the merge automatic.

**Implementation:** ~30 LOC. Use Apollo's `website_url` as the scrape URL, fall back to a sanitised domain. If scrape fails, return Apollo data alone with `scrapeFailed: true`.

**Test impact:** mock both, assert Apollo + scrape merge happens cleanly and `scrapeFailed` flips on failure.

---

## PR 16 — LLM-based homepage extractor (`extractCompanyContext`)

**Priority:** P2 · **Breaking:** no · **Status:** needs design

**Files:** new `src/ai/extract-company-context.ts`, `src/ai/types.ts`

**Change:** today's scraper only regex-extracts socials/email/contact-form. The richer signal (founded year from About page, retail location count, brand voice, signature origins, packaging description) lives in the prose. Fetching homepage + `/about` + `/our-story` + `/locations`, stripping nav/footer, and feeding cleaned text to the LLM produces dramatically better input for both `scoreBrandFit` and `generateOutreachBrief`.

**Sketch:**

```ts
export type CompanyContext = {
  tagline: string;
  yearFoundedFromCopy: number | null;
  retailPresence: "yes-cafe" | "yes-retail-only" | "online-only" | "wholesale-only" | "unknown";
  retailLocationCount: number | null;
  signatureOrigins: string[];          // e.g. ["Ethiopia", "Colombia", "Guatemala"]
  signatureProcessing: string[];       // e.g. ["Anaerobic", "Honey"]
  aestheticSignal: "high" | "medium" | "low";
  brandVoice: string;                  // ≤ 25 words
  notes: string;                       // any other relevant signal
};

export async function extractCompanyContext(
  scraper: WrappedScraper,
  llm: LLMClient,
  domain: string,
  options?: { paths?: string[] },     // default: ["/", "/about", "/our-story", "/locations"]
): Promise<CompanyContext | null>;
```

**Why "needs design":** open questions:
- Token budget per call (homepage HTML can be 100k+ tokens raw)
- Caching strategy (re-running discovery on the same brands shouldn't re-extract)
- Cost cap (this is the most expensive gate; needs `maxLLMCostUsd` style guard)
- How to integrate with `scoreBrandFit` (run extractor first, feed result into fit-gate prompt) vs as a separate enrichment stage

**Cost ballpark:** ~$0.05-0.15 per company at gpt-5.4 prices, depending on page size. For 2k discovery candidates, $100-300. Significant — this gate should be opt-in or run only on `medium`/`high` after the cheap fit-gate.

---

## PR 17 — Two-way Notion relation helper (`linkDatabases`)

**Priority:** P2 · **Breaking:** no · **Status:** ready

**File:** `src/notion/client.ts`

**Change:** add convenience method on `NotionService`:

```ts
async linkDatabases(args: {
  sourceDbId: string;
  targetDbId: string;
  propertyName: string;             // e.g. "Enriched Company"
  syncedPropertyName: string;       // e.g. "Coffee Products"
}): Promise<void> {
  await this.updateDatabase({
    databaseId: args.sourceDbId,
    properties: {
      [args.propertyName]: {
        type: "relation",
        relation: {
          database_id: args.targetDbId,
          type: "dual_property",
          dual_property: { synced_property_name: args.syncedPropertyName },
        },
      },
    } as never,
  });
}
```

**Why:** podsque-enrichment used the raw API for this in `add-catalog-relation.ts`. ~5 LOC of wrapping makes it a one-liner for consumers.

**Test impact:** mock `databases.update` and assert the relation property is built correctly.

---

## PR 18 — Idempotent setup variant

**Priority:** P2 · **Breaking:** no · **Status:** ready

**File:** `src/notion/setup.ts`

**Change:** add `setupEnrichmentDatabasesIdempotent` (or `findOrCreate` flag on existing function) that looks up existing DBs by title under the parent page before creating. Returns the same `EnrichmentDatabaseIds` shape either way.

**Sketch:**

```ts
export async function setupEnrichmentDatabasesIdempotent(
  options: SetupOptions,
): Promise<EnrichmentDatabaseIds> {
  const titles = {
    company: `${options.productName} — Companies Enriched`,
    people: `${options.productName} — People Enriched`,
    extractions: `${options.productName} — Extractions`,
  };
  const existing = await findChildDatabasesByTitle(options.notion, options.parentPageId, Object.values(titles));
  if (existing.length === 3) {
    logger.info("[setup] All 3 DBs already exist under parent — reusing.");
    return mapToIds(existing, titles);
  }
  // Otherwise fall through to the existing create flow.
  return setupEnrichmentDatabases(options);
}
```

**Why:** the existing function's "not idempotent" warning is a footgun. podsque-enrichment had to add a guard in their setup script to refuse to run if env vars were already set. Library-side idempotency is cleaner.

**Test impact:** mock `notion.search`/`children.list` to return the 3 DBs and assert no creates happen.

---

## PR 19 — `runDiscovery` orchestrator

**Priority:** P2 · **Breaking:** no · **Status:** needs design

**Files:** new `src/pipeline/run-discovery.ts`

**Change:** generic discovery orchestrator that wraps the pattern: Apollo list-search × N keywords + Brave SERP × M queries → dedupe → fit-gate → write to Companies as `discovered`.

**Sketch:**

```ts
export type DiscoveryOptions = {
  notion: NotionService;
  companiesDbId: string;
  apollo: WrappedApolloListSearch;
  brave: WrappedBrave;
  llm: LLMClient;
  role: RoleContext;
  apolloKeywords: string[];
  apolloFilters: { countries: string[]; foundedYearMin?: number };
  braveQueries: string[];
  knownDomains?: Set<string>;       // skip these
  productName: string;              // for the fit-score property name
  candidateLimit?: number;
  dryRun?: boolean;
};

export async function runDiscovery(options: DiscoveryOptions): Promise<{
  apolloCount: number;
  braveCount: number;
  uniqueCount: number;
  written: number;
  byScore: Record<FitScore, number>;
}>;
```

**Why "needs design":** the dedup logic, name-collision handling, and Brave URL parsing are all judgement calls that consumers may want to override. Need a clean extension model (e.g. `customFilter`, `customDedupKey` callbacks) without making the API a kitchen sink.

**Reference:** podsque-enrichment/src/discover.ts is a working impl, but tightly coupled to project conventions (e.g. `Brand → domain → Notion props`). Generalising means lifting those out.

---

## PR 20 — `runEnrichmentFromNotion` (status-driven HITL loop)

**Priority:** P2 · **Breaking:** no · **Status:** ready

**File:** new `src/pipeline/run-enrichment-from-notion.ts`

**Change:** for HITL-driven projects: read items from a Notion DB filtered by status, run `runEnrichment`-style processing, update each row's status based on outcome.

**Sketch:**

```ts
export type RunEnrichmentFromNotionOptions = {
  notion: NotionService;
  companiesDbId: string;
  inputStatusFilter: { property: string; equals: string };  // e.g. { property: "Enrichment Status", equals: "approved" }
  process: (row: NotionPage, ctx: RunContext) => Promise<{ outcome: "done" | "partial" | "failed"; reason?: string }>;
  // ...standard enrich options (apolloApiKey, braveApiKey, etc.)
};

export async function runEnrichmentFromNotion(opts: RunEnrichmentFromNotionOptions): Promise<RunStats>;
```

After processing each row, the runner updates `Enrichment Status` to the returned outcome and sets `Last Checked At` to now.

**Why:** podsque-enrichment had `enrich-approved.ts` doing exactly this. Pattern is generic.

**Test impact:** mock `queryDatabase` + `updatePage`, assert status transitions correctly.

---

## PR 21 — Documentation expansions

**Priority:** P2 · **Breaking:** no · **Status:** ready

**File:** `README.md`

**Add the following sections:**

### Prerequisites — workspace-root parent page

> Most internal Notion integrations cannot create top-level pages — Notion's API rejects with `creating workspace-level private pages is not supported`. **Create the parent page manually** via the Notion UI, share it with your integration, then pass its ID to `setupEnrichmentDatabases`.

### Idempotency

> **`setupEnrichmentDatabases` is NOT idempotent.** Re-running creates duplicate DBs under the parent page. Save the returned IDs immediately (typically as env vars). For idempotent re-runs, use `setupEnrichmentDatabasesIdempotent` (PR 18) instead.

### Quick start with `tsx` / ESM

```bash
# Use this pattern in consumer projects:
npm install outreach-forge dotenv tsx
cp .env.example .env
# Optional: layer a shared secrets file (so Apollo/Brave/OpenAI keys are reused
# across multiple enrichment projects)
echo 'SECRETS_ENV_PATH=~/.config/env-variables/secrets.env' >> .env
```

```ts
// In your consumer project's config.ts:
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

loadDotenv();
const secretsPath = process.env.SECRETS_ENV_PATH;
if (secretsPath) {
  const expanded = secretsPath.startsWith("~")
    ? path.join(homedir(), secretsPath.slice(1))
    : secretsPath;
  if (existsSync(expanded)) loadDotenv({ path: expanded, override: false });
}
```

### Common scrape failure modes

> When using the default axios scraper, expect ~10–15% of sites to fail:
> - **Cloudflare 403** — site blocks non-browser fingerprints. Recoverable via Firecrawl provider (PR 14).
> - **`getaddrinfo ENOTFOUND`** — domain doesn't resolve. Permanent. No tool can recover.
> - **`certificate has expired` / cert hostname mismatch** — sometimes recoverable via Firecrawl (proxy doesn't enforce strict TLS).
> - **`timeout of 10000ms exceeded`** — slow/dead site.
> - **`Skipped non-HTML content-type`** — server returned PDF/binary.

### Naming conventions (canonical)

> - LinkedIn properties: **"LinkedIn Person URL"** (not "Linkedin Person Url")
> - Apollo organisation ID: **"Apollo Organisation ID"** (British spelling)
> - Status enum values: `pending` · `done` · `partial` · `failed` · `needs_review`
> - HITL extension values (consumer-defined select options): `discovered` · `approved` · `rejected`
> - Confidence enum values: `high` · `medium` · `low`
> - Renamed in v0.2: `Enrichment Confidence` (was `Match Confidence`)
> - Project-specific: `${productName} Score` (consumer chooses productName at setup)

---

## Process learnings (no code changes)

These are observations to mention in lib docs but don't merit PRs:

- **`--print-domains` validation mode.** Before running any paid enrichment, callers benefit from a CLI mode that lists each input item's resolved domain (after retailer-blocklist + brand-token filter). podsque caught Blue Bottle's wrong-domain issue this way.
- **Catalog data quality matters.** Fields like `Brand Country` can be wrong if they came from sheet-name-on-import logic. Don't trust source data; verify at the gate.
- **0 people ≠ failure.** AI-rejected candidates are often the gate doing its job (e.g., commodity brands legitimately scored low). The audit log should distinguish "0 candidates returned by Apollo" from "candidates returned but AI rejected all".
- **HITL beats AI-only at scale.** First catalog run: 15 brands, AI silently rejected ~5. Second discovery run: 2k brands. Same silent-rejection rate would mean hundreds invisibly lost. Discovery → review → approve flow puts a human in the loop *before* paid Apollo credits land.
- **Apollo's `mixed_companies/search` deep-paging caps at ~5 pages × 100 = 500 results per query.** Document. Consumers may want to stitch together multiple narrower keyword searches to get coverage.

---

## Suggested merge order (for the implementing Claude session)

Land in this sequence for minimum churn:

1. **PR 1, 2, 3, 4** — pure bug fixes, no API changes. Land first, ship a v0.1.x patch.
2. **PR 5, 6, 7, 8** — small additive improvements. Same patch release or v0.1.next.
3. **PR 9, 10** — Apollo list-search + industry filter sanity. New API surface, additive only.
4. **PR 11** — `scoreBrandFit` gate. Depends on the existing `RoleContext` type only.
5. **PR 13, 15** — `runEnrichment` hooks + `enrichCompanyWithSocials`. Both consumer-friendly additions.
6. **PR 17, 18** — Notion convenience helpers. Standalone.
7. **PR 21** — README expansions. Can land alongside any of the above.
8. **PR 12** — Renames + parameterised fit-score. **Land last, as v0.2.0.** Bundle the migration script. Update CHANGELOG with breaking-change notes.
9. **PR 14, 16, 19, 20** — bigger features that need design discussion. Don't rush; punt to v0.3.

When PR 12 lands, rev podsque-enrichment to use the new lib version + delete its `rename-properties.ts`, `extend-companies-schema.ts`, and the manual confidence-mapping in `enrich.ts`.
