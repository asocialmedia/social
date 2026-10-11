import { describe, expect, test } from "bun:test";

import {
  retainSearchResultPage,
  searchResultPage,
  searchResultPageRequest,
} from "./search-result-window";
import type { SearchResultWindow } from "./search-result-window";

function page(index: number) {
  return {
    hits: Array.from({ length: 20 }, (_, hit) => `message-${index * 20 + hit}`),
    nextCursor: `older-${index}`,
    previousCursor: index === 0 ? null : `newer-${index}`,
    requestCursor: index === 0 ? null : `older-${index - 1}`,
  };
}

type Page = ReturnType<typeof page>;

describe("bounded search result window", () => {
  test("retains at most sixty hits through ten thousand forward and reverse page turns", () => {
    let window: SearchResultWindow<Page> = { pages: [], startPage: 0 };
    const head = page(0);
    for (let index = 0; index < 10_000; index += 1) {
      const request = searchResultPageRequest({
        pageIndex: index,
        refresh: false,
        window,
      });
      expect(request).toEqual({
        cursor: index === 0 ? null : `older-${index - 1}`,
        pageIndex: index,
      });
      window = retainSearchResultPage({
        page: index === 0 ? head : page(index),
        pageIndex: index,
        window,
      });
      expect(window.pages.length).toBeLessThanOrEqual(3);
    }
    expect(window.pages).not.toContain(head);
    expect(searchResultPage(window, 0)).toBeNull();
    for (let index = 9999; index >= 0; index -= 1) {
      const cached = searchResultPage(window, index);
      const request = searchResultPageRequest({
        pageIndex: index,
        refresh: false,
        window,
      });
      if (cached) {
        expect(request).toBeNull();
      } else {
        expect(request).toEqual({
          cursor: `newer-${index + 1}`,
          pageIndex: index,
        });
        window = retainSearchResultPage({
          page: page(index),
          pageIndex: index,
          window,
        });
      }
      expect(searchResultPage(window, index)?.hits).toEqual(page(index).hits);
      expect(
        window.pages.flatMap((entry) => entry.hits).length
      ).toBeLessThanOrEqual(60);
    }
  });

  test("retries use the original boundary and leave the existing window untouched", () => {
    const window = { pages: [page(8), page(9), page(10)], startPage: 8 };
    expect(
      searchResultPageRequest({ pageIndex: 9, refresh: true, window })
    ).toEqual({ cursor: "older-8", pageIndex: 9 });
    expect(window.pages.map((entry) => entry.hits[0])).toEqual([
      "message-160",
      "message-180",
      "message-200",
    ]);
    const refreshed = { ...page(9), hits: ["edited-message"] };
    const updated = retainSearchResultPage({
      page: refreshed,
      pageIndex: 9,
      window,
    });
    expect(searchResultPage(updated, 9)?.hits).toEqual(["edited-message"]);
    expect(updated.pages).toHaveLength(3);
    expect(window.pages[1]?.hits).toHaveLength(20);
  });

  test("arbitrary navigation starts at the nearest seam and exhausted pages do not loop", () => {
    const window = { pages: [page(8), page(9), page(10)], startPage: 8 };
    expect(
      searchResultPageRequest({ pageIndex: 0, refresh: false, window })
    ).toEqual({ cursor: "newer-8", pageIndex: 7 });
    expect(
      searchResultPageRequest({ pageIndex: 100, refresh: false, window })
    ).toEqual({ cursor: "older-10", pageIndex: 11 });
    expect(
      searchResultPageRequest({
        pageIndex: 1,
        refresh: false,
        window: { pages: [{ ...page(0), nextCursor: null }], startPage: 0 },
      })
    ).toBeNull();
    expect(
      searchResultPageRequest({
        pageIndex: 100,
        refresh: false,
        window: { pages: [], startPage: 0 },
      })
    ).toEqual({ cursor: null, pageIndex: 0 });
  });
});
