// Async fixtures preserve the public client promise contract.
// oxlint-disable require-await, promise/avoid-new, no-await-in-loop
import { expect, test } from "bun:test";

import { BlueskyClient } from "@asm/protocols/bluesky";
import type { ExternalPost } from "@asm/protocols/contracts";

import { BlueskyDiscovery } from "./discovery";
import {
  matchesDiscoveryLanguage,
  regionalRelevance,
  isFreshDiscoveryPost,
} from "./discovery-relevance";
import { MemoryDiscoveryStore } from "./discovery-store";

const fixtureTime = Date.now();
function post(index: number, did = "did:web:example.test"): ExternalPost {
  return {
    author: {
      displayName: "Example",
      handle: "example.test",
      id: did,
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/example.test",
    },
    createdAt: new Date(fixtureTime - index * 1000).toISOString(),
    id: `at://${did}/app.bsky.feed.post/${index}`,
    indexedAt: "2026-10-16T00:00:00.000Z",
    labels: [],
    languages: [],
    media: [],
    revision: "cid",
    segments: [{ text: "Example" }],
    source: "bluesky",
    text: "Example",
    upstreamCounts: { likes: 10, quotes: 0, replies: 0, reposts: 0 },
    url: "https://bsky.app/profile/example.test/post/example",
  };
}
const profile = post(0).author;

test("discovery expires old recommendations and rejects malformed/future timestamps", () => {
  const now = Date.now();
  expect(
    isFreshDiscoveryPost(
      { ...post(0), createdAt: new Date(now - 3 * 86_400_000).toISOString() },
      "trending",
      now
    )
  ).toBe(false);
  expect(
    isFreshDiscoveryPost(
      { ...post(0), createdAt: new Date(now - 8 * 86_400_000).toISOString() },
      "personalized",
      now
    )
  ).toBe(false);
  expect(
    isFreshDiscoveryPost({ ...post(0), createdAt: "invalid" }, "latest", now)
  ).toBe(false);
  expect(
    isFreshDiscoveryPost(
      { ...post(0), createdAt: new Date(now + 120_000).toISOString() },
      "latest",
      now
    )
  ).toBe(false);
});

function videoPost(index: number): ExternalPost {
  return {
    ...post(index),
    media: [
      {
        alt: "Clip",
        type: "video",
        url: "https://video.bsky.app/playlist.m3u8",
      },
    ],
  };
}

test("video discovery pages past text results and isolates its cursor from the regular feed", async () => {
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items: [] }),
      getFeed: async (_uri, options) =>
        options?.cursor
          ? { cursor: null, items: [videoPost(2), post(3)] }
          : { cursor: "more", items: [post(1)] },
      getProfile: async () => profile,
    },
    ["at://did:plc:source/app.bsky.feed.generator/video"]
  );
  const regular = await discovery.read("latest");
  expect(regular.items.map((item) => item.id)).toEqual([post(1).id]);
  const videos = await discovery.read("latest", undefined, "", [], "video");
  expect(videos.items.map((item) => item.id)).toEqual([post(2).id]);
  const regularAgain = await discovery.read("latest");
  expect(regularAgain.items).toEqual(regular.items);
  await expect(
    discovery.read("latest", regular.cursor ?? undefined, "", [], "video")
  ).rejects.toMatchObject({ code: "invalid_input" });
});

