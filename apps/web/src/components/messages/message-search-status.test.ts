import { describe, expect, test } from "bun:test";

import {
  isMessageSearchQueryTooLong,
  MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE,
  searchChatStatus,
  searchCoverageLabel,
  searchListEmptyState,
  searchListStatus,
  searchStorageStatus,
} from "./message-search-status";

const COVERED = { fullyCovered: true, indexingOlder: false, queryReady: true };
const PARTIAL = { fullyCovered: false, indexingOlder: false, queryReady: true };
const WALKING = { fullyCovered: false, indexingOlder: true, queryReady: true };

describe("isMessageSearchQueryTooLong", () => {
  test("measures the normalized query in Unicode code points", () => {
    expect(isMessageSearchQueryTooLong("😀".repeat(256))).toBe(false);
    expect(isMessageSearchQueryTooLong("😀".repeat(257))).toBe(true);
  });
});

describe("searchChatStatus", () => {
  test("says nothing until the query is worth searching", () => {
    expect(
      searchChatStatus({
        ...COVERED,
        activePosition: 0,
        matchCount: 0,
        queryReady: false,
      })
    ).toBe("");
  });

  test("counts matches when the whole conversation is covered", () => {
    expect(
      searchChatStatus({ ...COVERED, activePosition: 3, matchCount: 12 })
    ).toBe("3 of 12");
  });

  test("starts at the first match when nothing is active yet", () => {
    expect(
      searchChatStatus({ ...COVERED, activePosition: 0, matchCount: 12 })
    ).toBe("1 of 12");
  });

  test("claims nothing when a covered conversation has no matches", () => {
    expect(
      searchChatStatus({ ...COVERED, activePosition: 0, matchCount: 0 })
    ).toBe("No results");
  });

  // The honesty rule: a count from a partly indexed conversation is a count of
  // what was searched, not of what exists.
  test("qualifies a count while older history is unindexed", () => {
    expect(
      searchChatStatus({ ...PARTIAL, activePosition: 1, matchCount: 4 })
    ).toBe("1 of 4 so far");
  });

  test("does not say no results while older history is unindexed", () => {
    expect(
      searchChatStatus({ ...PARTIAL, activePosition: 0, matchCount: 0 })
    ).toBe("No matches yet");
  });

  test("says searching while a walk is running", () => {
    expect(
      searchChatStatus({ ...WALKING, activePosition: 0, matchCount: 0 })
    ).toBe("Searching…");
  });

  test("still counts matches found during a walk", () => {
    expect(
      searchChatStatus({ ...WALKING, activePosition: 2, matchCount: 7 })
    ).toBe("2 of 7 so far");
  });
});

describe("searchListStatus", () => {
  test("shows the visible slice when covered", () => {
    expect(
      searchListStatus({
        ...COVERED,
        rangeEnd: 20,
        rangeStart: 1,
        resultCount: 20,
        totalResults: 87,
      })
    ).toBe("1–20 of 87");
  });

  test("qualifies the slice while older history is unindexed", () => {
    expect(
      searchListStatus({
        ...PARTIAL,
        rangeEnd: 20,
        rangeStart: 1,
        resultCount: 20,
        totalResults: 87,
      })
    ).toBe("1–20 of 87 so far");
  });

  test("does not say no results while older history is unindexed", () => {
    expect(
      searchListStatus({
        ...PARTIAL,
        rangeEnd: 0,
        rangeStart: 0,
        resultCount: 0,
        totalResults: 0,
      })
    ).toBe("No matches yet");
  });

  test("says searching while a walk is running", () => {
    expect(
      searchListStatus({
        ...WALKING,
        rangeEnd: 0,
        rangeStart: 0,
        resultCount: 0,
        totalResults: 0,
      })
    ).toBe("Searching…");
  });

  // The reported contradiction: a fresh profile showed "1-20 of 29" beside an
  // empty list. The count was real, the rows were not in hand yet, and the bar
  // claimed a slice the page could not show.
  test("never claims a slice over a page with no rows", () => {
    expect(
      searchListStatus({
        ...COVERED,
        rangeEnd: 20,
        rangeStart: 1,
        resultCount: 0,
        totalResults: 29,
      })
    ).toBe("Loading matches…");
  });

  test("says the same while a walk is still filling the page", () => {
    expect(
      searchListStatus({
        ...WALKING,
        rangeEnd: 20,
        rangeStart: 1,
        resultCount: 0,
        totalResults: 29,
      })
    ).toBe("Loading matches…");
  });

  // The branch the whole status change exists for, and the one the earlier
  // tests did not pin. An empty page beside a nonzero total says one of two
  // different things depending on whether a newer index generation exists that
  // this page has not read:
  //   - it has, so waiting is the honest instruction;
  //   - it has not, so the page is simply empty and promising more would be a
  //     lie about a walk that was never going to fill it.
  test("distinguishes waiting on the index from a page that is simply empty", () => {
    expect(
      searchListStatus({
        ...WALKING,
        listPageStale: true,
        rangeEnd: 20,
        rangeStart: 1,
        resultCount: 0,
        totalResults: 29,
      })
    ).toBe("Still indexing…");
    expect(
      searchListStatus({
        ...WALKING,
        listPageStale: false,
        rangeEnd: 20,
        rangeStart: 1,
        resultCount: 0,
        totalResults: 29,
      })
    ).toBe("Loading matches…");
  });

  // A page that IS showing rows is not waiting on anything, stale or not: the
  // range is the answer.
  test("a page with rows reports its range even while it is stale", () => {
    expect(
      searchListStatus({
        ...WALKING,
        listPageStale: true,
        rangeEnd: 20,
        rangeStart: 1,
        resultCount: 20,
        totalResults: 29,
      })
    ).toBe("1–20 of 29 so far");
  });

  // The mirror of the above: a sticky total can lag the live match set low, and
  // a range that runs past the stated total is as self-contradictory as one over
  // no rows at all.
  test("raises the total to meet a range that outruns it", () => {
    expect(
      searchListStatus({
        ...COVERED,
        rangeEnd: 40,
        rangeStart: 21,
        resultCount: 20,
        totalResults: 25,
      })
    ).toBe("21–40 of 40");
  });
});

