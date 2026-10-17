"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import type { ExternalCommentPage } from "@asm/protocols/discovery";
import { externalCommentPageSchema } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRef } from "react";

import CommentInput from "@/components/comments/composer/comment-input";
import CommentItem from "@/components/comments/item/comment";
import { CommentsThreadView } from "@/components/comments/thread/comments-thread-view";
import { externalCommentView } from "@/lib/posts/external-comment-view";

import { useExternalInteractions } from "./use-external-interactions";

const noop = () => null;

export function ExternalDiscussion({
  post,
}: {
  post: Pick<ExternalPost, "id" | "asm">;
}) {
  const requestId = useRef(crypto.randomUUID());
  const interaction = useExternalInteractions(post);
  const comments = useInfiniteQuery({
    getNextPageParam: (page: ExternalCommentPage) => page.cursor ?? undefined,
    initialPageParam: null as { createdAt: string; id: string } | null,
    maxPages: 20,
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams({ kind: "comments", uri: post.id });
      if (pageParam) {
        query.set("cursor", JSON.stringify(pageParam));
      }
      const response = await fetch(
        `/api/protocols/bluesky/interactions?${query}`,
        { signal }
      );
      if (!response.ok) {
        throw new Error("Couldn't load discussion");
      }
      const data: unknown = await response.json();
      return externalCommentPageSchema.parse(
        (data as { comments: unknown }).comments
      );
    },
    queryKey: ["external-discussion", post.id],
    retry: false,
  });
  const items = [
    ...new Map(
      comments.data?.pages
        .flatMap((page) => page.items)
        .map((comment) => [comment.id, comment])
    ).values(),
  ];
  return (
    <CommentsThreadView
      loading={comments.isPending}
      failed={comments.isError}
      empty={comments.isSuccess && !items.length}
      onRetry={() => {
        void comments.refetch();
      }}
      composer={
        <CommentInput
          applyCreated={noop}
          post={post}
          controller={{
            maxLength: 1500,
            pending: interaction.pending,
            submit: async (content) => {
              const saved = await interaction.mutate({
                action: "comment",
                content,
                requestId: requestId.current,
                uri: post.id,
              });
              if (saved) {
                requestId.current = crypto.randomUUID();
              }
              return saved;
            },
          }}
        />
      }
    >
      {items.map((comment) => (
        <CommentItem
          applyCreated={noop}
          applyDeleted={noop}
          key={comment.id}
          post={post}
          node={{
            children: [],
            comment: externalCommentView(comment, post.id),
            depth: 0,
          }}
          localActions={{
            delete: () =>
              interaction.mutate({
                action: "delete_comment",
                commentId: comment.id,
                uri: post.id,
              }),
            pending: interaction.pending,
          }}
        />
      ))}
      {comments.hasNextPage ? (
        <Button
          className="mx-auto block"
          disabled={comments.isFetchingNextPage}
          variant="link"
          onClick={() => {
            void comments.fetchNextPage();
          }}
        >
          Load more eddies
        </Button>
      ) : null}
    </CommentsThreadView>
  );
}
