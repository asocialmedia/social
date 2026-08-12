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

export function FeedScrollbar({ containerRef }: FeedScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragStartScrollRef = useRef(0);
  const dragStartYRef = useRef(0);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const { clientHeight, scrollHeight, scrollTop } = el;
    if (scrollHeight <= clientHeight) {
      setGeometry((current) =>
        current.visible ? { ...current, visible: false } : current
      );
      return;
    }
    const trackHeight = el.clientHeight;
    const thumbHeight = Math.min(
      Math.max((clientHeight / scrollHeight) * trackHeight, MIN_THUMB_HEIGHT),
      MAX_THUMB_HEIGHT
    );
    const scrollable = scrollHeight - clientHeight;
    const maxTranslate = trackHeight - thumbHeight;
    const translate =
      scrollable > 0 ? (scrollTop / scrollable) * maxTranslate : 0;
    setGeometry({ height: thumbHeight, translate, visible: true });
    show();
  }, [containerRef, show]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    el.addEventListener("pointerenter", show);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      el.removeEventListener("pointerenter", show);
      observer.disconnect();
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [containerRef, measure, show]);

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
            "pointer-events-auto absolute top-0 right-0.5 w-1.5 cursor-grab rounded-full border border-[rgba(170,60,0,0.95)]",
            "bg-gradient-to-b from-[#ff9500] to-[#e65500]",
            "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25),inset_0_1px_1.5px_rgba(255,255,255,0.5),0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(0,0,0,0.12)]",
            "transition-[transform,opacity] duration-300 ease-out",
            showing ? "opacity-100" : "opacity-0",
            "hover:from-[#ff9f0a] hover:to-[#ea5b00] active:cursor-grabbing"
          )}
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
}
