import OpenAI from "openai";
import { logger } from "../utils/logger.js";

/**
 * Bring-your-own-LLM via any OpenAI-compatible endpoint.
 *
 * Examples:
 *   OpenAI:    { apiKey: "sk-...", model: "gpt-5.4" }
 *   Anthropic: { apiKey: "sk-ant-...", baseURL: "https://api.anthropic.com/v1/", model: "claude-..." }
 *   Groq:      { apiKey: "gsk_...", baseURL: "https://api.groq.com/openai/v1", model: "llama-..." }
 *   Ollama:    { apiKey: "ollama", baseURL: "http://localhost:11434/v1", model: "llama3" }
 */
export type LLMConfig = {
  apiKey: string;
  baseURL?: string;
  model: string;
  defaultTemperature?: number;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
};

export class LLMClient {
  private client: OpenAI;
  private model: string;
  private defaultTemperature: number;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    this.model = config.model;
    this.defaultTemperature = config.defaultTemperature ?? 0;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: options.temperature ?? this.defaultTemperature,
        max_completion_tokens: options.maxTokens,
        response_format: options.jsonMode ? { type: "json_object" } : undefined,
      });
      return response.choices[0]?.message?.content ?? "";
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      logger.error(`[llm] chat failed: ${message}`);
      throw error;
    }
  }

  async chatJson<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T | null> {
    const text = await this.chat(messages, { ...options, jsonMode: true });
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      logger.warn(`[llm] failed to parse JSON response: ${text.slice(0, 200)}`);
      return null;
    }
  }
}