test("video catalogs prioritize declared video feeds and retain topic discovery", async () => {
  const queries: (string | undefined)[] = [];
  const sources: string[] = [];
  const discovery = new BlueskyDiscovery({
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async (uri) => {
      sources.push(uri);
      return { cursor: null, items: [videoPost(sources.length)] };
    },
    getProfile: async () => profile,
    getSuggestedFeeds: async (options) => {
      queries.push(options?.query);
      return {
        cursor: null,
        items:
          options?.query === "video"
            ? Array.from({ length: 6 }, (_, index) => ({
                contentMode:
                  index === 5
                    ? "app.bsky.feed.defs#contentModeVideo"
                    : undefined,
                displayName: `Feed ${index}`,
                uri: `at://did:plc:source/app.bsky.feed.generator/feed${index}`,
              }))
            : [
                {
                  displayName: "Topic",
                  uri: "at://did:plc:source/app.bsky.feed.generator/topic",
                },
              ],
      };
    },
  });
  await discovery.read("personalized", undefined, "", ["science"], "video");
  expect(queries).toEqual(["video", "science"]);
  expect(sources[0]).toEndWith("feed5");
  expect(sources.some((uri) => uri.endsWith("topic"))).toBe(true);
});

test("background head refresh keeps the old head and every continuation readable", async () => {
  let refreshing = false;
  const pending = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<undefined>();
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => {
        if (refreshing) {
          started.resolve();
          await pending.promise;
        }
        return {
          cursor: null,
          items: Array.from({ length: 30 }, (_, index) =>
            post(index + (refreshing ? 100 : 0))
          ),
        };
      },
      getProfile: async () => profile,
    },
    ["one"]
  );
  const first = await discovery.read("latest", undefined, "en");
  refreshing = true;
  const refresh = discovery.refreshHead("latest", "en", []);
  await started.promise;
  const during = await discovery.read("latest", undefined, "en");
  expect(during.items.map((item) => item.id)).toEqual(
    first.items.map((item) => item.id)
  );
  expect(during.cursor).toBe(first.cursor);
  pending.resolve();
  await refresh;
  const after = await discovery.read("latest", undefined, "en");
  expect(after.items[0]?.id).not.toBe(first.items[0]?.id);
  const continuation = await discovery.read(
    "latest",
    first.cursor ?? undefined,
    "en"
  );
  expect(continuation.items.length).toBeGreaterThan(0);
});

test("a stalled locale does not queue unrelated discovery", async () => {
  const stalled = Promise.withResolvers<undefined>();
  const started = Promise.withResolvers<undefined>();
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items: [] }),
      getFeed: async (_feed, options) => {
        if (options?.language === "en-IN") {
          started.resolve();
          await stalled.promise;
        }
        return { cursor: null, items: [post(1)] };
      },
      getProfile: async () => profile,
    },
    ["at://did:plc:source/app.bsky.feed.generator/feed"]
  );
  const slow = discovery.read("latest", undefined, "en-IN");
  await started.promise;
  const fast = await discovery.read("latest", undefined, "en-GB");
  expect(fast.items).toHaveLength(1);
  stalled.resolve();
  const recovered = await slow;
  expect(recovered.items).toHaveLength(1);
});

test("fresh heads avoid a redundant post read but buffered continuations revalidate", async () => {
  let reads = 0;
  const items = Array.from({ length: 30 }, (_, index) => post(index));
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items }),
      getPosts: async (uris) => {
        reads += 1;
        return items.filter(
          (item) => uris.includes(item.id) && item.id !== post(20).id
        );
      },
      getProfile: async () => profile,
    },
    ["one"]
  );
  const head = await discovery.read("latest");
  expect(reads).toBe(0);
  const next = await discovery.read("latest", head.cursor ?? undefined);
  expect(reads).toBe(1);
  expect(next.items.some((item) => item.id === post(20).id)).toBe(false);
});

