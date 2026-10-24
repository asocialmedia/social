import { afterEach, expect, mock, test } from "bun:test";

let dbOffline = false;
const originalFetch = globalThis.fetch;
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
  redis: { get: () => Promise.resolve(null), set: () => Promise.resolve("OK") },
}));
mock.module("./topic-actions", () => ({ getTrendingTopics: read }));
const { getTrendingFeed } = await import("./trending-actions");
afterEach(() => {
  globalThis.fetch = originalFetch;
  dbOffline = false;
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
