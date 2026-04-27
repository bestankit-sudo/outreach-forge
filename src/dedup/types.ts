/**
 * One rule in a scoring rubric. If `match(record)` returns true, `points`
 * are added to the record's score.
 */
export type ScoringRule<T> = {
  label: string;
  match: (record: T) => boolean;
  points: number;
};

export type ScoringRubric<T> = ScoringRule<T>[];

/**
 * One merge rule for a field. Defaults to "fill from first non-empty loser
 * if winner's value is empty". Override via `isEmpty` or `combine`.
 */
export type MergeRule<T> = {
  field: keyof T;
  /** Defaults to the built-in `isFalsy` (null/undefined/""/empty array). */
  isEmpty?: (value: unknown) => boolean;
  /**
   * Union-style merge: combine winner+each loser. Useful for arrays and
   * relation lists where you want the union, not first-non-empty.
   */
  combine?: (winnerValue: unknown, loserValue: unknown) => unknown;
};

export type MergeSpec<T> = MergeRule<T>[];

export type DedupResult<T> = {
  winner: T;
  losers: T[];
  /** Field-level updates to apply to the winner. */
  updates: Partial<T>;
  /** Map of field name → score. Useful for logging. */
  winnerScore: number;
  /** Total records in the duplicate group (winner + losers). */
  groupSize: number;
};
