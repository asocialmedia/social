import { describe, expect, test } from "bun:test";

import {
  decidePageRead,
  decidePageRequest,
  headPageCursor,
} from "./search-page-refresh";

// The reported bug: page 2 onward of the results list did not change while the
// walk kept indexing, so it read as "no results here" for the whole session. The
// page read has to follow the index -- without turning a commit burst into a
// read burst.
describe("decidePageRead", () => {
  const MIN = 400;
  const base = { generation: 7, minIntervalMs: MIN, now: 10_000 };

  test("a page that has never been read reads immediately", () => {
    expect(decidePageRead(base)).toEqual({ kind: "read" });
  });

  // The effect re-runs for reasons that have nothing to do with the index -- a
  // page turn back, a boundary landing. Re-reading for those is a no-op that
  // still costs a transaction.
  test("a page already read at this generation is left alone", () => {
    expect(
      decidePageRead({ ...base, readAt: 9900, readGeneration: 7 })
    ).toEqual({ kind: "current" });
  });

  test("a newer generation reads again once the interval has passed", () => {
    expect(
      decidePageRead({
        ...base,
        generation: 8,
        readAt: 10_000 - MIN,
        readGeneration: 7,
      })
    ).toEqual({ kind: "read" });
  });

  // The other half of the tradeoff: commits land far faster than a page turn is
  // worth. A wait says exactly how long is left, so the caller can schedule a
  // trailing re-read instead of polling.
  test("a newer generation too soon waits out the remainder", () => {
    expect(
      decidePageRead({
        ...base,
        generation: 8,
        readAt: 10_000 - 100,
        readGeneration: 7,
      })
    ).toEqual({ kind: "wait", waitMs: MIN - 100 });
  });

  // A generation that went BACKWARDS (a re-seed, a reopened session) must not be
  // read as current, or the page would show a window from a query that is gone.
  test("an older recorded generation is not current", () => {
    expect(
      decidePageRead({
        ...base,
        generation: 6,
        readAt: 9000,
        readGeneration: 7,
      })
    ).toEqual({ kind: "read" });
  });

  // A read that FAILED records no generation, so the page is retried at once --
  // including inside the floor, which exists to stop a SUCCESSFUL read being
  // repeated per commit, not to make a failure wait. Treating a failure as
  // current is how a page stays blank with no way back.
  test("a failed read retries immediately, floor or not", () => {
    expect(
      decidePageRead({
        ...base,
        readAt: 10_000,
        readGeneration: undefined,
      })
    ).toEqual({ kind: "read" });
  });
});

// The keyset boundary. These pin the SHAPE of the rule -- the boundary is taken
// from the rows page 0 actually shows, not from the whole window -- and that is
// the half that was genuinely wrong: the head displays SEARCH_PAGE_SIZE rows out
// of a window that holds far more, so a boundary taken from the window skipped
// everything in between.
//
// They deliberately do NOT claim the result is a usable boundary. It is not, and
// the test names say so: the index's descending-row-id order is not newest-first
// for a backfilled conversation, so "the extreme shown row" can be the newest
// match. Until the ordering key is time-based, these cases describe arithmetic
// over an ordering that has been measured to be inverted. A test asserting
// "page 1 reaches 98 and then 50" would be asserting the bug.
//
// Every fixture below deliberately makes the ROW order the REVERSE of the time
// order, which is what a backfill descending from the newest page produces. The
// old boundary walked row ids and read "lowest" as the extreme to hang the next
// page below; on this shape that is the NEWEST match, so page 2 had nothing above
// it to return. The cursor is a position in time now, and these say so.
function facts(messageId: string, createdAt: number) {
  return { createdAt, messageId, preview: "" };
}

describe("headPageCursor", () => {
  test("no window means no cursor", () => {
    expect(
      headPageCursor({ shownMessageIds: new Set(), windowRows: new Map() })
    ).toBeNull();
  });

  // The regression, in shape. The head window holds far more than one page, so a
  // boundary taken from the WINDOW ignores every match between the displayed
  // slice and the end of the window -- up to two thousand messages reachable from
  // nowhere. Taken from the displayed slice, the window's own tail is at least
  // accounted for.
  test("reads the displayed slice, not the whole window", () => {
    const windowRows = new Map([
      [100, facts("m100", 500)],
      [99, facts("m99", 400)],
      [98, facts("m98", 300)],
      [50, facts("m50", 200)],
      [49, facts("m49", 100)],
    ]);
    // The head shows the two newest. The cursor is the older of them -- row 99 at
    // time 400 -- not the window's own oldest, which would account for neither
    // row 98 nor row 50.
    expect(
      headPageCursor({
        shownMessageIds: new Set(["m100", "m99"]),
        windowRows,
      })
    ).toEqual({ createdAt: 400, row: 99 });
  });

  // The inversion, stated as a test. Rows ascend here while the messages get
  // OLDER, and the cursor has to follow the message.
  test("the cursor follows time, not the row id", () => {
    const windowRows = new Map([
      [5, facts("newest", 900)],
      [6, facts("middle", 800)],
      [7, facts("oldest", 700)],
    ]);
    expect(
      headPageCursor({
        shownMessageIds: new Set(["newest", "middle", "oldest"]),
        windowRows,
      })
    ).toEqual({ createdAt: 700, row: 7 });
  });

  test("takes the oldest shown match when the slice interleaves the window", () => {
    const windowRows = new Map([
      [10, facts("m10", 300)],
      [9, facts("m9", 200)],
      [8, facts("m8", 100)],
    ]);
    expect(
      headPageCursor({
        shownMessageIds: new Set(["m10", "m8", "loaded-row"]),
        windowRows,
      })
    ).toEqual({ createdAt: 100, row: 8 });
  });

  // A head page of decoded transcript text the writer has not committed shows no
  // indexed row at all. With nothing shown, the rule falls back to the window's
  // own oldest rather than reporting no cursor and leaving the pager stuck.
  test("falls back to the window's oldest when nothing indexed is shown", () => {
    const windowRows = new Map([
      [7, facts("m7", 200)],
      [6, facts("m6", 100)],
    ]);
    expect(
      headPageCursor({
        shownMessageIds: new Set(["loaded-1", "loaded-2"]),
        windowRows,
      })
    ).toEqual({ createdAt: 100, row: 6 });
  });

  // Same-millisecond sends are ordinary. Without the row tiebreak the cursor is
  // ambiguous inside the tie group, and a pager over an ambiguous order repeats
  // and drops rows.
  test("breaks a same-millisecond tie by row, oldest first", () => {
    const windowRows = new Map([
      [12, facts("m12", 100)],
      [11, facts("m11", 100)],
    ]);
    expect(
      headPageCursor({ shownMessageIds: new Set(["m12", "m11"]), windowRows })
    ).toEqual({ createdAt: 100, row: 12 });
  });
});