test("language matching trusts explicit tags and detects long untagged text", () => {
  expect(
    matchesDiscoveryLanguage(
      { ...post(0), languages: ["es"], text: "Hola" },
      "en-IN"
    )
  ).toBe(false);
  expect(
    matchesDiscoveryLanguage({ ...post(0), languages: ["en-US"] }, "en-IN")
  ).toBe(true);
  expect(
    matchesDiscoveryLanguage({ ...post(0), languages: ["es"] }, "all")
  ).toBe(true);
  expect(
    matchesDiscoveryLanguage(
      {
        ...post(0),
        text: "The weather is beautiful today and we are going to take a long walk along the river with our friends and family.",
      },
      "en-IN"
    )
  ).toBe(true);
  expect(
    matchesDiscoveryLanguage(
      {
        ...post(0),
        text: "Bonjour tout le monde, nous sommes très heureux de partager cette nouvelle journée avec nos amis et notre famille dans cette belle ville.",
      },
      "en-IN"
    )
  ).toBe(false);
  expect(
    regionalRelevance(
      {
        ...post(0),
        text: "Bengaluru and Mumbai are hosting this year's event.",
      },
      "en-IN"
    )
  ).toBeGreaterThan(
    regionalRelevance({ ...post(1), text: "A beautiful day" }, "en-IN")
  );
});

test("language caches and continuation cursors remain separate", async () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    ...post(index),
    languages: [index < 25 ? "en" : "es"],
  }));
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items }),
      getProfile: async () => profile,
    },
    ["one"]
  );
  const english = await discovery.read("latest", undefined, "en-IN");
  const spanish = await discovery.read("latest", undefined, "es-ES");
  expect(english.items).toHaveLength(20);
  expect(english.items.every((item) => item.languages.includes("en"))).toBe(
    true
  );
  expect(spanish.items.every((item) => item.languages.includes("es"))).toBe(
    true
  );
  await expect(
    discovery.read("latest", english.cursor ?? undefined, "es-ES")
  ).rejects.toMatchObject({ code: "invalid_input" });
  const next = await discovery.read(
    "latest",
    english.cursor ?? undefined,
    "en-IN"
  );
  expect(next.items).toHaveLength(5);
});

test("a thousand simultaneous readers share one discovery refresh", async () => {
  let calls = 0;
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => {
        calls += 1;
        return { cursor: null, items: [post(1)] };
      },
      getProfile: async () => profile,
    },
    ["one"]
  );
  const pages = await Promise.all(
    Array.from({ length: 1000 }, () => discovery.read("latest"))
  );
  expect(calls).toBe(1);
  expect(pages.every((page) => page.items.length === 1)).toBe(true);
  pages[0]?.items.pop();
  expect(pages[1]?.items).toHaveLength(1);
});

test("replicas share refresh ownership and accept each other's continuations", async () => {
  let calls = 0;
  const store = new MemoryDiscoveryStore();
  const client = {
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => {
      calls += 1;
      return {
        cursor: null,
        items: Array.from({ length: 30 }, (_, index) => post(index)),
      };
    },
    getProfile: async () => profile,
  };
  const first = new BlueskyDiscovery(client, ["one"], { store });
  const second = new BlueskyDiscovery(client, ["one"], { store });
  const [page, concurrent] = await Promise.all([
    first.read("latest"),
    second.read("latest"),
  ]);
  expect(calls).toBe(1);
  expect(concurrent).toEqual(page);
  expect(page.cursor).toBeTruthy();
  const next = await second.read("latest", page.cursor ?? undefined);
  expect(next.items).toHaveLength(10);
  expect(
    new Set([...page.items, ...next.items].map((item) => item.id)).size
  ).toBe(30);
});

test("stalled discovery times out and a later read recovers", async () => {
  let healthy = false;
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items: [post(1)] }),
      getProfile: () =>
        healthy ? Promise.resolve(profile) : new Promise(() => {}),
    },
    ["one"],
    { timeoutMs: 20 }
  );
  await expect(discovery.read("latest")).rejects.toMatchObject({
    code: "unavailable",
  });
  healthy = true;
  const recovered = await discovery.read("latest");
  expect(recovered.items).toHaveLength(1);
});

