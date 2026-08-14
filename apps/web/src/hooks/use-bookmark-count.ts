import type { BookmarkCountInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";

import kyInstance from "@/lib/ky";

export function useBookmarkCount() {
  return useQuery({
    queryFn: () =>
      kyInstance.get("/api/bookmarks/count").json<BookmarkCountInfo>(),
    queryKey: ["bookmark-count"],
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });
}
