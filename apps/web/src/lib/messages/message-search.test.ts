import { describe, expect, test } from "bun:test";

import {
  buildSearchSnippet,
  extractSearchableText,
  findMatchingIds,
  findMatchRanges,
  MAX_SEARCH_RESULTS,
  normalizeSearchText,
  paginateSearchResults,
  rankSearchResults,
  scoreSearchMatch,
  searchQueryTokens,
  SEARCH_PAGE_SIZE,
} from "./message-search";

describe("normalizeSearchText", () => {
  test("lowercases and folds diacritics", () => {
    expect(normalizeSearchText("Héllo WÖRLD")).toBe("hello world");
  });
});

describe("searchQueryTokens", () => {
  test("splits on whitespace runs and drops empties", () => {
    expect(searchQueryTokens("  hello   world ")).toEqual(["hello", "world"]);
  });
});

describe("extractSearchableText", () => {
  test("returns the body for text messages", () => {
    expect(
      extractSearchableText({ content: "hello there", type: "text" })
    ).toEqual({ kind: "text", text: "hello there" });
  });

  test("keeps captionless media findable via a kind label", () => {
    expect(
      extractSearchableText({
        images: [{ url: "/api/media/abc" }],
        kind: "image",
        type: "media",
      }).text
    ).toContain("image");
    expect(
      extractSearchableText({
        images: [{ url: "/api/media/abc" }],
        kind: "gif",
        type: "media",
      }).text
    ).toContain("GIF");
  });

  test("combines a media caption with the kind label", () => {
    const { text } = extractSearchableText({
      content: "look at this",
      images: [{ url: "/api/media/abc" }],
      kind: "image",
      type: "media",
    });
    expect(text).toContain("look at this");
    expect(text).toContain("image");
  });

  test("labels captionless post shares", () => {
    expect(
      extractSearchableText({ postId: "p1", type: "post" }).text
    ).toContain("post");
  });
});

describe("scoreSearchMatch", () => {
  test("requires every token (AND semantics)", () => {
    expect(
      scoreSearchMatch("hello world", ["hello", "missing"], "hello missing")
    ).toBeNull();
    expect(
      scoreSearchMatch("hello world", ["hello", "world"], "hello world")
    ).not.toBeNull();
  });

  test("ranks exact-phrase hits above scattered tokens", () => {
    const phrase = scoreSearchMatch(
      "hello world",
      ["hello", "world"],
      "hello world"
    );
    const scattered = scoreSearchMatch(
      "hello there world",
      ["hello", "world"],
      "hello world"
    );
    expect(phrase).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(phrase as number).toBeGreaterThan(scattered as number);
  });

  test("ranks word-boundary hits above mid-word ones", () => {
    const boundary = scoreSearchMatch("hello there", ["hello"], "hello");
    const midWord = scoreSearchMatch("othello there", ["hello"], "hello");
    expect(boundary).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(boundary as number).toBeGreaterThan(midWord as number);
  });

  test("returns null for an empty token list", () => {
    expect(scoreSearchMatch("hello", [], "hello")).toBeNull();
  });
});

describe("findMatchRanges", () => {
  test("finds every occurrence and merges overlaps", () => {
    expect(findMatchRanges("hello hello", ["hello"])).toEqual([
      { end: 5, start: 0 },
      { end: 11, start: 6 },
    ]);
    expect(findMatchRanges("aaaa", ["aa", "aaa"])).toEqual([
      { end: 4, start: 0 },
    ]);
  });

  test("matches case-insensitively with original offsets", () => {
    expect(findMatchRanges("Hello", ["hello"])).toEqual([{ end: 5, start: 0 }]);
  });
});

describe("buildSearchSnippet", () => {
  test("windows around the match and collapses whitespace", () => {
    const text = `start ${"x ".repeat(100)}match ${"y ".repeat(100)}end`;
    const snippet = buildSearchSnippet(text, text.indexOf("match"));
    expect(snippet.text).toContain("match");
    expect(snippet.text.length).toBeLessThan(text.length);
    expect(snippet.offset).toBeGreaterThan(0);
  });

  test("keeps short text whole", () => {
    expect(buildSearchSnippet("hello", 0)).toEqual({
      offset: 0,
      text: "hello",
    });
  });
});

