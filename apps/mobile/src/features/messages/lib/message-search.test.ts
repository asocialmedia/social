import { describe, expect, test } from "bun:test";

import {
  extractSearchableText,
  findMatchingIds,
  paginateSearchResults,
  rankSearchResults,
} from "./message-search";
import { searchChatStatus } from "./message-search-status";

describe("web-compatible native message search", () => {
  test("chat search remains usable without Hermes-missing array methods", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      "toSorted"
    );
    // oxlint-disable-next-line no-extend-native -- emulate the Hermes runtime for this synchronous regression
    Object.defineProperty(Array.prototype, "toSorted", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(
        findMatchingIds([{ createdAt: 1, id: "one", text: "hello" }], "hello")
      ).toEqual(["one"]);
      expect(
        rankSearchResults([{ createdAt: 1, id: "one", text: "hello" }], "hello")
      ).toHaveLength(1);
    } finally {
      if (descriptor) {
        // oxlint-disable-next-line no-extend-native -- restore the host runtime after the Hermes regression
        Object.defineProperty(Array.prototype, "toSorted", descriptor);
      } else {
        Reflect.deleteProperty(Array.prototype, "toSorted");
      }
    }
  });
  const corpus = [
    { createdAt: 1, id: "old", text: "Café deployment went well" },
    { createdAt: 3, id: "new", text: "Deployment at the cafe" },
    { createdAt: 2, id: "unrelated", text: "deployment only" },
  ];

  test("AND tokens and accents share the same matches in chat and results", () => {
    expect(findMatchingIds(corpus, "cafe deploy")).toEqual(["new", "old"]);
    expect(
      new Set(rankSearchResults(corpus, "cafe deploy").map((row) => row.id))
    ).toEqual(new Set(["new", "old"]));
    expect(findMatchingIds(corpus, "c")).toEqual([]);
  });

  test("ranked snippets highlight original text without removing transcript rows", () => {
    const results = rankSearchResults(corpus, "deployment");
    const match = results.find((row) => row.id === "old");
    expect(
      match?.ranges.map((range) =>
        match.snippet.text.slice(range.start, range.end)
      )
    ).toEqual(["deployment"]);
    expect(corpus.length).toBe(3);
  });

  test("captionless media and posts are findable", () => {
    expect(extractSearchableText({ kind: "gif", type: "media" }).text).toBe(
      "Shared a GIF"
    );
    expect(extractSearchableText({ content: "hello", type: "post" }).text).toBe(
      "hello Shared a post"
    );
  });

  test("pagination clamps after the query narrows", () => {
    const results = rankSearchResults(corpus, "deployment");
    expect(paginateSearchResults(results, 9, 2)).toMatchObject({
      page: 1,
      pageCount: 2,
      rangeEnd: 3,
      rangeStart: 3,
    });
    expect(paginateSearchResults(results.slice(0, 1), 9, 2).page).toBe(0);
  });

  test("partial coverage never claims no results over unread history", () => {
    expect(
      searchChatStatus({
        activePosition: 0,
        fullyCovered: false,
        indexingOlder: false,
        matchCount: 0,
        queryReady: true,
      })
    ).toBe("No matches yet");
    expect(
      searchChatStatus({
        activePosition: 1,
        fullyCovered: false,
        indexingOlder: false,
        matchCount: 2,
        queryReady: true,
      })
    ).toBe("1 of 2 so far");
  });
});
