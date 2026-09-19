import { describe, expect, test } from "bun:test";

import type { MessagePage } from "@asm/db";

import {
  pagesToDropForViewerHistory,
  trimOldestPages,
  VIEWER_HISTORY_KEEP_PAGES,
  VIEWER_HISTORY_MIN_OLDER_ITEMS,
} from "./viewer-history-window";

function page(id: string): MessagePage {
  return {
    messages: [
      {
        createdAt: new Date(),
        id,
      } as MessagePage["messages"][number],
    ],
    previousCursor: `cursor-${id}`,
  };
}

describe("pagesToDropForViewerHistory", () => {
  const pages = [page("p0"), page("p1"), page("p2"), page("p3"), page("p4")];
  const pageCount = pages.length;
  const findPageIndex = (id: string) =>
    pages.findIndex((p) => p.messages.some((m) => m.id === id));

  test("does nothing when the anchor is near the oldest item", () => {
    expect(
      pagesToDropForViewerHistory({
        activeIndex: VIEWER_HISTORY_MIN_OLDER_ITEMS - 1,
        anchorMessageId: "p4",
        findPageIndex,
        pageCount,
      })
    ).toBe(0);
  });

  test("drops oldest pages beyond the keep buffer when far from the oldest", () => {
    // Anchor in the last page: 4 pages precede it, keep 6 -> nothing droppable.
    expect(
      pagesToDropForViewerHistory({
        activeIndex: VIEWER_HISTORY_MIN_OLDER_ITEMS + 10,
        anchorMessageId: "p4",
        findPageIndex,
        pageCount,
      })
    ).toBe(0);
  });

  test("drops the pages below the keep buffer", () => {
    const many = Array.from({ length: 12 }, (_, index) => page(`q${index}`));
    const findMany = (id: string) =>
      many.findIndex((p) => p.messages.some((m) => m.id === id));
    // Anchor at page 10, keep 6 -> drop 4.
    expect(
      pagesToDropForViewerHistory({
        activeIndex: VIEWER_HISTORY_MIN_OLDER_ITEMS + 1,
        anchorMessageId: "q10",
        findPageIndex: findMany,
        pageCount: many.length,
      })
    ).toBe(10 - VIEWER_HISTORY_KEEP_PAGES);
  });

  test("does nothing for an unknown anchor", () => {
    expect(
      pagesToDropForViewerHistory({
        activeIndex: 500,
        anchorMessageId: "missing",
        findPageIndex,
        pageCount,
      })
    ).toBe(0);
  });

  test("does nothing with no anchor or too few pages", () => {
    expect(
      pagesToDropForViewerHistory({
        activeIndex: 500,
        anchorMessageId: null,
        findPageIndex,
        pageCount,
      })
    ).toBe(0);
    expect(
      pagesToDropForViewerHistory({
        activeIndex: 500,
        anchorMessageId: "p1",
        findPageIndex,
        pageCount: VIEWER_HISTORY_KEEP_PAGES + 1,
      })
    ).toBe(0);
  });
});

describe("trimOldestPages", () => {
  test("slices pages and pageParams in lockstep", () => {
    const pages = [page("a"), page("b"), page("c")];
    const pageParams = [undefined, "c1", "c2"];
    const result = trimOldestPages(pages, pageParams, 2);
    expect(result.pages).toEqual([pages[2]]);
    expect(result.pageParams).toEqual(["c2"]);
  });

  test("returns the inputs unchanged when drop is non-positive", () => {
    const pages = [page("a")];
    const pageParams: (string | undefined)[] = [undefined];
    expect(trimOldestPages(pages, pageParams, 0)).toEqual({
      pageParams,
      pages,
    });
  });
});
