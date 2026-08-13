import type { BookmarkCountInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import kyInstance from "@/lib/ky";

export function useBookmarkCount() {
  return useQuery({
    queryKey: ["bookmark-count"],
    queryFn: () =>
      kyInstance.get("/api/bookmarks/count").json<BookmarkCountInfo>(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
