import { describe, expect, test } from "bun:test";

import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";

import type { MessagePage } from "@/lib/messages/types";

import {
  pagesToDropForViewerHistory,
  TRANSCRIPT_MAX_HISTORY_PAGES,
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

describe("bounded transcript pagination", () => {
  test("caps pages in both directions and keeps page parameters aligned", async () => {
    interface WindowPage {
      value: number;
    }
    type WindowData = InfiniteData<WindowPage, number>;

    const queryClient = new QueryClient();
    const queryKey = ["bounded-message-history"] as const;
    const observer = new InfiniteQueryObserver(queryClient, {
      getNextPageParam: (lastPage) =>
        lastPage.value < 20 ? lastPage.value + 1 : undefined,
      getPreviousPageParam: (firstPage) =>
        firstPage.value > 0 ? firstPage.value - 1 : undefined,
      initialPageParam: 8,
      maxPages: TRANSCRIPT_MAX_HISTORY_PAGES,
      queryFn: ({ pageParam }) => Promise.resolve({ value: pageParam }),
      queryKey,
    });
    const unsubscribe = observer.subscribe(() => {});

    try {
      await observer.refetch();
      for (let index = 0; index < TRANSCRIPT_MAX_HISTORY_PAGES; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- each page changes the cursor for the next fetch.
        await observer.fetchPreviousPage();
      }

      const olderWindow = queryClient.getQueryData<WindowData>(queryKey);
      expect(olderWindow?.pages.map(({ value }) => value)).toEqual(
        Array.from(
          { length: TRANSCRIPT_MAX_HISTORY_PAGES },
          (_, index) => index
        )
      );
      expect(olderWindow?.pageParams).toEqual(
        olderWindow?.pages.map(({ value }) => value)
      );

      for (let index = 0; index < 12; index += 1) {
        // oxlint-disable-next-line no-await-in-loop -- each page changes the cursor for the next fetch.
        await observer.fetchNextPage();
      }

      const newerWindow = queryClient.getQueryData<WindowData>(queryKey);
      expect(newerWindow?.pages.map(({ value }) => value)).toEqual(
        Array.from(
          { length: TRANSCRIPT_MAX_HISTORY_PAGES },
          (_, index) => index + 12
        )
      );
      expect(newerWindow?.pageParams).toEqual(
        newerWindow?.pages.map(({ value }) => value)
      );
    } finally {
      unsubscribe();
      queryClient.clear();
    }
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
