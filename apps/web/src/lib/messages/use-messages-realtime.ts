"use client";

import { useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";
import type { MessageData } from "@/lib/messages/types";

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

// Decides whether a (re)connect should trigger a catch-up refetch. Guards
// against the fetch-overwrite race that made the transcript look different on
// every open: an in-flight fetch must never be duplicated.
//
// The recent-data age gate applies ONLY to the initial connection, where the
// mount fetch (or a just-folded SSE event for this same stream) already covers
// the window. The stream has no replay cursor, so a genuine reconnect can have
// missed an arbitrary `message.created`/`message.deleted` during the gap -
// no matter how recently the cache was written - and must always reconcile.
// Reconnect catch-up is therefore independent of `dataUpdatedAt`; the in-flight
// guard is what keeps it from stacking a second GET. Pure so the policy is
// unit-tested independently of the stream.
const CATCH_UP_MIN_AGE_MS = 10_000;

export function shouldCatchUp(params: {
  dataUpdatedAt: number;
  isFetching: boolean;
  isReconnect?: boolean;
  minAgeMs?: number;
  now: number;
}): boolean {
  if (params.isFetching) {
    return false;
  }
  if (params.isReconnect) {
    return true;
  }
  if (params.dataUpdatedAt <= 0) {
    return true;
  }
  return (
    params.now - params.dataUpdatedAt >=
    (params.minAgeMs ?? CATCH_UP_MIN_AGE_MS)
  );
}

// Splits one raw SSE frame ("event: x\ndata: y") into its type and payload.
// Pure so the framing edge cases stay unit-testable without a stream.
export function parseServerSentFrame(rawEvent: string): {
  data: string | null;
  eventType: string;
} {
  let eventType = "message";
  let data: string | null = null;

  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data = line.slice("data:".length).trim();
    }
  }

  return { data, eventType };
}

// Returns an `onEvent` callback wired to an SSE connection for a single
// conversation. The caller decides how to fold each event into its query
// cache, so this stays reusable across the thread view and any future UI.
// `onConnect` fires on every (re)connect so the caller can catch up on
// events missed while the stream was down (mobile network drops). It receives
// `isReconnect`, false only for the first greeting of this stream instance, so
// the caller can tell the initial connect (already covered by the mount fetch)
// apart from a real reconnect that may have missed events.
export function useMessagesRealtime(
  conversationId: string,
  onEvent: (event: {
    conversationId: string;
    kind: MessageStreamEvent["kind"];
    message?: MessageData;
    userId?: string;
  }) => void,
  enabled = true,
  onConnect?: (isReconnect: boolean) => void
): { connected: boolean } {
  const { user } = useSession();
  // A stable id keeps the stream effect from tearing down and reconnecting
  // whenever the user object identity changes.
  const userId = user?.id;

  // Keep the latest handlers without reconnecting on every render; the SSE
  // effect below only depends on auth state, the convo id, and enabled.
  const onEventRef = useRef(onEvent);
  const onConnectRef = useRef(onConnect);
  useEffect(() => {
    onEventRef.current = onEvent;
    onConnectRef.current = onConnect;
  }, [onEvent, onConnect]);

  useEffect(() => {
    if (!enabled || !userId || typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = INITIAL_RETRY_MS;
    // First greeting of this stream instance (per conversation + effect run);
    // every later one is a reconnect that may have a delivery gap.
    let hasConnected = false;

    const handleRawEvent = (rawEvent: string) => {
      const { data, eventType } = parseServerSentFrame(rawEvent);

      // The server greets every (re)connect with `event: connected`. It
      // carries no message data, but it is the signal to refetch and catch
      // up on anything published while the stream was down.
      if (eventType === "connected") {
        const isReconnect = hasConnected;
        hasConnected = true;
        onConnectRef.current?.(isReconnect);
        return;
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
      // No invalidation here: the caller folds creates/deletes straight into
      // the query cache, so a refetch per event would just churn the list
      // (and reset decrypt state). Catch-up after a disconnect happens via
      // onConnect instead.
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
  }, [conversationId, enabled, userId]);

  return { connected: enabled && Boolean(user) };
}

function isBenignStreamError(error: unknown): boolean {
  return error instanceof TypeError && error.message.includes("input stream");
}

export type { MessageStreamEvent };
