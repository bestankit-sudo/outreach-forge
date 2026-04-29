import axios, { AxiosError } from "axios";
import { withExponentialBackoff } from "../utils/rate-limiter.js";
import { logger } from "../utils/logger.js";

// ─── Types ───

export type ApolloSearchResult = {
  id: string;
  first_name: string;
  title: string;
  organization_name: string;
  has_email: boolean;
};

export type ApolloPerson = {
  id: string;
  first_name: string;
  last_name: string;
  name: string;
  title: string;
  headline: string;
  linkedin_url: string;
  photo_url: string;
  twitter_url: string;
  email: string;
  email_status: string;
  city: string;
  country: string;
  seniority: string;
  organization_name: string;
  employment_history: ApolloEmployment[];
  organization: ApolloOrgFromReveal | null;
};

export type ApolloEmployment = {
  organization_name: string;
  title: string;
  current: boolean;
  start_date: string;
  end_date: string;
};

export type ApolloOrgFromReveal = {
  id: string;
  name: string;
  linkedin_url: string;
  primary_domain: string;
  website_url: string;
  short_description: string;
  industry: string;
  estimated_num_employees: number | null;
  founded_year: number | null;
  total_funding_printed: string;
  latest_funding_stage: string;
  phone: string;
  city: string;
  country: string;
  keywords: string[];
};

export type ApolloOrganisation = {
  id: string;
  name: string;
  domain: string;
  employee_count: number | null;
};

/**
 * Thin profile returned by Apollo's `mixed_companies/search` endpoint.
 *
 * IMPORTANT: this is the *search* response, not the *enrich* response. The
 * search endpoint is free but does NOT include `industry`, `employees`,
 * `city/state/country`, `short_description`, or `keywords`. Callers that need
 * those fields must call {@link enrichOrganisation} per result (1 credit each).
 *
 * Apollo guarantees the listed fields below; missing values come back as
 * empty strings or null rather than `undefined`.
 */
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
  alexa_ranking: number | null;
  organization_revenue_printed: string;
  organization_revenue: number | null;
  logo_url: string;
  crunchbase_url: string;
};

/**
 * Thrown when {@link searchOrganisationsList} or
 * {@link enrichOrganisation} is called with a value Apollo silently rejects
 * (e.g. industry names that aren't valid UUIDs). Use the `field` to identify
 * which input was bad.
 */
export class ApolloFilterError extends Error {
  constructor(
    public readonly field: string,
    public readonly invalidValues: string[],
    message?: string,
  ) {
    super(
      message ??
        `Apollo rejected values for "${field}" — got [${invalidValues.join(", ")}]; ` +
          `Apollo expects internal tag UUIDs for this field, not human-readable names. ` +
          `See https://apolloapi.com/docs (industry tags require lookup via Apollo support).`,
    );
    this.name = "ApolloFilterError";
  }
}

/** Apollo industry tag UUIDs are 24 lowercase hex chars (Mongo ObjectId-like). */
const APOLLO_TAG_UUID_RE = /^[a-f0-9]{24}$/;

export type SearchOrganisationsListParams = {
  /** Free-text keyword(s). Sent as `q_organization_keyword_tags` (array). */
  keyword: string | string[];
  /** ISO country names (e.g. "United States"). Sent as `organization_locations`. */
  countries?: string[];
  /** Optional founded-year minimum (inclusive). */
  foundedYearMin?: number;
  /**
   * Apollo internal industry tag UUIDs (24-char hex). Strings that don't
   * match the UUID shape will throw {@link ApolloFilterError} BEFORE the
   * request — Apollo otherwise silently zeroes the result with HTTP 200.
   *
   * To translate human industry names to UUIDs, contact Apollo support or
   * scrape the in-product picker. The lib does not maintain a mapping table
   * because Apollo rotates these.
   */
  industryTagIds?: string[];
  /** Default 100. Apollo caps at 100 per page. */
  perPage?: number;
  /** Default 5. Apollo's `mixed_companies/search` deep-pages cap at ~5. */
  maxPages?: number;
  /** Inter-page delay in ms; default 1000. Helps avoid 429s on long runs. */
  pacingMs?: number;
  /** Caller-provided escape hatch — merged into the request body verbatim. */
  rawOverrides?: Record<string, unknown>;
};

