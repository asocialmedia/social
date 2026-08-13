import { useQuery } from "@tanstack/react-query";
import kyInstance from "@/lib/ky";

export function useHnBookmarkStates(storyIds: number[]) {
  const uniqueIds = Array.from(new Set(storyIds));

  return useQuery({
    queryKey: ["hn-bookmark-states", uniqueIds],
    queryFn: async () => {
      const response = await kyInstance
        .post("/api/hackernews/bookmark-states", {
          json: { storyIds: uniqueIds },
        })
        .json<{ bookmarked: Record<number, boolean> }>();
      return response.bookmarked;
    },
    enabled: uniqueIds.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