test("a stalled generator cannot discard a healthy page at the overall deadline", async () => {
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items: [] }),
      getFeed: (uri) =>
        uri.endsWith("stalled")
          ? new Promise(() => {})
          : Promise.resolve({ cursor: null, items: [post(1)] }),
      getProfile: async () => profile,
    },
    [
      "at://did:plc:source/app.bsky.feed.generator/stalled",
      "at://did:plc:source/app.bsky.feed.generator/healthy",
    ],
    { sourceTimeoutMs: 20, timeoutMs: 500 }
  );
  const page = await discovery.read("trending");
  expect(page.items.map((item) => item.id)).toEqual([post(1).id]);
  expect(page.partial).toBe(true);
});

test("continuations retain unconsumed source posts and deduplicate original records", async () => {
  const client = {
    allowsRecommendations: async () => true,
    getAuthorFeed: async (actor: string) => ({
      cursor: null,
      items: Array.from({ length: 20 }, (_, index) =>
        post(index * 2 + (actor === "one" ? 0 : 1))
      ),
    }),
    getProfile: async () => profile,
  };
  const discovery = new BlueskyDiscovery(client, ["one", "two"]);
  const first = await discovery.read("latest");
  expect(first.items).toHaveLength(20);
  expect(first.cursor).toBeTruthy();
  const next = await discovery.read("latest", first.cursor ?? undefined);
  expect(next.items).toHaveLength(20);
  expect(
    new Set([...first.items, ...next.items].map((item) => item.id)).size
  ).toBe(40);
  expect(next.cursor).toBeNull();
  const replay = await discovery.read("latest", first.cursor ?? undefined);
  expect(replay.items.map((item) => item.id)).toEqual(
    next.items.map((item) => item.id)
  );
});

test("ranked discovery honors opt-outs and latest remains chronological", async () => {
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => false,
      getAuthorFeed: async () => ({ cursor: null, items: [post(1)] }),
      getProfile: async () => profile,
    },
    ["one"]
  );
  const personalized = await discovery.read("personalized");
  const trending = await discovery.read("trending");
  const latest = await discovery.read("latest");
  expect(personalized.items).toEqual([]);
  expect(trending.items).toEqual([]);
  expect(latest.items).toHaveLength(1);
});

test("one failed source does not hide healthy sources or persist anything", async () => {
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async (actor: string) => {
        if (actor === "bad") {
          throw new Error("down");
        }
        return { cursor: null, items: [post(1)] };
      },
      getProfile: async () => profile,
    },
    ["bad", "good"]
  );
  const page = await discovery.read("latest");
  expect(page.partial).toBe(true);
  expect(page.items).toHaveLength(1);
  await expect(discovery.read("latest", "missing")).rejects.toMatchObject({
    code: "invalid_input",
  });
});

test("visibility lookup distinguishes no declaration from an outage", async () => {
  const missing = new BlueskyClient({
    fetch: async () =>
      Response.json({ error: "RecordNotFound" }, { status: 400 }),
  });
  expect(await missing.allowsRecommendations(profile.id)).toBe(true);
  const hidden = new BlueskyClient({
    fetch: async () =>
      Response.json({
        uri: `at://${profile.id}/app.bsky.actor.contentVisibilityDeclaration/self`,
        value: { hideFromAlgorithmicRecommendations: true },
      }),
  });
  expect(await hidden.allowsRecommendations(profile.id)).toBe(false);
  const offline = new BlueskyClient({
    fetch: async () => new Response("", { status: 503 }),
  });
  await expect(offline.allowsRecommendations(profile.id)).rejects.toMatchObject(
    { code: "unavailable" }
  );
});

const publicFeed =
  "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot";

test("default discovery resolves live catalog feeds without restricting publishers", async () => {
  const requested: string[] = [];
  const discovery = new BlueskyDiscovery({
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async (feed) => {
      requested.push(feed);
      return {
        cursor: null,
        items: Array.from({ length: 30 }, (_, index) =>
          post(index, `did:web:person${index}.test`)
        ),
      };
    },
    getProfile: async () => profile,
    getSuggestedFeeds: async () => ({
      cursor: null,
      items: [{ displayName: "Live feed", uri: publicFeed }],
    }),
  });
  const page = await discovery.read("latest");
  expect(requested).toEqual([publicFeed]);
  expect(page.items).toHaveLength(20);
  expect(new Set(page.items.map((item) => item.author.id)).size).toBe(20);
});

