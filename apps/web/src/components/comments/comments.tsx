"use client";

import type { CommentsPage, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import noCommentsImage from "@assets/general/nocomments.png";
import noMediaImage from "@assets/general/nomedia.png";
import { useInfiniteQuery } from "@tanstack/react-query";
import Image from "next/image";
import { useCallback, useRef } from "react";

import CommentsSkeleton from "@/components/layouts/skeletons/comments-skeleton";
import kyInstance from "@/lib/ky";

import CommentItem from "./comment";
import CommentInput from "./comment-input";
import { buildCommentTree, mergeCommentsWithLive } from "./comment-tree";
import { useCommentsRealtimeValue } from "./comments-realtime-context";
import { useCommentsRealtime } from "./use-comments-realtime";
import type { LiveCommentStore } from "./use-comments-realtime";

interface CommentsProps {
  // Hides the top-level composer on mobile when a floating editor already
  // handles it (post detail page); reply composers stay available.
  hideComposerOnMobile?: boolean;
  post: PostData;
  reels?: boolean;
}

export default function Comments({
  hideComposerOnMobile = false,
  post,
  reels = false,
}: CommentsProps) {
  const shared = useCommentsRealtimeValue();

  // Without a provider (e.g. the feed dialog), the list owns its own realtime
  // store; inside a provider the shared store is used so every composer on the
  // page folds into the same thread (and only one SSE connection is opened).
  const ownStoreRef = useRef<LiveCommentStore>(new Map());
  const ownRealtime = useCommentsRealtime(post.id, ownStoreRef, !shared);

  const applyCreated = shared?.applyCreated ?? ownRealtime.applyCreated;
  const applyDeleted = shared?.applyDeleted ?? ownRealtime.applyDeleted;
  const liveStoreRef = shared?.liveStoreRef ?? ownStoreRef;

  const { data, fetchNextPage, hasNextPage, isFetching, status } =
    useInfiniteQuery({
      getNextPageParam: (firstPage) => firstPage.previousCursor,
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        kyInstance
          .get(
            `/api/posts/${post.id}/comments`,
            pageParam ? { searchParams: { cursor: pageParam } } : {}
          )
          .json<CommentsPage>(),
      queryKey: ["comments", post.id],
      select: (commentsData) => {
        const pages = [...commentsData.pages].toReversed();
        const serverComments = pages.flatMap((page) => page.comments);
        return mergeCommentsWithLive(serverComments, liveStoreRef.current);
      },
    });

  const comments = data ?? [];
  const tree = buildCommentTree(comments);

  const handleLoadPrevious = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  if (status === "pending") {
    return <CommentsSkeleton />;
  }

  return (
    <div className="space-y-4">
      <CommentInput
        applyCreated={applyCreated}
        hideOnMobile={hideComposerOnMobile}
        post={post}
        reels={reels}
      />
      {hasNextPage ? (
        <Button
          className="mx-auto block"
          disabled={isFetching}
          onClick={handleLoadPrevious}
          variant="link"
        >
          Load previous eddies
        </Button>
      ) : null}
      {status === "success" && !tree.length && (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <Image
            alt=""
            className="h-40 w-auto object-contain"
            draggable={false}
            height={1024}
            src={noCommentsImage}
            width={1536}
          />
          <p className="text-muted-foreground text-sm">No eddie yet.</p>
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
          <Image
            alt=""
            className="h-20 w-20 rounded-full object-contain opacity-70"
            draggable={false}
            height={80}
            src={noMediaImage}
            width={80}
          />
          <p className="text-muted-foreground text-sm">
            Eddies hit a snag. Try reloading this post.
          </p>
        </div>
      )}
      <div className="divide-border/40 divide-y pt-1">
        {tree.map((node) => (
          <CommentItem
            applyCreated={applyCreated}
            applyDeleted={applyDeleted}
            key={node.comment.id}
            node={node}
            post={post}
          />
        ))}
      </div>
    </div>
  );
}