export type PeopleSearchParams = {
  domain?: string;
  orgId?: string;
  organizationName?: string;
  personName?: string;
  personTitles?: string[];
  personSeniorities?: string[];
  personLocations?: string[];
  keywords?: string[];
  perPage?: number;
};

// ─── Domain Blocklist ───

const APOLLO_BASE = "https://api.apollo.io";

/**
 * Domains that should never be passed as a brand domain to Apollo —
 * social, crowdfunding, marketplaces, retailers, generic SaaS hosts.
 *
 * Exported so consumers can extend (e.g., add industry-specific
 * marketplaces) without forking. Use `isBlockedDomain` for matching.
 */
export const BLOCKED_DOMAINS = new Set([
  // social / video / messaging
  "facebook.com", "meta.com", "google.com", "apple.com",
  "twitter.com", "x.com", "instagram.com", "tiktok.com", "youtube.com",
  "linkedin.com",
  // crowdfunding
  "indiegogo.com", "igg.me", "kickstarter.com", "backerkit.com", "gofundme.com",
  // SaaS / hosting that often appears as a "site"
  "shopify.com", "wordpress.com", "wix.com", "squarespace.com",
  // marketplaces — global
  "amazon.com", "amazon.co.uk", "amazon.de", "ebay.com", "etsy.com",
  "alibaba.com", "1688.com", "made-in-china.com", "aliexpress.com",
  "taobao.com", "tmall.com", "jd.com",
  // retailers / grocery — North America
  "target.com", "walmart.com", "costco.com", "kroger.com", "instacart.com",
  "thrivemarket.com", "iherb.com", "wholefoodsmarket.com", "wholefoods.com",
  // retailers / grocery — UK
  "tesco.com", "sainsburys.co.uk", "asda.com", "morrisons.com",
  "ocado.com", "waitrose.com",
]);

