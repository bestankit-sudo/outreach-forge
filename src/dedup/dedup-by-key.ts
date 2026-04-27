import { groupByKey } from "./grouping.js";
import { planMerge } from "./merge.js";
import { scoreRecord } from "./scoring.js";
import type { DedupResult, MergeSpec, ScoringRubric } from "./types.js";

/**
 * End-to-end dedup: group records by `keyFn`, score each duplicate group,
 * pick the highest-scored as winner, plan field merges, return one
 * DedupResult per duplicate group.
 *
 * The caller is responsible for *applying* the updates and *archiving*
 * the losers in storage — this function is pure (no I/O).
 *
 * Single-record groups are skipped (nothing to dedupe).
 */
export function dedupByKey<T>(
  records: T[],
  options: {
    keyFn: (record: T) => string | null;
    rubric: ScoringRubric<T>;
    mergeSpec: MergeSpec<T>;
  },
): DedupResult<T>[] {
  const groups = groupByKey(records, options.keyFn);
  const results: DedupResult<T>[] = [];

  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    const scored = group.map((r) => ({ r, score: scoreRecord(r, options.rubric) }));
    scored.sort((a, b) => b.score - a.score);

    const winner = scored[0].r;
    const winnerScore = scored[0].score;
    const losers = scored.slice(1).map((s) => s.r);
    const updates = planMerge(winner, losers, options.mergeSpec);

    results.push({ winner, losers, updates, winnerScore, groupSize: group.length });
  }

  return results;
}