describe("searchStorageStatus", () => {
  test("uses an ordinary failure message when a local write is refused", () => {
    expect(searchStorageStatus({ storageFull: true })).toBe(
      "Search couldn't finish"
    );
  });

  test("says nothing when local storage is available", () => {
    expect(searchStorageStatus({ storageFull: false })).toBe("");
  });
});

describe("searchCoverageLabel", () => {
  test("describes automatic progress without exposing index counters", () => {
    expect(
      searchCoverageLabel({
        fullyCovered: false,
        indexingOlder: true,
      })
    ).toBe("Searching older messages…");
  });

  test("declares incomplete history while the background walk is between pages", () => {
    expect(
      searchCoverageLabel({
        fullyCovered: false,
        indexingOlder: false,
      })
    ).toBe("Searching older messages…");
  });

  test("uses ordinary retry copy after an incomplete search", () => {
    expect(
      searchCoverageLabel({
        fullyCovered: false,
        indexFailed: true,
        indexingOlder: false,
      })
    ).toBe("Search couldn't finish");
  });

  test("does not show an index state when no work or failure exists", () => {
    expect(
      searchCoverageLabel({
        fullyCovered: true,
        indexingOlder: false,
      })
    ).toBe("");
  });
});

describe("searchListEmptyState", () => {
  test("reports an oversized query instead of an empty search result", () => {
    expect(
      searchListEmptyState({
        ...BASE,
        queryTooLong: true,
        totalMatches: 0,
      })
    ).toBe(MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE);
  });

  const BASE = {
    indexing: false,
    indexingOlder: false,
    listPageError: null,
    listPageLoading: false,
    listPageStale: false,
    queryReady: true,
    resultCount: 0,
    totalMatches: 0,
  };

  test("says nothing until the query is worth searching", () => {
    expect(
      searchListEmptyState({ ...BASE, queryReady: false, totalMatches: 29 })
    ).toBeNull();
  });

  test("says nothing while rows are on screen", () => {
    expect(
      searchListEmptyState({ ...BASE, resultCount: 20, totalMatches: 29 })
    ).toBeNull();
  });

  test("a failed page reports the failure, never an empty result set", () => {
    expect(
      searchListEmptyState({
        ...BASE,
        listPageError: "This page could not be loaded. Go back and retry.",
        totalMatches: 29,
      })
    ).toBe("This page could not be loaded. Go back and retry.");
  });

  test("a page still reading reads as a read", () => {
    expect(
      searchListEmptyState({
        ...BASE,
        listPageLoading: true,
        totalMatches: 29,
      })
    ).toBe("Loading this page…");
  });

  // The reported bug: an empty page beside "29 matches" read "No messages
  // match this search" while the bar beside it counted 29. The body must agree
  // that matches exist and say where they are instead.
  test("an empty page with matches says the matches are elsewhere", () => {
    expect(searchListEmptyState({ ...BASE, totalMatches: 29 })).toBe(
      "No more matches past this page."
    );
  });

  // The reported bug, second half: page 2 onward sat on "More matches are still
  // indexing" while a walk ran, even when the walk was never going to fill that
  // window. Only a page that has NOT read the current index generation may say
  // that; a page that is merely empty has to admit it.
  test("only a page behind the index may say matches are still indexing", () => {
    expect(
      searchListEmptyState({
        ...BASE,
        indexingOlder: true,
        listPageStale: true,
        totalMatches: 29,
      })
    ).toBe("More matches are still indexing.");
    expect(
      searchListEmptyState({ ...BASE, indexingOlder: true, totalMatches: 29 })
    ).toBe("No more matches past this page.");
  });

  test("a genuinely empty result set says so only once settled", () => {
    expect(searchListEmptyState(BASE)).toBe("No messages match this search.");
    // While the transcript is still filling, emptiness is provisional.
    expect(searchListEmptyState({ ...BASE, indexing: true })).toBeNull();
    expect(searchListEmptyState({ ...BASE, indexingOlder: true })).toBeNull();
  });
});
