// oxlint-disable react/todo -- DOM gesture callbacks coordinate asynchronous query observers outside the compiler.
import {
  feedRenderPolicy,
  mergeUnreadFeedHead,
} from "@asm/protocols/discovery";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { FEED_POST_VISIBLE_EVENT } from "@/lib/posts/recommendation-visibility";

const HEAD_THRESHOLD = 16;
const EMPTY_PENDING_ITEMS: readonly never[] = [];

function visibleScrollAnchor(root: HTMLElement, edge: number) {
  const bounds = root.getBoundingClientRect();
  const x = Math.min(window.innerWidth - 1, bounds.left + bounds.width / 2);
  for (const distance of [1, 32, 96]) {
    const y = Math.max(0, edge) + distance;
    if (y >= window.innerHeight) {
      break;
    }
    for (const element of document.elementsFromPoint?.(x, y) ?? []) {
      const card = element.closest<HTMLElement>("[data-post-id]");
      if (card && root.contains(card)) {
        return card;
      }
    }
  }
  return null;
}

export function useSeamlessFeedHead<T extends { id: string }>({
  root,
  enabled,
  count,
  merge,
  probe,
  pendingItems = EMPTY_PENDING_ITEMS,
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
  const tracksUnread = pendingItems !== EMPTY_PENDING_ITEMS;
  const [notice, setNotice] = useState<{
    scope: string;
    items: T[];
    seenPending: ReadonlySet<string>;
  }>({
    items: [],
    scope,
    seenPending: new Set(),
  });
  const latest = useRef({
    count,
    merge,
    noticeItems: notice.items,
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
  const acknowledge = useCallback(() => {
    setNotice({ items: [], scope, seenPending: new Set() });
  }, [scope]);
  useEffect(() => {
    latest.current = {
      count,
      merge,
      noticeItems: notice.scope === scope ? notice.items : [],
      paging,
      pendingItems,
      probe,
      refreshing,
      scope,
    };
  }, [count, merge, probe, pendingItems, refreshing, paging, scope, notice]);

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
    let scrolled = false;
    let noticeVisibilityChanged = false;
    const seenCards = new Set<string>();
    const onPostVisible = (event: Event) => {
      const { detail: id, target } = event as CustomEvent<string>;
      if (
        !id ||
        !(target instanceof HTMLElement) ||
        !root.current?.contains(target)
      ) {
        return;
      }
      seenCards.delete(id);
      seenCards.add(id);
      if (seenCards.size > 600) {
        const oldest = seenCards.values().next().value;
        if (oldest !== undefined) {
          seenCards.delete(oldest);
        }
      }
      const { current } = latest;
      if (
        current.pendingItems.some((item) => item.id === id) ||
        current.noticeItems.some((item) => item.id === id)
      ) {
        noticeVisibilityChanged = true;
        schedule();
      }
    };

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
            setNotice({
              items: [],
              scope: refreshScope,
              seenPending: new Set(),
            });
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
    const probeAtHead = async () => {
      try {
        await latest.current.probe();
      } catch {
        // The next probe can retry without clearing the current timeline.
      }
    };
    const updateHead = () => {
      const { current } = latest;
      const feed = root.current;
      if (!feed?.checkVisibility()) {
        return;
      }
      const offset = Math.max(0, scrollContainer.scrollTop - feedOffset());
      const atHead = offset < HEAD_THRESHOLD;
      const { admitHead } = feedRenderPolicy({
        active: enabled,
        admitAtHead: tracksUnread,
        initialLoading: false,
        offset,
        paging: current.paging,
        pendingHeadCount: current.count,
        refreshing: current.refreshing || refreshBusy.current,
      });
      const updateNotice = () => {
        setNotice((previous) => {
          const previousItems =
            previous.scope === current.scope ? previous.items : [];
          let items = atHead ? [] : previousItems;
          if (admitHead && !atHead) {
            items = mergeUnreadFeedHead(items, current.pendingItems);
          }
          if (seenCards.size) {
            items = items.filter((item) => !seenCards.has(item.id));
          }
          const seenPending = new Set(
            current.pendingItems
              .filter((item) => seenCards.has(item.id))
              .map((item) => item.id)
          );
          if (
            previous.scope === current.scope &&
            items.length === previousItems.length &&
            items.every((item, index) => item === previousItems[index]) &&
            seenPending.size === previous.seenPending.size &&
            [...seenPending].every((id) => previous.seenPending.has(id))
          ) {
            return previous;
          }
          return { items, scope: current.scope, seenPending };
        });
      };
      if (admitHead && atHead) {
        updateNotice();
        current.merge();
      } else if (admitHead) {
        // Hit-test the viewport instead of forcing each offscreen card to lay out.
        const edge = scrollContainer.getBoundingClientRect().top;
        const anchor = visibleScrollAnchor(feed, edge);
        const before = anchor?.getBoundingClientRect().top;
        flushSync(() => {
          if (tracksUnread) {
            updateNotice();
          }
          current.merge();
        });
        if (anchor?.isConnected && before !== undefined) {
          const delta = anchor.getBoundingClientRect().top - before;
          if (delta) {
            scrollContainer.scrollTop += delta;
          }
        }
      } else if (
        tracksUnread &&
        (noticeVisibilityChanged || (atHead && current.noticeItems.length > 0))
      ) {
        updateNotice();
      }
      if (
        scrolled &&
        offset <= 48 &&
        Date.now() - lastProbe >= 10_000 &&
        !current.refreshing &&
        !refreshBusy.current &&
        !current.paging
      ) {
        lastProbe = Date.now();
        void probeAtHead();
      }
    };
    const schedule = () => {
      if (frame.current !== null) {
        return;
      }
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        updateHead();
        scrolled = false;
        noticeVisibilityChanged = false;
      });
    };
    admitRef.current = schedule;
    const onScroll = () => {
      const { current } = latest;
      if (
        !current.count &&
        !current.noticeItems.length &&
        Date.now() - lastProbe < 10_000
      ) {
        return;
      }
      scrolled = true;
      schedule();
    };
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    if (tracksUnread) {
      scrollContainer.addEventListener(FEED_POST_VISIBLE_EVENT, onPostVisible);
    }
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
      scrollContainer.removeEventListener(
        FEED_POST_VISIBLE_EVENT,
        onPostVisible
      );
    };
  }, [enabled, root, scope, tracksUnread]);

  useEffect(() => {
    if (
      enabled &&
      count > 0 &&
      !refreshing &&
      !paging &&
      latest.current.scope === scope
    ) {
      admitRef.current?.();
    }
  }, [enabled, count, refreshing, paging, scope]);
  return {
    acknowledge,
    pullState,
    unreadItems:
      notice.scope === scope
        ? mergeUnreadFeedHead(
            notice.items,
            pendingItems.filter((item) => !notice.seenPending.has(item.id))
          )
        : pendingItems,
  };
}
