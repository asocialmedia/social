import { describe, expect, test } from "bun:test";

import {
  formatSearchTime,
  historyItemKey,
  historyItemLabel,
  parseHistoryItem,
  parseSearchHistory,
} from "./search-history";
import type { SearchHistoryItem } from "./search-history";

// Parsing is expected to succeed in these cases, so failing loudly beats a
// non-null assertion the linter rightly forbids.
function parsed(raw: unknown): SearchHistoryItem {
  const item = parseHistoryItem(raw);
  if (!item) {
    throw new Error(`expected a history item from ${JSON.stringify(raw)}`);
  }
  return item;
}

describe("parseHistoryItem", () => {
  test("decodes a query stored as a JSON string", () => {
    const raw = JSON.stringify({
      query: "rust",
      resultCount: 4,
      searchedAt: 1_700_000_000_000,
      type: "query",
    });
    expect(parseHistoryItem(raw)).toEqual({
      query: "rust",
      resultCount: 4,
      searchedAt: 1_700_000_000_000,
      type: "query",
    });
  });

  test("decodes an already-parsed object as well as a string", () => {
    const item = parseHistoryItem({
      query: "zig",
      searchedAt: 1,
      type: "query",
    });
    expect(item).toEqual({
      query: "zig",
      resultCount: undefined,
      searchedAt: 1,
      type: "query",
    });
  });

  test("decodes a user and keeps the display name", () => {
    const item = parseHistoryItem({
      searchedAt: 2,
      type: "user",
      user: {
        avatarUrl: "/a.png",
        displayName: "Ada",
        id: "u1",
        username: "ada",
      },
    });
    expect(item).toEqual({
      searchedAt: 2,
      type: "user",
      user: {
        avatarUrl: "/a.png",
        displayName: "Ada",
        id: "u1",
        username: "ada",
      },
    });
  });

  test("decodes a post and defaults a missing date to the epoch", () => {
    const item = parseHistoryItem({
      post: { authorUsername: "ada", content: "hello", id: "p1" },
      type: "post",
    });
    expect(item).toEqual({
      post: {
        authorUsername: "ada",
        content: "hello",
        createdAt: new Date(0).toISOString(),
        id: "p1",
      },
      searchedAt: undefined,
      type: "post",
    });
  });

  test("decodes rich user and post metadata when provided", () => {
    const userItem = parseHistoryItem({
      type: "user",
      user: {
        aura: 150,
        avatarUrl: "/avatar.png",
        displayName: "Ada Lovelace",
        id: "u1",
        username: "ada",
      },
    });
    expect(userItem).toEqual({
      searchedAt: undefined,
      type: "user",
      user: {
        aura: 150,
        avatarUrl: "/avatar.png",
        displayName: "Ada Lovelace",
        id: "u1",
        username: "ada",
      },
    });

    const postItem = parseHistoryItem({
      post: {
        aura: 42,
        authorAvatarUrl: "/author.png",
        authorUsername: "ada",
        content: "rich content",
        createdAt: "2026-09-26T12:00:00.000Z",
        explicitContent: true,
        id: "p1",
        previewMedia: {
          id: "m1",
          thumbnailKey: "thumb.jpg",
          type: "VIDEO",
        },
        viewCount: 1200,
      },
      type: "post",
    });
    expect(postItem).toEqual({
      post: {
        aura: 42,
        authorAvatarUrl: "/author.png",
        authorUsername: "ada",
        content: "rich content",
        createdAt: "2026-09-26T12:00:00.000Z",
        explicitContent: true,
        id: "p1",
        previewMedia: {
          id: "m1",
          thumbnailKey: "thumb.jpg",
          type: "VIDEO",
        },
        viewCount: 1200,
      },
      searchedAt: undefined,
      type: "post",
    });
  });

  test("drops entries missing the fields their row needs", () => {
    expect(parseHistoryItem({ type: "query" })).toBeNull();
    expect(parseHistoryItem({ query: "", type: "query" })).toBeNull();
    expect(parseHistoryItem({ type: "user", user: { id: "u1" } })).toBeNull();
    expect(
      parseHistoryItem({ post: { content: "hi" }, type: "post" })
    ).toBeNull();
  });

  test("drops unknown and malformed entries instead of throwing", () => {
    expect(parseHistoryItem({ type: "something-else" })).toBeNull();
    expect(parseHistoryItem("not json")).toBeNull();
    expect(parseHistoryItem(null)).toBeNull();
    expect(parseHistoryItem(42)).toBeNull();
  });

  test("ignores a non-numeric resultCount and searchedAt", () => {
    const item = parseHistoryItem({
      query: "go",
      resultCount: "many",
      searchedAt: "now",
      type: "query",
    });
    expect(item).toEqual({
      query: "go",
      resultCount: undefined,
      searchedAt: undefined,
      type: "query",
    });
  });
});

