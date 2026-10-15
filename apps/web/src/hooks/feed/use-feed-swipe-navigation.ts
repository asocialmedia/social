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

export interface SwipeNavigationOptions {
  enableDesktop?: boolean;
}

export function useFeedSwipeNavigation(
  containerRef: RefObject<HTMLElement | null>,
  onNavigate: (direction: -1 | 1) => void,
  options?: SwipeNavigationOptions
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const enableDesktop = options?.enableDesktop ?? false;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    // Whether a single touch or drag is being tracked, and once decided,
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

    const handleStart = (
      clientX: number,
      clientY: number,
      target: EventTarget | null
    ) => {
      if (startsInHorizontalScroller(target)) {
        return;
      }
      tracking = true;
      horizontal = null;
      dx = 0;
      startX = clientX;
      startY = clientY;
      startTime = performance.now();
    };

    const handleMove = (
      clientX: number,
      clientY: number,
      cancelable: boolean,
      preventDefault: () => void
    ) => {
      if (!tracking) {
        return;
      }
      const currentDx = clientX - startX;
      const dy = clientY - startY;
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
      if (cancelable) {
        preventDefault();
      }
    };

    const handleEnd = () => {
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
        // Dragging content with the finger or pointer: a left-to-right drag pulls the
        // left-hand tab into view, a right-to-left drag the right-hand one.
        onNavigate(finalDx > 0 ? -1 : 1);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        reset();
        return;
      }
      const [touch] = event.touches;
      handleStart(touch.clientX, touch.clientY, touch.target);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!tracking || event.touches.length !== 1) {
        return;
      }
      const [touch] = event.touches;
      handleMove(touch.clientX, touch.clientY, event.cancelable, () =>
        event.preventDefault()
      );
    };

    const onTouchEnd = () => {
      handleEnd();
    };

    // Pointer events for desktop drag gestures (mouse / pen)
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0) {
        return;
      }
      handleStart(event.clientX, event.clientY, event.target);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      handleMove(event.clientX, event.clientY, event.cancelable, () => {
        if (event.cancelable) {
          event.preventDefault();
        }
      });
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      handleEnd();
    };

    // Trackpad horizontal swipe
    let wheelTimer: number | null = null;
    let wheelAccumX = 0;
    const onWheel = (event: WheelEvent) => {
      if (
        Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.5 &&
        Math.abs(event.deltaX) > 15
      ) {
        wheelAccumX += event.deltaX;
        if (wheelTimer !== null) {
          window.clearTimeout(wheelTimer);
        }
        wheelTimer = window.setTimeout(() => {
          if (Math.abs(wheelAccumX) > 40) {
            onNavigate(wheelAccumX > 0 ? 1 : -1);
          }
          wheelAccumX = 0;
          wheelTimer = null;
        }, 60);
      }
    };

    const bindTouch = () => {
      container.addEventListener("touchstart", onTouchStart, {
        passive: true,
      });
      container.addEventListener("touchmove", onTouchMove, { passive: false });
      container.addEventListener("touchend", onTouchEnd);
      container.addEventListener("touchcancel", reset);
    };

    const unbindTouch = () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", reset);
      reset();
    };

    const bindDesktop = () => {
      container.addEventListener("pointerdown", onPointerDown);
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerup", onPointerUp);
      container.addEventListener("pointercancel", reset);
      container.addEventListener("wheel", onWheel, { passive: true });
    };

    const unbindDesktop = () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", reset);
      container.removeEventListener("wheel", onWheel);
      if (wheelTimer !== null) {
        window.clearTimeout(wheelTimer);
        wheelTimer = null;
      }
    };

    if (enableDesktop) {
      bindTouch();
      bindDesktop();
      return () => {
        unbindTouch();
        unbindDesktop();
      };
    }

    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    const handleChange = () =>
      mobileQuery.matches ? bindTouch() : unbindTouch();

    if (mobileQuery.matches) {
      bindTouch();
    }
    mobileQuery.addEventListener("change", handleChange);
    return () => {
      unbindTouch();
      mobileQuery.removeEventListener("change", handleChange);
    };
  }, [containerRef, onNavigate, options?.enableDesktop]);
}
