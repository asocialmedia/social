// Response chunks must be read in order and cancelled immediately when the byte budget is exceeded.
// oxlint-disable no-await-in-loop
import { Client, XrpcInvalidResponseError } from "@atproto/lex";
import { app } from "@bsky/sdk/lexicons";
import { z } from "zod";

import { BoundedCache } from "../cache";
import type { ProtocolCache } from "../cache";
import { ProtocolError } from "../contracts";
import type {
  ExternalAuthor,
  ExternalPage,
  ExternalPost,
  ProtocolCapabilities,
  ProtocolObserver,
} from "../contracts";
import { normalizeAuthor, normalizePost } from "./normalize";
import {
  actorSchema,
  feedPageSchema,
  feedUriSchema,
  postUriSchema,
  postsSchema,
  postViewSchema,
  profileSchema,
} from "./schemas";

export const blueskyCapabilities: ProtocolCapabilities = {
  authenticatedWrites: false,
  liveEvents: true,
  profileTabs: ["posts", "replies", "media"],
  publicFeeds: true,
  publicProfiles: true,
  source: "bluesky",
};

export type ProtocolFetch = (
  url: string,
  init: RequestInit
) => Promise<Response>;
export interface BlueskyClientOptions {
  fetch?: ProtocolFetch;
  cache?: ProtocolCache;
  observe?: ProtocolObserver;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxConcurrentRequests?: number;
  now?: () => number;
}

const pageOptionsSchema = z.object({
  cursor: z.string().min(1).max(4096).optional(),
  language: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9,;-]+$/)
    .optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export interface FeedReadOptions {
  limit?: number;
  cursor?: string;
  language?: string;
}
export type AuthorFeedTab = "posts" | "replies" | "media";

async function boundedJson(
  response: Response,
  maxBytes: number
): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new ProtocolError(
      "invalid_response",
      "Upstream response exceeds the size limit"
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ProtocolError("invalid_response", "Upstream returned no data");
  }
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new ProtocolError(
          "invalid_response",
          "Upstream response exceeds the size limit"
        );
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof ProtocolError) {
      throw error;
    }
    throw new ProtocolError(
      "invalid_response",
      "Upstream returned invalid data"
    );
  } finally {
    reader.releaseLock();
  }
}

export class BlueskyClient {
  private readonly options: Required<
    Pick<
      BlueskyClientOptions,
      | "timeoutMs"
      | "maxResponseBytes"
      | "maxConcurrentRequests"
      | "now"
      | "fetch"
    >
  >;
  private readonly cache: ProtocolCache;
  private readonly observe?: ProtocolObserver;
  private readonly rpc: Client;
  private readonly pending = new Map<string, Promise<unknown>>();
  private active = 0;
  private blockedUntil = 0;
  private generation = 0;

  constructor(options: BlueskyClientOptions = {}) {
    this.options = {
      fetch: options.fetch ?? fetch,
      maxConcurrentRequests: options.maxConcurrentRequests ?? 4,
      maxResponseBytes: options.maxResponseBytes ?? 2 * 1024 * 1024,
      now: options.now ?? Date.now,
      timeoutMs: options.timeoutMs ?? 5000,
    };
    for (const value of [
      this.options.timeoutMs,
      this.options.maxResponseBytes,
      this.options.maxConcurrentRequests,
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError("Client limits must be positive safe integers");
      }
    }
    this.cache = options.cache ?? new BoundedCache({ now: this.options.now });
    this.observe = options.observe;
    this.rpc = new Client((path, init) => this.fetchBounded(path, init), {
      validateRequest: true,
      validateResponse: true,
    });
  }

  invalidate(): void {
    this.generation += 1;
    this.cache.clear();
  }

