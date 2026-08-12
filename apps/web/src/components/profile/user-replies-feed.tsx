"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Link2, Loader2 } from "lucide-react";
import Link from "next/link";
import React, { useCallback, useMemo } from "react";
import type { UserRepliesPage } from "@/app/api/users/[userId]/replies/route";
import PostCard from "@/components/home/feedview/post-card";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import CommentsSkeleton from "@/components/layouts/skeletons/comments-skeleton";
import kyInstance from "@/lib/ky";
import { formatRelativeDate } from "@/lib/utils";
import FeedCaughtUp from "./feed-caught-up";

interface UserRepliesFeedProps {
  userId: string;
}

const UserRepliesFeed: React.FC<UserRepliesFeedProps> = ({ userId }) => {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ["post-feed", "user-replies", userId],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          `/api/users/${userId}/replies`,
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<UserRepliesPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 1000 * 60,
  });

  const replies = useMemo(
    () => data?.pages.flatMap((page) => page.replies) || [],
    [data?.pages]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  if (status === "pending") {
    return <CommentsSkeleton />;
  }

  if (status === "error") {
    return (
      <p className="text-center text-destructive">
        An error occurred while loading replies.
      </p>
    );
  }

  if (status === "success" && !replies.length) {
    return (
      <p className="text-center text-muted-foreground">
        No replies yet. Join the conversation!
      </p>
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      {replies.map((reply) => (
        <div className="border-border/60 border-b" key={reply.id}>
          <div className="px-4 pt-4">
            <div className="mb-2 flex items-center gap-1.5 text-muted-foreground text-xs">
              <Link2 className="size-3.5" />
              <span>Replied to</span>
              <Link
                className="font-medium text-primary hover:underline"
                href={`/users/${reply.post.user.username}`}
              >
                @{reply.post.user.username}
              </Link>
              <span>·</span>
              <span>{formatRelativeDate(reply.createdAt)}</span>
            </div>
          </div>

          <PostCard isJoined post={reply.post} />

          <div className="border-border/60 border-t bg-[hsl(var(--background-alt))] px-4 pt-3 pb-4">
            <p className="whitespace-pre-line break-words text-[15px]">
              {reply.content}
            </p>
          </div>
        </div>
      ))}
      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-primary" />
        </div>
      ) : null}
      {!hasNextPage && replies.length > 0 ? (
        <FeedCaughtUp note="You've seen every reply from this profile." />
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserRepliesFeed);
