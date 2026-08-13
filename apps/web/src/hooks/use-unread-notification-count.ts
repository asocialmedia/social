import type { NotificationCountInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";
import kyInstance from "@/lib/ky";

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ["unread-notification-count"],
    queryFn: () =>
      kyInstance
        .get("/api/notifications/unread-count")
        .json<NotificationCountInfo>(),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });
}
