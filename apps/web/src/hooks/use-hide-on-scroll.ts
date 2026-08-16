"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";

// Hides a header while the user scrolls down a feed and reveals it again on
// scroll up. Reads the scroll container directly (no layout observers) so it
// works on the custom feed scroll areas that own their own overflow.
export function useHideOnScroll(
  scrollRef: RefObject<HTMLElement | null>,
  threshold = 8
): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    let lastScrollTop = el.scrollTop;

    const onScroll = () => {
      const current = el.scrollTop;
      const delta = current - lastScrollTop;
      lastScrollTop = current;
      if (Math.abs(delta) < threshold) {
        return;
      }
      setHidden(delta > 0 && current > 0);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, threshold]);

  return hidden;
}
