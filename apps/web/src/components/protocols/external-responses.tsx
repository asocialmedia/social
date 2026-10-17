"use client";

import type { PostData } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Separator } from "@asm/ui/shadui/separator";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { useSession } from "@/app/(main)/session-provider";
import LoadMoreSkeleton from "@/components/layouts/skeletons/load-more-skeleton";
import ResponseItem from "@/components/responses/response-item";
import {
  buildResponseTree,
  flattenResponseTree,
} from "@/components/responses/response-tree";
import { useRequireAuth } from "@/hooks/auth/use-require-auth";
import { useComposerStore } from "@/store/composer-store";

interface ResponsePage {
  cursor: { createdAt: string; id: string } | null;
  items: PostData[];
}

export function ExternalResponses({ uri }: { uri: string }) {
  const { user } = useSession();
  const auth = useRequireAuth();
  const openComposer = useComposerStore((state) => state.openComposer);

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

  const openRespond = useCallback(
    (target: PostData) => {
      if (!auth.isLoggedIn) {
        auth.goToLogin();
        return;
      }
      openComposer("post", {
        attachments: target.attachments,
        avatarUrl: target.user?.avatarUrl ?? null,
        badge: target.user?.badge,
        badges: [...(target.user?.badges ?? [])],
        content: target.content,
        createdAt: target.createdAt,
        displayName: target.user?.displayName ?? undefined,
        embeds: target.embeds,
        id: target.id,
        isGust: target.isGust,
        username: target.user?.username ?? "unknown",
      });
    },
    [auth, openComposer]
  );

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data]
  );
  const tree = useMemo(() => buildResponseTree(items), [items]);
  const rows = useMemo(() => flattenResponseTree(tree), [tree]);

  return (
    <section
      aria-label="Responses on asocialmedia"
      className="border-border/60 border-t pt-4"
    >
      <h2 className="px-4 pb-3 font-semibold">Responses on asocialmedia</h2>
      {query.isPending ? <LoadMoreSkeleton /> : null}
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
      {query.isSuccess && items.length === 0 ? (
        <p className="text-muted-foreground px-4 pb-6 text-sm">
          No responses yet. Use Respond to post a fleet.
        </p>
      ) : null}
      <div className="flex flex-col">
        {rows.map((node, index) => {
          const prevNode = rows[index - 1];
          const nextNode = rows[index + 1];
          const hasConnectingParent = Boolean(
            prevNode && node.response.parentPostId === prevNode.response.id
          );
          const hasConnectingChild = Boolean(
            nextNode && nextNode.response.parentPostId === node.response.id
          );
          const isBranchEnd = !nextNode || nextNode.depth === 0;

          return (
            <div key={node.response.id}>
              <ResponseItem
                hasConnectingChild={hasConnectingChild}
                hasConnectingParent={hasConnectingParent}
                node={node}
                onRespond={openRespond}
              />
              {isBranchEnd && nextNode ? (
                <Separator className="bg-border/60 my-2" />
              ) : null}
            </div>
          );
        })}
      </div>
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
