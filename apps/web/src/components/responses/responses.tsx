"use client";

import type { PostData, ResponsesPage } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { Separator } from "@asm/ui/shadui/separator";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useRef } from "react";

import kyInstance from "@/lib/ky";
import { useComposerStore } from "@/store/composer-store";

// eslint-disable-next-line import/no-cycle -- the response row renders media-previews and post-card renders this thread
import ResponseItem from "./response-item";
import {
  buildResponseTree,
  findResponseNode,
  flattenResponseTree,
  mergeResponsesWithLive,
} from "./response-tree";
import type { LiveResponseStore } from "./use-responses-realtime";
import { useResponsesRealtime } from "./use-responses-realtime";

interface ResponsesProps {
  // The post whose thread is listed. On a response permalink this is the
  // response being viewed; the thread is still fetched from its root so a
  // nested response can be slotted under its parent.
  post: PostData;
  // When set, only this response's node is rendered (its parent card carries
  // the context), which is how a response permalink focuses a single branch.
  focusResponseId?: string;
}

export default function Responses({ post, focusResponseId }: ResponsesProps) {
  // One thread, one channel: every response in a thread shares its top-level
  // post's id, so realtime, the query cache and the API all key on the root.
  const threadRootId = post.rootPostId ?? post.id;
  const liveStoreRef = useRef<LiveResponseStore>(new Map());
  const { applyCreated, applyDeleted } = useResponsesRealtime(
    threadRootId,
    liveStoreRef
  );
  const openComposer = useComposerStore((state) => state.openComposer);

  const { data, fetchNextPage, hasNextPage, isFetching, status } =
    useInfiniteQuery({
      getNextPageParam: (firstPage) => firstPage.previousCursor,
      initialPageParam: null as string | null,
      queryFn: ({ pageParam }: { pageParam: string | null }) =>
        kyInstance
          .get(
            `/api/posts/${threadRootId}/responses`,
            pageParam ? { searchParams: { cursor: pageParam } } : {}
          )
          .json<ResponsesPage>(),
      queryKey: ["responses", threadRootId],
      refetchInterval: 8000,
      refetchIntervalInBackground: false,
      select: (pagesData) => {
        const pages = [...pagesData.pages].toReversed();
        const serverResponses = pages.flatMap((page) => page.responses);
        return mergeResponsesWithLive(serverResponses, liveStoreRef.current);
      },
    });

  const tree = buildResponseTree(data ?? []);
  const focused = focusResponseId
    ? findResponseNode(tree, focusResponseId)
    : null;
  // When focusResponseId is set, the anchor post itself is already rendered by
  // PostCard; its responses are its children. Otherwise render the root tree.
  const rows = flattenResponseTree(focused ? focused.children : tree);

  const openRespond = useCallback(
    (target: PostData) => {
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
    [openComposer]
  );

  const handleLoadPrevious = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  // Suppress the unused-var lint for the live write handlers: they are wired
  // into the query cache by the realtime hook itself and kept for parity with
  // the eddies container, which passes them down to optimistic composers.
  void applyCreated;
  void applyDeleted;

  if (status === "pending") {
    return (
      <div className="text-muted-foreground py-6 text-sm">
        Loading responses…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {hasNextPage ? (
        <div className="pt-2">
          <Button
            className="mx-auto block"
            disabled={isFetching}
            onClick={handleLoadPrevious}
            variant="link"
          >
            Load previous responses
          </Button>
        </div>
      ) : null}

      {status === "success" && rows.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          No responses yet.
        </p>
      ) : null}

      {status === "error" ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          Responses hit a snag. Try reloading this post.
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
    </div>
  );
}
