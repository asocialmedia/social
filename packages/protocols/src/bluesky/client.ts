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
  ExternalThread,
  ProtocolCapabilities,
  ProtocolObserver,
} from "../contracts";
import {
  abortable,
  readJsonBounded,
  retryAfterMs,
  waitForReadRetry,
} from "../transport";
import { isAuthFeed, isAuthFeedUri } from "./auth-feeds";
import { extractThread, normalizeAuthor, normalizePost } from "./normalize";
import {
  actorSchema,
  feedPageSchema,
  feedUriSchema,
  postUriSchema,
  postsSchema,
  postViewSchema,
  profileSchema,
  threadResponseSchema,
} from "./schemas";

export {
  isAuthFeed,
  isAuthFeedUri,
  isAuthenticationNotice,
} from "./auth-feeds";
export {
  createAuthenticatedClient,
  createBlueskySession,
  publishBlueskyLike,
  publishBlueskyReply,
  publishBlueskyRepost,
  resolveBlueskyHandle,
} from "./authenticated";
export type {
  BlueskyAuthSession,
  BlueskyCredentials,
  BlueskyRecordResult,
} from "./authenticated";

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
  allowExplicitMedia?: boolean;
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

const postSearchOperations = new Set([
  "app.bsky.feed.searchPosts",
  "app.bsky.feed.searchPostsV2",
]);

const pageOptionsSchema = z.object({
  cursor: z.string().min(1).max(4096).optional(),
  hasVideo: z.boolean().optional(),
  language: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9,;-]+$/)
    .optional(),
  limit: z.number().int().min(1).max(50).default(20),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
});
export interface FeedReadOptions {
  hasVideo?: boolean;
  includePins?: boolean;
  limit?: number;
  cursor?: string;
  language?: string;
  since?: string;
  until?: string;
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
  private readonly allowExplicitMedia: boolean;
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
  private readonly unavailable = new Map<
    string,
    { until: number; code: "restricted" | "unavailable" | "invalid_input" }
  >();
  private active = 0;
  private blockedUntil = 0;
  private generation = 0;
  private failures = 0;
  private lastFailureAt = 0;
  private circuitUntil = 0;
  private probing = false;
  private readonly shutdown = new AbortController();

  close(): void {
    this.shutdown.abort();
    this.invalidate();
  }

