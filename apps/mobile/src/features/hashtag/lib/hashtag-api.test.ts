import { describe, expect, test } from "bun:test";

import type { ExternalPost } from "@asm/protocols/contracts";

import type { FeedPost } from "@/features/feed/lib/feed-types";

import {
  appendUnique,
  blueskyHashtagPath,
  canonicalTag,
  hashtagFeedView,
  hashtagPostsPath,
  hashtagTimelineRows,
  parseBlueskyHashtagPage,
  parseHashtagPage,
} from "./hashtag-api";

function nativePost(id: string, createdAt: string): FeedPost {
  return { content: `#rust ${id}`, createdAt, id, userId: "user-1" };
}

function blueskyPost(id: string, createdAt: string): ExternalPost {
  return {
    author: {
      displayName: "Bluesky author",
      handle: "author.example.test",
      id: "did:web:author.example.test",
      labels: [],
      source: "bluesky",
      upstreamCounts: {},
      url: "https://bsky.app/profile/author.example.test",
    },
    createdAt,
    id,
    indexedAt: createdAt,
    labels: [],
    languages: [],
    media: [],
    revision: "cid",
    segments: [],
    source: "bluesky",
    text: "#rust from Bluesky",
    upstreamCounts: { likes: 0, quotes: 0, replies: 0, reposts: 0 },
    url: "https://bsky.app/profile/author.example.test/post/one",
  };
}

describe("canonicalTag", () => {
  test("strips a leading hash and lowercases, matching the stored tag", () => {
    expect(canonicalTag("#Rust")).toBe("rust");
    expect(canonicalTag("RUST")).toBe("rust");
    expect(canonicalTag("rust")).toBe("rust");
  });

  test("decodes a percent-encoded tag from a deep link", () => {
    expect(canonicalTag("%23rust")).toBe("rust");
    expect(canonicalTag("caf%C3%A9")).toBe("café");
  });

  test("rejects what the hashtag routes would answer 400 for", () => {
    // `+` is not a hashtag character, so `normalizeHashtag` refuses it.
    expect(canonicalTag("C%2B%2B")).toBe("");
    expect(canonicalTag("two words")).toBe("");
    expect(canonicalTag("a".repeat(65))).toBe("");
  });

  test("survives a malformed escape rather than throwing on a link", () => {
    expect(canonicalTag("%E0%A4%A")).toBe("");
  });

  test("trims surrounding whitespace", () => {
    expect(canonicalTag("  #Rust  ")).toBe("rust");
  });

  test("reduces an empty or hash-only tag to an empty string", () => {
    expect(canonicalTag("")).toBe("");
    expect(canonicalTag("#")).toBe("");
    expect(canonicalTag("   ")).toBe("");
  });
});

describe("hashtagPostsPath", () => {
  test("puts the tag in the path, like web", () => {
    expect(hashtagPostsPath("rust", null)).toBe("/api/hashtags/rust/posts");
  });

  test("adds the cursor only when there is one", () => {
    expect(hashtagPostsPath("rust", "post-1")).toBe(
      "/api/hashtags/rust/posts?cursor=post-1"
    );
  });

  test("encodes a non-ASCII tag", () => {
    expect(hashtagPostsPath("café", null)).toBe(
      "/api/hashtags/caf%C3%A9/posts"
    );
  });
});

describe("blueskyHashtagPath", () => {
  test("sends the tag as a query parameter", () => {
    expect(blueskyHashtagPath("rust", null)).toBe(
      "/api/protocols/bluesky/hashtag?tag=rust"
    );
  });

  test("adds an opaque cursor encoded", () => {
    expect(blueskyHashtagPath("rust", "a b/c")).toBe(
      "/api/protocols/bluesky/hashtag?tag=rust&cursor=a+b%2Fc"
    );
  });
});

describe("parseHashtagPage", () => {
  test("reads the posts and the cursor", () => {
    const page = parseHashtagPage({
      nextCursor: "post-2",
      posts: [{ createdAt: "2026-01-01T00:00:00.000Z", id: "post-1" }],
    });
    expect(page.cursor).toBe("post-2");
    expect(page.items).toHaveLength(1);
  });

  test("returns an empty list for a missing or malformed payload", () => {
    expect(parseHashtagPage(null)).toEqual({ cursor: null, items: [] });
    expect(parseHashtagPage({})).toEqual({ cursor: null, items: [] });
    expect(parseHashtagPage({ posts: "nope" })).toEqual({
      cursor: null,
      items: [],
    });
  });

  test("drops rows with no usable id", () => {
    const page = parseHashtagPage({
      posts: [{ id: "post-1" }, { nope: true }, null, "post-2"],
    });
    expect(page.items).toHaveLength(1);
  });

  test("treats an empty cursor string as no cursor", () => {
    expect(parseHashtagPage({ nextCursor: "", posts: [] }).cursor).toBeNull();
  });
});

