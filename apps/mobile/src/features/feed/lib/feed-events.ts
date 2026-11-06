import {
  createFeedReadScheduler,
  feedChangeSchema,
} from "@asm/protocols/discovery";
import type { FeedChange } from "@asm/protocols/discovery";
import { fetch as expoFetch } from "expo/fetch";
import { AppState } from "react-native";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { withAuthHeaders } from "@/lib/network/auth-headers";
import { readSseStream } from "@/lib/network/sse-stream";

const connections = new Map<
  string,
  { listeners: Set<(change: FeedChange) => void>; close: () => void }
>();

export function subscribeFeedEvents(
  viewer: string | undefined,
  listener: (change: FeedChange) => void
) {
  const key = viewer ?? "guest";
  let connection = connections.get(key);
  if (!connection) {
    const listeners = new Set<(change: FeedChange) => void>();
    let controller: AbortController | undefined;
    const sync = () => {
      if (AppState.currentState !== "active") {
        controller?.abort();
        controller = undefined;
      } else if (!controller) {
        controller = new AbortController();
        void readSseStream({
          baseFetch: (url, init) =>
            expoFetch(url, {
              ...init,
              headers: withAuthHeaders(
                { ...init.headers, "x-asm-client": "mobile" },
                init.headers.cookie
              ),
            }),
          eventName: "feed",
          getCookie: () => authClient.getCookie(),
          onEvent: (_event, raw) => {
            const parsed = feedChangeSchema.safeParse(raw);
            if (parsed.success) {
              for (const notify of listeners) {
                notify(parsed.data);
              }
            }
          },
          signal: controller.signal,
          url: `${getApiBaseUrl()}/api/protocols/stream?locale=en`,
        });
      }
    };
    const appState = AppState.addEventListener("change", sync);
    sync();
    connection = {
      close: () => {
        controller?.abort();
        appState.remove();
      },
      listeners,
    };
    connections.set(key, connection);
  }
  connection.listeners.add(listener);
  return () => {
    connection.listeners.delete(listener);
    if (connection.listeners.size === 0) {
      connection.close();
      connections.delete(key);
    }
  };
}

export function subscribeFeedReads(
  viewer: string | undefined,
  source: "asm" | "bluesky" | "bluesky-following",
  read: () => Promise<unknown>,
  mode?: string
) {
  const scheduler = createFeedReadScheduler(read);
  const unsubscribe = subscribeFeedEvents(viewer, (change) => {
    if (
      change.source === "connected" ||
      ((change.source === source ||
        (source === "bluesky" && change.source === "bluesky-following")) &&
        (!mode || !change.mode || change.mode === mode))
    ) {
      scheduler.schedule();
    }
  });
  return () => {
    scheduler.stop();
    unsubscribe();
  };
}
