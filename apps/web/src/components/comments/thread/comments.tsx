"use client";

import type { CommentsPage, PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import kyInstance from "@/lib/ky";

import CommentInput from "../composer/comment-input";
import CommentItem from "../item/comment";
import { buildCommentTree, mergeCommentsWithLive } from "./comment-tree";
import { useCommentsRealtimeValue } from "./comments-realtime-context";
import { CommentsThreadView } from "./comments-thread-view";
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

  const { data, fetchNextPage, hasNextPage, isFetching, status, refetch } =
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
      refetchInterval: 8000,
      refetchIntervalInBackground: false,
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

  return (
    <CommentsThreadView
      loading={status === "pending"}
      failed={status === "error"}
      empty={status === "success" && !tree.length}
      onRetry={() => {
        void refetch();
      }}
      composer={
        <CommentInput
          applyCreated={applyCreated}
          hideOnMobile={hideComposerOnMobile}
          post={post}
          reels={reels}
        />
      }
      pagination={
        hasNextPage ? (
          <Button
            className="mx-auto block"
            disabled={isFetching}
            onClick={handleLoadPrevious}
            variant="link"
          >
            Load previous eddies
          </Button>
        ) : null
      }
    >
      {tree.map((node) => (
        <CommentItem
          applyCreated={applyCreated}
          applyDeleted={applyDeleted}
          key={node.comment.id}
          node={node}
          post={post}
        />
      ))}
    </CommentsThreadView>
  );
}
