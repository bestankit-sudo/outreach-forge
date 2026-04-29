# outreach-forge

> Opinionated B2B contact enrichment pipeline. Apollo + Brave + an LLM of your choice + Notion.

Given a list of companies, find the best reachable contact for each one — LinkedIn profile, verified email, or company channel — and write structured results to Notion.

> ⚠️ **Status: pre-v0.1.** API may shift. Not yet on npm. License: MIT.

## What it does

```
your list of companies
       │
       ▼
┌──────────────────────────────────────┐
│ Stage 1: Company enrichment           │
│   Website scrape (socials, emails)    │
│   Apollo org enrich (industry, size)  │
└──────────────────┬───────────────────┘
                   ▼
┌──────────────────────────────────────┐
│ Stage 2: People discovery             │
│   Apollo search (free)                │
│   AI prelim score → pick best 1–3     │
│   Apollo reveal (paid, 1 credit each) │
│   AI validate ("works there?")        │
│   AI score + evidence summary         │
│   AI quality gate                     │
│   Brave SERP fallback if Apollo empty │
└──────────────────┬───────────────────┘
                   ▼
┌──────────────────────────────────────┐
│ Stage 3: Dedup + write                │
│   Best-of-both merge across sources   │
│   Write to 3 standard Notion DBs:     │
│     Companies, People, Extractions    │
└──────────────────────────────────────┘
```

The library provides the **machinery**; you write the **strategy** (what titles to search, what counts as "good enough", what extra fields your project needs).

---

## Prerequisites

Before installing, make sure you have:

