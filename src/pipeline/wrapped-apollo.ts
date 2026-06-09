import {
  searchPeopleMetadata,
  revealPerson,
  revealByLinkedIn,
  searchOrganisation,
  enrichOrganisation,
  searchOrganisationsList,
  type ApolloOrganisation,
  type ApolloOrgFromReveal,
  type ApolloOrgListResult,
  type ApolloPerson,
  type ApolloSearchResult,
  type PeopleSearchParams,
  type SearchOrganisationsListParams,
} from "../apollo/client.js";
import type { ExtractionsDb } from "../notion/extractions-db.js";
import type { CostTracker } from "./cost-tracker.js";

type Deps = {
  apiKey: string;
  costs: CostTracker;
  extractions?: ExtractionsDb;
  dryRun?: boolean;
};

/**
 * Apollo client wrapped for use inside `runEnrichment`. Automatically:
 *  - Skips real calls in dry-run
 *  - Tracks Apollo credits used
 *  - Logs each call to the Extractions audit log (if provided)
 *  - Enforces the hard credit cap
 */
export class WrappedApollo {
  constructor(private readonly d: Deps) {}

  /** Best-effort audit log. The Extractions schema can differ across backends
   *  (e.g. the legacy vs. new per-country DB); audit is non-essential, so a
   *  write failure must never abort the enrichment item. */
  private async audit(input: Parameters<ExtractionsDb["create"]>[0]): Promise<void> {
    if (!this.d.extractions) return;
    try {
      await this.d.extractions.create(input);
    } catch {
      /* audit best-effort */
    }
  }

  async searchPeople(params: PeopleSearchParams): Promise<ApolloSearchResult[]> {
    if (this.d.dryRun) return [];
    const results = await searchPeopleMetadata(this.d.apiKey, params);
    await this.audit({
      title: `Apollo search: ${params.domain ?? params.organizationName ?? params.personName ?? "?"}`,
      type: "person",
      source: "apollo_search",
      status: "raw",
      creditsUsed: 0,
      rawData: JSON.stringify({ params, count: results.length }),
    });
    return results;
  }

  async revealPerson(personId: string): Promise<ApolloPerson | null> {
    if (this.d.dryRun) return null;
    this.d.costs.assertCanSpendApollo(1);
    const person = await revealPerson(this.d.apiKey, personId);
    if (person) this.d.costs.recordApolloCredit(1, "people/match (id)");
    await this.audit({
      title: `Apollo reveal: ${person?.name ?? personId}`,
      type: "person",
      source: "apollo_reveal",
      status: person ? "accepted" : "rejected",
      creditsUsed: person ? 1 : 0,
      rawData: person ? JSON.stringify(person).slice(0, 1500) : "no match",
    });
    return person;
  }

  async revealByLinkedIn(linkedinUrl: string): Promise<ApolloPerson | null> {
    if (this.d.dryRun) return null;
    this.d.costs.assertCanSpendApollo(1);
    const person = await revealByLinkedIn(this.d.apiKey, linkedinUrl);
    if (person) this.d.costs.recordApolloCredit(1, "people/match (linkedin)");
    await this.audit({
      title: `Apollo reveal by LinkedIn: ${linkedinUrl}`,
      type: "person",
      source: "apollo_reveal",
      status: person ? "accepted" : "rejected",
      creditsUsed: person ? 1 : 0,
      rawData: person ? JSON.stringify(person).slice(0, 1500) : "no match",
    });
    return person;
  }

  async searchOrganisation(params: { domain?: string; name?: string }): Promise<ApolloOrganisation | null> {
    if (this.d.dryRun) return null;
    this.d.costs.assertCanSpendApollo(1);
    const org = await searchOrganisation(this.d.apiKey, params);
    if (org) this.d.costs.recordApolloCredit(1, "organizations/enrich (search)");
    await this.audit({
      title: `Apollo org search: ${params.domain ?? params.name ?? "?"}`,
      type: "company",
      source: "apollo_org",
      status: org ? "accepted" : "rejected",
      creditsUsed: org ? 1 : 0,
      rawData: org ? JSON.stringify(org) : "no match",
    });
    return org;
  }

  /**
   * Free, paginated list-search via Apollo's `mixed_companies/search`.
   * No credit cost (so {@link CostTracker} is not touched), but the call
   * is logged to the Extractions audit log if one is configured.
   *
   * Returns an empty array in dry-run.
   */
  async searchOrganisationsList(params: SearchOrganisationsListParams): Promise<ApolloOrgListResult[]> {
    if (this.d.dryRun) return [];
    const results = await searchOrganisationsList(this.d.apiKey, params);
    const keywords = Array.isArray(params.keyword) ? params.keyword.join(", ") : params.keyword;
    await this.audit({
      title: `Apollo list-search: ${keywords}`,
      type: "company",
      source: "apollo_search",
      status: "raw",
      creditsUsed: 0,
      sourceQuery: keywords,
      rawData: JSON.stringify({
        countries: params.countries ?? [],
        foundedYearMin: params.foundedYearMin ?? null,
        industryTagIds: params.industryTagIds ?? [],
        count: results.length,
      }),
    });
    return results;
  }

  async enrichOrganisation(params: { domain?: string; name?: string }): Promise<ApolloOrgFromReveal | null> {
    if (this.d.dryRun) return null;
    this.d.costs.assertCanSpendApollo(1);
    const org = await enrichOrganisation(this.d.apiKey, params);
    if (org) this.d.costs.recordApolloCredit(1, "organizations/enrich (full)");
    await this.audit({
      title: `Apollo org enrich: ${params.domain ?? params.name ?? "?"}`,
      type: "company",
      source: "apollo_org",
      status: org ? "accepted" : "rejected",
      creditsUsed: org ? 1 : 0,
      rawData: org ? JSON.stringify(org).slice(0, 1500) : "no match",
    });
    return org;
  }
}
