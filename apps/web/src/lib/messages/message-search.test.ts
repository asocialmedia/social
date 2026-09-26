import { describe, expect, test } from "bun:test";

import {
  buildPagedResults,
  buildRankedResults,
  buildSearchSnippet,
  extractSearchableText,
  findMatchingIds,
  findMatchRanges,
  MAX_SEARCH_RESULTS,
  mergeSearchSnapshot,
  normalizeSearchText,
  paginateSearchResults,
  rankSearchResults,
  scoreSearchCandidates,
  scoreSearchMatch,
  scoredRowIdsNewestFirst,
  searchQueryTokens,
  SEARCH_PAGE_SIZE,
  splitSearchTokens,
} from "./message-search";
import type { IndexMatchSnapshot, SearchCandidate } from "./message-search";

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

describe("splitSearchTokens", () => {
  test("a trailing partial word goes prefix, finished words go exact", () => {
    expect(splitSearchTokens("deploy zarq")).toEqual({
      exact: ["deploy"],
      prefix: "zarq",
    });
  });

  test("a single word is all prefix", () => {
    expect(splitSearchTokens("zarq")).toEqual({ exact: [], prefix: "zarq" });
  });

  test("a trailing space finishes the last word", () => {
    expect(splitSearchTokens("deploy ")).toEqual({
      exact: ["deploy"],
      prefix: null,
    });
  });

  test("empty and blank queries are neither", () => {
    expect(splitSearchTokens("")).toEqual({ exact: [], prefix: null });
    expect(splitSearchTokens("   ")).toEqual({ exact: [], prefix: null });
  });

  test("normalizes before splitting", () => {
    expect(splitSearchTokens("Déploy ZARQ")).toEqual({
      exact: ["deploy"],
      prefix: "zarq",
    });
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

  // The reported bug: the pager was sized from the rows the hook happened to
  // hold, so a 24,261-match query offered a few pages and the rest of the
  // conversation was unreachable. The total is the denominator now, and the
  // rows are one page's worth.
  describe("paged results", () => {
    const TOTAL = 24_261;
    const onePage = results.slice(0, SEARCH_PAGE_SIZE);

    test("the pager spans the total, not the rows in hand", () => {
      const page = paginateSearchResults(onePage, 0, SEARCH_PAGE_SIZE, TOTAL);
      expect(page.pageCount).toBe(Math.ceil(TOTAL / SEARCH_PAGE_SIZE));
      expect(page.pageCount).toBe(1214);
      // Page 0 renders the rows it was handed, not a slice of the total.
      expect(page.pageResults).toHaveLength(SEARCH_PAGE_SIZE);
    });

    test("a deep page reports its position in the whole set", () => {
      const page = paginateSearchResults(onePage, 500, SEARCH_PAGE_SIZE, TOTAL);
      expect(page.page).toBe(500);
      expect(page.rangeStart).toBe(500 * SEARCH_PAGE_SIZE + 1);
      expect(page.rangeEnd).toBe(501 * SEARCH_PAGE_SIZE);
      // The rows are the page's own window wherever in the set it sits.
      expect(page.pageResults).toHaveLength(SEARCH_PAGE_SIZE);
      expect(page.pageResults[0]).toBe(onePage[0]);
    });

    test("an unread page is empty but keeps honest bounds", () => {
      // Before the window lands: the bounds must already describe the position,
      // or the bar would read "1–20 of 20" for page 500.
      const page = paginateSearchResults([], 500, SEARCH_PAGE_SIZE, TOTAL);
      expect(page.pageResults).toEqual([]);
      expect(page.rangeStart).toBe(500 * SEARCH_PAGE_SIZE + 1);
    });

    test("clamps a page past the end of the total", () => {
      const page = paginateSearchResults(
        onePage,
        9999,
        SEARCH_PAGE_SIZE,
        TOTAL
      );
      expect(page.page).toBe(1213);
    });

    test("a zero total is one empty page", () => {
      const page = paginateSearchResults([], 3, SEARCH_PAGE_SIZE, 0);
      expect(page.pageCount).toBe(1);
      expect(page.page).toBe(0);
      expect(page.rangeStart).toBe(0);
    });

    // The count the pager uses is sticky per query so a re-read cannot shrink
    // the page under the user's cursor, and it can lag the live match set in
    // the other direction too: a page that resolved more rows than the sticky
    // total has room for. The range describes rows on screen, so it must follow
    // the rows and let the bar raise the denominator to meet it.
    test("the range follows the rows, not a total that undercounts them", () => {
      const STALE = 25;
      const page = paginateSearchResults(onePage, 1, SEARCH_PAGE_SIZE, STALE);
      expect(page.pageResults).toHaveLength(SEARCH_PAGE_SIZE);
      expect(page.rangeStart).toBe(SEARCH_PAGE_SIZE + 1);
      expect(page.rangeEnd).toBe(2 * SEARCH_PAGE_SIZE);
    });

    test("a resolved page that fills its slot reports the same bounds as before", () => {
      const page = paginateSearchResults(onePage, 0, SEARCH_PAGE_SIZE, TOTAL);
      expect(page.rangeStart).toBe(1);
      expect(page.rangeEnd).toBe(SEARCH_PAGE_SIZE);
    });
  });
});

// One scoring pass feeds both surfaces. These pin the property the refactor
// exists for, plus the ordering contract that a shared pass must NOT blur.
describe("scoreSearchCandidates", () => {
  const rows: SearchCandidate[] = [
    { createdAt: 1, id: "oldest", text: "hello world" },
    { createdAt: 3, id: "newest", text: "hello" },
    { createdAt: 2, id: "middle", text: "hello world again" },
    { createdAt: 4, id: "nomatch", text: "goodbye" },
  ];

  test("returns only rows matching every token, newest-tiebreak first", () => {
    const scored = scoreSearchCandidates(rows, "hello world");
    expect(scored.map((row) => row.candidate.id).toSorted()).toEqual([
      "middle",
      "oldest",
    ]);
    // A single token picks up every matching row.
    expect(scoreSearchCandidates(rows, "hello")).toHaveLength(3);
  });

  test("a query under the minimum length matches nothing", () => {
    expect(scoreSearchCandidates(rows, "h")).toEqual([]);
  });

  // The two surfaces have different orders on purpose: the list is score-first,
  // navigation is chronological. Sharing the scoring pass must not leak one
  // surface's ordering into the other, which is a regression this caused once.
  // Asserted as ordering PROPERTIES rather than as a fixture-specific inequality,
  // because for many fixtures the two orders coincide and an inequality test
  // would then be asserting nothing.
  test("navigation is chronological and the list is score-first", () => {
    const scored = scoreSearchCandidates(rows, "hello");
    // Navigation: strictly newest-first by createdAt.
    const navigation = scoredRowIdsNewestFirst(scored);
    const timestamps = navigation.map(
      (id) => rows.find((row) => row.id === id)?.createdAt ?? 0
    );
    expect(timestamps).toEqual([...timestamps].toSorted((l, r) => r - l));
    // List: score descending, then newest first on a tie.
    const list = buildRankedResults(scored, "hello");
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1];
      const current = list[index];
      if (previous && current) {
        expect(previous.score).toBeGreaterThanOrEqual(current.score);
        if (previous.score === current.score) {
          expect(previous.createdAt).toBeGreaterThanOrEqual(current.createdAt);
        }
      }
    }
    // And the scored path agrees with the from-candidates path.
    expect(navigation).toEqual(findMatchingIds(rows, "hello"));
  });

  test("buildRankedResults and rankSearchResults agree", () => {
    expect(
      buildRankedResults(scoreSearchCandidates(rows, "hello"), "hello")
    ).toEqual(rankSearchResults(rows, "hello"));
  });

  test("the shared pass is pure and repeatable", () => {
    const first = scoreSearchCandidates(rows, "hello world");
    const second = scoreSearchCandidates(rows, "hello world");
    expect(first).toEqual(second);
  });
});

