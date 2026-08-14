"use client";

import type { CommentData } from "@asm/db";
import { useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryKey } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo } from "react";

import { useSession } from "@/app/(main)/session-provider";

// Realtime comments never live inside a single fetched page (a page could be
// refetched or the reply could target a thread that is still loading), so they
// are accumulated in a component-level map that the comments query's `select`
// merges over the server pages on every render. Deduping by id keeps a comment
// that arrives both optimistically and over the stream from showing twice.
export type LiveCommentStore = Map<string, CommentData>;

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

interface CommentStreamEvent {
  kind: "comment.created" | "comment.deleted";
  postId: string;
  comment: unknown;
}

// Kept client-side (mirrors the @asm/db helper) so the browser bundle never
// drags in the server-only DB package. The server serializes events with the
// same shape.
function parseCommentEvent(raw: string): CommentStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CommentStreamEvent>;
    if (
      parsed.kind !== "comment.created" &&
      parsed.kind !== "comment.deleted"
    ) {
      return null;
    }
    if (typeof parsed.postId !== "string" || parsed.comment === undefined) {
      return null;
    }
    return {
      comment: parsed.comment,
      kind: parsed.kind,
      postId: parsed.postId,
    };
  } catch {
    return null;
  }
}

function reviveDates(_key: string, value: unknown): unknown {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
  ) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return value;
}

export interface UseCommentsRealtimeReturn {
  applyCreated: (comment: CommentData) => void;
  applyDeleted: (comment: CommentData) => void;
}

export function useCommentsRealtime(
  postId: string,
  liveStore: MutableRefObject<LiveCommentStore>,
  enabled = true
): UseCommentsRealtimeReturn {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const queryKey: QueryKey = useMemo(() => ["comments", postId], [postId]);

  // Notify the query that its backing data changed so `select` re-runs and
  // folds the live store back over the (possibly refetched) server pages.
  const notify = useCallback(() => {
    queryClient.setQueryData<InfiniteData<unknown, string | null>>(
      queryKey,
      (oldData) => (oldData ? { ...oldData } : oldData)
    );
  }, [queryClient, queryKey]);

  // The write handlers are stable (they only close over the live store ref and
  // notify), so they can live in the stream effect's deps without reconnecting
  // the SSE connection on every render.
  const applyCreated = useCallback(
    (comment: CommentData) => {
      liveStore.current.set(comment.id, comment);
      notify();
    },
    [liveStore, notify]
  );

  const applyDeleted = useCallback(
    (comment: CommentData) => {
      const existing = liveStore.current.get(comment.id);
      if (existing) {
        liveStore.current.set(comment.id, {
          ...existing,
          content: "",
          deleted: true,
        });
      } else {
        liveStore.current.set(comment.id, {
          ...comment,
          content: "",
          deleted: true,
        });
      }
      notify();
    },
    [liveStore, notify]
  );

  useEffect(() => {
    // The stream endpoint requires an authenticated session; guests fall back
    // to plain polling of the comments list. When disabled, the caller already
    // has a shared connection for this post (e.g. the comments list inside the
    // post page provider) so this instance only supplies the write path.
    if (!enabled || !user || typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = INITIAL_RETRY_MS;

    const handleRawEvent = (rawEvent: string) => {
      let eventType = "message";
      let data: string | null = null;

      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) {
          eventType = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          data = line.slice("data:".length).trim();
        }
        // Lines starting with ":" are keep-alive comments; ignore them.
      }

      if (!data || eventType !== "comment") {
        return;
      }

      const event = parseCommentEvent(data);
      if (!event) {
        return;
      }

      const comment = JSON.parse(
        JSON.stringify(event.comment),
        reviveDates
      ) as CommentData;

      if (event.kind === "comment.created") {
        applyCreated(comment);
      } else if (event.kind === "comment.deleted") {
        applyDeleted(comment);
      }
    };

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/posts/${postId}/comments/stream`, {
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Comment stream returned ${response.status}`);
        }

        retryDelay = INITIAL_RETRY_MS;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          // oxlint-disable-next-line no-await-in-loop -- stream chunks must be read sequentially
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const rawEvent = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            handleRawEvent(rawEvent);
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Comment stream disconnected:", error);
      }

      if (!cancelled) {
        retryTimer = setTimeout(() => {
          void connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [
    postId,
    queryClient,
    queryKey,
    user,
    enabled,
    applyCreated,
    applyDeleted,
  ]);

  return { applyCreated, applyDeleted };
}
