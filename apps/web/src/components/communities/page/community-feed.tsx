"use client";

import type { PostsPage } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Tabs, TabsContent, TabsList } from "@asm/ui/shadui/tabs";
import errorImage from "@assets/general/error.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import { FeedView } from "@/components/home/feed-view";
import { AnimatedTabTrigger } from "@/components/home/feedview/animated-tab-trigger";
import FeedEnd from "@/components/home/feedview/feed-end";
import { FeedScrollbar } from "@/components/layouts/feed/feed-scrollbar";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import EmptyFeedState from "@/components/profile/empty-feed-state";
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

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    status,
  } = useInfiniteQuery({
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
      <EmptyFeedState
        action={
          <Button
            className="h-8 gap-1.5 px-3.5! py-0! text-xs!"
            onClick={() => refetch()}
            variant="premium"
          >
            Try again
          </Button>
        }
        description="Something went wrong loading this community's posts."
        image={errorImage}
        title="Couldn't load posts"
      />
    );
  } else if (posts.length === 0) {
    body = (
      <EmptyFeedState
        description="Be the first to post here."
        title="No posts yet"
      />
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
            className="hide-native-scrollbar h-full overflow-x-hidden overflow-y-auto pb-24 lg:pb-0"
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
