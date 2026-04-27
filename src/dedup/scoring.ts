import type { ScoringRubric } from "./types.js";

export function scoreRecord<T>(record: T, rubric: ScoringRubric<T>): number {
  let total = 0;
  for (const rule of rubric) {
    if (rule.match(record)) total += rule.points;
  }
  return total;
}

/**
 * Default scoring rubric matching the conventions used by MagMirror and
 * Kickstarter. Tuned for `outreach-forge`'s standard `PersonEnrichment`
 * shape — projects with custom record shapes should write their own rubric.
 *
 * Field weights (higher = more valuable signal):
 *   apolloPersonId  +10 — strongest unique-person signal
 *   workEmails      +8  — direct contact channel
 *   linkedinUrl     +5  — alternate contact + identity
 *   firstName+last  +10 — proper name structure
 *   jobTitle        +3
 *   headline        +2
 *   evidenceLength  up to +5
 *   isCurrent       +5  — prefer non-archived
 */
export function defaultPersonScoringRubric<
  T extends {
    apolloPersonId?: string | null;
    workEmails?: string | null;
    linkedinUrl?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    jobTitle?: string | null;
    headline?: string | null;
    evidenceSummary?: string | null;
    archived?: boolean;
  },
>(): ScoringRubric<T> {
  return [
    { label: "has Apollo Person ID", match: (r) => Boolean(r.apolloPersonId?.trim()), points: 10 },
    { label: "has work email", match: (r) => Boolean(r.workEmails?.trim()), points: 8 },
    {
      label: "has LinkedIn URL",
      match: (r) => {
        const url = r.linkedinUrl?.trim().toLowerCase();
        return Boolean(url && url !== "not found");
      },
      points: 5,
    },
    {
      label: "has first + last name",
      match: (r) => Boolean(r.firstName?.trim() && r.lastName?.trim()),
      points: 10,
    },
    { label: "has job title", match: (r) => Boolean(r.jobTitle?.trim()), points: 3 },
    { label: "has headline", match: (r) => Boolean(r.headline?.trim()), points: 2 },
    {
      label: "has evidence summary",
      match: (r) => Boolean((r.evidenceSummary?.trim().length ?? 0) > 0),
      points: 1,
    },
    { label: "not archived", match: (r) => r.archived !== true, points: 5 },
  ];
}
