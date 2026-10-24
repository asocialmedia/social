"use client";

import { feedChangeSchema } from "@asm/protocols/discovery";
import type { FeedChange } from "@asm/protocols/discovery";
import { useEffect, useRef } from "react";

import { useSession } from "@/app/(main)/session-provider";

import { useDiscoveryLocale } from "./use-discovery-locale";

const connections = new Map<
  string,
  { listeners: Set<(change: FeedChange) => void>; close: () => void }
>();

function subscribeFeedEvents(
  locale: string,
  viewer: string,
  listener: (change: FeedChange) => void
) {
  const key = `${locale}:${viewer}`;
  let connection = connections.get(key);
  if (!connection) {
    const listeners = new Set<(change: FeedChange) => void>();
    let stream: EventSource | undefined;
    const sync = () => {
      if (document.visibilityState === "hidden") {
        stream?.close();
        stream = undefined;
      } else if (!stream) {
        stream = new EventSource(
          `/api/protocols/stream?${new URLSearchParams({ locale })}`
        );
        stream.addEventListener("feed", (event: MessageEvent<string>) => {
          try {
            const change = feedChangeSchema.safeParse(JSON.parse(event.data));
            if (change.success) {
              for (const notify of listeners) {
                notify(change.data);
              }
            }
          } catch {
            // Invalid frames never trigger reads.
          }
        });
      }
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    connection = {
      close: () => {
        stream?.close();
        document.removeEventListener("visibilitychange", sync);
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

export function useFeedEvents(
  enabled: boolean,
  onEvent: (change: FeedChange) => void
) {
  const { user } = useSession();
  const { locale, ready } = useDiscoveryLocale();
  const viewer = user?.id ?? "guest";
  const callback = useRef(onEvent);
  useEffect(() => {
    callback.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    if (enabled && ready) {
      return subscribeFeedEvents(locale, viewer, (change) =>
        callback.current(change)
      );
    }
  }, [enabled, locale, ready, viewer]);
}
