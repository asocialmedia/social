"use client";

import type React from "react";
import { useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";

type RecommendationEventType =
  | "DWELL"
  | "IMPRESSION"
  | "NOT_INTERESTED"
  | "SKIP"
  | "VIEW_COMPLETE"
  | "VIEW_START";

interface RecommendationEvent {
  durationMs?: number;
  eventType: RecommendationEventType;
  postId: string;
}

const MAX_QUEUE_SIZE = 50;
let eventQueue: RecommendationEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

async function flushEvents(): Promise<void> {
  if (flushInFlight || eventQueue.length === 0) {
    return;
  }
  flushInFlight = true;
  const events = eventQueue.splice(0, MAX_QUEUE_SIZE);
  try {
    const response = await fetch("/api/recommendations/events", {
      body: JSON.stringify({ events }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
    if (!response.ok && response.status !== 401) {
      eventQueue = [...events, ...eventQueue].slice(-MAX_QUEUE_SIZE);
    }
  } catch {
    eventQueue = [...events, ...eventQueue].slice(-MAX_QUEUE_SIZE);
  } finally {
    flushInFlight = false;
    if (eventQueue.length > 0) {
      scheduleFlush();
    }
  }
}

function scheduleFlush(): void {
  if (flushTimer !== null) {
    return;
  }
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEvents();
  }, 2000);
}

export function trackRecommendationEvent(event: RecommendationEvent): void {
  eventQueue.push(event);
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    void flushEvents();
  } else {
    scheduleFlush();
  }
}

export function markRecommendationNotInterested(postId: string): void {
  trackRecommendationEvent({ eventType: "NOT_INTERESTED", postId });
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("recommendation:not-interested", {
        detail: { postId },
      })
    );
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void flushEvents();
  });
}

interface RecommendationTrackerProps {
  children: React.ReactNode;
  // Layout pass-through. Full-height media (the gust reel) needs this wrapper to
  // forward the parent's height so the card is sized from the available space
  // instead of its own video's intrinsic dimensions.
  className?: string;
  postId: string;
}

export function RecommendationTracker({
  children,
  className,
  postId,
}: RecommendationTrackerProps) {
  const { user } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const completionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user || !containerRef.current || typeof window === "undefined") {
      return;
    }
    const element = containerRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || startedAtRef.current !== null) {
          return;
        }
        startedAtRef.current = Date.now();
        trackRecommendationEvent({ eventType: "IMPRESSION", postId });
        trackRecommendationEvent({ eventType: "VIEW_START", postId });
        completionTimerRef.current = window.setTimeout(() => {
          if (startedAtRef.current !== null && !completedRef.current) {
            completedRef.current = true;
            trackRecommendationEvent({
              durationMs: Date.now() - startedAtRef.current,
              eventType: "VIEW_COMPLETE",
              postId,
            });
          }
        }, 8000);
      },
      { threshold: 0.6 }
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      if (startedAtRef.current !== null) {
        trackRecommendationEvent({
          durationMs: Date.now() - startedAtRef.current,
          eventType: "DWELL",
          postId,
        });
      }
    };
  }, [postId, user]);

  return (
    <div className={className} ref={containerRef}>
      {children}
    </div>
  );
}
