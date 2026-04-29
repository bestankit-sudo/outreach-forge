export { NotionService } from "./client.js";
export {
  titleProp,
  richTextProp,
  urlProp,
  emailProp,
  numberProp,
  selectProp,
  multiSelectProp,
  checkboxProp,
  dateProp,
  relationProp,
  fileProp,
  truncateForNotion,
} from "./property.js";
export {
  getTitle,
  getRichText,
  getUrl,
  getEmail,
  getSelect,
  getMultiSelect,
  getDate,
  getNumber,
  getCheckbox,
  getRelationIds,
  getTextOrUrl,
} from "./readers.js";
export type { NotionPage } from "./readers.js";
export {
  COMPANY_BASE_SCHEMA,
  PERSON_BASE_SCHEMA,
  EXTRACTION_BASE_SCHEMA,
  buildNotionPropertyConfig,
  buildNotionPropertiesDict,
} from "./standard-schema.js";
export type { SchemaProperty, SchemaDef } from "./standard-schema.js";
export {
  setupEnrichmentDatabases,
  setupEnrichmentDatabasesIdempotent,
} from "./setup.js";
export type { EnrichmentDatabaseIds, SetupOptions } from "./setup.js";
export { ExtractionsDb } from "./extractions-db.js";
export { withRowErrorIsolation } from "./batch.js";
export type { RowErrorIsolationResult, RowErrorIsolationOptions } from "./batch.js";
export type {
  EnrichmentStatus,
  EnrichmentConfidence,
  MatchConfidence,
  DiscoveryMethod,
  CompanyOutreachReadiness,
  CompanySocials,
  CompanyEnrichment,
  PersonEnrichment,
  ExtractionType,
  ExtractionSource,
  ExtractionStatus,
  Extraction,
} from "./types.js";
export {
  personEnrichmentConfidence,
  companyEnrichmentConfidence,
} from "./enrichment-confidence.js";
