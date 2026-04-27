import { describe, it, expect, vi } from "vitest";
import {
  titleProp,
  richTextProp,
  urlProp,
  selectProp,
  numberProp,
  relationProp,
  truncateForNotion,
  getTitle,
  getRichText,
  getSelect,
  getRelationIds,
  buildNotionPropertyConfig,
  buildNotionPropertiesDict,
  COMPANY_BASE_SCHEMA,
  PERSON_BASE_SCHEMA,
  EXTRACTION_BASE_SCHEMA,
  setupEnrichmentDatabases,
  type NotionPage,
  type NotionService,
} from "../src/index.js";

// ─── Property builders ───

describe("property builders", () => {
  it("titleProp falls back to 'Untitled' when value is empty", () => {
    expect(titleProp("")).toEqual({ title: [{ text: { content: "Untitled" } }] });
    expect(titleProp("Hello")).toEqual({ title: [{ text: { content: "Hello" } }] });
  });

  it("richTextProp returns empty array when value is empty", () => {
    expect(richTextProp("")).toEqual({ rich_text: [] });
    expect(richTextProp("hi")).toEqual({ rich_text: [{ text: { content: "hi" } }] });
  });

  it("urlProp converts empty/null/undefined to null", () => {
    expect(urlProp("")).toEqual({ url: null });
    expect(urlProp(null)).toEqual({ url: null });
    expect(urlProp("https://x.com")).toEqual({ url: "https://x.com" });
  });

  it("selectProp returns null select when value is empty", () => {
    expect(selectProp("")).toEqual({ select: null });
    expect(selectProp("done")).toEqual({ select: { name: "done" } });
  });

  it("numberProp coerces undefined to null", () => {
    expect(numberProp(undefined)).toEqual({ number: null });
    expect(numberProp(0)).toEqual({ number: 0 });
    expect(numberProp(42)).toEqual({ number: 42 });
  });

  it("relationProp accepts a single id, array, or null", () => {
    expect(relationProp(null)).toEqual({ relation: [] });
    expect(relationProp("p1")).toEqual({ relation: [{ id: "p1" }] });
    expect(relationProp(["p1", "p2"])).toEqual({ relation: [{ id: "p1" }, { id: "p2" }] });
  });

  it("truncateForNotion enforces max length", () => {
    expect(truncateForNotion("abc", 10)).toBe("abc");
    expect(truncateForNotion("a".repeat(20), 10)).toBe("aaaaaaa...");
  });
});

// ─── Readers ───

describe("readers", () => {
  const page: NotionPage = {
    id: "p1",
    properties: {
      "Title": { type: "title", title: [{ plain_text: "Hello " }, { plain_text: "World" }] },
      "Body": { type: "rich_text", rich_text: [{ plain_text: "Some text" }] },
      "Status": { type: "select", select: { name: "done" } },
      "People": { type: "relation", relation: [{ id: "id1" }, { id: "id2" }] },
    },
  };

  it("getTitle joins all parts and trims", () => {
    expect(getTitle(page, "Title")).toBe("Hello World");
  });

  it("getRichText returns trimmed content", () => {
    expect(getRichText(page, "Body")).toBe("Some text");
  });

  it("getSelect returns the name", () => {
    expect(getSelect(page, "Status")).toBe("done");
  });

  it("getRelationIds returns IDs", () => {
    expect(getRelationIds(page, "People")).toEqual(["id1", "id2"]);
  });

  it("returns empty for missing properties", () => {
    expect(getTitle(page, "Missing")).toBe("");
    expect(getRichText(page, "Missing")).toBe("");
    expect(getSelect(page, "Missing")).toBe("");
    expect(getRelationIds(page, "Missing")).toEqual([]);
  });
});

// ─── Schema builders ───

describe("buildNotionPropertyConfig", () => {
  it("builds title/rich_text/url/email/number/checkbox/date primitives", () => {
    expect(buildNotionPropertyConfig({ type: "title" })).toEqual({ title: {} });
    expect(buildNotionPropertyConfig({ type: "rich_text" })).toEqual({ rich_text: {} });
    expect(buildNotionPropertyConfig({ type: "url" })).toEqual({ url: {} });
    expect(buildNotionPropertyConfig({ type: "email" })).toEqual({ email: {} });
    expect(buildNotionPropertyConfig({ type: "number" })).toEqual({ number: { format: "number" } });
    expect(buildNotionPropertyConfig({ type: "checkbox" })).toEqual({ checkbox: {} });
    expect(buildNotionPropertyConfig({ type: "date" })).toEqual({ date: {} });
  });

  it("builds select with options", () => {
    const config = buildNotionPropertyConfig({
      type: "select",
      options: [{ name: "high", color: "green" }, { name: "low", color: "red" }],
    });
    expect(config).toEqual({
      select: { options: [{ name: "high", color: "green" }, { name: "low", color: "red" }] },
    });
  });

  it("builds relation with single_property type", () => {
    const config = buildNotionPropertyConfig({ type: "relation", databaseId: "db1" });
    expect(config).toEqual({
      relation: { database_id: "db1", type: "single_property", single_property: {} },
    });
  });
});

