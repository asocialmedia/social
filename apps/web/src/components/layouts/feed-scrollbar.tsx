"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const MIN_THUMB_HEIGHT = 48;
const MAX_THUMB_HEIGHT = 96;
const HIDE_DELAY_MS = 800;

interface FeedScrollbarProps {
  containerRef: React.RefObject<HTMLElement | null>;
}

interface ThumbGeometry {
  height: number;
  translate: number;
  visible: boolean;
}

interface TrackGeometry {
  maxTranslate: number;
  scrollable: number;
  thumbHeight: number;
  trackHeight: number;
}

function getTrackGeometry(el: HTMLElement): TrackGeometry {
  const trackHeight = el.clientHeight;
  const thumbHeight = Math.min(
    Math.max(
      (el.clientHeight / el.scrollHeight) * trackHeight,
      MIN_THUMB_HEIGHT
    ),
    MAX_THUMB_HEIGHT
  );
  const scrollable = el.scrollHeight - el.clientHeight;
  const maxTranslate = trackHeight - thumbHeight;
  return { maxTranslate, scrollable, thumbHeight, trackHeight };
}

export const FeedScrollbar = ({ containerRef }: FeedScrollbarProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartScrollRef = useRef(0);
  const dragStartYRef = useRef(0);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);
  const [geometry, setGeometry] = useState<ThumbGeometry>({
    height: 0,
    translate: 0,
    visible: false,
  });
  const [showing, setShowing] = useState(false);

  const show = useCallback(() => {
    setShowing(true);
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    hideTimeoutRef.current = setTimeout(() => {
      if (!draggingRef.current) {
        setShowing(false);
      }
    }, HIDE_DELAY_MS);
  }, []);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const { scrollHeight, scrollTop } = el;
    if (scrollHeight <= el.clientHeight) {
      setGeometry((current) =>
        current.visible ? { ...current, visible: false } : current
      );
      return;
    }
    const { maxTranslate, scrollable, thumbHeight } = getTrackGeometry(el);
    const translate =
      scrollable > 0 ? (scrollTop / scrollable) * maxTranslate : 0;
    setGeometry((current) =>
      current.height === thumbHeight &&
      current.translate === translate &&
      current.visible
        ? current
        : { height: thumbHeight, translate, visible: true }
    );
    show();
  }, [containerRef, show]);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    measure();
    el.addEventListener("scroll", scheduleMeasure, { passive: true });
    el.addEventListener("pointerenter", show);
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(el);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      el.removeEventListener("scroll", scheduleMeasure);
      el.removeEventListener("pointerenter", show);
      observer.disconnect();
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [containerRef, measure, scheduleMeasure, show]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) {
        return;
      }
      draggingRef.current = true;
      dragStartScrollRef.current = el.scrollTop;
      dragStartYRef.current = e.clientY;
      e.currentTarget.setPointerCapture(e.pointerId);
      setShowing(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    },
    [containerRef]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!(draggingRef.current && el)) {
        return;
      }
      const { maxTranslate, scrollable } = getTrackGeometry(el);
      const deltaY = e.clientY - dragStartYRef.current;
      const deltaScroll =
        scrollable > 0 && maxTranslate > 0
          ? (deltaY / maxTranslate) * scrollable
          : 0;
      el.scrollTop = dragStartScrollRef.current + deltaScroll;
    },
    [containerRef]
  );

  const handlePointerUp = useCallback(() => {
    draggingRef.current = false;
    setShowing(false);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 right-0 z-30 hidden h-full w-2.5 lg:block"
      ref={trackRef}
    >
      {geometry.visible ? (
        <div
          className={cn(
            "feed-scrollbar-thumb pointer-events-auto absolute top-0 right-0.5 w-1.5 cursor-grab rounded-full",
            "transition-[transform,opacity] duration-300 ease-out",
            showing ? "opacity-100" : "opacity-0",
            "active:cursor-grabbing"
          )}
          onLostPointerCapture={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            height: geometry.height,
            transform: `translateY(${geometry.translate}px) translateX(${showing ? 0 : 6}px)`,
          }}
        />
      ) : null}
    </div>
  );
};
