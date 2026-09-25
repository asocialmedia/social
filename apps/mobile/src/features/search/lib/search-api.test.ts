import { describe, expect, test } from "bun:test";

import {
  buildSpotlightPath,
  buildSuggestionsPath,
  parseSpotlightResponse,
} from "./search-api";

describe("native search API", () => {
  test("encodes spotlight and suggestion queries", () => {
    expect(buildSpotlightPath("  ada lovelace  ")).toBe(
      "/api/search/spotlight?limit=6&q=ada%20lovelace"
    );
    expect(buildSuggestionsPath("rust & native")).toBe(
      "/api/search?type=suggestions&q=rust%20%26%20native"
    );
  });

  test("normalizes and drops malformed spotlight rows", () => {
    const result = parseSpotlightResponse({
      communities: [
        { id: "community-1", name: "Native", slug: "native" },
        { name: "missing slug" },
      ],
      posts: [
        {
          authorUsername: "ada",
          content: "Hello",
          createdAt: "2026-09-25T00:00:00.000Z",
          id: "post-1",
        },
        null,
      ],
      users: [
        {
          aura: 12,
          displayName: "Ada",
          id: "user-1",
          username: "ada",
        },
        { id: "missing-username" },
      ],
    });

    expect(result.users).toHaveLength(1);
    expect(result.users[0]?.username).toBe("ada");
    expect(result.posts).toHaveLength(1);
    expect(result.communities).toHaveLength(1);
  });
});
