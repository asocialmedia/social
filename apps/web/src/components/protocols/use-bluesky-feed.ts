"use client";

import {
  canRetryRead,
  FeedReadError,
  readDiscoveryPage,
} from "@asm/protocols/discovery";
import type { DiscoveryMode, DiscoveryPage } from "@asm/protocols/discovery";
import { useInfiniteQuery } from "@tanstack/react-query";

export function useBlueskyFeed(
  mode: DiscoveryMode,
  enabled: boolean,
  viewer = "guest"
) {
  return useInfiniteQuery({
    enabled,
    gcTime: 0,
    getNextPageParam: (lastPage: DiscoveryPage) => lastPage.cursor ?? undefined,
    initialPageParam: null as string | null,
    maxPages: 20,
    queryFn: ({ pageParam, signal }): Promise<DiscoveryPage> =>
      readDiscoveryPage({ cursor: pageParam, mode, signal }),
    queryKey: ["bluesky-discovery", mode, viewer],
    refetchInterval: (query) =>
      enabled && canRetryRead(query.state.error)
        ? Math.max(
            30_000,
            query.state.error instanceof FeedReadError
              ? query.state.error.retryAfter
              : 0
          )
        : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: (query) => Boolean(query.state.error),
    retry: false,
    staleTime: Infinity,
  });
}
