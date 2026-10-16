import type { DiscoveryMode } from "@asm/protocols/discovery";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";
import { createExpoPoller } from "@/lib/expo-poller";

import { createBlueskyFeed } from "../lib/bluesky-feed";

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
    const poller = createExpoPoller({
      intervalMs: 30_000,
      onPoll: store.recover,
    });
    poller.start();
    return () => poller.stop();
  }, [enabled, store]);
  useEffect(() => store.dispose, [store]);
  return {
    ...state,
    fetchNext: store.fetchNext,
    hasMore: Boolean(state.pages.at(-1)?.cursor),
    refresh: store.refresh,
  };
}
