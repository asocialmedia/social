// Port of web's useBoundedSourcePending (hooks/feed/use-bounded-source-pending).
// Coalesce mixed-source arrivals within a deadline, then release healthy
// posts if a peer stalls. The pure transition lives in boundedPendingState so
// it can be unit tested without React.
import { useEffect, useState } from "react";

export const DEFAULT_SOURCE_WAIT_MS = 600;
// Match the remote read deadline so a slower first page is mixed before the
// native batch is committed (web following.tsx).
export const FOLLOWING_INITIAL_SOURCE_WAIT_MS = 18_000;

export interface BoundedPendingState {
  expired: boolean;
  pending: boolean;
}

// The state machine: idle (pending=false) -> waiting (pending, !expired) ->
// released (pending, expired). Any change of the input restarts the wait.
export function boundedPendingState(
  state: BoundedPendingState,
  pending: boolean
): BoundedPendingState {
  return state.pending === pending ? state : { expired: false, pending };
}

export function isHoldingSources(state: BoundedPendingState): boolean {
  return state.pending && !state.expired;
}

export function useBoundedSourcePending(
  pending: boolean,
  timeoutMs = DEFAULT_SOURCE_WAIT_MS
): boolean {
  const [state, setState] = useState<BoundedPendingState>({
    expired: false,
    pending,
  });
  const next = boundedPendingState(state, pending);
  if (next !== state) {
    setState(next);
  }
  useEffect(() => {
    if (!pending) {
      return;
    }
    const timer = setTimeout(
      () => setState({ expired: true, pending: true }),
      timeoutMs
    );
    return () => clearTimeout(timer);
  }, [pending, timeoutMs]);
  return isHoldingSources(next);
}
