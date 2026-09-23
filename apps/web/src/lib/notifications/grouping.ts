// The grouping logic lives once, in @asm/notifications/shared. This module
// keeps the app-local import path stable and types it against the Prisma
// Notification shape. It must stay client-safe: the notifications page is a
// client component, and a runtime import from @asm/db would drag Prisma, pg,
// ioredis, bullmq and the S3 client into the browser bundle - only type
// imports from @asm/db are allowed here.
import type { GroupedNotificationData, NotificationData } from "@asm/db";
import { groupNotifications as groupShared } from "@asm/notifications/shared";

export type { GroupedNotificationData } from "@asm/db";

export function groupNotifications(
  notifications: NotificationData[]
): GroupedNotificationData[] {
  return groupShared(notifications);
}
