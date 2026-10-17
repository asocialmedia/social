"use client";
import { externalPostSchema } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "@/app/(main)/session-provider";
import InfiniteScrollContainer from "@/components/layouts/feed/infinite-scroll-container";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import { FEED_QUERY_BEHAVIOR } from "@/lib/posts/feed-cache";

import { BlueskyPostCard } from "./bluesky-post-card";

const pageSchema = z.object({
  cursor: z.string().nullable(),
  items: z.array(externalPostSchema).max(50),
});

export function ExternalAuthorFeed({
  actor,
  tab,
}: {
  actor: string;
  tab: "posts" | "replies" | "media";
}) {
  const { user } = useSession();
  const query = useInfiniteQuery({
    ...FEED_QUERY_BEHAVIOR,
    getNextPageParam: (page: z.infer<typeof pageSchema>) =>
      page.cursor ?? undefined,
    initialPageParam: null as string | null,
    maxPages: 20,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ actor, tab });
      if (pageParam) {
        params.set("cursor", pageParam);
      }
      const response = await fetch(`/api/protocols/bluesky/profile?${params}`, {
        signal,
      });
      if (!response.ok) {
        throw new Error("Couldn't load posts");
      }
      return pageSchema.parse(await response.json());
    },
    queryKey: ["bluesky-author-feed", actor, tab, user?.id ?? "guest"],
    retry: false,
  });
  if (query.isPending) {
    return <FeedViewSkeleton />;
  }
  if (query.isError && !query.data) {
    return (
      <Button
        className="m-4"
        variant="ghost"
        onClick={() => {
          void query.refetch();
        }}
      >
        Couldn't load posts. Retry
      </Button>
    );
  }
  const posts = [
    ...new Map(
      query.data?.pages
        .flatMap((page) => page.items)
        .map((post) => [post.id, post])
    ).values(),
  ];
  return (
    <InfiniteScrollContainer
      onBottomReached={() => {
        if (query.hasNextPage && !query.isFetching) {
          void query.fetchNextPage();
        }
      }}
    >
      {posts.map((post) => (
        <BlueskyPostCard key={post.id} post={post} />
      ))}
      {posts.length ? null : (
        <p className="text-muted-foreground px-4 py-10 text-center text-sm">
          No posts to show here.
        </p>
      )}
      {query.isFetchingNextPage ? <LoadMoreSkeleton /> : null}
      {query.hasNextPage ? (
        <Button
          className="mx-auto my-4 block"
          disabled={query.isFetching}
          onClick={() => {
            void query.fetchNextPage();
          }}
          variant="ghost"
        >
          Load more posts
        </Button>
      ) : null}
    </InfiniteScrollContainer>
  );
}
