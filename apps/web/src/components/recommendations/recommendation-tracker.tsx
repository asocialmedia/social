"use client";

import { EngagementSession } from "@asm/media";
import type { EngagementEventType } from "@asm/media";
import type React from "react";
import { useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { rememberFeedExposure } from "@/lib/posts/feed-exposure";

type RecommendationEventType =
  | EngagementEventType
  | "NOT_INTERESTED"
  | "DOWNVOTE"
  | "REMOVE_DOWNVOTE"
  | "REMOVE_NOT_INTERESTED"
  | "VOTE"
  | "BOOKMARK"
  | "COMMENT";
const networkReceipts = new Map<
  string,
  { networkToken: string; networkSource?: string }
>();

export function trackNetworkAction(
  postId: string,
  eventType: RecommendationEventType
): void {
  const receipt = networkReceipts.get(postId);
  if (receipt && receipt.networkSource !== "asm") {
    trackRecommendationEvent({ ...receipt, eventType, postId });
  }
}

interface RecommendationEvent {
  networkToken?: string;
  networkSource?: string;
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
    const nativeEvents = events.filter(
      (event) =>
        (!event.networkSource || event.networkSource === "asm") &&
        ![
          "DOWNVOTE",
          "REMOVE_DOWNVOTE",
          "REMOVE_NOT_INTERESTED",
          "VOTE",
          "BOOKMARK",
          "COMMENT",
        ].includes(event.eventType)
    );
    const networkEvents = events.filter((event) => event.networkToken);
    const responses = await Promise.all([
      ...(nativeEvents.length
        ? [
            fetch("/api/recommendations/events", {
              body: JSON.stringify({ events: nativeEvents }),
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              keepalive: true,
              method: "POST",
            }),
          ]
        : []),
      ...(networkEvents.length
        ? [
            fetch("/api/network/events", {
              body: JSON.stringify({ events: networkEvents }),
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              keepalive: true,
              method: "POST",
            }).then(async (response) => {
              const result = response.ok ? await response.clone().json() : null;
              if (result?.accepted > 0) {
                window.dispatchEvent(new Event("network:learned"));
              }
              return response;
            }),
          ]
        : []),
    ]);
    if (responses.some((response) => !response.ok && response.status !== 401)) {
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
  window.dispatchEvent(new Event("network:learned"));
  trackNetworkAction(postId, "NOT_INTERESTED");
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
  window.dispatchEvent(new Event("network:learned"));
  trackNetworkAction(postId, "REMOVE_NOT_INTERESTED");
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
  networkToken?: string;
  networkSource?: string;
  children: React.ReactNode;
  // Layout pass-through. Full-height media (the gust reel) needs this wrapper to
  // forward the parent's height so the card is sized from the available space
  // instead of its own video's intrinsic dimensions.
  className?: string;
  postId: string;
  requestId?: string;
}

export function RecommendationTracker({
  networkToken,
  networkSource,
  children,
  className,
  postId,
  requestId,
}: RecommendationTrackerProps) {
  const { user } = useSession();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || typeof window === "undefined") {
      return;
    }
    if (networkToken) {
      networkReceipts.delete(postId);
      networkReceipts.set(postId, { networkSource, networkToken });
      if (networkReceipts.size > 500) {
        const oldest = networkReceipts.keys().next().value;
        if (oldest) {
          networkReceipts.delete(oldest);
        }
      }
    }
    const element = containerRef.current;
    let visible = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const session = new EngagementSession((event) => {
      if (!user) {
        return;
      }
      trackRecommendationEvent({
        ...event,
        networkSource,
        networkToken,
        postId,
        requestId,
      });
    });
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
          const path = window.location.pathname;
          if (path === "/" || path === "/gusts") {
            rememberFeedExposure(
              user?.id ?? "guest",
              path === "/gusts" ? "gusts" : "home",
              postId
            );
          }
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
  }, [postId, requestId, user, networkToken, networkSource]);

  return (
    <div className={className} ref={containerRef}>
      {children}
    </div>
  );
}
