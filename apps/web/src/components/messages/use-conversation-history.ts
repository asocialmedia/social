import {
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { fetchMessages } from "@/lib/messages/client";
import type { MessagePageAxis } from "@/lib/messages/client";
import type { MessagePage } from "@/lib/messages/types";

import { TRANSCRIPT_MAX_HISTORY_PAGES } from "./viewer-history-window";

export function evictInactiveConversationHistories(
  queryClient: QueryClient,
  activeConversationId: string
): void {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[1] !== activeConversationId,
    queryKey: ["messages"],
    type: "inactive",
  });
}

export function conversationHistoryOptions(conversationId: string) {
  return infiniteQueryOptions<
    MessagePage,
    Error,
    InfiniteData<MessagePage, MessagePageAxis>,
    readonly [string, string],
    MessagePageAxis
  >({
    gcTime: 0,
    getNextPageParam: (page) =>
      page.nextCursor ? { cursor: page.nextCursor, kind: "newer" } : undefined,
    getPreviousPageParam: (page) =>
      page.previousCursor
        ? { cursor: page.previousCursor, kind: "older" }
        : undefined,
    initialPageParam: { kind: "older" },
    maxPages: TRANSCRIPT_MAX_HISTORY_PAGES,
    queryFn: ({ pageParam, signal }) =>
      fetchMessages(conversationId, pageParam, 100, { signal }),
    queryKey: ["messages", conversationId],
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}

export function useConversationHistory(conversationId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    evictInactiveConversationHistories(queryClient, conversationId);
  }, [conversationId, queryClient]);
  return useInfiniteQuery(conversationHistoryOptions(conversationId));
}
