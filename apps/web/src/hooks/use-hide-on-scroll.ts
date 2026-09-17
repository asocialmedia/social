"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

// Hides a header while the user scrolls down a feed and reveals it again on
// scroll up. Reads the scroll container directly (no layout observers) so it
// works on the custom feed scroll areas that own their own overflow.
export function useHideOnScroll(
  scrollRef: RefObject<HTMLElement | null>,
  threshold = 8
): boolean {
  const [hidden, setHidden] = useState(false);
  const boundElRef = useRef<HTMLElement | null>(null);
  const handlerRef = useRef<(() => void) | null>(null);

  // Deliberately NO dependency array. A ref carries no re-render signal, so a
  // []-deps effect cannot tell when the element finally appears - and on routes
  // that render a query-gated skeleton first, the scroller is not mounted on the
  // initial pass, which left the listener permanently unattached. Re-checking
  // after every render fixes that; the identity guard makes the common case a
  // cheap no-op so the listener is only rebound when the element actually
  // changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === boundElRef.current) {
      return;
    }
    if (boundElRef.current && handlerRef.current) {
      boundElRef.current.removeEventListener("scroll", handlerRef.current);
    }
    boundElRef.current = el;
    if (!el) {
      handlerRef.current = null;
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

    handlerRef.current = onScroll;
    el.addEventListener("scroll", onScroll, { passive: true });
  });

  // Unmount-only teardown. It MUST also clear the bookkeeping refs: React runs
  // this cleanup during the dev-only StrictMode remount, so leaving
  // `boundElRef` set would make the identity guard above short-circuit on the
  // re-run and never re-attach - a silently dead listener.
  useEffect(
    () => () => {
      if (boundElRef.current && handlerRef.current) {
        boundElRef.current.removeEventListener("scroll", handlerRef.current);
      }
      boundElRef.current = null;
      handlerRef.current = null;
    },
    []
  );

  return hidden;
}

// The same hide-on-scroll behaviour as useHideOnScroll, but without needing a
// ref: it listens on the document in the CAPTURE phase, so it catches scroll
// from whichever container the current route scrolls. Scroll events do not
// bubble, yet they do propagate down through capture, which is what makes one
// listener cover every page. Swapping the tracked container mid-gesture
// re-seeds the baseline instead of reporting a bogus delta.
//
// Chrome that must move in lockstep with the page then needs no shared state:
// both this and useHideOnScroll see the same event, apply the same threshold and
// the same `delta > 0 && scrollTop > 0` rule, so they flip on the same frame.
export function useHideOnPageScroll(threshold = 8): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let tracked: Element | null = null;
    let lastScrollTop = 0;

    const onScroll = (event: Event) => {
      const { target } = event;
      if (!(target instanceof Element)) {
        return;
      }
      // Only containers with real distance to travel drive the chrome; this
      // skips the small inner scrollers (editor bodies, chip rails, pickers).
      if (target.scrollHeight - target.clientHeight < 100) {
        return;
      }
      if (target !== tracked) {
        tracked = target;
        lastScrollTop = target.scrollTop;
        return;
      }
      const current = target.scrollTop;
      const delta = current - lastScrollTop;
      lastScrollTop = current;
      if (Math.abs(delta) < threshold) {
        return;
      }
      setHidden(delta > 0 && current > 0);
    };

    document.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () =>
      document.removeEventListener("scroll", onScroll, { capture: true });
  }, [threshold]);

  return hidden;
}
