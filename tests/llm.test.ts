import { describe, it, expect } from "vitest";
import { LLMClient } from "../src/index.js";

describe("LLMClient", () => {
  it("constructs without making any network calls", () => {
    const client = new LLMClient({ apiKey: "test", model: "gpt-5.4" });
    expect(client).toBeInstanceOf(LLMClient);
  });

  it("accepts custom baseURL for OpenAI-compatible providers", () => {
    const client = new LLMClient({
      apiKey: "test",
      baseURL: "https://api.groq.com/openai/v1",
      model: "llama-3-70b",
    });
    expect(client).toBeInstanceOf(LLMClient);
  });
});
