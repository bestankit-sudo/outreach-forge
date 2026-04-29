/**
 * Per-row write isolation for bulk Notion jobs.
 *
 * A single bad row (e.g. an over-100-char email, a malformed select option,
 * a transient Notion validation error) will abort an entire batch if writes
 * are run inline. This helper wraps the per-row callback in try/catch so the
 * remaining rows can still be processed and the failures collected for review.
 *
 * Foundational pattern for any consumer running > ~50 rows; document
 * prominently and use as the default for HITL flows.
 */

import { logger } from "../utils/logger.js";

export type RowErrorIsolationResult<T, R> = {
  ok: R[];
  failed: Array<{ row: T; error: Error; index: number }>;
};

export type RowErrorIsolationOptions<T> = {
  /** Called for each failure. Use to log structured context (row identifier, etc). */
  onError?: (row: T, err: Error, index: number) => void;
  /** Stop iterating after this many failures. Default: no cap. */
  maxFailures?: number;
};

export async function withRowErrorIsolation<T, R>(
  rows: T[],
  fn: (row: T, idx: number) => Promise<R>,
  opts: RowErrorIsolationOptions<T> = {},
): Promise<RowErrorIsolationResult<T, R>> {
  const ok: R[] = [];
  const failed: Array<{ row: T; error: Error; index: number }> = [];
  const maxFailures = opts.maxFailures;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as T;
    try {
      ok.push(await fn(row, i));
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      failed.push({ row, error, index: i });
      if (opts.onError) {
        opts.onError(row, error, i);
      } else {
        logger.warn(`[withRowErrorIsolation] row ${i} failed: ${error.message}`);
      }
      if (typeof maxFailures === "number" && failed.length >= maxFailures) {
        logger.error(
          `[withRowErrorIsolation] aborting after ${failed.length} failures (cap = ${maxFailures})`,
        );
        break;
      }
    }
  }

  return { ok, failed };
}
