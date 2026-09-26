// When an on-demand list page may be read again.
//
// A page turn is a local index read -- milliseconds -- while the index it reads
// is being written continuously by a backfill. Left alone, that is a read per
// commit; ignored entirely, the page keeps answering a question about a snapshot
// that has since moved, which is how page 2 sat empty and stale through a whole
// walk. The decision is extracted from the hook because it is a scheduling rule
// with edge cases worth pinning, and because a hook test here would need a React
// harness this package does not have.

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

// The keyset boundary for the first on-demand page: the extreme row id among the
// index rows ALREADY SHOWN on the page before it, in the direction the page read
// walks.
//
// Correct in shape, and it fixes one real gap: this used to be the lowest row of
// the whole head WINDOW, which is only right when the head displays every row it
// holds. The window is capped at SEARCH_INDEX_QUERY_LIMIT rows and displays
// SEARCH_PAGE_SIZE of them, so hanging page 1 below the window skipped every match
// between the displayed slice and the end of the window -- up to two thousand
// messages reachable from nowhere, behind a pager offering page after page of
// nothing.
//
// Its RESULT is still not trustworthy, and the caller must know that. The
// direction below is the index's own descending-row-id order, which is NOT
// newest-first for a backfilled conversation -- see the ordering note on
// `intersectPostingLists`, which measures the inversion. With the direction
// unverified, "lowest" can be the newest match, and the boundary is then the top
// of the set with nothing above it, which is exactly the empty-page-2 report.
// Fixing the ordering key is the prerequisite; this function is the piece that
// will then be right without further change.
//
// `shownMessageIds` is the id set the head actually renders; `windowRows` is the
// window's row -> message mapping.
export function headPageBoundary(input: {
  shownMessageIds: ReadonlySet<string>;
  windowRows: ReadonlyMap<
    number,
    { createdAt: number; messageId: string; preview: string }
  >;
}): number | null {
  let lowestShown: number | null = null;
  let highest: number | null = null;
  for (const [row, facts] of input.windowRows) {
    if (highest === null || row > highest) {
      highest = row;
    }
    if (
      input.shownMessageIds.has(facts.messageId) &&
      (lowestShown === null || row < lowestShown)
    ) {
      lowestShown = row;
    }
  }
  return lowestShown ?? highest;
}
