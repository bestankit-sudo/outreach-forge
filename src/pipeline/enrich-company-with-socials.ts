import type { ApolloOrgFromReveal } from "../apollo/client.js";
import { logger } from "../utils/logger.js";
import { normalizeDomain } from "../utils/normalize.js";
import type { WrappedApollo } from "./wrapped-apollo.js";
import type { WrappedScraper } from "./wrapped-scraper.js";

export type CompanyEnrichmentWithSocials = ApolloOrgFromReveal & {
  socials: {
    linkedin: string | null;
    x: string | null;
    instagram: string | null;
    facebook: string | null;
    youtube: string | null;
    tiktok: string | null;
  };
  businessEmail: string | null;
  contactFormUrl: string | null;
  scrapeFailed: boolean;
  scrapeFailureReason?: string;
};

/**
 * Apollo `organizations/enrich` + homepage scrape, merged into one combined
 * result. Replaces the easy-to-get-wrong pattern of calling Apollo, then
 * scraping the website, then forgetting to merge the scrape's socials/email
 * back into the persisted record.
 *
 * Behaviour:
 * - Calls {@link WrappedApollo.enrichOrganisation} (1 credit). If Apollo
 *   returns null, this function returns null.
 * - Scrapes Apollo's `website_url` (or, falling back, a sanitised `domain`).
 *   If the scrape fails, returns Apollo data with `scrapeFailed: true` and
 *   empty socials — the Apollo data is still useful on its own.
 * - Always returns a value when Apollo succeeds, even if scraping didn't.
 */
export async function enrichCompanyWithSocials(
  apollo: WrappedApollo,
  scraper: WrappedScraper,
  params: { domain?: string; name?: string },
): Promise<CompanyEnrichmentWithSocials | null> {
  const apolloOrg = await apollo.enrichOrganisation(params);
  if (!apolloOrg) return null;

  const scrapeUrl =
    apolloOrg.website_url ||
    (apolloOrg.primary_domain ? `https://${apolloOrg.primary_domain}` : "") ||
    (params.domain ? `https://${normalizeDomain(params.domain)}` : "");

  const emptySocials = {
    linkedin: null,
    x: null,
    instagram: null,
    facebook: null,
    youtube: null,
    tiktok: null,
  };

  if (!scrapeUrl) {
    logger.warn(`[enrichCompanyWithSocials] no scrapeable URL for "${apolloOrg.name}"`);
    return {
      ...apolloOrg,
      socials: emptySocials,
      businessEmail: null,
      contactFormUrl: null,
      scrapeFailed: true,
      scrapeFailureReason: "no resolvable URL",
    };
  }

  const scrape = await scraper.scrape(scrapeUrl);

  if (!scrape.fetched) {
    return {
      ...apolloOrg,
      socials: emptySocials,
      businessEmail: null,
      contactFormUrl: null,
      scrapeFailed: true,
      scrapeFailureReason: scrape.sourceNotes || "scrape returned no content",
    };
  }

  return {
    ...apolloOrg,
    socials: scrape.socials,
    businessEmail: scrape.businessEmail,
    contactFormUrl: scrape.contactFormUrl,
    scrapeFailed: false,
  };
}
