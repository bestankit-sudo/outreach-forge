import { describe, it, expect } from "vitest";
import { isBlockedDomain, ApolloFilterError, searchOrganisationsList } from "../src/index.js";

describe("isBlockedDomain", () => {
  it("returns true for marketplace/social domains", () => {
    expect(isBlockedDomain("facebook.com")).toBe(true);
    expect(isBlockedDomain("kickstarter.com")).toBe(true);
    expect(isBlockedDomain("alibaba.com")).toBe(true);
  });

  it("returns true for empty input", () => {
    expect(isBlockedDomain("")).toBe(true);
  });

  it("strips protocol and www before matching", () => {
    expect(isBlockedDomain("https://www.facebook.com/page")).toBe(true);
    expect(isBlockedDomain("www.kickstarter.com")).toBe(true);
  });

  it("matches subdomains via suffix", () => {
    expect(isBlockedDomain("page.facebook.com")).toBe(true);
    expect(isBlockedDomain("shop.shopify.com")).toBe(true);
  });

  it("returns false for legitimate company domains", () => {
    expect(isBlockedDomain("acme.com")).toBe(false);
    expect(isBlockedDomain("anker.com")).toBe(false);
    expect(isBlockedDomain("smallrig.com")).toBe(false);
  });

  it("blocks retailer/grocery domains added in v0.1.x", () => {
    expect(isBlockedDomain("target.com")).toBe(true);
    expect(isBlockedDomain("walmart.com")).toBe(true);
    expect(isBlockedDomain("amazon.co.uk")).toBe(true);
    expect(isBlockedDomain("wholefoodsmarket.com")).toBe(true);
    expect(isBlockedDomain("ocado.com")).toBe(true);
    expect(isBlockedDomain("tesco.com")).toBe(true);
  });
});

describe("searchOrganisationsList", () => {
  it("rejects non-UUID industry tag IDs with ApolloFilterError before calling the API", async () => {
    await expect(
      searchOrganisationsList("fake-key", {
        keyword: "coffee",
        countries: ["United States"],
        industryTagIds: ["Food & Beverages"],
      }),
    ).rejects.toBeInstanceOf(ApolloFilterError);
  });

  it("accepts well-formed 24-char hex UUIDs without throwing the validator", async () => {
    // We only assert the validator doesn't throw — the network call will fail with a fake key,
    // but that's caught by the function and returns []. The point is `Food & Beverages`
    // would have thrown synchronously above.
    const fakeUuid = "5567cd4773696439e2030000";
    const result = await searchOrganisationsList("fake-key", {
      keyword: "coffee",
      countries: ["United States"],
      industryTagIds: [fakeUuid],
      maxPages: 1,
    });
    expect(Array.isArray(result)).toBe(true);
  });
});
