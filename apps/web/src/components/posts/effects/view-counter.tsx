"use client";

import { useEffect, useRef } from "react";

import { useIncrementViewMutation } from "@/posts/view/mutations";

interface ViewTrackerProps {
  postId: string;
}

// The marker element must stay geometrically visible to IntersectionObserver:
// a visually-hidden-but-unclipped 1x1px marker is detected the moment it
// enters the viewport, whereas `sr-only` clips the element (clip-path) down
// to zero area, so the observer can never report it as intersecting.
const MARKER_CLASS = "pointer-events-none block h-px w-px opacity-0";

// Single shared observer instance for all view tracking across the application
let sharedObserver: IntersectionObserver | null = null;
const observerHandlers = new Map<Element, (target: Element) => void>();

function getSharedObserver(): IntersectionObserver | null {
  if (!sharedObserver && typeof window !== "undefined") {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const handler = observerHandlers.get(entry.target);
            if (handler) {
              observerHandlers.delete(entry.target);
              sharedObserver?.unobserve(entry.target);
              handler(entry.target);
            }
          }
        }
      },
      {
        rootMargin: "0px",
        threshold: 0.5,
      }
    );
  }
  return sharedObserver;
}

export default function ViewTracker({ postId }: ViewTrackerProps) {
  const incrementViewMutation = useIncrementViewMutation();
  const markerRef = useRef<HTMLSpanElement>(null);
  const hasIncrementedRef = useRef(false);

  useEffect(() => {
    const el = markerRef.current;
    if (!el || hasIncrementedRef.current) {
      return;
    }

    const observer = getSharedObserver();
    if (!observer) {
      return;
    }

    observerHandlers.set(el, () => {
      if (!hasIncrementedRef.current) {
        hasIncrementedRef.current = true;
        incrementViewMutation.mutate(postId);
      }
    });

    observer.observe(el);

    return () => {
      observerHandlers.delete(el);
      observer.unobserve(el);
    };
  }, [postId, incrementViewMutation]);

  return <span aria-hidden="true" className={MARKER_CLASS} ref={markerRef} />;
}
