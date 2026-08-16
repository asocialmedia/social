"use client";

import type { BookmarkCountInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { useSession } from "@/app/(main)/session-provider";
import kyInstance from "@/lib/ky";

export const BOOKMARK_COUNT_QUERY_KEY = ["bookmark-count"] as const;

// Optimistically adjusts the shared bookmark-count cache (posts/HN/gusts) after
// a bookmark toggle so every consumer (sidebar badge, mobile nav, bookmarks
// tabs) updates instantly instead of waiting on a refetch.
export function adjustBookmarkCount(
  queryClient: QueryClient,
  kind: "post" | "gust" | "hn",
  delta: 1 | -1
) {
  const prev = queryClient.getQueryData<BookmarkCountInfo>([
    ...BOOKMARK_COUNT_QUERY_KEY,
  ]);
  if (!prev) {
    return;
  }
  const next: BookmarkCountInfo = {
    ...prev,
    gustCount: kind === "gust" ? prev.gustCount + delta : prev.gustCount,
    hnCount: kind === "hn" ? prev.hnCount + delta : prev.hnCount,
    postCount: kind === "post" ? prev.postCount + delta : prev.postCount,
    // totalCount is posts + HN (historical sidebar semantics).
    totalCount:
      prev.totalCount + (kind === "post" || kind === "hn" ? delta : 0),
  };
  queryClient.setQueryData<BookmarkCountInfo>(
    [...BOOKMARK_COUNT_QUERY_KEY],
    next
  );
}

export function useBookmarkCount(initialData?: BookmarkCountInfo) {
  const { user } = useSession();
  return useQuery({
    enabled: Boolean(user),
    initialData,
    queryFn: () =>
      kyInstance.get("/api/bookmarks/count").json<BookmarkCountInfo>(),
    queryKey: [...BOOKMARK_COUNT_QUERY_KEY],
    refetchOnWindowFocus: false,
    staleTime: 30 * 1000,
  });
}