describe("rankSearchResults", () => {
  const candidates = [
    { createdAt: 3, id: "newest", text: "hello world" },
    { createdAt: 2, id: "middle", text: "say hello world today" },
    { createdAt: 1, id: "oldest", text: "hello world" },
    { createdAt: 4, id: "unrelated", text: "nothing to see" },
  ];

  test("returns matches newest-first on score ties", () => {
    const results = rankSearchResults(candidates, "hello world");
    expect(results.map((r) => r.id)).toEqual(["newest", "oldest", "middle"]);
  });

  test("rejects short queries", () => {
    expect(rankSearchResults(candidates, "h")).toEqual([]);
    expect(rankSearchResults(candidates, "  ")).toEqual([]);
  });

  test("attaches snippet and ranges to survivors", () => {
    const [first] = rankSearchResults(candidates, "world");
    expect(first?.snippet.text).toContain("world");
    expect(first?.ranges.length).toBeGreaterThan(0);
  });

  test("caps the result count", () => {
    const many = Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_, index) => ({
      createdAt: index,
      id: `m-${index}`,
      text: "hello world",
    }));
    expect(rankSearchResults(many, "hello")).toHaveLength(MAX_SEARCH_RESULTS);
  });
});

describe("findMatchingIds", () => {
  const candidates = [
    { createdAt: 1, id: "oldest", text: "hello world" },
    { createdAt: 3, id: "newest", text: "say hello there" },
    { createdAt: 2, id: "middle", text: "hello and world" },
    { createdAt: 4, id: "unrelated", text: "nothing to see" },
  ];

  test("returns every match newest-first regardless of score", () => {
    expect(findMatchingIds(candidates, "hello")).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  test("uses the same AND-token predicate as the ranked list", () => {
    expect(findMatchingIds(candidates, "hello world")).toEqual([
      "middle",
      "oldest",
    ]);
    expect(findMatchingIds(candidates, "hello missing")).toEqual([]);
  });

  test("rejects short and blank queries", () => {
    expect(findMatchingIds(candidates, "h")).toEqual([]);
    expect(findMatchingIds(candidates, "   ")).toEqual([]);
  });

  test("is not capped at MAX_SEARCH_RESULTS", () => {
    const many = Array.from({ length: MAX_SEARCH_RESULTS + 5 }, (_, index) => ({
      createdAt: index,
      id: `m-${index}`,
      text: "hello world",
    }));
    expect(findMatchingIds(many, "hello")).toHaveLength(MAX_SEARCH_RESULTS + 5);
  });
});

describe("paginateSearchResults", () => {
  const results = rankSearchResults(
    Array.from({ length: 25 }, (_, index) => ({
      createdAt: index,
      id: `m-${index}`,
      text: "hello world",
    })),
    "hello"
  );

  test("slices a full first page and reports 1-based bounds", () => {
    const page = paginateSearchResults(results, 0, SEARCH_PAGE_SIZE);
    expect(page.page).toBe(0);
    expect(page.pageCount).toBe(2);
    expect(page.pageResults).toHaveLength(SEARCH_PAGE_SIZE);
    expect(page.rangeStart).toBe(1);
    expect(page.rangeEnd).toBe(SEARCH_PAGE_SIZE);
  });

  test("returns a short final page", () => {
    const page = paginateSearchResults(results, 1, SEARCH_PAGE_SIZE);
    expect(page.pageResults).toHaveLength(5);
    expect(page.rangeStart).toBe(SEARCH_PAGE_SIZE + 1);
    expect(page.rangeEnd).toBe(25);
  });

  test("clamps out-of-range pages to the last page", () => {
    expect(paginateSearchResults(results, 99, SEARCH_PAGE_SIZE).page).toBe(1);
    expect(paginateSearchResults(results, -4, SEARCH_PAGE_SIZE).page).toBe(0);
  });

  test("handles an empty result set as one empty page", () => {
    const page = paginateSearchResults([], 3, SEARCH_PAGE_SIZE);
    expect(page.page).toBe(0);
    expect(page.pageCount).toBe(1);
    expect(page.pageResults).toEqual([]);
    expect(page.rangeStart).toBe(0);
    expect(page.rangeEnd).toBe(0);
  });

  test("coerces a non-integer or non-finite page and page size", () => {
    expect(paginateSearchResults(results, 1.9, SEARCH_PAGE_SIZE).page).toBe(1);
    expect(
      paginateSearchResults(results, Number.NaN, SEARCH_PAGE_SIZE).page
    ).toBe(0);
    expect(
      paginateSearchResults(results, 0, 0).pageResults.length
    ).toBeGreaterThan(0);
  });
});
