/**
 * Domain types — what the enrichment pipeline produces. Storage-agnostic.
 * Notion is the v0.1 destination, but these shapes don't depend on Notion.
 */

export type EnrichmentStatus = "pending" | "done" | "partial" | "failed" | "needs_review";
export type EnrichmentConfidence = "high" | "medium" | "low";
/** @deprecated Use {@link EnrichmentConfidence}. Kept as an alias for type-only consumers. */
export type MatchConfidence = EnrichmentConfidence;
export type DiscoveryMethod = "apollo" | "serp_fallback" | "manual";
export type CompanyOutreachReadiness = "pending" | "ready_person" | "ready_form" | "ready_email" | "blocked";

export type CompanySocials = {
  linkedin: string | null;
  x: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  tiktok: string | null;
};

export type CompanyEnrichment = {
  name: string;
  domain: string;
  description: string;
  industry: string;
  employeeCount: number | null;
  foundedYear: number | null;
  totalFunding: string;
  fundingStage: string;
  socials: CompanySocials;
  genericBusinessEmail: string | null;
  contactFormUrl: string | null;
  phone: string;
  country: string;
  hqCity: string;
  apolloOrgId: string;
  bestOutreachPath: string;
  outreachReadiness: CompanyOutreachReadiness;
  status: EnrichmentStatus;
  enrichmentConfidence: EnrichmentConfidence;
  sourceNotes: string;
  lastCheckedAt: string;
};

export type PersonEnrichment = {
  fullName: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  headline: string;
  linkedinUrl: string;
  apolloPersonId: string;
  workEmails: string;
  emailStatus: string;
  city: string;
  country: string;
  discoveryMethod: DiscoveryMethod;
  enrichmentConfidence: EnrichmentConfidence;
  evidenceSummary: string;
  matchNotes: string;
  candidateRank: number | null;
  isPrimaryCandidate: boolean;
  status: EnrichmentStatus;
  lastEnrichedAt: string;
};

export type ExtractionType = "company" | "person";

export type ExtractionSource =
  | "apollo_search"
  | "apollo_reveal"
  | "apollo_org"
  | "website_scrape"
  | "brave_serp"
  | "manual"
  | "chinese_media";

export type ExtractionStatus = "raw" | "accepted" | "rejected" | "merged";

export type Extraction = {
  title: string;
  type: ExtractionType;
  source: ExtractionSource;
  status: ExtractionStatus;
  creditsUsed: number;
  rawData?: string;
  sourceQuery?: string;
  sourceNotes?: string;
  aiValidation?: string;
  companyPageId?: string;
  personPageId?: string;
};
