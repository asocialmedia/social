// Realtime transport for messages: the per-conversation event stream and the
// per-user activity stream, both server-sent events over fetch + a ReadableStream
// reader.
//
// Native callers inject expo/fetch so headers and chunks arrive before the
// response ends. React Native global fetch buffers the entire SSE response -- and it is the same shape web uses, which keeps one frame
// parser for both clients.
//
// TWO DELIBERATE DIFFERENCES FROM THE SHARED @/lib/sse-stream READER:
// 1. Backoff resets only on the server's `connected` greeting, not on a
//    successful HTTP open. A stream can return 200 and then drop every few
//    seconds; resetting on the open would hammer the endpoint at 1s forever. The
//    greeting is the signal that the subscription is actually live.
// 2. Every frame is delivered, not just one event name, because a conversation
//    stream multiplexes seven event kinds over the same `message` event name and
//    filters in `parseMessageEvent`.

import { withAuthHeaders } from "@/lib/auth-headers";
import { drainSseFrames } from "@/lib/sse-stream";
import type { SseStatus } from "@/lib/sse-stream";

export const MESSAGES_INITIAL_RETRY_MS = 1000;
export const MESSAGES_MAX_RETRY_MS = 30_000;
export const MESSAGES_STREAM_IDLE_MS = 45_000;

export interface MessageStreamEvent {
  conversationId: string;
  deliveredAt?: string;
  kind:
    | "conversation.delivered"
    | "conversation.read"
    | "keys.rotated"
    | "message.created"
    | "message.deleted"
    | "message.edited"
    | "typing.started";
  message?: unknown;
  readAt?: string;
  userId?: string;
}

// Mirrors the @asm/db helper server-side. Kept client-side so the bundle never
// drags in the server-only DB package, and validated here because the frame is
// whatever the server last published.
export function parseMessageEvent(raw: string): MessageStreamEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MessageStreamEvent>;
    if (
      parsed.kind !== "message.created" &&
      parsed.kind !== "message.deleted" &&
      parsed.kind !== "message.edited" &&
      parsed.kind !== "conversation.read" &&
      parsed.kind !== "conversation.delivered" &&
      parsed.kind !== "typing.started" &&
      parsed.kind !== "keys.rotated"
    ) {
      return null;
    }
    if (typeof parsed.conversationId !== "string") {
      return null;
    }
    if (
      (parsed.kind === "message.created" ||
        parsed.kind === "message.deleted" ||
        parsed.kind === "message.edited") &&
      parsed.message === undefined
    ) {
      return null;
    }
    if (parsed.kind === "typing.started" && typeof parsed.userId !== "string") {
      return null;
    }
    if (
      parsed.kind === "conversation.delivered" &&
      (typeof parsed.userId !== "string" ||
        typeof parsed.deliveredAt !== "string")
    ) {
      return null;
    }
    if (
      parsed.kind === "conversation.read" &&
      (typeof parsed.userId !== "string" || typeof parsed.readAt !== "string")
    ) {
      return null;
    }
    return {
      conversationId: parsed.conversationId,
      deliveredAt: parsed.deliveredAt,
      kind: parsed.kind,
      message: parsed.message,
      readAt: parsed.readAt,
      userId: parsed.userId,
    };
  } catch {
    return null;
  }
}

export interface MessageActivityEvent {
  conversationId: string;
  kind: string;
}

export function parseMessageActivity(raw: string): MessageActivityEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MessageActivityEvent>;
    if (
      typeof parsed.conversationId !== "string" ||
      typeof parsed.kind !== "string"
    ) {
      return null;
    }
    return { conversationId: parsed.conversationId, kind: parsed.kind };
  } catch {
    return null;
  }
}

// Decides whether a (re)connect should trigger a catch-up refetch. Guards against
// the fetch-overwrite race that made a transcript look different on every open: an
// in-flight fetch must never be duplicated.
//
// The recent-data age gate applies ONLY to the initial connection, where the mount
// fetch already covers the window. The stream has no replay cursor, so a genuine
// reconnect can have missed an arbitrary message.created/deleted during the gap --
// and on mobile that gap is a tunnel, not a hypothetical. Reconnect catch-up is
// therefore independent of data age; the in-flight guard is what keeps it from
// stacking a second GET.
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

// Split out so the reconnect loop stays a plain loop and the "is this really
// connected" question stays testable without a socket.
export interface MessageStreamCallbacks {
  onEvent: (event: MessageStreamEvent) => void;
  // Fires once per live subscription, so the caller can catch up on events missed
  // while the stream was down. `isReconnect` is false only for the first greeting.
  onConnect?: (isReconnect: boolean) => void;
  onStatusChange?: (status: SseStatus) => void;
  onUnauthorized?: () => void;
}

export type MessageStreamFetch = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal }
) => Promise<Pick<Response, "status" | "ok" | "body" | "headers">>;

