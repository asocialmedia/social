"use client";

import type { HNApiResponse } from "@asm/aggregator/hackernews";
import { Separator } from "@asm/ui/shadui/separator";
import noSearchImage from "@assets/general/nosearch.png";
import notFoundImage from "@assets/general/notfound.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useMemo } from "react";

import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { useHnBookmarkStates } from "@/hooks/use-hn-bookmark-states";
import kyInstance from "@/lib/ky";

import HnFeedSkeleton from "./hn-feed-skeleton";
import { HNStoryCard } from "./hn-story-card";

export const HN_SORT_OPTIONS = {
  COMMENTS: "comments",
  SCORE: "score",
  TIME: "time",
} as const;

export type HNSortOption =
  (typeof HN_SORT_OPTIONS)[keyof typeof HN_SORT_OPTIONS];

const ITEMS_PER_PAGE = 20;

interface HNFeedProps {
  filter: string;
  search: string;
  sortBy: HNSortOption;
}

export const HNFeed = ({ filter, search, sortBy }: HNFeedProps) => {
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length : undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam }: { pageParam: number }) => {
      const params: Record<string, string | number> = {
        limit: ITEMS_PER_PAGE,
        page: pageParam,
        sort: sortBy,
      };
      if (search.trim()) {
        params.search = search.trim();
      }
      if (filter !== "all") {
        params.type = filter;
      }
      return kyInstance
        .get("/api/hackernews", { searchParams: params })
        .json<HNApiResponse>();
    },
    queryKey: ["hackernews", search, sortBy, filter],
    staleTime: 1000 * 60 * 5,
  });

  const stories = useMemo(
    () => data?.pages.flatMap((page) => page.stories) ?? [],
    [data?.pages]
  );

  const storyIds = useMemo(() => stories.map((story) => story.id), [stories]);
  const { data: bookmarkStates } = useHnBookmarkStates(storyIds);

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  if (status === "pending") {
    return <HnFeedSkeleton />;
  }

  if (status === "error") {
    const isRateLimited =
      (error as { response?: { status?: number } } | null)?.response?.status ===
      429;
    return (
      <div className="flex min-h-full flex-col items-center justify-end gap-3 px-4 pt-10 pb-16 text-center">
        <Image
          alt=""
          className="h-44 w-auto object-contain"
          draggable={false}
          height={1145}
          src={noSearchImage}
          width={1374}
        />
        <p className="text-destructive text-sm sm:text-base">
          {isRateLimited
            ? "Rate limit exceeded. Please try again later."
            : "An error occurred while loading stories."}
        </p>
        <p className="text-muted-foreground/70 text-xs sm:text-sm">
          {isRateLimited
            ? "You're moving too fast — take a breather and try again."
            : "Please try refreshing the page."}
        </p>
      </div>
    );
  }

  if (status === "success" && stories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <Image
          alt=""
          className="h-44 w-auto object-contain"
          draggable={false}
          height={1145}
          src={notFoundImage}
          width={1374}
        />
        <p className="text-base font-semibold">No stories found</p>
        <p className="text-muted-foreground text-sm">
          Try a different search or filter to find more stories.
        </p>
      </div>
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      <div className="flex flex-col">
        {stories.map((story, index) => (
          <div key={story.id}>
            {index > 0 && <Separator className="bg-border/60" />}
            <HNStoryCard
              initialBookmarked={bookmarkStates?.[story.id] ?? false}
              story={story}
            />
          </div>
        ))}
      </div>
      {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
};
