"use client";

import type { UserData } from "@asm/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

// Subscribes a server-fetched UserData to the [\"user\", id] query cache so that
// avatar/profile mutations (which setQueryData into that key) re-render every
// consumer in real time instead of showing stale server props.
//
// - initialData supplies the prop for the first render.
// - The effect re-syncs the fresh server prop into the cache on mount and on
//   navigation, so revisiting a previously cached profile never shows stale data.
// - The queryFn returns the prop so external invalidations of this key (e.g. the
//   follow/unfollow mutations in user-mutations.ts) can safely refetch without
//   erroring on a queryFn-less query.
export function useUserDataQuery(userData: UserData) {
  const queryClient = useQueryClient();
  const userId = userData.id;

  useEffect(() => {
    queryClient.setQueryData(["user", userId], userData);
  }, [queryClient, userId, userData]);

  return useQuery({
    initialData: userData,
    // Mutations update this key directly (setQueryData) and then invalidate it.
    // The refetch must NOT clobber that fresher value with the captured server
    // prop, or the sidebars only update after a manual refresh - prefer the
    // live cache, falling back to the prop only when the cache is empty.
    queryFn: () =>
      queryClient.getQueryData<UserData>(["user", userId]) ?? userData,
    queryKey: ["user", userId],
    staleTime: Number.POSITIVE_INFINITY,
  });
}
