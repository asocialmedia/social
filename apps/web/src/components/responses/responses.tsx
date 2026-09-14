"use client";

import type { PostData, ResponsesPage } from "@asm/db";
import { Button } from "@asm/ui/shadui/button";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CornerDownRight } from "lucide-react";
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
  // A single Twitter-style column: depth-first order, parent before child.
  const rows = flattenResponseTree(focused ? [focused] : tree);

  const openRespond = useCallback(
    (target: PostData) => {
      openComposer("post", {
        avatarUrl: target.user?.avatarUrl ?? null,
        content: target.content,
        displayName: target.user?.displayName ?? undefined,
        id: target.id,
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
    <div className="space-y-4">
      {focusResponseId ? null : (
        <button
          className="border-border/60 bg-muted/30 hover:bg-muted/50 text-muted-foreground flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors active:translate-y-px"
          onClick={() => openRespond(post)}
          type="button"
        >
          <CornerDownRight className="size-4 shrink-0" />
          <span>Respond to this post…</span>
        </button>
      )}

      {hasNextPage ? (
        <Button
          className="mx-auto block"
          disabled={isFetching}
          onClick={handleLoadPrevious}
          variant="link"
        >
          Load previous responses
        </Button>
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

      {/* pl-1 nudges the thread so its line sits under the anchor post's
          avatar centre, keeping the connector unbroken from post to reply. */}
      <div className="pl-1">
        {rows.map((node, index) => (
          <ResponseItem
            isLast={index === rows.length - 1}
            key={node.response.id}
            node={node}
            onRespond={openRespond}
          />
        ))}
      </div>
    </div>
  );
}