export interface MessageStreamOptions extends MessageStreamCallbacks {
  url: string;
  cookie?: string | null;
  baseFetch?: MessageStreamFetch;
  signal?: AbortSignal;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export async function readMessageStream({
  baseFetch = fetch,
  clearTimeoutFn = clearTimeout,
  cookie,
  onConnect,
  onEvent,
  onStatusChange,
  onUnauthorized,
  setTimeoutFn = setTimeout,
  signal,
  url,
}: MessageStreamOptions): Promise<void> {
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = MESSAGES_INITIAL_RETRY_MS;
  let currentStatus: SseStatus | null = null;
  let connectedOnce = false;

  const updateStatus = (next: SseStatus) => {
    if (currentStatus === next) {
      return;
    }
    currentStatus = next;
    onStatusChange?.(next);
  };

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    controller?.abort();
    if (idleTimer !== null) {
      clearTimeoutFn(idleTimer);
    }
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer);
    }
    updateStatus("closed");
  };

  const connect = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    updateStatus("connecting");
    controller = new AbortController();
    const connection = controller;
    const watchConnection = () => {
      if (idleTimer !== null) {
        clearTimeoutFn(idleTimer);
      }
      idleTimer = setTimeoutFn(
        () => connection.abort(),
        MESSAGES_STREAM_IDLE_MS
      );
    };
    watchConnection();
    const onAbort = () => controller?.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const headers = withAuthHeaders(
        { accept: "text/event-stream", "x-asm-client": "mobile" },
        cookie
      );
      const response = await baseFetch(url, {
        headers,
        signal: controller.signal,
      });
      if (response.status === 401) {
        onUnauthorized?.();
        stop();
        return;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          retryDelay = Math.max(retryDelay, retryAfter * 1000);
        }
      }
      if (!response.ok || !response.body) {
        throw new Error(`Message stream returned ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- stream chunks must be read in order
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        watchConnection();
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 262_144) {
          throw new Error("Message stream frame is too large");
        }
        const drained = drainSseFrames(buffer);
        buffer = drained.rest;
        for (const frame of drained.frames) {
          // The greeting is the only proof the subscription is live, so it -- and
          // only it -- resets the backoff.
          if (frame.event === "connected") {
            retryDelay = MESSAGES_INITIAL_RETRY_MS;
            updateStatus("live");
            onConnect?.(connectedOnce);
            connectedOnce = true;
            continue;
          }
          if (frame.event !== "message") {
            continue;
          }
          const parsed = parseMessageEvent(frame.data);
          if (parsed) {
            onEvent(parsed);
          }
        }
      }
    } catch {
      if (stopped) {
        return;
      }
      updateStatus("reconnecting");
    } finally {
      if (idleTimer !== null) {
        clearTimeoutFn(idleTimer);
        idleTimer = null;
      }
      signal?.removeEventListener("abort", onAbort);
    }

    if (stopped) {
      return;
    }
    updateStatus("reconnecting");
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, MESSAGES_MAX_RETRY_MS);
    retryTimer = setTimeoutFn(() => {
      void connect();
    }, delay);
  };

  if (signal) {
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
  }

  await connect();
  if (stopped) {
    updateStatus("closed");
  }
}

// The per-user activity stream runs on `message-activity` and exists only to tell
// the conversation list to refetch. Same reader, different event name and parser.
export async function readMessageActivityStream(options: {
  url: string;
  cookie?: string | null;
  baseFetch?: MessageStreamFetch;
  onActivity: (event: MessageActivityEvent) => void;
  onConnect?: (isReconnect: boolean) => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  onStatusChange?: (status: SseStatus) => void;
  onUnauthorized?: () => void;
  signal?: AbortSignal;
}): Promise<void> {
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let connectedOnce = false;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = MESSAGES_INITIAL_RETRY_MS;
  let currentStatus: SseStatus | null = null;

  const updateStatus = (next: SseStatus) => {
    if (currentStatus === next) {
      return;
    }
    currentStatus = next;
    options.onStatusChange?.(next);
  };

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    controller?.abort();
    if (idleTimer !== null) {
      clearTimeoutFn(idleTimer);
    }
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer);
    }
    updateStatus("closed");
  };

  const connect = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    updateStatus("connecting");
    controller = new AbortController();
    const connection = controller;
    const watchConnection = () => {
      if (idleTimer !== null) {
        clearTimeoutFn(idleTimer);
      }
      idleTimer = setTimeoutFn(
        () => connection.abort(),
        MESSAGES_STREAM_IDLE_MS
      );
    };
    watchConnection();
    const onAbort = () => controller?.abort();
    options.signal?.addEventListener("abort", onAbort);
    try {
      const headers = withAuthHeaders(
        { accept: "text/event-stream", "x-asm-client": "mobile" },
        options.cookie
      );
      const response = await (options.baseFetch ?? fetch)(options.url, {
        headers,
        signal: controller.signal,
      });
      if (response.status === 401) {
        options.onUnauthorized?.();
        stop();
        return;
      }
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) {
          retryDelay = Math.max(retryDelay, retryAfter * 1000);
        }
      }
      if (!response.ok || !response.body) {
        throw new Error(`Activity stream returned ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- stream chunks must be read in order
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        watchConnection();
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 262_144) {
          throw new Error("Activity stream frame is too large");
        }
        const drained = drainSseFrames(buffer);
        buffer = drained.rest;
        for (const frame of drained.frames) {
          if (frame.event === "connected") {
            retryDelay = MESSAGES_INITIAL_RETRY_MS;
            updateStatus("live");
            options.onConnect?.(connectedOnce);
            connectedOnce = true;
            continue;
          }
          if (frame.event !== "message-activity") {
            continue;
          }
          const parsed = parseMessageActivity(frame.data);
          if (parsed) {
            options.onActivity(parsed);
          }
        }
      }
    } catch {
      if (stopped) {
        return;
      }
      updateStatus("reconnecting");
    } finally {
      if (idleTimer !== null) {
        clearTimeoutFn(idleTimer);
        idleTimer = null;
      }
      options.signal?.removeEventListener("abort", onAbort);
    }

    if (stopped) {
      return;
    }
    updateStatus("reconnecting");
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, MESSAGES_MAX_RETRY_MS);
    retryTimer = setTimeoutFn(() => {
      void connect();
    }, delay);
  };

  if (options.signal) {
    if (options.signal.aborted) {
      stop();
      return;
    }
    options.signal.addEventListener("abort", stop, { once: true });
  }

  await connect();
  if (stopped) {
    updateStatus("closed");
  }
}
