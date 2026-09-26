import { describe, expect, test } from "bun:test";

import {
  searchChatStatus,
  searchCoverageLabel,
  searchListStatus,
  searchStorageStatus,
} from "./message-search-status";

const COVERED = { fullyCovered: true, indexingOlder: false, queryReady: true };
const PARTIAL = { fullyCovered: false, indexingOlder: false, queryReady: true };
const WALKING = { fullyCovered: false, indexingOlder: true, queryReady: true };

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
        totalResults: 0,
      })
    ).toBe("Searching…");
  });
});

describe("searchStorageStatus", () => {
  // The point of surfacing this: a full disk used to be indistinguishable from a
  // conversation with no matches, so results were silently narrower than the user
  // believed.
  test("says storage is full when a write was refused", () => {
    expect(searchStorageStatus({ evictedCount: 0, storageFull: true })).toBe(
      "Storage full"
    );
  });

  test("reports conversations dropped to stay inside the budget", () => {
    expect(searchStorageStatus({ evictedCount: 3, storageFull: false })).toBe(
      "Older indexes removed (3)"
    );
  });

  test("says nothing when there is no pressure", () => {
    expect(searchStorageStatus({ evictedCount: 0, storageFull: false })).toBe(
      ""
    );
  });

  test("a full disk outranks an eviction notice", () => {
    expect(searchStorageStatus({ evictedCount: 2, storageFull: true })).toBe(
      "Storage full"
    );
  });
});

describe("searchCoverageLabel", () => {
  test("offers the walk plainly when nothing is indexed yet", () => {
    expect(searchCoverageLabel({ indexedCount: 0, indexingOlder: false })).toBe(
      "Index older messages"
    );
  });

  test("reports how much is already covered", () => {
    expect(
      searchCoverageLabel({ indexedCount: 12_480, indexingOlder: false })
    ).toBe("Index older messages (12,480 indexed)");
  });

  test("reports progress while the walk runs", () => {
    expect(
      searchCoverageLabel({ indexedCount: 12_480, indexingOlder: true })
    ).toBe("Indexing older messages (12,480 indexed)");
  });

  test("a fresh walk with nothing covered yet has no count to show", () => {
    expect(searchCoverageLabel({ indexedCount: 0, indexingOlder: true })).toBe(
      "Indexing older messages"
    );
  });

  test("a failed run asks for a retry instead of looking done", () => {
    expect(
      searchCoverageLabel({
        indexFailed: true,
        indexedCount: 12_480,
        indexingOlder: false,
      })
    ).toBe("Retry indexing older messages");
  });
});
