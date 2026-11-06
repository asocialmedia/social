"use client";

import { useEffect, useRef } from "react";

// Keep the focused conversation inside the visible viewport when a browser
// opens its software keyboard or changes the browser toolbar height.
export function useCommunityChatViewport(enabled: boolean) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const viewport = window.visualViewport;
    const resize = () => {
      const element = viewportRef.current;
      if (!element) {
        return;
      }
      element.style.setProperty(
        "--community-chat-height",
        `${viewport?.height ?? window.innerHeight}px`
      );
      element.style.setProperty(
        "--community-chat-top",
        `${viewport?.offsetTop ?? 0}px`
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    window.addEventListener("resize", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      window.removeEventListener("resize", resize);
    };
  }, [enabled]);
  return viewportRef;
}
