import { describe, it, expect, vi } from "vitest";
import {
  scoreSearchCandidates,
  validatePersonAtCompany,
  validateDataQuality,
  disambiguateEntity,
  generateOutreachBrief,
  type RoleContext,
} from "../src/index.js";
import type { LLMClient } from "../src/index.js";
import type { ApolloPerson, ApolloSearchResult } from "../src/index.js";

// Helper: create a mock LLMClient with stubbed chat()
function mockLLM(response: string): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue(response),
    chatJson: vi.fn(),
  } as unknown as LLMClient;
}

const ROLE: RoleContext = {
  entityType: "specialty coffee roasters",
  targetRole: "head of partnerships or wholesale",
};

const APOLLO_PERSON: ApolloPerson = {
  id: "p1",
  first_name: "Jane",
  last_name: "Doe",
  name: "Jane Doe",
  title: "Head of Partnerships",
  headline: "Coffee partnerships @ Acme",
  linkedin_url: "https://linkedin.com/in/janedoe",
  photo_url: "",
  twitter_url: "",
  email: "jane@acme.com",
  email_status: "verified",
  city: "Brooklyn",
  country: "USA",
  seniority: "head",
  organization_name: "Acme Coffee",
  employment_history: [
    { organization_name: "Acme Coffee", title: "Head of Partnerships", current: true, start_date: "2023-01", end_date: "" },
  ],
  organization: null,
};

describe("scoreSearchCandidates", () => {
  it("falls back to top-N when LLM throws", async () => {
    const llm = {
      chat: vi.fn().mockRejectedValue(new Error("api down")),
    } as unknown as LLMClient;

    const candidates: ApolloSearchResult[] = [
      { id: "1", first_name: "A", title: "VP", organization_name: "Acme", has_email: true },
      { id: "2", first_name: "B", title: "CEO", organization_name: "Acme", has_email: false },
    ];

    const result = await scoreSearchCandidates(llm, candidates, {
      targetCompanyName: "Acme",
      role: ROLE,
      maxReveals: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0].worthRevealing).toBe(true);
    expect(result[0].reason).toMatch(/AI scoring failed/);
  });

  it("parses LLM JSON array response", async () => {
    const llm = mockLLM('[{"id":"1","worthRevealing":true,"reason":"Good fit"}]');
    const candidates: ApolloSearchResult[] = [
      { id: "1", first_name: "A", title: "VP", organization_name: "Acme", has_email: true },
    ];

    const result = await scoreSearchCandidates(llm, candidates, {
      targetCompanyName: "Acme",
      role: ROLE,
    });

    expect(result).toEqual([{ id: "1", worthRevealing: true, reason: "Good fit" }]);
  });

  it("returns empty when no candidates given", async () => {
    const llm = mockLLM("");
    const result = await scoreSearchCandidates(llm, [], {
      targetCompanyName: "Acme",
      role: ROLE,
    });
    expect(result).toEqual([]);
  });
});

describe("validatePersonAtCompany", () => {
  it("rejects person with no name without calling LLM", async () => {
    const chat = vi.fn();
    const llm = { chat } as unknown as LLMClient;
    const person = { ...APOLLO_PERSON, name: "", first_name: "" };

    const result = await validatePersonAtCompany(llm, person, {
      companyName: "Acme",
      domain: "acme.com",
    }, ROLE);

    expect(result.valid).toBe(false);
    expect(result.entityMatch).toBe("unrelated");
    expect(chat).not.toHaveBeenCalled();
  });

  it("rejects invalid LinkedIn URL without calling LLM", async () => {
    const chat = vi.fn();
    const llm = { chat } as unknown as LLMClient;
    const person = { ...APOLLO_PERSON, linkedin_url: "https://twitter.com/janedoe" };

    const result = await validatePersonAtCompany(llm, person, {
      companyName: "Acme",
      domain: "acme.com",
    }, ROLE);

    expect(result.valid).toBe(false);
    expect(chat).not.toHaveBeenCalled();
  });

  it("parses LLM verdict", async () => {
    const llm = mockLLM('{"valid":true,"reason":"Email domain matches","entityMatch":"exact"}');
    const result = await validatePersonAtCompany(llm, APOLLO_PERSON, {
      companyName: "Acme Coffee",
      domain: "acme.com",
    }, ROLE);

    expect(result.valid).toBe(true);
    expect(result.entityMatch).toBe("exact");
  });
});

describe("validateDataQuality", () => {
  it("rejects deterministically when name is empty (no LLM call)", async () => {
    const chat = vi.fn();
    const llm = { chat } as unknown as LLMClient;
    const result = await validateDataQuality(llm, {
      name: "",
      linkedinUrl: "",
      email: "",
      title: "",
    });
    expect(result.pass).toBe(false);
    expect(result.issues).toContain("Missing name");
    expect(chat).not.toHaveBeenCalled();
  });

  it("rejects malformed LinkedIn URL deterministically", async () => {
    const chat = vi.fn();
    const llm = { chat } as unknown as LLMClient;
    const result = await validateDataQuality(llm, {
      name: "Jane Doe",
      linkedinUrl: "https://twitter.com/jane",
      email: "",
      title: "VP",
    });
    expect(result.pass).toBe(false);
    expect(chat).not.toHaveBeenCalled();
  });
});

describe("disambiguateEntity", () => {
  it("short-circuits when domains match exactly (no LLM call)", async () => {
    const chat = vi.fn();
    const llm = { chat } as unknown as LLMClient;
    const result = await disambiguateEntity(llm, {
      name: "Acme",
      domain: "acme.com",
    }, {
      orgName: "Acme",
      domain: "acme.com",
      description: "",
    });
    expect(result.match).toBe("same");
    expect(chat).not.toHaveBeenCalled();
  });

  it("calls LLM when domains differ", async () => {
    const llm = mockLLM('{"match":"rebrand","explanation":"Old domain","useDomain":"new.com"}');
    const result = await disambiguateEntity(llm, {
      name: "Acme",
      domain: "old.com",
    }, {
      orgName: "Acme Corp",
      domain: "new.com",
      description: "",
    });
    expect(result.match).toBe("rebrand");
    expect(result.useDomain).toBe("new.com");
  });
});

describe("generateOutreachBrief", () => {
  it("returns trimmed plain-text response", async () => {
    const llm = mockLLM("  Mention their recent partnership with X.\n");
    const text = await generateOutreachBrief(llm, {
      candidate: { name: "Jane", title: "Head", headline: "", linkedinUrl: "" },
      company: { name: "Acme", domain: "acme.com", description: "Coffee" },
      role: ROLE,
    });
    expect(text).toBe("Mention their recent partnership with X.");
  });

  it("returns empty string on LLM failure", async () => {
    const llm = {
      chat: vi.fn().mockRejectedValue(new Error("rate limited")),
    } as unknown as LLMClient;
    const text = await generateOutreachBrief(llm, {
      candidate: { name: "Jane", title: "Head", headline: "", linkedinUrl: "" },
      company: { name: "Acme", domain: "acme.com", description: "Coffee" },
      role: ROLE,
    });
    expect(text).toBe("");
  });
});
