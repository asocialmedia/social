// oxlint-disable react/todo -- DOM gesture callbacks coordinate asynchronous query observers outside the compiler.
import {
  feedRenderPolicy,
  mergeUnreadFeedHead,
} from "@asm/protocols/discovery";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export function useSeamlessFeedHead<T extends { id: string }>({
  root,
  enabled,
  count,
  merge,
  probe,
  pendingItems = [],
  scope = "",
  refreshing = false,
  paging = false,
}: {
  root: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  count: number;
  merge: () => void;
  probe: () => Promise<unknown>;
  pendingItems?: readonly T[];
  scope?: string;
  refreshing?: boolean;
  paging?: boolean;
}) {
  const [notice, setNotice] = useState<{ scope: string; items: T[] }>({
    items: [],
    scope,
  });
  const latest = useRef({
    count,
    merge,
    paging,
    pendingItems,
    probe,
    refreshing,
    scope,
  });
  const [pullState, setPullState] = useState<
    "idle" | "pulling" | "ready" | "refreshing" | "error"
  >("idle");
  const refreshBusy = useRef(false);
  const admitRef = useRef<(() => void) | null>(null);
  const frame = useRef<number | null>(null);
  const acknowledge = useCallback(
    () => setNotice({ items: [], scope }),
    [scope]
  );
  useEffect(() => {
    latest.current = {
      count,
      merge,
      paging,
      pendingItems,
      probe,
      refreshing,
      scope,
    };
  }, [count, merge, probe, pendingItems, refreshing, paging, scope]);

  useEffect(() => {
    if (!enabled || !root.current || latest.current.scope !== scope) {
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
    let lastProbe = 0;
    let disposed = false;

    let touch: {
      x: number;
      y: number;
      baseline: number | null;
      distance: number;
    } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      const [first] = event.touches;
      if (!first || event.touches.length !== 1 || refreshBusy.current) {
        return;
      }
      touch = {
        baseline: null,
        distance: 0,
        x: first.clientX,
        y: first.clientY,
      };
    };
    const onTouchMove = (event: TouchEvent) => {
      const [first] = event.touches;
      if (!touch || !first || event.touches.length !== 1) {
        return;
      }
      if (
        Math.abs(first.clientX - touch.x) > 16 ||
        first.clientY < touch.y - 8
      ) {
        touch = null;
        setPullState("idle");
        return;
      }
      if (scrollContainer.scrollTop > feedOffset() + 1) {
        touch.baseline = null;
        return;
      }
      if (touch.baseline === null) {
        touch.baseline = first.clientY;
      }
      touch.distance = Math.max(0, first.clientY - touch.baseline) * 0.55;
      if (touch.distance > 8) {
        if (event.cancelable) {
          event.preventDefault();
        }
        setPullState(touch.distance > 90 ? "ready" : "pulling");
      }
    };
    const onTouchEnd = () => {
      const distance = touch?.distance ?? 0;
      touch = null;
      if (distance <= 90 || refreshBusy.current || latest.current.refreshing) {
        setPullState("idle");
        return;
      }
      refreshBusy.current = true;
      setPullState("refreshing");
      const refreshScope = latest.current.scope;
      void (async () => {
        try {
          await latest.current.probe();
          // Let query observers publish the new head before reading the merge callback.
          // oxlint-disable-next-line promise/avoid-new -- Query observers must commit before the next animation frame admits their buffer.
          await new Promise<void>((resolve) => {
            window.requestAnimationFrame(() => resolve());
          });
          if (disposed || latest.current.scope !== refreshScope) {
            return;
          }
          flushSync(() => {
            setNotice({ items: [], scope: refreshScope });
            latest.current.merge();
          });
          scrollContainer.scrollTop = feedOffset();
          setPullState("idle");
        } catch {
          if (!disposed) {
            setPullState("error");
          }
        } finally {
          if (!disposed) {
            refreshBusy.current = false;
          }
        }
      })();
    };
    const onTouchCancel = () => {
      touch = null;
      if (!refreshBusy.current) {
        setPullState("idle");
      }
    };
    const feedOffset = () =>
      root.current
        ? Math.max(
            0,
            root.current.getBoundingClientRect().top -
              scrollContainer.getBoundingClientRect().top +
              scrollContainer.scrollTop
          )
        : 0;
    const admit = () => {
      const { current } = latest;
      if (
        !root.current?.checkVisibility() ||
        !feedRenderPolicy({
          active: enabled,
          initialLoading: false,
          offset: Math.max(0, scrollContainer.scrollTop - feedOffset()),
          paging: current.paging,
          pendingHeadCount: current.count,
          refreshing: current.refreshing || refreshBusy.current,
        }).admitHead
      ) {
        return;
      }
      // Capture a real visible card. Browser anchoring may already compensate;
      // the measured delta adds only the remaining adjustment after commit.
      const cards = [
        ...root.current.querySelectorAll<HTMLElement>("[data-post-id]"),
      ];
      const edge = scrollContainer.getBoundingClientRect().top;
      const anchor = cards.find(
        (card) => card.getBoundingClientRect().bottom > edge
      );
      const before = anchor?.getBoundingClientRect().top;
      flushSync(() => {
        setNotice((previous) => ({
          items: mergeUnreadFeedHead(
            previous.scope === current.scope ? previous.items : [],
            current.pendingItems
          ),
          scope: current.scope,
        }));
        current.merge();
      });
      if (anchor?.isConnected && before !== undefined) {
        scrollContainer.scrollTop +=
          anchor.getBoundingClientRect().top - before;
      }
    };
    const schedule = () => {
      if (frame.current !== null) {
        return;
      }
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        admit();
      });
    };
    admitRef.current = schedule;
    const onScroll = async () => {
      schedule();
      if (
        scrollContainer.scrollTop <= feedOffset() + 48 &&
        Date.now() - lastProbe >= 10_000 &&
        !latest.current.refreshing &&
        !refreshBusy.current &&
        !latest.current.paging
      ) {
        lastProbe = Date.now();
        try {
          await latest.current.probe();
        } catch {
          // Background reads retain the current feed and retry on the next probe.
        }
      }
    };
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    scrollContainer.addEventListener("touchstart", onTouchStart, {
      passive: true,
    });
    scrollContainer.addEventListener("touchmove", onTouchMove, {
      passive: false,
    });
    scrollContainer.addEventListener("touchend", onTouchEnd);
    scrollContainer.addEventListener("touchcancel", onTouchCancel);
    return () => {
      disposed = true;
      refreshBusy.current = false;
      admitRef.current = null;
      scrollContainer.removeEventListener("touchstart", onTouchStart);
      scrollContainer.removeEventListener("touchmove", onTouchMove);
      scrollContainer.removeEventListener("touchend", onTouchEnd);
      scrollContainer.removeEventListener("touchcancel", onTouchCancel);
      if (frame.current !== null) {
        window.cancelAnimationFrame(frame.current);
        frame.current = null;
      }
      scrollContainer.removeEventListener("scroll", onScroll);
    };
  }, [enabled, root, scope]);

  useEffect(() => {
    if (enabled && count > 0 && !refreshing && !paging) {
      admitRef.current?.();
    }
  }, [enabled, count, refreshing, paging]);
  return {
    acknowledge,
    pullState,
    unreadItems: mergeUnreadFeedHead(
      notice.scope === scope ? notice.items : [],
      pendingItems
    ),
  };
}