test("a frequent author cannot bury other authors, and deferred posts survive continuation", async () => {
  const feedItems = [
    ...Array.from({ length: 20 }, (_, index) => post(index)),
    ...Array.from({ length: 30 }, (_, index) =>
      post(index + 20, `did:web:person${index}.test`)
    ),
  ];
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items: [] }),
      getFeed: async () => ({ cursor: null, items: feedItems }),
      getProfile: async () => profile,
    },
    [publicFeed]
  );
  const first = await discovery.read("latest");
  expect(new Set(first.items.map((item) => item.author.id)).size).toBe(20);
  expect(
    first.items.filter((item) => item.author.id === profile.id)
  ).toHaveLength(1);
  expect(first.items.map((item) => item.createdAt)).toEqual(
    first.items
      .map((item) => item.createdAt)
      .toSorted()
      .toReversed()
  );
  const second = await discovery.read("latest", first.cursor ?? undefined);
  const third = await discovery.read("latest", second.cursor ?? undefined);
  const all = [...first.items, ...second.items, ...third.items];
  expect(all).toHaveLength(50);
  expect(new Set(all.map((item) => item.id)).size).toBe(50);
  expect(third.cursor).toBeNull();
});

test("generator pagination keeps upstream cursors opaque and does not repeat posts", async () => {
  const cursors: (string | undefined)[] = [];
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items: [] }),
      getFeed: async (_feed, options) => {
        cursors.push(options?.cursor);
        return options?.cursor
          ? { cursor: null, items: [post(1), post(2)] }
          : { cursor: "upstream-private-cursor", items: [post(1)] };
      },
      getProfile: async () => profile,
    },
    [publicFeed]
  );
  const first = await discovery.read("latest");
  expect(first.cursor).not.toBe("upstream-private-cursor");
  const second = await discovery.read("latest", first.cursor ?? undefined);
  expect(cursors).toEqual([undefined, "upstream-private-cursor"]);
  expect(second.items.map((item) => item.id)).toEqual([post(2).id]);
});

test("generator candidates respect recommendation opt-outs in every display mode and bound policy reads", async () => {
  let active = 0;
  let peak = 0;
  const client = {
    allowsRecommendations: async (author: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 1);
      });
      active -= 1;
      if (author === "did:web:person2.test") {
        throw new Error("policy unavailable");
      }
      return author !== "did:web:person1.test";
    },
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async () => ({
      cursor: null,
      items: Array.from({ length: 15 }, (_, index) =>
        post(index, `did:web:person${index}.test`)
      ),
    }),
    getProfile: async () => profile,
  };
  const discovery = new BlueskyDiscovery(client, [publicFeed]);
  for (const mode of ["latest", "trending", "personalized"] as const) {
    const page = await discovery.read(mode);
    expect(page.items).toHaveLength(13);
    expect(
      page.items.some((item) =>
        ["did:web:person1.test", "did:web:person2.test"].includes(
          item.author.id
        )
      )
    ).toBe(false);
    expect(page.partial).toBe(true);
  }
  expect(peak).toBe(6);
});

test("trending ranks fresh engagement among distinct authors", async () => {
  const items = [post(5, "did:web:first.test"), post(1, "did:web:second.test")];
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items: [] }),
      getFeed: async () => ({ cursor: null, items }),
      getProfile: async () => profile,
    },
    [publicFeed]
  );
  const page = await discovery.read("trending");
  expect(page.items.map((item) => item.id)).toEqual(
    items.toReversed().map((item) => item.id)
  );
});

