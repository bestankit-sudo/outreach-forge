import type { LLMClient } from "../llm/client.js";
import type { ApolloPerson, ApolloSearchResult, ApolloOrgFromReveal } from "../apollo/client.js";
import { logger } from "../utils/logger.js";
import type {
  CandidateScore,
  Confidence,
  DataQualityResult,
  DisambiguationResult,
  MergeDecision,
  PreliminaryScore,
  RoleContext,
  ValidationResult,
} from "./types.js";

function isValidLinkedInUrl(url: string): boolean {
  if (!url) return false;
  return /linkedin\.com\/in\//i.test(url);
}

function extractJson<T>(text: string, kind: "object" | "array"): T | null {
  const pattern = kind === "object" ? /\{[\s\S]*\}/ : /\[[\s\S]*\]/;
  const match = text.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

// ─── 1. Preliminary Score (cheap pass over Apollo search metadata) ───

export async function scoreSearchCandidates(
  llm: LLMClient,
  candidates: ApolloSearchResult[],
  options: {
    targetCompanyName: string;
    role: RoleContext;
    maxReveals?: number;
  },
): Promise<PreliminaryScore[]> {
  if (candidates.length === 0) return [];

  const maxReveals = options.maxReveals ?? 2;
  const { targetCompanyName, role } = options;

  try {
    const text = await llm.chat(
      [
        {
          role: "user",
          content: `I searched Apollo for people at "${targetCompanyName}" — a ${role.entityType}.
We're looking for: ${role.targetRole}.${role.additionalContext ? `\nContext: ${role.additionalContext}` : ""}

Apollo returned these candidates (metadata only — revealing each costs 1 credit):

${candidates.map((c, i) => `${i + 1}. ID: ${c.id} | Name: ${c.first_name} | Title: ${c.title} | Org: ${c.organization_name}`).join("\n")}

Which candidates are worth paying to reveal? Pick at most ${maxReveals}. Consider:
- Does the org name match or relate to "${targetCompanyName}"?
- Is the title relevant to "${role.targetRole}"?
- Is the seniority appropriate?

Reply JSON ONLY — array of ALL candidates with the keys exactly as shown:
[{ "id": "<the id>", "worthRevealing": true/false, "reason": "one sentence" }]`,
        },
      ],
      { maxTokens: 600 },
    );

    const parsed = extractJson<PreliminaryScore[]>(text, "array");
    if (Array.isArray(parsed)) return parsed;
    throw new Error("No JSON array returned");
  } catch (error) {
    logger.warn(`[ai] scoreSearchCandidates failed: ${error instanceof Error ? error.message : "unknown"}`);
    return candidates.slice(0, maxReveals).map((c) => ({
      id: c.id,
      worthRevealing: true,
      reason: "AI scoring failed — revealing top candidates",
    }));
  }
}

// ─── 2. Validate person works at target company ───

export async function validatePersonAtCompany(
  llm: LLMClient,
  person: ApolloPerson,
  target: { companyName: string; domain: string; parentCompany?: string },
  context: RoleContext,
): Promise<ValidationResult> {
  if (!person.name && !person.first_name) {
    return { valid: false, reason: "No name returned by Apollo", entityMatch: "unrelated" };
  }
  if (person.linkedin_url && !isValidLinkedInUrl(person.linkedin_url)) {
    return { valid: false, reason: `Invalid LinkedIn URL: ${person.linkedin_url}`, entityMatch: "unrelated" };
  }

  const currentJobs = person.employment_history
    .filter((e) => e.current)
    .map((e) => `${e.title} at ${e.organization_name}`)
    .join("; ");

  try {
    const text = await llm.chat(
      [
        {
          role: "user",
          content: `Does this person currently work at the target ${context.entityType}?

Target company: "${target.companyName}" (domain: ${target.domain})${target.parentCompany ? `\nParent company: "${target.parentCompany}"` : ""}
Person: ${person.name} — ${person.title}
Current employer from Apollo: ${person.organization_name}
Employment history (current roles): ${currentJobs || "none listed"}
Email domain: ${person.email?.split("@")[1] || "unknown"}

Reply JSON ONLY:
{ "valid": true/false, "reason": "one sentence", "entityMatch": "exact/subsidiary/parent/unrelated" }
- exact: works at "${target.companyName}" directly
- subsidiary: works at a subsidiary or division
- parent: works at the parent company${target.parentCompany ? ` ("${target.parentCompany}")` : ""}
- unrelated: works at a completely different company
- valid=true for exact, subsidiary, or parent matches; valid=false for unrelated`,
        },
      ],
      { maxTokens: 250 },
    );

    const parsed = extractJson<{ valid: boolean; reason: string; entityMatch: string }>(text, "object");
    if (parsed) {
      return {
        valid: Boolean(parsed.valid),
        reason: String(parsed.reason ?? ""),
        entityMatch: (parsed.entityMatch ?? "unrelated") as ValidationResult["entityMatch"],
      };
    }
  } catch (error) {
    logger.warn(`[ai] validatePersonAtCompany failed: ${error instanceof Error ? error.message : "unknown"}`);
  }

  return { valid: true, reason: "AI validation inconclusive — allowing", entityMatch: "exact" };
}

// ─── 3. Score & rank revealed candidates ───

export async function scoreRevealedCandidates(
  llm: LLMClient,
  candidates: ApolloPerson[],
  options: {
    targetCompanyName: string;
    role: RoleContext;
    nameHints?: string[];
  },
): Promise<CandidateScore[]> {
  if (candidates.length === 0) return [];

  const { targetCompanyName, role, nameHints } = options;
  const hintStr = nameHints && nameHints.length > 0 ? nameHints.join(", ") : "unknown";

  const scoringInput = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    headline: c.headline,
    linkedin_url: c.linkedin_url,
    email: c.email,
    organization_name: c.organization_name,
    seniority: c.seniority,
    country: c.country,
    current_employer: c.employment_history
      .filter((e) => e.current)
      .map((e) => `${e.title} at ${e.organization_name}`)
      .join("; "),
  }));

  try {
    const text = await llm.chat(
      [
        {
          role: "user",
          content: `Score these Apollo results for outreach to "${targetCompanyName}" — a ${role.entityType}.
We're looking for: ${role.targetRole}.${role.additionalContext ? `\nContext: ${role.additionalContext}` : ""}
Expected name hints: ${hintStr}.

Scoring rules:
- HIGH: Person clearly matches "${role.targetRole}" at "${targetCompanyName}", has LinkedIn URL, and identity is unambiguous.
- MEDIUM: Person works at "${targetCompanyName}" in a relevant role, has LinkedIn URL.
- LOW: Weak match — no LinkedIn, ambiguous identity, or unclear connection to the company.

Candidates:
${JSON.stringify(scoringInput, null, 2)}

Reply JSON ONLY — one entry per candidate, ranked best first:
[{ "apolloPersonId": "<id>", "confidence": "high/medium/low", "evidenceSummary": "1-2 sentence reasoning", "rank": 1 }]`,
        },
      ],
      { maxTokens: 1500 },
    );

    const parsed = extractJson<CandidateScore[]>(text, "array");
    if (Array.isArray(parsed)) {
      return parsed.map((s, i) => ({
        apolloPersonId: String(s.apolloPersonId ?? ""),
        confidence: ((s.confidence ?? "low") as Confidence),
        evidenceSummary: String(s.evidenceSummary ?? ""),
        rank: typeof s.rank === "number" ? s.rank : i + 1,
      }));
    }
    throw new Error("No JSON array returned");
  } catch (error) {
    logger.warn(`[ai] scoreRevealedCandidates failed: ${error instanceof Error ? error.message : "unknown"}`);
    // Conservative fallback: rank by index, mark all "low"
    return candidates.map((c, i) => ({
      apolloPersonId: c.id,
      confidence: "low",
      evidenceSummary: "AI scoring failed — review manually",
      rank: i + 1,
    }));
  }
}

