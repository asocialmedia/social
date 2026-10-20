import { timingSafeEqual } from "node:crypto";

import {
  readBlueskyAccountStatus,
  blueskyCapabilities,
} from "@asm/protocols/bluesky";
import type { BlueskyClient } from "@asm/protocols/bluesky";
import { ProtocolError } from "@asm/protocols/contracts";
import { Elysia, NotFound, ParseError, ValidationError, t } from "elysia";

import { version } from "../package.json";
import { observeRequest, requestId } from "./observability";
import type { ProtocolLogger } from "./observability";
import { createBlueskySearch } from "./search";

export interface ProtocolsHealth {
  discovery?: {
    connected: boolean;
    leaseHeld: boolean;
    processedEvents: number;
    lastEventAt: number | null;
    queued: number;
  };
  storageReady?: boolean;
  draining: boolean;
  jetstreamEnabled: boolean;
  connected: boolean;
  leaseHeld: boolean;
  processedEvents: number;
  lastEventAt: number | null;
}

export interface ProtocolsAppOptions {
  search?: ReturnType<typeof createBlueskySearch>;
  explicitClient?: ProtocolsAppOptions["client"];
  explicitDiscover?: ProtocolsAppOptions["discover"];
  client: Pick<
    BlueskyClient,
    "getProfile" | "getAuthorFeed" | "getFeed" | "getPost"
  > &
    Partial<
      Pick<
        BlueskyClient,
        | "getPosts"
        | "getPostThread"
        | "allowsRecommendations"
        | "searchActors"
        | "searchPosts"
      >
    >;
  logger: ProtocolLogger;
  token?: string;
  health: () => ProtocolsHealth;
  discover?: (
    mode: "latest" | "personalized" | "trending",
    cursor?: string,
    locale?: string,
    topics?: string[],
    content?: "all" | "video"
  ) => Promise<unknown>;
}

function authorized(header: string | null, expected: string): boolean {
  const value = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const received = Buffer.from(value);
  const token = Buffer.from(expected);
  return received.length === token.length && timingSafeEqual(received, token);
}

const pageQuery = {
  cursor: t.Optional(t.String({ maxLength: 4096, minLength: 1 })),
  language: t.Optional(
    t.String({ maxLength: 100, pattern: "^[a-zA-Z0-9,;-]+$" })
  ),
  limit: t.Optional(t.Integer({ maximum: 50, minimum: 1 })),
};
const statusByCode = {
  cancelled: 503,
  capacity: 503,
  invalid_input: 400,
  invalid_response: 502,
  rate_limited: 429,
  restricted: 403,
  unavailable: 502,
} as const;

