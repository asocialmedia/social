import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

function subscribeToMediaQuery(onChange: () => void): () => void {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getIsMobileSnapshot(): boolean {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribeToMediaQuery,
    getIsMobileSnapshot,
    () => false
  );
}
