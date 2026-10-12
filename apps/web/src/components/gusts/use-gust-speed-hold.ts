"use client";

import { createGustSpeedHold, GUST_SPEED_BOOST } from "@asm/ui/lib/gust-speed";
import { useEffect, useState } from "react";
import type { RefObject } from "react";

export function useGustSpeedHold({
  enabled,
  onConsumeTap,
  targetRef,
  videoRef,
}: {
  enabled: boolean;
  onConsumeTap: () => void;
  targetRef: RefObject<HTMLButtonElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [boosted, setBoosted] = useState(false);
  useEffect(() => {
    const target = targetRef.current;
    const video = videoRef.current;
    if (!enabled || !target || !video) {
      return;
    }
    let pointerId: number | null = null;
    const hold = createGustSpeedHold({
      onChange(active) {
        const playingHold = active && !video.paused;
        video.playbackRate = playingHold ? GUST_SPEED_BOOST : 1;
        setBoosted(playingHold);
      },
      onConsumeTap,
    });
    const cancel = () => {
      const capturedPointer = pointerId;
      pointerId = null;
      hold.cancel();
      if (
        capturedPointer !== null &&
        target.hasPointerCapture(capturedPointer)
      ) {
        target.releasePointerCapture(capturedPointer);
      }
    };
    const start = (event: PointerEvent) => {
      if (!event.isPrimary || pointerId !== null) {
        cancel();
        return;
      }
      if (event.button !== 0 || document.hidden) {
        return;
      }
      ({ pointerId } = event);
      if (event.isTrusted) {
        target.setPointerCapture(event.pointerId);
      }
      hold.start(event.clientX, event.clientY);
    };
    const secondTouch = (event: PointerEvent) => {
      if (!event.isPrimary) {
        cancel();
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId === pointerId) {
        hold.move(event.clientX, event.clientY);
      }
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId === pointerId) {
        cancel();
      }
    };
    const contextMenu = (event: Event) => event.preventDefault();
    target.addEventListener("pointerdown", start);
    target.addEventListener("lostpointercapture", cancel);
    target.addEventListener("contextmenu", contextMenu);
    document.addEventListener("pointerdown", secondTouch);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    document.addEventListener("visibilitychange", cancel);
    window.addEventListener("blur", cancel);
    video.addEventListener("pause", cancel);
    return () => {
      cancel();
      target.removeEventListener("pointerdown", start);
      target.removeEventListener("lostpointercapture", cancel);
      target.removeEventListener("contextmenu", contextMenu);
      document.removeEventListener("pointerdown", secondTouch);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.removeEventListener("visibilitychange", cancel);
      window.removeEventListener("blur", cancel);
      video.removeEventListener("pause", cancel);
    };
  }, [enabled, onConsumeTap, targetRef, videoRef]);
  return enabled && boosted;
}
