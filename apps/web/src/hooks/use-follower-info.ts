import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FollowerInfo } from "@asm/db";
import kyInstance from "@/lib/ky";

export function useFollowerInfo(userId: string, initialData: FollowerInfo) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ["follower-info", userId],
    queryFn: async () => {
      const response = await kyInstance
        .get(`/api/users/${userId}/followers`)
        .json<FollowerInfo>();
      return response;
    },
    initialData,
    staleTime: 30_000,
    // @ts-expect-error
    onSuccess: (data) => {
      queryClient.setQueriesData(
        { queryKey: ["follower-info"] },
        // biome-ignore lint/suspicious/noExplicitAny: any
        (oldData: any) => ({
          ...oldData,
          [userId]: data,
        })
      );
    },
  });
}
