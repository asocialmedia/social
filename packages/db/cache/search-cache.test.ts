import { describe, expect, it } from "bun:test";

import { isValidSearchSuggestion, parseHistoryEntry } from "./search-cache";

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

  it("validates search suggestions against spam and invalid lengths", () => {
    // Valid queries
    expect(isValidSearchSuggestion("javascript")).toBe(true);
    expect(isValidSearchSuggestion("nextjs 15")).toBe(true);
    expect(isValidSearchSuggestion("hello world")).toBe(true);

    // Invalid: too short or too long
    expect(isValidSearchSuggestion("a")).toBe(false);
    expect(isValidSearchSuggestion("")).toBe(false);
    expect(isValidSearchSuggestion("   ")).toBe(false);
    expect(isValidSearchSuggestion("a".repeat(51))).toBe(false);

    // Invalid: contains URLs or domains
    expect(isValidSearchSuggestion("visit https://malicious.com")).toBe(false);
    expect(isValidSearchSuggestion("buy cheap crypto.xyz")).toBe(false);
    expect(isValidSearchSuggestion("www.google.com")).toBe(false);

    // Invalid: HTML tags or SQL injection probes
    expect(isValidSearchSuggestion("<script>alert(1)</script>")).toBe(false);
    expect(isValidSearchSuggestion("test'; DROP TABLE users;--")).toBe(false);
    expect(isValidSearchSuggestion("union select 1, 2")).toBe(false);
  });
});
