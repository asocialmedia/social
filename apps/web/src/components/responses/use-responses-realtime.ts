"use client";

import type { PostData } from "@asm/db";
import { useQueryClient } from "@tanstack/react-query";
import type { InfiniteData, QueryKey } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo } from "react";

import { useSession } from "@/app/(main)/session-provider";
import { applyResponseCountDeltaToCaches } from "@/lib/posts/cache-sync";

// Realtime responses are accumulated in a component-level map that the
// responses query's `select` merges over the server pages, so a response that
// arrives while a branch is still loading is never dropped. Deduping by id
// keeps the optimistic insert and the streamed event from showing twice.
export type LiveResponseStore = Map<string, PostData>;

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

interface ResponseStreamEvent {
  kind: "response.created" | "response.deleted";
  postId: string;
  response: unknown;
}

// Kept client-side (mirrors the @asm/db helper) so the browser bundle never
// drags in the server-only DB package.
function parseResponseEvent(raw: string): ResponseStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ResponseStreamEvent>;
    if (
      parsed.kind !== "response.created" &&
      parsed.kind !== "response.deleted"
    ) {
      return null;
    }
    if (typeof parsed.postId !== "string" || parsed.response === undefined) {
      return null;
    }
    return {
      kind: parsed.kind,
      postId: parsed.postId,
      response: parsed.response,
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

// React Compiler cannot lower `throw` statements inside hook try blocks, so the
// stream status check lives in this module-scoped helper.
function openResponseStream(response: Response): ReadableStream<Uint8Array> {
  if (!response.ok || !response.body) {
    throw new Error(`Response stream returned ${response.status}`);
  }
  return response.body;
}

export interface UseResponsesRealtimeReturn {
  applyCreated: (response: PostData) => void;
  applyDeleted: (response: PostData) => void;
}

export function useResponsesRealtime(
  postId: string,
  liveStore: MutableRefObject<LiveResponseStore>,
  enabled = true
): UseResponsesRealtimeReturn {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const queryKey: QueryKey = useMemo(() => ["responses", postId], [postId]);

  const notify = useCallback(() => {
    queryClient.setQueryData<InfiniteData<unknown, string | null>>(
      queryKey,
      (oldData) => (oldData ? { ...oldData } : oldData)
    );
  }, [queryClient, queryKey]);

  const applyCreated = useCallback(
    (response: PostData) => {
      liveStore.current.set(response.id, response);
      notify();
    },
    [liveStore, notify]
  );

  // Responses are hard-deleted (unlike eddies), so removal is handled by
  // dropping the row from the live store and letting the query refetch.
  const applyDeleted = useCallback(
    (response: PostData) => {
      liveStore.current.delete(response.id);
      notify();
    },
    [liveStore, notify]
  );

  useEffect(() => {
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
      }

      if (!data || eventType !== "response") {
        return;
      }

      const event = parseResponseEvent(data);
      if (!event) {
        return;
      }

      const response = JSON.parse(
        JSON.stringify(event.response),
        reviveDates
      ) as PostData;

      if (event.kind === "response.created") {
        applyCreated(response);
        applyResponseCountDeltaToCaches(queryClient, event.postId, 1);
      } else if (event.kind === "response.deleted") {
        applyDeleted(response);
        applyResponseCountDeltaToCaches(queryClient, event.postId, -1);
      }
    };

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(`/api/posts/${postId}/responses/stream`, {
          credentials: "same-origin",
          signal: controller.signal,
        });

        retryDelay = INITIAL_RETRY_MS;

        const reader = openResponseStream(response).getReader();
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
        console.error("Response stream disconnected:", error);
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
  }, [postId, queryClient, user, enabled, applyCreated, applyDeleted]);

  return { applyCreated, applyDeleted };
}
