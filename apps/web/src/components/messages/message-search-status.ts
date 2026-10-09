// Status text for the search bar, kept out of the component so the wording can be
// tested and so the honesty rules live in one place.
//
// The rule these encode: the bar must never claim more than it knows. A count
// drawn from a partially indexed conversation says how many messages were
// searched, not how many exist, and "No results" against a thread whose older
// half has never been read is a lie the user will act on. So while coverage is
// partial the wording says so, and only a fully indexed conversation gets a
// plain "No results".

import { normalizeMessageSearchQuery } from "@asm/messages/normalization";
import { MESSAGE_SEARCH_MAXIMUM_QUERY_CODE_POINTS } from "@asm/messages/search-contracts";

export interface SearchStatusInput {
  // A backfill walk is paging through older history right now.
  indexingOlder: boolean;
  // False while older history is known to exist but has not been indexed.
  fullyCovered: boolean;
  queryReady: boolean;
}

export function isMessageSearchQueryTooLong(query: string): boolean {
  const normalized = normalizeMessageSearchQuery(query).normalizedQuery;
  return [...normalized].length > MESSAGE_SEARCH_MAXIMUM_QUERY_CODE_POINTS;
}

export const MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE = `Search queries must be ${MESSAGE_SEARCH_MAXIMUM_QUERY_CODE_POINTS} characters or fewer`;

export interface SearchChatStatusInput extends SearchStatusInput {
  activePosition: number;
  matchCount: number;
}

export interface SearchListStatusInput extends SearchStatusInput {
  // Rows the current page actually holds. A page whose window has not landed
  // yet, or whose read failed, holds none while the total still counts them:
  // printing a range over zero rows is the "1-20 of 29" beside an empty body
  // that made the two halves of one answer disagree.
  resultCount: number;
  // The page is waiting on the index rather than on a read. Only changes the
  // wording of an unresolved page.
  listPageStale: boolean;
  rangeEnd: number;
  rangeStart: number;
  totalResults: number;
}

// Chat view: the match counter, with a qualifier when the conversation is only
// partly searchable.
export function searchChatStatus(input: SearchChatStatusInput): string {
  const {
    activePosition,
    fullyCovered,
    indexingOlder,
    matchCount,
    queryReady,
  } = input;
  if (!queryReady) {
    return "";
  }
  if (matchCount === 0) {
    if (indexingOlder) {
      return "Searching…";
    }
    return fullyCovered ? "No results" : "No matches yet";
  }
  const position = `${activePosition > 0 ? activePosition : 1} of ${matchCount}`;
  return fullyCovered ? position : `${position} so far`;
}

// List view: which slice of the ranked results is on screen, with the same
// qualifier.
export function searchListStatus(input: SearchListStatusInput): string {
  const {
    fullyCovered,
    indexingOlder,
    listPageStale,
    queryReady,
    resultCount,
    rangeEnd,
    rangeStart,
    totalResults,
  } = input;
  if (!queryReady) {
    return "";
  }
  if (totalResults === 0) {
    if (indexingOlder) {
      return "Searching…";
    }
    return fullyCovered ? "No results" : "No matches yet";
  }
  if (resultCount === 0) {
    // Matches are counted, this page is not in hand. Says so instead of
    // borrowing a range; the body explains which of reading/indexing it is, and
    // whether the page is waiting on a read or on the index catching up.
    return listPageStale ? "Still indexing…" : "Loading matches…";
  }
  // The range describes the rows on screen, so the denominator is raised to
  // meet it: a sticky total that undercounts the live match set would otherwise
  // claim fewer matches than the page visibly shows.
  const total = Math.max(totalResults, rangeEnd);
  const slice = `${rangeStart}–${rangeEnd} of ${total}`;
  return fullyCovered ? slice : `${slice} so far`;
}

export interface SearchListEmptyInput {
  indexing: boolean;
  indexingOlder: boolean;
  listPageError: string | null;
  listPageLoading: boolean;
  // The page's window predates the index generation on hand, so commits since
  // then may hold matches for it. Distinct from "a read is in flight" and from
  // "the read failed", and the only one of the three where waiting is the
  // correct advice.
  listPageStale: boolean;
  queryReady: boolean;
  queryTooLong?: boolean;
  // Rows actually on screen, which can be fewer than the matches: the list
  // pages one window at a time, so an empty page with a nonzero total is "not
  // here", never "does not exist".
  resultCount: number;
  totalMatches: number;
}

// The list body's empty state. Kept here with the other wording so the rule is
// testable: the counter and the body must never contradict each other. An empty
// page beside a nonzero total used to read "No messages match this search"
// while the bar beside it counted 29 -- the two halves of one answer
// disagreeing. Now the empty body says which of the three is true: still
// reading, failed to read, matches elsewhere, or genuinely nothing.
export function searchListEmptyState(
  input: SearchListEmptyInput
): string | null {
  const {
    indexing,
    indexingOlder,
    listPageError,
    listPageLoading,
    listPageStale,
    queryReady,
    queryTooLong = false,
    resultCount,
    totalMatches,
  } = input;
  if (queryTooLong) {
    return MESSAGE_SEARCH_QUERY_TOO_LONG_MESSAGE;
  }
  if (resultCount > 0) {
    return null;
  }
  if (!queryReady) {
    return null;
  }
  if (listPageError) {
    return listPageError;
  }
  if (listPageLoading) {
    return "Loading this page…";
  }
  if (totalMatches > 0) {
    // "Still indexing" is only honest when a newer index generation actually
    // exists that this page has not read. It used to be inferred from "a walk is
    // running", which is why a page that simply had nothing in its window -- or
    // whose window had not been re-read since a dozen commits -- told the user
    // to wait for a walk that was never going to fill it.
    if (listPageStale) {
      return "More matches are still indexing.";
    }
    // No inference left: a current read of this window found nothing in it, and
    // a walk running somewhere else is not a reason to keep promising this page.
    return "No more matches past this page.";
  }
  if (indexing || indexingOlder) {
    return null;
  }
  return "No messages match this search.";
}

export function searchCoverageLabel(input: {
  fullyCovered: boolean;
  indexingOlder: boolean;
  indexFailed?: boolean;
}): string {
  if (input.indexFailed) {
    return "Search couldn't finish";
  }
  return input.indexingOlder || !input.fullyCovered
    ? "Searching older messages…"
    : "";
}

export function searchStorageStatus(input: { storageFull: boolean }): string {
  return input.storageFull ? "Search couldn't finish" : "";
}
