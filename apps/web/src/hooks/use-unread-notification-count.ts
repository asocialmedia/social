"use client";

import type { NotificationCountInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";

import { useSession } from "@/app/(main)/session-provider";
import kyInstance from "@/lib/ky";

export function useUnreadNotificationCount() {
  const { user } = useSession();
  return useQuery({
    enabled: Boolean(user),
    queryFn: () =>
      kyInstance
        .get("/api/notifications/unread-count")
        .json<NotificationCountInfo>(),
    queryKey: ["unread-notification-count"],
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    staleTime: 60 * 1000,
  });
}
