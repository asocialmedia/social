import type { DiscoveryMode } from "@asm/protocols/discovery";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { getApiBaseUrl } from "@/lib/api-env";

import { createBlueskyFeed } from "../lib/bluesky-feed";
import { subscribeFeedReads } from "../lib/feed-events";
import { useExternalFollowRevision } from "./use-external-follow";

export function useBlueskyFeed(
  mode: DiscoveryMode,
  enabled: boolean,
  viewer?: string,
  following = false
) {
  const revision = useExternalFollowRevision(
    (state) => state.revisions[viewer ?? "guest"] ?? 0
  );
  const store = useMemo(
    () =>
      createBlueskyFeed(
        getApiBaseUrl(),
        mode,
        async (url, init) => {
          const cookie = viewer ? await authClient.getCookie() : null;
          return fetch(url, {
            ...init,
            headers: {
              "x-asm-client": "mobile",
              ...(cookie ? { cookie } : {}),
            },
          });
        },
        following
      ),
    [mode, viewer, following]
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
      following ? "bluesky-following" : "bluesky",
      async () => {
        await store.recover();
        await store.probe();
      },
      following ? undefined : mode
    );
  }, [enabled, mode, store, viewer, following]);
  useEffect(() => {
    if (enabled && revision > 0) {
      void store.refresh();
    }
  }, [enabled, revision, store]);
  useEffect(() => store.dispose, [store]);
  return {
    ...state,
    fetchNext: store.fetchNext,
    hasMore: Boolean(state.pages.at(-1)?.cursor),
    refresh: store.refresh,
  };
}
