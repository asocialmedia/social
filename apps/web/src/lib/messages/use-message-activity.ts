"use client";

import { useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

// React Compiler cannot lower `throw` inside a hook's try block, so the status check
// lives out here and the hook only awaits it.
function openActivityStream(response: Response): ReadableStream<Uint8Array> {
  if (!response.ok || !response.body) {
    throw new Error(`Activity stream returned ${response.status}`);
  }
  return response.body;
}

// Listens for "a message landed in one of your conversations" and calls back.
//
// The transcript has its own per-conversation stream (`useMessagesRealtime`); this
// is the list's, and it exists because the list is about the conversations nobody
// has open. It carries only the conversation id, so the response is to re-read the
// list rather than to render anything.
//
// Deliberately does NOT fall back to polling on its own: the list already has a
// slow refetch interval, and that is the right amount of redundancy. A second
// timer here would be the same polling wearing a different name.
//
// Reconnects with backoff, and a failed connect is not fatal -- Redis may be down,
// which the app tolerates everywhere else ("failing open"), and the interval picks
// up the slack.
export function useMessageActivity(onActivity: () => void): void {
  const { user } = useSession();
  const userId = user?.id;

  // Kept in a ref so a new callback identity (a re-render) does not tear the stream
  // down and reconnect it.
  const onActivityRef = useRef(onActivity);
  useEffect(() => {
    onActivityRef.current = onActivity;
  }, [onActivity]);

  useEffect(() => {
    if (!userId || typeof window === "undefined") {
      return;
    }

    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = INITIAL_RETRY_MS;

    const connect = async () => {
      controller = new AbortController();
      try {
        const response = await fetch("/api/messages/events", {
          credentials: "same-origin",
          signal: controller.signal,
        });
        // Throws from the helper, not from here: the compiler cannot lower a
        // `throw` statement inside this try.
        const body = openActivityStream(response);
        // The server answered, so back off from the top again if it drops later.
        retryDelay = INITIAL_RETRY_MS;

        const reader = body.getReader();
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
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            // `connected` and the keep-alive comments carry nothing to act on;
            // only the activity frame re-reads the list.
            if (frame.includes("event: message-activity")) {
              onActivityRef.current();
            }
            boundary = buffer.indexOf("\n\n");
          }
        }
      } catch {
        // A dropped or refused stream is normal (a reload, a proxy timeout, Redis
        // down). The backoff below reconnects; the list's interval covers the gap.
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
  }, [userId]);
}
