// Re-export of the shared grouping implementation so existing @asm/db
// consumers keep their import path while the logic lives exactly once in
// @asm/notifications/shared (the copy RN can also bundle).
import { groupNotifications as groupShared } from "@asm/notifications/shared";
import type { GroupedNotification } from "@asm/notifications/shared";

import type { NotificationData } from "../client";

export type GroupedNotificationData = GroupedNotification<NotificationData>;

export function groupNotifications(
  notifications: NotificationData[]
): GroupedNotificationData[] {
  return groupShared(notifications);
}
