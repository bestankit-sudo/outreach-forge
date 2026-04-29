import { logger } from "../utils/logger.js";
import type { ExtractionsDb } from "../notion/extractions-db.js";
import { CostTracker } from "./cost-tracker.js";
import { WrappedApollo } from "./wrapped-apollo.js";
import { WrappedBrave } from "./wrapped-brave.js";
import { WrappedScraper } from "./wrapped-scraper.js";

export type RunContext = {
  apollo: WrappedApollo;
  brave: WrappedBrave;
  scrape: (url: string) => ReturnType<WrappedScraper["scrape"]>;
  log: (message: string) => void;
  dryRun: boolean;
  costs: CostTracker;
};

export type RunStats = {
  totalItems: number;
  succeeded: number;
  failed: number;
  failures: Array<{ identifier: string; error: string }>;
  apolloCreditsUsed: number;
  braveQueries: number;
  llmCalls: number;
  apolloByEndpoint: Record<string, number>;
};

export type RunOptions<T> = {
  items: T[];
  /**
   * Per-item callback. Receives the item, the run context, and an optional
   * `existingPageId` resolved by {@link RunOptions.lookupExisting} (or `null`
   * if no lookup hook is wired). Use the existing page ID to upsert instead
   * of always creating.
   */
  process: (item: T, ctx: RunContext, existingPageId: string | null) => Promise<void>;
  /** Defaults to a numeric index. Override to surface meaningful identifiers in logs. */
  identify?: (item: T) => string;
  /** Required for any apollo.* calls. */
  apolloApiKey?: string;
  /** Required for any brave.* calls. */
  braveApiKey?: string;
  /** If provided, every API call auto-logs an Extractions row. */
  extractionsDb?: ExtractionsDb;
  /** Skip all real API calls; helpers return empty results. */
  dryRun?: boolean;
  /** Throws when total Apollo credits used would exceed this number. */
  maxApolloCredits?: number;
  /**
   * Build a stable dedup key for an item (e.g. normalised domain or brand
   * name). Required for {@link RunOptions.lookupExisting} to fire.
   */
  dedupKey?: (item: T) => string;
  /**
   * Resolve a key to an existing Notion page ID, or `null` when none exists.
   * Called once per item before {@link RunOptions.process}; the result is
   * passed to `process` as the third argument.
   *
   * Typical implementation: query the Companies DB by domain/name and
   * return the first hit's page ID. Errors here are logged and treated as
   * "no existing page" so the run continues.
   */
  lookupExisting?: (key: string, item: T) => Promise<string | null>;
};

/**
 * Generic enrichment loop. Iterates `items`, calls `process(item, ctx)` for
 * each one, with auto-logged Apollo/Brave/scraper helpers exposed via ctx.
 *
 * Per-item failures are caught and recorded — one bad row doesn't kill the
 * run. Exception: if the Apollo cost cap is hit, the run aborts immediately.
 */
export async function runEnrichment<T>(options: RunOptions<T>): Promise<RunStats> {
  const items = options.items;
  const identify = options.identify ?? ((_item: T, i: number) => `#${i + 1}`) as (item: T, i?: number) => string;
  const dryRun = options.dryRun ?? false;
  const costs = new CostTracker(options.maxApolloCredits);

  const apollo = new WrappedApollo({
    apiKey: options.apolloApiKey ?? "",
    costs,
    extractions: options.extractionsDb,
    dryRun,
  });
  const brave = new WrappedBrave({
    apiKey: options.braveApiKey ?? "",
    costs,
    extractions: options.extractionsDb,
    dryRun,
  });
  const scraper = new WrappedScraper({
    extractions: options.extractionsDb,
    dryRun,
  });

  const failures: Array<{ identifier: string; error: string }> = [];
  let succeeded = 0;
  let failed = 0;

  if (dryRun) logger.warn("[runEnrichment] DRY RUN — no real API calls or writes");
  logger.info(`[runEnrichment] Processing ${items.length} items`);

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const id = identify(item, i);
    const log = (msg: string) => logger.info(`[${i + 1}/${items.length}] ${id}: ${msg}`);

    const ctx: RunContext = {
      apollo,
      brave,
      scrape: (url: string) => scraper.scrape(url),
      log,
      dryRun,
      costs,
    };

    try {
      log("starting");
      let existingPageId: string | null = null;
      if (options.dedupKey && options.lookupExisting) {
        const key = options.dedupKey(item);
        if (key) {
          try {
            existingPageId = await options.lookupExisting(key, item);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`lookupExisting threw — treating as no match (${msg})`);
            existingPageId = null;
          }
          if (existingPageId) log(`found existing page ${existingPageId} for key "${key}"`);
        }
      }
      await options.process(item, ctx, existingPageId);
      succeeded += 1;
      log("done");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Hard-fail on cap exceeded (the run can't continue safely)
      if (message.includes("Apollo credit cap")) {
        logger.error(`[runEnrichment] Aborting — ${message}`);
        failed += 1;
        failures.push({ identifier: id, error: message });
        break;
      }
      failed += 1;
      failures.push({ identifier: id, error: message });
      logger.error(`[${i + 1}/${items.length}] ${id}: failed — ${message}`);
    }
  }

  const snapshot = costs.snapshot();
  const stats: RunStats = {
    totalItems: items.length,
    succeeded,
    failed,
    failures,
    apolloCreditsUsed: snapshot.apolloCredits,
    braveQueries: snapshot.braveQueries,
    llmCalls: snapshot.llmCalls,
    apolloByEndpoint: snapshot.apolloByEndpoint,
  };

  logger.info(
    `[runEnrichment] Done — ${succeeded} succeeded, ${failed} failed, ` +
      `${snapshot.apolloCredits} Apollo credits, ${snapshot.braveQueries} Brave queries`,
  );

  return stats;
}
