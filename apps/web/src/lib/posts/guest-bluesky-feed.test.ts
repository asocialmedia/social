import { beforeEach, expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";
import type { DiscoveryPage } from "@asm/protocols/discovery";

let items: ExternalPost[] = [];
let unavailable = false;
let pending = false;
const unsafeMedia = new Set<string>();
const read = mock((): Promise<DiscoveryPage> => {
  if (unavailable) {
    throw new Error("Upstream unavailable");
  }
  return pending
    ? Promise.withResolvers<DiscoveryPage>().promise
    : Promise.resolve({ cursor: null, items });
});
const safety = mock((posts: ExternalPost[]) =>
  Promise.resolve(posts.filter((post) => !unsafeMedia.has(post.id)))
);
mock.module("server-only", () => ({}));
mock.module("@asm/db", () => ({ filterExternalMediaSafety: safety }));
mock.module("@/lib/protocols/service", () => ({ readBlueskyDiscovery: read }));
const { getGuestBlueskyFeed, guestDiscoveryLocale } =
  await import("./guest-bluesky-feed");
const post: ExternalPost = {
  author: {
    displayName: "Public author",
    handle: "public.test",
    id: "did:plc:public",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:public",
  },
  createdAt: "2026-11-07T10:00:00Z",
  id: "at://did:plc:public/app.bsky.feed.post/123",
  indexedAt: "2026-11-07T10:00:00Z",
  labels: [],
  languages: ["en"],
  media: [],
  revision: "revision",
  segments: [{ text: "Public conversation" }],
  source: "bluesky",
  text: "Public conversation",
  upstreamCounts: {},
  url: "https://bsky.app/profile/did:plc:public/post/123",
};
beforeEach(() => {
  items = [];
  unavailable = false;
  pending = false;
  unsafeMedia.clear();
  read.mockClear();
  safety.mockClear();
});

test("server locale respects the requested language and known edge country", () => {
  expect(guestDiscoveryLocale("fr-CA,fr;q=0.9", "CA")).toBe("fr-CA");
  expect(guestDiscoveryLocale("en-US,en;q=0.9", "IN")).toBe("en-IN");
  expect(guestDiscoveryLocale("en-US", "XX")).toBe("en-US");
  expect(guestDiscoveryLocale("invalid/header", null)).toBe("en");
});

test("public initial HTML cannot serialize viewer state or observation tokens", async () => {
  const privateState = {
    amplifications: 1,
    amplified: true,
    bookmarked: true,
    comments: 1,
  };
  items = [
    {
      ...post,
      asm: privateState,
      networkRecommendationToken: "private-receipt",
      quote: {
        ...post,
        asm: privateState,
        networkRecommendationToken: "quoted-receipt",
      },
    },
  ];
  const result = await getGuestBlueskyFeed("en-IN");
  expect(result).toHaveLength(1);
  expect(result[0]?.asm).toBeUndefined();
  expect(result[0]?.networkRecommendationToken).toBeUndefined();
  expect(result[0]?.quote?.asm).toBeUndefined();
  expect(result[0]?.quote?.networkRecommendationToken).toBeUndefined();
  expect(items[0]?.asm?.bookmarked).toBe(true);
  expect(read).toHaveBeenCalledWith(
    "latest",
    undefined,
    expect.any(AbortSignal),
    undefined,
    "en-IN",
    [],
    false,
    "all"
  );
});

test("guest HTML applies label, quoted-author and media restrictions", async () => {
  items = [
    { ...post, labels: ["!no-unauthenticated"] },
    {
      ...post,
      quote: { ...post, author: { ...post.author, labels: ["!takedown"] } },
    },
    { ...post, text: "Adults-only 18+ conversation" },
    post,
  ];
  unsafeMedia.add(post.id);
  expect(await getGuestBlueskyFeed("en")).toEqual([]);
  expect(safety).toHaveBeenCalledWith([post]);
});

test("an upstream failure leaves the native feed available", async () => {
  unavailable = true;
  expect(await getGuestBlueskyFeed("en")).toEqual([]);
});

test("a stalled source cannot hold the initial page indefinitely", async () => {
  pending = true;
  expect(await getGuestBlueskyFeed("en")).toEqual([]);
});
