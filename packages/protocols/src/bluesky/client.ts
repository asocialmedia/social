// Response chunks must be read in order and cancelled immediately when the byte budget is exceeded.
// oxlint-disable no-await-in-loop
import {
  Client,
  l,
  XrpcInvalidResponseError,
  XrpcResponseError,
} from "@atproto/lex";
import { app, com } from "@bsky/sdk/lexicons";
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
import {
  abortable,
  readJsonBounded,
  retryAfterMs,
  waitForReadRetry,
} from "../transport";
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

const popularFeedsQuery = l.query(
  "app.bsky.unspecced.getPopularFeedGenerators",
  l.params({
    cursor: l.optional(l.string()),
    limit: l.optional(l.integer({ maximum: 100, minimum: 1 })),
    query: l.string(),
  }),
  app.bsky.feed.getSuggestedFeeds.$output
);

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
  maxRetries?: number;
  wait?: typeof waitForReadRetry;
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
  maxBytes: number,
  signal: AbortSignal
): Promise<unknown> {
  try {
    return await readJsonBounded(response, maxBytes, signal);
  } catch {
    throw new ProtocolError(
      signal.aborted ? "unavailable" : "invalid_response",
      "Upstream returned invalid data"
    );
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
      | "maxRetries"
      | "wait"
    >
  >;
  private readonly cache: ProtocolCache;
  private readonly observe?: ProtocolObserver;
  private readonly rpc: Client;
  private readonly pending = new Map<string, Promise<unknown>>();
  private active = 0;
  private blockedUntil = 0;
  private generation = 0;
  private failures = 0;
  private circuitUntil = 0;
  private probing = false;
  private readonly shutdown = new AbortController();

  close(): void {
    this.shutdown.abort();
    this.invalidate();
  }

  constructor(options: BlueskyClientOptions = {}) {
    this.options = {
      fetch: options.fetch ?? fetch,
      maxConcurrentRequests: options.maxConcurrentRequests ?? 4,
      maxResponseBytes: options.maxResponseBytes ?? 2 * 1024 * 1024,
      maxRetries: options.maxRetries ?? 1,
      now: options.now ?? Date.now,
      timeoutMs: options.timeoutMs ?? 5000,
      wait: options.wait ?? waitForReadRetry,
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
    if (
      !Number.isInteger(this.options.maxRetries) ||
      this.options.maxRetries < 0 ||
      this.options.maxRetries > 2
    ) {
      throw new RangeError("Read retries must be between zero and two");
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

  async allowsRecommendations(did: string): Promise<boolean> {
    const actor = actorSchema.parse(did);
    const result = await this.request(
      "content_visibility",
      { actor },
      z.object({ allowed: z.boolean() }),
      30_000
    );
    return result.allowed;
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

  async getSuggestedFeeds(
    options: { query?: string; cursor?: string; limit?: number } = {}
  ): Promise<{
    cursor: string | null;
    items: { uri: string; displayName: string; description?: string }[];
  }> {
    const parsed = z
      .object({
        cursor: z.string().min(1).max(4096).optional(),
        limit: z.number().int().min(1).max(50).default(24),
        query: z.string().trim().min(2).max(80).optional(),
      })
      .safeParse(options);
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid feed discovery");
    }
    const page = await this.request(
      parsed.data.query
        ? "app.bsky.unspecced.getPopularFeedGenerators"
        : "app.bsky.feed.getSuggestedFeeds",
      {
        ...(parsed.data.query ? { query: parsed.data.query } : {}),
        limit: String(parsed.data.limit),
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      },
      z.object({
        cursor: z.string().optional(),
        feeds: z
          .array(
            z.object({
              description: z.string().optional(),
              displayName: z.string(),
              uri: feedUriSchema,
            })
          )
          .max(100),
      }),
      300_000
    );
    return { cursor: page.cursor ?? null, items: page.feeds };
  }

  async searchPosts(
    query: string,
    sort: "latest" | "top",
    options: FeedReadOptions = {}
  ): Promise<ExternalPage<ExternalPost>> {
    const parsedQuery = z.string().trim().min(1).max(80).safeParse(query);
    const parsed = pageOptionsSchema.safeParse(options);
    if (
      !parsedQuery.success ||
      !parsed.success ||
      !["latest", "top"].includes(sort)
    ) {
      throw new ProtocolError("invalid_input", "Invalid post search");
    }
    const page = await this.request(
      "app.bsky.feed.searchPosts",
      {
        limit: String(parsed.data.limit),
        q: parsedQuery.data,
        sort,
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        ...(parsed.data.language
          ? { lang: parsed.data.language.split("-")[0] ?? "en" }
          : {}),
      },
      z.object({
        cursor: z.string().optional(),
        posts: z.array(z.unknown()).max(100),
      }),
      10_000
    );
    const items: ExternalPost[] = [];
    for (const value of page.posts) {
      const post = postViewSchema.safeParse(value);
      if (!post.success) {
        continue;
      }
      try {
        items.push(normalizePost(post.data));
      } catch (error) {
        if (!(error instanceof ProtocolError)) {
          throw error;
        }
      }
    }
    return { cursor: page.cursor ?? null, items };
  }

  async getPost(uri: string): Promise<ExternalPost | null> {
    const parsed = postUriSchema.safeParse(uri);
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid Bluesky post");
    }
    const posts = await this.getPosts([parsed.data]);
    return posts.find((post) => post.id === uri) ?? null;
  }

  async getPosts(uris: string[]): Promise<ExternalPost[]> {
    const parsed = z.array(postUriSchema).min(1).max(25).safeParse(uris);
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid Bluesky posts");
    }
    const page = await this.request(
      "app.bsky.feed.getPosts",
      { uris: JSON.stringify([...new Set(parsed.data)].toSorted()) },
      postsSchema,
      10_000
    );
    const posts: ExternalPost[] = [];
    for (const value of page.posts) {
      const post = postViewSchema.safeParse(value);
      if (!post.success || !parsed.data.includes(post.data.uri)) {
        continue;
      }
      try {
        posts.push(normalizePost(post.data));
      } catch (error) {
        if (!(error instanceof ProtocolError)) {
          throw error;
        }
      }
    }
    return posts;
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
      parsed.data.cursor ? 30_000 : 10_000,
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
      if (
        this.pending.size >= 64 ||
        this.active >= this.options.maxConcurrentRequests
      ) {
        throw new ProtocolError("capacity", "Protocol reader is busy", 1);
      }
      if (this.blockedUntil > this.options.now()) {
        throw new ProtocolError(
          "rate_limited",
          "Upstream is cooling down",
          Math.ceil((this.blockedUntil - this.options.now()) / 1000)
        );
      }
      if (this.shutdown.signal.aborted) {
        throw new ProtocolError("cancelled", "Protocol reader is stopping");
      }
      if (
        this.circuitUntil > this.options.now() ||
        (this.circuitUntil > 0 && this.probing)
      ) {
        throw new ProtocolError(
          "unavailable",
          "Protocol reader is recovering",
          Math.max(
            1,
            Math.ceil((this.circuitUntil - this.options.now()) / 1000)
          )
        );
      }
      const probe = this.circuitUntil > 0;
      if (probe) {
        this.probing = true;
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
          this.failures = 0;
          this.circuitUntil = 0;
          return validated.data;
        } catch (error) {
          if (
            error instanceof ProtocolError &&
            ["unavailable", "invalid_response"].includes(error.code)
          ) {
            this.failures += 1;
            if (probe || this.failures >= 5) {
              this.circuitUntil = this.options.now() + 30_000;
            }
          }
          throw error;
        } finally {
          if (probe) {
            this.probing = false;
          }
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
      if (operation === "content_visibility") {
        try {
          const record = await this.rpc.call(
            com.atproto.repo.getRecord,
            {
              collection: "app.bsky.actor.contentVisibilityDeclaration",
              repo: actorSchema.parse(query.get("actor")),
              rkey: "self",
            },
            options
          );
          const declaration = z
            .object({
              hideFromAlgorithmicRecommendations: z.boolean().default(false),
            })
            .parse(record.value);
          return { allowed: !declaration.hideFromAlgorithmicRecommendations };
        } catch (error) {
          if (
            error instanceof XrpcResponseError &&
            error.error === "RecordNotFound"
          ) {
            return { allowed: true };
          }
          throw error;
        }
      }
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
          {
            uris: z
              .array(postUriSchema)
              .min(1)
              .max(25)
              .parse(JSON.parse(query.get("uris") ?? "[]")),
          },
          options
        );
      }
      const page = {
        cursor: query.get("cursor") ?? undefined,
        limit: Number(query.get("limit")),
      };
      if (operation === "app.bsky.unspecced.getPopularFeedGenerators") {
        return await this.rpc.call(
          popularFeedsQuery,
          { ...page, query: query.get("query") ?? "" },
          options
        );
      }
      if (operation === "app.bsky.feed.getSuggestedFeeds") {
        return await this.rpc.call(
          app.bsky.feed.getSuggestedFeeds,
          page,
          options
        );
      }
      if (operation === "app.bsky.feed.searchPosts") {
        return await this.rpc.call(
          app.bsky.feed.searchPosts,
          {
            ...page,
            lang: query.get("lang") ?? undefined,
            q: query.get("q") ?? "",
            sort: query.get("sort") ?? "top",
          },
          options
        );
      }
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
      for (let attempt = 0; ; attempt += 1) {
        const signal = AbortSignal.any([
          this.shutdown.signal,
          AbortSignal.timeout(this.options.timeoutMs),
        ]);
        try {
          const response = await abortable(
            this.options.fetch(`https://public.api.bsky.app${path}`, {
              ...init,
              redirect: "error",
              signal,
            }),
            signal
          );
          if (!response.ok) {
            if (
              response.status === 400 &&
              path.startsWith("/xrpc/com.atproto.repo.getRecord?")
            ) {
              return Response.json(
                await abortable(
                  boundedJson(response, this.options.maxResponseBytes, signal),
                  signal
                ),
                { status: 400 }
              );
            }
            await response.body?.cancel();
            if (response.status === 429) {
              const wait = Math.ceil(
                (retryAfterMs(
                  response.headers.get("retry-after"),
                  this.options.now()
                ) ?? 30_000) / 1000
              );
              this.blockedUntil = Math.max(
                this.blockedUntil,
                this.options.now() + wait * 1000
              );
              throw new ProtocolError(
                "rate_limited",
                "Bluesky requested a pause",
                wait
              );
            }
            if (response.status === 401 || response.status === 403) {
              throw new ProtocolError(
                "restricted",
                "Public access is unavailable"
              );
            }
            throw new ProtocolError(
              response.status >= 500 || response.status === 408
                ? "unavailable"
                : "invalid_input",
              "Public read failed"
            );
          }
          return Response.json(
            await abortable(
              boundedJson(response, this.options.maxResponseBytes, signal),
              signal
            )
          );
        } catch (error) {
          if (this.shutdown.signal.aborted) {
            throw new ProtocolError("cancelled", "Protocol reader is stopping");
          }
          const failure =
            error instanceof ProtocolError
              ? error
              : new ProtocolError(
                  "unavailable",
                  "Bluesky is temporarily unavailable"
                );
          if (
            failure.code !== "unavailable" ||
            attempt >= this.options.maxRetries
          ) {
            throw failure;
          }
          this.report({
            code: failure.code,
            durationMs: 0,
            operation: "read.retry",
            outcome: "error",
          });
          await this.options.wait(
            Math.min(1000, 250 * 2 ** attempt) +
              Math.floor(Math.random() * 250),
            this.shutdown.signal
          );
        }
      }
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
