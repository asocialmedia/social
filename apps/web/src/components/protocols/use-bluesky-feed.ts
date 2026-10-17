"use client";

import {
  canRetryRead,
  FeedReadError,
  readDiscoveryPage,
} from "@asm/protocols/discovery";
import type { DiscoveryMode, DiscoveryPage } from "@asm/protocols/discovery";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";

import { useDiscoveryLocale } from "@/hooks/feed/use-discovery-locale";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import { FEED_QUERY_BEHAVIOR } from "@/lib/posts/feed-cache";
import { useExternalExclusions } from "@/store/feed-source-store";

export function useBlueskyFeed(
  mode: DiscoveryMode,
  enabled: boolean,
  viewer = "guest"
) {
  const queryClient = useQueryClient();
  const excluded = useExternalExclusions(viewer);
  const { locale, ready } = useDiscoveryLocale();
  const queryKey = ["bluesky-discovery", mode, viewer, locale];
  const query = useInfiniteQuery({
    ...FEED_QUERY_BEHAVIOR,
    enabled: enabled && ready,
    getNextPageParam: (lastPage: DiscoveryPage) => lastPage.cursor ?? undefined,
    initialPageParam: null as string | null,
    maxPages: 20,
    queryFn: ({ pageParam, signal }): Promise<DiscoveryPage> =>
      readDiscoveryPage({ cursor: pageParam, locale, mode, signal }),
    queryKey,
    refetchInterval: (state) =>
      enabled && canRetryRead(state.state.error)
        ? Math.max(
            30_000,
            state.state.error instanceof FeedReadError
              ? state.state.error.retryAfter
              : 0
          )
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (state) => Boolean(state.state.error),
    retry: false,
    staleTime: Infinity,
  });
  const probe = useNewContentProbe({
    enabled: enabled && Boolean(query.data),
    fetchHead: async () => {
      const head = await readDiscoveryPage({
        cursor: null,
        locale,
        mode,
        signal: AbortSignal.timeout(18_000),
      });
      return head.items;
    },
    filter: (post) =>
      !excluded.has(`post:${post.id}`) &&
      !excluded.has(`author:${post.author.id}`),
    order: "ranked",
    resetKey: `${mode}:${viewer}:${locale}`,
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
  return { ...query, newItems: probe.newItems, showNewItems };
}
