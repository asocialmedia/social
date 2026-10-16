"use client";

import type { PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useSession } from "@/app/(main)/session-provider";
import PostCard from "@/components/home/feedview/post-card";
import { normalizePostData } from "@/lib/posts/post-normalize";

interface ResponsePage {
  items: PostData[];
  cursor: { createdAt: string; id: string } | null;
}

export function ExternalResponses({ uri }: { uri: string }) {
  const { user } = useSession();
  const query = useInfiniteQuery({
    getNextPageParam: (page: ResponsePage) => page.cursor ?? undefined,
    initialPageParam: null as ResponsePage["cursor"],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ kind: "responses", uri });
      if (pageParam) {
        params.set("cursor", JSON.stringify(pageParam));
      }
      const response = await fetch(
        `/api/protocols/bluesky/interactions?${params}`,
        { signal }
      );
      if (!response.ok) {
        throw new Error("Couldn't load responses");
      }
      return (await response.json()) as ResponsePage;
    },
    queryKey: ["external-responses", uri, user?.id ?? "guest"],
    retry: false,
  });
  return (
    <section
      aria-label="Responses on ASM"
      className="border-border/60 border-t pt-4"
    >
      <h2 className="px-4 pb-3 font-semibold">Responses on ASM</h2>
      {query.isPending ? (
        <p className="text-muted-foreground px-4 pb-4 text-sm">
          Loading responses…
        </p>
      ) : null}
      {query.isError ? (
        <Button
          className="mx-4 mb-4"
          onClick={() => {
            void query.refetch();
          }}
          variant="ghost"
        >
          Couldn't load responses. Retry
        </Button>
      ) : null}
      {query.isSuccess &&
      query.data.pages.every((page) => page.items.length === 0) ? (
        <p className="text-muted-foreground px-4 pb-6 text-sm">
          No responses yet. Use Respond to post a fleet.
        </p>
      ) : null}
      {query.data?.pages
        .flatMap((page) => page.items)
        .map((post) => (
          <PostCard key={post.id} post={normalizePostData(post)} />
        ))}
      {query.hasNextPage ? (
        <Button
          className="mx-4 my-4"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            void query.fetchNextPage();
          }}
          variant="ghost"
        >
          More responses
        </Button>
      ) : null}
    </section>
  );
}
