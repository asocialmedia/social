// When an on-demand list page may be read again.
//
// A page turn is a local index read -- milliseconds -- while the index it reads
// is being written continuously by a backfill. Left alone, that is a read per
// commit; ignored entirely, the page keeps answering a question about a snapshot
// that has since moved, which is how page 2 sat empty and stale through a whole
// walk. The decision is extracted from the hook because it is a scheduling rule
// with edge cases worth pinning, and because a hook test here would need a React
// harness this package does not have.

import type { SearchIndexCursor } from "./search-index-format";

export type PageReadDecision =
  // Read now.
  | { kind: "read" }
  // The page already reflects this generation of the index.
  | { kind: "current" }
  // Newer rows exist but the last read was too recent; come back in `waitMs`.
  | { kind: "wait"; waitMs: number };

export function decidePageRead(input: {
  // The generation the page's last COMPLETED read used, if any. A failed read
  // records nothing, so a failure is re-read rather than treated as current.
  readGeneration?: number;
  // When that read ran, if it did.
  readAt?: number;
  // The generation on hand now.
  generation: number;
  // Floor between two reads of the same page.
  minIntervalMs: number;
  now: number;
}): PageReadDecision {
  if (input.readGeneration === input.generation) {
    return { kind: "current" };
  }
  // The floor applies to a page that has SUCCEEDED at reading before. A page
  // whose read failed is retried at once: the user asked for it, and a failure is
  // not something to make them wait out.
  if (input.readGeneration === undefined || input.readAt === undefined) {
    return { kind: "read" };
  }
  const waitMs = input.minIntervalMs - (input.now - input.readAt);
  return waitMs > 0 ? { kind: "wait", waitMs } : { kind: "read" };
}

// The keyset boundary for the first on-demand page: the OLDEST match already
// SHOWN on the page before it, in the index's own order.
//
// Correct in shape, and it fixes one real gap: this used to be the lowest row of
// the whole head WINDOW, which is only right when the head displays every row it
// holds. The window is capped at SEARCH_INDEX_QUERY_LIMIT rows and displays
// SEARCH_PAGE_SIZE of them, so hanging page 1 below the window skipped every match
// between the displayed slice and the end of the window -- up to two thousand
// messages reachable from nowhere, behind a pager offering page after page of
// nothing.
//
// The order is (createdAt, row), newest first, and that is no longer a caveat.
// This used to walk row ids, on the assumption that they ascend with message age.
// They do not: a backfill descends from the newest page, so LOW row ids are the
// NEWEST messages (measured on the 200k fixture, row 975 is the newest message and
// row 44416 the oldest), which made "lowest" the newest match and the boundary
// the top of the set with nothing above it. That is the empty-page-2 report, and
// `selectNewestFirstWindow` is where the ordering key is fixed.
//
// `shownMessageIds` is the id set the head actually renders; `windowRows` is the
// window's row -> message mapping. Falling back to the oldest row in the WHOLE
// window matters: the head's displayed slice can be entirely in-memory matches
// that this index window does not hold, and with no boundary page 1 would have
// nowhere to start and would silently re-serve the head.
export function headPageCursor(input: {
  shownMessageIds: ReadonlySet<string>;
  windowRows: ReadonlyMap<
    number,
    { createdAt: number; messageId: string; preview: string }
  >;
}): SearchIndexCursor | null {
  let oldestShown: SearchIndexCursor | null = null;
  let oldestInWindow: SearchIndexCursor | null = null;
  for (const [row, facts] of input.windowRows) {
    const cursor: SearchIndexCursor = {
      createdAt: facts.createdAt,
      row,
    };
    if (oldestInWindow === null || isOlder(cursor, oldestInWindow)) {
      oldestInWindow = cursor;
    }
    if (
      input.shownMessageIds.has(facts.messageId) &&
      (oldestShown === null || isOlder(cursor, oldestShown))
    ) {
      oldestShown = cursor;
    }
  }
  return oldestShown ?? oldestInWindow;
}

// Which of two cursors is the OLDER message -- the one a page turn starts below.
function isOlder(left: SearchIndexCursor, right: SearchIndexCursor): boolean {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt;
  }
  // Same millisecond. The higher row id is older, matching the order
  // `selectNewestFirstWindow` sorts by.
  return left.row > right.row;
}
