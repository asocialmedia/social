// When a virtualized shared-content list reads its next page.
//
// Auto-loading is correct here because the read is LOCAL: `loadMore` is a keyset
// read of sixty rows out of the local refs index, not a request. The network-bound
// part of this feature is the backfill walk, which is separately gated and reports
// itself with its own line. The two were confused once, and the result was a "Load
// older" button on the end of every list plus a comment claiming a scroll-triggered
// read was something a reader had not asked for.
//
// The rule also has to cover the case that makes a naive sentinel break: a list
// shorter than the pane has nothing to scroll, so a trigger that waits for an
// intersection never fires and the pane never fills.

import { describe, expect, test } from "bun:test";

import {
  AUTO_LOAD_LAST_ROWS,
  shouldAutoLoadMore,
} from "./conversation-shared-frame";

function input(
  overrides: Partial<Parameters<typeof shouldAutoLoadMore>[0]> = {}
) {
  return {
    hasMore: true,
    lastVisibleRow: 10,
    readError: false,
    rowCount: 30,
    ...overrides,
  };
}

describe("shouldAutoLoadMore", () => {
  test("reads ahead while rows remain below the viewport", () => {
    // Within the threshold rows of the end: row 28 of 30, with 2 as the threshold.
    expect(
      shouldAutoLoadMore(input({ lastVisibleRow: 28, rowCount: 30 }))
    ).toBe(true);
    expect(
      shouldAutoLoadMore(
        input({ lastVisibleRow: 30 - AUTO_LOAD_LAST_ROWS, rowCount: 30 })
      )
    ).toBe(true);
  });

  test("stays quiet while the reader is nowhere near the end", () => {
    expect(shouldAutoLoadMore(input({ lastVisibleRow: 3, rowCount: 30 }))).toBe(
      false
    );
    // One row short of the threshold is still short of it: the read is meant to
    // start near the end, not as soon as the list is scrolled at all.
    expect(
      shouldAutoLoadMore(
        input({ lastVisibleRow: 30 - AUTO_LOAD_LAST_ROWS - 1, rowCount: 30 })
      )
    ).toBe(false);
  });

  // The case a scroll-triggered sentinel misses entirely. Every row is already
  // visible, there is nothing to scroll, and the only way the pane fills is to keep
  // reading -- so the last row being above the threshold is satisfied by definition.
  test("fills a list shorter than the pane", () => {
    for (const rowCount of [1, 2, AUTO_LOAD_LAST_ROWS]) {
      expect(
        shouldAutoLoadMore(input({ lastVisibleRow: rowCount - 1, rowCount }))
      ).toBe(true);
    }
  });

  test("stops at the end of the store", () => {
    expect(shouldAutoLoadMore(input({ hasMore: false }))).toBe(false);
  });

  test("does not keep reading a list that could not be read", () => {
    // A read failure sets the kind done, so continuing would spin on a store that
    // is not answering. The footer says so instead.
    expect(shouldAutoLoadMore(input({ readError: true }))).toBe(false);
  });

  test("waits for rows to be laid out at all", () => {
    // -1 is the first paint: the virtualizer has no scroll element yet, so there is
    // no last row and nothing to be near.
    expect(shouldAutoLoadMore(input({ lastVisibleRow: -1 }))).toBe(false);
  });

  test("an empty list with nothing more is quiet", () => {
    expect(
      shouldAutoLoadMore(
        input({ hasMore: false, lastVisibleRow: -1, rowCount: 0 })
      )
    ).toBe(false);
  });
});
