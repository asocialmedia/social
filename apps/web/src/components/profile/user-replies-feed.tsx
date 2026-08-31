"use client";

import type { CommentData } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CornerDownRight, Loader2 } from "lucide-react";
import Link from "next/link";
import React, { useCallback, useMemo, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import type { UserRepliesPage } from "@/app/api/users/[userId]/replies/route";
import { CommentAttachments } from "@/components/comments/comment-attachments";
import { CommentLinkEmbeds } from "@/components/comments/comment-link-embeds";
import CommentMoreButton from "@/components/comments/comment-more-button";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import CommentsSkeleton from "@/components/layouts/skeletons/comments-skeleton";
import UserAvatar from "@/components/layouts/user-avatar";
import AuraVoteButton from "@/components/posts/aura-vote-button";
import Linkify from "@/helpers/global/linkify";
import kyInstance from "@/lib/ky";
import { cn, formatRelativeDate } from "@/lib/utils";

import EmptyFeedState from "./empty-feed-state";
import FeedCaughtUp from "./feed-caught-up";

interface UserRepliesFeedProps {
  userId: string;
}

const UserRepliesFeed: React.FC<UserRepliesFeedProps> = ({ userId }) => {
  const { user: sessionUser } = useSession();
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());

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
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          `/api/users/${userId}/replies`,
          pageParam ? { searchParams: { cursor: pageParam } } : {}
        )
        .json<UserRepliesPage>(),
    queryKey: ["post-feed", "user-replies", userId],
    staleTime: 1000 * 60,
  });

  const replies = useMemo(
    () => data?.pages.flatMap((page) => page.replies) || [],
    [data?.pages]
  );

  const visibleReplies = useMemo(
    () => replies.filter((reply) => !deletedIds.has(reply.id)),
    [deletedIds, replies]
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);

  const handleReplyDeleted = useCallback((deleted: CommentData) => {
    setDeletedIds((prev) => new Set([...prev, deleted.id]));
  }, []);

  if (status === "pending") {
    return <CommentsSkeleton />;
  }

  if (status === "error") {
    return (
      <p className="text-destructive text-center">
        An error occurred while loading replies.
      </p>
    );
  }

  if (status === "success" && !visibleReplies.length) {
    return (
      <EmptyFeedState
        description="When this profile replies to a post, the replies will show up here."
        title="No replies yet"
      />
    );
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      {visibleReplies.map((reply) => {
        const postHref = `/posts/${reply.post.id}?comment=${reply.id}`;
        const repliedToUsername =
          reply.parent?.user?.username ??
          reply.post?.user?.username ??
          "someone";
        const replyUsername = reply.user?.username ?? "unknown";
        const replyDisplayName = reply.user?.displayName || replyUsername;

        return (
          <div className="border-border/60 border-b px-4 py-3" key={reply.id}>
            <div className="flex gap-3">
              <Link
                aria-label={`View @${replyUsername}'s profile`}
                className="shrink-0"
                href={`/users/${replyUsername}`}
              >
                <UserAvatar
                  avatarUrl={reply.user?.avatarUrl}
                  className="size-10"
                />
              </Link>

              <div className="min-w-0 flex-1">
                {/* Header: author + time + own-reply menu */}
                <div className="flex items-center gap-1.5 text-sm">
                  <Link
                    className="text-foreground truncate font-semibold hover:underline"
                    href={`/users/${replyUsername}`}
                  >
                    {replyDisplayName}
                  </Link>
                  <Link
                    className="text-muted-foreground truncate hover:underline"
                    href={`/users/${replyUsername}`}
                  >
                    @{replyUsername}
                  </Link>
                  <span className="text-muted-foreground shrink-0">·</span>
                  <Link
                    className="text-muted-foreground shrink-0 text-xs hover:underline"
                    href={postHref}
                  >
                    {formatRelativeDate(reply.createdAt)}
                  </Link>
                  {sessionUser?.id &&
                  reply.user?.id &&
                  sessionUser.id === reply.user.id ? (
                    <div className="ml-auto shrink-0">
                      <CommentMoreButton
                        applyDeleted={handleReplyDeleted}
                        className="h-7 w-7 rounded-full opacity-0 transition-opacity group-hover/comment:opacity-100 focus-visible:opacity-100"
                        comment={reply}
                      />
                    </div>
                  ) : null}
                </div>

                {/* Reply context + content */}
                <Link
                  className="mt-0.5 block"
                  href={`/users/${repliedToUsername}`}
                >
                  <p className="text-muted-foreground text-xs">
                    Replying to{" "}
                    <span className="text-primary">@{repliedToUsername}</span>
                  </p>
                </Link>
                <Link className="mt-1 block" href={postHref}>
                  <p
                    className={cn(
                      "text-foreground text-[15px] leading-relaxed break-words whitespace-pre-line",
                      reply.deleted && "italic"
                    )}
                  >
                    {reply.deleted ? (
                      "This eddie has been deleted."
                    ) : (
                      <Linkify>{reply.content}</Linkify>
                    )}
                  </p>
                </Link>

                {!reply.deleted && (reply.attachments?.length ?? 0) > 0 ? (
                  <div className="mt-2">
                    <CommentAttachments attachments={reply.attachments ?? []} />
                  </div>
                ) : null}

                {!reply.deleted && (
                  <CommentLinkEmbeds content={reply.content} />
                )}

                {/* Actions */}
                {reply.deleted ? null : (
                  <div className="mt-2 flex items-center gap-2">
                    <AuraVoteButton
                      authorName={replyDisplayName}
                      commentId={reply.id}
                      expandable={false}
                      initialState={{
                        aura: reply.aura,
                        userVote: reply.votes[0]?.value ?? 0,
                      }}
                      postId={reply.post.id}
                    />
                    <Link
                      aria-label="Reply to eddie"
                      className="pill-3d-hover text-muted-foreground inline-flex h-8 items-center gap-1.5 rounded-full border-0 px-2 text-xs font-medium active:translate-y-px"
                      href={postHref}
                    >
                      <CornerDownRight className="size-3.5" />
                      Reply
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Loader2 className="text-primary animate-spin" />
        </div>
      ) : null}
      {!hasNextPage && visibleReplies.length > 0 ? (
        <FeedCaughtUp note="You've seen every reply from this profile." />
      ) : null}
    </InfiniteScrollContainer>
  );
};

export default React.memo(UserRepliesFeed);
