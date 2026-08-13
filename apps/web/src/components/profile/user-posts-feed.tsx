"use client";

import type { PostsPage } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Separator } from "@asm/ui/shadui/separator";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, PenLine } from "lucide-react";
import Link from "next/link";
import React, { useCallback, useMemo } from "react";
import PostCard from "@/components/home/feedview/post-card";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import PostsOnlyLoadingSkeleton from "@/components/layouts/skeletons/post-only-loading-skeleton";
import kyInstance from "@/lib/ky";
import EmptyFeedState from "./empty-feed-state";
import FeedCaughtUp from "./feed-caught-up";

interface UserPostsFeedProps {
  filter?: "all" | "media";
  isOwnProfile?: boolean;
  userId: string;
}

const UserPostsFeed: React.FC<UserPostsFeedProps> = ({
  userId,
  filter = "all",
  isOwnProfile = false,
}) => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ["post-feed", "user-posts", userId, filter],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          `/api/users/${userId}/posts`,
          pageParam
            ? { searchParams: { cursor: pageParam, filter } }
            : { searchParams: { filter } }
        )
        .json<PostsPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 1000 * 60,
  });

  const posts = useMemo(
    () => data?.pages.flatMap((page) => page.posts) || [],
    [data?.pages]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  if (status === "pending") {
    return <PostsOnlyLoadingSkeleton />;
  }

  if (status === "error") {
    return (
      <p className="text-center text-destructive">
        An error occurred while loading posts.
      </p>
    );
  }

  if (status === "success" && !posts.length) {
    if (filter === "media") {
      return (
        <EmptyFeedState
          description="Photos, videos and files from this profile's posts will show up here."
          title="No media posts yet"
        />
      );
    }

    return (
      <EmptyFeedState
        action={
          isOwnProfile ? (
            <Button asChild variant="premium">
              <Link href="/compose">
                <PenLine className="mr-1.5 size-4" />
                Create a post
              </Link>
            </Button>
          ) : undefined
        }
        description="Share something to get the conversation started."
        title="No posts yet"
      />
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      {posts.map((post, index) => (
        <React.Fragment key={post.id}>
          {index > 0 && <Separator className="bg-border/60" />}
          <PostCard isJoined post={post} />
        </React.Fragment>
      ))}
      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-primary" />
        </div>
      ) : null}
      {!hasNextPage && posts.length > 0 ? (
        <FeedCaughtUp
          note={
            filter === "media"
              ? "You've seen all the media from this profile."
              : "You've seen every post from this profile."
          }
        />
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserPostsFeed);
