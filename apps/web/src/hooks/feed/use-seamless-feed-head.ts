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
  const requested = useRef(false);
  const canMergeAtHead = useRef<() => boolean>(() => false);

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
    canMergeAtHead.current = () =>
      Boolean(root.current?.checkVisibility()) &&
      isAtHead(scrollContainer.scrollTop, getFeedHeadOffset());

    const requestHead = () => {
      if (!canMergeAtHead.current()) {
        return;
      }
      requested.current = true;
      if (latest.current.count > 0) {
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
        requested.current = false;
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
      requested.current = false;
      canMergeAtHead.current = () => false;
      scrollContainer.removeEventListener("scroll", onScroll);
      scrollContainer.removeEventListener("wheel", onWheel);
      scrollContainer.removeEventListener("touchend", onTouchEnd);
    };
  }, [enabled, root]);

  useEffect(() => {
    if (!enabled || count === 0 || !requested.current) {
      return;
    }
    if (!canMergeAtHead.current()) {
      requested.current = false;
      return;
    }
    merge();
  }, [enabled, count, merge]);
}
