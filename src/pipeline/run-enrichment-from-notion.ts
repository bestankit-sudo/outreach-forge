import { logger } from "../utils/logger.js";
import type { NotionService } from "../notion/client.js";
import type { ExtractionsDb } from "../notion/extractions-db.js";
import type { NotionPage } from "../notion/readers.js";
import type { EnrichmentStatus } from "../notion/types.js";
import { dateProp, richTextProp, selectProp } from "../notion/property.js";
import { runEnrichment, type RunContext, type RunStats } from "./runner.js";

export type EnrichmentOutcome = {
  /** What status to write back to the row's `Enrichment Status` (or equivalent) field. */
  outcome: EnrichmentStatus;
  /** Optional reason — written to `Source Notes` if the property exists. */
  reason?: string;
};

export type RunEnrichmentFromNotionOptions = {
  notion: NotionService;
  /** DB to read items from (typically the Companies DB). */
  databaseId: string;
  /** Filter that selects which rows to process. e.g. `{ property: "Enrichment Status", equals: "approved" }`. */
  inputFilter: { property: string; equals: string };
  /** Process callback — return outcome + optional reason. Errors auto-mapped to `failed`. */
  process: (row: NotionPage, ctx: RunContext) => Promise<EnrichmentOutcome>;
  /** Property name to update with the outcome. Default: "Enrichment Status". */
  statusProperty?: string;
  /** Property name to update with `now()`. Default: "Last Checked At". Set to `null` to skip. */
  timestampProperty?: string | null;
  /** Property name to write the reason into. Default: "Source Notes". Set to `null` to skip. */
  reasonProperty?: string | null;
  apolloApiKey?: string;
  braveApiKey?: string;
  extractionsDb?: ExtractionsDb;
  dryRun?: boolean;
  maxApolloCredits?: number;
  /** Optional row identifier for logs. Falls back to the page ID. */
  identify?: (row: NotionPage) => string;
};

/**
 * Status-driven HITL enrichment loop. Reads rows from a Notion DB filtered by
 * a status property, runs each through {@link runEnrichment}, and writes the
 * outcome back to the row.
 *
 * Failures inside `process` are caught and reported as `failed` outcomes —
 * one bad row doesn't kill the rest of the batch. The Apollo credit cap
 * (when set) still aborts the whole run, matching `runEnrichment` semantics.
 */
export async function runEnrichmentFromNotion(
  opts: RunEnrichmentFromNotionOptions,
): Promise<RunStats> {
  const statusProperty = opts.statusProperty ?? "Enrichment Status";
  const timestampProperty = opts.timestampProperty === undefined ? "Last Checked At" : opts.timestampProperty;
  const reasonProperty = opts.reasonProperty === undefined ? "Source Notes" : opts.reasonProperty;

  const filter = {
    property: opts.inputFilter.property,
    select: { equals: opts.inputFilter.equals },
  };

  logger.info(
    `[runEnrichmentFromNotion] querying db ${opts.databaseId} where ${opts.inputFilter.property} = "${opts.inputFilter.equals}"`,
  );
  const rows = (await opts.notion.queryDatabase(opts.databaseId, filter)) as NotionPage[];
  logger.info(`[runEnrichmentFromNotion] ${rows.length} rows match`);

  return runEnrichment<NotionPage>({
    items: rows,
    identify: opts.identify ?? ((row: NotionPage) => row.id),
    apolloApiKey: opts.apolloApiKey,
    braveApiKey: opts.braveApiKey,
    extractionsDb: opts.extractionsDb,
    dryRun: opts.dryRun,
    maxApolloCredits: opts.maxApolloCredits,
    process: async (row, ctx) => {
      let resolved: EnrichmentOutcome;
      try {
        resolved = await opts.process(row, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Re-throw the cap error so the runner can short-circuit the batch.
        if (message.includes("Apollo credit cap")) throw err;
        resolved = { outcome: "failed", reason: message };
      }

      if (opts.dryRun) {
        ctx.log(`(dry-run) would write status=${resolved.outcome} reason=${resolved.reason ?? ""}`);
        return;
      }

      const updates: Record<string, unknown> = {
        [statusProperty]: selectProp(resolved.outcome),
      };
      if (timestampProperty) {
        updates[timestampProperty] = dateProp(new Date().toISOString());
      }
      if (reasonProperty && resolved.reason) {
        updates[reasonProperty] = richTextProp(resolved.reason);
      }
      await opts.notion.updatePage(row.id, updates);
    },
  });
}
