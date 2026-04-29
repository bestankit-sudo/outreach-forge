import type { ApolloOrgFromReveal } from "../apollo/client.js";
import type { EntityMatch } from "../ai/types.js";
import { normalizeDomain } from "../utils/normalize.js";
import type { EnrichmentConfidence } from "./types.js";

/**
 * Map a person-level entity-match verdict to an `Enrichment Confidence` value.
 *
 * Ships in the lib so every consumer doesn't reinvent the same exact/
 * subsidiary/parent/unrelated → high/medium/low mapping when persisting to
 * the People DB. Mirrors {@link confidenceFromEntityMatch} from `ai/gates`
 * but lives here so consumers don't have to import from `ai/` for a
 * Notion-flavoured concern.
 */
export function personEnrichmentConfidence(verdict: { entityMatch: EntityMatch }): EnrichmentConfidence {
  return verdict.entityMatch === "exact"
    ? "high"
    : verdict.entityMatch === "unrelated"
      ? "low"
      : "medium";
}

/**
 * Compute Companies-DB `Enrichment Confidence` from an Apollo enrich result
 * plus the inputs used to look it up.
 *
 * Rules:
 * - `null` Apollo result → `low` (we have nothing to corroborate)
 * - Apollo's `primary_domain` matches the requested domain → `high`
 * - Apollo name fuzzy-matches the requested name (case-insensitive substring) → `medium`
 *   (treats subsidiary/parent/rebrand as medium, since we can't tell from this signal alone)
 * - Otherwise → `medium` (we have data, but it's unverified against the input)
 *
 * Domain comparison uses {@link normalizeDomain} to handle protocol/`www.`
 * differences. Pass either the requested domain, the requested name, or both.
 */
export function companyEnrichmentConfidence(args: {
  apolloOrg: ApolloOrgFromReveal | null;
  requestedDomain?: string;
  requestedName?: string;
}): EnrichmentConfidence {
  const { apolloOrg, requestedDomain, requestedName } = args;
  if (!apolloOrg) return "low";
  if (requestedDomain) {
    const requested = normalizeDomain(requestedDomain);
    const apolloDomain = normalizeDomain(apolloOrg.primary_domain);
    if (requested && apolloDomain && requested === apolloDomain) return "high";
  }
  if (requestedName && apolloOrg.name) {
    const a = apolloOrg.name.toLowerCase();
    const b = requestedName.toLowerCase();
    if (a.includes(b) || b.includes(a)) return "medium";
  }
  return "medium";
}