1. **Node 20+**
2. **A Notion integration** — go to [notion.so/my-integrations](https://www.notion.so/my-integrations), click "+ New integration", copy the secret. This is your `NOTION_API_KEY`.
3. **A Notion page** that will become the parent of the 3 enrichment databases. Create one **manually in the Notion UI** (most internal integrations cannot create top-level pages — Notion's API rejects with `creating workspace-level private pages is not supported`). Then in the page header click the "..." menu → "Connections" → add your integration. Copy the page ID from its URL (the 32-char string after the last dash).
4. **API keys** for:
   - **Apollo** ([apollo.io](https://app.apollo.io/)) — paid; people search is free, reveals cost 1 credit each, list-search via `mixed_companies/search` is free (deep-pages cap at ~5 × 100 = 500 results per query)
   - **Brave Search** ([brave.com/search/api](https://brave.com/search/api/)) — free tier available
   - An **OpenAI-compatible LLM endpoint** — see "Bring your own LLM" below

### Sharing one secrets file across projects

If you run multiple enrichment projects, store API keys once and layer them via a shared file. Add to your project's `.env`:

```bash
SECRETS_ENV_PATH=~/.config/env-variables/secrets.env
```

Then in your project's bootstrap:

```ts
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

The project-local `.env` overrides shared secrets, so per-project values still win.

---

## Installation

Until this hits npm, install via local file dependency:

```jsonc
// In your project's package.json
"dependencies": {
  "outreach-forge": "file:../outreach-forge"
}
```

Then in the library directory, run `npm run build` once so the consumer's `npm install` picks up `dist/`.

```bash
cd outreach-forge && npm run build
cd ../your-project && npm install
```

---

## Quick start

### 1. One-time: create the 3 enrichment databases

```typescript
import { NotionService, setupEnrichmentDatabases } from "outreach-forge";

const notion = new NotionService(process.env.NOTION_API_KEY!);

const ids = await setupEnrichmentDatabases({
  notion,
  parentPageId: process.env.NOTION_PARENT_PAGE_ID!,
  projectName: "My Project",
});

console.log(ids);
// {
//   companyDbId:     "...",
//   peopleDbId:      "...",
//   extractionsDbId: "...",
// }
```

This creates three databases under your parent page:

| Database | What goes in it |
|---|---|
| `My Project — Companies Enriched` | One row per company. Domain, socials, industry, funding, etc. |
| `My Project — People Enriched` | One row per discovered contact. Name, LinkedIn, email, evidence. |
| `My Project — Extractions` | Audit log. One row per Apollo/Brave/scrape call with credits used. |

**Save the returned IDs as env vars.** Re-running `setupEnrichmentDatabases` creates duplicates (it's not idempotent). For idempotent re-runs use `setupEnrichmentDatabasesIdempotent` — it looks up the 3 DBs by their canonical titles under the parent page and reuses them when all 3 already exist.

### 2. Run an enrichment

```typescript
import { NotionService, ExtractionsDb, runEnrichment } from "outreach-forge";

const notion = new NotionService(process.env.NOTION_API_KEY!);
const extractions = new ExtractionsDb(notion, process.env.EXTRACTIONS_DB_ID!);

const companies = [
  { name: "Acme Coffee", url: "https://acmecoffee.com" },
  { name: "Brooklyn Beans", url: "https://brooklynbeans.com" },
];

const stats = await runEnrichment({
  items: companies,
  identify: (c) => c.name,
  apolloApiKey: process.env.APOLLO_API_KEY!,
  braveApiKey: process.env.BRAVE_SEARCH_API_KEY!,
  extractionsDb: extractions,        // every API call auto-logged
  maxApolloCredits: 50,              // hard cap — aborts run if exceeded
  dryRun: process.argv.includes("--dry-run"),

  process: async (company, ctx) => {
    ctx.log(`scraping ${company.url}`);
    const scraped = await ctx.scrape(company.url);

    ctx.log("Apollo org enrich");
    const org = await ctx.apollo.enrichOrganisation({ domain: company.url });
    if (!org) throw new Error("Apollo no match");

    ctx.log("Apollo people search");
    const candidates = await ctx.apollo.searchPeople({
      domain: org.primary_domain,
      personTitles: ["partnerships", "wholesale", "co-founder"],
      perPage: 5,
    });

    ctx.log(`found ${candidates.length} candidates — write your scoring/reveal/dedup here`);
    // See "Adding AI gates" and "Writing to Notion" below.
  },
});

console.log(`${stats.succeeded}/${stats.totalItems} done, ${stats.apolloCreditsUsed} credits used`);
```

The `ctx` object inside `process` gives you pre-wrapped Apollo, Brave, and scraper helpers that:
- Skip real calls in `--dry-run`
- Auto-log every call to your Extractions DB
- Track Apollo credits and abort the run if you hit `maxApolloCredits`

---

## Bring your own LLM

The library never instantiates an LLM directly. You construct an `LLMClient` and pass it to AI gates:

```typescript
import { LLMClient } from "outreach-forge";

// OpenAI (default)
const llm = new LLMClient({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-5.4",
});

// Anthropic via OpenAI-compatible proxy
const llm = new LLMClient({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  baseURL: "https://api.anthropic.com/v1/",
  model: "claude-opus-4-7",
});

// Groq (free tier, fast)
const llm = new LLMClient({
  apiKey: process.env.GROQ_API_KEY!,
  baseURL: "https://api.groq.com/openai/v1",
  model: "llama-3.1-70b-versatile",
});

// Ollama (local, free)
const llm = new LLMClient({
  apiKey: "ollama",
  baseURL: "http://localhost:11434/v1",
  model: "llama3",
});
```

---

## Adding AI gates to your pipeline

The 8 AI gates are parameterized via a `RoleContext` so the same prompts work across project domains:

```typescript
import { LLMClient, scoreSearchCandidates, validatePersonAtCompany,
         scoreRevealedCandidates, generateOutreachBrief, type RoleContext } from "outreach-forge";

const llm = new LLMClient({ apiKey: process.env.OPENAI_API_KEY!, model: "gpt-5.4" });

// Describe what you're looking for. Splices into every gate's prompts.
const role: RoleContext = {
  entityType: "specialty coffee roasters",
  targetRole: "head of partnerships or wholesale",
  additionalContext: "we sell pod-compatible packaging — partnership angle",
};

// Inside your `process` function:
const scored = await scoreSearchCandidates(llm, candidates, {
  targetCompanyName: company.name,
  role,
  maxReveals: 2,                  // only reveal top 2 — saves credits
});

const toReveal = scored.filter((s) => s.worthRevealing);
for (const c of toReveal) {
  const person = await ctx.apollo.revealPerson(c.id);
  if (!person) continue;

  const verdict = await validatePersonAtCompany(llm, person,
    { companyName: company.name, domain: org.primary_domain }, role);
  if (!verdict.valid) continue;

  const brief = await generateOutreachBrief(llm, {
    candidate: { name: person.name, title: person.title,
                  headline: person.headline, linkedinUrl: person.linkedin_url },
    company: { name: company.name, domain: org.primary_domain,
               description: org.short_description },
    role,
  });

  // Write to Notion (next section)
}
```

The 8 gates: `scoreSearchCandidates`, `validatePersonAtCompany`, `scoreRevealedCandidates`, `validateDataQuality`, `disambiguateEntity`, `decideMerge`, `generateOutreachBrief`, `generateCompanySummary`.

---

## Writing to Notion

The library gives you typed property builders and readers:

```typescript
import { titleProp, richTextProp, urlProp, selectProp, relationProp,
         numberProp, checkboxProp, dateProp } from "outreach-forge";

await notion.createPage(process.env.PEOPLE_DB_ID!, {
  "Full Name": titleProp(person.name),
  "First Name": richTextProp(person.first_name),
  "Last Name": richTextProp(person.last_name),
  "LinkedIn Person URL": urlProp(person.linkedin_url),
  "Apollo Person ID": richTextProp(person.id),
  "Work Emails": richTextProp(person.email),
  "Job Title": richTextProp(person.title),
  "Enrichment Confidence": selectProp("high"),
  "Discovery Method": selectProp("apollo"),
  "Linked Company": relationProp(companyPageId),
  "Last Enriched At": dateProp(new Date().toISOString()),
});
```

### Per-row write isolation for bulk jobs

A single bad row (over-100-char email, malformed select, transient validation error) will abort an entire batch if writes are inline. Wrap bulk writes:

```ts
import { withRowErrorIsolation } from "outreach-forge";

const { ok, failed } = await withRowErrorIsolation(rows, async (row, idx) => {
  return notion.createPage(peopleDbId, {
    "Full Name": titleProp(row.name),
    "Work Emails": richTextProp(row.email ?? ""),
  });
});

console.log(`${ok.length} written, ${failed.length} failed`);
for (const f of failed) console.warn(`row ${f.index}: ${f.error.message}`);
```

`emailProp` already drops > 100-char values silently to avoid this footgun, but other property types may surprise you — wrap.

The standard schema field names are documented below. Use whatever subset your project needs.

---

## Standard schema (what `setupEnrichmentDatabases` creates)

### Companies Enriched

`Company Name` (title) · `Company Domain` (url) · `Company Description` (rich_text) · `Industry` (rich_text) · `Employee Count` (number) · `Founded Year` (number) · `Total Funding` (rich_text) · `Funding Stage` (rich_text) · `LinkedIn Company URL` (url) · `X URL` (url) · `Instagram URL` (url) · `Facebook URL` (url) · `YouTube URL` (url) · `TikTok URL` (url) · `Generic Business Email` (email) · `Contact Form URL` (url) · `Company Phone` (rich_text) · `Company Country` (rich_text) · `HQ City` (rich_text) · `Apollo Organisation ID` (rich_text) · `Best Outreach Path` (rich_text) · `Company Outreach Readiness` (select) · `Enrichment Status` (select) · `Enrichment Confidence` (select) · `Source Notes` (rich_text) · `Last Checked At` (date)

Plus relations: `All People`, `Best Person`, `Extractions`.

### People Enriched

`Full Name` (title) · `First Name` · `Last Name` · `Job Title` · `Headline` · `LinkedIn Person URL` (url) · `Apollo Person ID` · `Work Emails` · `Email Status` · `City` · `Country` · `Discovery Method` (select: apollo/serp_fallback/manual) · `Enrichment Confidence` (select) · `Evidence Summary` · `Match Notes` · `Candidate Rank` (number) · `Is Primary Candidate` (checkbox) · `Enrich Status` (select) · `Last Enriched At` (date)

Plus relations: `Linked Company`, `Extractions`.

### Extractions (audit log)

`Extraction` (title) · `Type` (select: company/person) · `Source` (select: apollo_search/apollo_reveal/apollo_org/website_scrape/brave_serp/manual/chinese_media) · `Status` (select: raw/accepted/rejected/merged) · `Credits Used` (number) · `Extracted At` (date) · `Raw Data` · `Source Query` · `Source Notes` · `AI Validation`

Plus relations: `Company`, `Person`.

### Adding project-specific fields

```typescript
await setupEnrichmentDatabases({
  notion,
  parentPageId: "...",
  projectName: "Roaster Outreach",
  companyExtensions: {
    "Roaster Tier": {
      type: "select",
      options: [{ name: "boutique" }, { name: "regional" }, { name: "national" }],
    },
    "Last Order Date": { type: "date" },
  },
});
```

Standard fields are always there; your extensions are added on top.

---

## Dedup

After running enrichment a few times you'll have duplicate records — same person discovered by different sources, or the same Apollo ID written twice across runs. The library has dedup primitives:

```typescript
import { dedupByKey, defaultPersonScoringRubric, linkedinUrlKey, unionArrays } from "outreach-forge";

const allPeople = /* load all rows from your Notion People DB and map to your shape */;

const results = dedupByKey(allPeople, {
  keyFn: (p) => linkedinUrlKey(p.linkedinUrl),     // group by normalized LinkedIn URL
  rubric: defaultPersonScoringRubric(),            // Apollo ID +10, email +8, etc.
  mergeSpec: [
    { field: "workEmails" },                       // fill empty winner field from loser
    { field: "jobTitle" },
    { field: "campaignIds", combine: unionArrays }, // union all relation lists
  ],
});

// Apply the results to Notion
for (const { winner, losers, updates } of results) {
  if (Object.keys(updates).length > 0) {
    await notion.updatePage(winner.id, /* convert updates to Notion props */);
  }
  for (const loser of losers) await notion.archivePage(loser.id);
}
```

Run dedup once with `Apollo Person ID` as the key, again with `linkedinUrlKey`, and once more with `lowercase(name) + companyId` to catch every case.

---

## What lives in the library vs your project

| Concern | Lives in |
|---|---|
| Apollo client, Brave client, scraper, LLM wrapper | Library |
| AI gate prompts (parameterized via `RoleContext`) | Library |
| Standard Notion schema (Companies, People, Extractions) | Library |
| Dedup primitives + scoring rubric | Library |
| `runEnrichment` loop with auto-logging + cost tracking | Library |
| **Project-specific search strategy** (which titles, how many passes) | Your project |
| **Stop conditions** (coverage targets, "good enough" rules) | Your project |
| **Source data shape** (your input list — CSV, Notion DB, scraped, etc.) | Your project |
| **Custom Notion fields** (passed to `setupEnrichmentDatabases` as extensions) | Your project |
| **Domain-specific search paths** (e.g. Chinese-language SERP, Crunchbase) | Your project |

---

## API surface (full export list)

Single import root: `outreach-forge`.

**Utilities:** `logger`, `sleep`, `RequestQueue`, `withExponentialBackoff`, `extractDomain`, `normalizeUrl`, `normalizeDomain`, `normalizeBrandName`, `BRAND_NAME_SUFFIX_TOKENS`, `parseFounderName`, `parseFounderNames`

**Apollo:** `searchPeopleMetadata`, `revealPerson`, `revealByLinkedIn`, `searchOrganisation`, `enrichOrganisation`, `searchOrganisationsList`, `isBlockedDomain`, `BLOCKED_DOMAINS`, `ApolloFilterError` · types: `ApolloSearchResult`, `ApolloPerson`, `ApolloOrgFromReveal`, `ApolloOrganisation`, `ApolloOrgListResult`, `PeopleSearchParams`, `SearchOrganisationsListParams`

**Brave:** `findLinkedInProfiles`, `searchSerp`, `simplifyCompanyName` · types: `FounderName`, `SerpCandidate`

**Scraper:** `scrapeWebsite` · types: `WebsiteScrapeResult`

**LLM:** `LLMClient` · types: `LLMConfig`, `ChatMessage`, `ChatOptions`

**AI gates:** `scoreSearchCandidates`, `scoreSearchCandidatesDetailed`, `validatePersonAtCompany`, `scoreRevealedCandidates`, `validateDataQuality`, `disambiguateEntity`, `decideMerge`, `generateOutreachBrief`, `generateCompanySummary`, `confidenceFromEntityMatch` · types: `RoleContext`, `Confidence`, `EntityMatch`, `ValidationResult`, `DisambiguationResult`, `PreliminaryScore`, `ScoreCandidatesResult`, `CandidateScore`, `DataQualityResult`, `MergeDecision`

**Dedup:** `scoreRecord`, `defaultPersonScoringRubric`, `groupByKey`, `linkedinUrlKey`, `planMerge`, `isFalsy`, `unionArrays`, `dedupByKey` · types: `ScoringRule`, `ScoringRubric`, `MergeRule`, `MergeSpec`, `DedupResult`

**Notion:** `NotionService`, all property builders (`titleProp` · `richTextProp` · `urlProp` · `emailProp` · `numberProp` · `selectProp` · `multiSelectProp` · `checkboxProp` · `dateProp` · `relationProp` · `fileProp` · `truncateForNotion`), all readers (`getTitle` · `getRichText` · `getUrl` · `getEmail` · `getSelect` · `getMultiSelect` · `getDate` · `getNumber` · `getCheckbox` · `getRelationIds` · `getTextOrUrl`), `COMPANY_BASE_SCHEMA` · `PERSON_BASE_SCHEMA` · `EXTRACTION_BASE_SCHEMA` · `buildNotionPropertyConfig` · `buildNotionPropertiesDict` · `setupEnrichmentDatabases` · `setupEnrichmentDatabasesIdempotent` · `ExtractionsDb` · `withRowErrorIsolation` · `personEnrichmentConfidence` · `companyEnrichmentConfidence` · types: `NotionPage`, `SchemaProperty`, `SchemaDef`, `EnrichmentDatabaseIds`, `SetupOptions`, `CompanyEnrichment`, `PersonEnrichment`, `Extraction`, `EnrichmentConfidence`, `MatchConfidence` (alias), `RowErrorIsolationResult`, `RowErrorIsolationOptions`, all enum types

**Pipeline:** `runEnrichment`, `runEnrichmentFromNotion`, `enrichCompanyWithSocials`, `CostTracker`, `WrappedApollo`, `WrappedBrave`, `WrappedScraper` · types: `RunContext`, `RunStats`, `RunOptions`, `RunEnrichmentFromNotionOptions`, `EnrichmentOutcome`, `CompanyEnrichmentWithSocials`

---

## Naming conventions (locked)

- LinkedIn properties: **"LinkedIn Person URL"** (not "Linkedin Person Url")
- Apollo organisation ID uses British spelling: **"Apollo Organisation ID"**
- Status enum values: `pending` · `done` · `partial` · `failed` · `needs_review`
- HITL extension values (consumer-defined select options): `discovered` · `approved` · `rejected`
- Confidence enum values: `high` · `medium` · `low`
- Confidence property is **"Enrichment Confidence"** (renamed from "Match Confidence" in v0.1.x — the old name conflated entity-match-for-People with data-quality-for-Companies)

These names appear in your Notion databases. Don't override them in extensions or your code won't read what the library writes.

---

## Common scrape failure modes

When using the default axios scraper, expect ~10–15% of sites to fail. The failure shows up in `WebsiteScrapeResult.sourceNotes` so you can branch on it:

- **`Website blocked (status 403)` / `(status 503)`** — Cloudflare-style fingerprint block. Recoverable via a stealth/headless provider (e.g. Firecrawl). About 13% of sites in our measured runs.
- **`getaddrinfo ENOTFOUND`** — domain doesn't resolve. Permanent. No tool can recover.
- **`certificate has expired` / cert hostname mismatch** — sometimes recoverable via a proxying provider that doesn't enforce strict TLS.
- **`timeout of 10000ms exceeded`** — slow or dead site.
- **`Skipped non-HTML content-type: application/pdf`** (etc.) — server returned a binary; nothing to parse.

The scraper never throws on these — it returns `{ fetched: false, sourceNotes }` so a single bad URL doesn't kill a batch.

---

## Status

- [x] Phase A: utilities (logger, rate-limiter, url, name-parser)
- [x] Phase B: API clients (Apollo, Brave, scraper, LLM wrapper)
- [x] Phase C: AI gates parameterized
- [x] Phase D: Dedup core
- [x] Phase E: Notion helpers + standard schema + setup function
- [x] Phase F: Pipeline orchestrator
- [ ] **v0.1: first real project shipped on the library** — that's the next milestone

115 tests, 0 vulnerabilities. Run `npm test` to verify.

---

## License

MIT
