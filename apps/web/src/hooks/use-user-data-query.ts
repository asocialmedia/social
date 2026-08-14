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
    queryFn: () => userData,
    queryKey: ["user", userId],
    staleTime: Number.POSITIVE_INFINITY,
  });
}
