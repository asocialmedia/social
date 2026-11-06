import { useEffect, useState } from "react";

// Coalesce mixed-source arrivals within a deadline, then release healthy posts if a peer stalls.
export function useBoundedSourcePending(
  pending: boolean,
  timeoutMs = 600
): boolean {
  const [state, setState] = useState({ expired: false, pending });
  if (state.pending !== pending) {
    setState({ expired: false, pending });
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
  return pending && !state.expired;
}
