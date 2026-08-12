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
    <InfiniteScrollContainer
      className="divide-y divide-border/60"
      onBottomReached={handleBottomReached}
    >
      {replies.map((reply) => (
        <div className="px-4 py-4" key={reply.id}>
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

          <div className="mb-2 overflow-hidden rounded-lg border border-border/60 bg-background/50">
            <PostCard post={reply.post} />
          </div>

          <p className="whitespace-pre-line break-words text-[15px]">
            {reply.content}
          </p>
        </div>
      ))}
      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-primary" />
        </div>
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserRepliesFeed);
