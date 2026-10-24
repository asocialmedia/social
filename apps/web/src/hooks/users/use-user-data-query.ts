"use client";

import type { UserData } from "@asm/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import type { PrivateUserData } from "@/hooks/users/use-user-data";
import kyInstance from "@/lib/ky";

// Subscribes a server-fetched UserData to the [\"user\", id] query cache so that
// avatar/profile mutations (which setQueryData into that key) re-render every
// consumer in real time instead of showing stale server props.
//
// - initialData supplies the prop for the first render.
// - The effect re-syncs the fresh server prop into the cache on mount and on
//   navigation, so revisiting a previously cached profile never shows stale data.
// - Refetches merge public profile totals and mutuals into the cached identity,
//   preserving the owner's private fields needed by the edit dialog.
export function useUserDataQuery<T extends UserData | PrivateUserData>(
  userData: T,
  enabled = true
) {
  const queryClient = useQueryClient();
  const userId = userData.id;

  useEffect(() => {
    queryClient.setQueryData<T>(["user", userId], userData);
  }, [queryClient, userId, userData]);

  const query = useQuery<T>({
    enabled,
    initialData: userData,
    queryFn: async ({ signal }) => {
      const fresh = await kyInstance
        .get(`/api/users/${encodeURIComponent(userId)}`, { signal })
        .json<UserData>();
      return {
        ...(queryClient.getQueryData<T>(["user", userId]) ?? userData),
        ...fresh,
        createdAt: new Date(fresh.createdAt),
      };
    },
    queryKey: ["user", userId],
    staleTime: 30_000,
  });

  return { ...query, data: query.data ?? userData };
}
