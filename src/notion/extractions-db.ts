import type { NotionService } from "./client.js";
import { dateProp, numberProp, relationProp, richTextProp, selectProp, titleProp, truncateForNotion } from "./property.js";
import type { Extraction } from "./types.js";

/**
 * Wrapper for the Extractions audit log. Every Apollo reveal, search,
 * Brave query, scrape, or manual edit can be logged here so cost and
 * provenance are queryable later.
 */
export class ExtractionsDb {
  constructor(
    private readonly notion: NotionService,
    private readonly databaseId: string,
  ) {}

  async create(input: Extraction): Promise<{ pageId: string }> {
    const properties: Record<string, unknown> = {
      "Extraction": titleProp(input.title),
      "Type": selectProp(input.type),
      "Source": selectProp(input.source),
      "Status": selectProp(input.status),
      "Credits Used": numberProp(input.creditsUsed),
      "Extracted At": dateProp(new Date().toISOString()),
    };

    if (input.rawData) properties["Raw Data"] = richTextProp(truncateForNotion(input.rawData));
    if (input.sourceQuery) properties["Source Query"] = richTextProp(input.sourceQuery);
    if (input.sourceNotes) properties["Source Notes"] = richTextProp(truncateForNotion(input.sourceNotes));
    if (input.aiValidation) properties["AI Validation"] = richTextProp(truncateForNotion(input.aiValidation));
    if (input.companyPageId) properties["Company"] = relationProp(input.companyPageId);
    if (input.personPageId) properties["Person"] = relationProp(input.personPageId);

    const created = await this.notion.createPage(this.databaseId, properties);
    return { pageId: created.id };
  }
}
