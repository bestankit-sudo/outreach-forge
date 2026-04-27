/**
 * The opinionated standard schema for the 3 enrichment databases.
 *
 * Project-specific extensions are passed to `setupEnrichmentDatabases`
 * as additional property definitions; they're merged on top of these.
 */

export type SchemaProperty =
  | { type: "title" }
  | { type: "rich_text" }
  | { type: "url" }
  | { type: "email" }
  | { type: "number" }
  | { type: "checkbox" }
  | { type: "date" }
  | { type: "select"; options: Array<{ name: string; color?: string }> }
  | { type: "multi_select"; options: Array<{ name: string; color?: string }> }
  | { type: "relation"; databaseId: string };

export type SchemaDef = Record<string, SchemaProperty>;

const STATUS_OPTIONS = [
  { name: "pending", color: "gray" },
  { name: "done", color: "green" },
  { name: "partial", color: "yellow" },
  { name: "failed", color: "red" },
  { name: "needs_review", color: "orange" },
] as const;

const CONFIDENCE_OPTIONS = [
  { name: "high", color: "green" },
  { name: "medium", color: "yellow" },
  { name: "low", color: "red" },
] as const;

/** Standard fields for the Companies Enriched DB. Relations added at setup time. */
export const COMPANY_BASE_SCHEMA: SchemaDef = {
  "Company Name": { type: "title" },
  "Company Domain": { type: "url" },
  "Company Description": { type: "rich_text" },
  "Industry": { type: "rich_text" },
  "Employee Count": { type: "number" },
  "Founded Year": { type: "number" },
  "Total Funding": { type: "rich_text" },
  "Funding Stage": { type: "rich_text" },
  "LinkedIn Company URL": { type: "url" },
  "X URL": { type: "url" },
  "Instagram URL": { type: "url" },
  "Facebook URL": { type: "url" },
  "YouTube URL": { type: "url" },
  "TikTok URL": { type: "url" },
  "Generic Business Email": { type: "email" },
  "Contact Form URL": { type: "url" },
  "Company Phone": { type: "rich_text" },
  "Company Country": { type: "rich_text" },
  "HQ City": { type: "rich_text" },
  "Apollo Organisation ID": { type: "rich_text" },
  "Best Outreach Path": { type: "rich_text" },
  "Company Outreach Readiness": {
    type: "select",
    options: [
      { name: "pending", color: "gray" },
      { name: "ready_person", color: "green" },
      { name: "ready_form", color: "blue" },
      { name: "ready_email", color: "blue" },
      { name: "blocked", color: "red" },
    ],
  },
  "Enrichment Status": { type: "select", options: [...STATUS_OPTIONS] },
  "Match Confidence": { type: "select", options: [...CONFIDENCE_OPTIONS] },
  "Source Notes": { type: "rich_text" },
  "Last Checked At": { type: "date" },
};

/** Standard fields for the People Enriched DB. Relations added at setup time. */
export const PERSON_BASE_SCHEMA: SchemaDef = {
  "Full Name": { type: "title" },
  "First Name": { type: "rich_text" },
  "Last Name": { type: "rich_text" },
  "Job Title": { type: "rich_text" },
  "Headline": { type: "rich_text" },
  "LinkedIn Person URL": { type: "url" },
  "Apollo Person ID": { type: "rich_text" },
  "Work Emails": { type: "rich_text" },
  "Email Status": { type: "rich_text" },
  "City": { type: "rich_text" },
  "Country": { type: "rich_text" },
  "Discovery Method": {
    type: "select",
    options: [
      { name: "apollo", color: "blue" },
      { name: "serp_fallback", color: "purple" },
      { name: "manual", color: "gray" },
    ],
  },
  "Match Confidence": { type: "select", options: [...CONFIDENCE_OPTIONS] },
  "Evidence Summary": { type: "rich_text" },
  "Match Notes": { type: "rich_text" },
  "Candidate Rank": { type: "number" },
  "Is Primary Candidate": { type: "checkbox" },
  "Enrich Status": { type: "select", options: [...STATUS_OPTIONS] },
  "Last Enriched At": { type: "date" },
};

/** Standard fields for the Extractions audit log. Relations added at setup time. */
export const EXTRACTION_BASE_SCHEMA: SchemaDef = {
  "Extraction": { type: "title" },
  "Type": {
    type: "select",
    options: [
      { name: "company", color: "blue" },
      { name: "person", color: "purple" },
    ],
  },
  "Source": {
    type: "select",
    options: [
      { name: "apollo_search", color: "blue" },
      { name: "apollo_reveal", color: "blue" },
      { name: "apollo_org", color: "blue" },
      { name: "website_scrape", color: "green" },
      { name: "brave_serp", color: "yellow" },
      { name: "chinese_media", color: "orange" },
      { name: "manual", color: "gray" },
    ],
  },
  "Status": {
    type: "select",
    options: [
      { name: "raw", color: "gray" },
      { name: "accepted", color: "green" },
      { name: "rejected", color: "red" },
      { name: "merged", color: "blue" },
    ],
  },
  "Credits Used": { type: "number" },
  "Extracted At": { type: "date" },
  "Raw Data": { type: "rich_text" },
  "Source Query": { type: "rich_text" },
  "Source Notes": { type: "rich_text" },
  "AI Validation": { type: "rich_text" },
};

/**
 * Convert a SchemaProperty to the JSON shape Notion's databases.create expects.
 */
export function buildNotionPropertyConfig(prop: SchemaProperty): Record<string, unknown> {
  switch (prop.type) {
    case "title":
      return { title: {} };
    case "rich_text":
      return { rich_text: {} };
    case "url":
      return { url: {} };
    case "email":
      return { email: {} };
    case "number":
      return { number: { format: "number" } };
    case "checkbox":
      return { checkbox: {} };
    case "date":
      return { date: {} };
    case "select":
      return { select: { options: prop.options } };
    case "multi_select":
      return { multi_select: { options: prop.options } };
    case "relation":
      return {
        relation: {
          database_id: prop.databaseId,
          type: "single_property",
          single_property: {},
        },
      };
  }
}

/** Build the full Notion properties dict from a SchemaDef. */
export function buildNotionPropertiesDict(schema: SchemaDef): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema)) {
    result[name] = buildNotionPropertyConfig(prop);
  }
  return result;
}
