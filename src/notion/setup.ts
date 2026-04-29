import { logger } from "../utils/logger.js";
import type { Client } from "@notionhq/client";
import type { NotionService } from "./client.js";
import {
  COMPANY_BASE_SCHEMA,
  EXTRACTION_BASE_SCHEMA,
  PERSON_BASE_SCHEMA,
  buildNotionPropertiesDict,
  type SchemaDef,
} from "./standard-schema.js";

export type EnrichmentDatabaseIds = {
  companyDbId: string;
  peopleDbId: string;
  extractionsDbId: string;
};

export type SetupOptions = {
  notion: NotionService;
  /** ID of the Notion page that will be the parent of the 3 databases. */
  parentPageId: string;
  /** Optional prefix added to DB titles, e.g. "Podsque Beans". */
  projectName?: string;
  /** Extra fields to add to the Companies DB beyond the standard schema. */
  companyExtensions?: SchemaDef;
  /** Extra fields to add to the People DB beyond the standard schema. */
  peopleExtensions?: SchemaDef;
};

/**
 * Create the 3 standard enrichment databases (Companies, People, Extractions)
 * with the standard schema + relations + any project-specific extensions.
 *
 * Idempotent it is NOT — calling twice creates duplicate databases. The
 * caller should persist the returned IDs (typically as env vars).
 */
export async function setupEnrichmentDatabases(options: SetupOptions): Promise<EnrichmentDatabaseIds> {
  const { notion, parentPageId } = options;
  const prefix = options.projectName ? `${options.projectName} — ` : "";

  // Step 1: Create Companies DB (no relations yet — they'll be added after People exists).
  const companyTitle = `${prefix}Companies Enriched`;
  logger.info(`[setup] Creating "${companyTitle}"`);
  const companyDb = await notion.createDatabase({
    parentPageId,
    title: companyTitle,
    properties: buildNotionPropertiesDict({
      ...COMPANY_BASE_SCHEMA,
      ...(options.companyExtensions ?? {}),
    }),
  });

  // Step 2: Create People DB with a relation back to Companies.
  const peopleTitle = `${prefix}People Enriched`;
  logger.info(`[setup] Creating "${peopleTitle}"`);
  const peopleDb = await notion.createDatabase({
    parentPageId,
    title: peopleTitle,
    properties: buildNotionPropertiesDict({
      ...PERSON_BASE_SCHEMA,
      "Linked Company": { type: "relation", databaseId: companyDb.id },
      ...(options.peopleExtensions ?? {}),
    }),
  });

  // Step 3: Create Extractions DB with relations to both.
  const extractionsTitle = `${prefix}Extractions`;
  logger.info(`[setup] Creating "${extractionsTitle}"`);
  const extractionsDb = await notion.createDatabase({
    parentPageId,
    title: extractionsTitle,
    properties: buildNotionPropertiesDict({
      ...EXTRACTION_BASE_SCHEMA,
      "Company": { type: "relation", databaseId: companyDb.id },
      "Person": { type: "relation", databaseId: peopleDb.id },
    }),
  });

  // Step 4: Add reverse relations to Companies (All People, Best Person, Extractions).
  logger.info(`[setup] Adding reverse relations to Companies DB`);
  await notion.updateDatabase({
    databaseId: companyDb.id,
    properties: buildNotionPropertiesDict({
      "All People": { type: "relation", databaseId: peopleDb.id },
      "Best Person": { type: "relation", databaseId: peopleDb.id },
      "Extractions": { type: "relation", databaseId: extractionsDb.id },
    }),
  });

  // Step 5: Add reverse Extractions relation to People.
  logger.info(`[setup] Adding Extractions relation to People DB`);
  await notion.updateDatabase({
    databaseId: peopleDb.id,
    properties: buildNotionPropertiesDict({
      "Extractions": { type: "relation", databaseId: extractionsDb.id },
    }),
  });

  logger.info("[setup] Done. Persist these IDs in your project's env vars:");
  logger.info(`  COMPANY_DB_ID=${companyDb.id}`);
  logger.info(`  PEOPLE_DB_ID=${peopleDb.id}`);
  logger.info(`  EXTRACTIONS_DB_ID=${extractionsDb.id}`);

  return {
    companyDbId: companyDb.id,
    peopleDbId: peopleDb.id,
    extractionsDbId: extractionsDb.id,
  };
}

type ChildDbBlock = {
  id: string;
  type?: string;
  child_database?: { title?: string };
};

async function findChildDatabasesByTitle(
  notion: NotionService,
  parentPageId: string,
  titles: string[],
): Promise<Record<string, string>> {
  const wantedSet = new Set(titles);
  const found: Record<string, string> = {};
  const client = notion.raw as Client;
  let cursor: string | undefined;
  do {
    const response = (await client.blocks.children.list({
      block_id: parentPageId,
      start_cursor: cursor,
      page_size: 100,
    })) as { results: ChildDbBlock[]; has_more: boolean; next_cursor: string | null };

    for (const block of response.results) {
      if (block.type !== "child_database") continue;
      const title = block.child_database?.title?.trim() ?? "";
      if (wantedSet.has(title)) {
        found[title] = block.id;
      }
    }
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return found;
}

/**
 * Idempotent variant of {@link setupEnrichmentDatabases}. Looks up the 3
 * databases by their canonical titles under `parentPageId`; reuses them if
 * all 3 exist, otherwise falls through to the create flow.
 *
 * Use this in consumer setup scripts so re-running doesn't create duplicate
 * Notion databases (a common, expensive footgun).
 *
 * NOTE: only checks for the *base* DBs by title — it does NOT migrate
 * extensions or schema diffs. If you change `companyExtensions`,
 * `peopleExtensions`, or rename any field, run a separate migration.
 */
export async function setupEnrichmentDatabasesIdempotent(
  options: SetupOptions,
): Promise<EnrichmentDatabaseIds> {
  const prefix = options.projectName ? `${options.projectName} — ` : "";
  const titles = {
    company: `${prefix}Companies Enriched`,
    people: `${prefix}People Enriched`,
    extractions: `${prefix}Extractions`,
  };

  const found = await findChildDatabasesByTitle(
    options.notion,
    options.parentPageId,
    Object.values(titles),
  );

  if (
    found[titles.company] &&
    found[titles.people] &&
    found[titles.extractions]
  ) {
    logger.info("[setup] All 3 enrichment DBs already exist under parent — reusing.");
    return {
      companyDbId: found[titles.company],
      peopleDbId: found[titles.people],
      extractionsDbId: found[titles.extractions],
    };
  }

  if (Object.keys(found).length > 0) {
    logger.warn(
      `[setup] Found ${Object.keys(found).length}/3 expected DBs under parent — ` +
        "running fresh setup will create duplicates of the missing ones. " +
        "Either move the existing partial DBs out, or pass their IDs directly.",
    );
  }

  return setupEnrichmentDatabases(options);
}