test("quiet sources are paged past before selecting Trending candidates", async () => {
  const quiet = {
    ...post(1),
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  };
  let reads = 0;
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => true,
      getAuthorFeed: async () => ({ cursor: null, items: [] }),
      getFeed: async () => {
        reads += 1;
        return reads === 1
          ? { cursor: "older-popular-posts", items: [quiet] }
          : { cursor: null, items: [post(2)] };
      },
      getProfile: async () => profile,
    },
    [publicFeed]
  );
  const page = await discovery.read("trending");
  expect(reads).toBe(2);
  expect(page.items.map((item) => item.id)).toEqual([post(2).id]);
});

test("personalized sources search the live corpus and cursors stay bound to their interests", async () => {
  const searches: string[] = [];
  const discovery = new BlueskyDiscovery({
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async () => ({
      cursor: null,
      items: [post(9, "did:web:general.test")],
    }),
    getProfile: async () => profile,
    getSuggestedFeeds: async () => ({
      cursor: "next-catalog",
      items: [{ displayName: "Live channel", uri: publicFeed }],
    }),
    searchPosts: async (query) => {
      searches.push(query);
      return {
        cursor: "next-search",
        items: [
          { ...post(1, "did:web:space.test"), text: "Astronomy discoveries" },
        ],
      };
    },
  });
  const page = await discovery.read("personalized", undefined, "en", [
    "astronomy",
  ]);
  expect(searches).toEqual(["astronomy"]);
  expect(page.items[0]?.author.id).toBe("did:web:space.test");
  expect(page.cursor).not.toBeNull();
  await expect(
    discovery.read("personalized", page.cursor ?? undefined, "en", [
      "gardening",
    ])
  ).rejects.toMatchObject({ code: "invalid_input" });
});

test("a cold focused feed bypasses slow global catalogs and preserves search pagination", async () => {
  let catalogReads = 0;
  const cursors: (string | undefined)[] = [];
  const discovery = new BlueskyDiscovery({
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async () => ({
      cursor: null,
      items: [{ ...post(3), text: "Astronomy telescope tutorial" }],
    }),
    getProfile: async () => profile,
    getSuggestedFeeds: async () => {
      catalogReads += 1;
      return {
        cursor: null,
        items: [{ displayName: "Astronomy channel", uri: publicFeed }],
      };
    },
    searchPosts: async (_query, _sort, options) => {
      cursors.push(options?.cursor);
      return {
        cursor: options?.cursor ? null : "next-search",
        items: [
          { ...post(options?.cursor ? 2 : 1), text: "Astronomy discoveries" },
        ],
      };
    },
  });
  const head = await discovery.read("personalized", undefined, "en", [
    "astronomy",
  ]);
  expect(head.items).toHaveLength(1);
  const tail = await discovery.read(
    "personalized",
    head.cursor ?? undefined,
    "en",
    ["astronomy"]
  );
  expect(tail.items[0]?.id).not.toBe(head.items[0]?.id);
  expect(tail.cursor).toBeTruthy();
  expect(catalogReads).toBe(0);
  expect(cursors).toEqual([undefined, "next-search"]);
  const fallback = await discovery.read(
    "personalized",
    tail.cursor ?? undefined,
    "en",
    ["astronomy"]
  );
  expect(fallback.items[0]?.id).toBe(post(3).id);
  expect(catalogReads).toBeGreaterThan(0);
});

test("video discovery searches chosen interests instead of relying only on general video feeds", async () => {
  const searches: string[] = [];
  const sorts: string[] = [];
  const discovery = new BlueskyDiscovery({
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async () => ({ cursor: null, items: [videoPost(9)] }),
    getProfile: async () => profile,
    getSuggestedFeeds: async () => ({
      cursor: null,
      items: [{ displayName: "Video", uri: publicFeed }],
    }),
    searchPosts: async (query, sort) => {
      sorts.push(sort);
      searches.push(query);
      return {
        cursor: null,
        items: [{ ...videoPost(1), text: "Software and web development" }],
      };
    },
  });
  const page = await discovery.read(
    "personalized",
    undefined,
    "en",
    ["software", "web development"],
    "video"
  );
  expect(searches).toContain("software");
  expect(searches).toContain("web development");
  expect(
    page.items.some((item) => item.text === "Software and web development")
  ).toBe(true);
  expect(
    page.items.every((item) =>
      item.media.some((media) => media.type === "video")
    )
  ).toBe(true);
});

