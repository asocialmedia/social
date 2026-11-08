import { describe, expect, test } from "bun:test";

import {
  pagesToDropForTranscriptHistory,
  pagesToDropForViewerHistory,
  trimOldestPages,
  VIEWER_HISTORY_KEEP_PAGES,
  VIEWER_HISTORY_MIN_OLDER_ITEMS,
} from "./viewer-history-window";

const findPageIndex = (id: string) =>
  ["p0", "p1", "p2", "p3", "p4"].indexOf(id);
const findMany = (id: string) =>
  Array.from({ length: 12 }, (_, index) => `q${index}`).indexOf(id);
const findTranscriptPageIndex = (id: string) => ["a", "b"].indexOf(id);

describe("pagesToDropForViewerHistory", () => {
  test("does nothing when the anchor is near the oldest item", () => {
    expect(
      pagesToDropForViewerHistory({
        activeIndex: VIEWER_HISTORY_MIN_OLDER_ITEMS - 1,
        anchorMessageId: "p4",
        findPageIndex,
        pageCount: 5,
      })
    ).toBe(0);
  });

  test("drops nothing when the keep buffer covers the anchor page", () => {
    expect(
      pagesToDropForViewerHistory({
        activeIndex: VIEWER_HISTORY_MIN_OLDER_ITEMS + 10,
        anchorMessageId: "p4",
        findPageIndex,
        pageCount: 5,
      })
    ).toBe(0);
  });

  test("drops the pages below the keep buffer", () => {
    expect(
      pagesToDropForViewerHistory({
        activeIndex: VIEWER_HISTORY_MIN_OLDER_ITEMS + 1,
        anchorMessageId: "q10",
        findPageIndex: findMany,
        pageCount: 12,
      })
    ).toBe(10 - VIEWER_HISTORY_KEEP_PAGES);
  });

  test("does nothing for an unknown anchor", () => {
    expect(
      pagesToDropForViewerHistory({
        activeIndex: 500,
        anchorMessageId: "missing",
        findPageIndex,
        pageCount: 5,
      })
    ).toBe(0);
  });

  test("does nothing with no anchor or too few pages", () => {
    expect(
      pagesToDropForViewerHistory({
        activeIndex: 500,
        anchorMessageId: null,
        findPageIndex,
        pageCount: 5,
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
  test("gates on the visible row being far above the boundary", () => {
    expect(
      pagesToDropForTranscriptHistory({
        anchorMessageId: "b",
        findPageIndex: findTranscriptPageIndex,
        firstVisibleIndex: 239,
        pageCount: 10,
      })
    ).toBe(0);
    expect(
      pagesToDropForTranscriptHistory({
        anchorMessageId: "b",
        findPageIndex: findTranscriptPageIndex,
        firstVisibleIndex: 240,
        pageCount: 10,
      })
    ).toBe(0);
  });
});

describe("trimOldestPages", () => {
  test("slices pages and pageParams in lockstep", () => {
    const pages = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const pageParams = [undefined, "c1", "c2"];
    const result = trimOldestPages(pages, pageParams, 2);
    expect(result.pages).toEqual([pages[2]]);
    expect(result.pageParams).toEqual(["c2"]);
  });

  test("returns the inputs unchanged when drop is non-positive", () => {
    const pages = [{ id: "a" }];
    const pageParams: (string | undefined)[] = [undefined];
    expect(trimOldestPages(pages, pageParams, 0)).toEqual({
      pageParams,
      pages,
    });
  });
});
