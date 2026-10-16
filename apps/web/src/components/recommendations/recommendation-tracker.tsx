"use client";

import { EngagementSession } from "@asm/media";
import type { EngagementEventType } from "@asm/media";
import type React from "react";
import { useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";

type RecommendationEventType = EngagementEventType | "NOT_INTERESTED";

interface RecommendationEvent {
  eventId?: string;
  requestId?: string;
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
  eventQueue.push({ ...event, eventId: event.eventId ?? crypto.randomUUID() });
  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    void flushEvents();
  } else {
    scheduleFlush();
  }
}

// Tells every mounted ranked surface to drop this post right now. The durable
// side of the dismissal is a server action (hideRecommendationPost), not a
// queued telemetry event: the feed must hide instantly, and the write must be
// undone reliably if the viewer taps Undo. Surfaces (the self-healing FeedView,
// the gust reel) listen for this and remove the id locally.
export function markRecommendationNotInterested(postId: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("recommendation:not-interested", {
        detail: { postId },
      })
    );
  }
}

// The inverse of markRecommendationNotInterested: undo restores the post to
// every surface showing it, so a mis-tap does not require a reload.
export function clearRecommendationNotInterested(postId: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("recommendation:interested", {
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
  requestId?: string;
}

export function RecommendationTracker({
  children,
  className,
  postId,
  requestId,
}: RecommendationTrackerProps) {
  const { user } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || !containerRef.current || typeof window === "undefined") {
      return;
    }
    const element = containerRef.current;
    let visible = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const session = new EngagementSession((event) =>
      trackRecommendationEvent({ ...event, postId, requestId })
    );
    const sample = () => {
      const video = element.querySelector("video");
      session.sample(
        {
          buffering: video ? video.readyState < 3 : undefined,
          duration: video?.duration,
          failed: Boolean(video?.error),
          foreground: document.visibilityState === "visible",
          playing: video ? !video.paused : undefined,
          position: video?.currentTime,
          video: Boolean(video),
          visible,
        },
        performance.now()
      );
    };
    const stop = (leaving: boolean) => {
      sample();
      session.stop(leaving);
      if (timer !== null) {
        clearInterval(timer);
      }
      timer = null;
    };
    const visibilityChanged = () => {
      stop(false);
      if (visible && document.visibilityState === "visible") {
        sample();
        timer = setInterval(sample, 250);
      }
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        const next = Boolean(
          entry?.isIntersecting && entry.intersectionRatio >= 0.6
        );
        if (next === visible) {
          return;
        }
        if (!next) {
          stop(true);
        }
        visible = next;
        if (next) {
          visibilityChanged();
        }
      },
      { threshold: 0.6 }
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibilityChanged);
      stop(true);
    };
  }, [postId, requestId, user]);

  return (
    <div className={className} ref={containerRef}>
      {children}
    </div>
  );
}
