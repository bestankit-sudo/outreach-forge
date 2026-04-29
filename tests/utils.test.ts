import { describe, it, expect } from "vitest";
import {
  extractDomain,
  normalizeUrl,
  normalizeDomain,
  normalizeBrandName,
  parseFounderNames,
  sleep,
} from "../src/index.js";

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

describe("normalizeDomain", () => {
  it("strips protocol, www, path, query, fragment, trailing slash", () => {
    expect(normalizeDomain("https://www.Acme.com/path?x=1#y")).toBe("acme.com");
    expect(normalizeDomain("acme.com/")).toBe("acme.com");
    expect(normalizeDomain("ACME.COM")).toBe("acme.com");
    expect(normalizeDomain("")).toBe("");
  });

  it("is idempotent", () => {
    const a = normalizeDomain("https://www.Acme.com/path");
    expect(normalizeDomain(a)).toBe(a);
  });
});

describe("normalizeBrandName", () => {
  it("drops generic suffix tokens by default", () => {
    expect(normalizeBrandName("Blue Bottle Coffee, Inc.")).toBe("blue bottle coffee");
    expect(normalizeBrandName("The Acme Co.")).toBe("acme");
    expect(normalizeBrandName("Foo Bar LLC")).toBe("foo bar");
  });

  it("supports project-specific extra suffixes", () => {
    expect(normalizeBrandName("Blue Bottle Coffee", ["coffee"])).toBe("blue bottle");
    expect(normalizeBrandName("Acme Roasters", ["roasters"])).toBe("acme");
  });

  it("normalises curly apostrophes and punctuation", () => {
    expect(normalizeBrandName("L’OR Espresso")).toBe("lor espresso");
    expect(normalizeBrandName("Joe's & Sons")).toBe("joes sons");
  });

  it("falls back to unfiltered tokens if everything is a suffix", () => {
    expect(normalizeBrandName("The & Co", [])).toBe("the co");
  });
});

describe("sleep", () => {
  it("waits at least the requested duration", async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
