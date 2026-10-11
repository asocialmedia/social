export interface ServerSharedRefsCoveragePollState {
  coverageIncomplete: boolean;
  coverageUnavailable: boolean;
  requestLoading: boolean;
  source: "local" | "server" | null;
  serverMode: boolean;
}

export function shouldPollServerSharedRefsCoverage(
  state: ServerSharedRefsCoveragePollState
): boolean {
  return (
    state.serverMode &&
    state.source === "server" &&
    state.coverageIncomplete &&
    !state.coverageUnavailable &&
    !state.requestLoading
  );
}