describe("parseSearchHistory", () => {
  test("keeps the good rows and skips the broken ones", () => {
    const history = parseSearchHistory([
      JSON.stringify({ query: "one", type: "query" }),
      { broken: true },
      JSON.stringify({
        type: "user",
        user: { id: "u1", username: "ada" },
      }),
    ]);
    expect(history).toHaveLength(2);
    expect(history[0]?.type).toBe("query");
    expect(history[1]?.type).toBe("user");
  });

  test("returns an empty list for a non-array payload", () => {
    expect(parseSearchHistory(null)).toEqual([]);
    expect(parseSearchHistory({ items: [] })).toEqual([]);
    expect(parseSearchHistory("nope")).toEqual([]);
  });
});

describe("historyItemKey", () => {
  test("sends back the exact stored form when the raw value is a string", () => {
    const raw = JSON.stringify({ query: "rust", type: "query" });
    // The server matches removals on the stored serialization, so reconstructing
    // a different string would silently fail to delete anything.
    expect(historyItemKey(parsed(raw), raw)).toBe(raw);
  });

  test("builds a stable key from a parsed object", () => {
    const item = parsed({
      query: "rust",
      searchedAt: 5,
      type: "query",
    });
    expect(historyItemKey(item)).toBe('{"searchedAt":5,"type":"query"}');
  });
});

describe("historyItemLabel", () => {
  test("prefers the display name and falls back to the username", () => {
    const named = parsed({
      type: "user",
      user: { displayName: "Ada L", id: "u1", username: "ada" },
    });
    const bare = parsed({ type: "user", user: { id: "u1", username: "ada" } });
    expect(historyItemLabel(named)).toBe("Ada L");
    expect(historyItemLabel(bare)).toBe("ada");
  });

  test("labels a post row by its author", () => {
    const item = parsed({
      post: { authorUsername: "ada", content: "hi", id: "p1" },
      type: "post",
    });
    expect(historyItemLabel(item)).toBe("@ada");
  });

  test("labels a post with no author without printing undefined", () => {
    const item = parsed({ post: { content: "hi", id: "p1" }, type: "post" });
    expect(historyItemLabel(item)).toBe("@someone");
  });
});

describe("formatSearchTime", () => {
  test("returns empty string for missing or invalid dates", () => {
    expect(formatSearchTime(null)).toBe("");
    expect(formatSearchTime()).toBe("");
    expect(formatSearchTime("invalid-date")).toBe("");
  });

  test("formats relative search times accurately", () => {
    const now = Date.now();
    expect(formatSearchTime(now - 10_000)).toBe("searched just now");
    expect(formatSearchTime(now - 5 * 60 * 1000)).toBe("searched 5m ago");
    expect(formatSearchTime(now - 3 * 3600 * 1000)).toBe("searched 3h ago");
    expect(formatSearchTime(now - 2 * 86_400 * 1000)).toBe("searched 2d ago");
  });
});
