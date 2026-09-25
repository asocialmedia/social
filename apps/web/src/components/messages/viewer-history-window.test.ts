import { describe, expect, test } from "bun:test";

import type { MessagePage } from "@asm/db";

import {
  pagesToDropForTranscriptHistory,
  pagesToDropForViewerHistory,
  TRANSCRIPT_HISTORY_KEEP_PAGES,
  TRANSCRIPT_MIN_ROWS_ABOVE_BOUNDARY,
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

describe("pagesToDropForTranscriptHistory", () => {
  const pages = Array.from({ length: 20 }, (_, index) => page(`p${index}`));
  const findPageIndex = (id: string) =>
    pages.findIndex((p) => p.messages.some((m) => m.id === id));

  test("keeps everything while the reader is near the oldest loaded row", () => {
    // Right at the auto-loader's trigger band: trimming here would drop a page
    // the near-top loader is about to ask for, and loop.
    expect(
      pagesToDropForTranscriptHistory({
        anchorMessageId: "p15",
        findPageIndex,
        firstVisibleIndex: TRANSCRIPT_MIN_ROWS_ABOVE_BOUNDARY - 1,
        pageCount: pages.length,
      })
    ).toBe(0);
  });

  test("drops the oldest pages beyond the keep buffer once clear of them", () => {
    const drop = pagesToDropForTranscriptHistory({
      anchorMessageId: "p15",
      findPageIndex,
      firstVisibleIndex: TRANSCRIPT_MIN_ROWS_ABOVE_BOUNDARY + 1,
      pageCount: pages.length,
    });
    expect(drop).toBe(15 - TRANSCRIPT_HISTORY_KEEP_PAGES);
    // The anchor page and everything from the keep buffer onward survive.
    expect(pages.length - drop).toBeGreaterThanOrEqual(
      TRANSCRIPT_HISTORY_KEEP_PAGES
    );
  });

  test("is inert with too few pages to be worth trimming", () => {
    const few = pages.slice(0, TRANSCRIPT_HISTORY_KEEP_PAGES + 1);
    expect(
      pagesToDropForTranscriptHistory({
        anchorMessageId: "p3",
        findPageIndex,
        firstVisibleIndex: 5000,
        pageCount: few.length,
      })
    ).toBe(0);
  });

  test("is inert before mount or for an anchor outside the loaded pages", () => {
    expect(
      pagesToDropForTranscriptHistory({
        anchorMessageId: null,
        findPageIndex,
        firstVisibleIndex: 5000,
        pageCount: pages.length,
      })
    ).toBe(0);
    // An anchor the cache cannot place (hidden or evicted between render and
    // effect) must not produce a blind slice.
    expect(
      pagesToDropForTranscriptHistory({
        anchorMessageId: "gone",
        findPageIndex,
        firstVisibleIndex: 5000,
        pageCount: pages.length,
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
