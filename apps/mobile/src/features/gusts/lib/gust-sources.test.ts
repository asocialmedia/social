import { describe, expect, test } from "bun:test";

import {
  failedGustSources,
  gustPagingState,
  gustSourceRetryCopy,
  showGustFeedError,
} from "./gust-sources";
import type { GustSourceLabel, GustSourceState } from "./gust-sources";

function source(
  label: GustSourceLabel,
  patch: Partial<GustSourceState> = {}
): GustSourceState {
  return {
    enabled: true,
    hasError: false,
    hasNextPage: false,
    isFetching: false,
    isFetchingNextPage: false,
    label,
    pageError: false,
    ...patch,
  };
}

describe("failedGustSources", () => {
  test.each(["ASM", "Bluesky"] as const)(
    "%s failure exposes only its own retry",
    (failed) => {
      const sources = (["ASM", "Bluesky"] as const).map((label) =>
        source(label, { hasError: label === failed })
      );
      expect(failedGustSources(sources).map((entry) => entry.label)).toEqual([
        failed,
      ]);
    }
  );

  test("both failures keep separate retries, in order", () => {
    const sources = [
      source("ASM", { hasError: true }),
      source("Bluesky", { hasError: true }),
    ];
    expect(failedGustSources(sources).map((entry) => entry.label)).toEqual([
      "ASM",
      "Bluesky",
    ]);
  });

  test("a disabled source never offers a retry", () => {
    expect(
      failedGustSources([source("ASM", { enabled: false, hasError: true })])
    ).toEqual([]);
  });
});

describe("gustPagingState", () => {
  test("a page error on one source leaves the healthy peer paging", () => {
    const paging = gustPagingState([
      source("ASM", { hasNextPage: true, pageError: true }),
      source("Bluesky", { hasNextPage: true }),
    ]);
    expect(paging.canFetchNextPage).toBe(true);
    expect(paging.pageError).toBe(true);
  });

  test("an exhausted peer with a failed source cannot page on", () => {
    const paging = gustPagingState([
      source("ASM", { hasNextPage: true, pageError: true }),
      source("Bluesky"),
    ]);
    expect(paging.canFetchNextPage).toBe(false);
    expect(paging.hasNextPage).toBe(true);
  });

  test("disabled sources are ignored", () => {
    const paging = gustPagingState([
      source("ASM", { enabled: false, hasNextPage: true }),
      source("Bluesky"),
    ]);
    expect(paging.hasNextPage).toBe(false);
  });
});

describe("showGustFeedError", () => {
  test("an empty reel keeps the error panel once nothing can page", () => {
    expect(
      showGustFeedError({
        canFetchNextPage: false,
        pageError: true,
        postCount: 0,
        status: "ready",
      })
    ).toBe(true);
  });

  test("a loaded reel with a page error keeps playing", () => {
    expect(
      showGustFeedError({
        canFetchNextPage: false,
        pageError: true,
        postCount: 3,
        status: "ready",
      })
    ).toBe(false);
  });

  test("an error with a healthy pager does not block the reel", () => {
    expect(
      showGustFeedError({
        canFetchNextPage: true,
        pageError: false,
        postCount: 0,
        status: "error",
      })
    ).toBe(false);
  });
});

test("retry copy matches web", () => {
  expect(gustSourceRetryCopy("Bluesky")).toEqual({
    action: "Retry Bluesky videos",
    message: "Bluesky videos couldn’t load right now. Please try again.",
  });
});
