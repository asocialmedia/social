import { useQuery } from "@tanstack/react-query";

import kyInstance from "@/lib/ky";

export function useHnBookmarkStates(storyIds: number[]) {
  const uniqueIds = [...new Set(storyIds)];

  return useQuery({
    enabled: uniqueIds.length > 0,
    queryFn: async () => {
      const response = await kyInstance
        .post("/api/hackernews/bookmark-states", {
          json: { storyIds: uniqueIds },
        })
        .json<{ bookmarked: Record<number, boolean> }>();
      return response.bookmarked;
    },
    queryKey: ["hn-bookmark-states", uniqueIds],
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}
