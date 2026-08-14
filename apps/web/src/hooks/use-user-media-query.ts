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
    enabled,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }: { pageParam: string | null }) =>
      kyInstance
        .get(
          `/api/users/${userId}/media`,
          pageParam ? { searchParams: { cursor: pageParam } } : undefined
        )
        .json<UserMediaPage>(),
    queryKey: ["media-gallery", userId],
    staleTime: 1000 * 60,
  });
}
