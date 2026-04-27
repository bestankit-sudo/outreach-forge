import { describe, it, expect } from "vitest";
import { __testables__ } from "../src/scraper/website.js";

const { pickFirstSocial, extractBusinessEmail } = __testables__;

describe("pickFirstSocial", () => {
  const LINKEDIN = /https?:\/\/(www\.)?linkedin\.com\/company\/[^/"'\s?#]+/gi;

  it("picks the canonical LinkedIn company URL", () => {
    const html = `<a href="https://www.linkedin.com/company/acme-corp/about">LinkedIn</a>`;
    expect(pickFirstSocial(html, LINKEDIN)).toBe("https://www.linkedin.com/company/acme-corp");
  });

  it("returns null when nothing matches", () => {
    expect(pickFirstSocial("<p>no socials here</p>", LINKEDIN)).toBeNull();
  });

  it("strips query strings and fragments", () => {
    const html = `<a href="https://linkedin.com/company/acme?utm=x#section">LI</a>`;
    expect(pickFirstSocial(html, LINKEDIN)).toBe("https://linkedin.com/company/acme");
  });
});

describe("extractBusinessEmail", () => {
  it("prefers domain-matching emails", () => {
    const html = "Contact us at info@acme.com or someone@gmail.com";
    expect(extractBusinessEmail(html, "acme.com")).toBe("info@acme.com");
  });

  it("falls back to preferred prefix when no domain match", () => {
    const html = "Email contact@otherdomain.com";
    expect(extractBusinessEmail(html, "acme.com")).toBe("contact@otherdomain.com");
  });

  it("excludes generic provider domains", () => {
    const html = "Mail us at hi@gmail.com";
    expect(extractBusinessEmail(html, null)).toBeNull();
  });
});
