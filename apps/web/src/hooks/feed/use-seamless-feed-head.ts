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

    const getFeedHeadOffset = () => {
      if (!root.current || !scrollContainer) {
        return 0;
      }
      const rootRect = root.current.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      return Math.max(
        0,
        rootRect.top - containerRect.top + scrollContainer.scrollTop
      );
    };

    const isAtHead = (top: number, feedHeadOffset: number) =>
      top <= feedHeadOffset + 48;

    const requestHead = () => {
      const feedHeadOffset = getFeedHeadOffset();
      if (
        !isAtHead(scrollContainer.scrollTop, feedHeadOffset) ||
        !root.current?.checkVisibility()
      ) {
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
      const feedHeadOffset = getFeedHeadOffset();
      if (top < previous && isAtHead(top, feedHeadOffset)) {
        requestHead();
      }
      if (!isAtHead(top, feedHeadOffset)) {
        requestedAt.current = 0;
      }
      previous = top;
    };

    const onWheel = (event: WheelEvent) => {
      const feedHeadOffset = getFeedHeadOffset();
      if (
        event.deltaY < 0 &&
        isAtHead(scrollContainer.scrollTop, feedHeadOffset)
      ) {
        requestHead();
      }
    };

    const onTouchEnd = () => {
      const feedHeadOffset = getFeedHeadOffset();
      if (isAtHead(scrollContainer.scrollTop, feedHeadOffset)) {
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
