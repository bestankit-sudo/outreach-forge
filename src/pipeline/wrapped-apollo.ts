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

  async searchPeople(params: PeopleSearchParams): Promise<ApolloSearchResult[]> {
    if (this.d.dryRun) return [];
    const results = await searchPeopleMetadata(this.d.apiKey, params);
    if (this.d.extractions) {
      await this.d.extractions.create({
        title: `Apollo search: ${params.domain ?? params.organizationName ?? params.personName ?? "?"}`,
        type: "person",
        source: "apollo_search",
        status: "raw",
        creditsUsed: 0,
        rawData: JSON.stringify({ params, count: results.length }),
      });
    }
    return results;
  }

  async revealPerson(personId: string): Promise<ApolloPerson | null> {
    if (this.d.dryRun) return null;
    this.d.costs.assertCanSpendApollo(1);
    const person = await revealPerson(this.d.apiKey, personId);
    if (person) this.d.costs.recordApolloCredit(1, "people/match (id)");
    if (this.d.extractions) {
      await this.d.extractions.create({
        title: `Apollo reveal: ${person?.name ?? personId}`,
        type: "person",
        source: "apollo_reveal",
        status: person ? "accepted" : "rejected",
        creditsUsed: person ? 1 : 0,
        rawData: person ? JSON.stringify(person).slice(0, 1500) : "no match",
      });
    }
    return person;
  }

  async revealByLinkedIn(linkedinUrl: string): Promise<ApolloPerson | null> {
    if (this.d.dryRun) return null;
    this.d.costs.assertCanSpendApollo(1);
    const person = await revealByLinkedIn(this.d.apiKey, linkedinUrl);
    if (person) this.d.costs.recordApolloCredit(1, "people/match (linkedin)");
    if (this.d.extractions) {
      await this.d.extractions.create({
        title: `Apollo reveal by LinkedIn: ${linkedinUrl}`,
        type: "person",
        source: "apollo_reveal",
        status: person ? "accepted" : "rejected",
        creditsUsed: person ? 1 : 0,
        rawData: person ? JSON.stringify(person).slice(0, 1500) : "no match",
      });
    }
    return person;
  }

  async searchOrganisation(params: { domain?: string; name?: string }): Promise<ApolloOrganisation | null> {
    if (this.d.dryRun) return null;
    this.d.costs.assertCanSpendApollo(1);
    const org = await searchOrganisation(this.d.apiKey, params);
    if (org) this.d.costs.recordApolloCredit(1, "organizations/enrich (search)");
    if (this.d.extractions) {
      await this.d.extractions.create({
        title: `Apollo org search: ${params.domain ?? params.name ?? "?"}`,
        type: "company",
        source: "apollo_org",
        status: org ? "accepted" : "rejected",
        creditsUsed: org ? 1 : 0,
        rawData: org ? JSON.stringify(org) : "no match",
      });
    }
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
    if (this.d.extractions) {
      const keywords = Array.isArray(params.keyword) ? params.keyword.join(", ") : params.keyword;
      await this.d.extractions.create({
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
    }
    return results;
  }

  async enrichOrganisation(params: { domain?: string; name?: string }): Promise<ApolloOrgFromReveal | null> {
    if (this.d.dryRun) return null;
    this.d.costs.assertCanSpendApollo(1);
    const org = await enrichOrganisation(this.d.apiKey, params);
    if (org) this.d.costs.recordApolloCredit(1, "organizations/enrich (full)");
    if (this.d.extractions) {
      await this.d.extractions.create({
        title: `Apollo org enrich: ${params.domain ?? params.name ?? "?"}`,
        type: "company",
        source: "apollo_org",
        status: org ? "accepted" : "rejected",
        creditsUsed: org ? 1 : 0,
        rawData: org ? JSON.stringify(org).slice(0, 1500) : "no match",
      });
    }
    return org;
  }
}
