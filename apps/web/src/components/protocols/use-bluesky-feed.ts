"use client";

import {
  readDiscoveryPage,
  readDiscoveryWindow,
  isExternalTrendingPost,
} from "@asm/protocols/discovery";
import type {
  DiscoveryContent,
  DiscoveryMode,
  DiscoveryPage,
} from "@asm/protocols/discovery";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useMemo } from "react";

import { useDiscoveryLocale } from "@/hooks/feed/use-discovery-locale";
import { useFeedEvents } from "@/hooks/feed/use-feed-events";
import { useFeedExposures } from "@/hooks/feed/use-feed-exposures";
import { useFeedRecovery } from "@/hooks/feed/use-feed-recovery";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import { FEED_QUERY_BEHAVIOR } from "@/lib/posts/feed-cache";
import {
  externalNetworkPostAllowed,
  externalNetworkPostRecommended,
} from "@/lib/posts/network-content-policy";
import {
  initialDiscoveryPosition,
  readProgressiveDiscovery,
} from "@/lib/protocols/progressive-discovery";
import type {
  DiscoveryPosition,
  ProgressiveDiscoveryPage,
} from "@/lib/protocols/progressive-discovery";
import { useExternalExclusions } from "@/store/feed-source-store";

const EMPTY_EXPOSURES = new Set<string>();

export function useBlueskyFeed(
  mode: DiscoveryMode,
  enabled: boolean,
  viewer = "guest",
  content: DiscoveryContent = "all",
  following = false,
  surface: "home" | "explore" = "home"
) {
  const queryClient = useQueryClient();
  const excluded = useExternalExclusions(viewer);
  const { locale, ready } = useDiscoveryLocale();
  const network = useNetworkSettings();
  const profile = network.settings.preferences.activeProfileId;
  const progressive = !following && mode !== "latest";
  let exposureSurface: "home" | "gusts" | "explore" =
    content === "video" ? "gusts" : "home";
  if (surface === "explore") {
    exposureSurface = "explore";
  }
  const exposures = useFeedExposures(viewer, exposureSurface, mode);
  const oppositeSeen = mode === "latest" ? EMPTY_EXPOSURES : exposures;
  const queryKey = [
    following ? "bluesky-following" : "bluesky-discovery",
    mode,
    viewer,
    locale,
    network.scope,
    content,
    "progressive-v9",
    surface,
  ];
  const query = useInfiniteQuery({
    ...FEED_QUERY_BEHAVIOR,
    enabled: enabled && ready && network.ready,
    getNextPageParam: (
      lastPage: DiscoveryPage & Partial<ProgressiveDiscoveryPage>
    ) => {
      if (progressive) {
        return lastPage.nextPosition ?? undefined;
      }
      return lastPage.cursor
        ? { ...initialDiscoveryPosition, cursor: lastPage.cursor }
        : undefined;
    },
    initialPageParam: initialDiscoveryPosition as DiscoveryPosition,
    queryFn: ({
      pageParam,
      signal,
    }): Promise<DiscoveryPage & Partial<ProgressiveDiscoveryPage>> => {
      const options = {
        content,
        cursor: pageParam.cursor,
        following,
        locale,
        mode,
        profile,
        signal,
        surface,
      };
      if (
        !progressive &&
        !pageParam.cursor &&
        content !== "video" &&
        !oppositeSeen.size
      ) {
        return readDiscoveryPage(options);
      }
      const current =
        queryClient.getQueryData<
          InfiniteData<DiscoveryPage, DiscoveryPosition>
        >(queryKey);
      const existingPage =
        current?.pageParams.findIndex(
          (position) =>
            position.cursor === pageParam.cursor &&
            position.level === pageParam.level &&
            position.topicPage === pageParam.topicPage
        ) ?? -1;
      const previousPages =
        existingPage >= 0
          ? current?.pages.slice(0, existingPage)
          : current?.pages;
      const known = new Set([
        ...oppositeSeen,
        ...(previousPages?.flatMap((page) =>
          page.items.map((item) => item.id)
        ) ?? []),
      ]);
      return progressive
        ? readProgressiveDiscovery(
            options,
            pageParam,
            known,
            undefined,
            network.settings.preferences.profiles.find(
              (entry) => entry.id === profile
            )?.interests.length
              ? 1
              : 2
          )
        : readDiscoveryWindow(options, known);
    },
    queryKey,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  useFeedRecovery({
    enabled:
      enabled && ready && Boolean(query.data) && Boolean(query.hasNextPage),
    failed: query.isError,
    fetching: query.isFetching,
    resetKey: JSON.stringify(queryKey),
    retry: () => query.fetchNextPage({ cancelRefetch: false }),
    updatedAt: query.dataUpdatedAt,
  });
  useFeedEvents(enabled && ready && (!query.data || query.isError), () => {
    if (query.isError) {
      void (query.data && query.hasNextPage
        ? query.fetchNextPage({ cancelRefetch: false })
        : query.refetch());
    }
  });
  const probe = useNewContentProbe({
    enabled:
      enabled &&
      network.ready &&
      Boolean(query.data) &&
      (following || content !== "video" || surface === "explore"),
    eventMode: following ? undefined : mode,
    eventSource: following ? "bluesky-following" : "bluesky",
    fetchHead: async (signal) => {
      const head = await readDiscoveryPage({
        content,
        cursor: null,
        following,
        locale,
        mode: !following && mode === "personalized" ? "latest" : mode,
        profile,
        refresh: true,
        signal: AbortSignal.any([signal, AbortSignal.timeout(18_000)]),
        surface,
      });
      return head.items;
    },
    filter: (post) =>
      (following || !oppositeSeen.has(post.id)) &&
      !excluded.has(`post:${post.id}`) &&
      !excluded.has(`author:${post.author.id}`) &&
      (mode !== "trending" || isExternalTrendingPost(post)) &&
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
          )),
    intervalMs: mode === "latest" || following ? 20_000 : 180_000,
    order: mode === "latest" ? "newest-first" : "ranked",
    probeOnMount: true,
    resetKey: `${following}:${mode}:${viewer}:${locale}:${network.scope}:${content}:${surface}`,
    visible: query.data?.pages.flatMap((page) => page.items) ?? [],
  });
  const showNewItems = () => {
    queryClient.setQueryData<InfiniteData<DiscoveryPage, string | null>>(
      queryKey,
      (current) => {
        if (!current?.pages.length) {
          return current;
        }
        const known = new Set(
          current.pages.flatMap((page) => page.items.map((item) => item.id))
        );
        const fresh = probe.newItems.filter((item) => !known.has(item.id));
        const [first, ...rest] = current.pages;
        return {
          ...current,
          pages: [{ ...first, items: [...fresh, ...first.items] }, ...rest],
        };
      }
    );
    probe.clearNewItems();
  };
  const data = useMemo(
    () =>
      !following && query.data
        ? {
            ...query.data,
            pages: query.data.pages.map((page) => ({
              ...page,
              items: page.items.filter(
                (item) =>
                  (mode === "latest" || !oppositeSeen.has(item.id)) &&
                  externalNetworkPostAllowed(
                    item,
                    network.settings.preferences,
                    network.settings.topicScope
                  )
              ),
            })),
          }
        : query.data,
    [
      following,
      mode,
      query.data,
      oppositeSeen,
      network.settings.preferences,
      network.settings.topicScope,
    ]
  );
  return {
    ...query,
    data,
    newItems: probe.newItems,
    probeNow: probe.probeNow,
    showNewItems,
  };
}