export function isBlockedDomain(domain: string): boolean {
  if (!domain) return true;
  const cleaned = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  if (BLOCKED_DOMAINS.has(cleaned)) return true;
  for (const blocked of BLOCKED_DOMAINS) {
    if (cleaned.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

const shouldRetry = (error: unknown): boolean => {
  const axiosError = error as AxiosError;
  const status = axiosError.response?.status;
  if (status === 429) return true;
  return typeof status === "number" && status >= 500;
};

// ─── Search (FREE — returns metadata only, no reveal) ───

export async function searchPeopleMetadata(
  apiKey: string,
  params: PeopleSearchParams,
): Promise<ApolloSearchResult[]> {
  const body: Record<string, unknown> = {
    per_page: params.perPage ?? 5,
  };

  if (params.domain && !isBlockedDomain(params.domain)) {
    body.q_organization_domains = params.domain;
  }
  if (params.orgId) {
    body.organization_ids = [params.orgId];
  }
  if (params.organizationName) {
    body.q_organization_name = params.organizationName;
  }
  if (params.personName) {
    body.q_person_name = params.personName;
  }
  if (params.personTitles && params.personTitles.length > 0) {
    body.person_titles = params.personTitles;
  }
  if (params.personSeniorities && params.personSeniorities.length > 0) {
    body.person_seniorities = params.personSeniorities;
  }
  if (params.personLocations && params.personLocations.length > 0) {
    body.person_locations = params.personLocations;
  }
  if (params.keywords && params.keywords.length > 0) {
    body.q_keywords = params.keywords.join(" ");
  }

  try {
    const response = await withExponentialBackoff(
      () =>
        axios.post(`${APOLLO_BASE}/api/v1/mixed_people/api_search`, body, {
          headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
          timeout: 15_000,
        }),
      { retries: 3, initialDelayMs: 2000, maxDelayMs: 30_000, shouldRetry },
    );

    const people = (response.data?.people ?? []) as Array<Record<string, unknown>>;

    return people.map((p) => ({
      id: String(p.id ?? ""),
      first_name: String(p.first_name ?? ""),
      title: String(p.title ?? ""),
      organization_name: String((p.organization as Record<string, unknown>)?.name ?? ""),
      has_email: Boolean((p as Record<string, unknown>).has_email),
    }));
  } catch (error) {
    const axiosError = error as AxiosError;
    const responseData = axiosError.response?.data as Record<string, unknown> | undefined;
    logger.error(`[apollo] Search failed (${axiosError.response?.status ?? "unknown"}): ${responseData?.error ?? axiosError.message}`);
    return [];
  }
}

// ─── Reveal (PAID — 1 credit per person) ───

export async function revealByLinkedIn(
  apiKey: string,
  linkedinUrl: string,
): Promise<ApolloPerson | null> {
  try {
    const response = await withExponentialBackoff(
      () =>
        axios.post(
          `${APOLLO_BASE}/api/v1/people/match`,
          { linkedin_url: linkedinUrl, reveal_personal_emails: false },
          {
            headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
            timeout: 15_000,
          },
        ),
      { retries: 2, initialDelayMs: 1000, maxDelayMs: 10_000, shouldRetry },
    );

    const p = response.data?.person as Record<string, unknown> | undefined;
    if (!p?.id) return null;

    return parseRevealedPerson(p);
  } catch (error) {
    const axiosError = error as AxiosError;
    logger.warn(`[apollo] Reveal by LinkedIn failed for ${linkedinUrl}: ${axiosError.message} (${axiosError.response?.status ?? "unknown"})`);
    return null;
  }
}

export async function revealPerson(
  apiKey: string,
  personId: string,
): Promise<ApolloPerson | null> {
  try {
    const response = await withExponentialBackoff(
      () =>
        axios.post(
          `${APOLLO_BASE}/api/v1/people/match`,
          { id: personId, reveal_personal_emails: false },
          {
            headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
            timeout: 15_000,
          },
        ),
      { retries: 2, initialDelayMs: 1000, maxDelayMs: 10_000, shouldRetry },
    );

    const p = response.data?.person as Record<string, unknown> | undefined;
    if (!p?.id) return null;

    return parseRevealedPerson(p);
  } catch (error) {
    const axiosError = error as AxiosError;
    logger.warn(`[apollo] Reveal failed for ${personId}: ${axiosError.message} (${axiosError.response?.status ?? "unknown"})`);
    return null;
  }
}

// ─── Org Enrichment (PAID — 1 credit) ───

export async function searchOrganisation(
  apiKey: string,
  params: { domain?: string; name?: string },
): Promise<ApolloOrganisation | null> {
  const body: Record<string, unknown> = {};
  if (params.domain) body.domain = params.domain;
  if (params.name) body.name = params.name;

  try {
    const response = await withExponentialBackoff(
      () =>
        axios.post(`${APOLLO_BASE}/api/v1/organizations/enrich`, body, {
          headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
          timeout: 15_000,
        }),
      { retries: 3, initialDelayMs: 2000, maxDelayMs: 30_000, shouldRetry },
    );

    const org = response.data?.organization as Record<string, unknown> | undefined;
    if (!org?.id) return null;

    return {
      id: String(org.id),
      name: String(org.name ?? ""),
      domain: String(org.primary_domain ?? org.domain ?? ""),
      employee_count: typeof org.estimated_num_employees === "number" ? org.estimated_num_employees : null,
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    logger.error(`[apollo] Org search failed: ${axiosError.message} (status ${axiosError.response?.status ?? "unknown"})`);
    return null;
  }
}

export async function enrichOrganisation(
  apiKey: string,
  params: { domain?: string; name?: string },
): Promise<ApolloOrgFromReveal | null> {
  const body: Record<string, unknown> = {};
  if (params.domain) body.domain = params.domain;
  if (params.name) body.name = params.name;

  try {
    const response = await withExponentialBackoff(
      () =>
        axios.post(`${APOLLO_BASE}/api/v1/organizations/enrich`, body, {
          headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
          timeout: 15_000,
        }),
      { retries: 3, initialDelayMs: 2000, maxDelayMs: 30_000, shouldRetry },
    );

    const org = response.data?.organization as Record<string, unknown> | undefined;
    if (!org?.id) return null;

    return parseOrgFromReveal(org);
  } catch (error) {
    const axiosError = error as AxiosError;
    logger.error(`[apollo] Org enrich failed: ${axiosError.message} (status ${axiosError.response?.status ?? "unknown"})`);
    return null;
  }
}

// ─── List Search (FREE — paginated, returns thin org profiles) ───

/**
 * Paginated organisation list-search via `POST /api/v1/mixed_companies/search`.
 *
 * No credit cost. Returns thin profiles only — see {@link ApolloOrgListResult}
 * for the exact fields. Callers that need `industry`, `employees`, `city`,
 * etc. must call {@link enrichOrganisation} per row (1 credit each).
 *
 * Apollo's deep-paging caps at ~5 pages × 100 results = 500 organisations per
 * query. To exceed that, stitch together multiple narrower keyword searches.
 *
 * Industry filtering: Apollo's `organization_industries` request param
 * requires internal tag UUIDs, not human-readable names. Passing string names
 * silently zeroes the result with HTTP 200 — a high-likelihood footgun. This
 * function rejects non-UUID values via {@link ApolloFilterError} BEFORE the
 * request is made.
 */
export async function searchOrganisationsList(
  apiKey: string,
  params: SearchOrganisationsListParams,
): Promise<ApolloOrgListResult[]> {
  if (params.industryTagIds && params.industryTagIds.length > 0) {
    const invalid = params.industryTagIds.filter((t) => !APOLLO_TAG_UUID_RE.test(t));
    if (invalid.length > 0) {
      throw new ApolloFilterError("organization_industries", invalid);
    }
  }

  const perPage = Math.min(Math.max(params.perPage ?? 100, 1), 100);
  const maxPages = Math.max(params.maxPages ?? 5, 1);
  const pacingMs = params.pacingMs ?? 1000;
  const keywords = Array.isArray(params.keyword) ? params.keyword : [params.keyword];

  const baseBody: Record<string, unknown> = {
    q_organization_keyword_tags: keywords,
    per_page: perPage,
  };
  if (params.countries && params.countries.length > 0) {
    baseBody.organization_locations = params.countries;
  }
  if (typeof params.foundedYearMin === "number") {
    baseBody.organization_founded_year_min = params.foundedYearMin;
  }
  if (params.industryTagIds && params.industryTagIds.length > 0) {
    baseBody.organization_industries = params.industryTagIds;
  }
  if (params.rawOverrides) {
    Object.assign(baseBody, params.rawOverrides);
  }

  const collected: ApolloOrgListResult[] = [];
  const seenIds = new Set<string>();

  for (let page = 1; page <= maxPages; page += 1) {
    try {
      const response = await withExponentialBackoff(
        () =>
          axios.post(
            `${APOLLO_BASE}/api/v1/mixed_companies/search`,
            { ...baseBody, page },
            {
              headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
              timeout: 20_000,
            },
          ),
        { retries: 3, initialDelayMs: 2000, maxDelayMs: 30_000, shouldRetry },
      );

      const orgs = (response.data?.organizations ?? response.data?.accounts ?? []) as Array<Record<string, unknown>>;
      if (orgs.length === 0) break;

      for (const o of orgs) {
        const parsed = parseOrgListResult(o);
        if (parsed && !seenIds.has(parsed.id)) {
          seenIds.add(parsed.id);
          collected.push(parsed);
        }
      }

      // Apollo's `pagination.total_pages` is unreliable on deep queries — we
      // rely on the empty-page sentinel above and the `maxPages` cap.
      if (orgs.length < perPage) break;

      if (page < maxPages) {
        await new Promise((resolve) => setTimeout(resolve, pacingMs));
      }
    } catch (error) {
      const axiosError = error as AxiosError;
      const responseData = axiosError.response?.data as Record<string, unknown> | undefined;
      logger.error(
        `[apollo] list-search page ${page} failed (${axiosError.response?.status ?? "unknown"}): ` +
          `${responseData?.error ?? axiosError.message}`,
      );
      break;
    }
  }

  return collected;
}

// ─── Parsers ───

function parseOrgListResult(raw: Record<string, unknown>): ApolloOrgListResult | null {
  if (!raw?.id) return null;
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    website_url: String(raw.website_url ?? ""),
    primary_domain: String(raw.primary_domain ?? ""),
    founded_year: typeof raw.founded_year === "number" ? raw.founded_year : null,
    linkedin_url: String(raw.linkedin_url ?? ""),
    twitter_url: String(raw.twitter_url ?? ""),
    facebook_url: String(raw.facebook_url ?? ""),
    phone: String(raw.phone ?? raw.primary_phone ?? ""),
    alexa_ranking: typeof raw.alexa_ranking === "number" ? raw.alexa_ranking : null,
    organization_revenue_printed: String(raw.organization_revenue_printed ?? ""),
    organization_revenue: typeof raw.organization_revenue === "number" ? raw.organization_revenue : null,
    logo_url: String(raw.logo_url ?? ""),
    crunchbase_url: String(raw.crunchbase_url ?? ""),
  };
}

function parseOrgFromReveal(raw: Record<string, unknown> | undefined): ApolloOrgFromReveal | null {
  if (!raw?.id) return null;
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    linkedin_url: String(raw.linkedin_url ?? ""),
    primary_domain: String(raw.primary_domain ?? ""),
    website_url: String(raw.website_url ?? ""),
    short_description: String(raw.short_description ?? ""),
    industry: Array.isArray(raw.industries) && raw.industries.length > 0 ? String(raw.industries[0]) : String(raw.industry ?? ""),
    estimated_num_employees: typeof raw.estimated_num_employees === "number" ? raw.estimated_num_employees : null,
    founded_year: typeof raw.founded_year === "number" ? raw.founded_year : null,
    total_funding_printed: String(raw.total_funding_printed ?? ""),
    latest_funding_stage: String(raw.latest_funding_stage ?? ""),
    phone: String(raw.phone ?? ""),
    city: String(raw.city ?? ""),
    country: String(raw.country ?? ""),
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String).slice(0, 20) : [],
  };
}

function parseRevealedPerson(p: Record<string, unknown>): ApolloPerson {
  return {
    id: String(p.id ?? ""),
    first_name: String(p.first_name ?? ""),
    last_name: String(p.last_name ?? ""),
    name: String(p.name ?? ""),
    title: String(p.title ?? ""),
    headline: String(p.headline ?? ""),
    linkedin_url: String(p.linkedin_url ?? ""),
    photo_url: String(p.photo_url ?? ""),
    twitter_url: String(p.twitter_url ?? ""),
    email: String(p.email ?? ""),
    email_status: String(p.email_status ?? ""),
    city: String(p.city ?? ""),
    country: String(p.country ?? ""),
    seniority: String(p.seniority ?? ""),
    organization_name: (p.organization as Record<string, unknown>)?.name
      ? String((p.organization as Record<string, unknown>).name) : "",
    employment_history: parseEmploymentHistory(p.employment_history),
    organization: parseOrgFromReveal(p.organization as Record<string, unknown> | undefined),
  };
}

function parseEmploymentHistory(raw: unknown): ApolloEmployment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: Record<string, unknown>) => ({
    organization_name: String(e.organization_name ?? ""),
    title: String(e.title ?? ""),
    current: Boolean(e.current),
    start_date: String(e.start_date ?? ""),
    end_date: String(e.end_date ?? ""),
  }));
}
