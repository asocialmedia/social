import { describe, expect, test } from "bun:test";

import {
  decideServerSearchPageRequest,
  isServerSearchScopeChanged,
  serverSearchCoverageRetryDelay,
  serverSearchHasMore,
  shouldRestartAfterServerSearchScopeChange,
  shouldPollServerSearchCoverage,
} from "./server-search-coverage";

const POLLABLE = {
  coverageComplete: false,
  coverageSettled: false,
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
      shouldPollServerSearchCoverage({ ...POLLABLE, coverageSettled: true })
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

  test("recognizes only explicit scope conflicts and retries once per query", () => {
    expect(
      isServerSearchScopeChanged(409, { code: "SEARCH_SCOPE_CHANGED" })
    ).toBe(true);
    expect(isServerSearchScopeChanged(409, { error: "Conflict" })).toBe(false);
    expect(
      isServerSearchScopeChanged(200, { code: "SEARCH_SCOPE_CHANGED" })
    ).toBe(false);
    expect(shouldRestartAfterServerSearchScopeChange("q1", "")).toBe(true);
    expect(shouldRestartAfterServerSearchScopeChange("q1", "q1")).toBe(false);
    expect(shouldRestartAfterServerSearchScopeChange("q2", "q1")).toBe(true);
  });
});
