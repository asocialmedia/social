"use client";

import type { Media } from "@asm/db";
import { useInfiniteQuery } from "@tanstack/react-query";
import kyInstance from "@/lib/ky";

export interface UserMediaPage {
  media: Media[];
  nextCursor: string | null;
}

export function useUserMediaQuery(userId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["media-gallery", userId],
    queryFn: ({ pageParam }) =>
      kyInstance
        .get(
          `/api/users/${userId}/media`,
          pageParam ? { searchParams: { cursor: pageParam } } : undefined
        )
        .json<UserMediaPage>(),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    staleTime: 1000 * 60,
  });
}