  async getProfile(actor: string): Promise<ExternalAuthor> {
    const parsed = actorSchema.safeParse(actor);
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid Bluesky account");
    }
    const data = await this.request(
      "app.bsky.actor.getProfile",
      { actor: parsed.data },
      profileSchema,
      60_000
    );
    return normalizeAuthor(data);
  }

  async getAuthorFeed(
    actor: string,
    tab: AuthorFeedTab = "posts",
    options: FeedReadOptions = {}
  ): Promise<ExternalPage<ExternalPost>> {
    const parsed = actorSchema.safeParse(actor);
    const validatedTab = z.enum(["posts", "replies", "media"]).safeParse(tab);
    if (!parsed.success || !validatedTab.success) {
      throw new ProtocolError("invalid_input", "Invalid author feed");
    }
    // Check the account's current public visibility before exposing its author feed.
    const author = await this.getProfile(parsed.data);
    const filterByTab = {
      media: "posts_with_media",
      posts: "posts_no_replies",
      replies: "posts_with_replies",
    };
    const filter = filterByTab[tab];
    const page = await this.feed(
      "app.bsky.feed.getAuthorFeed",
      { actor: author.id, filter },
      options
    );
    return {
      ...page,
      items: page.items.filter(
        (post) => tab !== "replies" || Boolean(post.replyTo)
      ),
    };
  }

  async getFeed(
    feed: string,
    options: FeedReadOptions = {}
  ): Promise<ExternalPage<ExternalPost>> {
    const parsed = feedUriSchema.safeParse(feed);
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid Bluesky feed");
    }
    const page = await this.feed(
      "app.bsky.feed.getFeed",
      { feed: parsed.data },
      options
    );
    return page;
  }

  async getPost(uri: string): Promise<ExternalPost | null> {
    const parsed = postUriSchema.safeParse(uri);
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid Bluesky post");
    }
    const page = await this.request(
      "app.bsky.feed.getPosts",
      { uris: parsed.data },
      postsSchema,
      15_000
    );
    const post = page.posts
      .map((value) => postViewSchema.safeParse(value))
      .find((value) => value.success && value.data.uri === uri);
    if (!post?.success) {
      return null;
    }
    return normalizePost(post.data);
  }

  private async feed(
    operation: string,
    parameters: Record<string, string>,
    options: FeedReadOptions
  ): Promise<ExternalPage<ExternalPost>> {
    const parsed = pageOptionsSchema.safeParse(options);
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid feed pagination");
    }
    const params = {
      ...parameters,
      limit: String(parsed.data.limit),
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
    };
    const page = await this.request(
      operation,
      params,
      feedPageSchema,
      30_000,
      parsed.data.language
    );
    const unique = new Map<string, ExternalPost>();
    for (const entry of page.feed) {
      const post = postViewSchema.safeParse(entry.post);
      if (!post.success) {
        continue;
      }
      try {
        const normalized = normalizePost(post.data);
        unique.set(normalized.id, normalized);
      } catch (error) {
        if (!(error instanceof ProtocolError)) {
          throw error;
        }
      }
    }
    return { cursor: page.cursor ?? null, items: [...unique.values()] };
  }

  private async request<Schema extends z.ZodType>(
    operation: string,
    parameters: Record<string, string>,
    schema: Schema,
    ttlMs: number,
    language?: string
  ): Promise<z.output<Schema>> {
    const start = this.options.now();
    const query = new URLSearchParams(parameters);
    query.sort();
    const key = `${this.generation}:${operation}:${language ?? ""}:${query}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.report({
        durationMs: this.options.now() - start,
        operation,
        outcome: "cache_hit",
      });
      try {
        return schema.parse(JSON.parse(cached));
      } catch {
        this.invalidate();
      }
    }
    let pending = this.pending.get(key);
    if (!pending) {
      if (this.active >= this.options.maxConcurrentRequests) {
        throw new ProtocolError("capacity", "Protocol reader is busy", 1);
      }
      if (this.blockedUntil > this.options.now()) {
        throw new ProtocolError(
          "rate_limited",
          "Upstream is cooling down",
          Math.ceil((this.blockedUntil - this.options.now()) / 1000)
        );
      }
      const { generation } = this;
      pending = (async () => {
        try {
          const value = await this.load(operation, query, language);
          const validated = schema.safeParse(value);
          if (!validated.success) {
            throw new ProtocolError(
              "invalid_response",
              "Upstream returned an unexpected response"
            );
          }
          if (this.generation === generation) {
            this.cache.set(key, JSON.stringify(validated.data), ttlMs);
          }
          return validated.data;
        } finally {
          this.pending.delete(key);
        }
      })();
      this.pending.set(key, pending);
    }
    try {
      const value = schema.parse(await pending);
      this.report({
        durationMs: this.options.now() - start,
        operation,
        outcome: "success",
      });
      return value;
    } catch (error) {
      const failure =
        error instanceof ProtocolError
          ? error
          : new ProtocolError(
              "unavailable",
              "Bluesky is temporarily unavailable"
            );
      this.report({
        code: failure.code,
        durationMs: this.options.now() - start,
        operation,
        outcome: "error",
      });
      throw failure;
    }
  }

  private async load(
    operation: string,
    query: URLSearchParams,
    language?: string
  ): Promise<unknown> {
    const options = {
      headers: language ? { "accept-language": language } : undefined,
      maxRetries: 0,
    };
    try {
      if (operation === "app.bsky.actor.getProfile") {
        return await this.rpc.call(
          app.bsky.actor.getProfile,
          { actor: actorSchema.parse(query.get("actor")) },
          options
        );
      }
      if (operation === "app.bsky.feed.getPosts") {
        return await this.rpc.call(
          app.bsky.feed.getPosts,
          { uris: [postUriSchema.parse(query.get("uris"))] },
          options
        );
      }
      const page = {
        cursor: query.get("cursor") ?? undefined,
        limit: Number(query.get("limit")),
      };
      if (operation === "app.bsky.feed.getAuthorFeed") {
        return await this.rpc.call(
          app.bsky.feed.getAuthorFeed,
          {
            actor: actorSchema.parse(query.get("actor")),
            filter: query.get("filter") ?? "posts_no_replies",
            ...page,
          },
          options
        );
      }
      if (operation === "app.bsky.feed.getFeed") {
        return await this.rpc.call(
          app.bsky.feed.getFeed,
          { feed: feedUriSchema.parse(query.get("feed")), ...page },
          options
        );
      }
      throw new ProtocolError(
        "invalid_input",
        "Unsupported public Bluesky operation"
      );
    } catch (error) {
      if (error instanceof ProtocolError) {
        throw error;
      }
      if (error instanceof Error && error.cause instanceof ProtocolError) {
        throw error.cause;
      }
      if (error instanceof XrpcInvalidResponseError) {
        throw new ProtocolError(
          "invalid_response",
          "Bluesky returned invalid Lexicon data"
        );
      }
      throw new ProtocolError(
        "unavailable",
        "Bluesky is temporarily unavailable"
      );
    }
  }

  private async fetchBounded(
    path: string,
    init: RequestInit
  ): Promise<Response> {
    this.active += 1;
    try {
      const response = await this.options.fetch(
        `https://public.api.bsky.app${path}`,
        {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(this.options.timeoutMs),
        }
      );
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) {
          const header = response.headers.get("retry-after");
          const numeric = Number(header);
          const seconds =
            header && !Number.isNaN(numeric)
              ? numeric
              : (Date.parse(header ?? "") - this.options.now()) / 1000;
          const wait = Number.isFinite(seconds)
            ? Math.max(1, Math.min(300, Math.ceil(seconds)))
            : 30;
          this.blockedUntil = this.options.now() + wait * 1000;
          throw new ProtocolError(
            "rate_limited",
            "Bluesky requested a pause",
            wait
          );
        }
        if (response.status === 401 || response.status === 403) {
          throw new ProtocolError("restricted", "Public access is unavailable");
        }
        throw new ProtocolError(
          "unavailable",
          "Bluesky is temporarily unavailable"
        );
      }
      return Response.json(
        await boundedJson(response, this.options.maxResponseBytes)
      );
    } catch (error) {
      if (error instanceof ProtocolError) {
        throw error;
      }
      throw new ProtocolError(
        "unavailable",
        "Bluesky is temporarily unavailable"
      );
    } finally {
      this.active -= 1;
    }
  }

  private report(diagnostic: Parameters<ProtocolObserver>[0]): void {
    // Observability failures must not fail a content request.
    try {
      this.observe?.(diagnostic);
    } catch {
      // Observers are optional and may fail independently of reads.
    }
  }
}
