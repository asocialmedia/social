import type { NotificationCountInfo } from "@asm/db";
import { useQuery } from "@tanstack/react-query";

import kyInstance from "@/lib/ky";

export function useUnreadNotificationCount() {
  return useQuery({
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
