import { Client } from "@notionhq/client";
import { RequestQueue, sleep, withExponentialBackoff } from "../utils/rate-limiter.js";
import { logger } from "../utils/logger.js";

type NotionFilter = Record<string, unknown>;

type QueryResult = {
  id: string;
  properties: Record<string, unknown>;
} & Record<string, unknown>;

export class NotionService {
  private readonly client: Client;
  private readonly queue: RequestQueue;
  private readonly propertyTypeCache = new Map<string, Record<string, string>>();

  constructor(token: string) {
    this.client = new Client({ auth: token });
    this.queue = new RequestQueue(350);
  }

  /** Underlying SDK client — for callers that need an unwrapped operation. */
  get raw(): Client {
    return this.client;
  }

  private async runNotionCall<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.schedule(() =>
      withExponentialBackoff(
        async () => {
          while (true) {
            try {
              return await fn();
            } catch (error) {
              if (this.isRateLimit(error)) {
                await sleep(this.getRetryAfterMs(error));
                continue;
              }
              throw error;
            }
          }
        },
        {
          retries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 10_000,
          shouldRetry: (err) => {
            const retry = this.isTransient(err);
            if (retry) {
              const code = (err as { code?: string }).code ?? "unknown";
              const status = (err as { status?: number }).status ?? "unknown";
              logger.warn(`[notion] transient error (code=${code}, status=${status}) — retrying`);
            }
            return retry;
          },
        },
      ),
    );
  }

  private isRateLimit(error: unknown): boolean {
    const v = error as { code?: string; status?: number };
    return v?.status === 429 || v?.code === "rate_limited";
  }

  private isTransient(error: unknown): boolean {
    const v = error as { code?: string; status?: number };
    if (v?.code === "notionhq_client_request_timeout") return true;
    if (v?.code === "notionhq_client_response_error" && (v?.status === 502 || v?.status === 503 || v?.status === 504)) {
      return true;
    }
    if (v?.status === 502 || v?.status === 503 || v?.status === 504) return true;
    if (v?.status === 429 || v?.code === "rate_limited") return true;
    return false;
  }

  private getRetryAfterMs(error: unknown): number {
    const e = error as { headers?: Record<string, string | string[]> };
    const retryAfter = e?.headers?.["retry-after"];
    const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
    const seconds = Number.parseInt(raw ?? "", 10);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    return 1500;
  }

  async queryDatabase(
    dbId: string,
    filter?: NotionFilter,
    startCursor?: string,
  ): Promise<QueryResult[]> {
    const results: QueryResult[] = [];
    let cursor = startCursor;

    do {
      const response = await this.runNotionCall(() =>
        this.client.databases.query({
          database_id: dbId,
          page_size: 100,
          filter: filter as never,
          start_cursor: cursor,
        }),
      );
      const typed = response as {
        results: unknown[];
        has_more: boolean;
        next_cursor: string | null;
      };
      results.push(...(typed.results as QueryResult[]));
      cursor = typed.has_more ? typed.next_cursor ?? undefined : undefined;
    } while (cursor);

    return results;
  }

  async createPage(dbId: string, properties: Record<string, unknown>): Promise<QueryResult> {
    const response = await this.runNotionCall(() =>
      this.client.pages.create({
        parent: { database_id: dbId },
        properties: properties as never,
      }),
    );
    return response as QueryResult;
  }

  async updatePage(pageId: string, properties: Record<string, unknown>): Promise<QueryResult> {
    const response = await this.runNotionCall(() =>
      this.client.pages.update({
        page_id: pageId,
        properties: properties as never,
      }),
    );
    return response as QueryResult;
  }

  async archivePage(pageId: string): Promise<void> {
    await this.runNotionCall(() => this.client.pages.update({ page_id: pageId, archived: true }));
  }

  async createDatabase(args: {
    parentPageId: string;
    title: string;
    properties: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const response = await this.runNotionCall(() =>
      this.client.databases.create({
        parent: { type: "page_id", page_id: args.parentPageId },
        title: [{ type: "text", text: { content: args.title } }],
        properties: args.properties as never,
      }),
    );
    return { id: (response as { id: string }).id };
  }

  async updateDatabase(args: {
    databaseId: string;
    properties: Record<string, unknown>;
  }): Promise<void> {
    await this.runNotionCall(() =>
      this.client.databases.update({
        database_id: args.databaseId,
        properties: args.properties as never,
      }),
    );
  }

  /**
   * Add a two-way (synced) relation between `sourceDbId` and `targetDbId`.
   *
   * Wraps Notion's `databases.update` `dual_property` shape so callers don't
   * have to remember the (under-documented) JSON layout. The synced reverse
   * property appears on `targetDbId` with `syncedPropertyName` as its title.
   *
   * Idempotent on Notion's side: calling twice keeps the existing relation.
   */
  async linkDatabases(args: {
    sourceDbId: string;
    targetDbId: string;
    propertyName: string;
    syncedPropertyName: string;
  }): Promise<void> {
    await this.updateDatabase({
      databaseId: args.sourceDbId,
      properties: {
        [args.propertyName]: {
          type: "relation",
          relation: {
            database_id: args.targetDbId,
            type: "dual_property",
            dual_property: { synced_property_name: args.syncedPropertyName },
          },
        },
      },
    });
  }

  private async getPropertyType(dbId: string, propertyName: string): Promise<string | null> {
    const cached = this.propertyTypeCache.get(dbId);
    if (cached && cached[propertyName]) return cached[propertyName];

    const response = await this.runNotionCall(() =>
      this.client.databases.retrieve({ database_id: dbId }),
    );
    const typed = response as { properties?: Record<string, { type?: string }> };
    const next: Record<string, string> = {};
    for (const [name, prop] of Object.entries(typed.properties ?? {})) {
      if (prop?.type) next[name] = prop.type;
    }
    this.propertyTypeCache.set(dbId, next);
    return next[propertyName] ?? null;
  }

  async searchByProperty(dbId: string, propertyName: string, value: string): Promise<QueryResult[]> {
    const type = await this.getPropertyType(dbId, propertyName);
    const filterType = type === "url" ? "url" : type === "title" ? "title" : "rich_text";
    return this.queryDatabase(dbId, {
      property: propertyName,
      [filterType]: { equals: value },
    });
  }
}
