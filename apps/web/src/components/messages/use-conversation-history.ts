import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";

import { fetchMessages } from "@/lib/messages/client";
import type { MessagePageAxis } from "@/lib/messages/client";
import type { MessagePage } from "@/lib/messages/types";

import { TRANSCRIPT_MAX_HISTORY_PAGES } from "./viewer-history-window";

export function conversationHistoryOptions(conversationId: string) {
  return infiniteQueryOptions<
    MessagePage,
    Error,
    InfiniteData<MessagePage, MessagePageAxis>,
    readonly [string, string],
    MessagePageAxis
  >({
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
  return useInfiniteQuery(conversationHistoryOptions(conversationId));
}