describe("parseBlueskyHashtagPage", () => {
  test("accepts the route's { cursor, items } page", () => {
    const post = blueskyPost(
      "at://did:plc:author/app.bsky.feed.post/1",
      "2026-01-01T00:00:00.000Z"
    );
    const parsed = parseBlueskyHashtagPage({ cursor: "next", items: [post] });
    expect(parsed.cursor).toBe("next");
    expect(parsed.items.map((item) => item.id)).toEqual([post.id]);
  });

  test("rejects a malformed page instead of rendering part of it", () => {
    expect(() => parseBlueskyHashtagPage(null)).toThrow();
    expect(() => parseBlueskyHashtagPage({ items: [] })).toThrow();
    expect(() =>
      parseBlueskyHashtagPage({ cursor: null, items: [{ id: "x" }] })
    ).toThrow();
  });

  test("rejects more than the 50 items the route can send", () => {
    const items = Array.from({ length: 51 }, (_, index) =>
      blueskyPost(
        `at://did:plc:author/app.bsky.feed.post/${index}`,
        "2026-01-01T00:00:00.000Z"
      )
    );
    expect(() => parseBlueskyHashtagPage({ cursor: null, items })).toThrow();
  });
});

describe("appendUnique", () => {
  test("appends new ids and keeps the first copy of a repeat", () => {
    const merged = appendUnique(
      [{ id: "a", version: 1 }],
      [
        { id: "a", version: 2 },
        { id: "b", version: 1 },
        { id: "b", version: 2 },
      ]
    );
    expect(merged).toEqual([
      { id: "a", version: 1 },
      { id: "b", version: 1 },
    ]);
  });
});

describe("hashtagTimelineRows", () => {
  const older = nativePost("asm-old", "2026-01-01T00:00:00.000Z");
  const newer = nativePost("asm-new", "2026-01-03T00:00:00.000Z");
  const remote = blueskyPost(
    "at://did:plc:author/app.bsky.feed.post/1",
    "2026-01-02T00:00:00.000Z"
  );

  test("interleaves both sources newest first", () => {
    const rows = hashtagTimelineRows([older, newer], [remote], "all");
    expect(rows.map((row) => row.kind)).toEqual(["asm", "bluesky", "asm"]);
    expect(rows.map((row) => row.id)).toEqual([
      "asm:asm-new",
      `bluesky:${remote.id}`,
      "asm:asm-old",
    ]);
  });

  test("returns only native posts with no external input", () => {
    const rows = hashtagTimelineRows([older, newer], [], "asm");
    expect(rows.map((row) => row.id)).toEqual(["asm:asm-new", "asm:asm-old"]);
  });

  test("returns only Bluesky posts with no native input", () => {
    const rows = hashtagTimelineRows([], [remote], "bluesky");
    expect(rows.map((row) => row.id)).toEqual([`bluesky:${remote.id}`]);
  });
});

describe("hashtagFeedView", () => {
  const base = {
    failed: false,
    hasContent: false,
    hasMore: false,
    networkError: false,
    networkReady: true,
    pending: false,
  };

  test("surfaces a Network settings failure first", () => {
    expect(
      hashtagFeedView({
        ...base,
        hasContent: true,
        networkError: true,
        networkReady: false,
      })
    ).toBe("network-error");
  });

  test("a Network error after settings loaded is not fatal", () => {
    expect(
      hashtagFeedView({ ...base, hasContent: true, networkError: true })
    ).toBe("content");
  });

  test("shows the skeleton while a source is pending with nothing to show", () => {
    expect(hashtagFeedView({ ...base, pending: true })).toBe("loading");
    expect(
      hashtagFeedView({ ...base, networkReady: false, pending: true })
    ).toBe("loading");
  });

  test("keeps content on screen while another source is pending", () => {
    expect(hashtagFeedView({ ...base, hasContent: true, pending: true })).toBe(
      "content"
    );
  });

  test("shows the full error only when nothing loaded", () => {
    expect(hashtagFeedView({ ...base, failed: true })).toBe("error");
    expect(hashtagFeedView({ ...base, failed: true, hasContent: true })).toBe(
      "content"
    );
  });

  test("is empty only once every source is exhausted", () => {
    expect(hashtagFeedView(base)).toBe("empty");
    expect(hashtagFeedView({ ...base, hasMore: true })).toBe("content");
  });
});
