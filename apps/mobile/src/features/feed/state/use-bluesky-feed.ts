import {
  externalNetworkPostAllowed,
  externalNetworkPostRecommended,
} from "@asm/protocols/discovery";
import type { DiscoveryMode } from "@asm/protocols/discovery";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { authClient } from "@/features/auth/lib/auth-client";
import { useNetworkSettings } from "@/features/network/state/use-network-settings";
import { getApiBaseUrl } from "@/lib/api-env";

import type { BlueskyReadContext } from "../lib/bluesky-feed";
import { createBlueskyFeed } from "../lib/bluesky-feed";
import { subscribeFeedReads } from "../lib/feed-events";
import { useExternalFollowRevision } from "./use-external-follow";

export function useBlueskyFeed(
  mode: DiscoveryMode,
  enabled: boolean,
  viewer?: string,
  following = false,
  context: Pick<BlueskyReadContext, "content" | "surface"> = {}
) {
  const network = useNetworkSettings();
  const active = enabled && network.ready;
  const { content, surface } = context;
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
            headers: {
              "x-asm-client": "mobile",
              ...(cookie ? { cookie } : {}),
            },
          });
        },
        following,
        {
          content,
          locale: network.locale,
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
    if (active) {
      store.activate();
    }
    return store.pause;
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
  };
}
