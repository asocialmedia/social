// Async fixtures preserve the production transport and storage promise contracts.
// oxlint-disable require-await
import { describe, expect, test } from "bun:test";

import type { ExternalAuthor, ExternalThread } from "@asm/protocols/contracts";
import { ProtocolError } from "@asm/protocols/contracts";

import { createProtocolsApp } from "./app";
import type { ProtocolsAppOptions, ProtocolsHealth } from "./app";
import { readConfig } from "./config";

const token = "protocols_test_token_with_32_characters";
const author: ExternalAuthor = {
  displayName: "Example",
  handle: "example.test",
  id: "did:web:example.test",
  labels: [],
  source: "bluesky",
  upstreamCounts: {},
  url: "https://bsky.app/profile/did%3Aweb%3Aexample.test",
};

function fixture(overrides: Partial<ProtocolsAppOptions> = {}) {
  const logs: {
    level: string;
    fields: Record<string, unknown>;
    message: string;
  }[] = [];
  const capture =
    (level: string) => (fields: Record<string, unknown>, message: string) => {
      logs.push({ fields, level, message });
    };
  const logger = {
    debug: capture("debug"),
    error: capture("error"),
    info: capture("info"),
    warn: capture("warn"),
  };
  const health: ProtocolsHealth = {
    connected: false,
    draining: false,
    jetstreamEnabled: false,
    lastEventAt: null,
    leaseHeld: false,
    processedEvents: 0,
  };
  const client = {
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async () => ({ cursor: null, items: [] }),
    getPost: async () => null,
    getPostThread: async (): Promise<ExternalThread> => ({
      post: null,
      replies: [],
    }),
    getProfile: async () => author,
  };
  const app = createProtocolsApp({
    client,
    health: () => health,
    logger,
    token,
    ...overrides,
  });
  const request = (path: string, headers: Record<string, string> = {}) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        headers: { authorization: `Bearer ${token}`, ...headers },
      })
    );
  return { app, client, health, logs, request };
}

