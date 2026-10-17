import type { RefObject } from "react";
import { useEffect, useRef } from "react";

export function useSeamlessFeedHead({
  root,
  enabled,
  count,
  merge,
  probe,
}: {
  root: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  count: number;
  merge: () => void;
  probe: () => Promise<unknown>;
}) {
  const latest = useRef({ count, merge, probe });
  const requestedAt = useRef(0);
  useEffect(() => {
    latest.current = { count, merge, probe };
  }, [count, merge, probe]);
  useEffect(() => {
    if (!enabled || !root.current) {
      return;
    }
    let container: HTMLElement | null = root.current.parentElement;
    while (
      container &&
      !/(?:auto|scroll)/.test(getComputedStyle(container).overflowY)
    ) {
      container = container.parentElement;
    }
    if (!container) {
      return;
    }
    const scrollContainer = container;
    let previous = scrollContainer.scrollTop;
    let lastProbe = 0;
    const requestHead = () => {
      if (scrollContainer.scrollTop > 16 || !root.current?.checkVisibility()) {
        return;
      }
      requestedAt.current = Date.now();
      if (latest.current.count > 0) {
        requestedAt.current = 0;
        latest.current.merge();
      }
      if (Date.now() - lastProbe >= 10_000) {
        lastProbe = Date.now();
        void latest.current.probe();
      }
    };
    const onScroll = () => {
      const top = scrollContainer.scrollTop;
      if (top < previous) {
        requestHead();
      }
      if (top > 16) {
        requestedAt.current = 0;
      }
      previous = top;
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        requestHead();
      }
    };
    const onTouchEnd = () => {
      if (scrollContainer.scrollTop <= 16) {
        requestHead();
      }
    };
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    scrollContainer.addEventListener("wheel", onWheel, { passive: true });
    scrollContainer.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      requestedAt.current = 0;
      scrollContainer.removeEventListener("scroll", onScroll);
      scrollContainer.removeEventListener("wheel", onWheel);
      scrollContainer.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, root]);
  useEffect(() => {
    if (
      enabled &&
      count > 0 &&
      requestedAt.current > 0 &&
      Date.now() - requestedAt.current < 10_000
    ) {
      requestedAt.current = 0;
      merge();
    }
  }, [enabled, count, merge]);
}
