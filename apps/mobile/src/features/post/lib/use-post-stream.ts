// Live comment and response streams for a post.
//
// Web opens an SSE connection per stream and applies count deltas to its query
// caches as events arrive, so a reader watching a thread sees a new eddie
// without polling and the post's comment count moves with it. This is that
// path: one reader from lib/sse-stream, pointed at the comments or responses
// endpoint, with the created/deleted deltas handed back to the caller.
//
// The existing interval poll is left in place by the caller as a fallback.
// The stream and the poll are not mutually exclusive, and a dropped
// connection re-reads the page anyway, so the two cannot disagree.

import { useEffect, useRef, useState } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { logInfo, logWarn } from "@/lib/lifecycle/telemetry";
import { getApiBaseUrl } from "@/lib/network/api-env";
import type { SseStatus } from "@/lib/network/sse-stream";
import { readSseStream } from "@/lib/network/sse-stream";

import { StreamRegistry } from "./post-stream-registry";

export type PostStreamKind = "comments" | "responses";

/** A created or deleted item, with the post it belongs to. */
export interface PostStreamEvent {
  kind: "created" | "deleted";
  payload: unknown;
  postId: string;
}

function eventNameFor(kind: PostStreamKind): string {
  return kind === "comments" ? "comment" : "response";
}

function isStreamEvent(value: unknown): value is {
  kind: string;
  postId: string;
  [key: string]: unknown;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { kind?: unknown; postId?: unknown };
  return (
    typeof candidate.kind === "string" && typeof candidate.postId === "string"
  );
}

/**
 * Subscribes to one of a post's streams. `onEvent` fires for each created or
 * deleted item; `onCountDelta` carries the same signal as a number so the
 * caller can keep its comment count honest without re-reading the post.
 *
 * Connections are shared per post+kind (web's CommentsRealtimeProvider
 * contract): a feed card and the open detail page for the same post hold one
 * SSE reader with refcounted subscribers, not two. The shared reader keeps
 * the generic 1s->30s backoff from lib/sse-stream, and guests never connect
 * (the endpoint is auth-gated and stops on 401), so guest threads stay
 * poll-only like web.
 */
interface StreamSubscriber {
  onCountDelta?: (delta: number, postId: string) => void;
  onEvent: (event: PostStreamEvent) => void;
  setStatus: (status: SseStatus) => void;
}

const sharedStreams = new StreamRegistry<StreamSubscriber>();

function streamKey(kind: PostStreamKind, postId: string): string {
  return `${kind}:${postId}`;
}

export function usePostStream({
  enabled = true,
  kind,
  onCountDelta,
  onEvent,
  postId,
}: {
  enabled?: boolean;
  kind: PostStreamKind;
  onCountDelta?: (delta: number, postId: string) => void;
  onEvent: (event: PostStreamEvent) => void;
  postId: string;
}): SseStatus {
  const [status, setStatus] = useState<SseStatus>("closed");
  // Mirrored into refs inside an effect so a caller passing inline closures
  // does not tear the connection down and rebuild it on every render. Writing
  // a ref during render is what this avoids: the effect runs after commit, so
  // the stream always calls the latest closure without re-subscribing.
  const onCountDeltaRef = useRef(onCountDelta);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onCountDeltaRef.current = onCountDelta;
    onEventRef.current = onEvent;
  }, [onCountDelta, onEvent]);

  useEffect(() => {
    if (!enabled || !postId) {
      return;
    }
    const key = streamKey(kind, postId);
    const {
      controller,
      created: opened,
      subscribers,
    } = sharedStreams.acquire(key);
    if (opened) {
      const run = async () => {
        // Read the cookie per attempt, not once: reconnect backoff reuses
        // the same URL string, and a rotated session must heal the stream
        // instead of 401-looping on a stale credential until closed.
        const url = `${getApiBaseUrl().replace(/\/+$/, "")}/api/posts/${encodeURIComponent(postId)}/${kind}/stream`;
        await readSseStream({
          eventName: eventNameFor(kind),
          getCookie: () => authClient.getCookie(),
          onEvent: (_event, data) => {
            if (!isStreamEvent(data)) {
              return;
            }
            const created = data.kind.endsWith(".created");
            const deleted = data.kind.endsWith(".deleted");
            if (!created && !deleted) {
              return;
            }
            // The item rides under a kind-specific key: responses on
            // "response", comments on "comment".
            let payload: unknown = null;
            if (kind === "responses" && "response" in data) {
              payload = data.response;
            } else if (kind === "comments" && "comment" in data) {
              payload = data.comment;
            }
            if (!payload) {
              return;
            }
            for (const subscriber of subscribers) {
              subscriber.onEvent({
                kind: created ? "created" : "deleted",
                payload,
                postId: data.postId,
              });
              subscriber.onCountDelta?.(created ? 1 : -1, data.postId);
            }
            logInfo("post_stream.event", {
              item: created ? "created" : "deleted",
              kind,
              postId: data.postId,
            });
          },
          onStatusChange: (next) => {
            for (const subscriber of subscribers) {
              subscriber.setStatus(next);
            }
          },
          signal: controller.signal,
          url,
        });
      };
      void run();
    }
    const subscriber: StreamSubscriber = {
      onCountDelta: (delta, eventPostId) =>
        onCountDeltaRef.current?.(delta, eventPostId),
      onEvent: (event) => onEventRef.current(event),
      setStatus,
    };
    subscribers.add(subscriber);
    return () => {
      sharedStreams.release(key, subscriber);
    };
  }, [enabled, kind, postId]);

  useEffect(() => {
    if (status === "reconnecting") {
      logWarn("post_stream.reconnecting", { kind, postId });
    }
  }, [kind, postId, status]);

  return status;
}
