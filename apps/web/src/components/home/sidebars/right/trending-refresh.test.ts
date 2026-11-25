import { afterEach, beforeEach, expect, mock, test } from "bun:test";

let dbOffline = false;
let blueskySnapshot: string | null = null;
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let now = originalNow();
beforeEach(() => {
  now += 2 * 60 * 60_000;
  Date.now = () => now;
});
const read = () =>
  dbOffline
    ? Promise.reject(new Error("database unavailable"))
    : Promise.resolve([]);
mock.module("@asm/db", () => ({
  SYSTEM_MODERATION_USER_ID: "system",
  and: () => ({}),
  getUserDataQuery: () => ({
    where: () => ({
      all: read,
      orderBy: () => ({ limit: () => ({ all: read }) }),
    }),
  }),
  mapUserData: (row: unknown) => row,
  prisma: {
    orm: {
      public: {
        Mentions: { where: () => ({ groupBy: () => ({ aggregate: read }) }) },
      },
    },
  },
  redis: {
    get: () => Promise.resolve(blueskySnapshot),
    set: () => Promise.resolve("OK"),
  },
}));
mock.module("./topic-actions", () => ({ getTrendingTopics: read }));
const { fetchBlueskyTrendingTopics, getTrendingFeed } =
  await import("./trending-actions");
afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  dbOffline = false;
  blueskySnapshot = null;
});

test("serves the local snapshot across Redis misses and backs off after a 429", async () => {
  const fetcher = mock(() =>
    Promise.resolve(Response.json({ topics: [{ topic: "software" }] }))
  );
  globalThis.fetch = Object.assign(fetcher, {
    preconnect: originalFetch.preconnect,
  });
  const saved = await fetchBlueskyTrendingTopics();
  expect(saved).toHaveLength(1);
  fetcher.mockImplementation(() =>
    Promise.resolve(
      new Response(null, {
        headers: { "retry-after": "30" },
        status: 429,
      })
    )
  );
  now += 6 * 60_000;
  expect(await fetchBlueskyTrendingTopics(true)).toEqual(saved);
  expect(await fetchBlueskyTrendingTopics(true)).toEqual(saved);
  expect(fetcher).toHaveBeenCalledTimes(2);
  now += 30_000;
  fetcher.mockImplementation(() =>
    Promise.resolve(Response.json({ topics: [] }))
  );
  expect(await fetchBlueskyTrendingTopics(true)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("an expired Bluesky cache and upstream failure are reported separately from a valid empty feed", async () => {
  globalThis.fetch = Object.assign(
    () => Promise.resolve(new Response(null, { status: 503 })),
    { preconnect: originalFetch.preconnect }
  );
  const partial = await getTrendingFeed(true);
  expect(partial.unavailable).toEqual(["bluesky"]);
  expect(partial.items).toEqual([]);
  dbOffline = true;
  await expect(getTrendingFeed(true)).rejects.toThrow(
    "Trending sources are unavailable"
  );
});

test("a successful empty refresh has no unavailable sources", async () => {
  globalThis.fetch = Object.assign(
    () => Promise.resolve(Response.json({ topics: [] })),
    { preconnect: originalFetch.preconnect }
  );
  expect(await getTrendingFeed(true)).toEqual({
    items: [],
    topAura: [],
    unavailable: [],
  });
});

test("opening the sidebar serves retained trends while their refresh is still pending", async () => {
  const topic = {
    displayName: "Software",
    source: "bluesky",
    topic: "software",
    type: "bluesky_topic",
  };
  blueskySnapshot = JSON.stringify({
    at: Date.now() - 6 * 60_000,
    topics: [topic],
  });
  const upstream = Promise.withResolvers<Response>();
  const fetcher = mock(() => upstream.promise);
  globalThis.fetch = Object.assign(fetcher, {
    preconnect: originalFetch.preconnect,
  });
  expect(await fetchBlueskyTrendingTopics()).toEqual([topic]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  upstream.resolve(Response.json({ topics: [] }));
  expect(await fetchBlueskyTrendingTopics(true)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
