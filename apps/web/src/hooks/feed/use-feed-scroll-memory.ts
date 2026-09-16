import type { RefObject } from "react";
import { useEffect, useRef } from "react";

import {
  clampScrollTop,
  computeAnchorScrollTop,
  findAnchorElement,
  findTopAnchor,
} from "@/lib/posts/feed-scroll";
import type { FeedPosition } from "@/store/feed-position-store";
import {
  useFeedPositionReady,
  useFeedPositionStore,
} from "@/store/feed-position-store";

// How long after mount a restore keeps polling for its anchor. Cold loads
// (evicted cache, slow media) need the runway; warm cache-first remounts
// settle on the first frames.
const RESTORE_WINDOW_MS = 5000;
// Consecutive frames the scroll position must hold before a restore is
// declared done. Guards against finishing mid-layout-shift.
const RESTORE_STABLE_FRAMES = 3;
// Idle gap after the last scroll event before the anchor is captured.
// Scroll offsets save every frame; anchor lookups only run once scrolling
// settles so long feeds never pay a querySelectorAll per frame.
const ANCHOR_SETTLE_MS = 300;

interface FeedScrollMemoryOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  // Stable per surface, e.g. `home:latest` or `profile:<userId>:posts`.
  // A null key disables tracking (nothing saved, nothing restored).
  memoryKey: string | null;
}

// Meta-style feed memory for the app's custom scroll containers (the browser
// only restores window scroll, and these feeds own their own overflow):
// every surface remembers its scroll offset plus the post at the top of the
// viewport, and coming back - from a post, a media viewer, another tab -
// lands exactly where you left instead of flashing the top of the feed.
export function useFeedScrollMemory({
  containerRef,
  memoryKey,
}: FeedScrollMemoryOptions): void {
  const ready = useFeedPositionReady();
  const keyRef = useRef<string | null>(null);
  const restoringRef = useRef(false);
  const userScrolledRef = useRef(false);

  // Persist the container's position: raw offsets on every scroll frame,
  // anchor capture once scrolling settles, and a final capture on pagehide
  // and unmount (covers back/forward navigations that never fire scroll).
  useEffect(() => {
    if (!memoryKey) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const key = memoryKey;
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const saveOffset = () => {
      const previous = useFeedPositionStore.getState().positions[key];
      useFeedPositionStore.getState().saveFeedPosition(key, {
        anchorOffset: previous?.anchorOffset ?? 0,
        anchorPostId: previous?.anchorPostId ?? null,
        scrollTop: container.scrollTop,
        updatedAt: Date.now(),
      });
    };

    const saveAnchor = () => {
      const anchor = findTopAnchor(container);
      const entry: FeedPosition = {
        anchorOffset: anchor?.offset ?? 0,
        anchorPostId: anchor?.id ?? null,
        scrollTop: container.scrollTop,
        updatedAt: Date.now(),
      };
      useFeedPositionStore.getState().saveFeedPosition(key, entry);
    };

    const onScroll = () => {
      // Programmatic restore sets land here too; they must neither cancel
      // the restore nor count as the user taking over.
      if (restoringRef.current) {
        return;
      }
      userScrolledRef.current = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(saveOffset);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(saveAnchor, ANCHOR_SETTLE_MS);
    };

    const onPageHide = () => {
      saveAnchor();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelAnimationFrame(frame);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      saveAnchor();
    };
  }, [containerRef, memoryKey]);

  // Restore on mount and whenever the tracked surface changes (tab switches
  // share one container). A key with no memory is a fresh surface, so it
  // starts at the top instead of inheriting the previous surface's offset.
  useEffect(() => {
    if (!ready || !memoryKey) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const key = memoryKey;
    const previousKey = keyRef.current;
    keyRef.current = key;

    const saved = useFeedPositionStore.getState().positions[key] ?? null;
    if (!saved || saved.scrollTop <= 0) {
      if (previousKey !== null && previousKey !== key) {
        container.scrollTo({ top: 0 });
      }
      return;
    }

    restoringRef.current = true;
    userScrolledRef.current = false;
    const deadline = performance.now() + RESTORE_WINDOW_MS;
    let frame = 0;
    let stableFrames = 0;
    let finished = false;

    // One attempt: anchor wins (survives height drift), raw pixels are the
    // fallback. Returns true once the container actually holds the target -
    // and only then: a container still showing a short skeleton clamps every
    // target near the top, which must NOT count as settled or cold loads get
    // stranded at the top when the real content lands.
    const attempt = (): boolean => {
      const anchor = saved.anchorPostId
        ? findAnchorElement(container, saved.anchorPostId)
        : null;
      const target = anchor
        ? computeAnchorScrollTop(container, anchor, saved.anchorOffset)
        : saved.scrollTop;
      const clamped = clampScrollTop(container, target);
      container.scrollTop = clamped;
      if (Math.abs(container.scrollTop - clamped) >= 2) {
        return false;
      }
      if (
        !anchor &&
        container.scrollHeight - container.clientHeight < saved.scrollTop - 2
      ) {
        return false;
      }
      return true;
    };

    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      restoringRef.current = false;
      cancelAnimationFrame(frame);
    };

    const tick = () => {
      if (finished) {
        return;
      }
      if (userScrolledRef.current || performance.now() > deadline) {
        finish();
        return;
      }
      stableFrames = attempt() ? stableFrames + 1 : 0;
      if (stableFrames >= RESTORE_STABLE_FRAMES) {
        finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Late media can still shift layout after the restore settles; take one
    // final correction pass on full page load unless the user has moved on.
    const onLoad = () => {
      if (!userScrolledRef.current) {
        attempt();
      }
    };
    window.addEventListener("load", onLoad);
    return () => {
      finish();
      window.removeEventListener("load", onLoad);
    };
  }, [containerRef, memoryKey, ready]);
}
