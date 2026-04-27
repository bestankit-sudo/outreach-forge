/**
 * Tracks API costs across an enrichment run. Used by the wrapped API helpers
 * to enforce hard caps and report actual spend at the end.
 */
export class CostTracker {
  private apolloCredits = 0;
  private braveQueries = 0;
  private llmCalls = 0;
  private apolloCallsByEndpoint: Record<string, number> = {};

  constructor(private readonly maxApolloCredits?: number) {}

  recordApolloCredit(amount: number, endpoint: string): void {
    this.apolloCredits += amount;
    this.apolloCallsByEndpoint[endpoint] = (this.apolloCallsByEndpoint[endpoint] ?? 0) + 1;
    if (this.maxApolloCredits !== undefined && this.apolloCredits > this.maxApolloCredits) {
      throw new Error(
        `Apollo credit cap exceeded: ${this.apolloCredits} used, cap is ${this.maxApolloCredits}`,
      );
    }
  }

  recordBraveQuery(): void {
    this.braveQueries += 1;
  }

  recordLlmCall(): void {
    this.llmCalls += 1;
  }

  /** Throws if the next call would exceed the cap. Use before paid Apollo calls. */
  assertCanSpendApollo(amount: number): void {
    if (this.maxApolloCredits === undefined) return;
    if (this.apolloCredits + amount > this.maxApolloCredits) {
      throw new Error(
        `Apollo credit cap would be exceeded: ${this.apolloCredits} + ${amount} > ${this.maxApolloCredits}`,
      );
    }
  }

  snapshot(): { apolloCredits: number; braveQueries: number; llmCalls: number; apolloByEndpoint: Record<string, number> } {
    return {
      apolloCredits: this.apolloCredits,
      braveQueries: this.braveQueries,
      llmCalls: this.llmCalls,
      apolloByEndpoint: { ...this.apolloCallsByEndpoint },
    };
  }
}