// A minimal index snapshot, so these tests describe the merge contract without a
// store or a decryptor. Rows carry no preview unless given one, which keeps the
// long-standing cases on the token-join fallback while new cases pass real text.
function indexSnapshot(
  rows: [number, string, number, string?][],
  totalMatched: number,
  tokens: readonly string[] = ["deploy"]
): IndexMatchSnapshot {
  return {
    rows: new Map(
      rows.map(([row, messageId, createdAt, preview]) => [
        row,
        { createdAt, messageId, preview: preview ?? "" },
      ])
    ),
    tokens,
    totalMatched,
  };
}

// The reported bug: a static query reported 269, then 316, then 289 results with
// nothing deleted. The counter was a sum of two independently-moving windows. These
// pin the fix as a property of a pure function, so it is testable without React.
describe("mergeSearchSnapshot", () => {
  const corpus: SearchCandidate[] = Array.from({ length: 40 }, (_, index) => ({
    createdAt: index + 1,
    id: `m${index}`,
    text: index % 2 === 0 ? `deploy note ${index}` : `rollback ${index}`,
  }));

  test("the same inputs always give the same total", () => {
    const index = indexSnapshot(
      [
        [100, "x1", 90],
        [101, "x2", 80],
      ],
      12
    );
    const first = mergeSearchSnapshot({ corpus, index, query: "deploy" });
    const second = mergeSearchSnapshot({ corpus, index, query: "deploy" });
    expect(second.totalMatches).toBe(first.totalMatches);
    expect(second.matchIds).toEqual(first.matchIds);
  });

  // The exact failure mode: evaluating the same snapshot repeatedly, as a live
  // re-render does, must not move the number.
  test("repeated evaluation of one snapshot never drifts", () => {
    const index = indexSnapshot(
      [
        [100, "x1", 90],
        [101, "x2", 80],
      ],
      40
    );
    const totals = new Set<number>();
    for (let run = 0; run < 25; run += 1) {
      totals.add(
        mergeSearchSnapshot({ corpus, index, query: "deploy" }).totalMatches
      );
    }
    expect(totals.size).toBe(1);
  });

  test("a row held by memory is not counted twice", () => {
    // 20 corpus rows match "deploy" (every even index). "m0" is one of them, and
    // the index snapshot also reports it, so it must not be added a second time.
    const index = indexSnapshot([[0, "m0", 1]], 1);
    const merged = mergeSearchSnapshot({ corpus, index, query: "deploy" });
    expect(merged.totalMatches).toBe(20);
    // Nothing index-only: the single reported row is the one memory already had.
    expect(merged.indexOnlyIds).toEqual([]);
    expect(new Set(merged.matchIds).size).toBe(merged.matchIds.length);
  });

  test("index-only hits are counted and ordered newest first", () => {
    const index = indexSnapshot(
      [
        [100, "old", 5],
        [101, "new", 95],
      ],
      2
    );
    const merged = mergeSearchSnapshot({ corpus, index, query: "deploy" });
    expect(merged.indexOnlyIds).toEqual(["new", "old"]);
    expect(merged.totalMatches).toBe(20 + 2);
  });

  test("an index total above the observed cap is not double counted", () => {
    // 5 rows returned, 3 of which memory also holds, totalMatched says 100.
    // The 2 unseen index-only rows are counted; the 3 seen ones are not re-added.
    const index = indexSnapshot(
      [
        [0, "m0", 1],
        [1, "m2", 3],
        [2, "m4", 5],
        [100, "u1", 90],
        [101, "u2", 91],
      ],
      100
    );
    const merged = mergeSearchSnapshot({ corpus, index, query: "deploy" });
    // 100 total, of which 3 are already in memory: 97 index-only.
    expect(merged.totalMatches).toBe(20 + 97);
  });

  test("a total below the observed rows cannot go negative", () => {
    const index = indexSnapshot(
      [
        [0, "m0", 1],
        [100, "u1", 90],
      ],
      1
    );
    const merged = mergeSearchSnapshot({ corpus, index, query: "deploy" });
    expect(merged.totalMatches).toBeGreaterThanOrEqual(0);
  });

  test("an empty query reports in-memory matches and no index tail", () => {
    const index = indexSnapshot([[100, "x1", 90]], 1);
    const merged = mergeSearchSnapshot({ corpus, index, query: "" });
    expect(merged.indexOnlyIds).toEqual([]);
    expect(merged.ranked).toEqual([]);
  });

  test("no index snapshot means memory only", () => {
    const merged = mergeSearchSnapshot({
      corpus,
      index: null,
      query: "deploy",
    });
    expect(merged.totalMatches).toBe(20);
    expect(merged.indexOnlyIds).toEqual([]);
  });

  test("matchIds are newest first across both sources", () => {
    const index = indexSnapshot([[100, "u1", 999]], 1);
    const merged = mergeSearchSnapshot({ corpus, index, query: "deploy" });
    const [firstIndexOnly] = merged.indexOnlyIds;
    // The index-only row has the newest timestamp, so it leads.
    expect(merged.matchIds[0]).toBe(firstIndexOnly);
  });

  // The reported bug: while indexing runs, the capped index window slides and
  // jumps replace the transcript window, so a landed match vanishes mid-session
  // and the arrows yank back to the newest hit -- teleporting through random
  // positions -- while the counter swings (31, then 23) on the same churn.
  // Navigation ids and the counter are sticky per query from here on.
  test("match ids never drop while the inputs churn", () => {
    const first = mergeSearchSnapshot({
      corpus,
      index: indexSnapshot(
        [
          [100, "x1", 90],
          [101, "x2", 80],
        ],
        12
      ),
      query: "deploy",
    });
    expect(first.matchIds).toContain("x1");
    // The window slid (x1/x2 no longer resolved) and the transcript turned
    // over (empty corpus): both used to evict the ids.
    const second = mergeSearchSnapshot(
      { corpus: [], index: indexSnapshot([], 0), query: "deploy" },
      first
    );
    expect(second.matchIds).toEqual(first.matchIds);
    expect(second.totalMatches).toBe(first.totalMatches);
    // The displayed list stays fresh, though: stale rows navigate, they do
    // not render.
    expect(second.ranked).toEqual([]);
    expect(second.indexOnlyIds).toEqual([]);
  });

  test("the counter never drops for a static query", () => {
    const first = mergeSearchSnapshot({
      corpus,
      index: indexSnapshot([[100, "x1", 90]], 31),
      query: "deploy",
    });
    expect(first.totalMatches).toBeGreaterThanOrEqual(31);
    const dropped = mergeSearchSnapshot(
      { corpus: [], index: null, query: "deploy" },
      first
    );
    expect(dropped.totalMatches).toBe(first.totalMatches);
  });

  test("the counter still grows as real coverage lands", () => {
    const first = mergeSearchSnapshot({
      corpus,
      index: indexSnapshot([[100, "x1", 90]], 23),
      query: "deploy",
    });
    const grown = mergeSearchSnapshot(
      {
        corpus,
        index: indexSnapshot(
          [
            [100, "x1", 90],
            [101, "x2", 80],
          ],
          31
        ),
        query: "deploy",
      },
      first
    );
    expect(grown.totalMatches).toBeGreaterThanOrEqual(31);
    expect(grown.matchIds).toContain("x2");
  });

  test("sticky ids order newest-first by their known timestamps", () => {
    const first = mergeSearchSnapshot({
      corpus: [],
      index: indexSnapshot([[100, "x1", 90]], 1),
      query: "deploy",
    });
    const second = mergeSearchSnapshot(
      {
        corpus: [{ createdAt: 50, id: "m-new", text: "deploy fresh" }],
        index: null,
        query: "deploy",
      },
      first
    );
    // x1 (90) still leads the newer m-new (50): order follows timestamps,
    // not arrival.
    expect(second.matchIds).toEqual(["x1", "m-new"]);
  });

  // The reported teleport bug: with a query matching more rows than the
  // ranked display holds, landing on a match replaces the loaded window with
  // a small anchored page. The next merge then knows timestamps only for the
  // rows still loaded (plus the capped index rows and the truncated display
  // list), so every other id sinks to the epoch and the counter jumps to the
  // end of the list -- 2203 of 2203 -- while the arrows walk a reshuffled
  // order. Falling back to the previous snapshot's own facts keeps every
  // known id exactly where it was.
  test("replacing the loaded window never reorders known ids", () => {
    const full: SearchCandidate[] = Array.from({ length: 250 }, (_, row) => ({
      createdAt: row + 1,
      id: `c${row}`,
      text: `deploy ${row}`,
    }));
    const first = mergeSearchSnapshot({
      corpus: full,
      index: null,
      query: "deploy",
    });
    expect(first.matchIds).toHaveLength(250);
    expect(first.matchIds[0]).toBe("c249");
    // Only the landed row is still loaded: the jumped window.
    const landed: SearchCandidate = {
      createdAt: 101,
      id: "c100",
      text: "deploy 100",
    };
    const second = mergeSearchSnapshot(
      { corpus: [landed], index: null, query: "deploy" },
      first
    );
    expect(second.matchIds).toEqual(first.matchIds);
    expect(second.matchIds.indexOf("c100")).toBe(
      first.matchIds.indexOf("c100")
    );
  });

  test("older matches surfacing mid-session slot in chronologically", () => {
    const full: SearchCandidate[] = Array.from({ length: 250 }, (_, row) => ({
      createdAt: row + 1,
      id: `c${row}`,
      text: `deploy ${row}`,
    }));
    const first = mergeSearchSnapshot({
      corpus: full,
      index: null,
      query: "deploy",
    });
    const landed: SearchCandidate = {
      createdAt: 101,
      id: "c100",
      text: "deploy 100",
    };
    // Indexing lands an older hit the corpus never held while the window is
    // still the small jumped page.
    const second = mergeSearchSnapshot(
      {
        corpus: [landed],
        index: indexSnapshot([[300, "zz-old", 0]], 251),
        query: "deploy",
      },
      first
    );
    expect(second.matchIds.slice(0, 250)).toEqual(first.matchIds);
    expect(second.matchIds.at(-1)).toBe("zz-old");
  });

  test("same-timestamp ids order deterministically, not by arrival", () => {
    const forward: SearchCandidate[] = ["a", "b", "c"].map((id) => ({
      createdAt: 42,
      id,
      text: "deploy tie",
    }));
    const backward = [...forward].toReversed();
    const first = mergeSearchSnapshot({
      corpus: forward,
      index: null,
      query: "deploy",
    });
    const second = mergeSearchSnapshot(
      { corpus: backward, index: null, query: "deploy" },
      first
    );
    expect(second.matchIds).toEqual(first.matchIds);
  });

  // The reported list-view complaint: typing "zar" showed every index-only hit
  // as the bare word "zar" instead of the message. Stored previews render real
  // context with real highlight ranges, built the same way in-memory rows are.
  test("index-only hits render the stored preview, not the matched tokens", () => {
    const merged = mergeSearchSnapshot({
      corpus: [],
      index: indexSnapshot(
        [[100, "m1", 90, "can anyone find the zarquon thread?"]],
        1,
        ["zarquon"]
      ),
      query: "zarquon",
    });
    const [row] = merged.ranked;
    expect(row?.text).toBe("can anyone find the zarquon thread?");
    expect(row?.snippet.text).toContain("zarquon");
    expect(row?.ranges.length).toBeGreaterThan(0);
    // Ranges are rebased onto the snippet window for the renderer.
    for (const range of row?.ranges ?? []) {
      expect(row?.snippet.text.slice(range.start, range.end)).toBe("zarquon");
    }
  });

  test("a preview without the match still shows the prefix, unhighlighted", () => {
    // The row matched on text past the stored prefix: postings resolve it, but
    // the prefix holds no highlight. The row still shows real text -- the
    // message start with an ellipsis -- rather than the bare token, so every
    // list row reads as a message.
    const merged = mergeSearchSnapshot({
      corpus: [],
      index: indexSnapshot([[100, "m1", 90, "unrelated leading words"]], 1),
      query: "deploy",
    });
    const [row] = merged.ranked;
    expect(row?.text).toBe("unrelated leading words");
    expect(row?.ranges).toEqual([]);
  });

  test("an empty preview falls back to the matched tokens", () => {
    const merged = mergeSearchSnapshot({
      corpus: [],
      index: indexSnapshot([[100, "x1", 90]], 1),
      query: "deploy",
    });
    const [row] = merged.ranked;
    expect(row?.text).toBe("deploy");
    expect(row?.snippet).toEqual({ offset: 0, text: "deploy" });
  });
});

