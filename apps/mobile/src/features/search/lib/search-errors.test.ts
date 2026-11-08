import { describe, expect, test } from "bun:test";

import { SEARCH_UNAVAILABLE_COPY, searchErrorCopy } from "./search-errors";

describe("search error copy", () => {
  test("a rate limit names the wait, at least one second", () => {
    expect(searchErrorCopy({ retryAfter: 12, status: 429 })).toBe(
      "Search limit reached. Try again in 12s."
    );
    expect(searchErrorCopy({ retryAfter: 0, status: 429 })).toBe(
      "Search limit reached. Try again in 1s."
    );
  });

  test("other HTTP failures read as busy, transport failures as unavailable", () => {
    expect(searchErrorCopy({ status: 503 })).toBe(
      "Search is temporarily busy. Try again shortly."
    );
    expect(searchErrorCopy(null)).toBe(SEARCH_UNAVAILABLE_COPY);
  });
});
