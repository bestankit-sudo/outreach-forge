import type { MergeSpec } from "./types.js";

/** Default "is empty" check used when a merge rule doesn't supply one. */
export function isFalsy(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Plan field updates to apply to the winner record. The winner is preserved
 * as-is unless a field is empty and a loser has a value (or a `combine`
 * function is supplied for union-style merging).
 *
 * Returns a Partial<T> with only the fields that should be updated. Caller
 * is responsible for actually writing these updates to storage.
 */
export function planMerge<T>(
  winner: T,
  losers: T[],
  spec: MergeSpec<T>,
): Partial<T> {
  const updates: Partial<T> = {};

  for (const rule of spec) {
    const isEmpty = rule.isEmpty ?? isFalsy;
    const winnerValue = winner[rule.field];

    if (rule.combine) {
      // Union-style: fold all losers into the winner via combine().
      let merged: unknown = winnerValue;
      for (const loser of losers) {
        merged = rule.combine(merged, loser[rule.field]);
      }
      if (merged !== winnerValue) {
        (updates as Record<string, unknown>)[rule.field as string] = merged;
      }
    } else if (isEmpty(winnerValue)) {
      // First-non-empty: fill winner from the first loser that has a value.
      for (const loser of losers) {
        const loserValue = loser[rule.field];
        if (!isEmpty(loserValue)) {
          (updates as Record<string, unknown>)[rule.field as string] = loserValue;
          break;
        }
      }
    }
  }

  return updates;
}

/**
 * Pre-built combiner for union-of-arrays. Useful for relation lists where
 * you want to keep all references from winner + all losers, deduplicated.
 */
export function unionArrays<T>(winnerValue: unknown, loserValue: unknown): T[] {
  const winnerArr = Array.isArray(winnerValue) ? (winnerValue as T[]) : [];
  const loserArr = Array.isArray(loserValue) ? (loserValue as T[]) : [];
  const seen = new Set(winnerArr);
  const result = [...winnerArr];
  for (const item of loserArr) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }
  return result;
}
