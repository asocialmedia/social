// Server-sent events for the two live streams a post detail page needs:
// comments (eddies) and responses.
//
// Both endpoints speak the same protocol, so one reader covers them: a stream
// of `event: <name>` / `data: <json>` frames separated by a blank line, where
// the payload carries a `kind` that says what happened. Web opens these with
// fetch + a ReadableStream reader rather than EventSource because it needs the
// session cookie on the request and a manual abort; the mobile port keeps that
// shape and React Native's fetch has no EventSource either.
//
// Reconnection is exponential from 1s to a 30s ceiling, matching web. The
// parser is exported separately from the reader so the frame splitting - the
// part that is genuinely fiddly, because a frame can straddle two network
// chunks - can be tested without a socket.

export const SSE_INITIAL_RETRY_MS = 1000;
export const SSE_MAX_RETRY_MS = 30_000;

/** One decoded `event:`/`data:` frame. */
export interface SseFrame {
  data: string;
  event: string;
}

/**
 * Pulls every complete frame out of `buffer` and returns whatever tail is
 * still incomplete, so a frame split across two chunks is not lost.
 */
export function drainSseFrames(buffer: string): {
  frames: SseFrame[];
  rest: string;
} {
  const frames: SseFrame[] = [];
  // The SSE spec allows CRLF and some servers send it. Normalizing on the way
  // in means one split and one line scan handle both, rather than the frame
  // terminator silently never matching on a CRLF stream.
  let rest = buffer.replaceAll("\r\n", "\n");
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary === -1) {
      break;
    }
    const raw = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    let event = "message";
    let data: string | null = null;
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        data = line.slice("data:".length).trim();
      }
    }
    if (data !== null) {
      frames.push({ data, event });
    }
  }
  return { frames, rest };
}

export interface SseStreamOptions {
  /** Full URL of the stream endpoint. */
  url: string;
  /** Cookies for the session, sent as a Cookie header. */
  cookie?: string | null;
  /** Called for each frame that parses and passes the name filter. */
  onEvent: (event: string, data: unknown) => void;
  /** Only frames with this `event:` name are delivered. */
  eventName: string;
  baseFetch?: typeof fetch;
  onStatusChange?: (status: SseStatus) => void;
  // Called when the endpoint responds with 401 Unauthorized, halting retries.
  onUnauthorized?: () => void;
  // Aborts the in-flight request and stops reconnecting.
  signal?: AbortSignal;
  // Injected for tests; defaults to the platform timer.
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export type SseStatus = "connecting" | "live" | "reconnecting" | "closed";

// Opens `url` and keeps it open, reporting every frame whose event name
// matches. Resolves when the stream ends and the caller should stop; retries
// with backoff until aborted.
export async function readSseStream({
  baseFetch = fetch,
  clearTimeoutFn = clearTimeout,
  cookie,
  eventName,
  onEvent,
  onStatusChange,
  onUnauthorized,
  setTimeoutFn = setTimeout,
  signal,
  url,
}: SseStreamOptions): Promise<void> {
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let retryDelay = SSE_INITIAL_RETRY_MS;
  let currentStatus: SseStatus | null = null;

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
    const onAbort = () => controller?.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const headers: Record<string, string> = { accept: "text/event-stream" };
      if (cookie) {
        headers.cookie = cookie;
      }
      const response = await baseFetch(url, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        if (response.status === 401) {
          onUnauthorized?.();
          stop();
          return;
        }
        throw new Error(`Stream returned ${response.status}`);
      }
      // A stream that opened is healthy again, so the next drop starts over
      // from the shortest delay rather than the backoff ceiling.
      retryDelay = SSE_INITIAL_RETRY_MS;
      updateStatus("live");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- stream chunks must be read in order
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const drained = drainSseFrames(buffer);
        buffer = drained.rest;
        for (const frame of drained.frames) {
          if (frame.event !== eventName) {
            continue;
          }
          try {
            onEvent(frame.event, JSON.parse(frame.data));
          } catch {
            // A malformed frame must not tear down a stream that is otherwise
            // healthy, so it is dropped and the reader continues.
          }
        }
      }
    } catch {
      if (stopped) {
        return;
      }
      updateStatus("reconnecting");
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    if (stopped) {
      return;
    }
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, SSE_MAX_RETRY_MS);
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