// ─── 4. Data quality gate ───

export async function validateDataQuality(
  llm: LLMClient,
  candidate: {
    name: string;
    linkedinUrl: string;
    email: string;
    title: string;
    headline?: string;
  },
): Promise<DataQualityResult> {
  // Cheap deterministic checks first — skip the LLM call when obvious
  const issues: string[] = [];
  if (!candidate.name.trim()) issues.push("Missing name");
  if (candidate.linkedinUrl && !isValidLinkedInUrl(candidate.linkedinUrl)) {
    issues.push(`Invalid LinkedIn URL: ${candidate.linkedinUrl}`);
  }
  if (issues.length > 0) {
    return { pass: false, issues };
  }

  try {
    const text = await llm.chat(
      [
        {
          role: "user",
          content: `Is this a real human professional with usable contact data?

Name: ${candidate.name}
Title: ${candidate.title}
Headline: ${candidate.headline || "(none)"}
LinkedIn: ${candidate.linkedinUrl || "(none)"}
Email: ${candidate.email || "(none)"}

Reject if:
- Name looks like a mascot, brand persona, or placeholder ("Acme Bot", "Brand Team", "Customer Service")
- Email is generic shared inbox (info@, support@, hello@) — those don't reach a person
- LinkedIn URL is missing AND no email is present
- Name is just a single word that's clearly not a person ("Admin", "Team", "Founders")

Reply JSON ONLY:
{ "pass": true/false, "issues": ["string", ...] }`,
        },
      ],
      { maxTokens: 200 },
    );

    const parsed = extractJson<{ pass: boolean; issues: string[] }>(text, "object");
    if (parsed) {
      return {
        pass: Boolean(parsed.pass),
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      };
    }
  } catch (error) {
    logger.warn(`[ai] validateDataQuality failed: ${error instanceof Error ? error.message : "unknown"}`);
  }

  return { pass: true, issues: [] };
}

