import { describe, it, expect } from "vitest";
import { extractDomain, normalizeUrl, parseFounderNames, sleep } from "../src/index.js";

describe("extractDomain", () => {
  it("strips protocol and www", () => {
    expect(extractDomain("https://www.acme.com/about")).toBe("acme.com");
  });
  it("returns null for invalid URLs", () => {
    expect(extractDomain("not a url")).toBeNull();
  });
});

describe("normalizeUrl", () => {
  it("strips protocol, www, query, fragment, trailing slash", () => {
    expect(normalizeUrl("HTTPS://www.Acme.com/path/?utm=x#section")).toBe("acme.com/path");
  });
});

describe("parseFounderNames", () => {
  it("splits on common conjunctions and dedupes", () => {
    const result = parseFounderNames("Jane Doe and John Smith & Jane Doe");
    expect(result).toEqual([
      { firstName: "Jane", lastName: "Doe" },
      { firstName: "John", lastName: "Smith" },
    ]);
  });
  it("filters company hints", () => {
    expect(parseFounderNames("Acme Inc")).toEqual([]);
  });
  it("strips title prefixes", () => {
    expect(parseFounderNames("Dr. Jane Doe")).toEqual([
      { firstName: "Jane", lastName: "Doe" },
    ]);
  });
});

describe("sleep", () => {
  it("waits at least the requested duration", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
