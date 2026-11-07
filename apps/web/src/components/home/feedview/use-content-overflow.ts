import type { RefObject } from "react";
import { useEffect, useState } from "react";

export function useContentOverflow(
  contentRef: RefObject<HTMLDivElement | null>,
  expanded: boolean,
  content: string
) {
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const element = contentRef.current;
    if (!element || expanded) {
      return;
    }
    const measure = () => {
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    const resize = new ResizeObserver(measure);
    const observeSize = () => {
      measure();
      resize.observe(element);
      if (element.firstElementChild) {
        resize.observe(element.firstElementChild);
      }
    };
    // Reading offscreen scrollHeight forces the browser to lay out skipped feed cards.
    // Observe size only near the viewport while the browser remembers previously rendered sizes.
    let visibility: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "undefined") {
      observeSize();
    } else {
      visibility = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observeSize();
          } else {
            resize.disconnect();
          }
        },
        { rootMargin: "800px 0px" }
      );
      visibility.observe(element);
    }
    return () => {
      visibility?.disconnect();
      resize.disconnect();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Recheck changed text even when its clamped dimensions stay the same.
  }, [contentRef, expanded, content]);
  return overflowing;
}