describe("buildNotionPropertiesDict", () => {
  it("converts a SchemaDef to Notion properties dict", () => {
    const dict = buildNotionPropertiesDict({
      "Foo": { type: "title" },
      "Bar": { type: "url" },
    });
    expect(dict).toEqual({
      "Foo": { title: {} },
      "Bar": { url: {} },
    });
  });
});

// ─── Standard schemas ───

describe("standard schemas", () => {
  it("Companies includes the required fields", () => {
    expect(COMPANY_BASE_SCHEMA["Company Name"]).toEqual({ type: "title" });
    expect(COMPANY_BASE_SCHEMA["Company Domain"]).toEqual({ type: "url" });
    expect(COMPANY_BASE_SCHEMA["Apollo Organisation ID"]).toEqual({ type: "rich_text" });
    expect(COMPANY_BASE_SCHEMA["Enrichment Status"].type).toBe("select");
  });

  it("People includes the required fields with our chosen LinkedIn casing", () => {
    expect(PERSON_BASE_SCHEMA["Full Name"]).toEqual({ type: "title" });
    expect(PERSON_BASE_SCHEMA["LinkedIn Person URL"]).toEqual({ type: "url" });
    expect(PERSON_BASE_SCHEMA["Apollo Person ID"]).toEqual({ type: "rich_text" });
  });

  it("Extractions has audit-log fields", () => {
    expect(EXTRACTION_BASE_SCHEMA["Extraction"]).toEqual({ type: "title" });
    expect(EXTRACTION_BASE_SCHEMA["Credits Used"]).toEqual({ type: "number" });
    expect(EXTRACTION_BASE_SCHEMA["Source"].type).toBe("select");
  });
});

// ─── Setup orchestration ───

describe("setupEnrichmentDatabases", () => {
  function mockNotion() {
    let nextId = 1;
    const createDatabase = vi.fn().mockImplementation(async () => ({ id: `db${nextId++}` }));
    const updateDatabase = vi.fn().mockResolvedValue(undefined);
    return {
      service: { createDatabase, updateDatabase } as unknown as NotionService,
      createDatabase,
      updateDatabase,
    };
  }

  it("creates 3 databases in the right order", async () => {
    const { service, createDatabase, updateDatabase } = mockNotion();
    const result = await setupEnrichmentDatabases({
      notion: service,
      parentPageId: "parent",
      projectName: "Test Project",
    });

    expect(createDatabase).toHaveBeenCalledTimes(3);
    expect(createDatabase.mock.calls[0][0].title).toBe("Test Project — Companies Enriched");
    expect(createDatabase.mock.calls[1][0].title).toBe("Test Project — People Enriched");
    expect(createDatabase.mock.calls[2][0].title).toBe("Test Project — Extractions");
    expect(updateDatabase).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ companyDbId: "db1", peopleDbId: "db2", extractionsDbId: "db3" });
  });

  it("works without a project prefix", async () => {
    const { service, createDatabase } = mockNotion();
    await setupEnrichmentDatabases({ notion: service, parentPageId: "parent" });
    expect(createDatabase.mock.calls[0][0].title).toBe("Companies Enriched");
  });

  it("merges company extensions into the Companies DB", async () => {
    const { service, createDatabase } = mockNotion();
    await setupEnrichmentDatabases({
      notion: service,
      parentPageId: "parent",
      companyExtensions: {
        "Buyer Group": {
          type: "select",
          options: [{ name: "A" }, { name: "B" }],
        },
      },
    });

    const companyProps = createDatabase.mock.calls[0][0].properties as Record<string, unknown>;
    expect(companyProps["Buyer Group"]).toBeDefined();
    expect(companyProps["Company Name"]).toBeDefined(); // standard fields still there
  });

  it("creates People DB with relation to Companies DB", async () => {
    const { service, createDatabase } = mockNotion();
    await setupEnrichmentDatabases({ notion: service, parentPageId: "parent" });

    const peopleProps = createDatabase.mock.calls[1][0].properties as Record<string, { relation?: { database_id?: string } }>;
    expect(peopleProps["Linked Company"].relation?.database_id).toBe("db1");
  });

  it("creates Extractions DB with relations to both", async () => {
    const { service, createDatabase } = mockNotion();
    await setupEnrichmentDatabases({ notion: service, parentPageId: "parent" });

    const extractionProps = createDatabase.mock.calls[2][0].properties as Record<string, { relation?: { database_id?: string } }>;
    expect(extractionProps["Company"].relation?.database_id).toBe("db1");
    expect(extractionProps["Person"].relation?.database_id).toBe("db2");
  });
});
