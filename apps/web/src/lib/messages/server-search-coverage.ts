export interface ServerSearchCoveragePollState {
  coverageComplete: boolean;
  coveragePaused: boolean;
  coverageSettled: boolean;
  hasPage: boolean;
  offline: boolean;
  queryValid: boolean;
  requestError: boolean;
  requestLoading: boolean;
  searchEnabled: boolean;
  serverMode: boolean;
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
    !state.coveragePaused &&
    !state.coverageSettled &&
    !state.offline &&
    !state.requestError &&
    !state.requestLoading
  );
}

export function serverSearchHasMore(input: {
  nextCursor: string | null;
}): boolean {
  return input.nextCursor !== null;
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
