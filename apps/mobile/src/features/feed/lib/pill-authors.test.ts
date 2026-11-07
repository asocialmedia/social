import { describe, expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import { externalPostView } from "./external-post-view";
import type { FeedPost } from "./feed-types";
import { pillAuthors } from "./pill-authors";

function asmPost(
  id: string,
  userId: string,
  avatarUrl: string | null,
  username: string
): FeedPost {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    user: { avatarUrl, id: userId, username },
    userId,
  };
}

function blueskySource(id: string, avatarUrl?: string): ExternalPost {
  return {
    author: {
      avatarUrl,
      displayName: "Blue",
      handle: "blue.bsky.social",
      id: "did:plc:blue",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/did:plc:blue",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    indexedAt: "2026-01-01T00:00:00.000Z",
    labels: [],
    languages: [],
    media: [],
    revision: "3",
    segments: [{ text: "hello" }],
    source: "bluesky",
    text: "hello",
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    url: `https://bsky.app/profile/did:plc:blue/post/${id}`,
  };
}

describe("pillAuthors", () => {
  test("dedupes by author, keeping first-seen order", () => {
    const authors = pillAuthors([
      asmPost("p1", "u1", "https://cdn.example/a.png", "alice"),
      asmPost("p2", "u1", "https://cdn.example/a.png", "alice"),
      asmPost("p3", "u2", null, "bob"),
    ]);
    expect(authors).toEqual([
      { avatarUrl: "https://cdn.example/a.png", id: "u1", username: "alice" },
      { avatarUrl: null, id: "u2", username: "bob" },
    ]);
  });

  test("keeps Bluesky author avatars through the external view", () => {
    const bskyUrl =
      "https://cdn.bsky.app/img/avatar/plain/did:plc:blue/bafkreiblob";
    const view = externalPostView(blueskySource("at://x", bskyUrl));
    const authors = pillAuthors([view]);
    expect(authors).toHaveLength(1);
    expect(authors[0]?.avatarUrl).toBe(bskyUrl);
    expect(authors[0]?.id).toBe("did:plc:blue");
  });

  test("missing Bluesky avatars resolve to null, not undefined", () => {
    const view = externalPostView(blueskySource("at://x"));
    expect(pillAuthors([view])[0]?.avatarUrl).toBeNull();
  });
});