export function createProtocolsApp(options: ProtocolsAppOptions) {
  const healthRateLimits = new Map<
    string,
    { count: number; resetAt: number }
  >();
  const isHealthRateLimited = (ip: string) => {
    const now = Date.now();
    const current = healthRateLimits.get(ip);
    if (!current || now > current.resetAt) {
      healthRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
      if (healthRateLimits.size > 2000) {
        for (const [k, v] of healthRateLimits) {
          if (now > v.resetAt) {
            healthRateLimits.delete(k);
          }
        }
      }
      return false;
    }
    current.count += 1;
    return current.count > 60;
  };

  const search =
    options.search ??
    createBlueskySearch({
      client: options.client,
      explicitClient: options.explicitClient,
    });
  const clientFor = (request: Request) =>
    new URL(request.url).searchParams.get("explicit") === "1"
      ? (options.explicitClient ?? options.client)
      : options.client;
  return new Elysia({
    name: "asm.protocols",
    serve: { maxRequestBodySize: 16 * 1024 },
  })
    .onRequest(({ request, set }) => {
      set.headers["x-request-id"] = requestId(request);
      set.headers["cache-control"] = "no-store";
    })
    .onError(ProtocolError, ({ error, set }) => {
      set.status = statusByCode[error.code];
      if (error.retryAfterSeconds) {
        set.headers["retry-after"] = String(error.retryAfterSeconds);
      }
      return { error: error.code };
    })
    .onError(NotFound, ({ set }) => {
      set.status = 404;
      return { error: "not_found" };
    })
    .onError(ValidationError, ({ set }) => {
      set.status = 400;
      return { error: "invalid_input" };
    })
    .onError(ParseError, ({ set }) => {
      set.status = 400;
      return { error: "invalid_input" };
    })
    .onError(({ set }) => {
      options.logger.error(
        { code: "internal" },
        "Protocol HTTP handler failed"
      );
      set.status = 500;
      return { error: "internal" };
    })
    .get("/health", ({ request, set }) => {
      const clientIp =
        request.headers.get("cf-connecting-ip") ??
        request.headers.get("x-forwarded-for") ??
        "local";
      if (isHealthRateLimited(clientIp)) {
        set.status = 429;
        set.headers["retry-after"] = "60";
        return { error: "rate_limited" };
      }
      return { service: "protocols", status: "ok", version };
    })
    .get("/ready", ({ request, set }) => {
      const host = request.headers.get("host") ?? "";
      if (
        host.includes("proto.asocialmedia.cc") ||
        request.headers.get("cf-connecting-ip")
      ) {
        set.status = 403;
        return { error: "restricted" };
      }
      const health = options.health();
      const ready = !health.draining && health.storageReady !== false;
      if (!ready) {
        set.status = 503;
      }
      let stream = "disabled";
      if (health.jetstreamEnabled) {
        stream = health.connected ? "connected" : "disconnected";
      }
      return {
        discovery: health.discovery
          ? {
              events: health.discovery.processedEvents,
              lastEventAt: health.discovery.lastEventAt,
              queued: health.discovery.queued,
              stream: health.discovery.connected ? "connected" : "disconnected",
              worker: health.discovery.leaseHeld ? "leader" : "standby",
            }
          : undefined,
        search: search.stats(),
        service: "protocols",
        status: ready ? "ready" : "not_ready",
        storage: health.storageReady === false ? "recovering" : "ready",
        stream,
        worker: health.leaseHeld ? "leader" : "standby",
      };
    })
    .group("/v1", (app) =>
      app
        .onBeforeHandle(({ request, set }) => {
          const host = request.headers.get("host") ?? "";
          if (
            host.includes("proto.asocialmedia.cc") ||
            request.headers.get("cf-connecting-ip")
          ) {
            set.status = 403;
            return { error: "restricted" };
          }
          if (!options.token) {
            set.status = 503;
            return { error: "not_configured" };
          }
          if (
            !authorized(request.headers.get("authorization"), options.token)
          ) {
            set.status = 401;
            return { error: "unauthorized" };
          }
          if (options.health().storageReady === false) {
            set.status = 503;
            set.headers["retry-after"] = "2";
            return { error: "storage_recovering" };
          }
          if (options.health().draining) {
            set.status = 503;
            return { error: "draining" };
          }
        })
        .get("/capabilities", () => ({ protocols: [blueskyCapabilities] }))
        .get(
          "/bluesky/search",
          {
            query: t.Object({
              kind: t.Optional(
                t.Union([
                  t.Literal("all"),
                  t.Literal("user"),
                  t.Literal("post"),
                ])
              ),
              limit: t.Optional(t.Integer({ maximum: 10, minimum: 1 })),
              q: t.String({ maxLength: 80, minLength: 1 }),
            }),
          },
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.search",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () =>
                search.read(
                  query.q,
                  query.limit ?? 6,
                  query.kind ?? "all",
                  new URL(request.url).searchParams.get("explicit") === "1",
                  request.signal
                )
            )
        )
        .get(
          "/bluesky/posts",
          {
            query: t.Object({
              recommendations: t.Optional(t.Literal("1")),
              uri: t.Array(t.String({ maxLength: 512 }), {
                maxItems: 25,
                minItems: 1,
              }),
            }),
          },
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.posts",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              async () => {
                const client = clientFor(request);
                if (!client.getPosts) {
                  throw new ProtocolError(
                    "unavailable",
                    "Post reads unavailable"
                  );
                }
                const posts = await client.getPosts(query.uri);
                if (query.recommendations !== "1") {
                  return posts;
                }
                if (!client.allowsRecommendations) {
                  return [];
                }
                const authors = [
                  ...new Set(posts.map((post) => post.author.id)),
                ];
                const allowed = new Set(
                  await Promise.all(
                    authors.map(async (author) =>
                      (await client
                        .allowsRecommendations?.(author)
                        .catch(() => false))
                        ? author
                        : ""
                    )
                  )
                );
                return posts.filter((post) => allowed.has(post.author.id));
              }
            )
        )
        .get(
          "/bluesky/discover",
          {
            query: t.Object({
              content: t.Optional(
                t.Union([t.Literal("all"), t.Literal("video")])
              ),
              cursor: t.Optional(t.String({ format: "uuid" })),
              locale: t.Optional(
                t.String({
                  maxLength: 8,
                  pattern: "^(?:all|[a-z]{2}(?:-[A-Z]{2})?)$",
                })
              ),
              mode: t.Optional(
                t.Union([
                  t.Literal("latest"),
                  t.Literal("personalized"),
                  t.Literal("trending"),
                ])
              ),
              topic: t.Optional(
                t.Array(t.String({ maxLength: 80, minLength: 2 }), {
                  maxItems: 5,
                })
              ),
            }),
          },
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.discover",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () => {
                if (!options.discover) {
                  throw new ProtocolError(
                    "unavailable",
                    "Discovery is not configured"
                  );
                }
                const discover =
                  new URL(request.url).searchParams.get("explicit") === "1"
                    ? (options.explicitDiscover ?? options.discover)
                    : options.discover;
                return discover(
                  query.mode ?? "latest",
                  query.cursor,
                  query.locale,
                  query.topic,
                  query.content
                );
              }
            )
        )
        .get(
          "/bluesky/profile",
          {
            query: t.Object({
              actor: t.String({ maxLength: 2048, minLength: 3 }),
            }),
          },
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.profile",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () => clientFor(request).getProfile(query.actor)
            )
        )
        .get(
          "/bluesky/account-status",
          {
            query: t.Object({
              actor: t.String({
                maxLength: 2048,
                pattern: "^did:(plc|web):[A-Za-z0-9._:%-]+$",
              }),
            }),
          },
          async ({ query, request }) => ({
            status: await readBlueskyAccountStatus(query.actor, request.signal),
          })
        )
        .get(
          "/bluesky/author-feed",
          {
            query: t.Object({
              actor: t.String({ maxLength: 2048, minLength: 3 }),
              pins: t.Optional(t.Literal("0")),
              tab: t.Optional(
                t.Union([
                  t.Literal("posts"),
                  t.Literal("replies"),
                  t.Literal("media"),
                ])
              ),
              ...pageQuery,
            }),
          },
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.author_feed",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () =>
                clientFor(request).getAuthorFeed(
                  query.actor,
                  query.tab ?? "posts",
                  {
                    cursor: query.cursor,
                    includePins: query.pins === "0" ? false : undefined,
                    language: query.language,
                    limit: query.limit,
                  }
                )
            )
        )
        .get(
          "/bluesky/feed",
          {
            query: t.Object({
              feed: t.String({ maxLength: 2300, minLength: 1 }),
              ...pageQuery,
            }),
          },
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.feed",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () =>
                clientFor(request).getFeed(query.feed, {
                  cursor: query.cursor,
                  language: query.language,
                  limit: query.limit,
                })
            )
        )
        .get(
          "/bluesky/post",
          {
            query: t.Object({
              uri: t.String({ maxLength: 2300, minLength: 1 }),
            }),
          },
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.post",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () => clientFor(request).getPost(query.uri)
            )
        )
        .get(
          "/bluesky/thread",
          {
            query: t.Object({
              depth: t.Optional(t.Integer({ maximum: 10, minimum: 0 })),
              uri: t.String({ maxLength: 2300, minLength: 1 }),
            }),
          },
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.thread",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () => {
                const client = clientFor(request);
                if (!client.getPostThread) {
                  throw new ProtocolError(
                    "unavailable",
                    "Thread reads unavailable"
                  );
                }
                return client.getPostThread(
                  query.uri,
                  query.depth === undefined ? 3 : Number(query.depth)
                );
              }
            )
        )
    );
}