// The page-turn state machine. This is the sequencing a pager depends on, and it
// used to live inline in a hook effect where the suite could not reach it -- so the
// cases below are all reports that happened, not hypotheticals.
describe("decidePageRequest", () => {
  const base = {
    generation: 7,
    minIntervalMs: 400,
    now: 10_000,
    page: 1,
    ready: true,
  };
  // The head's displayed boundary: the oldest row page 0 shows.
  const headCursor = { createdAt: 500, row: 4 };

  test("page 0 is the merged head and never reads", () => {
    expect(decidePageRequest({ ...base, page: 0 })).toEqual({ kind: "skip" });
  });

  test("a closed session never reads", () => {
    expect(decidePageRequest({ ...base, ready: false })).toEqual({
      kind: "skip",
    });
  });

  test("page 1 reads from the head's boundary", () => {
    expect(decidePageRequest({ ...base, afterMatch: headCursor })).toEqual({
      afterMatch: headCursor,
      kind: "read",
    });
  });

  // An all-in-memory head shows no index row at all, so there is no boundary. The
  // read starts at the top of the match sequence, which is what an absent cursor
  // means -- and it must NOT be confused with "the page before is unreachable",
  // which is a different page's problem entirely.
  test("page 1 with no boundary still reads, from the top", () => {
    expect(decidePageRequest({ ...base, afterMatch: null })).toEqual({
      kind: "read",
    });
  });

  test("a deeper page reads from the page before it", () => {
    const previous = { createdAt: 400, row: 9 };
    expect(
      decidePageRequest({ ...base, afterMatch: previous, page: 2 })
    ).toEqual({ afterMatch: previous, kind: "read" });
  });

  // Paging faster than reads land is ordinary. Treating it as a failure is what
  // made fast paging a dead end behind a retry nobody had broken.
  test("a page whose predecessor is mid-read waits rather than failing", () => {
    expect(
      decidePageRequest({
        ...base,
        afterMatch: null,
        page: 3,
        previousState: "loading",
      })
    ).toEqual({ kind: "await-previous" });
  });

  test("a page whose predecessor failed is unreachable", () => {
    expect(
      decidePageRequest({
        ...base,
        afterMatch: null,
        page: 3,
        previousState: "failed",
      })
    ).toEqual({ kind: "unreachable" });
  });

  // The one that matters most on a fresh index. A page read early in a backfill
  // legitimately finds nothing past it, because the walk has not got there yet --
  // and then the walk fills that space. Trusting that stale verdict would strand
  // every match the walk had not reached, which is the unreachable-tail defect
  // arriving by a new route.
  test("a stale 'nothing past me' verdict is ignored, not trusted", () => {
    const decision = decidePageRequest({
      ...base,
      afterMatch: { createdAt: 300, row: 12 },
      page: 2,
      previousHasMore: false,
      // Read at generation 5; the index is at 7.
      previousReadGeneration: 5,
    });
    expect(decision.kind).toBe("read");
  });

  test("a current 'nothing past me' verdict ends the pager without a read", () => {
    expect(
      decidePageRequest({
        ...base,
        afterMatch: { createdAt: 300, row: 12 },
        page: 2,
        previousHasMore: false,
        previousReadGeneration: 7,
      })
    ).toEqual({ kind: "exhausted" });
  });

  test("a predecessor that never read has no verdict to trust", () => {
    const decision = decidePageRequest({
      ...base,
      afterMatch: { createdAt: 300, row: 12 },
      page: 2,
      previousHasMore: false,
      // Never read: absent is not the same as having read nothing.
      previousReadGeneration: undefined,
    });
    expect(decision.kind).toBe("read");
  });

  test("a window already read at this generation needs no read", () => {
    expect(
      decidePageRequest({
        ...base,
        afterMatch: headCursor,
        readAt: 9900,
        readGeneration: 7,
      })
    ).toEqual({ kind: "current" });
  });

  // Commits arrive far faster than a page turn is worth re-reading. One re-read
  // per window is enough, and the trailing tick brings it back.
  test("a window behind the index waits out the floor rather than reading", () => {
    expect(
      decidePageRequest({
        ...base,
        afterMatch: headCursor,
        now: 10_000,
        readAt: 9900,
        readGeneration: 6,
      })
    ).toEqual({ kind: "wait", waitMs: 300 });
  });
});