// A list page read on demand. The rows come from the index (previews only, no
// loaded row), so these pin what the list shows for a page the keystroke path
// never resolved.
describe("buildPagedResults", () => {
  const window = new Map([
    [7, { createdAt: 70, messageId: "m7", preview: "deploy the seventh" }],
    [8, { createdAt: 80, messageId: "m8", preview: "deploy the eighth" }],
  ]);

  test("renders the stored preview with real highlight ranges", () => {
    // Both rows match, as they must: the store filtered this window, so a paged
    // row is trusted to match the way the head trusts its index rows.
    const results = buildPagedResults({
      corpusById: new Map(),
      query: "deploy",
      rows: window,
      tokens: ["deploy"],
    });
    expect(results).toHaveLength(2);
    for (const result of results) {
      for (const range of result.ranges) {
        expect(result.snippet.text.slice(range.start, range.end)).toBe(
          "deploy"
        );
      }
    }
  });

  test("orders the page newest first, by real timestamps", () => {
    const results = buildPagedResults({
      corpusById: new Map(),
      query: "deploy",
      rows: window,
      tokens: ["deploy"],
    });
    expect(results.map((row) => row.id)).toEqual(["m8", "m7"]);
  });

  // The overlay matters: a row the transcript happens to hold should show the
  // WHOLE message, not the stored prefix, and must score exactly as it would on
  // the head page.
  test("a loaded row shows its full text, not the stored prefix", () => {
    const full = "deploy the eighth, plus a lot more text after the prefix";
    const results = buildPagedResults({
      corpusById: new Map([["m8", { createdAt: 80, id: "m8", text: full }]]),
      query: "eighth",
      rows: window,
      tokens: ["eighth"],
    });
    const loaded = results.find((row) => row.id === "m8");
    expect(loaded?.text).toBe(full);
    // The highlight is still on the matched word, inside the full text.
    for (const range of loaded?.ranges ?? []) {
      expect(loaded?.snippet.text.slice(range.start, range.end)).toBe("eighth");
    }
  });

  test("a loaded row scores the same as it does on the head page", () => {
    const candidate = { createdAt: 80, id: "m8", text: "deploy the eighth" };
    const head = mergeSearchSnapshot({
      corpus: [candidate],
      index: null,
      query: "eighth",
    });
    const [paged] = buildPagedResults({
      corpusById: new Map([["m8", candidate]]),
      query: "eighth",
      rows: new Map([
        [8, { createdAt: 80, messageId: "m8", preview: "deploy the eighth" }],
      ]),
      tokens: ["eighth"],
    });
    const [fromHead] = head.ranked;
    expect(paged?.score).toBe(fromHead?.score);
    expect(paged?.snippet.text).toBe(fromHead?.snippet.text);
    expect(paged?.ranges).toEqual(fromHead?.ranges);
  });

  test("a row with no stored preview and no loaded text is skipped", () => {
    const results = buildPagedResults({
      corpusById: new Map(),
      query: "deploy",
      rows: new Map([[3, { createdAt: 3, messageId: "m3", preview: "" }]]),
      tokens: ["deploy"],
    });
    expect(results).toEqual([]);
  });

  test("same-timestamp rows order deterministically", () => {
    const tied = new Map([
      [1, { createdAt: 42, messageId: "b", preview: "deploy b" }],
      [2, { createdAt: 42, messageId: "a", preview: "deploy a" }],
    ]);
    const first = buildPagedResults({
      corpusById: new Map(),
      query: "deploy",
      rows: tied,
      tokens: ["deploy"],
    });
    const reversed = new Map([...tied].toReversed());
    const second = buildPagedResults({
      corpusById: new Map(),
      query: "deploy",
      rows: reversed,
      tokens: ["deploy"],
    });
    expect(first.map((row) => row.id)).toEqual(["a", "b"]);
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
  });
});
