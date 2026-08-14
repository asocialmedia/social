import type { FollowerInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";

export function useFollowStates(userIds: string[]) {
  return useQuery({
    enabled: userIds.length > 0,
    queryFn: async () => {
      const response = await fetch("/api/users/follow-states", {
        body: JSON.stringify({ userIds }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return response.json() as Promise<Record<string, FollowerInfo>>;
    },
    queryKey: ["follow-states", userIds],
  });
}
