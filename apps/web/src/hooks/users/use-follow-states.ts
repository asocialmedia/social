"use client";

import type { FollowerInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/(main)/session-provider";

export function useFollowStates(userIds: string[]) {
  const { user } = useSession();
  return useQuery({
    enabled: userIds.length > 0 && Boolean(user),
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
