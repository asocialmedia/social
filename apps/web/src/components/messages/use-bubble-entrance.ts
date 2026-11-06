"use client";

import {
  BUBBLE_MOTION,
  BUBBLE_SPRING_EASING,
  bubbleLaunchOffset,
} from "@asm/messages";
import type {
  BubbleEntranceRegistry,
  BubbleMotionDirection,
} from "@asm/messages";
import { useLayoutEffect, useRef, useState } from "react";

export function useBubbleEntrance(
  entrances: BubbleEntranceRegistry | undefined,
  messageId: string,
  direction: BubbleMotionDirection = "outgoing"
) {
  const motionRef = useRef<HTMLDivElement>(null);
  const origin = useRef(entrances?.getOrigin(messageId));
  const [entering, setEntering] = useState(
    () =>
      (entrances?.isPending(messageId) ?? false) &&
      !(
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
  );
  useLayoutEffect(() => {
    entrances?.consume(messageId);
    if (!entering) {
      return;
    }
    const element = motionRef.current;
    if (element) {
      element.style.setProperty(
        "--msg-flight-easing",
        window.CSS?.supports("animation-timing-function", "linear(0, 1)")
          ? BUBBLE_SPRING_EASING[direction]
          : "cubic-bezier(0.16, 1, 0.3, 1)"
      );
      element.style.setProperty(
        "--msg-flight-duration",
        `${BUBBLE_MOTION[direction].duration}ms`
      );
      if (direction === "outgoing" && element.parentElement) {
        // The unanimated parent gives the final position without measuring an
        // already transformed bubble or interrupting its compositor animation.
        const offset = bubbleLaunchOffset(
          origin.current,
          element.parentElement.getBoundingClientRect()
        );
        element.style.setProperty("--msg-launch-x", `${offset.x}px`);
        element.style.setProperty("--msg-launch-y", `${offset.y}px`);
      }
    }
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stopForReducedMotion = () => {
      if (preference.matches) {
        setEntering(false);
      }
    };
    preference.addEventListener("change", stopForReducedMotion);
    const timeout = window.setTimeout(
      () => setEntering(false),
      BUBBLE_MOTION[direction].duration + 100
    );
    return () => {
      window.clearTimeout(timeout);
      preference.removeEventListener("change", stopForReducedMotion);
      for (const property of [
        "--msg-flight-easing",
        "--msg-flight-duration",
        "--msg-launch-x",
        "--msg-launch-y",
      ]) {
        element?.style.removeProperty(property);
      }
    };
  }, [direction, entrances, messageId, entering]);
  return [entering, () => setEntering(false), motionRef] as const;
}
