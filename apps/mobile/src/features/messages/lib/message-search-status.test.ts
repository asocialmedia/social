// Ported from apps/web/src/components/messages/message-search-status.test.ts:
// the contract branches the native bar and empty body must honor.
import { expect, test } from "bun:test";

import {
  isMessageSearchQueryTooLong,
  MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE,
  searchListEmptyState,
} from "./message-search-status";

test("queries past the contract read as too long", () => {
  expect(isMessageSearchQueryTooLong("a".repeat(257))).toBe(true);
  expect(isMessageSearchQueryTooLong("a".repeat(256))).toBe(false);
  expect(isMessageSearchQueryTooLong("short")).toBe(false);
  expect(MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE).toBe(
    "Search queries must be 256 characters or fewer"
  );
});

function empty(overrides = {}) {
  return {
    coverageUnavailable: false,
    indexing: false,
    indexingOlder: false,
    listPageError: null,
    listPageLoading: false,
    listPageStale: false,
    queryReady: true,
    resultCount: 0,
    savedScope: false,
    totalMatches: 0,
    ...overrides,
  };
}

test("the contract wins over every other empty state", () => {
  expect(
    searchListEmptyState(
      empty({ listPageError: "Read failed", queryTooLong: true })
    )
  ).toBe(MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE);
});

test("a scope with nothing in it names the scope", () => {
  expect(searchListEmptyState(empty({ savedScope: true }))).toBe(
    "No matching saved messages."
  );
  expect(searchListEmptyState(empty({ coverageUnavailable: true }))).toBe(
    "No matches in searchable history. Some older messages couldn't be searched."
  );
  expect(searchListEmptyState(empty())).toBe("No messages match this search.");
});

test("an unresolved page says which wait it is", () => {
  expect(
    searchListEmptyState(
      empty({ listPageError: "Couldn't load this page. Try again." })
    )
  ).toBe("Couldn't load this page. Try again.");
  expect(searchListEmptyState(empty({ listPageLoading: true }))).toBe(
    "Loading this page…"
  );
  expect(
    searchListEmptyState(empty({ listPageStale: true, totalMatches: 3 }))
  ).toBe("More matches are still indexing.");
  expect(searchListEmptyState(empty({ totalMatches: 3 }))).toBe(
    "No more matches past this page."
  );
});
