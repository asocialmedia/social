"use client";

import type { MessageData } from "@asm/db";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

interface MessageStreamEvent {
  kind:
    | "message.created"
    | "message.deleted"
    | "conversation.read"
    | "typing.started";
  conversationId: string;
  message?: unknown;
  userId?: string;
}

// Kept client-side (mirrors the @asm/db helper) so the browser bundle never
// drags in the server-only DB package.
function parseMessageEvent(raw: string): MessageStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MessageStreamEvent>;
    if (
      parsed.kind !== "message.created" &&
      parsed.kind !== "message.deleted" &&
      parsed.kind !== "conversation.read" &&
      parsed.kind !== "typing.started"
    ) {
      return null;
    }
    if (typeof parsed.conversationId !== "string") {
      return null;
    }
    if (
      (parsed.kind === "message.created" ||
        parsed.kind === "message.deleted") &&
      parsed.message === undefined
    ) {
      return null;
    }
    if (parsed.kind === "typing.started" && typeof parsed.userId !== "string") {
      return null;
    }
    return {
      conversationId: parsed.conversationId,
      kind: parsed.kind,
      message: parsed.message,
      userId: parsed.userId,
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

// React Compiler cannot lower `throw` statements inside hook try blocks, so
// the stream status check lives in this module-scoped helper.
function openMessageStream(response: Response): ReadableStream<Uint8Array> {
  if (!response.ok || !response.body) {
    throw new Error(`Message stream returned ${response.status}`);
  }
  return response.body;
}

// Returns an `onEvent` callback wired to an SSE connection for a single
// conversation. The caller decides how to fold each event into its query
// cache, so this stays reusable across the thread view and any future UI.
export function useMessagesRealtime(
  conversationId: string,
  onEvent: (event: {
    conversationId: string;
    kind: MessageStreamEvent["kind"];
    message?: MessageData;
    userId?: string;
  }) => void,
  enabled = true
): { connected: boolean } {
  const queryClient = useQueryClient();
  const { user } = useSession();
  // A stable id keeps the stream effect from tearing down and reconnecting
  // whenever the user object identity changes.
  const userId = user?.id;

  // Keep the latest handler without reconnecting on every render; the SSE
  // effect below only depends on auth state, the convo id, and enabled.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || !userId || typeof window === "undefined") {
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

      if (!data || eventType !== "message") {
        return;
      }

      const event = parseMessageEvent(data);
      if (!event) {
        return;
      }

      if (event.conversationId !== conversationId) {
        return;
      }

      const message = event.message
        ? (JSON.parse(
            JSON.stringify(event.message),
            reviveDates
          ) as MessageData)
        : undefined;

      onEventRef.current({
        conversationId: event.conversationId,
        kind: event.kind,
        message,
        userId: event.userId,
      });
      // Only events that actually change the message list (create/delete)
      // invalidate the query; typing and read receipts are handled purely by
      // the event callback and would cause a wasteful refetch.
      if (
        event.kind === "message.created" ||
        event.kind === "message.deleted"
      ) {
        queryClient.invalidateQueries({
          queryKey: ["messages", conversationId],
        });
      }
    };

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch(
          `/api/messages/conversations/${conversationId}/stream`,
          {
            credentials: "same-origin",
            signal: controller.signal,
          }
        );

        retryDelay = INITIAL_RETRY_MS;

        const reader = openMessageStream(response).getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          // oxlint-disable-next-line no-await-in-loop -- stream chunks are sequential
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
        // "Error in input stream" is Chrome's generic message when the fetch
        // stream is reset under us (a dev-server recompile, a proxy timeout,
        // or a network blip). The backoff reconnect below recovers from it, so
        // don't treat it as a real failure.
        if (!isBenignStreamError(error)) {
          console.error("Message stream disconnected:", error);
        }
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
  }, [conversationId, enabled, queryClient, userId]);

  return { connected: enabled && Boolean(user) };
}

function isBenignStreamError(error: unknown): boolean {
  return error instanceof TypeError && error.message.includes("input stream");
}

export type { MessageStreamEvent };
