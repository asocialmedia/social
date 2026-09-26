import { describe, expect, test } from "bun:test";

import { decidePageRead, headPageBoundary } from "./search-page-refresh";

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
function facts(messageId: string) {
  return { createdAt: 0, messageId, preview: "" };
}

describe("headPageBoundary", () => {
  test("no window means no boundary", () => {
    expect(
      headPageBoundary({ shownMessageIds: new Set(), windowRows: new Map() })
    ).toBeNull();
  });

  // The regression, in shape. The head window holds far more than one page, so a
  // boundary taken from the WINDOW ignores every match between the displayed
  // slice and the end of the window. Taken from the displayed slice, the window's
  // own tail is at least accounted for.
  test("reads the displayed slice, not the whole window", () => {
    const windowRows = new Map([
      [100, facts("m100")],
      [99, facts("m99")],
      [98, facts("m98")],
      [50, facts("m50")],
      [49, facts("m49")],
    ]);
    // The head shows rows 100 and 99. The boundary is 99 -- the extreme shown
    // row -- rather than 49, the window's own extreme, which would account for
    // neither 98 nor 50.
    expect(
      headPageBoundary({
        shownMessageIds: new Set(["m100", "m99"]),
        windowRows,
      })
    ).toBe(99);
  });

  test("takes the lowest shown row when the slice interleaves the window", () => {
    const windowRows = new Map([
      [10, facts("m10")],
      [9, facts("m9")],
      [8, facts("m8")],
    ]);
    expect(
      headPageBoundary({
        shownMessageIds: new Set(["m10", "m8", "loaded-row"]),
        windowRows,
      })
    ).toBe(8);
  });

  // A head page of decoded transcript text the writer has not committed shows no
  // indexed row at all. With nothing shown, the rule falls back to the window's
  // own extreme rather than reporting no boundary and leaving the pager stuck.
  test("falls back to the window extreme when nothing indexed is shown", () => {
    const windowRows = new Map([
      [7, facts("m7")],
      [6, facts("m6")],
    ]);
    expect(
      headPageBoundary({
        shownMessageIds: new Set(["loaded-1", "loaded-2"]),
        windowRows,
      })
    ).toBe(7);
  });

  test("a row shown twice in the window resolves to its lowest instance", () => {
    const windowRows = new Map([
      [12, facts("m12")],
      [11, facts("m11")],
    ]);
    expect(
      headPageBoundary({ shownMessageIds: new Set(["m11"]), windowRows })
    ).toBe(11);
  });
});
