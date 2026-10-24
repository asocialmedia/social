import { expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import type { FeedRow } from "./feed-rows";
import { mixedFeedRows, nativePostForRow } from "./mixed-feed-rows";

const external: ExternalPost = {
  author: {
    displayName: "External",
    handle: "example.test",
    id: "did:web:example.test",
    labels: [],
    source: "bluesky",
    upstreamCounts: {},
    url: "https://bsky.app/profile/example.test",
  },
  createdAt: "2026-10-15T00:00:00Z",
  id: "at://did:web:example.test/app.bsky.feed.post/one",
  indexedAt: "2026-10-15T00:00:00Z",
  labels: [],
  languages: [],
  media: [],
  revision: "cid",
  segments: [],
  source: "bluesky",
  text: "Example",
  upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
  url: "https://bsky.app/profile/example.test/post/one",
};

test("outside posts never split native reply rails", () => {
  const rows: FeedRow[] = [
    {
      hasThreadChild: true,
      hasThreadParent: false,
      post: {
        createdAt: "2026-10-14T00:00:00Z",
        id: "parent",
        userId: "author",
      },
    },
    {
      hasThreadChild: false,
      hasThreadParent: true,
      post: {
        createdAt: "2026-10-16T00:00:00Z",
        id: "reply",
        userId: "author",
      },
    },
  ];
  const mixed = mixedFeedRows(rows, [external], "all", true);
  expect(mixed.map((row) => row.id)).toEqual([
    "asm:parent",
    "asm:reply",
    `bluesky:${external.id}`,
  ]);
  expect(nativePostForRow(mixed[0])?.id).toBe("parent");
  expect(nativePostForRow(mixed[2])).toBeUndefined();
});
