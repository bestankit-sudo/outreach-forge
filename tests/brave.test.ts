import { describe, it, expect } from "vitest";
import { simplifyCompanyName } from "../src/index.js";

describe("simplifyCompanyName", () => {
  it("normalises curly apostrophes to straight (PR 5 fix)", () => {
    // Brave returns 0 hits for the curly variant of L'OR Espresso —
    // normalising to a straight apostrophe restores results.
    expect(simplifyCompanyName("L’OR Espresso")).toBe("L'OR Espresso");
    expect(simplifyCompanyName("Joe‘s Coffee")).toBe("Joe's Coffee");
  });

  it("strips well-known legal suffix tokens", () => {
    expect(simplifyCompanyName("Foo LLC")).toBe("Foo");
    expect(simplifyCompanyName("Acme Pty")).toBe("Acme");
  });

  it("removes parenthetical aliases", () => {
    expect(simplifyCompanyName("Acme (formerly XYZ) Coffee")).toBe("Acme Coffee");
  });
});
