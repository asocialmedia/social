"use client";

import { useSyncExternalStore } from "react";

// Subscribe to a CSS media query as a boolean.
//
// `useSyncExternalStore` rather than an effect that reads `matchMedia` and calls
// setState, which is what the same thing written by hand looks like: that version
// renders once with the wrong answer and again with the right one, and the compiler
// flags it because the effect is synchronizing a value React already has a way to
// subscribe to. This reports the current answer on the very first client render.
//
// The server snapshot is `false`, so the markup a client renders before hydration is
// the narrow layout. That is the safe direction for every use here: the wide layout
// is the one that adds a pane, and adding one a frame late is invisible while
// removing one a frame late is a flash.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}
