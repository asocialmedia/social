// The paging cursor: which read is allowed to move it, and why the read that FILLS
// the list has to be one of them.
//
// This is the rule behind a bug that looked like a rendering fault. The list is
// filled by a top-of-list read, which prepends and so legitimately leaves the
// cursor alone — the oldest row held has not changed. The cursor therefore stayed
// unset, the first "load older" went out with no cursor, and the store answered
// with page one again. The "more" merge appended it, so the grid grew a second
// copy of its own first screen at the bottom, and every click after that paged
// correctly. Nothing about the merge or the sort was wrong.

import { describe, expect, test } from "bun:test";

import { nextPagingCursor } from "./use-shared-refs-reader";

const PAGE_ONE_END = "0000005:m1:996";

describe("nextPagingCursor", () => {
  // The bug. A refresh on an empty list has just HELD page one, so it owns the
  // cursor whether or not anyone asked to page.
  test("a refresh that fills an empty list sets the cursor", () => {
    expect(
      nextPagingCursor({
        after: PAGE_ONE_END,
        currentAfter: undefined,
        currentDone: false,
        hasMore: true,
        mode: "refresh",
        started: false,
      })
    ).toStrictEqual({ after: PAGE_ONE_END, done: false });
  });

  test("so the first load-older starts below page one rather than at it", () => {
    const afterOpen = nextPagingCursor({
      after: PAGE_ONE_END,
      currentAfter: undefined,
      currentDone: false,
      hasMore: true,
      mode: "refresh",
      started: false,
    });
    const afterFirstPageIn = nextPagingCursor({
      after: "0000004:m20:999",
      currentAfter: afterOpen.after,
      currentDone: afterOpen.done,
      hasMore: true,
      mode: "more",
      started: true,
    });
    expect(afterFirstPageIn.after).toBe("0000004:m20:999");
    expect(afterFirstPageIn.after).not.toBe(PAGE_ONE_END);
  });

  // A refresh on a list that already has rows prepends, which does not change the
  // oldest row held — so the cursor must come back UNCHANGED, not reset. Clearing
  // it here would turn every live message into a page-one re-read.
  test("a refresh on a filled list leaves the cursor alone", () => {
    expect(
      nextPagingCursor({
        after: "0000005:m1:000",
        currentAfter: PAGE_ONE_END,
        currentDone: false,
        hasMore: true,
        mode: "refresh",
        started: true,
      })
    ).toStrictEqual({ after: PAGE_ONE_END, done: false });
  });

  test("a refresh does not un-finish a kind that reached the end", () => {
    expect(
      nextPagingCursor({
        after: "0000001:m99:999",
        currentAfter: "0000001:m99:999",
        currentDone: true,
        hasMore: false,
        mode: "refresh",
        started: true,
      }).done
    ).toBe(true);
  });

  test("load-older moves the cursor and records the end of the store", () => {
    expect(
      nextPagingCursor({
        after: undefined,
        currentAfter: PAGE_ONE_END,
        currentDone: false,
        hasMore: false,
        mode: "more",
        started: true,
      })
    ).toStrictEqual({ after: undefined, done: true });
  });

  // A "load older" that lands on an empty page still counts as reaching the end:
  // the store said there was nothing below the cursor, which is the same fact as
  // hasMore being false.
  test("load-older past the end finishes the kind", () => {
    expect(
      nextPagingCursor({
        after: undefined,
        currentAfter: PAGE_ONE_END,
        currentDone: false,
        hasMore: false,
        mode: "more",
        started: true,
      }).done
    ).toBe(true);
  });
});
