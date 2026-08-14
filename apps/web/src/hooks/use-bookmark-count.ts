"use client";

import type { BookmarkCountInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/(main)/session-provider";
import kyInstance from "@/lib/ky";

export function useBookmarkCount() {
  const { user } = useSession();
  return useQuery({
    enabled: Boolean(user),
    queryFn: () =>
      kyInstance.get("/api/bookmarks/count").json<BookmarkCountInfo>(),
    queryKey: ["bookmark-count"],
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });
}
