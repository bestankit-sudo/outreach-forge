export {
  scoreSearchCandidates,
  validatePersonAtCompany,
  scoreRevealedCandidates,
  validateDataQuality,
  disambiguateEntity,
  decideMerge,
  generateOutreachBrief,
  generateCompanySummary,
} from "./gates.js";
export type {
  Confidence,
  EntityMatch,
  RoleContext,
  ValidationResult,
  DisambiguationResult,
  PreliminaryScore,
  CandidateScore,
  DataQualityResult,
  MergeAction,
  MergeDecision,
} from "./types.js";
