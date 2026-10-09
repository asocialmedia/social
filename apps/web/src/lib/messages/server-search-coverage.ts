export interface ServerSearchCoveragePollState {
  coverageComplete: boolean;
  coverageSettled: boolean;
  hasPage: boolean;
  offline: boolean;
  queryValid: boolean;
  requestError: boolean;
  requestLoading: boolean;
  searchEnabled: boolean;
  serverMode: boolean;
}

export interface ServerSearchPageRequestState {
  currentPagesLength: number;
  listPage: number;
  refreshingIncompleteHead: boolean;
  requestGenerationChanged: boolean;
}

export function decideServerSearchPageRequest(
  state: ServerSearchPageRequestState
): { pageIndex: number } | null {
  const currentPageExists = state.currentPagesLength > state.listPage;
  if (
    currentPageExists &&
    (!state.requestGenerationChanged || !state.refreshingIncompleteHead)
  ) {
    return null;
  }
  if (state.refreshingIncompleteHead) {
    return { pageIndex: 0 };
  }
  return { pageIndex: state.currentPagesLength };
}

export function shouldPollServerSearchCoverage(
  state: ServerSearchCoveragePollState
): boolean {
  return (
    state.serverMode &&
    state.searchEnabled &&
    state.queryValid &&
    state.hasPage &&
    !state.coverageComplete &&
    !state.coverageSettled &&
    !state.offline &&
    !state.requestError &&
    !state.requestLoading
  );
}

export function serverSearchHasMore(input: {
  coverageComplete: boolean;
  nextCursor: string | null;
}): boolean {
  return input.coverageComplete && input.nextCursor !== null;
}

export function isServerSearchScopeChanged(
  status: number,
  payload: unknown
): boolean {
  return (
    status === 409 &&
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).code === "SEARCH_SCOPE_CHANGED"
  );
}

export function shouldRestartAfterServerSearchScopeChange(
  requestKey: string,
  lastRestartedKey: string
): boolean {
  return requestKey !== lastRestartedKey;
}
