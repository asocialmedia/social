import { timingSafeEqual } from "node:crypto";

import { blueskyCapabilities } from "@asm/protocols/bluesky";
import type { BlueskyClient } from "@asm/protocols/bluesky";
import { ProtocolError } from "@asm/protocols/contracts";
import { Elysia, t } from "elysia";

import { version } from "../package.json";
import { observeRequest, requestId } from "./observability";
import type { ProtocolLogger } from "./observability";

export interface ProtocolsHealth {
  storageReady?: boolean;
  draining: boolean;
  jetstreamEnabled: boolean;
  connected: boolean;
  leaseHeld: boolean;
  processedEvents: number;
  lastEventAt: number | null;
}

export interface ProtocolsAppOptions {
  client: Pick<
    BlueskyClient,
    "getProfile" | "getAuthorFeed" | "getFeed" | "getPost"
  > &
    Partial<Pick<BlueskyClient, "getPosts" | "getPostThread">>;
  logger: ProtocolLogger;
  token?: string;
  health: () => ProtocolsHealth;
  discover?: (
    mode: "latest" | "personalized" | "trending",
    cursor?: string,
    locale?: string,
    topics?: string[]
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
  return new Elysia({
    name: "asm.protocols",
    serve: { maxRequestBodySize: 16 * 1024 },
  })
    .onRequest(({ request, set }) => {
      set.headers["x-request-id"] = requestId(request);
      set.headers["cache-control"] = "no-store";
    })
    .onError(({ code, error, set }) => {
      if (error instanceof ProtocolError) {
        set.status = statusByCode[error.code];
        if (error.retryAfterSeconds) {
          set.headers["retry-after"] = String(error.retryAfterSeconds);
        }
        return { error: error.code };
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "not_found" };
      }
      if (code === "VALIDATION" || code === "PARSE") {
        set.status = 400;
        return { error: "invalid_input" };
      }
      options.logger.error(
        { code: "internal" },
        "Protocol HTTP handler failed"
      );
      set.status = 500;
      return { error: "internal" };
    })
    .get("/health", () => ({ service: "protocols", status: "ok", version }))
    .get("/ready", ({ set }) => {
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
          "/bluesky/posts",
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.posts",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () => {
                if (!options.client.getPosts) {
                  throw new ProtocolError(
                    "unavailable",
                    "Post reads unavailable"
                  );
                }
                return options.client.getPosts(query.uri);
              }
            ),
          {
            query: t.Object({
              uri: t.Array(t.String({ maxLength: 512 }), {
                maxItems: 25,
                minItems: 1,
              }),
            }),
          }
        )
        .get(
          "/bluesky/discover",
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
                return options.discover(
                  query.mode ?? "latest",
                  query.cursor,
                  query.locale,
                  query.topic
                );
              }
            ),
          {
            query: t.Object({
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
          }
        )
        .get(
          "/bluesky/profile",
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.profile",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () => options.client.getProfile(query.actor)
            ),
          {
            query: t.Object({
              actor: t.String({ maxLength: 2048, minLength: 3 }),
            }),
          }
        )
        .get(
          "/bluesky/author-feed",
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.author_feed",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () =>
                options.client.getAuthorFeed(
                  query.actor,
                  query.tab ?? "posts",
                  {
                    cursor: query.cursor,
                    language: query.language,
                    limit: query.limit,
                  }
                )
            ),
          {
            query: t.Object({
              actor: t.String({ maxLength: 2048, minLength: 3 }),
              tab: t.Optional(
                t.Union([
                  t.Literal("posts"),
                  t.Literal("replies"),
                  t.Literal("media"),
                ])
              ),
              ...pageQuery,
            }),
          }
        )
        .get(
          "/bluesky/feed",
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.feed",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () =>
                options.client.getFeed(query.feed, {
                  cursor: query.cursor,
                  language: query.language,
                  limit: query.limit,
                })
            ),
          {
            query: t.Object({
              feed: t.String({ maxLength: 2300, minLength: 1 }),
              ...pageQuery,
            }),
          }
        )
        .get(
          "/bluesky/post",
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.post",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () => options.client.getPost(query.uri)
            ),
          {
            query: t.Object({
              uri: t.String({ maxLength: 2300, minLength: 1 }),
            }),
          }
        )
        .get(
          "/bluesky/thread",
          ({ query, request, set }) =>
            observeRequest(
              "bluesky.thread",
              request,
              String(set.headers["x-request-id"]),
              options.logger,
              () => {
                if (!options.client.getPostThread) {
                  throw new ProtocolError(
                    "unavailable",
                    "Thread reads unavailable"
                  );
                }
                return options.client.getPostThread(
                  query.uri,
                  query.depth === undefined ? 3 : Number(query.depth)
                );
              }
            ),
          {
            query: t.Object({
              depth: t.Optional(t.Integer({ maximum: 10, minimum: 0 })),
              uri: t.String({ maxLength: 2300, minLength: 1 }),
            }),
          }
        )
    );
}
