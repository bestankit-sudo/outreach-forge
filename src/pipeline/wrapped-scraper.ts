import { scrapeWebsite, type WebsiteScrapeResult } from "../scraper/website.js";
import type { ExtractionsDb } from "../notion/extractions-db.js";

type Deps = {
  extractions?: ExtractionsDb;
  dryRun?: boolean;
};

/**
 * Website scraper wrapped for use inside `runEnrichment`.
 * Auto-logs each scrape attempt. Returns an empty result in dry-run.
 */
export class WrappedScraper {
  constructor(private readonly d: Deps) {}

  async scrape(url: string): Promise<WebsiteScrapeResult> {
    if (this.d.dryRun) {
      return {
        fetched: false,
        sourceNotes: "(dry run — skipped)",
        socials: { linkedin: null, x: null, instagram: null, facebook: null, youtube: null, tiktok: null },
        businessEmail: null,
        contactFormUrl: null,
      };
    }

    const result = await scrapeWebsite(url);

    if (this.d.extractions) {
      await this.d.extractions.create({
        title: `Website scrape: ${url}`,
        type: "company",
        source: "website_scrape",
        status: result.fetched ? "accepted" : "rejected",
        creditsUsed: 0,
        sourceNotes: result.sourceNotes,
        rawData: JSON.stringify({
          fetched: result.fetched,
          socials: result.socials,
          businessEmail: result.businessEmail,
          contactFormUrl: result.contactFormUrl,
        }),
      });
    }

    return result;
  }
}
