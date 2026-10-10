"use client";

import { gustZoomTransform } from "@asm/ui/lib/gust-zoom";
import { useMotionValue } from "motion/react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export function useGustPinchZoom({
  enabled,
  onPinchStart,
  targetRef,
  videoAspectRatio,
  viewportHeight,
  viewportWidth,
}: {
  enabled: boolean;
  onPinchStart: () => void;
  targetRef: RefObject<HTMLDivElement | null>;
  videoAspectRatio: number;
  viewportHeight: number;
  viewportWidth: number;
}) {
  const suppressTapUntil = useRef(0);
  const scale = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  useEffect(() => {
    if (!enabled) {
      suppressTapUntil.current = 0;
      scale.set(1);
      x.set(0);
      y.set(0);
      return;
    }
    const target = targetRef.current;
    if (!target) {
      return;
    }
    let pinch: {
      anchorX: number;
      anchorY: number;
      distance: number;
      scale: number;
    } | null = null;
    const geometry = (event: TouchEvent) => {
      const [a, b] = event.touches;
      if (!a || !b) {
        return null;
      }
      const bounds = target.getBoundingClientRect();
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        focalX: (a.clientX + b.clientX) / 2 - bounds.left,
        focalY: (a.clientY + b.clientY) / 2 - bounds.top,
      };
    };
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        return;
      }
      const point = geometry(event);
      if (!point || point.distance <= 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      suppressTapUntil.current = Infinity;
      onPinchStart();
      pinch = {
        anchorX: (point.focalX - viewportWidth / 2 - x.get()) / scale.get(),
        anchorY: (point.focalY - viewportHeight / 2 - y.get()) / scale.get(),
        distance: point.distance,
        scale: scale.get(),
      };
    };
    const move = (event: TouchEvent) => {
      if (!pinch) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const point = geometry(event);
      if (!point) {
        return;
      }
      const mediaWidth = Math.min(
        viewportWidth,
        viewportHeight * videoAspectRatio
      );
      const next = gustZoomTransform({
        ...point,
        anchorX: pinch.anchorX,
        anchorY: pinch.anchorY,
        mediaHeight: mediaWidth / videoAspectRatio,
        mediaWidth,
        scale: (pinch.scale * point.distance) / pinch.distance,
        viewportHeight,
        viewportWidth,
      });
      scale.set(next.scale);
      x.set(next.x);
      y.set(next.y);
    };
    const finish = (event: TouchEvent) => {
      if (pinch && event.touches.length < 2) {
        event.preventDefault();
        event.stopPropagation();
        pinch = null;
        suppressTapUntil.current = Date.now() + 280;
      }
    };
    // Only two-finger touches are cancelled; one-finger paging remains native.
    target.addEventListener("touchstart", start, { passive: false });
    target.addEventListener("touchmove", move, { passive: false });
    target.addEventListener("touchend", finish, { passive: false });
    target.addEventListener("touchcancel", finish, { passive: false });
    return () => {
      target.removeEventListener("touchstart", start);
      target.removeEventListener("touchmove", move);
      target.removeEventListener("touchend", finish);
      target.removeEventListener("touchcancel", finish);
      if (pinch) {
        suppressTapUntil.current = Date.now() + 280;
      }
    };
  }, [
    enabled,
    onPinchStart,
    scale,
    targetRef,
    videoAspectRatio,
    viewportHeight,
    viewportWidth,
    x,
    y,
  ]);

  return { style: { scale, x, y }, suppressTapUntil };
}
