import { describe, expect, test } from "bun:test";

import {
  decideServerSearchPageRequest,
  serverSearchCoverageRetryDelay,
  serverSearchHasMore,
  shouldPollServerSearchCoverage,
} from "./server-search-coverage";

const POLLABLE = {
  coverageComplete: false,
  hasPage: true,
  offline: false,
  queryValid: true,
  requestError: false,
  requestLoading: false,
  searchEnabled: true,
  serverMode: true,
};

describe("server search coverage refresh policy", () => {
  test("loads missing pages and refreshes incomplete page zero", () => {
    expect(
      decideServerSearchPageRequest({
        currentPagesLength: 1,
        listPage: 1,
        refreshingIncompleteHead: false,
        requestGenerationChanged: false,
      })
    ).toEqual({ pageIndex: 1 });
    expect(
      decideServerSearchPageRequest({
        currentPagesLength: 1,
        listPage: 0,
        refreshingIncompleteHead: true,
        requestGenerationChanged: true,
      })
    ).toEqual({ pageIndex: 0 });
    expect(
      decideServerSearchPageRequest({
        currentPagesLength: 1,
        listPage: 0,
        refreshingIncompleteHead: false,
        requestGenerationChanged: false,
      })
    ).toBeNull();
    expect(
      decideServerSearchPageRequest({
        currentPagesLength: 1,
        listPage: 1,
        refreshingIncompleteHead: false,
        requestGenerationChanged: false,
      })
    ).toEqual({ pageIndex: 1 });
  });

  test("polls only while an online server search has a partial result page", () => {
    expect(shouldPollServerSearchCoverage(POLLABLE)).toBe(true);
    expect(
      shouldPollServerSearchCoverage({ ...POLLABLE, requestLoading: true })
    ).toBe(false);
    expect(
      shouldPollServerSearchCoverage({ ...POLLABLE, requestError: true })
    ).toBe(false);
    expect(shouldPollServerSearchCoverage({ ...POLLABLE, offline: true })).toBe(
      false
    );
    expect(
      shouldPollServerSearchCoverage({ ...POLLABLE, coverageComplete: true })
    ).toBe(false);
    expect(
      shouldPollServerSearchCoverage({ ...POLLABLE, hasPage: false })
    ).toBe(false);
    expect(
      shouldPollServerSearchCoverage({ ...POLLABLE, queryValid: false })
    ).toBe(false);
  });

  test("holds pagination until coverage is complete and a cursor exists", () => {
    expect(
      serverSearchHasMore({ coverageComplete: false, nextCursor: "cursor" })
    ).toBe(false);
    expect(
      serverSearchHasMore({ coverageComplete: true, nextCursor: null })
    ).toBe(false);
    expect(
      serverSearchHasMore({ coverageComplete: true, nextCursor: "cursor" })
    ).toBe(true);
  });

  test("backs off from one second to a bounded fifteen-second interval", () => {
    expect([0, 1, 2, 3, 4, 5].map(serverSearchCoverageRetryDelay)).toEqual([
      1000, 2000, 4000, 8000, 15_000, 15_000,
    ]);
    expect(serverSearchCoverageRetryDelay(Number.NaN)).toBe(1000);
  });
});
