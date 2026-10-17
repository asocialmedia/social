// Async fixtures preserve the production transport and storage promise contracts.
// oxlint-disable require-await
// These tests deliberately control unresolved network promises and verify unsafe source URLs.
// oxlint-disable promise/avoid-new, no-script-url
import { describe, expect, test } from "bun:test";

import { BoundedCache } from "../cache";
import { ProtocolError } from "../contracts";
import { authorDid, postFixture, profileFixture } from "../testing/fixtures";
import { BlueskyClient } from "./client";
import type { ProtocolFetch } from "./client";
import { normalizePost, normalizeSegments } from "./normalize";
import { postViewSchema } from "./schemas";

describe("Bluesky public read boundary", () => {
  test("transient reads retry once while invalid responses never retry", async () => {
    let calls = 0;
    const waits: number[] = [];
    const client = new BlueskyClient({
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? new Response(null, { status: 503 })
          : Response.json(profileFixture);
      },
      wait: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });
    const profile = await client.getProfile("bsky.app");
    expect(profile.id).toBe(authorDid);
    expect(calls).toBe(2);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(250);
    expect(waits[0]).toBeLessThan(500);
    client.invalidate();
    const invalid = new BlueskyClient({
      fetch: async () => {
        calls += 1;
        return Response.json({ invalid: true });
      },
      wait: async () => {
        throw new Error("Invalid data must not retry");
      },
    });
    await expect(invalid.getProfile("bsky.app")).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(calls).toBe(3);
  });

  test("circuit opens after repeated failures and allows one recovery probe", async () => {
    let now = 1000;
    let calls = 0;
    let recover: ((response: Response) => void) | undefined;
    const client = new BlueskyClient({
      fetch: async () => {
        calls += 1;
        return calls <= 5
          ? new Response(null, { status: 503 })
          : new Promise((resolve) => {
              recover = resolve;
            });
      },
      maxRetries: 0,
      now: () => now,
    });
    for (let index = 0; index < 6; index += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sequential failures open the circuit.
      await expect(
        client.getProfile(`account${index}.test`)
      ).rejects.toMatchObject({ code: "unavailable" });
    }
    expect(calls).toBe(5);
    now += 30_001;
    const probe = client.getProfile("bsky.app");
    await expect(client.getProfile("other.test")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(calls).toBe(6);
    recover?.(Response.json(profileFixture));
    await probe;
    const next = client.getProfile("other.test");
    recover?.(Response.json(profileFixture));
    await next;
    expect(calls).toBe(7);
  });

  test("shutdown releases a stalled read without requiring fetch to honor abort", async () => {
    let calls = 0;
    const client = new BlueskyClient({
      fetch: () => {
        calls += 1;
        return new Promise(() => {});
      },
    });
    const pending = client.getProfile("bsky.app");
    client.close();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    await expect(client.getProfile("other.test")).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(calls).toBe(1);
  });

  test("fetches and caches a profile without creating a native identity", async () => {
    const calls: { url: string; options: RequestInit }[] = [];
    const client = new BlueskyClient({
      fetch: async (url, options) => {
        calls.push({ options, url });
        return Response.json(profileFixture);
      },
    });
    const first = await client.getProfile("bsky.app");
    first.displayName = "client mutation";
    const second = await client.getProfile("bsky.app");
    expect(second.id).toBe(authorDid);
    expect(second.displayName).toBe("Bluesky");
    expect(second).not.toHaveProperty("userId");
    expect(second).not.toHaveProperty("aura");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.startsWith("https://public.api.bsky.app/xrpc/")).toBe(
      true
    );
    expect(calls[0]?.options.redirect).toBe("error");
    expect(new Headers(calls[0]?.options.headers).has("authorization")).toBe(
      false
    );
  });

  test("rejects arbitrary URLs and unsupported tabs before any network access", async () => {
    let calls = 0;
    const client = new BlueskyClient({
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    await expect(
      client.getProfile("http://localhost/private")
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.getFeed("https://example.com")).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      client.getPost("at://bad/app.bsky.feed.post/a")
    ).rejects.toMatchObject({ code: "invalid_input" });
    // @ts-expect-error Unsupported tabs must also be rejected for untyped callers.
    const unsupported = client.getAuthorFeed("bsky.app", "likes");
    await expect(unsupported).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls).toBe(0);
  });

  test("enforces visibility, deduplicates pages and retains upstream cursors", async () => {
    const client = new BlueskyClient({
      fetch: async (url) =>
        url.includes("getProfile")
          ? Response.json(profileFixture)
          : Response.json({
              cursor: "next-page",
              feed: [
                { post: postFixture },
                { post: postFixture },
                {
                  post: {
                    ...postFixture,
                    labels: [
                      {
                        cts: "2026-10-16T10:00:00.000Z",
                        src: authorDid,
                        uri: postFixture.uri,
                        val: "porn",
                      },
                    ],
                    uri: `at://${authorDid}/app.bsky.feed.post/hidden`,
                  },
                },
              ],
            }),
    });
    const page = await client.getAuthorFeed("bsky.app", "media");
    expect(page.items.map((post) => post.id)).toEqual([postFixture.uri]);
    expect(page.cursor).toBe("next-page");
    const hidden = new BlueskyClient({
      fetch: async () =>
        Response.json({
          ...profileFixture,
          labels: [
            {
              cts: "2026-10-16T10:00:00.000Z",
              src: authorDid,
              uri: authorDid,
              val: "!no-unauthenticated",
            },
          ],
        }),
    });
    await expect(hidden.getAuthorFeed("bsky.app")).rejects.toMatchObject({
      code: "restricted",
    });
  });

  test("uses the media filter and excludes non-replies from Replies", async () => {
    const urls: string[] = [];
    const client = new BlueskyClient({
      fetch: async (url) => {
        urls.push(url);
        return url.includes("getProfile")
          ? Response.json(profileFixture)
          : Response.json({
              feed: [
                { post: postFixture },
                {
                  post: {
                    ...postFixture,
                    record: {
                      ...postFixture.record,
                      reply: { parent: { uri: postFixture.uri } },
                    },
                    uri: `at://${authorDid}/app.bsky.feed.post/reply`,
                  },
                },
              ],
            });
      },
    });
    await client.getAuthorFeed("bsky.app", "media", { limit: 2 });
    expect(new URL(urls[1] ?? "").searchParams.get("filter")).toBe(
      "posts_with_media"
    );
    const replies = await client.getAuthorFeed("bsky.app", "replies");
    expect(replies.items).toHaveLength(1);
    expect(replies.items[0]?.replyTo).toBe(postFixture.uri);
  });

  test("coalesces identical requests and bounds unrelated concurrent requests", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    let calls = 0;
    const client = new BlueskyClient({
      fetch: async () => {
        calls += 1;
        return new Promise((resolve) => {
          resolveFetch = resolve;
        });
      },
      maxConcurrentRequests: 1,
    });
    const first = client.getProfile("bsky.app");
    const second = client.getProfile("bsky.app");
    await expect(client.getProfile("other.test")).rejects.toMatchObject({
      code: "capacity",
    });
    resolveFetch?.(Response.json(profileFixture));
    const profiles = await Promise.all([first, second]);
    expect(profiles).toHaveLength(2);
    expect(calls).toBe(1);
  });

  test("honors a bounded upstream cooldown without automatic retry storms", async () => {
    let now = 10_000;
    let calls = 0;
    const client = new BlueskyClient({
      fetch: async () => {
        calls += 1;
        return new Response("private upstream body", {
          headers: { "retry-after": "99999" },
          status: 429,
        });
      },
      now: () => now,
    });
    await expect(client.getProfile("bsky.app")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 300,
    });
    await expect(client.getProfile("other.test")).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(calls).toBe(1);
    now += 301_000;
    await expect(client.getProfile("other.test")).rejects.toBeInstanceOf(
      ProtocolError
    );
    expect(calls).toBe(2);
  });

  test("bounds response bodies and validates JSON and schemas", async () => {
    for (const response of [
      new Response("not JSON"),
      Response.json({ did: 123 }),
      new Response("x".repeat(2048)),
      new Response("x", { headers: { "content-length": "2048" } }),
    ]) {
      const client = new BlueskyClient({
        fetch: async () => response,
        maxResponseBytes: 1024,
      });
      // Each fixture has an independent client and consumed response body.
      // oxlint-disable-next-line no-await-in-loop
      await expect(client.getProfile("bsky.app")).rejects.toMatchObject({
        code: "invalid_response",
      });
    }
  });

  test("timeouts release capacity and diagnostics never include payloads", async () => {
    const diagnostics: unknown[] = [];
    const client = new BlueskyClient({
      fetch: abortingFetcher,
      maxConcurrentRequests: 1,
      observe: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
      timeoutMs: 5,
    });
    await expect(client.getProfile("bsky.app")).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(client.getProfile("other.test")).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(diagnostics).toHaveLength(4);
    expect(JSON.stringify(diagnostics)).not.toContain("sensitive");
    expect(JSON.stringify(diagnostics)).not.toContain("bsky.app");
  });

  test("invalidation cannot let an old in-flight read repopulate the cache", async () => {
    let finish: ((response: Response) => void) | undefined;
    const cache = new BoundedCache();
    const client = new BlueskyClient({
      cache,
      fetch: async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = client.getProfile("bsky.app");
    client.invalidate();
    finish?.(Response.json(profileFixture));
    await pending;
    expect(cache.size).toBe(0);
  });

  test("missing post stays distinct from a network failure", async () => {
    const missing = new BlueskyClient({
      fetch: async () => Response.json({ posts: [] }),
    });
    expect(await missing.getPost(postFixture.uri)).toBeNull();
    const offline = new BlueskyClient({
      fetch: async () => new Response("", { status: 503 }),
    });
    await expect(offline.getPost(postFixture.uri)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  test("fetches a post thread with nested replies and maps reply targets", async () => {
    const replyUri = `at://${authorDid}/app.bsky.feed.post/reply1`;
    const subReplyUri = `at://${authorDid}/app.bsky.feed.post/reply2`;
    const threadData = {
      thread: {
        $type: "app.bsky.feed.defs#threadViewPost",
        post: postFixture,
        replies: [
          {
            $type: "app.bsky.feed.defs#threadViewPost",
            post: {
              ...postFixture,
              record: {
                $type: "app.bsky.feed.post",
                createdAt: "2026-10-16T10:02:00.000Z",
                reply: { parent: { uri: postFixture.uri } },
                text: "First reply",
              },
              uri: replyUri,
            },
            replies: [
              {
                $type: "app.bsky.feed.defs#threadViewPost",
                post: {
                  ...postFixture,
                  record: {
                    $type: "app.bsky.feed.post",
                    createdAt: "2026-10-16T10:04:00.000Z",
                    reply: { parent: { uri: replyUri } },
                    text: "Nested response",
                  },
                  uri: subReplyUri,
                },
                replies: [],
              },
              {
                // Malformed or blocked reply node should auto-heal and be skipped
                $type: "app.bsky.feed.defs#blockedPost",
                author: { did: "did:plc:blocked" },
                blocked: true,
                uri: "at://did:plc:blocked/app.bsky.feed.post/bad",
              },
            ],
          },
        ],
      },
    };
    const client = new BlueskyClient({
      fetch: async () => Response.json(threadData),
    });
    const thread = await client.getPostThread(postFixture.uri);
    expect(thread.post?.id).toBe(postFixture.uri);
    expect(thread.replies).toHaveLength(2);
    expect(thread.replies[0]?.id).toBe(replyUri);
    expect(thread.replies[0]?.replyTo).toBe(postFixture.uri);
    expect(thread.replies[1]?.id).toBe(subReplyUri);
    expect(thread.replies[1]?.replyTo).toBe(replyUri);
  });
});

describe("safe Bluesky presentation", () => {
  test("uses UTF-8 facet offsets around emoji without losing text", () => {
    const post = postViewSchema.parse({
      ...postFixture,
      record: {
        ...postFixture.record,
        facets: [
          {
            features: [
              {
                $type: "app.bsky.richtext.facet#link",
                uri: "https://example.com",
              },
            ],
            index: { byteEnd: 9, byteStart: 5 },
          },
        ],
        text: "\uD83E\uDD8B link!",
      },
    });
    expect(normalizeSegments(post)).toEqual([
      { text: "\uD83E\uDD8B " },
      { href: "https://example.com/", text: "link" },
      { text: "!" },
    ]);
    const [facet] = post.record.facets;
    if (facet) {
      facet.index.byteStart = 1;
    }
    expect(normalizeSegments(post)).toEqual([{ text: "\uD83E\uDD8B link!" }]);
  });

  test("rejects unsafe facet links and untrusted media hosts", () => {
    const post = postViewSchema.parse({
      ...postFixture,
      embed: {
        $type: "app.bsky.embed.images#view",
        images: [{ alt: "Unsafe", fullsize: "https://evil.test/private" }],
      },
      record: {
        ...postFixture.record,
        facets: [
          {
            features: [
              {
                $type: "app.bsky.richtext.facet#link",
                uri: "javascript:alert(1)",
              },
            ],
            index: { byteEnd: 5, byteStart: 0 },
          },
        ],
      },
    });
    const result = normalizePost(post);
    expect(result.media).toEqual([]);
    expect(result.segments).toEqual([{ text: "Hello world" }]);
  });

  test("keeps image descriptions and dimensions without copying assets", () => {
    const post = postViewSchema.parse({
      ...postFixture,
      embed: {
        $type: "app.bsky.embed.images#view",
        images: [
          {
            alt: "A butterfly",
            aspectRatio: { height: 600, width: 800 },
            fullsize: "https://cdn.bsky.app/image.jpg",
          },
        ],
      },
    });
    expect(normalizePost(post).media[0]).toMatchObject({
      alt: "A butterfly",
      height: 600,
      url: "https://cdn.bsky.app/image.jpg",
      width: 800,
    });
  });

  test("keeps a restricted quote unavailable without hiding the safe outer post", () => {
    const post = postViewSchema.parse({
      ...postFixture,
      embed: {
        $type: "app.bsky.embed.record#view",
        record: {
          $type: "app.bsky.embed.record#viewRecord",
          ...postFixture,
          labels: [{ val: "porn" }],
          value: postFixture.record,
        },
      },
    });
    const result = normalizePost(post);
    expect(result.unavailableQuote).toBe(true);
    expect(result.quote).toBeUndefined();
  });

  test("rejects an author whose DID does not match the canonical post URI", () => {
    const post = postViewSchema.parse({
      ...postFixture,
      author: { ...profileFixture, did: "did:web:other.test" },
    });
    expect(() => normalizePost(post)).toThrow("Post identity does not match");
  });
});

const abortingFetcher: ProtocolFetch = (_url, options) =>
  new Promise((_resolve, reject) => {
    options.signal?.addEventListener(
      "abort",
      () => reject(new Error("sensitive body")),
      { once: true }
    );
  });

test("live catalog queries use the bounded public transport with topic and continuation parameters", async () => {
  const requests: string[] = [];
  const catalog = {
    feeds: [
      {
        cid: postFixture.cid,
        creator: profileFixture,
        did: authorDid,
        displayName: "Astronomy",
        indexedAt: postFixture.indexedAt,
        uri: `at://${authorDid}/app.bsky.feed.generator/astronomy`,
      },
    ],
  };
  const client = new BlueskyClient({
    fetch: async (url) => {
      requests.push(url);
      return Response.json(catalog);
    },
  });
  const general = await client.getSuggestedFeeds({ limit: 4 });
  const related = await client.getSuggestedFeeds({
    limit: 5,
    query: "astronomy",
  });
  expect(general.items[0]?.displayName).toBe("Astronomy");
  expect(related.items[0]?.uri).toContain("/astronomy");
  expect(requests[0]).toContain("app.bsky.feed.getSuggestedFeeds");
  expect(new URL(requests[1] ?? "").searchParams.get("query")).toBe(
    "astronomy"
  );
  expect(requests[1]).toContain("app.bsky.unspecced.getPopularFeedGenerators");
  await client.getSuggestedFeeds({ limit: 5, query: "astronomy" });
  expect(requests).toHaveLength(2);
});