// ─── 5. Entity disambiguation (same/subsidiary/parent/rebrand/different) ───

export async function disambiguateEntity(
  llm: LLMClient,
  expected: { name: string; domain: string; parentCompany?: string },
  apolloResult: { orgName: string; domain: string; description: string },
): Promise<DisambiguationResult> {
  if (!expected.domain || !apolloResult.domain) {
    return {
      match: "same",
      explanation: "Missing domain — assuming match",
      useDomain: apolloResult.domain || expected.domain,
    };
  }
  if (expected.domain === apolloResult.domain) {
    return { match: "same", explanation: "Domains match exactly", useDomain: expected.domain };
  }

  try {
    const text = await llm.chat(
      [
        {
          role: "user",
          content: `Are these the same company entity, or different?

Expected: "${expected.name}" (domain: ${expected.domain})${expected.parentCompany ? `\nParent company: "${expected.parentCompany}"` : ""}
Apollo found: "${apolloResult.orgName}" (domain: ${apolloResult.domain})
Apollo description: ${apolloResult.description || "none"}

Reply JSON ONLY:
{ "match": "same|subsidiary|parent|rebrand|different", "explanation": "one sentence", "useDomain": "<domain to use going forward>" }
- same: exact same company
- subsidiary: Apollo found a subsidiary or division of the expected company
- parent: Apollo found the parent company
- rebrand: same company under a new name/domain
- different: unrelated entity that happens to share a name`,
        },
      ],
      { maxTokens: 200 },
    );

    const parsed = extractJson<DisambiguationResult>(text, "object");
    if (parsed && parsed.match) {
      return {
        match: parsed.match,
        explanation: String(parsed.explanation ?? ""),
        useDomain: String(parsed.useDomain ?? expected.domain),
      };
    }
  } catch (error) {
    logger.warn(`[ai] disambiguateEntity failed: ${error instanceof Error ? error.message : "unknown"}`);
  }

  return { match: "same", explanation: "AI inconclusive — assuming match", useDomain: expected.domain };
}

// ─── 6. Decide merge: write / skip / merge with existing ───

