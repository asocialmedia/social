import { beforeEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import { defaultNetworkPreferences } from "@asm/protocols/discovery";

import { interestTrendingTopics } from "@/lib/recommendations/interest-trending";

let session: { user: { id: string } } | null = { user: { id: "reader" } };
let allowed = true;
let offline = false;
let cached = false;
let posts: ExternalPost[] = [];
const preferences = defaultNetworkPreferences();
const context = (interests = ["anime"]) => ({
  preferences,
  profile: { authorWeights: {}, tagWeights: {} },
  revision: 1,
  selected: { id: "default", interests, name: "Everyday" },
  topicScope: undefined,
});
const globalRead = mock((_refresh: boolean, _includeBluesky: boolean) =>
  Promise.resolve({ items: [], topAura: [], unavailable: [] })
);
const discovery = mock(() =>
  offline
    ? Promise.reject(new Error("unavailable"))
    : Promise.resolve({ cursor: null, items: posts, partial: false })
);
mock.module("@asm/db", () => ({
  consumeRateLimit: () => Promise.resolve({ allowed, retryAfterSeconds: 10 }),
  getClientIpFromRequest: () => "127.0.0.1",
}));
mock.module("@/lib/auth/session", () => ({
  getSessionFromApi: () => Promise.resolve(session),
}));
mock.module("@/lib/recommendations/network-context", () => ({
  networkFeedContext: (_id: string | undefined, profile: string | undefined) =>
    Promise.resolve(
      context(session ? [profile === "software" ? "software" : "anime"] : [])
    ),
  networkRegionalLocale: () => "en",
}));
mock.module("@/lib/protocols/service", () => ({
  readBlueskyDiscovery: discovery,
}));
mock.module("@/lib/protocols/discovery-cache", () => ({
  cachedDiscoveryHead: () =>
    Promise.resolve(cached ? { page: { items: posts } } : null),
  discoveryCacheKey: () => "head",
}));
mock.module("@/components/home/sidebars/right/trending-actions", () => ({
  getTrendingFeed: globalRead,
}));
const { GET } = await import("./route");
beforeEach(() => {
  session = { user: { id: "reader" } };
  allowed = true;
  offline = false;
  cached = false;
  posts = [];
  preferences.showExplicitContent = false;
  preferences.avoidedTopics = [];
  globalRead.mockClear();
  discovery.mockClear();
});

function post(id: string, text = "Anime news", tags = ["Anime"]): ExternalPost {
  return {
    author: {
      displayName: "Author",
      handle: "author.test",
      id: `did:plc:${id}`,
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/author.test",
    },
    createdAt: new Date().toISOString(),
    id,
    indexedAt: new Date().toISOString(),
    labels: [],
    languages: ["en"],
    media: [],
    revision: "cid",
    segments: [{ text }],
    source: "bluesky",
    tags,
    text,
    upstreamCounts: { likes: 20, quotes: 0, replies: 0, reposts: 0 },
    url: "https://bsky.app/profile/author.test/post/one",
  };
}

test("selected interests only become sidebar topics when popular recent posts provide evidence", () => {
  const first = post("first", "Anime fans discuss Naruto", ["Naruto"]);
  const second = post("second", "Anime news about Naruto", ["Naruto"]);
  const topics = interestTrendingTopics(
    [first, first, second, post("politics", "Election", ["politics"])],
    context()
  );
  expect(topics.map((topic) => topic.topic)).toEqual(["anime", "naruto"]);
  expect(topics[0].description).toBe(
    "2 popular posts in recent recommendations"
  );
  expect(topics[1].matchedInterests).toEqual(["anime"]);
  expect(interestTrendingTopics([], context())).toEqual([]);
});

test("stale, low-engagement, restricted and default-safe adult posts cannot create trends", () => {
  const old = {
    ...post("old"),
    createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
  };
  const quiet = {
    ...post("quiet"),
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  };
  const adult = { ...post("adult"), labels: ["porn"] };
  const hidden = { ...post("hidden"), labels: ["!hide"] };
  expect(
    interestTrendingTopics([old, quiet, adult, hidden], context())
  ).toEqual([]);
  preferences.showExplicitContent = true;
  expect(
    interestTrendingTopics([adult, hidden], context()).map(
      (topic) => topic.topic
    )
  ).toEqual(["anime"]);
});

test("current preferences and avoided topics apply even when the global cache contains unrelated trends", async () => {
  posts = [post("a"), post("b")];
  const response = await GET(
    new Request("https://asm.test/api/recommendations/trending?profile=default")
  );
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.items[0].topic).toBe("anime");
  expect(globalRead).toHaveBeenCalledWith(false, false);
  preferences.avoidedTopics = ["anime"];
  const avoidedResponse = await GET(
    new Request("https://asm.test/api/recommendations/trending")
  );
  const avoidedData = await avoidedResponse.json();
  expect(avoidedData.items).toEqual([]);
});

test("another active profile cannot inherit the previous profile's topics", async () => {
  posts = [post("anime"), post("software", "Software release", ["software"])];
  const response = await GET(
    new Request(
      "https://asm.test/api/recommendations/trending?profile=software"
    )
  );
  const data = await response.json();
  expect(data.items.map((item: { topic: string }) => item.topic)).toEqual([
    "software",
  ]);
});

test("warm feed evidence avoids another upstream read, and failures preserve independent sources", async () => {
  posts = [post("a")];
  cached = true;
  const warmResponse = await GET(
    new Request("https://asm.test/api/recommendations/trending")
  );
  const warmData = await warmResponse.json();
  expect(warmData.items).toHaveLength(1);
  expect(discovery).not.toHaveBeenCalled();
  cached = false;
  offline = true;
  const failedResponse = await GET(
    new Request("https://asm.test/api/recommendations/trending")
  );
  const failedData = await failedResponse.json();
  expect(failedData.unavailable).toContain("bluesky");
});

test("guest discovery stays global and excessive refreshes retain a retry boundary", async () => {
  session = null;
  const guestResponse = await GET(
    new Request("https://asm.test/api/recommendations/trending")
  );
  expect(guestResponse.status).toBe(200);
  expect(globalRead).toHaveBeenCalledWith(false, true);
  allowed = false;
  const response = await GET(
    new Request("https://asm.test/api/recommendations/trending?refresh=1")
  );
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("10");
});
