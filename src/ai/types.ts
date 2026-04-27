export type Confidence = "high" | "medium" | "low";

export type EntityMatch = "exact" | "subsidiary" | "parent" | "unrelated";

/**
 * Project-specific context that customizes AI gate prompts.
 *
 * - entityType: a short noun phrase describing the project's universe.
 *   Examples: "B2B buyer companies", "Kickstarter campaign companies",
 *   "specialty coffee roasters", "AI tooling startups".
 *
 * - targetRole: a noun phrase describing who you want to find.
 *   Examples: "decision-makers for partnership/acquisition",
 *   "founders or operators", "head of partnerships", "any decision-maker".
 *
 * - additionalContext (optional): free-form context to splice into prompts.
 *   Examples: "we're evaluating them as licensing partners",
 *   "campaign closes on the date below — outreach is time-sensitive".
 */
export type RoleContext = {
  entityType: string;
  targetRole: string;
  additionalContext?: string;
};

export type ValidationResult = {
  valid: boolean;
  reason: string;
  entityMatch: EntityMatch;
};

export type DisambiguationResult = {
  match: "same" | "subsidiary" | "parent" | "rebrand" | "different";
  explanation: string;
  useDomain: string;
};

export type PreliminaryScore = {
  id: string;
  worthRevealing: boolean;
  reason: string;
};

export type CandidateScore = {
  apolloPersonId: string;
  confidence: Confidence;
  evidenceSummary: string;
  rank: number;
};

export type DataQualityResult = {
  pass: boolean;
  issues: string[];
};

export type MergeAction = "write" | "skip" | "merge";

export type MergeDecision = {
  action: MergeAction;
  reason: string;
  mergedFields: Record<string, string>;
};
