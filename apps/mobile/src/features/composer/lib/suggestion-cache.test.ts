import { describe, expect, test } from "bun:test";

import {
  clearCachedSuggestions,
  readCachedSuggestions,
  SUGGESTION_TTL_MS,
  writeCachedSuggestions,
} from "./suggestion-cache";

describe("suggestion query cache", () => {
  test("misses before any write, hits after", () => {
    clearCachedSuggestions();
    expect(readCachedSuggestions("@ada", 1000)).toBeNull();
    writeCachedSuggestions(
      "@ada",
      { tags: [], users: [{ avatarUrl: null, id: "u1", username: "ada" }] },
      1000
    );
    expect(readCachedSuggestions("@ada", 1000)?.users).toHaveLength(1);
  });

  test("entries expire after the web 30s staleTime", () => {
    clearCachedSuggestions();
    writeCachedSuggestions("@ada", { tags: ["a"], users: [] }, 0);
    expect(readCachedSuggestions("@ada", SUGGESTION_TTL_MS)).not.toBeNull();
    expect(readCachedSuggestions("@ada", SUGGESTION_TTL_MS + 1)).toBeNull();
  });

  test("expired entries are evicted on read", () => {
    clearCachedSuggestions();
    writeCachedSuggestions("#x", { tags: ["x"], users: [] }, 0);
    readCachedSuggestions("#x", SUGGESTION_TTL_MS + 1);
    writeCachedSuggestions("#y", { tags: ["y"], users: [] }, 0);
    expect(readCachedSuggestions("#y", 1)).not.toBeNull();
  });
});
