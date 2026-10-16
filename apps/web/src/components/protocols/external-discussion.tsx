"use client";

import type { ExternalPost } from "@asm/protocols/contracts";
import type { ExternalCommentPage } from "@asm/protocols/discovery";
import { externalCommentPageSchema } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { Textarea } from "@asm/ui/shadui/textarea";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";

import { useSession } from "@/app/(main)/session-provider";
import UserAvatar from "@/components/layouts/user/user-avatar";
import { formatRelativeDate } from "@/lib/utils";

import { useExternalInteractions } from "./use-external-interactions";

export function ExternalDiscussion({
  post,
}: {
  post: Pick<ExternalPost, "id" | "asm">;
}) {
  const { user } = useSession();
  const [content, setContent] = useState("");
  const requestId = useRef(crypto.randomUUID());
  const interaction = useExternalInteractions(post);
  const comments = useInfiniteQuery({
    getNextPageParam: (page: ExternalCommentPage) => page.cursor ?? undefined,
    initialPageParam: null as { createdAt: string; id: string } | null,
    maxPages: 20,
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams({ uri: post.id });
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
  return (
    <section
      className="border-border/60 border-t px-4 py-4"
      aria-label="ASM discussion"
    >
      <h2 className="font-semibold">Eddies</h2>
      <p className="text-muted-foreground mt-1 mb-4 text-xs">
        Discussion on ASM · Replies stay on ASM
      </p>
      {comments.isSuccess &&
      comments.data.pages.every((page) => page.items.length === 0) ? (
        <p className="text-muted-foreground py-4 text-sm">
          No eddies yet. Start the conversation.
        </p>
      ) : null}
      {comments.isPending ? (
        <p className="text-muted-foreground text-sm">Loading discussion…</p>
      ) : null}
      {comments.isError ? (
        <Button
          onClick={() => {
            void comments.refetch();
          }}
          variant="ghost"
        >
          Couldn't load discussion. Retry
        </Button>
      ) : null}
      {comments.data?.pages
        .flatMap((page) => page.items)
        .map((comment) => (
          <div className="flex gap-3 py-3" key={comment.id}>
            <UserAvatar
              avatarUrl={comment.user?.avatarUrl}
              className="size-8"
            />
            <div className="min-w-0 flex-1">
              <Link
                className="text-sm font-semibold"
                href={`/users/${comment.user.username}`}
              >
                {comment.user.displayName}
              </Link>
              <time
                className="text-muted-foreground ml-2 text-xs"
                dateTime={comment.createdAt}
                suppressHydrationWarning
              >
                {formatRelativeDate(comment.createdAt)}
              </time>
              <p className="text-sm wrap-break-word whitespace-pre-wrap">
                {comment.deleted ? "Comment removed" : comment.content}
              </p>
            </div>
            {comment.userId === user?.id && !comment.deleted ? (
              <Button
                disabled={interaction.pending}
                onClick={() => {
                  void interaction.mutate({
                    action: "delete_comment",
                    commentId: comment.id,
                    uri: post.id,
                  });
                }}
                size="sm"
                variant="ghost"
              >
                Delete
              </Button>
            ) : null}
          </div>
        ))}
      {comments.hasNextPage ? (
        <Button
          disabled={comments.isFetchingNextPage}
          onClick={() => {
            void comments.fetchNextPage();
          }}
          variant="ghost"
        >
          More comments
        </Button>
      ) : null}
      {user ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (
              await interaction.mutate({
                action: "comment",
                content,
                requestId: requestId.current,
                uri: post.id,
              })
            ) {
              setContent("");
              requestId.current = crypto.randomUUID();
            }
          }}
        >
          <Textarea
            aria-label="Write an eddy"
            maxLength={1500}
            onChange={(event) => {
              setContent(event.target.value);
              requestId.current = crypto.randomUUID();
            }}
            placeholder="Write an eddy…"
            value={content}
          />
          <Button
            className="self-end"
            disabled={interaction.pending || !content.trim()}
            type="submit"
            variant="premium"
          >
            Post eddy
          </Button>
        </form>
      ) : (
        <Link className="text-primary mt-3 block text-sm" href="/login">
          Sign in to join the discussion
        </Link>
      )}
    </section>
  );
}
