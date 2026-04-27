import { logger } from "../utils/logger.js";
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
