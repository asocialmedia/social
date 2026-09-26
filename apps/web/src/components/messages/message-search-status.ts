// Status text for the search bar, kept out of the component so the wording can be
// tested and so the honesty rules live in one place.
//
// The rule these encode: the bar must never claim more than it knows. A count
// drawn from a partially indexed conversation says how many messages were
// searched, not how many exist, and "No results" against a thread whose older
// half has never been read is a lie the user will act on. So while coverage is
// partial the wording says so, and only a fully indexed conversation gets a
// plain "No results".

export interface SearchStatusInput {
  // A backfill walk is paging through older history right now.
  indexingOlder: boolean;
  // False while older history is known to exist but has not been indexed.
  fullyCovered: boolean;
  queryReady: boolean;
}

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
    resultCount,
    totalMatches,
  } = input;
  if (!queryReady || resultCount > 0) {
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

// Label for the coverage control. The count is what the user has actually
// covered, which is the only number available and the only one that would let
// them decide whether the walk is worth starting.
// What the bar says when the device is out of index storage, or had to drop a
// conversation to stay inside its budget. Said in the status line rather than a
// toast because it is a standing condition, not an event: the user needs to know
// their results are narrower than they think.
export function searchStorageStatus(input: {
  evictedCount: number;
  storageFull: boolean;
}): string {
  const { evictedCount, storageFull } = input;
  if (storageFull) {
    return "Storage full";
  }
  if (evictedCount > 0) {
    return `Older indexes removed (${evictedCount})`;
  }
  return "";
}

export function searchCoverageLabel(input: {
  indexedCount: number;
  indexingOlder: boolean;
  // A run ended in failure (throttled past its retries, storage refused, a
  // request failed). The button must say so: an idle-looking bar after a
  // failure reads as "done" and nobody retries, stranding coverage silently.
  indexFailed?: boolean;
}): string {
  const { indexedCount, indexingOlder, indexFailed = false } = input;
  if (indexingOlder) {
    // While the walk runs, the label carries the live count: hovering the
    // spinner reads how much of the conversation is indexed so far.
    return indexedCount > 0
      ? `Indexing older messages (${indexedCount.toLocaleString()} indexed)`
      : "Indexing older messages";
  }
  if (indexFailed) {
    return "Retry indexing older messages";
  }
  return indexedCount > 0
    ? `Index older messages (${indexedCount.toLocaleString()} indexed)`
    : "Index older messages";
}