describe("Elysia protocol service", () => {
  test("preserves authorization and validation over Bun's live HTTP adapter", async () => {
    const { app } = fixture();
    app.listen({ hostname: "127.0.0.1", port: 0 });
    try {
      const { server } = app;
      if (!server) {
        throw new Error("Protocol test server did not start");
      }
      const origin = `http://127.0.0.1:${server.port}`;
      const health = await fetch(`${origin}/health`);
      expect(health.status).toBe(200);
      expect(health.headers.get("cache-control")).toBe("no-store");
      const unauthorized = await fetch(`${origin}/v1/capabilities`);
      expect(unauthorized.status).toBe(401);
      const invalid = await fetch(
        `${origin}/v1/bluesky/author-feed?actor=example.test&limit=0`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "invalid_input" });
    } finally {
      await app.stop(true);
    }
  });

  test("validates single and repeated post URI query parameters before calling the source", async () => {
    const base = fixture();
    const calls: string[][] = [];
    const { request } = fixture({
      client: {
        ...base.client,
        getPosts: (uris) => {
          calls.push([...uris]);
          return Promise.resolve([]);
        },
      },
    });
    const first = "at://did:web:example.test/app.bsky.feed.post/first";
    const second = "at://did:web:example.test/app.bsky.feed.post/second";
    const single = await request(
      `/v1/bluesky/posts?uri=${encodeURIComponent(first)}`
    );
    expect(single.status).toBe(200);
    const repeated = await request(
      `/v1/bluesky/posts?uri=${encodeURIComponent(first)}&uri=${encodeURIComponent(second)}`
    );
    expect(repeated.status).toBe(200);
    const invalid = await request(`/v1/bluesky/posts?uri=${"x".repeat(513)}`);
    expect(invalid.status).toBe(400);
    expect(calls).toEqual([[first], [first, second]]);
  });

  test("search validates inputs, preserves profile results when posts fail, and selects the media policy client", async () => {
    const queries: string[] = [];
    const base = fixture();
    const { request, app } = fixture({
      client: {
        ...base.client,
        searchActors: async (query) => {
          queries.push(query);
          return [author];
        },
        searchPosts: async () => {
          throw new ProtocolError("unavailable", "private source error");
        },
      },
      explicitClient: {
        ...base.client,
        searchActors: async () => [
          { ...author, displayName: "Explicit client" },
        ],
        searchPosts: async () => ({ cursor: null, items: [] }),
      },
    });
    const response = await request("/v1/bluesky/search?q=example");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      posts: [],
      profiles: [author],
      unavailable: ["posts"],
    });
    const explicit = await request("/v1/bluesky/search?q=example&explicit=1");
    const explicitData = await explicit.json();
    expect(explicitData.profiles[0]?.displayName).toBe("Explicit client");
    const tooLong = await request(`/v1/bluesky/search?q=${"x".repeat(81)}`);
    expect(tooLong.status).toBe(400);
    const oversized = await request("/v1/bluesky/search?q=test&limit=999");
    expect(oversized.status).toBe(400);
    const unauthorized = await app.handle(
      new Request("http://localhost/v1/bluesky/search?q=test")
    );
    expect(unauthorized.status).toBe(401);
    expect(queries).toEqual(["example"]);
  });

  test("search keeps post results when profiles fail and reports a total outage safely", async () => {
    const base = fixture();
    const { request } = fixture({
      client: {
        ...base.client,
        searchActors: async () => {
          throw new Error("private source error");
        },
        searchPosts: async () => ({ cursor: null, items: [] }),
      },
    });
    const response = await request("/v1/bluesky/search?q=example");
    expect(await response.json()).toEqual({
      posts: [],
      profiles: [],
      unavailable: ["profiles"],
    });
    const offline = await base.request("/v1/bluesky/search?q=example");
    expect(offline.status).toBe(502);
    expect(await offline.json()).toEqual({ error: "unavailable" });
  });
  test("separates liveness, readiness, and authenticated reads", async () => {
    const { app, health } = fixture();
    const awaitedResponse1 = await app.handle(
      new Request("http://localhost/health")
    );
    expect(awaitedResponse1.status).toBe(200);
    const awaitedResponse2 = await app.handle(
      new Request("http://localhost/ready")
    );
    expect(awaitedResponse2.status).toBe(200);
    const awaitedResponse3 = await app.handle(
      new Request("http://localhost/v1/capabilities")
    );
    expect(awaitedResponse3.status).toBe(401);
    health.jetstreamEnabled = true;
    const awaitedResponse4 = await app.handle(
      new Request("http://localhost/ready")
    );
    expect(awaitedResponse4.status).toBe(200);
    const awaitedResponse5 = await app.handle(
      new Request("http://localhost/health")
    );
    expect(awaitedResponse5.status).toBe(200);
    health.connected = true;
    health.leaseHeld = true;
    const awaitedResponse6 = await app.handle(
      new Request("http://localhost/ready")
    );
    expect(awaitedResponse6.status).toBe(200);
  });

  test("does not expose reads when the internal credential is absent", async () => {
    const { request } = fixture({ token: undefined });
    const response = await request("/v1/bluesky/profile?actor=example.test");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
  });

  test("rejects wrong and oversized bearer credentials", async () => {
    const { request } = fixture();
    await Promise.all(
      ["Bearer bad", "Basic abc", `Bearer ${"x".repeat(1000)}`].map(
        async (credential) => {
          const response = await request("/v1/capabilities", {
            authorization: credential,
          });
          expect(response.status).toBe(401);
        }
      )
    );
  });

  test("serves validated reads, capability metadata, and correlated safe logs", async () => {
    const { request, logs } = fixture();
    const response = await request("/v1/bluesky/profile?actor=example.test", {
      "x-request-id": "request-123",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-123");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(author);
    expect(logs[0]?.fields).toMatchObject({
      operation: "bluesky.profile",
      requestId: "request-123",
    });
    expect(JSON.stringify(logs)).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain("example.test");
    const awaitedResponse8 = await request("/v1/capabilities");
    const capabilities = await awaitedResponse8.json();
    expect(capabilities.protocols[0].authenticatedWrites).toBe(false);
  });

  test("serves post thread reads with requested depth", async () => {
    let capturedDepth: number | undefined;
    let capturedUri: string | undefined;
    const { request } = fixture({
      client: {
        getAuthorFeed: async () => ({ cursor: null, items: [] }),
        getFeed: async () => ({ cursor: null, items: [] }),
        getPost: async () => null,
        getPostThread: async (uri, depth) => {
          capturedUri = uri;
          capturedDepth = depth;
          return { post: null, replies: [] };
        },
        getProfile: async () => author,
      },
    });
    const targetUri = "at://did:web:example.test/app.bsky.feed.post/123";
    const res = await request(
      `/v1/bluesky/thread?uri=${encodeURIComponent(targetUri)}&depth=4`
    );
    expect(res.status).toBe(200);
    expect(capturedUri).toBe(targetUri);
    expect(capturedDepth).toBe(4);
    expect(await res.json()).toEqual({ post: null, replies: [] });
  });

  test("validates tab and pagination before invoking the adapter", async () => {
    let calls = 0;
    const { request } = fixture({
      client: {
        getAuthorFeed: async (_actor, tab, options) => {
          calls += 1;
          expect(tab).toBe("media");
          expect(options?.limit).toBe(2);
          return { cursor: null, items: [] };
        },
        getFeed: async () => ({ cursor: null, items: [] }),
        getPost: async () => null,
        getProfile: async () => author,
      },
    });
    const awaitedResponse9 = await request(
      "/v1/bluesky/author-feed?actor=example.test&tab=likes"
    );
    expect(awaitedResponse9.status).toBe(400);
    const awaitedResponse10 = await request(
      "/v1/bluesky/author-feed?actor=example.test&limit=1000000"
    );
    expect(awaitedResponse10.status).toBe(400);
    expect(calls).toBe(0);
    const awaitedResponse11 = await request(
      "/v1/bluesky/author-feed?actor=example.test&tab=media&limit=2"
    );
    expect(awaitedResponse11.status).toBe(200);
    expect(calls).toBe(1);
  });

  test("returns stable safe errors and retry hints without leaking source bodies", async () => {
    const { request } = fixture({
      client: {
        getAuthorFeed: async () => ({ cursor: null, items: [] }),
        getFeed: async () => ({ cursor: null, items: [] }),
        getPost: async () => null,
        getProfile: async () => {
          throw new ProtocolError(
            "rate_limited",
            "secret upstream response",
            25
          );
        },
      },
    });
    const response = await request("/v1/bluesky/profile?actor=example.test");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("25");
    expect(await response.json()).toEqual({ error: "rate_limited" });
  });

  test("replaces unsafe request IDs and reports unknown routes safely", async () => {
    const { request } = fixture();
    const response = await request("/v1/bluesky/profile?actor=example.test", {
      "x-request-id": "<script>unsafe</script>",
    });
    expect(response.headers.get("x-request-id")).not.toContain("script");
    const missing = await request("/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
  });

  test("maps unregistered errors without exposing private details", async () => {
    const base = fixture();
    const { logs, request } = fixture({
      client: {
        ...base.client,
        getProfile: async () => {
          throw new Error("private upstream credentials");
        },
      },
    });
    const response = await request("/v1/bluesky/profile?actor=example.test", {
      "x-request-id": "failed-read",
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("failed-read");
    expect(logs.some((entry) => entry.level === "error")).toBe(true);
  });

  test("drains reads while keeping liveness reachable", async () => {
    const { request, health } = fixture();
    health.draining = true;
    const awaitedResponse12 = await request("/v1/capabilities");
    expect(awaitedResponse12.status).toBe(503);
    const awaitedResponse13 = await request("/ready");
    expect(awaitedResponse13.status).toBe(503);
    const awaitedResponse14 = await request("/health");
    expect(awaitedResponse14.status).toBe(200);
  });
});

describe("protocol configuration", () => {
  test("search concurrency is independently bounded", () => {
    expect(readConfig({}).searchConcurrency).toBe(48);
    expect(
      readConfig({ PROTOCOLS_SEARCH_CONCURRENCY: "24" }).searchConcurrency
    ).toBe(24);
    for (const value of ["0", "65", "NaN", "1.5"]) {
      expect(() => readConfig({ PROTOCOLS_SEARCH_CONCURRENCY: value })).toThrow(
        "PROTOCOLS_SEARCH_CONCURRENCY"
      );
    }
  });
  test("keeps Jetstream opt-in and never subscribes to the full firehose by accident", () => {
    expect(readConfig({}).jetstreamEnabled).toBe(false);
    expect(() => readConfig({ PROTOCOLS_JETSTREAM_ENABLED: "true" })).toThrow();
    expect(() => readConfig({ PROTOCOLS_JETSTREAM_ENABLED: "yes" })).toThrow();
    expect(() =>
      readConfig({ PROTOCOLS_JETSTREAM_ENDPOINT: "wss://evil.test" })
    ).toThrow();
    expect(() => readConfig({ PROTOCOLS_INTERNAL_TOKEN: "short" })).toThrow();
    expect(() => readConfig({ PROTOCOLS_PORT: "0" })).toThrow();
  });
});

test("storage loss removes readiness and reads recover without restarting the app", async () => {
  const { request, health } = fixture();
  health.storageReady = false;
  const response1 = await request("/ready");
  expect(response1.status).toBe(503);
  const response2 = await request("/v1/capabilities");
  expect(response2.status).toBe(503);
  const response3 = await request("/health");
  expect(response3.status).toBe(200);
  health.storageReady = true;
  const response4 = await request("/v1/capabilities");
  expect(response4.status).toBe(200);
});

test("production read replicas require shared continuation storage", () => {
  expect(() =>
    readConfig({ NODE_ENV: "production", PROTOCOLS_INTERNAL_TOKEN: token })
  ).toThrow("REDIS_URL");
});

test("the internal discovery boundary preserves repeated interest terms and rejects oversized arrays", async () => {
  const seen: unknown[] = [];
  const { request } = fixture({
    discover: async (...args) => {
      seen.push(args);
      return { cursor: null, items: [], partial: false };
    },
  });
  const response = await request(
    "/v1/bluesky/discover?mode=personalized&locale=en&topic=astronomy&topic=art"
  );
  expect(response.status).toBe(200);
  expect(seen).toEqual([
    ["personalized", undefined, "en", ["astronomy", "art"]],
  ]);
  const invalid = await request(
    `/v1/bluesky/discover?${new URLSearchParams(
      Array.from({ length: 6 }, (_, i) => ["topic", `topic${i}`])
    )}`
  );
  expect(invalid.status).toBe(400);
});

test("blocks external requests to /v1 and /ready from external ingress", async () => {
  const { request } = fixture();
  const v1Blocked = await request("/v1/capabilities", {
    host: "proto.asocialmedia.cc",
  });
  expect(v1Blocked.status).toBe(403);

  const readyBlocked = await request("/ready", {
    "cf-connecting-ip": "203.0.113.1",
  });
  expect(readyBlocked.status).toBe(403);

  const healthAllowed = await request("/health", {
    "cf-connecting-ip": "203.0.113.1",
    host: "proto.asocialmedia.cc",
  });
  expect(healthAllowed.status).toBe(200);
});

test("rate limits excessive health check requests from the same external IP", async () => {
  const { request } = fixture();
  const ip = "198.51.100.42";
  const burst = await Promise.all(
    Array.from({ length: 60 }, () =>
      request("/health", { "cf-connecting-ip": ip })
    )
  );
  for (const res of burst) {
    expect(res.status).toBe(200);
  }
  const rateLimited = await request("/health", { "cf-connecting-ip": ip });
  expect(rateLimited.status).toBe(429);
  expect(rateLimited.headers.get("retry-after")).toBe("60");
});
