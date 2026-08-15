"use client";

import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/(main)/session-provider";
import { fetchUnreadMessageCount } from "@/lib/messages/client";

export function useUnreadMessageCount(): number {
  const { user } = useSession();
  const { data } = useQuery({
    enabled: Boolean(user),
    queryFn: fetchUnreadMessageCount,
    queryKey: ["unread-message-count", user?.id],
    refetchInterval: 60_000,
  });
  return data ?? 0;
}
