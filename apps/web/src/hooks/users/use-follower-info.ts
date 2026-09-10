import type { FollowerInfo } from "@asm/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import kyInstance from "@/lib/ky";

export function useFollowerInfo(userId: string, initialData: FollowerInfo) {
  const queryClient = useQueryClient();

  return useQuery({
    initialData,
    // @ts-expect-error -- onSuccess accepts a callback that syncs the follower cache
    onSuccess: (data) => {
      queryClient.setQueriesData(
        { queryKey: ["follower-info"] },
        (oldData: unknown) => ({
          ...(typeof oldData === "object" && oldData !== null ? oldData : {}),
          [userId]: data,
        })
      );
    },
    queryFn: async () => {
      const response = await kyInstance
        .get(`/api/users/${userId}/followers`)
        .json<FollowerInfo>();
      return response;
    },
    queryKey: ["follower-info", userId],
    staleTime: 30_000,
  });
}
