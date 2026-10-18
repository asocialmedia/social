"use client";

import {
  readDiscoveryPage,
  readDiscoveryWindow,
} from "@asm/protocols/discovery";
import type {
  DiscoveryContent,
  DiscoveryMode,
  DiscoveryPage,
} from "@asm/protocols/discovery";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";

import { useDiscoveryLocale } from "@/hooks/feed/use-discovery-locale";
import { useFeedEvents } from "@/hooks/feed/use-feed-events";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import { FEED_QUERY_BEHAVIOR } from "@/lib/posts/feed-cache";
import { externalNetworkPostRecommended } from "@/lib/posts/network-content-policy";
import { useExternalExclusions } from "@/store/feed-source-store";

export function useBlueskyFeed(
  mode: DiscoveryMode,
  enabled: boolean,
  viewer = "guest",
  content: DiscoveryContent = "all"
) {
  const queryClient = useQueryClient();
  const excluded = useExternalExclusions(viewer);
  const { locale, ready } = useDiscoveryLocale();
  const network = useNetworkSettings();
  const profile = network.settings.preferences.activeProfileId;
  const queryKey = [
    "bluesky-discovery",
    mode,
    viewer,
    locale,
    network.scope,
    content,
  ];
  const query = useInfiniteQuery({
    ...FEED_QUERY_BEHAVIOR,
    enabled: enabled && ready && network.ready,
    getNextPageParam: (lastPage: DiscoveryPage) => lastPage.cursor ?? undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }): Promise<DiscoveryPage> => {
      const options = {
        content,
        cursor: pageParam,
        locale,
        mode,
        profile,
        signal,
      };
      if (!pageParam && content !== "video") {
        return readDiscoveryPage(options);
      }
      const current =
        queryClient.getQueryData<InfiniteData<DiscoveryPage>>(queryKey);
      return readDiscoveryWindow(
        options,
        new Set(
          current?.pages.flatMap((page) => page.items.map((item) => item.id))
        )
      );
    },
    queryKey,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  useFeedEvents(enabled && ready && !query.data, () => {
    if (query.isError) {
      void query.refetch();
    }
  });
  const probe = useNewContentProbe({
    enabled: enabled && network.ready && Boolean(query.data),
    eventMode: mode,
    eventSource: "bluesky",
    fetchHead: async (signal) => {
      const head = await readDiscoveryPage({
        content,
        cursor: null,
        locale,
        mode,
        profile,
        signal: AbortSignal.any([signal, AbortSignal.timeout(18_000)]),
      });
      return head.items;
    },
    filter: (post) =>
      !excluded.has(`post:${post.id}`) &&
      !excluded.has(`author:${post.author.id}`) &&
      externalNetworkPostRecommended(
        post,
        network.settings.preferences,
        undefined,
        network.settings.topicScope
      ),
    order: mode === "latest" ? "newest-first" : "ranked",
    probeOnMount: !query.isFetchedAfterMount,
    resetKey: `${mode}:${viewer}:${locale}:${network.scope}:${content}`,
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
  return {
    ...query,
    newItems: probe.newItems,
    probeNow: probe.probeNow,
    showNewItems,
  };
}
