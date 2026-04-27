import { describe, it, expect } from "vitest";
import { isBlockedDomain } from "../src/index.js";

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
});
