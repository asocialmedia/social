import { describe, expect, it } from "bun:test";

import { parseHistoryEntry, searchSuggestionsCache } from "./search-cache";

describe("search cache", () => {
  it("parses legacy string entries as query type", () => {
    const parsed = parseHistoryEntry("some search query");
    expect(parsed).toEqual({
      query: "some search query",
      raw: "some search query",
      type: "query",
    });
  });

  it("parses json serialized user search item with searchedAt", () => {
    const now = Date.now();
    const userPayload = {
      aura: 150,
      avatarUrl: "https://avatar.example.com",
      badge: "OG",
      badges: ["OG"],
      bio: "Bio",
      displayName: "Jane Doe",
      displayUsername: "janedoe",
      id: "u-1",
      username: "janedoe",
    };

    const serialized = JSON.stringify({
      searchedAt: now,
      type: "user",
      user: userPayload,
    });
    const parsed = parseHistoryEntry(serialized);

    expect(parsed.type).toBe("user");
    if (parsed.type === "user") {
      expect(parsed.user.username).toBe("janedoe");
      expect(parsed.user.id).toBe("u-1");
      expect(parsed.user.aura).toBe(150);
      expect(parsed.searchedAt).toBe(now);
    }
  });

  it("parses json serialized post search item with searchedAt", () => {
    const now = Date.now();
    const postPayload = {
      aura: 25,
      authorAvatarUrl: null,
      authorBadge: null,
      authorBadges: [],
      authorDisplayName: "Jane",
      authorId: "u-1",
      authorUsername: "janedoe",
      content: "Hello world post",
      createdAt: new Date().toISOString(),
      explicitContent: false,
      id: "p-1",
      previewMedia: null,
      viewCount: 100,
    };

    const serialized = JSON.stringify({
      post: postPayload,
      searchedAt: now,
      type: "post",
    });
    const parsed = parseHistoryEntry(serialized);

    expect(parsed.type).toBe("post");
    if (parsed.type === "post") {
      expect(parsed.post.id).toBe("p-1");
      expect(parsed.post.content).toBe("Hello world post");
      expect(parsed.post.createdAt).toBeInstanceOf(Date);
      expect(parsed.searchedAt).toBe(now);
    }
  });

  it("parses json serialized query with resultCount and searchedAt", () => {
    const now = Date.now();
    const serialized = JSON.stringify({
      query: "parazeeknova",
      resultCount: 12,
      searchedAt: now,
      type: "query",
    });
    const parsed = parseHistoryEntry(serialized);

    expect(parsed.type).toBe("query");
    if (parsed.type === "query") {
      expect(parsed.query).toBe("parazeeknova");
      expect(parsed.resultCount).toBe(12);
      expect(parsed.searchedAt).toBe(now);
    }
  });

  it("adds and retrieves rich user, post, and query history in redis with metadata", async () => {
    const testUserId = "unit-test-user-search-history";
    await searchSuggestionsCache.clearHistory(testUserId);

    const userItem = {
      aura: 42,
      avatarUrl: null,
      badge: null,
      badges: [],
      bio: null,
      displayName: "Alice",
      displayUsername: "alice",
      id: "alice-1",
      username: "alice",
    };

    const postItem = {
      aura: 10,
      authorAvatarUrl: null,
      authorBadge: null,
      authorBadges: [],
      authorDisplayName: "Bob",
      authorId: "bob-1",
      authorUsername: "bob",
      content: "Bob thoughts",
      createdAt: new Date(),
      explicitContent: false,
      id: "post-bob-1",
      previewMedia: null,
      viewCount: 50,
    };

    await searchSuggestionsCache.addUserToHistory(testUserId, userItem);
    await searchSuggestionsCache.addPostToHistory(testUserId, postItem);
    await searchSuggestionsCache.addToHistory(testUserId, "bun runtime", 15);

    const history = await searchSuggestionsCache.getHistory(testUserId);
    expect(history.length).toBe(3);

    // Latest added is at the top
    expect(history[0]?.type).toBe("query");
    if (history[0]?.type === "query") {
      expect(history[0].resultCount).toBe(15);
      expect(history[0].searchedAt).toBeDefined();
    }

    expect(history[1]?.type).toBe("post");
    if (history[1]?.type === "post") {
      expect(history[1].searchedAt).toBeDefined();
    }

    expect(history[2]?.type).toBe("user");
    if (history[2]?.type === "user") {
      expect(history[2].searchedAt).toBeDefined();
    }

    // Remove user
    await searchSuggestionsCache.removeHistoryItem(testUserId, "alice-1");
    const historyAfterUserRemoval =
      await searchSuggestionsCache.getHistory(testUserId);
    expect(historyAfterUserRemoval.length).toBe(2);

    // Remove post
    await searchSuggestionsCache.removeHistoryItem(testUserId, "post-bob-1");
    const historyAfterPostRemoval =
      await searchSuggestionsCache.getHistory(testUserId);
    expect(historyAfterPostRemoval.length).toBe(1);
    expect(historyAfterPostRemoval[0]?.type).toBe("query");

    // Clear all
    await searchSuggestionsCache.clearHistory(testUserId);
    const historyAfterClear =
      await searchSuggestionsCache.getHistory(testUserId);
    expect(historyAfterClear.length).toBe(0);
  });
});
