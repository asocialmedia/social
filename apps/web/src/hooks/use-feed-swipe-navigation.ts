"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

// Mobile-only swipe navigation between home feed tabs, attached to the feed
// scroll area (which owns its own overflow). The strip is dragged with the
// finger: a right-to-left slide reveals the tab on the right of the current
// one, a left-to-right slide the tab on its left.
//
// Vertical swipes are abandoned in favor of native scrolling as soon as the
// gesture locks direction, and gestures starting inside a horizontally
// scrollable element are ignored so carousels keep their own touches.
const MOBILE_QUERY = "(max-width: 767px)";

// Horizontal travel (px) that commits a swipe on release, and the speed
// (px/ms) that commits a shorter flick.
const SWIPE_DISTANCE = 56;
const FLICK_VELOCITY = 0.6;
// Once the finger travels this far the gesture locks to horizontal or
// vertical; whichever axis is ahead wins.
const DIRECTION_LOCK = 10;

export function useFeedSwipeNavigation(
  containerRef: RefObject<HTMLElement | null>,
  onNavigate: (direction: -1 | 1) => void
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    // Whether a single-finger touch is being tracked, and once decided,
    // whether it locked as a horizontal gesture.
    let tracking = false;
    let horizontal: boolean | null = null;
    let dx = 0;

    const reset = () => {
      tracking = false;
      horizontal = null;
      dx = 0;
    };

    const startsInHorizontalScroller = (target: EventTarget | null) => {
      let el = target instanceof Element ? target : null;
      while (el && el !== container) {
        const { overflowX } = getComputedStyle(el);
        // Only bail out for scrollers that can actually pan horizontally right
        // now. A plain overflow-y-auto element computes overflow-x to auto per
        // CSS rules without being pannable, and must not disable the gesture.
        if (
          (overflowX === "auto" || overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth
        ) {
          return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        reset();
        return;
      }
      const [touch] = event.touches;
      if (startsInHorizontalScroller(touch.target)) {
        return;
      }
      tracking = true;
      horizontal = null;
      dx = 0;
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = performance.now();
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) {
        return;
      }
      const [touch] = event.touches;
      const currentDx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (horizontal === null) {
        if (
          Math.abs(currentDx) < DIRECTION_LOCK &&
          Math.abs(dy) < DIRECTION_LOCK
        ) {
          return;
        }
        horizontal = Math.abs(currentDx) > Math.abs(dy);
        if (!horizontal) {
          // Vertical gesture: hand it back to native scrolling entirely.
          reset();
          return;
        }
      }
      dx = currentDx;
      // The horizontal swipe belongs to tab navigation; keep the browser from
      // also interpreting it (e.g. rubber banding or text selection).
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (!tracking || horizontal !== true) {
        reset();
        return;
      }
      const elapsed = performance.now() - startTime;
      const velocity = Math.abs(dx) / Math.max(elapsed, 1);
      const committed =
        Math.abs(dx) >= SWIPE_DISTANCE || velocity >= FLICK_VELOCITY;
      // Capture the travel before reset() clears it.
      const finalDx = dx;
      reset();
      if (committed) {
        // Dragging content with the finger: a left-to-right drag pulls the
        // left-hand tab into view, a right-to-left drag the right-hand one.
        onNavigate(finalDx > 0 ? -1 : 1);
      }
    };

    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const bind = () => {
      container.addEventListener("touchstart", onTouchStart, {
        passive: true,
      });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      container.addEventListener("touchend", onTouchEnd);
      container.addEventListener("touchcancel", reset);
    };
    const unbind = () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", reset);
      reset();
    };
    const handleChange = () => (mobileQuery.matches ? bind() : unbind());

    if (mobileQuery.matches) {
      bind();
    }
    mobileQuery.addEventListener("change", handleChange);
    return () => {
      unbind();
      mobileQuery.removeEventListener("change", handleChange);
    };
  }, [containerRef, onNavigate]);
}
