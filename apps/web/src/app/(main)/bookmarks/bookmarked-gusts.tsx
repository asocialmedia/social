"use client";

import type { PostsPage } from "@asm/db";
import { Separator } from "@asm/ui/shadui/separator";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Clapperboard } from "lucide-react";
import { Fragment, useCallback } from "react";

import GustRowCard from "@/components/gusts/gust-row-card";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import kyInstance from "@/lib/ky";

const BookmarkedGusts: React.FC = () => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }: { pageParam: string | null }) => {
      const response = await kyInstance
        .get(
          "/api/posts/bookmarked",
          pageParam
            ? { searchParams: { cursor: pageParam, filter: "gusts" } }
            : { searchParams: { filter: "gusts" } }
        )
        .json<PostsPage>();
      return response;
    },
    queryKey: ["post-feed", "bookmarks-gusts"],
  });

  const gustPosts = (data?.pages.flatMap((page) => page.posts) || []).filter(
    Boolean
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetching]);

  if (status === "pending") {
    return <FeedViewSkeleton />;
  }

  if (status === "error") {
    return (
      <p className="text-destructive px-4 py-8 text-center">
        An error occurred while loading bookmarked gusts.
      </p>
    );
  }

  if (gustPosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-16 text-center">
        <Clapperboard className="text-muted-foreground/60 h-6 w-6" />
        <p className="font-medium">No bookmarked gusts yet.</p>
        <p className="text-muted-foreground text-sm">
          Gusts you bookmark will show up here.
        </p>
      </div>
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      {gustPosts.map((post, index) => (
        <Fragment key={post.id}>
          {index > 0 && <Separator className="bg-border/60" />}
          <GustRowCard post={post} />
        </Fragment>
      ))}
      {isFetchingNextPage ? <LoadMoreSkeleton /> : null}
    </InfiniteScrollContainer>
  );
};

export default BookmarkedGusts;