  constructor(options: BlueskyClientOptions = {}) {
    this.allowExplicitMedia = options.allowExplicitMedia ?? false;
    this.options = {
      fetch: options.fetch ?? fetch,
      maxConcurrentRequests: options.maxConcurrentRequests ?? 4,
      maxResponseBytes: options.maxResponseBytes ?? 2 * 1024 * 1024,
      maxRetries: options.maxRetries ?? 1,
      now: options.now ?? Date.now,
      timeoutMs: options.timeoutMs ?? 10_000,
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

  invalidate(target?: string): void {
    if (!target) {
      this.generation += 1;
      this.cache.clear();
      return;
    }
    const encoded = encodeURIComponent(target);
    this.cache.deleteMatching?.(
      (key) => key.includes(target) || key.includes(encoded)
    );
  }

  async allowsRecommendations(did: string): Promise<boolean> {
    const actor = actorSchema.parse(did);
    const visibility = this.request(
      "content_visibility",
      { actor },
      z.object({ allowed: z.boolean() }),
      30_000
    );
    const profile = (async () => {
      if (this.allowExplicitMedia) {
        return true;
      }
      try {
        await this.getProfile(actor);
        return true;
      } catch (error) {
        if (error instanceof ProtocolError && error.code === "restricted") {
          return false;
        }
        throw error;
      }
    })();
    const [result, safeAuthor] = await Promise.all([visibility, profile]);
    return result.allowed && safeAuthor;
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
    return normalizeAuthor(data, this.allowExplicitMedia);
  }

  async getPublicSocialRecords(actor: string) {
    const repo = actorSchema.parse(actor);
    const collections = [
      "app.bsky.feed.like",
      "app.bsky.feed.repost",
      "app.bsky.graph.follow",
    ] as const;
    const pages = await Promise.all(
      collections.map(async (collection) => {
        const page = await this.request(
          "com.atproto.repo.listRecords",
          { collection, limit: "50", repo, reverse: "true" },
          z.object({
            records: z
              .array(
                z.object({ uri: z.string().max(2300), value: z.unknown() })
              )
              .max(50),
          }),
          60_000
        );
        return page.records.flatMap((record) => {
          const value = z
            .object({
              createdAt: z.iso.datetime({ offset: true }).optional(),
              subject:
                collection === "app.bsky.graph.follow"
                  ? z.string().startsWith("did:")
                  : z.object({ uri: postUriSchema }),
            })
            .safeParse(record.value);
          if (
            !value.success ||
            !record.uri.startsWith(`at://${repo}/${collection}/`)
          ) {
            return [];
          }
          const actions = {
            "app.bsky.feed.like": "like",
            "app.bsky.feed.repost": "repost",
            "app.bsky.graph.follow": "follow",
          } as const;
          const action = actions[collection];
          return [
            {
              action,
              at:
                action === "follow"
                  ? this.options.now()
                  : Date.parse(value.data.createdAt ?? ""),
              rkey: record.uri.split("/").at(-1) ?? "",
              target:
                typeof value.data.subject === "string"
                  ? value.data.subject
                  : value.data.subject.uri,
            },
          ];
        });
      })
    );
    return pages
      .flat()
      .filter(
        (entry) =>
          Number.isFinite(entry.at) &&
          entry.at > this.options.now() - 7 * 86_400_000
      );
  }

  async searchActors(query: string, limit = 6): Promise<ExternalAuthor[]> {
    const parsed = z
      .object({
        limit: z.number().int().min(1).max(20),
        query: z.string().trim().min(1).max(80),
      })
      .safeParse({ limit, query });
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid profile search");
    }
    const page = await this.request(
      "app.bsky.actor.searchActors",
      { limit: String(parsed.data.limit), q: parsed.data.query },
      z.object({ actors: z.array(z.unknown()).max(100) }),
      30_000
    );
    const authors: ExternalAuthor[] = [];
    for (const value of page.actors) {
      const profile = profileSchema.safeParse(value);
      if (!profile.success) {
        continue;
      }
      try {
        authors.push(normalizeAuthor(profile.data, this.allowExplicitMedia));
      } catch (error) {
        if (!(error instanceof ProtocolError)) {
          throw error;
        }
      }
    }
    return authors.slice(0, limit);
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
      {
        actor: author.id,
        filter,
        ...(options.includePins === undefined
          ? {}
          : { includePins: String(options.includePins) }),
      },
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
    if (isAuthFeedUri(parsed.data)) {
      throw new ProtocolError(
        "restricted",
        "This feed requires authentication"
      );
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
    items: {
      uri: string;
      displayName: string;
      description?: string;
      contentMode?: string;
      likeCount?: number;
    }[];
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
              contentMode: z.string().optional(),
              description: z.string().optional(),
              displayName: z.string(),
              likeCount: z.number().int().nonnegative().optional(),
              uri: feedUriSchema,
            })
          )
          .max(100),
      }),
      300_000
    );
    const items = page.feeds.filter((feed) => !isAuthFeed(feed));
    return { cursor: page.cursor ?? null, items };
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
    const video = parsed.data.hasVideo === true;
    const page = await this.request(
      video ? "app.bsky.feed.searchPostsV2" : "app.bsky.feed.searchPosts",
      {
        limit: String(parsed.data.limit),
        ...(video
          ? { hasVideo: "true", query: parsedQuery.data }
          : { q: parsedQuery.data }),
        sort: video && sort === "latest" ? "recent" : sort,
        ...(parsed.data.since ? { since: parsed.data.since } : {}),
        ...(parsed.data.until ? { until: parsed.data.until } : {}),
        ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
        ...(parsed.data.language
          ? {
              [video ? "languages" : "lang"]:
                parsed.data.language.split("-")[0] ?? "en",
            }
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
        items.push(normalizePost(post.data, 0, this.allowExplicitMedia));
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

  async getPosts(
    uris: string[],
    requireComplete = false
  ): Promise<ExternalPost[]> {
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
      if (!post.success && requireComplete) {
        throw new ProtocolError(
          "invalid_response",
          "Post lookup could not verify source visibility"
        );
      }
      if (!post.success || !parsed.data.includes(post.data.uri)) {
        continue;
      }
      try {
        posts.push(normalizePost(post.data, 0, this.allowExplicitMedia));
      } catch (error) {
        if (requireComplete || !(error instanceof ProtocolError)) {
          throw error;
        }
      }
    }
    return posts;
  }

  async getPostThread(uri: string, depth = 3): Promise<ExternalThread> {
    const parsed = postUriSchema.safeParse(uri);
    if (!parsed.success) {
      throw new ProtocolError("invalid_input", "Invalid Bluesky post");
    }
    const clampedDepth = Math.max(0, Math.min(depth, 10));
    const data = await this.request(
      "app.bsky.feed.getPostThread",
      {
        depth: String(clampedDepth),
        parentHeight: "0",
        uri: parsed.data,
      },
      threadResponseSchema,
      15_000
    );
    return extractThread(data.thread, 150, this.allowExplicitMedia);
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
        const normalized = normalizePost(post.data, 0, this.allowExplicitMedia);
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
    const resource = postSearchOperations.has(operation)
      ? `${operation}:${query}`
      : `${operation}:${parameters.feed ?? parameters.actor ?? parameters.repo ?? parameters.q ?? ""}:${parameters.collection ?? ""}`;
    const resourceFailure = this.unavailable.get(resource);
    if (resourceFailure && resourceFailure.until > this.options.now()) {
      throw new ProtocolError(
        resourceFailure.code,
        "Public resource is cooling down",
        Math.ceil((resourceFailure.until - this.options.now()) / 1000)
      );
    }
    this.unavailable.delete(resource);
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
            ["unavailable", "invalid_response"].includes(error.code) &&
            ![
              "app.bsky.feed.getFeed",
              "com.atproto.repo.listRecords",
              "app.bsky.feed.searchPosts",
              "app.bsky.feed.searchPostsV2",
            ].includes(operation)
          ) {
            const now = this.options.now();
            if (now - this.lastFailureAt > 30_000) {
              this.failures = 0;
            }
            this.failures += 1;
            this.lastFailureAt = now;
            if (probe || this.failures >= 5) {
              this.circuitUntil = now + 30_000;
            }
          } else if (probe) {
            // A non-availability response (e.g. rate limit, input error, auth) proves upstream is reachable.
            this.failures = 0;
            this.circuitUntil = 0;
          }
          if (
            error instanceof ProtocolError &&
            (["restricted", "unavailable"].includes(error.code) ||
              (operation === "app.bsky.feed.getFeed" &&
                error.code === "invalid_input" &&
                !parameters.cursor))
          ) {
            for (const [id, entry] of this.unavailable) {
              if (entry.until <= this.options.now()) {
                this.unavailable.delete(id);
              }
            }
            if (this.unavailable.size >= 256) {
              this.unavailable.delete(
                this.unavailable.keys().next().value ?? ""
              );
            }
            let cooldownMs =
              operation === "app.bsky.feed.getFeed" ? 60_000 : 5000;
            if (error.code === "restricted" || error.code === "invalid_input") {
              cooldownMs = 300_000;
            }
            this.unavailable.set(resource, {
              code:
                error.code === "restricted" || error.code === "invalid_input"
                  ? error.code
                  : "unavailable",
              until: this.options.now() + cooldownMs,
            });
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
        resource: parameters.feed,
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
      if (operation === "com.atproto.repo.listRecords") {
        return await this.rpc.call(
          com.atproto.repo.listRecords,
          {
            collection: z
              .enum([
                "app.bsky.feed.like",
                "app.bsky.feed.repost",
                "app.bsky.graph.follow",
              ])
              .parse(query.get("collection")),
            limit: 50,
            repo: actorSchema.parse(query.get("repo")),
            reverse: true,
          },
          options
        );
      }
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
      if (operation === "app.bsky.feed.getPostThread") {
        try {
          return await this.rpc.call(
            app.bsky.feed.getPostThread,
            {
              depth: Number(query.get("depth") ?? "3"),
              parentHeight: Number(query.get("parentHeight") ?? "0"),
              uri: postUriSchema.parse(query.get("uri")),
            },
            options
          );
        } catch (error) {
          if (
            error instanceof XrpcResponseError &&
            (error.error === "NotFound" || error.status === 404)
          ) {
            return {
              thread: {
                $type: "app.bsky.feed.defs#notFoundPost",
                notFound: true,
                uri: query.get("uri") ?? "",
              },
            };
          }
          throw error;
        }
      }
      const page = {
        cursor: query.get("cursor") ?? undefined,
        limit: query.get("limit") ? Number(query.get("limit")) : undefined,
      };
      if (operation === "app.bsky.actor.searchActors") {
        return await this.rpc.call(
          app.bsky.actor.searchActors,
          { ...page, q: query.get("q") ?? "" },
          options
        );
      }
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
      if (operation === "app.bsky.feed.searchPostsV2") {
        return await this.rpc.call(
          app.bsky.feed.searchPostsV2,
          {
            ...page,
            hasVideo: query.get("hasVideo") === "true",
            languages: query.has("languages")
              ? query.getAll("languages")
              : undefined,
            query: query.get("query") ?? "",
            since: query.get("since") ?? undefined,
            sort: query.get("sort") ?? "top",
            until: query.get("until") ?? undefined,
          },
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
            since: query.get("since") ?? undefined,
            sort: query.get("sort") ?? "top",
            until: query.get("until") ?? undefined,
          },
          options
        );
      }
      if (operation === "app.bsky.feed.getAuthorFeed") {
        return await this.rpc.call(
          app.bsky.feed.getAuthorFeed,
          {
            actor: actorSchema.parse(query.get("actor")),
            ...(query.has("includePins")
              ? { includePins: query.get("includePins") === "true" }
              : {}),
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
          let origin = "https://public.api.bsky.app";
          if (path.startsWith("/xrpc/com.atproto.repo.listRecords?")) {
            origin = "https://bsky.social";
          } else if (
            path.startsWith("/xrpc/app.bsky.feed.searchPosts?") ||
            path.startsWith("/xrpc/app.bsky.feed.searchPostsV2?")
          ) {
            origin = "https://api.bsky.app";
          }
          const response = await abortable(
            this.options.fetch(`${origin}${path}`, {
              ...init,
              redirect: "error",
              signal,
            }),
            signal
          );
          if (!response.ok) {
            if (
              response.status === 400 &&
              (path.startsWith("/xrpc/com.atproto.repo.getRecord?") ||
                path.startsWith("/xrpc/app.bsky.feed.getPostThread?"))
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
              "Public read failed",
              response.status >= 500 || response.status === 408
                ? Math.ceil(
                    (retryAfterMs(
                      response.headers.get("retry-after"),
                      this.options.now()
                    ) ?? 5000) / 1000
                  )
                : undefined
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
export { readBlueskyAccountStatus } from "./lifecycle";