test("video source selection favors popular native video generators over weak catalog matches", async () => {
  const reads: string[] = [];
  const discovery = new BlueskyDiscovery({
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async (uri) => {
      reads.push(uri);
      return { cursor: null, items: [] };
    },
    getProfile: async () => profile,
    getSuggestedFeeds: async () => ({
      cursor: null,
      items: Array.from({ length: 10 }, (_, index) => ({
        contentMode: "app.bsky.feed.defs#contentModeVideo",
        displayName: `Video ${index}`,
        likeCount: index * 100,
        uri: `at://did:plc:example/app.bsky.feed.generator/video${index}`,
      })),
    }),
  });
  await discovery.read("personalized", undefined, "en", [], "video");
  expect(reads).toHaveLength(4);
  expect(reads).toEqual(
    [9, 8, 7, 6].map(
      (index) => `at://did:plc:example/app.bsky.feed.generator/video${index}`
    )
  );
});

test("discovery advances the live catalog after its source buffers drain", async () => {
  const cursors: (string | undefined)[] = [];
  const discovery = new BlueskyDiscovery({
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async (uri) => ({
      cursor: null,
      items: [post(uri.endsWith("second") ? 2 : 1)],
    }),
    getProfile: async () => profile,
    getSuggestedFeeds: async (options) => {
      cursors.push(options?.cursor);
      return {
        cursor: options?.cursor ? null : "next-catalog",
        items: [
          {
            displayName: "Dynamic",
            uri: options?.cursor
              ? publicFeed.replace("whats-hot", "second")
              : publicFeed,
          },
        ],
      };
    },
  });
  const first = await discovery.read("latest");
  const second = await discovery.read("latest", first.cursor ?? undefined);
  expect(cursors).toEqual([undefined, "next-catalog"]);
  expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
});

test("author policy work is bounded by the selected page rather than the complete candidate buffers", async () => {
  let checks = 0;
  const feeds = Array.from(
    { length: 4 },
    (_, index) => `at://did:plc:source/app.bsky.feed.generator/pool${index}`
  );
  const discovery = new BlueskyDiscovery(
    {
      allowsRecommendations: async () => {
        checks += 1;
        return true;
      },
      getAuthorFeed: async () => ({ cursor: null, items: [] }),
      getFeed: async (feed) => ({
        cursor: null,
        items: Array.from({ length: 50 }, (_, index) =>
          post(
            index + feeds.indexOf(feed) * 50,
            `did:web:author${index + feeds.indexOf(feed) * 50}.test`
          )
        ),
      }),
      getProfile: async () => profile,
    },
    feeds
  );
  const page = await discovery.read("personalized");
  expect(page.items).toHaveLength(20);
  expect(checks).toBe(20);
  expect(page.cursor).not.toBeNull();
});

test("distinct cold discovery scopes queue behind the active load bound", async () => {
  let active = 0;
  let peak = 0;
  const discovery = new BlueskyDiscovery({
    allowsRecommendations: async () => true,
    getAuthorFeed: async () => ({ cursor: null, items: [] }),
    getFeed: async () => ({ cursor: null, items: [] }),
    getProfile: async () => profile,
    getSuggestedFeeds: async () => ({ cursor: null, items: [] }),
    searchPosts: async (query) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
      active -= 1;
      return { cursor: null, items: [{ ...post(1), text: query }] };
    },
  });
  const pages = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      discovery.read("personalized", undefined, "en", [`topic ${index}`])
    )
  );
  expect(pages).toHaveLength(16);
  expect(pages.every((page) => page.items.length === 1)).toBe(true);
  expect(peak).toBeLessThanOrEqual(8);
});
