import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { fetchConversationList } from "./client";

function conversationListKey(userId: string | undefined) {
  return ["message-conversations", userId] as const;
}

export function conversationListQuery(userId: string | undefined) {
  return queryOptions({
    enabled: Boolean(userId),
    queryFn: () => fetchConversationList(),
    queryKey: conversationListKey(userId),
    staleTime: 30_000,
  });
}

export function useRefreshConversationList(userId: string | undefined) {
  const queryClient = useQueryClient();
  return useCallback(() => {
    if (userId) {
      void queryClient.invalidateQueries({
        queryKey: conversationListKey(userId),
      });
    }
  }, [queryClient, userId]);
}
