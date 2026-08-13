"use client";

import type { PostData } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback } from "react";
import InfiniteScrollContainer from "@/components/layouts/infinite-scroll-container";
import UserAvatar from "@/components/layouts/user-avatar";
import Linkify from "@/helpers/global/linkify";
import kyInstance from "@/lib/ky";
import { formatRelativeDate } from "@/lib/utils";

interface RelatedPostsProps {
  excludePostId: string;
}

const SKELETON_KEYS = Array.from(
  { length: 3 },
  (_, index) => `skeleton-${index}`
);

// Related-post list for the media viewer sidebar. Kept lightweight (each row
// is a plain link, no view tracking / full post card) but paginated via the
// same cursor-based endpoint + infinite scroll the main feed uses, so the
// whole backlog is reachable, not a hardcoded handful.
export default function RelatedPosts({ excludePostId }: RelatedPostsProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } =
    useInfiniteQuery({
      queryKey: ["related-posts", excludePostId],
      queryFn: async ({ pageParam }) => {
        const result = await kyInstance
          .get(
            "/api/posts/for-you",
            pageParam ? { searchParams: { cursor: pageParam } } : {}
          )
          .json<{ posts: PostData[]; nextCursor: string | null }>();
        return result;
      },
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: 30 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    });

  const posts = (data?.pages.flatMap((page) => page.posts) || []).filter(
    (post) => post.id !== excludePostId
  );

  const handleBottomReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (status === "pending") {
    return (
      <div className="space-y-3 px-4 py-3">
        {SKELETON_KEYS.map((key) => (
          <div className="animate-pulse space-y-2" key={key}>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-border/40" />
              <div className="h-3 w-24 rounded bg-border/40" />
            </div>
            <div className="h-3 w-full rounded bg-border/40" />
            <div className="h-3 w-2/3 rounded bg-border/40" />
          </div>
        ))}
      </div>
    );
  }

  if (status === "error" || posts.length === 0) {
    return null;
  }

  return (
    <InfiniteScrollContainer onBottomReached={handleBottomReached}>
      <div className="flex flex-col divide-y divide-border/60">
        {posts.map((post) => (
          <Link
            className="group/post flex gap-3 px-4 py-3 transition-colors hover:bg-[hsl(var(--muted))]"
            href={`/posts/${post.id}`}
            key={post.id}
          >
            <UserAvatar
              avatarUrl={post.user.avatarUrl}
              className="h-8 w-8 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5 text-sm">
                <span className="truncate font-semibold text-foreground">
                  {post.user.displayName}
                </span>
                <span className="truncate text-muted-foreground">
                  @{post.user.username}
                </span>
                <span className="shrink-0 text-muted-foreground">·</span>
                <span
                  className="shrink-0 text-muted-foreground"
                  suppressHydrationWarning
                >
                  {formatRelativeDate(post.createdAt)}
                </span>
              </div>
              <Linkify>
                <p className="wrap-break-word mt-0.5 line-clamp-2 whitespace-pre-wrap text-foreground text-sm">
                  {post.content}
                </p>
              </Linkify>
              {post.attachments.length > 0 ? (
                <p className="mt-1 text-muted-foreground text-xs">
                  {post.attachments.length} attachment
                  {post.attachments.length > 1 ? "s" : ""}
                </p>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </InfiniteScrollContainer>
  );
}
