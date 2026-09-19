import { describe, expect, it } from "bun:test";

import { searchSuggestionsCache } from "./search-cache";

describe("search cache redis integration", () => {
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
      community: null,
      content: "Bob thoughts",
      createdAt: new Date(),
      explicitContent: false,
      id: "post-bob-1",
      isGust: false,
      previewMedia: null,
      viewCount: 50,
    };

    await searchSuggestionsCache.addUserToHistory(testUserId, userItem);
    await searchSuggestionsCache.addPostToHistory(testUserId, postItem);
    await searchSuggestionsCache.addToHistory(testUserId, "bun runtime", 15);

    const history = await searchSuggestionsCache.getHistory(testUserId);
    expect(history.length).toBe(3);

    // The three writes can land in the same millisecond, and a Redis sorted set
    // orders equal-score members lexicographically rather than by insertion
    // order, so assert on membership and per-type metadata instead of position.
    const queryEntry = history.find((item) => item.type === "query");
    expect(queryEntry?.type).toBe("query");
    if (queryEntry?.type === "query") {
      expect(queryEntry.resultCount).toBe(15);
      expect(queryEntry.searchedAt).toBeDefined();
    }

    const postEntry = history.find((item) => item.type === "post");
    expect(postEntry?.type).toBe("post");
    if (postEntry?.type === "post") {
      expect(postEntry.searchedAt).toBeDefined();
    }

    const userEntry = history.find((item) => item.type === "user");
    expect(userEntry?.type).toBe("user");
    if (userEntry?.type === "user") {
      expect(userEntry.searchedAt).toBeDefined();
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

  it("deduplicates suggestions from the same client within cooldown window", async () => {
    // The dedupe claim key lives in Redis for 5 minutes, so fixed identifiers
    // would make a second run of this suite (e.g. the pre-push hook after the
    // pre-commit run) fail instead of asserting. A per-run suffix gives every
    // execution a fresh claim while still exercising the same-client throttle.
    const runId = Math.random().toString(36).slice(2, 10);
    const testClient = `client-dedup-${runId}`;
    const otherClient = `different-client-${runId}`;
    const testQuery = `typescript tips ${runId}`;

    const first = await searchSuggestionsCache.addSuggestion(testQuery, {
      clientId: testClient,
    });
    expect(first).toBe(true);

    // Immediate second call from same client should be throttled
    const second = await searchSuggestionsCache.addSuggestion(testQuery, {
      clientId: testClient,
    });
    expect(second).toBe(false);

    // Different client can still suggest it
    const other = await searchSuggestionsCache.addSuggestion(testQuery, {
      clientId: otherClient,
    });
    expect(other).toBe(true);
  });
});
