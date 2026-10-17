import type { DiscoveryMode } from "@asm/protocols/discovery";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";

import { createBlueskyFeed } from "../lib/bluesky-feed";
import { subscribeFeedReads } from "../lib/feed-events";

export function useBlueskyFeed(
  mode: DiscoveryMode,
  enabled: boolean,
  viewer?: string
) {
  const store = useMemo(
    () =>
      createBlueskyFeed(getApiBaseUrl(), mode, async (url, init) => {
        const cookie = viewer ? await authClient.getCookie() : null;
        return fetch(url, {
          ...init,
          headers: { "x-asm-client": "mobile", ...(cookie ? { cookie } : {}) },
        });
      }),
    [mode, viewer]
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot
  );
  useEffect(() => {
    if (enabled) {
      store.activate();
    }
    return store.pause;
  }, [enabled, store]);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    return subscribeFeedReads(
      viewer,
      "bluesky",
      async () => {
        await store.recover();
        await store.probe();
      },
      mode
    );
  }, [enabled, mode, store, viewer]);
  useEffect(() => store.dispose, [store]);
  return {
    ...state,
    fetchNext: store.fetchNext,
    hasMore: Boolean(state.pages.at(-1)?.cursor),
    refresh: store.refresh,
  };
}
