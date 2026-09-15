"use client";

import type { PostsPage } from "@asm/db";
import { Tabs, TabsContent, TabsList } from "@asm/ui/shadui/tabs";
import { useInfiniteQuery } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { FeedView } from "@/components/home/feed-view";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import FeedEnd from "@/components/home/feedview/feed-end";
import { FeedScrollbar } from "@/components/layouts/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";
import { FEED_QUERY_BEHAVIOR } from "@/lib/posts/feed-cache";

type CommunitySort = "new" | "top";

// The community's own feed. Native posts only, sorted by new or top. Reuses
// the global FeedView so the card, media, voting and comments behave exactly
// as they do everywhere else.
export default function CommunityFeed({ slug }: { slug: string }) {
  const [sort, setSort] = useState<CommunitySort>("new");
  const feedScrollRef = useRef<HTMLDivElement>(null);

  const queryKey = useMemo(() => ["community-feed", slug, sort], [slug, sort]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } =
    useInfiniteQuery({
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        kyInstance
          .get(`/api/communities/${slug}/posts`, {
            searchParams: {
              sort,
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          })
          .json<PostsPage>(),
      queryKey,
      ...FEED_QUERY_BEHAVIOR,
    });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  const handleSortChange = useCallback((value: string) => {
    setSort(value === "top" ? "top" : "new");
  }, []);

  let body: React.ReactNode;
  if (status === "pending") {
    body = <FeedViewSkeleton />;
  } else if (status === "error") {
    body = (
      <p className="text-destructive px-4 py-8 text-center text-sm">
        Couldn&apos;t load this community&apos;s posts.
      </p>
    );
  } else if (posts.length === 0) {
    body = (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-foreground text-sm font-medium">No posts yet</p>
        <p className="text-muted-foreground mt-1 text-xs">
          Be the first to post here.
        </p>
      </div>
    );
  } else {
    body = (
      <InfiniteScrollContainer
        onBottomReached={() =>
          hasNextPage && !isFetchingNextPage && fetchNextPage()
        }
      >
        <FeedView cacheKey={queryKey} posts={posts} sortBy="server" />
        {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
        {hasNextPage ? null : <FeedEnd />}
      </InfiniteScrollContainer>
    );
  }

  return (
    <Tabs
      className="flex min-h-0 flex-1 flex-col"
      onValueChange={handleSortChange}
      value={sort}
    >
      <div className="border-border/60 flex items-center border-b">
        <TabsList className="flex h-full items-center gap-0 bg-transparent p-0">
          <AnimatedTabTrigger
            active={sort === "new"}
            layoutId={`community-tab-${slug}`}
            value="new"
          >
            New
          </AnimatedTabTrigger>
          <AnimatedTabTrigger
            active={sort === "top"}
            layoutId={`community-tab-${slug}`}
            value="top"
          >
            Top
          </AnimatedTabTrigger>
        </TabsList>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="relative h-full">
          <div
            className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto pb-16 lg:pb-0"
            ref={feedScrollRef}
          >
            <TabsContent className="mt-0" value="new">
              {body}
            </TabsContent>
            <TabsContent className="mt-0" value="top">
              {body}
            </TabsContent>
          </div>
          <FeedScrollbar containerRef={feedScrollRef} />
        </div>
      </div>
    </Tabs>
  );
}
