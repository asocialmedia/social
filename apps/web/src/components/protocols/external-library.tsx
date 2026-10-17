"use client";

import { externalPostSchema } from "@asm/protocols/discovery";
import { Button } from "@asm/ui/shadui/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { useSession } from "@/app/(main)/session-provider";
import FeedViewSkeleton from "@/components/layouts/skeletons/feed-view-skeleton";

import { BlueskyPostCard } from "./bluesky-post-card";

const schema = z.object({
  cursor: z
    .object({ externalPostId: z.string(), updatedAt: z.string() })
    .nullable(),
  items: z.array(
    z.object({ post: externalPostSchema.nullable(), uri: z.string() })
  ),
});
export function ExternalLibrary() {
  const { user } = useSession();
  const [kind, setKind] = useState<"bookmarks" | "amplified">("bookmarks");
  const library = useInfiniteQuery({
    getNextPageParam: (page: z.infer<typeof schema>) =>
      page.cursor ?? undefined,
    initialPageParam: null as {
      updatedAt: string;
      externalPostId: string;
    } | null,
    maxPages: 20,
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams({ kind });
      if (pageParam) {
        query.set("cursor", JSON.stringify(pageParam));
      }
      const response = await fetch(
        `/api/protocols/bluesky/interactions?${query}`,
        { signal }
      );
      if (!response.ok) {
        throw new Error("Couldn't load saved posts");
      }
      return schema.parse(await response.json());
    },
    queryKey: ["external-library", user?.id, kind],
    retry: false,
  });
  return (
    <div>
      <div className="flex gap-2 px-4 py-3">
        <Button
          onClick={() => setKind("bookmarks")}
          variant={kind === "bookmarks" ? "premium" : "ghost"}
        >
          Saved
        </Button>
        <Button
          onClick={() => setKind("amplified")}
          variant={kind === "amplified" ? "premium" : "ghost"}
        >
          Amplified
        </Button>
      </div>
      {library.isPending ? <FeedViewSkeleton /> : null}
      {library.isError ? (
        <Button
          onClick={() => {
            void library.refetch();
          }}
          variant="ghost"
        >
          Couldn't load posts. Retry
        </Button>
      ) : null}
      {library.data?.pages
        .flatMap((page) => page.items)
        .map((item) =>
          item.post ? (
            <BlueskyPostCard key={item.uri} post={item.post} />
          ) : (
            <Link
              className="text-muted-foreground block border-b p-4 text-sm"
              href={`/network/bluesky?uri=${encodeURIComponent(item.uri)}`}
              key={item.uri}
            >
              Source post unavailable. Open asocialmedia discussion.
            </Link>
          )
        )}
      {library.isSuccess &&
      library.data.pages.every((page) => page.items.length === 0) ? (
        <p className="text-muted-foreground p-8 text-center text-sm">
          No posts here yet.
        </p>
      ) : null}
      {library.hasNextPage ? (
        <Button
          disabled={library.isFetchingNextPage}
          onClick={() => {
            void library.fetchNextPage();
          }}
          variant="ghost"
        >
          Load more
        </Button>
      ) : null}
    </div>
  );
}
