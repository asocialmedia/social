"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {
  /* empty */
};

// The server and initial hydration both read false, even with a warm client cache.
export function useIsHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
