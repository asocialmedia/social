import { expect, mock, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

let rows: { uri: string; snapshot: unknown }[] = [];
const query = {
  all: () => Promise.resolve(rows),
  limit: () => query,
  orderBy: () => query,
  where: () => query,
};
mock.module("@asm/db", () => ({
  and: mock(),
  filterExternalMediaSafety: (posts: ExternalPost[]) => Promise.resolve(posts),
  or: mock(),
  prisma: { orm: { public: { ExternalPosts: { select: () => query } } } },
}));
mock.module("next/cache", () => ({ cacheLife: mock() }));
const { getPublicBlueskyDiscovery } = await import("./bluesky-discovery");
const post: ExternalPost = {
  author: {
    displayName: "Public author",
    handle: "example.bsky.social",
    id: "did:plc:example",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/did:plc:example",
  },
  createdAt: "2026-11-07T10:00:00.000Z",
  id: "at://did:plc:example/app.bsky.feed.post/123",
  indexedAt: "2026-11-07T10:00:00.000Z",
  labels: [],
  languages: ["en"],
  media: [],
  revision: "cid",
  segments: [{ text: "A public conversation." }],
  source: "bluesky",
  text: "A public conversation.",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/did:plc:example/post/123",
};

test("public discovery keeps readable retained source snapshots", async () => {
  rows = [{ snapshot: post, uri: post.id }];
  expect(await getPublicBlueskyDiscovery()).toEqual([post]);
});

test("public snippets and sitemap discovery exclude restricted authors, quoted posts and explicit cached text", async () => {
  rows = [
    { ...post, labels: ["!no-unauthenticated"] },
    { ...post, author: { ...post.author, labels: ["!takedown"] } },
    { ...post, quote: { ...post, labels: ["!hide"] } },
    { ...post, text: "An adults-only 18+ conversation." },
    { ...post, labels: ["porn"] },
  ].map((snapshot) => ({ snapshot, uri: snapshot.id }));
  expect(await getPublicBlueskyDiscovery()).toEqual([]);
});

test("malformed snapshots and snapshots belonging to another URI are excluded", async () => {
  rows = [
    { snapshot: post, uri: `${post.id}other` },
    { snapshot: { text: "Incomplete source" }, uri: post.id },
  ];
  expect(await getPublicBlueskyDiscovery()).toEqual([]);
});