export async function decideMerge(
  llm: LLMClient,
  options: {
    existing: Record<string, unknown>;
    incoming: Record<string, unknown>;
    role: RoleContext;
  },
): Promise<MergeDecision> {
  const { existing, incoming, role } = options;

  try {
    const text = await llm.chat(
      [
        {
          role: "user",
          content: `We already have a record for this ${role.entityType} candidate. New data just came in. Decide what to do.

Existing record:
${JSON.stringify(existing, null, 2)}

Incoming record:
${JSON.stringify(incoming, null, 2)}

Reply JSON ONLY:
{ "action": "write|skip|merge", "reason": "one sentence", "mergedFields": { "<field>": "<value>" } }
- write: incoming is materially better; replace existing
- skip: incoming is duplicate or weaker; keep existing as-is
- merge: cherry-pick best fields from both into mergedFields (only include fields you'd actually update)`,
        },
      ],
      { maxTokens: 400 },
    );

    const parsed = extractJson<MergeDecision>(text, "object");
    if (parsed && parsed.action) {
      return {
        action: parsed.action,
        reason: String(parsed.reason ?? ""),
        mergedFields: parsed.mergedFields && typeof parsed.mergedFields === "object" ? parsed.mergedFields : {},
      };
    }
  } catch (error) {
    logger.warn(`[ai] decideMerge failed: ${error instanceof Error ? error.message : "unknown"}`);
  }

  return { action: "skip", reason: "AI merge decision failed — keeping existing", mergedFields: {} };
}

// ─── 7. Generate outreach brief ───

export async function generateOutreachBrief(
  llm: LLMClient,
  options: {
    candidate: { name: string; title: string; headline: string; linkedinUrl: string };
    company: { name: string; domain: string; description: string };
    role: RoleContext;
  },
): Promise<string> {
  const { candidate, company, role } = options;

  try {
    const text = await llm.chat(
      [
        {
          role: "user",
          content: `Write a 1-2 sentence outreach talking point for reaching out to this person.

Person: ${candidate.name} — ${candidate.title} at ${company.name}
Headline: ${candidate.headline || "(none)"}
LinkedIn: ${candidate.linkedinUrl || "(none)"}

Company: ${company.name} (${company.domain})
Company description: ${company.description}

Context: We're approaching them as ${role.targetRole} at a ${role.entityType}.${role.additionalContext ? `\n${role.additionalContext}` : ""}

Output: 1-2 sentences, plain text only (no JSON). Direct and specific. Should give the sender a clear angle.`,
        },
      ],
      { maxTokens: 200, temperature: 0.3 },
    );
    return text.trim();
  } catch (error) {
    logger.warn(`[ai] generateOutreachBrief failed: ${error instanceof Error ? error.message : "unknown"}`);
    return "";
  }
}

// ─── 8. Generate company summary ───

export async function generateCompanySummary(
  llm: LLMClient,
  org: ApolloOrgFromReveal,
  context: RoleContext,
): Promise<string> {
  try {
    const text = await llm.chat(
      [
        {
          role: "user",
          content: `Write a 2-3 sentence summary of this ${context.entityType} for outreach prep.

Company: ${org.name}
Domain: ${org.primary_domain || org.website_url}
Industry: ${org.industry}
Description: ${org.short_description}
Employees: ${org.estimated_num_employees ?? "unknown"}
Founded: ${org.founded_year ?? "unknown"}
Funding: ${org.total_funding_printed} (${org.latest_funding_stage})
Location: ${[org.city, org.country].filter(Boolean).join(", ")}
Keywords: ${(org.keywords ?? []).slice(0, 8).join(", ")}

Context: ${context.additionalContext || `We're approaching them in the context of: ${context.targetRole}.`}

Output: 2-3 sentences, plain text. What does this company do, what's their stage, and what's relevant for outreach?`,
        },
      ],
      { maxTokens: 250, temperature: 0.3 },
    );
    return text.trim();
  } catch (error) {
    logger.warn(`[ai] generateCompanySummary failed: ${error instanceof Error ? error.message : "unknown"}`);
    return "";
  }
}
