"use client";

import {
  feedHeadFreshMs,
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
import { useEffect, useMemo, useState } from "react";

import { useDiscoveryLocale } from "@/hooks/feed/use-discovery-locale";
import { useFeedEvents } from "@/hooks/feed/use-feed-events";
import { useFeedExposures } from "@/hooks/feed/use-feed-exposures";
import { useFeedRecovery } from "@/hooks/feed/use-feed-recovery";
import { useNetworkSettings } from "@/hooks/feed/use-network-settings";
import { useNewContentProbe } from "@/hooks/feed/use-new-content-probe";
import {
  FEED_QUERY_BEHAVIOR,
  markFeedHeadRead,
  readFeedHeadUpdatedAt,
} from "@/lib/posts/feed-cache";
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
  surface: "home" | "explore" = "home",
  mixed = false
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
  const queryKey = useMemo(
    () => [
      following ? "bluesky-following" : "bluesky-discovery",
      mode,
      viewer,
      locale,
      network.scope,
      content,
      "progressive-v9",
      surface,
      ...(mixed ? ["mixed"] : []),
    ],
    [following, mode, viewer, locale, network.scope, content, surface, mixed]
  );
  const recoveryScope = JSON.stringify(queryKey);
  const [recovery, setRecovery] = useState<{
    pageStatus?: DiscoveryPage["sourceStatus"];
    scope: string;
    retryAt: number;
  }>();
  const query = useInfiniteQuery({
    ...FEED_QUERY_BEHAVIOR,
    enabled: enabled && ready && network.ready,
    getNextPageParam: (
      lastPage: DiscoveryPage & Partial<ProgressiveDiscoveryPage>
    ) => {
      if (lastPage.sourceStatus) {
        return;
      }
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
        mixed,
        mode,
        profile,
        signal: mixed
          ? AbortSignal.any([signal, AbortSignal.timeout(10_000)])
          : signal,
        surface,
      };
      const rememberHead = (
        page: DiscoveryPage & Partial<ProgressiveDiscoveryPage>
      ) => {
        if (
          pageParam.level === 0 &&
          !pageParam.cursor &&
          !page.sourceStatus &&
          !signal.aborted
        ) {
          markFeedHeadRead(queryClient, queryKey);
        }
        return page;
      };
      if (
        !progressive &&
        !pageParam.cursor &&
        content !== "video" &&
        !oppositeSeen.size
      ) {
        return readDiscoveryPage(options).then(rememberHead);
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
      return (
        progressive
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
          : readDiscoveryWindow(options, known)
      ).then(rememberHead);
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
  const failedPage = query.data?.pages.at(-1)?.sourceStatus;
  const retryAt =
    recovery?.scope === recoveryScope && recovery.pageStatus === failedPage
      ? recovery.retryAt
      : failedPage?.retryAt;
  const homeVideo = !following && content === "video" && surface === "home";
  const eventSource = following ? "bluesky-following" : "bluesky";
  const intervalMs = mode === "latest" || following ? 20_000 : 180_000;
  const probe = useNewContentProbe({
    enabled: enabled && network.ready && Boolean(query.data),
    eventMode: following ? undefined : mode,
    eventSource: homeVideo ? undefined : eventSource,
    fetchHead: async (signal, expired) => {
      if (
        (homeVideo && !expired) ||
        (mixed && retryAt && retryAt > Date.now())
      ) {
        return [];
      }
      const head = await readDiscoveryPage({
        content,
        cursor: null,
        following,
        locale,
        mixed,
        mode:
          !expired && !following && mode === "personalized" ? "latest" : mode,
        profile,
        refresh: true,
        signal: AbortSignal.any([signal, AbortSignal.timeout(18_000)]),
        surface,
      });
      if (
        !head.sourceStatus &&
        !signal.aborted &&
        (expired || mode !== "personalized" || following)
      ) {
        markFeedHeadRead(queryClient, queryKey);
      }
      if (mixed) {
        setRecovery({
          pageStatus: failedPage,
          retryAt: head.sourceStatus?.retryAt ?? 0,
          scope: recoveryScope,
        });
        if (!head.sourceStatus) {
          queryClient.setQueryData<
            InfiniteData<DiscoveryPage, DiscoveryPosition>
          >(queryKey, (current) =>
            current &&
            current.pages.length > 1 &&
            current.pages.at(-1)?.sourceStatus
              ? {
                  pageParams: current.pageParams.slice(0, -1),
                  pages: current.pages.slice(0, -1),
                }
              : current
          );
        }
      }
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
    intervalMs: homeVideo ? feedHeadFreshMs : intervalMs,
    order: mode === "latest" ? "newest-first" : "ranked",
    probeOnMount: true,
    readHeadUpdatedAt:
      !following && surface === "home"
        ? () => readFeedHeadUpdatedAt(queryClient, queryKey)
        : undefined,
    resetKey: `${following}:${mode}:${viewer}:${locale}:${network.scope}:${content}:${surface}`,
    visible: query.data?.pages.flatMap((page) => page.items) ?? [],
  });
  const { refetch } = query;
  const { probeNow } = probe;
  const initialPage = (query.data?.pages.length ?? 0) <= 1;
  useEffect(() => {
    if (!enabled || !retryAt || !mixed) {
      return;
    }
    const timer = setTimeout(
      () => {
        if (initialPage) {
          setRecovery(undefined);
          void refetch();
        } else {
          void probeNow();
        }
      },
      Math.max(1000, retryAt - Date.now())
    );
    return () => clearTimeout(timer);
  }, [enabled, initialPage, mixed, probeNow, refetch, retryAt]);
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
    sourceDeferred: Boolean(mixed && retryAt),
  };
}
