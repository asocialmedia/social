import {
  externalNetworkPostAllowed,
  externalNetworkPostRecommended,
} from "@asm/protocols/discovery";
import type { DiscoveryMode } from "@asm/protocols/discovery";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { getApiBaseUrl } from "@/lib/network/api-env";
import { withAuthHeaders } from "@/lib/network/auth-headers";

import type { BlueskyReadContext } from "../lib/bluesky-feed";
import { createBlueskyFeed } from "../lib/bluesky-feed";
import {
  subscribeFeedForeground,
  subscribeFeedReads,
} from "../lib/feed-events";
import { useExternalFollowRevision } from "./use-external-follow";

export function useBlueskyFeed(
  mode: DiscoveryMode,
  enabled: boolean,
  viewer?: string,
  following = false,
  context: Pick<BlueskyReadContext, "content" | "surface" | "mixed"> = {}
) {
  const network = useNetworkSettings();
  const active = enabled && network.ready;
  const { content, mixed, surface } = context;
  const profile = network.settings.preferences.activeProfileId;
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
            headers: withAuthHeaders(
              {
                ...Object.fromEntries(new Headers(init.headers)),
                "x-asm-client": "mobile",
              },
              cookie
            ),
          });
        },
        following,
        {
          content,
          locale: network.locale,
          mixed,
          profile,
          scope: network.scope,
          surface,
        }
      ),
    [
      mode,
      viewer,
      following,
      network.scope,
      network.locale,
      content,
      mixed,
      surface,
      profile,
    ]
  );
  const state = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot
  );
  useEffect(() => {
    if (!active) {
      return;
    }
    store.activate();
    const unsubscribe = subscribeFeedForeground(store.activate);
    return () => {
      unsubscribe();
      store.pause();
    };
  }, [active, store]);
  useEffect(() => {
    if (!active) {
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
  }, [active, mode, store, viewer, following]);
  useEffect(() => {
    if (active && revision > 0) {
      void store.refresh();
    }
  }, [active, revision, store]);
  const retryAt = state.sourceStatus?.retryAt;
  useEffect(() => {
    if (!active || !retryAt) {
      return;
    }
    const timer = setTimeout(
      () => {
        if (store.snapshot().pages.some((page) => page.items.length)) {
          void store.probe();
        } else {
          void store.refresh();
        }
      },
      Math.max(1000, retryAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [active, retryAt, store]);
  useEffect(() => store.dispose, [store]);
  return {
    ...state,
    acceptNew: store.acceptNew,
    fetchNext: store.fetchNext,
    hasMore: Boolean(state.pages.at(-1)?.cursor),
    newItems: state.newItems.filter(
      (post) =>
        network.ready &&
        (following
          ? externalNetworkPostAllowed(
              post,
              network.settings.preferences,
              network.settings.topicScope
            )
          : externalNetworkPostRecommended(
              post,
              network.settings.preferences,
              undefined,
              network.settings.topicScope
            ))
    ),
    posts: state.pages.flatMap((page) => page.items),
    refresh: store.refresh,
    retry: store.retry,
  };
}
