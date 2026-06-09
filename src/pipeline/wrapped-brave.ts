import { findLinkedInProfiles, searchSerp, type FounderName, type SerpCandidate } from "../brave/search.js";
import type { ExtractionsDb } from "../notion/extractions-db.js";
import type { CostTracker } from "./cost-tracker.js";

type Deps = {
  apiKey: string;
  costs: CostTracker;
  extractions?: ExtractionsDb;
  dryRun?: boolean;
};

/**
 * Brave Search wrapped for use inside `runEnrichment`.
 */
export class WrappedBrave {
  constructor(private readonly d: Deps) {}

  /** Best-effort audit log — a write failure must never abort enrichment
   *  (the Extractions schema can differ across backends). */
  private async audit(input: Parameters<ExtractionsDb["create"]>[0]): Promise<void> {
    if (!this.d.extractions) return;
    try {
      await this.d.extractions.create(input);
    } catch {
      /* audit best-effort */
    }
  }

  async findLinkedInProfiles(companyName: string, founders: FounderName[]): Promise<SerpCandidate[]> {
    if (this.d.dryRun) return [];
    const results = await findLinkedInProfiles(this.d.apiKey, companyName, founders);
    this.d.costs.recordBraveQuery();
    await this.audit({
      title: `Brave LinkedIn search: ${companyName}`,
      type: "person",
      source: "brave_serp",
      status: results.length > 0 ? "accepted" : "rejected",
      creditsUsed: 0,
      rawData: JSON.stringify(results).slice(0, 1500),
    });
    return results;
  }

  async searchSerp(query: string, options: { count?: number } = {}): Promise<Array<{ url: string; title: string; description: string }>> {
    if (this.d.dryRun) return [];
    const results = await searchSerp(this.d.apiKey, query, options);
    this.d.costs.recordBraveQuery();
    await this.audit({
      title: `Brave SERP: ${query}`,
      type: "company",
      source: "brave_serp",
      status: results.length > 0 ? "accepted" : "rejected",
      creditsUsed: 0,
      sourceQuery: query,
      rawData: JSON.stringify(results).slice(0, 1500),
    });
    return results;
  }
}
