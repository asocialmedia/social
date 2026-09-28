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
import { getApiBaseUrl } from "@/lib/api-env";
import type { SseStatus } from "@/lib/sse-stream";
import { readSseStream } from "@/lib/sse-stream";
import { logInfo, logWarn } from "@/lib/telemetry";

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
 */
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
    const controller = new AbortController();
    const run = async () => {
      const cookie = await authClient.getCookie();
      const url = `${getApiBaseUrl().replace(/\/+$/, "")}/api/posts/${encodeURIComponent(postId)}/${kind}/stream`;
      await readSseStream({
        cookie,
        eventName: eventNameFor(kind),
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
          onEventRef.current({
            kind: created ? "created" : "deleted",
            payload,
            postId: data.postId,
          });
          onCountDeltaRef.current?.(created ? 1 : -1, data.postId);
          logInfo("post_stream.event", {
            item: created ? "created" : "deleted",
            kind,
            postId: data.postId,
          });
        },
        onStatusChange: setStatus,
        signal: controller.signal,
        url,
      });
    };
    void run();
    return () => {
      controller.abort();
    };
  }, [enabled, kind, postId]);

  useEffect(() => {
    if (status === "reconnecting") {
      logWarn("post_stream.reconnecting", { kind, postId });
    }
  }, [kind, postId, status]);

  return status;
}
