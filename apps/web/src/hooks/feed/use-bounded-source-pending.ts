import { useEffect, useState } from "react";

// Briefly coalesce mixed-source arrivals, but never hide a healthy page behind a slow source.
export function useBoundedSourcePending(pending: boolean): boolean {
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
      600
    );
    return () => clearTimeout(timer);
  }, [pending]);
  return pending && !state.expired;
}
